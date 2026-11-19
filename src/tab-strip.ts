/**
 * The tab strip in the toolbar, the open-tabs menu that the compact title and the strip's overflow button share, and the
 * pointer drag that reorders tabs. It draws what it is told (`paint`) and reports what the user did (`handlers`); the tab
 * model and everything a tab holds live in `tabs.ts` and `main.ts`.
 *
 * Dragging (reordering, and carrying a tab to another strip, a pane or an edge) uses pointer events, not HTML5 drag and drop: with Tauri's native drag-drop enabled WebView2 does not
 * deliver HTML5 drag events inside the page.
 */
import { slotAt } from './tabs';
import { middleTruncate } from './tab-titles';

/** What one tab shows. `image` tabs keep the end of a long title (cut in the middle); the others keep its start. `where` is the short place ("40 / 146"; the toolbar prints it "P. 40/146"), empty until the document has been read; `progress` is the library's wording for how far in it is ("p. 12 / 96", "37 %", "Finished"), for the tab menu. The Library tab (`library`) shows a glyph for the format and its title for the path. */
export type TabView = { path: string; title: string; hint: string; format: string; where: string; progress: string; active: boolean; problem: boolean; library: boolean; image: boolean };

export type TabHandlers = {
  /** A tab was chosen; `undefined` is Home (only the toolbar's open-tabs menu says so). */
  select: (path: string | undefined) => void;
  close: (path: string) => void;
  newTab: () => void;
  /** A dragged tab was dropped; `to` is its index among the tabs. */
  move: (path: string, to: number) => void;
  /** The context menu of a tab was asked for (right-click, the menu key, Shift+F10), at `at` or, from the keyboard, beside `anchor`. */
  menu: (path: string, anchor: HTMLElement, at: { x: number; y: number } | undefined) => void;
  /** A tab dragged away from its own strip: `over` hears every pointer position (to show where a release would land), `drop` the release, and `clear` that the preview must go (the drag came back, was cancelled, or ended). */
  carry: { over: (path: string, x: number, y: number) => void; drop: (path: string, x: number, y: number) => void; clear: () => void };
};

/** A press that travels less than this (CSS px) is a click, not a drag. */
const DRAG_SLOP = 4;
/** How far (CSS px) above or below its strip a dragged tab may stray and still be reordering in it. */
const AWAY_MARGIN = 12;
const NS = 'http://www.w3.org/2000/svg';

const icon = (paths: string, size = 14, stroke = 1.6) => {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', String(size)); svg.setAttribute('height', String(size)); svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', String(stroke));
  svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round'); svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = paths;
  return svg;
};
const icons = {
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9.5h13V10"/><path d="M10 19.5v-5h4v5"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  document: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  library: '<path d="m16 6 4 14"/><path d="M12 6v14"/><path d="M8 8v12"/><path d="M4 4v16"/>',
};

const text = (tag: string, className: string, content: string) => Object.assign(document.createElement(tag), { className, textContent: content });
/** Writes text only when it differs, so a repaint that changes nothing touches nothing. */
const setText = (element: Element, value: string) => { if (element.textContent !== value) element.textContent = value; };
let measuring: CanvasRenderingContext2D | null | undefined;
/** Whether `candidate` is at most `limit` CSS px wide in `font`; true when there is nothing to measure with, so the CSS ellipsis stays in charge. */
function fitsIn(font: string, limit: number): (candidate: string) => boolean {
  measuring ??= document.createElement('canvas').getContext('2d');
  const context = measuring;
  if (!context || !(limit > 0)) return () => true;
  context.font = font;
  return candidate => context.measureText(candidate).width <= limit - .5;
}
/** A tab's tooltip: the Library tab's title, else the path, under the title when a folder hint is shown beside it. */
const tooltip = (view: TabView) => view.library ? view.title : view.hint ? `${view.title}\n${view.path}` : view.path;
const closeButton = (title: string) => {
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'tab-close'; button.tabIndex = -1;
  button.setAttribute('aria-label', `Close ${title}`); button.title = 'Close tab';
  button.append(icon(icons.close, 11, 2));
  return button;
};

export type TabStrip = {
  paint: (tabs: readonly TabView[], home: boolean) => void;
  /** Shows the open-tabs menu under `anchor`. */
  openMenu: (anchor: HTMLElement) => void;
  closeMenu: () => void;
  isMenuOpen: () => boolean;
  /** The slot (an index among the tabs) a drop at this point of the window would open at, or undefined when the point is not over the strip. */
  dropSlot: (x: number, y: number) => number | undefined;
  /** Marks where a drop would go, with a ghost tab saying what is coming; `undefined` clears it. */
  showDrop: (slot: number | undefined, label?: string) => void;
};

/** The toolbar's place for a tab: "40 / 146" is printed "P. 40/146"; anything else ("37 %") is kept. */
const placeOf = (where: string) => where.replace(/^([\d–-]+) \/ (\d+)$/, 'P. $1/$2');

/**
 * `elements` are the static parts of the markup: the scrolling list of tabs, the optional + button and the overflow button.
 * `newTabKeys` is how the New tab command's shortcut is written on this platform. `toolbar` says which strip this is. The toolbar's
 * strip draws every tab with its title and place (no format badge), has no + button, and its open-tabs menu has a Home row and carries
 * the `tab-menu` id. A pane's own row of tabs (a split view) keeps the format badge, the place of its active tab only, its + button,
 * and a menu without a Home row.
 */
export function createTabStrip(elements: { strip: HTMLElement; list: HTMLElement; add?: HTMLElement; overflow: HTMLElement }, handlers: TabHandlers, newTabKeys: string, toolbar: boolean): TabStrip {
  const { strip, list, add, overflow } = elements;
  const nodes = new Map<string, HTMLElement>();
  let views: readonly TabView[] = [], homeActive = true, dragging = false, repaint = false;

  if (add) { add.replaceChildren(icon(icons.plus, 14, 2)); add.onclick = () => handlers.newTab(); }
  overflow.replaceChildren(icon(icons.chevron, 14, 2));
  overflow.onclick = () => (menu.hidden ? openMenu(overflow) : closeMenu());

  function build(view: TabView): HTMLElement {
    const tab = document.createElement('div');
    tab.className = 'tab'; tab.dataset.path = view.path; tab.setAttribute('role', 'tab'); tab.tabIndex = 0;
    const title = text('span', 'tab-title', ''), hint = text('span', 'tab-hint', ''), where = text('span', 'tab-where', '');
    // The toolbar's tabs have no format badge; only the Library tab keeps its glyph there.
    tab.append(...(toolbar && !view.library ? [] : [text('span', 'tab-format', '')]), title, hint, where, closeButton(view.title));
    return tab;
  }
  function fill(tab: HTMLElement, view: TabView) {
    tab.classList.toggle('is-active', view.active); tab.classList.toggle('has-problem', view.problem);
    tab.setAttribute('aria-selected', String(view.active)); tab.dataset.kind = view.library ? 'library' : 'document';
    tab.title = tooltip(view);
    if (!view.library) tab.dataset.format = view.format.toUpperCase();
    const mark = tab.querySelector('.tab-format');
    if (mark) { if (!view.library) setText(mark, view.format.toUpperCase()); else if (!mark.firstElementChild) mark.replaceChildren(icon(icons.library, 12)); }
    setText(tab.querySelector('.tab-hint')!, view.hint);
    setText(tab.querySelector('.tab-where')!, toolbar ? placeOf(view.where) : view.active ? view.where : '');
    tab.querySelector('.tab-close')!.setAttribute('aria-label', `Close ${view.title}`);
  }
  /**
   * An image tab's title is cut in the middle to fit the tab's real width and font, which depend on whether it is active; the
   * other tabs show the whole title and the CSS cuts its end. The full name stays in the tooltip and the accessible name.
   * Runs once the tab is in the page, where its font and `max-width` can be read.
   */
  function fit(tab: HTMLElement, view: TabView) {
    const title = tab.querySelector<HTMLElement>('.tab-title')!;
    if (!view.image || view.library) { delete title.dataset.fit; setText(title, view.title); tab.removeAttribute('aria-label'); return; }
    const style = getComputedStyle(title), font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`, limit = parseFloat(style.maxWidth);
    const key = `${view.title}\n${font}\n${limit}`;
    if (title.dataset.fit !== key) {
      title.dataset.fit = key;
      setText(title, middleTruncate(view.title, fitsIn(font, limit)));
    }
    const cut = title.textContent !== view.title;
    if (cut) tab.setAttribute('aria-label', view.hint ? `${view.title} · ${view.hint}` : view.title); else tab.removeAttribute('aria-label');
    tab.title = cut ? `${view.title}\n${view.path}` : tooltip(view);
  }
  const refit = () => { for (const view of views) { const node = nodes.get(view.path); if (node) { delete node.querySelector<HTMLElement>('.tab-title')!.dataset.fit; fit(node, view); } } };
  document.fonts?.addEventListener?.('loadingdone', refit);
  void document.fonts?.ready.then(refit);
  /** Keeps the active tab in view in a scrolling strip. */
  function reveal() {
    const tab = list.querySelector<HTMLElement>('.tab.is-active');
    if (!tab) return;
    const left = tab.offsetLeft, right = left + tab.offsetWidth;
    if (left < list.scrollLeft) list.scrollLeft = left;
    else if (right > list.scrollLeft + list.clientWidth) list.scrollLeft = right - list.clientWidth;
  }
  function measure() { overflow.hidden = list.scrollWidth <= list.clientWidth + 1; }

  function paint(next: readonly TabView[], atHome: boolean) {
    views = next; homeActive = atHome;
    if (dragging) { repaint = true; return; }
    const wanted = new Set(next.map(view => view.path));
    for (const [path, node] of nodes) if (!wanted.has(path)) { node.remove(); nodes.delete(path); }
    next.forEach((view, index) => {
      let node = nodes.get(view.path);
      if (!node) { node = build(view); nodes.set(view.path, node); }
      fill(node, view);
      if (list.children[index] !== node) list.insertBefore(node, list.children[index] ?? null);
      fit(node, view);
    });
    measure(); reveal();
    if (!menu.hidden) fillMenu();
  }

  list.addEventListener('click', event => {
    const target = event.target as Element, tab = target.closest<HTMLElement>('.tab');
    if (!tab) return;
    if (target.closest('.tab-close')) handlers.close(tab.dataset.path!); else handlers.select(tab.dataset.path!);
  });
  // Middle-click closes. The press itself is claimed, or the platform starts autoscrolling.
  list.addEventListener('mousedown', event => { if (event.button === 1) event.preventDefault(); });
  list.addEventListener('auxclick', event => {
    const tab = (event.target as Element).closest<HTMLElement>('.tab');
    if (event.button === 1 && tab) { event.preventDefault(); handlers.close(tab.dataset.path!); }
  });
  list.addEventListener('contextmenu', event => {
    const tab = (event.target as Element).closest<HTMLElement>('.tab');
    if (!tab) return;
    event.preventDefault();
    handlers.menu(tab.dataset.path!, tab, event.clientX || event.clientY ? { x: event.clientX, y: event.clientY } : undefined);
  });
  list.addEventListener('keydown', event => {
    const tab = (event.target as Element).closest<HTMLElement>('.tab');
    if (!tab || event.target !== tab) return;
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); handlers.select(tab.dataset.path!); }
    else if (event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey) { event.preventDefault(); handlers.menu(tab.dataset.path!, tab, undefined); }
    else if (event.key === 'Delete') { event.preventDefault(); handlers.close(tab.dataset.path!); }
    else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      const next = (event.key === 'ArrowRight' ? tab.nextElementSibling : tab.previousElementSibling) as HTMLElement | null;
      if (next) { event.preventDefault(); next.focus(); }
    }
  });
  // A mouse's vertical wheel scrolls an overflowing strip sideways.
  list.addEventListener('wheel', event => {
    if (event.ctrlKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX) || list.scrollWidth <= list.clientWidth) return;
    event.preventDefault(); list.scrollLeft += event.deltaY * (event.deltaMode === 1 ? 16 : 1);
  }, { passive: false });
  new ResizeObserver(measure).observe(list);

  // Dragging. The dragged tab follows the pointer (a translate over its current place) while the others make room by the DOM
  // order changing under it; the model is told once, on release. Over this strip the drag reorders; away from it (`away`) the tab
  // goes back to where it was and `handlers.carry` is told where the pointer is, so the window can show and take a drop elsewhere.
  // Escape, or a release away from every target, changes nothing.
  type Drag = { id: number; x: number; tab: HTMLElement; left: number; scroll: number; next: Element | null; moved: boolean; away: boolean; cancelled: boolean };
  let drag: Drag | undefined;
  const overStrip = (x: number, y: number) => {
    const box = strip.getBoundingClientRect();
    return x >= box.left && x <= box.right && y >= box.top - AWAY_MARGIN && y <= box.bottom + AWAY_MARGIN;
  };
  /** Moving a node in the DOM releases its pointer capture, and the release would then go to whatever is under the pointer instead of this list: the capture is taken again. */
  const moveTab = (held: Drag, before: Element | null) => {
    if (before ? held.tab.nextElementSibling !== before : list.lastElementChild !== held.tab) list.insertBefore(held.tab, before);
    if (held.moved && !held.tab.hasPointerCapture(held.id)) held.tab.setPointerCapture(held.id);
  };
  const putBack = (held: Drag) => moveTab(held, held.next);
  const settle = (held: Drag) => { dragging = false; held.tab.classList.remove('is-dragging', 'is-carried'); held.tab.style.translate = ''; handlers.carry.clear(); };
  list.addEventListener('pointerdown', event => {
    const tab = (event.target as Element).closest<HTMLElement>('.tab');
    if (!tab || drag || event.button !== 0 || !event.isPrimary || (event.target as Element).closest('.tab-close')) return;
    drag = { id: event.pointerId, x: event.clientX, tab, left: tab.offsetLeft, scroll: list.scrollLeft, next: tab.nextElementSibling, moved: false, away: false, cancelled: false };
    tab.setPointerCapture(event.pointerId); // Without it a press that leaves the row downward stops hearing moves before the drag starts.
  });
  list.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id || drag.cancelled) return;
    if (!(event.buttons & 1)) { drag = undefined; return; }
    if (!drag.moved) {
      if (Math.abs(event.clientX - drag.x) < DRAG_SLOP && overStrip(event.clientX, event.clientY)) return; // A press that has not moved sideways, and has not left the strip, is still a click.
      drag.moved = dragging = true; drag.tab.setPointerCapture(event.pointerId); drag.tab.classList.add('is-dragging');
    }
    const away = !overStrip(event.clientX, event.clientY);
    if (away) {
      if (!drag.away) { putBack(drag); drag.away = true; drag.tab.classList.add('is-carried'); }
      handlers.carry.over(drag.tab.dataset.path!, event.clientX, event.clientY);
    } else {
      if (drag.away) { drag.away = false; drag.tab.classList.remove('is-carried'); handlers.carry.clear(); }
      const others = [...list.querySelectorAll<HTMLElement>('.tab')].filter(tab => tab !== drag!.tab);
      const pointer = event.clientX - list.getBoundingClientRect().left + list.scrollLeft;
      const before = others[slotAt(others.map(tab => tab.offsetLeft + tab.offsetWidth / 2), pointer)] ?? null;
      moveTab(drag, before);
    }
    drag.tab.style.translate = `${event.clientX - drag.x + drag.scroll - list.scrollLeft - (drag.tab.offsetLeft - drag.left)}px 0`;
  });
  const endDrag = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.id) return;
    const held = drag; drag = undefined;
    if (!held.moved) return;
    const swallow = (click: Event) => { click.preventDefault(); click.stopPropagation(); };
    list.addEventListener('click', swallow, { capture: true, once: true }); setTimeout(() => list.removeEventListener('click', swallow, true));
    if (held.cancelled) return; // Escape has put everything back already.
    const dropped = event.type === 'pointerup';
    settle(held);
    if (held.away) { putBack(held); if (dropped) handlers.carry.drop(held.tab.dataset.path!, event.clientX, event.clientY); }
    else if (dropped) handlers.move(held.tab.dataset.path!, [...list.querySelectorAll('.tab')].indexOf(held.tab));
    if (repaint || !dropped) { repaint = false; paint(views, homeActive); }
  };
  list.addEventListener('pointerup', endDrag); list.addEventListener('pointercancel', endDrag);
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !drag?.moved || drag.cancelled) return;
    event.preventDefault(); event.stopPropagation();
    drag.cancelled = true; putBack(drag); settle(drag);
    if (repaint) { repaint = false; paint(views, homeActive); }
  }, true);

  // The menu of open tabs: Home, every document, then New tab. The compact title opens it, and so does the strip's overflow button.
  const menu = document.createElement('div');
  if (toolbar) menu.id = 'tab-menu';
  menu.className = 'tab-menu'; menu.hidden = true; menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', 'Open tabs');
  document.body.append(menu);
  let anchor: HTMLElement | undefined;
  function row(label: string, meta: string | undefined, active: boolean, glyph: string, onChoose: () => void, onClose?: () => void, hint = '', tip = '') {
    const item = document.createElement('div');
    item.className = 'tab-menu-row'; item.setAttribute('role', 'menuitem'); item.tabIndex = -1; item.classList.toggle('is-active', active);
    const body = document.createElement('span'); body.className = 'tab-menu-text'; const heading = text('span', 'tab-menu-title', label); if (hint) heading.append(text('span', 'tab-hint', hint)); body.append(heading);
    if (tip) item.title = tip;
    if (meta) body.append(text('span', 'tab-menu-meta', meta));
    item.append(icon(glyph, 14), body);
    if (onClose) { const close = closeButton(label); close.onclick = event => { event.stopPropagation(); onClose(); }; item.append(close); }
    item.onclick = () => { closeMenu(); onChoose(); };
    return item;
  }
  function fillMenu() {
    const rows: HTMLElement[] = toolbar ? [row('Home', undefined, homeActive, icons.home, () => handlers.select(undefined))] : [];
    for (const view of views) {
      const item = row(view.title, view.library ? undefined : [view.format.toUpperCase(), view.progress].filter(Boolean).join(' · '), view.active, view.library ? icons.library : icons.document, () => handlers.select(view.path), () => handlers.close(view.path), view.hint, view.library ? view.title : `${view.title}\n${view.path}`);
      item.dataset.path = view.path; rows.push(item);
    }
    const separator = document.createElement('div'); separator.className = 'tab-menu-separator'; separator.setAttribute('role', 'separator');
    const fresh = row('New tab…', undefined, false, icons.plus, () => handlers.newTab());
    fresh.append(text('kbd', 'tab-menu-key', newTabKeys));
    menu.replaceChildren(...rows, ...(views.length ? [separator] : []), fresh);
  }
  function place() {
    if (!anchor) return;
    const box = anchor.getBoundingClientRect(), width = Math.min(menu.offsetWidth, innerWidth - 12);
    menu.style.top = `${Math.round(box.bottom + 4)}px`;
    menu.style.left = `${Math.round(Math.max(6, Math.min(box.left, innerWidth - width - 6)))}px`;
    menu.style.maxHeight = `${Math.max(120, innerHeight - box.bottom - 16)}px`;
  }
  function openMenu(from: HTMLElement) {
    anchor = from; fillMenu(); menu.hidden = false; from.setAttribute('aria-expanded', 'true'); place();
    (menu.querySelector('.is-active') as HTMLElement | null ?? menu.querySelector<HTMLElement>('.tab-menu-row'))?.focus();
  }
  function closeMenu() {
    if (menu.hidden) return;
    menu.hidden = true; anchor?.setAttribute('aria-expanded', 'false'); anchor = undefined;
  }
  document.addEventListener('pointerdown', event => { if (!menu.hidden && !menu.contains(event.target as Node) && !anchor?.contains(event.target as Node)) closeMenu(); }, true);
  window.addEventListener('resize', () => closeMenu());
  /** A row's own menu: this list closes, and the tab's menu opens at the pointer or beside the button that opened this list. */
  function rowMenu(item: HTMLElement | null, at: { x: number; y: number } | undefined) {
    if (!item?.dataset.path) return;
    const owner = anchor ?? overflow;
    closeMenu(); handlers.menu(item.dataset.path, owner, at);
  }
  menu.addEventListener('contextmenu', event => { event.preventDefault(); rowMenu((event.target as Element).closest<HTMLElement>('.tab-menu-row'), event.clientX || event.clientY ? { x: event.clientX, y: event.clientY } : undefined); });
  menu.addEventListener('keydown', event => {
    const items = [...menu.querySelectorAll<HTMLElement>('.tab-menu-row')], at = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); const back = anchor; closeMenu(); back?.focus(); }
    else if (event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey) { event.preventDefault(); rowMenu(items[at] ?? null, undefined); }
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); items[(at + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus(); }
    else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); (document.activeElement as HTMLElement).click(); }
  });

  // A drop: an insertion marker between tabs, and a ghost tab beside it saying what is coming.
  const marker = document.createElement('div'), ghost = document.createElement('div');
  marker.className = 'tab-drop-marker'; ghost.className = 'tab-drop-ghost';
  marker.hidden = ghost.hidden = true;
  strip.append(marker, ghost);
  const tabRects = () => [...list.querySelectorAll<HTMLElement>('.tab')].map(tab => tab.getBoundingClientRect());
  function dropSlot(x: number, y: number) {
    const box = strip.getBoundingClientRect();
    if (!box.width || x < box.left || x > box.right || y < box.top || y > box.bottom) return undefined;
    return slotAt(tabRects().map(rect => rect.left + rect.width / 2), x);
  }
  function showDrop(slot: number | undefined, label = '') {
    marker.hidden = ghost.hidden = slot === undefined;
    if (slot === undefined) return;
    const box = strip.getBoundingClientRect(), place = list.getBoundingClientRect(), rects = tabRects();
    const edge = slot < rects.length ? rects[slot].left - 1 : rects.length ? rects[rects.length - 1].right + 1 : place.left;
    const left = Math.max(place.left, Math.min(place.right, edge)) - box.left;
    marker.style.left = `${left - 1}px`;
    ghost.textContent = label; ghost.style.left = `${left + 6}px`;
  }

  return { paint, openMenu, closeMenu, isMenuOpen: () => !menu.hidden, dropSlot, showDrop };
}
