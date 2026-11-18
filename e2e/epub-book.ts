import { ZipWriter, Uint8ArrayWriter, TextReader } from '@zip.js/zip.js';

/**
 * A synthetic multi-chapter reflowable EPUB. The title page is in the contents under the book's own title (it is
 * not a chapter); the chapters carry "CHAPTER <roman>" in the way some Project Gutenberg contents do.
 * `code` puts a `<pre>` sample and a table at the head of every chapter, as a reference book has them; `nested` lists a
 * subsection under the first chapter's contents entry, pointing part-way into that chapter.
 */
export async function chapterBook({ chapters = 4, paragraphs = 40, pageList = false, code = false, nested = false } = {}) {
  const roman = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
  const ids = Array.from({ length: chapters }, (_, i) => `c${i + 1}`);
  const label = (i: number) => `A remark that ends in a stop. CHAPTER ${roman[i]}.`;
  const files: Record<string, string> = {
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    'OPS/book.opf': `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">chapter-book-${chapters}-${paragraphs}-${pageList}</dc:identifier><dc:title>THE GENERATED BOOK</dc:title><dc:language>en</dc:language></metadata><manifest><item id="title" href="title.xhtml" media-type="application/xhtml+xml"/>${ids.map(id => `<item id="${id}" href="${id}.xhtml" media-type="application/xhtml+xml"/>`).join('')}<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine><itemref idref="title"/>${ids.map(id => `<itemref idref="${id}"/>`).join('')}</spine></package>`,
    'OPS/nav.xhtml': `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol><li><a href="title.xhtml">THE GENERATED   BOOK.</a></li>${ids.map((id, i) => `<li><a href="${id}.xhtml">${label(i)}</a></li>`).join('')}</ol></nav>${pageList ? `<nav epub:type="page-list"><ol>${ids.flatMap((id, i) => [0, 1, 2, 3, 4, 5].map(n => `<li><a href="${id}.xhtml#p${n * 7}">${i * 6 + n + 1}</a></li>`)).join('')}</ol></nav>` : ''}</body></html>`,
    'OPS/title.xhtml': '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Title</title></head><body><h1>THE GENERATED BOOK</h1><p>A synthetic book made by the test suite.</p></body></html>',
  };
  ids.forEach((id, i) => {
    files[`OPS/${id}.xhtml`] = `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${id}</title></head><body><h1>Chapter heading ${i + 1}</h1>${Array.from({ length: paragraphs }, (_, n) => `<p id="p${n}">Passage ${n + 1} of chapter ${i + 1}: the reader keeps a stable place beside your work, and this paragraph supplies natural flowing text across several displayed pages of the generated book.</p>`).join('')}</body></html>`;
  });
  if (code) for (const id of ids) files[`OPS/${id}.xhtml`] = files[`OPS/${id}.xhtml`].replace('</h1>', `</h1><pre>${Array.from({ length: 12 }, (_, n) => `const total${n} = values.reduce((sum, value) => sum + value * ${n}, 0);`).join('\n')}</pre><table><tr><th>Name</th><th>Meaning</th></tr><tr><td>total</td><td>a running sum</td></tr></table>`);
  if (nested) files['OPS/nav.xhtml'] = files['OPS/nav.xhtml'].replace(/(<a href="c1\.xhtml">[^<]*<\/a>)/, '$1<ol><li><a href="c1.xhtml#p20">A subsection</a></li></ol>');
  files['OPS/book.opf'] = files['OPS/book.opf'].replace('</dc:identifier>', `-${code}-${nested}</dc:identifier>`);
  return pack(files);
}

/**
 * A two-chapter EPUB whose first spine item is declared `application/xml` and holds what a hostile book would: a frame, a form, a
 * remote image, a remote stylesheet url and a redirect. The second chapter is ordinary XHTML.
 */
export async function xmlChapterBook(remote = 'https://example.invalid') {
  const xhtml = (body: string, head = '') => `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title>${head}</head><body>${body}</body></html>`;
  return pack({
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    'OPS/book.opf': '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">xml-chapter-book</dc:identifier><dc:title>XML CHAPTER BOOK</dc:title><dc:language>en</dc:language></metadata><manifest><item id="x1" href="x1.xml" media-type="application/xml"/><item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine><itemref idref="x1"/><itemref idref="c2"/></spine></package>',
    'OPS/nav.xhtml': xhtml('<nav xmlns:epub="http://www.idpf.org/2007/ops" epub:type="toc"><ol><li><a href="x1.xml">First</a></li><li><a href="c2.xhtml">Second</a></li></ol></nav>'),
    'OPS/x1.xml': xhtml(`<h1>Declared as plain XML</h1><p style="background:url(${remote}/inline.png)">The first chapter text is still here.</p><iframe src="${remote}/frame.html"></iframe><form action="${remote}/post"><input name="q"/></form><img src="${remote}/x.png" alt="remote"/>`, `<style>p { background-image: url(${remote}/sheet.png); }</style><meta http-equiv="refresh" content="0;url=${remote}/away.html"/><meta name="viewport" http-equiv="refresh" content="width=800"/>`),
    'OPS/c2.xhtml': xhtml('<h1>Second chapter</h1><p>Ordinary text of the second chapter.</p>'),
  });
}

async function pack(files: Record<string, string>) {
  const writer = new ZipWriter(new Uint8ArrayWriter(), { useWebWorkers: false });
  for (const [name, text] of Object.entries(files)) await writer.add(name, new TextReader(text), { level: name === 'mimetype' ? 0 : 6, lastModDate: new Date('2026-01-01T00:00:00Z'), extendedTimestamp: false });
  return Buffer.from(await writer.close());
}

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** Wraps keywords, strings and comments of one line of synthetic Python in `<span class="...">`; `classes` names the three. */
function highlight(line: string, classes: { keyword: string; string: string; comment: string }) {
  return escapeHtml(line).replace(/(#.*$)|("[^"]*")|\b(def|return|import|for|in|if|else|with|as)\b/g, (_, comment, string, keyword) =>
    `<span class="${comment ? classes.comment : string ? classes.string : classes.keyword}">${comment ?? string ?? keyword}</span>`);
}
const pandocClasses = { keyword: 'kw', string: 'st', comment: 'co' };
const sphinxClasses = { keyword: 'k', string: 's2', comment: 'c1' };
/** Pandoc's own markup: a `div.sourceCode` around a `pre`, one `span` per line, each opening with an empty anchor. */
function pandocBlock(id: number, lines: string[], wrapperClass = '') {
  const body = lines.map((line, i) => `<span id="cb${id}-${i + 1}"><a href="#cb${id}-${i + 1}" aria-hidden="true" tabindex="-1"></a>${highlight(line, pandocClasses)}</span>`).join('\n');
  return `<div class="sourceCode${wrapperClass}" id="cb${id}"><pre class="sourceCode python"><code class="sourceCode python">${body}</code></pre></div>`;
}
/** Sphinx's markup: `div.highlight > pre` holding token spans and the line breaks themselves. */
const sphinxBlock = (lines: string[]) => `<div class="highlight-python notranslate"><div class="highlight"><pre><span></span>${lines.map(line => highlight(line, sphinxClasses)).join('\n')}\n</pre></div></div>`;
/** A synthetic call of `length` characters at least: the long lines a reference book wraps. */
const longLine = (n: number) => `    result_${n} = client.submit(graph=build_graph(prompt="synthetic prompt number ${n}", steps=${20 + n}, sampler="euler", seed=${1000 + n}), timeout=${30 + n})`;
const shortLine = (n: number) => `    total_${n} = values[${n}] * scale + offset  # a short step`;

/**
 * A synthetic reflowable EPUB shaped like pandoc's (and Sphinx's) output, with the publisher CSS that makes code a nowrap scroll box:
 * `pre > code.sourceCode { white-space: pre }`, `div.sourceCode { overflow: auto }`, per-line spans at `line-height: 1.25`, light code
 * backgrounds, and one dark block (`div.sourceCode.dark`, Monokai colours). One chapter holds a pandoc block of 100-140 character lines, an indented block, an inline `<code>`, a 60-line block, the dark block and a
 * Sphinx `div.highlight`, among prose.
 */
export async function codeBook() {
  const css = `code { white-space: pre-wrap; }
span.smallcaps { font-variant: small-caps; }
pre > code.sourceCode { white-space: pre; position: relative; }
pre > code.sourceCode > span { display: inline-block; line-height: 1.25; }
pre > code.sourceCode > span:empty { height: 1.2em; }
.sourceCode { overflow: visible; }
code.sourceCode > span { color: inherit; text-decoration: inherit; }
div.sourceCode { margin: 1em 0; background-color: #f8f8f8; border-left: 4px solid #cccccc; }
pre.sourceCode { margin: 0; padding: 0.5em; background-color: #f0f0f0; border-left: 3px solid #aaaaaa; }
@media screen { div.sourceCode { overflow: auto; } }
@media print { pre > code.sourceCode { white-space: pre-wrap; } pre > code.sourceCode > span { text-indent: -5em; padding-left: 5em; } }
code span.kw { color: #204a87; font-weight: bold; }
code span.st { color: #4e9a06; }
code span.co { color: #8f5902; font-style: italic; }
div.sourceCode.dark { background-color: #272822; border-left-color: #75715e; color: #f8f8f2; }
div.sourceCode.dark pre.sourceCode { background-color: transparent; border-left: 0; }
div.sourceCode.dark code span.kw { color: #a6e22e; }
div.sourceCode.dark code span.st { color: #f8f8f2; }
.highlight { background: #f3f3f3; border-left: 4px solid #cccccc; margin: 1em 0; }
.highlight pre { line-height: 125%; margin: 0; overflow-x: auto; }
.highlight .k { color: #007020; font-weight: bold; }
.highlight .s2 { color: #4070a0; }
.highlight .c1 { color: #60a0b0; font-style: italic; }`;
  const long = Array.from({ length: 6 }, (_, n) => longLine(n + 1)), mixed = ['def run(job):', ...long.slice(0, 2), '    return job', '', '# done'];
  const indented = ['def outer(items):', '    for item in items:', '        if item:', '            with open(item) as handle:', '                return handle.read()', '    return None'];
  const sixty = Array.from({ length: 60 }, (_, n) => n % 9 === 8 ? longLine(n + 1) : n % 5 === 4 ? '' : shortLine(n + 1));
  const dark = ['def tint(job):', '    return job.run("synthetic")  # dark block on any page', '', 'for job in jobs:', '    tint(job)'];
  const sphinx = ['import json', '', 'def load(path):', ...long.slice(2, 4), '    return json.loads(path)  # synthetic'];
  const prose = (n: number) => `<p>Paragraph ${n}: the reader keeps a stable place beside your work, and this synthetic paragraph supplies ordinary flowing text between the listings of the generated book.</p>`;
  const chapter = `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Code</title><link rel="stylesheet" type="text/css" href="style.css"/></head><body><h1 id="code">Code listings</h1>${prose(1)}<p>Call <code>client.submit(graph)</code> inside a paragraph to queue a job.</p>${pandocBlock(1, mixed)}${prose(2)}${pandocBlock(2, indented)}${prose(3)}${pandocBlock(3, sixty)}${prose(4)}${pandocBlock(4, dark, ' dark')}${prose(5)}${sphinxBlock(sphinx)}${prose(6)}</body></html>`;
  return pack({
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    'OPS/book.opf': '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">code-book-1</dc:identifier><dc:title>THE CODE BOOK</dc:title><dc:language>en</dc:language></metadata><manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/><item id="css" href="style.css" media-type="text/css"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine><itemref idref="c1"/></spine></package>',
    'OPS/nav.xhtml': '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol><li><a href="c1.xhtml">Code listings</a></li></ol></nav></body></html>',
    'OPS/style.css': css,
    'OPS/c1.xhtml': chapter,
  });
}

/**
 * A synthetic reflowable EPUB shaped like pandoc's and Sphinx's output, with publisher boxes that paint their own light background: `div.note`
 * on `#f1f6fb` and `div.warning` on `#fff5ee`, each with a coloured left border (the note inherits its text colour, the warning sets a dark one),
 * a table whose header cells are shaded, an `<aside>`, and a link inside the note. `night` adds `div.night`, a publisher-dark box with dark text
 * of its own, which is what a light page has to map the other way.
 */
export async function calloutBook({ night = false } = {}) {
  const css = `div.note { background-color: #f1f6fb; border-left: 4px solid #2f6db5; padding: 0.5em 1em; margin: 1em 0; }
div.warning { background-color: #fff5ee; border-left: 4px solid #c4561a; color: #5a2a00; padding: 0.5em 1em; margin: 1em 0; }
div.note p, div.warning p { margin: 0.4em 0; }
div.note .title, div.warning .title { font-weight: bold; }
table.reference { border-collapse: collapse; margin: 1em 0; }
table.reference th { background-color: #e8edf3; border: 1px solid #9aa7b5; padding: 0.3em 0.6em; }
table.reference td { border: 1px solid #9aa7b5; padding: 0.3em 0.6em; }
aside { background-color: #f6f3e8; border: 1px solid #b8ab7c; border-left: 4px solid #8a7a2f; padding: 0.5em 1em; margin: 1em 0; }
div.night { background-color: #1f2933; border-left: 4px solid #2a3f5f; color: #243447; padding: 0.5em 1em; margin: 1em 0; }
hr.rule { border: 0; height: 2px; background-color: #ccc; }${night ? '\nhr.dark-rule { border: 0; height: 2px; background-color: #333; }' : ''}`;
  const prose = (n: number) => `<p>Paragraph ${n}: the reader keeps a stable place beside your work, and this synthetic paragraph supplies ordinary flowing text between the boxes of the generated book.</p>`;
  const chapter = `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Callouts</title><link rel="stylesheet" type="text/css" href="style.css"/></head><body><h1 id="callouts">Callouts</h1>${prose(1)}<div class="note"><p class="title">Note</p><p>A note keeps its own pale blue box. See <a href="https://example.invalid/docs">the documentation</a> for the details of every setting.</p></div>${prose(2)}<div class="warning"><p class="title">Warning</p><p>A warning keeps its own pale warm box, and its own dark text colour, whatever the page around it is.</p></div>${prose(3)}<table class="reference"><tr><th>Name</th><th>Meaning</th></tr><tr><td>total</td><td>a running sum</td></tr></table>${prose(4)}<aside><p>An aside sits in its own pale box beside the main text, and says one more thing.</p></aside>${prose(5)}<hr class="rule"/>${prose(7)}${night ? '<div class="night"><p>A publisher-dark box with dark text of its own, which a light page maps to a light box.</p></div>' + prose(6) + '<hr class="dark-rule"/>' + prose(8) : ''}</body></html>`;
  return pack({
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    'OPS/book.opf': `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">callout-book-${night}</dc:identifier><dc:title>THE CALLOUT BOOK</dc:title><dc:language>en</dc:language></metadata><manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/><item id="css" href="style.css" media-type="text/css"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine><itemref idref="c1"/></spine></package>`,
    'OPS/nav.xhtml': '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol><li><a href="c1.xhtml">Callouts</a></li></ol></nav></body></html>',
    'OPS/style.css': css,
    'OPS/c1.xhtml': chapter,
  });
}
