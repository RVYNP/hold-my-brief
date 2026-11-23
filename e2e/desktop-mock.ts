import type { Page } from '@playwright/test';

declare global {
  interface Window {
    __mockWindow: { width: number; height: number; pinned: boolean; locked: boolean };
    /** Delivers a native event (`control-request`, `file-changed`, …) to the reader's listeners. */
    __mockEmit: (event: string, payload: unknown) => void;
    /** Briefs `read_brief` answers with, by path (`hold-my-brief:brief/<id>`). */
    __mockBriefs: Record<string, { id: string; path: string; title: string; format: string; content: string; updatedAt: number }>;
    /** Library documents by id: `get_library` lists them, `open_library_document` and `read_document_bytes` answer for them. */
    __mockLibrary: Record<string, { name: string; format: string; text: string }>;
    /** Every `control_reply` the reader sent, in order. */
    __mockReplies: { id: string; ok: boolean; result: unknown; error: string | null }[];
    /** Every session `save_tabs` was asked to write, in order. */
    __mockSessions: { tabs: { path: string }[]; active: number | null; layout?: unknown }[];
    /** Every `control_event` (what the user selected, read or sent) the reader recorded, in order. */
    __mockEvents: { type: string; [field: string]: unknown }[];
    /** The `paths` of every `prefetch_documents` call the reader made, in order. */
    __mockPrefetch: string[][];
  }
}

/** A saved session, as `get_state` returns it in `tabs`: the tabs in order, the shown one's index, and the split layout if any. */
export type MockSession = { tabs: { path: string; name: string; format: string }[]; active: number | null; layout?: unknown };

/**
 * Makes the page believe it runs inside the desktop app: `isTauri()` is true and the few native commands the reader calls at startup and for
 * the window (state, pin, lock, presets) answer from a small in-page model, `window.__mockWindow`. `read_brief` answers from
 * `window.__mockBriefs`, the Library from `window.__mockLibrary`, `control_reply` is recorded in `window.__mockReplies`, `control_event` in `window.__mockEvents`, `save_tabs` in
 * `window.__mockSessions`, `prefetch_documents` in `window.__mockPrefetch`, and `window.__mockEmit` delivers a native event. Like the native bridge, which forwards nothing before the reader
 * calls `control_ready`, events emitted earlier wait and are delivered then, so a test may emit right after `page.goto`. `control_status`
 * answers `null` (Agent control not reported) unless `control` says how the switch stands. `get_state` answers `session` as the saved tabs (none by default) and `recents`. Every other command, and every plugin call, answers
 * `null`. Call before `page.goto`.
 */
export async function mockDesktop(page: Page, { control = null, session = null, recents = [] }: { control?: { enabled: boolean; running: boolean } | null; session?: MockSession | null; recents?: { path: string; name: string; format: string; lastOpened: number }[] } = {}) {
  await page.addInitScript(({ control, session, recents }) => {
    const state = { width: 420, height: 620, pinned: false, locked: false };
    let callbackId = 0, ready = false;
    const callbacks = new Map<number, (message: unknown) => void>(), listeners = new Map<string, number[]>();
    const presets: Record<string, [number, number]> = { compact: [420, 620], reading: [760, 900] };
    const held: [string, unknown][] = [];
    const deliver = (event: string, payload: unknown) => { for (const id of listeners.get(event) ?? []) callbacks.get(id)?.({ event, id, payload }); };
    const replies: Window['__mockReplies'] = [], briefs: Window['__mockBriefs'] = {}, sessions: Window['__mockSessions'] = [], events: Window['__mockEvents'] = [];
    const library: Window['__mockLibrary'] = {}, prefetched: Window['__mockPrefetch'] = [];
    Object.assign(window, { isTauri: true, __mockLibrary: library, __mockPrefetch: prefetched, __mockWindow: state, __mockReplies: replies, __mockBriefs: briefs, __mockSessions: sessions, __mockEvents: events });
    Object.assign(window, {
      __mockEmit: (event: string, payload: unknown) => { if (ready) deliver(event, payload); else held.push([event, payload]); },
      __TAURI_INTERNALS__: {
        metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
        transformCallback: (callback?: (message: unknown) => void) => { const id = ++callbackId; if (callback) callbacks.set(id, callback); return id; },
        unregisterCallback: (id: number) => { callbacks.delete(id); },
        convertFileSrc: (path: string) => path,
        invoke: async (command: string, args?: Record<string, unknown>) => {
          if (command === 'get_state') return { recents, window: { ...state }, tabs: session };
          if (command === 'get_library') return { documents: Object.entries(library).map(([path, doc]) => ({ path, name: doc.name, format: doc.format, lastOpened: 0, collectionIds: [], favorite: false, tags: [], notes: '' })), collections: [], roots: [], imports: [] };
          if (command === 'reading_progress') return {};
          if (command === 'open_library_document') { const doc = library[String(args?.path)]; if (!doc) throw new Error('Item is no longer in the library.'); return { id: args?.path, path: args?.path, name: doc.name, format: doc.format }; }
          if (command === 'read_document_bytes') { const doc = library[String(args?.path)]; return doc ? new TextEncoder().encode(doc.text).buffer : null; }
          if (command === 'pending_open') return [];
          if (command === 'set_pin') { state.pinned = Boolean(args?.enabled); return { ...state }; }
          if (command === 'set_lock') { state.locked = Boolean(args?.enabled); return { ...state }; }
          if (command === 'set_preset') { [state.width, state.height] = presets[String(args?.preset ?? 'compact')]!; return { ...state }; }
          if (command === 'plugin:event|listen') { const event = String(args?.event), handler = Number(args?.handler); listeners.set(event, [...(listeners.get(event) ?? []), handler]); return handler; }
          if (command === 'read_brief') { const brief = briefs[String(args?.id)]; if (!brief) throw new Error('No such brief'); return brief; }
          if (command === 'control_reply') { replies.push(args as Window['__mockReplies'][number]); return null; }
          if (command === 'control_ready') { ready = true; for (const [event, payload] of held.splice(0)) deliver(event, payload); return null; }
          if (command === 'control_event') { events.push(args?.event as Window['__mockEvents'][number]); return null; }
          if (command === 'control_status') return control && { ...control, transport: 'unix', discoveryPath: '' };
          if (command === 'prefetch_documents') { prefetched.push(args?.paths as string[]); return null; }
          if (command === 'save_tabs') { sessions.push(args?.session as Window['__mockSessions'][number]); return null; }
          return null;
        },
      },
    });
  }, { control, session, recents });
}
