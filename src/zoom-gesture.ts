import { pageFraction, roundZoom, scrollToHold, zoomAbout, ZOOM_MAX, ZOOM_MIN, type Point, type Pose } from './zoom';

/** Marks a scroller whose page is being scaled by a gesture; adapters must not refit it meanwhile (see the PDF and image resize handlers). */
export const PREVIEW_CLASS = 'zoom-preview';
/** The page, spread or image frame a gesture scales: the same box the hand tool moves. */
const SURFACE = ':scope > .pdf-page, :scope > .pdf-spread, :scope > .image-frame';
/** Quiet time that ends a wheel gesture; a pinch on macOS also ends it explicitly. */
const SETTLE_MS = 160;

export type ZoomGestureTarget = {
  /** The scroll container of the open page-based document, or undefined when it cannot zoom by gesture. */
  scroller(): HTMLElement | undefined;
  /** The zoom committed to the document now. */
  zoom(): number;
  /** Applies a zoom and resolves once the document is drawn at it; resolves to the zoom that is now committed. */
  commit(zoom: number): Promise<number>;
};

type Gesture = { host: HTMLElement; surface: HTMLElement | null; base: number; pose: Pose; origin: Point; pointer: Point };

/**
 * Continuous zoom toward the pointer for Ctrl/⌘ + wheel and trackpad pinch.
 *
 * While the gesture runs the page is only scaled and moved with a CSS transform, one write per animation
 * frame: nothing is re-laid-out or re-rendered, so the page stays blurry but follows the fingers at full
 * rate, and the document point under the pointer stays under it. When the input pauses the zoom is committed
 * once (a crisp render through the adapter) and the scroll offset is set so that same point is still under the
 * pointer. Input that arrives while a commit is drawing is kept and starts the next gesture.
 */
export function createZoomGesture(target: ZoomGestureTarget) {
  let gesture: Gesture | undefined, timer: ReturnType<typeof setTimeout> | undefined, frame = 0, committing = false;
  let queued: { factor: number; at: Point } | undefined;

  const paint = () => {
    frame = 0;
    if (!gesture?.surface) return;
    const { pose, surface } = gesture;
    surface.style.transformOrigin = '0 0';
    surface.style.transform = `translate(${pose.x}px, ${pose.y}px) scale(${pose.scale})`;
  };

  function begin(at: Point): Gesture | undefined {
    const host = target.scroller();
    if (!host) return undefined;
    const surface = host.querySelector<HTMLElement>(SURFACE), box = surface?.getBoundingClientRect();
    host.classList.add(PREVIEW_CLASS);
    return { host, surface, base: target.zoom(), pose: { scale: 1, x: 0, y: 0 }, origin: { x: box?.left ?? 0, y: box?.top ?? 0 }, pointer: at };
  }

  async function settle() {
    clearTimeout(timer); timer = undefined;
    const current = gesture;
    if (!current || committing) return;
    cancelAnimationFrame(frame); paint();
    const zoom = roundZoom(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, current.base * current.pose.scale)));
    const { host, surface, pointer, pose } = current;
    const size = surface ? { width: surface.offsetWidth, height: surface.offsetHeight } : undefined;
    const held = size ? pageFraction(pose, { x: pointer.x - current.origin.x, y: pointer.y - current.origin.y }, size) : undefined;
    committing = true;
    let committed = current.base;
    try { committed = zoom === current.base ? current.base : await target.commit(zoom); }
    finally {
      // The scaled page is replaced by the crisp one (or, for an image, resized in place) in the same task.
      if (surface) { surface.style.transform = ''; surface.style.transformOrigin = ''; }
      host.classList.remove(PREVIEW_CLASS);
      gesture = undefined; committing = false;
    }
    const fresh = held && committed !== current.base ? host.querySelector<HTMLElement>(SURFACE) : null;
    if (fresh && held) {
      const box = fresh.getBoundingClientRect(), edge = host.getBoundingClientRect();
      host.scrollLeft = scrollToHold(box.left - edge.left + host.scrollLeft, held.x, box.width, pointer.x - edge.left);
      host.scrollTop = scrollToHold(box.top - edge.top + host.scrollTop, held.y, box.height, pointer.y - edge.top);
    }
    // Wheel events that came in while the page was being drawn start the next gesture.
    const next = queued; queued = undefined;
    if (next) zoomBy(next.factor, next.at);
  }

  /** Scales the page by `factor` about the viewport point `at` (client coordinates) and schedules the commit. */
  function zoomBy(factor: number, at: Point) {
    if (committing) { queued = { factor: (queued?.factor ?? 1) * factor, at }; return; }
    gesture ??= begin(at);
    if (!gesture) return;
    gesture.pointer = at;
    gesture.pose = zoomAbout(gesture.pose, factor, { x: at.x - gesture.origin.x, y: at.y - gesture.origin.y }, ZOOM_MIN / gesture.base, ZOOM_MAX / gesture.base);
    if (!frame) frame = requestAnimationFrame(paint);
    clearTimeout(timer); timer = setTimeout(() => void settle(), SETTLE_MS);
  }

  return {
    zoomBy,
    /** Commits now instead of waiting for the input to pause (the end of a pinch). */
    end: () => void settle(),
    /** Drops a gesture when its document goes away; nothing is committed. */
    cancel() {
      clearTimeout(timer); timer = undefined; cancelAnimationFrame(frame); frame = 0; queued = undefined;
      if (committing || !gesture) return;
      if (gesture.surface) { gesture.surface.style.transform = ''; gesture.surface.style.transformOrigin = ''; }
      gesture.host.classList.remove(PREVIEW_CLASS); gesture = undefined;
    },
  };
}
