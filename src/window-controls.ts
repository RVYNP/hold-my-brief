// macOS draws its close, minimize and zoom buttons over the toolbar's left end (titleBarStyle Overlay), loud and
// out of the reader's palette. The native ones are hidden (windows::hide_native_buttons) and these stand in:
// three 12 px circles, one quiet colour at rest, the standard colours and glyphs only while the pointer is over
// the group (style.css, .mac-controls). The markup is in the page on every platform and shown only under
// .mac-titlebar, the way the Windows caption buttons are shown only under .windows-titlebar.

const glyph = (body: string, fill = false) =>
  `<svg width="12" height="12" viewBox="0 0 12 12" ${fill ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"'} aria-hidden="true">${body}</svg>`;

export type WindowActions = {
  close(): Promise<unknown>;
  minimize(): Promise<unknown>;
  isFullscreen(): Promise<boolean>;
  setFullscreen(fullscreen: boolean): Promise<unknown>;
  toggleMaximize(): Promise<unknown>;
};

export function createWindowControls(): HTMLElement {
  const group = document.createElement('div');
  group.className = 'mac-controls';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Window');
  group.innerHTML =
    `<button type="button" id="mac-close" class="mac-control" aria-label="Close" title="Close">${glyph('<path d="M3.5 3.5l5 5m0-5l-5 5"/>')}</button>` +
    `<button type="button" id="mac-minimize" class="mac-control" aria-label="Minimize" title="Minimize">${glyph('<path d="M3 6h6"/>')}</button>` +
    `<button type="button" id="mac-zoom" class="mac-control" aria-label="Enter Full Screen" title="Enter Full Screen">` +
      `<span class="mac-glyph-full">${glyph('<path d="M3 3h4L3 7zM9 9H5l4-4z"/>', true)}</span>` +
      `<span class="mac-glyph-zoom">${glyph('<path d="M6 3v6M3 6h6"/>')}</span></button>`;
  const zoom = group.querySelector<HTMLButtonElement>('#mac-zoom')!;
  // Holding Option turns the green control from full screen into zoom (maximize and restore), as it does on a Mac.
  const option = (held: boolean) => {
    if (group.classList.contains('option') === held) return;
    group.classList.toggle('option', held);
    const label = held ? 'Zoom' : 'Enter Full Screen';
    zoom.setAttribute('aria-label', label);
    zoom.title = label;
  };
  for (const type of ['keydown', 'keyup'] as const) window.addEventListener(type, event => option(event.altKey));
  window.addEventListener('blur', () => option(false));
  group.addEventListener('pointerover', event => option(event.altKey));
  group.addEventListener('pointermove', event => option(event.altKey));
  return group;
}

export function wireWindowControls(group: HTMLElement, win: WindowActions, fail: (error: unknown) => void) {
  // close() raises CloseRequested, so the reading position is flushed exactly as with ⌘W or the menu.
  group.querySelector<HTMLButtonElement>('#mac-close')!.onclick = () => void win.close().catch(fail);
  group.querySelector<HTMLButtonElement>('#mac-minimize')!.onclick = () => void win.minimize().catch(fail);
  group.querySelector<HTMLButtonElement>('#mac-zoom')!.onclick = event => {
    if (event.altKey) return void win.toggleMaximize().catch(fail);
    void win.isFullscreen().then(full => win.setFullscreen(!full)).catch(fail);
  };
}
