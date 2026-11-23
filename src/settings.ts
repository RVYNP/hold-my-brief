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

export type SettingsTab = 'appearance' | 'window' | 'general';

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
 * The Settings sheet the rail's Settings button and the compact toolbar's open, organized into compact tabs so Appearance
 * stays short enough to preview themes on the live page above: Appearance (theme, accent, background, text), Window
 * (desktop only: pin, size lock, presets) and General (library side and More commands).
 */
export function createSettingsSheet(dialog: HTMLDialogElement, text: TextControls, host: SettingsHost) {
  const tabs: [SettingsTab, string][] = host.desktop
    ? [['appearance', 'Appearance'], ['window', 'Window'], ['general', 'General']]
    : [['appearance', 'Appearance'], ['general', 'General']];
  dialog.setAttribute('aria-labelledby', 'settings-title');
  dialog.innerHTML = `
    <div class="sheet-head">
      <h2 id="settings-title">Settings</h2>
      <div class="settings-tabs" role="tablist" aria-label="Settings sections">${tabs.map(([id, label], index) => `<button type="button" role="tab" id="settings-tab-${id}" aria-controls="settings-panel-${id}" aria-selected="${index === 0}" tabindex="${index === 0 ? 0 : -1}" data-settings-tab="${id}">${label}</button>`).join('')}</div>
      <button class="sheet-close" data-close aria-label="Close settings">${close}</button>
    </div>
    <div class="settings-body">
      <div class="settings-panel" id="settings-panel-appearance" role="tabpanel" aria-labelledby="settings-tab-appearance" data-panel="appearance">
        <section class="settings-section" id="settings-appearance" aria-labelledby="appearance-title"></section>
      </div>
      <div class="settings-panel" id="settings-panel-window" role="tabpanel" aria-labelledby="settings-tab-window" data-panel="window" hidden>
        <section class="settings-section" id="settings-window" aria-labelledby="settings-window-title" ${host.desktop ? '' : 'hidden'}>
          <div class="settings-heading"><h3 id="settings-window-title">Window</h3></div>
          <div class="settings-row"><span class="settings-name">Keep on top</span><kbd>Ctrl+Shift+T</kbd><button type="button" class="settings-switch" role="switch" aria-checked="false" aria-label="Keep on top" data-window="pin"><span aria-hidden="true"></span></button></div>
          <div class="settings-row"><span class="settings-name">Lock size</span><kbd>Ctrl+Shift+L</kbd><button type="button" class="settings-switch" role="switch" aria-checked="false" aria-label="Lock size" data-window="lock"><span aria-hidden="true"></span></button></div>
          <div class="appearance-row"><span class="sheet-label" id="settings-size-label">SIZE</span>
            <div class="choices settings-sizes" role="group" aria-labelledby="settings-size-label">${sizes.map(([id, label, value]) => `<button type="button" data-preset="${id}">${label}<span class="menu-value">${value}</span></button>`).join('')}</div></div>
        </section>
      </div>
      <div class="settings-panel" id="settings-panel-general" role="tabpanel" aria-labelledby="settings-tab-general" data-panel="general" hidden>
        <section class="settings-section" id="settings-library" aria-labelledby="settings-library-title">
          <div class="settings-heading"><h3 id="settings-library-title">Library</h3></div>
          <div class="appearance-row"><span class="sheet-label" id="settings-side-label">SIDE</span>
            <div class="choices" role="radiogroup" aria-labelledby="settings-side-label">${sides.map(([side, label]) => `<button type="button" role="radio" data-side="${side}">${label}</button>`).join('')}</div></div>
        </section>
        <section class="settings-section" id="settings-control" aria-labelledby="settings-control-title" ${host.desktop ? '' : 'hidden'}>
          <div class="settings-heading"><h3 id="settings-control-title">Agent control</h3></div>
          <div class="settings-row"><span class="settings-name">Local CLI &amp; agents</span><kbd>hmb</kbd><button type="button" class="settings-switch" role="switch" aria-checked="true" aria-label="Local CLI and agents" data-control="enabled"><span aria-hidden="true"></span></button></div>
          <p class="settings-note" id="settings-control-note">Allows local tools on this computer to show documents, live briefs and visuals over a private per-user socket.</p>
        </section>
        <section class="settings-section" id="settings-more" aria-labelledby="settings-more-title">
          <div class="settings-heading"><h3 id="settings-more-title">More</h3></div>
          <div class="settings-list">${items.map(([id, label, keys, desktopOnly]) => `<button type="button" data-more="${id}"${desktopOnly && !host.desktop ? ' hidden' : ''}><span>${label}</span>${keys ? `<kbd>${keys}</kbd>` : ''}</button>`).join('')}</div>
        </section>
      </div>
    </div>`;
  const appearance = createAppearanceSection(dialog, dialog.querySelector<HTMLElement>('#settings-appearance')!, text);
  const tabList = dialog.querySelector<HTMLElement>('.settings-tabs')!;
  const tabButtons = Array.from(tabList.querySelectorAll<HTMLButtonElement>('[data-settings-tab]'));
  const panels = Array.from(dialog.querySelectorAll<HTMLElement>('[data-panel]'));
  const body = dialog.querySelector<HTMLElement>('.settings-body')!;
  const switches = Array.from(dialog.querySelectorAll<HTMLButtonElement>('[data-window]'));
  const controlSwitch = dialog.querySelector<HTMLButtonElement>('[data-control="enabled"]');
  const controlNote = dialog.querySelector<HTMLElement>('#settings-control-note');
  const sideGroup = dialog.querySelector<HTMLElement>('[aria-labelledby=settings-side-label]')!;
  radioGroup(sideGroup, true);
  check(sideGroup, item => item.dataset.side === 'left');

  function selectTab(next: SettingsTab, focusButton = false) {
    const resolved: SettingsTab = next === 'window' && !host.desktop ? 'appearance' : next;
    for (const button of tabButtons) {
      const active = button.dataset.settingsTab === resolved;
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
      if (active && focusButton) button.focus();
    }
    for (const panel of panels) panel.hidden = panel.dataset.panel !== resolved;
    body.scrollTop = 0;
  }
  tabList.addEventListener('click', event => {
    const tab = (event.target as Element).closest<HTMLElement>('[data-settings-tab]')?.dataset.settingsTab as SettingsTab | undefined;
    if (tab) selectTab(tab);
  });
  tabList.addEventListener('keydown', event => {
    const at = tabButtons.indexOf(event.target as HTMLButtonElement);
    if (at < 0) return;
    const to = event.key === 'ArrowRight' ? (at + 1) % tabButtons.length : event.key === 'ArrowLeft' ? (at + tabButtons.length - 1) % tabButtons.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabButtons.length - 1 : -1;
    if (to < 0) return;
    event.preventDefault();
    selectTab(tabButtons[to]!.dataset.settingsTab as SettingsTab, true);
  });

  for (const toggle of switches) toggle.onclick = () => host.toggle(toggle.dataset.window as 'pin' | 'lock');
  if (controlSwitch) controlSwitch.onclick = () => host.setControl?.(controlSwitch.getAttribute('aria-checked') !== 'true');
  for (const button of dialog.querySelectorAll<HTMLButtonElement>('[data-preset]')) button.onclick = () => host.preset(button.dataset.preset as 'compact' | 'reading');
  sideGroup.addEventListener('click', event => { const side = (event.target as Element).closest<HTMLElement>('[data-side]')?.dataset.side as Side | undefined; if (side) host.setSide(side); });
  for (const button of dialog.querySelectorAll<HTMLButtonElement>('[data-more]')) button.onclick = () => { dialog.close(); host.more(button.dataset.more as MoreItem); };
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    if (event.clientY < box.top || event.clientX < box.left || event.clientX > box.right) dialog.close();
  });

  return {
    /** Opens the sheet on the requested section: Appearance by default (so theme previews stay visible above it), or Window / General when requested. */
    open(focus: 'top' | 'appearance' | 'size' | 'window' | 'general' = 'top') {
      appearance.refresh();
      const tab: SettingsTab = focus === 'window' && host.desktop ? 'window' : focus === 'general' ? 'general' : 'appearance';
      selectTab(tab);
      dialog.showModal();
      const target = tab === 'window' ? switches[0] : tab === 'general' ? sideGroup.querySelector<HTMLElement>('[aria-checked=true]') : appearance.focusTarget(focus === 'size' ? 'size' : 'mode');
      target?.focus();
    },
    /** The window state the switches show. */
    showWindow(state: { pinned: boolean; locked: boolean }) {
      for (const toggle of switches) toggle.setAttribute('aria-checked', String(toggle.dataset.window === 'pin' ? state.pinned : state.locked));
    },
    /** The side the library is on. */
    showSide(side: Side) { check(sideGroup, item => item.dataset.side === side); },
    /** Whether local CLI / agent control is active. */
    showControl(state: { enabled: boolean; running: boolean; transport?: string }) {
      if (controlSwitch) controlSwitch.setAttribute('aria-checked', String(state.enabled));
      if (controlNote) {
        controlNote.textContent = state.enabled && state.running
          ? 'Ready for local CLI and agents via hmb (private per-user socket, no network access).'
          : state.enabled
            ? 'Enabled, waiting for local socket.'
            : 'Off. Local CLI and agents cannot reach Hold My Brief.';
      }
    },
  };
}
