import { describe, expect, it } from 'vitest';
import { LIBRARY_PATH, MAX_LIVE_TABS, MAX_TABS, TabList, emptySession, mergeLists, moveAcross, readSession, restoreSplit, slotAt, splitOff } from '../src/tabs';

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

describe('adding without showing', () => {
  it('puts a tab at the index without changing what is showing, and does nothing for one that is open', () => {
    const list = listOf('a', 'b');
    list.activate('a');
    expect(list.add(tab('c'), 1)).toBe(true);
    expect(paths(list)).toEqual(['a', 'c', 'b']);
    expect(list.active?.path).toBe('a');
    expect(list.add(tab('b'), 0)).toBe(false);
    expect(paths(list)).toEqual(['a', 'c', 'b']);
    list.add(tab('d'));
    expect(paths(list)).toEqual(['a', 'c', 'b', 'd']);
    expect(list.isLive('c')).toBe(false);
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

  it('keeps the Library tab with its scope, and drops a scope that is not text', () => {
    const read = readSession({ tabs: [{ path: LIBRARY_PATH, name: 'Favorites', format: 'library', scope: 'favorites' }, { path: 'a', name: 'A', format: 'pdf', scope: 7 }], active: 0 });
    expect(read.tabs).toEqual([{ path: LIBRARY_PATH, name: 'Favorites', format: 'library', scope: 'favorites' }, { path: 'a', name: 'A', format: 'pdf' }]);
  });

  it('caps the number of restored tabs', () => {
    const many = Array.from({ length: MAX_TABS + 10 }, (_, index) => ({ path: `p${index}`, name: `n${index}`, format: 'pdf' }));
    expect(readSession({ tabs: many, active: 0 }).tabs).toHaveLength(MAX_TABS);
  });
});

describe('the saved split', () => {
  const docs = ['a', 'b', 'c', 'd'].map(path => ({ path, name: path.toUpperCase(), format: 'pdf' }));
  const split = { left: { tabs: ['a', 'b'], shown: 'b' }, right: { tabs: ['c', 'd'], shown: 'c' }, ratio: 60, active: 'right' };

  it('reads each pane\'s tabs and shown tab, the ratio and the active pane back as they were saved', () => {
    const saved = { tabs: docs, active: 2, split };
    expect(readSession(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
  });

  it('reads a session with no split, or written before there was one, as it always was', () => {
    const old = { tabs: docs, active: 1 };
    expect(readSession(old)).toEqual(old);
    expect(readSession({ ...old, split: null })).toEqual(old);
    expect('split' in readSession(old)).toBe(false);
  });

  it('ignores a split that is not one: no pane, a pane with no open document, wrong types', () => {
    const base = { tabs: docs, active: 0 };
    for (const garbage of [undefined, 3, 'right', [], {}, { left: 1, right: 2 }, { left: { tabs: ['a'] } }, { left: { tabs: ['a'] }, right: { tabs: ['zz'] } }, { left: { tabs: 'a' }, right: { tabs: [4, null] } }]) {
      expect(readSession({ ...base, split: garbage })).toEqual(base);
    }
  });

  it('keeps what is valid inside a split and gives the rest its default', () => {
    const read = readSession({ tabs: docs, active: 0, split: { left: { tabs: ['a', 'a', 'x'], shown: 'zz' }, right: { tabs: ['b', 'c'], shown: 'c' }, ratio: 'wide', active: 'middle' } });
    // `d` is named by no pane, so it joins the left one; a repeated or unknown path is dropped; an unknown shown tab becomes the pane's first.
    expect(read.split).toEqual({ left: { tabs: ['a', 'd'], shown: 'a' }, right: { tabs: ['b', 'c'], shown: 'c' }, ratio: 50, active: 'left' });
  });

  it('keeps a document in one pane only, the right pane\'s claim first, and never lists the Library tab in a pane', () => {
    const read = readSession({ tabs: [{ path: LIBRARY_PATH, name: 'All', format: 'library' }, ...docs], active: 1, split: { left: { tabs: [LIBRARY_PATH, 'a', 'b'], shown: 'a' }, right: { tabs: ['b', 'c', 'd'], shown: 'd' }, ratio: 40, active: 'right' } });
    expect(read.split).toEqual({ left: { tabs: ['a'], shown: 'a' }, right: { tabs: ['b', 'c', 'd'], shown: 'd' }, ratio: 40, active: 'right' });
  });

  it('clamps a ratio outside 0 to 100', () => {
    expect(readSession({ tabs: docs, active: 0, split: { ...split, ratio: 400 } }).split?.ratio).toBe(100);
    expect(readSession({ tabs: docs, active: 0, split: { ...split, ratio: -3 } }).split?.ratio).toBe(0);
    expect(readSession({ tabs: docs, active: 0, split: { ...split, ratio: Number.NaN } }).split?.ratio).toBe(50);
  });

  it('starts a split from a list: the right pane\'s tabs leave in the saved order and each pane shows its saved tab', () => {
    const list = listOf('a', 'b', 'c', 'd');
    const right = restoreSplit(list, { left: { tabs: ['a', 'b'], shown: 'a' }, right: { tabs: ['d', 'c'], shown: 'c' }, ratio: 50, active: 'left' })!;
    expect(paths(list)).toEqual(['a', 'b']);
    expect(list.active?.path).toBe('a');
    expect(paths(right)).toEqual(['d', 'c']);
    expect(right.active?.path).toBe('c');
  });

  it('starts no split, and changes nothing, when a side would be left with no tab', () => {
    const list = listOf('a', 'b');
    expect(restoreSplit(list, { left: { tabs: ['a'], shown: 'a' }, right: { tabs: ['gone'], shown: 'gone' }, ratio: 50, active: 'left' })).toBeUndefined();
    expect(restoreSplit(list, { left: { tabs: [], shown: '' }, right: { tabs: ['a', 'b'], shown: 'a' }, ratio: 50, active: 'left' })).toBeUndefined();
    expect(paths(list)).toEqual(['a', 'b']);
  });

  it('shows the first tab on the left when Home was showing and no tab was ever shown', () => {
    const list = new TabList<Tab>();
    for (const name of ['a', 'b', 'c']) list.add(tab(name));
    const right = splitOff(list, 'c')!;
    expect(right.active?.path).toBe('c');
    expect(list.active?.path).toBe('a');
  });
});

describe('replacing a tab\'s document', () => {
  it('puts the new document in the same slot and keeps showing it when the old one was showing', () => {
    const list = listOf('a', 'b', 'c');
    list.activate('b');
    expect(list.replace('b', tab('x'))).toBe(true);
    expect(paths(list)).toEqual(['a', 'x', 'c']);
    expect(list.active?.path).toBe('x');
    expect(list.find('b')).toBeUndefined();
  });

  it('forgets the old document\'s liveness and keeps the live count honest', () => {
    const list = listOf('a', 'b');
    list.markLive('a'); list.markLive('b');
    list.replace('b', tab('x')); list.markLive('x');
    expect(list.isLive('b')).toBe(false);
    expect(list.liveCount).toBe(2);
  });

  it('leaves what is showing alone when the replaced tab was not showing', () => {
    const list = listOf('a', 'b', 'c');
    list.replace('a', tab('x'));
    expect(paths(list)).toEqual(['x', 'b', 'c']);
    expect(list.active?.path).toBe('c');
  });

  it('refuses a document that is open in another tab, or a tab that is not open', () => {
    const list = listOf('a', 'b');
    expect(list.replace('a', tab('b'))).toBe(false);
    expect(list.replace('zzz', tab('x'))).toBe(false);
    expect(paths(list)).toEqual(['a', 'b']);
  });
});

describe('splitting and merging tab lists', () => {
  it('splits the shown tab off to the right and keeps every other tab on the left, in order', () => {
    const left = listOf('a', 'b', 'c', 'd');
    left.activate('c');
    const right = splitOff(left, 'c')!;
    expect(paths(left)).toEqual(['a', 'b', 'd']);
    expect(paths(right)).toEqual(['c']);
    expect(right.active?.path).toBe('c');
  });

  it('shows the most recently shown of the remaining tabs on the left, not the tab beside the one that left', () => {
    const left = listOf('a', 'b', 'c', 'd');
    left.activate('a'); left.activate('c');
    splitOff(left, 'c');
    expect(left.active?.path).toBe('a');
  });

  it('shows the closing neighbour when none of the rest was ever shown', () => {
    const left = new TabList<Tab>();
    for (const name of ['a', 'b', 'c']) left.add(tab(name));
    left.activate('b');
    splitOff(left, 'b');
    expect(left.active?.path).toBe('c');
  });

  it('splits nothing off a path the list does not hold', () => {
    const left = listOf('a', 'b');
    expect(splitOff(left, 'z')).toBeUndefined();
    expect(paths(left)).toEqual(['a', 'b']);
  });

  it('takes a live reader along when a tab moves, so it is not reopened', () => {
    const left = listOf('a', 'b', 'c');
    left.markLive('b');
    const right = splitOff(left, 'b')!;
    expect(right.isLive('b')).toBe(true);
    expect(left.isLive('b')).toBe(false);
    left.markLive('a');
    expect(moveAcross(left, right, 'a')).toBe(true);
    expect(right.isLive('a')).toBe(true);
  });

  it('moves a tab to the other side at the end, shows it there, and shows what closing it would show on the side it left', () => {
    const left = listOf('a', 'b', 'c');
    const right = splitOff(left, 'c')!;
    left.activate('a');
    expect(moveAcross(left, right, 'a')).toBe(true);
    expect(paths(left)).toEqual(['b']);
    expect(left.active?.path).toBe('b');
    expect(paths(right)).toEqual(['c', 'a']);
    expect(right.active?.path).toBe('a');
  });

  it('does not move a tab to a list that already holds it, or one the source does not hold', () => {
    const left = listOf('a', 'b'), right = listOf('b');
    expect(moveAcross(left, right, 'b')).toBe(false);
    expect(moveAcross(left, right, 'z')).toBe(false);
    expect(paths(left)).toEqual(['a', 'b']);
  });

  it('merges the right tabs after the left ones, in order, and shows the one asked for', () => {
    const left = listOf('a', 'b', 'c');
    const right = splitOff(left, 'c')!;
    right.add(tab('d')); right.add(tab('e'));
    mergeLists(left, right, 'd');
    expect(paths(left)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(left.active?.path).toBe('d');
    expect(right.size).toBe(0);
  });

  it('keeps live readers live through a merge', () => {
    const left = listOf('w'), right = listOf('x', 'y');
    right.markLive('y');
    mergeLists(left, right, 'w');
    expect(left.isLive('y')).toBe(true);
    expect(left.isLive('x')).toBe(false);
  });
});
