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
});
