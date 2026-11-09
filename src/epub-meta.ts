// What a library tile needs from an EPUB: its real title, author and cover picture. Only the zip directory
// and the few entries involved are read, through byte ranges, so a 100 MB book is never loaded whole.
import { Reader, ZipReader, type FileEntry } from '@zip.js/zip.js';

export type OpfInfo = { title?: string; creator?: string; coverPath?: string; coverType?: string };
export type EpubMeta = { title?: string; creator?: string; /** Whether the package names a cover picture that the archive holds. */ hasCover: boolean; cover?: Blob };

const dublinCore = 'http://purl.org/dc/elements/1.1/';
const textLimit = 4 * 1024 * 1024, coverLimit = 8 * 1024 * 1024, entryLimit = 20_000;
const coverTypes: Record<string, true> = { 'image/jpeg': true, 'image/png': true, 'image/gif': true, 'image/webp': true, 'image/avif': true, 'image/bmp': true };
const clean = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim() || undefined;

/** The package document's path inside the archive, from `META-INF/container.xml`. */
export function parseContainer(xml: string): string | undefined {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) return undefined;
  return clean(Array.from(doc.getElementsByTagNameNS('*', 'rootfile')).find(node => node.getAttribute('full-path'))?.getAttribute('full-path'));
}

/** `href` as an archive path: relative to the package document's folder, percent-decoded, `.` and `..` resolved. */
export function resolveArchivePath(opfPath: string, href: string): string | undefined {
  let target: string;
  try { target = decodeURIComponent(href.split('#')[0].split('?')[0]); } catch { return undefined; }
  if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('/')) return undefined;
  const parts = opfPath.split('/').slice(0, -1);
  for (const part of target.split('/')) {
    if (part === '..') { if (!parts.length) return undefined; parts.pop(); } else if (part && part !== '.') parts.push(part);
  }
  return parts.join('/');
}

/**
 * Title (first `dc:title`), authors (first three `dc:creator`) and cover of a package document. The cover is the
 * manifest item whose `properties` hold `cover-image` (EPUB 3), else the one `<meta name="cover" content="id">`
 * names (EPUB 2). Only raster pictures count; undefined parts are simply missing.
 */
export function parseOpf(xml: string, opfPath: string): OpfInfo {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) return {};
  const texts = (name: string) => Array.from(doc.getElementsByTagNameNS(dublinCore, name)).map(node => clean(node.textContent)).filter((text): text is string => Boolean(text));
  const items = Array.from(doc.getElementsByTagNameNS('*', 'item'));
  const declared = Array.from(doc.getElementsByTagNameNS('*', 'meta')).find(node => node.getAttribute('name') === 'cover')?.getAttribute('content');
  const item = items.find(node => (node.getAttribute('properties') ?? '').split(/\s+/).includes('cover-image')) ?? (declared ? items.find(node => node.getAttribute('id') === declared) : undefined);
  const href = item?.getAttribute('href'), type = item?.getAttribute('media-type')?.toLowerCase();
  const coverPath = href ? resolveArchivePath(opfPath, href) : undefined;
  const creators = texts('creator').slice(0, 3).join(', ');
  return { title: texts('title')[0], creator: creators || undefined, ...(coverPath && type && Object.hasOwn(coverTypes, type) ? { coverPath, coverType: type } : {}) };
}

/** The bytes of an entry, counted as they inflate: the size the archive declares is not trusted, so a crafted entry stops at `limit`. */
async function inflate(entry: FileEntry, limit: number): Promise<Uint8Array | undefined> {
  if (entry.uncompressedSize > limit) return undefined;
  const chunks: Uint8Array[] = []; let length = 0;
  await entry.getData(new WritableStream<Uint8Array>({ write(chunk) {
    length += chunk.byteLength;
    if (length > limit) throw new Error('An EPUB entry is larger than it declares.');
    chunks.push(chunk.slice());
  } }), { checkSignature: true });
  const bytes = new Uint8Array(length); let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
  return bytes;
}

/** A zip.js reader over byte ranges, so the archive's directory is read from its end without fetching the rest. */
class RangeReader extends Reader<undefined> {
  constructor(private readonly read: (offset: number, length: number) => Promise<Uint8Array>, size: number) { super(undefined); this.size = size; }
  readUint8Array(index: number, length: number) { return this.read(index, Math.min(length, this.size - index)); }
}

/**
 * Reads an EPUB's metadata from `size` bytes served by `read(offset, length)`. `wantCover` also fetches the cover
 * picture; without it only the package document is read. A book with no readable package gives `{ hasCover: false }`.
 */
export async function readEpubMeta(read: (offset: number, length: number) => Promise<Uint8Array>, size: number, wantCover: boolean): Promise<EpubMeta> {
  const archive = new ZipReader(new RangeReader(read, size), { useWebWorkers: false });
  try {
    const entries = new Map<string, FileEntry>(); let count = 0;
    for await (const entry of archive.getEntriesGenerator()) {
      if (++count > entryLimit) return { hasCover: false };
      if (!entry.directory && !entry.encrypted) entries.set(entry.filename, entry as FileEntry);
    }
    const text = async (name: string) => {
      const entry = entries.get(name); const bytes = entry && await inflate(entry, textLimit);
      return bytes && new TextDecoder().decode(bytes);
    };
    const container = await text('META-INF/container.xml'); const opfPath = container && parseContainer(container);
    const opf = opfPath ? await text(opfPath) : undefined;
    if (!opfPath || !opf) return { hasCover: false };
    const info = parseOpf(opf, opfPath);
    const coverEntry = info.coverPath ? entries.get(info.coverPath) : undefined;
    const usable = coverEntry && coverEntry.uncompressedSize <= coverLimit ? coverEntry : undefined;
    const meta: EpubMeta = { title: info.title, creator: info.creator, hasCover: Boolean(usable) };
    if (usable && wantCover) {
      const bytes = await inflate(usable, coverLimit);
      if (bytes) meta.cover = new Blob([bytes as BlobPart], { type: info.coverType }); else meta.hasCover = false;
    }
    return meta;
  } finally { await archive.close().catch(() => undefined); }
}
