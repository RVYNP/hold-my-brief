// The page the reader opens on, once there is anything to return to. A first launch with nothing saved keeps
// the splash in main.ts. After that this is a main area in the manner of a media player's home: file type
// chips, a "Jump back in" grid of what was opened last, then horizontal shelves (Continue reading, Favorites,
// Collections). Empty sections are left out. `homeSections` derives them; `renderHome` paints them.
import { coverRatio, coverSeedOf, fileTitle, assignCoverSlots, compareCollections, collectionDisplayName } from './shelf';
import { libraryGrid } from './library-layout';
import { matchesFileType } from './library-query';
import { markUnavailable, showPicture, tileMedia, type Appearance } from './cards';
import { OPEN_DRAG_SLOP } from './open-drag';
import type { Thumbnail } from './thumbnails';
import { formatProgress, inProgress, type Progress } from './progress';

/** Most cards in "Jump back in" (4 columns by 2 rows on a wide window). */
export const jumpLimit = 8;
/** Most cards on one shelf; "Show all" opens the rest in the library. */
export const shelfLimit = 30;

export type HomeRecent = { path: string; name: string; format: string; lastOpened?: number | string };
export type HomeDocument = HomeRecent & { coverSeed?: number; collectionIds?: string[]; availability?: string; favorite?: boolean };
export type HomeCollection = { id: string; name: string; parentId: string | null; removed?: boolean };

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
/** A top-level collection: how many references it holds (sub-collections included) and the first four covers. */
export type HomeCollectionCard = { id: string; name: string; count: number; covers: HomeTile[] };
export type HomeSections = {
  jump: HomeTile[];
  reading: HomeTile[];
  favorites: HomeTile[];
  collections: HomeCollectionCard[];
};

/** The chips: a value for `matchesFileType` and its label. The empty value is "All". */
const typeChoices = [['', 'All'], ['pdf', 'PDF'], ['epub', 'EPUB'], ['md', 'Markdown'], ['txt', 'Text'], ['image', 'Images']] as const;

/**
 * The chips to offer: All and each type that some file in the library (or the recents) has, in a fixed order. A library
 * of one type has nothing to choose between, so there are no chips.
 */
export function homeTypes(recents: readonly HomeRecent[], documents: readonly HomeDocument[]): (readonly [string, string])[] {
  const present = typeChoices.filter(([value]) => value && (documents.some(doc => matchesFileType(doc, value)) || recents.some(recent => matchesFileType(recent, value))));
  return present.length > 1 ? [typeChoices[0], ...present] : [];
}

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

type Titles = (item: HomeDocument) => string | undefined;
export type HomeInput = {
  recents: readonly HomeRecent[];
  documents: readonly HomeDocument[];
  collections?: readonly HomeCollection[];
  /** The chip: a `matchesFileType` value; empty for every type. */
  format?: string;
  /** The book's own title where one has been read (an EPUB's metadata); the file name stands in until then. */
  titleOf?: Titles;
  progress?: Readonly<Record<string, Progress>>;
};

const noTitle: Titles = () => undefined;

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

/** Recents in the store's order (most recent first), each with the library entry's cover where the path matches. */
function recentItems(recents: readonly HomeRecent[], byPath: ReadonlyMap<string, HomeDocument>): HomeDocument[] {
  return recents.map(recent => byPath.get(recent.path) ?? recent);
}

/**
 * What was opened last: the recents, most recent first, each borrowing the library entry's cover when the path matches.
 * Used by "Jump back in" and by the library rail.
 */
export function recentTiles(recents: readonly HomeRecent[], documents: readonly HomeDocument[], options: { format?: string; titleOf?: Titles; progress?: Readonly<Record<string, Progress>>; limit?: number } = {}): HomeTile[] {
  const { format = '', titleOf = noTitle, progress = {}, limit = jumpLimit } = options;
  const byPath = new Map(documents.map(doc => [doc.path, doc]));
  return recentItems(recents, byPath).filter(item => matchesFileType(item, format)).slice(0, limit).map(item => tileOf(item, titleOf(item), progress[item.path]));
}

const byRecency = (a: { opened: number; doc: HomeDocument }, b: { opened: number; doc: HomeDocument }) => b.opened - a.opened || a.doc.name.localeCompare(b.doc.name);

/** Top-level collections (a collection whose parent is unknown counts as one, so nothing is hidden) with their sub-collections' documents. */
function collectionCards(collections: readonly HomeCollection[], documents: readonly HomeDocument[], tile: (item: HomeDocument) => HomeTile): HomeCollectionCard[] {
  const live = collections.filter(collection => !collection.removed);
  const known = new Set(live.map(collection => collection.id));
  const children = new Map<string, string[]>();
  for (const collection of live) if (collection.parentId && known.has(collection.parentId)) children.set(collection.parentId, [...(children.get(collection.parentId) ?? []), collection.id]);
  const tops = live.filter(collection => !collection.parentId || !known.has(collection.parentId)).sort(compareCollections);
  const cards: HomeCollectionCard[] = [];
  for (const top of tops) {
    const ids = new Set<string>(), stack = [top.id];
    for (let id = stack.pop(); id !== undefined; id = stack.pop()) { if (ids.has(id)) continue; ids.add(id); stack.push(...(children.get(id) ?? [])); }
    const inside = documents.filter(doc => doc.collectionIds?.some(id => ids.has(id)));
    if (inside.length) cards.push({ id: top.id, name: collectionDisplayName(top.name), count: inside.length, covers: inside.slice(0, 4).map(tile) });
  }
  return cards;
}

/**
 * Sections of the opening page, every one filtered by the chip.
 * - Jump back in: the first `jumpLimit` recents, in the store's order.
 * - Continue reading: opened documents whose progress is past the start and short of Finished, most recently opened first
 *   (the recents' order, then the library's `lastOpened`).
 * - Favorites: starred documents, most recently opened first.
 * - Collections: top-level collections with at least one document, each with the first four covers of its documents.
 */
export function homeSections(input: HomeInput): HomeSections {
  const { recents, documents, collections = [], format = '', titleOf = noTitle, progress = {} } = input;
  const byPath = new Map(documents.map(doc => [doc.path, doc]));
  const tile = (item: HomeDocument) => tileOf(item, titleOf(item), progress[item.path]);
  const matching = documents.filter(doc => matchesFileType(doc, format));
  const library = matching.map(doc => ({ doc, opened: openedAt(doc.lastOpened) })).sort(byRecency).map(({ doc }) => doc);
  const recent = recentItems(recents, byPath).filter(item => matchesFileType(item, format));
  const seen = new Set<string>();
  const opened = [...recent, ...library].filter(item => !seen.has(item.path) && seen.add(item.path));
  return {
    jump: recent.slice(0, jumpLimit).map(tile),
    reading: opened.filter(item => inProgress(progress[item.path])).slice(0, shelfLimit).map(tile),
    favorites: library.filter(doc => doc.favorite).slice(0, shelfLimit).map(tile),
    collections: collectionCards(collections, matching, tile).slice(0, shelfLimit),
  };
}

export const homeIsEmpty = (sections: HomeSections) => !sections.jump.length && !sections.reading.length && !sections.favorites.length && !sections.collections.length;

/** Same sibling grouping the library uses, so a cover on this page is the cover on its shelf. */
export function assignShelfSlots(collections: readonly HomeCollection[]): void {
  const siblings = new Map<string | null, HomeCollection[]>();
  for (const collection of collections) siblings.set(collection.parentId, [...(siblings.get(collection.parentId) ?? []), collection]);
  assignCoverSlots([...siblings.values()].map(group => [...group].sort(compareCollections).map(collection => collection.id)));
}

/** A shelf cover is 124 wide and 124 to 165 tall: a real proportion, kept between square and the cover's 3:4. */
export const shelfCover = { width: 124, height: 165 } as const;
export const shelfRatio = (ratio: number) => Math.min(1, Math.max(shelfCover.width / shelfCover.height, Number.isFinite(ratio) && ratio > 0 ? ratio : coverRatio));

export type HomeActions = {
  open: (path: string, name: string) => void;
  openFile: () => void;
  /** Opens the full library: on all references, its favorites, or the documents still being read. */
  viewAll: (scope: 'all' | 'favorites' | 'reading') => void;
  /** Opens the library on one collection. */
  viewCollection: (id: string) => void;
  /** The chips on offer (empty: nothing to choose between), and the one pressed. */
  types: readonly (readonly [string, string])[];
  format: string;
  selectFormat: (value: string) => void;
  /** Whether a picture can be made for a format, and what is already known about it (proportions, a finished picture). */
  picture: { can: (format: string) => boolean; ratio: (path: string) => number | undefined; peek: (path: string) => Thumbnail | undefined };
  /** Present for "Jump back in", whose entries can leave the recent list without leaving the library. */
  remove?: (path: string, name: string) => void;
};

function element<T extends HTMLElement = HTMLElement>(tag: string, className?: string, text?: string): T {
  const node = document.createElement(tag) as T;
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function control(className: string, label?: string, text?: string): HTMLButtonElement {
  const node = element<HTMLButtonElement>('button', className, text);
  node.type = 'button';
  if (label) node.setAttribute('aria-label', label);
  return node;
}

type Shelf = { track: HTMLElement; previous: HTMLButtonElement; next: HTMLButtonElement };
let current: { shelves: Shelf[]; chips?: HTMLElement; resize: ResizeObserver; lazy?: IntersectionObserver; frame: number; reduced: MediaQueryList } | undefined;

function disposeHome() {
  if (!current) return;
  current.resize.disconnect(); current.lazy?.disconnect(); cancelAnimationFrame(current.frame); current = undefined;
}

/** The ‹ › buttons are there only while there is more to scroll to in their direction. */
function syncShelf({ track, previous, next }: Shelf) {
  previous.hidden = track.scrollLeft <= 1;
  next.hidden = track.scrollLeft + track.clientWidth >= track.scrollWidth - 1;
}
/** The chip row is one line that scrolls sideways; a fade shows at an edge while there is more beyond it. */
function fadeChips(row: HTMLElement) {
  row.style.setProperty('--fade-start', row.scrollLeft > 1 ? '28px' : '0px');
  row.style.setProperty('--fade-end', row.scrollLeft + row.clientWidth < row.scrollWidth - 1 ? '28px' : '0px');
}
function scheduleSync(view: NonNullable<typeof current>) {
  if (!view.frame) view.frame = requestAnimationFrame(() => { view.frame = 0; if (current !== view) return; for (const shelf of view.shelves) syncShelf(shelf); if (view.chips) fadeChips(view.chips); });
}

/** One tab stop per list, arrows between its cards (and up and down by row in the grid). */
function roving(container: HTMLElement, vertical: boolean) {
  const items = () => [...container.querySelectorAll<HTMLElement>('.home-open')];
  const settle = (active?: HTMLElement) => { const all = items(); const stop = active ?? all[0]; for (const item of all) item.tabIndex = item === stop ? 0 : -1; };
  settle();
  container.addEventListener('focusin', event => { const target = (event.target as HTMLElement).closest<HTMLElement>('.home-open'); if (target) settle(target); });
  container.addEventListener('keydown', event => {
    const all = items(), at = all.indexOf((event.target as HTMLElement).closest<HTMLElement>('.home-open') as HTMLElement);
    if (at < 0 || event.altKey || event.ctrlKey || event.metaKey) return;
    const row = vertical ? all.filter(item => item.offsetTop === all[0].offsetTop).length : 1;
    const to = event.key === 'ArrowRight' ? at + 1 : event.key === 'ArrowLeft' ? at - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? all.length - 1
      : vertical && event.key === 'ArrowDown' ? at + row : vertical && event.key === 'ArrowUp' ? at - row : undefined;
    if (to === undefined) return;
    event.preventDefault();
    if (to < 0 || to >= all.length || to === at) return;
    all[to].focus({ preventScroll: true });
    all[to].scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: current?.reduced.matches ? 'auto' : 'smooth' });
  });
}

/**
 * A mouse press that travels sideways on a shelf drags it (touch and trackpads scroll it natively). A press that travels
 * up or down is left alone, so a card can still be dragged out to open in a new tab (see open-drag.ts).
 */
function dragScroll(track: HTMLElement) {
  track.addEventListener('dragstart', event => event.preventDefault());
  track.addEventListener('pointerdown', down => {
    if (down.button !== 0 || down.pointerType !== 'mouse' || !down.isPrimary) return;
    const startX = down.clientX, startY = down.clientY, startLeft = track.scrollLeft;
    let dragging = false;
    const move = (event: PointerEvent) => {
      if (event.pointerId !== down.pointerId) return;
      if (!(event.buttons & 1)) { end(); return; }
      if (!dragging) {
        const dx = event.clientX - startX, dy = event.clientY - startY;
        if (Math.hypot(dx, dy) < OPEN_DRAG_SLOP) return;
        if (Math.abs(dx) <= Math.abs(dy)) { end(); return; }
        dragging = true; track.classList.add('is-dragging');
        try { track.setPointerCapture(event.pointerId); } catch { /* The pointer may already be gone. */ }
      }
      track.scrollLeft = startLeft - (event.clientX - startX);
    };
    const end = () => {
      window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerup', end, true); window.removeEventListener('pointercancel', end, true);
      if (!dragging) return;
      track.classList.remove('is-dragging');
      // The click that ends a drag must not open the card it ended on.
      const swallow = (click: Event) => { click.preventDefault(); click.stopPropagation(); };
      window.addEventListener('click', swallow, { capture: true, once: true }); setTimeout(() => window.removeEventListener('click', swallow, true));
    };
    window.addEventListener('pointermove', move, true); window.addEventListener('pointerup', end, true); window.addEventListener('pointercancel', end, true);
  });
}

type Painter = { actions: HomeActions; appearance: Appearance; view: { shelves: Shelf[] } };

/** The picture box of a document: a generated cover until the picture arrives, sized by `kind`. */
function mediaOf(item: HomeTile, painter: Painter, kind: 'jump' | 'shelf' | 'mosaic'): HTMLElement {
  const { actions, appearance } = painter;
  const thumbnailable = actions.picture.can(item.format);
  const generated = !item.missing && (!thumbnailable || item.format.toLowerCase() === 'epub');
  const known = actions.picture.ratio(item.path) ?? (generated ? coverRatio : libraryGrid.defaultRatio);
  const media = tileMedia({ ...item, ratio: kind === 'shelf' ? shelfRatio(known) : known, generated, thumbnailable }, appearance);
  if (thumbnailable && !item.missing) {
    const cached = actions.picture.peek(item.path);
    if (cached) { showPicture(media, cached); if (kind === 'shelf') media.style.setProperty('--ratio', String(shelfRatio(cached.ratio))); }
  }
  return media;
}

/** A document's button: its name for assistive technology, its file name and progress on hover. */
function opener(item: HomeTile, className: string, actions: HomeActions): HTMLButtonElement {
  const open = control(`home-open ${className}`, `Open ${item.label}`);
  const reached = formatProgress(item.progress);
  open.title = reached ? `${item.name} · ${reached}` : item.name;
  open.onclick = () => actions.open(item.path, item.name);
  return open;
}

function jumpCard(item: HomeTile, painter: Painter): HTMLElement {
  const cell = element('div', 'home-jump');
  cell.setAttribute('role', 'listitem');
  cell.dataset.homePath = item.path;
  cell.classList.toggle('is-missing', item.missing);
  const open = opener(item, 'home-jump-open', painter.actions);
  const text = element('span', 'home-jump-text');
  text.append(element('span', 'home-card-title', item.title));
  // A thin line under the title shows how far the reader got; a document with no progress has none.
  if (item.progress && item.progress.fraction > 0) {
    const line = element('span', 'home-progress'), fill = element('i');
    fill.style.width = `${Math.round(Math.min(1, item.progress.fraction) * 1000) / 10}%`;
    line.append(fill); line.dataset.progress = formatProgress(item.progress) ?? '';
    text.append(line);
  }
  open.append(mediaOf(item, painter, 'jump'), text);
  cell.append(open);
  if (painter.actions.remove) {
    const remove = control('home-remove', `Remove ${item.name} from recents`, '×');
    remove.onclick = () => painter.actions.remove!(item.path, item.name);
    cell.append(remove);
  }
  return cell;
}

function documentCard(item: HomeTile, painter: Painter, meta: string): HTMLElement {
  const cell = element('div', 'home-card');
  cell.setAttribute('role', 'listitem');
  cell.dataset.homePath = item.path;
  cell.classList.toggle('is-missing', item.missing);
  const open = opener(item, 'home-card-open', painter.actions);
  const cover = element('span', 'home-card-cover');
  cover.append(mediaOf(item, painter, 'shelf'));
  open.append(cover, element('span', 'home-card-title', item.title), element('span', 'home-card-meta', meta));
  cell.append(open);
  return cell;
}

function collectionCard(card: HomeCollectionCard, painter: Painter): HTMLElement {
  const cell = element('div', 'home-card home-collection');
  cell.setAttribute('role', 'listitem');
  cell.dataset.homeCollection = card.id;
  const count = `${card.count} ${card.count === 1 ? 'reference' : 'references'}`;
  const open = control('home-open home-card-open', `Collection ${card.name}, ${count}`);
  open.title = card.name;
  open.onclick = () => painter.actions.viewCollection(card.id);
  const mosaic = element('span', 'home-mosaic');
  for (let slot = 0; slot < 4; slot++) {
    const cellNode = element('span', 'home-mosaic-cell'), cover = card.covers[slot];
    if (cover) cellNode.append(mediaOf(cover, painter, 'mosaic'));
    mosaic.append(cellNode);
  }
  const cover = element('span', 'home-card-cover');
  cover.append(mosaic);
  open.append(cover, element('span', 'home-card-title', card.name), element('span', 'home-card-meta', count));
  cell.append(open);
  return cell;
}

/** A labelled region with a heading and, optionally, "Show all". */
function section(id: string, title: string, showAll?: { label: string; run: () => void }): { region: HTMLElement; heading: HTMLElement } {
  const region = element('section', 'home-section');
  const head = element('div', 'home-section-head');
  const heading = element('h2', '', title);
  heading.id = `home-${id}`;
  region.setAttribute('aria-labelledby', heading.id);
  head.append(heading);
  if (showAll) {
    const all = control('home-all', showAll.label, 'Show all');
    all.onclick = showAll.run;
    head.append(all);
  }
  region.append(head);
  return { region, heading };
}

/** A shelf: one row of cards that scrolls sideways, with ‹ › buttons at its ends. */
function shelf(id: string, title: string, cards: HTMLElement[], showAll: { label: string; run: () => void }, painter: Painter): HTMLElement {
  const { region, heading } = section(id, title, showAll);
  region.classList.add('home-shelf');
  const frame = element('div', 'home-shelf-frame');
  const track = element('div', 'home-shelf-track');
  track.setAttribute('role', 'list');
  track.setAttribute('aria-labelledby', heading.id);
  track.dataset.scrollX = '';
  track.append(...cards);
  const previous = control('home-shelf-nav is-previous', `Scroll ${title} back`, '‹'), next = control('home-shelf-nav is-next', `Scroll ${title} forward`, '›');
  previous.tabIndex = next.tabIndex = -1; previous.hidden = true; next.hidden = true;
  const page = (direction: -1 | 1) => track.scrollBy({ left: direction * Math.max(shelfCover.width, track.clientWidth - shelfCover.width), behavior: current?.reduced.matches ? 'auto' : 'smooth' });
  previous.onclick = () => page(-1); next.onclick = () => page(1);
  frame.append(previous, track, next);
  region.append(frame);
  roving(track, false); dragScroll(track);
  painter.view.shelves.push({ track, previous, next });
  return region;
}

/** Paints the home into `root`, replacing whatever was there (the splash, or a previous home). */
export function renderHome(root: HTMLElement, sections: HomeSections, actions: HomeActions, appearance: Appearance): void {
  disposeHome();
  root.classList.add('is-home');
  root.replaceChildren();
  const bar = element('div', 'home-bar');
  const openFile = control('home-file', undefined, 'Open files');
  openFile.id = 'empty-open';
  openFile.onclick = () => actions.openFile();
  const browse = control('home-file', undefined, 'Browse library');
  browse.id = 'home-browse';
  browse.onclick = () => actions.viewAll('all');
  const buttons = element('div', 'home-actions');
  buttons.append(openFile, browse);
  bar.append(element('h1', '', 'Home'), buttons);
  root.append(bar);
  let chipRow: HTMLElement | undefined;
  if (actions.types.length) {
    const chips = chipRow = element('div', 'home-chips');
    chips.setAttribute('role', 'group');
    chips.setAttribute('aria-label', 'File type');
    for (const [value, label] of actions.types) {
      const chip = control('home-chip', undefined, label);
      chip.dataset.type = value;
      chip.setAttribute('aria-pressed', String(value === actions.format));
      chip.onclick = () => actions.selectFormat(value);
      chips.append(chip);
    }
    // A chip reached by Tab is brought fully into the row (the browser leaves one that is partly visible where it is).
    chips.addEventListener('focusin', event => (event.target as HTMLElement).scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }));
    root.append(chips);
  }
  if (homeIsEmpty(sections)) {
    const empty = element('p', 'home-no-matches', actions.format ? 'No files of this type. Choose another file type or open a file.' : 'Nothing opened yet. Open a file, or browse the library.');
    empty.setAttribute('role', 'status');
    root.append(empty);
  }
  const view = { shelves: [] as Shelf[], frame: 0, reduced: matchMedia('(prefers-reduced-motion: reduce)'), resize: new ResizeObserver(() => scheduleSync(view)) } as NonNullable<typeof current>;
  const painter: Painter = { actions, appearance, view };
  if (sections.jump.length) {
    const { region } = section('jump', 'Jump back in');
    region.classList.add('home-jump-section');
    const grid = element('div', 'home-jump-grid');
    grid.setAttribute('role', 'list');
    grid.setAttribute('aria-labelledby', 'home-jump');
    grid.append(...sections.jump.map(item => jumpCard(item, painter)));
    region.append(grid);
    root.append(region);
    roving(grid, true);
  }
  if (sections.reading.length) root.append(shelf('reading', 'Continue reading', sections.reading.map(item => documentCard(item, painter, [item.format.toUpperCase(), formatProgress(item.progress)].filter(Boolean).join(' · '))), { label: 'Show all: Continue reading', run: () => actions.viewAll('reading') }, painter));
  if (sections.favorites.length) root.append(shelf('favorites', 'Favorites', sections.favorites.map(item => documentCard(item, painter, item.format.toUpperCase())), { label: 'Show all: Favorites', run: () => actions.viewAll('favorites') }, painter));
  if (sections.collections.length) root.append(shelf('collections', 'Collections', sections.collections.map(card => collectionCard(card, painter)), { label: 'Show all: Collections', run: () => actions.viewAll('all') }, painter));
  current = view;
  if (chipRow) { view.chips = chipRow; view.resize.observe(chipRow); chipRow.addEventListener('scroll', () => scheduleSync(view), { passive: true }); }
  for (const { track } of view.shelves) { view.resize.observe(track); track.addEventListener('scroll', () => scheduleSync(view), { passive: true }); }
  scheduleSync(view);
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
 * Fills picture tiles as they scroll near the viewport, shows EPUB titles once read, and reserves the real proportions
 * of pictures the disk cache knows. `alive` drops a result that belongs to a home that was repainted.
 */
export function fillHomePictures(root: ParentNode, loaders: HomeLoaders, alive: () => boolean): void {
  const view = current; if (!view) return;
  const retitle = (cell: HTMLElement, path: string) => {
    const known = loaders.title(path); if (!known) return;
    for (const text of cell.querySelectorAll<HTMLElement>('.library-cover-title, .library-tile-name, .home-card-title')) text.textContent = known;
    cell.querySelector('.home-open')?.setAttribute('aria-label', `Open ${known}`);
  };
  // A shelf cover keeps its slot (165 tall), so a picture of another proportion moves nothing but itself; the grid and the mosaic crop.
  const proportion = (media: HTMLElement, ratio: number) => { media.style.setProperty('--ratio', String(media.closest('.home-card-cover') ? shelfRatio(ratio) : ratio)); };
  const lazy = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const media = entry.target as HTMLElement; lazy.unobserve(media);
      const cell = media.closest<HTMLElement>('[data-home-path]'); const path = media.dataset.path ?? ''; const format = media.dataset.format ?? '';
      void loaders.picture(path, format).then(picture => {
        if (!alive() || !media.isConnected) return;
        if (picture) { showPicture(media, picture); proportion(media, picture.ratio); }
        else if (loaders.failed(path)) markUnavailable(media);
        if (cell && format.toLowerCase() === 'epub') retitle(cell, path);
      });
    }
  }, { rootMargin: '120px' });
  view.lazy = lazy;
  const paths = new Set<string>();
  for (const media of root.querySelectorAll<HTMLElement>('.library-tile-media[data-path]')) {
    const path = media.dataset.path ?? '';
    paths.add(path);
    if (!media.classList.contains('is-loaded')) lazy.observe(media);
  }
  for (const cell of root.querySelectorAll<HTMLElement>('[data-home-path]')) {
    const path = cell.dataset.homePath ?? '';
    if (cell.querySelector<HTMLElement>('.library-tile-media[data-format]')?.dataset.format?.toLowerCase() === 'epub') void loaders.epub(path).then(() => { if (alive() && cell.isConnected) retitle(cell, path); });
  }
  void loaders.prime([...paths]).then(learned => {
    if (!learned || !alive()) return;
    for (const media of root.querySelectorAll<HTMLElement>('.library-tile-media[data-path]')) {
      const ratio = loaders.ratio(media.dataset.path ?? '');
      if (ratio && !media.classList.contains('is-loaded')) proportion(media, ratio);
    }
  });
}

/** Leaves the home: stops watching size and pictures. */
export function closeHome() { disposeHome(); }
