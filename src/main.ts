import './style.css';
import { defaultOptions, type Position, type ReaderAdapter, type ReaderOptions } from './types';
import { nudgeFor, parsePlacement, placementOf, resolvePlacement, serialisePlacement, type Placement, type Point } from './view-controls-position';
import { desktop, native, state, browserFile, persist, openExternal, confirmDocument, openLibraryDocument, chooseDocument, getLibrary, imageFormats, type Opened, type Recent, type WindowState } from './bridge';
import { emptyLibrary, type Library } from './catalog-types';
import { createLibrary } from './library';
import { createLibraryRail, openedOrder, railItems } from './library-rail';
import { ImageAdapter } from './adapters/image';
import { createPalette } from './palette';
import { createFindBar } from './find-bar';
import { COMMANDS, shortcutFor, shortcutReference, unavailableReason } from './commands';
import { appearance, initAppearance, onAppearanceChange, pageTones, palettes, saveAppearance, scheme, type AppearanceMode } from './theme';
import { appearanceSummary, createAppearanceSheet, paletteIcon } from './appearance';
import { createAssistantPanel } from './assistant-panel';
import { DRAG_SLOP, Panner } from './pan';
import { MIN_SPREAD_WIDTH, pagesLabel, spreadPages } from './spread';
import { assignShelfSlots, closeHome, fillHomePictures, homeRows, renderHome } from './home';
import { repaintCovers } from './cards';
import { canThumbnail, createThumbnailStore } from './thumbnails';
import { createPageStrip, MIN_PANEL_HEIGHT } from './page-strip';
import { DEFAULT_LIMITS, migrateLegacyZoom, stepZoom, wheelFactor, ZOOM_MODEL, zoomPercent, type Point as ZoomPoint } from './zoom';
import { createZoomGesture } from './zoom-gesture';
import { createZoomMenu } from './zoom-menu';
import { createProgressPreview } from './progress-preview';
initAppearance();

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <header class="toolbar" data-tauri-drag-region><button id="library-toggle" class="icon-button" aria-label="Document library" aria-controls="library-root" aria-expanded="false" title="Document library (Ctrl+B)"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16m-3-12v8"/></svg></button><button id="ask" class="title" aria-haspopup="dialog" aria-keyshortcuts="Control+K" title="Go to, find or run a command (Ctrl+K)"><svg class="ask-mark" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M9.94 15.5a2 2 0 0 0-1.44-1.44l-6.13-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.13a.5.5 0 0 1 .96 0l1.58 6.13a2 2 0 0 0 1.44 1.44l6.13 1.58a.5.5 0 0 1 0 .96l-6.13 1.58a2 2 0 0 0-1.44 1.44l-1.58 6.13a.5.5 0 0 1-.96 0z"/></svg><strong id="filename">Hold My Brief</strong><span id="filekind">A reader that holds.</span><span class="visually-hidden">. Go to, find or run a command</span><kbd class="ask-key" aria-hidden="true">Ctrl K</kbd></button><button id="pin" class="icon-button" aria-label="Pin" aria-pressed="false" title="Always on top (Ctrl+Shift+T)"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg></button><button id="lock" class="icon-button" aria-label="Lock" aria-pressed="false" title="Lock dimensions (Ctrl+Shift+L)"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></button><button id="menu-toggle" class="icon-button" aria-label="Reader menu" aria-expanded="false"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg></button><div class="caption" role="group" aria-label="Window"><button id="caption-minimize" aria-label="Minimize" title="Minimize"><svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M0 5.5h10" stroke="currentColor"/></svg></button><button id="caption-maximize" aria-label="Maximize" title="Maximize"><svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" aria-hidden="true"><rect class="caption-max" x=".5" y=".5" width="9" height="9"/><path class="caption-restore" d="M2.5 2.5V.5h7v7h-2M.5 2.5h7v7h-7z"/></svg></button><button id="caption-close" aria-label="Close" title="Close"><svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" aria-hidden="true"><path d="M.5.5l9 9m0-9l-9 9"/></svg></button></div></header>
  <aside id="notice" role="status" hidden><span></span><button id="retry-save" hidden>Retry save</button><button id="dismiss-notice" aria-label="Dismiss message">×</button></aside>
  <div id="reader-layout"><div id="loading" role="status" hidden><span></span><button id="cancel">Cancel</button></div><div id="library-root"></div><nav id="library-rail"></nav>
  <main id="workspace"><section id="empty"><div class="book-mark" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="4" y="3" width="16" height="18" rx="3"/><path d="M9 3v18m4-13h3m-3 4h3"/></svg></div><p class="eyebrow">KEEP YOUR PLACE</p><h1>Hand it over.</h1><p>Drop a brief and it stays pinned<br>exactly where you leave it.</p><button id="empty-open" class="primary">Hold a brief <span>↗</span></button><p class="formats">PDF · EPUB · MARKDOWN · TEXT</p><div id="recents"></div><p id="preview-note" hidden>Browser preview · Pin and size lock are available in the desktop app.</p></section>
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
  pan.refresh(position?.spread);
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
/** How much of the panel's bottom the page-preview strip and the footer lane under it take while the strip is shown: the pill keeps above it. */
const pillStrip = () => workspace.classList.contains('has-page-strip') ? Math.max(0, workspace.getBoundingClientRect().bottom - pageStrip.element.getBoundingClientRect().top) : 0;
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
  changed: next => { homeLibrary = next; if ($('empty').classList.contains('is-home')) paintHome(); paintRail(); },
  sideChanged: side => rail.setSide(side),
});
$('library-toggle').onclick = () => library.toggle();
// The library closed is a rail of the latest recents. It shares Home's picture store, so a cover made for one is there for the other.
const rail = createLibraryRail($('library-rail'), {
  toggle: () => library.toggle(),
  open: (path, name) => { void load(() => openLibraryDocument(path), name); },
  picture: (path, format, alive) => homeThumbs.request(path, format, alive),
  peek: path => homeThumbs.peek(path),
  epub: (path, alive) => homeThumbs.loadEpub(path, alive),
  title: path => homeThumbs.epub(path)?.title?.trim() || undefined,
  failed: path => homeThumbs.failed(path),
  setSide: side => library.setSide(side),
});
rail.setSide(library.side());
const knownTitle = (item: { path: string; format: string }) => item.format.toLowerCase() === 'epub' ? homeThumbs.epub(item.path)?.title?.trim() || undefined : undefined;
function paintRail() { rail.paint(railItems(desktop ? homeRecents : openedOrder(homeLibrary.documents), homeLibrary.documents, knownTitle), active?.path, scheme()); }

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
  if (id === 'open') openFile();
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
    stripSpace(candidate); // A page-preview strip's room is there before the document is fitted, so opening never refits it.
    staging = document.createElement('section'); staging.className = 'reader-host staging'; staging.tabIndex = 0; staging.setAttribute('aria-label', 'Reading surface'); $('view-controls').before(staging);
    // Options saved before zoom was a true scale hold a multiplier of the fit. They open fitted and are converted below, once the document is drawn, so the page keeps its size; saving then writes the new form.
    const saved = doc.previousState?.options, legacy = Boolean(saved) && saved!.zoomModel !== ZOOM_MODEL, legacyZoom = Number(saved?.zoom);
    const prefs: ReaderOptions = { ...defaultOptions, ...saved, zoomModel: ZOOM_MODEL, ...(legacy ? { fitted: true, zoom: 1 } : {}) };
    const current = candidate;
    await candidate.open({ ...doc, bytes: doc.bytes }, staging, {
      onPosition: p => { if (reader === current) showPosition(p); }, onError: fail, openExternal, requestPassword: password, onFrame: doc => { pan.watchFrame(doc); watchFrameZoom(doc); },
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
    zoomGesture.cancel(); reader?.destroy(); activeHost?.remove();
    doc.bytes = new Uint8Array();
    reader = candidate; active = doc; options = prefs; activeHost = staging; staging.classList.remove('staging'); $('empty').hidden = true;
    pannedScroller = reader.scroller?.(); pan.attach(pannedScroller, staging); scanNoticeShown = false;
    ++scrubRequest; scrubbing = false;
    $('filename').textContent = doc.name; $('filename').title = doc.path;
    for (const id of ['previous', 'position', 'next']) $<HTMLButtonElement>(id).disabled = false;
    showPosition(reader.getPosition()); staging.focus(); candidate = undefined; staging = undefined; cancelPending = undefined;
    // Marks belong to the adapter that produced them, so a new document starts with none.
    findBar.close();
    if (doc.warning) notify(doc.warning);
    if (desktop) homeRecents = (await state()).recents; // The store moves the opened document to the front.
    await library.refresh(doc.path).catch(fail);
    return true;
  } catch (error) { if (token === request) fail(error); return false; }
  finally { candidate?.destroy(); staging?.remove(); if (token === request) { $('loading').hidden = true; cancelPending = undefined; syncPageStrip(); } }
}
function openFile(path?: string) { if (desktop) void load(() => chooseDocument(path), path?.split(/[\\/]/).pop()); else $<HTMLInputElement>('file-input').click(); }
$('ask').onclick = () => openPalette(); $('empty-open').onclick = () => openFile();
$<HTMLInputElement>('file-input').onchange = event => { const input = event.target as HTMLInputElement; if (input.files?.[0]) { const file = input.files[0]; void load(() => browserFile(file), file.name); } input.value = ''; };
$('cancel').onclick = () => { ++request; cancelPending?.(); cancelPending = undefined; $<HTMLDialogElement>('password').close(); $('loading').hidden = true; syncPageStrip(); };
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
async function changeOptions(next: Partial<ReaderOptions>) { if (!reader) return; if ('zoom' in next || 'fit' in next || 'fitted' in next) pan.recenter(); const previous = options; options = { ...options, ...next }; try { await reader.setOptions(options); showPosition(reader.getPosition()); } catch (error) { options = previous; fail(error); } }
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
  commit: zoom => changeOptions({ fitted: false, zoom }),
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
  if (shortcut === 'back') operation = () => void navigate('back');
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
if (!desktop) { $('preview-note').hidden = false; document.addEventListener('dragover', event => event.preventDefault()); document.addEventListener('drop', event => { event.preventDefault(); if (event.dataTransfer?.files.length !== 1) return notify('Drop one document at a time.'); const file = event.dataTransfer.files[0]; void load(() => browserFile(file), file.name); }); }
function paintHome() {
  const empty = $('empty');
  splashHtml ??= empty.innerHTML;
  assignShelfSlots(homeLibrary.collections);
  const rows = homeRows(homeRecents, homeLibrary.documents, homeFormat, knownTitle);
  if (!homeRecents.length && !homeLibrary.documents.length) {
    if (empty.classList.contains('is-home')) { closeHome(); empty.classList.remove('is-home'); empty.innerHTML = splashHtml; $('empty-open').onclick = () => openFile(); }
    return;
  }
  const generation = ++homePicture;
  renderHome(empty, rows, {
    open: (path, name) => { void load(() => openLibraryDocument(path), name); },
    openFile: () => openFile(),
    viewAll: scope => library.browse(scope),
    picture: { can: canThumbnail, ratio: path => homeThumbs.ratio(path), peek: path => homeThumbs.peek(path) },
    format: homeFormat,
    selectFormat: value => { homeFormat = value; paintHome(); $('home-format').focus(); },
    remove: path => { void native('remove_recent', { path }).then(() => { homeRecents = homeRecents.filter(item => item.path !== path); paintHome(); paintRail(); }).catch(fail); },
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
  if (desktop) {
    const { listen } = await import('@tauri-apps/api/event');
    await listen<string>('open-request', event => openFile(event.payload));
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
