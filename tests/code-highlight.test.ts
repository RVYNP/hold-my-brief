// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../src/adapters/text';
import { highlightCode } from '../src/code-highlight';

const textOf = (html: string) => { const element = document.createElement('div'); element.innerHTML = html; return element.textContent; };

describe('highlightCode', () => {
  it('names the sixteen languages and their aliases, and nothing else', () => {
    const samples: Record<string, string> = {
      bash: 'if true; then echo "x"; fi', shell: '$ npm install', javascript: 'const a = 1;', typescript: 'const a: number = 1;', json: '{"a": 1}',
      python: 'def f(): return 1', css: 'a { color: red; }', xml: '<a href="b">c</a>', markdown: '# Title\n\n- item', yaml: 'a: 1', sql: 'SELECT 1 FROM t;',
      rust: 'fn main() { let x = 1; }', go: 'func main() { x := 1 }', swift: 'func f() -> Int { return 1 }', diff: '-a\n+b',
      sh: 'if true; then echo "x"; fi', zsh: 'if true; then echo "x"; fi', console: 'if true; then echo "x"; fi', js: 'const a = 1;', jsx: 'const a = 1;', ts: 'const a: number = 1;', tsx: 'const a: number = 1;',
      py: 'def f(): return 1', html: '<a href="b">c</a>', yml: 'a: 1', md: '# Title\n\n- item',
    };
    for (const [language, code] of Object.entries(samples)) {
      const html = highlightCode(code, language);
      expect(html, language).not.toBeNull();
      expect(html, language).toContain('hljs-');
      expect(textOf(html!), language).toBe(code);
    }
    expect(highlightCode('plain text', 'plaintext')).toBe('plain text');
  });

  it('sends console to bash, not to the shell session language', () => {
    expect(highlightCode('echo $HOME # home', 'console')).toBe(highlightCode('echo $HOME # home', 'bash'));
  });

  it('leaves an unknown or missing language, and names on the object prototype, uncoloured', () => {
    for (const language of ['', 'foo', 'constructor', '__proto__', 'toString', 'hasOwnProperty']) expect(highlightCode('const a = 1;', language), language).toBeNull();
  });

  it('does not detect a language', () => {
    expect(renderMarkdown('```\nconst a = 1;\nfunction f() { return "x"; }\n```').html).not.toContain('hljs-');
  });

  it('keeps the text exact: markup in the source is escaped, tabs and blank lines stay', () => {
    const code = '<script>alert("x" && \'y\')</script>\n\n\tconst a = 1;\n';
    const html = highlightCode(code, 'js')!;
    expect(html).not.toContain('<script>');
    expect(textOf(html)).toBe(code);
  });

  it('colours up to 2,000 lines and leaves a longer block plain', () => {
    const lines = (count: number) => Array.from({ length: count }, (_, i) => `const v${i} = ${i};`).join('\n');
    // A fence's text ends with a line break.
    for (const end of ['', '\n']) {
      expect(highlightCode(lines(2000) + end, 'js'), JSON.stringify(end)).toContain('hljs-keyword');
      expect(highlightCode(lines(2001) + end, 'js'), JSON.stringify(end)).toBeNull();
    }
  });

  it('leaves a block over 200 KB plain, counting bytes, not characters', () => {
    const ascii = '// ' + 'a'.repeat(200 * 1024 - 4);
    expect(highlightCode(ascii, 'js')).toContain('hljs-comment');
    expect(highlightCode(ascii + 'aa', 'js')).toBeNull();
    // 70,000 three-byte characters are 210,000 bytes in 70,000 characters.
    expect(highlightCode('// ' + '€'.repeat(70000), 'js')).toBeNull();
    expect(highlightCode('// ' + '€'.repeat(60000), 'js')).toContain('hljs-comment');
  });
});

describe('a Markdown fence', () => {
  it('puts the token spans inside the existing code element and keeps the label', () => {
    const html = renderMarkdown('```ts\nconst a = 1;\n```').html;
    expect(html).toContain('<span class="code-lang">ts</span>');
    expect(html).toContain('<code><span class="hljs-keyword">const</span> a = <span class="hljs-number">1</span>;\n</code>');
    const unknown = renderMarkdown('```foo\nconst a = 1;\n```').html;
    expect(unknown).toContain('<span class="code-lang">foo</span>');
    expect(unknown).toContain('<code>const a = 1;\n</code>');
  });

  it('colours by the first word of the info string, in any case', () => {
    expect(renderMarkdown('```TS {1,3}\nconst a = 1;\n```').html).toContain('hljs-keyword');
  });
});
