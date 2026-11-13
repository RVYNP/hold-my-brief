import './library.css';
import { addDocuments, desktop, editLibrary, getLibrary, readingProgress, chooseSourceRoot, locateLibraryDocument, indexFolder } from './bridge';
import { emptyLibrary, type Collection, type Library, type LibraryDocument } from './catalog-types';
import { fileTypeChoices, isImage, matchesFileType, searchText } from './library-query';
import { clampLibraryWidth, defaultLibraryView, libraryGrid, libraryGridColumns, libraryTileSize, libraryWidth, libraryWidthBounds, parseLibraryView, parseLibraryWidth, parseTileSize, type LibrarySide, type LibraryView } from './library-layout';
import { canThumbnail, createThumbnailStore, type Thumbnail } from './thumbnails';
import { colourHex, colourMatches, colourNames, colourSwatches, nameColour, parseColourName, type ColourName } from './colour';
import { shortcutFor } from './commands';
import { buildLibraryTree, filterTree, sectionOf, type LibraryTree, type TreeNode } from './library-tree';
import { createTreeView } from './library-tree-view';
import type { RailView } from './icon-rail';
import { formatProgress, inProgress, type Progress } from './progress';
import { coverNode as cardCover, markUnavailable, placeTiles, repaintCovers, showPicture, tileMedia } from './cards';
import { createIntake, intakeSource, intakeTitle, newArrivals, movedCollectionIds, type IntakeHost } from './intake';
import { assignCoverSlots, collectionDisplayName, compareCollections, coverRatio, coverSeedOf, displayTitle, groupIntoShelves, shelfLayout, type Shelf } from './shelf';
import { onAppearanceChange, scheme } from './theme';

/** `pending` is how many pictures still had no measured colours when the answer was given (0 = `matches` is complete). */
export type LibraryFilterResult = { colour: string | null; query: string; matches: number; names: string[]; pending: number };
const titleCase = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

type Callbacks = {
  open: (path: string) => Promise<boolean>;
  /** Gives a document a tab beside the one showing without showing it (⌘/Ctrl-click in the tree). */
  openBackground: (doc: LibraryDocument) => void;
  error: (error: unknown) => void;
  /** The library changed (an edit, a refresh): the opening page shows part of it too. */
  changed?: (library: Library, progress: Readonly<Record<string, Progress>>) => void;
  /** Reading progress changed since it was last shown (the drawer was opened after some reading): Home and the rail show it too. */
  progressChanged?: (progress: Readonly<Record<string, Progress>>) => void;
  /** Saves the position being read, so the progress the library reads next includes it. */
  settle?: () => Promise<void>;
  /** The library moved to the other side, from the icon rail's button or elsewhere; the icon rail follows. */
  sideChanged?: (side: LibrarySide) => void;
  /** The info rail opened on a view, or closed (`null`): the icon rail marks the one that is showing. */
  viewChanged?: (view: RailView | null) => void;
  /** The icon-rail button that stands for `view`, where focus returns when the info rail closes. */
  door?: (view: RailView) => HTMLElement | undefined;
};
/** What Home's "Show all" opens the library on. */
export type LibraryScope = 'all' | 'favorites' | 'reading' | { collection: string };
type Filter = { kind: 'all' | 'favorites' | 'reading' | 'unfiled' } | { kind: 'collection' | 'source'; id: string } | { kind: 'folder'; id: string; path: string };
const pageSize = 40;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function button(text: string, label?: string, key?: string) {
  const node = element('button', '', text); node.type = 'button';
  if (label) node.setAttribute('aria-label', label);
  if (key) node.dataset.libraryFocus = key;
  return node;
}
function timestamp(value: number | string) {
  const numeric = Number(value); return Number.isFinite(numeric) ? numeric : Date.parse(String(value)) || 0;
}
function option(select: HTMLSelectElement, value: string, label: string) {
  const node = element('option', '', label); node.value = value; select.append(node);
}
function check(label: string, checked = false) {
  const row = element('label', 'library-check'); const input = element('input'); input.type = 'checkbox'; input.checked = checked;
  row.append(input, element('span', '', label)); return { row, input };
}
function descendantIds<T extends { id: string; parentId: string | null }>(items: T[], id: string): Set<string> {
  const result = new Set([id]); const children = new Map<string, string[]>();
  for (const item of items) if (item.parentId) children.set(item.parentId, [...(children.get(item.parentId) ?? []), item.id]);
  const pending = [id];
  while (pending.length) for (const child of children.get(pending.pop()!) ?? []) if (!result.has(child)) { result.add(child); pending.push(child); }
  return result;
}
// Lucide outlines, drawn at the toolbar's stroke weight.
function icon(paths: string) {
  return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}
const closeIcon = icon('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>');
const plusIcon = icon('<path d="M5 12h14"/><path d="M12 5v14"/>');
const searchIcon = icon('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>');
const menuIcon = icon('<path d="M4 6h16M4 12h16M4 18h16"/>').replace('width="15" height="15"', 'width="13" height="13" class="library-menu-icon"');
const boardIcon = { open: icon('<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>'), close: icon('<path d="m14 10 7-7"/><path d="M20 10h-6V4"/><path d="m3 21 7-7"/><path d="M4 14h6v6"/>') };
function savedPreference(key: string) { try { return localStorage.getItem(key); } catch { return null; } }
function savePreference(key: string, value: string) { try { localStorage.setItem(key, value); } catch { /* Optional preference. */ } }
function orderedTree<T extends { id: string; name: string; parentId: string | null }>(items: T[]): { item: T; depth: number }[] {
  const ids = new Set(items.map(item => item.id)); const visited = new Set<string>(); const result: { item: T; depth: number }[] = [];
  const children = new Map<string | null, T[]>();
  for (const item of items) {
    const parent = item.parentId && ids.has(item.parentId) ? item.parentId : null;
    children.set(parent, [...(children.get(parent) ?? []), item]);
  }
  function visit(item: T, depth: number) {
    if (visited.has(item.id)) return; visited.add(item.id); result.push({ item, depth });
    for (const child of children.get(item.id) ?? []) visit(child, depth + 1);
  }
  for (const item of children.get(null) ?? []) visit(item, 0);
  // Corrupt/cyclic source hierarchy must remain inspectable, never hide entries.
  for (const item of items) if (!visited.has(item.id)) visit(item, 0);
  return result;
}

export function createLibrary(root: HTMLElement, callbacks: Callbacks): {
  refresh: (activePath?: string) => Promise<void>; toggle: () => void; board: () => void;
  /** The side the library, drawer and rail, is kept on (one saved preference), and the way to change it. */
  side: () => LibrarySide; setSide: (side: LibrarySide) => void;
  /** Opens the library on all references, on favorites, on the documents still being read, or on one collection (the board where there is room). */
  browse: (scope: LibraryScope) => void;
  /** Sets the colour and/or search text of the library list (opening the drawer if needed) and reports what matches. `colour: null` clears it; omitted fields are left alone. */
  filter: (change: { colour?: string | null; query?: string }) => Promise<LibraryFilterResult>;
  colourNames: readonly string[];
  /** The info rail's view, and how the icon rail changes it: opens the rail on `view`, or collapses it when it already shows that one. */
  view: () => RailView; showView: (view: RailView) => void;
  /** Opens the Add files menu (add files, manage sources) beside `anchor`: the icon rail's button, which stands there even when the rail is closed. */
  openAddMenu: (anchor: HTMLElement) => void;
  /** The document showing (none: Home): its row is marked in the tree and the folders above it are opened. */
  setActive: (path: string | undefined) => void;
} {
  // Info rail mode: at >=720 px the library is a resizable rail floating over the page beside the icon rail; below it
  // becomes a compact sheet with a scrim, a focus trap and workspace `inert`.
  const wide = window.matchMedia('(min-width: 720px)');
  const layout = document.getElementById('reader-layout');
  const toggleButton = document.getElementById('library-toggle');
  const workspace = document.getElementById('workspace');
  const preferenceKey = () => `hold-my-brief:library-${wide.matches ? 'wide' : 'narrow'}`;
  function preference() { try { const saved = localStorage.getItem(preferenceKey()); return saved === null ? wide.matches : saved === 'open'; } catch { return wide.matches; } }
  let visible = preference(); let library: Library = emptyLibrary(); let filter: Filter = { kind: 'all' };
  let activePath: string | undefined; let progress: Record<string, Progress> = {}; let busy = false, loaded = false, revision = 0, page = 0;
  let loadError = false; let modal: HTMLDialogElement | undefined; let modalError: HTMLElement | undefined;
  let matches: LibraryDocument[] = []; let imageSequence: string[] = [];
  const expanded = new Set<string>(); const knownCollections = new Set<string>();
  // The info rail shows one of four views; Library and Search are the whole tree (Search with its filter field open), Collections is its
  // COLLECTIONS section, Favorites a flat list. `treeQuery` narrows the tree; `filterOpen` is the filter field shown by hand.
  let railView: RailView = 'library'; let tree: LibraryTree = buildLibraryTree(emptyLibrary()); let treeQuery = ''; let filterOpen = false; let revealed: string | undefined;
  let collectionMatches = new Map<string, Set<string>>();
  let searchable = new Map<string, string>();
  const busyDisabled = new Map<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLButtonElement, boolean>();
  let view: LibraryView = 'list'; let menuAnchor: HTMLElement | undefined;
  // The sort, the availability and the file type are what the Recent menu and the chips set (the board's controls).
  let sortMode: 'recent' | 'name' = 'recent'; let availabilityFilter = ''; let fileType = ''; let chromeMenu: { menu: HTMLElement; anchor: HTMLElement } | undefined;
  // The board is the same drawer opened across the whole reading panel; it is never saved, so the drawer width is untouched.
  let board = false; let selectedPath: string | undefined;
  // Colour filter: a named hue applied on top of the collection and search. A picture counts once its colours are known.
  let colourFilter: ColourName | null = null; let colourIndex: Promise<number> | undefined; let colourUnknown = 0; let colourTimer = 0; const colourRequested = new Set<string>();

  root.classList.add('library-root');
  const backdrop = button('', 'Close library'); backdrop.className = 'library-backdrop'; backdrop.tabIndex = -1;
  const panel = element('aside', 'library-panel'); panel.setAttribute('aria-label', 'Reference library');
  const header = element('div', 'library-header'); const headerActions = element('div', 'library-header-actions');
  // Header, one line: the view's name and count, then the filter, + New (Collections), + (add files, sources; compact windows and the board only: the icon rail has Add files), → (the board) and, in the compact sheet, close.
  const heading = element('h2'); const headingText = element('span', '', 'Library'); const headingCount = element('span', 'library-title-count'); heading.append(headingText, headingCount);
  const close = button('', 'Close library'); close.className = 'library-close'; close.innerHTML = closeIcon; close.title = 'Close library';
  const plus = button('', 'Add files or manage sources', 'plus'); plus.className = 'library-plus'; plus.innerHTML = plusIcon; plus.title = 'Add files, manage sources'; plus.setAttribute('aria-haspopup', 'menu'); plus.setAttribute('aria-expanded', 'false');
  const boardButton = button('', 'Open library board', 'board'); boardButton.className = 'library-board-toggle'; boardButton.innerHTML = boardIcon.open; boardButton.title = 'Browse the library at full width';
  const filterToggle = button('', 'Filter the library', 'filter-toggle'); filterToggle.className = 'library-filter-toggle'; filterToggle.innerHTML = searchIcon; filterToggle.title = 'Filter folders and documents'; filterToggle.setAttribute('aria-expanded', 'false');
  const newCollection = button('+ New', 'New personal collection', 'new-collection-header'); newCollection.className = 'library-new-collection'; newCollection.hidden = true;
  headerActions.append(filterToggle, newCollection, plus, boardButton, close); header.append(heading, headerActions);
  // The Add files menu and the dialogs live beside the info rail, not in it: the icon rail opens them while the rail is closed.
  const addMenu = element('div', 'library-item-menu library-add-menu'); addMenu.setAttribute('role', 'menu'); addMenu.hidden = true;
  const dialogHost = element('div', 'library-dialog-host');
  const add = button('Add files…', 'Add local documents or images'); const sourcesButton = button('Sources…', 'Index folders and manage source locations');
  for (const item of [add, sourcesButton]) item.setAttribute('role', 'menuitem');
  addMenu.append(add, sourcesButton); (layout ?? root).append(addMenu, dialogHost);
  dialogHost.addEventListener('keydown', event => { if (shortcutFor(event) !== 'command-palette') event.stopPropagation(); });
  const searchLabel = element('label', 'library-search-label', 'Search library');
  const search = element('input', 'library-search'); search.type = 'search'; search.placeholder = 'Title, tags, notes, folder…'; search.id = 'library-search'; search.autocomplete = 'off'; searchLabel.htmlFor = search.id;
  // The info rail's own filter narrows the tree as you type; the board's search above has the fuller query (tags, notes, colour).
  const treeFilterRow = element('div', 'library-tree-filter'); treeFilterRow.hidden = true;
  const treeFilterLabel = element('label', 'library-search-label', 'Filter the library'); const treeFilter = element('input', 'library-tree-search'); treeFilter.type = 'search'; treeFilter.placeholder = 'Filter folders and documents'; treeFilter.id = 'library-tree-filter'; treeFilter.autocomplete = 'off'; treeFilterLabel.htmlFor = treeFilter.id;
  treeFilterRow.append(treeFilterLabel, treeFilter);
  const treeRoot = element('div'); treeRoot.setAttribute('aria-label', 'Library');
  const treeEmpty = element('div', 'library-empty'); treeEmpty.hidden = true;
  const colourSelect = element('select'); colourSelect.setAttribute('aria-label', 'Filter by colour'); option(colourSelect, '', 'Any colour');
  for (const name of colourNames) option(colourSelect, name, titleCase(name));
  const facets = element('div', 'library-facets'); facets.append(colourSelect);
  const navigation = element('nav', 'library-navigation'); navigation.setAttribute('aria-label', 'Library filters and collections');
  // The board's chips row: the scope names what is open, then one chip per file type the library has. The row scrolls sideways rather than wrapping.
  const scope = element('div', 'library-scope');
  const scopeTitle = element('h3', 'library-scope-name'); const scopeLabel = element('span', 'library-scope-label'); scopeTitle.append(scopeLabel);
  const colourChip = button('', undefined, 'colour-chip'); colourChip.className = 'library-colour-chip'; colourChip.hidden = true;
  const typeChips = element('div', 'library-type-chips'); typeChips.setAttribute('role', 'group'); typeChips.setAttribute('aria-label', 'File type');
  scope.append(scopeTitle, colourChip, typeChips);
  // The board's search and sort row: the search field, the result count, and the one menu for sort, view and availability.
  const searchRow = element('div', 'library-searchbar');
  const searchField = element('div', 'library-search-field'); searchField.append(searchLabel, search);
  const resultCount = element('span', 'library-result-count'); resultCount.setAttribute('role', 'status');
  const viewButton = button('', undefined, 'view-menu'); viewButton.className = 'library-view-button'; viewButton.setAttribute('aria-haspopup', 'menu'); viewButton.setAttribute('aria-expanded', 'false');
  const viewLabel = element('span', 'library-view-label'); viewButton.append(viewLabel); viewButton.insertAdjacentHTML('beforeend', menuIcon);
  searchRow.append(searchField, resultCount, viewButton);
  const boardNav = element('div', 'library-board-nav'); boardNav.append(navigation, facets);
  const itemMenu = element('div', 'library-item-menu'); itemMenu.setAttribute('role', 'menu'); itemMenu.hidden = true;
  // One menu: Sort by, View as, Show and, for the grid, Size.
  const viewMenu = element('div', 'library-item-menu library-view-menu'); viewMenu.setAttribute('role', 'menu'); viewMenu.hidden = true;
  const choices: { group: string; value: string; node: HTMLButtonElement }[] = [];
  function menuGroup(group: string, options: readonly (readonly [string, string])[], pick: (value: string) => void) {
    const section = element('div', 'library-menu-group'); section.setAttribute('role', 'group'); section.setAttribute('aria-label', group); section.append(element('div', 'library-menu-heading', group));
    for (const [value, label] of options) { const item = button(label); item.setAttribute('role', 'menuitemradio'); item.onclick = () => pick(value); choices.push({ group, value, node: item }); section.append(item); }
    viewMenu.append(section);
  }
  menuGroup('Sort by', [['recent', 'Recent'], ['name', 'Name A–Z']], value => { sortMode = value === 'name' ? 'name' : 'recent'; page = 0; renderDocuments(); });
  menuGroup('View as', [['list', 'List'], ['grid', 'Grid']], value => { savePreference(viewKey(), value); renderDocuments(); });
  menuGroup('Show', [['', 'Any availability'], ['ready', 'Ready'], ['missing', 'Missing']], value => { availabilityFilter = value; page = 0; renderDocuments(); });
  const sizeRow = element('label', 'library-size-row'); const sizeInput = element('input'); sizeInput.type = 'range'; sizeInput.min = String(libraryTileSize.min); sizeInput.max = String(libraryTileSize.max); sizeInput.step = String(libraryTileSize.step); sizeInput.setAttribute('aria-label', 'Tile size');
  sizeRow.append(element('span', '', 'Size'), sizeInput); viewMenu.append(sizeRow);
  const documents = element('div', 'library-documents'); documents.setAttribute('aria-label', 'Library items'); documents.setAttribute('role', 'list');
  const pager = element('div', 'library-pager');
  const fileInput = element('input'); fileInput.type = 'file'; fileInput.accept = '.pdf,.epub,.md,.markdown,.txt,.png,.jpeg,.jpg,.webp,.gif,.avif,.bmp'; fileInput.multiple = true; fileInput.hidden = true;
  // Board layout: the header and the collection tree become a left rail, the chips, search row and grid the
  // main column, and a detail strip joins from 1200 px. `arrange` moves the same nodes between the two layouts.
  const boardBack = button('', undefined, 'board-back'); boardBack.className = 'library-board-back'; boardBack.setAttribute('aria-keyshortcuts', 'Escape'); boardBack.insertAdjacentHTML('beforeend', `${boardIcon.close}<span>Back to reading</span><kbd>Esc</kbd>`);
  const rail = element('div', 'library-board-rail'); const boardMain = element('div', 'library-board-main');
  const detail = element('aside', 'library-detail'); detail.setAttribute('aria-label', 'Selected reference');
  const boardLayout = element('div', 'library-board'); boardLayout.append(rail, boardMain, detail);
  function arrange() {
    const focused = document.activeElement instanceof HTMLElement && root.contains(document.activeElement) ? document.activeElement : undefined;
    if (board) {
      searchRow.append(boardBack);
      rail.append(header, boardNav); boardMain.append(scope, searchRow, documents, pager);
      panel.replaceChildren(boardLayout, itemMenu, viewMenu, fileInput);
    } else {
      boardBack.remove(); panel.replaceChildren(header, treeFilterRow, treeRoot, treeEmpty, documents, pager, itemMenu, fileInput);
    }
    syncRail();
    if (focused?.isConnected) focused.focus();
  }
  const railTitles: Record<RailView, string> = { library: 'Library', favorites: 'Favorites', collections: 'Collections', search: 'Search' };
  /** Brings the header, the filter field and what fills the rail (the tree, or the favorites list) in line with the view; nothing is rebuilt. */
  function syncRail() {
    const list = !board && railView === 'favorites';
    headingText.textContent = board ? 'Library' : railTitles[railView];
    treeRoot.hidden = board || list; documents.hidden = !board && !list; pager.hidden = documents.hidden;
    const searching = railView === 'search' || filterOpen || treeQuery !== '';
    treeFilterRow.hidden = board || list || !searching;
    filterToggle.hidden = board || list || railView === 'search'; filterToggle.setAttribute('aria-expanded', String(!treeFilterRow.hidden));
    newCollection.hidden = board || railView !== 'collections';
    if (board || list) treeEmpty.hidden = true;
  }
  arrange();
  const resizeHandle = element('div', 'library-resize'); resizeHandle.tabIndex = 0;
  for (const [name, value] of [['role', 'separator'], ['aria-orientation', 'vertical'], ['aria-label', 'Resize library'], ['aria-controls', root.id]]) resizeHandle.setAttribute(name, value);
  const grip = element('span', 'library-resize-grip'); grip.append(element('span'), element('span'), element('span'));
  const tip = element('span', 'library-resize-tip'); tip.setAttribute('aria-hidden', 'true'); const tipValue = element('span', 'library-resize-value');
  tip.append(element('span', '', 'Drag to resize · double-click to reset'), tipValue); resizeHandle.append(grip, tip);
  root.replaceChildren(backdrop, panel, resizeHandle);
  const imageNavigation = element('div', 'library-image-navigation'); imageNavigation.hidden = true; imageNavigation.setAttribute('aria-label', 'Images in selected collection'); imageNavigation.setAttribute('role', 'group'); workspace?.append(imageNavigation);

  // Drawer width and dock side. The drawer floats over the reading panel, so its width never
  // affects the page. The stored width is the user's preference; the applied width is re-clamped
  // to the current window so growing the window restores it.
  const widthKey = 'hold-my-brief:library-width', sideKey = 'hold-my-brief:library-side';
  let preferredWidth = parseLibraryWidth(savedPreference(widthKey)); let width: number = libraryWidth.default;
  let side: LibrarySide = savedPreference(sideKey) === 'right' ? 'right' : 'left';
  const viewport = () => layout?.clientWidth || window.innerWidth;
  function applyWidth(next: number) {
    const bounds = libraryWidthBounds(viewport()); width = clampLibraryWidth(next, viewport());
    // Set on the root (it declares its own --library-width, which would shadow an inherited one)
    // and on the layout: the workspace reads it to keep the floating view controls clear of a
    // right-docked drawer, and the opening strip spans the reading panel beside the library.
    root.style.setProperty('--library-width', `${width}px`);
    layout?.style.setProperty('--library-width', `${width}px`);
    tipValue.textContent = `${width} px`;
    resizeHandle.setAttribute('aria-valuenow', String(width)); resizeHandle.setAttribute('aria-valuetext', `${width} pixels wide`);
    resizeHandle.setAttribute('aria-valuemin', String(bounds.min)); resizeHandle.setAttribute('aria-valuemax', String(bounds.max));
  }
  function setWidth(next: number) { applyWidth(next); preferredWidth = width; savePreference(widthKey, String(width)); }
  function applySide(notify = true) {
    layout?.classList.toggle('library-right', side === 'right');
    toggleButton?.setAttribute('data-library-side', side);
    if (notify) callbacks.sideChanged?.(side);
  }
  /** One preference for the info rail and the icon rail: both stand on `next`. */
  function setSide(next: LibrarySide) { if (next === side) return; side = next; savePreference(sideKey, side); applySide(); }
  // While dragging, only the drawer follows the pointer; it is out of flow, so the reading panel,
  // the page box and the canvas bitmap keep their exact geometry and never refit.
  let drag: { pointer: number; x: number; start: number; next?: number } | undefined; let dragFrame = 0;
  function setResizing(on: boolean) {
    document.documentElement.classList.toggle('library-resizing', on);
  }
  resizeHandle.addEventListener('pointerdown', event => {
    if (event.button !== 0 || drag || !wide.matches) return;
    event.preventDefault(); resizeHandle.setPointerCapture(event.pointerId);
    drag = { pointer: event.pointerId, x: event.clientX, start: width }; setResizing(true);
  });
  resizeHandle.addEventListener('pointermove', event => {
    if (drag?.pointer !== event.pointerId) return;
    const delta = event.clientX - drag.x; drag.next = drag.start + (side === 'left' ? delta : -delta);
    if (!dragFrame) dragFrame = requestAnimationFrame(() => { dragFrame = 0; if (drag?.next !== undefined) applyWidth(drag.next); });
  });
  function endDrag(event: PointerEvent) {
    if (drag?.pointer !== event.pointerId) return;
    const { next } = drag; drag = undefined; cancelAnimationFrame(dragFrame); dragFrame = 0;
    if (next !== undefined) setWidth(next);
    setResizing(false);
    if (resizeHandle.hasPointerCapture(event.pointerId)) resizeHandle.releasePointerCapture(event.pointerId);
  }
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) resizeHandle.addEventListener(type, endDrag);
  resizeHandle.addEventListener('dblclick', () => setWidth(libraryWidth.default));
  resizeHandle.addEventListener('keydown', event => {
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    // Arrows move the separator visually, so they mirror when the library is docked right.
    const step = (event.shiftKey ? libraryWidth.largeStep : libraryWidth.step) * (side === 'left' ? 1 : -1);
    const bounds = libraryWidthBounds(viewport());
    const next = event.key === 'ArrowRight' ? width + step : event.key === 'ArrowLeft' ? width - step : event.key === 'Home' ? bounds.min : event.key === 'End' ? bounds.max : event.key === 'Enter' ? libraryWidth.default : undefined;
    if (next === undefined) return;
    event.preventDefault(); setWidth(next);
  });
  let windowFrame = 0;
  window.addEventListener('resize', () => { if (!windowFrame) windowFrame = requestAnimationFrame(() => { windowFrame = 0; if (!drag) applyWidth(preferredWidth); }); });

  function applyVisibility() {
    root.hidden = !visible; layout?.classList.toggle('library-open', visible); toggleButton?.setAttribute('aria-expanded', String(visible));
    if (workspace) workspace.inert = visible && (!wide.matches || board);
    if (visible && loaded) void refreshProgress();
    if (visible) { thumbs.retryFailed(); for (const media of documents.querySelectorAll('.is-unavailable')) media.classList.remove('is-unavailable'); observeThumbnails(); } else { setBoard(false, 'none'); closeItemMenu(false); closeChromeMenu(false); clearThumbnails(); }
    callbacks.viewChanged?.(visible ? railView : null);
  }
  /** Where focus goes when the info rail closes: the icon that opened it, or the toolbar's button in a compact window. */
  function focusDoor() { const door = wide.matches ? callbacks.door?.(railView) : undefined; (door ?? toggleButton)?.focus(); }
  /** Where focus goes when the rail opens: the filter field (Search), the first favorite, or the tree. */
  function focusRail() {
    if (railView === 'search') treeFilter.focus();
    else if (railView === 'favorites') (documents.querySelector<HTMLElement>('.library-document-open') ?? close).focus();
    else treeView.focus();
    if (!root.contains(document.activeElement)) (plus.offsetParent ? plus : filterToggle).focus();
  }
  function setVisible(next: boolean, focus = true, persist = true) {
    visible = next; if (persist) try { localStorage.setItem(preferenceKey(), next ? 'open' : 'closed'); } catch { /* Optional preference. */ }
    applyVisibility(); if (focus) { if (next) focusRail(); else focusDoor(); }
  }
  function toggle() { if (modal?.open) return; setVisible(!visible); }
  backdrop.onclick = close.onclick = () => { if (!busy) setVisible(false); };
  wide.addEventListener('change', () => { const hadFocus = root.contains(document.activeElement); if (!wide.matches) setBoard(false, 'none'); visible = modal?.open ? true : preference(); applyVisibility(); if (!visible && hadFocus) focusDoor(); });
  root.addEventListener('keydown', event => {
    if (event.key === 'Escape' && (!itemMenu.hidden || chromeMenu)) { event.preventDefault(); event.stopPropagation(); if (!itemMenu.hidden) closeItemMenu(); else closeChromeMenu(); return; }
    // In the filter field Escape clears what was typed; with nothing typed it folds the field away (Search keeps it) and returns to the tree.
    if (event.key === 'Escape' && event.target === treeFilter && !modal?.open && (treeFilter.value || railView !== 'search')) {
      event.preventDefault(); event.stopPropagation();
      if (treeFilter.value) setTreeQuery(''); else { filterOpen = false; syncRail(); treeView.focus(); }
      return;
    }
    if (event.key === 'Escape' && board && !modal?.open) { event.preventDefault(); event.stopPropagation(); if (!busy) setBoard(false, 'control'); return; }
    if (event.key === 'Escape' && !modal?.open) { event.preventDefault(); event.stopPropagation(); if (!busy) setVisible(false); }
    if (event.key === 'Tab' && visible && !wide.matches && !modal?.open) {
      const controls = Array.from(panel.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled):not([hidden]), select:not(:disabled), summary, [role=treeitem][tabindex="0"]')).filter(node => node.getClientRects().length);
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    // Reader shortcuts must never consume typing, arrows, or space in the library. The palette (Ctrl+K)
    // is the exception: it is how every command is reached, so it works from the library too.
    const shortcut = shortcutFor(event);
    if (shortcut === 'command-palette' || shortcut === 'library' || shortcut === 'library-search') return;
    event.stopPropagation();
  });
  imageNavigation.addEventListener('keydown', event => { if (shortcutFor(event) !== 'command-palette') event.stopPropagation(); });
  function focusKey() { return document.activeElement instanceof HTMLElement && root.contains(document.activeElement) ? document.activeElement.dataset.libraryFocus : undefined; }
  function restoreFocus(key?: string, original?: HTMLElement) {
    if (original?.isConnected && !original.matches(':disabled') && original.getClientRects().length) { original.focus(); return; }
    if (!visible) { focusDoor(); return; }
    if (!key && root.contains(document.activeElement) && document.activeElement !== document.body) return; // a tree row keeps its focus
    const replacement = key && Array.from(root.querySelectorAll<HTMLElement>('[data-library-focus]')).find(node => node.dataset.libraryFocus === key);
    (replacement || plus).focus();
  }
  function setBusy(next: boolean) {
    busy = next; panel.setAttribute('aria-busy', String(next));
    if (next) for (const control of [...root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLButtonElement>('button, input, select, textarea'), ...dialogHost.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLButtonElement>('button, input, select, textarea'), ...addMenu.querySelectorAll<HTMLButtonElement>('button'), ...imageNavigation.querySelectorAll<HTMLButtonElement>('button')]) {
      if (!busyDisabled.has(control)) busyDisabled.set(control, control.disabled); control.disabled = true;
    }
    else { for (const [control, disabled] of busyDisabled) control.disabled = disabled; busyDisabled.clear(); }
  }
  function report(error: unknown) { if (modalError) modalError.textContent = error instanceof Error ? error.message : String(error); callbacks.error(error); }
  async function mutate(operation: () => Promise<Library>, after?: () => void) {
    if (busy) return; const key = focusKey(), hadDialog = Boolean(modal?.open), scrolled = documents.scrollTop; if (modalError) modalError.textContent = '';
    ++revision; setBusy(true);
    try { library = await operation(); ++revision; loaded = true; loadError = false; rebuildIndex(); render(); callbacks.changed?.(library, progress); documents.scrollTop = scrolled; after?.(); }
    catch (error) { report(error); }
    finally { setBusy(false); if (!hadDialog && !modal?.open) restoreFocus(key); }
  }
  function openDialog(heading: string, trigger: HTMLElement) {
    if (busy || modal?.open) return undefined;
    const key = trigger.dataset.libraryFocus; const dialog = element('dialog', 'library-dialog'); const form = element('form');
    const headingNode = element('h2', '', heading); headingNode.id = 'library-dialog-title'; dialog.setAttribute('aria-labelledby', headingNode.id);
    const content = element('div', 'library-dialog-content'); const error = element('p', 'library-dialog-error'); error.setAttribute('role', 'alert');
    const actions = element('div', 'dialog-actions'); const cancel = button('Close'); cancel.onclick = () => dialog.close();
    actions.append(cancel); form.append(headingNode, content, error, actions); dialog.append(form); form.onsubmit = event => event.preventDefault();
    dialogHost.append(dialog); modal = dialog; modalError = error;
    dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
    dialog.addEventListener('close', () => { dialog.remove(); if (modal === dialog) { modal = undefined; modalError = undefined; } restoreFocus(key, trigger); });
    return { dialog, form, content, actions };
  }
  function labeled<T extends HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(text: string, input: T) {
    const label = element('label', 'library-field', text); label.append(input); return label;
  }
  function parentOptions(select: HTMLSelectElement, excluded = new Set<string>()) {
    option(select, '', 'Top level');
    for (const { item, depth } of orderedTree(library.collections.filter(item => !item.sourceId))) if (!excluded.has(item.id)) option(select, item.id, `${'— '.repeat(depth)}${collectionDisplayName(item.name)}`);
  }
  function collectionForm(trigger: HTMLElement, collection?: Collection) {
    const view = openDialog(collection ? 'Edit collection' : 'New collection', trigger); if (!view) return;
    const input = element('input'); input.required = true; input.maxLength = 120; input.autocomplete = 'off'; input.value = collection?.name ?? '';
    const parent = element('select'); parentOptions(parent, collection ? descendantIds(library.collections, collection.id) : undefined);
    const current = filter.kind === 'collection' ? library.collections.find(item => filter.kind === 'collection' && item.id === filter.id) : undefined;
    parent.value = collection?.parentId ?? (current && !current.sourceId ? current.id : '');
    const submit = button(collection ? 'Save collection' : 'Create collection'); submit.type = 'submit'; submit.className = 'primary';
    view.content.append(labeled('Collection name', input), labeled('Parent collection', parent)); view.actions.append(submit);
    if (collection) {
      const remove = button('Delete collection…'); remove.className = 'library-remove'; const confirmation = element('div', 'library-remove-confirmation'); confirmation.hidden = true;
      const confirm = button('Delete collection'); confirm.className = 'danger'; const keep = button('Keep collection');
      confirmation.append(element('p', '', 'Delete this collection only? Children move to its parent. Items, other memberships, original files, and reading positions stay intact.'), keep, confirm); view.content.append(remove, confirmation);
      remove.onclick = () => { confirmation.hidden = false; confirm.focus(); }; keep.onclick = () => { confirmation.hidden = true; remove.focus(); };
      confirm.onclick = () => void mutate(() => editLibrary({ action: 'deleteCollection', id: collection.id }), () => view.dialog.close());
    }
    input.oninput = () => input.setCustomValidity('');
    view.form.onsubmit = event => {
      event.preventDefault(); const name = input.value.trim(); if (!name) { input.setCustomValidity('Enter a collection name.'); input.reportValidity(); return; }
      const id = collection?.id ?? crypto.randomUUID();
      void mutate(async () => {
        if (!collection) return editLibrary({ action: 'createCollection', id, name, parentId: parent.value || null });
        // Separate existing command contracts; retain a successful rename if a move fails.
        let next = library;
        if (name !== collection.name) { next = await editLibrary({ action: 'renameCollection', id, name }); library = next; }
        if ((parent.value || null) !== collection.parentId) next = await editLibrary({ action: 'moveCollection', id, parentId: parent.value || null });
        return next;
      }, () => { filter = { kind: 'collection', id }; if (parent.value) expanded.add(parent.value); page = 0; render(); view.dialog.close(); });
    };
    view.dialog.showModal(); input.focus(); input.select();
  }
  // A relocated original may be a different file under the same entry, so its old thumbnail goes.
  const locateOriginal = (doc: LibraryDocument, after?: () => void) => void mutate(() => { thumbs.forget(doc.path); return locateLibraryDocument(doc.path); }, after);
  function locationActions(doc: LibraryDocument, target: HTMLElement, closeDialog?: () => void) {
    const provenance = doc.source;
    if (provenance) {
      const source = element('dl', 'library-provenance');
      for (const [label, value] of [['Source', provenance.repository], ['Relative file', provenance.relativePath]]) if (value) source.append(element('dt', '', label), element('dd', '', value));
      target.append(source);
      if (provenance.removed) target.append(element('p', 'library-warning', 'No longer found in its indexed folder. This entry and your personal organization have not been deleted.'));
    }
    if (!desktop) return;
    const rootInfo = library.roots.find(item => item.id === provenance?.rootId);
    if (rootInfo) {
      target.append(element('p', 'library-dialog-help', `${rootInfo.name}: ${rootInfo.path ?? 'Not located'}`));
      if (!rootInfo.managed) { const locateRoot = button(`Locate ${rootInfo.name} root…`); locateRoot.onclick = () => void mutate(() => chooseSourceRoot(rootInfo.id), closeDialog); target.append(locateRoot); }
    }
    const locate = button('Locate this original…'); locate.onclick = () => locateOriginal(doc, closeDialog); target.append(locate);
  }
  function organize(doc: LibraryDocument, trigger: HTMLElement) {
    const view = openDialog('Organize reference', trigger); if (!view) return;
    view.content.append(element('p', 'library-dialog-document', docLabel(doc)));
    const memberships = element('fieldset', 'library-memberships'); memberships.append(element('legend', '', 'Collections'));
    const selected = new Set(doc.collectionIds); const collectionInputs: { collection: Collection; input: HTMLInputElement }[] = [];
    for (const { item, depth } of orderedTree(library.collections)) {
      const choice = check(`${collectionDisplayName(item.name)}${item.sourceId ? ' · source-owned' : ''}`, selected.has(item.id)); choice.row.style.paddingInlineStart = `${depth * 14}px`; choice.input.disabled = Boolean(item.sourceId);
      memberships.append(choice.row); collectionInputs.push({ collection: item, input: choice.input });
    }
    if (!collectionInputs.length) memberships.append(element('p', 'library-dialog-help', 'Create a personal collection from the sidebar to organize this item.'));
    const favorite = check('Favorite', doc.favorite); const tags = element('input'); tags.value = doc.tags.join(', '); tags.placeholder = 'Comma-separated personal tags';
    const notes = element('textarea'); notes.rows = 4; notes.value = doc.notes;
    view.content.append(memberships, favorite.row, labeled('Personal tags', tags), labeled('Personal notes', notes), element('p', 'library-dialog-help', 'Indexed folder memberships are read-only. Personal notes, tags, favorites, and collections survive re-indexing. Originals never move.'));
    const sourceDetails = element('details'); sourceDetails.append(element('summary', '', 'Source and original location')); locationActions(doc, sourceDetails, () => view.dialog.close()); view.content.append(sourceDetails);
    const submit = button('Save organization'); submit.type = 'submit'; submit.className = 'primary'; view.actions.append(submit);
    const remove = button('Remove from library…'); remove.className = 'library-remove'; const confirmation = element('div', 'library-remove-confirmation'); confirmation.hidden = true;
    const confirm = button('Remove entry'); confirm.className = 'danger'; const keep = button('Keep reference');
    confirmation.append(element('p', '', 'Remove only this library entry? The original file and saved reading position will not be deleted. Re-indexing its folder may add it again.'), keep, confirm); view.content.append(remove, confirmation);
    remove.onclick = () => { confirmation.hidden = false; confirm.focus(); }; keep.onclick = () => { confirmation.hidden = true; remove.focus(); };
    confirm.onclick = () => void mutate(() => editLibrary({ action: 'removeDocument', path: doc.path }), () => view.dialog.close());
    view.form.onsubmit = event => {
      event.preventDefault(); const current = library.documents.find(item => item.path === doc.path); if (!current) { view.dialog.close(); return; }
      // Keep all source-owned memberships, including ones not shown.
      const ids = new Set(current.collectionIds.filter(id => { const item = library.collections.find(collection => collection.id === id); return !item || Boolean(item.sourceId); }));
      for (const { collection, input } of collectionInputs) if (!collection.sourceId && input.checked) ids.add(collection.id);
      void mutate(() => editLibrary({ action: 'updateDocument', path: doc.path, collectionIds: [...ids], favorite: favorite.input.checked, tags: [...new Set(tags.value.split(',').map(tag => tag.trim()).filter(Boolean))], notes: notes.value }), () => view.dialog.close());
    };
    view.dialog.showModal(); tags.focus();
  }
  function referenceDetails(doc: LibraryDocument, trigger: HTMLElement) {
    const view = openDialog(docLabel(doc), trigger); if (!view) return;
    const creator = doc.format === 'epub' ? thumbs.epub(doc.path)?.creator : undefined;
    if (creator) view.content.append(element('p', 'library-dialog-help', creator));
    view.content.append(element('p', 'library-document-meta', rowMeta(doc)));
    if (doc.tags.length) view.content.append(element('p', 'library-dialog-help', `Personal tags: ${doc.tags.join(', ')}`));
    if (doc.notes) view.content.append(element('p', 'library-description', doc.notes));
    locationActions(doc, view.content, () => view.dialog.close());
    const read = button('Open in reader'); read.onclick = () => { view.dialog.close(); void openDocument(doc, trigger); }; view.actions.append(read);
    const edit = button('Organize…'); edit.onclick = () => { view.dialog.close(); organize(doc, trigger); }; view.actions.append(edit); view.dialog.showModal();
  }
  async function openDocument(doc: LibraryDocument, trigger?: HTMLElement, sequence?: string[]) {
    if (busy) return;
    if (isImage(doc) && sequence) imageSequence = sequence;
    setBusy(true); let opened = false;
    try {
      opened = await callbacks.open(doc.path);
      if (opened) { activePath = doc.path; revealed = undefined; renderImageNavigation(); paintTree(); if (!wide.matches) { setVisible(false, false, false); workspace?.querySelector<HTMLElement>('.reader-host:not(.staging)')?.focus(); } }
    } catch (error) { report(error); }
    finally { setBusy(false); if (!opened) restoreFocus(`open:${doc.path}`, trigger); }
  }
  function renderImageNavigation() {
    const focused = document.activeElement instanceof HTMLElement && imageNavigation.contains(document.activeElement) ? document.activeElement.dataset.imageDirection : undefined;
    imageNavigation.replaceChildren(); const doc = library.documents.find(item => item.path === activePath);
    imageNavigation.hidden = !doc || !isImage(doc); workspace?.classList.toggle('has-image-navigation', !imageNavigation.hidden); if (!doc || !isImage(doc)) return;
    imageSequence = imageSequence.filter(path => library.documents.some(item => item.path === path && isImage(item)));
    if (!imageSequence.includes(doc.path)) imageSequence = matches.filter(isImage).map(item => item.path);
    if (!imageSequence.includes(doc.path)) imageSequence = [doc.path];
    const index = imageSequence.indexOf(doc.path); const previous = button('←', 'Previous image in collection'); const next = button('→', 'Next image in collection');
    previous.dataset.imageDirection = 'previous'; next.dataset.imageDirection = 'next'; previous.disabled = index <= 0; next.disabled = index >= imageSequence.length - 1;
    const move = (offset: number) => { const target = library.documents.find(item => item.path === imageSequence[index + offset]); if (target) void openDocument(target); };
    previous.onclick = () => move(-1); next.onclick = () => move(1);
    const caption = element('span', '', `${index + 1} / ${imageSequence.length} · ${doc.name}`); caption.title = doc.name;
    imageNavigation.append(previous, caption, next);
    if (busy) setBusy(true);
    if (focused) { const control = imageNavigation.querySelector<HTMLButtonElement>(`[data-image-direction="${focused}"]`); if (control && !control.disabled) control.focus(); }
  }
  function sourceManager(trigger: HTMLElement) {
    const view = openDialog('Sources and originals', trigger); if (!view) return;
    if (desktop) {
      const indexButton = button('Index a folder', undefined, 'index-folder'); indexButton.className = 'primary';
      indexButton.onclick = () => void addAndReview(() => indexFolder(), 'Indexed folder', true, trigger, () => view.dialog.close());
      const row = element('section', 'library-source-card');
      row.append(element('h3', '', 'Folders'), element('p', 'library-dialog-help', 'PDF, EPUB, Markdown and text; files stay where they are.'), element('p', 'library-dialog-help', 'Choose a folder to list its documents, grouped by subfolder. Each entry points at its real file; nothing is copied. Index the same folder again to pick up changes.'), indexButton);
      view.content.append(row);
    } else view.content.append(element('p', 'library-dialog-help', 'Folder indexing and source locations require the desktop app. Browser mode supports locally chosen documents and images.'));
    for (const sourceRoot of library.roots) {
      const row = element('section', 'library-source-card'); row.append(element('h3', '', sourceRoot.name), element('p', 'library-source-path', sourceRoot.path ?? 'Not located'));
      if (desktop && !sourceRoot.managed) { const locate = button('Locate folder…'); locate.onclick = () => void mutate(() => chooseSourceRoot(sourceRoot.id), () => view.dialog.close()); row.append(locate); }
      view.content.append(row);
    }
    view.dialog.showModal();
  }

  function rebuildIndex() {
    searchable = new Map(library.documents.map(doc => [doc.path, searchText(doc)])); collectionMatches = new Map();
    // Siblings get distinct cover styles by display order, so shelves side by side never share art or hue.
    const siblings = new Map<string | null, Collection[]>();
    for (const collection of library.collections) siblings.set(collection.parentId, [...(siblings.get(collection.parentId) ?? []), collection]);
    assignCoverSlots([...siblings.values()].map(group => [...group].sort(compareCollections).map(collection => collection.id)));
    for (const collection of library.collections) {
      if (!knownCollections.has(collection.id)) { knownCollections.add(collection.id); if (!collection.parentId) expanded.add(collection.id); }
      collectionMatches.set(collection.id, new Set(library.documents.filter(doc => doc.collectionIds.includes(collection.id)).map(doc => doc.path)));
    }
    for (const { item } of orderedTree(library.collections).reverse()) {
      if (!item.parentId) continue;
      const parent = collectionMatches.get(item.parentId); if (parent) for (const path of collectionMatches.get(item.id) ?? []) parent.add(path);
    }
    tree = buildLibraryTree(library); if (loaded) treeView.prune(treeIds(tree)); revealed = undefined;
    thumbs.reconcile(new Set(library.documents.map(doc => doc.path))); colourIndex = undefined; colourRequested.clear();
  }
  function renderNavigation() {
    navigation.replaceChildren();
    function filterButton(label: string, count: number, next: Filter, key: string) {
      const control = button('', label, key); control.className = 'library-filter'; control.append(element('span', 'library-filter-name', label), element('span', 'library-count', String(count)));
      control.setAttribute('aria-pressed', String(filter.kind === next.kind && (!('id' in next) || 'id' in filter && filter.id === next.id)));
      control.onclick = () => { filter = next; page = 0; render(); }; return control;
    }
    navigation.append(filterButton('All references', library.documents.length, { kind: 'all' }, 'all'), filterButton('Favorites', library.documents.filter(doc => doc.favorite).length, { kind: 'favorites' }, 'favorites'), filterButton('Continue reading', library.documents.filter(doc => inProgress(progress[doc.path])).length, { kind: 'reading' }, 'reading'), filterButton('Unfiled', library.documents.filter(doc => !doc.collectionIds.length).length, { kind: 'unfiled' }, 'unfiled'));
    const heading = element('div', 'library-collections-heading'); const create = button('+ New', 'New personal collection', 'new-collection'); create.onclick = () => collectionForm(create); heading.append(element('h3', '', 'Collections'), create); navigation.append(heading);
    const parents = new Set(library.collections.map(item => item.parentId)); const byId = new Map(library.collections.map(item => [item.id, item]));
    for (const { item, depth } of orderedTree(library.collections)) {
      let parent = item.parentId, hidden = false; const seen = new Set<string>();
      while (parent && !seen.has(parent)) { seen.add(parent); if (byId.has(parent) && !expanded.has(parent)) hidden = true; parent = byId.get(parent)?.parentId ?? null; }
      if (hidden) continue;
      const row = element('div', 'library-collection'); row.style.paddingInlineStart = `${Math.min(depth, 8) * 11}px`;
      if (parents.has(item.id)) { const expand = button(expanded.has(item.id) ? '▾' : '▸', `${expanded.has(item.id) ? 'Collapse' : 'Expand'} ${collectionDisplayName(item.name)}`, `expand:${item.id}`); expand.className = 'library-expand'; expand.setAttribute('aria-expanded', String(expanded.has(item.id))); expand.onclick = () => { if (expanded.has(item.id)) expanded.delete(item.id); else expanded.add(item.id); renderNavigation(); restoreFocus(`expand:${item.id}`); }; row.append(expand); }
      else row.append(element('span', 'library-expand-spacer'));
      const select = filterButton(`${collectionDisplayName(item.name)}${item.removed ? ' · removed' : ''}`, collectionMatches.get(item.id)?.size ?? 0, { kind: 'collection', id: item.id }, `collection:${item.id}`);
      select.title = [collectionDisplayName(item.name), item.sourceId ? 'Indexed folder collection' : 'Personal collection'].join('\n'); row.append(select);
      if (!item.sourceId) { const edit = button('···', `Edit ${collectionDisplayName(item.name)}`, `edit:${item.id}`); edit.className = 'library-collection-action'; edit.onclick = () => collectionForm(edit, item); row.append(edit); }
      navigation.append(row);
    }
    if (!library.collections.length) navigation.append(element('p', 'library-no-collections', 'Create a collection or index a folder.'));
    const sources = [...new Set(library.documents.map(doc => doc.source?.repository).filter((source): source is string => Boolean(source)))];
    if (sources.length) { const heading = element('div', 'library-collections-heading'); heading.append(element('h3', '', 'Sources')); navigation.append(heading); for (const source of sources) navigation.append(filterButton(source, library.documents.filter(doc => doc.source?.repository === source).length, { kind: 'source', id: source }, `source:${source}`)); }
  }

  // Thumbnails come from the shared store (src/thumbnails.ts). Tiles ask for theirs as they scroll into
  // view, and every re-render reuses what has already loaded, so typing in the search box fetches nothing.
  const thumbs = createThumbnailStore();
  let renderGeneration = 0;
  // The tile's media box is observed, not the <img>: it stays hidden until its picture arrives and a
  // hidden element never intersects.
  const thumbnailObserver = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) {
      const media = entry.target as HTMLElement; thumbnailObserver.unobserve(media); const path = media.dataset.path!;
      void thumbs.request(path, media.dataset.format!, () => media.isConnected && visible).then(thumbnail => {
        if (!media.isConnected) return;
        if (thumbnail) showThumbnail(media, thumbnail); else if (thumbs.failed(path)) markUnavailable(media);
        if (media.dataset.format === 'epub') reflectEpub(path);
      });
    }
  }, { root: documents, rootMargin: '120px' });
  const clearThumbnails = () => thumbnailObserver.disconnect();
  function observeThumbnails() { if (visible) for (const media of documents.querySelectorAll<HTMLElement>('[data-path]:not(.is-loaded):not(.is-unavailable)')) thumbnailObserver.observe(media); }
  function showThumbnail(media: HTMLElement, thumbnail: Thumbnail) {
    const tile = tileByPath.get(media.dataset.path!); if (tile && Math.abs(tile.ratio - thumbnail.ratio) > .001) { tile.ratio = thumbnail.ratio; schedulePlacement(); }
    showPicture(media, thumbnail);
  }
  let placementFrame = 0;
  function schedulePlacement() { if (!placementFrame) placementFrame = requestAnimationFrame(() => { placementFrame = 0; layoutGrid(); }); }
  // The picture box, its cover and the placement of tiles are shared with Home (src/cards.ts).
  window.addEventListener('pagehide', () => { clearThumbnails(); thumbs.dispose(); });

  // Board: a click selects a reference for the detail strip, and activating the selected one (a second click,
  // Enter, VoiceOver's press) opens it and returns to reading. Outside the board a click opens it, as before.
  function labelOpen(open: HTMLElement, doc: { name: string; path: string }) {
    if (!board) { open.setAttribute('aria-label', `Open ${doc.name}`); open.removeAttribute('aria-pressed'); return; }
    const selected = doc.path === selectedPath;
    open.setAttribute('aria-pressed', String(selected)); open.setAttribute('aria-label', `${selected ? 'Open' : 'Select'} ${doc.name}`);
  }
  function bindOpen(doc: LibraryDocument, open: HTMLElement, node: HTMLElement) {
    node.dataset.docPath = doc.path; node.dataset.docName = docLabel(doc); node.classList.toggle('is-selected', board && doc.path === selectedPath); labelOpen(open, { name: docLabel(doc), path: doc.path });
    open.onclick = () => {
      if (!board) void openDocument(doc, open, matches.filter(isImage).map(item => item.path));
      else if (selectedPath === doc.path) void openFromBoard(doc, open);
      else selectDocument(doc.path);
    };
    open.onkeydown = event => { if (board && event.key === 'Enter') { event.preventDefault(); void openFromBoard(doc, open); } };
  }
  function selectDocument(path: string | undefined) {
    selectedPath = path;
    for (const node of documents.querySelectorAll<HTMLElement>('[data-doc-path]')) {
      node.classList.toggle('is-selected', board && node.dataset.docPath === path);
      const open = node.querySelector<HTMLElement>('.library-document-open'); if (open) labelOpen(open, { name: node.dataset.docName ?? '', path: node.dataset.docPath ?? '' });
    }
    renderDetail();
  }
  async function openFromBoard(doc: LibraryDocument, trigger: HTMLElement) {
    await openDocument(doc, trigger, matches.filter(isImage).map(item => item.path));
    if (activePath === doc.path) setBoard(false, 'reader');
  }
  function setBoard(next: boolean, focus: 'none' | 'control' | 'reader') {
    if (next === board || next && (!wide.matches || !visible || modal?.open)) return;
    closeItemMenu(false); closeChromeMenu(false); board = next;
    // Leaving the board returns the scope to what the info rail's view shows: the favorites list, or every reference for the tree.
    if (!board) { filter = railView === 'favorites' ? { kind: 'favorites' } : { kind: 'all' }; page = 0; }
    root.classList.toggle('is-board', board); boardButton.setAttribute('aria-pressed', String(board));
    if (workspace) workspace.inert = visible && (!wide.matches || board);
    arrange(); renderDocuments(); paintTree();
    if (focus === 'reader') workspace?.querySelector<HTMLElement>('.reader-host:not(.staging)')?.focus();
    else if (focus === 'control') (board ? documents.querySelector<HTMLElement>('.is-selected .library-document-open') ?? search : boardButton).focus();
  }
  boardButton.onclick = () => setBoard(true, 'control'); boardBack.onclick = () => setBoard(false, 'control');
  // The detail strip (from 1200 px): the selected reference at a glance, with the actions the tile menu has.
  function renderDetail() {
    if (!board) return;
    detail.replaceChildren(); const doc = library.documents.find(item => item.path === selectedPath);
    if (!doc) { detail.append(element('p', 'library-detail-empty', 'Select a reference to see its details.')); return; }
    const missing = (doc.availability ?? 'ready') === 'missing'; const cached = thumbs.peek(doc.path);
    const preview = element('div', 'library-detail-preview'); preview.classList.toggle('is-empty', !cached); preview.classList.toggle('is-cover', !cached && hasCover(doc));
    if (cached) { const image = element('img'); image.alt = ''; image.src = cached.url; preview.append(image); }
    else {
      if (!missing && hasCover(doc)) {
        preview.append(coverNode(doc, coverShelf.has(doc.path) ? coverShelf.get(doc.path) : doc.collectionIds[0]));
        const reroll = rerollButton(doc, 'detail-reroll'); reroll.classList.add('library-detail-reroll'); preview.append(reroll);
      } else preview.append(element('span', '', missing ? 'Missing' : doc.format.toUpperCase()));
      if (thumbnailable(doc) && !missing) void thumbs.request(doc.path, doc.format, () => board && selectedPath === doc.path).then(made => { if (made && board && selectedPath === doc.path) renderDetail(); });
    }
    const name = element('h3', 'library-detail-name', docLabel(doc)); name.title = doc.path;
    const open = button('Open in reader'); open.className = 'library-detail-open'; open.append(element('kbd', '', 'Enter')); open.onclick = () => void openFromBoard(doc, open);
    const organizeButton = button('Organize…'); organizeButton.onclick = () => organize(doc, organizeButton);
    const actions = element('div', 'library-detail-actions'); actions.append(open, organizeButton);
    detail.append(preview, name);
    const creator = doc.format === 'epub' ? thumbs.epub(doc.path)?.creator : undefined; if (creator) detail.append(element('p', 'library-detail-creator', creator));
    detail.append(element('p', 'library-detail-meta', rowMeta(doc, false)));
    if (docLabel(doc) !== doc.name) detail.append(element('p', 'library-detail-file', doc.name));
    detail.append(actions);
    const byId = new Map(library.collections.map(item => [item.id, item]));
    const chain = (id: string) => { const names: string[] = []; const seen = new Set<string>(); let current = byId.get(id); while (current && !seen.has(current.id)) { seen.add(current.id); names.unshift(collectionDisplayName(current.name)); current = current.parentId ? byId.get(current.parentId) : undefined; } return names.join(' › '); };
    const provenance = doc.source;
    for (const [label, value] of [['Collection', doc.collectionIds.map(chain).filter(Boolean).join('\n')], ['Tags', doc.tags.join(', ')], ['Notes', doc.notes], ['Source', [provenance?.repository, provenance?.relativePath ?? provenance?.sourcePath].filter(Boolean).join(' / ')]]) {
      if (!value) continue; const section = element('section', 'library-detail-section'); section.append(element('h4', '', label), element('p', '', value)); detail.append(section);
    }
    const colours = thumbs.colours(doc.path);
    if (colours?.length) {
      const section = element('section', 'library-detail-section'); const swatches = element('div', 'library-swatches');
      for (const colour of colours) {
        const name = nameColour(colour); const swatch = button('', `Filter the library by ${name}`); swatch.className = 'library-swatch'; swatch.style.background = colourHex(colour); swatch.title = `${titleCase(name)} — filter by this`;
        swatch.onclick = () => setColour(name); swatches.append(swatch);
      }
      section.append(element('h4', '', 'Colours'), swatches); detail.append(section);
    }
  }

  // Scope popover: the collection tree and the two filters, opened from the scope row.
  function scopeName() {
    const selected = filter;
    if (!('id' in selected)) return selected.kind === 'all' ? 'All references' : selected.kind === 'favorites' ? 'Favorites' : selected.kind === 'reading' ? 'Continue reading' : 'Unfiled';
    if (selected.kind === 'source') return selected.id;
    if (selected.kind === 'folder') return selected.path ? selected.path.split('/').pop()! : library.roots.find(item => item.id === selected.id)?.name ?? 'Folder';
    const named = library.collections.find(item => item.id === selected.id); return named ? collectionDisplayName(named.name) : 'Collection';
  }
  // The context menu of a row, tile or tree row: what can be done with a document, a folder or a collection.
  function closeItemMenu(refocus = true) {
    if (itemMenu.hidden) return; itemMenu.hidden = true; const anchor = menuAnchor; menuAnchor = undefined;
    anchor?.closest('.library-document, .tree-row')?.classList.remove('is-menu-open'); if (anchor?.matches('button')) anchor.setAttribute('aria-expanded', 'false');
    if (refocus && anchor?.isConnected) anchor.focus();
  }
  function showItemMenu(entries: [string, () => void][], anchor: HTMLElement, at?: { x: number; y: number }) {
    if (busy || modal?.open) return; if (!at && !itemMenu.hidden && menuAnchor === anchor) { closeItemMenu(); return; }
    closeItemMenu(false); closeChromeMenu(false); itemMenu.replaceChildren();
    for (const [label, run] of entries) { const item = button(label); item.setAttribute('role', 'menuitem'); item.onclick = () => { closeItemMenu(false); run(); }; itemMenu.append(item); }
    menuAnchor = anchor; if (anchor.matches('button')) anchor.setAttribute('aria-expanded', 'true'); anchor.closest('.library-document, .tree-row')?.classList.add('is-menu-open'); itemMenu.hidden = false;
    if (at) placeMenuAt(itemMenu, at.x, at.y); else placeMenu(itemMenu, anchor);
    itemMenu.querySelector<HTMLElement>('button')?.focus();
  }
  const toggleFavorite = (doc: LibraryDocument) => void mutate(() => editLibrary({ action: 'updateDocument', path: doc.path, collectionIds: doc.collectionIds, favorite: !doc.favorite, tags: doc.tags, notes: doc.notes }));
  function openItemMenu(doc: LibraryDocument, anchor: HTMLElement, at?: { x: number; y: number }) {
    const entries: [string, () => void][] = [['Open in new tab', () => callbacks.openBackground(doc)], [doc.favorite ? 'Remove from favorites' : 'Add to favorites', () => toggleFavorite(doc)], ['Details', () => referenceDetails(doc, anchor)], ['Organize…', () => organize(doc, anchor)], ['Remove from library…', () => removeReference(doc, anchor)]];
    if (hasCover(doc) && !thumbs.peek(doc.path)) { entries.push(['New cover pattern', () => void rerollCovers([doc.path])]); if (doc.coverSeed !== undefined) entries.push(['Reset cover', () => void rerollCovers([doc.path], true)]); }
    if (desktop) entries.push(['Locate original…', () => locateOriginal(doc)]);
    showItemMenu(entries, anchor, at);
  }
  function openNodeMenu(node: TreeNode, anchor: HTMLElement, at?: { x: number; y: number }) {
    const entries: [string, () => void][] = [];
    const collection = node.scope?.kind === 'collection' ? library.collections.find(item => item.id === (node.scope as { id: string }).id) : undefined;
    if (collection && !collection.sourceId) entries.push(['Edit collection…', () => collectionForm(anchor, collection)]);
    const target = node.scope;
    if (target && wide.matches) entries.push(['Browse in the board', () => openScope(target.kind === 'folder' ? { kind: 'folder', id: target.rootId, path: target.path } : { kind: 'collection', id: target.id })]);
    if (entries.length) showItemMenu(entries, anchor, at);
  }
  function removeReference(doc: LibraryDocument, trigger: HTMLElement) {
    const view = openDialog('Remove from library', trigger); if (!view) return;
    view.content.append(element('p', 'library-dialog-document', docLabel(doc)), element('p', 'library-dialog-help', 'Remove only this library entry? The original file and saved reading position will not be deleted. Re-indexing its folder may add it again.'));
    const confirm = button('Remove entry'); confirm.className = 'danger'; confirm.onclick = () => void mutate(() => editLibrary({ action: 'removeDocument', path: doc.path }), () => view.dialog.close());
    view.actions.append(confirm); view.dialog.showModal();
  }
  /** Puts `menu` (already shown) under `anchor`, its right edge on the anchor's, or above it when it would run past the panel. */
  function placeMenu(menu: HTMLElement, anchor: HTMLElement) {
    const bounds = panel.getBoundingClientRect(), at = anchor.getBoundingClientRect(), border = panel.clientLeft;
    const below = at.bottom - bounds.top - panel.clientTop + panel.scrollTop + 2;
    menu.style.left = `${Math.min(Math.max(4, at.right - bounds.left - border - menu.offsetWidth), panel.clientWidth - menu.offsetWidth - 4)}px`;
    menu.style.top = `${below + menu.offsetHeight > panel.scrollTop + panel.clientHeight ? Math.max(4, at.top - bounds.top - panel.clientTop + panel.scrollTop - menu.offsetHeight - 2) : below}px`;
  }
  /** Puts `menu` (already shown) at the window point (x, y), kept inside the panel. */
  function placeMenuAt(menu: HTMLElement, x: number, y: number) {
    const bounds = panel.getBoundingClientRect();
    menu.style.left = `${Math.max(4, Math.min(x - bounds.left - panel.clientLeft, panel.clientWidth - menu.offsetWidth - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(y - bounds.top - panel.clientTop + panel.scrollTop, panel.scrollTop + panel.clientHeight - menu.offsetHeight - 4))}px`;
  }
  /** Puts the fixed Add files menu beside the icon rail button (on the side away from the rail's edge), or under a header button. */
  function placeBeside(menu: HTMLElement, anchor: HTMLElement) {
    const at = anchor.getBoundingClientRect(), inRail = Boolean(anchor.closest('.icon-rail'));
    const left = inRail ? (side === 'left' ? at.right + 8 : at.left - menu.offsetWidth - 8) : at.right - menu.offsetWidth;
    menu.style.left = `${Math.max(4, Math.min(left, window.innerWidth - menu.offsetWidth - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(inRail ? at.top : at.bottom + 2, window.innerHeight - menu.offsetHeight - 4))}px`;
  }
  // The two chrome menus: + (add files, sources) and Recent ☰ (sort, view, show, size). One is open at a time.
  function closeChromeMenu(refocus = true) {
    if (!chromeMenu) return; const { menu, anchor } = chromeMenu; chromeMenu = undefined;
    menu.hidden = true; anchor.setAttribute('aria-expanded', 'false'); if (refocus && anchor.isConnected) anchor.focus();
  }
  function openChromeMenu(menu: HTMLElement, anchor: HTMLElement) {
    if (busy || modal?.open) return; if (chromeMenu?.menu === menu) { closeChromeMenu(); return; }
    closeChromeMenu(false); closeItemMenu(false);
    chromeMenu = { menu, anchor }; anchor.setAttribute('aria-expanded', 'true'); menu.hidden = false; if (menu === addMenu) placeBeside(menu, anchor); else placeMenu(menu, anchor);
    menu.querySelector<HTMLElement>('[aria-checked=true], button')?.focus();
  }
  plus.onclick = () => openChromeMenu(addMenu, plus); viewButton.onclick = () => openChromeMenu(viewMenu, viewButton);
  for (const menu of [addMenu, viewMenu]) menu.addEventListener('keydown', event => {
    // The Add files menu stands outside the info rail, so its keys are its own: Escape closes it, and no reader shortcut sees them.
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeChromeMenu(); return; }
    if (menu === addMenu && shortcutFor(event) !== 'command-palette') event.stopPropagation();
    if (event.key === 'Tab') { closeChromeMenu(false); return; }
    if (event.target instanceof HTMLInputElement) return; // The size slider keeps its own arrow keys.
    const items = Array.from(menu.querySelectorAll<HTMLElement>('button')); const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); items[(index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus(); }
    else if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); items[event.key === 'Home' ? 0 : items.length - 1]?.focus(); }
  });
  itemMenu.addEventListener('keydown', event => {
    const items = Array.from(itemMenu.querySelectorAll<HTMLElement>('button')); const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); items[(index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus(); }
    else if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); items[event.key === 'Home' ? 0 : items.length - 1]?.focus(); }
    else if (event.key === 'Tab') closeItemMenu(false);
  });
  document.addEventListener('pointerdown', event => {
    const target = event.target as Node;
    if (!itemMenu.hidden && !itemMenu.contains(target) && !menuAnchor?.contains(target)) closeItemMenu(false);
    if (chromeMenu && !chromeMenu.menu.contains(target) && !chromeMenu.anchor.contains(target)) closeChromeMenu(false);
  });

  // Grid view: each tile keeps its picture's proportions and joins the shortest column.
  const thumbnailable = (doc: LibraryDocument) => canThumbnail(doc.format);
  function inScope(doc: LibraryDocument) {
    const selected = filter;
    if (selected.kind === 'favorites') return doc.favorite; if (selected.kind === 'reading') return inProgress(progress[doc.path]); if (selected.kind === 'unfiled') return !doc.collectionIds.length;
    if (selected.kind === 'collection') return Boolean(collectionMatches.get(selected.id)?.has(doc.path));
    if (selected.kind === 'source') return doc.source?.repository === selected.id;
    if (selected.kind === 'folder') return doc.source?.rootId === selected.id && (selected.path === '' || (doc.source.relativePath ?? '').replace(/\\/g, '/').startsWith(`${selected.path}/`));
    return true;
  }
  const viewKey = () => `hold-my-brief:library-view:${filter.kind === 'collection' || filter.kind === 'source' ? `${filter.kind}:${filter.id}` : filter.kind === 'folder' ? `folder:${filter.id}:${filter.path}` : filter.kind}`;
  /** The grid's minimum tile width: the Size saved for this scope, else the surface's own (the board's tiles are larger). */
  const sizeKey = () => viewKey().replace('library-view:', 'library-tile-size:');
  const tileSize = () => parseTileSize(savedPreference(sizeKey())) ?? (board ? libraryGrid.boardMinTile : libraryGrid.minTile);
  // Saved per collection; with no choice yet, grid when at least half of the collection can show a thumbnail, but a drawer
  // narrower than 400 px opens on list. The default looks at the whole collection, not the search, so typing never flips the view.
  function currentView(): LibraryView {
    if (!board) return 'list'; // the info rail's favorites are always rows
    const saved = parseLibraryView(savedPreference(viewKey())); if (saved) return saved;
    const scoped = library.documents.filter(inScope); return defaultLibraryView(scoped.filter(thumbnailable).length, scoped.length, board ? Infinity : wide.matches ? width : 0);
  }
  // Tiles sit in the DOM in sorted order (so Tab and screen readers follow the sort, shelf by shelf) and are
  // positioned absolutely into masonry columns: each joins the shortest column of its shelf, and a tile's height
  // follows its ratio. A shelf header is placed the same way, above its tiles.
  type Tile = { node: HTMLElement; path: string; ratio: number; column: number; caption: number };
  type Section = { shelf?: string; head?: HTMLElement; tiles: Tile[] };
  let tiles: Tile[] = []; let sections: Section[] = []; let columnCount = 0; const tileByPath = new Map<string, Tile>();
  // The shelf each tile's cover was made for (which tints and styles it), so the detail strip shows the very same cover.
  const coverShelf = new Map<string, string | undefined>();
  const gridSizer = element('div', 'library-grid-sizer'); gridSizer.setAttribute('aria-hidden', 'true');
  function contentWidth() { const style = getComputedStyle(documents); return documents.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight); }
  /** Places every header and tile. The column of each tile is only reassigned when asked or when the column count changes, so a picture arriving moves what is below it, never reshuffles. */
  function layoutGrid(assign = false) {
    if (view !== 'grid' || !tiles.length) return;
    const width = contentWidth(); if (width <= 0) return;
    const columns = libraryGridColumns(width, tileSize()); const gap = libraryGrid.gap;
    const tileWidth = (width - gap * (columns - 1)) / columns; const reassign = assign || columns !== columnCount; columnCount = columns;
    const style = getComputedStyle(documents); const left = parseFloat(style.paddingLeft), top = parseFloat(style.paddingTop);
    let y = 0;
    sections.forEach((section, index) => {
      if (section.head) {
        if (index) y += shelfLayout.gap;
        section.head.style.left = `${left}px`; section.head.style.top = `${top + y}px`; section.head.style.width = `${width}px`; y += shelfLayout.head + shelfLayout.below;
      }
      y += placeTiles(section.tiles, { columns, tileWidth, gap, left, top: top + y, reassign });
    });
    gridSizer.style.height = `${Math.max(0, y)}px`;
    // Tiles built while the drawer was hidden or had no width are only placed now; observing is idempotent.
    observeThumbnails();
  }
  // The drawer's own width is the only input; a new width re-places the tiles (and re-assigns columns if their count changed).
  new ResizeObserver(() => { if (visible) layoutGrid(); }).observe(documents);

  // An EPUB's title is what its tile and detail show, once read (the file name until then). The library entry's own name is kept as the file name.
  const epubTitle = (doc: LibraryDocument) => doc.format === 'epub' ? thumbs.epub(doc.path)?.title : undefined;
  const docLabel = (doc: LibraryDocument) => displayTitle(doc, epubTitle(doc));
  function reflectEpub(path: string) {
    const doc = library.documents.find(item => item.path === path); if (!doc) return;
    const label = docLabel(doc);
    for (const node of documents.querySelectorAll<HTMLElement>('[data-doc-path]')) {
      if (node.dataset.docPath !== path) continue;
      node.dataset.docName = label; const open = node.querySelector<HTMLElement>('.library-document-open'); if (open) labelOpen(open, { name: label, path });
      for (const text of node.querySelectorAll<HTMLElement>('.library-document-name, .library-tile-name, .library-tile-caption')) text.textContent = label;
      for (const text of node.querySelectorAll<HTMLElement>('.library-cover-title')) text.textContent = displayTitle(doc, epubTitle(doc), true);
      const meta = node.querySelector<HTMLElement>('.library-row-meta'); if (meta) meta.textContent = rowMeta(doc);
    }
    if (board && selectedPath === path) renderDetail();
  }
  /** Format, how far the reader got, then only what is worth saying: a missing or removed original, the open reference, and the file name when the title is the book's own. A reference that is simply there says nothing about it. */
  const rowMeta = (doc: LibraryDocument, full = true) => [doc.format.toUpperCase(), formatProgress(progress[doc.path]), doc.source?.removed ? 'no longer in folder' : (doc.availability ?? 'ready') === 'ready' ? undefined : doc.availability, full && doc.path === activePath ? 'Reading' : undefined, full && docLabel(doc) !== doc.name ? doc.name : undefined].filter(Boolean).join(' · ');
  /** A generated cover for a document with no picture: dithered art of its shelf in the top half, the title and the format (with the version in the file name) below. */
  const coverNode = (doc: LibraryDocument, shelfId: string | undefined) => cardCover({ name: doc.name, format: doc.format, title: displayTitle(doc, epubTitle(doc), true), seed: coverSeedOf(doc), shelfId }, scheme());
  const hasCover = (doc: LibraryDocument) => (doc.availability ?? 'ready') !== 'missing' && (!thumbnailable(doc) || doc.format === 'epub');
  onAppearanceChange(() => repaintCovers(root, scheme()));
  // A new random pattern for each document, in one library change (one render), or none at all (`reset`: the pattern its path gives).
  const rerollCovers = (paths: string[], reset = false) => mutate(async () => {
    let next = library;
    for (const path of paths) next = await editLibrary({ action: 'setCoverSeed', path, coverSeed: reset ? null : crypto.getRandomValues(new Uint32Array(1))[0] });
    return next;
  });
  /** The ↻ over a cover: hidden until the cover is pointed at or focused, and for good once a real picture shows instead. */
  function rerollButton(doc: LibraryDocument, key: string) {
    const reroll = button('↻', `New cover pattern for ${docLabel(doc)}`, key); reroll.className = 'library-reroll'; reroll.onclick = () => void rerollCovers([doc.path]);
    return reroll;
  }
  function actionsFor(doc: LibraryDocument, generated = false) {
    const actions = element('div', 'library-card-actions');
    const favorite = button(doc.favorite ? '★' : '☆', `${doc.favorite ? 'Unfavorite' : 'Favorite'} ${doc.name}`, `favorite:${doc.path}`); favorite.className = 'library-favorite'; favorite.setAttribute('aria-pressed', String(doc.favorite));
    favorite.onclick = () => toggleFavorite(doc);
    const more = button('···', `More actions for ${doc.name}`, `more:${doc.path}`); more.className = 'library-organize'; more.setAttribute('aria-haspopup', 'menu'); more.setAttribute('aria-expanded', 'false'); more.onclick = () => openItemMenu(doc, more);
    if (generated) actions.append(rerollButton(doc, `reroll:${doc.path}`));
    actions.append(favorite, more); return actions;
  }
  /** A row: a 32 x 43 cover or picture, the title and the meta line. */
  function documentRow(doc: LibraryDocument) {
    const row = element('div', 'library-document'); row.setAttribute('role', 'listitem'); row.classList.toggle('is-active', doc.path === activePath);
    const generated = hasCover(doc); const missing = (doc.availability ?? 'ready') === 'missing';
    const open = button('', `Open ${docLabel(doc)}`, `open:${doc.path}`); open.className = 'library-document-open'; open.title = doc.path; if (doc.path === activePath) open.setAttribute('aria-current', 'true');
    const media = tileMedia({ path: doc.path, name: doc.name, format: doc.format, title: displayTitle(doc, epubTitle(doc), true), label: docLabel(doc), seed: coverSeedOf(doc), shelfId: doc.collectionIds[0], ratio: 32 / 43, missing, generated, thumbnailable: thumbnailable(doc) }, scheme());
    if (!missing && thumbnailable(doc)) { const cached = thumbs.peek(doc.path); if (cached) showThumbnail(media, cached); else if (thumbs.failed(doc.path)) markUnavailable(media); }
    const text = element('span', 'library-row-text'); text.append(element('span', 'library-document-name', docLabel(doc)), element('span', 'library-document-meta library-row-meta', rowMeta(doc)));
    open.append(media, text);
    bindOpen(doc, open, row);
    row.append(open, actionsFor(doc)); return row;
  }
  /** `shelfId` is the shelf the tile sits on, which tints its generated cover; outside shelves it is the document's first collection. */
  function documentTile(doc: LibraryDocument, shelfId: string | undefined): Tile {
    const generated = hasCover(doc); const ratio = thumbs.ratio(doc.path) ?? (generated ? coverRatio : libraryGrid.defaultRatio); const missing = (doc.availability ?? 'ready') === 'missing';
    const node = element('div', 'library-document library-tile'); node.setAttribute('role', 'listitem');
    node.classList.toggle('is-active', doc.path === activePath); node.classList.toggle('is-missing', missing); node.classList.toggle('is-cover', generated);
    const open = button('', `Open ${docLabel(doc)}`, `open:${doc.path}`); open.className = 'library-document-open library-tile-open'; open.title = doc.path; if (doc.path === activePath) open.setAttribute('aria-current', 'true');
    const media = tileMedia({ path: doc.path, name: doc.name, format: doc.format, title: displayTitle(doc, epubTitle(doc), true), label: docLabel(doc), seed: coverSeedOf(doc), shelfId, ratio, missing, generated, thumbnailable: thumbnailable(doc) }, scheme());
    if (generated && !missing) coverShelf.set(doc.path, shelfId);
    if (!missing && thumbnailable(doc)) { const cached = thumbs.peek(doc.path); if (cached) showThumbnail(media, cached); else if (thumbs.failed(doc.path)) markUnavailable(media); }
    if (doc.path === activePath) media.append(element('span', 'library-tile-tag', 'Reading'));
    // A title goes under every tile that shows (or can come to show) a picture: a PDF page, an image, an EPUB's cover image, a missing original.
    // A generated cover prints its own title, so a tile that only ever has one (Markdown, text) has no caption. The height is fixed so the masonry
    // can place the tile before its picture arrives; an EPUB's caption stays hidden (but reserved) until its picture replaces the cover.
    const captioned = thumbnailable(doc) || missing; const caption = captioned ? element('span', 'library-tile-caption', docLabel(doc)) : undefined;
    if (caption) caption.style.height = `${libraryGrid.captionHeight}px`;
    open.append(...(caption ? [media, caption] : [media]));
    bindOpen(doc, open, node);
    node.append(open, actionsFor(doc, generated)); return { node, path: doc.path, ratio, column: 0, caption: caption ? libraryGrid.captionHeight : 0 };
  }
  function shelfHead(shelf: Shelf<LibraryDocument>) {
    const head = element('div', 'library-shelf-head'); head.setAttribute('role', 'listitem'); head.dataset.shelf = shelf.id;
    head.append(element('span', 'library-shelf-name', shelf.name), element('span', 'library-shelf-count', String(shelf.items.length))); return head;
  }
  const chipLabels: Record<string, string> = { pdf: 'PDF', epub: 'EPUB', md: 'Markdown', txt: 'Text', image: 'Images' };
  /** One chip per file type the library holds, same semantics as the format filter (`matchesFileType`): one active at a time, a second click clears it. */
  function renderChips() {
    const present = fileTypeChoices.filter(([value]) => value && library.documents.some(doc => matchesFileType(doc, value)));
    if (fileType && !present.some(([value]) => value === fileType)) fileType = '';
    typeChips.replaceChildren(...present.map(([value]) => {
      const chip = button(chipLabels[value] ?? value, undefined, `type:${value}`); chip.className = 'library-type-chip'; chip.dataset.type = value;
      chip.onclick = () => { fileType = fileType === value ? '' : value; page = 0; renderDocuments(); };
      return chip;
    }));
    typeChips.hidden = !present.length; fadeChips();
  }
  /** A soft fade at the chips row's right edge while more is scrolled out of sight, so a chip is never sliced without a hint. */
  function fadeChips() { scope.classList.toggle('has-more', scope.scrollLeft + scope.clientWidth < scope.scrollWidth - 1); }
  scope.addEventListener('scroll', fadeChips); new ResizeObserver(fadeChips).observe(scope);
  /** Brings the chips, the Recent menu and the search field in line with the state they show; nothing is rebuilt, so focus stays where it is. */
  function syncChrome() {
    for (const chip of typeChips.querySelectorAll<HTMLElement>('.library-type-chip')) chip.setAttribute('aria-pressed', String(chip.dataset.type === fileType));
    for (const { group, value, node } of choices) node.setAttribute('aria-checked', String(value === (group === 'Sort by' ? sortMode : group === 'View as' ? view : availabilityFilter)));
    sizeRow.hidden = view !== 'grid'; sizeInput.value = String(tileSize());
    viewLabel.textContent = sortMode === 'name' ? 'Name A–Z' : 'Recent'; viewButton.setAttribute('aria-label', `Sort, view and filter options. Sorted by ${viewLabel.textContent}`);
  }
  sizeInput.oninput = () => { savePreference(sizeKey(), sizeInput.value); layoutGrid(true); };
  function renderDocuments() {
    clearThumbnails(); documents.replaceChildren(); pager.replaceChildren(); tiles = []; sections = []; tileByPath.clear(); coverShelf.clear(); columnCount = 0; closeItemMenu(false); const generation = ++renderGeneration;
    const unknown: LibraryDocument[] = [];
    const query = search.value.trim().toLocaleLowerCase();
    matches = library.documents.filter(doc => {
      if (!inScope(doc)) return false;
      if (!matchesFileType(doc, fileType)) return false;
      if (availabilityFilter && (doc.availability ?? 'ready') !== availabilityFilter) return false;
      const categories = doc.collectionIds.map(id => { const item = library.collections.find(collection => collection.id === id); return item ? `${item.name} ${collectionDisplayName(item.name)}` : ''; }).join(' ').toLocaleLowerCase();
      const info = thumbs.epub(doc.path); const known = `${info?.title ?? ''} ${info?.creator ?? ''}`.toLocaleLowerCase();
      if (!(!query || query.split(/\s+/).every(word => `${searchable.get(doc.path) ?? ''} ${known} ${categories}`.includes(word)))) return false;
      if (!colourFilter) return true;
      const colours = thumbs.colours(doc.path);
      if (!colours) { if (thumbnailable(doc) && (doc.availability ?? 'ready') !== 'missing' && !thumbs.failed(doc.path) && !thumbs.none(doc.path)) unknown.push(doc); return false; }
      return colourMatches(colours, colourFilter);
    });
    matches.sort(sortMode === 'name' ? (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }) || a.path.localeCompare(b.path) : (a, b) => timestamp(b.lastOpened) - timestamp(a.lastOpened) || a.name.localeCompare(b.name));
    view = currentView();
    // A collection with sub-collections shows as shelves in the grid: its own documents first, then one shelf per child.
    const shelves = view === 'grid' && filter.kind === 'collection' ? groupIntoShelves(filter.id, library.collections, matches) : undefined;
    const ordered = shelves ? shelves.flatMap(shelf => shelf.items) : matches;
    page = Math.min(page, Math.max(0, Math.ceil(matches.length / pageSize) - 1));
    if (board && !matches.some(doc => doc.path === selectedPath)) selectedPath = matches.find(doc => doc.path === activePath)?.path ?? ordered[0]?.path;
    colourUnknown = unknown.length; colourChip.hidden = !colourFilter;
    if (colourFilter) {
      colourChip.replaceChildren(); const dot = element('span', 'library-colour-dot'); dot.style.background = colourSwatches[colourFilter];
      colourChip.append(dot, element('span', '', titleCase(colourFilter)), element('span', 'library-colour-clear', '×')); colourChip.setAttribute('aria-label', `Remove colour filter: ${colourFilter}`); colourChip.title = 'Remove colour filter';
      analyseColours(unknown, generation);
    }
    resultCount.textContent = `${matches.length} ${matches.length === 1 ? 'reference' : 'references'}${colourFilter && unknown.length ? ` · analysing ${unknown.length}` : ''}`;
    documents.classList.toggle('library-grid', view === 'grid'); documents.classList.toggle('library-list', view === 'list');
    scopeLabel.textContent = scopeName(); syncChrome();
    if (!matches.length) {
      const empty = element('div', 'library-empty'); empty.setAttribute('role', 'listitem');
      empty.append(element('strong', '', loadError ? 'Library unavailable' : !loaded ? 'Loading library…' : !library.documents.length ? 'Your references, collected.' : 'No matching references'), element('p', '', loadError ? 'Could not load the library. Close and reopen it to retry.' : !loaded ? 'Getting your saved library.' : !library.documents.length ? 'Add local documents and images, or index a folder. Originals stay untouched.' : 'Try another search, format, availability, or collection.'));
      documents.append(empty);
    }
    const shown = ordered.slice(page * pageSize, (page + 1) * pageSize);
    if (view === 'grid') {
      const nodes: HTMLElement[] = [];
      for (const doc of shown) {
        const shelf = shelves?.find(candidate => candidate.items.includes(doc)); const last = sections[sections.length - 1];
        // What sits directly in the open collection comes first and needs no header: the scope row already names it.
        if (!last || shelf && last.shelf !== shelf.id) { const head = shelf && shelf.id !== (filter.kind === 'collection' ? filter.id : undefined) ? shelfHead(shelf) : undefined; sections.push({ shelf: shelf?.id, head, tiles: [] }); if (head) nodes.push(head); }
        const tile = documentTile(doc, shelf?.id ?? doc.collectionIds[0]); sections[sections.length - 1].tiles.push(tile); tiles.push(tile); tileByPath.set(tile.path, tile); nodes.push(tile.node);
      }
      documents.append(gridSizer, ...nodes); layoutGrid(true);
      // The disk cache knows the shape of every thumbnail it holds: reserve those tiles' real height now
      // rather than letting the grid jump as pictures arrive.
      void thumbs.primeRatios(shown.map(doc => doc.path)).then(learned => {
        if (!learned || generation !== renderGeneration) return;
        for (const tile of tiles) { const ratio = thumbs.ratio(tile.path); if (ratio && Math.abs(ratio - tile.ratio) > .001) { tile.ratio = ratio; tile.node.querySelector<HTMLElement>('.library-tile-media')?.style.setProperty('--ratio', String(ratio)); } }
        layoutGrid(true);
      });
    }
    else documents.append(...shown.map(documentRow));
    for (const doc of showingList() ? shown : []) if (doc.format === 'epub' && (doc.availability ?? 'ready') !== 'missing' && !thumbs.epub(doc.path)) void thumbs.loadEpub(doc.path, () => visible && generation === renderGeneration).then(info => { if (info) reflectEpub(doc.path); });
    thumbs.trim(new Set(shown.map(doc => doc.path)));
    if (matches.length > pageSize) {
      const previous = button('←', 'Previous library page', 'page-previous'); previous.disabled = page === 0; const next = button('→', 'Next library page', 'page-next'); next.disabled = (page + 1) * pageSize >= matches.length;
      const change = (offset: number) => { page += offset; renderDocuments(); documents.scrollTop = 0; documents.querySelector<HTMLElement>('.library-document-open')?.focus(); };
      previous.onclick = () => change(-1); next.onclick = () => change(1); pager.append(previous, element('span', '', `${page * pageSize + 1}–${Math.min(matches.length, (page + 1) * pageSize)} / ${matches.length}`), next);
    }
    observeThumbnails(); renderImageNavigation(); renderDetail(); if (busy) setBusy(true);
  }
  // The info rail's tree. Opening a document from it opens or focuses its tab; ⌘/Ctrl-click gives it a background tab; right-click is the item menu.
  const treeView = createTreeView(treeRoot, {
    open: (doc, background, siblings) => {
      if (background) { callbacks.openBackground(doc); return; }
      void openDocument(doc, treeRoot.querySelector<HTMLElement>(`[data-doc-path="${CSS.escape(doc.path)}"]`) ?? undefined, siblings.map(item => item.path));
    },
    menu: (node, anchor, at) => { if (node.doc) openItemMenu(node.doc, anchor, at); else openNodeMenu(node, anchor, at); },
    scope: node => { if (node.scope) openScope(node.scope.kind === 'folder' ? { kind: 'folder', id: node.scope.rootId, path: node.scope.path } : { kind: 'collection', id: node.scope.id }); },
  });
  const showingList = () => board || railView === 'favorites';
  /** Every node id of the tree, for forgetting the saved open state of what no longer exists. */
  function treeIds(from: LibraryTree) { const ids = new Set<string>(); const walk = (node: TreeNode) => { ids.add(node.id); node.children.forEach(walk); }; from.sections.forEach(walk); return ids; }
  /** What else a document is known by, for the filter: its title, an EPUB's author, tags and notes. */
  const treeExtra = (doc: LibraryDocument) => { const info = doc.format === 'epub' ? thumbs.epub(doc.path) : undefined; return `${docLabel(doc)} ${info?.creator ?? ''} ${doc.tags.join(' ')} ${doc.notes}`; };
  function paintTree() {
    if (board || railView === 'favorites') { syncRail(); updateCount(); return; }
    const top = railView === 'collections' ? sectionOf(tree, 'collections')?.children ?? [] : tree.sections;
    const filtered = filterTree(top, treeQuery, treeExtra);
    treeView.paint({ sections: filtered.sections, query: treeQuery, extra: treeExtra, forced: filtered.open, activePath, progress: doc => formatProgress(progress[doc.path]) });
    const empty = !filtered.sections.length;
    treeEmpty.hidden = !empty; treeRoot.hidden = empty;
    if (empty) {
      const searching = treeQuery.trim() !== '';
      treeEmpty.replaceChildren(element('strong', '', loadError ? 'Library unavailable' : !loaded ? 'Loading library…' : searching ? 'No matching references' : railView === 'collections' ? 'No collections yet' : 'Your references, collected.'),
        element('p', '', loadError ? 'Could not load the library. Close and reopen it to retry.' : !loaded ? 'Getting your saved library.' : searching ? 'Try another word, or clear the filter.' : railView === 'collections' ? 'Create a collection with + New, then organize references into it.' : 'Add local documents and images, or index a folder. Originals stay untouched.'));
    }
    updateCount(filtered.documents);
    // The document showing has its folders opened (once per document, so closing one by hand is respected).
    if (activePath && revealed !== activePath && railView !== 'collections' && !treeQuery.trim()) {
      const ancestors = tree.ancestors.get(activePath);
      if (ancestors) { revealed = activePath; treeView.reveal(ancestors, `d:${activePath}`); }
    }
  }
  function updateCount(documentsShown?: number) {
    const count = railView === 'favorites' ? library.documents.filter(doc => doc.favorite).length : documentsShown ?? tree.total;
    headingCount.textContent = board ? '' : loaded ? String(count) : '';
  }
  function setTreeQuery(value: string) { treeQuery = value; treeFilter.value = value; syncRail(); paintTree(); }
  treeFilter.addEventListener('input', () => setTreeQuery(treeFilter.value));
  treeFilter.addEventListener('keydown', event => { if (event.key === 'ArrowDown' || event.key === 'Enter') { event.preventDefault(); treeView.focus(); } });
  filterToggle.onclick = () => {
    if (!treeFilterRow.hidden) { setTreeQuery(''); filterOpen = false; syncRail(); treeView.focus(); return; }
    filterOpen = true; syncRail(); treeFilter.focus();
  };
  newCollection.onclick = () => collectionForm(newCollection);
  /** Opens the info rail on `next` (the icon rail's four library icons). The scope of the list behind it follows: favorites, or every reference. */
  function setView(next: RailView, focus = true) {
    railView = next; if (next === 'search') filterOpen = true;
    if (!board) { filter = next === 'favorites' ? { kind: 'favorites' } : { kind: 'all' }; page = 0; }
    syncRail(); render(); callbacks.viewChanged?.(visible ? railView : null);
    if (focus) focusRail();
  }
  function showView(next: RailView) {
    if (modal?.open || busy) return;
    if (visible && railView === next) { setVisible(false); return; } // the active icon collapses the rail; the icon rail stays
    if (board) setBoard(false, 'none');
    if (!visible) setVisible(true, false);
    setView(next);
    if (loadError) void refresh();
  }
  /** The board scoped to a folder, collection or Home's scope (the compact sheet has no board: it shows the nearest tree view). */
  function openScope(next: Filter) {
    filter = next; page = 0; search.value = ''; fileType = ''; availabilityFilter = ''; colourFilter = null; colourRequested.clear(); colourSelect.value = '';
    if (!visible) setVisible(true, false);
    if (wide.matches) { setBoard(true, 'control'); render(); }
    else setView(next.kind === 'favorites' ? 'favorites' : next.kind === 'collection' ? 'collections' : 'library');
    if (visible && loadError) void refresh();
  }
  function setActive(path: string | undefined) {
    if (path === activePath) return;
    activePath = path; revealed = undefined; renderImageNavigation(); if (visible) renderDocuments(); paintTree();
  }
  function render() {
    const key = focusKey(); if (filter.kind === 'collection' && !library.collections.some(collection => filter.kind === 'collection' && collection.id === filter.id)) filter = { kind: 'unfiled' };
    renderNavigation(); renderChips(); renderDocuments(); paintTree(); const collection = filter.kind === 'collection' ? library.collections.find(item => filter.kind === 'collection' && item.id === filter.id) : undefined;
    add.title = collection && !collection.sourceId ? `Add files to ${collectionDisplayName(collection.name)}` : 'Add files to Unfiled';
    if (busy) setBusy(true); if (key && !busy && !modal?.open) restoreFocus(key);
  }
  function setColour(next: ColourName | null) { colourFilter = next; colourRequested.clear(); colourSelect.value = next ?? ''; page = 0; renderDocuments(); }
  colourChip.onclick = () => { setColour(null); search.focus(); };
  colourSelect.onchange = () => setColour(parseColourName(colourSelect.value) ?? null);
  // A picture's colours are known once its thumbnail has been made, or the disk cache already has them. While a
  // colour filter is on, the ones still unknown are made in the background and the list refreshes as they arrive.
  /**
   * Re-renders the list as colours arrive without pulling anything out from under the user: the scroll position
   * and the focused tile or control are kept, and an open menu or dialog makes it wait for the next tick.
   */
  function scheduleColourRender() {
    if (colourTimer) return;
    colourTimer = window.setTimeout(() => {
      colourTimer = 0; if (!colourFilter || !visible) return;
      if (!itemMenu.hidden || modal?.open || busy) { scheduleColourRender(); return; }
      const key = focusKey(), scrolled = documents.scrollTop, hadFocus = root.contains(document.activeElement);
      renderDocuments(); documents.scrollTop = scrolled;
      if (hadFocus && key) restoreFocus(key);
    }, 250);
  }
  function analyseColours(unknown: LibraryDocument[], generation: number) {
    colourIndex ??= thumbs.primeRatios(library.documents.filter(thumbnailable).map(doc => doc.path)).then(learned => { if (learned) scheduleColourRender(); return learned; });
    void colourIndex.then(() => {
      if (generation !== renderGeneration) return;
      // Each picture is asked for once per colour session, however often the list is refreshed meanwhile.
      for (const doc of unknown) {
        if (thumbs.colours(doc.path) || colourRequested.has(doc.path)) continue; colourRequested.add(doc.path);
        void thumbs.request(doc.path, doc.format, () => colourFilter !== null && visible).then(made => { if (!made) colourRequested.delete(doc.path); scheduleColourRender(); });
      }
    });
  }
  async function filterBy(change: { colour?: string | null; query?: string }): Promise<LibraryFilterResult> {
    const colour = change.colour === undefined || change.colour === null ? change.colour : parseColourName(change.colour);
    if (typeof change.colour === 'string' && !colour) throw Error(`Unknown colour "${change.colour}". Choose one of: ${colourNames.join(', ')}.`);
    if (change.query !== undefined) search.value = change.query;
    if (colour !== undefined) { colourFilter = colour; colourRequested.clear(); colourSelect.value = colour ?? ''; }
    page = 0; renderDocuments();
    // The tree narrows by words; a colour is the board's filter, so it opens there where there is room.
    if (!visible) setVisible(true, false);
    if (colourFilter && wide.matches) setBoard(true, 'none');
    else if (change.query !== undefined && !board) { setView('search', false); setTreeQuery(change.query); }
    // Pictures whose colours are not known yet are analysed first, for at most 25 s, so the answer is complete.
    for (const deadline = Date.now() + 25_000; colourFilter && colourUnknown > 0 && Date.now() < deadline;) await new Promise(resolve => setTimeout(resolve, 200));
    if (colourTimer) { clearTimeout(colourTimer); colourTimer = 0; }
    if (colourFilter) renderDocuments();
    return { colour: colourFilter, query: search.value.trim(), matches: matches.length, names: matches.slice(0, 10).map(doc => doc.name), pending: colourFilter ? colourUnknown : 0 };
  }
  search.oninput = () => { page = 0; renderDocuments(); };
  let chosenCollection: string | null = null;
  // Who asked for files, so focus returns there once the dialogs are done: the icon rail's Add files, or this panel's + (compact windows, the board).
  let addTrigger: HTMLElement = plus;
  add.onclick = () => { addTrigger = chromeMenu?.anchor ?? plus; closeChromeMenu(false); if (busy) return; const collection = filter.kind === 'collection' ? library.collections.find(item => filter.kind === 'collection' && item.id === filter.id) : undefined; chosenCollection = collection && !collection.sourceId ? collection.id : null; if (desktop) void addAndReview(() => addDocuments(chosenCollection), 'Added files', false, addTrigger); else fileInput.click(); };
  fileInput.onchange = () => { const files = Array.from(fileInput.files ?? []); fileInput.value = ''; if (files.length) void addAndReview(() => addDocuments(chosenCollection, files), 'Added files', false, addTrigger); };
  // Intake: once files arrive (Add files, Index a folder) a quiet sheet shows what came in, grouped by shelf, each with its cover.
  const intakeHost: IntakeHost = {
    documents: () => library.documents, collections: () => library.collections, label: docLabel,
    generated: doc => hasCover(doc) && !thumbs.peek(doc.path),
    cover: coverNode,
    picture: doc => thumbnailable(doc) ? { peek: () => thumbs.peek(doc.path), request: wants => thumbs.request(doc.path, doc.format, wants) } : undefined,
    reroll: paths => rerollCovers(paths),
    move: (paths, from, to) => mutate(async () => {
      let next = library;
      for (const path of paths) {
        const doc = next.documents.find(item => item.path === path); if (!doc) continue;
        next = await editLibrary({ action: 'updateDocument', path, collectionIds: movedCollectionIds(doc.collectionIds, next.collections, from, to), favorite: doc.favorite, tags: doc.tags, notes: doc.notes });
      }
      return next;
    }),
  };
  /** A folder always gets a review. Files do unless they all show a real picture: a lone PDF, image or EPUB with a cover is just there. Several files are reviewed when any of them would get a generated cover. */
  async function worthReview(arrived: LibraryDocument[], folder: boolean) {
    if (folder) return true;
    if (arrived.length > 1) return arrived.some(hasCover);
    const [only] = arrived; if (!hasCover(only)) return false;
    return only.format !== 'epub' || !(await thumbs.request(only.path, 'epub', () => true));
  }
  async function addAndReview(operation: () => Promise<Library>, fallback: string, folder: boolean, trigger: HTMLElement, after?: () => void) {
    if (busy) return; const before = new Set(library.documents.map(doc => doc.path));
    await mutate(operation, after);
    const arrived = newArrivals(before, library.documents); if (!arrived.length) return;
    await new Promise(resolve => setTimeout(resolve)); // a dialog that was just closed finishes closing first
    if (!await worthReview(arrived, folder)) return;
    const view = openDialog(intakeTitle(arrived.length), trigger); if (!view) return;
    view.dialog.classList.add('library-intake');
    const sheet = createIntake(intakeHost, arrived.map(doc => doc.path), intakeSource(arrived, fallback), view);
    view.dialog.showModal(); sheet.focus();
    // An EPUB's own title replaces the file's name on its cover as soon as it is read.
    for (const doc of arrived) if (doc.format === 'epub' && !thumbs.epub(doc.path)) void thumbs.loadEpub(doc.path, () => view.dialog.open).then(info => { if (info && view.dialog.isConnected) sheet.retitle(doc.path); });
  }
  sourcesButton.onclick = () => { const trigger = chromeMenu?.anchor ?? plus; closeChromeMenu(false); sourceManager(trigger); };
  /** Progress is optional decoration: a failed read leaves what was shown. */
  const loadProgress = (documentsNow: readonly LibraryDocument[]) => readingProgress(documentsNow.map(doc => doc.path)).catch(() => progress);
  /** Re-reads reading progress (one call for the whole library) and updates the rows already on screen in place. */
  async function refreshProgress() {
    const token = revision;
    await callbacks.settle?.().catch(() => undefined);
    const next = await loadProgress(library.documents); if (token !== revision || !loaded) return;
    if (JSON.stringify(next) === JSON.stringify(progress)) return;
    progress = next;
    paintTree();
    if (filter.kind === 'reading') render(); // Its members are the progress.
    for (const node of documents.querySelectorAll<HTMLElement>('[data-doc-path]')) {
      const doc = library.documents.find(item => item.path === node.dataset.docPath); const meta = node.querySelector<HTMLElement>('.library-row-meta');
      if (doc && meta) meta.textContent = rowMeta(doc);
    }
    if (board && selectedPath) renderDetail();
    callbacks.progressChanged?.(progress);
  }
  async function refresh(path?: string) {
    if (path !== undefined) activePath = path; const token = ++revision;
    try { const next = await getLibrary(); const reached = await loadProgress(next.documents); if (token !== revision) return; library = next; progress = reached; loaded = true; loadError = false; rebuildIndex(); render(); callbacks.changed?.(library, progress); }
    catch (error) { if (token !== revision) return; loadError = true; render(); callbacks.error(error); }
  }
  toggleButton?.setAttribute('aria-controls', root.id); applySide(false); applyWidth(preferredWidth); rebuildIndex(); applyVisibility(); render();
  return {
    refresh,
    side: () => side,
    setSide,
    toggle: () => { toggle(); if (visible && loadError) void refresh(); },
    view: () => railView,
    showView,
    openAddMenu: (anchor: HTMLElement) => openChromeMenu(addMenu, anchor),
    setActive,
    // Library board (palette command): open the info rail if needed, then enter or leave the board. Below 720 px there is only the sheet: it opens on the tree's filter.
    board: () => { if (!visible) setVisible(true, false); if (wide.matches) setBoard(!board, 'control'); else setView('search'); if (visible && loadError) void refresh(); },
    /** Home's "Show all" and collection cards: the info rail opened on a scope of the library, as the board where there is room. */
    browse: (scope: LibraryScope) => openScope(typeof scope === 'string' ? { kind: scope } : { kind: 'collection', id: scope.collection }),
    filter: filterBy,
    colourNames,
  };
}
