// Placement of the movable view-controls pill. Pure so the clamping edges stay testable without a DOM.
// The position is stored as the pill's centre, as fractions of the reading panel, so a window
// resize keeps it proportionally placed; pixels are derived on every placement.

/** Gap kept between the pill and the reading panel's edges. */
export const pillMargin = 8;
/** Clearance kept below the pill: the footer's hover band, and the footer when it opens over the page. */
export const pillBottomClearance = 36;
/** Arrow-key nudge, and the Shift variant. */
export const pillStep = 16;
export const pillLargeStep = 64;

export interface Size { width: number; height: number }
/** Pill centre as fractions (0..1) of the reading panel. */
export interface Placement { x: number; y: number }
/** Pill top-left in pixels, relative to the reading panel's padding box. */
export interface Point { left: number; top: number }
/** Horizontal band, in reading-panel pixels, covered by something floating over the panel (the library drawer). */
export interface Band { left: number; right: number }

/** Clamps a top-left so the whole pill sits inside the panel with the margin, above the bottom clearance. */
export function clampPoint(point: Point, panel: Size, pill: Size): Point {
  // A panel too small for the pill pins it to the top-left margin rather than producing a negative range.
  const maxLeft = Math.max(pillMargin, panel.width - pill.width - pillMargin);
  const maxTop = Math.max(pillMargin, panel.height - pill.height - pillBottomClearance);
  return {
    left: Math.round(Math.min(maxLeft, Math.max(pillMargin, Number.isFinite(point.left) ? point.left : pillMargin))),
    top: Math.round(Math.min(maxTop, Math.max(pillMargin, Number.isFinite(point.top) ? point.top : pillMargin))),
  };
}

/** Moves a clamped point out from under a band by the shortest horizontal move that fits; unchanged when none fits. */
export function avoidBand(point: Point, panel: Size, pill: Size, band: Band | null): Point {
  if (!band || band.right <= band.left) return point;
  const overlaps = point.left < band.right + pillMargin && point.left + pill.width > band.left - pillMargin;
  if (!overlaps) return point;
  const maxLeft = panel.width - pill.width - pillMargin;
  const candidates = [band.left - pillMargin - pill.width, band.right + pillMargin].filter(left => left >= pillMargin && left <= maxLeft);
  if (!candidates.length) return point;
  const left = candidates.reduce((best, next) => Math.abs(next - point.left) < Math.abs(best - point.left) ? next : best);
  return { left: Math.round(left), top: point.top };
}

/** Pixel position for a stored placement: centre fractions → top-left, clamped inside the panel, clear of the band. */
export function resolvePlacement(placement: Placement, panel: Size, pill: Size, band: Band | null = null): Point {
  const raw = { left: placement.x * panel.width - pill.width / 2, top: placement.y * panel.height - pill.height / 2 };
  const clamped = clampPoint(raw, panel, pill);
  return clampPoint(avoidBand(clamped, panel, pill, band), panel, pill);
}

/** Pixel top-left → centre fractions, clamped to the panel. */
export function placementOf(point: Point, panel: Size, pill: Size): Placement {
  if (panel.width <= 0 || panel.height <= 0) return { x: .5, y: .5 };
  const unit = (value: number) => Math.min(1, Math.max(0, value));
  return { x: unit((point.left + pill.width / 2) / panel.width), y: unit((point.top + pill.height / 2) / panel.height) };
}

/** Parses the stored value; anything that is not two fractions in 0..1 means "no custom position". */
export function parsePlacement(saved: string | null): Placement | null {
  if (saved === null) return null;
  let value: unknown;
  try { value = JSON.parse(saved); } catch { return null; }
  if (typeof value !== 'object' || value === null) return null;
  const { x, y } = value as Record<string, unknown>;
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { x, y };
}

export function serialisePlacement(placement: Placement): string {
  return JSON.stringify({ x: Math.round(placement.x * 10000) / 10000, y: Math.round(placement.y * 10000) / 10000 });
}

/** Arrow key → offset in pixels, or null for any other key. */
export function nudgeFor(key: string, large: boolean): { dx: number; dy: number } | null {
  const step = large ? pillLargeStep : pillStep;
  switch (key) {
    case 'ArrowLeft': return { dx: -step, dy: 0 };
    case 'ArrowRight': return { dx: step, dy: 0 };
    case 'ArrowUp': return { dx: 0, dy: -step };
    case 'ArrowDown': return { dx: 0, dy: step };
    default: return null;
  }
}
