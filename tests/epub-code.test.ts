// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import * as CFI from 'foliate-js/epubcfi.js';
import { codeSafeAnchor, markLines } from '../src/epub-code';

const page = (body: string) => new DOMParser().parseFromString(`<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>${body}</body></html>`, 'application/xhtml+xml');
const textAt = (doc: Document, needle: string) => {
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) if (node.data.includes(needle)) return { node, offset: node.data.indexOf(needle) };
  throw new Error(`no text ${needle}`);
};
/** Where a reader sits at `needle`, as the build before `markLines` saved it, and the same place as a document-wide text offset. */
const saved = (markup: string, needle: string) => {
  const doc = page(markup);
  const { node, offset } = textAt(doc, needle);
  const range = doc.createRange(); range.setStart(node, offset); range.collapse(true);
  const before = doc.createRange(); before.selectNodeContents(doc.body); before.setEnd(node, offset);
  return { cfi: CFI.fromRange(range), offset: before.toString().length };
};
const offsetAnchor = (target: number) => (doc: Document) => {
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  let remaining = target;
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    if (remaining <= node.data.length) { const range = doc.createRange(); range.setStart(node, remaining); range.collapse(true); return range; }
    remaining -= node.data.length;
  }
  throw new Error('offset past the end');
};
const resolveOn = (markup: string, cfi: string, offset: number) => {
  const doc = page(markup);
  markLines(doc);
  const parts = CFI.parse(cfi);
  const range = codeSafeAnchor(d => CFI.toRange(d, parts) as Range, offsetAnchor(offset))(doc) as Range;
  return { doc, range };
};

const sphinx = '<p>Intro</p><div class="highlight"><pre><span class="k">def</span> <span class="nf">first</span><span class="p">():</span>\n    <span class="k">return</span> <span class="s">"needle-one"</span>\n<span class="k">def</span> <span class="nf">second</span><span class="p">():</span>\n    <span class="k">return</span> <span class="mi">3</span>\n</pre></div><p>After</p>';
const plain = '<p>Intro</p><pre>alpha\n  beta needle-two\ngamma\n</pre><p>After</p>';

describe('a position saved before code lines were boxed', () => {
  for (const [name, markup, needle] of [['a Sphinx listing with token spans', sphinx, 'needle-one'], ['a plain pre', plain, 'needle-two']] as const) {
    it(`still resolves inside ${name}`, () => {
      const { cfi, offset } = saved(markup, needle);
      // The premise: the CFI no longer fits the rebuilt markup.
      const marked = page(markup); markLines(marked);
      let literal: Range | undefined;
      try { literal = CFI.toRange(marked, CFI.parse(cfi)); } catch { /* out of bound */ }
      expect(literal && literal.startContainer.textContent?.slice(literal.startOffset).startsWith(needle)).not.toBe(true);

      const { range } = resolveOn(markup, cfi, offset);
      expect(range.startContainer.textContent?.slice(range.startOffset).startsWith(needle)).toBe(true);
    });
  }

  it('keeps the CFI position outside a listing', () => {
    const { cfi, offset } = saved(sphinx, 'After');
    const { range } = resolveOn(sphinx, cfi, offset);
    expect(range.startContainer.textContent?.slice(range.startOffset)).toBe('After');
  });
});
