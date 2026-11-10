import { describe, expect, it } from 'vitest';
import { rgbToOklch } from '../src/colour';
import { coverFamilies, coverPalette, ditherMethods, familyFor, inkCoverage, renderCover, seedFrom, type DitherMethod } from '../src/procedural-cover';

const spec = { hue: 215, scheme: 'light', width: 48, height: 36 } as const;
const seeds = Array.from({ length: 100 }, (_, index) => seedFrom(`book ${index}`));
// The Languages shelf of the reference library: eleven neighbours that all draw the same family.
const languages = ['The Cargo Book', 'Node.js v24.22.3 Documentation', 'PowerShell 7.5 About Topics', 'PowerShell 7.5 Core Cmdlets', 'PowerShell Documentation (Learning & Scripting)', 'Python 3.13 Library Reference', 'Python 3.13 Tutorial & Language Reference', 'The Rust Programming Language', 'Rust By Example', 'The Rust Reference', 'The Swift Programming Language'];
const hamming = (a: Uint8Array, b: Uint8Array) => { let count = 0; for (let index = 0; index < a.length; index++) if (a[index] !== b[index]) count++; return count; };
const ink = (pixels: Uint8Array) => pixels.reduce((sum, pixel) => sum + (pixel ? 1 : 0), 0) / pixels.length;
const luminance = ([r, g, b]: number[]) => [r, g, b].map(c => c / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4).reduce((sum, c, index) => sum + c * [.2126, .7152, .0722][index], 0);
const contrast = (a: number[], b: number[]) => { const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (high + .05) / (low + .05); };
const closest = (grids: Uint8Array[]) => { let best = Infinity; for (let a = 0; a < grids.length; a++) for (let b = a + 1; b < grids.length; b++) best = Math.min(best, hamming(grids[a], grids[b]) / grids[a].length); return best; };

describe('seedFrom', () => {
  it('is a stable 32-bit hash that spreads near texts far apart', () => {
    expect(seedFrom('The Rust Programming Language')).toBe(seedFrom('The Rust Programming Language'));
    expect(seedFrom('a')).not.toBe(seedFrom('b'));
    for (const text of ['a', 'b', 'The Rust Reference']) { const seed = seedFrom(text); expect(Number.isInteger(seed)).toBe(true); expect(seed).toBeGreaterThanOrEqual(0); expect(seed).toBeLessThan(2 ** 32); }
    expect(new Set(seeds).size).toBe(seeds.length);
    expect(new Set(seeds.map(seed => seed >>> 24)).size).toBeGreaterThan(40);
  });
});

describe('renderCover', () => {
  it('keeps the shelf slots in order: flow, arcs, stripes, contours, truchet', () => {
    expect([...coverFamilies]).toEqual(['flow', 'arcs', 'stripes', 'contours', 'truchet']);
    expect([...ditherMethods]).toEqual(['bayer4', 'bayer8', 'blue', 'atkinson']);
  });
  it.each(coverFamilies)('%s: deterministic, sized, with indices inside the palette', family => {
    const first = renderCover({ ...spec, seed: seeds[3], family }), second = renderCover({ ...spec, seed: seeds[3], family });
    expect(first.family).toBe(family);
    expect(first.width).toBe(48); expect(first.height).toBe(36); expect(first.pixels).toHaveLength(48 * 36);
    expect(Array.from(second.pixels)).toEqual(Array.from(first.pixels));
    expect(second.palette).toEqual(first.palette);
    expect(first.palette).toHaveLength(3);
    for (const pixel of first.pixels) { expect(pixel).toBeGreaterThanOrEqual(0); expect(pixel).toBeLessThan(first.palette.length); }
  });
  it.each(ditherMethods)('%s: stays in a 2- or 3-tone palette and a shelf of covers uses every tone', method => {
    for (const tones of [2, 3] as const) {
      const used = new Set<number>();
      for (const title of languages) {
        const cover = renderCover({ ...spec, seed: seedFrom(title), family: 'flow', dither: method, tones });
        expect(cover.palette).toHaveLength(tones);
        for (const pixel of cover.pixels) used.add(pixel);
      }
      expect(used).toEqual(new Set(Array.from({ length: tones }, (_, index) => index)));
    }
  });
  it('dithers with blue noise unless told otherwise', () => {
    const plain = renderCover({ ...spec, seed: seeds[8], family: 'arcs' }), blue = renderCover({ ...spec, seed: seeds[8], family: 'arcs', dither: 'blue' });
    expect(Array.from(plain.pixels)).toEqual(Array.from(blue.pixels));
    expect(hamming(plain.pixels, renderCover({ ...spec, seed: seeds[8], family: 'arcs', dither: 'bayer8' }).pixels)).toBeGreaterThan(100);
  });
  it('takes any art size, not only 48 x 36', () => {
    for (const [width, height] of [[64, 48], [44, 33]]) {
      const cover = renderCover({ ...spec, width, height, seed: seeds[1], family: 'arcs' });
      expect(cover.pixels).toHaveLength(width * height);
      expect(ink(cover.pixels)).toBeGreaterThan(inkCoverage.low - .03); expect(ink(cover.pixels)).toBeLessThan(inkCoverage.high + .03);
    }
  });
  it('picks a family from the seed when none, or an unknown one, is named', () => {
    const picked = renderCover({ ...spec, seed: seeds[7] });
    expect(picked.family).toBe(familyFor(seeds[7]));
    expect(renderCover({ ...spec, seed: seeds[7], family: 'moire' }).family).toBe(picked.family);
    expect(new Set(seeds.map(familyFor))).toEqual(new Set(coverFamilies));
  });
  it('differs with the family for the same seed', () => {
    const grids = coverFamilies.map(family => renderCover({ ...spec, seed: seeds[9], family }).pixels);
    expect(closest(grids)).toBeGreaterThan(.1);
  });
  it('is the same art in light and dark: only the palette changes', () => {
    const light = renderCover({ ...spec, seed: seeds[2], family: 'contours' }), dark = renderCover({ ...spec, scheme: 'dark', seed: seeds[2], family: 'contours' });
    expect(Array.from(dark.pixels)).toEqual(Array.from(light.pixels));
    expect(dark.palette).not.toEqual(light.palette);
  });
});

describe('ink coverage', () => {
  // Every cover is steered to the same weight, so a sparse family and a dense one sit alike on a shelf.
  it.each(coverFamilies)('%s: 100 seeds land between 30% and 38% non-ground pixels', family => {
    const shares = seeds.map(seed => ink(renderCover({ ...spec, seed, family }).pixels));
    expect(Math.min(...shares)).toBeGreaterThanOrEqual(.30); expect(Math.max(...shares)).toBeLessThanOrEqual(.38);
  });
  it.each(['bayer4', 'bayer8', 'atkinson'] as DitherMethod[])('%s lands in the band too', dither => {
    for (const family of coverFamilies) for (const seed of seeds.slice(0, 25)) {
      const share = ink(renderCover({ ...spec, seed, family, dither }).pixels);
      expect(share).toBeGreaterThanOrEqual(.29); expect(share).toBeLessThanOrEqual(.39);
    }
  });
  it('holds at 2 tones', () => {
    for (const family of coverFamilies) for (const seed of seeds.slice(0, 25)) {
      const share = ink(renderCover({ ...spec, seed, family, tones: 2 }).pixels);
      expect(share).toBeGreaterThanOrEqual(.29); expect(share).toBeLessThanOrEqual(.39);
    }
  });
});

describe('tone use', () => {
  // A cover that is all mid tone (no pixel of the strongest ink) weighs less than its shelf neighbours; a plateau once caused that for 38 of 100 flow seeds.
  it.each(coverFamilies)('%s: at most 2 of 100 seeds are missing the strongest tone', family => {
    const flat = seeds.filter(seed => renderCover({ ...spec, seed, family }).pixels.filter(pixel => pixel === 2).length < 20);
    expect(flat.length).toBeLessThanOrEqual(2);
  });
});

describe('uniqueness', () => {
  it.each(coverFamilies)('%s: 100 seeds give 100 visibly different grids', family => {
    expect(closest(seeds.map(seed => renderCover({ ...spec, seed, family }).pixels))).toBeGreaterThan(.1);
  });
  it.each(coverFamilies)('%s: eleven books on one shelf differ at a glance (30% of pixels or more, pairwise)', family => {
    expect(closest(languages.map(title => renderCover({ ...spec, seed: seedFrom(title), family }).pixels))).toBeGreaterThanOrEqual(.3);
  });
  it.each(['bayer8', 'atkinson'] as DitherMethod[])('holds with %s too', dither => {
    expect(closest(languages.map(title => renderCover({ ...spec, seed: seedFrom(title), family: 'flow', dither }).pixels))).toBeGreaterThanOrEqual(.3);
  });
  // The Libraries & tools shelf draws stripes, the family with the most room to look samey. Raw pixel difference also counts the dust that every
  // blue-noise cover shares at the same cells, so it understates how different two covers look; the orientation test below checks composition.
  it('stripes: ten neighbouring books differ in at least 38% of pixels, pairwise', () => {
    const libraries = ['D2 Documentation', 'FFmpeg Documentation', "Just Programmer's Manual", 'Mermaid Documentation', 'NumPy 2.5.4 Reference', 'NumPy 2.5.4 User Guide', 'Obsidian Help', 'Pillow 13.0.0 Documentation', 'Tauri 2 Documentation', 'uv Documentation'];
    expect(closest(libraries.map(title => renderCover({ ...spec, seed: seedFrom(title), family: 'stripes' }).pixels))).toBeGreaterThanOrEqual(.38);
  });
  it('stripes: 100 seeds run in every direction, near horizontal and near vertical included', () => {
    // dominant orientation of the ink's gradient (structure tensor), in six bins of 30 degrees
    const bins = new Array<number>(6).fill(0);
    for (const seed of seeds) {
      const { pixels } = renderCover({ ...spec, seed, family: 'stripes' }), at = (x: number, y: number) => pixels[y * 48 + x] ? 1 : 0;
      let xx = 0, yy = 0, xy = 0;
      for (let y = 1; y < 35; y++) for (let x = 1; x < 47; x++) { const gx = at(x + 1, y) - at(x - 1, y), gy = at(x, y + 1) - at(x, y - 1); xx += gx * gx; yy += gy * gy; xy += gx * gy; }
      const angle = (.5 * Math.atan2(2 * xy, xx - yy) + Math.PI) % Math.PI;
      bins[Math.min(5, Math.floor(angle / (Math.PI / 6)))]++;
    }
    for (const count of bins) expect(count).toBeGreaterThanOrEqual(5);
  });
  it('a re-roll (the same title under another suffix) is a different cover', () => {
    const grids = Array.from({ length: 8 }, (_, roll) => renderCover({ ...spec, seed: seedFrom(`The Rust Programming Language #${roll}`), family: 'stripes' }).pixels);
    expect(closest(grids)).toBeGreaterThan(.25);
  });
});

describe('palette', () => {
  it('keeps tones close: neighbouring tones 1.15:1 to 1.45:1, the whole range under 1.7:1', () => {
    for (const scheme of ['light', 'dark'] as const) for (const hue of [0, 60, 135, 215, 300]) {
      const [ground, mid, strongest] = coverPalette(hue, scheme, 3);
      for (const [a, b] of [[ground, mid], [mid, strongest]]) { expect(contrast(a, b)).toBeGreaterThanOrEqual(1.15); expect(contrast(a, b)).toBeLessThanOrEqual(1.45); }
      expect(contrast(ground, strongest)).toBeLessThan(1.7);
    }
  });
  it('is ordered ground to ink: lightest first in light, darkest first in dark', () => {
    const light = coverPalette(215, 'light'), dark = coverPalette(215, 'dark');
    expect(luminance(light[0])).toBeGreaterThan(luminance(light[2]));
    expect(luminance(dark[0])).toBeLessThan(luminance(dark[2]));
  });
  it('carries the hue of the shelf', () => {
    for (const hue of [20, 135, 250]) for (const colour of coverPalette(hue, 'light')) {
      const [, chroma, found] = rgbToOklch(...colour);
      expect(chroma).toBeGreaterThan(.02);
      expect(Math.abs(((found - hue + 540) % 360) - 180)).toBeLessThan(12);
    }
  });
});

describe('cost', () => {
  // Design target is under 2 ms on a dev machine. GitHub's Windows runners land at
  // 2.0–2.4 ms for this same code (run 42735091170: flow 2.39, stripes 2.37, contours
  // 2.001), so the CI bound only catches an algorithmic regression, not runner noise.
  const host: unknown = globalThis;
  const proc = host && typeof host === 'object' && 'process' in host ? host.process : undefined;
  const env = proc && typeof proc === 'object' && 'env' in proc ? proc.env : undefined;
  const ci = env && typeof env === 'object' && 'CI' in env ? env.CI : undefined;
  const budget = typeof ci === 'string' && ci ? 12 : 2;
  it.each(coverFamilies)('%s: renders a 64 x 48 cover within the cost budget (blue noise and Atkinson)', family => {
    for (let index = 0; index < 20; index++) renderCover({ ...spec, width: 64, height: 48, seed: seeds[index], family }); // warm the JIT
    const methods: DitherMethod[] = ['blue', 'atkinson'], runs = 60, started = performance.now();
    for (let index = 0; index < runs; index++) renderCover({ ...spec, width: 64, height: 48, seed: seeds[index], family, dither: methods[index % 2] });
    expect((performance.now() - started) / runs).toBeLessThan(budget);
  });
});
