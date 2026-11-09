// Procedural cover art: one seed makes one unique, calm texture. Pure (no DOM, no canvas): `renderCover` returns a
// palette-indexed pixel grid; the caller paints it. Deterministic: the same spec always gives the same pixels.
// A shelf picks one family; each book's seed varies that family's composition, so a shelf reads as a set.
import { oklchToRgb } from './colour';

/** In shelf-slot order: the first shelf draws `flow`, the second `arcs`, and so on. */
export const coverFamilies = ['flow', 'arcs', 'stripes', 'contours', 'truchet'] as const;
export type CoverFamily = typeof coverFamilies[number];
export const ditherMethods = ['bayer4', 'bayer8', 'blue', 'atkinson'] as const;
export type DitherMethod = typeof ditherMethods[number];

/** Share of pixels that carry ink (any tone above the ground) every cover is steered to: a texture, not a poster. */
export const inkCoverage = { low: .31, high: .37 } as const;

export interface CoverSpec {
  /** 32-bit seed (see `seedFrom`). */
  seed: number;
  /** Hue in degrees (OKLCH). */
  hue: number;
  scheme: 'light' | 'dark';
  /** Art size in dither pixels. */
  width: number;
  height: number;
  /** A `CoverFamily`; omitted or unknown, the seed picks one. */
  family?: string;
  /** Default `blue`. */
  dither?: DitherMethod;
  /** Number of tones, 2 or 3. Default 3. */
  tones?: 2 | 3;
}

export interface Cover {
  width: number;
  height: number;
  /** Row-major palette index per pixel; 0 is the ground tint, the last index is the strongest ink. */
  pixels: Uint8Array;
  /** 2 or 3 colours as [r, g, b], from the ground tint to the strongest ink. */
  palette: [number, number, number][];
  family: string;
}

/** 32-bit FNV-1a hash of a text, finished with a murmur-style avalanche so near titles give far seeds. */
export function seedFrom(text: string): number {
  let h = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) { h ^= text.charCodeAt(index); h = Math.imul(h, 0x01000193); }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
}

/** The family a seed picks when the caller names none. Reads high bits so it is independent of the family's own parameters. */
export function familyFor(seed: number): CoverFamily { return coverFamilies[(seed >>> 24) % coverFamilies.length]; }

// ---- randomness ---------------------------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = a + 0x6d2b79f5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

function hash2(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ seed;
  h = Math.imul(h ^ h >>> 15, 0x85ebca6b); h = Math.imul(h ^ h >>> 13, 0xc2b2ae35);
  return ((h ^ h >>> 16) >>> 0) / 4294967296;
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const smoothstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function vnoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), fx = fade(x - ix), fy = fade(y - iy);
  const a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed), c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

function fbm(x: number, y: number, seed: number, octaves: number): number {
  let sum = 0, amp = .5, norm = 0;
  for (let octave = 0; octave < octaves; octave++) { sum += amp * vnoise(x, y, seed + octave * 101); norm += amp; x = x * 2.03 + 17.1; y = y * 2.03 + 9.7; amp *= .5; }
  return sum / norm;
}

// ---- families -----------------------------------------------------------------------------------------------
// A field takes x in [0, aspect] and y in [0, 1] (both in units of the art's height, so circles stay round) and
// returns an ink density that need not be in [0, 1]: the renderer stretches it and bends it to the coverage.

type Field = (x: number, y: number) => number;
type Maker = (rng: () => number, seed: number, aspect: number) => Field;

const between = (rng: () => number, low: number, high: number) => low + (high - low) * rng();
const sign = (rng: () => number) => rng() < .5 ? -1 : 1;

const makers: Record<CoverFamily, Maker> = {
  // Combed streaks at any angle, swirled around one eddy placed anywhere on or just off the art.
  flow(rng, seed, aspect) {
    const angle = between(rng, 0, Math.PI), along = between(rng, .5, 1.2), across = between(rng, 6, 13), bend = between(rng, .2, .6), ox = between(rng, 0, 90), oy = between(rng, 0, 90);
    const eddyX = between(rng, -.1, aspect + .1), eddyY = between(rng, -.1, 1.1), swirl = between(rng, 1.6, 3.4) * sign(rng), reach = between(rng, .22, .5);
    const cos = Math.cos(angle), sin = Math.sin(angle);
    return (x, y) => {
      const dx = x - eddyX, dy = y - eddyY, turn = swirl * Math.exp(-(dx * dx + dy * dy) / (reach * reach)), tc = Math.cos(turn), ts = Math.sin(turn);
      const px = eddyX + dx * tc - dy * ts, py = eddyY + dx * ts + dy * tc;
      let a = px * cos + py * sin, c = -px * sin + py * cos;
      c += bend * 1.6 * (fbm(a * .9 + ox, c * .9 + oy, seed + 3, 2) - .5); a += bend * .4 * (fbm(a * .7 + oy, c * .7 + ox, seed + 5, 2) - .5);
      return fbm(a * along + ox, c * across + oy, seed, 3); // left unsaturated: the renderer's curve and threshold shape it, so no plateau pins the coverage
    };
  },
  // Concentric bands around a centre that sits in one of eight places in, around or off the art; the centre drifts ring by ring and each ring is only partly drawn.
  arcs(rng, seed, aspect) {
    const places = [[-.1, -.15], [.5, -.35], [1.1, -.15], [1.25, .5], [1.1, 1.15], [.5, 1.35], [-.1, 1.15], [.5, .5]], place = places[Math.floor(rng() * places.length)];
    const centreX = (place[0] + between(rng, -.12, .12)) * aspect, centreY = place[1] + between(rng, -.12, .12);
    const spacing = between(rng, .075, .15), drift = between(rng, .004, .02), direction = between(rng, 0, Math.PI * 2), half = between(rng, .32, .52) * spacing, count = 22;
    const driftX = Math.cos(direction) * drift, driftY = Math.sin(direction) * drift, tilt = between(rng, -1, 1);
    const phases = Array.from({ length: count }, () => between(rng, 0, Math.PI * 2)), reach = Array.from({ length: count }, () => between(rng, .25, 1)), weight = Array.from({ length: count }, (_, ring) => .45 + .55 * hash2(ring, 7, seed) + .25 * tilt * (ring / count - .5));
    return (x, y) => {
      let best = 0;
      for (let ring = 1; ring < count; ring++) {
        const cx = centreX + driftX * ring, cy = centreY + driftY * ring, dx = x - cx, dy = y - cy, d = Math.abs(Math.sqrt(dx * dx + dy * dy) - ring * spacing);
        if (d > half) continue;
        const mask = smoothstep(1 - reach[ring] * 2, 1 - reach[ring] * 2 + .5, Math.cos(Math.atan2(dy, dx) - phases[ring]));
        best = Math.max(best, (1 - smoothstep(half * .45, half, d)) * mask * weight[ring]);
      }
      return best + .12 * fbm(x * 1.5, y * 1.5, seed, 2);
    };
  },
  // Stripes: any angle (a third snap near horizontal or vertical), 3.5 to 11 stripes per height, a straight, bent or S-shaped run, optional grouping into
  // pairs or triples with wider gaps, optional thinning toward an edge or corner.
  stripes(rng, seed, aspect) {
    const snapped = rng() < .12, angle = snapped ? (rng() < .5 ? 0 : Math.PI / 2) + between(rng, -.14, .14) : between(rng, 0, Math.PI);
    const frequency = Math.exp(between(rng, Math.log(3.5), Math.log(11))), warp = between(rng, .04, .22), duty = between(rng, .22, .42), shape = rng(); // duty: the stripes alone must stay under the coverage target, or the scale phase flattens them to mid tone
    const bend = between(rng, .4, 1.6) * sign(rng), wave = between(rng, .08, .22) * sign(rng), waves = between(rng, .4, .9), wavePhase = between(rng, 0, Math.PI * 2);
    const group = rng() < .4 ? 2 + Math.floor(rng() * 2) : 1, gap = between(rng, 1, 1.7), faded = rng() < .55;
    const fadeAngle = between(rng, 0, Math.PI * 2), fadeShift = between(rng, -.25, .15), fadeReach = between(rng, .35, .7), ox = between(rng, 0, 90), oy = between(rng, 0, 90);
    const cos = Math.cos(angle), sin = Math.sin(angle), fadeX = Math.cos(fadeAngle), fadeY = Math.sin(fadeAngle), midX = aspect / 2, period = group + (group > 1 ? gap : 0);
    return (x, y) => {
      const px = x - midX, py = y - .5, u = px * cos + py * sin, w = -px * sin + py * cos;
      // lengthwise displacement of the stripes: none (a fifth), a slow bend (two fifths) or one gentle S (two fifths)
      const run = shape < .2 ? 0 : shape < .6 ? bend * w * w * .6 : wave * Math.sin(w * waves * Math.PI * 2 + wavePhase);
      let phase = (u + run + warp * 2 * (fbm(x * 1.2 + ox, y * 1.2 + oy, seed, 3) - .5)) * frequency, line = 1;
      if (group > 1) { phase = phase - Math.floor(phase / period) * period; if (phase >= group) line = 0; }
      const triangle = line ? Math.abs(phase - Math.floor(phase) - .5) * 2 : 1;
      const fade = faded ? .3 + .7 * smoothstep(-fadeReach, fadeReach, px * fadeX + py * fadeY + fadeShift) : 1;
      return Math.max((1 - smoothstep(duty - .18, duty + .18, triangle)) * fade, .3 * smoothstep(.4, .75, fbm(x * 1.3 + oy, y * 1.3 + ox, seed + 11, 2))); // patchy haze: a sparse cover (wide gaps, strong fade) can still reach the coverage
    };
  },
  // Warped value-noise terrain drawn as a few soft ramps, tilted so the levels run across the art in a direction of their own.
  contours(rng, seed) {
    const scale = between(rng, .8, 1.5), warp = between(rng, .1, .25), levels = between(rng, 3.5, 5.5), tilt = between(rng, .1, .6), tiltAngle = between(rng, 0, Math.PI * 2), ox = between(rng, 0, 90), oy = between(rng, 0, 90);
    const tiltX = Math.cos(tiltAngle) * tilt, tiltY = Math.sin(tiltAngle) * tilt;
    return (x, y) => {
      const qx = fbm(x * scale + ox, y * scale + oy, seed, 2), qy = fbm(x * scale + ox + 5.2, y * scale + oy + 1.3, seed + 7, 2);
      const t = (fbm(x * scale + ox + warp * 3 * (qx - .5), y * scale + oy + warp * 3 * (qy - .5), seed + 13, 3) + x * tiltX + y * tiltY) * levels;
      return t - Math.floor(t); // a plain sawtooth: a ramp with a flat top would pin the coverage
    };
  },
  // Tiles of quarter arcs and straight diagonals with blank cells between; cell size, mix and density all come from the seed.
  truchet(rng, seed) {
    const cells = between(rng, 2.8, 5.5), diagonals = between(rng, 0, .6), blanks = between(rng, 0, .3), width = between(rng, .09, .16), ox = between(rng, 0, 40), oy = between(rng, 0, 40), mood = between(rng, 0, 90);
    return (x, y) => {
      const u = x * cells + ox, v = y * cells + oy, ix = Math.floor(u), iy = Math.floor(v), fx = u - ix, fy = v - iy;
      const pick = hash2(ix, iy, seed), kind = hash2(ix, iy, seed + 1), flip = hash2(ix, iy, seed + 2) < .5;
      let line = 0;
      if (pick >= blanks) {
        const px = flip ? fx : 1 - fx;
        const d = kind < diagonals ? Math.abs(px - fy) * .7071 : Math.min(Math.abs(Math.sqrt(px * px + fy * fy) - .5), Math.abs(Math.sqrt((1 - px) * (1 - px) + (1 - fy) * (1 - fy)) - .5));
        line = 1 - smoothstep(width * .6, width, d);
      }
      return Math.max(line, .3 * smoothstep(.5, .75, fbm(x * 1.4 + mood, y * 1.4, seed + 1, 2)));
    };
  },
};

// ---- dithering ----------------------------------------------------------------------------------------------

const bayer4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

function bayer8(x: number, y: number): number {
  let value = 0;
  for (let level = 0; level < 3; level++) value |= (((x ^ y) >> level & 1) << (5 - 2 * level)) | ((y >> level & 1) << (4 - 2 * level));
  return (value + .5) / 64;
}

const blueSize = 32;
// Void-and-cluster blue noise on a 32 x 32 torus (sigma 1.5): the rank of every cell, 0 to 1023, as little-endian Uint16 in base64. Precomputed so the first cover pays nothing.
const blueRanks =
'EgMyAFUCQAM6AXsDBAF+AeUD2gCvAYkCVAPzAZgDCwM/AMkBpQBQArwC8APFAFEDvgIlATwD0AA5ArMCIQAWAoUC+QOHAdcAOwDGARsDzgImAK' +
  '4CkQNAAKIAkAE9AWsCEALhAkoBJAMCAUcAQAFAAsQBngD/AX8DMQEFA8ADUgFrAM4B1AKWA0cC2ANuACECYANkAUkCHgHCA6cCJADzA/cAgQMK' +
  'AKgD2wF8AugCwQMPAKIDgwI5AKcBkwDaAdMAiAMUAZIA9AFHAZ4CtwCsAQgBjwAuA7cB9QIrAkIDvwCkAZECLQK0AJUBQwOXAIUB/QAHA1oB4w' +
  'LuA2QCTAOsAiAC9AJjAwYAMwP4AP4CoQN5AvcDBQJaANkAaQF5AP4BYQNcAGgBygLiAycAGQJoA1gC6QHMAGkADgIMARUAjwFGAFgBaAKoAcoD' +
  'KQI4AO8BUAEcALYChwNtAtwDAwO1AgcByAMRAxoBTALfAE4BugJLAN4DNwOfApkDcAHNAtQDswCvA+0AtwKcAHoBjwJPA88A8AKAAQAB4QEMAE' +
  'EBuwFSAqAA5QE9AIADKAPMAZ4DqwCYAS8BxwGfACMD6ABZAq4BCgMLAk4AFwN5AzABfQC+A8gBSAOZAKICagPIALQDUgBTA8ACoQGbAnQAOwIW' +
  'Ae0CbgIHAGcDMQJWAOgBXwN1AJkCOwHxA+IB2ADXAg0CcAJXADMC0QNsARQCFQN9An8BKgIuAfYDwgBuAb8DLwBOAwACuAPzAJYC/gPgAiMBNg' +
  'JGAxQAiwFNAl4AowORAfsAJwM1ATUA6gKCACQBKACaA+YALQMDAAcCCQN/AsMBzQBhAbsCiwBDAZYBIgCQA18BowCdA88CEgGHAjEDCQDnA4sC' +
  'vQGgA2cCzQHVA6kC8AGOANkCXwKMAzcBhADSAusDZwA5A+wBDgNXAs4AzwH7Am8C4wDFAc4DmgBiAesBtgDiAn8A7ABlA1UBvAAyA5QBbQNgAW' +
  'AAtgHbAEsDHAIgAVECqgGnAzYAbAOrAt8DRQD5AR0DLABaAx4C6QJ9A0MCeAFJAyMCEQDbAlMCUwAwAv4AxgP4AbAC1gMgAJ0BjwNBAI4CwAAm' +
  'ARICjQAVAaUBbgMqAZ0CiAFUADYB6QAtAMkDHQGgAqkBpQMTAf8D7gIXAHQCnQApA28BggIWA+cA3wJrAdkD6wKBASwDSgLEAnAAxwPJAEsCDw' +
  'P0A3sCywK/AWMAHwOpAAICbwB5AdUBUANIAYUDCgFNACYCpADqAV0DOAJlAOQBegMNAKwDvQAsAnQB3wGcA4oAogH6AboAZAMVArMDZQH2AoID' +
  'jALUAIAAxgI0AsIB7AKXA0kB+AMaABEBwgKqAGwC9QBcAfsDJQOkAhAA1gL/AHIDSAACAywBcQLlADcAZgIrAUQDCQK7A4kBKwDhA+IAmAJ3AG' +
  'MCygEqA1EBywO1AQ0D/AFDACIBpgBSA0wBEwKUAm0B3QMCAJsB2gLTA6sBuQAfAN0CAQF3AjYDrwABAlcDnwHzAsMAqwOVAjEAWAN7AIYCywGO' +
  'A1YCuAHMA2EAKwPeADoCrQKLA5YA9wE0AzIC7AO5AVUAmwM/AcECcwEIAA4BiQNJAHwBCgLrAD8CPAHlAj4DhgEuAPwCxwBqAq0BsAOMAN0BSw' +
  'FKAw8BbACvAkYBIANcAvEBhQBFAhgDtwOBAtwBQgLmAogAeAOXAdcDuACcAu4A5gMuAikBgwMdAMwCCwEMA08ARAKSAncBfAPdAJAAggFZA/AA' +
  '8gNQAMABlABBA+EA7wMzASIDZQIEAAYCcgBXAcMC1gGRAKMCUwH2AWYDjgH1A8YAqgMOAOYB3gK6A4oCGwDvAmYBKAIfAbICYwEjAJACvgFMAL' +
  '0CEAGKA0ECsQNZAGkDnAEaA+MDhwB4AioAGgK/ArMBGQM9AlEAGAEbApMD0gGoAr4AhAP6As0DFwJWA60AuQPnAXEB+AKwAdwABANPAvwAQgAl' +
  'Au8A/QJZAXcDAwGDADIB0AOSATgDrgBCAXYAXgNpAjoA7gGBAPkAfQE8AgYD1QBbA5UAkwL1AR4ARAHDA4gCTQO6AbUDsgDTAfcCdQJwA8EAuQ' +
  'JiAu0DsQETAwYBtgOgATQBfgKpA8cCXwA5AXMCJQD6AyEBPQOUA9MC4AG7AHIBCwC4Al0CYgDaAzMAAwJdARgA8gFdAMUCSAIBAP0BsQABA2sD' +
  'EgDRAT8DxQMEAtUCgwFkADcCrACTAW0AdgMUAw8C9ABcAzgBNQKKAUcD5wKtAwUBYgPKAE0BRQO0Av0DIgJqAdIAWwIJAZ4BiQDkAIYDvAGxAg' +
  '0B6QNaAqYCGwF6APwDowEeA9EApQIXAXwAgAJ7Af8CLwLEA40BcwAZATwA0AI1A+ADRACqAm8DTgIAA64DAAAcAwgCPgBWAZ8DPgLcAjAA7QGk' +
  'A1sAdQPZAbUA2wPQASkAoQB6At4BjQNUArQBhgARAlQB8gLXATQATwHLAHYCZwFVA+oA8QLUAcQAdQGEAqgA5AJGApkBIQMnAkoAPgHRApUDCA' +
  'PgADoDRQGyA/oAlwKSA6cAHAHqAyQC2ALYAbwDcQCmAdIDEwAvA3EDKAG9A14BBQDoAy0BoQJ+A2AC8gAMAlsBFgCaApsA+QLjARkAJgPBAXIC' +
  'MAN+AHQDJwGwAMkCGAKNApgAXgL7AWYAEAMdAvEAyAJ4ANYAhAE7A88DagCyAXMDHwKMAVgA5ANhAnYBaACmA/YAmgE=';
let blueTable: Float32Array | undefined;

/** Thresholds in (0, 1) of the blue-noise table; every rank appears once. Decoded on first use (about 0.1 ms). */
function blue(): Float32Array {
  if (blueTable) return blueTable;
  const bytes = atob(blueRanks), table = new Float32Array(blueSize * blueSize);
  for (let index = 0; index < table.length; index++) table[index] = ((bytes.charCodeAt(index * 2) | bytes.charCodeAt(index * 2 + 1) << 8) + .5) / table.length;
  return blueTable = table;
}

function dither(values: Float32Array, width: number, height: number, tones: number, method: DitherMethod): Uint8Array {
  const out = new Uint8Array(width * height), top = tones - 1;
  if (method === 'atkinson') {
    const buffer = Float32Array.from(values);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const index = y * width + x, old = buffer[index], level = Math.min(top, Math.max(0, Math.round(old * top)));
      out[index] = level;
      const share = (old - level / top) / 8;
      if (x + 1 < width) buffer[index + 1] += share;
      if (x + 2 < width) buffer[index + 2] += share;
      if (y + 1 < height) { if (x > 0) buffer[index + width - 1] += share; buffer[index + width] += share; if (x + 1 < width) buffer[index + width + 1] += share; }
      if (y + 2 < height) buffer[index + 2 * width] += share;
    }
    return out;
  }
  const table = method === 'blue' ? blue() : undefined;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = y * width + x, target = Math.min(1, Math.max(0, values[index])) * top, base = Math.min(top - 1, Math.floor(target));
    const threshold = table ? table[(y % blueSize) * blueSize + x % blueSize] : method === 'bayer4' ? (bayer4[(y & 3) * 4 + (x & 3)] + .5) / 16 : bayer8(x, y);
    out[index] = base + (target - base > threshold ? 1 : 0);
  }
  return out;
}

// ---- colour -------------------------------------------------------------------------------------------------

// Tones stay close (about 1.15:1 to 1.45:1 between neighbours) so the art is a texture, never a figure.
const tonesOf = {
  light: { lightness: [.93, .875, .82], chroma: [.03, .04, .05] },
  dark: { lightness: [.30, .36, .42], chroma: [.03, .04, .05] },
} as const;

/** The tones of a hue: ground first, strongest ink last. */
export function coverPalette(hue: number, scheme: 'light' | 'dark', tones: 2 | 3 = 3): [number, number, number][] {
  const { lightness, chroma } = tonesOf[scheme], pick = tones === 3 ? [0, 1, 2] : [0, 2];
  return pick.map(index => { const rgb = oklchToRgb(lightness[index], chroma[index], hue); return [rgb >> 16 & 255, rgb >> 8 & 255, rgb & 255] as [number, number, number]; });
}

// ---- render -------------------------------------------------------------------------------------------------

/** Share of pixels above the ground tone. */
function coverage(pixels: Uint8Array): number {
  let ink = 0;
  for (let index = 0; index < pixels.length; index++) if (pixels[index]) ink++;
  return ink / pixels.length;
}

/**
 * One cover's art. Same spec, same pixels. The field is stretched to [0, 1] and raised to the power that
 * lands the ink coverage on a target inside `inkCoverage`, so a sparse family and a dense one weigh the same on a shelf.
 */
export function renderCover(spec: CoverSpec): Cover {
  const { seed, width, height } = spec, tones = spec.tones ?? 3, method = spec.dither ?? 'blue';
  const family = (coverFamilies as readonly string[]).includes(spec.family ?? '') ? spec.family as CoverFamily : familyFor(seed);
  const salt = coverFamilies.indexOf(family) * 0x9e3779b1;
  const rng = mulberry32((seed ^ salt) >>> 0), aspect = width / height;
  const field = makers[family](rng, (seed ^ salt) | 0, aspect), target = between(rng, inkCoverage.low + .01, inkCoverage.high - .01);
  const linear = new Float32Array(width * height);
  let low = Infinity, high = -Infinity;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const v = field((x + .5) / width * aspect, (y + .5) / height); linear[y * width + x] = v;
    if (v < low) low = v; if (v > high) high = v;
  }
  const range = high - low > 1e-6 ? high - low : 1;
  // Stretch to [0, 1]. The S-curved copy has fewer pixels in the thin-dust densities, so shapes read as shapes and the dither stays on their edges;
  // both copies are clamped, since the float32 store can leave [low, high] by a hair.
  const curved = new Float32Array(linear.length);
  for (let index = 0; index < linear.length; index++) { const unit = (linear[index] - low) / range; linear[index] = Math.min(1, Math.max(0, unit)); curved[index] = smoothstep(.08, .92, unit); }
  // Bisect one knob q in [0, 1]; more q, less ink, in three phases: a power below 1 up to 1 (a thin field gains ink), then a threshold that
  // drops the weak values and keeps the strong ones crisp, then a scale for fields whose strongest values alone are too many. Keep the closest try.
  // A field the S-curve leaves too bare to reach the target even at q = 0 (thin lines on nothing) keeps its linear stretch.
  const shaped = new Float32Array(linear.length), shape = (values: Float32Array, q: number) => {
    const power = q < 1 / 3 ? Math.exp(Math.log(.12) * (1 - q * 3)) : 1, cut = .85 * Math.min(1, Math.max(0, q * 3 - 1)), scale = 1 - .75 * Math.max(0, q * 3 - 2);
    for (let index = 0; index < values.length; index++) shaped[index] = scale * (Math.max(0, values[index] - cut) / (1 - cut)) ** power;
    return dither(shaped, width, height, tones, method);
  };
  const probe = shape(curved, 0), values = coverage(probe) > target + .03 ? curved : linear;
  let lo = 0, hi = 1, pixels = probe, miss = Infinity;
  for (let step = 0; step < 10 && miss > .005; step++) { // .005 is well inside the band's +-.03
    const q = (lo + hi) / 2, tried = shape(values, q), ink = coverage(tried);
    if (Math.abs(ink - target) < miss) { miss = Math.abs(ink - target); pixels = tried; }
    if (ink > target) lo = q; else hi = q;
  }
  return { width, height, pixels, palette: coverPalette(spec.hue, spec.scheme, tones), family };
}
