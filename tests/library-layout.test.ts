import { describe, expect, it } from 'vitest';
import { assignMasonry, clampLibraryWidth, defaultLibraryView, libraryGrid, libraryGridColumns, libraryWidthBounds, parseLibraryView, parseLibraryWidth } from '../src/library-layout';

// Bounds for the floating drawer's width: the drawer overlays the page, but these limits still
// guarantee the reading panel keeps a usable strip of page visible.
describe('library drawer width', () => {
  it('caps at 520 px, then 55% of the window, then a 320 px reading panel', () => {
    expect(libraryWidthBounds(1400)).toEqual({ min: 240, max: 520 });
    expect(libraryWidthBounds(800)).toEqual({ min: 240, max: 440 });
    // At the 720 px breakpoint the reading-panel floor (720 - 22 - 320) is tighter than 55%.
    expect(libraryWidthBounds(720)).toEqual({ min: 240, max: 378 });
  });

  it('never lets the maximum fall below the minimum in a window narrower than both limits', () => {
    expect(libraryWidthBounds(500)).toEqual({ min: 240, max: 240 });
    expect(clampLibraryWidth(400, 500)).toBe(240);
  });

  it('clamps, rounds, and falls back to the default for unreadable saved widths', () => {
    expect(clampLibraryWidth(100, 1080)).toBe(240);
    expect(clampLibraryWidth(900, 1080)).toBe(520);
    expect(clampLibraryWidth(300.6, 1080)).toBe(301);
    expect(clampLibraryWidth(Number.NaN, 1080)).toBe(270);
    for (const saved of [null, '', 'wide', '-5', 'Infinity']) expect(parseLibraryWidth(saved)).toBe(270);
    expect(parseLibraryWidth('340')).toBe(340);
  });
});

describe('library grid columns', () => {
  it('adds a column exactly when another minimum-width tile and its gap fit', () => {
    const { minTile, gap } = libraryGrid;
    const need = (columns: number) => columns * minTile + (columns - 1) * gap;
    for (const columns of [2, 3, 4, 5, 6]) {
      expect(libraryGridColumns(need(columns))).toBe(columns);
      expect(libraryGridColumns(need(columns) - 1)).toBe(columns - 1 < 2 ? 2 : columns - 1);
    }
  });

  it('shows the designed column counts at the drawer widths users actually have', () => {
    // Content box = drawer width minus the panel's 8 px side padding.
    expect(libraryGridColumns(240 - 16)).toBe(2);
    expect(libraryGridColumns(270 - 16)).toBe(2);
    expect(libraryGridColumns(306 - 16)).toBe(2); // compact sheet
    expect(libraryGridColumns(480 - 16)).toBe(3);
    expect(libraryGridColumns(520 - 16)).toBe(4);
  });

  it('keeps two columns down to the narrowest tile and one below it or for unusable widths', () => {
    expect(libraryGridColumns(2 * libraryGrid.minColumnWidth + libraryGrid.gap)).toBe(2);
    expect(libraryGridColumns(2 * libraryGrid.minColumnWidth + libraryGrid.gap - 1)).toBe(1);
    for (const width of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) expect(libraryGridColumns(width)).toBe(1);
  });
});

describe('library masonry', () => {
  it('puts every tile in exactly one column, in ascending order within it', () => {
    const heights = [1.2, 0.6, 1.5, 0.8, 1, 1, 0.5, 2, 0.7];
    const columns = assignMasonry(heights, 3);
    expect(columns.flat().sort((a, b) => a - b)).toEqual(heights.map((_, index) => index));
    for (const column of columns) expect(column).toEqual([...column].sort((a, b) => a - b));
  });

  it('sends the next tile to the shortest column and breaks ties to the left', () => {
    // After 0..2 the columns stand at 3, 1, 2: tile 3 must go under the short middle column,
    // then the columns are 3, 2, 2 and the tie between the middle and right column goes left.
    expect(assignMasonry([3, 1, 2, 1, 1], 3)).toEqual([[0], [1, 3, 4], [2]]);
    // With equal heights the layout degenerates to plain row-major order.
    expect(assignMasonry([1, 1, 1, 1, 1, 1, 1], 3)).toEqual([[0, 3, 6], [1, 4], [2, 5]]);
  });

  it('balances a tall column against many short ones', () => {
    const columns = assignMasonry([5, 1, 1, 1, 1, 1], 2);
    expect(columns).toEqual([[0], [1, 2, 3, 4, 5]]);
  });

  it('accounts for the gap between stacked tiles', () => {
    // Without a gap three 0.4 tiles stack to 1.2 beside a single 1.0 tile, so all three share the
    // right column; each stacked tile also costs its gap, so with a 0.5 gap the right column is
    // already taller (1.8) than the left (1.5) when the last tile arrives and it moves left.
    expect(assignMasonry([1, 0.4, 0.4, 0.4], 2, 0)).toEqual([[0], [1, 2, 3]]);
    expect(assignMasonry([1, 0.4, 0.4, 0.4], 2, 0.5)).toEqual([[0, 3], [1, 2]]);
  });

  it('survives zero tiles, more columns than tiles, and unusable column counts', () => {
    expect(assignMasonry([], 3)).toEqual([[], [], []]);
    expect(assignMasonry([1, 1], 4)).toEqual([[0], [1], [], []]);
    for (const columns of [0, -2, Number.NaN]) expect(assignMasonry([1, 2, 3], columns)).toEqual([[0, 1, 2]]);
    expect(assignMasonry([1, 1, 1], 2.9)).toEqual([[0, 2], [1]]);
  });

  it('treats unusable heights as the default tile so they never poison the column totals', () => {
    const fallback = 1 / libraryGrid.defaultRatio;
    expect(assignMasonry([Number.NaN, 0, -1, Number.POSITIVE_INFINITY], 2)).toEqual(assignMasonry([fallback, fallback, fallback, fallback], 2));
  });
});

describe('library view mode', () => {
  it('defaults to grid when at least half of the matches have thumbnails', () => {
    expect(defaultLibraryView(5, 10)).toBe('grid');
    expect(defaultLibraryView(4, 10)).toBe('list');
    expect(defaultLibraryView(1, 1)).toBe('grid');
    expect(defaultLibraryView(0, 0)).toBe('list');
  });

  it('accepts only the two saved values', () => {
    expect(parseLibraryView('grid')).toBe('grid');
    expect(parseLibraryView('list')).toBe('list');
    for (const saved of [null, '', 'GRID', 'masonry']) expect(parseLibraryView(saved)).toBeUndefined();
  });
});
