// Canvas side of the generated covers: draws a motif's dithered grid once per (shelf, colour scheme) and keeps the PNG.
import { artSize, artTone, ditherGrid } from './dither';
import { coverInkRgb, coverMotif } from './shelf';

const made = new Map<string, string>();

/**
 * The art of a cover as a PNG data URL: only the ink pixels, on transparency, so the cover's own fill shows
 * through and the art needs no resizing beyond `image-rendering: pixelated`. `collectionId` undefined is the
 * neutral art of a document with no collection.
 */
export function coverArt(collectionId: string | undefined, scheme: 'light' | 'dark'): string {
  const key = `${collectionId ?? ''}\n${scheme}`;
  const hit = made.get(key); if (hit) return hit;
  const { width, height } = artSize, grid = ditherGrid(coverMotif(collectionId), width, height);
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d'); if (!context) return '';
  const image = context.createImageData(width, height);
  const rgb = collectionId === undefined ? artTone[scheme].neutral.rgb : coverInkRgb(collectionId, scheme);
  const alpha = collectionId === undefined ? Math.round(artTone[scheme].neutral.alpha * 255) : 255;
  for (let index = 0; index < grid.length; index++) if (grid[index]) image.data.set([rgb >> 16 & 255, rgb >> 8 & 255, rgb & 255, alpha], index * 4);
  context.putImageData(image, 0, 0);
  const url = canvas.toDataURL('image/png'); made.set(key, url); return url;
}
