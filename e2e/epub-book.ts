import { ZipWriter, Uint8ArrayWriter, TextReader } from '@zip.js/zip.js';

/**
 * A synthetic multi-chapter reflowable EPUB. The title page is in the contents under the book's own title (it is
 * not a chapter); the chapters carry "CHAPTER <roman>" in the way some Project Gutenberg contents do.
 */
export async function chapterBook({ chapters = 4, paragraphs = 40, pageList = false } = {}) {
  const roman = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
  const writer = new ZipWriter(new Uint8ArrayWriter(), { useWebWorkers: false });
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
  for (const [name, text] of Object.entries(files)) await writer.add(name, new TextReader(text), { level: name === 'mimetype' ? 0 : 6, lastModDate: new Date('2026-01-01T00:00:00Z'), extendedTimestamp: false });
  return Buffer.from(await writer.close());
}
