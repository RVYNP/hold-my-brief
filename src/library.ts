import './library.css';
import { addDocuments, desktop, editLibrary, getLibrary, chooseSourceRoot, locateLibraryDocument, indexFolder } from './bridge';
import { emptyLibrary, type Collection, type Library, type LibraryDocument } from './catalog-types';
import { isImage, searchText } from './library-query';
import { assignMasonry, clampLibraryWidth, defaultLibraryView, libraryGrid, libraryGridColumns, libraryWidth, libraryWidthBounds, parseLibraryView, parseLibraryWidth, type LibrarySide, type LibraryView } from './library-layout';
import { canThumbnail, createThumbnailStore, type Thumbnail } from './thumbnails';
import { colourHex, colourMatches, colourNames, colourSwatches, nameColour, parseColourName, type ColourName } from './colour';
import { shortcutFor } from './commands';
import { coverArt } from './covers';
import { createIntake, intakeSource, intakeTitle, newArrivals, movedCollectionIds, type IntakeHost } from './intake';
import { assignCoverSlots, collectionDisplayName, compareCollections, coverFill, coverRatio, coverSeedOf, fileTitle, fileVersion, groupIntoShelves, shelfLayout, type Shelf } from './shelf';
import { onAppearanceChange, scheme } from './theme';

/** `pending` is how many pictures still had no measured colours when the answer was given (0 = `matches` is complete). */
export type LibraryFilterResult = { colour: string | null; query: string; matches: number; names: string[]; pending: number };
const titleCase = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

type Callbacks = {
  open: (path: string) => Promise<boolean>;
  error: (error: unknown) => void;
  /** Desktop reader: tear the drawer off into its own window. */
  undock?: () => void;
  /** This library already is that window. Closing it docks it back into the reader. */
  detached?: boolean;
  dock?: () => void;
  /** The undocked window should move to the other side of the reader. */
  place?: (side: LibrarySide) => void;
};
type Filter = { kind: 'all' | 'favorites' | 'unfiled' } | { kind: 'collection' | 'source'; id: string };
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
const panelIcon = { left: icon('<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/>'), right: icon('<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/>') };
const undockIcon = icon('<rect x="3" y="8" width="12" height="13" rx="1.5"/><rect x="9" y="3" width="12" height="13" rx="1.5"/>');
const closeIcon = icon('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>');
const chevronIcon = '<svg class="library-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
const viewIcon = { grid: icon('<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>'), list: icon('<path d="M3 6h.01M3 12h.01M3 18h.01M8 6h13M8 12h13M8 18h13"/>') };
const boardIcon = { open: icon('<path d="m15 15 6 6"/><path d="m9 9-6-6"/><path d="M21 16v5h-5"/><path d="M3 8V3h5"/>'), close: icon('<path d="m14 10 7-7"/><path d="M20 10h-6V4"/><path d="m3 21 7-7"/><path d="M4 14h6v6"/>') };
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
  /** Hides the drawer without changing the saved open/closed preference. Used while the library is its own window. */
  suspend: (hidden: boolean) => void;
  /** Sets the colour and/or search text of the library list (opening the drawer if needed) and reports what matches. `colour: null` clears it; omitted fields are left alone. */
  filter: (change: { colour?: string | null; query?: string }) => Promise<LibraryFilterResult>;
  colourNames: readonly string[];
} {
  // Drawer mode: at >=720 px the library is a resizable drawer floating over the page; below it
  // becomes a compact sheet with a scrim, a focus trap and workspace `inert`.
  const wide = window.matchMedia('(min-width: 720px)');
  // An undocked window is always the drawer, never the compact sheet, whatever its width.
  const roomy = () => Boolean(callbacks.detached) || wide.matches;
  const layout = document.getElementById('reader-layout');
  const toggleButton = document.getElementById('library-toggle');
  const workspace = document.getElementById('workspace');
  const preferenceKey = () => `hold-my-brief:library-${wide.matches ? 'wide' : 'narrow'}`;
  function preference() { try { const saved = localStorage.getItem(preferenceKey()); return saved === null ? wide.matches : saved === 'open'; } catch { return wide.matches; } }
  let visible = callbacks.detached ? true : preference(); let suspended = false; let library: Library = emptyLibrary(); let filter: Filter = { kind: 'all' };
  let activePath: string | undefined; let busy = false, loaded = false, revision = 0, page = 0;
  let loadError = false; let modal: HTMLDialogElement | undefined; let modalError: HTMLElement | undefined;
  let matches: LibraryDocument[] = []; let imageSequence: string[] = [];
  const expanded = new Set<string>(); const knownCollections = new Set<string>();
  let collectionMatches = new Map<string, Set<string>>();
  let searchable = new Map<string, string>();
  const busyDisabled = new Map<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLButtonElement, boolean>();
  let view: LibraryView = 'list'; let scopeOpen = false; let menuAnchor: HTMLElement | undefined;
  // The board is the same drawer opened across the whole reading panel; it is never saved, so the drawer width is untouched.
  let board = false; let selectedPath: string | undefined;
  // Colour filter: a named hue applied on top of the collection and search. A picture counts once its colours are known.
  let colourFilter: ColourName | null = null; let colourIndex: Promise<number> | undefined; let colourUnknown = 0; let colourTimer = 0; const colourRequested = new Set<string>();

  root.classList.add('library-root');
  if (callbacks.detached) root.classList.add('is-detached');
  const backdrop = button('', 'Close library'); backdrop.className = 'library-backdrop'; backdrop.tabIndex = -1;
  const panel = element('aside', 'library-panel'); panel.setAttribute('aria-label', 'Reference library');
  const header = element('div', 'library-header'); const headerActions = element('div', 'library-header-actions');
  const dock = button('', undefined, 'dock'); dock.className = 'library-dock';
  const undock = callbacks.undock ? button('', 'Undock library', 'undock') : undefined;
  if (undock) { undock.className = 'library-undock'; undock.title = 'Open the library in its own window'; undock.innerHTML = undockIcon; undock.onclick = () => callbacks.undock?.(); }
  const close = button('', callbacks.detached ? 'Dock library' : 'Close library'); close.innerHTML = closeIcon; close.title = callbacks.detached ? 'Dock library into the reader' : 'Close library';
  if (undock) headerActions.append(undock);
  headerActions.append(dock, close); header.append(element('h2', '', 'Library'), headerActions);
  const tools = element('div', 'library-tools');
  const add = button('Add files', 'Add local documents or images', 'add'); add.className = 'library-add';
  const sourcesButton = button('Sources', 'Index folders and manage source locations', 'sources'); tools.append(add, sourcesButton);
  const searchLabel = element('label', 'library-search-label', 'Search library');
  const search = element('input', 'library-search'); search.type = 'search'; search.placeholder = 'Title, tags, notes, folder…'; search.id = 'library-search'; search.autocomplete = 'off'; searchLabel.htmlFor = search.id;
  const facets = element('div', 'library-facets');
  const format = element('select'); format.setAttribute('aria-label', 'Filter by format');
  for (const [value, text] of [['', 'All formats'], ['image', 'Images'], ['document', 'Documents']]) option(format, value, text);
  const availability = element('select'); availability.setAttribute('aria-label', 'Filter by availability');
  for (const [value, text] of [['', 'Any availability'], ['ready', 'Ready'], ['missing', 'Missing']]) option(availability, value, text);
  facets.append(format, availability);
  const colourSelect = element('select'); colourSelect.setAttribute('aria-label', 'Filter by colour'); option(colourSelect, '', 'Any colour');
  for (const name of colourNames) option(colourSelect, name, titleCase(name));
  facets.append(colourSelect);
  const navigation = element('nav', 'library-navigation'); navigation.setAttribute('aria-label', 'Library filters and collections');
  // The scope row names the open collection; its popover holds the collection tree and the two filters,
  // so the grid keeps the drawer's height.
  const scope = element('div', 'library-scope');
  const scopeButton = button('', 'Choose collection and filters', 'scope'); scopeButton.className = 'library-scope-name'; scopeButton.setAttribute('aria-haspopup', 'true'); scopeButton.setAttribute('aria-expanded', 'false'); scopeButton.setAttribute('aria-controls', 'library-scope-menu');
  const scopeLabel = element('span', 'library-scope-label'); scopeButton.append(scopeLabel); scopeButton.insertAdjacentHTML('beforeend', chevronIcon);
  const resultCount = element('span', 'library-result-count'); resultCount.setAttribute('role', 'status');
  const viewToggle = element('div', 'library-view-toggle'); viewToggle.setAttribute('role', 'group'); viewToggle.setAttribute('aria-label', 'Library view');
  const viewButtons = { grid: button('', 'Grid view', 'view-grid'), list: button('', 'List view', 'view-list') };
  for (const mode of ['grid', 'list'] as const) { viewButtons[mode].innerHTML = viewIcon[mode]; viewButtons[mode].title = `${mode === 'grid' ? 'Grid' : 'List'} view`; viewToggle.append(viewButtons[mode]); }
  const sort = element('select', 'library-sort'); sort.setAttribute('aria-label', 'Sort library'); option(sort, 'recent', 'Recent'); option(sort, 'name', 'Name A–Z');
  const colourChip = button('', undefined, 'colour-chip'); colourChip.className = 'library-colour-chip'; colourChip.hidden = true;
  scope.append(scopeButton, colourChip, resultCount, viewToggle, sort);
  const scopeMenu = element('div', 'library-scope-menu'); scopeMenu.id = 'library-scope-menu'; scopeMenu.hidden = true; scopeMenu.append(navigation, facets);
  const itemMenu = element('div', 'library-item-menu'); itemMenu.setAttribute('role', 'menu'); itemMenu.hidden = true;
  const documents = element('div', 'library-documents'); documents.setAttribute('aria-label', 'Library items'); documents.setAttribute('role', 'list');
  const pager = element('div', 'library-pager');
  const fileInput = element('input'); fileInput.type = 'file'; fileInput.accept = '.pdf,.epub,.md,.markdown,.txt,.png,.jpeg,.jpg,.webp,.gif,.avif,.bmp'; fileInput.multiple = true; fileInput.hidden = true;
  // Board layout: header, tools and the collection tree become a left rail, search, scope row and grid the
  // main column, and a detail strip joins from 1200 px. `arrange` moves the same nodes between the two layouts.
  const boardButton = button('', 'Open library board', 'board'); boardButton.className = 'library-board-toggle'; boardButton.innerHTML = boardIcon.open; boardButton.title = 'Browse the library at full width'; headerActions.prepend(boardButton);
  const boardBack = button('', undefined, 'board-back'); boardBack.className = 'library-board-back'; boardBack.setAttribute('aria-keyshortcuts', 'Escape'); boardBack.insertAdjacentHTML('beforeend', `${boardIcon.close}<span>Back to reading</span><kbd>Esc</kbd>`);
  const rail = element('div', 'library-board-rail'); const boardMain = element('div', 'library-board-main');
  const detail = element('aside', 'library-detail'); detail.setAttribute('aria-label', 'Selected reference');
  const boardLayout = element('div', 'library-board'); boardLayout.append(rail, boardMain, detail);
  function arrange() {
    const focused = document.activeElement instanceof HTMLElement && root.contains(document.activeElement) ? document.activeElement : undefined;
    if (board) {
      scope.insertBefore(searchLabel, viewToggle); scope.insertBefore(search, viewToggle); scope.append(boardBack);
      rail.append(header, tools, scopeMenu); boardMain.append(scope, documents, pager);
      panel.replaceChildren(boardLayout, itemMenu, fileInput);
    } else {
      boardBack.remove(); panel.replaceChildren(header, tools, searchLabel, search, scope, scopeMenu, itemMenu, documents, pager, fileInput);
    }
    if (focused?.isConnected) focused.focus();
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
  function applySide() {
    const other = side === 'left' ? 'right' : 'left'; layout?.classList.toggle('library-right', side === 'right');
    toggleButton?.setAttribute('data-library-side', side);
    dock.innerHTML = panelIcon[other]; dock.setAttribute('aria-label', `Move library to the ${other}`); dock.title = `Move library to the ${other}`;
  }
  dock.onclick = () => { side = side === 'left' ? 'right' : 'left'; savePreference(sideKey, side); applySide(); callbacks.place?.(side); };
  // While dragging, only the drawer follows the pointer; it is out of flow, so the reading panel,
  // the page box and the canvas bitmap keep their exact geometry and never refit.
  let drag: { pointer: number; x: number; start: number; next?: number } | undefined; let dragFrame = 0;
  function setResizing(on: boolean) {
    document.documentElement.classList.toggle('library-resizing', on);
  }
  resizeHandle.addEventListener('pointerdown', event => {
    if (event.button !== 0 || drag || callbacks.detached || !wide.matches) return;
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
    const shown = visible && !suspended;
    root.hidden = !shown; layout?.classList.toggle('library-open', shown); toggleButton?.setAttribute('aria-expanded', String(shown));
    if (workspace) workspace.inert = shown && (!roomy() || board);
    if (shown) { thumbs.retryFailed(); for (const media of documents.querySelectorAll('.is-unavailable')) media.classList.remove('is-unavailable'); observeThumbnails(); } else { setBoard(false, 'none'); setScope(false); closeItemMenu(false); clearThumbnails(); }
  }
  function setVisible(next: boolean, focus = true, persist = true) {
    if (callbacks.detached) { if (!next) callbacks.dock?.(); return; }
    visible = next; if (persist) try { localStorage.setItem(preferenceKey(), next ? 'open' : 'closed'); } catch { /* Optional preference. */ }
    applyVisibility(); if (focus) (next ? search : toggleButton)?.focus();
  }
  function toggle() { if (modal?.open) return; if (suspended) { suspended = false; setVisible(true); return; } setVisible(!visible); }
  backdrop.onclick = close.onclick = () => { if (!busy) setVisible(false); };
  wide.addEventListener('change', () => { if (callbacks.detached) return; const hadFocus = root.contains(document.activeElement); if (!wide.matches) setBoard(false, 'none'); visible = modal?.open ? true : preference(); applyVisibility(); if (!visible && hadFocus) toggleButton?.focus(); });
  root.addEventListener('keydown', event => {
    if (event.key === 'Escape' && (!itemMenu.hidden || scopeOpen)) { event.preventDefault(); event.stopPropagation(); if (!itemMenu.hidden) closeItemMenu(); else { setScope(false); scopeButton.focus(); } return; }
    if (event.key === 'Escape' && board && !modal?.open) { event.preventDefault(); event.stopPropagation(); if (!busy) setBoard(false, 'control'); return; }
    if (event.key === 'Escape' && !modal?.open) { event.preventDefault(); event.stopPropagation(); if (!busy) setVisible(false); }
    if (event.key === 'Tab' && visible && !roomy() && !modal?.open) {
      const controls = Array.from(panel.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled):not([hidden]), select:not(:disabled), summary')).filter(node => node.getClientRects().length);
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    // Reader shortcuts must never consume typing, arrows, or space in the library. The palette (Ctrl+K)
    // is the exception: it is how every command is reached, so it works from the library too.
    if (shortcutFor(event) === 'command-palette') return;
    event.stopPropagation();
  });
  imageNavigation.addEventListener('keydown', event => { if (shortcutFor(event) !== 'command-palette') event.stopPropagation(); });
  function focusKey() { return document.activeElement instanceof HTMLElement && root.contains(document.activeElement) ? document.activeElement.dataset.libraryFocus : undefined; }
  function restoreFocus(key?: string, original?: HTMLElement) {
    if (!visible) { toggleButton?.focus(); return; }
    if (original?.isConnected && !original.matches(':disabled')) { original.focus(); return; }
    const replacement = key && Array.from(root.querySelectorAll<HTMLElement>('[data-library-focus]')).find(node => node.dataset.libraryFocus === key);
    (replacement || add).focus();
  }
  function setBusy(next: boolean) {
    busy = next; panel.setAttribute('aria-busy', String(next));
    if (next) for (const control of [...root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLButtonElement>('button, input, select, textarea'), ...imageNavigation.querySelectorAll<HTMLButtonElement>('button')]) {
      if (!busyDisabled.has(control)) busyDisabled.set(control, control.disabled); control.disabled = true;
    }
    else { for (const [control, disabled] of busyDisabled) control.disabled = disabled; busyDisabled.clear(); }
  }
  function report(error: unknown) { if (modalError) modalError.textContent = error instanceof Error ? error.message : String(error); callbacks.error(error); }
  async function mutate(operation: () => Promise<Library>, after?: () => void) {
    if (busy) return; const key = focusKey(), hadDialog = Boolean(modal?.open), scrolled = documents.scrollTop; if (modalError) modalError.textContent = '';
    ++revision; setBusy(true);
    try { library = await operation(); ++revision; loaded = true; loadError = false; rebuildIndex(); render(); documents.scrollTop = scrolled; after?.(); }
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
    root.append(dialog); modal = dialog; modalError = error;
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
      if (opened) { activePath = doc.path; renderImageNavigation(); if (!roomy()) { setVisible(false, false, false); workspace?.querySelector<HTMLElement>('.reader-host:not(.staging)')?.focus(); } }
    } catch (error) { report(error); }
    finally { setBusy(false); if (!opened) restoreFocus(`open:${doc.path}`, trigger); }
  }
  function renderImageNavigation() {
    const focused = document.activeElement instanceof HTMLElement && imageNavigation.contains(document.activeElement) ? document.activeElement.dataset.imageDirection : undefined;
    imageNavigation.replaceChildren(); const doc = library.documents.find(item => item.path === activePath);
    imageNavigation.hidden = !doc || !isImage(doc); if (!doc || !isImage(doc)) return;
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
      indexButton.onclick = () => void addAndReview(() => indexFolder(), 'Indexed folder', true, sourcesButton, () => view.dialog.close());
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
    thumbs.reconcile(new Set(library.documents.map(doc => doc.path))); colourIndex = undefined; colourRequested.clear();
  }
  function renderNavigation() {
    navigation.replaceChildren();
    function filterButton(label: string, count: number, next: Filter, key: string) {
      const control = button('', label, key); control.className = 'library-filter'; control.append(element('span', 'library-filter-name', label), element('span', 'library-count', String(count)));
      control.setAttribute('aria-pressed', String(filter.kind === next.kind && (!('id' in next) || 'id' in filter && filter.id === next.id)));
      control.onclick = () => { filter = next; page = 0; if (!board) { setScope(false); scopeButton.focus(); } render(); }; return control;
    }
    navigation.append(filterButton('All references', library.documents.length, { kind: 'all' }, 'all'), filterButton('Favorites', library.documents.filter(doc => doc.favorite).length, { kind: 'favorites' }, 'favorites'), filterButton('Unfiled', library.documents.filter(doc => !doc.collectionIds.length).length, { kind: 'unfiled' }, 'unfiled'));
    const heading = element('div', 'library-collections-heading'); const create = button('+ New', 'New personal collection', 'new-collection'); create.onclick = () => { setScope(false); collectionForm(scopeButton); }; heading.append(element('h3', '', 'Collections'), create); navigation.append(heading);
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
      if (!item.sourceId) { const edit = button('···', `Edit ${collectionDisplayName(item.name)}`, `edit:${item.id}`); edit.className = 'library-collection-action'; edit.onclick = () => { setScope(false); collectionForm(scopeButton, item); }; row.append(edit); }
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
    media.style.setProperty('--ratio', String(thumbnail.ratio));
    const image = media.querySelector<HTMLImageElement>(':scope > img')!; image.src = thumbnail.url; image.hidden = false; media.classList.add('is-loaded');
  }
  let placementFrame = 0;
  function schedulePlacement() { if (!placementFrame) placementFrame = requestAnimationFrame(() => { placementFrame = 0; layoutGrid(); }); }
  function markUnavailable(media: HTMLElement) { media.classList.add('is-unavailable'); media.title = 'Thumbnail unavailable. Use More actions to locate the original.'; }
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
    if (next === board || next && (!roomy() || !visible || suspended || modal?.open)) return;
    closeItemMenu(false); setScope(false); board = next;
    root.classList.toggle('is-board', board); boardButton.setAttribute('aria-pressed', String(board));
    scopeMenu.hidden = !board; scopeButton.tabIndex = board ? -1 : 0;
    if (workspace) workspace.inert = visible && !suspended && (!roomy() || board);
    arrange(); renderDocuments();
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
    if (!('id' in selected)) return selected.kind === 'all' ? 'All references' : selected.kind === 'favorites' ? 'Favorites' : 'Unfiled';
    if (selected.kind === 'source') return selected.id;
    const named = library.collections.find(item => item.id === selected.id); return named ? collectionDisplayName(named.name) : 'Collection';
  }
  function setScope(open: boolean) {
    if (board || open && (busy || modal?.open)) return;
    scopeOpen = open; scopeMenu.hidden = !open; scopeButton.setAttribute('aria-expanded', String(open));
    if (open) { closeItemMenu(false); scopeMenu.style.setProperty('--scope-top', `${scope.offsetTop + scope.offsetHeight + 2}px`); }
  }
  scopeButton.onclick = () => setScope(!scopeOpen);
  // Per-item menu (Details, Organize, Locate original) shared by every tile and row.
  function closeItemMenu(refocus = true) {
    if (itemMenu.hidden) return; itemMenu.hidden = true; const anchor = menuAnchor; menuAnchor = undefined;
    anchor?.closest('.library-document')?.classList.remove('is-menu-open'); anchor?.setAttribute('aria-expanded', 'false');
    if (refocus && anchor?.isConnected) anchor.focus();
  }
  function openItemMenu(doc: LibraryDocument, anchor: HTMLElement) {
    if (busy || modal?.open) return; if (!itemMenu.hidden && menuAnchor === anchor) { closeItemMenu(); return; }
    closeItemMenu(false); setScope(false); itemMenu.replaceChildren();
    const entries: [string, () => void][] = [['Details', () => referenceDetails(doc, anchor)], ['Organize…', () => organize(doc, anchor)]];
    if (hasCover(doc) && !thumbs.peek(doc.path)) { entries.push(['New cover pattern', () => void rerollCovers([doc.path])]); if (doc.coverSeed !== undefined) entries.push(['Reset cover', () => void rerollCovers([doc.path], true)]); }
    if (desktop) entries.push(['Locate original…', () => locateOriginal(doc)]);
    for (const [label, run] of entries) { const item = button(label); item.setAttribute('role', 'menuitem'); item.onclick = () => { closeItemMenu(false); run(); }; itemMenu.append(item); }
    menuAnchor = anchor; anchor.setAttribute('aria-expanded', 'true'); anchor.closest('.library-document')?.classList.add('is-menu-open'); itemMenu.hidden = false;
    const bounds = panel.getBoundingClientRect(), at = anchor.getBoundingClientRect(), border = panel.clientLeft;
    const below = at.bottom - bounds.top - panel.clientTop + panel.scrollTop + 2;
    itemMenu.style.left = `${Math.min(Math.max(4, at.right - bounds.left - border - itemMenu.offsetWidth), panel.clientWidth - itemMenu.offsetWidth - 4)}px`;
    itemMenu.style.top = `${below + itemMenu.offsetHeight > panel.scrollTop + panel.clientHeight ? at.top - bounds.top - panel.clientTop + panel.scrollTop - itemMenu.offsetHeight - 2 : below}px`;
    itemMenu.querySelector<HTMLElement>('button')?.focus();
  }
  itemMenu.addEventListener('keydown', event => {
    const items = Array.from(itemMenu.querySelectorAll<HTMLElement>('button')); const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); items[(index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus(); }
    else if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); items[event.key === 'Home' ? 0 : items.length - 1]?.focus(); }
    else if (event.key === 'Tab') closeItemMenu(false);
  });
  document.addEventListener('pointerdown', event => {
    const target = event.target as Node;
    if (!itemMenu.hidden && !itemMenu.contains(target) && !menuAnchor?.contains(target)) closeItemMenu(false);
    if (scopeOpen && !scopeMenu.contains(target) && !scopeButton.contains(target)) setScope(false);
  });

  // Grid view: each tile keeps its picture's proportions and joins the shortest column.
  const thumbnailable = (doc: LibraryDocument) => canThumbnail(doc.format);
  function inScope(doc: LibraryDocument) {
    const selected = filter;
    if (selected.kind === 'favorites') return doc.favorite; if (selected.kind === 'unfiled') return !doc.collectionIds.length;
    if (selected.kind === 'collection') return Boolean(collectionMatches.get(selected.id)?.has(doc.path));
    if (selected.kind === 'source') return doc.source?.repository === selected.id;
    return true;
  }
  const viewKey = () => `hold-my-brief:library-view:${filter.kind === 'collection' || filter.kind === 'source' ? `${filter.kind}:${filter.id}` : filter.kind}`;
  // Saved per collection; with no choice yet, grid when at least half of the collection can show a thumbnail.
  // The default looks at the whole collection, not the search, so typing never flips the view.
  function currentView(): LibraryView {
    const saved = parseLibraryView(savedPreference(viewKey())); if (saved) return saved;
    const scoped = library.documents.filter(inScope); return defaultLibraryView(scoped.filter(thumbnailable).length, scoped.length);
  }
  // Tiles sit in the DOM in sorted order (so Tab and screen readers follow the sort, shelf by shelf) and are
  // positioned absolutely into masonry columns: each joins the shortest column of its shelf, and a tile's height
  // follows its ratio. A shelf header is placed the same way, above its tiles.
  type Tile = { node: HTMLElement; path: string; ratio: number; column: number };
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
    const columns = libraryGridColumns(width, board ? libraryGrid.boardMinTile : undefined); const gap = libraryGrid.gap;
    const tileWidth = (width - gap * (columns - 1)) / columns; const reassign = assign || columns !== columnCount; columnCount = columns;
    const style = getComputedStyle(documents); const left = parseFloat(style.paddingLeft), top = parseFloat(style.paddingTop);
    let y = 0;
    sections.forEach((section, index) => {
      if (section.head) {
        if (index) y += shelfLayout.gap;
        section.head.style.left = `${left}px`; section.head.style.top = `${top + y}px`; section.head.style.width = `${width}px`; y += shelfLayout.head + shelfLayout.below;
      }
      if (reassign) assignMasonry(section.tiles.map(tile => 1 / tile.ratio), columns, gap / tileWidth).forEach((indices, column) => { for (const at of indices) section.tiles[at].column = column; });
      const bottoms = new Array<number>(columns).fill(0);
      for (const tile of section.tiles) {
        const offset = bottoms[tile.column]; bottoms[tile.column] = offset + tileWidth / tile.ratio + gap;
        tile.node.dataset.column = String(tile.column); tile.node.style.width = `${tileWidth}px`; tile.node.style.left = `${left + tile.column * (tileWidth + gap)}px`; tile.node.style.top = `${top + y + offset}px`;
      }
      y += Math.max(...bottoms) - gap;
    });
    gridSizer.style.height = `${Math.max(0, y)}px`;
    // Tiles built while the drawer was hidden or had no width are only placed now; observing is idempotent.
    observeThumbnails();
  }
  // The drawer's own width is the only input; a new width re-places the tiles (and re-assigns columns if their count changed).
  new ResizeObserver(() => { if (visible) layoutGrid(); }).observe(documents);

  // An EPUB's title is what its tile and detail show, once read (the file name until then). The library entry's own name is kept as the file name.
  const epubTitle = (doc: LibraryDocument) => doc.format === 'epub' ? thumbs.epub(doc.path)?.title : undefined;
  const docLabel = (doc: LibraryDocument) => epubTitle(doc) ?? doc.name;
  function reflectEpub(path: string) {
    const doc = library.documents.find(item => item.path === path); if (!doc) return;
    const label = docLabel(doc);
    for (const node of documents.querySelectorAll<HTMLElement>('[data-doc-path]')) {
      if (node.dataset.docPath !== path) continue;
      node.dataset.docName = label; const open = node.querySelector<HTMLElement>('.library-document-open'); if (open) labelOpen(open, { name: label, path });
      for (const text of node.querySelectorAll<HTMLElement>('.library-document-name, .library-tile-name')) text.textContent = label;
      for (const text of node.querySelectorAll<HTMLElement>('.library-cover-title')) text.textContent = epubTitle(doc) ?? fileTitle(doc.name);
      const meta = node.querySelector<HTMLElement>('.library-row-meta'); if (meta) meta.textContent = rowMeta(doc);
    }
    if (board && selectedPath === path) renderDetail();
  }
  /** Format, then only what is worth saying: a missing or removed original, the open reference, and the file name when the title is the book's own. A reference that is simply there says nothing about it. */
  const rowMeta = (doc: LibraryDocument, full = true) => [doc.format.toUpperCase(), doc.source?.removed ? 'no longer in folder' : (doc.availability ?? 'ready') === 'ready' ? undefined : doc.availability, full && doc.path === activePath ? 'Reading' : undefined, full && epubTitle(doc) ? doc.name : undefined].filter(Boolean).join(' · ');
  /** A generated cover for a document with no picture: dithered art of its shelf in the top half, the title and the format (with the version in the file name) below. */
  function coverNode(doc: LibraryDocument, shelfId: string | undefined) {
    const cover = element('span', 'library-cover'); cover.style.setProperty('--cover-fill', coverFill(shelfId));
    const seed = coverSeedOf(doc);
    const art = element('img', 'library-cover-art'); art.alt = ''; art.dataset.cover = shelfId ?? ''; art.dataset.seed = String(seed); art.src = coverArt(seed, shelfId, scheme());
    const meta = element('span', 'library-cover-meta'); meta.append(element('span', '', doc.format.toUpperCase())); const version = fileVersion(doc.name); if (version) meta.append(element('span', '', version));
    const text = element('span', 'library-cover-text'); text.append(element('span', 'library-cover-title', epubTitle(doc) ?? fileTitle(doc.name)), meta);
    cover.append(art, text); return cover;
  }
  const hasCover = (doc: LibraryDocument) => (doc.availability ?? 'ready') !== 'missing' && (!thumbnailable(doc) || doc.format === 'epub');
  onAppearanceChange(() => { for (const art of root.querySelectorAll<HTMLImageElement>('.library-cover-art')) art.src = coverArt(Number(art.dataset.seed), art.dataset.cover || undefined, scheme()); });
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
    favorite.onclick = () => void mutate(() => editLibrary({ action: 'updateDocument', path: doc.path, collectionIds: doc.collectionIds, favorite: !doc.favorite, tags: doc.tags, notes: doc.notes }));
    const more = button('···', `More actions for ${doc.name}`, `more:${doc.path}`); more.className = 'library-organize'; more.setAttribute('aria-haspopup', 'menu'); more.setAttribute('aria-expanded', 'false'); more.onclick = () => openItemMenu(doc, more);
    if (generated) actions.append(rerollButton(doc, `reroll:${doc.path}`));
    actions.append(favorite, more); return actions;
  }
  function documentRow(doc: LibraryDocument) {
    const row = element('div', 'library-document'); row.setAttribute('role', 'listitem'); row.classList.toggle('is-active', doc.path === activePath);
    const open = button('', `Open ${docLabel(doc)}`, `open:${doc.path}`); open.className = 'library-document-open'; open.title = doc.path; if (doc.path === activePath) open.setAttribute('aria-current', 'true');
    open.append(element('span', 'library-document-name', docLabel(doc)), element('span', 'library-document-meta library-row-meta', rowMeta(doc)));
    bindOpen(doc, open, row);
    row.append(open, actionsFor(doc)); return row;
  }
  /** `shelfId` is the shelf the tile sits on, which tints its generated cover; outside shelves it is the document's first collection. */
  function documentTile(doc: LibraryDocument, shelfId: string | undefined): Tile {
    const generated = hasCover(doc); const ratio = thumbs.ratio(doc.path) ?? (generated ? coverRatio : libraryGrid.defaultRatio); const missing = (doc.availability ?? 'ready') === 'missing';
    const node = element('div', 'library-document library-tile'); node.setAttribute('role', 'listitem');
    node.classList.toggle('is-active', doc.path === activePath); node.classList.toggle('is-missing', missing); node.classList.toggle('is-cover', generated);
    const open = button('', `Open ${docLabel(doc)}`, `open:${doc.path}`); open.className = 'library-document-open library-tile-open'; open.title = doc.path; if (doc.path === activePath) open.setAttribute('aria-current', 'true');
    const media = element('span', 'library-tile-media'); media.style.setProperty('--ratio', String(ratio));
    const format = doc.format.toUpperCase();
    if (missing) media.append(element('span', 'library-tile-glyph'), element('span', 'library-tile-note', 'Missing'));
    else {
      if (generated) { media.append(coverNode(doc, shelfId)); coverShelf.set(doc.path, shelfId); }
      if (thumbnailable(doc)) {
        if (!generated) media.append(element('span', 'library-tile-format', format));
        const image = element('img'); image.alt = ''; image.hidden = true; image.decoding = 'async'; media.dataset.path = doc.path; media.dataset.format = doc.format; media.append(image);
        const cached = thumbs.peek(doc.path); if (cached) showThumbnail(media, cached); else if (thumbs.failed(doc.path)) markUnavailable(media);
        const scrim = element('span', 'library-tile-scrim'); scrim.append(element('span', 'library-tile-name', docLabel(doc)), element('span', 'library-tile-meta', format)); media.append(scrim);
      }
    }
    if (doc.path === activePath) media.append(element('span', 'library-tile-tag', 'Reading'));
    open.append(media);
    bindOpen(doc, open, node);
    node.append(open, actionsFor(doc, generated)); return { node, path: doc.path, ratio, column: 0 };
  }
  for (const mode of ['grid', 'list'] as const) viewButtons[mode].onclick = () => { if (view !== mode) { savePreference(viewKey(), mode); renderDocuments(); } };
  function shelfHead(shelf: Shelf<LibraryDocument>) {
    const head = element('div', 'library-shelf-head'); head.setAttribute('role', 'listitem'); head.dataset.shelf = shelf.id;
    head.append(element('span', 'library-shelf-name', shelf.name), element('span', 'library-shelf-count', String(shelf.items.length))); return head;
  }
  function renderDocuments() {
    clearThumbnails(); documents.replaceChildren(); pager.replaceChildren(); tiles = []; sections = []; tileByPath.clear(); coverShelf.clear(); columnCount = 0; closeItemMenu(false); const generation = ++renderGeneration;
    const unknown: LibraryDocument[] = [];
    const query = search.value.trim().toLocaleLowerCase();
    matches = library.documents.filter(doc => {
      if (!inScope(doc)) return false;
      if (format.value === 'image' && !isImage(doc) || format.value === 'document' && !['pdf', 'epub', 'md', 'markdown', 'txt'].includes(doc.format)) return false;
      if (availability.value && (doc.availability ?? 'ready') !== availability.value) return false;
      const categories = doc.collectionIds.map(id => { const item = library.collections.find(collection => collection.id === id); return item ? `${item.name} ${collectionDisplayName(item.name)}` : ''; }).join(' ').toLocaleLowerCase();
      const info = thumbs.epub(doc.path); const known = `${info?.title ?? ''} ${info?.creator ?? ''}`.toLocaleLowerCase();
      if (!(!query || query.split(/\s+/).every(word => `${searchable.get(doc.path) ?? ''} ${known} ${categories}`.includes(word)))) return false;
      if (!colourFilter) return true;
      const colours = thumbs.colours(doc.path);
      if (!colours) { if (thumbnailable(doc) && (doc.availability ?? 'ready') !== 'missing' && !thumbs.failed(doc.path) && !thumbs.none(doc.path)) unknown.push(doc); return false; }
      return colourMatches(colours, colourFilter);
    });
    matches.sort(sort.value === 'name' ? (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }) || a.path.localeCompare(b.path) : (a, b) => timestamp(b.lastOpened) - timestamp(a.lastOpened) || a.name.localeCompare(b.name));
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
    for (const mode of ['grid', 'list'] as const) viewButtons[mode].setAttribute('aria-pressed', String(view === mode));
    scopeLabel.textContent = scopeName(); scopeButton.setAttribute('aria-label', `${scopeName()}. Choose collection and filters`);
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
    for (const doc of shown) if (doc.format === 'epub' && (doc.availability ?? 'ready') !== 'missing' && !thumbs.epub(doc.path)) void thumbs.loadEpub(doc.path, () => visible && generation === renderGeneration).then(info => { if (info) reflectEpub(doc.path); });
    thumbs.trim(new Set(shown.map(doc => doc.path)));
    if (matches.length > pageSize) {
      const previous = button('←', 'Previous library page', 'page-previous'); previous.disabled = page === 0; const next = button('→', 'Next library page', 'page-next'); next.disabled = (page + 1) * pageSize >= matches.length;
      const change = (offset: number) => { page += offset; renderDocuments(); documents.scrollTop = 0; documents.querySelector<HTMLElement>('.library-document-open')?.focus(); };
      previous.onclick = () => change(-1); next.onclick = () => change(1); pager.append(previous, element('span', '', `${page * pageSize + 1}–${Math.min(matches.length, (page + 1) * pageSize)} / ${matches.length}`), next);
    }
    observeThumbnails(); renderImageNavigation(); renderDetail(); if (busy) setBusy(true);
  }
  function render() {
    const key = focusKey(); if (filter.kind === 'collection' && !library.collections.some(collection => filter.kind === 'collection' && collection.id === filter.id)) filter = { kind: 'unfiled' };
    renderNavigation(); renderDocuments(); const collection = filter.kind === 'collection' ? library.collections.find(item => filter.kind === 'collection' && item.id === filter.id) : undefined;
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
    if (!visible) setVisible(true, false);
    if (change.query !== undefined) search.value = change.query;
    if (colour !== undefined) { colourFilter = colour; colourRequested.clear(); colourSelect.value = colour ?? ''; }
    page = 0; renderDocuments();
    // Pictures whose colours are not known yet are analysed first, for at most 25 s, so the answer is complete.
    for (const deadline = Date.now() + 25_000; colourFilter && colourUnknown > 0 && Date.now() < deadline;) await new Promise(resolve => setTimeout(resolve, 200));
    if (colourTimer) { clearTimeout(colourTimer); colourTimer = 0; }
    if (colourFilter) renderDocuments();
    return { colour: colourFilter, query: search.value.trim(), matches: matches.length, names: matches.slice(0, 10).map(doc => doc.name), pending: colourFilter ? colourUnknown : 0 };
  }
  search.oninput = () => { page = 0; renderDocuments(); }; sort.onchange = format.onchange = availability.onchange = () => { page = 0; renderDocuments(); };
  let chosenCollection: string | null = null;
  add.onclick = () => { if (busy) return; const collection = filter.kind === 'collection' ? library.collections.find(item => filter.kind === 'collection' && item.id === filter.id) : undefined; chosenCollection = collection && !collection.sourceId ? collection.id : null; if (desktop) void addAndReview(() => addDocuments(chosenCollection), 'Added files', false, add); else fileInput.click(); };
  fileInput.onchange = () => { const files = Array.from(fileInput.files ?? []); fileInput.value = ''; if (files.length) void addAndReview(() => addDocuments(chosenCollection, files), 'Added files', false, add); };
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
  sourcesButton.onclick = () => sourceManager(sourcesButton);
  async function refresh(path?: string) {
    if (path !== undefined) activePath = path; const token = ++revision;
    try { const next = await getLibrary(); if (token !== revision) return; library = next; loaded = true; loadError = false; rebuildIndex(); render(); }
    catch (error) { if (token !== revision) return; loadError = true; render(); callbacks.error(error); }
  }
  toggleButton?.setAttribute('aria-controls', root.id); applySide(); applyWidth(preferredWidth); rebuildIndex(); applyVisibility(); render();
  return {
    refresh,
    toggle: () => { toggle(); if (visible && !suspended && loadError) void refresh(); },
    suspend(hidden: boolean) { suspended = hidden; if (hidden) { setBoard(false, 'none'); setScope(false); closeItemMenu(false); } applyVisibility(); },
    // Library board (palette command): open the drawer if needed, then enter or leave the board. Below 720 px there is only the sheet.
    board: () => { if (suspended) return; if (!visible) setVisible(true, false); if (roomy()) setBoard(!board, 'control'); else search.focus(); if (visible && loadError) void refresh(); },
    filter: filterBy,
    colourNames,
  };
}
