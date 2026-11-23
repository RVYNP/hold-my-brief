// The page the reader opens on, once there is anything to return to. A first launch with nothing saved keeps
// the splash in main.ts. After that this is a main area of one heading and, below it: "Recently opened" (one card,
// the document opened last), the horizontal shelf "Continue reading", and one shelf per file type the library has.
// Empty sections are left out. `homeSections` derives them; `renderHome` paints them.
import { coverRatio, coverSeedOf, displayTitle, assignCoverSlots, compareCollections } from './shelf';
import { libraryGrid } from './library-layout';
import { matchesFileType } from './library-query';
import { markUnavailable, showPicture, tileMedia, type Appearance } from './cards';
import { OPEN_DRAG_SLOP } from './open-drag';
import type { Thumbnail } from './thumbnails';
import { formatProgress, inProgress, type Progress } from './progress';
import { bannerGrid, bannerPixel, localDay, renderBanner, seedFor, type BannerSeed } from './home-banner';
import type { Cover } from './procedural-cover';
import { rememberRecent } from './covers';
import type { Banner } from './theme';

/** Most cards on one shelf. */
export const shelfLimit = 30;
/** Most cards in the top "Recently opened" row. */
export const recentLimit = 4;

export type HomeRecent = { path: string; name: string; format: string; lastOpened?: number | string };
export type HomeDocument = HomeRecent & { coverSeed?: number; collectionIds?: string[]; availability?: string };
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
/** One file-type shelf: a value for `matchesFileType`, its title, and the library's documents of that type. */
export type HomeTypeShelf = { type: string; title: string; tiles: HomeTile[] };
export type HomeSections = {
  /** The one document opened last (empty when nothing has been opened). */
  recent: HomeTile[];
  reading: HomeTile[];
  /** One shelf per file type that has documents, in a fixed order. */
  types: HomeTypeShelf[];
};

/** The file-type shelves, in the order Home shows them. */
const typeShelves = [['pdf', 'PDFs'], ['epub', 'EPUBs'], ['md', 'Markdown'], ['txt', 'Text'], ['image', 'Images']] as const;

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

/** What the browser build has for recents (no store keeps a list there): the library's documents that were opened, latest first. */
export function openedOrder(documents: readonly HomeDocument[]): HomeDocument[] {
  return documents.filter(doc => openedAt(doc.lastOpened) > 0).sort((a, b) => openedAt(b.lastOpened) - openedAt(a.lastOpened) || a.name.localeCompare(b.name));
}

type Titles = (item: HomeDocument) => string | undefined;
export type HomeInput = {
  recents: readonly HomeRecent[];
  documents: readonly HomeDocument[];
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
    title: displayTitle(item, known, true),
    label: displayTitle(item, known),
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

/** The recents as tiles, in the store's order, each borrowing the library entry's cover when the path matches. */
export function recentTiles(recents: readonly HomeRecent[], documents: readonly HomeDocument[], options: { titleOf?: Titles; progress?: Readonly<Record<string, Progress>>; limit?: number } = {}): HomeTile[] {
  const { titleOf = noTitle, progress = {}, limit = recents.length } = options;
  const byPath = new Map(documents.map(doc => [doc.path, doc]));
  return recentItems(recents, byPath).slice(0, limit).map(item => tileOf(item, titleOf(item), progress[item.path]));
}

const byRecency = (a: { opened: number; doc: HomeDocument }, b: { opened: number; doc: HomeDocument }) => b.opened - a.opened || a.doc.name.localeCompare(b.doc.name);

/**
 * Sections of the opening page.
 * - Recently opened: the first recent, in the store's order.
 * - Continue reading: opened documents whose progress is past the start and short of Finished, most recently opened first
 *   (the recents' order, then the library's `lastOpened`).
 * - One shelf per file type (PDFs, EPUBs, Markdown, Text, Images) with documents: the opened ones, most recently opened
 *   first, then the never-opened ones by title.
 */
export function homeSections(input: HomeInput): HomeSections {
  const { recents, documents, titleOf = noTitle, progress = {} } = input;
  const byPath = new Map(documents.map(doc => [doc.path, doc]));
  const tile = (item: HomeDocument) => tileOf(item, titleOf(item), progress[item.path]);
  const library = documents.map(doc => ({ doc, opened: openedAt(doc.lastOpened) })).sort(byRecency).map(({ doc }) => doc);
  const recent = recentItems(recents, byPath);
  const seen = new Set<string>();
  const opened = [...recent, ...library].filter(item => !seen.has(item.path) && seen.add(item.path));
  const types = typeShelves.map(([type, title]) => ({
    type, title,
    tiles: documents.filter(doc => matchesFileType(doc, type)).map(item => ({ item, opened: openedAt(item.lastOpened), title: displayTitle(item, titleOf(item), true) }))
      .sort((a, b) => b.opened - a.opened || a.title.localeCompare(b.title) || a.item.name.localeCompare(b.item.name))
      .slice(0, shelfLimit).map(({ item }) => tile(item)),
  })).filter(shelf => shelf.tiles.length);
  return {
    recent: recent.slice(0, recentLimit).map(tile),
    reading: opened.filter(item => inProgress(progress[item.path])).slice(0, shelfLimit).map(tile),
    types,
  };
}

/** Same sibling grouping the library uses, so a cover on this page is the cover on its shelf. */
export function assignShelfSlots(collections: readonly HomeCollection[]): void {
  const siblings = new Map<string | null, HomeCollection[]>();
  for (const collection of collections) siblings.set(collection.parentId, [...(siblings.get(collection.parentId) ?? []), collection]);
  assignCoverSlots([...siblings.values()].map(group => [...group].sort(compareCollections).map(collection => collection.id)));
}

/** A shelf cover is 125 wide and 125 to 170 tall: a real proportion, kept between square and the cover's 3:4. */
export const shelfCover = { width: 125, height: 170 } as const;
export const shelfRatio = (ratio: number) => Math.min(1, Math.max(shelfCover.width / shelfCover.height, Number.isFinite(ratio) && ratio > 0 ? ratio : coverRatio));

export type HomeActions = {
  open: (path: string, name: string) => void;
  /** The context menu of a document card or row was asked for (right-click, the menu key, Shift+F10), at `at` or, from the keyboard, beside `anchor`. */
  menu: (item: { path: string; name: string; format: string }, anchor: HTMLElement, at: { x: number; y: number } | undefined) => void;
  /** Whether a picture can be made for a format, and what is already known about it (proportions, a finished picture). */
  picture: { can: (format: string) => boolean; ratio: (path: string) => number | undefined; peek: (path: string) => Thumbnail | undefined };
  /** The Appearance's BACKGROUND choice: a cover family draws the dithered ground, `none` leaves Home without one. */
  banner: Banner;
  /** Present for "Recently opened", whose entries can leave the recent list without leaving the library. */
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
/** The ground on show: Home's root and the element it sits in, the family drawn, the canvas shown (and its key), the pending idle job. */
type GroundView = { root: HTMLElement; host: HTMLElement; family: string; canvas?: HTMLCanvasElement; key: string; cancel?: () => void; resize: ResizeObserver };
let current: { shelves: Shelf[]; resize: ResizeObserver; lazy?: IntersectionObserver; frame: number; reduced: MediaQueryList; ground?: GroundView } | undefined;

function disposeHome() {
  if (!current) return;
  current.resize.disconnect(); current.lazy?.disconnect(); cancelAnimationFrame(current.frame);
  const { ground } = current;
  if (ground) { ground.cancel?.(); ground.resize.disconnect(); for (const canvas of ground.host.querySelectorAll('.home-ground')) canvas.remove(); }
  current = undefined;
}

// ---- the ground ---------------------------------------------------------------------------------------------
// The dithered window glow, one canvas behind Home's content and the whole window below the toolbar (style.css: `.home-ground`).
// Painted in an idle callback while Home is the tab on show, once per (theme colours, family, seed, size bucket); a change
// cross-fades two stacked canvases by a CSS transition. Nothing here runs a frame loop.

const bannerSeedKey = 'hold-my-brief:home-banner';
const groundCacheSize = 8;
const groundFade = 650; // ms: the 600 ms transition and a margin
let bannerSeed: BannerSeed | undefined;
/** Rendered pictures, newest last; the key holds everything the pixels depend on. */
const groundPictures = new Map<string, HTMLCanvasElement>();
/** What the last ground showed, so a repainted Home starts from it rather than from an empty window. */
let lastGround: { key: string; picture: HTMLCanvasElement } | undefined;

function saveBannerSeed(next: BannerSeed) {
  bannerSeed = next;
  try { localStorage.setItem(bannerSeedKey, JSON.stringify(next)); } catch { /* Optional preference. */ }
}
/** Today's seed: the saved one while it is from today, otherwise a new day's. */
function bannerSeedNow(): BannerSeed {
  const today = localDay(new Date());
  if (bannerSeed?.day === today) return bannerSeed;
  let saved: unknown = null;
  try { saved = JSON.parse(localStorage.getItem(bannerSeedKey) ?? 'null'); } catch { /* A new day's seed stands. */ }
  const next = seedFor(saved, today);
  if (JSON.stringify(saved) !== JSON.stringify(next)) saveBannerSeed(next); else bannerSeed = next;
  return next;
}

const later = (run: () => void): (() => void) => {
  if (typeof requestIdleCallback === 'function') { const id = requestIdleCallback(run, { timeout: 500 }); return () => cancelIdleCallback(id); }
  const id = setTimeout(run, 0);
  return () => clearTimeout(id);
};

type Channels = [number, number, number];
/** A computed `rgb()` / `rgba()` colour as opaque channels, and whether it had any alpha at all; other syntaxes are null. */
function opaque(value: string): { rgb: Channels; visible: boolean } | null {
  const match = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+)(%?))?\s*\)$/.exec(value);
  if (!match) return null;
  const alpha = match[4] === undefined ? 1 : Number(match[4]) / (match[5] ? 100 : 1);
  return { rgb: [Number(match[1]), Number(match[2]), Number(match[3])], visible: alpha > 0 };
}
/** The ground's three colours as the page shows them now: `--surface`, and the glow's two hues at full strength (the sheen's where the glow is not drawn). */
function groundColours(host: HTMLElement): [Channels, Channels, Channels] {
  const probe = element('span');
  probe.hidden = true;
  host.append(probe);
  const read = (token: string) => { probe.style.color = ''; probe.style.color = `var(${token})`; return opaque(getComputedStyle(probe).color); };
  const surface = read('--surface')?.rgb ?? [128, 128, 128];
  const hue = (glow: string, sheen: string) => { const grad = read(glow); return (grad?.visible ? grad : read(sheen))?.rgb ?? surface; };
  const colours: [Channels, Channels, Channels] = [surface, hue('--grad-a', '--sheen-a'), hue('--grad-b', '--sheen-b')];
  probe.remove();
  return colours;
}
/** The window's top edge of the ground: the toolbar's bottom edge. The toolbar never shows any of it. */
const toolbarBottom = (host: HTMLElement) => document.querySelector('.toolbar')?.getBoundingClientRect().bottom ?? host.getBoundingClientRect().top;

function groundPicture(key: string, make: () => HTMLCanvasElement): HTMLCanvasElement {
  return rememberRecent(groundPictures, key, groundPictures.get(key) ?? make(), groundCacheSize);
}
/** The grid below its first `skip` rows (the toolbar's) as pixels: tone 0, the ground, stays transparent, the others are opaque hues; the layer's opacity and blend do the rest. */
function paintGroundGrid(grid: Cover, skip: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas'), rows = Math.max(1, grid.height - skip);
  canvas.width = grid.width; canvas.height = rows;
  const context = canvas.getContext('2d');
  if (!context) return canvas;
  const image = context.createImageData(grid.width, rows);
  for (let y = 0; y < rows; y++) for (let x = 0; x < grid.width; x++) {
    const tone = grid.pixels[(y + skip) * grid.width + x];
    if (!tone) continue;
    const [r, g, b] = grid.palette[tone], at = (y * grid.width + x) * 4;
    image.data[at] = r; image.data[at + 1] = g; image.data[at + 2] = b; image.data[at + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  return canvas;
}
/** Puts a canvas at the window's left edge and the toolbar's bottom edge, whatever the rail or the toolbar do to the element it sits in. */
function placeGround(view: GroundView, canvas: HTMLCanvasElement) {
  const box = view.host.getBoundingClientRect();
  canvas.style.left = `${-(box.left + view.host.clientLeft)}px`;
  canvas.style.top = `${toolbarBottom(view.host) - (box.top + view.host.clientTop)}px`;
}
/** A fresh on-screen canvas with the picture's pixels (a picture itself may be on screen only once). */
function groundCopy(view: GroundView, picture: HTMLCanvasElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.className = 'home-ground';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.width = picture.width; canvas.height = picture.height;
  canvas.style.width = `${picture.width * bannerPixel}px`; canvas.style.height = `${picture.height * bannerPixel}px`;
  canvas.getContext('2d')?.drawImage(picture, 0, 0);
  placeGround(view, canvas);
  return canvas;
}

function showGround(view: GroundView, key: string, picture: HTMLCanvasElement) {
  const next = groundCopy(view, picture), before = view.canvas;
  for (const stale of Array.from(view.host.querySelectorAll('.home-ground'))) if (stale !== before) stale.remove();
  view.canvas = next; view.key = key; lastGround = { key, picture };
  if (!before || matchMedia('(prefers-reduced-motion: reduce)').matches) { before?.remove(); view.host.append(next); return; }
  next.classList.add('is-entering');
  view.host.append(next);
  void next.offsetWidth; // the transition starts from the hidden state
  next.classList.remove('is-entering'); before.classList.add('is-leaving');
  setTimeout(() => before.remove(), groundFade);
}

/** Draws what the window should show now, unless it already shows it, is not laid out, or Home is not the tab on show. */
function drawGround(view: GroundView) {
  const { root, host } = view;
  if (!root.isConnected || root.hidden) return;
  const width = innerWidth, height = innerHeight; // the picture belongs to the window: the rail, the drawer and the toolbar's height move nothing
  if (!width || !height) return;
  for (const canvas of host.querySelectorAll<HTMLCanvasElement>('.home-ground')) placeGround(view, canvas);
  const skip = Math.round(toolbarBottom(host) / bannerPixel), grid = bannerGrid(width, height), colours = groundColours(host), seed = bannerSeedNow().seed;
  const key = [view.family, seed, grid.width, grid.height, skip, ...colours.map(channels => channels.join(','))].join('|');
  if (key === view.key) return;
  const [surface, a, b] = colours;
  showGround(view, key, groundPicture(key, () => paintGroundGrid(renderBanner({ seed, family: view.family, ...grid, ground: surface, a, b, strength: 1 }), skip)));
}
function scheduleGround(view: GroundView) {
  view.cancel?.();
  view.cancel = later(() => { view.cancel = undefined; drawGround(view); });
}

/** The ground behind `root`, in the element `root` sits in. It starts from the picture the last one showed. */
function groundView(root: HTMLElement, family: Banner): GroundView {
  const view: GroundView = { root, host: root.parentElement ?? root, family, key: '', resize: new ResizeObserver(() => scheduleGround(view)) };
  if (lastGround) { view.canvas = groundCopy(view, lastGround.picture); view.key = lastGround.key; view.host.append(view.canvas); }
  return view;
}

/**
 * Called when the theme or the BACKGROUND choice changed. Returns false when the page has to be painted again (the ground
 * is there or gone); otherwise the ground repaints itself in an idle moment.
 */
export function repaintGround(banner: Banner): boolean {
  const view = current?.ground;
  if (!current || (banner === 'none') === Boolean(view)) return false;
  if (view) { view.family = banner; scheduleGround(view); }
  return true;
}


/** The ‹ › buttons are there only while there is more to scroll to in their direction. */
function syncShelf({ track, previous, next }: Shelf) {
  previous.hidden = track.scrollLeft <= 1;
  next.hidden = track.scrollLeft + track.clientWidth >= track.scrollWidth - 1;
}
function scheduleSync(view: NonNullable<typeof current>) {
  if (!view.frame) view.frame = requestAnimationFrame(() => { view.frame = 0; if (current !== view) return; for (const shelf of view.shelves) syncShelf(shelf); });
}

/** One tab stop per shelf, arrows between its cards. */
function roving(container: HTMLElement) {
  const items = () => [...container.querySelectorAll<HTMLElement>('.home-open')];
  const settle = (active?: HTMLElement) => { const all = items(); const stop = active ?? all[0]; for (const item of all) item.tabIndex = item === stop ? 0 : -1; };
  settle();
  container.addEventListener('focusin', event => { const target = (event.target as HTMLElement).closest<HTMLElement>('.home-open'); if (target) settle(target); });
  container.addEventListener('keydown', event => {
    const all = items(), at = all.indexOf((event.target as HTMLElement).closest<HTMLElement>('.home-open') as HTMLElement);
    if (at < 0 || event.altKey || event.ctrlKey || event.metaKey) return;
    const to = event.key === 'ArrowRight' ? at + 1 : event.key === 'ArrowLeft' ? at - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? all.length - 1 : undefined;
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
function mediaOf(item: HomeTile, painter: Painter, kind: 'recent' | 'shelf'): HTMLElement {
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
  open.addEventListener('contextmenu', event => { event.preventDefault(); actions.menu(item, open, event.clientX || event.clientY ? { x: event.clientX, y: event.clientY } : undefined); });
  open.addEventListener('keydown', event => { if (event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey) { event.preventDefault(); actions.menu(item, open, undefined); } });
  return open;
}

/** The file type as the cards print it: the extension in capitals, Markdown as `MD`. */
const typeLabel = (format: string) => format.toLowerCase() === 'markdown' ? 'MD' : format.toUpperCase();

/** "Recently opened": one wide card, the cover at its left edge, the title beside it, the file type and the progress along its foot. */
function recentCard(item: HomeTile, painter: Painter): HTMLElement {
  const cell = element('div', 'home-recent');
  cell.dataset.homePath = item.path;
  cell.classList.toggle('is-missing', item.missing);
  const open = opener(item, 'home-recent-open', painter.actions);
  const foot = element('span', 'home-recent-foot');
  foot.append(element('span', 'home-recent-type', typeLabel(item.format)), element('span', 'home-recent-progress', formatProgress(item.progress)));
  const text = element('span', 'home-recent-text');
  text.append(element('span', 'home-card-title', item.title), foot);
  open.append(mediaOf(item, painter, 'recent'), text);
  cell.append(open);
  if (painter.actions.remove) {
    const remove = control('home-remove', `Remove ${item.name} from recents`, '×');
    remove.onclick = () => painter.actions.remove!(item.path, item.name);
    cell.append(remove);
  }
  return cell;
}

/** A cover card: the picture, the title, and one caption line, the file type and the progress when there is any. `stroke` draws the hairline on the cover. */
function documentCard(item: HomeTile, painter: Painter, stroke: boolean): HTMLElement {
  const cell = element('div', 'home-card');
  cell.setAttribute('role', 'listitem');
  cell.dataset.homePath = item.path;
  cell.classList.toggle('is-missing', item.missing);
  const open = opener(item, 'home-card-open', painter.actions);
  const art = element('span', stroke ? 'home-card-art has-stroke' : 'home-card-art');
  art.append(mediaOf(item, painter, 'shelf'));
  const cover = element('span', 'home-card-cover');
  cover.append(art);
  const meta = [typeLabel(item.format), formatProgress(item.progress)].filter(Boolean).join(' · ');
  open.append(cover, element('span', 'home-card-title', item.title), element('span', 'home-card-meta', meta));
  cell.append(open);
  return cell;
}

/** A labelled region with a heading. */
function section(id: string, title: string): { region: HTMLElement; heading: HTMLElement } {
  const region = element('section', 'home-section');
  const heading = element('h2', '', title);
  heading.id = `home-${id}`;
  region.setAttribute('aria-labelledby', heading.id);
  region.append(heading);
  return { region, heading };
}

/** A shelf: one row of cards that scrolls sideways, with ‹ › buttons at its ends. */
function shelf(id: string, title: string, cards: HTMLElement[], painter: Painter): HTMLElement {
  const { region, heading } = section(id, title);
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
  roving(track); dragScroll(track);
  painter.view.shelves.push({ track, previous, next });
  return region;
}

/** Paints the home into `root`, replacing whatever was there (the splash, or a previous home). */
export function renderHome(root: HTMLElement, sections: HomeSections, actions: HomeActions, appearance: Appearance): void {
  disposeHome();
  root.classList.add('is-home');
  root.replaceChildren();
  const ground = actions.banner === 'none' ? undefined : groundView(root, actions.banner);
  root.append(element('h1', '', 'Home'));
  const view = { shelves: [] as Shelf[], frame: 0, reduced: matchMedia('(prefers-reduced-motion: reduce)'), resize: new ResizeObserver(() => scheduleSync(view)), ground } as NonNullable<typeof current>;
  const painter: Painter = { actions, appearance, view };
  if (sections.recent.length) {
    const { region, heading } = section('recent', 'Recently opened');
    region.classList.add('home-recent-section');
    const row = element('div', 'home-recent-row');
    row.setAttribute('role', 'list');
    row.setAttribute('aria-labelledby', heading.id);
    for (const item of sections.recent) {
      const card = recentCard(item, painter);
      card.setAttribute('role', 'listitem');
      row.append(card);
    }
    region.append(row);
    root.append(region);
  }
  if (sections.reading.length) root.append(shelf('reading', 'Continue reading', sections.reading.map(item => documentCard(item, painter, true)), painter));
  for (const { type, title, tiles } of sections.types) root.append(shelf(`type-${type}`, title, tiles.map(item => documentCard(item, painter, false)), painter));
  current = view;
  if (ground) { ground.resize.observe(root); ground.resize.observe(document.body); }
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
  // A shelf cover keeps its slot (170 tall), so a picture of another proportion moves nothing but itself; the recent card's cover crops.
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
