// The library's closed form: a thin rail beside the reading panel with the library toggle on top and the
// latest recents under it, drawn with the same covers and pictures as Home (src/cards.ts). Opening the
// library replaces the rail with the drawer; the rail is a window-level overlay like the drawer, so it
// never changes the page's box. The rail is only shown from 720 px up (see library.css).
import { homeRows, openedAt, type HomeDocument, type HomeRecent, type HomeTile } from './home';
import { showPicture, markUnavailable, tileMedia, type Appearance } from './cards';
import { canThumbnail, type Thumbnail } from './thumbnails';
import type { LibrarySide } from './library-layout';

/** Most covers the rail shows. */
export const railLimit = 8;
/** Cover size in px (3:4 would be 40 x 53.3). */
export const railCover = { width: 40, height: 54 } as const;

/** The covers for the rail: the recents, most recent first, each with the library entry's own cover where it has one. `titleOf` is an EPUB's own title once read. */
export function railItems(recents: readonly HomeRecent[], documents: readonly HomeDocument[], titleOf?: (item: HomeDocument) => string | undefined): HomeTile[] {
  return homeRows(recents, documents, '', titleOf).find(row => row.id === 'recent')?.items.slice(0, railLimit) ?? [];
}

/** What the browser build has for recents (no store keeps a list there): the library's documents that were opened, latest first. */
export function openedOrder(documents: readonly HomeDocument[]): HomeDocument[] {
  return documents.filter(doc => openedAt(doc.lastOpened) > 0).sort((a, b) => openedAt(b.lastOpened) - openedAt(a.lastOpened) || a.name.localeCompare(b.name));
}

export type RailHost = {
  /** The same action as the toolbar's library button. */
  toggle: () => void;
  open: (path: string, name: string) => void;
  /** Pictures and EPUB titles come from the store Home uses, so a cover made for one is at once there for the other. */
  picture: (path: string, format: string, alive: () => boolean) => Promise<Thumbnail | undefined>;
  peek: (path: string) => Thumbnail | undefined;
  epub: (path: string, alive: () => boolean) => Promise<unknown>;
  title: (path: string) => string | undefined;
  failed: (path: string) => boolean;
  /** Keeps the library, rail and drawer both, on `side`: the same preference as the drawer's dock button. */
  setSide: (side: LibrarySide) => void;
};

const toggleIcon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16m-3-12v8"/></svg>';

/** The panel with its divider on `side`: the glyph of the button that moves the library there, as on the drawer's dock button. */
const sideIcon = (side: LibrarySide) => `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="${side === 'left' ? 'M9 3v18' : 'M15 3v18'}"/></svg>`;

export function createLibraryRail(root: HTMLElement, host: RailHost): { paint: (items: readonly HomeTile[], activePath: string | undefined, appearance: Appearance) => void; setSide: (side: LibrarySide) => void } {
  root.classList.add('library-rail'); root.setAttribute('aria-label', 'Library rail');
  const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'library-rail-toggle'; toggle.innerHTML = toggleIcon;
  toggle.setAttribute('aria-label', 'Open library'); toggle.setAttribute('aria-expanded', 'false'); toggle.setAttribute('aria-controls', 'library-root'); toggle.title = 'Document library (Ctrl+B)';
  toggle.onclick = () => host.toggle();
  const list = document.createElement('div'); list.className = 'library-rail-list'; list.setAttribute('role', 'list');
  // The side control sits at the foot of the rail, below the scrolling covers, so it never scrolls away.
  const move = document.createElement('button'); move.type = 'button'; move.className = 'library-rail-side';
  const menu = document.createElement('div'); menu.className = 'library-rail-menu'; menu.setAttribute('role', 'menu'); menu.hidden = true;
  let side: LibrarySide = 'left';
  const choices = (['left', 'right'] as const).map(target => {
    const item = document.createElement('button'); item.type = 'button'; item.setAttribute('role', 'menuitemradio'); item.textContent = `Keep library on the ${target}`;
    item.onclick = () => { closeMenu(false); host.setSide(target); };
    return { target, item };
  });
  menu.append(...choices.map(choice => choice.item));
  const other = () => side === 'left' ? 'right' : 'left';
  move.onclick = () => host.setSide(other());
  function closeMenu(refocus = true) {
    if (menu.hidden) return;
    menu.hidden = true; document.removeEventListener('pointerdown', outside, true);
    if (refocus && move.isConnected) move.focus();
  }
  function outside(event: Event) { if (!menu.contains(event.target as Node)) closeMenu(false); }
  function openMenu(x: number, y: number) {
    for (const { target, item } of choices) item.setAttribute('aria-checked', String(target === side));
    menu.hidden = false;
    // Fixed to the window, so the rail's own clipping never cuts it; kept inside the window.
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
  function setSide(next: LibrarySide) {
    side = next; root.dataset.librarySide = next;
    move.innerHTML = sideIcon(other()); move.setAttribute('aria-label', `Move library to the ${other()}`); move.title = `Move library to the ${other()}`;
    for (const { target, item } of choices) item.setAttribute('aria-checked', String(target === side));
  }
  setSide(side);
  root.replaceChildren(toggle, list, move, menu);
  let generation = 0;
  // Pictures the store has not made yet (a PDF's first page, an EPUB's cover) are made after the paint and once the page is idle, never
  // while a document is opening or being read: rendering them is real work on the same thread. A repaint before then supersedes them.
  const settle = 600;
  const whenIdle = (run: () => void) => window.setTimeout(() => (window.requestIdleCallback ? window.requestIdleCallback(run, { timeout: 3000 }) : run()), settle);
  function paint(items: readonly HomeTile[], activePath: string | undefined, appearance: Appearance) {
    const current = ++generation, alive = () => current === generation, loads: (() => void)[] = [];
    list.replaceChildren(...items.map(item => {
      const thumbnailable = canThumbnail(item.format), generated = !item.missing && (!thumbnailable || item.format.toLowerCase() === 'epub');
      const cell = document.createElement('div'); cell.setAttribute('role', 'listitem'); cell.className = 'library-rail-item'; cell.classList.toggle('is-missing', item.missing); cell.classList.toggle('is-cover', generated);
      const open = document.createElement('button'); open.type = 'button'; open.className = 'library-rail-cover'; open.dataset.railPath = item.path;
      open.setAttribute('aria-label', item.label); open.title = item.label;
      if (item.path === activePath) { open.classList.add('is-active'); open.setAttribute('aria-current', 'true'); }
      const media = tileMedia({ ...item, ratio: railCover.width / railCover.height, generated, thumbnailable }, appearance);
      const cached = thumbnailable && !item.missing ? host.peek(item.path) : undefined;
      if (cached) showPicture(media, cached);
      open.append(media); open.onclick = () => host.open(item.path, item.name); cell.append(open);
      if (thumbnailable && !item.missing) {
        if (!cached) loads.push(() => void host.picture(item.path, item.format, alive).then(picture => {
          if (!alive() || !media.isConnected) return;
          if (picture) showPicture(media, picture); else if (host.failed(item.path)) markUnavailable(media);
        }));
        if (item.format.toLowerCase() === 'epub') loads.push(() => void host.epub(item.path, alive).then(() => {
          const known = host.title(item.path); if (!alive() || !known) return;
          open.setAttribute('aria-label', known); open.title = known;
        }));
      }
      return cell;
    }));
    if (loads.length) whenIdle(() => { if (alive()) for (const load of loads) load(); });
  }
  return { paint, setSide };
}
