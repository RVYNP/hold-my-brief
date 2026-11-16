/**
 * The context menu: a short list of commands for one thing (a library row, a tab, a Home card), shown at the pointer or beside the thing it belongs
 * to. One is open at a time. It takes the keys while it is open (arrows, Home, End, Escape, Tab), and Escape returns focus to what asked for it.
 * An entry that cannot run now stays in the list, disabled, with the reason as its tooltip.
 */
import { shortcutFor } from './commands';

/** One command. `unavailable` is why it cannot run now; with it the entry is shown disabled. */
export type MenuEntry = { label: string; run: () => void; unavailable?: string };

export type ContextMenu = {
  /** Shows `entries` at `at` (a window point), or under `anchor` when there is none; asking again for the same anchor from the keyboard closes it. */
  show: (entries: readonly MenuEntry[], anchor: HTMLElement, at?: { x: number; y: number }) => void;
  close: (refocus?: boolean) => void;
  isOpen: () => boolean;
  element: HTMLElement;
};

/** Puts `menu` (already shown, and fixed to the window) under `anchor`, its right edge (or its left, for `align` left) on the anchor's, or above it when it would run past the window. */
export function placeMenu(menu: HTMLElement, anchor: HTMLElement, align: 'left' | 'right' = 'right') {
  const at = anchor.getBoundingClientRect(), below = at.bottom + 2;
  menu.style.left = `${Math.max(4, Math.min(align === 'right' ? at.right - menu.offsetWidth : at.left, window.innerWidth - menu.offsetWidth - 4))}px`;
  menu.style.top = `${below + menu.offsetHeight > window.innerHeight - 4 ? Math.max(4, at.top - menu.offsetHeight - 2) : below}px`;
}
/** Puts `menu` (already shown) at the window point (x, y), kept inside the window. */
export function placeMenuAt(menu: HTMLElement, x: number, y: number) {
  menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - menu.offsetWidth - 4))}px`;
  menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - menu.offsetHeight - 4))}px`;
}

let open: ContextMenu | undefined;

/**
 * The menu's element is on the page's body (its owner may move it). `className` is added to its own `context-menu`. `opened` and `closed` tell the owner when
 * `anchor` gains and loses a menu, so it can mark it. `blocked` says the menu must not open now (a dialog is up).
 */
export function createContextMenu(options: { className?: string; label?: string; opened?: (anchor: HTMLElement) => void; closed?: (anchor: HTMLElement) => void; blocked?: () => boolean } = {}): ContextMenu {
  const element = document.createElement('div');
  element.className = options.className ? `context-menu ${options.className}` : 'context-menu'; element.hidden = true; element.setAttribute('role', 'menu');
  if (options.label) element.setAttribute('aria-label', options.label);
  document.body.append(element);
  let anchor: HTMLElement | undefined;

  function close(refocus = true) {
    if (element.hidden) return;
    element.hidden = true;
    const was = anchor; anchor = undefined;
    if (open === menu) open = undefined;
    if (!was) return;
    if (was.matches('button')) was.setAttribute('aria-expanded', 'false');
    options.closed?.(was);
    if (refocus && was.isConnected) was.focus();
  }
  function show(entries: readonly MenuEntry[], from: HTMLElement, at?: { x: number; y: number }) {
    if (options.blocked?.()) return;
    if (!at && !element.hidden && anchor === from) { close(); return; }
    if (open && open !== menu) open.close(false);
    close(false); element.replaceChildren();
    for (const entry of entries) {
      const item = document.createElement('button');
      item.type = 'button'; item.textContent = entry.label; item.setAttribute('role', 'menuitem');
      if (entry.unavailable) { item.disabled = true; item.title = entry.unavailable; }
      else item.onclick = () => { close(false); entry.run(); };
      element.append(item);
    }
    anchor = from; open = menu;
    if (from.matches('button')) from.setAttribute('aria-expanded', 'true');
    options.opened?.(from);
    element.hidden = false;
    if (at) placeMenuAt(element, at.x, at.y); else placeMenu(element, from);
    element.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
  }
  element.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (shortcutFor(event) !== 'command-palette') event.stopPropagation();
    const items = [...element.querySelectorAll<HTMLElement>('button:not(:disabled)')], index = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); items[(index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus(); }
    else if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); items[event.key === 'Home' ? 0 : items.length - 1]?.focus(); }
    else if (event.key === 'Tab') close(false);
  });
  document.addEventListener('pointerdown', event => { const target = event.target as Node; if (!element.hidden && !element.contains(target) && !anchor?.contains(target)) close(false); });
  window.addEventListener('resize', () => close(false));
  const menu: ContextMenu = { show, close, isOpen: () => !element.hidden, element };
  return menu;
}
