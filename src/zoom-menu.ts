import { COMMANDS } from './commands';
import { DEFAULT_LIMITS, parseZoomInput, ZOOM_PRESETS, zoomPercent, type ZoomLimits } from './zoom';

/** What choosing an entry asks for: a command by catalog id, or a true zoom (1 = actual size). */
export type ZoomChoice = { kind: 'command'; id: 'larger' | 'smaller' | 'fit-page' | 'fit-width' | 'actual-size' } | { kind: 'zoom'; zoom: number };
/** `level` is the zoom being drawn, which is the field's value; `fit` is the fit mode in force, if any, and gets the check. */
export type ZoomMenuState = { level: number; fit?: 'page' | 'width'; limits: ZoomLimits; canZoomIn: boolean; canZoomOut: boolean };
export interface ZoomMenu {
  readonly element: HTMLElement;
  isOpen(): boolean;
  close(restoreFocus?: boolean): void;
  /** Syncs the field and the enabled entries with the document's zoom. */
  update(state: ZoomMenuState): void;
}

const shortcutOf = (id: string) => COMMANDS.find(command => command.id === id)?.shortcut;
const COMMAND_ROWS = [
  { id: 'larger', label: 'Zoom in' }, { id: 'smaller', label: 'Zoom out' },
  { id: 'fit-page', label: 'Fit page' }, { id: 'fit-width', label: 'Fit width' }, { id: 'actual-size', label: 'Actual size (100%)' },
] as const;

/**
 * The popover on the zoom level, like the zoom menu of a design tool: a field to type a percentage into, the
 * zoom, fit and actual-size commands with their keys (the fit in force is checked), then a few presets. It is a menu in the keyboard sense: Up/Down/Home/End
 * move between its entries, Escape and Tab close it and return focus to its button, as does a choice.
 * The popover opens above the button (the pill sits at the bottom of the panel) and flips below it without room.
 */
export function createZoomMenu(button: HTMLButtonElement, choose: (choice: ZoomChoice) => void): ZoomMenu {
  const element = document.createElement('div');
  element.id = 'zoom-menu'; element.className = 'zoom-menu'; element.hidden = true;
  const field = document.createElement('input');
  field.id = 'zoom-input'; field.type = 'text'; field.inputMode = 'decimal'; field.autocomplete = 'off'; field.spellcheck = false;
  field.setAttribute('aria-label', 'Zoom percentage');
  const menu = document.createElement('div');
  menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', 'Zoom');
  const separator = () => { const line = document.createElement('div'); line.className = 'zoom-sep'; line.setAttribute('role', 'separator'); return line; };
  const entry = (label: string, choice: ZoomChoice, keys?: string, radio = false) => {
    const item = document.createElement('button');
    item.type = 'button'; item.tabIndex = -1; item.setAttribute('role', radio ? 'menuitemradio' : 'menuitem');
    if (radio) item.setAttribute('aria-checked', 'false');
    // A slot for the check, on every entry so the labels line up.
    const check = document.createElement('span'); check.className = 'zoom-check'; check.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span'); text.className = 'zoom-label'; text.textContent = label; item.append(check, text);
    if (keys) item.append(Object.assign(document.createElement('kbd'), { textContent: keys }));
    item.onclick = () => { close(true); choose(choice); };
    return item;
  };
  const commands = new Map(COMMAND_ROWS.map(row => [row.id, entry(row.label, { kind: 'command', id: row.id }, shortcutOf(row.id), row.id === 'fit-page' || row.id === 'fit-width')]));
  const presets = ZOOM_PRESETS.map(zoom => entry(`${zoomPercent(zoom)}%`, { kind: 'zoom', zoom }));
  menu.append(commands.get('larger')!, commands.get('smaller')!, separator(), commands.get('fit-page')!, commands.get('fit-width')!, commands.get('actual-size')!, separator(), ...presets);
  element.append(field, menu);
  document.body.append(element);

  let shown = '100%', limits = DEFAULT_LIMITS;
  const items = (): HTMLElement[] => [field, ...[...menu.querySelectorAll<HTMLButtonElement>('[role^=menuitem]')].filter(item => !item.disabled)];
  const isOpen = () => !element.hidden;

  function place() {
    const anchor = button.getBoundingClientRect(), width = element.offsetWidth, height = element.offsetHeight;
    const above = anchor.top - height - 6;
    element.style.left = `${Math.round(Math.max(6, Math.min(anchor.left, innerWidth - width - 6)))}px`;
    element.style.top = `${Math.round(above >= 6 ? above : Math.min(anchor.bottom + 6, Math.max(6, innerHeight - height - 6)))}px`;
  }
  /** Where a choice, or a second press of the button, puts focus back: the page when the menu was opened with the pointer (pill presses never take focus from it), the button when opened from the keyboard. */
  let origin: HTMLElement | undefined;
  function open(byPointer: boolean) {
    if (isOpen()) return;
    const was = document.activeElement;
    origin = byPointer && was instanceof HTMLElement && was !== button && was !== document.body && was.isConnected ? was : undefined;
    element.hidden = false; place();
    button.setAttribute('aria-expanded', 'true');
    field.value = shown; field.focus(); field.select();
  }
  /** `restoreFocus` returns focus to where the menu was opened from; `toButton` insists on the button (Escape and Tab). */
  function close(restoreFocus = false, toButton = false) {
    if (!isOpen()) return;
    element.hidden = true; button.setAttribute('aria-expanded', 'false');
    if (restoreFocus) (toButton ? button : origin ?? button).focus();
    origin = undefined;
  }
  /** Moves the focus ring along the entries, wrapping; `to` jumps to the first or last menu item. */
  function move(from: Element | null, delta: 1 | -1 | 'first' | 'last') {
    const all = items(), index = all.indexOf(from as HTMLElement);
    const next = delta === 'first' ? all[1] : delta === 'last' ? all[all.length - 1] : all[(index + delta + all.length) % all.length];
    next?.focus();
  }
  function apply() {
    const zoom = parseZoomInput(field.value, limits);
    if (zoom === undefined) { field.value = shown; field.select(); return; } // Unreadable: back to what is shown.
    close(true); choose({ kind: 'zoom', zoom });
  }

  button.setAttribute('aria-haspopup', 'menu'); button.setAttribute('aria-expanded', 'false'); button.setAttribute('aria-controls', element.id);
  button.addEventListener('click', event => isOpen() ? close(true) : open(event.detail > 0));
  button.addEventListener('keydown', event => {
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !event.ctrlKey && !event.altKey && !event.metaKey) { event.preventDefault(); open(false); }
  });
  element.addEventListener('keydown', event => {
    if (event.ctrlKey || event.altKey || event.metaKey) return; // Reading shortcuts keep working with the menu open.
    const target = event.target as HTMLElement;
    if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); event.stopPropagation(); close(true, true); }
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); move(target, event.key === 'ArrowDown' ? 1 : -1); }
    else if ((event.key === 'Home' || event.key === 'End') && target !== field) { event.preventDefault(); move(target, event.key === 'Home' ? 'first' : 'last'); }
    else if (event.key === 'Enter' && target === field) { event.preventDefault(); apply(); }
  });
  // A press anywhere else closes it. Focus stays wherever the press put it, unless that is nowhere: then it goes to the button.
  document.addEventListener('pointerdown', event => {
    if (!isOpen() || !(event.target instanceof Node) || element.contains(event.target) || button.contains(event.target)) return;
    close();
    setTimeout(() => { if (!document.activeElement || document.activeElement === document.body) button.focus(); });
  }, true);
  // Something else took focus (a dialog, the palette): the menu is not what is being used any more.
  element.addEventListener('focusout', event => {
    const next = event.relatedTarget;
    if (next instanceof Node && !element.contains(next) && next !== button) close();
  });
  addEventListener('resize', () => close());

  return {
    element, isOpen, close,
    update(state) {
      shown = `${zoomPercent(state.level)}%`; limits = state.limits;
      for (const fit of ['page', 'width'] as const) commands.get(`fit-${fit}`)!.setAttribute('aria-checked', String(state.fit === fit));
      if (document.activeElement !== field) field.value = shown;
      (commands.get('larger') as HTMLButtonElement).disabled = !state.canZoomIn;
      (commands.get('smaller') as HTMLButtonElement).disabled = !state.canZoomOut;
    },
  };
}
