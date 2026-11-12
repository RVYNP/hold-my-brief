/**
 * Zoom arithmetic for page-based documents, kept free of the DOM so it can be tested.
 *
 * A zoom is a multiplier of the current fit (1 = fitted, shown as "Fit" or "Width"), the same number
 * `ReaderOptions.zoom` stores. The buttons, the menu and Ctrl + / Ctrl − move along a fixed ladder;
 * Ctrl + wheel and trackpad pinch move continuously, then settle on a value rounded to a whole percent.
 */
export const ZOOM_MIN = .25;
export const ZOOM_MAX = 4;
/** What zoom in and zoom out snap to, from the current value. */
export const ZOOM_STEPS: readonly number[] = [.25, .33, .5, .67, .75, .9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];
/** The presets at the foot of the zoom menu. */
export const ZOOM_PRESETS: readonly number[] = [.5, 1, 2];
/** Two values closer than this are the same zoom (half a percent). */
const SAME = .005;

export const clampZoom = (zoom: number) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Number.isFinite(zoom) ? zoom : 1));
/** A zoom as the whole percentage the interface shows. */
export const zoomPercent = (zoom: number) => Math.round(zoom * 100);
/** A zoom rounded to a whole percent, so what is stored is what is shown. */
export const roundZoom = (zoom: number) => zoomPercent(zoom) / 100;

/** The next rung above (`direction` 1) or below (-1) `current`; the end of the ladder when there is none. */
export function stepZoom(current: number, direction: 1 | -1): number {
  const next = direction === 1 ? ZOOM_STEPS.find(rung => rung > current + SAME) : ZOOM_STEPS.filter(rung => rung < current - SAME).at(-1);
  return next ?? (direction === 1 ? ZOOM_MAX : ZOOM_MIN);
}

/**
 * Reads what was typed into the zoom field: "135", "135%" or " 135 % ", with an optional decimal part.
 * The result is clamped to the supported range and rounded to a whole percent. Anything else, and zero,
 * is undefined, so the field can revert.
 */
export function parseZoomInput(text: string): number | undefined {
  const match = /^\s*(\d+(?:\.\d+)?)\s*%?\s*$/.exec(text);
  if (!match) return undefined;
  const percent = Number(match[1]);
  return percent > 0 ? roundZoom(clampZoom(percent / 100)) : undefined;
}

/**
 * The factor one wheel event applies. A trackpad pinch arrives as many small ctrl+wheel deltas and is followed
 * closely; a mouse wheel notch (about 100) is capped so it is a firm step, not a jump.
 */
export function wheelFactor(deltaY: number, deltaMode = 0): number {
  const pixels = deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? 100 : 1);
  return Math.exp(-Math.max(-40, Math.min(40, pixels)) * .01);
}

/** A preview of a zoom in progress: the page drawn at `scale` of its committed size, `x`/`y` from where it was laid out. */
export type Pose = { scale: number; x: number; y: number };
export type Point = { x: number; y: number };

/**
 * The pose after scaling by `factor` about `at`, a point given from the page's laid-out top-left corner and
 * held still on screen. The scale stays within `min`–`max` (of the committed size); a factor that would leave
 * it is shortened.
 */
export function zoomAbout(pose: Pose, factor: number, at: Point, min: number, max: number): Pose {
  const scale = Math.max(min, Math.min(max, pose.scale * factor)), ratio = scale / pose.scale;
  return { scale, x: at.x - ratio * (at.x - pose.x), y: at.y - ratio * (at.y - pose.y) };
}

/** Where on a page of `size` (laid out) the point `at` is drawn under `pose`, as a fraction of the page on each axis. */
export function pageFraction(pose: Pose, at: Point, size: { width: number; height: number }): Point {
  return { x: (at.x - pose.x) / (pose.scale * size.width), y: (at.y - pose.y) / (pose.scale * size.height) };
}

/**
 * The scroll offset that puts page fraction `fraction` under the pointer at `pointer` (from the scroller's
 * edge) when the page, now `size`, starts `origin` from the scroll content's edge. Callers clamp it.
 */
export function scrollToHold(origin: number, fraction: number, size: number, pointer: number): number {
  return origin + fraction * size - pointer;
}
