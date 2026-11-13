import { describe, expect, it } from 'vitest';
import { MAX_LIVE_TABS, MAX_TABS, TabList, emptySession, readSession, slotAt } from '../src/tabs';

type Tab = { path: string; name: string };
const tab = (path: string): Tab => ({ path, name: path.toUpperCase() });
const paths = (list: TabList<Tab>) => list.tabs.map(entry => entry.path);
const listOf = (...names: string[]) => { const list = new TabList<Tab>(); for (const name of names) list.open(tab(name)); return list; };

describe('opening', () => {
  it('appends a new tab and shows it', () => {
    const list = listOf('a', 'b');
    expect(paths(list)).toEqual(['a', 'b']);
    expect(list.active?.path).toBe('b');
  });

  it('focuses the tab of a document that is already open instead of adding another', () => {
    const list = listOf('a', 'b', 'c');
    const result = list.open(tab('a'));
    expect(result.created).toBe(false);
    expect(result.tab.path).toBe('a');
    expect(paths(list)).toEqual(['a', 'b', 'c']);
    expect(list.active?.path).toBe('a');
  });

  it('keeps the existing tab object, so its state survives being opened again', () => {
    const list = listOf('a');
    const first = list.find('a');
    expect(list.open({ path: 'a', name: 'other' }).tab).toBe(first);
  });

  it('inserts at an index, clamped to the strip', () => {
    const list = listOf('a', 'b');
    list.open(tab('c'), 1);
    list.open(tab('d'), -5);
    list.open(tab('e'), 99);
    expect(paths(list)).toEqual(['d', 'a', 'c', 'b', 'e']);
  });

  it('shows Home when nothing is open, and selecting nothing shows Home', () => {
    const list = new TabList<Tab>();
    expect(list.active).toBeUndefined();
    list.open(tab('a'));
    list.activate(undefined);
    expect(list.active).toBeUndefined();
    list.activate('missing');
    expect(list.active).toBeUndefined();
  });
});

describe('closing', () => {
  it('shows the right neighbour when the showing tab closes', () => {
    const list = listOf('a', 'b', 'c');
    list.activate('b');
    expect(list.close('b')?.path).toBe('c');
    expect(paths(list)).toEqual(['a', 'c']);
  });

  it('shows the left neighbour when the last tab closes', () => {
    const list = listOf('a', 'b', 'c');
    expect(list.close('c')?.path).toBe('b');
  });

  it('leaves the showing tab alone when another one closes', () => {
    const list = listOf('a', 'b', 'c');
    list.activate('c');
    expect(list.close('a')?.path).toBe('c');
    expect(list.activeIndex).toBe(1);
  });

  it('shows Home when the last tab closes', () => {
    const list = listOf('a');
    expect(list.close('a')).toBeUndefined();
    expect(list.size).toBe(0);
    expect(list.active).toBeUndefined();
  });

  it('forgets a closed tab for the live count and for reopening', () => {
    const list = listOf('a', 'b');
    list.markLive('a'); list.markLive('b');
    list.close('a');
    expect(list.liveCount).toBe(1);
    expect(list.open(tab('a')).created).toBe(true);
    expect(list.isLive('a')).toBe(false);
  });

  it('ignores a tab that is not there', () => {
    const list = listOf('a', 'b');
    expect(list.close('zzz')?.path).toBe('b');
    expect(paths(list)).toEqual(['a', 'b']);
  });
});

describe('reordering', () => {
  it('moves a tab to an index of the resulting list', () => {
    const list = listOf('a', 'b', 'c', 'd');
    list.move('a', 2);
    expect(paths(list)).toEqual(['b', 'c', 'a', 'd']);
    list.move('d', 0);
    expect(paths(list)).toEqual(['d', 'b', 'c', 'a']);
    list.move('c', 99);
    expect(paths(list)).toEqual(['d', 'b', 'a', 'c']);
  });

  it('does not change what is showing', () => {
    const list = listOf('a', 'b', 'c');
    list.activate('b');
    list.move('b', 0);
    expect(list.active?.path).toBe('b');
    expect(list.activeIndex).toBe(0);
  });

  it('puts a dragged tab after every other tab whose centre the pointer has passed', () => {
    const centres = [50, 150, 250];
    expect(slotAt(centres, 10)).toBe(0);
    expect(slotAt(centres, 50)).toBe(0);
    expect(slotAt(centres, 51)).toBe(1);
    expect(slotAt(centres, 200)).toBe(2);
    expect(slotAt(centres, 900)).toBe(3);
    expect(slotAt([], 5)).toBe(0);
  });
});

describe('moving between tabs', () => {
  it('steps and wraps around the strip', () => {
    const list = listOf('a', 'b', 'c');
    expect(list.neighbour(1)?.path).toBe('a');
    list.activate('b');
    expect(list.neighbour(1)?.path).toBe('c');
    expect(list.neighbour(-1)?.path).toBe('a');
    list.activate('a');
    expect(list.neighbour(-1)?.path).toBe('c');
  });

  it('goes from Home to the first tab forward and to the last backward', () => {
    const list = listOf('a', 'b', 'c');
    list.activate(undefined);
    expect(list.neighbour(1)?.path).toBe('a');
    expect(list.neighbour(-1)?.path).toBe('c');
    expect(new TabList<Tab>().neighbour(1)).toBeUndefined();
  });

  it('selects by number like a browser: 1…8 are that tab, 9 is the last, past the end is nothing', () => {
    const list = listOf('a', 'b', 'c');
    expect(list.byNumber(1)?.path).toBe('a');
    expect(list.byNumber(3)?.path).toBe('c');
    expect(list.byNumber(4)).toBeUndefined();
    expect(list.byNumber(9)?.path).toBe('c');
    expect(new TabList<Tab>().byNumber(9)).toBeUndefined();
  });
});

describe('live tabs', () => {
  const live = (list: TabList<Tab>, ...names: string[]) => { for (const name of names) { list.activate(name); list.markLive(name); } };

  it('allows three live tabs', () => {
    expect(MAX_LIVE_TABS).toBe(3);
    const list = listOf('a', 'b', 'c');
    live(list, 'a', 'b', 'c');
    expect(list.hibernation()).toEqual([]);
  });

  it('hibernates the least recently shown tab when a fourth goes live', () => {
    const list = listOf('a', 'b', 'c', 'd');
    live(list, 'a', 'b', 'c', 'd');
    expect(list.hibernation()).toEqual(['a']);
  });

  it('counts showing a tab as using it, so the order follows the user and not the strip', () => {
    const list = listOf('a', 'b', 'c', 'd', 'e');
    live(list, 'a', 'b', 'c');
    list.activate('a'); // a is now the most recent; b is the oldest.
    live(list, 'd');
    expect(list.hibernation()).toEqual(['b']);
    list.markHibernated('b');
    live(list, 'e');
    expect(list.hibernation()).toEqual(['c']);
  });

  it('lists several tabs oldest first when more than one must go', () => {
    const list = listOf('a', 'b', 'c', 'd', 'e');
    live(list, 'a', 'b', 'c', 'd', 'e');
    expect(list.hibernation()).toEqual(['a', 'b']);
  });

  it('never hibernates the showing tab, even when a tab it never opened is more recent', () => {
    const list = listOf('a', 'b');
    live(list, 'a', 'b');
    list.activate(undefined);
    expect(list.hibernation(1)).toEqual(['a']);
    list.activate('a');
    expect(list.hibernation(1)).toEqual(['b']);
    expect(list.hibernation(0)).toEqual(['b']);
  });

  it('marks only tabs that exist', () => {
    const list = listOf('a');
    list.markLive('ghost');
    expect(list.liveCount).toBe(0);
    list.markLive('a'); list.markHibernated('a');
    expect(list.isLive('a')).toBe(false);
  });
});

describe('the saved session', () => {
  const describeTab = (entry: Tab) => ({ path: entry.path, name: entry.name, format: 'pdf' });

  it('records the tabs in order and which one was showing', () => {
    const list = listOf('a', 'b', 'c');
    list.move('c', 0);
    list.activate('b');
    expect(list.session(describeTab)).toEqual({ tabs: [{ path: 'c', name: 'C', format: 'pdf' }, { path: 'a', name: 'A', format: 'pdf' }, { path: 'b', name: 'B', format: 'pdf' }], active: 2 });
  });

  it('records Home as no active tab', () => {
    const list = listOf('a');
    list.activate(undefined);
    expect(list.session(describeTab)).toEqual({ tabs: [{ path: 'a', name: 'A', format: 'pdf' }], active: null });
    expect(new TabList<Tab>().session(describeTab)).toEqual(emptySession());
  });

  it('restores the order and the active tab it saved', () => {
    const saved = { tabs: [{ path: 'c', name: 'C', format: 'pdf' }, { path: 'a', name: 'A', format: 'epub' }], active: 1 };
    expect(readSession(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
  });

  it('treats a missing or malformed session as empty', () => {
    for (const value of [undefined, null, 4, 'x', {}, { tabs: 'nope' }]) expect(readSession(value)).toEqual(emptySession());
  });

  it('drops malformed and duplicate entries and keeps `active` on the same tab', () => {
    const session = readSession({ tabs: [{ path: 'a', name: 'A', format: 'pdf' }, { name: 'no path' }, null, { path: 'a', name: 'again', format: 'pdf' }, { path: 'b', name: 'B', format: 'txt' }], active: 4 });
    expect(session.tabs.map(entry => entry.path)).toEqual(['a', 'b']);
    expect(session.active).toBe(1);
    expect(readSession({ tabs: [{ path: 'a' }, { path: 'b' }], active: 7 }).active).toBeNull();
  });

  it('fills a missing name from the path, so a tab can always be drawn', () => {
    expect(readSession({ tabs: [{ path: '/books/Dune.epub' }], active: 0 }).tabs[0]).toEqual({ path: '/books/Dune.epub', name: 'Dune.epub', format: '' });
  });

  it('caps the number of restored tabs', () => {
    const many = Array.from({ length: MAX_TABS + 10 }, (_, index) => ({ path: `p${index}`, name: `n${index}`, format: 'pdf' }));
    expect(readSession({ tabs: many, active: 0 }).tabs).toHaveLength(MAX_TABS);
  });
});
