// The page the reader opens on, once there is anything to return to. A first launch with nothing
// saved keeps the splash in main.ts. After that this is what was opened, what is starred, and a small
// selection of the rest of the library: the same cards as the library grid (src/cards.ts), wrapped
// into responsive masonry. Empty sections are left out.
import { coverRatio, coverSeedOf, fileTitle, assignCoverSlots, compareCollections } from './shelf';
import { libraryGrid, libraryGridColumns } from './library-layout';
import { fileTypeChoices, matchesFileType } from './library-query';
import { markUnavailable, placeTiles, showPicture, tileMedia, type Appearance, type Placed } from './cards';
import type { Thumbnail } from './thumbnails';
import { formatProgress, type Progress } from './progress';

export const homeRowLimit = 12;

export type HomeRecent = { path: string; name: string; format: string; lastOpened?: number | string };
export type HomeDocument = HomeRecent & { coverSeed?: number; collectionIds?: string[]; availability?: string; favorite?: boolean };
export type HomeCollection = { id: string; name: string; parentId: string | null };

export type HomeTile = {
  path: string;
  name: string;
  format: string;
  /** What the cover prints: the book's own title when known, else the cleaned file name. */
  title: string;
  /** What names the tile to assistive technology and on hover. */
  label: string;
  seed: number;
  shelfId: string | undefined;
  missing: boolean;
  /** How far into it the reader got, when it has been opened. */
  progress?: Progress;
};
export type HomeRow = { id: 'recent' | 'favorites' | 'library'; title: string; items: HomeTile[] };

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

function tileOf(item: HomeDocument, known: string | undefined, progress: Progress | undefined): HomeTile {
  return {
    path: item.path,
    name: item.name,
    format: item.format,
    title: known || fileTitle(item.name),
    label: known || item.name,
    seed: coverSeedOf(item),
    shelfId: item.collectionIds?.[0],
    missing: item.availability === 'missing',
    ...(progress ? { progress } : {}),
  };
}

/**
 * Sections of the opening page. Recents keep the store's order (most recent first) and borrow the library
 * entry's cover when the path matches. Favorites may repeat a recent. The library selection is the rest,
 * most recently opened first, and never repeats what the sections above show. `titleOf` is the book's own
 * title where one has been read (an EPUB's metadata); the file name stands in until then.
 */
export function homeRows(recents: readonly HomeRecent[], documents: readonly HomeDocument[], selectedFormat = '', titleOf: (item: HomeDocument) => string | undefined = () => undefined, progress: Readonly<Record<string, Progress>> = {}): HomeRow[] {
  const byPath = new Map(documents.map(doc => [doc.path, doc]));
  const tile = (item: HomeDocument) => tileOf(item, titleOf(item), progress[item.path]);
  const recentTiles = recents.map(recent => byPath.get(recent.path) ?? recent)
    .filter(item => matchesFileType(item, selectedFormat)).slice(0, homeRowLimit).map(tile);
  const byRecency = (a: { opened: number; doc: HomeDocument }, b: { opened: number; doc: HomeDocument }) => b.opened - a.opened || a.doc.name.localeCompare(b.doc.name);
  const candidates = documents.filter(doc => matchesFileType(doc, selectedFormat)).map(doc => ({ doc, opened: openedAt(doc.lastOpened) })).sort(byRecency);
  const favoriteTiles = candidates.filter(({ doc }) => doc.favorite).slice(0, homeRowLimit).map(({ doc }) => tile(doc));
  const seen = new Set([...recentTiles, ...favoriteTiles].map(item => item.path));
  const libraryTiles = candidates.filter(({ doc }) => !seen.has(doc.path)).slice(0, homeRowLimit).map(({ doc }) => tile(doc));
  const rows: HomeRow[] = [
    { id: 'recent', title: 'Recently opened', items: recentTiles },
    { id: 'favorites', title: 'Favorites', items: favoriteTiles },
    { id: 'library', title: 'Library', items: libraryTiles },
  ];
  return rows.filter(row => row.items.length);
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
  /** Opens the full library, on its favorites for the Favorites section. */
  viewAll: (scope: 'all' | 'favorites') => void;
  format: string;
  selectFormat: (value: string) => void;
  /** Whether a picture can be made for a format, and what is already known about it (proportions, a finished picture). */
  picture: { can: (format: string) => boolean; ratio: (path: string) => number | undefined; peek: (path: string) => Thumbnail | undefined };
  /** Present for the recent row, whose entries can leave the recent list without leaving the library. */
  remove?: (path: string, name: string) => void;
};

function element<T extends HTMLElement = HTMLElement>(tag: string, className?: string, text?: string): T {
  const node = document.createElement(tag) as T;
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

type PlacedTile = Placed & { path: string };
type Block = { grid: HTMLElement; tiles: PlacedTile[]; columns: number };
let current: { blocks: Block[]; resize: ResizeObserver; lazy?: IntersectionObserver; frame: number } | undefined;

function disposeHome() {
  if (!current) return;
  current.resize.disconnect(); current.lazy?.disconnect(); cancelAnimationFrame(current.frame); current = undefined;
}

/** Places every section's tiles. A column is only reassigned when asked or when the column count changes, so a picture that arrives moves what is below it and never reshuffles. */
function layoutHome(view: NonNullable<typeof current>, assign = false) {
  for (const block of view.blocks) {
    const width = block.grid.clientWidth; if (width <= 0) continue;
    const columns = libraryGridColumns(width, libraryGrid.boardMinTile), gap = libraryGrid.gap;
    const tileWidth = (width - gap * (columns - 1)) / columns;
    const height = placeTiles(block.tiles, { columns, tileWidth, gap, left: 0, top: 0, reassign: assign || columns !== block.columns });
    block.columns = columns; block.grid.style.height = `${Math.max(0, height)}px`;
  }
}
function scheduleLayout(view: NonNullable<typeof current>) {
  if (!view.frame) view.frame = requestAnimationFrame(() => { view.frame = 0; if (current === view) layoutHome(view); });
}

/** Paints the home into `root`, replacing whatever was there (the splash, or a previous home). */
export function renderHome(root: HTMLElement, rows: readonly HomeRow[], actions: HomeActions, appearance: Appearance): void {
  disposeHome();
  root.classList.add('is-home');
  root.replaceChildren();
  const bar = element('div', 'home-bar');
  const openFile = element<HTMLButtonElement>('button', 'home-file');
  openFile.type = 'button';
  openFile.id = 'empty-open';
  openFile.textContent = 'Open files';
  openFile.onclick = () => actions.openFile();
  const browse = element<HTMLButtonElement>('button', 'home-file');
  browse.type = 'button';
  browse.id = 'home-browse';
  browse.textContent = 'Browse library';
  browse.onclick = () => actions.viewAll('all');
  const buttons = element('div', 'home-actions');
  buttons.append(openFile, browse);
  bar.append(element('h1', '', 'Home'), buttons);
  root.append(bar);
  const formatLabel = element('label', 'home-format', 'File type');
  const format = element<HTMLSelectElement>('select');
  format.id = 'home-format';
  for (const [value, label] of fileTypeChoices) {
    const option = element<HTMLOptionElement>('option', '', label);
    option.value = value;
    format.append(option);
  }
  format.value = actions.format;
  format.onchange = () => actions.selectFormat(format.value);
  formatLabel.append(format);
  root.append(formatLabel);
  if (!rows.length) {
    const empty = element('p', 'home-no-matches', 'No files of this type. Choose another file type or open a file.');
    empty.setAttribute('role', 'status');
    root.append(empty);
  }
  const blocks: Block[] = [];
  for (const row of rows) {
    const section = element('section', 'home-section');
    const head = element('div', 'home-section-head');
    const heading = element('h2', '', row.title);
    heading.id = `home-${row.id}`;
    head.append(heading);
    if (row.id !== 'recent') {
      const all = element<HTMLButtonElement>('button', 'home-all', 'View all');
      all.type = 'button';
      all.setAttribute('aria-label', `View all: ${row.title}`);
      all.onclick = () => actions.viewAll(row.id === 'favorites' ? 'favorites' : 'all');
      head.append(all);
    }
    const grid = element('div', 'home-grid');
    grid.setAttribute('role', 'list');
    grid.setAttribute('aria-labelledby', heading.id);
    const tiles: PlacedTile[] = [];
    for (const item of row.items) {
      const thumbnailable = actions.picture.can(item.format);
      const generated = !item.missing && (!thumbnailable || item.format.toLowerCase() === 'epub');
      const ratio = actions.picture.ratio(item.path) ?? (generated ? coverRatio : libraryGrid.defaultRatio);
      const cell = element('div', 'library-tile home-tile');
      cell.setAttribute('role', 'listitem');
      cell.dataset.homePath = item.path;
      cell.classList.toggle('is-missing', item.missing);
      cell.classList.toggle('is-cover', generated);
      const open = element<HTMLButtonElement>('button', 'library-tile-open home-open');
      open.type = 'button';
      open.setAttribute('aria-label', `Open ${item.label}`);
      open.title = item.name;
      const media = tileMedia({ ...item, ratio, generated, thumbnailable }, appearance);
      if (thumbnailable && !item.missing) {
        const cached = actions.picture.peek(item.path);
        if (cached) showPicture(media, cached);
      }
      open.append(media);
      // A thin bar along the foot of a recently opened tile shows how far the reader got; Home's other sections stay clean.
      const reached = row.id === 'recent' ? formatProgress(item.progress) : undefined;
      if (reached && item.progress && item.progress.fraction > 0) {
        const bar = element('span', 'home-progress'), fill = element('i');
        fill.style.width = `${Math.round(item.progress.fraction * 1000) / 10}%`;
        bar.append(fill); bar.dataset.progress = reached; open.append(bar);
        open.title = `${item.name} · ${reached}`;
      }
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
      grid.append(cell);
      tiles.push({ node: cell, path: item.path, ratio, column: 0 });
    }
    section.append(head, grid);
    root.append(section);
    blocks.push({ grid, tiles, columns: 0 });
  }
  const view = { blocks, frame: 0, resize: new ResizeObserver(() => layoutHome(view)) } as NonNullable<typeof current>;
  current = view;
  view.resize.observe(root);
  layoutHome(view, true);
}

export type HomeLoaders = {
  /** A finished picture for a tile, made on demand; undefined when skipped or none exists. */
  picture: (path: string, format: string) => Promise<Thumbnail | undefined>;
  /** Reads an EPUB's own title (resolving it, or undefined), and the title as last known. */
  epub: (path: string) => Promise<unknown>;
  title: (path: string) => string | undefined;
  failed: (path: string) => boolean;
  /** Learns the proportions of pictures the disk cache holds; resolves to how many it learned. */
  prime: (paths: string[]) => Promise<number>;
  ratio: (path: string) => number | undefined;
};

/**
 * Fills picture tiles as they scroll near the viewport, shows EPUB titles once read, and reserves the real height
 * of tiles the disk cache knows. `alive` drops a result that belongs to a home that was repainted.
 */
export function fillHomePictures(root: ParentNode, loaders: HomeLoaders, alive: () => boolean): void {
  const view = current; if (!view) return;
  const tiles = view.blocks.flatMap(block => block.tiles);
  const tileOf = new Map(tiles.map(tile => [tile.node, tile]));
  const retitle = (cell: HTMLElement, path: string) => {
    const known = loaders.title(path); if (!known) return;
    for (const text of cell.querySelectorAll<HTMLElement>('.library-cover-title, .library-tile-name')) text.textContent = known;
    cell.querySelector('.home-open')?.setAttribute('aria-label', `Open ${known}`);
  };
  const lazy = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const media = entry.target as HTMLElement; lazy.unobserve(media);
      const cell = media.closest<HTMLElement>('[data-home-path]'); const path = media.dataset.path ?? ''; const format = media.dataset.format ?? '';
      if (!cell) continue;
      void loaders.picture(path, format).then(picture => {
        if (!alive() || !media.isConnected) return;
        if (picture) {
          showPicture(media, picture);
          const tile = tileOf.get(cell); if (tile && Math.abs(tile.ratio - picture.ratio) > .001) { tile.ratio = picture.ratio; scheduleLayout(view); }
        } else if (loaders.failed(path)) markUnavailable(media);
        if (format.toLowerCase() === 'epub') retitle(cell, path);
      });
    }
  }, { rootMargin: '120px' });
  view.lazy = lazy;
  const paths: string[] = [];
  for (const cell of root.querySelectorAll<HTMLElement>('[data-home-path]')) {
    const path = cell.dataset.homePath ?? '';
    const media = cell.querySelector<HTMLElement>('.library-tile-media[data-path]');
    if (!media) continue;
    paths.push(path);
    if (!media.classList.contains('is-loaded')) lazy.observe(media);
    if (media.dataset.format?.toLowerCase() === 'epub') void loaders.epub(path).then(() => { if (alive() && cell.isConnected) retitle(cell, path); });
  }
  void loaders.prime(paths).then(learned => {
    if (!learned || !alive()) return;
    for (const tile of tiles) {
      const ratio = loaders.ratio(tile.path);
      if (ratio && Math.abs(ratio - tile.ratio) > .001) { tile.ratio = ratio; tile.node.querySelector<HTMLElement>('.library-tile-media')?.style.setProperty('--ratio', String(ratio)); }
    }
    layoutHome(view, true);
  });
}

/** Leaves the home: stops watching size and pictures. */
export function closeHome() { disposeHome(); }
