/**
 * Reader CSS and colours for code blocks in reflowable EPUBs. Publisher code is a nowrap scroll box inside the prose measure with the
 * reading line height on every line; here it wraps with a hanging indent, sits at 1.45 line height, and in Scroll flow may run wider
 * than the prose column. Publisher fonts and syntax colours are kept. Everything is `:where()` so it adds no specificity of its own.
 */
import { isDark, type Rgb } from './theme';

/** Elements that are a code listing, or the box around one. `.example` is only freed from clipping: it can hold prose around the listing. */
const BLOCKS = 'pre, div.sourceCode, div.highlight, .programlisting, .screen, .listing';
const BOXES = `${BLOCKS}, pre > code, .example`;
/** Boxes whose whitespace is the listing: `.programlisting` and friends are `pre` in practice, and a `div` of them would print its source indentation. */
const WRAPPED = 'pre, pre > code, div.sourceCode, div.highlight';
const WITHIN = `:where(${BLOCKS})`;
const inBlock = `${WITHIN} *`;
/** A listing not inside another: the one that carries margin, padding, and the Scroll width. */
const OUTER = `${WITHIN}:not(${inBlock})`;

/** The element selector for `closest()`. */
export const CODE_BLOCKS = BLOCKS;
/** A code background that is light on a dark page or dark on a light one: a tint of the page. The two variables are set on the frame's `html`. */
export const CODE_BACKGROUND = 'color-mix(in srgb, var(--hmb-paper) 90%, var(--hmb-ink))';
export const codeBackground = (paper: Rgb, ink: Rgb): Rgb => paper.map((channel, i) => Math.round(channel * .9 + ink[i] * .1)) as Rgb;

/** What a code block's own background needs on a page of `paper`: the tint of the page when it is light on dark or dark on light, else null. */
export function mappedBackground(background: Rgb, paper: Rgb, ink: Rgb): Rgb | null {
  return isDark(background) === isDark(paper) ? null : codeBackground(paper, ink);
}

/**
 * The Scroll-flow width of a code block as a share of the viewport: Foliate pads the document by `g / (1 - g)` of the frame width on each side
 * for a `gap` attribute of `g`, and the block may use what is left.
 */
export function scrollRoom(g: number): number {
  const share = Math.max(0, Math.min(.9, g));
  return 1 - 2 * share / (1 - share);
}

/** `room` is set in Scroll flow only; Pages keeps blocks in the column. */
export function codeStyles(room?: number): string {
  const rules = [
    `:where(${BOXES}) { overflow: visible !important; max-height: none !important; }`,
    `:where(${WRAPPED}) { white-space: pre-wrap !important; overflow-wrap: anywhere !important; tab-size: 4 !important; }`,
    `${OUTER} { box-sizing: border-box !important; font-size: max(12px, 0.82em) !important; margin: 0.9em 0 !important; padding: 0.6em 0.9em !important; }`,
    `${WITHIN}, ${inBlock} { line-height: 1.45 !important; }`,
    `${WITHIN} :where(pre, code) { font-size: inherit !important; }`,
    // A wrapped line hangs 2ch in from the line before it. Pandoc sets each line in its own inline-block span, which then carries the hang.
    `:where(pre):not(${inBlock}) { padding-left: calc(0.9em + 2ch) !important; text-indent: -2ch !important; }`,
    `${WITHIN} :where(pre) { margin: 0 !important; padding: 0 0 0 2ch !important; text-indent: -2ch !important; }`,
    `pre.sourceCode { text-indent: 0 !important; }`,
    `${WITHIN} pre.sourceCode { padding-left: 0 !important; }`,
    `pre.sourceCode > code > span { padding-left: 2ch !important; text-indent: -2ch !important; }`,
  ];
  if (room !== undefined) rules.push(
    `html { --hmb-code-wide: max(100%, min(calc(100vw * ${Math.max(0, room).toFixed(4)}), 100ch)); }`,
    `${OUTER} { width: var(--hmb-code-wide) !important; max-width: none !important; margin-inline: calc((100% - var(--hmb-code-wide)) / 2) !important; }`,
  );
  return rules.join(' ');
}
