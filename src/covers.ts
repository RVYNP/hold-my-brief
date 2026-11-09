// Canvas side of the generated covers: paints a procedural cover once per (seed, hue, family, scheme) and keeps the PNG.
import { renderCover } from './procedural-cover';
import { coverStyle } from './shelf';

/** Art size in dither pixels; the art box of a cover keeps this 4:3 proportion (56% of a 3:4 cover's height). */
export const coverArtSize = { width: 64, height: 48 } as const;
/** Most covers kept as PNG data URLs; the least recently shown is dropped first. */
export const coverCacheSize = 400;

/** Stores `value` under `key` as the most recent entry of `cache` (a Map, whose insertion order is recency) and drops the oldest ones beyond `cap`. */
export function rememberRecent<K, V>(cache: Map<K, V>, key: K, value: V, cap: number): V {
  cache.delete(key); cache.set(key, value);
  while (cache.size > cap) cache.delete(cache.keys().next().value as K);
  return value;
}

const made = new Map<string, string>();

/**
 * The art of a cover as an opaque PNG data URL (its ground tone is the first palette colour, the same as the cover's
 * fill), shown with `image-rendering: pixelated`. `seed` is the book's (see `coverSeedOf`), `shelfId` the collection it
 * sits on: it sets the hue and, when the collection has a sibling slot, the pattern family; `undefined` is a book in no collection.
 */
export function coverArt(seed: number, shelfId: string | undefined, scheme: 'light' | 'dark'): string {
  const { hue, family } = coverStyle(seed, shelfId), key = `${seed}\n${hue}\n${family}\n${scheme}`;
  const hit = made.get(key); if (hit !== undefined) return rememberRecent(made, key, hit, coverCacheSize);
  const { width, height } = coverArtSize, cover = renderCover({ seed, hue, family, scheme, width, height });
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d'); if (!context) return '';
  const image = context.createImageData(width, height);
  cover.pixels.forEach((tone, index) => { const [r, g, b] = cover.palette[tone]; image.data.set([r, g, b, 255], index * 4); });
  context.putImageData(image, 0, 0);
  return rememberRecent(made, key, canvas.toDataURL('image/png'), coverCacheSize);
}
