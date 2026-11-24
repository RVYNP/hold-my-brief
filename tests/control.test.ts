import { describe, expect, it, vi } from 'vitest';
import { BRIEF_PREFIX, createAgentFeed, handleControlRequest, resolveHeadingTarget, type ControlHost, type ControlStatusSnapshot } from '../src/control';

function makeHost(): { host: ControlHost; calls: string[] } {
  const calls: string[] = [];
  const snap: ControlStatusSnapshot = {
    window: { width: 760, height: 900, pinned: true, locked: false, focused: false },
    appearance: 'Brief (dark)',
    layout: 'single',
    libraryOpen: false,
    panes: [{ id: 'a', active: true, shown: '/tmp/spec.pdf', tabs: [{ path: '/tmp/spec.pdf', title: 'spec.pdf', format: 'pdf', brief: false, active: true, position: 'Page 14 of 40' }] }],
    active: { paneId: 'a', path: '/tmp/spec.pdf', title: 'spec.pdf', format: 'pdf', brief: false, position: 'Page 14 of 40', progress: 0.35, outlineCount: 2, selection: 'token refresh' },
  };
  const host: ControlHost = {
    status: () => snap,
    openFile: vi.fn(async (path, opts) => {
      calls.push(`openFile:${path}:${opts.split ?? 'same'}`);
      return { path, title: path.split('/').pop()!, format: path.endsWith('.md') ? 'md' : 'pdf', paneId: opts.split ? 'b' : 'a', position: 'Page 1 of 40' };
    }),
    openBrief: vi.fn(async spec => {
      calls.push(`openBrief:${spec.id}:${spec.split ?? 'same'}`);
      return { path: spec.path, title: spec.title, format: spec.format, paneId: spec.split ? 'b' : 'a', position: 'Line 1 of 10' };
    }),
    goTo: vi.fn(async (target, paneId) => {
      calls.push(`goTo:${target}:${paneId ?? ''}`);
      return `Target ${target}`;
    }),
    outline: () => [{ label: 'Introduction', target: 'heading:intro' }, { label: 'Auth Refresh Flow', target: 'heading:auth-refresh-flow' }],
    search: vi.fn(async query => ({
      hits: [{ text: query, unitLabel: 'Page 14', excerpt: `...${query}...`, locator: { kind: 'pdf' } } as never],
      truncated: false,
    })),
    showMatch: vi.fn(async (_hit, query) => {
      calls.push(`showMatch:${query}`);
      return 'Page 14 of 40';
    }),
    readText: vi.fn(async () => ({ label: 'Page 14 of 40', text: 'Refresh tokens rotate on use.' })),
    selection: () => 'token refresh',
    closeTab: vi.fn(target => [target.path ?? `${BRIEF_PREFIX}${target.id ?? 'default'}`]),
    setAppearance: vi.fn(() => 'Graphite (dark)'),
    runCommand: vi.fn(async id => `Ran ${id}`),
    library: vi.fn(async () => []),
    filterLibrary: vi.fn(async () => ({ colour: null, query: '', matches: 0, pending: 0, names: [] })),
  };
  return { host, calls };
}

describe('control dispatcher', () => {
  it('resolves headings by exact, prefix, or substring match', () => {
    const items = [{ label: 'Overview', target: 'heading:overview' }, { label: 'Auth Refresh Flow', target: 'heading:auth' }];
    expect(resolveHeadingTarget(items, 'overview')).toBe('heading:overview');
    expect(resolveHeadingTarget(items, 'auth')).toBe('heading:auth');
    expect(resolveHeadingTarget(items, 'refresh')).toBe('heading:auth');
    expect(resolveHeadingTarget(items, 'missing')).toBeUndefined();
  });

  it('executes compound show with jump, find, and beside split in one call', async () => {
    const { host, calls } = makeHost();
    const res = await handleControlRequest(host, 'show', {
      path: '/tmp/spec.pdf',
      target: '14',
      find: 'refresh',
      beside: '/tmp/notes.md',
      besideTarget: '42',
    }) as Record<string, unknown>;
    expect(calls).toEqual([
      'openFile:/tmp/spec.pdf:same',
      'goTo:14:a',
      'showMatch:refresh',
      'openFile:/tmp/notes.md:right',
      'goTo:42:b',
    ]);
    expect(res.position).toBe('Page 14 of 40');
    expect((res.beside as Record<string, unknown>).position).toBe('Target 42');
  });

  it('opens and updates briefs and supports heading jumps', async () => {
    const { host, calls } = makeHost();
    const res = await handleControlRequest(host, 'brief', {
      id: 'plan',
      title: 'Migration Plan',
      format: 'md',
      updated: true,
      split: 'right',
      heading: 'refresh',
    }) as Record<string, unknown>;
    expect(calls).toEqual(['openBrief:plan:right', 'goTo:heading:auth-refresh-flow:b']);
    expect(res.updated).toBe(true);
    expect(res.path).toBe(`${BRIEF_PREFIX}plan`);
  });

  it('returns selection-only or bounded page text on read', async () => {
    const { host } = makeHost();
    const sel = await handleControlRequest(host, 'read', { selectionOnly: true }) as Record<string, unknown>;
    expect(sel.selection).toBe('token refresh');
    expect(sel.text).toBeUndefined();

    const full = await handleControlRequest(host, 'read', { limit: 500 }) as Record<string, unknown>;
    expect(full.text).toBe('Refresh tokens rotate on use.');
    expect(full.selection).toBe('token refresh');
  });

  it('lists window changes in a cmd reply alongside the theme and the command', async () => {
    const { host } = makeHost();
    const reply = await handleControlRequest(host, 'cmd', { pin: true, lock: false, preset: 'reading', appearance: { theme: 'graphite' }, command: 'split-down' }) as { done: string[] };
    expect(reply.done).toEqual(['Keep on top on', 'Size unlocked', 'Reading size', 'Graphite (dark)', 'Ran split-down']);
  });
});

describe('what a request says about the document it moved in', () => {
  it('names the pane the goto or the shown match landed in', async () => {
    const { host } = makeHost();
    expect(await handleControlRequest(host, 'goto', { target: '5' })).toEqual({ position: 'Target 5', path: '/tmp/spec.pdf', title: 'spec.pdf' });
    expect(await handleControlRequest(host, 'goto', { target: '5', paneId: 'zz' })).toEqual({ position: 'Target 5' });
    const found = await handleControlRequest(host, 'find', { query: 'refresh', show: true }) as Record<string, unknown>;
    expect([found.shown, found.path, found.title]).toEqual(['Page 14 of 40', '/tmp/spec.pdf', 'spec.pdf']);
    const listed = await handleControlRequest(host, 'find', { query: 'refresh' }) as Record<string, unknown>;
    expect(listed.shown).toBeUndefined();
    expect(listed.path).toBeUndefined();
  });
});

describe('the agent feed', () => {
  const omp = { kind: 'omp', name: 'omp', pid: 7, terminal: 'Ghostty', firstSeen: 10, lastRequest: 40, lastAction: { method: 'show', title: 'Plan', path: '/p.md', at: 40 }, listening: true };

  it('keeps the whole list each time and drops entries it cannot read', () => {
    const feed = createAgentFeed();
    const seen: number[] = [];
    feed.subscribeAgents(agents => seen.push(agents.length));
    feed.setAgents([omp, { kind: 'unknown', name: 'unknown', firstSeen: 1, lastRequest: 2, listening: false }, { name: 'no kind' }, 'junk']);
    expect(feed.agents()).toEqual([omp, { kind: 'unknown', name: 'unknown', firstSeen: 1, lastRequest: 2, listening: false }]);
    feed.setAgents([]);
    feed.setAgents('not a list');
    expect(feed.agents()).toEqual([]);
    expect(seen).toEqual([2, 0, 0]);
  });

  it('hands each agent action to its subscribers once it names an agent and a method', () => {
    const feed = createAgentFeed();
    const actions: unknown[] = [];
    const stop = feed.subscribeActions(action => actions.push(action));
    feed.agentAction({ agent: { kind: 'claude', name: 'Claude Code', pid: 3 }, method: 'goto', path: '/a.pdf', target: '12' });
    feed.agentAction({ agent: { kind: 'claude' }, method: 'goto' });
    feed.agentAction({ agent: { kind: 'claude', name: 'Claude Code' } });
    stop();
    feed.agentAction({ agent: { kind: 'omp', name: 'omp' }, method: 'show' });
    expect(actions).toEqual([{ agent: { kind: 'claude', name: 'Claude Code', pid: 3 }, method: 'goto', path: '/a.pdf', target: '12' }]);
  });
});
