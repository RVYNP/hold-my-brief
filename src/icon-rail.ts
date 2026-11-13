// The window's icon rail: a 48 px strip of the places the library opens on (Library, Favorites, Collections, Search), Home, Add
// files, and, at its foot, the side switch and Appearance. It is the library's only door at 720 px and up; the info rail it opens
// (library.ts) stands beside it. It is a window-level overlay like the info rail, so it never changes the page's box.
import type { LibrarySide } from './library-layout';

export type RailView = 'library' | 'favorites' | 'collections' | 'search';

export type IconRailHost = {
  /** One of the four library icons was pressed: open the info rail on it, or collapse it when it is already showing that. */
  view: (view: RailView) => void;
  home: () => void;
  /** Add files was pressed; `anchor` is the button, for the menu it opens. */
  add: (anchor: HTMLElement) => void;
  appearance: () => void;
  /** Keeps the library on `side`: the one saved preference the info rail and the palette share. */
  setSide: (side: LibrarySide) => void;
};

const icon = (paths: string) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
export const railIcons = {
  library: icon('<path d="M20 10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2.5a1 1 0 0 1-.8-.4l-.9-1.2A1 1 0 0 0 15 3h-2a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z"/><path d="M20 21a1 1 0 0 0 1-1v-3a1 1 0 0 0-1-1h-2.9a1 1 0 0 1-.88-.55l-.42-.85a1 1 0 0 0-.92-.6H13a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z"/><path d="M3 5a2 2 0 0 0 2 2h3"/><path d="M3 3v13a2 2 0 0 0 2 2h3"/>'),
  home: icon('<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  favorites: icon('<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>'),
  collections: icon('<path d="m16 6 4 14"/><path d="M12 6v14"/><path d="M8 8v12"/><path d="M4 4v16"/>'),
  search: icon('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>'),
  add: icon('<path d="M5 12h14"/><path d="M12 5v14"/>'),
  appearance: icon('<circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.65-.75 1.65-1.69 0-.44-.18-.84-.44-1.13-.29-.29-.44-.65-.44-1.13a1.64 1.64 0 0 1 1.67-1.67h2c3.05 0 5.55-2.5 5.55-5.55C21.97 6.01 17.46 2 12 2z"/>'),
  /** The panel with its divider on `side`: the glyph of the button that moves the library there. */
  side: (side: LibrarySide) => icon(`<rect width="18" height="18" x="3" y="3" rx="2"/><path d="${side === 'left' ? 'M9 3v18' : 'M15 3v18'}"/>`),
};

type Entry = { id: string; label: string; shortcut?: string; icon: string; view?: RailView };
const top: readonly Entry[] = [
  { id: 'library', label: 'Library', shortcut: 'Ctrl+B', icon: railIcons.library, view: 'library' },
  { id: 'home', label: 'Home', icon: railIcons.home },
  { id: 'favorites', label: 'Favorites', icon: railIcons.favorites, view: 'favorites' },
  { id: 'collections', label: 'Collections', icon: railIcons.collections, view: 'collections' },
  { id: 'search', label: 'Search', shortcut: 'Ctrl+Shift+F', icon: railIcons.search, view: 'search' },
  { id: 'add', label: 'Add files', icon: railIcons.add },
];

export function createIconRail(root: HTMLElement, host: IconRailHost) {
  root.classList.add('icon-rail'); root.setAttribute('aria-label', 'Library rail');
  const button = (entry: { id: string; label: string; shortcut?: string; icon: string }) => {
    const node = document.createElement('button'); node.type = 'button'; node.className = 'icon-rail-button'; node.dataset.rail = entry.id;
    node.innerHTML = entry.icon; node.setAttribute('aria-label', entry.label);
    // The tooltip is drawn by CSS from `data-tip` (beside the rail, on the side the rail is not); the name and shortcut are also exposed to assistive technology.
    node.dataset.tip = entry.shortcut ? `${entry.label}  ${entry.shortcut}` : entry.label;
    if (entry.shortcut) node.setAttribute('aria-keyshortcuts', entry.shortcut.replace('Ctrl', 'Control'));
    return node;
  };
  const buttons = new Map<string, HTMLButtonElement>();
  const group = document.createElement('div'); group.className = 'icon-rail-group';
  for (const entry of top) {
    const node = button(entry); buttons.set(entry.id, node); group.append(node);
    if (entry.view) { node.setAttribute('aria-controls', 'library-root'); node.setAttribute('aria-pressed', 'false'); }
    const view = entry.view;
    node.onclick = () => { if (view) host.view(view); else if (entry.id === 'home') host.home(); else host.add(node); };
  }
  buttons.get('home')!.setAttribute('aria-pressed', 'false');
  const foot = document.createElement('div'); foot.className = 'icon-rail-group icon-rail-foot';
  const side = button({ id: 'side', label: 'Move library to the right', icon: railIcons.side('right') });
  const settings = button({ id: 'appearance', label: 'Appearance', icon: railIcons.appearance });
  settings.onclick = () => host.appearance();
  foot.append(side, settings); buttons.set('side', side); buttons.set('appearance', settings);
  const menu = document.createElement('div'); menu.className = 'icon-rail-menu'; menu.setAttribute('role', 'menu'); menu.hidden = true;
  let current: LibrarySide = 'left';
  const choices = (['left', 'right'] as const).map(target => {
    const item = document.createElement('button'); item.type = 'button'; item.setAttribute('role', 'menuitemradio'); item.textContent = `Keep library on the ${target}`;
    item.onclick = () => { closeMenu(false); host.setSide(target); };
    return { target, item };
  });
  menu.append(...choices.map(choice => choice.item));
  const other = () => current === 'left' ? 'right' : 'left';
  side.onclick = () => host.setSide(other());
  function closeMenu(refocus = true) {
    if (menu.hidden) return;
    menu.hidden = true; document.removeEventListener('pointerdown', outside, true);
    if (refocus && side.isConnected) side.focus();
  }
  function outside(event: Event) { if (!menu.contains(event.target as Node)) closeMenu(false); }
  function openMenu(x: number, y: number) {
    for (const { target, item } of choices) item.setAttribute('aria-checked', String(target === current));
    menu.hidden = false;
    // Fixed to the window, so the rail never clips it; kept inside the window.
    menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - menu.offsetWidth - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - menu.offsetHeight - 4))}px`;
    document.addEventListener('pointerdown', outside, true);
    menu.querySelector<HTMLElement>('[aria-checked=true]')?.focus();
  }
  root.addEventListener('contextmenu', event => {
    if (menu.contains(event.target as Node)) return;
    event.preventDefault();
    // The menu key and Shift+F10 arrive with no pointer position: open beside the focused control instead.
    const at = event.clientX || event.clientY ? { x: event.clientX, y: event.clientY } : (() => { const box = (event.target as HTMLElement).getBoundingClientRect(); return { x: box.left, y: box.bottom }; })();
    closeMenu(false); openMenu(at.x, at.y);
  });
  menu.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeMenu(); }
    else if (event.key === 'Tab') closeMenu(false);
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const at = choices.findIndex(choice => choice.item === document.activeElement);
      choices[(at + (event.key === 'ArrowDown' ? 1 : choices.length - 1)) % choices.length]!.item.focus();
    }
  });
  // The rail is one tab stop: arrows (and Home/End) move between its buttons, as a toolbar's do.
  root.addEventListener('keydown', event => {
    if (menu.contains(event.target as Node) || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const all = [...root.querySelectorAll<HTMLButtonElement>('.icon-rail-button')]; const at = all.indexOf(document.activeElement as HTMLButtonElement); if (at < 0) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? all.length - 1 : (at + (event.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length;
    all[next]!.focus();
  });
  root.replaceChildren(group, foot, menu);
  // Home is marked only while nothing else is: with the info rail open, its view is where you are.
  let view: RailView | null = null; let homeShowing = false;
  const paintHome = () => buttons.get('home')!.setAttribute('aria-pressed', String(homeShowing && view === null));
  const set = (next: LibrarySide) => {
    current = next; root.dataset.librarySide = next;
    side.innerHTML = railIcons.side(other()); side.setAttribute('aria-label', `Move library to the ${other()}`); side.dataset.tip = `Move library to the ${other()}`;
    for (const { target, item } of choices) item.setAttribute('aria-checked', String(target === current));
  };
  set(current);
  return {
    setSide: set,
    /** The info rail is open on `view`, or closed (`null`). */
    setView: (next: RailView | null) => { view = next; for (const entry of top) if (entry.view) buttons.get(entry.id)!.setAttribute('aria-pressed', String(entry.view === next)); paintHome(); },
    /** Home is the page showing. */
    setHome: (showing: boolean) => { homeShowing = showing; paintHome(); },
    button: (id: string) => buttons.get(id)!,
  };
}
