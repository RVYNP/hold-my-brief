import { boxBetween, worthSending, type Box } from './area';

/** Keys the overlay keeps from the reader while it is up: scrolling, turning pages and zooming would move the page under the box. */
const MOVING = new Set(['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'pageup', 'pagedown', 'home', 'end', ' ']);
const ZOOMING = new Set(['+', '=', '-', '_', '0', '2', '3', '4']);

export type AreaDrag = {
  /** Takes the overlay away without sending anything. Harmless once the drag has ended. */
  cancel(): void;
};

/**
 * Lays a transparent overlay over `host` (the reading surface) and lets the user drag a box over it: a crosshair cursor, a hint at the
 * top, a 1 px accent border with a faint accent fill. Releasing a box of at least 8 × 8 px calls `onBox` with it in CSS px from the host's
 * top-left corner; a smaller one, Escape, a press outside the host's area, a window resize or `cancel()` ends it without `onBox`.
 * The wheel, pinch and the keys that scroll, turn pages or zoom do nothing meanwhile. The overlay is removed in every case, `onEnd` called last.
 */
export function startAreaDrag(host: HTMLElement, { onBox, onEnd }: { onBox: (box: Box) => void; onEnd?: () => void }): AreaDrag {
  const bounds = host.getBoundingClientRect();
  const overlay = document.createElement('div'); overlay.className = 'area-overlay';
  Object.assign(overlay.style, { left: `${bounds.left}px`, top: `${bounds.top}px`, width: `${bounds.width}px`, height: `${bounds.height}px` });
  const hint = document.createElement('div'); hint.className = 'area-hint'; hint.textContent = 'Drag a box to send · Esc to cancel';
  const rubber = document.createElement('div'); rubber.className = 'area-box'; rubber.hidden = true;
  overlay.append(hint, rubber);
  let from: { x: number; y: number } | undefined, pointer: number | undefined, over = false;

  const point = (event: PointerEvent) => ({ x: Math.max(0, Math.min(bounds.width, event.clientX - bounds.left)), y: Math.max(0, Math.min(bounds.height, event.clientY - bounds.top)) });
  const finish = (box?: Box) => {
    if (over) return;
    over = true;
    overlay.remove();
    window.removeEventListener('keydown', key, true); window.removeEventListener('pointerdown', outside, true); window.removeEventListener('resize', cancel);
    try { if (box && worthSending(box)) onBox(box); } finally { onEnd?.(); }
  };
  const cancel = () => finish();
  const key = (event: KeyboardEvent) => {
    const name = event.key.toLowerCase(), zoom = (event.ctrlKey || event.metaKey) && ZOOMING.has(name), move = !event.ctrlKey && !event.metaKey && !event.altKey && MOVING.has(name);
    if (name === 'escape') { event.preventDefault(); event.stopImmediatePropagation(); cancel(); }
    else if (zoom || move) { event.preventDefault(); event.stopImmediatePropagation(); }
  };
  const outside = (event: PointerEvent) => { if (!(event.target instanceof Node && overlay.contains(event.target))) cancel(); };

  overlay.addEventListener('pointerdown', event => {
    event.preventDefault();
    if (event.button !== 0 || !event.isPrimary || from) return;
    from = point(event); pointer = event.pointerId; overlay.setPointerCapture(event.pointerId);
  });
  overlay.addEventListener('pointermove', event => {
    if (!from || event.pointerId !== pointer) return;
    const box = boxBetween(from, point(event));
    Object.assign(rubber.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px` }); rubber.hidden = false;
  });
  overlay.addEventListener('pointerup', event => { if (from && event.pointerId === pointer) finish(boxBetween(from, point(event))); });
  overlay.addEventListener('pointercancel', cancel);
  overlay.addEventListener('wheel', event => event.preventDefault(), { passive: false });
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) overlay.addEventListener(type, event => event.preventDefault());
  overlay.addEventListener('contextmenu', event => event.preventDefault());

  window.addEventListener('keydown', key, true); window.addEventListener('pointerdown', outside, true); window.addEventListener('resize', cancel);
  document.body.append(overlay);
  return { cancel };
}
