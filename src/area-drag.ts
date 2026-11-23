import { boxBetween, worthSending, type Box } from './area';

export type AreaDrag = {
  /** Takes the overlay away without sending anything. Harmless once the drag has ended. */
  cancel(): void;
};

/**
 * Lays a transparent overlay over `host` (the reading surface) and lets the user drag a box over it: a crosshair cursor, a hint at the
 * top, a 1 px accent border with a faint accent fill. Releasing a box of at least 8 × 8 px calls `onBox` with it in CSS px from the host's
 * top-left corner; a smaller one, Escape, a press outside the host's area, a window resize, any change in the host's size or `cancel()` ends it without `onBox`.
 * The wheel, pinch and every key but Escape do nothing meanwhile. The overlay is removed in every case, `onEnd` called last.
 */
export function startAreaDrag(host: HTMLElement, { onBox, onEnd }: { onBox: (box: Box) => void; onEnd?: () => void }): AreaDrag {
  const bounds = host.getBoundingClientRect();
  const overlay = document.createElement('div'); overlay.className = 'area-overlay';
  Object.assign(overlay.style, { left: `${bounds.left}px`, top: `${bounds.top}px`, width: `${bounds.width}px`, height: `${bounds.height}px` });
  const hint = document.createElement('div'); hint.className = 'area-hint'; hint.textContent = 'Drag a box to send · Esc to cancel';
  const rubber = document.createElement('div'); rubber.className = 'area-box'; rubber.hidden = true;
  overlay.append(hint, rubber);
  let resized: ResizeObserver | undefined;
  let from: { x: number; y: number } | undefined, pointer: number | undefined, over = false;

  const point = (event: PointerEvent) => ({ x: Math.max(0, Math.min(bounds.width, event.clientX - bounds.left)), y: Math.max(0, Math.min(bounds.height, event.clientY - bounds.top)) });
  const finish = (box?: Box) => {
    if (over) return;
    over = true;
    overlay.remove();
    window.removeEventListener('keydown', key, true); window.removeEventListener('pointerdown', outside, true); window.removeEventListener('resize', cancel); resized?.disconnect();
    try { if (box && worthSending(box)) onBox(box); } finally { onEnd?.(); }
  };
  const cancel = () => finish();
  const key = (event: KeyboardEvent) => {
    event.preventDefault(); event.stopImmediatePropagation();
    if (event.key === 'Escape') cancel();
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
  // The box is measured against `bounds` and the adapter measures the host again at release: a layout change in between would send another part of the page.
  resized = new ResizeObserver(() => { const now = host.getBoundingClientRect(); if (now.left !== bounds.left || now.top !== bounds.top || now.width !== bounds.width || now.height !== bounds.height) cancel(); });
  resized.observe(host);
  return { cancel };
}
