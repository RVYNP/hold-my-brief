// Side-by-side library sizing. Pure so the clamping edges stay testable without a DOM.
export const libraryWidth = { default: 270, min: 240, max: 520, step: 16, largeStep: 64 } as const;
/** Handle hit area between the panel and the reading panel. */
export const libraryHandleWidth = 10;
const maxViewportShare = .55;
const minReadingWidth = 320;
// Outer 6 px margins on both sides of the reader layout plus the handle.
const layoutChrome = 6 + 6 + libraryHandleWidth;

export type LibrarySide = 'left' | 'right';

export function libraryWidthBounds(viewport: number): { min: number; max: number } {
  const max = Math.floor(Math.min(libraryWidth.max, viewport * maxViewportShare, viewport - layoutChrome - minReadingWidth));
  // A window too narrow for both limits keeps the panel usable; the compact overlay takes over below 720 px.
  return { min: libraryWidth.min, max: Math.max(libraryWidth.min, max) };
}

export function clampLibraryWidth(width: number, viewport: number): number {
  const { min, max } = libraryWidthBounds(viewport);
  return Math.round(Math.min(max, Math.max(min, Number.isFinite(width) ? width : libraryWidth.default)));
}

export function parseLibraryWidth(saved: string | null): number {
  const value = saved === null ? NaN : Number(saved);
  return Number.isFinite(value) && value > 0 ? value : libraryWidth.default;
}

// Thumbnail grid. Tiles keep their true proportions (masonry), so the only layout decisions are
// how many columns fit and which column each tile joins. Both are pure so the edges stay testable.
export const libraryGrid = { minTile: 120, gap: 4, defaultRatio: 4 / 5, minColumnWidth: 56 } as const;
export type LibraryView = 'grid' | 'list';

/**
 * Columns for a grid whose content box is `width` px wide: as many `minTile`-wide columns as fit,
 * but at least two whenever two tiles of `minColumnWidth` fit, so the narrowest drawer (240 px, a
 * ~224 px content box that holds two 120 px tiles only with a few px squeezed) still reads as a grid
 * rather than one huge column; and never fewer than one.
 */
export function libraryGridColumns(width: number): number {
  if (!Number.isFinite(width) || width <= 0) return 1;
  const fit = Math.floor((width + libraryGrid.gap) / (libraryGrid.minTile + libraryGrid.gap));
  const twoFit = width >= 2 * libraryGrid.minColumnWidth + libraryGrid.gap;
  return Math.max(twoFit ? 2 : 1, fit);
}

/**
 * Masonry placement. `heights` are tile heights in any consistent unit (height / width), in reading
 * order. Each tile joins the currently shortest column, the leftmost on ties, so reading order runs
 * across the top and then fills the gaps. `gap` is the spacing between stacked tiles in the same
 * unit. Returns, per column, the indices placed in it in ascending (stable) order. A height that is
 * not a positive finite number falls back to the default tile ratio, so one corrupt entry cannot
 * produce NaN column totals that attract or repel every later tile.
 */
export function assignMasonry(heights: readonly number[], columns: number, gap = 0): number[][] {
  const count = Math.max(1, Math.floor(Number.isFinite(columns) ? columns : 1));
  const result: number[][] = Array.from({ length: count }, () => []);
  const totals = new Array<number>(count).fill(0);
  heights.forEach((height, index) => {
    let shortest = 0;
    for (let column = 1; column < count; column++) if (totals[column] < totals[shortest]) shortest = column;
    result[shortest].push(index);
    totals[shortest] += (Number.isFinite(height) && height > 0 ? height : 1 / libraryGrid.defaultRatio) + gap;
  });
  return result;
}

export function parseLibraryView(saved: string | null): LibraryView | undefined {
  return saved === 'grid' || saved === 'list' ? saved : undefined;
}

/** Grid when at least half of the matching references can show a thumbnail; otherwise list. */
export function defaultLibraryView(withThumbnails: number, total: number): LibraryView {
  return total > 0 && withThumbnails * 2 >= total ? 'grid' : 'list';
}
