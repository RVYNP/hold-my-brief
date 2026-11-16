/**
 * Publisher callouts (pandoc and Sphinx notes and warnings, admonitions, `<aside>`, shaded table cells) paint their own box. On a page of the
 * other tone the reader's ink is drawn on that box: light ink on a light box. Such a box is mapped into the page's scheme, keeping a hint of its
 * hue, and its rules are lifted to a legible lightness; the text inside is then lifted by `adaptInk` as for any other background.
 */
import { contrast, fromOklch, isDark, reach, rgbToHex, toOklch, type Rgb } from './theme';

/** Elements whose own background is the picture, not a callout box. */
export const NOT_CALLOUTS = 'img, svg, picture, canvas, video, audio, object, embed, iframe';
/** How much of the page's colour a mapped box keeps; the rest is the original's hue. */
const KEEP = .88;
/** A box counts as set against the page when it is of the other tone and at least this far from it, in contrast. */
const MARGIN = 3;
/** Contrast a rule needs against its box (WCAG's floor for a graphical object). */
const RULE = 3;
/** The sides of a box, as CSS names the properties of each. */
export const SIDES = ['top', 'right', 'bottom', 'left'] as const;

export type Callout = { css: string; rgb: Rgb };

const mix = (page: Rgb, tint: Rgb): Rgb => page.map((channel, i) => Math.round(channel * KEEP + tint[i] * (1 - KEEP))) as Rgb;

/**
 * What a box of `background` becomes on a page of `paper`, or null when it is not set against the page: the page mixed with the box's hue at a
 * low chroma, written as the `color-mix()` the frame computes and as the colour it computes to. The hue is dropped for a neutral box.
 */
export function calloutBackground(background: Rgb, paper: Rgb): Callout | null {
  if (isDark(background) === isDark(paper) || contrast(background, paper) < MARGIN) return null;
  const [, chroma, hue] = toOklch(background);
  const tint = fromOklch([isDark(paper) ? .72 : .4, chroma < .008 ? 0 : Math.min(.16, Math.max(.08, chroma * 8)), hue]);
  return { css: `color-mix(in srgb, var(--hmb-paper) ${KEEP * 100}%, ${rgbToHex(tint)})`, rgb: mix(paper, tint.map(Math.round) as Rgb) };
}

/** A border or left rule's colour on a mapped box, lifted (keeping its hue) when it would not show against the box; null when it already does. */
export function liftRule(color: Rgb, background: Rgb): Rgb | null {
  return contrast(color, background) >= RULE ? null : reach(color, background, RULE, isDark(background) ? .02 : -.02);
}
