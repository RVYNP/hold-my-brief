// The art on a generated cover: a motif drawn as a grayscale field, then ordered-dithered to two states.
// Pure (no canvas, no DOM): `ditherGrid` says which pixels carry ink, `artInk` says in what colour.

export const motifs = ['diagonal', 'sun', 'bands', 'rings', 'wave', 'corner'] as const;
export type Motif = typeof motifs[number] | 'neutral';

/** Size of the art in dither pixels; the art box on a cover keeps this proportion (56% of a 3:4 cover's height). */
export const artSize = { width: 48, height: 36 } as const;

/** The motif of a collection, from its id hash; a document with no collection gets the neutral one. Reads different bits than the hue does (`hash % 360`). */
export function motifFor(hash: number | undefined): Motif {
  return hash === undefined ? 'neutral' : motifs[(hash >>> 9) % motifs.length];
}

const clamp = (value: number) => Math.min(1, Math.max(0, value));
const smooth = (value: number) => { const t = clamp(value); return t * t * (3 - 2 * t); };

/**
 * Ink density (0 = none, 1 = solid) of `motif` at `x`, `y` in [0, 1] across the art box, whose width over
 * height is `aspect`, so circles stay round.
 */
export function motifField(motif: Motif, x: number, y: number, aspect: number): number {
  const ax = x * aspect;
  switch (motif) {
    case 'diagonal': return smooth((((ax * .7 + y) * 2.4) % 1) * 1.5 - .25) * (.3 + .7 * (1 - x * .8));
    case 'sun': { const distance = Math.hypot(ax - .62 * aspect, y - .48); return Math.max(smooth((.4 - distance) / .12), .22 * smooth(1.1 - distance / .6)); }
    case 'bands': return smooth(((y * 4.2 + x * .35) % 1) * 1.15 - .1) * (.35 + .65 * (1 - y * .5));
    case 'rings': return (.5 + .5 * Math.cos(Math.hypot(ax - .45 * aspect, y - .55) * Math.PI * 7)) * smooth(1.25 - Math.hypot(ax - .45 * aspect, y - .55) * 1.05);
    case 'wave': return smooth(y * 1.25 - .15 + .2 * Math.sin(x * Math.PI * 3 + .6));
    case 'corner': return smooth(1 - Math.hypot(ax, 1 - y) / (Math.hypot(aspect, 1) * .62));
    case 'neutral': return smooth(y * .9);
  }
}

/** Threshold in (0, 1) of an 8 x 8 Bayer matrix at pixel `x`, `y`. */
export function bayer(x: number, y: number): number {
  // Level 0 (the lowest coordinate bit) is the most significant pair of the result: (x ^ y, y).
  let value = 0;
  for (let level = 0; level < 3; level++) value |= (((x ^ y) >> level & 1) << (5 - 2 * level)) | ((y >> level & 1) << (4 - 2 * level));
  return (value + .5) / 64;
}

/** Row-major grid, 1 where the pixel carries ink. Same motif and size give the same grid. */
export function ditherGrid(motif: Motif, width: number = artSize.width, height: number = artSize.height): Uint8Array {
  const grid = new Uint8Array(width * height), aspect = width / height;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) grid[y * width + x] = motifField(motif, (x + .5) / width, (y + .5) / height, aspect) > bayer(x, y) ? 1 : 0;
  return grid;
}

/** Colours (OKLCH) of a cover's plain tint and of the art's ink on it. The two are close in lightness: the art is a texture, never a figure. */
export const artTone = {
  light: { ink: { lightness: .79, chroma: .055 }, neutral: { rgb: 0x000000, alpha: .2 } },
  dark: { ink: { lightness: .42, chroma: .055 }, neutral: { rgb: 0xffffff, alpha: .18 } },
} as const;
