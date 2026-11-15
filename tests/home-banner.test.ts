import { describe, expect, it } from 'vitest';
import { bannerGrid, bannerPalette, renderBanner, reshuffled, seedFor, localDay, type BannerSpec } from '../src/home-banner';

const spec: BannerSpec = { seed: 12345, family: 'flow', width: 125, height: 35, ground: [233, 227, 214], a: [225, 58, 58], b: [240, 138, 60], strength: .55 };
const differs = (x: Uint8Array, y: Uint8Array) => x.some((tone, index) => tone !== y[index]);

describe('renderBanner', () => {
  it('is deterministic: the same spec gives the same grid', () => {
    const first = renderBanner(spec), second = renderBanner({ ...spec });
    expect(first.width).toBe(125);
    expect(first.height).toBe(35);
    expect(first.pixels).toEqual(second.pixels);
    expect(first.palette).toEqual(second.palette);
  });
  it('uses only palette indices 0 to 3: the ground and both lights are drawn', () => {
    const { pixels, palette } = renderBanner(spec);
    expect(palette).toHaveLength(4);
    expect(pixels).toHaveLength(125 * 35);
    expect([...new Set(pixels)].every(tone => tone >= 0 && tone <= 3)).toBe(true);
    expect(new Set(pixels)).toContain(0);
    expect(new Set(pixels)).toContain(2);
    expect(new Set(pixels)).toContain(3);
  });
  it('changes with the seed and with the family', () => {
    const base = renderBanner(spec).pixels;
    expect(differs(base, renderBanner({ ...spec, seed: 54321 }).pixels)).toBe(true);
    for (const family of ['arcs', 'stripes', 'contours', 'truchet']) expect(differs(base, renderBanner({ ...spec, family }).pixels)).toBe(true);
  });
  it('lights the right of the band: the second light holds the lower right corner, the ground the upper left', () => {
    const { pixels, width, height } = renderBanner({ ...spec, width: 250, height: 70 });
    const share = (x0: number, x1: number, y0: number, y1: number, tone: number) => {
      let count = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (pixels[y * width + x] === tone) count++;
      return count / ((x1 - x0) * (y1 - y0));
    };
    expect(share(width - 40, width, height - 20, height, 3)).toBeGreaterThan(.3);
    expect(share(0, 30, 0, 30, 0)).toBeGreaterThan(.6);
  });
});

describe('bannerPalette', () => {
  it('runs from the ground through a weaker and a full first hue to the second hue', () => {
    expect(bannerPalette([100, 100, 100], [200, 0, 100], [0, 100, 200], .5)).toEqual([[100, 100, 100], [128, 73, 100], [150, 50, 100], [50, 100, 150]]);
  });
});

describe('bannerGrid', () => {
  it('is one dither pixel per 2 CSS px, the width rounded up to a bucket', () => {
    expect(bannerGrid(1000, 140)).toEqual({ width: 512, height: 70 });
    expect(bannerGrid(1000, 140)).toEqual(bannerGrid(1010, 140));
    expect(bannerGrid(388, 64)).toEqual({ width: 208, height: 32 });
  });
});

describe('the seed', () => {
  it('is kept through the day and is new on another; garbage is a new day\'s', () => {
    const monday = seedFor(null, '2026-11-16');
    expect(seedFor(monday, '2026-11-16')).toEqual(monday);
    expect(seedFor(monday, '2026-11-17').seed).not.toBe(monday.seed);
    expect(seedFor(monday, '2026-11-17').day).toBe('2026-11-17');
    expect(seedFor({ day: '2026-11-16', seed: 'x' }, '2026-11-16')).toEqual(monday);
    expect(seedFor('nope', '2026-11-16')).toEqual(monday);
  });
  it('reshuffles to another seed on the same day', () => {
    const today = seedFor(null, '2026-11-16');
    expect(reshuffled(today, today.day, () => .5)).toEqual({ day: today.day, seed: 2 ** 31 });
    expect(reshuffled({ day: today.day, seed: 2 ** 31 }, today.day, () => .5).seed).not.toBe(2 ** 31);
  });
  it('names the local calendar day', () => {
    expect(localDay(new Date(2026, 10, 5, 23, 59))).toBe('2026-11-05');
  });
});
