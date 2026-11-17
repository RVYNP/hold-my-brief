/**
 * The parts of a split that are drawn: a pane's row of tabs, the layer a pane's furniture (find bar, view controls, page strip, the placeholder
 * for a tab with no page) is laid on, and the dividers between the panes. The numbers and rules are in `layout.ts`; which tab is where is in
 * `tabs.ts`; `main.ts` owns what a pane shows.
 */
import { nudgePercent, percentAt, shareOf, snapPercent, type Axis, type Limits } from './layout';

/** What a side is drawn with. `body` is the layer over the pane's reading surface, `row` its tabs, `fold` the button at the row's end that swaps the panes while only one shows, `state` the placeholder of a tab with no page, `ghost` a still copy of the view controls while the side is not the active one. */
export type SideView = { id: string; body: HTMLElement; row: HTMLElement; list: HTMLElement; add: HTMLElement; overflow: HTMLElement; fold: HTMLElement; state: HTMLElement; ghost?: HTMLElement };

const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, attributes: Record<string, string> = {}) => {
  const node = document.createElement(tag);
  node.className = className;
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  return node;
};

/** Takes the ids out of a copy, so the page keeps one element of each id. */
export function withoutIds<T extends Element>(copy: T): T {
  copy.removeAttribute('id');
  for (const node of copy.querySelectorAll('[id]')) node.removeAttribute('id');
  return copy;
}

const sideName = (id: string) => `pane ${id.toUpperCase()}`;

/** A pane's row of tabs: the same parts the toolbar's strip is made of (a list, +, and an overflow button), without Home. */
export function createRow(id: string) {
  const row = make('nav', 'pane-strip', { 'data-pane': id, 'aria-label': `Documents in ${sideName(id)}` });
  const list = make('div', 'tab-list', { role: 'tablist', 'aria-label': `Documents, ${sideName(id)}` });
  const add = make('button', 'tab-add', { type: 'button', 'aria-label': `New tab, ${sideName(id)}`, title: 'New tab' });
  const overflow = make('button', 'tab-overflow', { type: 'button', 'aria-label': `All tabs, ${sideName(id)}`, title: 'All tabs', 'aria-haspopup': 'menu', 'aria-expanded': 'false' });
  overflow.hidden = true;
  const fold = make('button', 'pane-fold', { type: 'button' });
  fold.hidden = true;
  row.append(make('span', 'pane-edge', { 'aria-hidden': 'true' }), list, add, overflow, fold);
  return { row, list, add, overflow, fold };
}

/** The layer over a pane's reading surface. It takes no pointer; what is laid on it does. It ends with the dimming the pane wears while it is not the active one, which takes none either. */
export function createBody(id: string) {
  const body = make('div', 'pane-body', { 'data-pane': id });
  body.append(make('span', 'pane-dim', { 'aria-hidden': 'true' }));
  return body;
}

export type DividerHandlers = {
  /** The axis of the split the divider belongs to: a row has a vertical divider, a column a horizontal one. */
  axis: () => Axis;
  /** The divider's position, in percent. */
  percent: () => number;
  /** Takes a new position (already snapped and kept within the subtrees' minimum). */
  set: (percent: number) => void;
  /** Puts the divider in the middle. */
  even: () => void;
  /** The ends of the room the split's two subtrees share with the divider along its axis, in window pixels, and the percents that keep both at their minimum; undefined while the panes are not both showing. */
  bounds: () => { start: number; end: number; limits: Limits } | undefined;
};

/** A divider: a focusable separator. It is dragged, nudged with the arrow keys along its axis, Home and End, and double-clicked to even the panes it separates. */
export function createDivider(handlers: DividerHandlers) {
  const divider = make('div', 'pane-divider', { role: 'separator', tabindex: '0', 'aria-label': 'Resize the panes', title: 'Drag to resize · double-click to even them', 'aria-valuemin': '0', 'aria-valuemax': '100' });
  divider.hidden = true;
  let drag: number | undefined;
  divider.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault(); divider.focus(); divider.setPointerCapture(event.pointerId); drag = event.pointerId; divider.classList.add('is-dragging');
  });
  divider.addEventListener('pointermove', event => {
    const room = handlers.bounds();
    if (drag !== event.pointerId || !room) return;
    handlers.set(snapPercent(percentAt(handlers.axis() === 'row' ? event.clientX : event.clientY, room.start, room.end), shareOf(room.end - room.start), room.limits));
  });
  const end = (event: PointerEvent) => { if (drag !== event.pointerId) return; drag = undefined; divider.classList.remove('is-dragging'); };
  divider.addEventListener('pointerup', end); divider.addEventListener('pointercancel', end);
  divider.addEventListener('dblclick', handlers.even);
  divider.addEventListener('keydown', event => {
    const room = handlers.bounds();
    if (!room || event.ctrlKey || event.altKey || event.metaKey) return;
    const next = nudgePercent(event.key, handlers.percent(), room.limits, handlers.axis());
    if (next !== undefined) { event.preventDefault(); handlers.set(next); }
  });
  return divider;
}

/** Tells the divider (and its assistive description) where it is, and which way it runs. */
export function paintDivider(divider: HTMLElement, percent: number, axis: Axis) {
  const shown = Math.round(percent);
  divider.setAttribute('aria-orientation', axis === 'row' ? 'vertical' : 'horizontal');
  divider.style.cursor = axis === 'row' ? 'col-resize' : 'row-resize';
  divider.setAttribute('aria-valuenow', String(shown));
  divider.setAttribute('aria-valuetext', axis === 'row' ? `${shown} % left, ${100 - shown} % right` : `${shown} % top, ${100 - shown} % bottom`);
}

/** Lucide's `columns-2`. */
const COLUMNS_ICON = '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M12 3v18"/>';
/** The button at the end of a folded split's row: a two-columns icon and "Other side (n)" (with more than two panes, "Other panes (n)"), n being the documents the panes that are out of sight hold. Hidden when the panes are side by side. */
export function paintFold(fold: HTMLElement, folded: boolean, others: number, panes = 2) {
  fold.hidden = !folded;
  if (!folded) return;
  const side = panes > 2 ? 'panes' : 'side', label = `Other ${side} (${others})`;
  if (fold.textContent !== label || !fold.querySelector('svg')) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    for (const [name, value] of Object.entries({ width: '13', height: '13', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(name, value);
    svg.innerHTML = COLUMNS_ICON;
    fold.replaceChildren(svg, label);
  }
  fold.setAttribute('aria-label', `Other ${side}, ${others} ${others === 1 ? 'document' : 'documents'}`);
  fold.title = panes > 2 ? 'Show the next pane (Ctrl \\)' : 'Show the other side (Ctrl \\)';
}
