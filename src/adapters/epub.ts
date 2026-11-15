import { BlobReader, ZipReader, configure, type FileEntry } from '@zip.js/zip.js';
import { EPUB } from 'foliate-js/epub.js';
import 'foliate-js/view.js';
import type { Locator, OutlineItem, Position, ReaderAdapter, ReaderContext, ReaderOptions, ReaderSource, ReadingFlow } from '../types';
import { isDark, liftInk, onAppearanceChange, parseRgb, readingColors, rgbToHex, type Rgb } from '../theme';
import { MIN_SPREAD_WIDTH, pagesLabel, pairedSides } from '../spread';
import { clampZoom } from '../zoom';
import { DEFAULT_WPM, chapterMap, contentsLabel, estimatedPage, footerLabel, formatPageShort, numberedChapters, readingMeasure, type PageInfo } from '../epub-position';
import { calloutBackground, liftRule, NOT_CALLOUTS, SIDES } from '../epub-callouts';
import { CODE_BACKGROUND, CODE_BLOCKS, CODE_WRAPPERS, codeSafeAnchor, codeStyles, mappedBackground, markLines, scrollRoom } from '../epub-code';
import { SAMPLE_SECTIONS, codeHeavy, sectionMix, type SectionMix } from '../epub-flow';
import { excerpt, findMatches, type DocumentSearch, type SearchHit, type SearchOptions, type UnitText } from '../search';

const RESOURCE_LIMIT = 64 * 1024 * 1024;
const ARCHIVE_LIMIT = 512 * 1024 * 1024;
const XHTML = 'http://www.w3.org/1999/xhtml';
const CONTENT_CSP = "default-src 'none'; script-src 'none'; connect-src 'none'; img-src blob: data:; font-src blob: data:; style-src 'unsafe-inline' blob:; media-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
const clamp = (n: number) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));

type Section = { id: string; size: number; linear?: string; pageSpread?: string; createDocument: () => Promise<Document>; unload: () => void };
type FoliateBook = { sections: Section[]; dir?: string; rendition: { layout?: string; spread?: string }; toc?: TocNode[]; pageList?: PageNode[]; metadata?: { title?: string | Record<string, string> }; splitTOCHref?: (href: string) => string[]; getTOCFragment?: (doc: Document, id: string) => Element | null; transformTarget: EventTarget; destroy: () => void };
type TocNode = { label: string; href: string; subitems?: TocNode[] };
type PageNode = { label?: string; href?: string };
/** Where a contents entry or page-list item starts: its section, and how far through the section's text. */
type Spot = { section: number; fraction: number };
type ChapterEntry = { label: string; section: number; node: TocNode; parent?: ChapterEntry };
type Target = { index: number; anchor?: number | ((doc: Document) => Range | Element | number) };
type FoliateView = HTMLElement & {
  open: (book: FoliateBook) => Promise<void>; close: () => void;
  prev: () => Promise<void>; next: () => Promise<void>;
  getCFI: (index: number, range?: Range) => string;
  goToFraction: (fraction: number) => Promise<void>;
  resolveNavigation: (target: string | number) => Target | undefined;
  renderer: HTMLElement & {
    index?: number; goTo: (target: Target) => Promise<void>; setStyles?: (styles: string) => void;
    getContents: () => { doc: Document; index?: number }[];
    /** Fixed layout only: which spread, and which side of it, shows a section. */
    getSpreadOf?: (section: Section) => { index: number; side: 'left' | 'right' | 'center' } | undefined;
  };
};

export function validArchivePath(path: string): boolean {
  return !!path && !path.startsWith('/') && !path.includes('\\') && !path.includes('\0') && !path.includes(':') && !path.split('/').includes('..');
}

/** Runs on detached markup before any document can enter an iframe. */
export function sanitizeEpubMarkup(markup: string, mime = 'application/xhtml+xml', rewritten = false): string {
  const doc = new DOMParser().parseFromString(markup, mime as DOMParserSupportedType);
  if (doc.querySelector('parsererror')) throw new Error('The EPUB contains malformed markup.');
  for (const node of Array.from(doc.childNodes)) if (node.nodeType === Node.PROCESSING_INSTRUCTION_NODE || node.nodeType === Node.DOCUMENT_TYPE_NODE) node.remove();
  for (const element of Array.from(doc.querySelectorAll('*'))) {
    const tag = element.localName.toLowerCase();
    if (['script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'base', 'form', 'input', 'button', 'textarea', 'select', 'foreignobject', 'animate', 'animatemotion', 'animatetransform', 'set'].includes(tag)) { element.remove(); continue; }
    if (['audio', 'video'].includes(tag)) {
      const placeholder = doc.createElementNS(XHTML, 'p'); placeholder.textContent = 'Embedded audio/video is unavailable in this reader.'; element.replaceWith(placeholder); continue;
    }
    if (tag === 'meta' && element.getAttribute('name')?.toLowerCase() !== 'viewport') { element.remove(); continue; }
    if (tag === 'link' && element.getAttribute('rel')?.toLowerCase() !== 'stylesheet') { element.remove(); continue; }
    for (const attr of Array.from(element.attributes)) {
      const name = attr.localName.toLowerCase(), value = attr.value.trim();
      if (name.startsWith('on') || ['srcdoc', 'srcset', 'ping', 'action', 'formaction', 'target', 'download', 'autofocus'].includes(name)) { element.removeAttributeNode(attr); continue; }
      if (['href', 'src', 'poster', 'data', 'background'].includes(name)) {
        const anchor = tag === 'a' && name === 'href';
        const safe = anchor
          ? /^(https?:\/\/|#)/i.test(value) || (!/^[a-z][\w+.-]*:|^\/\//i.test(value) && !value.includes('\\'))
          : rewritten ? /^(blob:|data:image\/(?:png|jpeg|gif|webp|avif);|#)/i.test(value)
            : !/^[a-z][\w+.-]*:|^\/\//i.test(value) || /^data:image\/(?:png|jpeg|gif|webp|avif);/i.test(value);
        if (!safe) { element.removeAttributeNode(attr); if (tag === 'img') element.setAttribute('alt', 'Unavailable image (external or unsupported resource)'); }
      }
    }
  }
  if (doc.documentElement.localName === 'html') {
    const head = doc.querySelector('head') ?? doc.documentElement.insertBefore(doc.createElementNS(XHTML, 'head'), doc.documentElement.firstChild);
    const csp = doc.createElementNS(XHTML, 'meta'); csp.setAttribute('http-equiv', 'Content-Security-Policy'); csp.setAttribute('content', CONTENT_CSP); head.prepend(csp);
  }
  return new XMLSerializer().serializeToString(doc);
}

const weight = (root: Node): number => (root.textContent?.length ?? 0) + (root instanceof Element || root instanceof DocumentFragment ? root.querySelectorAll('img,svg').length * 1000 : 0);
function offsetOfRange(doc: Document, range?: Range) {
  if (!range) return 0;
  const before = doc.createRange(); before.selectNodeContents(doc.body ?? doc.documentElement);
  try { before.setEnd(range.startContainer, range.startOffset); return weight(before.cloneContents()); } catch { return 0; }
}
function rangeAtOffset(doc: Document, offset: number) {
  const root = doc.body ?? doc.documentElement;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let remaining = Math.max(0, offset);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const n = node.nodeType === Node.TEXT_NODE ? node.textContent!.length : /^(img|svg)$/i.test((node as Element).localName) ? 1000 : 0;
    if (n && remaining <= n) {
      const range = doc.createRange();
      if (node.nodeType === Node.TEXT_NODE) range.setStart(node, Math.min(remaining, n)); else range.setStartBefore(node);
      range.collapse(true); return range;
    }
    remaining -= n;
  }
  const range = doc.createRange(); range.selectNodeContents(root); range.collapse(false); return range;
}

/** Characters of a section's size that make one Foliate location, the unit of its page estimate (see its SectionProgress). */
const SIZE_PER_LOCATION = 1500;
/** A wheel gesture that begins this long after the last wheel event is a new one. */
const WHEEL_GESTURE_GAP = 150;
/** After a wheel gesture has turned a chapter, the next one waits this long. */
const WHEEL_COOLDOWN = 700;
export class EpubAdapter implements ReaderAdapter {
  mode: 'fixed' | 'paginated' = 'paginated';
  readonly spreads = true;
  private host!: HTMLElement;
  private context!: ReaderContext;
  private options!: ReaderOptions;
  private view?: FoliateView;
  private book?: FoliateBook;
  private archive?: ZipReader<Blob>;
  private disposed = false;
  private queue = Promise.resolve();
  private abort = new AbortController();
  private history: Locator[] = [];
  private items: OutlineItem[] = [];
  /** The contents node behind each entry of `items`, for finding the one Foliate says the reader is in. */
  private nodes: TocNode[] = [];
  /** Where contents entries and page-list items start, measured as the sections are read. */
  private spots = new Map<object, Spot>();
  private weights: number[] = [];
  /** Words per spine section, and their running sum: the time left in a chapter is counted from them. */
  private words: number[] = [];
  private wordsPrefix: number[] = [0];
  /** The book's numbered chapters in reading order, and the number each contents entry Foliate reports carries. */
  private chapters: ChapterEntry[] = [];
  private chapterOf = new Map<TocNode, { n: number; total: number }>();
  /** Labels of the publisher's page list, empty when the book has none. */
  private pageLabels: string[] = [];
  /** What Foliate reported for the page on screen. */
  private reported?: { fraction?: number; location?: { current: number; total: number }; pageItem?: { label?: string } | null; tocItem?: TocNode | null };
  private activeIndex = 0;
  /** Fixed-layout sections on screen in reading order: one page, or both pages of a spread. */
  private visible: number[] = [0];
  /** The iframes Foliate has drawn fixed-layout pages in; the one on screen tells the scale it fits the page at. */
  private frames = new Set<Element>();
  /** Two-page layout and cover pairing currently applied to Foliate. */
  private layoutSpread = false;
  private layoutCover = true;
  /** Publisher page-spread sides, restored whenever the cover option is on. */
  private declaredSides: (string | undefined)[] = [];
  private observer?: ResizeObserver;
  private resizeTimer?: ReturnType<typeof setTimeout>;
  /** Plain text per spine section, extracted on demand for search and kept with the document. */
  private sectionText = new Map<number, string>();
  /** The reading flow in force: `scrolled` is one continuous column, `paginated` is pages. Reflowable books only. */
  private flowNow: ReadingFlow = 'paginated';
  /** Wheel input in scrolled flow: when the last event came, whether the gesture began at the edge it is heading for, and when a chapter was last turned. */
  private wheel = { last: 0, atEdge: false, until: 0 };
  /** The section and offset of the currently marked search hit, if any. */
  private markedHit?: { index: number; start: number; length: number };
  private position: Position = { label: 'Opening EPUB…', fraction: 0, locator: { kind: 'epub' }, scrub: { current: 0, total: 100, unit: 'percent' } };
  private explicitEnd = false;
  private unsubscribe?: () => void;
  /** Inline colors replaced to keep publication text legible on a dark page, restored on light pages. */
  private lifted = new WeakMap<Document, [element: HTMLElement, property: string, value: string, priority: string][]>();
  private styles = '';

  async open(source: ReaderSource, host: HTMLElement, context: ReaderContext, options: ReaderOptions) {
    this.host = host; this.context = context; this.options = { ...options };
    host.tabIndex = 0; host.setAttribute('aria-label', 'EPUB reading surface');
    host.style.overflow = 'hidden';
    configure({ useWebWorkers: false });
    const archive = this.archive = new ZipReader(new BlobReader(new Blob([source.bytes.slice()])), { useWebWorkers: false });
    let size = 0, count = 0; const map = new Map<string, FileEntry>();
    for await (const entry of archive.getEntriesGenerator()) {
      if (++count > 10_000) throw new Error('This EPUB contains too many archive entries (limit 10,000).');
      if (!validArchivePath(entry.filename)) throw new Error('The EPUB contains an unsafe archive path.');
      if (entry.directory) continue;
      if (entry.encrypted) throw new Error('Encrypted/DRM-protected EPUB files are not supported.');
      if (entry.uncompressedSize > RESOURCE_LIMIT) throw new Error('An EPUB resource exceeds the 64 MiB limit.');
      size += entry.uncompressedSize;
      if (size > ARCHIVE_LIMIT) throw new Error('The expanded EPUB exceeds the 512 MiB limit.');
      if (map.has(entry.filename)) throw new Error('The EPUB contains duplicate archive entries.');
      map.set(entry.filename, entry as FileEntry);
    }
    const read = async (name: string, type = ''): Promise<Blob | null> => {
      if (!validArchivePath(name)) throw new Error('The EPUB requested a resource outside its archive.');
      if (this.disposed) throw new DOMException('Opening cancelled', 'AbortError');
      const entry = map.get(name); if (!entry) return null;
      let length = 0; const chunks: Uint8Array<ArrayBuffer>[] = [];
      await entry.getData(new WritableStream<Uint8Array>({ write(chunk) {
        length += chunk.byteLength;
        if (length > RESOURCE_LIMIT) throw new Error('An expanded EPUB resource exceeds the 64 MiB limit.');
        chunks.push(chunk.slice());
      } }), { signal: this.abort.signal, checkSignature: true });
      return new Blob(chunks, { type });
    };
    const loadText = async (name: string): Promise<string | null> => {
      const blob = await read(name); if (!blob) return null;
      const text = await blob.text();
      if (/\.(xhtml|html|htm|svg)$/i.test(name)) return sanitizeEpubMarkup(text, /\.svg$/i.test(name) ? 'image/svg+xml' : /\.(html|htm)$/i.test(name) ? 'text/html' : 'application/xhtml+xml');
      return text;
    };
    const encryption = await loadText('META-INF/encryption.xml');
    if (encryption) {
      const doc = new DOMParser().parseFromString(encryption, 'application/xml');
      const allowed = new Set(['http://www.idpf.org/2008/embedding', 'http://ns.adobe.com/pdf/enc#RC']);
      if (Array.from(doc.getElementsByTagNameNS('*', 'EncryptionMethod')).some(el => !allowed.has(el.getAttribute('Algorithm') ?? '')))
        throw new Error('DRM-protected EPUB files are not supported. Open a DRM-free copy.');
    }
    this.book = await new EPUB({ loadText, loadBlob: read, getSize: (name: string) => map.get(name)?.uncompressedSize ?? 0 }).init() as FoliateBook;
    if (!this.book.sections.length) throw new Error('The EPUB has no readable spine sections.');
    this.mode = this.book.rendition?.layout === 'pre-paginated' ? 'fixed' : 'paginated';
    this.book.rendition ??= {}; this.book.rendition.spread = 'none';
    // Reflowable text follows the reading theme; fixed-layout pages stay faithful.
    if (this.mode === 'paginated') host.classList.add('reflow-reader');
    this.declaredSides = this.book.sections.map(section => section.pageSpread);
    // A reflowable book opens in the flow the reader chose; with no choice yet it is picked below, once the first chapters have been read.
    const stored = this.mode === 'paginated' && (this.options.flow === 'scrolled' || this.options.flow === 'paginated') ? this.options.flow : undefined;
    this.flowNow = stored ?? 'paginated';
    this.layoutSpread = this.spreadState() === 'active'; this.layoutCover = this.options.cover !== false;
    this.pairSections();
    this.book.transformTarget.addEventListener('data', event => {
      const detail = (event as CustomEvent).detail;
      if (['application/xhtml+xml', 'text/html', 'image/svg+xml'].includes(detail.type))
        detail.data = Promise.resolve(detail.data).then(data => sanitizeEpubMarkup(String(data), detail.type, true));
    });
    this.numberChapters();
    const targets = this.outlineTargets(), mixes: SectionMix[] = [];
    // The map is based on content, never displayed page counts or equal chapter weights.
    for (const [index, section] of this.book.sections.entries()) {
      if (this.disposed) throw new DOMException('Opening cancelled', 'AbortError');
      const doc = await section.createDocument();
      this.weights.push(Math.max(1, weight(doc.body ?? doc.documentElement)));
      this.words.push((doc.body?.textContent ?? '').match(/\S+/g)?.length ?? 0);
      if (!stored && this.mode === 'paginated' && index < SAMPLE_SECTIONS) mixes.push(sectionMix(doc));
      this.locate(doc, index, targets.get(index));
    }
    if (this.mode === 'paginated') {
      this.flowNow = stored ?? (codeHeavy(mixes) ? 'scrolled' : 'paginated');
      this.options.flow = this.flowNow;
      this.layoutSpread = this.spreadState() === 'active';
    }
    this.buildOutline();
    this.wordsPrefix = [0];
    for (const count of this.words) this.wordsPrefix.push(this.wordsPrefix[this.wordsPrefix.length - 1] + count);
    const view = this.view = document.createElement('foliate-view') as FoliateView;
    Object.assign(view.style, { display: 'block', width: '100%', height: '100%' }); host.append(view);
    view.addEventListener('relocate', event => {
      if (this.disposed) return;
      const detail = (event as CustomEvent).detail;
      this.activeIndex = detail.section?.current ?? view.renderer.index ?? this.activeIndex;
      if (this.mode === 'fixed') {
        // Foliate reports one page of a spread; the position is its first page in reading order.
        const shown = this.pairOf(this.activeIndex);
        for (const index of this.visible) if (!shown.includes(index)) this.book?.sections[index]?.unload();
        this.visible = shown; this.activeIndex = shown[0];
      }
      this.reported = { fraction: detail.fraction, location: detail.location, pageItem: detail.pageItem, tocItem: detail.tocItem };
      const doc = detail.range?.startContainer?.ownerDocument;
      const offset = doc ? offsetOfRange(doc, detail.range) : 0;
      this.updatePosition(offset, detail.cfi);
    });
    view.addEventListener('external-link', event => { event.preventDefault(); const href = (event as CustomEvent).detail.href;
      if (/^https?:\/\//i.test(href)) void context.openExternal(href).catch(context.onError);
    });
    view.addEventListener('link', event => { event.preventDefault(); void this.goTo((event as CustomEvent).detail.href).catch(context.onError); });
    view.addEventListener('load', event => {
      const doc: Document = (event as CustomEvent).detail.doc;
      // The postinstall patch applies this before src is assigned; assert defense too.
      const frame = doc.defaultView?.frameElement;
      if (!frame || frame.getAttribute('sandbox') !== 'allow-same-origin') throw new Error('Unsafe EPUB frame sandbox. Reinstall the application.');
      if (this.mode === 'fixed') { this.frames.add(frame); context.onFrame?.(doc); this.shadeGutter(doc, (event as CustomEvent).detail.index); }
      doc.addEventListener('keydown', event => {
        const target = event.target as Element;
        if (target.closest('input,textarea,select,[contenteditable="true"]')) return;
        // iframe events do not bubble to the application document.
        const forwarded = new KeyboardEvent('keydown', { key: event.key, code: event.code, ctrlKey: event.ctrlKey, altKey: event.altKey, shiftKey: event.shiftKey, metaKey: event.metaKey, bubbles: true, cancelable: true, repeat: event.repeat });
        if (!host.dispatchEvent(forwarded)) event.preventDefault();
      });
      if (this.mode === 'paginated') { markLines(doc); this.adaptInk(doc); doc.addEventListener('wheel', event => this.chainChapter(event, doc), { passive: true }); }
    });
    await view.open(this.book);
    this.watchRenderer();
    this.applyOptions();
    if (this.mode === 'paginated') this.unsubscribe = onAppearanceChange(() => {
      this.applyOptions();
      for (const { doc } of view.renderer.getContents()) this.adaptInk(doc);
    });
    await view.renderer.goTo({ index: 0 });
    let box = `${host.offsetWidth}:${host.offsetHeight}`;
    this.observer = new ResizeObserver(() => {
      const next = `${host.offsetWidth}:${host.offsetHeight}`;
      if (next === box || !host.offsetWidth || !host.offsetHeight) return;
      box = next;
      clearTimeout(this.resizeTimer);
      // Foliate refits pages and columns itself; only a change of two-page layout needs this adapter.
      this.resizeTimer = setTimeout(() => {
        if (this.disposed) return;
        if (this.options.spread && (this.spreadState() === 'active') !== this.layoutSpread) void this.enqueue(() => this.relayout()).catch(context.onError);
        else if (this.mode === 'paginated') { this.applyLayout(); this.applyStyles(true); }
        // Foliate refits a fixed-layout page by itself; the level it comes to is reported once it has.
        else if (this.mode === 'fixed' && this.options.fitted) this.updatePosition(0);
      }, 150);
    });
    this.observer.observe(host);
  }

  /**
   * Numbers the book's chapters from its contents, in reading order. A page list, when the book has one, gives the page labels the
   * footer quotes. The book's own title is never a chapter.
   */
  private numberChapters() {
    const book = this.book;
    if (!book) return;
    const bookTitle = this.bookTitle();
    const entries: ChapterEntry[] = [];
    const walk = (nodes: TocNode[], parent?: ChapterEntry) => { for (const node of nodes) {
      const section = node.href ? book.sections.findIndex(candidate => candidate.id === book.splitTOCHref?.(node.href)[0]) : -1;
      const entry: ChapterEntry | undefined = section >= 0 ? { label: node.label, section, node, parent } : undefined;
      if (entry) entries.push(entry);
      walk(node.subitems ?? [], entry ?? parent);
    } };
    walk(book.toc ?? []);
    // Stable: entries that share a section keep their contents order.
    entries.sort((a, b) => a.section - b.section);
    this.chapters = numberedChapters(entries, bookTitle);
    const byEntry = chapterMap(entries, bookTitle);
    this.chapterOf = new Map(entries.flatMap(entry => { const found = byEntry.get(entry); return found ? [[entry.node, found] as const] : []; }));
    this.pageLabels = (book.pageList ?? []).map(item => String(item.label ?? '').trim()).filter(Boolean);
  }
  private bookTitle(): string | undefined {
    const title = this.book?.metadata?.title;
    return typeof title === 'string' ? title : title ? Object.values(title)[0] : undefined;
  }
  /** The contents entries and page-list items that point into each section, with the fragment each names. */
  private outlineTargets() {
    const book = this.book!, sections = new Map(book.sections.map((section, index) => [section.id, index]));
    const targets = new Map<number, { node: object; fragment?: string }[]>();
    const add = (node: object, href?: string) => {
      if (!href) return;
      const [id, fragment] = book.splitTOCHref?.(href) ?? [], section = sections.get(id);
      if (section !== undefined) targets.set(section, [...(targets.get(section) ?? []), { node, fragment }]);
    };
    const walk = (nodes: TocNode[]) => { for (const node of nodes) { add(node, node.href); walk(node.subitems ?? []); } };
    walk(book.toc ?? []);
    for (const item of book.pageList ?? []) add(item, item.href);
    return targets;
  }
  /** Records how far through its section each target starts, counting text and images the way `weight` does, in one pass over the document. */
  private locate(doc: Document, section: number, list: { node: object; fragment?: string }[] = []) {
    const wanted = new Map<Element, object[]>();
    for (const { node, fragment } of list) {
      const element = fragment ? this.book?.getTOCFragment?.(doc, fragment) ?? doc.getElementById(fragment) : null;
      if (element) wanted.set(element, [...(wanted.get(element) ?? []), node]);
      else this.spots.set(node, { section, fraction: 0 });
    }
    if (!wanted.size) return;
    const before = new Map<object, number>(), walker = doc.createTreeWalker(doc.body ?? doc.documentElement, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let at = 0;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.nodeType === Node.TEXT_NODE) { at += node.textContent!.length; continue; }
      for (const owner of wanted.get(node as Element) ?? []) before.set(owner, at);
      if (/^(img|svg)$/i.test((node as Element).localName)) at += 1000;
    }
    for (const owners of wanted.values()) for (const owner of owners) this.spots.set(owner, { section, fraction: at ? Math.min(1, (before.get(owner) ?? 0) / at) : 0 });
  }
  /**
   * The contents as the Contents list shows them: cleaned labels (the raw label where cleaning finds nothing), the contents' own
   * nesting, and the page each entry starts on. A book with a page list gives its own page labels; otherwise the page is the
   * footer's estimate, a fixed span of the book's text.
   */
  private buildOutline() {
    const book = this.book;
    if (!book) return;
    const sizes = book.sections.map(section => section.linear !== 'no' && section.size > 0 ? section.size : 0);
    const sizeBefore = sizes.map((_, index) => sizes.slice(0, index).reduce((sum, size) => sum + size, 0)), total = sizes.reduce((sum, size) => sum + size, 0);
    const at = (spot: Spot) => sizeBefore[spot.section] + spot.fraction * sizes[spot.section];
    const listed = (book.pageList ?? []).flatMap(item => { const spot = this.spots.get(item), label = String(item.label ?? '').trim(); return spot && label ? [{ at: at(spot), label }] : []; });
    const pageOf = (spot: Spot) => {
      if (listed.length) return { page: (listed.filter(item => item.at <= at(spot)).at(-1) ?? listed[0]).label, estimated: false };
      // A fixed-layout page is a whole spine item, so its number is the spine position, as in the footer.
      if (this.mode === 'fixed') return { page: String(spot.section + 1), estimated: false };
      const estimate = estimatedPage({ current: Math.floor(at(spot) / SIZE_PER_LOCATION), total: Math.ceil(total / SIZE_PER_LOCATION) });
      return estimate && { page: estimate.page, estimated: true };
    };
    const bookTitle = this.bookTitle();
    this.items = []; this.nodes = [];
    const walk = (nodes: TocNode[], depth: number) => { for (const node of nodes) {
      if (node.href) {
        const spot = this.spots.get(node), page = spot && pageOf(spot);
        this.items.push({ label: contentsLabel(node.label, bookTitle), target: node.href, depth, ...(page ? { page: formatPageShort(page) } : {}) });
        this.nodes.push(node);
      }
      walk(node.subitems ?? [], node.href ? depth + 1 : depth);
    } };
    walk(book.toc ?? [], 0);
  }
  /** Two-page state for the current options and panel size. Foliate's paginator only sets two columns in a landscape box. */
  private spreadState(): Position['spread'] {
    if (!this.options.spread || this.flowNow === 'scrolled') return undefined; // One column has no pages to pair.
    const width = this.host.offsetWidth;
    return width >= MIN_SPREAD_WIDTH && (this.mode === 'fixed' || width > this.host.offsetHeight) ? 'active' : 'waiting';
  }
  /** Foliate pairs fixed-layout pages when a book is opened, so the pairing is configured on the book first. */
  private pairSections() {
    const book = this.book;
    if (!book || this.mode !== 'fixed') return;
    book.rendition.spread = this.layoutSpread ? 'both' : 'none';
    const sides = this.layoutSpread && !this.layoutCover ? pairedSides(this.declaredSides, book.dir === 'rtl') : this.declaredSides;
    book.sections.forEach((section, index) => { section.pageSpread = sides[index]; });
  }
  /** Sections shown together with `index`, in reading order. */
  private pairOf(index: number): number[] {
    const book = this.book, renderer = this.view?.renderer;
    if (!book || !renderer?.getSpreadOf || this.mode !== 'fixed' || !this.layoutSpread) return [index];
    const spread = renderer.getSpreadOf(book.sections[index])?.index;
    return [index - 1, index, index + 1].filter(i => i >= 0 && i < book.sections.length && renderer.getSpreadOf!(book.sections[i])?.index === spread);
  }
  /** A soft paper shade on the inner edge of each page of a fixed-layout spread. */
  private shadeGutter(doc: Document, index: number) {
    const section = this.book?.sections[index];
    const side = section && this.pairOf(index).length > 1 ? this.view?.renderer.getSpreadOf?.(section)?.side : undefined;
    if (side !== 'left' && side !== 'right') return;
    const edge = side === 'left' ? 'right' : 'left';
    const style = doc.createElementNS(XHTML, 'style');
    // Faithful paper shading, identical in every theme because pages are never recolored.
    style.textContent = `html::after { content: ''; position: fixed; top: 0; bottom: 0; ${edge}: 0; width: 7.5%; z-index: 2147483647; pointer-events: none; background: linear-gradient(to ${edge}, transparent, #1e1a2e12); }`;
    (doc.head ?? doc.documentElement).append(style);
  }
  /** Prepares a fixed-layout renderer; Foliate creates a new one whenever the book is (re)opened. */
  private watchRenderer() {
    const renderer = this.view?.renderer;
    if (this.mode !== 'fixed' || !renderer) return;
    // Foliate centres fixed-layout pages with plain flex centring, which pushes the left/top of a
    // zoomed page into negative overflow that no scroll (or hand-tool pan) can reach.
    Object.assign(renderer.style, { justifyContent: 'safe center', alignItems: 'safe center' });
    renderer.addEventListener('scroll', () => {
      if (renderer.scrollTop < renderer.scrollHeight - renderer.clientHeight - 2) this.explicitEnd = false;
      this.updatePosition(0);
    }, { passive: true });
  }
  /** Applies the current options and panel size, rebuilding Foliate's fixed-layout renderer when its pairing changes. */
  private async relayout() {
    if (!this.view || !this.book) return;
    const old = { ...this.position.locator };
    const spread = this.spreadState() === 'active', cover = this.options.cover !== false;
    const repair = this.mode === 'fixed' && (spread !== this.layoutSpread || (spread && cover !== this.layoutCover));
    this.layoutSpread = spread; this.layoutCover = cover;
    if (repair) {
      this.pairSections();
      this.view.close();
      await this.view.open(this.book);
      this.watchRenderer();
    }
    this.applyOptions();
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    await this.restoreNow(old);
  }

  private updatePosition(offset: number, cfi?: string) {
    if (!this.book || !this.view || this.disposed) return;
    const index = this.activeIndex, total = this.book.sections.length;
    const renderer = this.view.renderer, fixed = this.mode === 'fixed';
    const shown = fixed ? this.visible : [index];
    const within = fixed ? clamp(renderer.scrollTop / Math.max(1, renderer.scrollHeight)) : clamp(offset / this.weights[index]);
    // A reflowable book's place is Foliate's own: its fraction counts the text on screen, so it moves with the first page turn.
    const fraction = this.explicitEnd ? 1 : fixed ? (index + within * shown.length) / total : clamp(this.reported?.fraction ?? 0);
    const spread = this.options.spread && this.flowNow !== 'scrolled' ? this.layoutSpread ? 'active' as const : 'waiting' as const : undefined;
    this.position = { label: fixed ? pagesLabel(shown.map(page => page + 1), total) : this.reflowLabel(index, within, fraction), fraction,
      scrub: fixed ? { current: index + 1, total, unit: 'page' } : { current: fraction * 100, total: 100, unit: 'percent' },
      ...(spread ? { spread } : {}),
      locator: { kind: 'epub', spine: this.book.sections[index]?.id, index, cfi: cfi ?? this.position.locator.cfi, offset, fraction, within, end: this.explicitEnd } };
    this.context.onPosition(this.position);
  }
  /** Chapter, page, percentage and time left, from what Foliate last reported for the page on screen. */
  private reflowLabel(index: number, within: number, fraction: number): string {
    const reported = this.reported, toc = reported?.tocItem ? this.chapterOf.get(reported.tocItem) : undefined;
    const chapter = toc ?? (this.chapters.length ? undefined : { n: index + 1, total: this.book!.sections.length });
    const listed = this.pageLabels.length;
    const page: PageInfo | undefined = listed ? reported?.pageItem?.label ? { page: String(reported.pageItem.label), pages: this.pageLabels[listed - 1], estimated: false } : undefined
      : estimatedPage(reported?.location);
    // The chapter runs to the next numbered entry, which may be several sections on.
    const end = Math.max(index + 1, toc ? this.chapters[toc.n]?.section ?? this.weights.length : index + 1);
    const words = this.words[index] * (1 - within) + this.wordsPrefix[end] - this.wordsPrefix[index + 1];
    return footerLabel({ chapter, page, fraction, words, wpm: DEFAULT_WPM });
  }
  private enqueue(work: () => Promise<void>): Promise<void> {
    const next = this.queue.then(async () => {
      if (this.disposed) return;
      this.host.setAttribute('aria-busy', 'true');
      try { await work(); } finally { this.host.removeAttribute('aria-busy'); }
    });
    this.queue = next.catch(() => {}); return next;
  }
  private remember() { this.history.push({ ...this.position.locator }); if (this.history.length > 20) this.history.shift(); }
  private async target(target: string | number) {
    const resolved = this.view?.resolveNavigation(target);
    if (!resolved || resolved.index < 0 || resolved.index >= (this.book?.sections.length ?? 0)) throw new Error('This chapter or link is not in the EPUB spine.');
    await this.view!.renderer.goTo(resolved);
  }
  async navigate(action: Parameters<ReaderAdapter['navigate']>[0]) {
    return this.enqueue(async () => {
      if (!this.view || !this.book) return;
      if (action === 'back') { const old = this.history.pop(); if (old) await this.restoreNow(old); return; }
      this.explicitEnd = action === 'end';
      if (action === 'start' || action === 'end') {
        this.remember(); await this.view.renderer.goTo({ index: action === 'start' ? 0 : this.book.sections.length - 1, anchor: action === 'end' ? 1 : 0 });
        if (this.mode === 'fixed' && action === 'end') this.view.renderer.scrollTop = this.view.renderer.scrollHeight;
        this.updatePosition(action === 'end' ? this.weights.at(-1)! : 0); return;
      }
      const forward = action === 'next' || action === 'screen-next';
      if (this.mode === 'fixed' && action.startsWith('screen-')) {
        const element = this.view.renderer, max = element.scrollHeight - element.clientHeight;
        if ((forward && element.scrollTop < max - 2) || (!forward && element.scrollTop > 2)) { element.scrollTop = Math.max(0, Math.min(max, element.scrollTop + (forward ? 1 : -1) * element.clientHeight * .9)); this.updatePosition(0); return; }
      }
      if (forward) await this.view.next(); else await this.view.prev();
    });
  }
  async goTo(target: string) {
    return this.enqueue(async () => {
      const percent = /^\s*(\d+(?:\.\d+)?)%\s*$/.exec(target);
      if (percent && this.mode === 'paginated') {
        const fraction = Number(percent[1]) / 100;
        if (fraction < 0 || fraction > 1) throw new Error('Enter a percentage from 0% to 100%.');
        this.remember(); this.explicitEnd = fraction === 1;
        await this.view!.goToFraction(fraction); return;
      }
      if (/^\d+$/.test(target)) {
        const index = Number(target) - 1;
        if (index < 0 || index >= (this.book?.sections.length ?? 0)) throw new Error(`Enter a ${this.mode === 'fixed' ? 'page' : 'chapter'} from 1 to ${this.book?.sections.length}.`);
        this.remember(); this.explicitEnd = false; await this.target(index); return;
      }
      this.remember(); this.explicitEnd = false; await this.target(target);
    });
  }
  getPosition() { return this.position; }

  /**
   * Searches each spine section's text and reports hits as section index plus character offset.
   *
   * Section documents are created lazily by foliate, so text is loaded one section at a time
   * and cached. A hit stores the offset into that plain text, which `revealSearchMatch` turns
   * back into a Range using the same `rangeAtOffset` helper the position restore already uses.
   */
  async search(query: string, options: SearchOptions = {}): Promise<DocumentSearch> {
    const book = this.book;
    if (!book || this.disposed) return { hits: [], truncated: false };
    const hits: SearchHit[] = [];
    let textSections = 0;
    for (let index = 0; index < book.sections.length; index++) {
      const text = await this.sectionBodyText(index);
      if (this.disposed) return { hits: [], truncated: false };
      if (!text.trim()) continue;
      textSections++;
      const id = book.sections[index]?.id ?? '';
      const unit: UnitText = { number: index + 1, text, label: /\.[a-z]+$/i.test(id) ? `Section ${index + 1} \u00b7 ${id.replace(/\.[^.]+$/, '')}` : `Section ${index + 1}` };
      for (const match of findMatches(unit.text, query, options)) {
        hits.push({ text: unit.text.slice(match.start, match.end), excerpt: excerpt(unit.text, match.start, match.end), start: match.start, end: match.end, unit: unit.number, unitLabel: unit.label });
        if (hits.length >= 2000) return { hits, truncated: true };
      }
    }
    if (!textSections) return { hits: [], truncated: false, unavailable: 'This EPUB has no readable text' };
    return { hits, truncated: false };
  }

  /** The plain text of one spine section, extracted from its sanitised document. */
  private async sectionBodyText(index: number): Promise<string> {
    const cached = this.sectionText.get(index);
    if (cached !== undefined) return cached;
    const section = this.book?.sections[index];
    if (!section) return '';
    let text = '';
    try {
      const doc = await section.createDocument();
      text = doc.body?.textContent ?? doc.documentElement.textContent ?? '';
    } catch { text = ''; }
    finally { try { section.unload(); } catch { /* already unloaded */ } }
    this.sectionText.set(index, text);
    return text;
  }

  async readText(limit: number): Promise<{ label: string; text: string }> {
    const { label, locator } = this.position;
    const index = typeof locator.index === 'number' ? locator.index : 0;
    const text = (await this.sectionBodyText(index)).replace(/\n{3,}/g, '\n\n');
    if (text.length <= limit) return { label, text };
    // A long chapter is read from a little before the reader's place within it.
    const within = typeof locator.within === 'number' ? locator.within : 0;
    const start = Math.max(0, Math.min(text.length - limit, Math.round(within * text.length) - Math.round(limit / 4)));
    return { label, text: text.slice(start, start + limit) };
  }

  /** Navigates so the hit is on screen, then marks it in the rendered section. */
  async revealSearchMatch(hit: SearchHit): Promise<void> {
    const index = hit.unit - 1;
    this.markedHit = { index, start: hit.start, length: hit.text.length };
    return this.enqueue(async () => {
      if (!this.view || this.disposed) return;
      this.markedHit = { index, start: hit.start, length: hit.text.length };
      await this.view.renderer.goTo({ index, anchor: doc => rangeAtOffset(doc, hit.start) });
      this.paintMark();
    });
  }

  clearSearchHighlights(): void {
    this.markedHit = undefined;
    this.paintMark();
  }

  /**
   * Marks the current hit inside whichever content iframe is showing. The frame document is
   * same-origin and its content is sanitised, so a `<mark>` wrapper here cannot introduce
   * script or external resources.
   */
  private paintMark(): void {
    const contents = this.view?.renderer.getContents?.() ?? [];
    for (const { doc } of contents) {
      for (const old of Array.from(doc.querySelectorAll('mark.search-hit'))) old.replaceWith(...Array.from(old.childNodes));
      doc.body?.normalize();
    }
    const hit = this.markedHit;
    if (!hit) return;
    const target = contents.find(entry => entry.index === hit.index);
    if (!target) return;
    const range = rangeAtOffset(target.doc, hit.start);
    try {
      const slice = target.doc.createRange();
      slice.setStart(range.startContainer, range.startOffset);
      const text = target.doc.createTreeWalker(target.doc.body, NodeFilter.SHOW_TEXT);
      let remaining = hit.length;
      for (let node = text.nextNode(); node && remaining > 0; node = text.nextNode()) {
        const size = node.textContent?.length ?? 0;
        if (size >= remaining) { slice.setEnd(node, remaining); remaining = 0; }
        else { remaining -= size; }
      }
      if (remaining > 0) return;
      const mark = target.doc.createElement('mark');
      mark.className = 'search-hit';
      mark.append(slice.extractContents());
      slice.insertNode(mark);
    } catch { /* a mark that cannot be placed is cosmetic; navigation already happened */ }
  }
  private async restoreNow(locator: Locator) {
    if (locator.kind !== 'epub' || !this.book || !this.view) return;
    this.explicitEnd = locator.end === true;
    let index = this.book.sections.findIndex(section => section.id === locator.spine);
    if (index < 0) index = Math.max(0, Math.min(this.book.sections.length - 1, Number(locator.index) || 0));
    if (typeof locator.cfi === 'string' && this.mode !== 'fixed') {
      const resolved = this.view.resolveNavigation(locator.cfi);
      if (typeof resolved?.anchor === 'function' && resolved.index === index) {
        await this.view.renderer.goTo({ index, anchor: codeSafeAnchor(resolved.anchor, doc => rangeAtOffset(doc, Number(locator.offset) || 0)) });
        return;
      }
      if (resolved && resolved.index === index) { await this.view.renderer.goTo(resolved); return; }
    }
    await this.view.renderer.goTo({ index, anchor: doc => rangeAtOffset(doc, Number(locator.offset) || 0) });
    if (this.mode === 'fixed') { this.view.renderer.scrollTop = clamp(Number(locator.within)) * this.view.renderer.scrollHeight; this.updatePosition(0); }
  }
  async restore(locator: Locator) { return this.enqueue(() => this.restoreNow(locator)); }
  /** Margin, column gap and measure; the gap is a share of the width, so a resized window needs them again. */
  private applyLayout() {
    const renderer = this.view?.renderer;
    if (!renderer || this.mode !== 'paginated') return;
    const margin = `${this.options.margin}px`, share = this.gapShare(), gap = `${share}%`;
    if (renderer.getAttribute('margin') !== margin) renderer.setAttribute('margin', margin);
    if (renderer.getAttribute('gap') !== gap) renderer.setAttribute('gap', gap);
    this.applyMeasure(share / 100);
  }
  /** The `gap` attribute, in percent: Foliate turns it into the document's side padding, which is also what a Scroll-flow code block may not widen into. */
  private gapShare() { return Math.max(2, this.options.margin / Math.max(1, this.host.clientWidth) * 200); }
  private applyOptions() {
    if (!this.view) return;
    const renderer = this.view.renderer, options = this.options;
    // Foliate's numeric zoom is a scale of the book's declared viewport, which is what 100 % means for it.
    if (this.mode === 'fixed') renderer.setAttribute('zoom', options.fitted ? `fit-${options.fit}` : String(clampZoom(options.zoom)));
    else {
      const scrolled = this.flowNow === 'scrolled';
      renderer.setAttribute('flow', this.flowNow); renderer.setAttribute('max-column-count', this.layoutSpread && !scrolled ? '2' : '1');
      this.applyLayout();
      this.applyStyles(false);
    }
  }
  /** The reader's stylesheet for the frame. A resize only changes it in Scroll flow, where the code width follows the side padding; `changed` skips an identical one. */
  private applyStyles(changed: boolean) {
    const renderer = this.view?.renderer;
    if (!renderer || this.mode !== 'paginated') return;
    // The frame's color-scheme must match the app's or Chromium paints it opaque; Foliate paints --theme-bg-color behind each column.
    const { scheme, ink, paper, accent } = readingColors(), options = this.options;
    const styles = `html { color-scheme: ${scheme}; color: ${rgbToHex(ink)}; --theme-bg-color: ${rgbToHex(paper)}; --hmb-paper: ${rgbToHex(paper)}; --hmb-ink: ${rgbToHex(ink)}; } html, body { font-size: ${options.fontSize}px !important; line-height: ${options.lineHeight} !important; } img, svg { max-width: 100%; } a:focus-visible { outline: 2px solid ${rgbToHex(accent)}; } ${codeStyles(this.flowNow === 'scrolled' ? scrollRoom(this.gapShare() / 100) : undefined)}`;
    if (changed && styles === this.styles) return;
    this.styles = styles;
    renderer.setStyles?.(styles);
  }
  /**
   * Dark pages keep publication colors but lift text that would be illegible on them; light pages get the originals back. A code block's
   * background that is light on a dark page (or dark on a light one) becomes a tint of the page, and so does any other box set against the
   * page that way (a callout, a shaded table cell), with its rules lifted; the text on a mapped background is lifted to read on that.
   */
  private adaptInk(doc: Document) {
    for (const [element, property, value, priority] of this.lifted.get(doc) ?? []) element.style.setProperty(property, value, priority);
    this.lifted.delete(doc);
    const { paper, ink } = readingColors(), view = doc.defaultView, body = doc.body;
    if (!view || !body) return;
    const dark = isDark(paper), changed: [HTMLElement, string, string, string][] = [], backgrounds = new Map<Node, Rgb>(), mapped = new Set<Node>();
    const set = (element: HTMLElement, property: string, value: string) => {
      changed.push([element, property, element.style.getPropertyValue(property), element.style.getPropertyPriority(property)]);
      element.style.setProperty(property, value, 'important');
    };
    // A listing inside a frame paints one box: where both a wrapper (pandoc's `div.sourceCode`, Sphinx's `div.highlight`) and its `pre` have a background, or a left rule, the wrapper's is dropped.
    for (const wrapper of Array.from(body.querySelectorAll<HTMLElement>(CODE_WRAPPERS))) {
      const pre = wrapper.parentElement?.closest(CODE_BLOCKS) ? null : wrapper.querySelector('pre');
      if (!pre) continue;
      const frame = view.getComputedStyle(wrapper), code = view.getComputedStyle(pre);
      const rule = (style: CSSStyleDeclaration) => parseFloat(style.borderLeftWidth) > 0 && style.borderLeftStyle !== 'none';
      if (parseRgb(frame.backgroundColor) && parseRgb(code.backgroundColor)) set(wrapper, 'background-color', 'transparent');
      if (rule(frame) && rule(code)) set(wrapper, 'border-left', 'none');
    }
    // Both tones are walked whole: a box set against the page's tone is mapped into it, and on a light page only text on a mapped box (or in code) is lifted.
    const walker = doc.createTreeWalker(body, NodeFilter.SHOW_ELEMENT, { acceptNode: node => (node as Element).namespaceURI === XHTML ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT });
    for (let node: Node | null = body; node; node = walker.nextNode()) {
      const element = node as HTMLElement, style = view.getComputedStyle(element), inCode = !!element.closest(CODE_BLOCKS);
      // Foliate moves the body background behind the frame, where --theme-bg-color replaces it.
      let own = element !== body ? parseRgb(style.backgroundColor) : null;
      const tint = own && inCode && mappedBackground(own, paper, ink);
      // Images, SVG and code keep their own mapping; a callout is any other box with a plain background colour.
      const callout = own && !inCode && style.backgroundImage === 'none' && !element.matches(NOT_CALLOUTS) ? calloutBackground(own, paper) : null;
      if (tint) { set(element, 'background-color', CODE_BACKGROUND); own = tint; mapped.add(element); }
      else if (callout) {
        set(element, 'background-color', callout.css); own = callout.rgb; mapped.add(element);
        for (const side of SIDES) {
          const edge = parseFloat(style.getPropertyValue(`border-${side}-width`)) > 0 && style.getPropertyValue(`border-${side}-style`) !== 'none' && parseRgb(style.getPropertyValue(`border-${side}-color`));
          const lifted = edge && liftRule(edge, own);
          if (lifted) set(element, `border-${side}-color`, rgbToHex(lifted));
        }
      }
      else if (!own && element.parentNode && mapped.has(element.parentNode)) mapped.add(element);
      const background = own || (element.parentNode && backgrounds.get(element.parentNode)) || paper;
      backgrounds.set(element, background);
      if (!dark && !mapped.has(element)) continue;
      if (!Array.from(element.childNodes).some(child => child.nodeType === Node.TEXT_NODE && child.textContent?.trim())) continue;
      const color = parseRgb(style.color), legible = color && liftInk(color, background, ink);
      if (!legible) continue;
      set(element, 'color', rgbToHex(legible));
    }
    if (changed.length) this.lifted.set(doc, changed);
  }
  /**
   * The column is as wide as about 66 characters at the current font size, and Foliate centres it with equal margins either side, so a
   * wide window gains margin rather than longer lines. Foliate shows two columns only when a column is narrower than the box, so
   * with two pages the measure also keeps each column to under half the width.
   */
  private applyMeasure(gap: number) {
    const renderer = this.view?.renderer;
    if (!renderer || this.mode !== 'paginated') return;
    const column = readingMeasure(this.options.fontSize, gap);
    const measure = `${this.layoutSpread ? Math.round(Math.min(column, Math.max(280, this.host.clientWidth * .45))) : column}px`;
    if (renderer.getAttribute('max-inline-size') !== measure) renderer.setAttribute('max-inline-size', measure);
  }
  async setOptions(options: ReaderOptions) {
    return this.enqueue(async () => {
      this.options = { ...options };
      if (this.mode === 'paginated') { this.flowNow = options.flow === 'scrolled' || options.flow === 'paginated' ? options.flow : this.flowNow; this.options.flow = this.flowNow; }
      await this.relayout();
    });
  }
  /**
   * In scrolled flow Foliate shows one chapter at a time and stops scrolling at its ends. A wheel or trackpad gesture that starts at an end
   * and heads past it goes on into the next (or previous) chapter, so the column reads as continuous. A gesture that only arrives at the
   * end, with its momentum still running, stops there.
   */
  private chainChapter(event: WheelEvent, doc: Document) {
    const frame = doc.defaultView?.frameElement, renderer = this.view?.renderer, wheel = this.wheel;
    if (this.flowNow !== 'scrolled' || !frame || !renderer || event.ctrlKey || !event.deltaY) return;
    const down = event.deltaY > 0, area = renderer.getBoundingClientRect(), page = frame.getBoundingClientRect();
    const atEdge = down ? page.bottom <= area.bottom + 2 : page.top >= area.top - 2;
    if (event.timeStamp - wheel.last > WHEEL_GESTURE_GAP) wheel.atEdge = atEdge;
    wheel.last = event.timeStamp;
    if (!wheel.atEdge || !atEdge || event.timeStamp < wheel.until) return;
    wheel.until = event.timeStamp + WHEEL_COOLDOWN;
    void this.navigate(down ? 'next' : 'previous').catch(this.context.onError);
  }
  outline() { return this.items; }
  currentOutline() { const item = this.reported?.tocItem; return item ? this.nodes.indexOf(item) : -1; }
  flow() { return this.mode === 'paginated' ? this.flowNow : undefined; }
  /** Fixed-layout pages scroll inside Foliate's renderer when zoomed; reflowable chapters paginate and never pan. */
  scroller() { return this.mode === 'fixed' ? this.view?.renderer : undefined; }
  /** Foliate does not report the scale it drew at, so it is measured on the page frame on screen: its painted width over its declared width. */
  zoomLevel() {
    if (this.mode !== 'fixed') return undefined;
    for (const frame of this.frames) {
      if (!frame.isConnected) { this.frames.delete(frame); continue; }
      const declared = (frame as HTMLElement).offsetWidth, painted = frame.getBoundingClientRect().width;
      if (declared > 0 && painted > 0) return painted / declared;
    }
    return undefined;
  }
  /** Fixed-layout zoom was never relative to the fit here: Foliate took the number as a scale of the declared viewport, so a saved value already is a true scale. */
  legacyZoomBase() { return this.mode === 'fixed' ? 1 : undefined; }
  destroy() {
    this.disposed = true; this.abort.abort(); this.unsubscribe?.(); this.observer?.disconnect(); clearTimeout(this.resizeTimer);
    try { this.view?.close(); } catch { /* An opening cancellation may precede Foliate's first page. */ }
    this.view?.remove(); this.book?.destroy(); void this.archive?.close(); this.view = undefined; this.book = undefined;
    this.host?.classList.remove('reflow-reader');
  }
}
