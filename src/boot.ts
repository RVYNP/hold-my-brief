// The reader and the undocked library are the same bundle. Which shell starts depends on the
// window (its label, or `?panel=library` / `#library`), so the import is chosen at runtime: a
// static import would paint both shells in every window.
import { isTauri } from '@tauri-apps/api/core';

const params = new URLSearchParams(location.search);
const marked = params.get('panel') === 'library' || location.hash === '#library';
// The window label is the source of truth on the desktop. The query is the fallback, and the
// only signal in a browser. The window API is desktop-only, so it stays a runtime import.
const libraryWindow = marked || (isTauri() && (await import('@tauri-apps/api/window')).getCurrentWindow().label === 'library');
if (libraryWindow) await import('./library-window');
else await import('./main');
