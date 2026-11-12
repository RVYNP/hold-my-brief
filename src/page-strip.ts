/**
 * Page previews: the filmstrip of the document's pages under a PDF.
 *
 * The PDF adapter reports the committed view and draws thumbnails on request; the strip lives outside the
 * adapter's scroll container (a sibling of the reading surface), so showing it, or turning a page, never changes
 * the size the page was fitted to. The strip is a scroller laid out by `page-strip-window.ts`: the current page or
 * spread sits in the middle ringed with the accent, earlier pages to its left and later ones to its right, and only
 * the items in or near view exist in the DOM or ask for a thumbnail. Scrolling it looks ahead or back without
 * touching the reading position; a jump or a page turn centres it again.
 */
import { centreScroll, itemCount, itemIndex, itemLeft, itemPages, itemsInView, itemWidth, spanWidth, stripLabel, type StripLayout } from './page-strip-window';
import type { PageThumbnails, PreviewSink, PreviewView } from './types';

/** Thumbnail height in CSS px. The strip's own height (`--page-strip-height`) adds its padding; the footer's lane lies below the strip, not in it. */
export const THUMBNAIL_HEIGHT = 88;
/** Bitmaps kept for thumbnails, a fraction of the page cache: a thumbnail is ~100 KB at 2x, so this holds the strip's window and then some. */
export const PREVIEW_CACHE_BYTES = 8 * 1024 * 1024;
/**
 * Reading-panel height (CSS px) below which the strip stays hidden. It is measured on the panel, which the strip
 * never resizes (the page area loses its height to the strip, the panel does not), so showing it cannot hide it again.
 */
export const MIN_PANEL_HEIGHT = 360;
/** Space between items, CSS px. */
export const STRIP_GAP = 8;
/** Items this far (in items' widths) beyond the viewport are drawn and fetched too, so a scroll nudge finds them ready. */
const OVERSCAN_ITEMS = 2;
/** After the last scroll, this long (ms) passes before thumbnails are requested for the items now in view. */
const SETTLE_MS = 90;
/** A drag shorter than this (CSS px) is still a click. */
const DRAG_SLOP = 4;
/** A recentre further than this many viewports away jumps instead of gliding past pages nobody looks at. */
const GLIDE_VIEWPORTS = 1.5;
/** How long (ms) a glide to the middle takes. */
const GLIDE_MS = 220;

/** Decoded bitmaps kept under a byte budget; the least recently used go first, and a hit counts as a use. */
export class BitmapCache<T extends { width: number; height: number }> {
  private readonly entries = new Map<string, T>();
  private total = 0;
  constructor(private readonly limit: number) {}
  private static cost(bitmap: { width: number; height: number }) { return bitmap.width * bitmap.height * 4; }
  get bytes() { return this.total; }
  get(key: string): T | undefined {
    const hit = this.entries.get(key);
    if (hit) { this.entries.delete(key); this.entries.set(key, hit); }
    return hit;
  }
  set(key: string, bitmap: T) {
    this.delete(key);
    const cost = BitmapCache.cost(bitmap);
    if (cost > this.limit) return;
    for (const oldest of this.entries.keys()) { if (this.total + cost <= this.limit) break; this.delete(oldest); }
    this.entries.set(key, bitmap); this.total += cost;
  }
  private delete(key: string) {
    const old = this.entries.get(key);
    if (old && this.entries.delete(key)) this.total -= BitmapCache.cost(old);
  }
  clear() { this.entries.clear(); this.total = 0; }
}

/**
 * Copies a thumbnail into a canvas that is on screen and sizes it: as tall as the strip allows, or narrower when
 * `slot` (CSS px) is, so a page of another shape than its neighbours is scaled down whole rather than clipped.
 */
export function drawThumbnail(canvas: HTMLCanvasElement, bitmap: HTMLCanvasElement, slot?: number) {
  canvas.width = bitmap.width; canvas.height = bitmap.height;
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
  const natural = bitmap.width * THUMBNAIL_HEIGHT / bitmap.height, scale = slot ? Math.min(1, slot / natural) : 1;
  canvas.style.width = `${natural * scale}px`; canvas.style.height = `${THUMBNAIL_HEIGHT * scale}px`;
}

export type PageStrip = {
  /** The band, to be placed in the reading panel beside the reading surface. */
  element: HTMLElement;
  /** What an adapter reports to. */
  sink: PreviewSink;
  /** Empties the strip, for a document that is gone. */
  clear: () => void;
};

/** Builds the strip. `onError` receives a failed page turn. */
export function createPageStrip(onError: (error: unknown) => void): PageStrip {
  const element = document.createElement('div');
  element.id = 'page-strip'; element.hidden = true;
  const scroller = document.createElement('div');
  scroller.className = 'page-strip-scroller'; scroller.tabIndex = 0;
  scroller.setAttribute('role', 'listbox'); scroller.setAttribute('aria-label', 'Page previews'); scroller.setAttribute('aria-orientation', 'horizontal');
  const track = document.createElement('div');
  track.className = 'page-strip-track';
  scroller.append(track); element.append(scroller);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');

  let view: PreviewView | undefined, layout: StripLayout | undefined, layoutKey = '';
  let current = 0, active: number | undefined, centred = true, pad = 0;
  const items = new Map<number, HTMLElement>();
  /** Thumbnail requests in flight, by page; aborted when the page leaves the drawn range. */
  const requests = new Map<number, AbortController>();
  let settleTimer: ReturnType<typeof setTimeout> | undefined;

  const itemId = (index: number) => `page-strip-item-${index}`;
  const overscan = () => layout ? OVERSCAN_ITEMS * (layout.page * (layout.spread ? 2 : 1) + layout.gap) : 0;
  const range = () => layout ? itemsInView(layout, scroller.scrollLeft, scroller.clientWidth, overscan()) : undefined;

  function build(index: number): HTMLElement {
    const lay = layout!, pages = itemPages(lay, index);
    const item = document.createElement('div');
    item.id = itemId(index); item.className = 'page-strip-item'; item.dataset.index = String(index);
    item.setAttribute('role', 'option'); item.setAttribute('aria-posinset', String(index + 1)); item.setAttribute('aria-setsize', String(itemCount(lay)));
    item.setAttribute('aria-label', `${pages.length > 1 ? 'Pages' : 'Page'} ${stripLabel(pages)}`);
    item.style.width = `${itemWidth(lay, index)}px`;
    const slots = document.createElement('span'); slots.className = 'page-strip-pages';
    for (const number of pages) {
      const slot = document.createElement('span'); slot.className = 'page-strip-page'; slot.style.width = `${lay.page}px`;
      const canvas = document.createElement('canvas'); canvas.dataset.page = String(number); canvas.setAttribute('aria-hidden', 'true');
      slot.append(canvas); slots.append(slot);
    }
    const label = document.createElement('span'); label.className = 'page-strip-label'; label.textContent = stripLabel(pages);
    item.append(slots, label);
    track.append(item);
    return item;
  }
  function place(index: number, item: HTMLElement) { item.style.left = `${pad + itemLeft(layout!, index)}px`; }
  function mark(index: number, item: HTMLElement) {
    item.classList.toggle('is-current', index === current);
    item.classList.toggle('is-before', index < current);
    item.classList.toggle('is-active', index === (active ?? current));
    if (index === current) item.setAttribute('aria-selected', 'true'); else item.setAttribute('aria-selected', 'false');
  }

  /** Draws the items in or near view, drops the rest, and points the listbox at its active one. */
  function sync() {
    const lay = layout, wanted = range();
    if (!lay || !wanted || !scroller.clientWidth) return;
    const keep = new Set<number>();
    for (let index = wanted.first; index <= wanted.last; index++) keep.add(index);
    keep.add(current); keep.add(active ?? current); // The current and the keyboard's item always exist: aria-activedescendant names one.
    for (const [index, item] of items) if (!keep.has(index)) { item.remove(); items.delete(index); }
    for (const index of keep) {
      let item = items.get(index);
      if (!item) { item = build(index); items.set(index, item); place(index, item); paintCached(item); }
      mark(index, item);
    }
    scroller.setAttribute('aria-activedescendant', itemId(active ?? current));
  }
  /** A new item starts with whatever the cache already has, so scrolling back shows no blank tiles. */
  function paintCached(item: HTMLElement) {
    for (const canvas of item.querySelectorAll('canvas')) {
      const bitmap = view?.source.cached(Number(canvas.dataset.page));
      if (bitmap) draw(canvas, bitmap);
    }
  }

  /** Asks for the thumbnails of the items now in view, nearest the middle first; anything no longer wanted is dropped. */
  function requestThumbnails() {
    const lay = layout, wanted = range(), source = view?.source;
    if (!lay || !wanted || !source) return;
    const middle = scroller.scrollLeft, pages: { page: number; distance: number }[] = [];
    for (let index = wanted.first; index <= wanted.last; index++) {
      const distance = Math.abs(itemLeft(lay, index) + itemWidth(lay, index) / 2 - middle);
      for (const page of itemPages(lay, index)) pages.push({ page, distance });
    }
    const want = new Set(pages.map(entry => entry.page));
    for (const [page, controller] of requests) if (!want.has(page)) { controller.abort(); requests.delete(page); }
    for (const { page } of pages.sort((a, b) => a.distance - b.distance)) {
      if (requests.has(page)) continue;
      const canvas = track.querySelector<HTMLCanvasElement>(`canvas[data-page="${page}"]`);
      if (!canvas || canvas.dataset.drawn) continue;
      const cached = source.cached(page);
      if (cached) { paint(page, cached); continue; }
      const controller = new AbortController();
      requests.set(page, controller);
      void source.render(page, controller.signal).then(bitmap => {
        if (requests.get(page) === controller) requests.delete(page);
        if (bitmap && !controller.signal.aborted) paint(page, bitmap);
      });
    }
  }
  function draw(canvas: HTMLCanvasElement, bitmap: HTMLCanvasElement) {
    drawThumbnail(canvas, bitmap, layout?.page); canvas.dataset.drawn = '1';
  }
  function paint(page: number, bitmap: HTMLCanvasElement) {
    const canvas = track.querySelector<HTMLCanvasElement>(`canvas[data-page="${page}"]`);
    if (canvas) draw(canvas, bitmap);
  }
  /** Items draw at once; their thumbnails wait for the scroll to settle, so gliding past a page never fetches it. */
  function update(immediate = false) {
    sync();
    clearTimeout(settleTimer);
    if (immediate) requestThumbnails(); else settleTimer = setTimeout(requestThumbnails, SETTLE_MS);
  }

  /** Moves the strip to `left`, easing there when `animate`. Driven here, not by the engine's smooth scroll, so a newer move or the user's own always takes over cleanly. */
  let glide = 0;
  function scrollTo(left: number, animate: boolean) {
    cancelAnimationFrame(glide);
    const from = scroller.scrollLeft;
    if (!animate || from === left) { scroller.scrollLeft = left; return; }
    const began = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - began) / GLIDE_MS);
      scroller.scrollLeft = t < 1 ? from + (left - from) * (1 - (1 - t) ** 3) : left;
      if (t < 1) glide = requestAnimationFrame(step);
    };
    glide = requestAnimationFrame(step);
  }
  /** Scrolls so that item `index` is in the middle. A long way away it jumps, and with reduced motion it always does. */
  function centre(index: number, animate: boolean) {
    if (!layout || !scroller.clientWidth) return;
    const left = centreScroll(layout, index), near = Math.abs(left - scroller.scrollLeft) <= GLIDE_VIEWPORTS * scroller.clientWidth;
    scrollTo(left, animate && near && !reduced.matches);
  }
  const recentre = (animate: boolean) => { centred = true; centre(current, animate); };

  function jump(index: number) {
    const pages = layout && itemPages(layout, index);
    if (!view || !pages?.length) return;
    if (index === current) recentre(true); // Already there: the strip only comes back to it.
    void view.source.open(pages[0]).catch(onError);
  }
  function activate(index: number | undefined) {
    if (!layout || index === undefined) return;
    active = Math.max(0, Math.min(itemCount(layout) - 1, index));
    centred = false; centre(active, true); update(true);
  }

  // Gestures: the wheel (a mouse's vertical wheel scrolls it sideways) and dragging scroll the strip alone.
  scroller.addEventListener('wheel', event => {
    if (event.ctrlKey) return;
    centred = false; cancelAnimationFrame(glide);
    if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) { event.preventDefault(); scroller.scrollLeft += event.deltaY * (event.deltaMode === 1 ? 16 : 1); }
  }, { passive: false });
  let drag: { id: number; x: number; left: number; moved: boolean } | undefined;
  // The strip never takes focus from the page by a click; Tab reaches it.
  scroller.addEventListener('mousedown', event => event.preventDefault());
  scroller.addEventListener('pointerdown', event => {
    centred = false; active = undefined; cancelAnimationFrame(glide);
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    drag = { id: event.pointerId, x: event.clientX, left: scroller.scrollLeft, moved: false };
  });
  scroller.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    if (!(event.buttons & 1)) { drag = undefined; return; }
    if (!drag.moved && Math.abs(event.clientX - drag.x) < DRAG_SLOP) return;
    if (!drag.moved) { drag.moved = true; scroller.setPointerCapture(event.pointerId); scroller.classList.add('is-dragging'); }
    scroller.scrollLeft = drag.left - (event.clientX - drag.x);
  });
  const endDrag = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.id) return;
    const moved = drag.moved; drag = undefined; scroller.classList.remove('is-dragging');
    if (moved) { const swallow = (click: Event) => click.stopPropagation(); scroller.addEventListener('click', swallow, { capture: true, once: true }); setTimeout(() => scroller.removeEventListener('click', swallow, true)); }
  };
  scroller.addEventListener('pointerup', endDrag); scroller.addEventListener('pointercancel', endDrag);
  scroller.addEventListener('click', event => {
    const item = (event.target as Element).closest<HTMLElement>('.page-strip-item');
    if (item) jump(Number(item.dataset.index));
  });
  scroller.addEventListener('scroll', () => update(), { passive: true });
  scroller.addEventListener('keydown', event => {
    if (!layout || event.ctrlKey || event.altKey || event.metaKey) return;
    const at = active ?? current, last = itemCount(layout) - 1;
    const target = event.key === 'ArrowLeft' ? at - 1 : event.key === 'ArrowRight' ? at + 1 : event.key === 'Home' ? 0 : event.key === 'End' ? last : undefined;
    if (target !== undefined) { event.preventDefault(); event.stopPropagation(); activate(target); }
    else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); jump(at); }
  });
  scroller.addEventListener('blur', () => { if (active !== undefined) { active = undefined; sync(); } });

  let width = 0;
  new ResizeObserver(() => {
    if (scroller.clientWidth === width) return;
    width = scroller.clientWidth;
    if (!layout) return;
    pad = width / 2; track.style.width = `${spanWidth(layout) + width}px`;
    for (const [index, item] of items) place(index, item);
    if (centred) centre(current, false);
    update(true);
  }).observe(scroller);

  const sink: PreviewSink = {
    show(next) {
      const aspect = Math.max(.4, Math.min(2, next.aspect || .75));
      // One page's slot is fixed for a document and rotation: turning to a page of another shape never resizes the strip.
      const page = view && layout && view.source === next.source && view.revision === next.revision && layout.count === next.count ? layout.page : Math.round(THUMBNAIL_HEIGHT * aspect);
      const lay: StripLayout = { count: next.count, spread: next.spread, cover: next.cover, page, gap: STRIP_GAP };
      const key = `${next.revision}:${lay.count}:${lay.spread}:${lay.cover}:${lay.page}`, first = !view, rebuilt = view?.source !== next.source || key !== layoutKey;
      view = next; layout = lay; layoutKey = key;
      if (rebuilt) {
        for (const controller of requests.values()) controller.abort();
        requests.clear(); for (const item of items.values()) item.remove(); items.clear();
        pad = scroller.clientWidth / 2; track.style.width = `${spanWidth(lay) + scroller.clientWidth}px`;
      }
      const index = itemIndex(lay, next.pages[0]), moved = index !== current || rebuilt;
      current = index;
      if (moved) active = undefined; // A refit that lists the same page again does not take the keyboard's place from it.
      if (moved || first) recentre(!first && !rebuilt);
      update(first || rebuilt || !moved);
    },
  };

  function clear() {
    for (const controller of requests.values()) controller.abort();
    requests.clear(); clearTimeout(settleTimer); cancelAnimationFrame(glide);
    for (const item of items.values()) item.remove();
    items.clear(); view = undefined; layout = undefined; layoutKey = ''; active = undefined; centred = true;
    scroller.removeAttribute('aria-activedescendant'); scroller.scrollLeft = 0;
  }
  return { element, sink, clear };
}
