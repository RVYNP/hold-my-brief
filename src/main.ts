import './style.css';
import { defaultOptions, type Position, type ReaderAdapter, type ReaderOptions } from './types';
import { nudgeFor, parsePlacement, placementOf, resolvePlacement, serialisePlacement, type Placement, type Point } from './view-controls-position';
import { desktop, native, state, browserFile, persist, openExternal, confirmDocument, touchDocument, openLibraryDocument, chooseDocument, getLibrary, imageFormats, locateLibraryDocument, saveTabs, type Opened, type Recent, type WindowState } from './bridge';
import { emptyLibrary, type Library } from './catalog-types';
import { createLibrary } from './library';
import { formatProgress, progressOf, type Progress } from './progress';
import { createLibraryRail, openedOrder, railItems } from './library-rail';
import { ImageAdapter } from './adapters/image';
import { createPalette } from './palette';
import { createFindBar } from './find-bar';
import { COMMANDS, shortcutFor, shortcutReference, tabDigit, unavailableReason } from './commands';
import { appearance, initAppearance, onAppearanceChange, allPalettes, pageTones, saveAppearance, scheme, type AppearanceMode } from './theme';
import { appearanceSummary, createAppearanceSheet, paletteIcon } from './appearance';
import { createAssistantPanel } from './assistant-panel';
import { DRAG_SLOP, Panner, type Offset } from './pan';
import { MIN_SPREAD_WIDTH, pagesLabel, spreadPages } from './spread';
import { assignShelfSlots, closeHome, fillHomePictures, homeSections, homeTypes, renderHome } from './home';
import { repaintCovers } from './cards';
import { canThumbnail, createThumbnailStore } from './thumbnails';
import { createPageStrip, MIN_PANEL_HEIGHT } from './page-strip';
import { DEFAULT_LIMITS, migrateLegacyZoom, stepZoom, wheelFactor, ZOOM_MODEL, zoomPercent, type Point as ZoomPoint } from './zoom';
import { createZoomGesture } from './zoom-gesture';
import { holdView, type Anchor, type Hold, type Spot } from './zoom-anchor';
import { createZoomMenu } from './zoom-menu';
import { createProgressPreview } from './progress-preview';
import { TabList, type SavedTab } from './tabs';
import { createTabStrip, type TabView } from './tab-strip';
import { titleHints } from './tab-titles';
import { baseName, ghostLabel, insertionIndex, overlayNames, splitDropped, unsupportedNotice } from './drop';
import { attachOpenDrag } from './open-drag';
initAppearance();

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <header class="toolbar" data-tauri-drag-region><button id="library-toggle" class="icon-button" aria-label="Document library" aria-controls="library-root" aria-expanded="false" title="Document library (Ctrl+B)"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16m-3-12v8"/></svg></button><nav id="tab-strip" class="tab-strip" aria-label="Open documents" data-tauri-drag-region><button id="home-tab" class="tab-home" role="tab" aria-label="Home" title="Home"></button><div id="tab-list" class="tab-list" role="tablist" aria-label="Documents"></div><button id="tab-add" class="tab-add" aria-label="New tab" title="New tab"></button><button id="tab-overflow" class="tab-overflow" aria-label="All tabs" title="All tabs" aria-haspopup="menu" aria-expanded="false" hidden></button></nav><button id="title" class="title" aria-haspopup="menu" aria-expanded="false" title="Open tabs"><strong id="filename">Hold My Brief</strong><span id="filekind">A reader that holds.</span><span id="tab-count" class="tab-count"></span></button><button id="pin" class="icon-button" aria-label="Pin" aria-pressed="false" title="Always on top (Ctrl+Shift+T)"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg></button><button id="lock" class="icon-button" aria-label="Lock" aria-pressed="false" title="Lock dimensions (Ctrl+Shift+L)"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></button><button id="menu-toggle" class="icon-button" aria-label="Reader menu" aria-expanded="false"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg></button><div class="caption" role="group" aria-label="Window"><button id="caption-minimize" aria-label="Minimize" title="Minimize"><svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M0 5.5h10" stroke="currentColor"/></svg></button><button id="caption-maximize" aria-label="Maximize" title="Maximize"><svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" aria-hidden="true"><rect class="caption-max" x=".5" y=".5" width="9" height="9"/><path class="caption-restore" d="M2.5 2.5V.5h7v7h-2M.5 2.5h7v7h-7z"/></svg></button><button id="caption-close" aria-label="Close" title="Close"><svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" aria-hidden="true"><path d="M.5.5l9 9m0-9l-9 9"/></svg></button></div></header>
  <aside id="notice" role="status" hidden><span></span><button id="retry-save" hidden>Retry save</button><button id="dismiss-notice" aria-label="Dismiss message">×</button></aside>
  <div id="reader-layout"><div id="loading" role="status" hidden><span></span><button id="cancel">Cancel</button></div><div id="library-root"></div><nav id="library-rail"></nav>
  <main id="workspace"><section id="empty"><div class="book-mark" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="4" y="3" width="16" height="18" rx="3"/><path d="M9 3v18m4-13h3m-3 4h3"/></svg></div><p class="eyebrow">KEEP YOUR PLACE</p><h1>Hand it over.</h1><p>Drop a brief and it stays pinned<br>exactly where you leave it.</p><button id="empty-open" class="primary">Hold a brief <span>↗</span></button><p class="formats">PDF · EPUB · MARKDOWN · TEXT</p><div id="recents"></div><p id="preview-note" hidden>Browser preview · Pin and size lock are available in the desktop app.</p></section>
  <section id="tab-state" hidden><h2 id="tab-state-title"></h2><p id="tab-state-detail"></p><div class="tab-state-actions"><button id="tab-state-primary" class="primary"></button><button id="tab-state-close">Close tab</button></div></section>
  <div id="drop-overlay" hidden aria-hidden="true"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M12 18v-6M9 15h6"/></svg><strong>Drop to open in a new tab</strong><span id="drop-names"></span></div>
  <div id="view-controls" role="group" aria-label="View controls" hidden><button id="view-grip" type="button" aria-label="Move view controls" title="Drag to move · double-click to reset"><svg width="8" height="14" viewBox="0 0 8 14" fill="currentColor" aria-hidden="true"><circle cx="2" cy="3" r="1"/><circle cx="6" cy="3" r="1"/><circle cx="2" cy="7" r="1"/><circle cx="6" cy="7" r="1"/><circle cx="2" cy="11" r="1"/><circle cx="6" cy="11" r="1"/></svg></button><button id="zoom-out" aria-label="Zoom out" title="Zoom out (Ctrl −)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"/></svg></button><button id="zoom-level" type="button"><span>Fit</span><svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.5 3l2.5 2.5L6.5 3"/></svg></button><button id="zoom-in" aria-label="Zoom in" title="Zoom in (Ctrl +)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14M12 5v14"/></svg></button><span class="view-sep" aria-hidden="true"></span><button id="hand-tool" aria-label="Hand tool" aria-pressed="false" aria-disabled="false" title="Hand tool: drag to pan (H)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 11V6a2 2 0 0 0-4 0M14 10V4a2 2 0 0 0-4 0v2M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/></svg></button><span id="view-layout" class="view-group" role="group" aria-label="Page layout" hidden><span class="view-sep" aria-hidden="true"></span><button id="view-single" aria-label="Single page" aria-pressed="true" title="Single page"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg></button><button id="view-spread" aria-label="Two pages" aria-pressed="false" title="Two-page spread (Ctrl 3)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/></svg></button></span><span id="view-previews" class="view-group" hidden><span class="view-sep" aria-hidden="true"></span><button id="page-strip-toggle" aria-label="Page previews" aria-pressed="false" title="Page previews (Ctrl 4)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="10" rx="2"/><rect x="3" y="17" width="4.5" height="4" rx="1"/><rect x="9.75" y="17" width="4.5" height="4" rx="1"/><rect x="16.5" y="17" width="4.5" height="4" rx="1"/></svg></button></span></div></main>
  </div>
  <footer><button id="previous" aria-label="Previous page" title="Previous page (PgUp)" disabled>←</button><button id="position" title="Go to location (Ctrl+G)" disabled>Ready when you are</button><button id="next" aria-label="Next page" title="Next page (PgDn)" disabled>→</button><input id="progress" type="range" aria-label="Document position" title="Click or drag to jump through the document" min="0" max="100" step="1" value="0" disabled></footer>
  <dialog id="menu" aria-label="Reader menu"><div class="menu-grid">
    <div class="menu-group"><button id="menu-palette"><span class="menu-label">All commands…</span><kbd>Ctrl K</kbd></button></div>
    <div class="menu-group"><button data-action="goto">Go to… <kbd>Ctrl G</kbd></button><button data-action="outline">Contents</button><button data-action="back">Back after jump <kbd>Alt ←</kbd></button></div>
    <div class="menu-group" id="menu-page"><button id="rotate-toggle" data-action="rotate" hidden>Rotate page 90°</button><button id="spread-toggle" data-action="spread" aria-pressed="false" disabled hidden>Two-page spread <kbd>Ctrl 3</kbd></button><button id="cover-toggle" data-action="cover" aria-pressed="true" disabled hidden>Cover page alone</button></div>
    <div class="menu-group"><button data-action="appearance"><span class="menu-label">${paletteIcon}Appearance and text…</span><span class="menu-value" id="appearance-summary"></span></button><button data-action="assistant" data-desktop hidden>AI assistant…</button><button data-action="compact" data-desktop hidden>Compact window <span class="menu-value">420 × 620</span></button><button data-action="reading" data-desktop hidden>Reading window <span class="menu-value">760 × 900</span></button></div>
    <div class="menu-group"><button data-action="shortcuts">Keyboard shortcuts</button><button data-action="clear-recents">Clear recent files</button><button data-action="clear-data">Delete saved reading data…</button></div>
  </div></dialog>
  <dialog id="jump" class="drop" aria-labelledby="jump-label"><form><label id="jump-label" for="target">Location</label><div class="jump-row"><input id="target" required autocomplete="off"><button class="primary" type="submit" aria-label="Go to location">Go</button></div><p id="jump-error" role="alert"></p></form></dialog>
  <dialog id="password"><form><h2>Password required</h2><label for="secret">Document password</label><input id="secret" type="password" autocomplete="off"><div class="dialog-actions"><button type="button" data-close>Cancel</button><button type="submit" class="primary">Open document</button></div></form></dialog>
  <dialog id="contents" class="drop" aria-label="Contents"><div id="outline-list"></div></dialog>
  <dialog id="appearance"></dialog>
  <dialog id="shortcuts" aria-labelledby="shortcuts-title" tabindex="-1" autofocus><div class="dialog-head"><h2 id="shortcuts-title">Keyboard shortcuts</h2><button data-close aria-label="Close shortcuts">×</button></div><div id="shortcut-list"></div></dialog>
  <dialog id="delete-data"><h2>Delete saved reading data?</h2><p>This removes saved positions and reading settings. Your documents and recent-file list remain. The current position will be saved again when you navigate.</p><div class="dialog-actions"><button data-close>Cancel</button><button id="confirm-delete" class="danger">Delete reading data</button></div></dialog>
  <input id="file-input" type="file" accept=".pdf,.epub,.md,.markdown,.txt,.png,.jpg,.jpeg,.webp,.gif,.avif,.bmp" hidden>`;
// The window frame is drawn by the reader on both desktop systems. macOS keeps its own traffic lights
// over the toolbar's left end (titleBarStyle Overlay); Windows loses its native caption (see
// windows::restore) and gets minimize, maximize and close buttons at the toolbar's right end.
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
const appearanceSheet = createAppearanceSheet($<HTMLDialogElement>('appearance'), {
  current: () => reader && active && reader.mode !== 'fixed' ? { fontSize: options.fontSize, lineHeight: options.lineHeight, margin: options.margin, wrap: options.wrap, wraps: active.format === 'txt' } : undefined,
  change: next => changeOptions(next),
});
const scrubber = $<HTMLInputElement>('progress');
let scrubbing = false, scrubRequest = 0;
let reader: ReaderAdapter | undefined;
let active: Opened | undefined;
let options: ReaderOptions = { ...defaultOptions };
let position: Position | undefined;
let windowState: WindowState = { width: 420, height: 620, pinned: false, locked: false };
let homeRecents: Recent[] = [];
let homeLibrary: Library = emptyLibrary();
let homeProgress: Record<string, Progress> = {};
let homeFormat = '';
let splashHtml: string | undefined;
let homePicture = 0;
const homeThumbs = createThumbnailStore();
let request = 0, dirty = false, saveTimer: ReturnType<typeof setTimeout> | undefined;
let saveQueue = Promise.resolve();
let activeHost: HTMLElement | undefined;
let cancelPending: (() => void) | undefined;
const pan = new Panner();
let pannedScroller: HTMLElement | undefined;
/**
 * The documents open as tabs. `reader`, `active`, `options`, `position`, `activeHost`, `pannedScroller` and `scanNoticeShown` above
 * are the working copy of the tab that is showing (`shown`); `leave` takes them back into the tab, `enter` loads the next tab's into them.
 * Every other tab holds its own reader and host (live) or only its saved place (hibernated), see `hibernate`.
 */
type Tab = {
  path: string; name: string; format: string;
  doc?: Opened; reader?: ReaderAdapter; host?: HTMLElement;
  options: ReaderOptions; position?: Position; hand: boolean; stripScroll?: number; find?: string; scanNoticeShown: boolean;
  /** Where a hibernated tab picks up again; absent for a tab never opened this session, which takes its saved place from the store. */
  resume?: { locator: Position['locator']; options: ReaderOptions };
  problem?: { kind: 'missing' | 'failed'; message: string };
};
const tabs = new TabList<Tab>();
let shown: Tab | undefined;
/** The tab a pending open is filling, while the loading notice is up. */
let loadingTarget: Tab | undefined;
/** The scan notice is shown once per opened document; opening a document re-arms it. */
let scanNoticeShown = false;

function notify(message: string, retry = false) { $('notice').hidden = false; $('notice').querySelector('span')!.textContent = message; $('retry-save').hidden = !retry; }
// A select-drag on a page without text selects nothing. Say why, once, when the user shows that intent:
// primary button, hand tool off, past the same slop a pan uses, on a page marked image-only.
document.addEventListener('pointerdown', down => {
  const target = down.target;
  if (scanNoticeShown || down.button !== 0 || !down.isPrimary || down.pointerType === 'touch' || pan.hand || !(target instanceof Element)
    || !activeHost?.contains(target) || !target.closest('[data-image-only]') || !reader?.getPosition().imageOnly) return;
  const move = (e: PointerEvent) => {
    if (e.pointerId !== down.pointerId) return;
    if (!(e.buttons & 1)) return end();
    if (Math.hypot(e.clientX - down.clientX, e.clientY - down.clientY) < DRAG_SLOP) return;
    end(); scanNoticeShown = true; notify("This page is a scanned image, so its text can't be selected or searched.");
  };
  const end = () => { for (const type of ['pointermove', 'pointerup', 'pointercancel']) window.removeEventListener(type, move as EventListener, true); };
  window.addEventListener('pointermove', move, true); window.addEventListener('pointerup', end, true); window.addEventListener('pointercancel', end, true);
}, true);
function fail(error: unknown) { notify(error instanceof Error ? error.message : String(error)); }
function updateWindow(next: WindowState) { windowState = next; $('pin').setAttribute('aria-pressed', String(next.pinned)); $('pin').title = next.pinned ? 'Pinned on top (Ctrl+Shift+T)' : 'Always on top (Ctrl+Shift+T)'; $('lock').setAttribute('aria-pressed', String(next.locked)); $('lock').title = next.locked ? 'Size locked (Ctrl+Shift+L)' : 'Lock dimensions (Ctrl+Shift+L)'; $<HTMLButtonElement>('caption-maximize').disabled = next.locked; }
function showPosition(p: Position, save = true) {
  position = p;
  const percent = Math.max(0, Math.min(100, p.fraction * 100));
  const label = active?.format === 'epub' && reader?.mode === 'paginated' ? `${p.label} position` : `${p.label} · ${reader?.mode === 'fixed' ? '' : '≈'}${Math.round(percent)}% position`;
  if (!scrubbing) {
    $('position').textContent = label; $('position').title = `${label} · Go to location (Ctrl+G)`;
    scrubber.min = p.scrub.unit === 'percent' ? '0' : '1';
    scrubber.max = String(p.scrub.total);
    scrubber.step = p.scrub.unit === 'percent' ? '0.1' : '1';
    scrubber.value = String(p.scrub.current);
    scrubber.disabled = Number(scrubber.max) <= Number(scrubber.min);
    updateScrubValue();
  }
  if (save) { dirty = true; clearTimeout(saveTimer); saveTimer = setTimeout(() => void flush(), 650); }
  updateViewControls();
}
function updateScrubValue(preview = false) {
  if (!position) return;
  const value = scrubber.valueAsNumber, min = Number(scrubber.min), max = Number(scrubber.max);
  const cover = position.scrub.cover;
  const label = position.scrub.unit === 'percent' ? `${value.toFixed(1)}% position`
    : cover !== undefined ? pagesLabel(spreadPages(value, max, cover), max)
    : `${position.scrub.unit === 'page' ? 'Page' : 'Line'} ${value} of ${max}`;
  scrubber.style.setProperty('--scrub-fill', `${max > min ? (value - min) / (max - min) * 100 : 0}%`);
  scrubber.setAttribute('aria-valuenow', String(value));
  scrubber.setAttribute('aria-valuetext', label);
  if (preview) $('position').textContent = `${label} · release to jump`;
}
/** The level the open document is drawn at; before it is drawn, 100 %. */
const zoomLevel = () => reader?.zoomLevel?.() ?? (options.fitted ? 1 : options.zoom);
const zoomLimits = () => reader?.zoomLimits?.() ?? DEFAULT_LIMITS;
/** Syncs the view-controls pill, page-layout toggles and the title subtitle with the current position, zoom, layout and hand-tool state. */
function updateViewControls() {
  if (!reader || !active) return;
  syncPageStrip();
  // Fixed-layout EPUB rebuilds its renderer when the page layout changes; follow it.
  const scroller = reader.scroller?.();
  if (scroller !== pannedScroller) { pannedScroller = scroller; pan.attach(scroller, activeHost); }
  pan.refresh(position?.spread, options.fitted);
  // The level is always the real scale; a fit is a mode that follows the window, and the adapter says what scale it came to.
  const fitted = options.fitted, width = options.fit === 'width', current = zoomLevel();
  const level = `${zoomPercent(current)}%`;
  const layout = position?.spread, waiting = layout === 'waiting' ? `Two pages appear when the reading area is at least ${MIN_SPREAD_WIDTH} px wide` : '';
  const kind = reader.mode === 'fixed' && fitted && !width && layout === 'active' ? 'Two-page view'
    : `${reader.mode !== 'fixed' ? (reader.mode === 'paginated' ? 'Reading view' : 'Scroll view') : fitted ? (width ? 'Fit width' : 'Page view') : level}${layout === 'active' ? ' · Two pages' : ''}`;
  // The subtitle says where you are, compactly ("48 / 146", without a PDF's printed page number);
  // the full position and the kind of view are in its tooltip.
  const where = position?.label ?? '';
  // An image-only page is announced here, never drawn over the page. Find reports the same limit.
  const imageOnly = position?.imageOnly ? "Image-only page: text can't be selected or searched" : '';
  $('filekind').textContent = where.replace(/^(?:Pages?|Line) ([\d–-]+) of (\d+)(?: · .*)?$/, '$1 / $2');
  paintTabs();
  $('filekind').title = [where, `${active.format.toUpperCase()} · ${kind}${pan.hand ? ' · Hand' : ''}`, imageOnly, waiting].filter(Boolean).join('\n');
  const spreads = !!reader.spreads, spread = spreads && options.spread;
  const toggles = [$<HTMLButtonElement>('spread-toggle'), $<HTMLButtonElement>('view-spread')];
  for (const button of toggles) {
    button.setAttribute('aria-pressed', String(spread));
    if (waiting) button.setAttribute('aria-description', waiting); else button.removeAttribute('aria-description');
  }
  $<HTMLButtonElement>('spread-toggle').disabled = !spreads;
  $<HTMLButtonElement>('spread-toggle').title = waiting;
  $('view-spread').title = waiting ? `Two-page spread (Ctrl 3) · ${waiting}` : 'Two-page spread (Ctrl 3)';
  $('view-single').setAttribute('aria-pressed', String(!spread));
  const cover = $<HTMLButtonElement>('cover-toggle');
  cover.disabled = !spread || reader.mode !== 'fixed'; cover.setAttribute('aria-pressed', String(options.cover));
  // The menu offers page commands only where they do something: rotation for page-based documents,
  // spreads where the adapter has them, cover pairing for page spreads.
  $('rotate-toggle').hidden = reader.mode !== 'fixed';
  $('spread-toggle').hidden = !spreads;
  cover.hidden = !spreads || reader.mode !== 'fixed';
  $('view-layout').hidden = !spreads;
  // Page previews are a PDF feature: the toggle is offered only where the adapter has them, and says why when a short panel hides the strip.
  const previewable = Boolean(reader.setPreviews), hidden = previewable && stripWanted && workspace.clientHeight < MIN_PANEL_HEIGHT ? `Hidden while the reading area is shorter than ${MIN_PANEL_HEIGHT} px` : '';
  $('view-previews').hidden = !previewable;
  $('page-strip-toggle').setAttribute('aria-pressed', String(stripWanted));
  $('page-strip-toggle').title = hidden ? `Page previews (Ctrl 4) · ${hidden}` : 'Page previews (Ctrl 4)';
  if (hidden) $('page-strip-toggle').setAttribute('aria-description', hidden); else $('page-strip-toggle').removeAttribute('aria-description');
  $('view-controls').hidden = !pan.pannable;
  if (!pan.pannable) { zoomMenu.close(); return; }
  // The level opens the zoom menu; double-clicking it still toggles fit page/fit width (while zoomed it first returns to the current fit).
  const next = fitted && !width ? 'fit-width' : fitted ? 'fit-page' : `fit-${options.fit}`;
  const levelButton = $('zoom-level');
  levelButton.querySelector('span')!.textContent = level; levelButton.dataset.next = next; levelButton.dataset.fit = fitted ? options.fit : '';
  levelButton.setAttribute('aria-label', `Zoom menu, ${level}${fitted ? `, ${width ? 'fit width' : 'fit page'}` : ''}`);
  levelButton.title = `${fitted ? `${width ? 'Fit width' : 'Fit page'} · ${level}` : `Zoom ${level}`} · click for zoom options · double-click for ${next === 'fit-width' ? 'fit width (Ctrl 2)' : 'fit page (Ctrl 0)'}`;
  const limits = zoomLimits(), canZoomOut = stepZoom(current, -1, limits) < current - .004, canZoomIn = stepZoom(current, 1, limits) > current + .004;
  $<HTMLButtonElement>('zoom-out').disabled = !canZoomOut;
  $<HTMLButtonElement>('zoom-in').disabled = !canZoomIn;
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
$('view-single').onclick = () => void changeOptions({ spread: false });
$('view-spread').onclick = () => void changeOptions({ spread: true });
$('page-strip-toggle').onclick = () => void command('page-strip').catch(fail);
// Movable pill: the grip drags it anywhere in the reading panel. Without a stored position the CSS
// placement stands untouched; with one, inline left/top (kept as centre fractions of the panel so a
// resize keeps it proportional) win, clamped inside the panel and clear of an open library drawer.
const pillKey = 'hold-my-brief:view-controls', pill = $('view-controls'), grip = $('view-grip'), workspace = $('workspace');
let pillPlacement: Placement | null = null;
try { pillPlacement = parsePlacement(localStorage.getItem(pillKey)); } catch { /* Optional preference. */ }
const pillPanel = () => ({ width: workspace.clientWidth, height: workspace.clientHeight });
const pillBox = () => ({ width: pill.offsetWidth, height: pill.offsetHeight });
/**
 * How much of the panel's bottom the pill keeps above: the page-preview strip and the footer lane under it, or the image-navigation
 * pill and the footer lane under that (an image document has the second, a PDF the first, never both).
 */
const pillStrip = () => {
  const bottom = workspace.getBoundingClientRect().bottom;
  const covered = (element: Element | null) => element ? Math.max(0, bottom - element.getBoundingClientRect().top) : 0;
  return Math.max(workspace.classList.contains('has-page-strip') ? covered(pageStrip.element) : 0, workspace.classList.contains('has-image-navigation') ? covered(workspace.querySelector('.library-image-navigation')) : 0);
};
function drawerBand() {
  // The compact sheet covers the whole layout over a scrim; only the side-by-side drawer, or the rail that stands in for it, is steered around.
  if (matchMedia('(max-width: 719px)').matches) return null;
  const drawer = $($('reader-layout').classList.contains('library-open') ? 'library-root' : 'library-rail').getBoundingClientRect(), panel = workspace.getBoundingClientRect();
  return { left: drawer.left - panel.left - workspace.clientLeft, right: drawer.right - panel.left - workspace.clientLeft };
}
function showPill(point: Point | null) {
  const values = point ? [`${point.left}px`, `${point.top}px`, 'auto', 'auto', 'none'] : ['', '', '', '', ''];
  ['left', 'top', 'right', 'bottom', 'translate'].forEach((name, index) => pill.style.setProperty(name, values[index]));
}
function placePill() {
  if (!pillPlacement) return showPill(null);
  const size = pillBox();
  if (size.width) showPill(resolvePlacement(pillPlacement, pillPanel(), size, drawerBand(), pillStrip())); // A hidden pill has no size to place.
}
/** Moves the pill to the clamped, drawer-clear form of `point` and remembers what is actually on screen. */
function movePill(point: Point, save: boolean) {
  const panel = pillPanel(), size = pillBox(), resolved = resolvePlacement(placementOf(point, panel, size), panel, size, drawerBand(), pillStrip());
  pillPlacement = placementOf(resolved, panel, size); showPill(resolved);
  if (save) try { localStorage.setItem(pillKey, serialisePlacement(pillPlacement)); } catch { /* Optional preference. */ }
}
function resetPill() { pillPlacement = null; showPill(null); try { localStorage.removeItem(pillKey); } catch { /* Optional preference. */ } }
/** The pill's rendered top-left in panel pixels, wherever the CSS or a stored position put it. */
function pillPoint(): Point {
  const box = pill.getBoundingClientRect(), panel = workspace.getBoundingClientRect();
  return { left: box.left - panel.left - workspace.clientLeft, top: box.top - panel.top - workspace.clientTop };
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
const viewChanged = () => { cancelAnimationFrame(viewFrame); viewFrame = requestAnimationFrame(() => { updateViewControls(); placePill(); }); };
// The panel, the pill itself (shown, or resized by the layout toggle) and the library drawer all change where it may sit.
const viewObserver = new ResizeObserver(viewChanged);
for (const element of [workspace, pill, $('library-root')]) viewObserver.observe(element);
new MutationObserver(viewChanged).observe($('reader-layout'), { attributes: true, attributeFilter: ['class'] });
new MutationObserver(viewChanged).observe(workspace, { attributes: true, attributeFilter: ['class'] }); // The image navigation appearing or going takes or gives back the pill's lane.
// Page previews (PDF): a filmstrip of the document in a fixed band under the reading surface. The preference is global and
// off until chosen; the band is shown only for a document that has previews and a panel tall enough to spare
// it. It is room the reading surface leaves (CSS, `has-page-strip`), not a row in the page's flow, so turning
// a page never resizes what the page was fitted to.
const stripKey = 'hold-my-brief:page-strip', pageStrip = createPageStrip(fail);
let stripWanted = false, stripReader: ReaderAdapter | undefined;
try { stripWanted = localStorage.getItem(stripKey) === 'on'; } catch { /* Optional preference. */ }
workspace.append(pageStrip.element);
/** Reserves or releases the strip's room for the document `adapter` shows; true when the strip is shown. */
function stripSpace(adapter: ReaderAdapter | undefined) {
  // Measured on the panel, which the strip never resizes, so showing the strip cannot hide it again.
  const shown = Boolean(adapter?.setPreviews) && stripWanted && workspace.clientHeight >= MIN_PANEL_HEIGHT;
  if (workspace.classList.contains('has-page-strip') !== shown) {
    workspace.classList.toggle('has-page-strip', shown); pageStrip.element.hidden = !shown;
    placePill();
  }
  return shown;
}
/** Points the strip at the open document while it is shown, and away from it otherwise. */
function syncPageStrip() {
  const feeder = stripSpace(reader) ? reader : undefined;
  if (feeder === stripReader) return;
  stripReader?.setPreviews?.(undefined); pageStrip.clear();
  stripReader = feeder; feeder?.setPreviews?.(pageStrip.sink);
}
// Hovering or dragging the progress bar previews the page under the pointer (PDF only: the other formats have no pages to draw).
createProgressPreview(scrubber, $('app'), () => reader?.thumbnails && position?.scrub.unit === 'page'
  ? { source: reader.thumbnails, spread: position.spread === 'active', cover: position.scrub.cover !== false, total: position.scrub.total } : undefined);
scrubber.oninput = () => { scrubbing = true; ++scrubRequest; updateScrubValue(true); };
scrubber.onchange = () => {
  if (!reader || !position) return;
  const current = reader, token = ++scrubRequest, value = scrubber.value;
  const unit = position.scrub.unit;
  scrubbing = true;
  const jump = unit !== 'page' && value === scrubber.max ? current.navigate('end')
    : current.goTo(unit === 'percent' ? `${value}%` : value);
  void jump.catch(error => { if (reader === current) fail(error); }).finally(() => {
    if (reader !== current || token !== scrubRequest) return;
    scrubbing = false; showPosition(current.getPosition());
  });
};
scrubber.onpointercancel = () => {
  ++scrubRequest; scrubbing = false;
  if (reader) showPosition(reader.getPosition());
};
function flush(): Promise<void> {
  if (!active || !position || !dirty) return saveQueue;
  const doc = active, loc = structuredClone(position.locator), prefs = { ...options }, progress = progressOf(position); dirty = false;
  saveQueue = saveQueue.then(() => persist(doc, loc, prefs, progress)).catch(() => { if (active?.id === doc.id) dirty = true; notify('Progress could not be saved. Reading is still available.', true); });
  return saveQueue;
}
setInterval(() => { if (dirty) void flush(); }, 1500);
// Go to and Contents drop from the toolbar under the title, like the palette, instead of centring on a
// dimmed page; a click outside closes them.
function showDialog(id: string) {
  const dialog = $(id);
  if (!(dialog instanceof HTMLDialogElement)) return;
  if (dialog.classList.contains('drop')) {
    const title = ($('tab-strip').offsetParent ? $('tab-strip') : $('title')).getBoundingClientRect(), width = Math.min(320, innerWidth - 12);
    dialog.style.top = `${Math.round($('title').closest('header')!.getBoundingClientRect().bottom + 4)}px`;
    dialog.style.left = `${Math.round(Math.max(6, Math.min(title.left, innerWidth - width - 6)))}px`;
  }
  dialog.showModal();
  // A dialog marked autofocus (a reference with nothing to fill in) takes focus itself rather than
  // ringing its close button; not every engine honours the attribute on <dialog>.
  if (dialog.hasAttribute('autofocus')) dialog.focus();
}
function closeDialog(dialog: HTMLDialogElement) { dialog.close(); activeHost?.focus(); $('menu-toggle').setAttribute('aria-expanded', 'false'); }
document.querySelectorAll<HTMLDialogElement>('dialog').forEach(dialog => { dialog.addEventListener('close', () => { activeHost?.focus(); if (dialog.id === 'menu') $('menu-toggle').setAttribute('aria-expanded', 'false'); }); });
document.querySelectorAll<HTMLElement>('[data-close]').forEach(button => button.onclick = () => closeDialog(button.closest('dialog')!));
document.querySelectorAll<HTMLDialogElement>('dialog.drop').forEach(dialog => dialog.addEventListener('click', event => {
  const box = dialog.getBoundingClientRect();
  if (event.target === dialog && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom)) closeDialog(dialog);
}));
const library = createLibrary($('library-root'), {
  open: path => openPath(path),
  error: fail,
  changed: (next, progress) => { homeLibrary = next; homeProgress = { ...progress }; if ($('empty').classList.contains('is-home')) paintHome(); paintRail(); },
  progressChanged: progress => { homeProgress = { ...progress }; if ($('empty').classList.contains('is-home')) paintHome(); paintRail(); },
  settle: () => flush(),
  sideChanged: side => rail.setSide(side),
});
$('library-toggle').onclick = () => library.toggle();
// The library closed is a rail of the latest recents. It shares Home's picture store, so a cover made for one is there for the other.
const rail = createLibraryRail($('library-rail'), {
  toggle: () => library.toggle(),
  open: (path, name) => { void openPath(path, name); },
  picture: (path, format, alive) => homeThumbs.request(path, format, alive),
  peek: path => homeThumbs.peek(path),
  epub: (path, alive) => homeThumbs.loadEpub(path, alive),
  title: path => homeThumbs.epub(path)?.title?.trim() || undefined,
  failed: path => homeThumbs.failed(path),
  setSide: side => library.setSide(side),
});
rail.setSide(library.side());
const knownTitle = (item: { path: string; format: string }) => item.format.toLowerCase() === 'epub' ? homeThumbs.epub(item.path)?.title?.trim() || undefined : undefined;
function paintRail() { rail.paint(railItems(desktop ? homeRecents : openedOrder(homeLibrary.documents), homeLibrary.documents, knownTitle, homeProgress), active?.path, scheme()); }

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
      hasDocument: () => Boolean(reader), format: () => active?.format, desktop, run: id => command(id),
      goTo: target => { const current = reader; return current?.goTo(target).then(() => activeHost?.focus(), error => { if (reader === current) fail(error); }); },
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
  target: () => reader,
  formatIsImage: () => Boolean(active && Object.hasOwn(imageFormats, active.format)),
  onError: fail,
});
// Inside the reading panel, so it pushes the document down rather than covering it.
$('workspace').prepend(findBar.element);

/**
 * The opt-in assistant (desktop only, off until the user saves an Anthropic key). It reaches the
 * reader only through these functions, the same paths the palette, menu and keyboard use.
 */
const assistant = createAssistantPanel($('reader-layout'), {
  desktop, openExternal,
  returnFocus: () => activeHost?.focus(),
  env: {
    hasDocument: () => Boolean(reader),
    snapshot: () => ({
      document: active && reader ? { name: active.name, format: active.format, position: reader.getPosition().label, view: $('filekind').title } : null,
      window: desktop ? { pinned: windowState.pinned, sizeLocked: windowState.locked } : 'browser preview',
      appearance: appearanceSummary(),
      libraryOpen: $('library-toggle').getAttribute('aria-expanded') === 'true',
    }),
    goTo: async target => { const current = reader!; await current.goTo(target); return current.getPosition().label; },
    readText: async limit => reader?.readText?.(limit),
    search: async (query, options) => reader?.search?.(query, options),
    showMatch: async hit => { const current = reader!; await current.revealSearchMatch?.(hit); return current.getPosition().label; },
    outline: () => reader?.outline() ?? [],
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
      const reason = unavailableReason(entry, { hasDocument: Boolean(reader), desktop, format: active?.format });
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
  const reason = entry && unavailableReason(entry, { hasDocument: Boolean(reader), desktop, format: active?.format });
  if (reason) { notify(reason); return; }
  if (id === 'open' || id === 'new-tab') openFile();
  else if (id === 'close-tab') { if (shown) closeTab(shown.path); }
  else if (id === 'next-tab' || id === 'previous-tab') { const next = tabs.neighbour(id === 'next-tab' ? 1 : -1); if (next) selectTab(next.path); }
  else if (id === 'library') library.toggle();
  else if (id === 'library-board') library.board();
  else if (id === 'library-side') library.setSide(library.side() === 'left' ? 'right' : 'left');
  else if (id === 'find') findBar.open();
  else if (id === 'assistant') assistant.openSettings();
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
 */
async function load(open: () => Promise<Opened | null>, label = 'document', { target, at }: { target?: Tab; at?: number } = {}): Promise<boolean> {
  const token = ++request; cancelPending?.();
  loadingTarget = target; paintTabState();
  $('loading').hidden = false; $('loading').querySelector('span')!.textContent = `Opening ${label}…`;
  let candidate: ReaderAdapter | undefined, staging: HTMLElement | undefined, opening = true;
  const urls: string[] = [];
  cancelPending = () => { candidate?.destroy(); staging?.remove(); for (const url of urls) URL.revokeObjectURL(url); };
  try {
    await flush(); const doc = await open(); if (!doc || token !== request) return false;
    opening = false;
    // A dialog or a CLI request only now says which document it is: if it is already open, that tab is the one to fill or show.
    const tab = target ?? tabs.find(doc.path) ?? { path: doc.path, name: doc.name, format: doc.format, options: { ...defaultOptions }, hand: false, scanNoticeShown: false };
    if (tab.reader) { doc.bytes = new Uint8Array(); selectTab(tab.path); void touch(tab); return true; }
    if (tab.resume) doc.previousState = { locator: tab.resume.locator, options: tab.resume.options };
    $('loading').querySelector('span')!.textContent = `Opening ${doc.name}…`;
    candidate = await adapter(doc.format); if (token !== request) return false;
    stripSpace(candidate); // A page-preview strip's room is there before the document is fitted, so opening never refits it.
    staging = document.createElement('section'); staging.className = 'reader-host staging'; staging.tabIndex = 0; staging.setAttribute('aria-label', 'Reading surface'); $('view-controls').before(staging);
    // Options saved before zoom was a true scale hold a multiplier of the fit. They open fitted and are converted below, once the document is drawn, so the page keeps its size; saving then writes the new form.
    const saved = doc.previousState?.options, legacy = Boolean(saved) && saved!.zoomModel !== ZOOM_MODEL, legacyZoom = Number(saved?.zoom);
    const prefs: ReaderOptions = { ...defaultOptions, ...saved, zoomModel: ZOOM_MODEL, ...(legacy ? { fitted: true, zoom: 1 } : {}) };
    const current = candidate;
    await candidate.open({ ...doc, bytes: doc.bytes }, staging, {
      // The tab showing hears its reader fully; a live tab out of sight only keeps the place.
      onPosition: p => { if (reader === current) showPosition(p); else if (tab.reader === current) tab.position = p; }, onError: fail, openExternal, requestPassword: password, onFrame: doc => { pan.watchFrame(doc); watchFrameZoom(doc); },
      resolveImage: desktop ? async relative => { const result = await native<{bytes: number[]; mime: string}>('read_relative_image', { path: doc.path, relative }); const url = URL.createObjectURL(new Blob([new Uint8Array(result.bytes)], { type: result.mime })); urls.push(url); return url; } : undefined,
    }, prefs);
    if (doc.previousState?.locator) await candidate.restore(doc.previousState.locator);
    if (legacy && candidate.mode === 'fixed') {
      const converted = migrateLegacyZoom({ fit: prefs.fit, zoom: legacyZoom }, candidate.legacyZoomBase?.(prefs.fit), candidate.zoomLimits?.());
      if (!converted.fitted) { Object.assign(prefs, converted); await candidate.setOptions(prefs); }
    }
    if (token !== request) return false;
    await confirmDocument(doc).catch(error => notify(`Your library could not be saved. Reading is still available. ${error instanceof Error ? error.message : String(error)}`));
    await flush();
    if (token !== request) return false;
    doc.bytes = new Uint8Array();
    Object.assign(tab, { name: doc.name, format: doc.format, doc, reader: candidate, host: staging, options: prefs, position: candidate.getPosition(), hand: false, stripScroll: undefined, find: undefined, scanNoticeShown: false, resume: undefined, problem: undefined });
    staging.classList.remove('staging'); staging.classList.add('tab-hidden'); // `enter` shows it
    if (!tabs.find(tab.path)) tabs.open(tab, at);
    tabs.markLive(tab.path);
    show(tab, true);
    showPosition(candidate.getPosition()); // A reopened or converted document saves its place and options again.
    staging.focus(); candidate = undefined; staging = undefined; cancelPending = undefined;
    if (doc.warning) notify(doc.warning);
    if (tab.format === 'epub') void homeThumbs.loadEpub(tab.path, () => Boolean(tabs.find(tab.path))).then(() => paintTabs());
    if (desktop) homeRecents = (await state()).recents; // The store moves the opened document to the front.
    await library.refresh(doc.path).catch(fail);
    return true;
  } catch (error) {
    if (token === request) {
      fail(error);
      if (target && !target.reader) { target.problem = { kind: opening ? 'missing' : 'failed', message: error instanceof Error ? error.message : String(error) }; }
    }
    return false;
  }
  finally { candidate?.destroy(); staging?.remove(); if (token === request) { $('loading').hidden = true; cancelPending = undefined; loadingTarget = undefined; syncPageStrip(); paintTabState(); } }
}

/** Takes the showing tab's working copy back into the tab, saves its place, and puts it out of sight. */
function leave(tab: Tab) {
  void flush();
  if (tab.reader && tab.reader === reader) { tab.options = options; tab.position = position; tab.hand = pan.hand; tab.scanNoticeShown = scanNoticeShown; tab.stripScroll = pageStrip.scrollPosition(); }
  tab.find = findBar.isOpen() ? findBar.query() : undefined;
  tab.host?.classList.add('tab-hidden');
  findBar.close(); zoomGesture.cancel();
}

/** Frees a tab's reader and host, keeping where it was (and how it was viewed) so showing it again reopens it there. */
function hibernate(tab: Tab) {
  if (!tab.reader) return;
  let locator = tab.position?.locator;
  try { locator = tab.reader.getPosition().locator; } catch { /* Keep the last reported place. */ }
  if (locator) tab.resume = { locator: structuredClone(locator), options: { ...tab.options } };
  tab.reader.destroy(); tab.host?.remove();
  tab.reader = tab.host = undefined;
  tabs.markHibernated(tab.path);
}

/** Shows `next` (or Home, for none): the one place the working copy changes hands. */
function show(next: Tab | undefined, refreshed = false) {
  if (shown === next && !refreshed) return;
  if (shown && shown !== next) leave(shown);
  shown = next; tabs.activate(next?.path);
  reader = next?.reader; active = next?.doc; options = next?.options ?? { ...defaultOptions }; position = next?.position; activeHost = next?.host;
  scanNoticeShown = next?.scanNoticeShown ?? false; ++scrubRequest; scrubbing = false;
  for (const path of tabs.hibernation()) hibernate(tabs.find(path)!);
  next?.host?.classList.remove('tab-hidden');
  pannedScroller = reader?.scroller?.(); pan.attach(pannedScroller, activeHost); if (next) pan.setHand(next.hand);
  $('empty').hidden = Boolean(next);
  syncPageStrip(); if (next?.stripScroll !== undefined) pageStrip.restoreScroll(next.stripScroll);
  for (const id of ['previous', 'position', 'next']) $<HTMLButtonElement>(id).disabled = !reader;
  if (reader && position) showPosition(position, false); else paintNoDocument();
  activeHost?.focus();
  if (next?.find !== undefined) findBar.open(next.find, false);
  paintTabState(); paintTabs(); paintRail(); saveSession();
  if (!next) paintHome();
  else if (!next.reader && !next.problem) void reopen(next);
}

/** What the reading area, footer and title show while no document does: Home, or a tab waiting to open. */
function paintNoDocument() {
  $('position').textContent = 'Ready when you are'; $('position').title = 'Go to location (Ctrl+G)';
  scrubber.value = '0'; scrubber.disabled = true; scrubber.style.setProperty('--scrub-fill', '0%');
  $('view-controls').hidden = true; zoomMenu.close();
  $('filekind').textContent = 'A reader that holds.'; $('filekind').title = '';
}

/** Reopens a tab that holds nothing: its place was saved when it hibernated (or by the last session), and the page comes back there. */
function reopen(tab: Tab) { return load(() => openLibraryDocument(tab.path), tab.name, { target: tab }); }

const tabTitle = (tab: Tab) => tab.format === 'epub' ? homeThumbs.epub(tab.path)?.title?.trim() || tab.name : tab.name;
/** Where a tab is, short: "40 / 146" for pages and lines, a percentage for the rest. */
function tabWhere(tab: Tab) {
  const place = tab === shown ? position : tab.position;
  if (!place) return '';
  const pages = place.label.match(/^(?:Pages?|Line) ([\d–-]+) of (\d+)/);
  return pages ? `${pages[1]} / ${pages[2]}` : `${Math.round(Math.max(0, Math.min(100, place.fraction * 100)))} %`;
}
let paintedTabs = '';
function paintTabs() {
  const hints = titleHints(tabs.tabs.map(tab => ({ path: tab.path, title: tabTitle(tab) })));
  const views: TabView[] = tabs.tabs.map(tab => ({ path: tab.path, title: tabTitle(tab), hint: hints.get(tab.path) ?? '', format: tab.format, where: tabWhere(tab), progress: formatProgress(progressOf((tab === shown ? position : tab.position) ?? { fraction: NaN, scrub: { current: 0, total: 0, unit: 'line' } })) ?? '', active: tab === tabs.active, problem: Boolean(tab.problem) }));
  const key = JSON.stringify([views, tabs.size]);
  if (key === paintedTabs) return;
  paintedTabs = key;
  strip.paint(views, !tabs.active);
  const here = tabs.active;
  $('filename').textContent = here ? tabTitle(here) : 'Hold My Brief'; $('filename').title = here?.path ?? '';
  $('tab-count').textContent = tabs.size ? String(tabs.size) : '';
}

/** The placeholder for a showing tab that has no page: its file is missing, its open failed, or it is not opened yet. */
function paintTabState() {
  const tab = tabs.active, waiting = Boolean(tab && !tab.reader && loadingTarget !== tab);
  $('tab-state').hidden = !waiting || !tab;
  if (!waiting || !tab) return;
  const problem = tab.problem;
  $('tab-state-title').textContent = problem?.kind === 'missing' ? 'File not found' : problem ? 'This document could not be opened' : 'Not opened yet';
  $('tab-state-detail').textContent = problem ? `${tab.name} — ${problem.message}` : tab.name;
  $('tab-state-primary').textContent = problem?.kind === 'missing' ? 'Locate…' : problem ? 'Try again' : 'Open';
}
$('tab-state-primary').onclick = () => {
  const tab = tabs.active;
  if (!tab) return;
  if (tab.problem?.kind === 'missing' && desktop) {
    void locateLibraryDocument(tab.path).then(() => { tab.problem = undefined; void reopen(tab); }).catch(fail);
  } else if (tab.problem?.kind === 'missing') openFile();
  else { tab.problem = undefined; void reopen(tab); }
};
$('tab-state-close').onclick = () => { if (tabs.active) closeTab(tabs.active.path); };

/** Shows a tab, or Home for none. A tab with no page yet starts opening; opening something else meanwhile is given up. */
/** Tab 1…8, or 9 for the last one: reached by Alt+digit and ⌘+digit as keys and, on macOS, by the Window menu's items. No such tab: nothing happens. */
function selectTabNumber(digit: number) { const tab = tabs.byNumber(digit); if (tab) selectTab(tab.path); }
function selectTab(path: string | undefined) {
  const tab = path === undefined ? undefined : tabs.find(path);
  if (path !== undefined && !tab) return;
  if (tab === shown) return;
  if (loadingTarget !== tab) cancelOpen();
  show(tab);
}

function closeTab(path: string) {
  const tab = tabs.find(path);
  if (!tab) return;
  if (loadingTarget === tab) cancelOpen();
  const wasShown = shown === tab;
  if (wasShown) {
    void flush(); tab.find = undefined; findBar.close(); zoomGesture.cancel();
    reader = undefined; syncPageStrip(); // The strip lets go of the reader before it is destroyed.
  }
  tab.reader?.destroy(); tab.host?.remove(); tab.reader = tab.host = undefined;
  const next = tabs.close(path);
  if (wasShown) { shown = undefined; show(next, true); } else { paintTabs(); saveSession(); }
}

let sessionTimer: ReturnType<typeof setTimeout> | undefined;
/** Remembers the open tabs for the next launch; several changes in one tick are one write. */
function saveSession() {
  if (sessionTimer) return;
  sessionTimer = setTimeout(() => {
    sessionTimer = undefined;
    const session = tabs.session((tab): SavedTab => ({ path: tab.path, name: tab.name, format: tab.format }));
    void saveTabs(session).catch(fail);
  });
}

const strip = createTabStrip(
  { strip: $('tab-strip'), home: $('home-tab'), list: $('tab-list'), add: $('tab-add'), overflow: $('tab-overflow') },
  { select: selectTab, close: closeTab, newTab: () => openFile(), move: (path, to) => { tabs.move(path, to); paintTabs(); saveSession(); } },
  platform === 'mac' ? '⌘T' : 'Ctrl T',
);
$('title').onclick = () => (strip.isMenuOpen() ? strip.closeMenu() : strip.openMenu($('title')));

/** Opens a library document in a tab, or shows the tab it is already in. */
function openPath(path: string, name = path.split(/[\\/]/).pop()) { return openTab(path, () => openLibraryDocument(path), name); }
/** `path` is the document's identity when it is known before it is read (a library path, or the path a request named). */
async function openTab(path: string | undefined, open: () => Promise<Opened | null>, label?: string, at?: number) {
  const existing = path ? tabs.find(path) : undefined;
  if (!existing) return load(open, label, { at });
  existing.problem = undefined;
  if (shown === existing) { if (!existing.reader) void reopen(existing); } else selectTab(existing.path);
  if (existing.reader) void touch(existing);
  return true;
}
/** Something to open: `path` is its identity when that is known before it is read. */
type Opener = { path?: string; open: () => Promise<Opened | null>; label: string };
/** What is being opened now: an open is single-flight (a new one cancels the one in progress), so batches wait for each other. */
let openBatches: Promise<unknown> = Promise.resolve();
/** Opens each in turn, the first at tab index `at` (after the active tab when not given), and each new tab after the one before it. */
function openMany(items: readonly Opener[], at?: number): Promise<void> {
  const run = openBatches.then(async () => {
    let next = at ?? insertionIndex(undefined, tabs.activeIndex, tabs.size);
    for (const item of items) {
      const before = tabs.size;
      await openTab(item.path, item.open, item.label, next);
      if (tabs.size > before && shown) next = tabs.indexOf(shown.path) + 1;
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
  const slot = strip.dropSlot(point.x, point.y);
  const target = document.elementFromPoint(point.x, point.y);
  const reading = Boolean(target?.closest('#workspace')) && !target?.closest('#library-root, #library-rail');
  return { slot, accepted: slot !== undefined || !internal || reading, at: insertionIndex(slot, tabs.activeIndex, tabs.size) };
}
const overlay = $('drop-overlay');
/** Shows where a drag would drop: the marker and a ghost tab over the strip, the overlay over the reading area. */
function dragOver(point: { x: number; y: number }, names: readonly string[], count: number, internal: boolean) {
  const { slot, accepted } = dropPlace(point, internal);
  strip.showDrop(accepted ? slot : undefined, ghostLabel(count));
  overlay.hidden = !accepted || slot !== undefined;
  $('drop-names').textContent = overlayNames(names);
}
function dragEnd() { strip.showDrop(undefined); overlay.hidden = true; }
/** Opens what was dropped, in drop order, at the tab index the drop chose; what cannot be opened is named in one notice. */
function dropped<T>(items: readonly T[], nameOf: (item: T) => string, opener: (item: T) => Opener, at: number) {
  const { openable, unsupported } = splitDropped(items, nameOf);
  const notice = unsupportedNotice(unsupported);
  if (notice) notify(notice);
  void openMany(openable.map(opener), at);
}
// A document dragged out of the library, the rail or Home onto the strip or the reading area.
attachOpenDrag({
  over: (point, source) => dragOver(point, [source.name], 1, true),
  drop: (point, source) => {
    const { accepted, at } = dropPlace(point, true);
    dragEnd();
    if (accepted) void openMany([{ path: source.path, open: () => openLibraryDocument(source.path), label: source.name }], at);
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
function cancelOpen() { ++request; cancelPending?.(); cancelPending = undefined; loadingTarget = undefined; $<HTMLDialogElement>('password').close(); $('loading').hidden = true; syncPageStrip(); paintTabState(); }
$('cancel').onclick = cancelOpen;
$('dismiss-notice').onclick = () => { $('notice').hidden = true; };
$('retry-save').onclick = () => { dirty = true; void flush(); };
async function navigate(action: Parameters<ReaderAdapter['navigate']>[0]) { try { await reader?.navigate(action); } catch (error) { fail(error); } }
$('previous').onclick = () => void navigate('previous'); $('next').onclick = () => void navigate('next');
function jump() { if (!reader) return; $('jump-label').textContent = reader.mode === 'fixed' ? 'Physical page number' : active?.format === 'epub' ? 'Book percentage (e.g. 35%) or chapter' : 'Source line number'; $('jump-error').textContent = ''; $<HTMLInputElement>('target').value = ''; showDialog('jump'); $<HTMLInputElement>('target').focus(); }
$('position').onclick = jump;
$('jump').querySelector('form')!.onsubmit = event => { event.preventDefault(); void reader?.goTo($<HTMLInputElement>('target').value.trim()).then(() => closeDialog($<HTMLDialogElement>('jump'))).catch(error => { $('jump-error').textContent = String(error instanceof Error ? error.message : error); }); };
async function toggle(which: 'pin' | 'lock') { if (!desktop) { notify('Pin and size lock are available in the desktop app.'); return; } try { updateWindow(await native(`set_${which}`, { enabled: !(which === 'pin' ? windowState.pinned : windowState.locked) })); } catch (error) { fail(error); } }
$('pin').onclick = () => void toggle('pin'); $('lock').onclick = () => void toggle('lock');
// The menu is a popover under its button, not a centred dialog: it opens where the pointer already is
// and leaves the page undimmed. It stays a modal <dialog> for the focus trap and Escape.
$('menu-toggle').onclick = () => {
  const menu = $<HTMLDialogElement>('menu'), anchor = $('menu-toggle').getBoundingClientRect();
  $('appearance-summary').textContent = appearanceSummary();
  menu.style.top = `${Math.round(anchor.bottom + 4)}px`;
  menu.style.right = `${Math.max(6, Math.round(innerWidth - anchor.right))}px`;
  $('menu-toggle').setAttribute('aria-expanded', 'true'); showDialog('menu');
};
$('menu').addEventListener('click', event => { const box = $('menu').getBoundingClientRect(); if (event.target === $('menu') && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom)) closeDialog($<HTMLDialogElement>('menu')); });
$('menu-palette').onclick = () => { closeDialog($<HTMLDialogElement>('menu')); openPalette(); };
if (desktop) document.querySelectorAll<HTMLElement>('#menu [data-desktop]').forEach(item => { item.hidden = false; });
/**
 * What a zoom or fit change holds still (see zoom-anchor.ts): a zoom, the centre of the view; fit width, the line at its top, so the reading
 * position survives; fit page shows the whole page and centres it. A wheel or pinch gesture passes the point under the pointer itself.
 */
const holdFor = (next: Partial<ReaderOptions>): Hold | false => next.fitted === false ? 'centre' : next.fitted && next.fit === 'width' ? 'top' : false;
async function changeOptions(next: Partial<ReaderOptions>, hold: Hold | Spot | false = holdFor(next)) {
  if (!reader) return;
  const zooms = 'zoom' in next || 'fit' in next || 'fitted' in next;
  const open = reader, host = open.scroller?.();
  // The point is read where the page is drawn, slid or not; only then does a slid page go back, so the redrawn page starts from its natural place.
  const spot = zooms && hold ? typeof hold === 'string' ? holdView(host, hold) : hold : undefined;
  if (zooms) pan.recenter();
  // Fit width wants the line at the top only as far as the page scrolls: a fit may centre, so it never slides the page.
  const held: Anchor | undefined = host && spot && { ...spot, host, ...(hold === 'top' ? {} : { slide: (offset: Offset) => pan.slideTo(offset) }) };
  const previous = options; options = { ...options, ...next };
  try {
    await open.setOptions(options, held);
    showPosition(open.getPosition());
  } catch (error) { options = previous; fail(error); }
}
async function action(name: string) {
  if (name === 'goto') jump();
  else if (name === 'appearance') appearanceSheet.open();
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
  else if (name === 'smaller' || name === 'larger') { const direction = name === 'larger' ? 1 : -1; await changeOptions(reader?.mode === 'fixed' ? { fitted: false, zoom: stepZoom(zoomLevel(), direction, zoomLimits()) } : { fontSize: Math.max(12, Math.min(40, options.fontSize + direction * 2)) }); }
  else if (name === 'type') appearanceSheet.open('text');
  else if (name === 'outline') { const list = $('outline-list'); list.replaceChildren(); const entries = reader?.outline() ?? []; if (!entries.length) list.textContent = 'No contents outline in this document.'; for (const item of entries) { const button = document.createElement('button'); button.textContent = item.label; button.onclick = () => { void reader?.goTo(item.target).then(() => closeDialog($<HTMLDialogElement>('contents'))).catch(fail); }; list.append(button); } showDialog('contents'); }
  else if (name === 'shortcuts') showDialog('shortcuts');
  else if (name === 'clear-data') showDialog('delete-data');
  else if (name === 'clear-recents') { if (desktop) await native('clear_recents'); homeRecents = []; paintHome(); paintRail(); notify('Recent-file list cleared. Documents and saved positions are unchanged.'); }
  else if (['back', 'start', 'end', 'screen-next', 'screen-previous'].includes(name)) await navigate(name as Parameters<ReaderAdapter['navigate']>[0]);
}
document.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(button => button.onclick = () => { closeDialog($<HTMLDialogElement>('menu')); void command(button.dataset.action!).catch(fail); });
$('confirm-delete').onclick = () => { void (async () => { await flush(); if (desktop) await native('clear_reading_data'); else for (const key of Object.keys(localStorage)) if (key.startsWith('hold-my-brief:')) localStorage.removeItem(key); dirty = false; closeDialog($<HTMLDialogElement>('delete-data')); notify('Saved reading data deleted. Your documents are unchanged.'); })().catch(fail); };

// Tab marks keyboard navigation (the page's focus ring returns); a pointer press clears it.
document.addEventListener('keydown', event => { if (event.key === 'Tab') document.documentElement.classList.add('keyboard-focus'); }, true);
document.addEventListener('pointerdown', () => document.documentElement.classList.remove('keyboard-focus'), true);
// Ctrl/⌘ + wheel and a trackpad pinch zoom toward the pointer. Chromium and WebView2 report a pinch as ctrl+wheel; macOS's
// WKWebView reports it as gesture events. Both are claimed everywhere (the webview would otherwise zoom the whole interface),
// but only a page-based document moves; the zoom commits once the input pauses (see zoom-gesture.ts).
const zoomGesture = createZoomGesture({
  scroller: () => reader?.mode === 'fixed' ? reader.scroller?.() : undefined,
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
  const target = event.composedPath()[0];
  // Escape closes the find bar from anywhere except its own field, which handles it itself.
  if (event.key === 'Escape' && assistant.isOpen()) { event.preventDefault(); assistant.close(); return; }
  if (event.key === 'Escape' && findBar.isOpen() && target !== findBar.element.querySelector('#find-query')) {
    event.preventDefault(); findBar.close(); activeHost?.focus(); return;
  }
  // Ctrl+K opens the palette from anywhere, text fields included (the library search, find): it is how
  // the interface reaches every command, and a field would otherwise swallow it as typing. It needs no
  // document, so it is checked before the command table.
  if (shortcutFor(event) === 'command-palette') { event.preventDefault(); openPalette(); return; }
  if (target instanceof HTMLElement && (target.closest('input,textarea,select,[contenteditable="true"]'))) return;
  const key = event.key.toLowerCase(); let operation: (() => void) | undefined;
  const inStrip = target instanceof Node && pageStrip.element.contains(target);
  // Catalog shortcuts go through the same dispatcher as the menu and the palette.
  const shortcut = shortcutFor(event);
  const digit = tabDigit(shortcut);
  if (digit) operation = () => selectTabNumber(digit);
  else if (shortcut === 'back') operation = () => void navigate('back');
  else if (shortcut === 'page-strip' && reader && !reader.setPreviews) return; // Only a PDF has previews; for any other document the key is not ours.
  else if (shortcut) operation = () => void command(shortcut).catch(fail);
  else if (key === 'h' && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey && !event.repeat && pan.pannable && (target === document.body || target instanceof Node && (activeHost?.contains(target) || $('view-controls').contains(target)))) operation = toggleHand;
  else if (!event.ctrlKey && !event.altKey && activeHost && (target === document.body || target instanceof Node && (activeHost.contains(target) || inStrip))) {
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
    if (files.length) dropped(files, file => file.name, file => ({ open: () => browserFile(file), label: file.name }), dropPlace({ x: event.clientX, y: event.clientY }, false).at);
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
  const types = homeTypes(recents, homeLibrary.documents);
  if (!types.some(([value]) => value === homeFormat)) homeFormat = '';
  const sections = homeSections({ recents, documents: homeLibrary.documents, collections: homeLibrary.collections, format: homeFormat, titleOf: knownTitle, progress: homeProgress });
  const generation = ++homePicture;
  renderHome(empty, sections, {
    open: (path, name) => { void openPath(path, name); },
    openFile: () => openFile(),
    viewAll: scope => library.browse(scope),
    viewCollection: id => library.browse({ collection: id }),
    picture: { can: canThumbnail, ratio: path => homeThumbs.ratio(path), peek: path => homeThumbs.peek(path) },
    types,
    format: homeFormat,
    selectFormat: value => { homeFormat = value; paintHome(); empty.querySelector<HTMLElement>(`.home-chip[data-type="${value}"]`)?.focus(); },
    ...(desktop ? { remove: (path: string) => { void native('remove_recent', { path }).then(() => { homeRecents = homeRecents.filter(item => item.path !== path); paintHome(); paintRail(); }).catch(fail); } } : {}),
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
onAppearanceChange(() => {
  const home = $('empty');
  if (home.classList.contains('is-home')) repaintCovers(home, scheme());
  paintRail();
});
async function initialize() {
  const saved = await state(); updateWindow(saved.window); if (saved.warning) notify(saved.warning);
  homeRecents = saved.recents;
  await library.refresh().catch(fail);
  homeLibrary = await getLibrary().catch(() => emptyLibrary());
  paintHome(); paintRail();
  for (const entry of saved.tabs.tabs) tabs.open({ ...entry, options: { ...defaultOptions }, hand: false, scanNoticeShown: false });
  show(saved.tabs.active === null ? undefined : tabs.tabs[saved.tabs.active], true);
  if (desktop) {
    const { listen } = await import('@tauri-apps/api/event');
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await listen<string[]>('open-request', event => openRequested(event.payload));
    await listen<WindowState>('window-state', event => updateWindow(event.payload));
    // macOS routes ⌘W through its menu (see install_menu in main.rs). With no tab to close, it closes the window as it always did.
    // macOS also routes ⌘1…⌘9 through its menu; the number arrives here instead of as a key event.
    await listen<number>('select-tab-request', event => { if (!document.querySelector('dialog[open]')) selectTabNumber(event.payload); });
    await listen('close-tab-request', () => { if (shown) closeTab(shown.path); else void getCurrentWindow().close(); });
    await listen<string | null>('reader-warning', event => { if (event.payload) notify(event.payload); });
    const appWindow = getCurrentWindow();
    let closing = false; await appWindow.onCloseRequested(async event => { if (closing) return; event.preventDefault(); await flush(); closing = true; await appWindow.close(); });
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
      dropped(payload.paths, baseName, path => ({ path, open: () => chooseDocument(path), label: baseName(path) }), dropPlace(point, false).at);
    });
    // The native focus event, not the page's blur: clicking into an EPUB frame blurs the page too.
    await appWindow.onFocusChanged(({ payload: focused }) => document.documentElement.classList.toggle('window-inactive', !focused));
    if (platform === 'mac') {
      const syncFullscreen = async () => document.documentElement.classList.toggle('window-fullscreen', await appWindow.isFullscreen());
      await appWindow.onResized(() => void syncFullscreen());
      await syncFullscreen();
    }
    const pending = await native<string[]>('pending_open'); if (pending.length) openRequested(pending);
  }
}
void initialize().catch(fail);
window.addEventListener('beforeunload', () => { void flush(); });
