/**
 * Hand-tool panning for page-based content (PDF, images, fixed-layout EPUB).
 *
 * Dragging moves the scroll container 1:1, without momentum. The primary button pans only
 * while the hand tool is on; the middle button pans whenever the content can pan. A press
 * that never travels past DRAG_SLOP stays an ordinary click, so links keep working; a real
 * drag swallows the click that would follow it.
 *
 * The hand tool is a mode, not a capability: it turns on for any page-based document, even
 * at a zoom where the page fits and there is nothing to move yet. `overflowing` stays a live
 * geometry query so the UI can say whether a drag would do anything, but it never revokes
 * the tool — that is what made the button dead at Fit and below 100%.
 *
 * Fixed-layout EPUB pages live in same-origin iframes whose pointer input never reaches the
 * application document, so each frame document is watched directly (`watchFrame`).
 */
export const DRAG_SLOP = 3;
const XHTML = 'http://www.w3.org/1999/xhtml';
const FRAME_STYLE = `html.float-hand, html.float-hand * { cursor: grab !important; -webkit-user-select: none !important; user-select: none !important; }
html.float-hand a[href], html.float-hand a[href] * { cursor: pointer !important; }
html.float-panning, html.float-panning * { cursor: grabbing !important; }`;

type Drag = { id: number; x: number; y: number; left: number; top: number; moved: boolean; frame: boolean; capture: Element; win: Window; stop: () => void };

/** True when `node` is `ancestor` or sits below it, crossing shadow roots. */
function composedContains(ancestor: Node, node: Node | null): boolean {
  while (node) {
    if (node === ancestor) return true;
    const root = node.getRootNode();
    node = node.parentNode ?? (root instanceof ShadowRoot ? root.host : null);
  }
  return false;
}

/** Whether a scroll container has content beyond its visible box on either axis. */
export function overflows(scroller: { scrollWidth: number; clientWidth: number; scrollHeight: number; clientHeight: number }) {
  return scroller.scrollWidth - scroller.clientWidth > 1 || scroller.scrollHeight - scroller.clientHeight > 1;
}

export class Panner {
  private scroller?: HTMLElement;
  private surface?: HTMLElement;
  private frames = new Set<Document>();
  private drag?: Drag;
  private release?: () => void;
  private on = false;

  /** Hand tool state; stays on across zoom and resize, even while nothing overflows. */
  get hand() { return this.on; }
  get pannable() { return !!this.scroller; }
  get overflowing() { return !!this.scroller && overflows(this.scroller); }

  /**
   * Binds to a newly opened document. `scroller` is the element that scrolls (undefined when
   * the content reflows and cannot pan); `surface` is the reader host that receives input,
   * focus and cursor classes. Always resets the hand tool.
   */
  attach(scroller: HTMLElement | undefined, surface: HTMLElement | undefined) {
    this.cancel(); this.release?.(); this.release = undefined;
    this.surface?.classList.remove('hand-tool', 'panning');
    this.scroller = scroller; this.surface = surface; this.on = false;
    if (scroller && surface) {
      const down = (event: PointerEvent) => this.start(event, false);
      const guard = (event: MouseEvent) => this.guard(event, false);
      surface.addEventListener('pointerdown', down);
      surface.addEventListener('mousedown', guard);
      this.release = () => { surface.removeEventListener('pointerdown', down); surface.removeEventListener('mousedown', guard); };
    }
    this.sync();
  }

  /**
   * Turns the hand tool on or off. Any page-based document accepts it, whether or not the
   * content overflows right now: a fully-fitting page is "on with nothing to move", and the
   * tool starts moving the moment a zoom makes the content overflow.
   */
  setHand(on: boolean) { this.on = on && this.pannable; this.sync(); return this.on; }

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
  /** Whether a primary-button press should start a pan: the tool is on and there is room to move. */
  private active() { return this.on && this.overflowing; }
  private onScrollbar(event: MouseEvent) {
    const scroller = this.scroller!, box = scroller.getBoundingClientRect();
    return event.clientX >= box.left + scroller.clientLeft + scroller.clientWidth || event.clientY >= box.top + scroller.clientTop + scroller.clientHeight;
  }
  private accepts(event: MouseEvent, frame: boolean) {
    if (!this.scroller || !this.surface || !(event.button === 1 || (event.button === 0 && this.active()))) return false;
    if (frame) return this.live((event.target as Node).ownerDocument ?? (event.target as Document));
    return !this.onScrollbar(event);
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
    const win = doc.defaultView!;
    const move = (e: PointerEvent) => this.move(e);
    const up = (e: PointerEvent) => { if (e.pointerId === this.drag?.id) this.finish(); };
    win.addEventListener('pointermove', move, true);
    win.addEventListener('pointerup', up, true);
    win.addEventListener('pointercancel', up, true);
    // Frame coordinates shift as the frame scrolls (and are scaled); screen coordinates do not.
    this.drag = { id: event.pointerId, x: frame ? event.screenX : event.clientX, y: frame ? event.screenY : event.clientY,
      left: scroller.scrollLeft, top: scroller.scrollTop, moved: false, frame, win,
      capture: frame ? doc.documentElement : this.surface!,
      stop: () => { win.removeEventListener('pointermove', move, true); win.removeEventListener('pointerup', up, true); win.removeEventListener('pointercancel', up, true); } };
  }

  private move(event: PointerEvent) {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.id || !this.scroller) return;
    const dx = (drag.frame ? event.screenX : event.clientX) - drag.x;
    const dy = (drag.frame ? event.screenY : event.clientY) - drag.y;
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < DRAG_SLOP) return;
      // Capture only once this is a drag: capturing on press would retarget a plain click away from links.
      drag.moved = true;
      try { drag.capture.setPointerCapture(drag.id); } catch { /* The pointer may already be gone. */ }
      this.setPanning(true);
    }
    event.preventDefault();
    this.scroller.scrollLeft = drag.left - dx;
    this.scroller.scrollTop = drag.top - dy;
  }

  private finish() {
    const drag = this.drag;
    if (!drag) return;
    this.cancel();
    if (!drag.moved) return;
    // The click (or middle-button auxclick) after a drag must not follow a link under the cursor.
    const swallow = (event: Event) => { event.preventDefault(); event.stopPropagation(); };
    for (const target of new Set([drag.win, window])) {
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

  /**
   * The grab cursor is an affordance, so it is only shown where a drag would move something:
   * `active()` (tool on *and* overflowing), not the bare tool state. A page that fits gets no
   * grab cursor, because grabbing it would do nothing — the pressed state of the button is
   * what reports the tool itself.
   */
  private sync() {
    const on = this.active();
    this.surface?.classList.toggle('hand-tool', on);
    for (const doc of [...this.frames]) doc.documentElement?.classList.toggle('float-hand', on && this.live(doc));
  }
  /** Re-evaluates the cursor after zoom, resize or page changes; the tool state itself is not touched. */
  refresh() { this.sync(); }
}
