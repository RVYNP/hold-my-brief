/**
 * Hand-tool panning for page-based content (PDF, images, fixed-layout EPUB).
 *
 * The hand tool is a mode, not a capability: it is available for any page-based document at
 * any zoom. What a drag does depends on whether the content is larger than the panel.
 *
 * - Larger: the drag moves the scroll container 1:1, without momentum.
 * - It fits (Fit, or zoomed below 100%): the drag slides the page itself around the panel
 *   1:1, like a sheet across a desk, never further than leaving KEEP px of it inside on each
 *   axis. The offset is a pair of CSS variables on the reader host; style.css turns them into
 *   `translate` on the committed page, spread, image or fixed-layout renderer. A translate
 *   moves pixels at paint time, so the host's client size never changes and nothing refits or
 *   re-renders. While the page is moved the host stops scrolling (`page-moved`): a translated
 *   page would otherwise grow its scrollable area, and a scrollbar is exactly what once made the
 *   PDF adapter refit (PR #12).
 *
 * The offset survives page turns (the next page appears where the last one was) and is cleared
 * by `recenter` (a fit command, or a zoom, which then places the point it holds), a change of page layout,
 * content that starts to overflow, and a new document. A window resize re-clamps it.
 *
 * A zoom holds a point of the page still (zoom-anchor.ts). On an axis the page now fits the layout centres it, so `slideTo` puts
 * the move in the offset: the page stays where the point needs it, never further than KEEP px from leaving the panel. Each axis is
 * locked while it is slid (`page-moved-x`, `page-moved-y`): the other still scrolls, so a page that fits sideways but not
 * vertically is slid sideways and scrolled up and down. An axis that overflows is only ever scrolled.
 *
 * The primary button pans only while the hand tool is on; the middle button pans whenever the
 * content can pan. A press that never travels past DRAG_SLOP stays an ordinary click, so links
 * keep working; a real drag swallows the click that would follow it.
 *
 * Fixed-layout EPUB pages live in same-origin iframes whose pointer input never reaches the
 * application document, so each frame document is watched directly (`watchFrame`).
 */
export const DRAG_SLOP = 3;
/** How much of a moved page must stay inside the panel on each axis, in px. */
export const KEEP = 64;
const MOVED = 'page-moved', MOVED_X = 'page-moved-x', MOVED_Y = 'page-moved-y';
/** The committed PDF page or spread, or the image, that a move shifts: its box is the page. */
const PAGE = ':scope > .pdf-page, :scope > .pdf-spread, :scope .image-frame img';
/** What the host lays out around the page and scrolls: the page or spread, or the frame an image sits in. */
const CONTENT = ':scope > .pdf-page, :scope > .pdf-spread, :scope > .image-frame';
const XHTML = 'http://www.w3.org/1999/xhtml';
const FRAME_STYLE = `html.float-hand, html.float-hand * { cursor: grab !important; -webkit-user-select: none !important; user-select: none !important; }
html.float-hand a[href], html.float-hand a[href] * { cursor: pointer !important; }
html.float-panning, html.float-panning * { cursor: grabbing !important; }`;

export type Box = { left: number; top: number; right: number; bottom: number };
export type Offset = { x: number; y: number };
type Axes<T> = { x: T; y: T };
/** The page's untransformed box and the panel it moves in, and on which axes the content fits the panel. */
type Room = { page: Box; panel: Box; fits: Axes<boolean> };
type Drag = { id: number; x: number; y: number; sx: number; sy: number; left: number; top: number; slide?: Room & Offset; moved: boolean; frame: boolean; capture: Element; wins: Set<Window>; stop: () => void };

/** True when `node` is `ancestor` or sits below it, crossing shadow roots. */
function composedContains(ancestor: Node, node: Node | null): boolean {
  while (node) {
    if (node === ancestor) return true;
    const root = node.getRootNode();
    node = node.parentNode ?? (root instanceof ShadowRoot ? root.host : null);
  }
  return false;
}

type Scrollable = { scrollWidth: number; clientWidth: number; scrollHeight: number; clientHeight: number };
/** Whether a scroll container has content beyond its visible box on either axis. */
export function overflows(scroller: Scrollable) {
  return scroller.scrollWidth - scroller.clientWidth > 1 || scroller.scrollHeight - scroller.clientHeight > 1;
}
/** Which axes of a scroll container have content beyond its visible box. */
export function overflowAxes(scroller: Scrollable): Axes<boolean> {
  return { x: scroller.scrollWidth - scroller.clientWidth > 1, y: scroller.scrollHeight - scroller.clientHeight > 1 };
}

/**
 * Limits how far a page may be slid: at least `keep` px of `page` (its box at zero offset) stay
 * inside `panel` on each axis, or all of it when it is smaller than that.
 */
export function clampOffset(offset: Offset, page: Box, panel: Box, keep = KEEP): Offset {
  const axis = (value: number, low: number, high: number, panelLow: number, panelHigh: number) => {
    const kept = Math.min(keep, high - low, panelHigh - panelLow);
    return Math.max(panelLow + kept - high, Math.min(panelHigh - kept - low, value));
  };
  return { x: axis(offset.x, page.left, page.right, panel.left, panel.right), y: axis(offset.y, page.top, page.bottom, panel.top, panel.bottom) };
}

/**
 * Which axes of the host hold everything the host lays out: the page, or spread, or image frame, and the host's padding around it. Read
 * from the boxes rather than the scroll size: `scrollWidth`/`scrollHeight` follow a translate only on the next frame, so right after a page
 * has been slid, or put back, they still describe the other state.
 */
function fitsAround(host: HTMLElement): Axes<boolean> {
  const content = host.querySelector(CONTENT)?.getBoundingClientRect(), style = getComputedStyle(host);
  if (!content) return fitsOf(host);
  const [x, y] = [content.width + (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0), content.height + (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0)];
  return { x: x - host.clientWidth <= 1, y: y - host.clientHeight <= 1 };
}
const fitsOf = (scroller: Scrollable): Axes<boolean> => { const over = overflowAxes(scroller); return { x: !over.x, y: !over.y }; };

export class Panner {
  private scroller?: HTMLElement;
  private surface?: HTMLElement;
  private frames = new Set<Document>();
  private drag?: Drag;
  private release?: () => void;
  private on = false;
  /** Where the fitting page has been slid to, relative to its natural place. */
  private offset: Offset = { x: 0, y: 0 };
  private layout?: string;
  /** Panel size when the offset was last known to fit, to tell a stale page after a resize from content that really grew. */
  private sized = '';

  /** Hand tool state; stays on across zoom, resize and page turns. */
  get hand() { return this.on; }
  get pannable() { return !!this.scroller; }

  /**
   * Binds to a newly opened document. `scroller` is the element that scrolls (undefined when
   * the content reflows and cannot pan); `surface` is the reader host that receives input,
   * focus and cursor classes. Always resets the hand tool and the page offset.
   */
  attach(scroller: HTMLElement | undefined, surface: HTMLElement | undefined) {
    this.cancel(); this.release?.(); this.release = undefined;
    this.recenter();
    this.surface?.classList.remove('hand-tool', 'panning');
    this.scroller = scroller; this.surface = surface; this.on = false; this.layout = undefined;
    if (scroller && surface) {
      const down = (event: PointerEvent) => this.start(event, false);
      const guard = (event: MouseEvent) => this.guard(event, false);
      // A resize re-clamps a moved page; it only reads geometry and writes a paint-time translate.
      const resize = new ResizeObserver(() => this.settle(false));
      surface.addEventListener('pointerdown', down);
      surface.addEventListener('mousedown', guard);
      resize.observe(surface);
      this.release = () => { surface.removeEventListener('pointerdown', down); surface.removeEventListener('mousedown', guard); resize.disconnect(); };
    }
    this.sync();
  }

  /** Turns the hand tool on or off; any page-based document accepts it at any zoom. */
  setHand(on: boolean) { this.on = on && this.pannable; this.sync(); return this.on; }

  /** Puts a slid page back in its natural place: a zoom or fit command asks for a fresh view. */
  recenter() {
    this.offset = { x: 0, y: 0 };
    this.apply();
  }

  /**
   * Slides the page by `offset` from where the layout puts it, held within KEEP px of the panel, on the axes where it fits (the layout
   * centres it there; an axis that overflows scrolls instead). A zoom that holds a point calls this once the page is redrawn.
   */
  slideTo(offset: Offset) {
    const room = this.room();
    if (!room) return;
    const slid = clampOffset({ x: room.fits.x ? offset.x : 0, y: room.fits.y ? offset.y : 0 }, room.page, room.panel);
    this.offset = { x: room.fits.x ? slid.x : 0, y: room.fits.y ? slid.y : 0 };
    this.sized = this.size();
    this.apply();
  }

  /** Listens inside one same-origin content frame; the frame only pans while it belongs to the bound scroller. */
  watchFrame(doc: Document) {
    if (this.frames.has(doc)) return;
    this.frames.add(doc);
    const style = doc.createElementNS(XHTML, 'style'); style.textContent = FRAME_STYLE;
    (doc.head ?? doc.documentElement).append(style);
    doc.addEventListener('pointerdown', event => this.start(event, true), true);
    doc.addEventListener('mousedown', event => this.guard(event, true), true);
    this.sync();
  }

  private live(doc: Document) {
    const frame = doc.defaultView?.frameElement;
    if (!frame) { this.frames.delete(doc); return false; }
    return !!this.scroller && composedContains(this.scroller, frame);
  }

  /** Publishes the offset to the host: variables for style.css's `translate`, and the class that stops scrolling. */
  private apply() {
    const surface = this.surface, { x, y } = this.offset, moved = x !== 0 || y !== 0;
    if (!surface) return;
    surface.classList.toggle(MOVED, moved); surface.classList.toggle(MOVED_X, x !== 0); surface.classList.toggle(MOVED_Y, y !== 0);
    if (moved) { surface.style.setProperty('--pan-x', `${x}px`); surface.style.setProperty('--pan-y', `${y}px`); }
    else { surface.style.removeProperty('--pan-x'); surface.style.removeProperty('--pan-y'); }
  }

  /**
   * The geometry a slide is clamped by, and on which axes the content fits the panel. Measured with the offset lifted: a
   * translated page would otherwise count as overflow, and its box would already include the move. Everything happens in
   * one task, so nothing is painted.
   */
  private room(): Room | undefined {
    const scroller = this.scroller, surface = this.surface;
    if (!scroller || !surface) return undefined;
    const lifted = [MOVED, MOVED_X, MOVED_Y].filter(name => surface.classList.contains(name));
    for (const name of lifted) surface.classList.remove(name);
    try {
      const rects = [...this.frames].filter(doc => this.live(doc)).map(doc => doc.defaultView!.frameElement!.getBoundingClientRect());
      if (!rects.length) { const page = surface.querySelector(PAGE); if (page) rects.push(page.getBoundingClientRect()); }
      const shown = rects.filter(rect => rect.width > 0 && rect.height > 0);
      if (!shown.length) return undefined;
      const panel = surface.getBoundingClientRect();
      return {
        fits: this.frames.size ? fitsOf(scroller) : fitsAround(surface),
        page: { left: Math.min(...shown.map(r => r.left)), top: Math.min(...shown.map(r => r.top)), right: Math.max(...shown.map(r => r.right)), bottom: Math.max(...shown.map(r => r.bottom)) },
        panel: { left: panel.left + surface.clientLeft, top: panel.top + surface.clientTop, right: panel.left + surface.clientLeft + surface.clientWidth, bottom: panel.top + surface.clientTop + surface.clientHeight },
      };
    } finally { for (const name of lifted) surface.classList.add(name); }
  }

  /**
   * Keeps a moved page valid: re-clamped on each axis where it fits. An axis that does not fit has two cases. If the panel changed
   * size since the offset was last valid, the adapter has not refitted yet and this is the stale page, so the offset waits for the
   * refit. Otherwise the content really grew past the panel, and `drop` (a refresh after a zoom or page turn) puts the page back
   * so the host can scroll it again.
   */
  private settle(drop: boolean) {
    if (!this.offset.x && !this.offset.y) return;
    const room = this.room(), stale = !drop || this.size() !== this.sized;
    let waiting = false;
    if (!room || (!room.fits.x && !room.fits.y)) {
      if (stale) return;
      this.offset = { x: 0, y: 0 };
    } else {
      const next = clampOffset(this.offset, room.page, room.panel), offset = { ...this.offset };
      for (const axis of ['x', 'y'] as const) {
        if (room.fits[axis]) offset[axis] = next[axis];
        else if (!stale) offset[axis] = 0;
        else waiting = true;
      }
      this.offset = offset;
    }
    if (!waiting) this.sized = this.size(); // An axis still waiting for the refit must keep seeing the old size, or the next refresh would take it for grown content.
    this.apply();
  }
  private size() { return `${this.surface?.clientWidth}:${this.surface?.clientHeight}`; }

  private accepts(event: MouseEvent, frame: boolean) {
    if (!this.scroller || !this.surface || !(event.button === 1 || (event.button === 0 && this.on))) return false;
    if (frame) return this.live((event.target as Node).ownerDocument ?? (event.target as Document));
    return !this.onScrollbar(event);
  }
  private onScrollbar(event: MouseEvent) {
    const scroller = this.scroller!, box = scroller.getBoundingClientRect();
    return event.clientX >= box.left + scroller.clientLeft + scroller.clientWidth || event.clientY >= box.top + scroller.clientTop + scroller.clientHeight;
  }

  /** Blocks the press's default action: text selection, native link/image drag, middle-button autoscroll. */
  private guard(event: MouseEvent, frame: boolean) {
    if (!this.accepts(event, frame)) return;
    event.preventDefault();
    this.surface!.focus({ preventScroll: true });
  }

  private start(event: PointerEvent, frame: boolean) {
    if (this.drag || !event.isPrimary || event.pointerType === 'touch' || !this.accepts(event, frame)) return;
    const scroller = this.scroller!, target = event.target as Node;
    const doc = frame ? target.ownerDocument ?? (target as Document) : document;
    // The press can land in the page frame while the pointer travels through the margin around it, or the
    // other way round, and a document only hears pointers that are over it until capture begins at the
    // first real move. So every realm listens, and `move` reads each event in a coordinate system all share.
    const wins = new Set<Window>([window, doc.defaultView!]);
    for (const other of this.frames) if (this.live(other)) wins.add(other.defaultView!);
    const move = (e: PointerEvent) => this.move(e);
    const up = (e: PointerEvent) => { if (e.pointerId === this.drag?.id) this.finish(); };
    for (const win of wins) { win.addEventListener('pointermove', move, true); win.addEventListener('pointerup', up, true); win.addEventListener('pointercancel', up, true); }
    const room = this.room();
    this.sized = this.size();
    this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY, sx: event.screenX, sy: event.screenY,
      left: scroller.scrollLeft, top: scroller.scrollTop, slide: room && room.fits.x && room.fits.y ? { ...room, ...this.offset } : undefined, moved: false, frame, wins,
      capture: frame ? doc.documentElement : this.surface!,
      stop: () => { for (const win of wins) { win.removeEventListener('pointermove', move, true); win.removeEventListener('pointerup', up, true); win.removeEventListener('pointercancel', up, true); } } };
  }

  private move(event: PointerEvent) {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.id || !this.scroller) return;
    // Frame coordinates shift as the frame scrolls or is moved (and are scaled); screen coordinates do not.
    // Only a drag that began in the application document and is still reported there can use client coordinates.
    const own = !drag.frame && event.view === window;
    const dx = own ? event.clientX - drag.x : event.screenX - drag.sx;
    const dy = own ? event.clientY - drag.y : event.screenY - drag.sy;
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < DRAG_SLOP) return;
      // Capture only once this is a drag: capturing on press would retarget a plain click away from links.
      drag.moved = true;
      try { drag.capture.setPointerCapture(drag.id); } catch { /* The pointer may already be gone. */ }
      this.setPanning(true);
    }
    event.preventDefault();
    if (drag.slide) {
      const { page, panel, x, y } = drag.slide;
      this.offset = clampOffset({ x: x + dx, y: y + dy }, page, panel);
      this.apply();
    } else {
      this.scroller.scrollLeft = drag.left - dx;
      this.scroller.scrollTop = drag.top - dy;
    }
  }

  private finish() {
    const drag = this.drag;
    if (!drag) return;
    this.cancel();
    if (!drag.moved) return;
    // The click (or middle-button auxclick) after a drag must not follow a link under the cursor.
    const swallow = (event: Event) => { event.preventDefault(); event.stopPropagation(); };
    for (const target of drag.wins) {
      target.addEventListener('click', swallow, true); target.addEventListener('auxclick', swallow, true);
      setTimeout(() => { target.removeEventListener('click', swallow, true); target.removeEventListener('auxclick', swallow, true); });
    }
  }

  private cancel() {
    const drag = this.drag;
    if (!drag) return;
    this.drag = undefined; drag.stop();
    try { if (drag.capture.hasPointerCapture(drag.id)) drag.capture.releasePointerCapture(drag.id); } catch { /* Detached frame. */ }
    this.setPanning(false);
  }

  private setPanning(on: boolean) {
    this.surface?.classList.toggle('panning', on);
    for (const doc of this.frames) if (this.live(doc)) doc.documentElement.classList.toggle('float-panning', on);
  }

  private sync() {
    this.surface?.classList.toggle('hand-tool', this.on);
    for (const doc of [...this.frames]) doc.documentElement?.classList.toggle('float-hand', this.on && this.live(doc));
  }

  /**
   * Re-evaluates the page offset and cursor after a zoom, resize or page turn. `layout` names the
   * page layout in force (single page or two-page view); a change of it puts the page back.
   */
  refresh(layout = '') {
    if (layout !== this.layout) { if (this.layout !== undefined) this.recenter(); this.layout = layout; }
    this.settle(true); this.sync();
  }
}
