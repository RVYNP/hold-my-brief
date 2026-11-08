import { invoke, isTauri } from '@tauri-apps/api/core';
import type { Format, Locator, ReaderOptions } from './types';
import { getBrowserFile, getBrowserLibrary, mutateBrowserLibrary } from './library-store';
import type { Library, LibraryChange, LibraryDocument } from './catalog-types';
import { applyLibraryChange, localDocument, requireCollection } from './library-model';
export type { Library, LibraryChange, LibraryDocument, Collection } from './catalog-types';
export const desktop = isTauri();
export type WindowState = { width: number; height: number; pinned: boolean; locked: boolean };
export type Recent = { path: string; name: string; format: Format; lastOpened: number | string };
export type Saved = { locator: Locator; options: ReaderOptions };
export type Opened = { id: string; path: string; name: string; format: Format; bytes: Uint8Array; previousState?: Saved; warning?: string };
export type OpenedMeta = Omit<Opened, 'bytes'>;
export type State = { recents: Recent[]; window: WindowState; warning?: string };
export const imageFormats: Record<string, true> = { png: true, jpg: true, jpeg: true, webp: true, gif: true, avif: true, bmp: true };

// Failed renders can be garbage-collected together with their pending file.
const pendingFiles = new WeakMap<Opened, File>();
const confirmed = new WeakSet<Opened>();
export const native = <T>(command: string, args?: Record<string, unknown>) => invoke<T>(command, args);
export async function state(): Promise<State> {
  return desktop ? native('get_state') : { recents: [], window: { width: 420, height: 620, pinned: false, locked: false } };
}
function fileFormat(file: File): Format {
  const ext = file.name.split('.').pop()?.toLowerCase();
  const format = ext === 'markdown' ? 'md' : ext;
  if (!['pdf', 'epub', 'md', 'txt', ...Object.keys(imageFormats)].includes(format ?? '')) throw Error('Choose PDF, EPUB, Markdown, text, or a supported image.');
  if (file.size > 300 * 1024 * 1024) throw Error('This candidate supports files up to 300 MiB.');
  return format as Format;
}
export async function browserFile(file: File): Promise<Opened> {
  return readBrowserFile(file);
}
/** A browser file has no stable path, so its identity is its content: the same bytes under the same name are the same document, however and whenever they are picked. */
async function browserIdentity(file: File, buffer: ArrayBuffer): Promise<{ id: string; path: string }> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  const id = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  return { id, path: `${id}/${file.name}` };
}
async function readBrowserFile(file: File, path?: string): Promise<Opened> {
  const format = fileFormat(file);
  const buffer = await file.arrayBuffer();
  const identity = await browserIdentity(file, buffer);
  const saved = localStorage.getItem(`hold-my-brief:${identity.id}`);
  const doc: Opened = { id: identity.id, path: path ?? identity.path, name: file.name, format, bytes: new Uint8Array(buffer), previousState: saved ? JSON.parse(saved) : undefined };
  pendingFiles.set(doc, file);
  return doc;
}

export async function getLibrary(): Promise<Library> {
  return desktop ? native('get_library') : getBrowserLibrary();
}


export async function editLibrary(change: LibraryChange): Promise<Library> {
  if (desktop) return native('edit_library', { change });
  return mutateBrowserLibrary((library, files) => {
    applyLibraryChange(library, change);
    if (change.action === 'removeDocument') files.delete(change.path);
  });
}

export async function addDocuments(collectionId: string | null, files?: File[]): Promise<Library> {
  if (desktop) return native('add_documents', { collectionId });
  if (!files?.length) return getBrowserLibrary();
  // One buffer alive at a time: a multi-file pick of large originals must not be held in memory together.
  const additions: { file: File; document: LibraryDocument }[] = [];
  for (const file of files) {
    const format = fileFormat(file);
    const { path } = await browserIdentity(file, await file.arrayBuffer());
    additions.push({ file, document: localDocument(path, file.name, format, collectionId) });
  }
  return mutateBrowserLibrary((library, storedFiles) => {
    requireCollection(library, collectionId);
    if (collectionId && library.collections.find(collection => collection.id === collectionId)?.sourceId) throw Error('Add files to a personal collection, not an indexed folder collection.');
    for (const { file, document } of additions) {
      // Same identity as the desktop catalog (which keys on the canonical path): adding a file already in the library only files it into the collection.
      const existing = library.documents.find(item => item.path === document.path);
      if (existing) {
        if (collectionId && !existing.collectionIds.includes(collectionId)) existing.collectionIds.push(collectionId);
        continue;
      }
      storedFiles.put({ file, name: file.name, lastModified: file.lastModified }, document.path);
      library.documents.push(document);
    }
  });
}

export async function openLibraryDocument(path: string): Promise<Opened> {
  if (desktop) {
    const meta = await native<OpenedMeta | null>('open_library_document', { path });
    if (!meta) throw Error('No document was opened.');
    return attachBytes(meta);
  }
  return readBrowserFile(await getBrowserFile(path), path);
}

/** Fetches a document's bytes as a raw IPC payload and returns its full Opened record. */
async function attachBytes(meta: OpenedMeta): Promise<Opened> {
  const buffer = await native<ArrayBuffer>('read_document_bytes', { path: meta.path });
  return { ...meta, bytes: new Uint8Array(buffer) };
}

/** Native Open command (dialog or CLI path). Returns null when the dialog is cancelled. */
export async function chooseDocument(path?: string | null): Promise<Opened | null> {
  if (!desktop) return null;
  const meta = await native<OpenedMeta | null>('open_file', { path: path ?? null });
  if (!meta) return null;
  return attachBytes(meta);
}

export async function confirmDocument(doc: Opened): Promise<void> {
  if (desktop) {
    await native('confirm_open', { id: doc.id, path: doc.path });
    return;
  }
  if (confirmed.has(doc)) return;
  const file = pendingFiles.get(doc);
  if (!file) throw Error('The original document is unavailable. Open it again to save it in the library.');
  await mutateBrowserLibrary((library, files) => {
    const existing = library.documents.find(document => document.path === doc.path);
    if (existing) {
      existing.name = doc.name;
      existing.format = doc.format;
      existing.lastOpened = Date.now();
    } else {
      files.put({ file, name: file.name, lastModified: file.lastModified }, doc.path);
      library.documents.push({ ...localDocument(doc.path, doc.name, doc.format), lastOpened: Date.now() });
    }
  });
  confirmed.add(doc);
  pendingFiles.delete(doc);
}
export async function persist(doc: Opened, locator: Locator, options: ReaderOptions) {
  if (desktop) await native('save_position', { id: doc.id, path: doc.path, name: doc.name, format: doc.format, locator, options });
  else localStorage.setItem(`hold-my-brief:${doc.id}`, JSON.stringify({ locator, options }));
}
export async function openExternal(url: string) {
  if (!/^https?:\/\//i.test(url)) throw Error('Only web links can be opened externally.');
  if (desktop) await native('open_external', { url });
  else window.open(url, '_blank', 'noopener,noreferrer');
}

function requireDesktop() {
  if (!desktop) throw Error('Folder indexing and source locations are available in the desktop app.');
}
export async function chooseSourceRoot(id: string): Promise<Library> {
  requireDesktop();
  return native('choose_source_root', { id });
}
export async function locateLibraryDocument(path: string): Promise<Library> {
  requireDesktop();
  return native('locate_library_document', { path });
}
/** Asks for a folder and indexes its PDFs. Cancelling returns the unchanged library. */
export async function indexFolder(): Promise<Library> {
  requireDesktop();
  return native('index_folder');
}
/** A thumbnail ready to show: a JPEG (or, in the browser build, WebP) and its pixel size. */
export type LibraryThumbnail = { width: number; height: number; blob: Blob; /** Names the exact state of the original this was made from; the native cache refuses a save made from an older one. */ key?: string };
/** Length of a cache key, which the native side sends ahead of thumbnails and range reads. */
const keyLength = 32;
const decodeKey = (bytes: ArrayBuffer, offset: number) => new TextDecoder().decode(new Uint8Array(bytes, offset, keyLength));
// A cached thumbnail travels as `[width u32 BE][height u32 BE][jpeg]`, the same bytes the disk cache holds.
const thumbnailHeader = 8;
/**
 * The thumbnail the native side already has or can scale itself (every image format but AVIF). `null`
 * means "not available natively": PDFs and AVIF are rendered by the webview (src/thumbnails.ts) and
 * handed back through `putLibraryThumbnail`.
 */
export async function readLibraryThumbnail(path: string): Promise<LibraryThumbnail | null> {
  if (desktop) {
    const buffer = await native<ArrayBuffer>('read_library_thumbnail', { path });
    if (buffer.byteLength <= keyLength + thumbnailHeader) return null;
    const view = new DataView(buffer, keyLength);
    return { width: view.getUint32(0), height: view.getUint32(4), blob: new Blob([buffer.slice(keyLength + thumbnailHeader)], { type: 'image/jpeg' }), key: decodeKey(buffer, 0) };
  }
  const file = await getBrowserFile(path);
  if (!Object.hasOwn(imageFormats, file.name.split('.').pop()?.toLowerCase() ?? '') || file.name.toLowerCase().endsWith('.avif')) return null;
  const image = await createImageBitmap(file, { resizeWidth: 320, resizeQuality: 'medium' });
  try { return await canvasThumbnail(image, image.width, image.height, 'image/webp'); } finally { image.close(); }
}
/** Draws `source` at `width` x `height` and encodes it; shared by the AVIF and PDF paths. */
export async function canvasThumbnail(source: CanvasImageSource, width: number, height: number, type: 'image/jpeg' | 'image/webp' = 'image/jpeg'): Promise<LibraryThumbnail> {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw Error('Image previews are unavailable.');
  context.fillStyle = '#ffffff'; context.fillRect(0, 0, width, height); context.drawImage(source, 0, 0, width, height);
  return encodeCanvas(canvas, type);
}
export async function encodeCanvas(canvas: HTMLCanvasElement, type: 'image/jpeg' | 'image/webp' = 'image/jpeg'): Promise<LibraryThumbnail> {
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(Error('Could not create image preview.')), type, 0.82));
  return { width: canvas.width, height: canvas.height, blob };
}
/** Stores a webview-rendered JPEG thumbnail in the native cache. The browser build keeps it in memory only. */
export async function putLibraryThumbnail(path: string, thumbnail: LibraryThumbnail): Promise<void> {
  if (!desktop || !thumbnail.key) return;
  const header = new Uint8Array(thumbnailHeader); const view = new DataView(header.buffer);
  view.setUint32(0, thumbnail.width); view.setUint32(4, thumbnail.height);
  const body = new Uint8Array(await new Blob([header, thumbnail.blob]).arrayBuffer());
  await invoke('put_library_thumbnail', body, { headers: { 'x-library-path': encodeURIComponent(path), 'x-library-key': thumbnail.key } });
}
/** What the disk cache already knows about a thumbnail: pixel size and dominant colours (packed 0xRRGGBB, largest first; empty when not yet measured). */
export type LibraryThumbnailInfo = { size: [number, number]; colours: number[] };
/** Size and colours of every thumbnail that is already cached, so tiles can reserve their real shape and the colour filter can answer early. */
export async function libraryThumbnailIndex(paths: string[]): Promise<Record<string, LibraryThumbnailInfo>> {
  return desktop && paths.length ? native('library_thumbnail_index', { paths }) : {};
}
/** Stores the dominant colours measured for a thumbnail (desktop only; the browser build keeps them in memory). */
export async function putLibraryColours(path: string, colours: number[], key: string | undefined): Promise<void> {
  if (desktop && key) await native('put_library_colours', { path, colours, key });
}
/** Part of a library original: the total file length, a key naming the file's current state (the same on every read until the file changes), and the bytes from `offset` (at most 8 MiB). */
export async function readLibraryRange(path: string, offset: number, length: number): Promise<{ total: number; key: string; bytes: Uint8Array }> {
  if (desktop) {
    const buffer = await native<ArrayBuffer>('read_library_range', { path, offset, length });
    return { total: Number(new DataView(buffer).getBigUint64(0)), key: decodeKey(buffer, 8), bytes: new Uint8Array(buffer.slice(8 + keyLength)) };
  }
  const file = await getBrowserFile(path);
  return { total: file.size, key: `${file.size}:${file.lastModified}`, bytes: new Uint8Array(await file.slice(offset, offset + length).arrayBuffer()) };
}
