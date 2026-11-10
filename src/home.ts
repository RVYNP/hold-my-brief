// The page the reader opens on, once there is anything to return to. A first launch with nothing
// saved keeps the splash in main.ts. After that this is a shelf of what was opened, not a slogan.
import { coverArt } from './covers';
import { assignCoverSlots, compareCollections, coverFill, coverSeedOf, fileTitle, fileVersion } from './shelf';

export const homeRowLimit = 12;

export type HomeRecent = { path: string; name: string; format: string; lastOpened?: number | string };
export type HomeDocument = HomeRecent & { coverSeed?: number; collectionIds?: string[]; availability?: string };
export type HomeCollection = { id: string; name: string; parentId: string | null };

export type HomeTile = {
  path: string;
  name: string;
  format: string;
  title: string;
  seed: number;
  shelfId: string | undefined;
  missing: boolean;
};
export type HomeRow = { id: 'recent' | 'library'; title: string; items: HomeTile[] };

/** `lastOpened` is a unix millis number from the native store, sometimes a numeric string after a round trip. */
export function openedAt(value: number | string | undefined): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function tileOf(item: HomeDocument): HomeTile {
  return {
    path: item.path,
    name: item.name,
    format: item.format,
    title: fileTitle(item.name),
    seed: coverSeedOf(item),
    shelfId: item.collectionIds?.[0],
    missing: item.availability === 'missing',
  };
}

/**
 * Rows for the opening page. Recents keep the store's order (most recent first) and borrow the
 * library entry's cover when the path matches. Anything else in the library, most recently opened
 * first, is a second row. With no recents the library itself is the first row.
 */
export function homeRows(recents: readonly HomeRecent[], documents: readonly HomeDocument[]): HomeRow[] {
  const byPath = new Map(documents.map(doc => [doc.path, doc]));
  const recentTiles = recents.slice(0, homeRowLimit).map(recent => tileOf(byPath.get(recent.path) ?? recent));
  const seen = new Set(recentTiles.map(item => item.path));
  const rest = documents
    .filter(doc => !seen.has(doc.path))
    .map(doc => ({ doc, opened: openedAt(doc.lastOpened) }))
    .sort((a, b) => b.opened - a.opened || a.doc.name.localeCompare(b.doc.name))
    .slice(0, homeRowLimit)
    .map(({ doc }) => tileOf(doc));
  if (recentTiles.length) {
    const rows: HomeRow[] = [{ id: 'recent', title: 'Recently opened', items: recentTiles }];
    if (rest.length) rows.push({ id: 'library', title: 'In the library', items: rest });
    return rows;
  }
  if (!rest.length) return [];
  const anyOpened = documents.some(doc => openedAt(doc.lastOpened) > 0);
  return [{ id: anyOpened ? 'recent' : 'library', title: anyOpened ? 'Recently opened' : 'In the library', items: rest }];
}

/** Same sibling grouping the library uses, so a cover on this page is the cover on its shelf. */
export function assignShelfSlots(collections: readonly HomeCollection[]): void {
  const siblings = new Map<string | null, HomeCollection[]>();
  for (const collection of collections) siblings.set(collection.parentId, [...(siblings.get(collection.parentId) ?? []), collection]);
  assignCoverSlots([...siblings.values()].map(group => [...group].sort(compareCollections).map(collection => collection.id)));
}

export type HomeActions = {
  open: (path: string, name: string) => void;
  openFile: () => void;
  /** Present for the recent row, whose entries can leave the recent list without leaving the library. */
  remove?: (path: string, name: string) => void;
};

function element<T extends HTMLElement = HTMLElement>(tag: string, className?: string, text?: string): T {
  const node = document.createElement(tag) as T;
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function coverNode(item: HomeTile, appearance: 'light' | 'dark') {
  const cover = element('span', 'library-cover');
  cover.style.setProperty('--cover-fill', coverFill(item.shelfId));
  const art = element<HTMLImageElement>('img', 'library-cover-art');
  art.alt = '';
  art.dataset.seed = String(item.seed);
  art.dataset.cover = item.shelfId ?? '';
  art.src = coverArt(item.seed, item.shelfId, appearance);
  const meta = element('span', 'library-cover-meta');
  meta.append(element('span', '', item.format.toUpperCase()));
  const version = fileVersion(item.name);
  if (version) meta.append(element('span', '', version));
  const text = element('span', 'library-cover-text');
  text.append(element('span', 'library-cover-title', item.title), meta);
  cover.append(art, text);
  return cover;
}

/** Paints the home into `root`, replacing whatever was there (the splash, or a previous home). */
export function renderHome(root: HTMLElement, rows: readonly HomeRow[], actions: HomeActions, appearance: 'light' | 'dark'): void {
  root.classList.add('is-home');
  root.replaceChildren();
  const bar = element('div', 'home-bar');
  const openFile = element<HTMLButtonElement>('button', 'home-file');
  openFile.type = 'button';
  openFile.id = 'empty-open';
  openFile.textContent = 'Open…';
  openFile.onclick = () => actions.openFile();
  bar.append(element('h1', '', 'Home'), openFile);
  root.append(bar);
  for (const row of rows) {
    const section = element('section', 'home-section');
    const heading = element('h2', '', row.title);
    heading.id = `home-${row.id}`;
    const scroller = element('div', 'home-row');
    scroller.setAttribute('role', 'list');
    scroller.setAttribute('aria-labelledby', heading.id);
    for (const item of row.items) {
      const cell = element('div', 'home-tile');
      cell.setAttribute('role', 'listitem');
      cell.dataset.homePath = item.path;
      cell.dataset.format = item.format;
      if (item.missing) cell.classList.add('is-missing');
      const open = element<HTMLButtonElement>('button', 'home-open');
      open.type = 'button';
      open.setAttribute('aria-label', `Open ${item.title}`);
      open.title = item.name;
      const frame = element('span', 'home-cover');
      frame.append(coverNode(item, appearance));
      const photo = element<HTMLImageElement>('img', 'home-thumb');
      photo.alt = '';
      photo.hidden = true;
      frame.append(photo);
      open.append(frame);
      open.onclick = () => actions.open(item.path, item.name);
      cell.append(open);
      if (row.id === 'recent' && actions.remove) {
        const remove = element<HTMLButtonElement>('button', 'home-remove');
        remove.type = 'button';
        remove.textContent = '×';
        remove.setAttribute('aria-label', `Remove ${item.name} from recents`);
        remove.onclick = () => actions.remove!(item.path, item.name);
        cell.append(remove);
      }
      scroller.append(cell);
    }
    section.append(heading, scroller);
    root.append(section);
  }
}

/** Fills picture tiles once a thumbnail exists. `alive` drops a result that belongs to a home that was repainted. */
export function fillHomePictures(root: ParentNode, request: (path: string, format: string) => Promise<{ url: string } | undefined>, alive: () => boolean): void {
  for (const cell of root.querySelectorAll<HTMLElement>('[data-home-path]')) {
    const path = cell.dataset.homePath ?? '';
    const format = cell.dataset.format ?? '';
    void request(path, format).then(picture => {
      if (!picture || !alive() || !cell.isConnected) return;
      const frame = cell.querySelector('.home-cover');
      const photo = cell.querySelector('img.home-thumb');
      if (!(photo instanceof HTMLImageElement) || !frame) return;
      photo.src = picture.url;
      photo.hidden = false;
      frame.classList.add('is-photo');
    });
  }
}
