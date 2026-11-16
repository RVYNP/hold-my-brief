import { describe, expect, it } from 'vitest';
import { accentVars, allPalettes, banners, contrast, defaultBackgroundStrength, glowSchemes, glows, isGlow, liftInk, palettes, parse, type Banner, type Rgb } from '../src/theme';

const hex = (value: string): Rgb => [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16)) as Rgb;
const pair = (value: string) => /^light-dark\((#[0-9a-f]{6}), (#[0-9a-f]{6})\)$/.exec(value)!.slice(1).map(hex);
const white: Rgb = [255, 255, 255], darkSurface: Rgb = [0x22, 0x21, 0x27];

describe('accentVars', () => {
  it.each(['#6358d8', '#a86af4', '#ffd400', '#00c2a8', '#e8e8e8', '#141414', '#ff0000'])('keeps %s legible in both modes', accent => {
    const vars = accentVars(accent);
    const [markLight, markDark] = pair(vars['--accent']), [inkLight, inkDark] = pair(vars['--accent-ink']), [fillLight, fillDark] = pair(vars['--accent-fill']);
    expect(contrast(markLight, white)).toBeGreaterThanOrEqual(3.5);
    expect(contrast(inkLight, white)).toBeGreaterThanOrEqual(5.5);
    expect(contrast(fillLight, white)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(fillDark, white)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(markDark, darkSurface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(inkDark, darkSurface)).toBeGreaterThanOrEqual(7);
  });
  it('leaves the default accent where it already reads well', () => {
    const vars = accentVars('#6358d8');
    expect(vars['--accent']).toBe('light-dark(#6358d8, ' + vars['--accent'].slice(-8));
    expect(vars['--accent-fill'].startsWith('light-dark(#6358d8,')).toBe(true);
  });
});

describe('liftInk', () => {
  const ink = hex('#dedbe6');
  it('swaps illegible neutral publication text for the reading ink and leaves legible text alone', () => {
    expect(liftInk(hex('#1d1b22'), darkSurface, ink)).toEqual(ink);
    expect(liftInk(hex('#e9e7ee'), darkSurface, ink)).toBeNull();
    expect(liftInk(hex('#1d1b22'), white, ink)).toBeNull();
  });
  it('keeps a colored heading recognizably colored and comfortably legible', () => {
    const lifted = liftInk(hex('#5347c3'), darkSurface, ink)!;
    const [r, g, b] = lifted;
    expect(contrast(lifted, darkSurface)).toBeGreaterThanOrEqual(7);
    expect(b).toBeGreaterThan(r); expect(b).toBeGreaterThan(g);
  });
});

describe('glow themes', () => {
  it('are ten palettes of their own, four light and six dark, none of them a family', () => {
    expect(glows).toEqual(['aurora', 'dusk', 'nebula', 'solar', 'ember', 'orchid', 'glacier', 'peach', 'lagoon', 'moss']);
    expect(Object.values(glowSchemes).filter(scheme => scheme === 'light')).toHaveLength(4);
    expect(allPalettes).toEqual([...palettes, ...glows]);
    expect(palettes.some(isGlow)).toBe(false);
    expect(glows.every(isGlow)).toBe(true);
  });
});

describe('parse: Home background', () => {
  const strength = (record: object) => parse(JSON.stringify(record)).backgroundStrength;
  it('reads a kept strength from 0.02 to 0.10 as it is', () => {
    for (const value of [0.02, 0.06, 0.09, 0.1]) expect(strength({ backgroundStrength: value })).toBe(value);
  });
  it('loads a record without a strength as 0.06', () => {
    expect(defaultBackgroundStrength).toBe(0.06);
    expect(strength({ palette: 'aurora', banner: 'arcs' })).toBe(0.06);
    expect(parse(null).backgroundStrength).toBe(0.06);
    expect(parse('not json').backgroundStrength).toBe(0.06);
  });
  it.each([0.019, 0.101, 0.11, 0.12, 0.2, 0, -0.06, 1, 6, 1e9, null, '0.1', true, [0.1], {}])('loads the out-of-range or non-numeric strength %j as 0.06', value => {
    expect(strength({ backgroundStrength: value })).toBe(0.06);
  });
  it('loads a non-finite strength (which JSON writes as null) as 0.06', () => {
    expect(strength({ backgroundStrength: Number.NaN })).toBe(0.06);
    expect(strength({ backgroundStrength: Number.POSITIVE_INFINITY })).toBe(0.06);
  });
  it('keeps every saved banner value meaning the same pattern, and none off, whatever the strength', () => {
    for (const banner of banners) {
      expect(parse(JSON.stringify({ banner })).banner).toBe(banner);
      expect(parse(JSON.stringify({ banner, backgroundStrength: 0.1 }))).toMatchObject({ banner, backgroundStrength: 0.1 });
    }
    expect(parse(JSON.stringify({ banner: 'none' })).banner).toBe('none');
    expect(parse(JSON.stringify({ banner: 'confetti' })).banner).toBe('flow' satisfies Banner);
    expect(parse(JSON.stringify({ palette: 'brief' })).banner).toBe('flow');
  });
});
