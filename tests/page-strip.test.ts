import { describe, expect, it } from 'vitest';
import { BitmapCache, nextPages, PREVIEW_PAGES, PREVIEW_SPREADS } from '../src/page-strip';
import { spreadPages } from '../src/spread';

describe('which pages the strip lists', () => {
  it('lists the next three pages in single-page view', () => {
    expect(nextPages([1], 27, false, true)).toEqual([[2], [3], [4]]);
    expect(nextPages([10], 27, false, false)).toEqual([[11], [12], [13]]);
  });

  it('lists fewer pages, then none, as the document ends', () => {
    expect(nextPages([24], 27, false, true)).toEqual([[25], [26], [27]]);
    expect(nextPages([25], 27, false, true)).toEqual([[26], [27]]);
    expect(nextPages([26], 27, false, true)).toEqual([[27]]);
    expect(nextPages([27], 27, false, true)).toEqual([]);
  });

  it('lists the next two spreads in two-page view, leaving the cover alone', () => {
    expect(nextPages([1], 27, true, true)).toEqual([[2, 3], [4, 5]]);
    expect(nextPages([2, 3], 27, true, true)).toEqual([[4, 5], [6, 7]]);
  });

  it('pairs from the first page when the cover rule is off', () => {
    expect(nextPages([1, 2], 27, true, false)).toEqual([[3, 4], [5, 6]]);
    expect(nextPages([5, 6], 27, true, false)).toEqual([[7, 8], [9, 10]]);
  });

  it('ends two-page view on a lone last page, or on nothing', () => {
    // 8 pages with a cover: 1 | 2–3 | 4–5 | 6–7 | 8
    expect(nextPages([4, 5], 8, true, true)).toEqual([[6, 7], [8]]);
    expect(nextPages([6, 7], 8, true, true)).toEqual([[8]]);
    expect(nextPages([8], 8, true, true)).toEqual([]);
    // 7 pages without a cover: 1–2 | 3–4 | 5–6 | 7
    expect(nextPages([3, 4], 7, true, false)).toEqual([[5, 6], [7]]);
    expect(nextPages([5, 6], 7, true, false)).toEqual([[7]]);
    expect(nextPages([7], 7, true, false)).toEqual([]);
  });

  it('has nothing to list in a one-page or empty document', () => {
    expect(nextPages([1], 1, false, true)).toEqual([]);
    expect(nextPages([1], 1, true, true)).toEqual([]);
    expect(nextPages([1], 0, false, true)).toEqual([]);
  });

  it('always continues exactly where a page turn would, whatever is on screen', () => {
    for (const count of [1, 2, 3, 4, 7, 8, 12]) for (const cover of [true, false]) for (const spread of [false, true]) {
      const views = new Set(Array.from({ length: count }, (_, index) => (spread ? spreadPages(index + 1, count, cover) : [index + 1]).join(',')));
      for (const view of views) {
        const shown = view.split(',').map(Number), last = shown.at(-1)!;
        const listed = nextPages(shown, count, spread, cover), pages = listed.flat();
        const later = [...views].filter(other => Number(other.split(',')[0]) > last).length;
        expect(listed.length, `${spread ? 'spread' : 'single'} ${view} of ${count}, cover ${cover}`).toBe(Math.min(later, spread ? PREVIEW_SPREADS : PREVIEW_PAGES));
        // Whatever is listed continues straight on from the page on screen, and its first button is what the next turn shows.
        expect(pages).toEqual(Array.from({ length: pages.length }, (_, offset) => last + 1 + offset));
        if (later) expect(listed[0]).toEqual(spread ? spreadPages(last + 1, count, cover) : [last + 1]);
      }
    }
  });
});

describe('thumbnail bitmap cache', () => {
  const MB = 1024 * 1024, bitmap = (megabytes: number) => ({ width: 512, height: 512 * megabytes });

  it('stays within its budget by dropping the oldest bitmaps', () => {
    const cache = new BitmapCache(4 * MB);
    for (const key of 'abcde') cache.set(key, bitmap(1));
    expect(cache.bytes).toBe(4 * MB);
    expect(cache.get('a')).toBeUndefined();
    expect(['b', 'c', 'd', 'e'].map(key => cache.get(key) !== undefined)).toEqual([true, true, true, true]);
  });

  it('counts a hit as a use, so what is being turned past stays', () => {
    const cache = new BitmapCache(4 * MB);
    for (const key of 'abcd') cache.set(key, bitmap(1));
    cache.get('a');
    cache.set('e', bitmap(1));
    expect(cache.get('a')).toBeDefined();
    expect(cache.get('b')).toBeUndefined();
  });

  it('does not count a replaced bitmap twice', () => {
    const cache = new BitmapCache(4 * MB);
    cache.set('a', bitmap(1)); cache.set('a', bitmap(2));
    expect(cache.bytes).toBe(2 * MB);
  });

  it('refuses a bitmap larger than the whole budget without evicting anything', () => {
    const cache = new BitmapCache(4 * MB);
    cache.set('a', bitmap(1)); cache.set('huge', bitmap(5));
    expect(cache.get('huge')).toBeUndefined();
    expect(cache.get('a')).toBeDefined();
    expect(cache.bytes).toBe(MB);
  });

  it('empties completely', () => {
    const cache = new BitmapCache(4 * MB);
    cache.set('a', bitmap(1)); cache.clear();
    expect(cache.bytes).toBe(0);
    expect(cache.get('a')).toBeUndefined();
  });
});
