// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { blockText, languageOf, outerBlock } from '../src/code-viewer';

const html = (markup: string) => { const root = document.createElement('div'); root.innerHTML = markup; return root; };

describe('languageOf', () => {
  it('reads pandoc\'s class on the pre, not the wrapper\'s own classes', () => {
    const root = html('<div class="sourceCode dark"><pre class="sourceCode python"><code class="sourceCode python">x</code></pre></div>');
    expect(languageOf(root.firstElementChild!)).toBe('python');
  });
  it('ignores pandoc\'s flags when no language is named', () => {
    expect(languageOf(html('<pre class="sourceCode numberSource"><code>x</code></pre>').firstElementChild!)).toBeUndefined();
  });
  it('reads Sphinx\'s highlight-<lang> wrapper, and not its "default"', () => {
    expect(languageOf(html('<div class="highlight-js notranslate"><div class="highlight"><pre>x</pre></div></div>').querySelector('.highlight')!)).toBe('js');
    expect(languageOf(html('<div class="highlight-default"><div class="highlight"><pre>x</pre></div></div>').querySelector('.highlight')!)).toBeUndefined();
  });
  it('reads language-<lang> on a code element', () => {
    expect(languageOf(html('<pre><code class="language-rust">x</code></pre>').firstElementChild!)).toBe('rust');
  });
});

describe('blockText', () => {
  it('keeps whitespace and line breaks exactly, and drops Sphinx line numbers', () => {
    const root = html('<div class="highlight"><table class="highlighttable"><tr><td class="linenos"><div class="linenodiv"><pre>1\n2</pre></div></td><td class="code"><div class="highlight"><pre><span></span>a\n    b<span class="linenos"> 3</span>\n</pre></div></td></tr></table></div>');
    expect(blockText(root.firstElementChild!)).toBe('a\n    b\n');
  });
  it('writes a <br> as a line break', () => {
    expect(blockText(html('<pre>a<br/>  b</pre>').firstElementChild!)).toBe('a\n  b');
  });
});

describe('outerBlock', () => {
  it('is the wrapper around a pre, from anywhere inside it', () => {
    const root = html('<div class="sourceCode"><pre><code><span>x</span></code></pre></div>');
    expect(outerBlock(root.querySelector('span'))).toBe(root.firstElementChild);
    expect(outerBlock(root.querySelector('span')!.firstChild)).toBe(root.firstElementChild);
  });
  it('is null outside a block and in a line-number column', () => {
    expect(outerBlock(html('<p>text</p>').firstElementChild)).toBeNull();
    expect(outerBlock(html('<div class="linenodiv"><pre>1</pre></div>').querySelector('pre'))).toBeNull();
  });
});
