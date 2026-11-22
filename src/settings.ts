import { check, createAppearanceSection, radioGroup, type TextControls } from './appearance';

/** The items of the More section: each runs the command of that name (the palette is the one that is not a command). */
export type MoreItem = 'palette' | 'assistant' | 'shortcuts' | 'clear-recents' | 'clear-data';
/** Supplied by the reader: what the sheet asks of the window, the library and the commands. */
export type SettingsHost = {
  /** The Window section is the desktop app's: the browser build hides it. */
  desktop: boolean;
  /** Flips the pin or the size lock (the reader's one toggle, so the shortcut and the palette do exactly what the switch does). */
  toggle: (which: 'pin' | 'lock') => void;
  preset: (preset: 'compact' | 'reading') => void;
  setSide: (side: 'left' | 'right') => void;
  /** Turns the local per-user CLI / agent control socket on or off (desktop only). */
  setControl?: (enabled: boolean) => void;
  /** Runs a More item. The sheet has closed before this is called. */
  more: (item: MoreItem) => void;
};
export type Side = 'left' | 'right';

const close = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
const sides: [Side, string][] = [['left', 'Left'], ['right', 'Right']];
const sizes: [('compact' | 'reading'), string, string][] = [['compact', 'Compact', '420 × 620'], ['reading', 'Reading', '760 × 900']];
const items: [MoreItem, string, string?, boolean?][] = [
  ['palette', 'All commands…', 'Ctrl K'],
  ['assistant', 'AI assistant…', undefined, true],
  ['shortcuts', 'Keyboard shortcuts'],
  ['clear-recents', 'Clear recent files'],
  ['clear-data', 'Delete saved reading data…'],
];

/**
 * The Settings sheet the rail's Settings button and the compact toolbar's open: Window and Agent control (desktop only), Appearance, Library and
 * More, in one column that scrolls inside the sheet. Window holds the pin and size lock switches and the two window sizes; Agent control turns the
 * local `hmb` socket on or off; Appearance is appearance.ts; Library is the side the library docks on; More is what the ⋯ menu listed besides the
 * document's own actions.
 */
export function createSettingsSheet(dialog: HTMLDialogElement, text: TextControls, host: SettingsHost) {
  dialog.setAttribute('aria-labelledby', 'settings-title');
  dialog.innerHTML = `
    <div class="sheet-head"><h2 id="settings-title">Settings</h2><button class="sheet-close" data-close aria-label="Close settings">${close}</button></div>
    <div class="settings-body">
      <section class="settings-section" id="settings-window" aria-labelledby="settings-window-title" ${host.desktop ? '' : 'hidden'}>
        <div class="settings-heading"><h3 id="settings-window-title">Window</h3></div>
        <div class="settings-row"><span class="settings-name">Keep on top</span><kbd>Ctrl+Shift+T</kbd><button type="button" class="settings-switch" role="switch" aria-checked="false" aria-label="Keep on top" data-window="pin"><span aria-hidden="true"></span></button></div>
        <div class="settings-row"><span class="settings-name">Lock size</span><kbd>Ctrl+Shift+L</kbd><button type="button" class="settings-switch" role="switch" aria-checked="false" aria-label="Lock size" data-window="lock"><span aria-hidden="true"></span></button></div>
        <div class="appearance-row"><span class="sheet-label" id="settings-size-label">SIZE</span>
          <div class="choices settings-sizes" role="group" aria-labelledby="settings-size-label">${sizes.map(([id, label, value]) => `<button type="button" data-preset="${id}">${label}<span class="menu-value">${value}</span></button>`).join('')}</div></div>
      </section>
      <section class="settings-section" id="settings-control" aria-labelledby="settings-control-title" ${host.desktop ? '' : 'hidden'}>
        <div class="settings-heading"><h3 id="settings-control-title">Agent control</h3></div>
        <div class="settings-row"><span class="settings-name">Local CLI &amp; agents</span><kbd>hmb</kbd><button type="button" class="settings-switch" role="switch" aria-checked="true" aria-label="Local CLI and agents" data-control="enabled"><span aria-hidden="true"></span></button></div>
        <p class="settings-note" id="settings-control-note">Allows local tools on this computer to show documents, live briefs and visuals over a private per-user socket.</p>
      </section>
      <section class="settings-section" id="settings-appearance" aria-labelledby="appearance-title"></section>
      <section class="settings-section" id="settings-library" aria-labelledby="settings-library-title">
        <div class="settings-heading"><h3 id="settings-library-title">Library</h3></div>
        <div class="appearance-row"><span class="sheet-label" id="settings-side-label">SIDE</span>
          <div class="choices" role="radiogroup" aria-labelledby="settings-side-label">${sides.map(([side, label]) => `<button type="button" role="radio" data-side="${side}">${label}</button>`).join('')}</div></div>
      </section>
      <section class="settings-section" id="settings-more" aria-labelledby="settings-more-title">
        <div class="settings-heading"><h3 id="settings-more-title">More</h3></div>
        <div class="settings-list">${items.map(([id, label, keys, desktopOnly]) => `<button type="button" data-more="${id}"${desktopOnly && !host.desktop ? ' hidden' : ''}><span>${label}</span>${keys ? `<kbd>${keys}</kbd>` : ''}</button>`).join('')}</div>
      </section>
    </div>`;
  const appearance = createAppearanceSection(dialog, dialog.querySelector<HTMLElement>('#settings-appearance')!, text);
  const switches = Array.from(dialog.querySelectorAll<HTMLButtonElement>('[data-window]'));
  const sideGroup = dialog.querySelector<HTMLElement>('[aria-labelledby=settings-side-label]')!;
  radioGroup(sideGroup, true);
  check(sideGroup, item => item.dataset.side === 'left');
  const controlSwitch = dialog.querySelector<HTMLButtonElement>('[data-control="enabled"]')!;
  const controlNote = dialog.querySelector<HTMLElement>('#settings-control-note')!;

  for (const toggle of switches) toggle.onclick = () => host.toggle(toggle.dataset.window as 'pin' | 'lock');
  controlSwitch.onclick = () => host.setControl?.(controlSwitch.getAttribute('aria-checked') !== 'true');
  for (const button of dialog.querySelectorAll<HTMLButtonElement>('[data-preset]')) button.onclick = () => host.preset(button.dataset.preset as 'compact' | 'reading');
  sideGroup.addEventListener('click', event => { const side = (event.target as Element).closest<HTMLElement>('[data-side]')?.dataset.side as Side | undefined; if (side) host.setSide(side); });
  for (const button of dialog.querySelectorAll<HTMLButtonElement>('[data-more]')) button.onclick = () => { dialog.close(); host.more(button.dataset.more as MoreItem); };
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    if (event.clientY < box.top || event.clientX < box.left || event.clientX > box.right) dialog.close();
  });

  return {
    /** Opens the sheet. `appearance` and `size` (the palette's "Text size & spacing", when the open document has one) go to the Appearance section; otherwise focus starts at the top. */
    open(focus: 'top' | 'appearance' | 'size' = 'top') {
      appearance.refresh(); dialog.showModal();
      const target = focus === 'top' && host.desktop ? switches[0] : appearance.focusTarget(focus === 'size' ? 'size' : 'mode');
      target?.focus();
    },
    /** The window state the switches show. */
    showWindow(state: { pinned: boolean; locked: boolean }) {
      for (const toggle of switches) toggle.setAttribute('aria-checked', String(toggle.dataset.window === 'pin' ? state.pinned : state.locked));
    },
    /** The side the library is on. */
    showSide(side: Side) { check(sideGroup, item => item.dataset.side === side); },
    /** Whether local CLI / agent control is on, and whether its socket is listening. */
    showControl(state: { enabled: boolean; running: boolean }) {
      controlSwitch.setAttribute('aria-checked', String(state.enabled));
      controlNote.textContent = state.enabled && state.running
        ? 'Ready for local CLI and agents via hmb (private per-user socket, no network access).'
        : state.enabled ? 'On, but the control socket could not start. Restart Hold My Brief to try again.'
        : 'Off. Local CLI and agents cannot reach Hold My Brief.';
    },
  };
}
