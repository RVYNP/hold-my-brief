import './style.css';
import { defaultOptions, type Format, type Position, type ReaderAdapter, type ReaderOptions } from './types';
import { nudgeFor, parsePlacement, placementOf, resolvePlacement, serialisePlacement, type Point } from './view-controls-position';
import { desktop, native, state, browserFile, persist, openExternal, confirmDocument, touchDocument, openLibraryDocument, chooseDocument, getLibrary, imageFormats, locateLibraryDocument, saveTabs, type Opened, type Recent, type WindowState } from './bridge';
import { emptyLibrary, type Library } from './catalog-types';
import { createLibrary, type LibraryPlace } from './library';
import { formatProgress, progressOf, type Progress } from './progress';
import { createIconRail, railIcons } from './icon-rail';
import { ImageAdapter } from './adapters/image';
import { createPalette } from './palette';
import { createFindBar } from './find-bar';
import { COMMANDS, FOCUS_PANE_DIRECTIONS, shortcutFor, shortcutReference, splitReason as paneSplitReason, tabDigit, unavailableReason, type SplitContext } from './commands';
import { startAreaDrag, type AreaDrag } from './area-drag';
import { createAgentEvents, progressFraction, selectionInfo, type SelectionInfo, type TabInfo } from './agent-events';
import { appearance, initAppearance, onAppearanceChange, allPalettes, pageTones, saveAppearance, scheme, type AppearanceMode } from './theme';
import { appearanceSummary } from './appearance';
import { createSettingsSheet, type MoreItem } from './settings';
import { createAssistantPanel } from './assistant-panel';
import { DRAG_SLOP, Panner } from './pan';
import { MIN_SPREAD_WIDTH, pagesLabel, spreadPages } from './spread';
import { assignShelfSlots, closeHome, fillHomePictures, homeSections, openedOrder, renderHome, repaintGround } from './home';
import { displayTitle } from './shelf';
import { repaintCovers } from './cards';
import { canThumbnail, createThumbnailStore } from './thumbnails';
import { createPageStrip, MIN_PANEL_HEIGHT } from './page-strip';
import { DEFAULT_LIMITS, migrateLegacyZoom, stepZoom, wheelFactor, ZOOM_MODEL, zoomPercent, type Point as ZoomPoint } from './zoom';
import { createZoomGesture } from './zoom-gesture';
import type { Hold, Spot } from './zoom-anchor';
import { createZoomMenu } from './zoom-menu';
import { createProgressPreview } from './progress-preview';
import { readAheadPaths } from './read-ahead';
import { LIBRARY_PATH, TabList, hibernationAcross, legacySplit, mergeLists, moveAcross, restorePanes, splitOff, splitOffRest, type SavedLayout, type SavedTab, type TabSession } from './tabs';
import { createTabStrip, type TabStrip, type TabView } from './tab-strip';
import { titleHints } from './tab-titles';
import { baseName, ghostLabel, insertionIndex, overlayNames, splitDropped, unsupportedNotice } from './drop';
import { attachOpenDrag } from './open-drag';
import { createReadingControls } from './reading-controls';
import { fillContents } from './contents';
import { steppedFontSize } from './text-size';
import { createWindowControls, wireWindowControls } from './window-controls';
import { Pane } from './pane';
import { DEFAULT_PERCENT, MIN_SPLIT_WINDOW, PANE_IDS, boxes, evenRatio, fits, freeId, neighbour, panes as panesOf, receiver, removePane, renamePanes, setRatio, splitAt, splitPane, type Axis, type Direction, type Layout, type Path, type Rect } from './layout';
import { createBody, createDivider, createRow, paintDivider, paintFold, paneMap, withoutIds, type SideView } from './split-view';
import { hostSelectionText } from './pane-selection';
import { createContextMenu, type MenuEntry } from './context-menu';
import { BRIEF_PREFIX, briefIdOf, handleControlRequest, isBriefPath, type ControlHost } from './control';
initAppearance();

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <header class="toolbar" data-tauri-drag-region><button id="library-toggle" class="icon-button" aria-label="Document library" aria-controls="library-root" aria-expanded="false" title="Document library (Ctrl+B)"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16m-3-12v8"/></svg></button><nav id="tab-strip" class="tab-strip" aria-label="Open documents" data-tauri-drag-region><div id="tab-list" class="tab-list" role="tablist" aria-label="Documents"></div><button id="tab-overflow" class="tab-overflow" aria-label="All tabs" title="All tabs" aria-haspopup="menu" aria-expanded="false" hidden></button></nav><button id="title" class="title" aria-haspopup="menu" aria-expanded="false" title="Open tabs"><strong id="filename">Hold My Brief</strong><span id="filekind">A reader that holds.</span><span id="tab-count" class="tab-count"></span></button><button id="settings-toggle" class="icon-button" aria-label="Settings" title="Settings">${railIcons.settings}</button><div class="caption" role="group" aria-label="Window"><button id="caption-minimize" aria-label="Minimize" title="Minimize"><svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M0 5.5h10" stroke="currentColor"/></svg></button><button id="caption-maximize" aria-label="Maximize" title="Maximize"><svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" aria-hidden="true"><rect class="caption-max" x=".5" y=".5" width="9" height="9"/><path class="caption-restore" d="M2.5 2.5V.5h7v7h-2M.5 2.5h7v7h-7z"/></svg></button><button id="caption-close" aria-label="Close" title="Close"><svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" aria-hidden="true"><path d="M.5.5l9 9m0-9l-9 9"/></svg></button></div></header>
  <aside id="notice" role="status" hidden><span></span><button id="retry-save" hidden>Retry save</button><button id="dismiss-notice" aria-label="Dismiss message">×</button></aside>
  <div id="reader-layout"><div id="loading" role="status" hidden><span></span><button id="cancel">Cancel</button></div><div id="library-root"></div><nav id="library-rail"></nav>
  <main id="workspace"><section id="empty"><div class="book-mark" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="4" y="3" width="16" height="18" rx="3"/><path d="M9 3v18m4-13h3m-3 4h3"/></svg></div><p class="eyebrow">KEEP YOUR PLACE</p><h1>Hand it over.</h1><p>Drop a brief and it stays pinned<br>exactly where you leave it.</p><button id="empty-open" class="primary">Hold a brief <span>↗</span></button><p class="formats">PDF · EPUB · MARKDOWN · TEXT</p><div id="recents"></div><p id="preview-note" hidden>Browser preview · Pin and size lock are available in the desktop app.</p></section>
  <section id="tab-state" hidden><h2 id="tab-state-title"></h2><p id="tab-state-detail"></p><div class="tab-state-actions"><button id="tab-state-primary" class="primary"></button><button id="tab-state-close">Close tab</button></div></section>
  <div id="drop-overlay" hidden aria-hidden="true"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M12 18v-6M9 15h6"/></svg><strong>Drop to open in a new tab</strong><span id="drop-names"></span></div>
  <div id="view-controls" role="group" aria-label="View controls" hidden><button id="view-grip" type="button" aria-label="Move view controls" title="Drag to move · double-click to reset"><svg width="8" height="14" viewBox="0 0 8 14" fill="currentColor" aria-hidden="true"><circle cx="2" cy="3" r="1"/><circle cx="6" cy="3" r="1"/><circle cx="2" cy="7" r="1"/><circle cx="6" cy="7" r="1"/><circle cx="2" cy="11" r="1"/><circle cx="6" cy="11" r="1"/></svg></button><button id="zoom-out" aria-label="Zoom out" title="Zoom out (Ctrl −)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"/></svg></button><button id="zoom-level" type="button"><span>Fit</span><svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.5 3l2.5 2.5L6.5 3"/></svg></button><button id="zoom-in" aria-label="Zoom in" title="Zoom in (Ctrl +)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14M12 5v14"/></svg></button><span class="view-sep" aria-hidden="true"></span><button id="hand-tool" aria-label="Hand tool" aria-pressed="false" aria-disabled="false" title="Hand tool: drag to pan (H)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 11V6a2 2 0 0 0-4 0M14 10V4a2 2 0 0 0-4 0v2M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/></svg></button><span id="view-layout" class="view-group" role="group" aria-label="Page layout" hidden><span class="view-sep" aria-hidden="true"></span><button id="view-single" aria-label="Single page" aria-pressed="true" title="Single page"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg></button><button id="view-spread" aria-label="Two pages" aria-pressed="false" title="Two-page spread (Ctrl 3)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/></svg></button></span><span id="view-previews" class="view-group" hidden><span class="view-sep" aria-hidden="true"></span><button id="page-strip-toggle" aria-label="Page previews" aria-pressed="false" title="Page previews (Ctrl 4)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="10" rx="2"/><rect x="3" y="17" width="4.5" height="4" rx="1"/><rect x="9.75" y="17" width="4.5" height="4" rx="1"/><rect x="16.5" y="17" width="4.5" height="4" rx="1"/></svg></button></span>
<span id="view-more-group" class="view-group"><span class="view-sep" aria-hidden="true"></span><button id="view-more" type="button" aria-label="More" aria-haspopup="menu" aria-expanded="false" title="More"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg></button></span></div></main>
  <footer><button id="previous" aria-label="Previous page" title="Previous page (PgUp)" disabled>←</button><button id="position" title="Go to location (Ctrl+G)" disabled>Ready when you are</button><button id="next" aria-label="Next page" title="Next page (PgDn)" disabled>→</button><input id="progress" type="range" aria-label="Document position" title="Click or drag to jump through the document" min="0" max="100" step="1" value="0" disabled></footer>
  </div>
  <dialog id="jump" class="drop" aria-labelledby="jump-label"><form><label id="jump-label" for="target">Location</label><div class="jump-row"><input id="target" required autocomplete="off"><button class="primary" type="submit" aria-label="Go to location">Go</button></div><p id="jump-error" role="alert"></p></form></dialog>
  <dialog id="password"><form><h2>Password required</h2><label for="secret">Document password</label><input id="secret" type="password" autocomplete="off"><div class="dialog-actions"><button type="button" data-close>Cancel</button><button type="submit" class="primary">Open document</button></div></form></dialog>
  <dialog id="contents" class="drop" aria-label="Contents"><div id="outline-list"></div></dialog>
  <dialog id="settings"></dialog>
  <dialog id="shortcuts" aria-labelledby="shortcuts-title" tabindex="-1" autofocus><div class="dialog-head"><h2 id="shortcuts-title">Keyboard shortcuts</h2><button data-close aria-label="Close shortcuts">×</button></div><div id="shortcut-list"></div></dialog>
  <dialog id="delete-data"><h2>Delete saved reading data?</h2><p>This removes saved positions and reading settings. Your documents and recent-file list remain. The current position will be saved again when you navigate.</p><div class="dialog-actions"><button data-close>Cancel</button><button id="confirm-delete" class="danger">Delete reading data</button></div></dialog>
  <input id="file-input" type="file" accept=".pdf,.epub,.md,.markdown,.txt,.png,.jpg,.jpeg,.webp,.gif,.avif,.bmp,.svg" hidden>`;
const windowControls = createWindowControls();
document.querySelector('.toolbar')!.prepend(windowControls);
// The window frame is drawn by the reader on both desktop systems. macOS hides its own traffic lights and the reader
// draws quiet ones at the toolbar's left end (src/window-controls.ts, windows::hide_native_buttons); Windows loses its
// native caption (see windows::restore) and gets minimize, maximize and close buttons at the toolbar's right end.
const platform = !desktop ? undefined : navigator.userAgent.includes('Mac') ? 'mac' : navigator.userAgent.includes('Windows') ? 'windows' : undefined;
if (platform) document.documentElement.classList.add(`${platform}-titlebar`);

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
// The shortcut reference is generated from the command catalog, so it says what the palette says.
$('shortcut-list').replaceChildren(...shortcutReference({ desktop }).map(section => {
  const group = document.createElement('section'), heading = document.createElement('h3'), list = document.createElement('dl');
  heading.textContent = section.title;
  for (const row of section.rows) {
    const term = document.createElement('dt'), keys = document.createElement('dd');
    term.textContent = row.label;
    keys.append(...row.keys.map(key => Object.assign(document.createElement('kbd'), { textContent: key })));
    if (row.note) keys.append(Object.assign(document.createElement('span'), { textContent: row.note }));
    list.append(term, keys);
  }
  group.append(heading, list);
  return group;
}));
// Text settings apply to reflowable documents only; PDF pages, fixed-layout books and images zoom instead.
const settingsSheet = createSettingsSheet($<HTMLDialogElement>('settings'), {
  current: () => { const { reader, active, options } = activePane(); return reader && active && reader.mode !== 'fixed' ? { fontSize: options.fontSize, lineHeight: options.lineHeight, margin: options.margin, wrap: options.wrap, wraps: active.format === 'txt' } : undefined; },
  change: next => changeOptions(next),
}, {
  desktop,
  toggle: which => void toggle(which),
  preset: preset => void command(preset).catch(fail),
  setSide: side => library.setSide(side),
  setControl: enabled => {
    if (!desktop) return;
    void native<{ enabled: boolean; running: boolean; transport: string }>('set_control_enabled', { enabled })
      .then(setControlState)
      .catch(fail);
  },
  more: item => { if (item === 'palette') openPalette(); else void command(item).catch(fail); },
});
// A modal dialog holds back the reader's shortcuts; the two window ones still work in the sheet, so its switches follow them.
$('settings').addEventListener('keydown', event => { const shortcut = shortcutFor(event); if (shortcut === 'pin' || shortcut === 'lock') { event.preventDefault(); void command(shortcut).catch(fail); } });
const scrubber = $<HTMLInputElement>('progress'), footer = scrubber.parentElement!; // The footer carries --scrub-fill: its line is drawn by the footer, not the slider's track.
let scrubbing = false, scrubRequest = 0;
let windowState: WindowState = { width: 420, height: 620, pinned: false, locked: false };
let homeRecents: Recent[] = [];
let homeLibrary: Library = emptyLibrary();
let homeProgress: Record<string, Progress> = {};
let splashHtml: string | undefined;
let homePicture = 0;
const homeThumbs = createThumbnailStore();
const pan = new Panner();
const workspace = $('workspace'), pill = $('view-controls');
/**
 * A side is one pane of the window: its reading state (`pane`), the tabs it holds (`tabs`) and the one it shows (`shown`), and what it is drawn with (`view`).
 * Not split, the window has one side and its tabs are the toolbar's, the Library tab among them. Split, it has two to four (`layout` is the tree they are laid out in, and `sides` is kept in its reading order), each with a row of tabs of its own, and
 * the Library tab and Home (`cover`) belong to the window and take the whole reading area. `focused` is the side that commands, keys, the footer, the find
 * bar and the view controls act on: the last one clicked or focused. `activePane()` is its reading state.
 */
type Side = { pane: Pane<Tab>; tabs: TabList<Tab>; shown: Tab | undefined; scanNoticeShown: boolean; view: SideView; strip: TabStrip };
const sides: Side[] = [];
let focused!: Side;
const activePane = () => focused.pane;
const isSplit = () => sides.length > 1;
/** What the reader tells agents (`hmb events`): while the user has Agent control on, what they select, read and send goes to the local control socket and nowhere else. */
let agentControl = false;
const agentEvents = createAgentEvents(event => void native('control_event', { event }).catch(() => undefined), () => desktop && agentControl);
function setControlState(status: { enabled: boolean; running: boolean } | null) {
  if (status) settingsSheet.showControl(status);
  agentControl = Boolean(status?.enabled);
  if (!agentControl) agentEvents.reset();
}
const selectionOf = (side: Side): SelectionInfo | undefined => {
  const tab = side.shown;
  return tab && side.pane.reader ? selectionInfo({ paneId: side.view.id, path: tab.path, title: tabTitle(tab), where: side.pane.position?.label ?? '' }, paneSelection(side)) : undefined;
};
const liveSelection = () => [focused, ...sides.filter(side => side !== focused)].map(selectionOf).find(info => info !== undefined);
/** The selection Send selection to agent sends: the one on screen, or the last the user made when focus has moved to the palette. */
const sendableSelection = () => liveSelection() ?? agentEvents.lastSelection();
const agentContext = () => ({ enabled: agentControl, selection: Boolean(sendableSelection()), area: Boolean(activePane().reader?.captureArea) });
function observeSelection() {
  if (!agentControl || !focused) return;
  const info = liveSelection();
  // Focus in a dialog (the palette) empties the live selection without the user giving it up; anywhere else an empty one means they did.
  if (!info && !document.activeElement?.closest('dialog')) agentEvents.forgetSelection();
  agentEvents.observeSelection(info);
}
document.addEventListener('selectionchange', observeSelection);
setInterval(observeSelection, 250); // Same-origin EPUB frames report selectionchange to their own document only.
function sendSelection() {
  const info = sendableSelection();
  if (info && agentEvents.send(info)) notify('Sent to agent');
}
/** The overlay the user is dragging a box on, while there is one. */
let areaDrag: AreaDrag | undefined;
/** The most a sent area's PNG may weigh; the native side refuses more. */
const AREA_MAX_BYTES = 8 * 1024 * 1024;
/** Send area to agent: the user drags a box over the shown page or image, and the picture of it and where it is goes to the agent. */
function sendArea() {
  const side = focused, { reader, host } = side.pane, tab = side.shown;
  if (!reader?.captureArea || !host || !tab) return;
  areaDrag?.cancel();
  const drag = startAreaDrag(host, {
    onEnd: () => { if (areaDrag === drag) areaDrag = undefined; },
    onBox: box => void (async () => {
      const capture = await reader.captureArea!(box);
      if (side.shown !== tab || side.pane.reader !== reader) throw new Error('The page changed before the area was sent.');
      if (!agentControl) throw new Error('Turn on Agent control in Settings first');
      if (capture.png.size > AREA_MAX_BYTES) throw new Error('That area is too large to send (over 8 MB). Drag a smaller box.');
      const png = Array.from(new Uint8Array(await capture.png.arrayBuffer()));
      await native('control_area', { png, meta: { paneId: side.view.id, path: tab.path, title: tabTitle(tab), ...(capture.page === undefined ? {} : { page: capture.page }), box: capture.box } });
      notify('Sent area to agent');
    })().catch(fail),
  });
  areaDrag = drag;
}
const tabInfo = (side: Side, tab: Tab): Omit<TabInfo, 'action'> => ({ paneId: side.view.id, path: tab.path, title: tabTitle(tab), format: tab.format, brief: Boolean(tab.brief) });
/** What takes the whole reading area while split: Home, or the Library page. */
let cover: 'home' | 'library' | undefined;
/** While `restoreSplitView` opens the panes: the tabs it opens, and the side the user pressed, focused or selected since (that side keeps the focus). */
let restoring: { tabs: (Tab | undefined)[]; picked?: Side } | undefined;
const pick = (side: Side | undefined) => { if (restoring && side) restoring.picked = side; };
/** The Library tab while split (not split, it is the first tab of the one side). */
let libraryTab: Tab | undefined;
/** How the panes are laid out: a tree of pane ids, the dividers' places in it (`layout.ts`). Not split, it is the one pane. */
let layout: Layout = { pane: 'a' };
/** The dividers drawn, by the path of the split each belongs to, and where `applyLayout` last put them. */
const dividers = new Map<string, HTMLElement>();
/** The sides that are not in the window (a pane that was closed), by id: their row, layer and tab strip are made once and put back on a later split. */
const spares = new Map<string, Side>();
/** The tab of a document (or the Library tab) wherever it is open. */
const known = (path: string): Tab | undefined => { for (const side of sides) { const tab = side.tabs.find(path); if (tab) return tab; } return path === LIBRARY_PATH ? libraryTab : undefined; };
/** The side whose tabs hold `path`. */
const holder = (path: string) => sides.find(side => side.tabs.find(path));
/** The side an event target is in (a reading surface, a row of tabs, or a pane's layer). */
const sideAt = (target: EventTarget | null) => { const id = target instanceof Element ? target.closest<HTMLElement>('[data-pane]')?.dataset.pane : undefined; return sides.find(side => side.view.id === id); };
/** The pane whose area holds the press. `.pane-body` lets the pointer through (only its children take it), and a pane whose document has not mounted yet has no child there: such a press lands on #workspace itself, so the box decides. */
const sideUnder = (event: PointerEvent) => event.target === workspace && !workspace.classList.contains('is-single') ? sides.find(side => { const box = side.view.body.getBoundingClientRect(); return event.clientX >= box.left && event.clientX < box.right && event.clientY >= box.top && event.clientY < box.bottom; }) : undefined;
const carry = { over: (path: string, x: number, y: number) => carryOver(path, x, y), drop: (path: string, x: number, y: number) => carryDrop(path, x, y), clear: () => carryClear() };
/** What a pane's placeholder for a tab with no page is made from (the first pane's own is the page's element, which leaves the page with it). */
const stateTemplate = $('tab-state').cloneNode(true) as HTMLElement;
const persistTab: typeof persist = async (doc, locator, options, progress) => {
  if (isBriefPath(doc.path) || known(doc.path)?.ephemeral) return;
  return persist(doc, locator, options, progress);
};
function makeSide(id: string): Side {
  const parts = createRow(id), body = createBody(id);
  let state: HTMLElement;
  if (id === 'a') { state = $('tab-state'); body.append(state, pill); } else { state = withoutIds(stateTemplate.cloneNode(true) as HTMLElement); state.hidden = true; body.append(state); }
  workspace.append(parts.row, body);
  const tabsRow = createTabStrip({ strip: parts.row, list: parts.list, add: parts.add, overflow: parts.overflow }, { select: path => selectTab(path), close: closeTab, newTab: () => { activateSide(side); openFile(); }, move: (path, to) => { side.tabs.move(path, to); paintTabs(); saveSession(); }, menu: showTabMenu, carry }, platform === 'mac' ? '⌘T' : 'Ctrl T', false);
  parts.fold.onclick = () => showPaneMenu(parts.fold);
  const side: Side = { pane: new Pane<Tab>({ persist: persistTab, notify }), tabs: new TabList<Tab>(), shown: undefined, scanNoticeShown: false, view: { id, body, state, ...parts }, strip: tabsRow };
  state.querySelector<HTMLElement>('.primary')!.onclick = () => stateAction(side);
  state.querySelector<HTMLElement>('.tab-state-actions button:not(.primary)')!.onclick = () => { if (side.shown) closeTab(side.shown.path); };
  return side;
}
sides.push(makeSide('a'));
focused = sides[0];
/**
 * The documents open as tabs. A side's pane (`reader`, `active`, `options`, `position`, `host` and `pannedScroller`) and its `scanNoticeShown` below,
 * are the working copy of the tab that side is showing (`shown`); `leave` takes them back into the tab, `show` loads the next tab's into them.
 * Every other tab holds its own reader and host (live) or only its saved place (hibernated), see `hibernate`.
 */
type Tab = {
  path: string; name: string; format: string;
  doc?: Opened; reader?: ReaderAdapter; host?: HTMLElement;
  options: ReaderOptions; position?: Position; hand: boolean; stripScroll?: number; find?: string; scanNoticeShown: boolean;
  /** Where a hibernated tab picks up again; absent for a tab never opened this session, which takes its saved place from the store. */
  resume?: { locator: Position['locator']; options: ReaderOptions };
  problem?: { kind: 'missing' | 'failed'; message: string };
  /** The Library tab (`path` is `LIBRARY_PATH`, `format` `library`) holds no reader: its `name` is the scope's title and `scope` what it shows, in the form library-scope.ts saves. */
  scope?: string;
  /** True for agent-pushed ephemeral briefs (`hold-my-brief:brief/<id>`) that update in place and stay out of Library/Recents. */
  brief?: boolean;
  /** True when the tab should not be recorded in Library, Recents, or saved sessions. */
  ephemeral?: boolean;
};

function notify(message: string, retry = false) { $('notice').hidden = false; $('notice').querySelector('span')!.textContent = message; $('retry-save').hidden = !retry; }
// A select-drag on a page without text selects nothing. Say why, once, when the user shows that intent:
// primary button, hand tool off, past the same slop a pan uses, on a page marked image-only.
document.addEventListener('pointerdown', down => {
  const target = down.target, pane = activePane();
  if (focused.scanNoticeShown || down.button !== 0 || !down.isPrimary || down.pointerType === 'touch' || pan.hand || !(target instanceof Element)
    || !pane.host?.contains(target) || !target.closest('[data-image-only]') || !pane.reader?.getPosition().imageOnly) return;
  const move = (e: PointerEvent) => {
    if (e.pointerId !== down.pointerId) return;
    if (!(e.buttons & 1)) return end();
    if (Math.hypot(e.clientX - down.clientX, e.clientY - down.clientY) < DRAG_SLOP) return;
    end(); focused.scanNoticeShown = true; notify("This page is a scanned image, so its text can't be selected or searched.");
  };
  const end = () => { for (const type of ['pointermove', 'pointerup', 'pointercancel']) window.removeEventListener(type, move as EventListener, true); };
  window.addEventListener('pointermove', move, true); window.addEventListener('pointerup', end, true); window.addEventListener('pointercancel', end, true);
}, true);
function fail(error: unknown) { notify(error instanceof Error ? error.message : String(error)); }
function updateWindow(next: WindowState) { windowState = next; settingsSheet.showWindow(next); $<HTMLButtonElement>('caption-maximize').disabled = next.locked; }
function showPosition(p: Position, save = true) {
  const pane = activePane();
  pane.position = p;
  const percent = Math.max(0, Math.min(100, p.fraction * 100));
  const label = pane.active?.format === 'epub' && pane.reader?.mode === 'paginated' ? p.label : `${p.label} · ${pane.reader?.mode === 'fixed' ? '' : '≈'}${Math.round(percent)}% position`;
  if (!scrubbing) {
    $('position').textContent = label; $('position').title = `${label} · Go to location (Ctrl+G)`;
    scrubber.min = p.scrub.unit === 'percent' ? '0' : '1';
    scrubber.max = String(p.scrub.total);
    scrubber.step = p.scrub.unit === 'percent' ? '0.1' : '1';
    scrubber.value = String(p.scrub.current);
    scrubber.disabled = Number(scrubber.max) <= Number(scrubber.min);
    updateScrubValue();
  }
  if (save) pane.markDirty();
  const shown = focused.shown;
  if (agentControl) agentEvents.observePosition(!pane.loadingTarget && !cover && shown && shown.path !== LIBRARY_PATH ? { paneId: focused.view.id, path: shown.path, position: p.label, progress: progressFraction(p.fraction) } : undefined);
  updateViewControls();
}
function updateScrubValue(preview = false) {
  const position = activePane().position;
  if (!position) return;
  const value = scrubber.valueAsNumber, min = Number(scrubber.min), max = Number(scrubber.max);
  const cover = position.scrub.cover;
  const label = position.scrub.unit === 'percent' ? `${value.toFixed(1)}% position`
    : cover !== undefined ? pagesLabel(spreadPages(value, max, cover), max)
    : `${position.scrub.unit === 'page' ? 'Page' : 'Line'} ${value} of ${max}`;
  footer.style.setProperty('--scrub-fill', `${max > min ? (value - min) / (max - min) * 100 : 0}%`);
  scrubber.setAttribute('aria-valuenow', String(value));
  scrubber.setAttribute('aria-valuetext', label);
  if (preview) $('position').textContent = `${label} · release to jump`;
}
/** The level `pane`'s document is drawn at; before it is drawn, 100 %. */
const zoomLevel = (pane: Pane<Tab> = activePane()) => { const { reader, options } = pane; return reader?.zoomLevel?.() ?? (options.fitted ? 1 : options.zoom); };
const zoomLimits = (pane: Pane<Tab> = activePane()) => pane.reader?.zoomLimits?.() ?? DEFAULT_LIMITS;
/** Writes `pane`'s zoom level, its tooltip and its step buttons into `root`: the live view controls, or the still copy that belongs to a pane that is not the focused one. */
function paintZoom(pane: Pane<Tab>, root: ParentNode) {
  const part = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}, [data-was=${id}]`);
  const { options } = pane, fitted = options.fitted, width = options.fit === 'width', current = zoomLevel(pane), level = `${zoomPercent(current)}%`;
  // The level opens the zoom menu; double-clicking it still toggles fit page/fit width (while zoomed it first returns to the current fit).
  const next = fitted && !width ? 'fit-width' : fitted ? 'fit-page' : `fit-${options.fit}`;
  const levelButton = part('zoom-level'), limits = zoomLimits(pane), canZoomOut = stepZoom(current, -1, limits) < current - .004, canZoomIn = stepZoom(current, 1, limits) > current + .004;
  if (levelButton) {
    levelButton.querySelector('span')!.textContent = level; levelButton.dataset.next = next; levelButton.dataset.fit = fitted ? options.fit : '';
    levelButton.setAttribute('aria-label', `Zoom menu, ${level}${fitted ? `, ${width ? 'fit width' : 'fit page'}` : ''}`);
    levelButton.title = `${fitted ? `${width ? 'Fit width' : 'Fit page'} · ${level}` : `Zoom ${level}`} · click for zoom options · double-click for ${next === 'fit-width' ? 'fit width (Ctrl 2)' : 'fit page (Ctrl 0)'}`;
  }
  const out = part<HTMLButtonElement>('zoom-out'), into = part<HTMLButtonElement>('zoom-in');
  if (out) out.disabled = !canZoomOut;
  if (into) into.disabled = !canZoomIn;
  return { current, limits, canZoomIn, canZoomOut };
}
/** Whether the document reflows (reflowable EPUB, Markdown, TXT), so its pill holds the reading controls rather than the zoom ones. */
const isReflowable = (format: Format, mode: ReaderAdapter['mode']) => format === 'md' || format === 'txt' || format === 'epub' && mode !== 'fixed';
/** Syncs the view-controls pill, page-layout toggles and the title subtitle with the current position, zoom, layout and hand-tool state. */
function updateViewControls() {
  const pane = activePane(), { reader, active, options, position } = pane;
  if (!reader || !active) return;
  syncPageStrip();
  // Fixed-layout EPUB rebuilds its renderer when the page layout changes; follow it.
  const scroller = reader.scroller?.();
  if (scroller !== pane.pannedScroller) { pane.pannedScroller = scroller; pan.attach(scroller, pane.host); }
  pan.refresh(position?.spread, options.fitted);
  // The level is always the real scale; a fit is a mode that follows the window, and the adapter says what scale it came to.
  const fitted = options.fitted, width = options.fit === 'width', current = zoomLevel();
  const level = `${zoomPercent(current)}%`;
  const layout = position?.spread, waiting = layout === 'waiting' ? `Two pages appear when the reading area is at least ${MIN_SPREAD_WIDTH} px wide` : '';
  const kind = reader.mode === 'fixed' && fitted && !width && layout === 'active' ? 'Two-page view'
    : `${reader.mode !== 'fixed' ? (reader.mode === 'paginated' && reader.flow?.() !== 'scrolled' ? 'Reading view' : 'Scroll view') : fitted ? (width ? 'Fit width' : 'Page view') : level}${layout === 'active' ? ' · Two pages' : ''}`;
  // The subtitle says where you are, compactly ("48 / 146", without a PDF's printed page number);
  // the full position and the kind of view are in its tooltip.
  const where = position?.label ?? '';
  // An image-only page is announced here, never drawn over the page. Find reports the same limit.
  const imageOnly = position?.imageOnly ? "Image-only page: text can't be selected or searched" : '';
  $('filekind').textContent = where.replace(/^(?:Pages?|Line) ([\d–-]+) of (\d+)(?: · .*)?$/, '$1 / $2');
  paintTabs();
  $('filekind').title = [where, `${active.format.toUpperCase()} · ${kind}${pan.hand ? ' · Hand' : ''}`, imageOnly, waiting].filter(Boolean).join('\n');
  const spreads = !!reader.spreads, spread = spreads && options.spread;
  const viewSpread = $<HTMLButtonElement>('view-spread');
  viewSpread.setAttribute('aria-pressed', String(spread));
  if (waiting) viewSpread.setAttribute('aria-description', waiting); else viewSpread.removeAttribute('aria-description');
  viewSpread.title = waiting ? `Two-page spread (Ctrl 3) · ${waiting}` : 'Two-page spread (Ctrl 3)';
  $('view-single').setAttribute('aria-pressed', String(!spread));
  $('view-layout').hidden = !spreads;
  // Page previews are a PDF feature: the toggle is offered only where the adapter has them, and says why when a short panel hides the strip.
  const previewable = Boolean(reader.setPreviews), hidden = previewable && stripWanted && focused.view.body.clientHeight < MIN_PANEL_HEIGHT ? `Hidden while the reading area is shorter than ${MIN_PANEL_HEIGHT} px` : '';
  $('view-previews').hidden = !previewable;
  $('page-strip-toggle').setAttribute('aria-pressed', String(stripWanted));
  $('page-strip-toggle').title = hidden ? `Page previews (Ctrl 4) · ${hidden}` : 'Page previews (Ctrl 4)';
  if (hidden) $('page-strip-toggle').setAttribute('aria-description', hidden); else $('page-strip-toggle').removeAttribute('aria-description');
  // Reflowable text (EPUB, Markdown, TXT) has no page to zoom or pan: its pill holds the reading controls instead.
  const reflowable = isReflowable(active.format, reader.mode);
  $('view-controls').classList.toggle('is-reading', reflowable);
  $('view-controls').hidden = !pan.pannable && !reflowable;
  if (reflowable) readingControls.update({ flow: active.format === 'epub' ? reader.flow?.() ?? 'paginated' : undefined, hasContents: reader.outline().length > 0, fontSize: options.fontSize });
  if (pill.hidden) moreMenu.close(false);
  if (!pan.pannable) { zoomMenu.close(); return; }
  const { limits, canZoomIn, canZoomOut } = paintZoom(pane, pill);
  zoomMenu.update({ level: current, fit: fitted ? options.fit : undefined, limits, canZoomIn, canZoomOut });
  // The hand tool is always available while the pill is shown: it scrolls an overflowing page and slides a fitting one.
  $('hand-tool').setAttribute('aria-pressed', String(pan.hand));
}
function toggleHand() { pan.setHand(!pan.hand); updateViewControls(); }
// Keep keyboard focus on the page: clicking a pill button must not strand arrow/PgDn keys on it.
$('view-controls').addEventListener('mousedown', event => event.preventDefault());
$('zoom-out').onclick = () => void action('smaller').catch(fail);
$('zoom-in').onclick = () => void action('larger').catch(fail);
$('zoom-level').ondblclick = () => void action($('zoom-level').dataset.next ?? 'fit-page').catch(fail);
// The level is a menu button: it offers the zoom commands, a field to type a percentage into, and presets.
const zoomMenu = createZoomMenu($<HTMLButtonElement>('zoom-level'), choice => void (choice.kind === 'command' ? action(choice.id) : changeOptions({ fitted: false, zoom: choice.zoom })).catch(fail));
$('hand-tool').onclick = toggleHand;
const readingControls = createReadingControls({
  contents: () => void command('outline').catch(fail),
  flow: flow => void changeOptions({ flow }).catch(fail),
  size: direction => void action(direction > 0 ? 'larger' : 'smaller').catch(fail),
});
$('view-grip').after(readingControls.element);
$('view-single').onclick = () => void changeOptions({ spread: false });
$('view-spread').onclick = () => void changeOptions({ spread: true });
$('page-strip-toggle').onclick = () => void command('page-strip').catch(fail);
// The More button holds the open document's own actions: Go to, Contents, Back after jump and, where the document has pages, the page commands. A choice puts
// focus back where the press came from (the page after a pointer press, as the zoom menu does, the button after a key); Escape and an outside press close it.
const moreMenu = createContextMenu({ className: 'pill-menu', label: 'More' }), moreButton = $('view-more');
const closePillMenus = () => { zoomMenu.close(); moreMenu.close(false); };
let moreByPointer = false;
function documentActions(): MenuEntry[] {
  const { reader, active, options } = activePane();
  if (!reader || !active) return [];
  const fixed = reader.mode === 'fixed', spreads = !!reader.spreads, spread = spreads && options.spread;
  const entry = (label: string, id: string, extra: Partial<MenuEntry> = {}): MenuEntry => ({ label, run: () => { (moreByPointer ? activePane().host : moreButton)?.focus(); void command(id).catch(fail); }, ...extra });
  return [
    entry('Go to…', 'goto', { keys: 'Ctrl G' }),
    // A reflowable document's pill has its own Contents button.
    ...(reader.outline().length && !isReflowable(active.format, reader.mode) ? [entry('Contents', 'outline')] : []),
    entry('Back after jump', 'back', { keys: 'Alt ←' }),
    ...(fixed ? [entry('Rotate page 90°', 'rotate')] : []),
    ...(spreads ? [entry('Two-page spread', 'spread', { keys: 'Ctrl 3', checked: spread })] : []),
    ...(spreads && fixed ? [entry('Cover page alone', 'cover', { checked: options.cover, unavailable: spread ? undefined : 'Turn on Two-page spread first' })] : []),
  ];
}
moreButton.onclick = event => { moreByPointer = event.detail > 0; moreMenu.show(documentActions(), moreButton); };
// A press anywhere else closes the menu; focus stays where the press put it, unless that is nowhere: then it goes to the button.
document.addEventListener('pointerdown', event => {
  if (!moreMenu.isOpen() || !(event.target instanceof Node) || moreMenu.element.contains(event.target) || moreButton.contains(event.target)) return;
  setTimeout(() => { if (!document.activeElement || document.activeElement === document.body) moreButton.focus(); });
}, true);
// Movable pill: the grip drags it anywhere in the reading panel. Without a stored position the CSS
// placement stands untouched; with one, inline left/top (kept as centre fractions of the panel so a
// resize keeps it proportional) win, clamped inside the panel and clear of an open library drawer.
const pillKey = 'hold-my-brief:view-controls', grip = $('view-grip');
try { activePane().pillPlacement = parsePlacement(localStorage.getItem(pillKey)); } catch { /* Optional preference. */ }
const pillPanel = () => ({ width: focused.view.body.clientWidth, height: focused.view.body.clientHeight });
const pillBox = () => ({ width: pill.offsetWidth, height: pill.offsetHeight });
/**
 * How much of the panel's bottom the pill keeps above: the page-preview strip and the footer lane under it, or the image-navigation
 * pill and the footer lane under that (an image document has the second, a PDF the first, never both).
 */
const pillStrip = () => {
  const body = focused.view.body, bottom = body.getBoundingClientRect().bottom;
  const covered = (element: Element | null) => element ? Math.max(0, bottom - element.getBoundingClientRect().top) : 0;
  return Math.max(body.classList.contains('has-page-strip') ? covered(pageStrip.element) : 0, workspace.classList.contains('has-image-navigation') ? covered(workspace.querySelector('.library-image-navigation')) : 0);
};
function drawerBand() {
  // The compact sheet covers the whole layout over a scrim; only the docked panel, and the icon rail it stands beside, are steered around.
  if (matchMedia('(max-width: 719px)').matches) return null;
  const boxes = [$('library-rail').getBoundingClientRect(), ...($('reader-layout').classList.contains('library-open') ? [$('library-root').getBoundingClientRect()] : [])], panel = focused.view.body.getBoundingClientRect();
  return { left: Math.min(...boxes.map(box => box.left)) - panel.left - focused.view.body.clientLeft, right: Math.max(...boxes.map(box => box.right)) - panel.left - focused.view.body.clientLeft };
}
function showPill(point: Point | null) {
  const values = point ? [`${point.left}px`, `${point.top}px`, 'auto', 'auto', 'none'] : ['', '', '', '', ''];
  ['left', 'top', 'right', 'bottom', 'translate'].forEach((name, index) => pill.style.setProperty(name, values[index]));
}
function placePill() {
  const placement = activePane().pillPlacement;
  if (!placement) return showPill(null);
  const size = pillBox();
  if (size.width) showPill(resolvePlacement(placement, pillPanel(), size, drawerBand(), pillStrip())); // A hidden pill has no size to place.
}
/** Moves the pill to the clamped, drawer-clear form of `point` and remembers what is actually on screen. */
function movePill(point: Point, save: boolean) {
  const panel = pillPanel(), size = pillBox(), resolved = resolvePlacement(placementOf(point, panel, size), panel, size, drawerBand(), pillStrip());
  const pane = activePane();
  pane.pillPlacement = placementOf(resolved, panel, size); showPill(resolved);
  if (save) try { localStorage.setItem(pillKey, serialisePlacement(pane.pillPlacement)); } catch { /* Optional preference. */ }
}
function resetPill() { activePane().pillPlacement = null; showPill(null); try { localStorage.removeItem(pillKey); } catch { /* Optional preference. */ } }
/** The pill's rendered top-left in panel pixels, wherever the CSS or a stored position put it. */
function pillPoint(): Point {
  const box = pill.getBoundingClientRect(), panel = focused.view.body.getBoundingClientRect();
  return { left: box.left - panel.left - focused.view.body.clientLeft, top: box.top - panel.top - focused.view.body.clientTop };
}
let pillDrag: { x: number; y: number; from: Point; moved: boolean } | null = null;
const endPillDrag = () => { if (pillDrag?.moved) movePill(pillPoint(), true); pillDrag = null; };
grip.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  grip.setPointerCapture(event.pointerId); pillDrag = { x: event.clientX, y: event.clientY, from: pillPoint(), moved: false };
});
grip.addEventListener('pointermove', event => {
  if (!pillDrag) return;
  const dx = event.clientX - pillDrag.x, dy = event.clientY - pillDrag.y;
  if (!pillDrag.moved && Math.hypot(dx, dy) < 3) return; // A click or double-click is not a move.
  pillDrag.moved = true; movePill({ left: pillDrag.from.left + dx, top: pillDrag.from.top + dy }, false);
});
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) grip.addEventListener(type, endPillDrag);
grip.addEventListener('dblclick', resetPill);
grip.addEventListener('keydown', event => {
  if (event.ctrlKey || event.altKey || event.metaKey) return;
  const nudge = nudgeFor(event.key, event.shiftKey);
  if (event.key === 'Home' || event.key === 'Enter') { event.preventDefault(); resetPill(); }
  else if (nudge) { event.preventDefault(); const at = pillPoint(); movePill({ left: at.left + nudge.dx, top: at.top + nudge.dy }, true); }
});
let viewFrame = 0;
const viewChanged = () => { cancelAnimationFrame(viewFrame); viewFrame = requestAnimationFrame(() => { applyLayout(); updateViewControls(); placePill(); }); };
// The panel, the pill itself (shown, or resized by the layout toggle) and the library drawer all change where it may sit.
const viewObserver = new ResizeObserver(viewChanged);
for (const element of [workspace, pill, $('library-root')]) viewObserver.observe(element);
new MutationObserver(viewChanged).observe($('reader-layout'), { attributes: true, attributeFilter: ['class'] });
new MutationObserver(viewChanged).observe(workspace, { attributes: true, attributeFilter: ['class'] }); // The image navigation appearing or going takes or gives back the pill's lane.
/** A pane's layer changes size when the panes are laid out, and its class when it takes or gives up the page strip. */
const watchSide = (side: Side) => { viewObserver.observe(side.view.body); new MutationObserver(viewChanged).observe(side.view.body, { attributes: true, attributeFilter: ['class'] }); };
sides.forEach(watchSide);
// Page previews (PDF): a filmstrip of the document in a fixed band under the reading surface. The preference is global and
// off until chosen; the band is shown only for a document that has previews and a panel tall enough to spare
// it. It is room the reading surface leaves (CSS, `has-page-strip`), not a row in the page's flow, so turning
// a page never resizes what the page was fitted to.
const stripKey = 'hold-my-brief:page-strip', pageStrip = createPageStrip(fail);
let stripWanted = false;
try { stripWanted = localStorage.getItem(stripKey) === 'on'; } catch { /* Optional preference. */ }
focused.view.body.append(pageStrip.element);
/** Reserves or releases the strip's room for the document `adapter` shows; true when the strip is shown. */
function stripSpace(adapter: ReaderAdapter | undefined) {
  // Measured on the panel, which the strip never resizes, so showing the strip cannot hide it again.
  const shown = Boolean(adapter?.setPreviews) && stripWanted && focused.view.body.clientHeight >= MIN_PANEL_HEIGHT;
  if (focused.view.body.classList.contains('has-page-strip') !== shown) {
    focused.view.body.classList.toggle('has-page-strip', shown); pageStrip.element.hidden = !shown;
    placePill();
  }
  return shown;
}
/** Points the strip at the open document while it is shown, and away from it otherwise. */
function syncPageStrip() {
  const pane = activePane(), feeder = stripSpace(pane.reader) ? pane.reader : undefined;
  if (feeder === pane.stripReader) return;
  pane.stripReader?.setPreviews?.(undefined); pageStrip.clear();
  pane.stripReader = feeder; feeder?.setPreviews?.(pageStrip.sink);
}
// Hovering or dragging the progress bar previews the page under the pointer (PDF only: the other formats have no pages to draw).
createProgressPreview(scrubber, $('app'), () => { const { reader, position } = activePane(); return reader?.thumbnails && position?.scrub.unit === 'page'
  ? { source: reader.thumbnails, spread: position.spread === 'active', cover: position.scrub.cover !== false, total: position.scrub.total } : undefined; });
scrubber.oninput = () => { scrubbing = true; ++scrubRequest; updateScrubValue(true); };
scrubber.onchange = () => {
  const pane = activePane(), { position } = pane;
  if (!pane.reader || !position) return;
  const current = pane.reader, token = ++scrubRequest, value = scrubber.value;
  const unit = position.scrub.unit;
  scrubbing = true;
  const jump = unit !== 'page' && value === scrubber.max ? current.navigate('end')
    : current.goTo(unit === 'percent' ? `${value}%` : value);
  void jump.catch(error => { if (pane.reader === current) fail(error); }).finally(() => {
    if (pane.reader !== current || token !== scrubRequest) return;
    scrubbing = false; showPosition(current.getPosition());
  });
};
scrubber.onpointercancel = () => {
  ++scrubRequest; scrubbing = false;
  const { reader } = activePane();
  if (reader) showPosition(reader.getPosition());
};
setInterval(() => { for (const side of sides) if (side.pane.dirty) void side.pane.flush(); }, 1500);
// Go to and Contents drop from the toolbar under the title, like the palette, instead of centring on a
// dimmed page; a click outside closes them.
/** `anchor` stands a popover on that box, above it where there is room and below it where there is not; without one it drops from the toolbar. */
function showDialog(id: string, anchor?: DOMRect) {
  const dialog = $(id);
  if (!(dialog instanceof HTMLDialogElement)) return;
  if (dialog.classList.contains('drop')) {
    const title = ($('tab-strip').offsetParent ? $('tab-strip') : $('title')).getBoundingClientRect(), width = Math.min(320, innerWidth - 12);
    const left = anchor?.left ?? title.left;
    dialog.style.left = `${Math.round(Math.max(6, Math.min(left, innerWidth - width - 6)))}px`;
    if (anchor && anchor.top >= 160) {
      dialog.style.top = 'auto'; dialog.style.bottom = `${Math.round(innerHeight - anchor.top + 6)}px`; dialog.style.maxHeight = `${Math.round(anchor.top - 6 - 8)}px`;
    } else if (anchor) {
      dialog.style.top = `${Math.round(anchor.bottom + 6)}px`; dialog.style.bottom = 'auto'; dialog.style.maxHeight = `${Math.round(innerHeight - anchor.bottom - 6 - 8)}px`;
    } else {
      dialog.style.top = `${Math.round($('title').closest('header')!.getBoundingClientRect().bottom + 4)}px`; dialog.style.bottom = 'auto'; dialog.style.maxHeight = '';
    }
  }
  dialog.showModal();
  // A dialog marked autofocus (a reference with nothing to fill in) takes focus itself rather than
  // ringing its close button; not every engine honours the attribute on <dialog>.
  if (dialog.hasAttribute('autofocus')) dialog.focus();
}
function closeDialog(dialog: HTMLDialogElement) { dialog.close(); activePane().host?.focus(); }
document.querySelectorAll<HTMLDialogElement>('dialog').forEach(dialog => { dialog.addEventListener('close', () => { activePane().host?.focus(); }); });
document.querySelectorAll<HTMLElement>('[data-close]').forEach(button => button.onclick = () => closeDialog(button.closest('dialog')!));
document.querySelectorAll<HTMLDialogElement>('dialog.drop').forEach(dialog => dialog.addEventListener('click', event => {
  const box = dialog.getBoundingClientRect();
  if (event.target === dialog && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom)) closeDialog(dialog);
}));
// The icon rail is the library's door at 720 px and up (the toolbar button is for compact windows).
const rail = createIconRail($('library-rail'), {
  home: () => selectTab(undefined),
  view: view => library.showView(view),
  add: anchor => library.openAddMenu(anchor),
  settings: () => settingsSheet.open(),
  moveSide: () => library.setSide(library.side() === 'left' ? 'right' : 'left'),
});
const library = createLibrary($('library-root'), {
  open: path => openPath(path),
  replace: path => stepImage(path),
  error: fail,
  openBackground: doc => openInBackground(doc),
  openSplit: (doc, axis) => openInSplit(doc, axis),
  splitReason: (doc, axis) => openSplitReason(doc.path, axis),
  changed: (next, progress) => { homeLibrary = next; homeProgress = { ...progress }; if ($('empty').classList.contains('is-home')) paintHome(); },
  progressChanged: progress => { homeProgress = { ...progress }; if ($('empty').classList.contains('is-home')) paintHome(); },
  settle: () => activePane().flush(),
  sideChanged: showSide,
  openChanged: open => rail.setOpen(open),
  door: () => rail.button('library'),
  openPage: place => openLibraryTab(place),
  pageChanged: place => retargetLibraryTab(place),
});
$('library-toggle').onclick = () => library.toggle();
showSide(library.side());
/** The side is one preference: the rail's tooltips and context menu, and Settings › Library, follow it. */
function showSide(side: 'left' | 'right') { rail.setSide(side); settingsSheet.showSide(side); }
const knownTitle = (item: { path: string; format: string }) => item.format.toLowerCase() === 'epub' ? homeThumbs.epub(item.path)?.title?.trim() || undefined : undefined;

/**
 * The palette is mounted after the actions it dispatches, since `run` closes over `action`
 * and `library`. It shares the dispatcher with the menu rather than reimplementing commands.
 */
let palette: ReturnType<typeof createPalette> | undefined;
function openPalette() {
  if (!palette) {
    // Created on first use, and appended after the static dialogs, so the shared close handler
    // above (which focuses the reading surface) never attaches to it; the palette owns its focus.
    palette = createPalette({
      hasDocument: () => Boolean(activePane().reader), format: () => activePane().active?.format, desktop, split: splitContext, agent: agentContext, run: id => command(id),
      goTo: target => { const current = activePane().reader; return current?.goTo(target).then(() => activePane().host?.focus(), error => { if (activePane().reader === current) fail(error); }); },
      find: text => findBar.open(text),
      assistant,
    });
    document.body.append(palette.element);
  }
  palette.open();
}

/**
 * The find bar sits above the reading panel. It asks the current adapter to search and
 * reveal; adapters without a text layer (images) report that instead of searching.
 */
const findBar = createFindBar({
  target: () => activePane().reader,
  formatIsImage: () => { const { active } = activePane(); return Boolean(active && Object.hasOwn(imageFormats, active.format)); },
  onError: fail,
});
// Inside the reading panel, so it pushes the document down rather than covering it.
focused.view.body.prepend(findBar.element);

/**
 * The opt-in assistant (desktop only, off until the user saves an Anthropic key). It reaches the
 * reader only through these functions, the same paths the palette, menu and keyboard use.
 */
const assistant = createAssistantPanel($('reader-layout'), {
  desktop, openExternal,
  returnFocus: () => activePane().host?.focus(),
  env: {
    hasDocument: () => Boolean(activePane().reader),
    snapshot: () => { const { active, reader } = activePane(); return {
      document: active && reader ? { name: active.name, format: active.format, position: reader.getPosition().label, view: $('filekind').title } : null,
      window: desktop ? { pinned: windowState.pinned, sizeLocked: windowState.locked } : 'browser preview',
      appearance: appearanceSummary(),
      libraryOpen: $('library-toggle').getAttribute('aria-expanded') === 'true',
    }; },
    goTo: async target => { const current = activePane().reader!; await current.goTo(target); return current.getPosition().label; },
    readText: async limit => activePane().reader?.readText?.(limit),
    search: async (query, options) => activePane().reader?.search?.(query, options),
    showMatch: async hit => { const current = activePane().reader!; await current.revealSearchMatch?.(hit); return current.getPosition().label; },
    outline: () => activePane().reader?.outline() ?? [],
    library: async () => (await getLibrary()).documents,
    filterLibrary: change => library.filter(change),
    colourNames: library.colourNames,
    open: doc => openPath(doc.path, doc.name),
    setAppearance: change => {
      const kept = appearance();
      saveAppearance({
        ...kept,
        mode: (['system', 'light', 'dark'] as const satisfies readonly AppearanceMode[]).find(mode => mode === change.mode) ?? kept.mode,
        palette: allPalettes.find(palette => palette === change.theme) ?? kept.palette,
        page: pageTones.find(tone => tone === change.page) ?? kept.page,
      });
      return appearanceSummary();
    },
    runCommand: async id => {
      const entry = COMMANDS.find(candidate => candidate.id === id)!;
      if (id === 'send-to-agent' || id === 'send-area-to-agent') throw new Error(id === 'send-area-to-agent' ? 'Only the user can send an area.' : 'Only the user can send a selection.');
      const reason = unavailableReason(entry, { hasDocument: Boolean(activePane().reader), desktop, format: activePane().active?.format });
      if (reason) throw new Error(reason);
      const before = { pinned: windowState.pinned, locked: windowState.locked };
      await command(id);
      // toggle() reports its own failures in the notice; the assistant must not claim a change that did not happen.
      if ((id === 'pin' && windowState.pinned === before.pinned) || (id === 'lock' && windowState.locked === before.locked)) throw new Error(`Could not change ${id === 'pin' ? 'the pin' : 'the size lock'}.`);
      return id === 'pin' ? (windowState.pinned ? 'Pinned on top' : 'Unpinned') : id === 'lock' ? (windowState.locked ? 'Size locked' : 'Size unlocked') : entry.label;
    },
  },
});

/** Runs a command by catalog id. Every entry point (palette, menu, keyboard) goes through here. */
async function command(id: string) {
  // The catalog's declared requirements are enforced here rather than by each caller, so the
  // keyboard, the menu and the palette cannot drift into different behaviour.
  const entry = COMMANDS.find(candidate => candidate.id === id);
  const reason = entry && unavailableReason(entry, { hasDocument: Boolean(activePane().reader), desktop, format: activePane().active?.format, split: splitContext(), agent: agentContext() });
  if (reason) { notify(reason); return; }
  if (id === 'open' || id === 'new-tab') openFile();
  else if (id === 'close-tab') { const tab = closableTab(); if (tab) closeTab(tab.path); }
  else if (id === 'next-tab' || id === 'previous-tab') { const next = focused.tabs.neighbour(id === 'next-tab' ? 1 : -1); if (next) selectTab(next.path); }
  else if (id === 'split-right') splitTab('right');
  else if (id === 'split-down') splitTab('down');
  else if (id === 'move-tab-side') moveTab();
  else if (id === 'close-pane') closePane();
  else if (id === 'close-split') endSplit();
  else if (id === 'library') library.toggle();
  else if (id === 'library-search') library.showView('search');
  else if (id === 'library-board') openLibraryTab();
  else if (id === 'library-side') library.setSide(library.side() === 'left' ? 'right' : 'left');
  else if (id === 'find') findBar.open();
  else if (id === 'assistant') assistant.openSettings();
  else if (id === 'send-to-agent') sendSelection();
  else if (id === 'send-area-to-agent') sendArea();
  else await action(id);
}

async function password(): Promise<string | null> {
  const dialog = $<HTMLDialogElement>('password'), form = dialog.querySelector('form')!, input = $<HTMLInputElement>('secret'); input.value = '';
  return new Promise(resolve => {
    let result: string | null = null;
    form.onsubmit = event => { event.preventDefault(); result = input.value; dialog.close(); };
    dialog.addEventListener('close', () => { input.value = ''; resolve(result); }, { once: true });
    dialog.showModal(); input.focus();
  });
}
async function adapter(format: string): Promise<ReaderAdapter> {
  if (format === 'pdf') return new (await import('./adapters/pdf')).PdfAdapter();
  if (format === 'epub') return new (await import('./adapters/epub')).EpubAdapter();
  if (Object.hasOwn(imageFormats, format)) return new ImageAdapter();
  return new (await import('./adapters/text')).TextAdapter();
}
/**
 * Opens a document into a tab: a new one at `at` (the end by default), or `target`, a tab that is showing but holds nothing yet
 * (restored, hibernated, or one whose open failed). A document that is already open in a live tab is only shown. The page is built
 * off screen first and swapped in only once it is ready, so a slow or cancelled open leaves every other tab exactly as it was.
 * With `replace`, the document takes the place of that showing tab, in the same slot, and the tab it replaces is closed the way closing it would
 * (its place and view are saved first); when that tab is no longer showing by then, the document opens as a new tab at `at`.
 */
async function load(open: () => Promise<Opened | null>, label = 'document', { target, at, replace, ephemeral, brief, reload }: { target?: Tab; at?: number; replace?: Tab; ephemeral?: boolean; brief?: boolean; reload?: boolean } = {}): Promise<boolean> {
  const side = focused, pane = side.pane, token = pane.beginLoad(target);
  paintTabState();
  if (!reload) { $('loading').hidden = false; $('loading').querySelector('span')!.textContent = `Opening ${label}…`; }
  let candidate: ReaderAdapter | undefined, staging: HTMLElement | undefined, opening = true;
  const urls: string[] = [];
  pane.cancelPending = () => { candidate?.destroy(); staging?.remove(); for (const url of urls) URL.revokeObjectURL(url); };
  try {
    await pane.flush(); const doc = await open(); if (!doc || !pane.isCurrent(token)) return false;
    opening = false;
    // A dialog or a CLI request only now says which document it is: if it is already open, that tab is the one to fill or show.
    const existing = target ?? known(doc.path);
    const tab: Tab = existing ?? { path: doc.path, name: doc.name, format: doc.format, options: { ...defaultOptions }, hand: false, scanNoticeShown: false, ...(brief ? { brief: true } : {}), ...(ephemeral || brief ? { ephemeral: true } : {}) };
    if (brief) { tab.brief = true; tab.ephemeral = true; }
    else if (ephemeral) tab.ephemeral = true;
    if (!reload && (tab.reader || (holder(tab.path) && holder(tab.path) !== side))) { doc.bytes = new Uint8Array(); selectTab(tab.path); if (!tab.ephemeral) void touch(tab); return true; }
    const reloadSide = reload ? holder(tab.path) ?? side : side;
    const prevLocator = reload && tab.reader ? (() => { try { return tab.reader!.getPosition().locator; } catch { return tab.position?.locator; } })() : undefined;
    const prevOptions = reload && tab.reader ? { ...tab.options } : undefined;
    if (prevLocator && prevOptions) doc.previousState = { locator: prevLocator, options: prevOptions };
    else if (tab.resume) doc.previousState = { locator: tab.resume.locator, options: tab.resume.options };
    if (!reload) $('loading').querySelector('span')!.textContent = `Opening ${doc.name}…`;
    candidate = await adapter(doc.format); if (!pane.isCurrent(token)) return false;
    stripSpace(candidate); // A page-preview strip's room is there before the document is fitted, so opening never refits it.
    staging = document.createElement('section'); staging.className = 'reader-host staging'; staging.tabIndex = 0; staging.setAttribute('aria-label', 'Reading surface'); staging.dataset.pane = reloadSide.view.id; workspace.insertBefore(staging, sides[0].view.row); if (isSplit()) applyLayout();
    // Options saved before zoom was a true scale hold a multiplier of the fit. They open fitted and are converted below, once the document is drawn, so the page keeps its size; saving then writes the new form.
    const saved = doc.previousState?.options, legacy = Boolean(saved) && saved!.zoomModel !== ZOOM_MODEL, legacyZoom = Number(saved?.zoom);
    const prefs: ReaderOptions = { ...defaultOptions, ...saved, zoomModel: ZOOM_MODEL, ...(legacy ? { fitted: true, zoom: 1 } : {}) };
    const current = candidate;
    await candidate.open({ ...doc, bytes: doc.bytes }, staging, {
      // The tab showing hears its reader fully; a live tab out of sight only keeps the place.
      // The tab may have crossed to the other side since it opened: the side that holds it now is the one that hears its reader.
      onPosition: p => {
        const owner = holder(tab.path) ?? reloadSide;
        if (owner.pane.reader === current) { if (owner === focused) showPosition(p); else { owner.pane.position = p; owner.pane.markDirty(); paintTabs(); refreshGhost(owner); } }
        else if (tab.reader === current) tab.position = p;
      }, onError: fail, openExternal, requestPassword: password, onFrame: doc => { pan.watchFrame(doc); watchFrameZoom(doc); doc.addEventListener('pointerdown', () => { const owner = holder(tab.path); if (owner && isSplit()) { pick(owner); activateSide(owner); } }, true); },
      resolveImage: desktop ? async relative => { const result = await native<{bytes: number[]; mime: string}>('read_relative_image', { path: doc.path, relative }); const url = URL.createObjectURL(new Blob([new Uint8Array(result.bytes)], { type: result.mime })); urls.push(url); return url; } : undefined,
    }, prefs);
    // A reflowable book opens in the flow the reader last chose; with none saved the adapter picked one from the book, and it is kept from here on.
    const flow = candidate.flow?.();
    if (flow) prefs.flow = flow;
    if (doc.previousState?.locator) await candidate.restore(doc.previousState.locator).catch(() => undefined);
    if (legacy && candidate.mode === 'fixed') {
      const converted = migrateLegacyZoom({ fit: prefs.fit, zoom: legacyZoom }, candidate.legacyZoomBase?.(prefs.fit), candidate.zoomLimits?.());
      if (!converted.fitted) { Object.assign(prefs, converted); await candidate.setOptions(prefs); }
    }
    if (!pane.isCurrent(token)) return false;
    if (!tab.ephemeral) {
      await confirmDocument(doc).catch(error => notify(`Your library could not be saved. Reading is still available. ${error instanceof Error ? error.message : String(error)}`));
    }
    await pane.flush();
    if (!pane.isCurrent(token)) return false;
    doc.bytes = new Uint8Array();
    if (reload && tab.reader) {
      tab.reader.destroy(); tab.host?.remove();
    }
    // A split being restored does not let a document that finishes opening take the focus from the pane the user pressed meanwhile, and nor does a tab reopening in its own pane
    // (a split, a move or a closed pane left it showing a tab that had gone to sleep) while the focus has gone to another pane.
    const away = target && focused !== reloadSide ? focused : undefined;
    const held = (restoring?.tabs.includes(target) ? restoring.picked : undefined) ?? away, keep = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : undefined;
    if (focused !== reloadSide) activateSide(reloadSide); // The reader asked for another side while this one opened: the document goes where it was asked for.
    const swapping = replace && !reloadSide.tabs.find(tab.path) && reloadSide.shown === replace && reloadSide.tabs.find(replace.path) === replace ? replace : undefined;
    Object.assign(tab, { name: doc.name, format: doc.format, doc, reader: candidate, host: staging, options: prefs, position: candidate.getPosition(), hand: reload ? tab.hand : false, stripScroll: undefined, find: undefined, scanNoticeShown: false, resume: undefined, problem: undefined });
    staging.classList.remove('staging'); staging.classList.add('tab-hidden'); // `enter` shows it
    if (swapping) {
      // The tab being replaced goes the way a closed one does: its place and view are saved, its reader lets go, and it is gone from the strip.
      void pane.flush(); swapping.find = undefined; findBar.close(); zoomGesture.cancel();
      pane.reader = undefined; syncPageStrip();
      swapping.reader?.destroy(); swapping.host?.remove(); swapping.reader = swapping.host = undefined;
      reloadSide.tabs.replace(swapping.path, tab); reloadSide.shown = undefined;
    } else if (!reloadSide.tabs.find(tab.path)) reloadSide.tabs.open(tab, at);
    reloadSide.tabs.markLive(tab.path);
    show(tab, true);
    showPosition(candidate.getPosition(), !tab.ephemeral); // A reopened or converted document saves its place and options again.
    if (!reload) staging.focus();
    candidate = undefined; staging = undefined; pane.cancelPending = undefined;
    if (held && focused !== held) { activateSide(held); (keep?.isConnected ? keep : held.pane.host)?.focus(); }
    if (doc.warning) notify(doc.warning);
    if (!tab.ephemeral) {
      if (tab.format === 'epub') void homeThumbs.loadEpub(tab.path, () => Boolean(known(tab.path))).then(() => paintTabs());
      if (desktop) homeRecents = (await state()).recents; // The store moves the opened document to the front.
      await library.refresh(doc.path).catch(fail);
      if (!reload) warmLikelyDocuments();
    }
    return true;
  } catch (error) {
    if (pane.isCurrent(token)) {
      fail(error);
      if (target && !target.reader) { target.problem = { kind: opening ? 'missing' : 'failed', message: error instanceof Error ? error.message : String(error) }; }
    }
    return false;
  }
  finally { candidate?.destroy(); staging?.remove(); if (pane.endLoad(token)) { $('loading').hidden = true; syncPageStrip(); paintTabState(); } }
}

let warmed = false;
/**
 * Once per launch, after the first document has rendered and while nothing else is loading: asks the native side to read the
 * documents likely to be opened next (see `prefetch_documents`), so the OS file cache is warm for them. Nothing is copied or shown.
 */
function warmLikelyDocuments() {
  if (!desktop || warmed || restoring !== undefined || sides.some(side => side.pane.cancelPending !== undefined)) return;
  warmed = true;
  const reading = homeSections({ recents: lastOpened(), documents: homeLibrary.documents, titleOf: knownTitle, progress: homeProgress }).reading.map(tile => tile.path);
  const tabs = sides.flatMap(side => side.tabs.tabs).map(tab => ({ path: tab.path, loaded: Boolean(tab.reader), ephemeral: tab.ephemeral || tab.brief, problem: Boolean(tab.problem) }));
  const paths = readAheadPaths({ tabs, reading, recents: homeRecents.map(recent => recent.path), skip: path => path === LIBRARY_PATH });
  if (paths.length) void native('prefetch_documents', { paths }).catch(() => undefined);
}

/** Writes what `side`'s pane holds of the tab it shows back into the tab, and saves its place. `side` is the focused one: the hand tool, the page strip and the find bar are its. */
function syncBack(side: Side) {
  const tab = side.shown, pane = side.pane;
  void pane.flush();
  if (tab?.reader && tab.reader === pane.reader) { tab.options = pane.options; tab.position = pane.position; tab.hand = pan.hand; tab.scanNoticeShown = side.scanNoticeShown; tab.stripScroll = pageStrip.scrollPosition(); }
  if (tab) tab.find = findBar.isOpen() ? findBar.query() : undefined;
}

/** Takes the showing tab's working copy back into the tab, saves its place, and puts it out of sight. */
function leave(tab: Tab) {
  syncBack(focused);
  tab.host?.classList.add('tab-hidden');
  findBar.close(); zoomGesture.cancel();
}

/** Frees a tab's reader and host, keeping where it was (and how it was viewed) so showing it again reopens it there. */
function hibernate(side: Side, tab: Tab) {
  if (!tab.reader) return;
  let locator = tab.position?.locator;
  try { locator = tab.reader.getPosition().locator; } catch { /* Keep the last reported place. */ }
  if (locator) tab.resume = { locator: structuredClone(locator), options: { ...tab.options } };
  tab.reader.destroy(); tab.host?.remove();
  tab.reader = tab.host = undefined;
  side.tabs.markHibernated(tab.path);
}

/** Frees the readers the window has no room for: across the window, at most `MAX_LIVE_TABS` tabs, or one per pane when that is more, keep a live reader, and the tab each pane shows always keeps its own. */
function hibernateExcess() {
  for (const { list, path } of hibernationAcross(sides.map(side => side.tabs))) {
    const side = sides.find(other => other.tabs === list), tab = list.find(path);
    if (side && tab) hibernate(side, tab);
  }
}

/** Shows `next` (or Home, for none) in the focused side: the one place the working copy changes hands. */
function show(next: Tab | undefined, refreshed = false) {
  const side = focused, pane = side.pane;
  if (side.shown === next && !refreshed && !cover) return;
  clearCover();
  if (side.shown && side.shown !== next) leave(side.shown);
  const changed = side.shown !== next;
  if (changed) areaDrag?.cancel();
  side.shown = next; side.tabs.activate(next?.path);
  if (changed) {
    agentEvents.forgetSelection();
    if (agentControl && next && next.path !== LIBRARY_PATH) agentEvents.tab({ action: 'shown', ...tabInfo(side, next) });
  }
  pane.show(next);
  side.scanNoticeShown = next?.scanNoticeShown ?? false; ++scrubRequest; scrubbing = false;
  hibernateExcess();
  next?.host?.classList.remove('tab-hidden');
  pane.pannedScroller = pane.reader?.scroller?.(); pan.attach(pane.pannedScroller, pane.host); if (next) pan.setHand(next.hand);
  $('empty').hidden = Boolean(next);
  syncPageStrip(); if (next?.stripScroll !== undefined) pageStrip.restoreScroll(next.stripScroll);
  syncFooter();
  pane.host?.focus();
  if (next?.find !== undefined) findBar.open(next.find, false);
  lastBackground = undefined;
  // The Library tab's page is drawn while the tab is in front; the document that was showing is no longer the one the tree marks.
  if (next?.path === LIBRARY_PATH) { library.setActive(undefined); library.showPage(true); } else { library.showPage(false); library.setActive(next?.path); }
  paintTabState(); paintTabs(); saveSession();
  if (!next) paintHome();
  else if (!next.reader && !next.problem && next.path !== LIBRARY_PATH) void reopen(next);
}

/** The footer follows the focused pane: its arrows, position and progress line, or the resting text when it shows no document (or Home or the Library page covers it). */
function syncFooter() {
  const pane = focused.pane, live = Boolean(pane.reader) && !cover;
  for (const id of ['previous', 'position', 'next']) $<HTMLButtonElement>(id).disabled = !live;
  if (live && pane.position) showPosition(pane.position, false); else paintNoDocument();
}

/** What the reading area, footer and title show while no document does: Home, or a tab waiting to open. */
function paintNoDocument() {
  $('position').textContent = 'Ready when you are'; $('position').title = 'Go to location (Ctrl+G)';
  scrubber.value = '0'; scrubber.disabled = true; footer.style.setProperty('--scrub-fill', '0%');
  $('view-controls').hidden = true; closePillMenus();
  $('filekind').textContent = 'A reader that holds.'; $('filekind').title = '';
}

/** Reopens a tab that holds nothing: its place was saved when it hibernated (or by the last session), and the page comes back there. */
function reopen(tab: Tab) {
  if (tab.brief && desktop) return load(() => readBriefDocument(tab.path), tab.name, { target: tab, brief: true, ephemeral: true });
  return load(() => openLibraryDocument(tab.path), tab.name, { target: tab, ephemeral: tab.ephemeral });
}

type BriefRecord = { id: string; path: string; title: string; format: string; content: string; updatedAt: number };
async function readBriefDocument(idOrPath: string): Promise<Opened> {
  const entry = await native<BriefRecord>('read_brief', { id: idOrPath });
  return { id: entry.path, path: entry.path, name: entry.title, format: entry.format as Opened['format'], bytes: new TextEncoder().encode(entry.content) };
}

/** Reads the user's current text selection inside `side`'s reading surface (including same-origin EPUB frames). */
function paneSelection(side: Side): string {
  const host = side.pane.host;
  if (!host) return '';
  const topSel = window.getSelection();
  const text = topSel ? hostSelectionText(host, topSel).trim() : '';
  if (text) return text.slice(0, 8000);
  for (const frame of host.querySelectorAll<HTMLIFrameElement>('iframe')) {
    try {
      const sel = frame.contentWindow?.getSelection()?.toString().trim();
      if (sel) return sel.slice(0, 8000);
    } catch { /* Cross-origin frame. */ }
  }
  return '';
}

const sideById = (paneId?: string) => (paneId ? sides.find(s => s.view.id === paneId) : undefined) ?? focused;

/** Reloads an open file or brief in place after it changed on disk (`--watch`) or was pushed again, keeping its place. */
async function reloadOpenFile(path: string) {
  const tab = known(path);
  if (!tab) return;
  const owner = holder(path);
  if (owner && owner !== focused) activateSide(owner);
  if (tab.brief) await load(() => readBriefDocument(path), tab.name, { target: tab, brief: true, ephemeral: true, reload: true });
  else await load(() => chooseDocument(path), tab.name, { target: tab, ephemeral: tab.ephemeral, reload: true });
}

/** How a request opens what it names: a brief the way `reopen` does, a Library document (a `folder:<root>:<path>` id, as `status` reports it) the way the Library opens it, any other path as a file. */
async function requestOpener(path: string) {
  if (isBriefPath(path)) return () => readBriefDocument(path);
  const inLibrary = (await getLibrary().catch(() => emptyLibrary())).documents.some(doc => doc.path === path);
  return () => inLibrary ? openLibraryDocument(path) : chooseDocument(path);
}
const controlHost: ControlHost = {
  status: () => {
    const activeSide = focused;
    const activeTab = cover ? undefined : activeSide.shown?.path === LIBRARY_PATH ? undefined : activeSide.shown;
    const activePos = activeTab ? (activeSide.pane.position ?? activeTab.position) : undefined;
    return {
      window: {
        width: windowState.width,
        height: windowState.height,
        pinned: windowState.pinned,
        locked: windowState.locked,
        focused: !document.documentElement.classList.contains('window-inactive'),
      },
      appearance: appearanceSummary(),
      layout: isSplit() ? 'split' : 'single',
      libraryOpen: $('library-toggle').getAttribute('aria-expanded') === 'true',
      panes: sides.map(side => ({
        id: side.view.id,
        active: side === focused,
        shown: side.shown?.path ?? null,
        tabs: side.tabs.tabs.filter(tab => tab.path !== LIBRARY_PATH).map(tab => {
          const place = tab === side.shown ? side.pane.position : tab.position;
          return {
            path: tab.path,
            title: tabTitle(tab),
            format: tab.format,
            brief: Boolean(tab.brief),
            active: tab === side.tabs.active,
            ...(place ? { position: place.label, progress: Number(place.fraction.toFixed(4)) } : {}),
          };
        }),
      })),
      active: activeTab ? {
        paneId: activeSide.view.id,
        path: activeTab.path,
        title: tabTitle(activeTab),
        format: activeTab.format,
        brief: Boolean(activeTab.brief),
        position: activePos?.label ?? '',
        ...(activePos ? { progress: Number(activePos.fraction.toFixed(4)) } : {}),
        outlineCount: activeSide.pane.reader?.outline().length ?? 0,
        selection: paneSelection(activeSide),
      } : null,
    };
  },
  openFile: async (path, options) => {
    const open = await requestOpener(path), existing = known(path);
    const brief = isBriefPath(path);
    // A split the window cannot make (too narrow or short, four panes already) opens the file as a tab instead, and the reply says why.
    let splitRefused: string | undefined;
    if (options.split && (!isSplit() || holder(path) === focused)) {
      const other = isSplit() ? sides.find(s => s !== focused) : undefined;
      splitRefused = other ? undefined : openSplitReason(path, options.split);
      if (other) {
        activateSide(other);
      } else if (!splitRefused) {
        const format = path.split('.').pop()?.toLowerCase() ?? 'txt';
        openInSplit({ path, name: baseName(path), format: format === 'markdown' ? 'md' : format }, options.split);
        const tab = known(path);
        if (tab) {
          if (options.ephemeral || brief) tab.ephemeral = true;
          if (brief) tab.brief = true;
          const ok = await load(open, tab.name, { target: tab, ...(brief ? { brief: true } : {}), ephemeral: options.ephemeral || brief, reload: Boolean(tab.reader) });
          if (!ok) throw new Error(`Could not open ${path}`);
          const owner = holder(path) ?? focused;
          return { path: tab.path, title: tabTitle(tab), format: tab.format, paneId: owner.view.id, position: owner.pane.position?.label ?? '' };
        }
      }
    }
    const ok = await load(open, baseName(path), { target: existing, ...(brief ? { brief: true } : {}), ephemeral: options.ephemeral || brief, reload: Boolean(existing?.reader) });
    if (!ok) throw new Error(`Could not open ${path}`);
    const tab = known(path) ?? focused.shown;
    if (!tab) throw new Error(`Could not open ${path}`);
    // A tab that was already open is reloaded where it is, which leaves the focus with the pane the user was in: the request asks for this tab.
    if (existing) selectTab(tab.path);
    const owner = holder(tab.path) ?? focused;
    return { path: tab.path, title: tabTitle(tab), format: tab.format, paneId: owner.view.id, position: owner.pane.position?.label ?? '', ...(splitRefused ? { splitRefused } : {}) };
  },
  openBrief: async spec => {
    const existing = known(spec.path);
    let splitRefused: string | undefined;
    if (spec.split && !existing) {
      const other = isSplit() ? sides.find(s => s !== focused) : undefined;
      splitRefused = other ? undefined : openSplitReason(spec.path, spec.split);
      if (other) activateSide(other);
      else if (!splitRefused) openInSplit({ path: spec.path, name: spec.title, format: spec.format }, spec.split);
    } else if (existing) {
      const owner = holder(spec.path);
      if (owner && owner !== focused) activateSide(owner);
      existing.name = spec.title;
      existing.format = spec.format;
    }
    // Marked before this task ends: the split just made queued a session write, which must already see the brief as ephemeral.
    const target = known(spec.path);
    if (target) { target.brief = true; target.ephemeral = true; }
    const ok = await load(() => readBriefDocument(spec.path), spec.title, { target, brief: true, ephemeral: true, reload: Boolean(target?.reader) });
    if (!ok) throw new Error(`Could not display brief "${spec.id}".`);
    const tab = known(spec.path) ?? focused.shown;
    if (!tab) throw new Error(`Could not display brief "${spec.id}".`);
    const owner = holder(tab.path) ?? focused;
    return { path: tab.path, title: tabTitle(tab), format: tab.format, paneId: owner.view.id, position: owner.pane.position?.label ?? '', ...(splitRefused ? { splitRefused } : {}) };
  },
  goTo: async (target, paneId) => {
    const reader = sideById(paneId).pane.reader;
    if (!reader) throw new Error('No document is open.');
    await reader.goTo(target);
    return reader.getPosition().label;
  },
  outline: paneId => sideById(paneId).pane.reader?.outline() ?? [],
  search: async (query, options, paneId) => sideById(paneId).pane.reader?.search?.(query, options),
  showMatch: async (hit, _query, paneId) => {
    const reader = sideById(paneId).pane.reader;
    if (!reader) throw new Error('No document is open.');
    await reader.revealSearchMatch?.(hit);
    return reader.getPosition().label;
  },
  readText: async (limit, paneId) => sideById(paneId).pane.reader?.readText?.(limit),
  selection: paneId => paneSelection(sideById(paneId)),
  closeTab: target => {
    const closed: string[] = [];
    if (target.allBriefs) {
      const paths = sides.flatMap(side => side.tabs.tabs.filter(t => t.brief).map(t => t.path));
      for (const path of paths) { closeTab(path); closed.push(path); }
      return closed;
    }
    const wantPath = target.path ?? (target.id ? (target.id.startsWith(BRIEF_PREFIX) ? target.id : `${BRIEF_PREFIX}${target.id}`) : undefined);
    const tab = wantPath ? known(wantPath) : sides.flatMap(s => s.tabs.tabs).find(t => briefIdOf(t.path) === target.id);
    if (tab) { closeTab(tab.path); closed.push(tab.path); }
    else if (!wantPath && focused.shown) { const p = focused.shown.path; closeTab(p); closed.push(p); }
    return closed;
  },
  setAppearance: change => {
    const kept = appearance();
    saveAppearance({
      ...kept,
      mode: (['system', 'light', 'dark'] as const satisfies readonly AppearanceMode[]).find(mode => mode === change.mode) ?? kept.mode,
      palette: allPalettes.find(palette => palette === change.theme) ?? kept.palette,
      page: pageTones.find(tone => tone === change.page) ?? kept.page,
    });
    return appearanceSummary();
  },
  runCommand: async id => {
    const entry = COMMANDS.find(candidate => candidate.id === id);
    if (!entry) throw new Error(`Unknown command: ${id}`);
    if (id === 'send-to-agent' || id === 'send-area-to-agent') throw new Error(id === 'send-area-to-agent' ? 'Only the user can send an area.' : 'Only the user can send a selection.');
    const reason = unavailableReason(entry, { hasDocument: Boolean(activePane().reader), desktop, format: activePane().active?.format, split: splitContext() });
    if (reason) throw new Error(reason);
    await command(id);
    return entry.label;
  },
  library: async () => (await getLibrary()).documents,
  filterLibrary: change => library.filter(change),
};

const tabTitle = (tab: Tab) => tab.path === LIBRARY_PATH || tab.brief ? tab.name : displayTitle(tab, tab.format === 'epub' ? homeThumbs.epub(tab.path)?.title : undefined);
/** Where a tab is, short: "40 / 146" for pages and lines, a percentage for the rest. */
function tabWhere(side: Side, tab: Tab) {
  const place = tab === side.shown ? side.pane.position : tab.position;
  if (!place) return '';
  const pages = place.label.match(/^(?:Pages?|Line) ([\d–-]+) of (\d+)/);
  return pages ? `${pages[1]} / ${pages[2]}` : `${Math.round(Math.max(0, Math.min(100, place.fraction * 100)))} %`;
}
let paintedTabs = '';
function paintTabs() {
  const all = [...(libraryTab ? [libraryTab] : []), ...sides.flatMap(side => side.tabs.tabs)];
  const hints = titleHints(all.filter(tab => tab.path !== LIBRARY_PATH).map(tab => ({ path: tab.path, title: tabTitle(tab) })));
  const viewOf = (side: Side, tab: Tab, active: boolean): TabView => {
    const place = tab === side.shown ? side.pane.position : tab.position;
    return { path: tab.path, title: tabTitle(tab), hint: hints.get(tab.path) ?? '', format: tab.format, where: tabWhere(side, tab), paged: /^Pages? /.test(place?.label ?? ''), progress: formatProgress(progressOf(place ?? { fraction: NaN, scrub: { current: 0, total: 0, unit: 'line' } })) ?? '', active, problem: Boolean(tab.problem), library: tab.path === LIBRARY_PATH, image: Object.hasOwn(imageFormats, tab.format), brief: Boolean(tab.brief) };
  };
  const rows = sides.map(side => side.tabs.tabs.map(tab => viewOf(side, tab, tab === side.tabs.active)));
  const bar = isSplit() ? (libraryTab ? [viewOf(sides[0], libraryTab, cover === 'library')] : []) : rows[0], home = isSplit() ? cover === 'home' : !sides[0].tabs.active;
  const key = JSON.stringify([bar, home, isSplit() ? [rows, focused.view.id] : 0, all.length]);
  if (key === paintedTabs) return;
  paintedTabs = key;
  strip.paint(bar, home);
  rail.setHome(home);
  if (isSplit()) sides.forEach((side, index) => { side.strip.paint(rows[index], false); side.view.row.classList.toggle('is-inactive', side !== focused || Boolean(cover)); });
  paintFolds();
  const here = isSplit() ? (cover ? (cover === 'library' ? libraryTab : undefined) : focused.shown) : sides[0].tabs.active;
  $('filename').textContent = here ? tabTitle(here) : 'Hold My Brief'; $('filename').title = here?.path ?? '';
  $('tab-count').textContent = all.length ? String(all.length) : '';
}

/** The placeholder for a showing tab that has no page: its file is missing, its open failed, or it is not opened yet. Each side has its own. */
function paintTabState() {
  for (const side of sides) {
    const tab = side.shown, waiting = Boolean(tab && !tab.reader && side.pane.loadingTarget !== tab && tab.path !== LIBRARY_PATH), state = side.view.state;
    state.hidden = !waiting || !tab;
    if (!waiting || !tab) continue;
    const problem = tab.problem;
    state.querySelector('h2')!.textContent = problem?.kind === 'missing' ? 'File not found' : problem ? 'This document could not be opened' : 'Not opened yet';
    state.querySelector('p')!.textContent = problem ? `${tab.name} — ${problem.message}` : tab.name;
    state.querySelector('.primary')!.textContent = problem?.kind === 'missing' ? 'Locate…' : problem ? 'Try again' : 'Open';
  }
}
function stateAction(side: Side) {
  const tab = side.shown;
  if (!tab) return;
  activateSide(side);
  if (tab.problem?.kind === 'missing' && desktop) {
    void locateLibraryDocument(tab.path).then(() => { tab.problem = undefined; void reopen(tab); }).catch(fail);
  } else if (tab.problem?.kind === 'missing') openFile();
  else { tab.problem = undefined; void reopen(tab); }
}

/** Tab 1…8, or 9 for the last one: reached by Alt+digit and ⌘+digit as keys and, on macOS, by the Window menu's items. No such tab: nothing happens. */
function selectTabNumber(digit: number) { const tab = focused.tabs.byNumber(digit); if (tab) selectTab(tab.path); }
/** Shows a tab, or Home for none. A tab with no page yet starts opening; opening something else meanwhile is given up. While split, a tab of either side
 *  returns the split as it was (leaving Home or the Library page) and makes its side the focused one; Home and the Library tab cover the split. */
function selectTab(path: string | undefined) {
  if (isSplit() && (path === undefined || path === LIBRARY_PATH)) { showCover(path === undefined ? 'home' : 'library'); return; }
  const side = path === undefined ? focused : holder(path), tab = path === undefined ? undefined : side?.tabs.find(path);
  if (path !== undefined && !tab) return;
  if (isSplit()) { clearCover(); pick(side); if (side) activateSide(side); }
  if (tab === focused.shown) return;
  if (focused.pane.loadingTarget !== tab) cancelOpen();
  show(tab);
}

function closeTab(path: string) {
  if (path === LIBRARY_PATH && isSplit()) {
    libraryTab = undefined; library.forgetScope();
    if (cover === 'library') clearCover();
    paintTabs(); saveSession();
    return;
  }
  const side = holder(path), tab = side?.tabs.find(path);
  if (!side || !tab) return;
  if (side !== focused) activateSide(side);
  const pane = side.pane;
  if (pane.loadingTarget === tab) cancelOpen();
  if (agentControl && path !== LIBRARY_PATH) agentEvents.tab({ action: 'closed', ...tabInfo(side, tab) });
  const wasShown = side.shown === tab;
  if (wasShown) {
    void pane.flush(); tab.find = undefined; findBar.close(); zoomGesture.cancel();
    pane.reader = undefined; syncPageStrip(); // The strip lets go of the reader before it is destroyed.
  }
  tab.reader?.destroy(); tab.host?.remove(); tab.reader = tab.host = undefined;
  if (desktop) void native('unwatch_file', { path }).catch(() => undefined);
  const next = side.tabs.close(path);
  if (isSplit() && !side.tabs.size) { side.shown = undefined; pane.show(undefined); closePane(side); }
  else if (wasShown) { side.shown = undefined; show(next, true); } else { paintTabs(); saveSession(); }
  if (path === LIBRARY_PATH) library.forgetScope();
}

let sessionPending = false;
/** The last session write, so a close waits for the ones in flight; desktop writes run one after another, so a late one never lands over a newer one. */
let sessionWrite: Promise<void> = Promise.resolve();
/** Remembers the open tabs for the next launch. The write is queued as a microtask, so it lands before the page can be reloaded or closed, and several changes in one task are one write. */
function saveSession() {
  if (sessionPending) return;
  sessionPending = true;
  queueMicrotask(() => { if (sessionPending) writeSession(); });
}
function writeSession() {
  sessionPending = false;
  const session = sessionOf();
  sessionWrite = desktop ? sessionWrite.then(() => saveTabs(session)).catch(fail) : saveTabs(session).catch(fail);
}
/** On the way out: writes a session change that has not been written yet (the divider's too, which waits for the drag to rest) and returns once every write has landed. In the browser the write itself is synchronous. */
function flushSession(): Promise<void> {
  if (ratioTimer) { clearTimeout(ratioTimer); ratioTimer = undefined; sessionPending = true; }
  if (sessionPending) writeSession();
  return sessionWrite;
}

const savedTab = (tab: Tab): SavedTab => ({ path: tab.path, name: tab.name, format: tab.format, ...(tab.scope ? { scope: tab.scope } : {}) });
/**
 * The tabs as they are saved. Split or not, one strip in order (the Library tab, then each pane's tabs in reading order), so a build that does not know
 * the split still brings back every document; split, the session also holds the layout: its tree (the dividers' places among them), each pane's tabs and shown tab, and the active pane,
 * and, for two panes side by side, the same as an older build saved it (see `TabSession`).
 */
function sessionOf(): TabSession {
  // Briefs and other ephemeral tabs (agent-opened with `--ephemeral`) are never saved: they come back only when an agent pushes them again.
  const kept = (side: Side) => side.tabs.tabs.filter(tab => !tab.ephemeral);
  const active = focused.tabs.active;
  if (!isSplit()) { const tabs = kept(focused); return { tabs: tabs.map(savedTab), active: active && tabs.includes(active) ? tabs.indexOf(active) : null }; }
  const ordered = [...(libraryTab ? [libraryTab] : []), ...sides.flatMap(kept)];
  const showing = cover === 'library' ? libraryTab : cover ? undefined : focused.shown;
  const at = showing ? ordered.indexOf(showing) : -1;
  // A pane that held only briefs has nothing to bring back: with fewer than two panes left, the session is a single pane's.
  if (sides.filter(side => kept(side).length).length < 2) return { tabs: ordered.map(savedTab), active: at < 0 ? null : at };
  const pane = (side: Side) => { const tabs = kept(side); return { tabs: tabs.map(tab => tab.path), shown: side.shown && tabs.includes(side.shown) ? side.shown.path : tabs[0]?.path ?? '' }; };
  const saved: SavedLayout = { tree: layout, panes: Object.fromEntries(sides.map(side => [side.view.id, pane(side)])), active: focused.view.id }, split = legacySplit(saved);
  return { tabs: ordered.map(savedTab), active: at < 0 ? null : at, layout: saved, ...(split ? { split } : {}) };
}
/** The tab Close tab (Ctrl W) closes: the one the reader sees, which is the Library tab while its page covers the split. */
const closableTab = () => cover === 'library' ? libraryTab : cover ? undefined : focused.shown;

/** What the split commands need to know. */
const documentCount = () => sides.reduce((total, side) => total + side.tabs.tabs.filter(tab => tab.path !== LIBRARY_PATH).length, 0);
/** The width the panes really share: the reading area less the icon rail's room (`--workspace-clear`, which only applies from 720 px up). */
const paneRoomClear = () => matchMedia('(min-width: 720px)').matches ? parseFloat(getComputedStyle(workspace).getPropertyValue('--workspace-clear')) || 0 : 0;
const paneRoom = () => workspace.clientWidth - paneRoomClear();
/** What the split commands need to know, for splitting `side` (the active pane by default): the panes, the documents, and that pane's room and tabs. */
function splitContext(side = focused): SplitContext {
  const box = isSplit() ? boxes(layout, paneRect()).panes.find(entry => entry.pane === side.view.id)?.rect : undefined;
  return { panes: sides.length, documents: documentCount(), windowWidth: innerWidth, width: box?.width ?? paneRoom(), height: box?.height ?? workspace.clientHeight, tabs: side.tabs.tabs.filter(tab => tab.path !== LIBRARY_PATH).length };
}
/** Why Split right or Split down cannot run now for `tab` (the one showing, by default), whose pane is the one that would be split; undefined when it can. */
const splitReason = (axis: 'right' | 'down', tab = focused.shown) => unavailableReason(COMMANDS.find(entry => entry.id === `split-${axis}`)!, { hasDocument: Boolean(tab && tab.path !== LIBRARY_PATH), desktop, split: splitContext((tab && holder(tab.path)) || focused) });
/** Why the document at `path` cannot open in a new pane to the right of the active pane, or below it, now, or undefined: four panes are the most, the pane needs room, and when the window is not split another document has to stay beside it. */
function openSplitReason(path: string, axis: 'right' | 'down') {
  const context = splitContext(), reason = paneSplitReason(axis, { ...context, tabs: 2, documents: 2 }); // The document brings the tab the pane needs, so only the room and the panes are asked.
  if (reason) return reason;
  if (!isSplit()) return context.documents - (known(path) ? 1 : 0) < 1 ? 'Open a document first, to put this one beside it' : undefined;
  return holder(path) === focused && context.tabs < 2 ? 'Open another document first' : undefined;
}

/** The room the panes share, in the workspace's own px: its padding box less the icon rail's room on the side the library is at. */
function paneRect(): Rect {
  const box = workspace.getBoundingClientRect(), style = getComputedStyle(workspace), edge = (name: string) => parseFloat(style.getPropertyValue(`border-${name}-width`)) || 0;
  const clear = paneRoomClear(), libraryRight = $('reader-layout').classList.contains('library-right');
  return { x: libraryRight ? 0 : clear, y: 0, width: box.width - edge('left') - edge('right') - clear, height: box.height - edge('top') - edge('bottom') };
}
/** Puts a pane's row, layer or reading surface in `box` (a row of tabs `tabs` px high is the top of the pane). A reading surface keeps its top and bottom to the CSS, which adds the find bar and the page strip to them. */
function place(element: HTMLElement, box: Rect, tabs: number, room: Rect) {
  const { style } = element;
  style.left = `${box.x}px`; style.width = `${box.width}px`;
  if (element.classList.contains('pane-strip')) style.top = `${box.y}px`;
  else if (element.classList.contains('pane-body')) { style.top = `${box.y + tabs}px`; style.height = `${box.height - tabs}px`; }
  else { style.setProperty('--pane-top', `${box.y}px`); style.setProperty('--pane-bottom', `${room.height - box.y - box.height}px`); }
}
/** Lays the panes out: the split's classes, each pane's and divider's box from the layout tree, and the footer under the focused pane. */
function applyLayout() {
  const split = isSplit();
  workspace.classList.toggle('is-split', split);
  if (split) {
    workspace.dataset.active = focused.view.id;
    const single = innerWidth < MIN_SPLIT_WINDOW || !fits(layout, { width: paneRoom(), height: workspace.clientHeight });
    workspace.classList.toggle('is-single', single);
    const room = paneRect(), tabs = parseFloat(getComputedStyle(workspace).getPropertyValue('--pane-tabs')) || 0, shown = boxes(layout, room);
    const spots = new Map(shown.panes.map(({ pane, rect }) => [pane, rect]));
    // Folded, every pane has the whole room, and only the focused one is seen.
    for (const element of workspace.querySelectorAll<HTMLElement>('[data-pane]')) { const box = single ? room : spots.get(element.dataset.pane!); if (box) place(element, box, tabs, room); }
    const kept = new Set<string>();
    for (const box of shown.dividers) {
      const key = box.path.join('');
      let element = dividers.get(key);
      if (!element) { element = makeDivider(box.path); dividers.set(key, element); workspace.append(element); }
      kept.add(key);
      Object.assign(element.style, { left: `${box.rect.x}px`, top: `${box.rect.y}px`, width: `${box.rect.width}px`, height: `${box.rect.height}px` });
      element.hidden = single;
      paintDivider(element, box.percent, box.axis);
    }
    for (const [key, element] of dividers) if (!kept.has(key)) { element.remove(); dividers.delete(key); }
  } else {
    // `classList.remove` writes the attribute even when the class is absent, which the class observer would see: this runs on every layout pass, so it must change nothing it does not have to.
    delete workspace.dataset.active; workspace.classList.toggle('is-single', false);
    for (const element of workspace.querySelectorAll<HTMLElement>('[data-pane]')) for (const name of ['left', 'top', 'width', 'height', '--pane-top', '--pane-bottom']) element.style.removeProperty(name);
    for (const element of dividers.values()) element.remove();
    dividers.clear();
  }
  paintFolds();
  placeFooter();
}
/** The divider of the split at `path`. It reads its place from `layout` and the room as they are when it is used (a layout pass may be a frame behind), so it outlives layout changes that keep the split. */
function makeDivider(path: Path) {
  const key = path.join('');
  return createDivider({
    axis: () => splitAt(layout, path)?.axis ?? 'row',
    percent: () => splitAt(layout, path)?.ratio ?? DEFAULT_PERCENT,
    set: percent => moveDivider(setRatio(layout, path, percent)),
    even: () => moveDivider(evenRatio(layout, path)),
    bounds: () => {
      const box = boxes(layout, paneRect()).dividers.find(candidate => candidate.path.join('') === key);
      if (!box || workspace.classList.contains('is-single')) return undefined;
      const origin = workspace.getBoundingClientRect(), row = box.axis === 'row';
      const start = row ? origin.left + workspace.clientLeft + box.room.x : origin.top + workspace.clientTop + box.room.y;
      return { start, end: start + (row ? box.room.width : box.room.height), limits: box.limits };
    },
  });
}
/** While one pane shows, the shown pane's row ends with the pane map: the layout drawn small, "n panes", and a menu of the panes. */
function paintFolds() {
  const folded = isSplit() && workspace.classList.contains('is-single');
  const shown = focused.shown, label = `Panes, ${sides.length}; showing ${shown ? tabTitle(shown) : 'no document'}`;
  for (const side of sides) paintFold(side.view.fold, folded && side === focused, layout, focused.view.id, label);
}
/** The pane map's menu: a row per pane (in reading order) with the layout drawn small, that pane filled, and the document it shows; choosing one makes that pane the active one. */
function showPaneMenu(anchor: HTMLElement) {
  contextMenu.show(sides.map(side => { const shown = side.shown ?? side.tabs.tabs[0]; return { label: shown ? tabTitle(shown) : 'No document', icon: () => paneMap(layout, side.view.id), run: () => focusSide(side) }; }), anchor);
}
let ratioTimer: ReturnType<typeof setTimeout> | undefined;
/** Moves a divider (`next` is the layout with it moved). A drag moves it on every frame, so the session is written once it has been still for a moment. */
function moveDivider(next: Layout) { layout = next; applyLayout(); clearTimeout(ratioTimer); ratioTimer = setTimeout(() => { ratioTimer = undefined; saveSession(); }, 300); }
/** The progress line and scrubber sit under the focused pane only. */
function placeFooter() {
  if (!isSplit()) { footer.style.removeProperty('left'); footer.style.removeProperty('right'); return; }
  const layout = $('reader-layout').getBoundingClientRect(), box = focused.view.body.getBoundingClientRect();
  footer.style.left = `${box.left - layout.left}px`; footer.style.right = `${layout.right - box.right}px`;
}

/** A still copy of the view controls for the side that is not the focused one (the live ones are the focused pane's), so each pane keeps its own. */
function ghostOf(side: Side) {
  side.view.ghost?.remove(); side.view.ghost = undefined;
  if (pill.hidden || pill.parentElement !== side.view.body || !isSplit()) return;
  const copy = pill.cloneNode(true) as HTMLElement, live = [pill, ...pill.querySelectorAll<HTMLElement>('*')], still = [copy, ...copy.querySelectorAll<HTMLElement>('*')];
  live.forEach((node, index) => {
    if (index && getComputedStyle(node).display === 'none') { still[index].remove(); return; }
    if (node.id) still[index].dataset.was = node.id;
    still[index].removeAttribute('id');
  });
  copy.classList.add('pill-ghost'); copy.inert = true; copy.setAttribute('aria-hidden', 'true');
  side.view.body.append(copy); side.view.ghost = copy;
}
/** The reader of a pane that is not the focused one drew itself again (its size changed): its still view controls follow it. */
function refreshGhost(side: Side) { if (side.view.ghost) paintZoom(side.pane, side.view.ghost); }
/** The focused side stops being it: its find bar, page strip and view controls are put away, and its tab keeps what they held. */
function parkSide(side: Side) {
  syncBack(side);
  findBar.close(); zoomGesture.cancel(); closePillMenus();
  const pane = side.pane;
  pane.stripReader?.setPreviews?.(undefined); pane.stripReader = undefined; pageStrip.clear();
  side.view.body.classList.remove('has-page-strip'); pageStrip.element.hidden = true;
  ghostOf(side);
}
/** The side becomes the focused one: the find bar, page strip, view controls, hand tool and footer are its. */
function adoptSide(side: Side) {
  const pane = side.pane, tab = side.shown;
  side.view.ghost?.remove(); side.view.ghost = undefined;
  side.view.body.append(pill, pageStrip.element); side.view.body.prepend(findBar.element);
  ++scrubRequest; scrubbing = false;
  pane.pannedScroller = pane.reader?.scroller?.(); pan.attach(pane.pannedScroller, pane.host); pan.setHand(tab?.hand ?? false);
  syncPageStrip(); if (tab?.stripScroll !== undefined) pageStrip.restoreScroll(tab.stripScroll);
  syncFooter(); placePill();
  if (tab?.find !== undefined) findBar.open(tab.find, false);
  lastBackground = undefined;
  library.setActive(cover ? undefined : tab?.path);
  paintTabState(); paintTabs(); applyLayout();
}
function activateSide(side: Side) {
  if (side === focused || !sides.includes(side)) return;
  areaDrag?.cancel();
  parkSide(focused); focused = side; adoptSide(side); saveSession();
}
// The pane last clicked or focused is the active one. A press inside a book's frame never reaches the page (a fixed-layout book's frames report theirs, see `onFrame` in `load`),
// but it moves the focus into the frame, which blurs the page: the pane that holds the element the page then reports as focused is the one.
for (const type of ['pointerdown', 'focusin']) workspace.addEventListener(type, event => { const side = isSplit() ? sideAt(event.target) ?? (event instanceof PointerEvent ? sideUnder(event) : undefined) : undefined; if (side) { if (event.type === 'pointerdown') pick(side); activateSide(side); } }, true);
workspace.addEventListener('keydown', event => pick(isSplit() ? sideAt(event.target) : undefined), true);
window.addEventListener('blur', () => setTimeout(() => { const side = isSplit() ? sideAt(document.activeElement) : undefined; if (side) activateSide(side); }));

/** While split, Home or the Library page takes the whole reading area; the panes, and what they show, stay as they were. */
function showCover(kind: 'home' | 'library') {
  if (cover === kind || (kind === 'library' && !libraryTab)) return;
  if (focused.pane.cancelPending) cancelOpen();
  cover = kind;
  findBar.close(); closePillMenus();
  workspace.classList.add('is-covered'); $('empty').hidden = kind !== 'home';
  library.setActive(undefined); library.showPage(kind === 'library');
  syncFooter(); paintTabs(); saveSession();
  if (kind === 'home') paintHome();
}
/** Gives the reading area back to the panes. */
function clearCover() {
  if (!cover) return;
  cover = undefined;
  workspace.classList.remove('is-covered'); $('empty').hidden = true;
  library.showPage(false); library.setActive(focused.shown?.path);
  syncFooter(); paintTabs(); saveSession();
}

/** Puts a side in the window with `id` and `tabs`: the one made for an earlier split is put back, else it is made. Nothing is shown in it yet; the layout and the order of `sides` are the caller's. */
function createSide(id: string, tabs: TabList<Tab>, like: Side): Side {
  const spare = spares.get(id), side = spare ?? makeSide(id);
  if (spare) { spares.delete(id); workspace.append(side.view.row, side.view.body); side.pane = new Pane<Tab>({ persist: persistTab, notify }); side.shown = undefined; side.scanNoticeShown = false; } else watchSide(side);
  side.tabs = tabs; side.pane.pillPlacement = like.pane.pillPlacement;
  sides.push(side);
  return side;
}
/** Puts `sides` in the layout's reading order, which the saved session, the cycling key and the rows' order rely on. */
function orderSides() {
  const order = panesOf(layout);
  sides.sort((x, y) => order.indexOf(x.view.id) - order.indexOf(y.view.id));
}
/**
 * Splits `near`, which becomes the active pane: `tab` (a document tab of it, shown or not) moves to a new pane to its right or below it (`axis` `row` or `column`, `place` `'after'`) or to its left or above it
 * (`'before'`), which becomes the active one; every other tab stays in `near`, showing the one shown most recently. With `mirrored` (a tab dragged onto the left or top quarter of a window that is not split) the
 * new pane is the other way round: `tab` stays alone in `near`, which stays the active pane, and every other document tab goes to the new pane, showing the one the window was showing (else the one shown
 * most recently); `place` is then `'after'`, the dragged tab being the first pane.
 */
function startSplit(tab: Tab, near: Side, axis: Axis, mirrored = false, place: 'before' | 'after' = 'after') {
  clearCover();
  activateSide(near);
  if (near.pane.cancelPending) cancelOpen();
  syncBack(near); findBar.close(); zoomGesture.cancel();
  const entry = near.tabs.find(LIBRARY_PATH);
  if (entry) { near.tabs.detach(LIBRARY_PATH); libraryTab = entry; }
  const added = createSide(freeId(layout)!, (mirrored ? splitOffRest : splitOff)(near.tabs, tab.path)!, near);
  layout = splitPane(layout, near.view.id, axis, place, added.view.id)!; orderSides();
  const beside = added.tabs.active!;
  for (const moved of added.tabs.tabs) moved.host?.setAttribute('data-pane', added.view.id);
  beside.host?.classList.remove('tab-hidden');
  near.shown = undefined; applyLayout();
  show(near.tabs.active, true);
  added.shown = beside; added.pane.show(beside); added.scanNoticeShown = beside.scanNoticeShown;
  activateSide(added);
  hibernateExcess();
  if (!beside.reader && !beside.problem) void reopen(beside);
  if (mirrored) activateSide(near);
  focused.pane.host?.focus();
}
/** Split right or down: `tab` (the shown one, by default) moves to a new pane to the right of its pane or below it; with `mirrored` (a drag, window not split) it becomes the left or top pane and the other documents the right or bottom one. */
function splitTab(axis: 'right' | 'down', tab = focused.shown, mirrored = false) {
  const reason = splitReason(axis, tab);
  if (reason || !tab) { notify(reason ?? 'Open a document to split'); return; }
  startSplit(tab, holder(tab.path) ?? focused, axis === 'right' ? 'row' : 'column', mirrored);
}
/** Opens a document in a new pane to the right of the active pane or below it, splitting the window first when it is not split: the document is shown there, beside the documents that stay. One that is open in another pane moves. */
function openInSplit(doc: { path: string; name: string; format: string }, axis: 'right' | 'down') {
  const reason = openSplitReason(doc.path, axis);
  if (reason) { notify(reason); return; }
  const tab = known(doc.path) ?? { path: doc.path, name: doc.name, format: doc.format, options: { ...defaultOptions }, hand: false, scanNoticeShown: false };
  if (!known(doc.path)) focused.tabs.add(tab);
  if (holder(doc.path) !== focused) moveTab(doc.path, focused);
  startSplit(tab, focused, axis === 'right' ? 'row' : 'column');
}
/** Moves a tab (the shown one, by default) to the pane `to` (the other one, by default), at `at` (after its last tab by default), which shows it and becomes the active one; a pane left with no tab closes. */
function moveTab(path = focused.shown?.path, to?: Side, at?: number) {
  if (!isSplit() || !path || path === LIBRARY_PATH) return;
  const holding = holder(path), target = to ?? sides.find(side => side !== holding);
  if (!holding || !target || target === holding) return;
  if (focused.shown?.path !== path || cover) selectTab(path);
  const from = focused, tab = from.shown;
  if (!tab || from !== holding) return;
  if (from.pane.cancelPending) cancelOpen();
  syncBack(from); findBar.close(); zoomGesture.cancel();
  moveAcross(from.tabs, target.tabs, tab.path, at);
  tab.host?.setAttribute('data-pane', target.view.id);
  from.shown = undefined;
  if (from.tabs.size) show(from.tabs.active, true); else from.pane.show(undefined);
  activateSide(target);
  show(tab, true);
  if (!from.tabs.size) mergeInto(target, [from]);
  focused.pane.host?.focus();
}
/** Makes `side` the active pane and puts the focus in its page. */
function focusSide(side: Side) {
  pick(side); clearCover(); activateSide(side); side.pane.host?.focus();
}
/** Moves the focus to the next pane in reading order, from the last to the first. */
function focusNextPane() {
  const next = sides[(sides.indexOf(focused) + 1) % sides.length];
  if (next !== focused) focusSide(next);
}
/** Moves the focus to the pane next to the active one in `direction`; false when there is none. */
function focusPane(direction: Direction): boolean {
  const id = neighbour(layout, focused.view.id, direction, paneRect()), side = sides.find(other => other.view.id === id);
  if (side) focusSide(side);
  return Boolean(side);
}
/**
 * Closes the panes `gone`: their tabs follow those of `into`, which becomes the active pane and keeps showing what it showed (a pane that has no tab left, because its last one was closed or moved, brings none),
 * and each one's room goes to its sibling in the layout. When no pane but `into` is left the split ends: the tab the active pane showed stays shown (the Library tab, or Home, while it covers the panes),
 * and the Library tab goes back to the row.
 */
function mergeInto(into: Side, gone: readonly Side[]) {
  if (!isSplit() || gone.includes(into)) return;
  const ends = gone.length >= sides.length - 1;
  const keep = ends ? (cover === 'library' ? libraryTab : cover === 'home' ? undefined : focused.shown ?? sides.find(side => side !== focused)?.shown) : into.shown;
  if (ends) clearCover();
  activateSide(into);
  for (const side of gone) {
    const loading = side.pane.cancelPending !== undefined;
    side.pane.cancelLoad(); void side.pane.flush(); side.strip.closeMenu();
    for (const tab of side.tabs.tabs) tab.host?.classList.add('tab-hidden');
    mergeLists(into.tabs, side.tabs, keep?.path);
    side.view.ghost?.remove(); side.view.ghost = undefined;
    side.view.row.remove(); side.view.body.remove(); side.view.state.hidden = true;
    sides.splice(sides.indexOf(side), 1); spares.set(side.view.id, side);
    layout = removePane(layout, side.view.id) ?? layout;
    if (loading && !sides.some(other => other.pane.cancelPending)) $('loading').hidden = true;
  }
  if (!isSplit() && libraryTab) { into.tabs.add(libraryTab, 0); libraryTab = undefined; }
  for (const tab of into.tabs.tabs) tab.host?.setAttribute('data-pane', into.view.id);
  orderSides(); applyLayout();
  if (ends) show(keep, true); else { hibernateExcess(); paintTabState(); paintTabs(); saveSession(); }
}
/** Closes a pane (the active one, by default): its tabs join the pane that takes its room, its sibling in the layout or that sibling's first pane in reading order, and that pane becomes the active one. */
function closePane(side = focused) {
  const into = sides.find(other => other.view.id === receiver(layout, side.view.id));
  if (into) mergeInto(into, [side]);
}
/** Ends the split: every pane's tabs follow the first pane's, in reading order (the Library tab first), and the tab the active pane shows stays shown. */
function endSplit() {
  if (isSplit()) mergeInto(sides[0], sides.slice(1));
}
/**
 * Brings a saved layout back: every pane with its tabs, the dividers and the active pane. Each pane's shown document opens, the pane that is not the active one first, so the focus ends on the active one.
 * False, and nothing changed, when the session no longer holds a document in each pane.
 */
function restoreSplitView(session: TabSession, saved: SavedLayout): boolean {
  const order = panesOf(saved.tree), first = sides[0], entry = first.tabs.find(LIBRARY_PATH);
  if (entry) first.tabs.detach(LIBRARY_PATH);
  const lists = restorePanes(first.tabs, order.map(id => saved.panes[id]));
  if (!lists) { if (entry) first.tabs.add(entry, 0); return false; }
  libraryTab = entry;
  layout = renamePanes(saved.tree, id => PANE_IDS[order.indexOf(id)]);
  lists.slice(1).forEach((tabs, index) => createSide(PANE_IDS[index + 1], tabs, first));
  orderSides();
  for (const side of sides) { side.shown = side.tabs.active; side.pane.show(side.shown); }
  $('empty').hidden = true;
  applyLayout(); paintTabState(); paintTabs();
  // Anything else that changes the panes while the documents load (a file the app was launched with, a click on a tab, Home or a pane) ends the restore. A pane the user presses, focuses or selects while it runs stays the active one:
  // the documents still finish opening, but none of them takes the focus.
  const expected = sides.map(side => side.shown), active = sides[Math.max(0, order.indexOf(saved.active))];
  const changed = () => sides.length !== expected.length || sides.some((side, index) => side.shown !== expected[index] || side.pane.cancelPending !== undefined) || cover !== undefined;
  const run: NonNullable<typeof restoring> = { tabs: expected };
  restoring = run;
  void (async () => {
    for (const side of [...sides.filter(other => other !== active), active]) {
      if (changed()) return;
      activateSide(side);
      if (side.shown && !side.shown.reader && !side.shown.problem) {
        const opening = reopen(side.shown);
        // A load is the focused side's from its start; once it runs, the pane the user pressed in the meantime gets the focus back.
        if (run.picked) activateSide(run.picked);
        await opening;
      } else if (run.picked) activateSide(run.picked);
    }
    if (changed() || run.picked) return;
    // Home or the Library page was covering the panes: it does again, once they have opened.
    const showing = session.active === null ? undefined : session.tabs[session.active];
    if (!showing) showCover('home'); else if (showing.path === LIBRARY_PATH) showCover('library');
  })().catch(fail).finally(() => { if (restoring === run) { restoring = undefined; warmLikelyDocuments(); } });
  return true;
}

const strip = createTabStrip(
  { strip: $('tab-strip'), list: $('tab-list'), overflow: $('tab-overflow') },
  { select: selectTab, close: closeTab, newTab: () => openFile(), move: (path, to) => { if (isSplit()) return; sides[0].tabs.move(path, to); paintTabs(); saveSession(); }, menu: showTabMenu, carry },
  platform === 'mac' ? '⌘T' : 'Ctrl T',
  true,
);
/** The one context menu of the window's tabs and Home's cards (the library's own is the same component). */
const contextMenu = createContextMenu({ blocked: () => Boolean(document.querySelector('dialog[open]')) });
/** A tab's menu: Split right, Split down and Close, and while split Move to the other side (Move to pane ▸ with more than two panes), Close pane and Close the split. The Library tab only closes. */
function showTabMenu(path: string, anchor: HTMLElement, at: { x: number; y: number } | undefined) {
  const tab = known(path);
  if (!tab) return;
  const entries: MenuEntry[] = [];
  if (path !== LIBRARY_PATH) {
    entries.push({ label: 'Split right', run: () => splitTab('right', tab), unavailable: splitReason('right', tab) }, { label: 'Split down', run: () => splitTab('down', tab), unavailable: splitReason('down', tab) });
    const here = holder(path), others = sides.filter(side => side !== here);
    if (here && others.length === 1) entries.push({ label: 'Move to the other side', run: () => moveTab(path, others[0]) });
    else if (here && others.length > 1) entries.push({ label: 'Move to pane', submenu: others.map(side => ({ label: tabTitle(side.shown ?? side.tabs.tabs[0]), run: () => moveTab(path, side) })) });
  }
  if (tab.brief && desktop) {
    entries.push({
      label: 'Save brief…',
      run: () => {
        void native<string | null>('save_brief_as', { id: tab.path })
          .then(saved => { if (saved) notify(`Saved brief to ${baseName(saved)}`); })
          .catch(fail);
      },
    });
  }
  entries.push({ label: 'Close', run: () => closeTab(path) });
  if (isSplit() && path !== LIBRARY_PATH) entries.push({ label: 'Close pane', run: () => closePane(holder(path)) }, { label: 'Close the split', run: () => endSplit() });
  contextMenu.show(entries, anchor, at);
}
/** The shade over where a dragged tab would land (the half of the reading area a split would take, or the pane it would move into). */
const splitPreview = document.createElement('div');
splitPreview.id = 'split-preview'; splitPreview.hidden = true; splitPreview.setAttribute('aria-hidden', 'true');
workspace.append(splitPreview);
type Edges = { left: number; right: number; top: number; bottom: number };
/** The reading area: the workspace, less the icon rail's room on the side the library sits at (`--workspace-clear` only applies from 720 px up). */
function readingArea(): Edges {
  const box = workspace.getBoundingClientRect(), clear = paneRoomClear(), libraryRight = $('reader-layout').classList.contains('library-right');
  return { left: box.left + (libraryRight ? 0 : clear), right: box.right - (libraryRight ? clear : 0), top: box.top, bottom: box.bottom };
}
const within = (box: Edges, x: number, y: number) => x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
type Edge = 'left' | 'right' | 'top' | 'bottom';
/** Where a tab dragged out of its strip would land at this point: a slot in another pane's row, another pane (its centre), or a pane's edge (the outer quarter on a side), which splits that pane. Not split, the one pane is the reading area. */
type Landing = { kind: 'row'; to: Side; slot: number } | { kind: 'pane'; to: Side } | { kind: 'edge'; to: Side; edge: Edge };
/** The outer quarter of `box` the point is in, the nearest side in a corner; undefined in the centre. */
function zoneAt(box: Edges, x: number, y: number): Edge | undefined {
  const across = (x - box.left) / (box.right - box.left), down = (y - box.top) / (box.bottom - box.top);
  const [edge, depth] = ([['left', across], ['right', 1 - across], ['top', down], ['bottom', 1 - down]] as const).reduce((best, next) => next[1] < best[1] ? next : best);
  return depth < .25 ? edge : undefined;
}
const sideway = (edge: Edge) => edge === 'left' || edge === 'right';
/** Why a tab dropped on the `edge` of the pane `over` cannot split it now: the menus' reasons for the pane, then whether the layout that would result fits the room. Undefined when it can. */
function dropReason(path: string, over: Side, edge: Edge): string | undefined {
  const axis = sideway(edge) ? 'right' : 'down';
  if (!isSplit()) return splitReason(axis, known(path));
  const from = holder(path);
  if (!from) return 'Open a document first';
  const context = splitContext(over), reason = paneSplitReason(axis, over === from ? context : { ...context, tabs: 2 }); // Another pane's tabs are not what the split needs: the dragged tab joins it.
  if (reason) return reason;
  // A pane that was the dragged tab's only one closes, and its room goes to its sibling.
  const rest = over !== from && from.tabs.size === 1 ? removePane(layout, from.view.id) : layout;
  const result = rest && splitPane(rest, over.view.id, sideway(edge) ? 'row' : 'column', edge === 'left' || edge === 'top' ? 'before' : 'after', freeId(rest) ?? '');
  return result && fits(result, paneRect()) ? undefined : 'There is no room for another pane';
}
function landingAt(path: string, x: number, y: number): Landing | undefined {
  const tab = known(path);
  if (!tab || path === LIBRARY_PATH) return undefined; // The Library tab belongs to the window, not to a pane.
  if (isSplit()) {
    const from = holder(path), others = sides.filter(side => side !== from);
    if (!from || workspace.classList.contains('is-single')) return undefined; // Folded, the other panes' rows and pages are out of sight.
    for (const to of others) { const slot = to.strip.dropSlot(x, y); if (slot !== undefined) return { kind: 'row', to, slot }; }
    const over = !cover ? sides.find(side => within(side.view.body.getBoundingClientRect(), x, y)) : undefined;
    if (!over) return undefined;
    const edge = zoneAt(over.view.body.getBoundingClientRect(), x, y);
    if (!edge) return over === from ? undefined : { kind: 'pane', to: over };
    return dropReason(path, over, edge) ? undefined : { kind: 'edge', to: over, edge };
  }
  const area = readingArea(), edge = within(area, x, y) ? zoneAt(area, x, y) : undefined;
  return edge && !dropReason(path, sides[0], edge) ? { kind: 'edge', to: sides[0], edge } : undefined;
}
function showPreview(box: Edges) {
  const origin = workspace.getBoundingClientRect();
  Object.assign(splitPreview.style, { left: `${box.left - origin.left}px`, top: `${box.top - origin.top}px`, width: `${box.right - box.left}px`, height: `${box.bottom - box.top}px` });
  splitPreview.hidden = false;
}
/** The half of `box` on the `edge` side: what the new pane would take. */
function halfOf(box: Edges, edge: Edge): Edges {
  const middleX = (box.left + box.right) / 2, middleY = (box.top + box.bottom) / 2;
  return edge === 'left' ? { ...box, right: middleX } : edge === 'right' ? { ...box, left: middleX } : edge === 'top' ? { ...box, bottom: middleY } : { ...box, top: middleY };
}
function carryClear() { splitPreview.hidden = true; for (const side of sides) side.strip.showDrop(undefined); }
function carryOver(path: string, x: number, y: number) {
  carryClear();
  const landing = landingAt(path, x, y), tab = known(path);
  if (!landing || !tab) return;
  if (landing.kind === 'row') landing.to.strip.showDrop(landing.slot, tabTitle(tab));
  else if (landing.kind === 'pane') showPreview(landing.to.view.body.getBoundingClientRect());
  else if (!isSplit()) showPreview(halfOf(readingArea(), landing.edge));
  else { const body = landing.to.view.body.getBoundingClientRect(); showPreview(halfOf({ left: body.left, right: body.right, top: landing.to.view.row.getBoundingClientRect().top, bottom: body.bottom }, landing.edge)); }
}
function carryDrop(path: string, x: number, y: number) {
  const landing = landingAt(path, x, y);
  carryClear();
  if (landing?.kind === 'edge') dropOnEdge(path, landing.to, landing.edge);
  else if (landing) moveTab(path, landing.to, landing.kind === 'row' ? landing.slot : undefined);
}
/**
 * Splits the pane `over` along its `edge` with the dragged tab in the new pane. Not split, the left and top edges give the dragged tab the first pane (the same as the menu's Split right or Split down does for the second).
 * A tab from another pane first moves into `over` (its pane closing when that was its last tab), then `over` is split with it.
 */
function dropOnEdge(path: string, over: Side, edge: Edge) {
  const tab = known(path), before = edge === 'left' || edge === 'top';
  if (!tab) return;
  if (!isSplit()) { splitTab(sideway(edge) ? 'right' : 'down', tab, before); return; }
  const from = holder(path);
  if (!from) return;
  if (over !== from) moveTab(path, over);
  startSplit(tab, over, sideway(edge) ? 'row' : 'column', false, before ? 'before' : 'after');
}
/** A document card or row on Home: Open, Open in split right and Open in split down. */
function showHomeMenu(item: { path: string; name: string; format: string }, anchor: HTMLElement, at: { x: number; y: number } | undefined) {
  contextMenu.show([
    { label: 'Open', run: () => void openPath(item.path, item.name) },
    { label: 'Open in split right', run: () => openInSplit(item, 'right'), unavailable: openSplitReason(item.path, 'right') },
    { label: 'Open in split down', run: () => openInSplit(item, 'down'), unavailable: openSplitReason(item.path, 'down') },
  ], anchor, at);
}
$('title').onclick = () => { const menu = isSplit() ? focused.strip : strip; if (menu.isMenuOpen()) menu.closeMenu(); else menu.openMenu($('title')); };

/**
 * The Library tab: at most one, at the front of the strip. Opening it names a scope (a double-click in the panel, the panel's
 * title); a tab that is already open is shown and retargeted rather than opened again. With no scope named, an open tab is only shown.
 */
function openLibraryTab(place?: LibraryPlace) {
  const existing = known(LIBRARY_PATH);
  if (!place) { if (existing) selectTab(LIBRARY_PATH); else library.browse(); return; }
  if (existing) { retargetLibraryTab(place); selectTab(LIBRARY_PATH); return; }
  cancelOpen();
  const tab: Tab = { path: LIBRARY_PATH, name: place.title, format: 'library', scope: place.scope, options: { ...defaultOptions }, hand: false, scanNoticeShown: false };
  if (isSplit()) { libraryTab = tab; showCover('library'); paintTabs(); saveSession(); return; }
  sides[0].tabs.open(tab, 0); show(tab, true);
}
/** The Library tab's title and saved scope follow what the library shows; with no such tab, nothing is kept. */
function retargetLibraryTab(place: LibraryPlace) {
  const tab = known(LIBRARY_PATH);
  if (!tab || tab.name === place.title && tab.scope === place.scope) return;
  tab.name = place.title; tab.scope = place.scope; paintTabs(); saveSession();
}
/** Opens a library document in a tab, or shows the tab it is already in. */
function openPath(path: string, name = path.split(/[\\/]/).pop()) { return openTab(path, () => openLibraryDocument(path), name); }
/**
 * The image pager's step: the image takes the showing image tab's place (the tab keeps its slot in the strip), unless it is already open in another
 * tab, which is then shown and the showing one left as it is. With no showing image tab it opens like any other document.
 */
function stepImage(path: string) {
  const shown = focused.shown, here = shown && shown.path !== LIBRARY_PATH && Object.hasOwn(imageFormats, shown.format) && shown.path !== path ? shown : undefined;
  return openTab(path, () => openLibraryDocument(path), path.split(/[\\/]/).pop(), undefined, here);
}
/** The tab a background open added last, so the next one lands after it (as a browser's middle clicks do); forgotten when another tab is shown. */
let lastBackground: string | undefined;
/** Gives a library document a tab beside the one showing without showing it; it opens when it is first shown. */
function openInBackground(doc: { path: string; name: string; format: string }) {
  const tabs = focused.tabs, at = lastBackground && tabs.find(lastBackground) ? tabs.indexOf(lastBackground) + 1 : insertionIndex(undefined, tabs.activeIndex, tabs.size);
  if (known(doc.path) || !tabs.add({ path: doc.path, name: doc.name, format: doc.format, options: { ...defaultOptions }, hand: false, scanNoticeShown: false }, at)) return;
  lastBackground = doc.path; paintTabs(); saveSession();
}
/** `path` is the document's identity when it is known before it is read (a library path, or the path a request named). */
async function openTab(path: string | undefined, open: () => Promise<Opened | null>, label?: string, at?: number, replace?: Tab) {
  const existing = path ? known(path) : undefined;
  if (!existing) return load(open, label, { at, replace });
  existing.problem = undefined;
  if (focused.shown === existing && !cover && holder(existing.path) === focused) { if (!existing.reader) void reopen(existing); } else { selectTab(existing.path); if (!existing.reader && focused.shown === existing && !focused.pane.loadingTarget) void reopen(existing); }
  if (existing.reader) void touch(existing);
  return true;
}
/** Something to open: `path` is its identity when that is known before it is read. */
type Opener = { path?: string; open: () => Promise<Opened | null>; label: string };
/** What is being opened now: an open is single-flight (a new one cancels the one in progress), so batches wait for each other. */
let openBatches: Promise<unknown> = Promise.resolve();
/** Opens each in turn, the first at tab index `at` of `side` (the focused one when not given; after its shown tab when `at` is not given), and each new tab after the one before it. */
function openMany(items: readonly Opener[], at?: number, side?: Side): Promise<void> {
  const run = openBatches.then(async () => {
    const target = side ?? focused;
    if (sides.includes(target)) activateSide(target);
    let next = at ?? insertionIndex(undefined, focused.tabs.activeIndex, focused.tabs.size);
    for (const item of items) {
      const before = focused.tabs.size;
      await openTab(item.path, item.open, item.label, next);
      if (focused.tabs.size > before && focused.shown) next = focused.tabs.indexOf(focused.shown.path) + 1;
    }
  });
  openBatches = run.catch(() => undefined);
  return run;
}
/** Files the OS asked to open (a second instance, the command line, macOS open events): each in a new tab, in order. */
function openRequested(paths: readonly string[]) {
  void openMany(paths.map(path => ({ path, open: () => chooseDocument(path), label: baseName(path) })));
}

/** Where a drag at `point` would land: over the tab strip a marked slot, else the reading area. An app-internal drag lands only on those two. */
function dropPlace(point: { x: number; y: number }, internal: boolean) {
  const target = document.elementFromPoint(point.x, point.y);
  let side = focused, slot = isSplit() ? undefined : strip.dropSlot(point.x, point.y);
  if (isSplit()) {
    for (const candidate of sides) { const over = candidate.strip.dropSlot(point.x, point.y); if (over !== undefined) { side = candidate; slot = over; } }
    if (slot === undefined) side = sideAt(target) ?? focused;
  }
  const reading = Boolean(target?.closest('#workspace')) && !target?.closest('#library-root, #library-rail');
  return { side, slot, accepted: slot !== undefined || !internal || reading, at: insertionIndex(slot, side.tabs.activeIndex, side.tabs.size) };
}
const overlay = $('drop-overlay');
/** Shows where a drag would drop: the marker and a ghost tab over the strip, the overlay over the reading area. */
function dragOver(point: { x: number; y: number }, names: readonly string[], count: number, internal: boolean) {
  const { side, slot, accepted } = dropPlace(point, internal);
  dragEnd();
  (isSplit() ? side.strip : strip).showDrop(accepted ? slot : undefined, ghostLabel(count));
  overlay.hidden = !accepted || slot !== undefined;
  $('drop-names').textContent = overlayNames(names);
}
function dragEnd() { for (const target of [strip, ...sides.map(side => side.strip)]) target.showDrop(undefined); overlay.hidden = true; }
/** Opens what was dropped, in drop order, at the tab index the drop chose; what cannot be opened is named in one notice. */
function dropped<T>(items: readonly T[], nameOf: (item: T) => string, opener: (item: T) => Opener, place: { at: number; side: Side }) {
  const { openable, unsupported } = splitDropped(items, nameOf);
  const notice = unsupportedNotice(unsupported);
  if (notice) notify(notice);
  void openMany(openable.map(opener), place.at, place.side);
}
// A document dragged out of the library, the rail or Home onto the strip or the reading area.
attachOpenDrag({
  over: (point, source) => dragOver(point, [source.name], 1, true),
  drop: (point, source) => {
    const { accepted, at, side } = dropPlace(point, true);
    dragEnd();
    if (accepted) void openMany([{ path: source.path, open: () => openLibraryDocument(source.path), label: source.name }], at, side);
  },
  cancel: dragEnd,
});

/** Opening a document that is already open still counts as opening it: it moves to the front of the recents. */
async function touch(tab: Tab) {
  if (!tab.doc) return;
  try {
    await touchDocument(tab.doc);
    if (desktop) homeRecents = (await state()).recents;
    await library.refresh(tab.path);
  } catch (error) { fail(error); }
}
function openFile() { if (desktop) void openTab(undefined, () => chooseDocument(), undefined); else $<HTMLInputElement>('file-input').click(); }
$('empty-open').onclick = () => openFile();
$<HTMLInputElement>('file-input').onchange = event => { const input = event.target as HTMLInputElement; if (input.files?.[0]) { const file = input.files[0]; void openTab(undefined, () => browserFile(file), file.name); } input.value = ''; };
/** Gives up the pending open; every tab stays as it was. */
function cancelOpen() { activePane().cancelLoad(); $<HTMLDialogElement>('password').close(); $('loading').hidden = true; syncPageStrip(); paintTabState(); }
$('cancel').onclick = cancelOpen;
$('dismiss-notice').onclick = () => { $('notice').hidden = true; };
$('retry-save').onclick = () => { const pane = activePane(); pane.dirty = true; void pane.flush(); };
async function navigate(action: Parameters<ReaderAdapter['navigate']>[0]) { try { await activePane().reader?.navigate(action); } catch (error) { fail(error); } }
$('previous').onclick = () => void navigate('previous'); $('next').onclick = () => void navigate('next');
function jump() { const { reader, active } = activePane(); if (!reader) return; $('jump-label').textContent = reader.mode === 'fixed' ? 'Physical page number' : active?.format === 'epub' ? 'Book percentage (e.g. 35%) or chapter' : 'Source line number'; $('jump-error').textContent = ''; $<HTMLInputElement>('target').value = ''; showDialog('jump'); $<HTMLInputElement>('target').focus(); }
$('position').onclick = jump;
$('jump').querySelector('form')!.onsubmit = event => { event.preventDefault(); void activePane().reader?.goTo($<HTMLInputElement>('target').value.trim()).then(() => closeDialog($<HTMLDialogElement>('jump'))).catch(error => { $('jump-error').textContent = String(error instanceof Error ? error.message : error); }); };
async function toggle(which: 'pin' | 'lock') { if (!desktop) { notify('Pin and size lock are available in the desktop app.'); return; } try { updateWindow(await native(`set_${which}`, { enabled: !(which === 'pin' ? windowState.pinned : windowState.locked) })); } catch (error) { fail(error); } }
$('settings-toggle').onclick = () => settingsSheet.open();
/**
 * What a zoom or fit change holds still (see zoom-anchor.ts): a zoom, the centre of the view; fit width, the line at its top, so the reading
 * position survives; fit page shows the whole page and centres it. A wheel or pinch gesture passes the point under the pointer itself.
 */
const holdFor = (next: Partial<ReaderOptions>): Hold | false => next.fitted === false ? 'centre' : next.fitted && next.fit === 'width' ? 'top' : false;
async function changeOptions(next: Partial<ReaderOptions>, hold: Hold | Spot | false = holdFor(next)) {
  try { await activePane().changeOptions(next, hold, pan, showPosition); } catch (error) { fail(error); }
}
/**
 * The Contents popover. A reflowable document (EPUB, Markdown, TXT), whose pill carries the Contents button, opens it above the pill; any other document drops it from
 * the toolbar. The entry the reader is in is marked, scrolled to the middle of the list and focused, so Enter goes there and the arrow keys move from it.
 */
function openContents() {
  const dialog = $<HTMLDialogElement>('contents'), anchored = !$('view-controls').hidden && $('view-controls').classList.contains('is-reading');
  const current = fillContents($('outline-list'), activePane().reader?.outline() ?? [], activePane().reader?.currentOutline?.() ?? -1, item => { void activePane().reader?.goTo(item.target).then(() => closeDialog(dialog)).catch(fail); });
  showDialog('contents', anchored ? $('view-controls').getBoundingClientRect() : undefined);
  current?.focus({ preventScroll: true });
  current?.scrollIntoView({ block: 'center' });
}
async function action(name: string) {
  const { reader, options } = activePane();
  if (name === 'goto') jump();
  else if (name === 'appearance') settingsSheet.open('appearance');
  else if (name === 'pin' || name === 'lock') await toggle(name);
  else if (name === 'compact' || name === 'reading') { if (!desktop) return notify('Window presets are available in the desktop app.'); updateWindow(await native('set_preset', { preset: name })); }
  else if (name === 'fit-page' || name === 'fit-width') await changeOptions({ fit: name === 'fit-page' ? 'page' : 'width', fitted: true });
  else if (name === 'actual-size') await changeOptions({ fitted: false, zoom: 1 });
  else if (name === 'rotate') await changeOptions({ rotation: (options.rotation + 90) % 360 });
  else if (name === 'spread') { if (reader?.spreads) await changeOptions({ spread: !options.spread }); }
  else if (name === 'cover') await changeOptions({ cover: !options.cover });
  else if (name === 'page-strip') {
    stripWanted = !stripWanted;
    try { localStorage.setItem(stripKey, stripWanted ? 'on' : 'off'); } catch { /* Optional preference. */ }
    updateViewControls();
  }
  else if (name === 'smaller' || name === 'larger') { const direction = name === 'larger' ? 1 : -1; await changeOptions(reader?.mode === 'fixed' ? { fitted: false, zoom: stepZoom(zoomLevel(), direction, zoomLimits()) } : { fontSize: steppedFontSize(options.fontSize, direction) }); }
  else if (name === 'pages-view' || name === 'scroll-view') {
    if (!reader?.flow?.()) return notify('Pages and Scroll views are for reflowable books.');
    await changeOptions({ flow: name === 'pages-view' ? 'paginated' : 'scrolled' });
  }
  else if (name === 'type') settingsSheet.open('size');
  else if (name === 'outline') openContents();
  else if (name === 'shortcuts') showDialog('shortcuts');
  else if (name === 'clear-data') showDialog('delete-data');
  else if (name === 'clear-recents') { if (desktop) await native('clear_recents'); homeRecents = []; paintHome(); notify('Recent-file list cleared. Documents and saved positions are unchanged.'); }
  else if (['back', 'start', 'end', 'screen-next', 'screen-previous'].includes(name)) await navigate(name as Parameters<ReaderAdapter['navigate']>[0]);
}
$('confirm-delete').onclick = () => { void (async () => { await Promise.all(sides.map(side => side.pane.flush())); if (desktop) await native('clear_reading_data'); else for (const key of Object.keys(localStorage)) if (key.startsWith('hold-my-brief:')) localStorage.removeItem(key); for (const side of sides) side.pane.dirty = false; closeDialog($<HTMLDialogElement>('delete-data')); notify('Saved reading data deleted. Your documents are unchanged.'); })().catch(fail); };

// Tab marks keyboard navigation (the page's focus ring returns); a pointer press clears it.
document.addEventListener('keydown', event => { if (event.key === 'Tab') document.documentElement.classList.add('keyboard-focus'); }, true);
document.addEventListener('pointerdown', () => document.documentElement.classList.remove('keyboard-focus'), true);
// Ctrl/⌘ + wheel and a trackpad pinch zoom toward the pointer. Chromium and WebView2 report a pinch as ctrl+wheel; macOS's
// WKWebView reports it as gesture events. Both are claimed everywhere (the webview would otherwise zoom the whole interface),
// but only a page-based document moves; the zoom commits once the input pauses (see zoom-gesture.ts).
const zoomGesture = createZoomGesture({
  scroller: () => { const { reader } = activePane(); return reader?.mode === 'fixed' ? reader.scroller?.() : undefined; },
  zoom: zoomLevel,
  limits: zoomLimits,
  commit: (zoom, spot) => changeOptions({ fitted: false, zoom }, spot ?? false),
});
let pinching = false, pinchScale = 1;
/** The WebKit-only gesture events: `scale` is cumulative from the start of the pinch. */
type PinchEvent = Event & { scale: number; clientX: number; clientY: number };
/**
 * Claims Ctrl/⌘ + wheel and pinch on `doc`. `toApp` maps a point of that document to the application window (identity for the
 * application itself); `inside` says whether an event target is over the reading panel. A frame is always inside it.
 */
function claimZoomInput(doc: Document, toApp: (x: number, y: number) => ZoomPoint, inside: (target: EventTarget | null) => boolean) {
  doc.addEventListener('wheel', event => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    if (!pinching && inside(event.target)) zoomGesture.zoomBy(wheelFactor(event.deltaY, event.deltaMode), toApp(event.clientX, event.clientY));
  }, { passive: false, capture: true });
  doc.addEventListener('gesturestart', event => { event.preventDefault(); pinching = true; pinchScale = 1; }, { capture: true });
  doc.addEventListener('gesturechange', event => {
    event.preventDefault();
    const { scale, clientX, clientY } = event as PinchEvent;
    if (pinching && inside(event.target)) zoomGesture.zoomBy(scale / pinchScale, toApp(clientX, clientY));
    pinchScale = scale;
  }, { capture: true });
  doc.addEventListener('gestureend', event => { event.preventDefault(); pinching = false; zoomGesture.end(); }, { capture: true });
}
claimZoomInput(document, (x, y) => ({ x, y }), target => target instanceof Node && workspace.contains(target));
/**
 * Fixed-layout EPUB pages live in same-origin iframes whose wheel and gesture events never reach the application document
 * (the same reason the hand tool watches them, see pan.ts), so each frame claims them itself. The frame may be scaled by the
 * renderer, so a point is mapped through the frame's on-screen box.
 */
const zoomFrames = new WeakSet<Document>();
function watchFrameZoom(doc: Document) {
  if (zoomFrames.has(doc)) return;
  zoomFrames.add(doc);
  claimZoomInput(doc, (x, y) => {
    const frame = doc.defaultView?.frameElement, box = frame?.getBoundingClientRect();
    if (!frame || !box) return { x, y };
    return { x: box.left + x * box.width / (frame.clientWidth || box.width), y: box.top + y * box.height / (frame.clientHeight || box.height) };
  }, () => true);
}
document.addEventListener('keydown', event => {
  if (document.querySelector('dialog[open]')) return;
  const target = event.composedPath()[0], { reader, host } = activePane();
  // Escape closes the find bar from anywhere except its own field, which handles it itself.
  if (event.key === 'Escape' && assistant.isOpen()) { event.preventDefault(); assistant.close(); return; }
  if (event.key === 'Escape' && findBar.isOpen() && target !== findBar.element.querySelector('#find-query')) {
    event.preventDefault(); findBar.close(); host?.focus(); return;
  }
  // Ctrl+K opens the palette from anywhere, text fields included (the library search, find): it is how
  // the interface reaches every command, and a field would otherwise swallow it as typing. It needs no
  // document, so it is checked before the command table.
  if (shortcutFor(event) === 'command-palette') { event.preventDefault(); openPalette(); return; }
  if (target instanceof HTMLElement && (target.closest('input,textarea,select,[contenteditable="true"]'))) return;
  const key = event.key.toLowerCase(); let operation: (() => void) | undefined;
  const inStrip = target instanceof Node && pageStrip.element.contains(target);
  // Catalog shortcuts go through the same dispatcher as the menu and the palette.
  const shortcut = shortcutFor(event), focusDirection = shortcut ? (FOCUS_PANE_DIRECTIONS as Record<string, Direction | undefined>)[shortcut] : undefined;
  const digit = tabDigit(shortcut);
  if (digit) operation = () => selectTabNumber(digit);
  else if (shortcut === 'back') operation = () => void navigate('back');
  else if (shortcut === 'page-strip' && reader && !reader.setPreviews) return; // Only a PDF has previews; for any other document the key is not ours.
  else if (shortcut === 'split-right') operation = () => { if (isSplit()) focusNextPane(); else void command('split-right').catch(fail); };
  else if (focusDirection) operation = () => { if (isSplit()) focusPane(focusDirection); else if (focusDirection === 'left' || focusDirection === 'right') void command(focusDirection === 'left' ? 'previous-tab' : 'next-tab').catch(fail); };
  else if (shortcut) operation = () => void command(shortcut).catch(fail);
  else if (key === 'h' && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey && !event.repeat && pan.pannable && (target === document.body || target instanceof Node && (host?.contains(target) || $('view-controls').contains(target)))) operation = toggleHand;
  else if (!event.ctrlKey && !event.altKey && host && (target === document.body || target instanceof Node && (host.contains(target) || inStrip))) {
    const horizontal = target instanceof HTMLElement && target.closest('pre,table,[data-horizontal-scroll]');
    const mapping: Record<string, Parameters<ReaderAdapter['navigate']>[0]> = { pagedown: 'next', pageup: 'previous', home: 'start', end: 'end', ' ': event.shiftKey ? 'screen-previous' : 'screen-next' };
    if (reader?.mode !== 'scroll' && !horizontal) { mapping.arrowright = 'next'; mapping.arrowleft = 'previous'; }
    // Page keys turn pages from the focused strip too; its arrows, Home, End, Enter and Space are its own (it stops them before they get here).
    if (mapping[key]) operation = () => void navigate(mapping[key]);
  }
  if (operation) { event.preventDefault(); operation(); }
});
if (!desktop) {
  $('preview-note').hidden = false;
  // Files dragged in from the page's own system: any number, opened in drop order.
  const carriesFiles = (event: DragEvent) => Boolean(event.dataTransfer?.types.includes('Files'));
  const dragFiles = (event: DragEvent) => { if (carriesFiles(event)) { event.preventDefault(); dragOver({ x: event.clientX, y: event.clientY }, [], event.dataTransfer?.items.length || 1, false); } };
  document.addEventListener('dragenter', dragFiles); document.addEventListener('dragover', dragFiles);
  document.addEventListener('dragleave', event => { if (!event.relatedTarget) dragEnd(); });
  document.addEventListener('drop', event => {
    event.preventDefault(); dragEnd();
    const files = [...(event.dataTransfer?.files ?? [])];
    if (files.length) dropped(files, file => file.name, file => ({ open: () => browserFile(file), label: file.name }), dropPlace({ x: event.clientX, y: event.clientY }, false));
  });
}
/** What was opened last: the store's recents, or in the browser build the library's opened documents. */
const lastOpened = () => desktop ? homeRecents : openedOrder(homeLibrary.documents);
function paintHome() {
  const empty = $('empty');
  splashHtml ??= empty.innerHTML;
  assignShelfSlots(homeLibrary.collections);
  const recents = lastOpened();
  if (!recents.length && !homeLibrary.documents.length) {
    if (empty.classList.contains('is-home')) { closeHome(); empty.classList.remove('is-home'); empty.innerHTML = splashHtml; $('empty-open').onclick = () => openFile(); }
    return;
  }
  const sections = homeSections({ recents, documents: homeLibrary.documents, titleOf: knownTitle, progress: homeProgress });
  const generation = ++homePicture;
  renderHome(empty, sections, {
    open: (path, name) => { void openPath(path, name); },
    menu: showHomeMenu,
    picture: { can: canThumbnail, ratio: path => homeThumbs.ratio(path), peek: path => homeThumbs.peek(path) },
    banner: appearance().banner,
    ...(desktop ? { remove: (path: string) => { void native('remove_recent', { path }).then(() => { homeRecents = homeRecents.filter(item => item.path !== path); paintHome(); }).catch(fail); } } : {}),
  }, scheme());
  fillHomePictures(empty, {
    picture: (path, format) => homeThumbs.request(path, format, () => generation === homePicture && empty.classList.contains('is-home')),
    epub: path => homeThumbs.loadEpub(path, () => generation === homePicture && empty.classList.contains('is-home')),
    title: path => homeThumbs.epub(path)?.title?.trim() || undefined,
    failed: path => homeThumbs.failed(path),
    prime: paths => homeThumbs.primeRatios(paths),
    ratio: path => homeThumbs.ratio(path),
  }, () => generation === homePicture);
}
onAppearanceChange(next => {
  const home = $('empty');
  if (!home.classList.contains('is-home')) return;
  repaintCovers(home, scheme());
  // The ground repaints itself; choosing none or a pattern after the other adds or removes the ground, so Home is painted again.
  if (!repaintGround(next.banner)) paintHome();
});
async function initialize() {
  const saved = await state(); updateWindow(saved.window); if (saved.warning) notify(saved.warning);
  homeRecents = saved.recents;
  await library.refresh().catch(fail);
  homeLibrary = await getLibrary().catch(() => emptyLibrary());
  paintHome();
  for (const entry of saved.tabs.tabs) focused.tabs.open({ ...entry, options: { ...defaultOptions }, hand: false, scanNoticeShown: false });
  library.restoreScope(known(LIBRARY_PATH)?.scope);
  if (!saved.tabs.layout || !restoreSplitView(saved.tabs, saved.tabs.layout)) show(saved.tabs.active === null ? undefined : focused.tabs.tabs[saved.tabs.active], true);
  if (desktop) {
    const { listen } = await import('@tauri-apps/api/event');
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await listen<string[]>('open-request', event => openRequested(event.payload));
    await listen<WindowState>('window-state', event => updateWindow(event.payload));
    // macOS routes ⌘W through its menu (see install_menu in main.rs). With no tab to close, it closes the window as it always did.
    // macOS also routes ⌘1…⌘9 through its menu; the number arrives here instead of as a key event.
    await listen<number>('select-tab-request', event => { if (!document.querySelector('dialog[open]')) selectTabNumber(event.payload); });
    await listen('close-tab-request', () => { const tab = closableTab(); if (tab) closeTab(tab.path); else void getCurrentWindow().close(); });
    await listen<string | null>('reader-warning', event => { if (event.payload) notify(event.payload); });
    await listen<string>('file-changed', event => { void reloadOpenFile(event.payload).catch(fail); });
    await listen<{ id: string; method: string; params: unknown }>('control-request', event => {
      const { id, method, params } = event.payload;
      void handleControlRequest(controlHost, method, params).then(
        result => native('control_reply', { id, ok: true, result, error: null }),
        error => native('control_reply', { id, ok: false, result: null, error: error instanceof Error ? error.message : String(error) }),
      ).catch(() => undefined);
    });
    const controlState = await native<{ enabled: boolean; running: boolean } | null>('control_status').catch(() => null);
    setControlState(controlState);
    const appWindow = getCurrentWindow();
    let closing = false; await appWindow.onCloseRequested(async event => { if (closing) return; event.preventDefault(); await Promise.all(sides.map(side => side.pane.flush())); await flushSession(); closing = true; await appWindow.close(); });
    if (platform === 'windows') {
      const maximize = $('caption-maximize');
      const syncMaximized = async () => { const maximized = await appWindow.isMaximized(); document.documentElement.classList.toggle('window-maximized', maximized); maximize.setAttribute('aria-label', maximized ? 'Restore' : 'Maximize'); maximize.title = maximized ? 'Restore down' : 'Maximize'; };
      $('caption-minimize').onclick = () => void appWindow.minimize().catch(fail);
      maximize.onclick = () => void appWindow.toggleMaximize().catch(fail);
      // close() raises CloseRequested, so the reading position is flushed exactly as with Alt+F4.
      $('caption-close').onclick = () => void appWindow.close().catch(fail);
      await appWindow.onResized(() => void syncMaximized());
      await syncMaximized();
    }
    // Files dropped from the OS arrive as the webview's own drag-drop events (position is physical pixels). The native side has already
    // authorized what was dropped; an unauthorized path would be refused by the open command.
    const { getCurrentWebview } = await import('@tauri-apps/api/webview');
    let incoming: string[] = [];
    await getCurrentWebview().onDragDropEvent(event => {
      const payload = event.payload;
      if (payload.type === 'leave') return dragEnd();
      const point = { x: payload.position.x / devicePixelRatio, y: payload.position.y / devicePixelRatio };
      if (payload.type === 'enter') incoming = payload.paths.map(baseName);
      if (payload.type !== 'drop') return dragOver(point, incoming, incoming.length || 1, false);
      dragEnd();
      dropped(payload.paths, baseName, path => ({ path, open: () => chooseDocument(path), label: baseName(path) }), dropPlace(point, false));
    });
    // The native focus event, not the page's blur: clicking into an EPUB frame blurs the page too.
    await appWindow.onFocusChanged(({ payload: focused }) => document.documentElement.classList.toggle('window-inactive', !focused));
    if (platform === 'mac') {
      wireWindowControls(windowControls, appWindow, fail);
      // AppKit can bring its own buttons back as the window enters or leaves full screen; the page hears of that after the native
      // resize event does, so it asks the native side to hide them again once more.
      let wasFullscreen = false;
      const syncFullscreen = async () => {
        const fullscreen = await appWindow.isFullscreen();
        document.documentElement.classList.toggle('window-fullscreen', fullscreen);
        if (fullscreen !== wasFullscreen) { wasFullscreen = fullscreen; void native('reapply_window_chrome').catch(fail); }
      };
      await appWindow.onResized(() => void syncFullscreen());
      await syncFullscreen();
    }
    const pending = await native<string[]>('pending_open'); if (pending.length) openRequested(pending);
    await native('control_ready').catch(() => undefined);
  }
}
void initialize().catch(fail);
/** A reload or quit: reading positions and a pending session write go out now. `pagehide` is the event that always fires (a mobile tab discard, the back-forward cache), `beforeunload` is kept for the rest; the second finds nothing pending. */
const leaving = () => { for (const side of sides) void side.pane.flush(); void flushSession(); };
window.addEventListener('beforeunload', leaving);
window.addEventListener('pagehide', leaving);
