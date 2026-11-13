/**
 * The tab strip in the toolbar, the open-tabs menu that the compact title and the strip's overflow button share, and the
 * pointer drag that reorders tabs. It draws what it is told (`paint`) and reports what the user did (`handlers`); the tab
 * model and everything a tab holds live in `tabs.ts` and `main.ts`.
 *
 * Reordering uses pointer events, not HTML5 drag and drop: with Tauri's native drag-drop enabled WebView2 does not
 * deliver HTML5 drag events inside the page.
 */
import { slotAt } from './tabs';

/** What one tab shows. `where` is the short place ("40 / 146"), empty until the document has been read; `progress` is the library's wording for how far in it is ("p. 12 / 96", "37 %", "Finished"), for the tab menu. */
export type TabView = { path: string; title: string; format: string; where: string; progress: string; active: boolean; problem: boolean };

export type TabHandlers = {
  /** A tab was chosen; `undefined` is Home. */
  select: (path: string | undefined) => void;
  close: (path: string) => void;
  newTab: () => void;
  /** A dragged tab was dropped; `to` is its index among the tabs. */
  move: (path: string, to: number) => void;
};

/** A press that travels less than this (CSS px) is a click, not a drag. */
const DRAG_SLOP = 4;
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
};

const text = (tag: string, className: string, content: string) => Object.assign(document.createElement(tag), { className, textContent: content });
/** Writes text only when it differs, so a repaint that changes nothing touches nothing. */
const setText = (element: Element, value: string) => { if (element.textContent !== value) element.textContent = value; };
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
};

/**
 * `elements` are the static parts of the toolbar markup: the Home button, the scrolling list of tabs, the + button and the
 * overflow button. `newTabKeys` is how the New tab command's shortcut is written on this platform.
 */
export function createTabStrip(elements: { home: HTMLElement; list: HTMLElement; add: HTMLElement; overflow: HTMLElement }, handlers: TabHandlers, newTabKeys: string): TabStrip {
  const { home, list, add, overflow } = elements;
  const nodes = new Map<string, HTMLElement>();
  let views: readonly TabView[] = [], homeActive = true, dragging = false, repaint = false;

  home.replaceChildren(icon(icons.home, 16));
  home.onclick = () => handlers.select(undefined);
  add.replaceChildren(icon(icons.plus, 14, 2));
  add.onclick = () => handlers.newTab();
  overflow.replaceChildren(icon(icons.chevron, 14, 2));
  overflow.onclick = () => (menu.hidden ? openMenu(overflow) : closeMenu());

  function build(view: TabView): HTMLElement {
    const tab = document.createElement('div');
    tab.className = 'tab'; tab.dataset.path = view.path; tab.setAttribute('role', 'tab'); tab.tabIndex = 0;
    const format = text('span', 'tab-format', ''), title = text('span', 'tab-title', ''), where = text('span', 'tab-where', '');
    tab.append(format, title, where, closeButton(view.title));
    return tab;
  }
  function fill(tab: HTMLElement, view: TabView) {
    tab.classList.toggle('is-active', view.active); tab.classList.toggle('has-problem', view.problem);
    tab.setAttribute('aria-selected', String(view.active));
    tab.title = view.path;
    setText(tab.querySelector('.tab-format')!, view.format.toUpperCase());
    setText(tab.querySelector('.tab-title')!, view.title);
    setText(tab.querySelector('.tab-where')!, view.active ? view.where : '');
    tab.querySelector('.tab-close')!.setAttribute('aria-label', `Close ${view.title}`);
  }
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
    home.classList.toggle('is-active', atHome); home.setAttribute('aria-selected', String(atHome));
    const wanted = new Set(next.map(view => view.path));
    for (const [path, node] of nodes) if (!wanted.has(path)) { node.remove(); nodes.delete(path); }
    next.forEach((view, index) => {
      let node = nodes.get(view.path);
      if (!node) { node = build(view); nodes.set(view.path, node); }
      fill(node, view);
      if (list.children[index] !== node) list.insertBefore(node, list.children[index] ?? null);
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
  list.addEventListener('keydown', event => {
    const tab = (event.target as Element).closest<HTMLElement>('.tab');
    if (!tab || event.target !== tab) return;
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); handlers.select(tab.dataset.path!); }
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

  // Reordering. The dragged tab follows the pointer (a translate over its current place) while the others make room by the DOM
  // order changing under it; the model is told once, on release.
  let drag: { id: number; x: number; tab: HTMLElement; left: number; scroll: number; moved: boolean } | undefined;
  list.addEventListener('pointerdown', event => {
    const tab = (event.target as Element).closest<HTMLElement>('.tab');
    if (!tab || drag || event.button !== 0 || !event.isPrimary || (event.target as Element).closest('.tab-close')) return;
    drag = { id: event.pointerId, x: event.clientX, tab, left: tab.offsetLeft, scroll: list.scrollLeft, moved: false };
  });
  list.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    if (!(event.buttons & 1)) { drag = undefined; return; }
    if (!drag.moved) {
      if (Math.abs(event.clientX - drag.x) < DRAG_SLOP) return;
      drag.moved = dragging = true; drag.tab.setPointerCapture(event.pointerId); drag.tab.classList.add('is-dragging');
    }
    const others = [...list.querySelectorAll<HTMLElement>('.tab')].filter(tab => tab !== drag!.tab);
    const pointer = event.clientX - list.getBoundingClientRect().left + list.scrollLeft;
    const before = others[slotAt(others.map(tab => tab.offsetLeft + tab.offsetWidth / 2), pointer)] ?? null;
    if (before ? drag.tab.nextElementSibling !== before : list.lastElementChild !== drag.tab) list.insertBefore(drag.tab, before);
    drag.tab.style.translate = `${event.clientX - drag.x + drag.scroll - list.scrollLeft - (drag.tab.offsetLeft - drag.left)}px 0`;
  });
  const endDrag = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.id) return;
    const { tab, moved } = drag; drag = undefined;
    if (!moved) return;
    dragging = false; tab.classList.remove('is-dragging'); tab.style.translate = '';
    const swallow = (click: Event) => { click.preventDefault(); click.stopPropagation(); };
    list.addEventListener('click', swallow, { capture: true, once: true }); setTimeout(() => list.removeEventListener('click', swallow, true));
    if (event.type === 'pointerup') handlers.move(tab.dataset.path!, [...list.querySelectorAll('.tab')].indexOf(tab));
    if (repaint || event.type !== 'pointerup') { repaint = false; paint(views, homeActive); }
  };
  list.addEventListener('pointerup', endDrag); list.addEventListener('pointercancel', endDrag);

  // The menu of open tabs: Home, every document, then New tab. The compact title opens it, and so does the strip's overflow button.
  const menu = document.createElement('div');
  menu.id = 'tab-menu'; menu.className = 'tab-menu'; menu.hidden = true; menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', 'Open tabs');
  document.body.append(menu);
  let anchor: HTMLElement | undefined;
  function row(label: string, meta: string | undefined, active: boolean, glyph: string, onChoose: () => void, onClose?: () => void) {
    const item = document.createElement('div');
    item.className = 'tab-menu-row'; item.setAttribute('role', 'menuitem'); item.tabIndex = -1; item.classList.toggle('is-active', active);
    const body = document.createElement('span'); body.className = 'tab-menu-text'; body.append(text('span', 'tab-menu-title', label));
    if (meta) body.append(text('span', 'tab-menu-meta', meta));
    item.append(icon(glyph, 14), body);
    if (onClose) { const close = closeButton(label); close.onclick = event => { event.stopPropagation(); onClose(); }; item.append(close); }
    item.onclick = () => { closeMenu(); onChoose(); };
    return item;
  }
  function fillMenu() {
    const rows: HTMLElement[] = [row('Home', undefined, homeActive, icons.home, () => handlers.select(undefined))];
    for (const view of views) rows.push(row(view.title, [view.format.toUpperCase(), view.progress].filter(Boolean).join(' · '), view.active, icons.document, () => handlers.select(view.path), () => handlers.close(view.path)));
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
  menu.addEventListener('keydown', event => {
    const items = [...menu.querySelectorAll<HTMLElement>('.tab-menu-row')], at = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); const back = anchor; closeMenu(); back?.focus(); }
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); items[(at + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus(); }
    else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); (document.activeElement as HTMLElement).click(); }
  });

  return { paint, openMenu, closeMenu, isMenuOpen: () => !menu.hidden };
}
