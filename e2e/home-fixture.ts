import type { Page } from '@playwright/test';
import { pagedPdf } from './paged-pdf';

type Progress = { fraction: number; page?: number; pages?: number };
export type FixtureDocument = {
  name: string;
  format: string;
  /** Collection names it belongs to. */
  collections?: string[];
  favorite?: boolean;
  /** Minutes ago it was opened; omitted: never. */
  opened?: number;
  progress?: Progress;
  /** The file's bytes, for a document that should have a real picture; text and Markdown get text. */
  content?: Buffer;
  /** An indexed source folder this document sits in (its name) and its path inside it (`03_wwe_mag/source.pdf`): the info rail's tree is built from these. */
  root?: string;
  relativePath?: string;
};
export type FixtureCollection = { name: string; parent?: string };

const NOW = Date.UTC(2026, 10, 12, 12);

/** The id (and so the path prefix and saved-position key) of a fixture document. */
const idOf = (name: string) => `fx-${name}`;
export const pathOf = (name: string) => `${idOf(name)}/${name}`;
/** A document in a source folder has its relative path under its id, so the folder is the last directory of its path (as on the desktop) and many may be called `source.pdf`. */
const keyOf = (item: FixtureDocument) => item.root && item.relativePath ? `${item.root}:${item.relativePath}`.replace(/[^A-Za-z0-9.-]+/g, '_') : item.name;
export const pathOfItem = (item: FixtureDocument) => item.root && item.relativePath ? `${idOf(keyOf(item))}/${item.relativePath}` : pathOf(item.name);

/**
 * Puts a library into the browser build's own storage (the IndexedDB it keeps the library in, and the positions it keeps in
 * localStorage) and reloads, so the page opens with Home showing it. Text and Markdown documents get a real file, so they open.
 */
export async function seedLibrary(page: Page, documents: FixtureDocument[], collections: FixtureCollection[] = []) {
  const ids = (name: string) => `c-${name}`;
  const library = {
    documents: documents.map(item => ({
      path: pathOfItem(item), name: item.name, format: item.format,
      ...(item.root && item.relativePath ? { source: { sourceId: `folder:${item.root}`, recordId: item.relativePath, repository: item.root, sourcePath: item.relativePath, revision: '1', rootId: `root-${item.root}`, relativePath: item.relativePath } } : {}),
      lastOpened: item.opened === undefined ? 0 : NOW - item.opened * 60_000,
      collectionIds: (item.collections ?? []).map(ids), favorite: Boolean(item.favorite), tags: [], notes: '', availability: 'ready',
    })),
    collections: collections.map(item => ({ id: ids(item.name), name: item.name, parentId: item.parent ? ids(item.parent) : null })),
    roots: [...new Set(documents.map(item => item.root).filter(Boolean))].map(name => ({ id: `root-${name}`, name, path: null, managed: false })), imports: [],
  };
  const progress = Object.fromEntries(documents.filter(item => item.progress).map(item => [idOf(keyOf(item)), item.progress]));
  const files = documents.filter(item => item.content || item.format === 'txt' || item.format === 'md').map(item => ({ path: pathOfItem(item), name: item.name, base64: (item.content ?? Buffer.from(`${item.name}\n${'line\n'.repeat(80)}`)).toString('base64') }));
  await page.goto('/');
  await page.evaluate(async seed => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('hold-my-brief-library', 1);
      request.onupgradeneeded = () => { request.result.createObjectStore('state'); request.result.createObjectStore('files'); };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(['state', 'files'], 'readwrite');
      transaction.objectStore('state').put(seed.library, 'library');
      for (const file of seed.files) transaction.objectStore('files').put({ file: new Blob([Uint8Array.from(atob(file.base64), char => char.charCodeAt(0))]), name: file.name, lastModified: 1 }, file.path);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
    for (const [id, value] of Object.entries(seed.progress)) localStorage.setItem(`hold-my-brief:${id}`, JSON.stringify({ progress: value }));
  }, { library, progress, files });
  await page.reload();
}

/** The same shape the real library has, at its real size: about 300 documents of every type, 25 collections (a third with sub-collections), favorites, and reading in progress. */
export function bigLibrary(size = 300): { documents: FixtureDocument[]; collections: FixtureCollection[] } {
  const formats = ['pdf', 'epub', 'md', 'txt', 'png'];
  const collections: FixtureCollection[] = [];
  for (let index = 0; index < 25; index++) {
    collections.push({ name: `Shelf ${String(index + 1).padStart(2, '0')}` });
    if (index % 3 === 0) collections.push({ name: `Shelf ${String(index + 1).padStart(2, '0')} · part`, parent: `Shelf ${String(index + 1).padStart(2, '0')}` });
  }
  const documents: FixtureDocument[] = Array.from({ length: size }, (_, index) => {
    const format = formats[index % formats.length];
    const home = collections[(index * 7) % collections.length];
    const reading = index % 6 === 0 && index < 150;
    return {
      name: `Document ${String(index + 1).padStart(3, '0')}.${format}`, format,
      collections: index % 10 === 9 ? [] : [home.name], favorite: index % 7 === 0,
      ...(index < 120 ? { opened: index + 1 } : {}),
      ...(reading ? { progress: format === 'pdf' || format === 'epub' ? { fraction: .1 + (index % 8) / 10, page: 5 + index % 40, pages: 146 } : { fraction: .1 + (index % 8) / 10 } } : {}),
    };
  });
  return { documents, collections };
}

const wordsA = ['atlas', 'bridges', 'charts', 'dispatch', 'engines', 'fields'];
/**
 * A library that is mostly indexed folders, nested the way a real catalog is: source roots with numbered subfolders (and
 * subfolders of those), many documents called `source.pdf`, a few user collections, and loose files. `size` documents in all
 * (the real one holds about 300); public-domain names, so the same fixture can be shown. The text and Markdown ones open.
 */
export function treeLibrary(size = 300): { documents: FixtureDocument[]; collections: FixtureCollection[] } {
  const documents: FixtureDocument[] = [];
  const named: [string, string, Partial<FixtureDocument>][] = [
    ['refs', '01_art_nouveau_posters/source.pdf', {}], ['refs', '02_botanical_plates/source.pdf', {}], ['refs', '03_vintage_magazine/source.pdf', { content: pagedPdf(88), progress: { fraction: 62 / 88, page: 62, pages: 88 }, opened: 5 }],
    ['refs', '03_vintage_magazine/covers/january.png', {}], ['refs', '09_motorcycle_catalogues/source.pdf', {}], ['refs', '09_motorcycle_catalogues/issues/spring.pdf', {}], ['refs', '09_motorcycle_catalogues/issues/autumn.pdf', { progress: { fraction: 1, page: 40, pages: 40 } }],
    ['reference-docs', '1-languages/Rust-Book-1.99.epub', { progress: { fraction: .37 }, opened: 20 }], ['reference-docs', '1-languages/Python-Tutorial.epub', {}],
    ['reference-docs', '2-creative-apps/drafts/Photoshop-Notes.md', { opened: 3 }], ['reference-docs', '2-creative-apps/drafts/Layer-Notes.md', {}], ['reference-docs', '2-creative-apps/Brush-Notes.md', {}],
  ];
  for (const [root, relativePath, extra] of named) documents.push({ name: relativePath.split('/').pop()!, format: relativePath.split('.').pop()!, root, relativePath, ...extra });
  const roots = ['refs', 'reference-docs', 'Design materials'];
  for (let index = 0; documents.length < size - 3; index++) {
    const root = roots[index % roots.length], folder = `${String(10 + (index % 6)).padStart(2, '0')}_${wordsA[(index >> 1) % wordsA.length]}`, nested = index % 4 === 0 ? `/vol_${1 + index % 3}` : '';
    const format = index % 9 === 0 ? 'epub' : index % 5 === 0 ? 'md' : 'pdf';
    const relativePath = `${folder}${nested}/${index % 2 ? 'source' : `item_${index}`}.${format}`;
    if (documents.some(item => item.root === root && item.relativePath === relativePath)) continue;
    documents.push({ name: relativePath.split('/').pop()!, format, root, relativePath, favorite: index % 31 === 0 });
  }
  for (const name of ['loose-note.md', 'loose-scan.png', 'loose-paper.pdf']) documents.push({ name, format: name.split('.').pop()! });
  const find = (name: string) => documents.find(item => item.name === name)!;
  find('source.pdf').favorite = true; find('Rust-Book-1.99.epub').favorite = true;
  find('Photoshop-Notes.md').collections = ['Fashion photo and catalogues']; find('Layer-Notes.md').collections = ['90s']; find('Brush-Notes.md').collections = ['Reading list'];
  return { documents, collections: [{ name: 'Fashion photo and catalogues' }, { name: '90s', parent: 'Fashion photo and catalogues' }, { name: 'Reading list' }] };
}
