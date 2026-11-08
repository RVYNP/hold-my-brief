import { describe, expect, it } from 'vitest';
import { colourMatches, colourNames, dominantColours, nameColour, nameOklch, oklchToRgb, parseColourName, rgbToOklch } from '../src/colour';

const pixels = (...groups: [number, number][]) => Uint8ClampedArray.from(groups.flatMap(([colour, count]) => Array.from({ length: count }, () => [colour >> 16 & 255, colour >> 8 & 255, colour & 255, 255]).flat()));

describe('colour naming', () => {
  it('names the primary and secondary hues', () => {
    const expected: [number, string][] = [[0xff0000, 'red'], [0xffa500, 'orange'], [0xffff00, 'yellow'], [0x00aa00, 'green'], [0x008080, 'teal'], [0x0000ff, 'blue'], [0x800080, 'purple'], [0xffc0cb, 'pink'], [0x7b4a2a, 'brown']];
    for (const [colour, name] of expected) expect(nameColour(colour), `#${colour.toString(16)}`).toBe(name);
  });

  it('wraps red through 0 degrees: hues either side of the seam are both red', () => {
    for (const hue of [352, 358, 0, 4, 20, 38]) expect(nameOklch(0.55, 0.19, hue), `hue ${hue}`).toBe('red');
    // The seam is a boundary, not a plateau: orange starts at 40 and magenta-purple ends where red begins.
    expect(nameOklch(0.55, 0.19, 41)).toBe('orange');
    expect(nameOklch(0.5, 0.19, 348)).toBe('purple');
    expect(nameOklch(0.5, 0.19, 350)).toBe('red');
  });

  it('keeps pale reds and magentas apart from red and purple', () => {
    expect(nameOklch(0.85, 0.08, 10)).toBe('pink');
    expect(nameOklch(0.72, 0.17, 350)).toBe('pink');
    expect(nameOklch(0.4, 0.17, 330)).toBe('purple');
  });

  it('calls low chroma black, white or grey by lightness, with the boundary at chroma .035', () => {
    expect(nameOklch(0.55, 0.034, 40)).toBe('grey');
    expect(nameOklch(0.55, 0.036, 40)).toBe('brown');
    expect(nameOklch(0.29, 0.01, 0)).toBe('black');
    expect(nameOklch(0.31, 0.01, 0)).toBe('grey');
    expect(nameOklch(0.86, 0.01, 0)).toBe('white');
    expect(nameOklch(0.84, 0.01, 0)).toBe('grey');
    expect(nameColour(0x808080)).toBe('grey');
    expect(nameColour(0xfdfdfd)).toBe('white');
  });

  it('tells dark brown from black and paper cream from yellow', () => {
    expect(nameColour(0x3b2314)).toBe('brown');
    expect(nameColour(0x1a1410)).toBe('black');
    expect(nameColour(0x111111)).toBe('black');
    expect(nameColour(0xf0e6d0), 'cream paper').toBe('white');
    expect(nameColour(0xb8956a), 'sepia').toBe('brown');
    expect(nameColour(0xffd700), 'gold').toBe('yellow');
  });

  it('round-trips OKLCH through sRGB for in-gamut colours', () => {
    for (const [l, c, h] of [[0.7, 0.1, 145], [0.5, 0.12, 250], [0.8, 0.08, 80]] as const) {
      const colour = oklchToRgb(l, c, h); const [l2, c2, h2] = rgbToOklch(colour >> 16 & 255, colour >> 8 & 255, colour & 255);
      expect(l2).toBeCloseTo(l, 1); expect(c2).toBeCloseTo(c, 1); expect(Math.abs(h2 - h)).toBeLessThan(3);
    }
  });
});

describe('colour matching', () => {
  it('matches a hue anywhere in the five, but black, white and grey only among the two largest', () => {
    const colours = [0x202020, 0xe8e8e8, 0x808080, 0x2e8b3a, 0x3050c0];
    expect(colourMatches(colours, 'green')).toBe(true);
    expect(colourMatches(colours, 'blue')).toBe(true);
    expect(colourMatches(colours, 'black')).toBe(true);
    expect(colourMatches(colours, 'white')).toBe(true);
    expect(colourMatches(colours, 'grey'), 'grey is third, so not dominant').toBe(false);
    expect(colourMatches(colours, 'red')).toBe(false);
    expect(colourMatches([], 'green')).toBe(false);
  });

  it('parses the twelve names case-insensitively and nothing else', () => {
    expect(colourNames).toHaveLength(12);
    expect(parseColourName(' Green ')).toBe('green');
    for (const name of colourNames) expect(parseColourName(name.toUpperCase())).toBe(name);
    for (const bad of ['', 'cyan', 'greenish', 'gray']) expect(parseColourName(bad)).toBeUndefined();
  });
});

describe('dominant colours', () => {
  it('returns the largest colours first and merges close shades into one', () => {
    const found = dominantColours(pixels([0x2e8b3a, 500], [0x2f8c3b, 300], [0xf0f0f0, 150], [0xc03020, 74]));
    expect(found).toHaveLength(3);
    expect(nameColour(found[0])).toBe('green');
    expect(nameColour(found[1])).toBe('white');
    expect(nameColour(found[2])).toBe('red');
  });

  it('keeps at most five, ignores transparent pixels and drops specks under 2%', () => {
    const many = dominantColours(pixels([0xff0000, 100], [0x00ff00, 90], [0x0000ff, 80], [0xffff00, 70], [0xff00ff, 60], [0x00ffff, 50], [0x000000, 40]), 5);
    expect(many).toHaveLength(5);
    const rgba = Uint8ClampedArray.from([...pixels([0xff0000, 99]), 0, 255, 0, 255, 0, 0, 255, 0]);
    expect(dominantColours(rgba).map(nameColour)).toEqual(['red']);
    expect(dominantColours(new Uint8ClampedArray(0))).toEqual([]);
  });
});
