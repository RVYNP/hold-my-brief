import type { Page } from '@playwright/test';

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
};
export type FixtureCollection = { name: string; parent?: string };

const NOW = Date.UTC(2026, 10, 12, 12);

/** The id (and so the path prefix and saved-position key) of a fixture document. */
const idOf = (name: string) => `fx-${name}`;
export const pathOf = (name: string) => `${idOf(name)}/${name}`;

/**
 * Puts a library into the browser build's own storage (the IndexedDB it keeps the library in, and the positions it keeps in
 * localStorage) and reloads, so the page opens with Home showing it. Text and Markdown documents get a real file, so they open.
 */
export async function seedLibrary(page: Page, documents: FixtureDocument[], collections: FixtureCollection[] = []) {
  const ids = (name: string) => `c-${name}`;
  const library = {
    documents: documents.map(item => ({
      path: pathOf(item.name), name: item.name, format: item.format,
      lastOpened: item.opened === undefined ? 0 : NOW - item.opened * 60_000,
      collectionIds: (item.collections ?? []).map(ids), favorite: Boolean(item.favorite), tags: [], notes: '', availability: 'ready',
    })),
    collections: collections.map(item => ({ id: ids(item.name), name: item.name, parentId: item.parent ? ids(item.parent) : null })),
    roots: [], imports: [],
  };
  const progress = Object.fromEntries(documents.filter(item => item.progress).map(item => [idOf(item.name), item.progress]));
  const files = documents.filter(item => item.content || item.format === 'txt' || item.format === 'md').map(item => ({ path: pathOf(item.name), name: item.name, base64: (item.content ?? Buffer.from(`${item.name}\n${'line\n'.repeat(80)}`)).toString('base64') }));
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
