// Dominant colours and named hues for the library's colour filter. Pure, so every boundary is testable.
// Colours travel as packed 0xRRGGBB numbers (the native cache stores them three bytes each).

export const colourNames = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'brown', 'black', 'white', 'grey'] as const;
export type ColourName = typeof colourNames[number];

const achromatic: readonly string[] = ['black', 'white', 'grey'];

const linear = (channel: number) => { const c = channel / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const gamma = (value: number) => { const c = value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055; return Math.round(Math.min(1, Math.max(0, c)) * 255); };

/** sRGB (0-255 channels) to OKLab. */
export function rgbToOklab(r: number, g: number, b: number): [number, number, number] {
  const lr = linear(r), lg = linear(g), lb = linear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
}

/** sRGB to OKLCH: lightness 0-1, chroma (about 0-0.4) and hue in degrees [0, 360). */
export function rgbToOklch(r: number, g: number, b: number): [number, number, number] {
  const [lightness, a, bb] = rgbToOklab(r, g, b);
  return [lightness, Math.hypot(a, bb), (Math.atan2(bb, a) * 180 / Math.PI + 360) % 360];
}

/** OKLCH back to a packed colour, clipped to the sRGB gamut. */
export function oklchToRgb(lightness: number, chroma: number, hue: number): number {
  const a = chroma * Math.cos(hue * Math.PI / 180), b = chroma * Math.sin(hue * Math.PI / 180);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (lightness - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  const r = gamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), g = gamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s), bl = gamma(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s);
  return r << 16 | g << 8 | bl;
}

/**
 * The named hue of an OKLCH colour. Low chroma is black, white or grey by lightness (paper-white scans with a
 * cream cast stay white rather than "yellow"); orange-to-yellow hues that are also dark are brown; light
 * reds and magentas are pink; everything else is a hue bin, with red wrapping through 0 degrees.
 */
export function nameOklch(lightness: number, chroma: number, hue: number): ColourName {
  const h = (hue % 360 + 360) % 360;
  if (lightness < 0.2 && chroma < 0.08) return 'black';
  if (lightness > 0.93 && chroma < 0.08) return 'white';
  if (chroma < 0.035) return lightness < 0.3 ? 'black' : lightness > 0.85 ? 'white' : 'grey';
  if (lightness > 0.8 && chroma < 0.06) return 'white';
  if (h >= 25 && h < 100 && (lightness < 0.58 && chroma < 0.15 || lightness < 0.8 && chroma < 0.09)) return 'brown';
  if (h >= 325 && h < 360 && lightness >= 0.6 || h < 40 && lightness >= 0.78) return 'pink';
  if (h >= 350 || h < 40) return 'red';
  if (h < 85) return 'orange';
  if (h < 125) return 'yellow';
  if (h < 175) return 'green';
  if (h < 225) return 'teal';
  if (h < 275) return 'blue';
  return 'purple';
}

export function nameColour(colour: number): ColourName {
  const [lightness, chroma, hue] = rgbToOklch(colour >> 16 & 255, colour >> 8 & 255, colour & 255);
  return nameOklch(lightness, chroma, hue);
}

/**
 * Whether a picture's dominant colours (largest first) include `name`. Black, white and grey must be
 * among the two dominant colours, or nearly every scan would be "grey"; a hue may be any of the five.
 */
export function colourMatches(colours: readonly number[], name: string): boolean {
  const named = colours.map(nameColour);
  return (achromatic.includes(name) ? named.slice(0, 2) : named).includes(name as ColourName);
}

/** Case-insensitive lookup of a colour name; undefined when it is not one of the twelve. */
export function parseColourName(value: string): ColourName | undefined {
  const lower = value.trim().toLowerCase();
  return colourNames.find(name => name === lower);
}

/**
 * Up to `max` dominant colours of an RGBA buffer, largest first. Pixels are bucketed to 4 bits a channel,
 * then buckets are merged into the most common colours unless they sit within `mergeDistance` in OKLab,
 * so a photo's many shades of one wall become one colour. Colours under 2% of the picture are dropped.
 */
export function dominantColours(rgba: ArrayLike<number>, max = 5, mergeDistance = 0.08): number[] {
  const bins = new Map<number, { n: number; r: number; g: number; b: number }>(); let total = 0;
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) continue;
    const key = (rgba[i] >> 4) << 8 | (rgba[i + 1] >> 4) << 4 | rgba[i + 2] >> 4;
    const bin = bins.get(key) ?? { n: 0, r: 0, g: 0, b: 0 }; bin.n++; bin.r += rgba[i]; bin.g += rgba[i + 1]; bin.b += rgba[i + 2]; bins.set(key, bin); total++;
  }
  const chosen: { n: number; r: number; g: number; b: number; lab: [number, number, number] }[] = [];
  for (const bin of [...bins.values()].sort((x, y) => y.n - x.n)) {
    const lab = rgbToOklab(bin.r / bin.n, bin.g / bin.n, bin.b / bin.n);
    let nearest: typeof chosen[number] | undefined, best = Infinity;
    for (const colour of chosen) { const d = Math.hypot(colour.lab[0] - lab[0], colour.lab[1] - lab[1], colour.lab[2] - lab[2]); if (d < best) { best = d; nearest = colour; } }
    if (nearest && (best < mergeDistance || chosen.length >= max)) { nearest.n += bin.n; nearest.r += bin.r; nearest.g += bin.g; nearest.b += bin.b; }
    else chosen.push({ n: bin.n, r: bin.r, g: bin.g, b: bin.b, lab });
  }
  return chosen.sort((x, y) => y.n - x.n).filter(colour => colour.n / Math.max(1, total) >= 0.02)
    .map(colour => Math.round(colour.r / colour.n) << 16 | Math.round(colour.g / colour.n) << 8 | Math.round(colour.b / colour.n));
}

export const colourHex = (colour: number) => `#${colour.toString(16).padStart(6, '0')}`;

/** A representative sRGB colour for each name, for chips and swatches. */
export const colourSwatches: Record<ColourName, string> = {
  red: '#d93636', orange: '#f08c2a', yellow: '#f2c926', green: '#3fa34d', teal: '#2aa198', blue: '#3a6fe0',
  purple: '#8a55d6', pink: '#f08ab4', brown: '#8a5a3a', black: '#1a1a1a', white: '#f6f6f4', grey: '#8c8c8c',
};
