import type { Page } from '@playwright/test';

declare global {
  interface Window {
    __mockWindow: { width: number; height: number; pinned: boolean; locked: boolean };
    /** Delivers a native event (`control-request`, `file-changed`, …) to the reader's listeners. */
    __mockEmit: (event: string, payload: unknown) => void;
    /** Briefs `read_brief` answers with, by path (`hold-my-brief:brief/<id>`). */
    __mockBriefs: Record<string, { id: string; path: string; title: string; format: string; content: string; updatedAt: number }>;
    /** Every `control_reply` the reader sent, in order. */
    __mockReplies: { id: string; ok: boolean; result: unknown; error: string | null }[];
  }
}

/**
 * Makes the page believe it runs inside the desktop app: `isTauri()` is true and the few native commands the reader calls at startup and for
 * the window (state, pin, lock, presets) answer from a small in-page model, `window.__mockWindow`. `read_brief` answers from
 * `window.__mockBriefs`, `control_reply` is recorded in `window.__mockReplies`, and `window.__mockEmit` delivers a native event. Every other
 * command, and every plugin call, answers `null`. Call before `page.goto`.
 */
export async function mockDesktop(page: Page) {
  await page.addInitScript(() => {
    const state = { width: 420, height: 620, pinned: false, locked: false };
    let callbackId = 0;
    const callbacks = new Map<number, (message: unknown) => void>(), listeners = new Map<string, number[]>();
    const presets: Record<string, [number, number]> = { compact: [420, 620], reading: [760, 900] };
    const replies: Window['__mockReplies'] = [], briefs: Window['__mockBriefs'] = {};
    Object.assign(window, { isTauri: true, __mockWindow: state, __mockReplies: replies, __mockBriefs: briefs });
    Object.assign(window, {
      __mockEmit: (event: string, payload: unknown) => { for (const id of listeners.get(event) ?? []) callbacks.get(id)?.({ event, id, payload }); },
      __TAURI_INTERNALS__: {
        metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
        transformCallback: (callback?: (message: unknown) => void) => { const id = ++callbackId; if (callback) callbacks.set(id, callback); return id; },
        unregisterCallback: (id: number) => { callbacks.delete(id); },
        convertFileSrc: (path: string) => path,
        invoke: async (command: string, args?: Record<string, unknown>) => {
          if (command === 'get_state') return { recents: [], window: { ...state }, tabs: null };
          if (command === 'get_library') return { documents: [], collections: [], roots: [], imports: [] };
          if (command === 'pending_open') return [];
          if (command === 'set_pin') { state.pinned = Boolean(args?.enabled); return { ...state }; }
          if (command === 'set_lock') { state.locked = Boolean(args?.enabled); return { ...state }; }
          if (command === 'set_preset') { [state.width, state.height] = presets[String(args?.preset ?? 'compact')]!; return { ...state }; }
          if (command === 'plugin:event|listen') { const event = String(args?.event), handler = Number(args?.handler); listeners.set(event, [...(listeners.get(event) ?? []), handler]); return handler; }
          if (command === 'read_brief') { const brief = briefs[String(args?.id)]; if (!brief) throw new Error('No such brief'); return brief; }
          if (command === 'control_reply') { replies.push(args as Window['__mockReplies'][number]); return null; }
          return null;
        },
      },
    });
  });
}
