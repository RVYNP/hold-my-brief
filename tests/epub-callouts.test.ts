import { describe, expect, it } from 'vitest';
import { calloutBackground, liftRule } from '../src/epub-callouts';
import { contrast, isDark, type Rgb } from '../src/theme';

const darkPaper: Rgb = [33, 30, 26], lightPaper: Rgb = [251, 249, 244];

describe('a callout box against the page', () => {
  it('maps a light box on a dark page to a dark tint that keeps its hue', () => {
    const note = calloutBackground([0xf1, 0xf6, 0xfb], darkPaper)!, warning = calloutBackground([0xff, 0xf5, 0xee], darkPaper)!;
    expect(isDark(note.rgb) && isDark(warning.rgb)).toBe(true);
    expect(note.rgb[2]).toBeGreaterThan(note.rgb[0]);
    expect(warning.rgb[0]).toBeGreaterThan(warning.rgb[2]);
    expect(note.css).toMatch(/^color-mix\(in srgb, var\(--hmb-paper\) 88%, #[0-9a-f]{6}\)$/);
  });
  it('maps a dark box on a light page to a light tint', () => {
    expect(isDark(calloutBackground([0x1f, 0x29, 0x33], lightPaper)!.rgb)).toBe(false);
  });
  it('leaves a box of the page\'s own tone, or one not clearly set against it, alone', () => {
    expect(calloutBackground([0x2b, 0x2a, 0x30], darkPaper)).toBeNull();
    expect(calloutBackground([0xf1, 0xf6, 0xfb], lightPaper)).toBeNull();
    expect(calloutBackground([0x5b, 0x5b, 0x5b], [0x14, 0x14, 0x14])).toBeNull();
  });
});

describe('a rule on a mapped box', () => {
  const box = calloutBackground([0xf1, 0xf6, 0xfb], darkPaper)!.rgb;
  it('is left alone when it shows', () => expect(liftRule([0x3b, 0x79, 0xc2], box)).toBeNull());
  it('is lifted to 3:1 when it would not', () => {
    const lifted = liftRule([0x1a, 0x2a, 0x40], box)!;
    expect(contrast(lifted, box)).toBeGreaterThanOrEqual(3);
  });
});
