import { describe, expect, it } from 'vitest';
import { artSize, bayer, ditherGrid, motifField, motifFor, motifs, type Motif } from '../src/dither';

const all: Motif[] = [...motifs, 'neutral'];

describe('ordered dithering', () => {
  it('has a Bayer matrix that uses every threshold of 64 exactly once', () => {
    const seen = new Set<number>();
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) seen.add(Math.round(bayer(x, y) * 64 - .5));
    expect([...seen].sort((a, b) => a - b)).toEqual(Array.from({ length: 64 }, (_, index) => index));
    expect(bayer(0, 0)).toBeLessThan(1 / 32); expect(bayer(8, 8)).toBe(bayer(0, 0)); expect(bayer(3, 5)).toBe(bayer(11, 13));
  });
  it('spreads a flat density evenly: 25% ink lights a quarter of every 8 x 8 block', () => {
    let lit = 0; for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (.25 > bayer(x, y)) lit++;
    expect(lit).toBe(16);
  });
});

describe('motifs', () => {
  it('give every collection one of the six motifs, by hash, and the neutral one for none', () => {
    expect(motifFor(undefined)).toBe('neutral');
    expect(new Set(Array.from({ length: 600 }, (_, index) => motifFor(Math.imul(index, 2654435761) >>> 0)))).toEqual(new Set(motifs));
    expect(motifFor(123456789)).toBe(motifFor(123456789));
  });
  it.each(all)('%s: a density between 0 and 1 everywhere', motif => {
    for (let y = 0; y <= 20; y++) for (let x = 0; x <= 20; x++) { const value = motifField(motif, x / 20, y / 20, 4 / 3); expect(value).toBeGreaterThanOrEqual(0); expect(value).toBeLessThanOrEqual(1); }
  });
  it.each(all)('%s: dithers to the same two-state grid every time, with some ink and some bare tint', motif => {
    const first = ditherGrid(motif), second = ditherGrid(motif);
    expect(first).toHaveLength(artSize.width * artSize.height);
    expect(Array.from(second)).toEqual(Array.from(first));
    expect(new Set(first)).toEqual(new Set([0, 1]));
    const lit = first.reduce((sum, value) => sum + value, 0) / first.length;
    expect(lit).toBeGreaterThan(.08); expect(lit).toBeLessThan(.92);
  });
  it('look different from each other', () => {
    const grids = all.map(motif => Array.from(ditherGrid(motif)).join(''));
    expect(new Set(grids).size).toBe(all.length);
  });
});
