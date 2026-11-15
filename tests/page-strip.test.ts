import { describe, expect, it } from 'vitest';
import { BitmapCache } from '../src/page-strip';

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

  it('evicts the unheld first, then look-ahead, and what is shown last', () => {
    const cache = new BitmapCache(3 * MB);
    for (const key of 'abc') cache.set(key, bitmap(1)); // a is the least recently used.
    cache.hold(new Set(['a']), new Set(['b']));
    cache.set('d', bitmap(1)); cache.set('e', bitmap(1)); // c goes, then d: the oldest bitmaps nobody holds.
    cache.hold(new Set(['a', 'e']), new Set(['b']));
    cache.set('f', bitmap(1)); // Nothing unheld is left: the look-ahead b goes before the shown a.
    expect(['a', 'b', 'e', 'f'].map(key => cache.get(key) !== undefined)).toEqual([true, false, true, true]);
    cache.hold(new Set(['a', 'e', 'f']));
    cache.set('g', bitmap(1)); // Only now does a shown bitmap go, the least recently used of them.
    expect(['a', 'e', 'f', 'g'].map(key => cache.get(key) !== undefined)).toEqual([false, true, true, true]);
  });

  it('refuses look-ahead rather than evict what is shown or looked ahead to, and stores it over what is stale', () => {
    const cache = new BitmapCache(4 * MB);
    for (const key of 'abcd') cache.set(key, bitmap(1));
    cache.hold(new Set(['a', 'b']), new Set(['c']));
    // Only d is unheld: one look-ahead bitmap replaces it, and a second finds nothing it may replace.
    expect(cache.fits(bitmap(1), 0)).toBe(true);
    expect(cache.set('e', bitmap(1), 0)).toBe(true);
    cache.hold(new Set(['a', 'b']), new Set(['c', 'e']));
    expect(cache.fits(bitmap(1), 0)).toBe(false);
    expect(cache.set('f', bitmap(1), 0)).toBe(false);
    expect(['a', 'b', 'c', 'e'].map(key => cache.get(key) !== undefined)).toEqual([true, true, true, true]);
    expect(['d', 'f'].map(key => cache.get(key) !== undefined)).toEqual([false, false]);
    expect(cache.bytes).toBe(4 * MB);
  });

  it('lets a shown bitmap take the room of look-ahead when the budget cannot hold both', () => {
    const cache = new BitmapCache(2 * MB);
    cache.set('a', bitmap(1)); cache.set('b', bitmap(1));
    cache.hold(new Set(['c']), new Set(['a', 'b']));
    expect(cache.set('c', bitmap(1))).toBe(true);
    expect(['a', 'b', 'c'].map(key => cache.get(key) !== undefined)).toEqual([false, true, true]);
  });
});
