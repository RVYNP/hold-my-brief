import { getDocument, GlobalWorkerOptions, TextLayer, type PageViewport, type PDFDocumentProxy, type PDFPageProxy, type RenderTask } from 'pdfjs-dist';
import workerURL from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import 'pdfjs-dist/web/pdf_viewer.css';
import './pdf.css';
import type { Locator, OutlineItem, PageThumbnails, Position, PreviewSink, ReaderAdapter, ReaderContext, ReaderOptions, ReaderSource } from '../types';
import { MIN_SPREAD_WIDTH, pagesLabel, spreadPages } from '../spread';
import { searchUnits, type DocumentSearch, type SearchHit, type SearchOptions, type UnitText } from '../search';
import { BitmapCache, PREVIEW_CACHE_BYTES, THUMBNAIL_HEIGHT } from '../page-strip';
import { PREVIEW_CLASS } from '../zoom-gesture';
import { restoreView, type Anchor } from '../zoom-anchor';
import { clampZoom, DEFAULT_LIMITS, type ZoomLimits } from '../zoom';

GlobalWorkerOptions.workerSrc = workerURL;
/** Bound on decoded page bitmaps kept for instant page turns (bytes of canvas backing store). */
const PAGE_CACHE_BYTES = 32 * 1024 * 1024;
/** pdf.js's CSS_UNITS: a PDF point is 1/72 in and a CSS pixel 1/96 in, so a page at 100 % is 96/72 CSS px per point. */
const CSS_UNITS = 96 / 72;
/** The longest a page may be drawn along either side, in CSS px. Browsers lay out and tile far more, but stop short of their ~33 M px layout ceiling with room to spare. */
const MAX_PAGE_EXTENT = 24_000;
/** The most pixels along one side of a canvas backing store (Chromium, WebView2 and WebKit all stop at 16 384). */
const MAX_CANVAS_SIDE = 16_384;
/** A thumbnail somebody asked for: waits in the queue until the main page has finished, runs alone, and is dropped when its signal aborts. */
type ThumbnailJob = { page: number; signal: AbortSignal; resolve: (bitmap: HTMLCanvasElement | undefined) => void };
const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));

export class PdfAdapter implements ReaderAdapter {
  readonly mode = 'fixed' as const;
  readonly spreads = true;
  private doc?: PDFDocumentProxy;
  private loading?: ReturnType<typeof getDocument>;
  private host!: HTMLElement;
  private context!: ReaderContext;
  private options!: ReaderOptions;
  /** Committed pages in reading order: one page, or a two-page spread. */
  private pages = [1];
  /** First page of the most recently requested page or spread. */
  private requested = 1;
  /** Two-page state of the committed view; undefined when single pages were asked for. */
  private shownSpread: Position['spread'];
  private labels: string[] | null = null;
  private items: OutlineItem[] = [];
  private destinations = new Map<string, unknown>();
  private history: Locator[] = [];
  private generation = 0;
  private disposed = false;
  private tasks: RenderTask[] = [];
  private layers: TextLayer[] = [];
  private currentPages: PDFPageProxy[] = [];
  private surface?: HTMLElement;
  /** The level the pages on screen are drawn at, and the one the page being laid out will have once it is shown. */
  private level?: number;
  private nextLevel?: number;
  private status?: HTMLElement;
  private observer?: ResizeObserver;
  private resizeTimer?: ReturnType<typeof setTimeout>;
  private pageCache = new Map<string, HTMLCanvasElement>();
  /** Plain text per physical page, extracted on demand for search and kept with the document. */
  private textCache = new Map<number, string>();
  /** The hit currently marked per page, redrawn whenever the shown pages change. */
  private marks = new Map<number, SearchHit>();
  /**
   * Whether a page on screen has no text layer. `undefined` until the shown pages' text has been
   * read; reported through `Position.imageOnly` and re-reported once it is known.
   */
  private imageOnly?: boolean;
  private prefetchAbort?: AbortController;
  private prefetching = false;
  /** The page-preview strip while it is on. */
  private previews?: PreviewSink;
  /** Thumbnails, in a bounded bitmap cache of their own, rendered one at a time and only while the main page is not being drawn. */
  private previewCache = new BitmapCache<HTMLCanvasElement>(PREVIEW_CACHE_BYTES);
  private thumbQueue: ThumbnailJob[] = [];
  private thumbTask?: RenderTask;
  private pumping = false;
  /** True once the page in `render` has everything, text layer and links included; thumbnails wait for it so the strip never delays first paint. */
  private settled = false;
  private explicitEnd = false;
  private onScroll = () => { if (!this.host.hasAttribute('aria-busy')) {
    if (this.host.scrollTop < this.host.scrollHeight - this.host.clientHeight - 2) this.explicitEnd = false;
    this.report();
  } };

  async open(source: ReaderSource, host: HTMLElement, context: ReaderContext, options: ReaderOptions) {
    this.host = host; this.context = context; this.options = { ...options };
    host.classList.add('pdf-reader'); host.tabIndex = 0;
    host.setAttribute('aria-label', 'PDF reading surface');
    const root = new URL(`${import.meta.env.BASE_URL}pdfjs/`, location.href).href;
    const loading = this.loading = getDocument({ data: source.bytes,
      cMapUrl: `${root}cmaps/`, cMapPacked: true, standardFontDataUrl: `${root}standard_fonts/`, wasmUrl: `${root}wasm/`,
      enableXfa: false, maxImageSize: 40_000_000 });
    loading.onPassword = (update: (password: string) => void) => { void context.requestPassword().then(password => {
      if (password === null || this.disposed) void loading.destroy(); else update(password);
    }).catch(error => { context.onError(error); void loading.destroy(); }); };
    this.doc = await loading.promise;
    if (this.disposed) { await loading.destroy(); return; }
    this.labels = await this.doc.getPageLabels();
    const walk = (nodes: Awaited<ReturnType<PDFDocumentProxy['getOutline']>>) => {
      for (const node of nodes ?? []) {
        if (node.dest) { const target = `outline:${this.items.length}`; this.destinations.set(target, node.dest); this.items.push({ label: node.title, target }); }
        walk(node.items);
      }
    };
    walk(await this.doc.getOutline());
    await this.render(1);
    host.addEventListener('scroll', this.onScroll, { passive: true });
    let size = `${host.clientWidth}:${host.clientHeight}`;
    this.observer = new ResizeObserver(() => {
      // A zoom gesture is scaling the page and hides the scrollbars meanwhile; the size it reports is not a resize, and the gesture commits its own render.
      if (host.classList.contains(PREVIEW_CLASS)) return;
      const next = `${host.clientWidth}:${host.clientHeight}`;
      if (size === next || !host.clientWidth || !host.clientHeight) return;
      size = next;
      clearTimeout(this.resizeTimer);
      // Read the current committed location when the resize settles. Capturing
      // it here can overwrite a newer page/link navigation during the delay.
      this.resizeTimer = setTimeout(() => {
        if (!this.disposed && !host.hasAttribute('aria-busy') && !host.classList.contains(PREVIEW_CLASS))
          void this.restore(this.getPosition().locator).catch(context.onError);
      }, 100);
    });
    this.observer.observe(host);
  }

  /** Two-page state for the current options and panel width; offsetWidth ignores scrollbars, so a refit cannot flip it. */
  private spreadState(): Position['spread'] {
    return this.options.spread ? this.host.offsetWidth >= MIN_SPREAD_WIDTH ? 'active' : 'waiting' : undefined;
  }
  private pagesAt(page: number, spread: boolean) {
    const count = this.doc?.numPages ?? 1;
    return spread ? spreadPages(page, count, this.options.cover !== false) : [clamp(Math.trunc(page), 1, count)];
  }

  /** `anchored` means `x` is a fraction of page `pageNumber` itself (a link target) rather than of the whole view. */
  private async render(pageNumber: number, y = 0, x = 0, atEnd = false, anchored = false, hold?: Anchor) {
    const doc = this.doc;
    if (!doc || this.disposed) return;
    const generation = ++this.generation;
    const state = this.spreadState(), spread = state === 'active';
    const numbers = this.pagesAt(pageNumber, spread);
    this.requested = numbers[0];
    this.settled = false; this.pauseThumbnails();
    for (const task of this.tasks) task.cancel();
    for (const layer of this.layers) layer.cancel();
    this.tasks = []; this.layers = [];
    this.status?.remove();
    const status = this.status = document.createElement('div');
    const which = numbers.length > 1 ? `pages ${numbers[0]}–${numbers[1]}` : `page ${numbers[0]}`;
    status.className = 'pdf-render-status'; status.setAttribute('role', 'status'); status.textContent = `Loading ${which}…`;
    // Keep loading/retry UI out of page flow: a temporary scrollbar retriggers resize.
    status.style.top = `${this.host.scrollTop + 8}px`;
    status.style.left = `${this.host.scrollLeft + 8}px`;
    this.host.append(status); this.host.setAttribute('aria-busy', 'true');
    try {
      const pages = await Promise.all(numbers.map(number => doc.getPage(number)));
      if (generation !== this.generation || this.disposed) return;
      const laid = this.layout(pages, numbers, spread); this.nextLevel = laid.level;
      const shown = laid.items.map(({ viewport, scale, dpr, pixelsWidth, pixelsHeight, key }, index) => {
        const surface = document.createElement('div'); surface.className = 'pdf-page';
        surface.style.width = `${viewport.width}px`; surface.style.height = `${viewport.height}px`;
        surface.style.setProperty('--scale-factor', String(scale));
        surface.style.setProperty('--total-scale-factor', String(scale));
        // A cached bitmap for a neighbouring page paints in the same frame as the turn:
        // no decode, no rasterization, just a blit into the new canvas.
        const canvas = document.createElement('canvas'); canvas.setAttribute('aria-hidden', 'true');
        const cached = this.pageCache.get(key);
        canvas.width = pixelsWidth; canvas.height = pixelsHeight;
        canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`;
        if (cached) canvas.getContext('2d')?.drawImage(cached, 0, 0);
        surface.append(canvas);
        const task = cached ? undefined
          : pages[index].render({ canvas, viewport, transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0] });
        if (task) { this.tasks.push(task); void task.promise.catch(() => {}); } // Cancellation can occur while text extraction is still pending.
        return { page: pages[index], surface, canvas, viewport, key, task };
      });
      const pagesWidth = shown.reduce((sum, { viewport }) => sum + viewport.width, 0);
      const size = { width: pagesWidth, height: shown[0].viewport.height };
      let view = shown[0].surface;
      if (spread) {
        // Pages sit edge to edge. A page without a partner keeps its side of the open book:
        // the cover on the right, a final even page on the left.
        view = document.createElement('div'); view.className = 'pdf-spread';
        const side = shown.length > 1 ? 'both' : numbers[0] === 1 && this.options.cover !== false ? 'right' : 'left';
        view.dataset.side = side;
        if (side !== 'both') size.width *= 2;
        view.style.width = `${size.width}px`; view.style.height = `${size.height}px`;
        view.append(...shown.map(({ surface }) => surface));
        if (anchored) {
          const index = Math.max(0, numbers.indexOf(Math.trunc(pageNumber)));
          const offset = side === 'right' ? pagesWidth : shown.slice(0, index).reduce((sum, { viewport }) => sum + viewport.width, 0);
          x = (offset + clamp(x) * shown[index].viewport.width) / size.width;
        }
      }
      // Show the pages as soon as they have pixels. The text layer and links are layered on
      // afterwards: waiting for them would delay first content by a full frame budget.
      this.commit(view, numbers, pages, size, y, x, atEnd, state, hold);
      this.showPreviews();
      const texts = await Promise.all(pages.map(page => page.getTextContent()));
      if (generation !== this.generation || this.disposed) { for (const { task } of shown) task?.cancel(); return; }
      // Text arrives after the pages are shown, so the state is reported again once it is known.
      // No text is ever drawn over a page: a page without a text layer is only marked.
      const empty = texts.map(text => !text.items.length);
      for (const [index, { surface }] of shown.entries()) surface.toggleAttribute('data-image-only', empty[index]);
      const imageOnly = empty.some(Boolean);
      if (imageOnly !== !!this.imageOnly) { this.imageOnly = imageOnly; this.report(); } else this.imageOnly = imageOnly;
      for (const [index, { page, surface, canvas, viewport, key, task }] of shown.entries()) {
        if (task) await task.promise;
        if (generation !== this.generation || this.disposed) return;
        // Only a completed raster may be reused: a cancelled task leaves a partially painted canvas.
        if (task) this.cachePage(key, canvas);
        const textContainer = document.createElement('div'); textContainer.className = 'textLayer';
        surface.append(textContainer);
        const layer = new TextLayer({ textContentSource: texts[index], container: textContainer, viewport });
        this.layers.push(layer);
        await layer.render();
        if (generation !== this.generation || this.disposed) return;
        for (const annotation of await page.getAnnotations()) {
          if (annotation.subtype !== 'Link' || (!annotation.dest && !annotation.url)) continue;
          const [x1, y1] = viewport.convertToViewportPoint(annotation.rect[0], annotation.rect[1]);
          const [x2, y2] = viewport.convertToViewportPoint(annotation.rect[2], annotation.rect[3]);
          const link = document.createElement('a'); link.className = 'pdf-link'; link.href = '#';
          link.setAttribute('aria-label', annotation.url ? `Open ${annotation.url}` : 'Go to linked passage');
          Object.assign(link.style, { left: `${Math.min(x1, x2)}px`, top: `${Math.min(y1, y2)}px`, width: `${Math.abs(x2 - x1)}px`, height: `${Math.abs(y2 - y1)}px` });
          link.addEventListener('click', event => { event.preventDefault();
            if (annotation.dest) { this.pushHistory(); void this.followDestination(annotation.dest).catch(this.context.onError); }
            else if (/^https?:\/\//i.test(annotation.url)) void this.context.openExternal(annotation.url).catch(this.context.onError);
          }); surface.append(link);
        }
        if (generation !== this.generation || this.disposed) return;
      }
      this.prefetchNeighbours(numbers, spread);
    } catch (error) {
      if (generation !== this.generation || this.disposed || (error as Error).name === 'RenderingCancelledException') return;
      this.requested = this.pages[0]; this.host.removeAttribute('aria-busy');
      status.textContent = `${which[0].toUpperCase()}${which.slice(1)} could not be rendered. `;
      const retry = document.createElement('button'); retry.textContent = 'Retry'; retry.onclick = () => { void this.render(pageNumber, y, x, atEnd, anchored).catch(this.context.onError); }; status.append(retry);
      throw error;
    } finally {
      // A newer render owns the flag; this one only releases the queue when nothing superseded it (and an error leaves the strip working).
      if (generation === this.generation && !this.disposed) { this.settled = true; this.pumpThumbnails(); }
    }
  }
  /** The height the pages shown together take to fit the panel (fit page: the whole spread; fit width: its width), in CSS px. */
  private fitHeight(bases: PageViewport[], spread: boolean, fit: ReaderOptions['fit']) {
    const width = Math.max(100, this.host.clientWidth - 32), height = Math.max(100, this.host.clientHeight - 32);
    const aspect = bases.reduce((sum, base) => sum + base.width / base.height, 0) * (spread && bases.length === 1 ? 2 : 1);
    return fit === 'width' ? width / aspect : Math.min(height, width / aspect);
  }
  private basesOf(pages: PDFPageProxy[]) { return pages.map(page => page.getViewport({ scale: 1, rotation: this.rotationOf(page) })); }
  /** Pages of a spread share one height, so a level is that of the tallest: 100 % draws it at its physical size. */
  private referenceOf(bases: PageViewport[]) { return Math.max(...bases.map(base => base.height)); }
  /** What a page can be zoomed to before it is too long to lay out: very large sheets stop short of the global limit. */
  private limitsOf(bases: PageViewport[]): ZoomLimits {
    const extent = Math.max(...bases.map(base => Math.max(base.width, base.height)));
    return extent > 0 ? { min: DEFAULT_LIMITS.min, max: Math.max(DEFAULT_LIMITS.min, Math.min(DEFAULT_LIMITS.max, MAX_PAGE_EXTENT / (CSS_UNITS * extent))) } : DEFAULT_LIMITS;
  }
  /**
   * Geometry and cache identity for the pages shown together at the current options and host size, and the level they are
   * drawn at. A fit follows the panel: fit page fits the whole spread and fit width its width, and a page alone in two-page view
   * keeps the size of half a spread. Otherwise the level is the zoom itself, 1 being the tallest page at its physical size.
   */
  private layout(pages: PDFPageProxy[], numbers: number[], spread: boolean) {
    const rotation = (page: PDFPageProxy) => this.rotationOf(page);
    const bases = this.basesOf(pages), reference = this.referenceOf(bases);
    const common = this.options.fitted ? this.fitHeight(bases, spread, this.options.fit) : clampZoom(this.options.zoom, this.limitsOf(bases)) * CSS_UNITS * reference;
    const items = pages.map((page, index) => {
      const scale = common / bases[index].height;
      const viewport = page.getViewport({ scale, rotation: rotation(page) });
      // Cap the backing store by device pixels actually displayed, not by a flat 2x; a very large page is drawn at fewer pixels than it is shown at.
      const dpr = Math.min(devicePixelRatio || 1, 2, Math.sqrt(16_000_000 / (viewport.width * viewport.height)), MAX_CANVAS_SIDE / Math.max(viewport.width, viewport.height));
      const pixelsWidth = Math.ceil(viewport.width * dpr), pixelsHeight = Math.ceil(viewport.height * dpr);
      // Rotation is part of the identity: 0° and 180° share pixel dimensions but not pixels.
      return { viewport, scale, dpr, pixelsWidth, pixelsHeight, key: `${numbers[index]}:${rotation(page)}:${pixelsWidth}x${pixelsHeight}` };
    });
    return { items, level: common / (CSS_UNITS * reference) };
  }

  /** Puts rendered pages on screen and records the position they represent. */
  private commit(view: HTMLElement, numbers: number[], pages: PDFPageProxy[], size: { width: number; height: number }, y: number, x: number, atEnd: boolean, state: Position['spread'], hold?: Anchor) {
    const previous = this.currentPages;
    this.currentPages = pages; this.pages = numbers; this.surface = view; this.shownSpread = state; this.level = this.nextLevel;
    this.host.replaceChildren(view); this.host.removeAttribute('aria-busy');
    this.host.scrollTop = atEnd ? this.host.scrollHeight : clamp(y) * size.height;
    this.host.scrollLeft = clamp(x) * size.width;
    if (hold) restoreView(hold); // A zoom holds the point it was asked to, instead of the page corner the saved fraction names.
    this.explicitEnd = atEnd; this.imageOnly = undefined; // Unknown until this screen's text is read.
    for (const page of previous) if (!pages.includes(page)) page.cleanup();
    this.paintMarks();
    this.report();
  }

  /** Keeps a bounded set of rendered bitmaps so the next/previous turn can blit instead of rasterize. */
  private cachePage(key: string, canvas: HTMLCanvasElement) {
    this.pageCache.delete(key);
    // A single displayed page at 2x is a few MB; the bound keeps the whole adapter well under
    // any per-document memory budget while still covering the pages a reader turns between.
    const bytes = (bitmap: HTMLCanvasElement) => bitmap.width * bitmap.height * 4;
    let total = Array.from(this.pageCache.values()).reduce((sum, bitmap) => sum + bytes(bitmap), 0);
    const cost = bytes(canvas);
    while (this.pageCache.size && total + cost > PAGE_CACHE_BYTES) {
      const oldest = this.pageCache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      const bitmap = this.pageCache.get(oldest);
      this.pageCache.delete(oldest);
      total -= bitmap ? bytes(bitmap) : 0;
    }
    if (cost > PAGE_CACHE_BYTES) return;
    this.pageCache.set(key, canvas);
  }

  /** Warms the neighbouring pages or spreads at idle so a held-down page key does not rasterize on demand. */
  private prefetchNeighbours(shown: number[], spread: boolean) {
    const doc = this.doc;
    if (!doc || this.disposed || this.prefetching) return;
    this.prefetching = true;
    const controller = new AbortController();
    this.prefetchAbort?.abort();
    this.prefetchAbort = controller;
    void (async () => {
      try {
        for (const start of [shown.at(-1)! + 1, shown[0] - 1]) {
          if (start < 1 || start > doc.numPages || controller.signal.aborted || this.disposed) continue;
          // A spread's geometry depends on both pages, so the whole neighbouring spread is laid out together.
          const numbers = this.pagesAt(start, spread);
          const pages = await Promise.all(numbers.map(number => doc.getPage(number)));
          if (controller.signal.aborted || this.disposed) return;
          for (const [index, { viewport, dpr, pixelsWidth, pixelsHeight, key }] of this.layout(pages, numbers, spread).items.entries()) {
            // A page too big for the cache would be drawn only to be thrown away.
            if (this.pageCache.has(key) || pixelsWidth * pixelsHeight * 4 > PAGE_CACHE_BYTES) continue;
            const canvas = document.createElement('canvas');
            canvas.width = pixelsWidth; canvas.height = pixelsHeight;
            await pages[index].render({ canvas, viewport, transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0] }).promise;
            if (controller.signal.aborted || this.disposed) return;
            this.cachePage(key, canvas);
          }
        }
      } catch { /* Prefetch is an optimization; a failure must never surface to the reader. */ }
      finally { if (this.prefetchAbort === controller) this.prefetching = false; }
    })();
  }

  private rotationOf(page: PDFPageProxy) { return ((page.rotate + this.options.rotation) % 360 + 360) % 360; }

  /** The strip attaches (or detaches); a page that is still loading reports itself when it commits. */
  setPreviews(sink?: PreviewSink) {
    if (sink === this.previews) return;
    this.previews = sink;
    if (sink && !this.disposed && this.doc && !this.host.hasAttribute('aria-busy')) this.showPreviews();
  }
  private showPreviews() {
    const sink = this.previews, page = this.currentPages[0];
    if (!sink || !page || this.disposed) return;
    const base = page.getViewport({ scale: 1, rotation: this.rotationOf(page) });
    sink.show({ source: this.thumbnails, count: this.doc?.numPages ?? 1, pages: [...this.pages], spread: this.shownSpread === 'active', cover: this.options.cover !== false,
      aspect: base.width / base.height, revision: `${this.options.rotation}` });
  }

  readonly thumbnails: PageThumbnails = {
    cached: page => this.previewCache.get(this.thumbnailKey(page)),
    render: (page, signal, urgent = false) => this.queueThumbnail(page, signal, urgent),
    open: page => this.render(page),
  };
  /** Thumbnails depend on the page, the document's rotation and the pixel ratio; a page's own /Rotate never changes. */
  private thumbnailKey(page: number) { return `${page}:${this.options?.rotation ?? 0}:${Math.min(devicePixelRatio || 1, 2)}`; }
  private queueThumbnail(page: number, signal: AbortSignal, urgent: boolean): Promise<HTMLCanvasElement | undefined> {
    const hit = this.previewCache.get(this.thumbnailKey(page));
    if (hit) return Promise.resolve(hit);
    if (signal.aborted || this.disposed || !this.doc || page < 1 || page > this.doc.numPages) return Promise.resolve(undefined);
    return new Promise(resolve => {
      const job: ThumbnailJob = { page, signal, resolve };
      signal.addEventListener('abort', () => {
        const at = this.thumbQueue.indexOf(job);
        if (at >= 0) this.thumbQueue.splice(at, 1);
        resolve(undefined);
        if (this.thumbJob === job) this.thumbTask?.cancel();
      }, { once: true });
      if (urgent) this.thumbQueue.unshift(job); else this.thumbQueue.push(job);
      this.pumpThumbnails();
    });
  }
  private thumbJob?: ThumbnailJob;
  /** A page render is starting: the thumbnail being drawn stops (its request waits for the page) so the page gets the worker. */
  private pauseThumbnails() { this.thumbTask?.cancel(); }
  /**
   * Draws queued thumbnails one at a time while the main page is settled. A page turn pauses the one running and puts it back,
   * so holding PgDn never finishes thumbnails it passes: only the strip's requests for the page it lands on resume.
   */
  private pumpThumbnails() {
    if (this.pumping || !this.settled || this.disposed) return;
    this.pumping = true;
    void (async () => {
      try {
        while (this.settled && !this.disposed) {
          const job = this.thumbQueue.shift();
          if (!job) break;
          if (job.signal.aborted) continue;
          const bitmap = await this.drawThumbnail(job);
          if (bitmap === null) { this.thumbQueue.unshift(job); continue; } // Paused by a page turn: it asks again when the page has settled.
          job.resolve(bitmap);
        }
      } finally { this.pumping = false; this.thumbJob = undefined; }
    })();
  }
  /** The bitmap, `undefined` when the page cannot be drawn or the request was dropped, `null` when a page turn paused the render. */
  private async drawThumbnail(job: ThumbnailJob): Promise<HTMLCanvasElement | undefined | null> {
    const key = this.thumbnailKey(job.page), hit = this.previewCache.get(key);
    if (hit) return hit;
    const doc = this.doc;
    if (!doc) return undefined;
    try {
      const page = await doc.getPage(job.page), rotation = this.rotationOf(page);
      if (job.signal.aborted || !this.settled || this.disposed) return job.signal.aborted ? undefined : null;
      const base = page.getViewport({ scale: 1, rotation }), dpr = Math.min(devicePixelRatio || 1, 2);
      // Every thumbnail is as tall as the strip allows; an extreme banner is narrowed instead of crowding out the rest.
      const viewport = page.getViewport({ scale: Math.min(THUMBNAIL_HEIGHT / base.height, 2 * THUMBNAIL_HEIGHT / base.width), rotation });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width * dpr); canvas.height = Math.ceil(viewport.height * dpr);
      const task = this.thumbTask = page.render({ canvas, viewport, transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0] });
      this.thumbJob = job;
      await task.promise;
      this.previewCache.set(key, canvas);
      return canvas;
    } catch (error) {
      if (job.signal.aborted) return undefined;
      return (error as Error).name === 'RenderingCancelledException' ? null : undefined; // A thumbnail that fails stays a blank tile and never surfaces.
    } finally { this.thumbTask = undefined; this.thumbJob = undefined; }
  }

  private pushHistory() { this.history.push(this.getPosition().locator); if (this.history.length > 20) this.history.shift(); }
  private report() { if (!this.disposed) this.context.onPosition(this.getPosition()); }

  /**
   * Searches every page's text layer and reports each hit on its physical page.
   *
   * Text is extracted page by page and cached, because a search over a 1,000-page document
   * would otherwise re-extract everything on the next query. The cache holds the text only
   * (a few MB even for a long book) and is dropped with the document.
   */
  async search(query: string, options: SearchOptions = {}): Promise<DocumentSearch> {
    const doc = this.doc;
    if (!doc || this.disposed) return { hits: [], truncated: false };
    const units: UnitText[] = [];
    let textPages = 0;
    for (let number = 1; number <= doc.numPages; number++) {
      const text = await this.pageText(number);
      if (this.disposed) return { hits: [], truncated: false };
      if (!text.trim()) continue;
      textPages++;
      units.push({ text, number, label: this.labels?.[number - 1] || `Page ${number}` });
    }
    // A PDF of scans has pages but no text layer: say so instead of "no matches", which
    // would wrongly imply the word is not on the page.
    if (!textPages) return { hits: [], truncated: false, unavailable: 'No text layer in this document (it may be scanned images)' };
    const { hits, truncated } = searchUnits(units, query, options);
    return { hits, truncated };
  }

  /** Extracts (and caches) the plain text of one page. */
  private async pageText(number: number): Promise<string> {
    const cached = this.textCache.get(number);
    if (cached !== undefined) return cached;
    const doc = this.doc;
    if (!doc) return '';
    const text = (await (await doc.getPage(number)).getTextContent()).items.map(item => ('str' in item ? item.str : '')).join(' ');
    this.textCache.set(number, text);
    return text;
  }

  async readText(limit: number): Promise<{ label: string; text: string }> {
    // The committed pages are what is on screen, including a cover shown alone in a spread.
    const position = this.getPosition(), pages = [...this.pages];
    const texts = await Promise.all(pages.map(page => this.pageText(page)));
    return { label: position.label, text: texts.map((text, index) => `[${this.labels?.[pages[index] - 1] || `Page ${pages[index]}`}]\n${text}`).join('\n\n').slice(0, limit) };
  }

  /**
   * Navigates to a hit and marks it. Marks live in a separate absolutely-positioned layer
   * over the canvas, so the PDF text layer (which owns selection) is never mutated.
   */
  async revealSearchMatch(hit: SearchHit): Promise<void> {
    if (this.disposed || !this.doc) return;
    await this.render(hit.unit);
    this.marks.set(hit.unit, hit);
    this.paintMarks();
  }

  clearSearchHighlights(): void {
    this.marks.clear();
    this.paintMarks();
  }

  /**
   * Draws a mark for each remembered hit on the pages currently shown.
   *
   * The position is approximate: PDF text items carry no character offsets, so the mark is
   * placed relative to where the matched string sits within the page's concatenated text.
   * It is advisory — the page itself is the precise destination.
   */
  private paintMarks(): void {
    const surface = this.surface;
    if (!surface) return;
    for (const layer of Array.from(surface.querySelectorAll('.search-marker-layer'))) layer.remove();
    const layer = document.createElement('div');
    layer.className = 'search-marker-layer';
    const matched = this.pages.map(number => this.marks.get(number)).filter((hit): hit is SearchHit => Boolean(hit));
    if (!matched.length) return;
    for (const hit of matched) {
      // Spread the mark down the page by the hit's relative position in the page text, so a
      // hit near the end marks nearer the bottom. Entirely cosmetic, never used for math.
      const text = this.textCache.get(hit.unit) ?? '';
      const ratio = text.length ? hit.start / text.length : 0;
      const mark = document.createElement('div');
      mark.className = 'search-marker';
      mark.style.top = `${Math.min(92, Math.max(2, ratio * 100))}%`;
      layer.append(mark);
    }
    surface.append(layer);
  }

  async navigate(action: Parameters<ReaderAdapter['navigate']>[0]) {
    if (!this.doc) return;
    if (action === 'back') { const old = this.history.pop(); if (old) await this.restore(old); return; }
    if (action === 'start' || action === 'end') { this.pushHistory(); await this.render(action === 'start' ? 1 : this.doc.numPages, 0, 0, action === 'end'); return; }
    const forward = action === 'next' || action === 'screen-next';
    if (action.startsWith('screen-') && !this.host.hasAttribute('aria-busy')) {
      const max = this.host.scrollHeight - this.host.clientHeight;
      if ((forward && this.host.scrollTop < max - 2) || (!forward && this.host.scrollTop > 2)) {
        this.host.scrollTop = clamp(this.host.scrollTop + (forward ? 1 : -1) * this.host.clientHeight * .9, 0, max); this.report(); return;
      }
    }
    // Turns move by the requested page or spread, so a held key never waits for the commit.
    const requested = this.pagesAt(this.requested, this.spreadState() === 'active');
    const target = forward ? requested.at(-1)! + 1 : requested[0] - 1;
    if (target >= 1 && target <= this.doc.numPages) await this.render(target, forward ? 0 : action === 'screen-previous' ? 1 : 0);
  }
  async goTo(target: string) {
    if (this.destinations.has(target)) { this.pushHistory(); await this.followDestination(this.destinations.get(target)); return; }
    const page = Number(target);
    if (!/^\d+$/.test(target) || !Number.isInteger(page) || page < 1 || page > (this.doc?.numPages ?? 0)) throw new Error(`Enter a physical page from 1 to ${this.doc?.numPages ?? 0}.`);
    this.pushHistory(); await this.render(page);
  }
  private async followDestination(destination: unknown) {
    if (!this.doc) return;
    const dest = typeof destination === 'string' ? await this.doc.getDestination(destination) : destination;
    if (!Array.isArray(dest) || !dest.length) throw new Error('This PDF link has no valid destination.');
    const index = typeof dest[0] === 'number' ? dest[0] : await this.doc.getPageIndex(dest[0]);
    const page = await this.doc.getPage(index + 1);
    const view = page.getViewport({ scale: 1, rotation: page.rotate + this.options.rotation });
    let x = 0, y = 0;
    if (dest[1]?.name === 'XYZ' && typeof dest[3] === 'number') {
      const point = view.convertToViewportPoint(typeof dest[2] === 'number' ? dest[2] : 0, dest[3]); x = point[0] / view.width; y = point[1] / view.height;
    }
    await this.render(index + 1, y, x, false, true);
  }
  getPosition(): Position {
    const y = clamp(this.host?.scrollTop / (this.surface?.offsetHeight || 1));
    const x = clamp(this.host?.scrollLeft / (this.surface?.offsetWidth || 1));
    const total = this.doc?.numPages ?? 1, first = this.pages[0];
    const printed = this.pages.map(number => this.labels?.[number - 1] || String(number));
    const custom = printed.some((label, index) => label !== String(this.pages[index]));
    const spread = this.shownSpread === 'active';
    // The saved page is the first visible one, so switching between single and two-page view keeps the place.
    return { label: `${pagesLabel(this.pages, total)}${custom ? ` · ${printed.join('–')}` : ''}`,
      fraction: this.explicitEnd ? 1 : ((first - 1) + y * this.pages.length) / total,
      scrub: { current: first, total, unit: 'page', ...(spread ? { cover: this.options.cover !== false } : {}) },
      ...(this.shownSpread ? { spread: this.shownSpread } : {}),
      ...(this.imageOnly ? { imageOnly: true } : {}),
      locator: { kind: 'pdf', page: first, x, y, fit: this.options?.fit, zoom: this.options?.zoom, rotation: this.options?.rotation, end: this.explicitEnd } };
  }
  async restore(locator: Locator) { if (locator.kind === 'pdf') await this.render(Number(locator.page) || 1, Number(locator.y) || 0, Number(locator.x) || 0, locator.end === true); }
  async setOptions(options: ReaderOptions, hold?: Anchor) {
    const old = this.getPosition().locator; this.options = { ...options };
    await this.render(Number(old.page) || 1, Number(old.y) || 0, Number(old.x) || 0, old.end === true, false, hold);
  }
  outline() { return this.items; }
  scroller() { return this.host; }
  zoomLevel() { return this.level; }
  zoomLimits() { return this.currentPages.length ? this.limitsOf(this.basesOf(this.currentPages)) : DEFAULT_LIMITS; }
  legacyZoomBase(fit: ReaderOptions['fit']) {
    if (!this.currentPages.length) return undefined;
    const bases = this.basesOf(this.currentPages);
    return this.fitHeight(bases, this.shownSpread === 'active', fit) / (CSS_UNITS * this.referenceOf(bases));
  }
  destroy() {
    this.disposed = true; ++this.generation; for (const task of this.tasks) task.cancel(); this.thumbTask?.cancel(); for (const job of this.thumbQueue.splice(0)) job.resolve(undefined); for (const layer of this.layers) layer.cancel(); this.observer?.disconnect(); clearTimeout(this.resizeTimer);
    this.host?.removeEventListener('scroll', this.onScroll); this.host?.classList.remove('pdf-reader');
    this.prefetchAbort?.abort(); this.pageCache.clear(); this.previews = undefined; this.previewCache.clear();
    void this.loading?.destroy(); this.surface = undefined; this.doc = undefined; this.currentPages = [];
  }
}
