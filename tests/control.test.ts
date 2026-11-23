import { describe, expect, it, vi } from 'vitest';
import { BRIEF_PREFIX, handleControlRequest, resolveHeadingTarget, type ControlHost, type ControlStatusSnapshot } from '../src/control';

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
});
