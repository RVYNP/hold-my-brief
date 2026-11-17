/**
 * The context menu: a short list of commands for one thing (a library row, a tab, a Home card), shown at the pointer or beside the thing it belongs
 * to. One is open at a time. It takes the keys while it is open (arrows, Home, End, Escape, Tab), and Escape returns focus to what asked for it.
 * An entry that cannot run now stays in the list, disabled, with the reason as its tooltip.
 */
import { shortcutFor } from './commands';

/** One command, or (with `submenu`) a list of them that opens beside it. `unavailable` is why it cannot run now; with it the entry is shown disabled. */
export type MenuEntry = { label: string; run?: () => void; unavailable?: string; submenu?: readonly MenuEntry[] };

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
  /** The submenu of the entry that has one: a menu of its own, laid beside that entry inside this one. */
  let sub: HTMLElement | undefined, subOwner: HTMLElement | undefined;
  const items = (scope: ParentNode) => [...scope.querySelectorAll<HTMLElement>(':scope > button:not(:disabled)')];
  function closeSub(refocus = false) {
    if (!sub || sub.hidden) return;
    sub.hidden = true; sub.replaceChildren(); subOwner?.setAttribute('aria-expanded', 'false');
    if (refocus) subOwner?.focus();
    subOwner = undefined;
  }
  function openSub(owner: HTMLElement, entries: readonly MenuEntry[], focus: boolean) {
    if (!sub) return;
    if (subOwner === owner && !sub.hidden) { if (focus) items(sub)[0]?.focus(); return; }
    closeSub();
    for (const entry of entries) {
      const item = document.createElement('button');
      item.type = 'button'; item.textContent = entry.label; item.setAttribute('role', 'menuitem');
      if (entry.unavailable) { item.disabled = true; item.title = entry.unavailable; }
      else item.onclick = () => { close(false); entry.run?.(); };
      sub.append(item);
    }
    subOwner = owner; owner.setAttribute('aria-expanded', 'true');
    sub.hidden = false;
    const box = owner.getBoundingClientRect();
    sub.style.left = `${box.right + 2 + sub.offsetWidth > window.innerWidth - 4 ? Math.max(4, box.left - sub.offsetWidth - 2) : box.right + 2}px`;
    sub.style.top = `${Math.max(4, Math.min(box.top - 5, window.innerHeight - sub.offsetHeight - 4))}px`;
    if (focus) items(sub)[0]?.focus();
  }
  function show(entries: readonly MenuEntry[], from: HTMLElement, at?: { x: number; y: number }) {
    if (options.blocked?.()) return;
    if (!at && !element.hidden && anchor === from) { close(); return; }
    if (open && open !== menu) open.close(false);
    close(false); element.replaceChildren();
    sub = document.createElement('div'); sub.className = 'context-menu context-submenu'; sub.hidden = true; sub.setAttribute('role', 'menu');
    subOwner = undefined;
    for (const entry of entries) {
      const item = document.createElement('button');
      item.type = 'button'; item.textContent = entry.label; item.setAttribute('role', 'menuitem');
      if (entry.unavailable) { item.disabled = true; item.title = entry.unavailable; }
      else if (entry.submenu) {
        const submenu = entry.submenu;
        item.setAttribute('aria-haspopup', 'menu'); item.setAttribute('aria-expanded', 'false');
        const arrow = document.createElement('span'); arrow.className = 'context-menu-arrow'; arrow.textContent = '▸'; arrow.setAttribute('aria-hidden', 'true'); item.append(arrow);
        item.onclick = () => openSub(item, submenu, true);
        item.addEventListener('pointerenter', () => openSub(item, submenu, false));
      } else {
        item.onclick = () => { close(false); entry.run?.(); };
        item.addEventListener('pointerenter', () => closeSub());
      }
      element.append(item);
    }
    element.append(sub);
    anchor = from; open = menu;
    if (from.matches('button')) from.setAttribute('aria-expanded', 'true');
    options.opened?.(from);
    element.hidden = false;
    if (at) placeMenuAt(element, at.x, at.y); else placeMenu(element, from);
    items(element)[0]?.focus();
  }
  element.addEventListener('keydown', event => {
    const inSub = Boolean(sub && !sub.hidden && sub.contains(event.target as Node));
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (inSub) closeSub(true); else close(); return; }
    if (shortcutFor(event) !== 'command-palette') event.stopPropagation();
    const list = items(inSub ? sub! : element), index = list.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); list[(index + (event.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length]?.focus(); }
    else if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); list[event.key === 'Home' ? 0 : list.length - 1]?.focus(); }
    else if (event.key === 'ArrowRight' && !inSub && document.activeElement?.getAttribute('aria-haspopup') === 'menu') { event.preventDefault(); (document.activeElement as HTMLElement).click(); }
    else if (event.key === 'ArrowLeft' && inSub) { event.preventDefault(); closeSub(true); }
    else if (event.key === 'Tab') close(false);
  });
  document.addEventListener('pointerdown', event => { const target = event.target as Node; if (!element.hidden && !element.contains(target) && !anchor?.contains(target)) close(false); });
  window.addEventListener('resize', () => close(false));
  const menu: ContextMenu = { show, close, isOpen: () => !element.hidden, element };
  return menu;
}
