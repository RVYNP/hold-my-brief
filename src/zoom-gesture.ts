import { pageFraction, roundZoom, zoomAbout, type Point, type Pose, type ZoomLimits } from './zoom';
import { KEEP } from './pan';
import type { Spot } from './zoom-anchor';

/** Marks a scroller whose page is being scaled by a gesture; adapters must not refit it meanwhile (see the PDF and image resize handlers). */
export const PREVIEW_CLASS = 'zoom-preview';
/** The page, spread or image frame a gesture scales: the same box the hand tool moves. */
export const SURFACE = ':scope > .pdf-page, :scope > .pdf-spread, :scope > .image-frame';
/** Quiet time that ends a wheel gesture; a pinch on macOS also ends it explicitly. */
const SETTLE_MS = 160;

export type ZoomGestureTarget = {
  /** The scroll container of the open page-based document, or undefined when it cannot zoom by gesture. */
  scroller(): HTMLElement | undefined;
  /** The level the document is drawn at now, also while a fit is in force. */
  zoom(): number;
  /** The range the page on screen can be zoomed within. */
  limits(): ZoomLimits;
  /**
   * Applies a true zoom (leaving any fit) and resolves once the document is drawn at it. `spot` is the document point that was under
   * the pointer; the target puts it back there as the page is drawn (scrolling, or sliding the page where the page fits or the scroll range ends).
   */
  commit(zoom: number, spot: Spot | undefined): Promise<void>;
};

type Gesture = { host: HTMLElement; surface: HTMLElement | null; base: number; pose: Pose; origin: Point; pointer: Point; pad: Point };

/**
 * Continuous zoom toward the pointer for Ctrl/⌘ + wheel and trackpad pinch.
 *
 * While the gesture runs the page is only scaled and moved with a CSS transform, one write per animation
 * frame: nothing is re-laid-out or re-rendered, so the page stays blurry but follows the fingers at full
 * rate, and the document point under the pointer stays under it. When the input pauses the zoom is committed
 * once (a crisp render through the adapter), with that point to hold: the adapter places it as part of drawing the page, so the
 * crisp page appears exactly where the scaled one was. Input that arrives while a commit is drawing is kept and starts the next gesture.
 */
export function createZoomGesture(target: ZoomGestureTarget) {
  let gesture: Gesture | undefined, timer: ReturnType<typeof setTimeout> | undefined, frame = 0, committing = false;
  let queued: { factor: number; at: Point } | undefined;

  const paint = () => {
    frame = 0;
    if (!gesture?.surface) return;
    const { surface } = gesture, pose = reachable(gesture, gesture.pose);
    surface.style.transformOrigin = '0 0';
    surface.style.transform = `translate(${pose.x}px, ${pose.y}px) scale(${pose.scale})`;
  };

  function begin(at: Point): Gesture | undefined {
    const host = target.scroller();
    if (!host) return undefined;
    const surface = host.querySelector<HTMLElement>(SURFACE), box = surface?.getBoundingClientRect();
    const style = getComputedStyle(host);
    host.classList.add(PREVIEW_CLASS);
    return { host, surface, base: target.zoom(), pose: { scale: 1, x: 0, y: 0 }, origin: { x: box?.left ?? 0, y: box?.top ?? 0 }, pointer: at, pad: { x: parseFloat(style.paddingLeft) || 0, y: parseFloat(style.paddingTop) || 0 } };
  }

  /**
   * What is drawn for `pose`, the zoom the input asked for. The pose keeps the pointer's point still whatever the path to it, so a page
   * that cannot show it there is only drawn where it can: on an axis it will overflow, within its scroll range (zooming cannot drag a page
   * past its own end; it rests against it, as the document itself will), and on an axis it fits, with KEEP px of it in the panel. The crisp
   * page then replaces the scaled one exactly where it was drawn, so nothing moves when the gesture settles.
   */
  function reachable(current: Gesture, pose: Pose): Pose {
    const { host, surface, origin, pad } = current;
    if (!surface || surface.classList.contains('image-frame')) return pose;
    const edge = host.getBoundingClientRect();
    const axis = (shift: number, start: number, extent: number, panel: number, edgeAt: number, inset: number) => {
      const size = extent * pose.scale, rest = start - edgeAt + shift; // The page's start in the panel, from its inner edge.
      const [low, high] = size + 2 * inset - panel > 1 ? [panel - inset - size, inset] : [Math.min(KEEP, size, panel) - size, panel - Math.min(KEEP, size, panel)];
      return Math.max(low, Math.min(high, rest)) - start + edgeAt;
    };
    return { scale: pose.scale,
      x: axis(pose.x, origin.x, surface.offsetWidth, host.clientWidth, edge.left + host.clientLeft, pad.x),
      y: axis(pose.y, origin.y, surface.offsetHeight, host.clientHeight, edge.top + host.clientTop, pad.y) };
  }

  async function settle() {
    clearTimeout(timer); timer = undefined;
    const current = gesture;
    if (!current || committing) return;
    cancelAnimationFrame(frame);
    const { host, surface, pointer } = current;
    const limits = target.limits(), zoom = roundZoom(Math.max(limits.min, Math.min(limits.max, current.base * current.pose.scale)), limits);
    const changed = current.pose.scale !== 1;
    // The crisp page is drawn at a whole percent: scale the preview to exactly that first, so the two agree to the pixel.
    if (changed && zoom !== current.base) current.pose = zoomAbout(current.pose, zoom / current.base / current.pose.scale, { x: pointer.x - current.origin.x, y: pointer.y - current.origin.y }, 0, Infinity);
    paint();
    const pose = reachable(current, current.pose);
    const size = surface ? { width: surface.offsetWidth, height: surface.offsetHeight } : undefined;
    const held = size ? pageFraction(pose, { x: pointer.x - current.origin.x, y: pointer.y - current.origin.y }, size) : undefined;
    // Where the pointer is in the panel, from its inner edge: the point to hold stays there.
    const edge = host.getBoundingClientRect();
    const spot: Spot | undefined = held && { x: { f: held.x, at: pointer.x - edge.left - host.clientLeft }, y: { f: held.y, at: pointer.y - edge.top - host.clientTop } };
    committing = true;
    try { if (changed) await target.commit(zoom, spot); }
    finally {
      // The scaled page is replaced by the crisp one (or, for an image, resized in place) in the same task.
      if (surface) { surface.style.transform = ''; surface.style.transformOrigin = ''; }
      host.classList.remove(PREVIEW_CLASS);
      gesture = undefined; committing = false;
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
    const limits = target.limits();
    gesture.pose = zoomAbout(gesture.pose, factor, { x: at.x - gesture.origin.x, y: at.y - gesture.origin.y }, limits.min / gesture.base, limits.max / gesture.base);
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
