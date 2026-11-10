import './style.css';
import { defaultOptions, type Position, type ReaderAdapter, type ReaderOptions } from './types';
import { nudgeFor, parsePlacement, placementOf, resolvePlacement, serialisePlacement, type Placement, type Point } from './view-controls-position';
import { desktop, native, state, browserFile, persist, openExternal, confirmDocument, openLibraryDocument, chooseDocument, getLibrary, imageFormats, type Opened, type Recent, type WindowState } from './bridge';
import { emptyLibrary, type Library } from './catalog-types';
import { createLibrary } from './library';
import { ImageAdapter } from './adapters/image';
import { createPalette } from './palette';
import { createFindBar } from './find-bar';
import { COMMANDS, shortcutFor, shortcutReference, unavailableReason } from './commands';
import { appearance, initAppearance, onAppearanceChange, pageTones, palettes, saveAppearance, scheme, type AppearanceMode } from './theme';
import { appearanceSummary, createAppearanceSheet, paletteIcon } from './appearance';
import { createAssistantPanel } from './assistant-panel';
import { Panner } from './pan';
import { MIN_SPREAD_WIDTH, pagesLabel, spreadPages } from './spread';
import { assignShelfSlots, fillHomePictures, homeRows, renderHome } from './home';
import { coverArt } from './covers';
import { canThumbnail, createThumbnailStore } from './thumbnails';
initAppearance();

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <header class="toolbar" data-tauri-drag-region><button id="library-toggle" class="icon-button" aria-label="Document library" aria-controls="library-root" aria-expanded="false" title="Document library (Ctrl+B)"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16m-3-12v8"/></svg></button><button id="ask" class="title" aria-haspopup="dialog" aria-keyshortcuts="Control+K" title="Go to, find or run a command (Ctrl+K)"><svg class="ask-mark" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M9.94 15.5a2 2 0 0 0-1.44-1.44l-6.13-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.13a.5.5 0 0 1 .96 0l1.58 6.13a2 2 0 0 0 1.44 1.44l6.13 1.58a.5.5 0 0 1 0 .96l-6.13 1.58a2 2 0 0 0-1.44 1.44l-1.58 6.13a.5.5 0 0 1-.96 0z"/></svg><strong id="filename">Hold My Brief</strong><span id="filekind">A reader that holds.</span><span class="visually-hidden">. Go to, find or run a command</span><kbd class="ask-key" aria-hidden="true">Ctrl K</kbd></button><button id="pin" class="icon-button" aria-label="Pin" aria-pressed="false" title="Always on top (Ctrl+Shift+T)"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg></button><button id="lock" class="icon-button" aria-label="Lock" aria-pressed="false" title="Lock dimensions (Ctrl+Shift+L)"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></button><button id="menu-toggle" class="icon-button" aria-label="Reader menu" aria-expanded="false"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg></button><div class="caption" role="group" aria-label="Window"><button id="caption-minimize" aria-label="Minimize" title="Minimize"><svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M0 5.5h10" stroke="currentColor"/></svg></button><button id="caption-maximize" aria-label="Maximize" title="Maximize"><svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" aria-hidden="true"><rect class="caption-max" x=".5" y=".5" width="9" height="9"/><path class="caption-restore" d="M2.5 2.5V.5h7v7h-2M.5 2.5h7v7h-7z"/></svg></button><button id="caption-close" aria-label="Close" title="Close"><svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" aria-hidden="true"><path d="M.5.5l9 9m0-9l-9 9"/></svg></button></div></header>
  <aside id="notice" role="status" hidden><span></span><button id="retry-save" hidden>Retry save</button><button id="dismiss-notice" aria-label="Dismiss message">×</button></aside>
  <div id="reader-layout"><div id="loading" role="status" hidden><span></span><button id="cancel">Cancel</button></div><div id="library-root"></div>
  <main id="workspace"><section id="empty"><div class="book-mark" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="4" y="3" width="16" height="18" rx="3"/><path d="M9 3v18m4-13h3m-3 4h3"/></svg></div><p class="eyebrow">KEEP YOUR PLACE</p><h1>Hand it over.</h1><p>Drop a brief and it stays pinned<br>exactly where you leave it.</p><button id="empty-open" class="primary">Hold a brief <span>↗</span></button><p class="formats">PDF · EPUB · MARKDOWN · TEXT</p><div id="recents"></div><p id="preview-note" hidden>Browser preview · Pin and size lock are available in the desktop app.</p></section>
  <div id="view-controls" role="group" aria-label="View controls" hidden><button id="view-grip" type="button" aria-label="Move view controls" title="Drag to move · double-click to reset"><svg width="8" height="14" viewBox="0 0 8 14" fill="currentColor" aria-hidden="true"><circle cx="2" cy="3" r="1"/><circle cx="6" cy="3" r="1"/><circle cx="2" cy="7" r="1"/><circle cx="6" cy="7" r="1"/><circle cx="2" cy="11" r="1"/><circle cx="6" cy="11" r="1"/></svg></button><button id="zoom-out" aria-label="Zoom out" title="Zoom out (Ctrl −)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"/></svg></button><button id="zoom-level">Fit</button><button id="zoom-in" aria-label="Zoom in" title="Zoom in (Ctrl +)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14M12 5v14"/></svg></button><span class="view-sep" aria-hidden="true"></span><button id="hand-tool" aria-label="Hand tool" aria-pressed="false" aria-disabled="true" title="Zoom in to pan"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 11V6a2 2 0 0 0-4 0M14 10V4a2 2 0 0 0-4 0v2M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/></svg></button><span id="view-layout" class="view-group" role="group" aria-label="Page layout" hidden><span class="view-sep" aria-hidden="true"></span><button id="view-single" aria-label="Single page" aria-pressed="true" title="Single page"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg></button><button id="view-spread" aria-label="Two pages" aria-pressed="false" title="Two-page spread (Ctrl 3)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/></svg></button></span></div></main>
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
let libraryFloating = false;
let homeRecents: Recent[] = [];
let homeLibrary: Library = emptyLibrary();
let splashHtml: string | undefined;
let homePicture = 0;
const homeThumbs = createThumbnailStore();
let request = 0, dirty = false, saveTimer: ReturnType<typeof setTimeout> | undefined;
let saveQueue = Promise.resolve();
let activeHost: HTMLElement | undefined;
let cancelPending: (() => void) | undefined;
const pan = new Panner();
let pannedScroller: HTMLElement | undefined;

function notify(message: string, retry = false) { $('notice').hidden = false; $('notice').querySelector('span')!.textContent = message; $('retry-save').hidden = !retry; }
function fail(error: unknown) { notify(error instanceof Error ? error.message : String(error)); }
function updateWindow(next: WindowState) { windowState = next; $('pin').setAttribute('aria-pressed', String(next.pinned)); $('pin').title = next.pinned ? 'Pinned on top (Ctrl+Shift+T)' : 'Always on top (Ctrl+Shift+T)'; $('lock').setAttribute('aria-pressed', String(next.locked)); $('lock').title = next.locked ? 'Size locked (Ctrl+Shift+L)' : 'Lock dimensions (Ctrl+Shift+L)'; $<HTMLButtonElement>('caption-maximize').disabled = next.locked; }
function showPosition(p: Position) {
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
  dirty = true; clearTimeout(saveTimer); saveTimer = setTimeout(() => void flush(), 650);
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
/** Syncs the view-controls pill, page-layout toggles and the title subtitle with the current position, zoom, layout and hand-tool state. */
function updateViewControls() {
  if (!reader || !active) return;
  // Fixed-layout EPUB rebuilds its renderer when the page layout changes; follow it.
  const scroller = reader.scroller?.();
  if (scroller !== pannedScroller) { pannedScroller = scroller; pan.attach(scroller, activeHost); }
  pan.refresh();
  const fitted = Math.abs(options.zoom - 1) < .005, width = options.fit === 'width';
  const level = fitted ? (width ? 'Width' : 'Fit') : `${Math.round(options.zoom * 100)}%`;
  const layout = position?.spread, waiting = layout === 'waiting' ? `Two pages appear when the reading area is at least ${MIN_SPREAD_WIDTH} px wide` : '';
  const kind = reader.mode === 'fixed' && fitted && !width && layout === 'active' ? 'Two-page view'
    : `${reader.mode !== 'fixed' ? (reader.mode === 'paginated' ? 'Reading view' : 'Scroll view') : fitted ? (width ? 'Fit width' : 'Page view') : level}${layout === 'active' ? ' · Two pages' : ''}`;
  // The subtitle says where you are, compactly ("48 / 146", without a PDF's printed page number);
  // the full position and the kind of view are in its tooltip.
  const where = position?.label ?? '';
  $('filekind').textContent = where.replace(/^(?:Pages?|Line) ([\d–-]+) of (\d+)(?: · .*)?$/, '$1 / $2');
  $('filekind').title = [where, `${active.format.toUpperCase()} · ${kind}${pan.hand ? ' · Hand' : ''}`, waiting].filter(Boolean).join('\n');
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
  $('view-controls').hidden = !pan.pannable;
  if (!pan.pannable) return;
  // Clicking the level toggles fit page/fit width; while zoomed it first returns to the current fit.
  const next = fitted && !width ? 'fit-width' : fitted ? 'fit-page' : `fit-${options.fit}`;
  const levelButton = $('zoom-level');
  levelButton.textContent = level; levelButton.dataset.next = next;
  levelButton.setAttribute('aria-label', `${level} zoom, switch to ${next === 'fit-width' ? 'fit width' : 'fit page'}`);
  levelButton.title = `${fitted ? (width ? 'Fit width' : 'Fit page') : `Zoom ${level}`} · click for ${next === 'fit-width' ? 'fit width (Ctrl 2)' : 'fit page (Ctrl 0)'}`;
  $<HTMLButtonElement>('zoom-out').disabled = options.zoom <= .25;
  $<HTMLButtonElement>('zoom-in').disabled = options.zoom >= 4;
  const hand = $('hand-tool'), available = pan.overflowing;
  hand.setAttribute('aria-pressed', String(pan.hand)); hand.setAttribute('aria-disabled', String(!available));
  hand.title = available ? 'Hand tool: drag to pan (H)' : 'Zoom in to pan';
}
function toggleHand() { pan.setHand(!pan.hand); updateViewControls(); }
// Keep keyboard focus on the page: clicking a pill button must not strand arrow/PgDn keys on it.
$('view-controls').addEventListener('mousedown', event => event.preventDefault());
$('zoom-out').onclick = () => void action('smaller').catch(fail);
$('zoom-in').onclick = () => void action('larger').catch(fail);
$('zoom-level').onclick = () => void action($('zoom-level').dataset.next ?? 'fit-page').catch(fail);
$('hand-tool').onclick = () => { if ($('hand-tool').getAttribute('aria-disabled') !== 'true') toggleHand(); };
$('view-single').onclick = () => void changeOptions({ spread: false });
$('view-spread').onclick = () => void changeOptions({ spread: true });
// Movable pill: the grip drags it anywhere in the reading panel. Without a stored position the CSS
// placement stands untouched; with one, inline left/top (kept as centre fractions of the panel so a
// resize keeps it proportional) win, clamped inside the panel and clear of an open library drawer.
const pillKey = 'hold-my-brief:view-controls', pill = $('view-controls'), grip = $('view-grip'), workspace = $('workspace');
let pillPlacement: Placement | null = null;
try { pillPlacement = parsePlacement(localStorage.getItem(pillKey)); } catch { /* Optional preference. */ }
const pillPanel = () => ({ width: workspace.clientWidth, height: workspace.clientHeight });
const pillBox = () => ({ width: pill.offsetWidth, height: pill.offsetHeight });
function drawerBand() {
  // The compact sheet covers the whole layout over a scrim; only the side-by-side drawer is steered around.
  if (!$('reader-layout').classList.contains('library-open') || matchMedia('(max-width: 719px)').matches) return null;
  const drawer = $('library-root').getBoundingClientRect(), panel = workspace.getBoundingClientRect();
  return { left: drawer.left - panel.left - workspace.clientLeft, right: drawer.right - panel.left - workspace.clientLeft };
}
function showPill(point: Point | null) {
  const values = point ? [`${point.left}px`, `${point.top}px`, 'auto', 'auto', 'none'] : ['', '', '', '', ''];
  ['left', 'top', 'right', 'bottom', 'translate'].forEach((name, index) => pill.style.setProperty(name, values[index]));
}
function placePill() {
  if (!pillPlacement) return showPill(null);
  const size = pillBox();
  if (size.width) showPill(resolvePlacement(pillPlacement, pillPanel(), size, drawerBand())); // A hidden pill has no size to place.
}
/** Moves the pill to the clamped, drawer-clear form of `point` and remembers what is actually on screen. */
function movePill(point: Point, save: boolean) {
  const panel = pillPanel(), size = pillBox(), resolved = resolvePlacement(placementOf(point, panel, size), panel, size, drawerBand());
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
  const doc = active, loc = structuredClone(position.locator), prefs = { ...options }; dirty = false;
  saveQueue = saveQueue.then(() => persist(doc, loc, prefs)).catch(() => { if (active?.id === doc.id) dirty = true; notify('Progress could not be saved. Reading is still available.', true); });
  return saveQueue;
}
setInterval(() => { if (dirty) void flush(); }, 1500);
// Go to and Contents drop from the toolbar under the title, like the palette, instead of centring on a
// dimmed page; a click outside closes them.
function showDialog(id: string) {
  const dialog = $(id);
  if (!(dialog instanceof HTMLDialogElement)) return;
  if (dialog.classList.contains('drop')) {
    const title = $('ask').getBoundingClientRect(), width = Math.min(320, innerWidth - 12);
    dialog.style.top = `${Math.round($('ask').closest('header')!.getBoundingClientRect().bottom + 4)}px`;
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
  open: path => load(() => openLibraryDocument(path), path.split(/[\\/]/).pop()),
  error: fail,
  undock: desktop ? () => { void undockLibrary().catch(fail); } : undefined,
});
$('library-toggle').onclick = () => { if (libraryFloating) void native('set_library_window', { undocked: true, restore: false, width: 0, side: 'left' }).catch(fail); else library.toggle(); };

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
      hasDocument: () => Boolean(reader), desktop, run: id => command(id),
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
    open: doc => load(() => openLibraryDocument(doc.path), doc.name),
    setAppearance: change => {
      const kept = appearance();
      saveAppearance({
        ...kept,
        mode: (['system', 'light', 'dark'] as const satisfies readonly AppearanceMode[]).find(mode => mode === change.mode) ?? kept.mode,
        palette: palettes.find(palette => palette === change.theme) ?? kept.palette,
        page: pageTones.find(tone => tone === change.page) ?? kept.page,
      });
      return appearanceSummary();
    },
    runCommand: async id => {
      const entry = COMMANDS.find(candidate => candidate.id === id)!;
      const reason = unavailableReason(entry, { hasDocument: Boolean(reader), desktop });
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
  const reason = entry && unavailableReason(entry, { hasDocument: Boolean(reader), desktop });
  if (reason) { notify(reason); return; }
  if (id === 'open') openFile();
  else if (id === 'library') { if (libraryFloating) void native('set_library_window', { undocked: true, restore: false, width: 0, side: 'left' }).catch(fail); else library.toggle(); }
  else if (id === 'library-board') library.board();
  else if (id === 'library-undock') await undockLibrary();
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
async function load(open: () => Promise<Opened | null>, label = 'document'): Promise<boolean> {
  const token = ++request; cancelPending?.();
  $('loading').hidden = false; $('loading').querySelector('span')!.textContent = `Opening ${label}…`;
  let candidate: ReaderAdapter | undefined, staging: HTMLElement | undefined;
  const urls: string[] = [];
  cancelPending = () => { candidate?.destroy(); staging?.remove(); for (const url of urls) URL.revokeObjectURL(url); };
  try {
    await flush(); const doc = await open(); if (!doc || token !== request) return false;
    $('loading').querySelector('span')!.textContent = `Opening ${doc.name}…`;
    candidate = await adapter(doc.format); if (token !== request) return false;
    staging = document.createElement('section'); staging.className = 'reader-host staging'; staging.tabIndex = 0; staging.setAttribute('aria-label', 'Reading surface'); $('view-controls').before(staging);
    const prefs = { ...defaultOptions, ...doc.previousState?.options };
    const current = candidate;
    await candidate.open({ ...doc, bytes: doc.bytes }, staging, {
      onPosition: p => { if (reader === current) showPosition(p); }, onError: fail, openExternal, requestPassword: password, onFrame: doc => pan.watchFrame(doc),
      resolveImage: desktop ? async relative => { const result = await native<{bytes: number[]; mime: string}>('read_relative_image', { path: doc.path, relative }); const url = URL.createObjectURL(new Blob([new Uint8Array(result.bytes)], { type: result.mime })); urls.push(url); return url; } : undefined,
    }, prefs);
    if (doc.previousState?.locator) await candidate.restore(doc.previousState.locator);
    if (token !== request) return false;
    await confirmDocument(doc).catch(error => notify(`Your library could not be saved. Reading is still available. ${error instanceof Error ? error.message : String(error)}`));
    await flush();
    if (token !== request) return false;
    reader?.destroy(); activeHost?.remove();
    doc.bytes = new Uint8Array();
    reader = candidate; active = doc; options = prefs; activeHost = staging; staging.classList.remove('staging'); $('empty').hidden = true;
    pannedScroller = reader.scroller?.(); pan.attach(pannedScroller, staging);
    ++scrubRequest; scrubbing = false;
    $('filename').textContent = doc.name; $('filename').title = doc.path;
    for (const id of ['previous', 'position', 'next']) $<HTMLButtonElement>(id).disabled = false;
    showPosition(reader.getPosition()); staging.focus(); candidate = undefined; staging = undefined; cancelPending = undefined;
    // Marks belong to the adapter that produced them, so a new document starts with none.
    findBar.close();
    if (doc.warning) notify(doc.warning);
    await library.refresh(doc.path).catch(fail);
    return true;
  } catch (error) { if (token === request) fail(error); return false; }
  finally { candidate?.destroy(); staging?.remove(); if (token === request) { $('loading').hidden = true; cancelPending = undefined; } }
}
function openFile(path?: string) { if (desktop) void load(() => chooseDocument(path), path?.split(/[\\/]/).pop()); else $<HTMLInputElement>('file-input').click(); }
$('ask').onclick = () => openPalette(); $('empty-open').onclick = () => openFile();
$<HTMLInputElement>('file-input').onchange = event => { const input = event.target as HTMLInputElement; if (input.files?.[0]) { const file = input.files[0]; void load(() => browserFile(file), file.name); } input.value = ''; };
$('cancel').onclick = () => { ++request; cancelPending?.(); cancelPending = undefined; $<HTMLDialogElement>('password').close(); $('loading').hidden = true; };
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
async function changeOptions(next: Partial<ReaderOptions>) { if (!reader) return; const previous = options; options = { ...options, ...next }; try { await reader.setOptions(options); showPosition(reader.getPosition()); } catch (error) { options = previous; fail(error); } }
async function action(name: string) {
  if (name === 'goto') jump();
  else if (name === 'appearance') appearanceSheet.open();
  else if (name === 'pin' || name === 'lock') await toggle(name);
  else if (name === 'compact' || name === 'reading') { if (!desktop) return notify('Window presets are available in the desktop app.'); updateWindow(await native('set_preset', { preset: name })); }
  else if (name === 'fit-page' || name === 'fit-width') await changeOptions({ fit: name === 'fit-page' ? 'page' : 'width', zoom: 1 });
  else if (name === 'rotate') await changeOptions({ rotation: (options.rotation + 90) % 360 });
  else if (name === 'spread') { if (reader?.spreads) await changeOptions({ spread: !options.spread }); }
  else if (name === 'cover') await changeOptions({ cover: !options.cover });
  else if (name === 'smaller' || name === 'larger') { const delta = name === 'larger' ? 1 : -1; await changeOptions(reader?.mode === 'fixed' ? { zoom: Math.round(Math.max(.25, Math.min(4, options.zoom + delta * .1)) * 100) / 100 } : { fontSize: Math.max(12, Math.min(40, options.fontSize + delta * 2)) }); }
  else if (name === 'type') appearanceSheet.open('text');
  else if (name === 'outline') { const list = $('outline-list'); list.replaceChildren(); const entries = reader?.outline() ?? []; if (!entries.length) list.textContent = 'No contents outline in this document.'; for (const item of entries) { const button = document.createElement('button'); button.textContent = item.label; button.onclick = () => { void reader?.goTo(item.target).then(() => closeDialog($<HTMLDialogElement>('contents'))).catch(fail); }; list.append(button); } showDialog('contents'); }
  else if (name === 'shortcuts') showDialog('shortcuts');
  else if (name === 'clear-data') showDialog('delete-data');
  else if (name === 'clear-recents') { if (desktop) await native('clear_recents'); homeRecents = []; paintHome(); notify('Recent-file list cleared. Documents and saved positions are unchanged.'); }
  else if (['back', 'start', 'end', 'screen-next', 'screen-previous'].includes(name)) await navigate(name as Parameters<ReaderAdapter['navigate']>[0]);
}
document.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(button => button.onclick = () => { closeDialog($<HTMLDialogElement>('menu')); void command(button.dataset.action!).catch(fail); });
$('confirm-delete').onclick = () => { void (async () => { await flush(); if (desktop) await native('clear_reading_data'); else for (const key of Object.keys(localStorage)) if (key.startsWith('hold-my-brief:')) localStorage.removeItem(key); dirty = false; closeDialog($<HTMLDialogElement>('delete-data')); notify('Saved reading data deleted. Your documents are unchanged.'); })().catch(fail); };

// Tab marks keyboard navigation (the page's focus ring returns); a pointer press clears it.
document.addEventListener('keydown', event => { if (event.key === 'Tab') document.documentElement.classList.add('keyboard-focus'); }, true);
document.addEventListener('pointerdown', () => document.documentElement.classList.remove('keyboard-focus'), true);
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
  // Catalog shortcuts go through the same dispatcher as the menu and the palette.
  const shortcut = shortcutFor(event);
  if (shortcut === 'back') operation = () => void navigate('back');
  else if (shortcut) operation = () => void command(shortcut).catch(fail);
  else if (key === 'h' && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey && !event.repeat && pan.pannable && (target === document.body || target instanceof Node && (activeHost?.contains(target) || $('view-controls').contains(target)))) operation = toggleHand;
  else if (!event.ctrlKey && !event.altKey && activeHost && (target === document.body || target instanceof Node && activeHost.contains(target))) {
    const horizontal = target instanceof HTMLElement && target.closest('pre,table,[data-horizontal-scroll]');
    const mapping: Record<string, Parameters<ReaderAdapter['navigate']>[0]> = { pagedown: 'next', pageup: 'previous', home: 'start', end: 'end', ' ': event.shiftKey ? 'screen-previous' : 'screen-next' };
    if (reader?.mode !== 'scroll' && !horizontal) { mapping.arrowright = 'next'; mapping.arrowleft = 'previous'; }
    if (mapping[key]) operation = () => void navigate(mapping[key]);
  }
  if (operation) { event.preventDefault(); operation(); }
});
if (!desktop) { $('preview-note').hidden = false; document.addEventListener('dragover', event => event.preventDefault()); document.addEventListener('drop', event => { event.preventDefault(); if (event.dataTransfer?.files.length !== 1) return notify('Drop one document at a time.'); const file = event.dataTransfer.files[0]; void load(() => browserFile(file), file.name); }); }
async function undockLibrary() {
  if (!desktop) return notify('Undocking the library is available in the desktop app.');
  if (libraryFloating) { await native('set_library_window', { undocked: true, restore: false, width: 0, side: 'left' }); return; }
  const saved = Number(localStorage.getItem('hold-my-brief:library-width'));
  const width = Number.isFinite(saved) && saved > 0 ? saved : 270;
  const docked = localStorage.getItem('hold-my-brief:library-side') === 'right' ? 'right' : 'left';
  await native('set_library_window', { undocked: true, restore: false, width, side: docked });
  applyLibraryWindow(true, false);
}
function applyLibraryWindow(undocked: boolean, restore: boolean) {
  libraryFloating = undocked;
  document.documentElement.classList.toggle('library-floating', undocked);
  if (undocked) library.suspend(true);
  else if (restore) { library.suspend(false); void library.refresh(); }
  else library.suspend(true);
}
function paintHome() {
  const empty = $('empty');
  splashHtml ??= empty.innerHTML;
  assignShelfSlots(homeLibrary.collections);
  const rows = homeRows(homeRecents, homeLibrary.documents);
  if (!rows.length) {
    if (empty.classList.contains('is-home')) { empty.classList.remove('is-home'); empty.innerHTML = splashHtml; $('empty-open').onclick = () => openFile(); }
    return;
  }
  const generation = ++homePicture;
  renderHome(empty, rows, {
    open: (path, name) => { void load(() => openLibraryDocument(path), name); },
    openFile: () => openFile(),
    remove: path => { void native('remove_recent', { path }).then(() => { homeRecents = homeRecents.filter(item => item.path !== path); paintHome(); }).catch(fail); },
  }, scheme());
  fillHomePictures(empty, (path, format) => canThumbnail(format) ? homeThumbs.request(path, format, () => generation === homePicture && empty.classList.contains('is-home')) : Promise.resolve(undefined), () => generation === homePicture);
}
onAppearanceChange(() => {
  const mode = scheme();
  for (const art of document.querySelectorAll<HTMLImageElement>('#empty.is-home img.library-cover-art')) art.src = coverArt(Number(art.dataset.seed), art.dataset.cover || undefined, mode);
});
async function initialize() {
  const saved = await state(); updateWindow(saved.window); if (saved.warning) notify(saved.warning);
  homeRecents = saved.recents;
  await library.refresh().catch(fail);
  homeLibrary = await getLibrary().catch(() => emptyLibrary());
  paintHome();
  if (desktop) {
    const { listen } = await import('@tauri-apps/api/event');
    await listen<string>('open-request', event => openFile(event.payload));
    await listen<{ undocked: boolean; restore: boolean }>('library-window', event => applyLibraryWindow(event.payload.undocked, event.payload.restore));
    await listen<string>('library-open', event => { void load(() => openLibraryDocument(event.payload), event.payload.split(/[\\/]/).pop()); });
    await listen<WindowState>('window-state', event => updateWindow(event.payload));
    await listen<string | null>('reader-warning', event => { if (event.payload) notify(event.payload); });
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
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
    // The native focus event, not the page's blur: clicking into an EPUB frame blurs the page too.
    await appWindow.onFocusChanged(({ payload: focused }) => document.documentElement.classList.toggle('window-inactive', !focused));
    if (platform === 'mac') {
      const syncFullscreen = async () => document.documentElement.classList.toggle('window-fullscreen', await appWindow.isFullscreen());
      await appWindow.onResized(() => void syncFullscreen());
      await syncFullscreen();
    }
    const pending = await native<string | null>('pending_open'); if (pending) openFile(pending);
  }
}
void initialize().catch(fail);
window.addEventListener('beforeunload', () => { void flush(); });
