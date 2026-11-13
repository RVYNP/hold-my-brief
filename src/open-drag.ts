/**
 * Dragging a document from inside the app (a library tile, row or tree row, a Home tile) to the tab strip or the reading
 * area, to open it in a new tab there. It uses pointer events and a drag threshold, not HTML5 drag and drop: with Tauri's
 * native drag-drop enabled, WebView2 does not deliver HTML5 drag events inside the page. A press that never travels past
 * the threshold stays an ordinary click, so a click still opens the document where it always did.
 */

/** A press that travels less than this (CSS px) is a click. */
export const OPEN_DRAG_SLOP = 5;
/** The things that can be dragged: a library row, tile or tree row (`data-doc-path`), a Home tile. */
const SOURCES = '[data-doc-path], [data-home-path]';

export type OpenDragSource = { path: string; name: string };
export type OpenDragHandlers = {
  /** The drag is at `point`; called on every move once it has begun. */
  over: (point: { x: number; y: number }, source: OpenDragSource) => void;
  /** Released at `point`. */
  drop: (point: { x: number; y: number }, source: OpenDragSource) => void;
  /** Escape, or the system took the pointer. */
  cancel: () => void;
};

function sourceOf(target: EventTarget | null): { node: HTMLElement; source: OpenDragSource } | undefined {
  const node = target instanceof Element ? target.closest<HTMLElement>(SOURCES) : null;
  if (!node || node.classList.contains('is-missing')) return undefined;
  const path = node.dataset.docPath ?? node.dataset.homePath;
  if (!path) return undefined;
  const name = node.dataset.docName ?? node.querySelector<HTMLElement>('[title]')?.title ?? node.getAttribute('aria-label') ?? node.title ?? path.split(/[\\/]/).pop() ?? path;
  return { node, source: { path, name } };
}

/** A small copy of the cover under the pointer: the drawn picture when there is one, else the tile's own background. */
function ghostOf(node: HTMLElement): HTMLElement {
  const ghost = document.createElement('div');
  ghost.className = 'open-drag-ghost';
  const picture = node.querySelector<HTMLCanvasElement | HTMLImageElement>('canvas, img');
  if (picture instanceof HTMLCanvasElement && picture.width) {
    const copy = document.createElement('canvas');
    copy.width = picture.width; copy.height = picture.height;
    copy.getContext('2d')?.drawImage(picture, 0, 0);
    ghost.append(copy);
  } else if (picture instanceof HTMLImageElement) {
    ghost.append(Object.assign(document.createElement('img'), { src: picture.currentSrc || picture.src, alt: '' }));
  } else {
    const media = node.querySelector<HTMLElement>('[data-path]') ?? node, style = getComputedStyle(media);
    ghost.style.backgroundImage = style.backgroundImage; ghost.style.backgroundColor = style.backgroundColor;
  }
  return ghost;
}

export function attachOpenDrag(handlers: OpenDragHandlers) {
  let press: { id: number; x: number; y: number; node: HTMLElement; source: OpenDragSource } | undefined;
  let ghost: HTMLElement | undefined;

  const root = document.documentElement;
  const finish = () => {
    ghost?.remove(); ghost = undefined; press = undefined;
    root.classList.remove('is-open-dragging');
    for (const [type, listener] of listeners) window.removeEventListener(type, listener, true);
  };
  const place = (event: PointerEvent) => { if (ghost) ghost.style.transform = `translate(${event.clientX + 12}px, ${event.clientY + 12}px)`; };
  const move = (event: PointerEvent) => {
    if (!press || event.pointerId !== press.id) return;
    if (!(event.buttons & 1)) { handlers.cancel(); finish(); return; }
    if (!ghost) {
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) < OPEN_DRAG_SLOP) return;
      // Sideways on a horizontally scrolling shelf is the shelf's drag, not a document's.
      if (press.node.closest('[data-scroll-x]') && Math.abs(event.clientX - press.x) > Math.abs(event.clientY - press.y)) { finish(); return; }
      ghost = ghostOf(press.node); document.body.append(ghost); root.classList.add('is-open-dragging');
      // Capturing at the root keeps the move events coming over an EPUB's frame and anything else that would take them.
      try { root.setPointerCapture(event.pointerId); } catch { /* The pointer may already be gone. */ }
    }
    event.preventDefault(); place(event);
    handlers.over({ x: event.clientX, y: event.clientY }, press.source);
  };
  const up = (event: PointerEvent) => {
    if (!press || event.pointerId !== press.id) return;
    const dragged = Boolean(ghost), source = press.source;
    try { root.releasePointerCapture(event.pointerId); } catch { /* Not captured. */ }
    finish();
    if (!dragged) return;
    // The click that follows a drag must not open the tile it started on.
    const swallow = (click: Event) => { click.preventDefault(); click.stopPropagation(); };
    window.addEventListener('click', swallow, { capture: true, once: true }); setTimeout(() => window.removeEventListener('click', swallow, true));
    handlers.drop({ x: event.clientX, y: event.clientY }, source);
  };
  const cancel = () => { if (!press) return; const dragged = Boolean(ghost); finish(); if (dragged) handlers.cancel(); };
  const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && ghost) { event.preventDefault(); event.stopPropagation(); cancel(); } };
  const listeners: [string, EventListener][] = [['pointermove', move as EventListener], ['pointerup', up as EventListener], ['pointercancel', cancel], ['keydown', key as EventListener]];

  document.addEventListener('pointerdown', event => {
    if (press || event.button !== 0 || !event.isPrimary || event.pointerType === 'touch') return;
    const found = sourceOf(event.target);
    if (!found) return;
    press = { id: event.pointerId, x: event.clientX, y: event.clientY, ...found };
    for (const [type, listener] of listeners) window.addEventListener(type, listener, true);
  }, true);
  // A picture or a link under the pointer would otherwise start the platform's own drag.
  document.addEventListener('dragstart', event => { if (sourceOf(event.target)) event.preventDefault(); }, true);
}
