/**
 * External agent control dispatcher (DOM-free and unit-tested).
 *
 * Receives structured JSON-RPC method calls forwarded from Rust (`control-request`) and executes
 * them against `ControlHost` (implemented in `main.ts`), returning compact, token-efficient JSON.
 */

import type { LibraryDocument } from './catalog-types';
import type { LibraryFilterResult } from './library';
import type { SearchHit, SearchOptions } from './search';
import type { OutlineItem } from './types';

export const BRIEF_PREFIX = 'hold-my-brief:brief/';
export const isBriefPath = (path: string) => path.startsWith(BRIEF_PREFIX);
export const briefIdOf = (path: string) => isBriefPath(path) ? path.slice(BRIEF_PREFIX.length) : undefined;

const MAX_READ_LIMIT = 24_000;
const DEFAULT_READ_LIMIT = 8_000;
const MATCH_LIMIT = 20;
const LIBRARY_LIMIT = 30;

export type ControlTabSummary = {
  path: string;
  title: string;
  format: string;
  brief: boolean;
  active: boolean;
  position?: string;
  progress?: number;
};

export type ControlPaneSummary = {
  id: string;
  active: boolean;
  shown: string | null;
  tabs: ControlTabSummary[];
};

export type ControlStatusSnapshot = {
  window: { width: number; height: number; pinned: boolean; locked: boolean; focused: boolean };
  appearance: string;
  layout: 'single' | 'split';
  libraryOpen: boolean;
  panes: ControlPaneSummary[];
  active: {
    paneId: string;
    path: string;
    title: string;
    format: string;
    brief: boolean;
    position: string;
    progress?: number;
    outlineCount: number;
    selection: string;
  } | null;
};

/** Where a `show` or `brief` request opened. `splitRefused` is why a requested split was not made (the document opened as a tab instead). */
export type ControlOpened = { path: string; title: string; format: string; paneId: string; position: string; splitRefused?: string };

export type ControlHost = {
  status: () => ControlStatusSnapshot;
  openFile: (path: string, options: { ephemeral?: boolean; split?: 'right' | 'down' }) => Promise<ControlOpened>;
  openBrief: (spec: { id: string; path: string; title: string; format: string; split?: 'right' | 'down' }) => Promise<ControlOpened>;
  goTo: (target: string, paneId?: string) => Promise<string>;
  outline: (paneId?: string) => OutlineItem[];
  search: (query: string, options: SearchOptions, paneId?: string) => Promise<{ hits: SearchHit[]; truncated: boolean; unavailable?: string } | undefined>;
  showMatch: (hit: SearchHit, query: string, paneId?: string) => Promise<string>;
  readText: (limit: number, paneId?: string) => Promise<{ label: string; text: string } | undefined>;
  selection: (paneId?: string) => string;
  closeTab: (target: { id?: string; path?: string; allBriefs?: boolean }) => string[];
  setAppearance: (change: { mode?: string; theme?: string; page?: string }) => string;
  runCommand: (id: string) => Promise<string>;
  library: () => Promise<LibraryDocument[]>;
  filterLibrary: (change: { colour?: string | null; query?: string }) => Promise<LibraryFilterResult>;
};

const asObj = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const asStr = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const asSplit = (value: unknown): 'right' | 'down' | undefined =>
  value === 'right' || value === 'down' ? value : undefined;

/** Resolves a human heading title against a document's outline (exact match, then case-insensitive contains). */
export function resolveHeadingTarget(items: readonly OutlineItem[], heading: string): string | undefined {
  const needle = heading.trim().toLocaleLowerCase();
  if (!needle) return undefined;
  const exact = items.find(item => item.label.trim().toLocaleLowerCase() === needle);
  if (exact) return exact.target;
  const starts = items.find(item => item.label.trim().toLocaleLowerCase().startsWith(needle));
  if (starts) return starts.target;
  return items.find(item => item.label.trim().toLocaleLowerCase().includes(needle))?.target;
}

/** The document a pane (default: the focused one) shows. A request that moves within it names it, so the app can say what an agent did. */
function shownIn(host: ControlHost, paneId?: string): { path?: string; title?: string } {
  const panes = host.status().panes;
  const pane = paneId ? panes.find(p => p.id === paneId) : panes.find(p => p.active);
  const tab = pane?.tabs.find(t => t.path === pane.shown);
  return tab ? { path: tab.path, title: tab.title } : {};
}

async function applyJumpAndFind(
  host: ControlHost,
  params: { target?: string; heading?: string; find?: string; matchIndex?: number },
  paneId?: string,
): Promise<{ position?: string; matched?: { total: number; where: string; excerpt: string } }> {
  let position: string | undefined;
  let target = params.target;
  if (!target && params.heading) {
    target = resolveHeadingTarget(host.outline(paneId), params.heading);
    if (!target) throw new Error(`Heading not found: "${params.heading}".`);
  }
  if (target) {
    position = await host.goTo(target, paneId);
  }
  let matched: { total: number; where: string; excerpt: string } | undefined;
  if (params.find) {
    const found = await host.search(params.find, { matchCase: false, wholeWord: false }, paneId);
    if (!found) throw new Error('This document cannot be searched.');
    if (found.unavailable) throw new Error(found.unavailable);
    if (found.hits.length) {
      const idx = Math.max(0, Math.min(found.hits.length - 1, params.matchIndex ?? 0));
      const hit = found.hits[idx];
      position = await host.showMatch(hit, params.find, paneId);
      matched = { total: found.hits.length, where: hit.unitLabel, excerpt: hit.excerpt || hit.text };
    } else {
      matched = { total: 0, where: '', excerpt: '' };
    }
  }
  return { position, matched };
}

/** Dispatches one local control RPC call and returns a JSON-serializable result. */
export async function handleControlRequest(host: ControlHost, method: string, rawParams: unknown): Promise<unknown> {
  const params = asObj(rawParams);

  switch (method) {
    case 'status':
      return host.status();

    case 'show': {
      const path = asStr(params.path);
      if (!path) throw new Error('show requires a file path.');
      const ephemeral = params.ephemeral === true;
      const split = asSplit(params.split);
      const opened = await host.openFile(path, { ephemeral, split });
      const jumped = await applyJumpAndFind(
        host,
        {
          target: asStr(params.target),
          heading: asStr(params.heading),
          find: asStr(params.find),
          matchIndex: typeof params.matchIndex === 'number' ? params.matchIndex : undefined,
        },
        opened.paneId,
      );
      const result: Record<string, unknown> = {
        ...opened,
        position: jumped.position ?? opened.position,
        ...(jumped.matched ? { matched: jumped.matched } : {}),
      };
      const beside = asStr(params.beside);
      if (beside) {
        const secondary = await host.openFile(beside, { ephemeral, split: 'right' });
        const secondJump = await applyJumpAndFind(
          host,
          { target: asStr(params.besideTarget), find: asStr(params.besideFind) },
          secondary.paneId,
        );
        result.beside = {
          ...secondary,
          position: secondJump.position ?? secondary.position,
          ...(secondJump.matched ? { matched: secondJump.matched } : {}),
        };
      }
      return result;
    }

    case 'brief': {
      const id = asStr(params.id) ?? 'default';
      const path = asStr(params.path) ?? `${BRIEF_PREFIX}${id}`;
      const title = asStr(params.title) ?? id;
      const format = asStr(params.format) ?? 'md';
      const updated = params.updated === true;
      const opened = await host.openBrief({ id, path, title, format, split: asSplit(params.split) });
      const jumped = await applyJumpAndFind(
        host,
        { target: asStr(params.target), heading: asStr(params.heading), find: asStr(params.find) },
        opened.paneId,
      );
      return {
        id,
        updated,
        ...opened,
        position: jumped.position ?? opened.position,
        ...(jumped.matched ? { matched: jumped.matched } : {}),
      };
    }

    case 'read': {
      const paneId = asStr(params.paneId);
      const selection = host.selection(paneId);
      const snap = host.status();
      const active = snap.active;
      if (params.selectionOnly === true) {
        return {
          path: active?.path ?? null,
          title: active?.title ?? null,
          selection,
        };
      }
      const rawLimit = typeof params.limit === 'number' && Number.isFinite(params.limit) ? Math.floor(params.limit) : DEFAULT_READ_LIMIT;
      const limit = Math.max(100, Math.min(MAX_READ_LIMIT, rawLimit));
      const read = await host.readText(limit, paneId);
      if (!read) throw new Error('No readable text document is open.');
      return {
        path: active?.path ?? null,
        title: active?.title ?? null,
        format: active?.format ?? null,
        label: read.label,
        text: read.text,
        ...(selection ? { selection } : {}),
      };
    }

    case 'find': {
      const query = asStr(params.query);
      if (!query) throw new Error('find requires a query.');
      const paneId = asStr(params.paneId);
      const found = await host.search(query, { matchCase: params.matchCase === true, wholeWord: params.wholeWord === true }, paneId);
      if (!found) throw new Error('This document cannot be searched.');
      if (found.unavailable) throw new Error(found.unavailable);
      let shown: string | undefined;
      if ((typeof params.show === 'number' || params.show === true) && found.hits.length) {
        const index = typeof params.show === 'number' ? Math.max(0, Math.min(found.hits.length - 1, Math.floor(params.show))) : 0;
        shown = await host.showMatch(found.hits[index], query, paneId);
      }
      return {
        total: found.hits.length,
        more: found.truncated,
        matches: found.hits.slice(0, MATCH_LIMIT).map((hit, index) => ({
          index,
          where: hit.unitLabel,
          excerpt: hit.excerpt || hit.text,
        })),
        ...(shown ? { shown, ...shownIn(host, paneId) } : {}),
      };
    }

    case 'goto': {
      const paneId = asStr(params.paneId);
      const heading = asStr(params.heading);
      const target = asStr(params.target) ?? (heading ? resolveHeadingTarget(host.outline(paneId), heading) : undefined);
      if (!target) throw new Error(heading ? `Heading not found: "${heading}".` : 'goto requires a target.');
      const position = await host.goTo(target, paneId);
      return { position, ...shownIn(host, paneId) };
    }

    case 'outline': {
      const paneId = asStr(params.paneId);
      return { items: host.outline(paneId).slice(0, 300) };
    }

    case 'close': {
      const closed = host.closeTab({
        id: asStr(params.id),
        path: asStr(params.path),
        allBriefs: params.allBriefs === true,
      });
      return { closed };
    }

    case 'cmd': {
      // The window changes (pin, lock, size preset, focus) were applied natively before this call; the reply lists them with the rest.
      const done: string[] = [];
      if (typeof params.pin === 'boolean') done.push(params.pin ? 'Keep on top on' : 'Keep on top off');
      if (typeof params.lock === 'boolean') done.push(params.lock ? 'Size locked' : 'Size unlocked');
      if (params.preset === 'compact' || params.preset === 'reading') done.push(params.preset === 'compact' ? 'Compact size' : 'Reading size');
      if (params.focus === true) done.push('Focused');
      const appearance = asObj(params.appearance);
      if (appearance.mode || appearance.theme || appearance.page) {
        done.push(host.setAppearance({
          mode: asStr(appearance.mode),
          theme: asStr(appearance.theme),
          page: asStr(appearance.page),
        }));
      }
      const commandId = asStr(params.command);
      if (commandId) {
        done.push(await host.runCommand(commandId));
      }
      return { ok: true, done, status: host.status() };
    }

    case 'library': {
      const query = asStr(params.query) ?? '';
      const colour = params.colour === null ? null : asStr(params.colour);
      if (params.filterGui === true) {
        return host.filterLibrary({ colour, query });
      }
      const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
      const folder = (p: string) => p.split(/[\\/]/).slice(-2, -1)[0] ?? '';
      const docs = (await host.library()).filter(doc => {
        const haystack = [doc.name, folder(doc.path), ...doc.tags].join(' ').toLocaleLowerCase();
        return words.every(word => haystack.includes(word));
      }).slice(0, LIBRARY_LIMIT);
      return {
        total: docs.length,
        documents: docs.map(doc => ({
          path: doc.path,
          name: doc.name,
          folder: folder(doc.path),
          format: doc.format,
          favorite: doc.favorite,
          tags: doc.tags,
        })),
      };
    }

    default:
      throw new Error(`Unknown control method: ${method}`);
  }
}

// ---------------------------------------------------------------- agents

/** An agent that talks to the app, as the native registry describes it (`control-agents` carries the whole list, newest request first). */
export type AgentEntry = {
  kind: string;
  name: string;
  pid?: number;
  terminal?: string;
  firstSeen: number;
  lastRequest: number;
  lastAction?: { method: string; title?: string; path?: string; at: number };
  /** An `events` call from it is waiting, or a `--follow` round started within the last 5 s. */
  listening: boolean;
};

/** A request from an agent that changed the screen, delivered right after the reader applied it (`control-agent-action`). */
export type AgentAction = {
  agent: { kind: string; name: string; pid?: number; terminal?: string };
  method: string;
  path?: string;
  target?: string;
};

const asNum = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) ? value : undefined;

function parseAgentRef(value: unknown): AgentAction['agent'] | undefined {
  const raw = asObj(value);
  const kind = asStr(raw.kind), name = asStr(raw.name);
  if (!kind || !name) return undefined;
  return { kind, name, ...(asNum(raw.pid) === undefined ? {} : { pid: asNum(raw.pid) }), ...(asStr(raw.terminal) ? { terminal: asStr(raw.terminal) } : {}) };
}

/** Reads the payload of `control-agents`; entries that are malformed are dropped. */
export function parseAgents(payload: unknown): AgentEntry[] {
  if (!Array.isArray(payload)) return [];
  return payload.flatMap((item): AgentEntry[] => {
    const raw = asObj(item), ref = parseAgentRef(raw), firstSeen = asNum(raw.firstSeen), lastRequest = asNum(raw.lastRequest);
    if (!ref || firstSeen === undefined || lastRequest === undefined) return [];
    const action = asObj(raw.lastAction), method = asStr(action.method), at = asNum(action.at);
    return [{
      ...ref,
      firstSeen,
      lastRequest,
      ...(method && at !== undefined ? { lastAction: { method, at, ...(asStr(action.title) ? { title: asStr(action.title) } : {}), ...(asStr(action.path) ? { path: asStr(action.path) } : {}) } } : {}),
      listening: raw.listening === true,
    }];
  });
}

/** Reads the payload of `control-agent-action`, or `undefined` when it names no agent or method. */
export function parseAgentAction(payload: unknown): AgentAction | undefined {
  const raw = asObj(payload), agent = parseAgentRef(raw.agent), method = asStr(raw.method);
  if (!agent || !method) return undefined;
  return { agent, method, ...(asStr(raw.path) ? { path: asStr(raw.path) } : {}), ...(asStr(raw.target) ? { target: asStr(raw.target) } : {}) };
}

/** What the reader knows of the agents: the registry as of the last `control-agents`, and a hook for each `control-agent-action`. */
export function createAgentFeed() {
  let agents: AgentEntry[] = [];
  const onAgents = new Set<(agents: readonly AgentEntry[]) => void>();
  const onAction = new Set<(action: AgentAction) => void>();
  const subscribe = <T>(set: Set<T>, listener: T) => { set.add(listener); return () => { set.delete(listener); }; };
  return {
    agents: (): readonly AgentEntry[] => agents,
    /** Receives the payload of `control-agents`. */
    setAgents(payload: unknown) { agents = parseAgents(payload); onAgents.forEach(listener => listener(agents)); },
    /** Receives the payload of `control-agent-action`. */
    agentAction(payload: unknown) { const action = parseAgentAction(payload); if (action) onAction.forEach(listener => listener(action)); },
    subscribeAgents: (listener: (agents: readonly AgentEntry[]) => void) => subscribe(onAgents, listener),
    subscribeActions: (listener: (action: AgentAction) => void) => subscribe(onAction, listener),
  };
}
