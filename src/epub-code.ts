/**
 * Reader CSS and colours for code blocks in reflowable EPUBs. Publisher code is a nowrap scroll box inside the prose measure with the
 * reading line height on every line; here it wraps with a hanging indent, sits at 1.45 line height, and in Scroll flow may run wider
 * than the prose column. Publisher fonts and syntax colours are kept. Everything is `:where()` so it adds no specificity of its own.
 */
import { isDark, type Rgb } from './theme';

/** The boxes that wrap a `pre` in publisher markup (pandoc, Sphinx, DocBook); a `pre` in one of them is the code and the wrapper only frames it. */
export const CODE_WRAPPERS = 'div.sourceCode, div.highlight, .programlisting, .screen, .listing';
/** Elements that are a code listing, or the box around one. `.example` is only freed from clipping: it can hold prose around the listing. */
const BLOCKS = `pre, ${CODE_WRAPPERS}`;
const BOXES = `${BLOCKS}, pre > code, .example`;
/** Boxes whose whitespace is the listing: `.programlisting` and friends are `pre` in practice, and a `div` of them would print its source indentation. */
const WRAPPED = 'pre, pre > code, div.sourceCode, div.highlight';
/** Marks the box of one source line. */
const LINE = 'data-hmb-line';
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

/** Longest listing whose lines get a box each: splitting a line off a text node copies what follows it, so the cost grows with the square of the length. */
const MAX_LINES = 2000;
/** The column a line's text starts at, counting a tab as a step of 4 like `tab-size`. */
function indentOf(line: string): number {
  let column = 0;
  for (const char of line) {
    if (char === ' ') column++;
    else if (char === '\t') column = (Math.floor(column / 4) + 1) * 4;
    else break;
  }
  return column;
}

/**
 * Gives every source line of every `pre` its own box, carrying its indent as `--hmb-indent`, so a wrapped line can hang from where its line
 * begins. Pandoc already sets each line in a `span`. Elsewhere a line is cut out with a range, which copies a token's `span` across the cut
 * when a string or comment runs over several lines. The text, and so every text offset, is unchanged. Runs once per document.
 */
export function markLines(doc: Document) {
  for (const pre of Array.from(doc.querySelectorAll('pre'))) {
    if (pre.querySelector(`[${LINE}]`)) continue;
    const mark = (element: HTMLElement, line: string) => { element.setAttribute(LINE, ''); element.style.setProperty('--hmb-indent', String(indentOf(line))); };
    const spans = pre.matches('.sourceCode') ? Array.from(pre.querySelectorAll<HTMLElement>(':scope > code > span')) : [];
    if (spans.length) { for (const span of spans) mark(span, span.textContent ?? ''); continue; }
    const ranges: Range[] = [];
    let range: Range | undefined, end: [Text, number] | undefined;
    const flush = () => {
      if (range && end) { range.setEnd(...end); if (range.toString().trim()) ranges.push(range); }
      range = end = undefined;
    };
    const walker = doc.createTreeWalker(pre, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
      for (let from = 0; ;) {
        const newline = node.data.indexOf('\n', from), stop = newline < 0 ? node.data.length : newline;
        if (stop > from) { if (!range) { range = doc.createRange(); range.setStart(node, from); } end = [node, stop]; }
        if (newline < 0) break;
        flush();
        from = newline + 1;
      }
    }
    flush();
    if (ranges.length > MAX_LINES) continue;
    // Last line first: a cut leaves every earlier boundary where it was.
    for (const cut of ranges.reverse()) {
      const line = doc.createElement('span');
      mark(line, cut.toString());
      line.append(cut.extractContents());
      cut.insertNode(line);
    }
  }
}

/** `room` is set in Scroll flow only; Pages keeps blocks in the column. */
export function codeStyles(room?: number): string {
  const rules = [
    `:where(${BOXES}) { overflow: visible !important; max-height: none !important; }`,
    `:where(${WRAPPED}) { white-space: pre-wrap !important; overflow-wrap: anywhere !important; tab-size: 4 !important; }`,
    `${OUTER} { box-sizing: border-box !important; font-size: max(12px, 0.82em) !important; margin: 0.9em 0 !important; padding: 0.6em 0.9em !important; }`,
    `${WITHIN}, ${inBlock} { line-height: 1.45 !important; }`,
    `${WITHIN} :where(pre, code) { font-size: inherit !important; }`,
    `${WITHIN} :where(pre) { margin: 0 !important; padding: 0 !important; }`,
    // A wrapped line hangs 2ch in from where its own line begins (its indent, which `markLines` sets), so each line is a box of its own.
    `${WITHIN} [${LINE}] { display: inline-block !important; padding-left: calc(1ch * (var(--hmb-indent, 0) + 2)) !important; text-indent: calc(-1ch * (var(--hmb-indent, 0) + 2)) !important; }`,
  ];
  if (room !== undefined) rules.push(
    `html { --hmb-code-wide: max(100%, min(calc(100vw * ${Math.max(0, room).toFixed(4)}), 100ch)); }`,
    `${OUTER} { width: var(--hmb-code-wide) !important; max-width: none !important; margin-inline: calc((100% - var(--hmb-code-wide)) / 2) !important; }`,
  );
  return rules.join(' ');
}
