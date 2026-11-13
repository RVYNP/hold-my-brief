/**
 * Zoom arithmetic for page-based documents, kept free of the DOM so it can be tested.
 *
 * A zoom is a true scale: 1 (100 %) is the document at its own size, as each format defines it (a PDF page at its
 * physical size at CSS resolution, an image at one image pixel per CSS pixel, a fixed-layout book at its declared
 * viewport). Fit page and fit width are modes that follow the window rather than levels; while one is in force the
 * adapter reports the scale it ends up drawing, and that is the level shown. The buttons, the menu and Ctrl + / Ctrl −
 * move along a ladder; Ctrl + wheel and trackpad pinch move continuously, then settle on a whole percent.
 */
export const ZOOM_MIN = .1;
export const ZOOM_MAX = 8;
/** What zoom in and zoom out snap to, from the current level. */
export const ZOOM_STEPS: readonly number[] = [.1, .25, .33, .5, .67, .75, .9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 6, 8];
/** The presets under Actual size in the zoom menu. */
export const ZOOM_PRESETS: readonly number[] = [.5, 2];
/** Version of what `ReaderOptions.zoom` means. Saved options without it hold the old fit-relative multiplier (see `migrateLegacyZoom`). */
export const ZOOM_MODEL = 2;
/** Two values closer than this are the same zoom (half a percent). */
const SAME = .005;

/** The zoom a document can be drawn at; an adapter narrows it to what the page on screen can take. */
export type ZoomLimits = { min: number; max: number };
export const DEFAULT_LIMITS: ZoomLimits = { min: ZOOM_MIN, max: ZOOM_MAX };

export const clampZoom = (zoom: number, limits: ZoomLimits = DEFAULT_LIMITS) => Math.max(limits.min, Math.min(limits.max, Number.isFinite(zoom) ? zoom : 1));
/** A zoom as the whole percentage the interface shows. */
export const zoomPercent = (zoom: number) => Math.round(zoom * 100);
/** A zoom rounded to a whole percent, so what is stored is what is shown, and never outside `limits`. */
export const roundZoom = (zoom: number, limits: ZoomLimits = DEFAULT_LIMITS) =>
  Math.max(Math.min(zoomPercent(zoom) / 100, Math.floor(limits.max * 100) / 100), Math.min(Math.ceil(limits.min * 100) / 100, limits.max));

/** The next rung above (`direction` 1) or below (-1) `current` inside `limits`; the limit itself when the ladder has no rung left. */
export function stepZoom(current: number, direction: 1 | -1, limits: ZoomLimits = DEFAULT_LIMITS): number {
  const next = direction === 1
    ? ZOOM_STEPS.find(rung => rung > current + SAME && rung <= limits.max + SAME)
    : ZOOM_STEPS.filter(rung => rung < current - SAME && rung >= limits.min - SAME && rung <= limits.max + SAME).at(-1);
  return next ?? roundZoom(direction === 1 ? limits.max : limits.min, limits);
}

/**
 * Reads what was typed into the zoom field: "135", "135%" or " 135 % ", with an optional decimal part.
 * The result is clamped to `limits` and rounded to a whole percent. Anything else, and zero, is undefined,
 * so the field can revert.
 */
export function parseZoomInput(text: string, limits: ZoomLimits = DEFAULT_LIMITS): number | undefined {
  const match = /^\s*(\d+(?:\.\d+)?)\s*%?\s*$/.exec(text);
  if (!match) return undefined;
  const percent = Number(match[1]);
  return percent > 0 ? roundZoom(clampZoom(percent / 100, limits), limits) : undefined;
}

/** What a document's saved view means for the new zoom: a fit that follows the window, or a true scale. */
export type ZoomState = { fit: 'page' | 'width'; fitted: boolean; zoom: number };

/**
 * Converts a zoom saved under the old meaning, a multiplier of the fit (1 = the fit itself), so the document
 * opens at the size it was left at. A multiplier of 1 was the fit, so it stays a fit. Any other is turned into a true
 * scale with `base`, what a multiplier of 1 came to for this document in its own units (see `legacyZoomBase`); the
 * result is not rounded, so the page keeps its size exactly. Without a base, or for a value that is not a number,
 * the document keeps its fit rather than guessing.
 */
export function migrateLegacyZoom(saved: { fit: 'page' | 'width'; zoom: number }, base: number | undefined, limits: ZoomLimits = DEFAULT_LIMITS): ZoomState {
  const { fit, zoom } = saved;
  if (!Number.isFinite(zoom) || zoom <= 0 || Math.abs(zoom - 1) < SAME || base === undefined || !Number.isFinite(base) || base <= 0) return { fit, fitted: true, zoom: 1 };
  return { fit, fitted: false, zoom: clampZoom(base * zoom, limits) };
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
