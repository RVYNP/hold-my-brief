import type { OutlineItem } from './types';

/**
 * Fills the Contents list: one button per entry, indented by its depth, with its page (when it has one) at the right. The entry the
 * reader is in (`current`, an index, or -1) is marked and returned so the popover can scroll to it and focus it. Up and Down, Home and
 * End move between entries; Enter or a click picks one.
 */
export function fillContents(list: HTMLElement, entries: readonly OutlineItem[], current: number, pick: (entry: OutlineItem) => void): HTMLButtonElement | undefined {
  list.replaceChildren();
  if (!entries.length) { list.textContent = 'No contents outline in this document.'; return undefined; }
  const buttons = entries.map((entry, index) => {
    const button = document.createElement('button'), label = document.createElement('span');
    button.type = 'button'; button.className = 'outline-entry';
    button.style.setProperty('--depth', String(entry.depth ?? 0));
    label.className = 'outline-label'; label.textContent = entry.label;
    button.append(label);
    if (entry.page) button.append(Object.assign(document.createElement('span'), { className: 'outline-page', textContent: entry.page }));
    if (index === current) { button.setAttribute('aria-current', 'location'); button.classList.add('is-current'); }
    button.onclick = () => pick(entry);
    return button;
  });
  list.append(...buttons);
  list.onkeydown = event => {
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const to = event.key === 'ArrowDown' ? at + 1 : event.key === 'ArrowUp' ? at - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : undefined;
    if (to === undefined || event.ctrlKey || event.altKey || event.metaKey) return;
    event.preventDefault();
    buttons[Math.max(0, Math.min(buttons.length - 1, to))].focus();
  };
  return buttons[current];
}
