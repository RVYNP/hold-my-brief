// Shell for the library once it has been torn off the reader. Loaded only for that window
// (see boot.ts); the reader never imports this file.
import './style.css';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { native } from './bridge';
import { createLibrary } from './library';
import { initAppearance } from './theme';

initAppearance();

const platform = navigator.userAgent.includes('Mac') ? 'mac' : navigator.userAgent.includes('Windows') ? 'windows' : undefined;
document.documentElement.classList.add('library-window');
if (platform) document.documentElement.classList.add(`${platform}-titlebar`);
document.title = 'Library — Hold My Brief';

const caption = `<div class="caption" role="group" aria-label="Window"><button id="caption-minimize" aria-label="Minimize" title="Minimize"><svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M0 5.5h10" stroke="currentColor"/></svg></button><button id="caption-maximize" aria-label="Maximize" title="Maximize"><svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" aria-hidden="true"><rect class="caption-max" x=".5" y=".5" width="9" height="9"/><path class="caption-restore" d="M2.5 2.5V.5h7v7h-2M.5 2.5h7v7h-7z"/></svg></button><button id="caption-close" aria-label="Close" title="Close"><svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" aria-hidden="true"><path d="M.5.5l9 9m0-9l-9 9"/></svg></button></div>`;

document.querySelector('#app')!.innerHTML = `
  <header class="toolbar library-window-toolbar" data-tauri-drag-region><strong>Library</strong><span id="library-window-status" role="status"></span>${caption}</header>
  <div id="reader-layout" class="library-window-layout"><div id="library-root"></div></div>`;

const status = document.getElementById('library-window-status')!;
const savedWidth = Number(localStorage.getItem('hold-my-brief:library-width'));
const drawerWidth = Number.isFinite(savedWidth) && savedWidth > 0 ? savedWidth : 270;
const savedSide = localStorage.getItem('hold-my-brief:library-side') === 'right' ? 'right' : 'left';

function fail(error: unknown) { status.textContent = error instanceof Error ? error.message : String(error); }

const library = createLibrary(document.getElementById('library-root')!, {
  detached: true,
  open: async path => {
    // The reader window owns the document. This command tells it, and brings it forward.
    await native('open_from_library', { path });
    return true;
  },
  dock: () => { void native('set_library_window', { undocked: false, restore: true, width: drawerWidth, side: savedSide }).catch(fail); },
  place: next => { void native('set_library_window', { undocked: true, restore: false, width: drawerWidth, side: next }).catch(fail); },
  error: fail,
});

void library.refresh().catch(fail);

if (platform === 'windows') {
  // Same caption the reader draws: Windows has no native title bar on this window either.
  const appWindow = getCurrentWindow();
  const maximize = document.getElementById('caption-maximize')!;
  const syncMaximized = async () => {
    const maximized = await appWindow.isMaximized();
    document.documentElement.classList.toggle('window-maximized', maximized);
    maximize.setAttribute('aria-label', maximized ? 'Restore' : 'Maximize');
    maximize.title = maximized ? 'Restore down' : 'Maximize';
  };
  document.getElementById('caption-minimize')!.onclick = () => void appWindow.minimize().catch(fail);
  maximize.onclick = () => void appWindow.toggleMaximize().catch(fail);
  document.getElementById('caption-close')!.onclick = () => void appWindow.close().catch(fail);
  void appWindow.onResized(() => void syncMaximized());
  void syncMaximized();
}
