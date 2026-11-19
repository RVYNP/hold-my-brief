import type { Page } from '@playwright/test';

declare global {
  interface Window { __mockWindow: { width: number; height: number; pinned: boolean; locked: boolean } }
}

/**
 * Makes the page believe it runs inside the desktop app: `isTauri()` is true and the few native commands the reader calls at startup and for
 * the window (state, pin, lock, presets) answer from a small in-page model, `window.__mockWindow`. Every other command, and every plugin
 * call, answers `null`. Call before `page.goto`.
 */
export async function mockDesktop(page: Page) {
  await page.addInitScript(() => {
    const state = { width: 420, height: 620, pinned: false, locked: false };
    let callbackId = 0;
    const presets: Record<string, [number, number]> = { compact: [420, 620], reading: [760, 900] };
    Object.assign(window, { isTauri: true, __mockWindow: state });
    Object.assign(window, {
      __TAURI_INTERNALS__: {
        metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
        transformCallback: () => ++callbackId,
        unregisterCallback: () => undefined,
        convertFileSrc: (path: string) => path,
        invoke: async (command: string, args?: { enabled?: boolean; preset?: string }) => {
          if (command === 'get_state') return { recents: [], window: { ...state }, tabs: null };
          if (command === 'get_library') return { documents: [], collections: [], roots: [], imports: [] };
          if (command === 'pending_open') return [];
          if (command === 'set_pin') { state.pinned = Boolean(args?.enabled); return { ...state }; }
          if (command === 'set_lock') { state.locked = Boolean(args?.enabled); return { ...state }; }
          if (command === 'set_preset') { [state.width, state.height] = presets[args?.preset ?? 'compact']!; return { ...state }; }
          if (command === 'plugin:event|listen') return ++callbackId;
          return null;
        },
      },
    });
  });
}
