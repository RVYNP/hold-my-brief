/**
 * Whether a reflowable EPUB is a reference book, which reads better as one continuous column than as pages: code samples and
 * tables split across a page turn. Pure: the adapter hands in what it counted in the first chapters.
 */

/** What one spine item holds: `<pre>` blocks, characters inside outermost `<pre>`/`<table>` elements, and all characters. */
export type SectionMix = { pre: number; blockChars: number; chars: number };

/** The first spine items looked at. A book's front matter and opening chapters say what the rest is like. */
export const SAMPLE_SECTIONS = 10;
/** Spine items with at least one `<pre>` that make a book code-heavy. */
export const PRE_SECTIONS = 3;
/** Share of the sampled text that sits in `<pre>` or `<table>` that makes a book code-heavy when fewer sections have `<pre>`: one character in five. */
export const BLOCK_SHARE = 0.2;

/** True when `<pre>` appears in at least PRE_SECTIONS of the first SAMPLE_SECTIONS spine items, or `<pre>`/`<table>` text is at least BLOCK_SHARE of theirs. */
export function codeHeavy(sections: readonly SectionMix[]): boolean {
  const sample = sections.slice(0, SAMPLE_SECTIONS);
  if (sample.filter(section => section.pre > 0).length >= PRE_SECTIONS) return true;
  const chars = sample.reduce((sum, section) => sum + section.chars, 0);
  return chars > 0 && sample.reduce((sum, section) => sum + section.blockChars, 0) / chars >= BLOCK_SHARE;
}

/** How much `<pre>` and `<table>` a section document holds. Nested blocks count once, at the outermost. */
export function sectionMix(doc: Document): SectionMix {
  const root = doc.body ?? doc.documentElement;
  const blocks = Array.from(root.querySelectorAll('pre, table')).filter(block => !block.parentElement?.closest('pre, table'));
  return {
    pre: root.querySelectorAll('pre').length,
    blockChars: blocks.reduce((sum, block) => sum + (block.textContent?.length ?? 0), 0),
    chars: root.textContent?.length ?? 0,
  };
}
