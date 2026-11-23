// The window's icon rail: a 48 px strip of bare icons, Home, Add files, Library and Search at the top and Settings anchored at the foot, with a
// hairline along its inner edge. On desktop, a Pinned on top and a Size locked chip stand above Settings while (and only while) that window state is on. Home is where the toolbar's Home tab used to be (a compact window reaches Home through the open-tabs menu);
// Library and Search are the library's only door at 720 px and up, and the panel they open (library.ts) docks beside the rail. The rail
// overlays the page's edge while the panel is closed, so it never changes the page's box.

/** What an icon asks of the library: Library toggles the panel, Search opens it and focuses its filter field. */
export type RailView = 'library' | 'search';

export type IconRailHost = {
  /** Home was pressed: it shows Home, as the Home tab did. */
  home: () => void;
  view: (view: RailView) => void;
  /** Add files was pressed; `anchor` is the button, for the menu it opens. */
  add: (anchor: HTMLElement) => void;
  /** Settings was pressed: it opens the Settings sheet. */
  settings: () => void;
  /** A window-state chip (Pinned on top, Size locked) was pressed: it turns that state off. Desktop only; the chips never show without it. */
  toggle?: (which: 'pin' | 'lock') => void;
  /** The rail's context menu asked for the library on its other side. */
  moveSide: () => void;
};

const icon = (paths: string) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
export const railIcons = {
  home: icon('<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9.5h13V10"/><path d="M10 19.5v-5h4v5"/>'),
  library: icon('<path d="M20 10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2.5a1 1 0 0 1-.8-.4l-.9-1.2A1 1 0 0 0 15 3h-2a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z"/><path d="M20 21a1 1 0 0 0 1-1v-3a1 1 0 0 0-1-1h-2.9a1 1 0 0 1-.88-.55l-.42-.85a1 1 0 0 0-.92-.6H13a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z"/><path d="M3 5a2 2 0 0 0 2 2h3"/><path d="M3 3v13a2 2 0 0 0 2 2h3"/>'),
  search: icon('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>'),
  pin: icon('<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>'),
  lock: icon('<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>'),
  add: icon('<path d="M5 12h14"/><path d="M12 5v14"/>'),
  settings: icon('<circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.65-.75 1.65-1.69 0-.44-.18-.84-.44-1.13-.29-.29-.44-.65-.44-1.13a1.64 1.64 0 0 1 1.67-1.67h2c3.05 0 5.55-2.5 5.55-5.55C21.97 6.01 17.46 2 12 2z"/>'),
};

type Entry = { id: string; label: string; shortcut?: string; icon: string; view?: RailView };
const entries: readonly Entry[] = [
  { id: 'home', label: 'Home', icon: railIcons.home },
  { id: 'add', label: 'Add files', icon: railIcons.add },
  { id: 'library', label: 'Library', shortcut: 'Ctrl+B', icon: railIcons.library, view: 'library' },
  { id: 'search', label: 'Search', shortcut: 'Ctrl+Shift+F', icon: railIcons.search, view: 'search' },
];
const settingsEntry: Entry = { id: 'settings', label: 'Settings', icon: railIcons.settings };

export function createIconRail(root: HTMLElement, host: IconRailHost) {
  root.classList.add('icon-rail'); root.setAttribute('aria-label', 'Library rail');
  const button = (entry: { id: string; label: string; shortcut?: string; icon: string }, tip?: string) => {
    const node = document.createElement('button'); node.type = 'button'; node.className = 'icon-rail-button'; node.dataset.rail = entry.id;
    node.innerHTML = entry.icon; node.setAttribute('aria-label', entry.label);
    // The tooltip is drawn by CSS from `data-tip` (beside the rail, on the side the rail is not), only while the panel is closed; the name and shortcut are also exposed to assistive technology.
    node.dataset.tip = tip ?? (entry.shortcut ? `${entry.label}  ${entry.shortcut}` : entry.label);
    if (entry.shortcut) node.setAttribute('aria-keyshortcuts', entry.shortcut.replace('Ctrl', 'Control'));
    return node;
  };
  const buttons = new Map<string, HTMLButtonElement>();
  const group = document.createElement('div'); group.className = 'icon-rail-group';
  for (const entry of entries) {
    const node = button(entry); buttons.set(entry.id, node); group.append(node);
    const view = entry.view;
    if (view) node.setAttribute('aria-controls', 'library-root');
    node.onclick = () => { if (view) host.view(view); else if (entry.id === 'home') host.home(); else host.add(node); };
  }
  // The foot: the window-state chips (hidden until their state is on) above Settings.
  const foot = document.createElement('div'); foot.className = 'icon-rail-foot';
  const chip = (id: 'pin' | 'lock', label: string, shortcut: string, off: string) => {
    const node = button({ id, label, shortcut, icon: railIcons[id] }, `${label} — click to ${off}  ${shortcut}`);
    node.classList.add('icon-rail-status'); node.setAttribute('aria-pressed', 'true'); node.hidden = true;
    node.onclick = () => host.toggle?.(id);
    buttons.set(id, node);
    return node;
  };
  const settings = button(settingsEntry); settings.onclick = () => host.settings(); buttons.set('settings', settings);
  foot.append(chip('pin', 'Pinned on top', 'Ctrl+Shift+T', 'unpin'), chip('lock', 'Size locked', 'Ctrl+Shift+L', 'unlock'), settings);
  // Library says whether the panel is open; Search is an action, not a state. Home carries `aria-current` while Home is showing.
  buttons.get('library')!.setAttribute('aria-pressed', 'false');
  // The rail is one tab stop: arrows (and Home/End) move between its buttons, as a toolbar's do.
  root.addEventListener('keydown', event => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const all = [...root.querySelectorAll<HTMLButtonElement>('.icon-rail-button:not([hidden])')]; const at = all.indexOf(document.activeElement as HTMLButtonElement); if (at < 0) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? all.length - 1 : (at + (event.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length;
    all[next]!.focus();
  });
  // Right-click anywhere on the rail: one item, to move the library (and the rail with it) to the other side.
  let menu: HTMLElement | undefined;
  const closeMenu = (refocus = false) => {
    if (!menu) return;
    menu.remove(); menu = undefined; document.removeEventListener('pointerdown', dismiss, true); window.removeEventListener('blur', away); window.removeEventListener('resize', away);
    if (refocus) root.querySelector<HTMLElement>('.icon-rail-button')?.focus();
  };
  const away = () => closeMenu();
  const dismiss = (event: Event) => { if (!menu?.contains(event.target as Node)) closeMenu(); };
  root.addEventListener('contextmenu', event => {
    event.preventDefault(); closeMenu();
    const item = document.createElement('button'); item.type = 'button'; item.setAttribute('role', 'menuitem');
    item.textContent = root.dataset.librarySide === 'right' ? 'Move to the left side' : 'Move to the right side';
    item.onclick = () => { closeMenu(true); host.moveSide(); };
    menu = document.createElement('div'); menu.className = 'icon-rail-menu'; menu.setAttribute('role', 'menu'); menu.append(item);
    menu.addEventListener('keydown', key => { if (key.key === 'Escape') { key.preventDefault(); key.stopPropagation(); closeMenu(true); } else if (key.key === 'Tab') closeMenu(); });
    document.body.append(menu);
    menu.style.left = `${Math.max(4, Math.min(event.clientX, window.innerWidth - menu.offsetWidth - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(event.clientY, window.innerHeight - menu.offsetHeight - 4))}px`;
    document.addEventListener('pointerdown', dismiss, true); window.addEventListener('blur', away); window.addEventListener('resize', away);
    item.focus();
  });
  root.replaceChildren(group, foot);
  return {
    /** Which side the library is kept on: the tooltips are drawn on the other one. */
    setSide: (side: 'left' | 'right') => { root.dataset.librarySide = side; },
    /** The panel is open or closed. */
    setOpen: (open: boolean) => { buttons.get('library')!.setAttribute('aria-pressed', String(open)); },
    /** Home is showing (or a document is). */
    setHome: (showing: boolean) => { const home = buttons.get('home')!; if (showing) home.setAttribute('aria-current', 'page'); else home.removeAttribute('aria-current'); },
    /** The window's pin and size lock: each chip shows only while its state is on. */
    setWindow: (state: { pinned: boolean; locked: boolean }) => {
      const pin = buttons.get('pin')!, lock = buttons.get('lock')!;
      // A chip that held focus and hides hands it to Settings, so the keyboard does not fall out of the rail.
      const keep = (chip: HTMLButtonElement, on: boolean) => { const had = document.activeElement === chip; chip.hidden = !on; if (had && !on) buttons.get('settings')!.focus(); };
      keep(pin, state.pinned); keep(lock, state.locked);
    },
    button: (id: string) => buttons.get(id)!,
  };
}
