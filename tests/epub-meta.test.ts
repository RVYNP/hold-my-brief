// @vitest-environment jsdom
import { BlobWriter, TextReader, Uint8ArrayReader, ZipWriter } from '@zip.js/zip.js';
import { describe, expect, it } from 'vitest';
import { parseContainer, parseOpf, readEpubMeta, resolveArchivePath } from '../src/epub-meta';

const opf = (metadata: string, manifest: string) => `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata>${metadata}</metadata><manifest>${manifest}</manifest></package>`;

describe('container', () => {
  it('names the package document', () => {
    expect(parseContainer('<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="EPUB/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')).toBe('EPUB/content.opf');
    expect(parseContainer('<container><rootfiles/></container>')).toBeUndefined();
    expect(parseContainer('not xml <<<')).toBeUndefined();
  });
});

describe('archive paths', () => {
  it('resolves an href against the package folder', () => {
    expect(resolveArchivePath('EPUB/content.opf', 'images/cover.jpg')).toBe('EPUB/images/cover.jpg');
    expect(resolveArchivePath('content.opf', 'cover.jpg')).toBe('cover.jpg');
    expect(resolveArchivePath('OEBPS/content.opf', '../cover.png')).toBe('cover.png');
    expect(resolveArchivePath('OEBPS/content.opf', 'my%20cover.png#x')).toBe('OEBPS/my cover.png');
    expect(resolveArchivePath('content.opf', '../../x.png')).toBeUndefined();
    expect(resolveArchivePath('content.opf', 'https://example.test/c.jpg')).toBeUndefined();
    expect(resolveArchivePath('content.opf', '/abs.png')).toBeUndefined();
  });
});

describe('package document', () => {
  it('reads the title, the authors and an EPUB 3 cover-image item', () => {
    const info = parseOpf(opf('<dc:title id="t">  The Rust\n  Programming Language </dc:title><dc:title>Second</dc:title><dc:creator>Steve Klabnik</dc:creator><dc:creator>Carol Nichols</dc:creator><dc:creator>C</dc:creator><dc:creator>D</dc:creator>', '<item id="img" href="images/c.png" media-type="image/png" properties="cover-image"/><item id="x" href="x.png" media-type="image/png"/>'), 'EPUB/content.opf');
    expect(info).toEqual({ title: 'The Rust Programming Language', creator: 'Steve Klabnik, Carol Nichols, C', coverPath: 'EPUB/images/c.png', coverType: 'image/png' });
  });
  it('reads an EPUB 2 cover named by <meta name="cover">', () => {
    const info = parseOpf(opf('<dc:title>Pride and Prejudice</dc:title><dc:creator opf:file-as="Austen, Jane" xmlns:opf="http://www.idpf.org/2007/opf">Jane Austen</dc:creator><meta name="cover" content="id-1"/>', '<item href="3217_cover.jpg" id="id-1" media-type="image/jpeg"/><item href="a.css" id="css" media-type="text/css"/>'), 'OEBPS/content.opf');
    expect(info).toEqual({ title: 'Pride and Prejudice', creator: 'Jane Austen', coverPath: 'OEBPS/3217_cover.jpg', coverType: 'image/jpeg' });
  });
  it('prefers cover-image over the meta form, and tolerates other properties', () => {
    const info = parseOpf(opf('<dc:title>T</dc:title><meta name="cover" content="old"/>', '<item id="old" href="old.jpg" media-type="image/jpeg"/><item id="new" href="new.jpg" media-type="image/jpeg" properties="svg cover-image"/>'), 'content.opf');
    expect(info.coverPath).toBe('new.jpg');
  });
  it('copes with a missing title, no cover, a vector or unknown cover type, and broken markup', () => {
    expect(parseOpf(opf('<dc:creator>Someone</dc:creator>', ''), 'c.opf')).toEqual({ title: undefined, creator: 'Someone' });
    expect(parseOpf(opf('<dc:title>   </dc:title>', ''), 'c.opf').title).toBeUndefined();
    expect(parseOpf(opf('<dc:title>T</dc:title>', '<item id="s" href="c.svg" media-type="image/svg+xml" properties="cover-image"/>'), 'c.opf').coverPath).toBeUndefined();
    expect(parseOpf(opf('<dc:title>T</dc:title><meta name="cover" content="gone"/>', ''), 'c.opf').coverPath).toBeUndefined();
    expect(parseOpf('<package><metadata>', 'c.opf')).toEqual({});
  });
});

describe('reading an archive by ranges', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
  async function build(title: string, withCover: boolean) {
    const writer = new ZipWriter(new BlobWriter('application/epub+zip'), { useWebWorkers: false });
    await writer.add('mimetype', new TextReader('application/epub+zip'), { level: 0 });
    await writer.add('META-INF/container.xml', new TextReader('<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>'));
    await writer.add('OEBPS/content.opf', new TextReader(opf(`<dc:title>${title}</dc:title><dc:creator>A. Writer</dc:creator>`, withCover ? '<item id="c" href="cover.png" media-type="image/png" properties="cover-image"/>' : '')));
    if (withCover) await writer.add('OEBPS/cover.png', new Uint8ArrayReader(png));
    // A large chapter that must never be fetched.
    await writer.add('OEBPS/big.xhtml', new TextReader('x'.repeat(5_000_000)), { level: 0 });
    return new Uint8Array(await (await writer.close()).arrayBuffer());
  }
  const source = (bytes: Uint8Array) => { const reads: number[] = []; return { reads, read: async (offset: number, length: number) => { reads.push(length); return bytes.slice(offset, offset + length); } }; };

  it('gets the title, authors and cover without reading the whole book', async () => {
    const bytes = await build('A Fine Book', true), { read, reads } = source(bytes);
    const meta = await readEpubMeta(read, bytes.length, true);
    expect(meta.title).toBe('A Fine Book'); expect(meta.creator).toBe('A. Writer'); expect(meta.hasCover).toBe(true);
    expect(meta.cover?.type).toBe('image/png');
    expect(new Uint8Array(await meta.cover!.arrayBuffer())).toEqual(png);
    expect(reads.reduce((sum, length) => sum + length, 0)).toBeLessThan(bytes.length / 4);
  });
  it('skips the cover when it is not wanted, and reports a book with none', async () => {
    const bytes = await build('No Cover', false);
    const bare = await readEpubMeta(source(bytes).read, bytes.length, true);
    expect(bare).toMatchObject({ title: 'No Cover', hasCover: false }); expect(bare.cover).toBeUndefined();
    const covered = await build('Covered', true);
    const skipped = await readEpubMeta(source(covered).read, covered.length, false);
    expect(skipped).toMatchObject({ title: 'Covered', hasCover: true }); expect(skipped.cover).toBeUndefined();
  });
  it('treats something that is not a zip as having no metadata', async () => {
    await expect(readEpubMeta(async () => new Uint8Array(100), 100, true)).rejects.toThrow();
  });
});
