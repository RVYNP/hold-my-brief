// The art of Home's background: the window glow of the theme (two soft lights, one high and right of centre, one low in the
// right corner) dithered with an 8 x 8 Bayer matrix, with a procedural cover's texture folded in. Pure (no DOM, no canvas):
// `renderBanner` returns a palette-indexed grid in the shape of `renderCover`'s; home.ts paints it over the whole window.
import { bayer8, renderCover, seedFrom, type Cover } from './procedural-cover';
import type { Rgb } from './theme';

/** CSS px per dither pixel: the covers' pixel size. */
export const bannerPixel = 2;
/** The art is drawn for a width rounded up to this many CSS px, so a window resized a little reuses the picture. */
export const bannerBucket = 32;
/** How much a texture pixel adds to the glow before the threshold. */
const inkWeight = .12;

export interface BannerSpec {
  seed: number;
  /** A cover family (the Appearance's BACKGROUND choice, except none); another name lets the seed pick one. */
  family: string;
  /** Size in dither pixels. */
  width: number;
  height: number;
  /** The window's surface (the weaker first tone mixes from it), and the two hues of `--grad-a` / `--grad-b`, all opaque. */
  ground: Rgb;
  a: Rgb;
  b: Rgb;
  /** 0 to 1: how far the palette moves from the ground toward the hues. */
  strength: number;
}

const mix = (ground: Rgb, hue: Rgb, share: number): Rgb => ground.map((channel, index) => Math.round(channel + (hue[index] - channel) * share)) as Rgb;

/** The four tones, ground first: a weaker and a full first light, and the second light. */
export function bannerPalette(ground: Rgb, a: Rgb, b: Rgb, strength: number): Rgb[] {
  return [ground, mix(ground, a, strength * .55), mix(ground, a, strength), mix(ground, b, strength)];
}

/**
 * One banner's pixels. Same spec, same grid. Tone 3 is the second light at its core, 2 the first light, 1 the haze
 * where the two overlap, 0 the ground; each pixel takes the highest tone whose light, plus the texture, beats the Bayer threshold.
 */
export function renderBanner(spec: BannerSpec): Cover {
  const { seed, family, width, height, ground, a, b, strength } = spec;
  const texture = renderCover({ seed, family, tones: 2, hue: 0, scheme: 'light', width, height });
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = y * width + x, t = bayer8(x, y), ink = texture.pixels[index] ? inkWeight : 0;
    const fa = Math.max(0, 1 - Math.hypot((x / width - .62) / .7, (y / height + .08) / .55));
    const fb = Math.max(0, 1 - Math.hypot((x / width - .95) / .65, (y / height - 1) / .6));
    pixels[index] = fb + ink > t ? 3 : fa + ink > t ? 2 : (fa + fb) * .6 + ink > t ? 1 : 0;
  }
  return { width, height, pixels, palette: bannerPalette(ground, a, b, strength), family: texture.family };
}

/** The grid for a picture of this CSS size: one dither pixel per `bannerPixel`, the width rounded up to the bucket. */
export function bannerGrid(cssWidth: number, cssHeight: number): { width: number; height: number } {
  return { width: Math.max(1, Math.ceil(cssWidth / bannerBucket) * bannerBucket / bannerPixel), height: Math.max(1, Math.round(cssHeight / bannerPixel)) };
}

/** What Home keeps between runs: the seed on show and the local day it was set. */
export type BannerSeed = { day: string; seed: number };

/** The local calendar day, `2026-11-15`. */
export function localDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** The kept seed while it is from today; on a new day (or none, or garbage) the day's own seed. */
export function seedFor(saved: unknown, today: string): BannerSeed {
  const kept = saved as Partial<BannerSeed> | null;
  if (kept && typeof kept === 'object' && kept.day === today && typeof kept.seed === 'number' && Number.isInteger(kept.seed) && kept.seed >= 0 && kept.seed < 2 ** 32) return { day: today, seed: kept.seed };
  return { day: today, seed: seedFrom(today) };
}
