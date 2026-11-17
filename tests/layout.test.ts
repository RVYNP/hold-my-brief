import { describe, expect, it } from 'vitest';
import { MAX_PANES, boxes, canSplit, clampRatio, evenRatio, fits, freeId, minSize, neighbour, nudgePercent, panes, percentAt, ratioLimits, readLayout, receiver, removePane, renamePanes, setRatio, shareOf, snapPercent, splitAt, splitPane, type Layout, type Split } from '../src/layout';

const leaf = (pane: string): Layout => ({ pane });
const row = (first: Layout, second: Layout, ratio = 50): Split => ({ axis: 'row', ratio, first, second });
const column = (first: Layout, second: Layout, ratio = 50): Split => ({ axis: 'column', ratio, first, second });
const must = <T>(value: T | undefined): T => { expect(value).toBeDefined(); return value!; };
/** One pane on the left, two stacked on the right. */
const oneB = row(leaf('a'), column(leaf('b'), leaf('c')));
const room = { x: 0, y: 0, width: 1080, height: 640 };

describe('splitting and removing panes', () => {
  it('splits right, then splits the right pane down: three panes in reading order', () => {
    const two = must(splitPane(leaf('a'), 'a', 'row', 'after', 'b'));
    const three = must(splitPane(two, 'b', 'column', 'after', 'c'));
    expect(three).toEqual(oneB);
    expect(panes(three)).toEqual(['a', 'b', 'c']);
  });

  it('puts a pane before the one it splits: left of it, or above it', () => {
    expect(panes(must(splitPane(oneB, 'a', 'row', 'before', 'd')))).toEqual(['d', 'a', 'b', 'c']);
    expect(panes(must(splitPane(oneB, 'b', 'column', 'before', 'd')))).toEqual(['a', 'd', 'b', 'c']);
    expect(splitAt(must(splitPane(leaf('a'), 'a', 'column', 'before', 'b')), [])).toMatchObject({ axis: 'column', ratio: 50, first: { pane: 'b' }, second: { pane: 'a' } });
  });

  it('refuses the fifth pane, a pane that is not there and an id already in use', () => {
    const four = must(splitPane(oneB, 'c', 'row', 'after', 'd'));
    expect(panes(four)).toHaveLength(MAX_PANES);
    expect(splitPane(four, 'a', 'row', 'after', 'e')).toBeUndefined();
    expect(splitPane(oneB, 'zz', 'row', 'after', 'd')).toBeUndefined();
    expect(splitPane(oneB, 'a', 'row', 'after', 'b')).toBeUndefined();
  });

  it('leaves the tree it was given as it was', () => {
    const before = JSON.stringify(oneB);
    splitPane(oneB, 'a', 'column', 'after', 'd'); removePane(oneB, 'b'); setRatio(oneB, [], 10);
    expect(JSON.stringify(oneB)).toBe(before);
  });

  it('gives a removed pane\'s room to its sibling', () => {
    const withoutB = must(removePane(oneB, 'b'));
    expect(withoutB).toEqual(row(leaf('a'), leaf('c')));
    expect(boxes(withoutB, room).panes[1]).toEqual({ pane: 'c', rect: { x: 544, y: 0, width: 536, height: 640 } });
    const withoutA = must(removePane(oneB, 'a'));
    expect(withoutA).toEqual(column(leaf('b'), leaf('c')));
    expect(boxes(withoutA, room).panes.map(entry => entry.rect.width)).toEqual([1080, 1080]);
    expect(removePane(row(leaf('a'), leaf('b')), 'a')).toEqual(leaf('b'));
  });

  it('removes nothing from a lone pane or for a pane that is not there', () => {
    expect(removePane(leaf('a'), 'a')).toBeUndefined();
    expect(removePane(oneB, 'zz')).toBeUndefined();
  });

  it('names the pane that takes a closed pane\'s room: its sibling, or the first pane of the sibling subtree', () => {
    expect(receiver(row(leaf('a'), leaf('b')), 'a')).toBe('b');
    expect(receiver(oneB, 'a')).toBe('b'); // The sibling is the two stacked panes: the one on top.
    expect(receiver(oneB, 'b')).toBe('c');
    expect(receiver(oneB, 'c')).toBe('b');
    const grid = row(column(leaf('a'), leaf('c')), column(leaf('b'), leaf('d')));
    expect(receiver(grid, 'c')).toBe('a');
    expect(receiver(row(leaf('a'), column(leaf('b'), row(leaf('c'), leaf('d')))), 'b')).toBe('c');
    expect(receiver(leaf('a'), 'a')).toBeUndefined();
    expect(receiver(oneB, 'zz')).toBeUndefined();
  });

  it('hands out the first free id, and renames panes', () => {
    expect(freeId(leaf('a'))).toBe('b');
    expect(freeId(row(leaf('b'), leaf('a')))).toBe('c');
    expect(freeId(must(splitPane(oneB, 'c', 'row', 'after', 'd')))).toBeUndefined();
    expect(renamePanes(oneB, id => id.toUpperCase())).toEqual(row(leaf('A'), column(leaf('B'), leaf('C'))));
  });
});

describe('where the panes and dividers are', () => {
  it('places one pane on the left and two stacked on the right in 1080 × 640, with 8 px dividers', () => {
    const placed = boxes(oneB, room);
    expect(placed.panes).toEqual([
      { pane: 'a', rect: { x: 0, y: 0, width: 536, height: 640 } },
      { pane: 'b', rect: { x: 544, y: 0, width: 536, height: 316 } },
      { pane: 'c', rect: { x: 544, y: 324, width: 536, height: 316 } },
    ]);
    expect(placed.dividers).toEqual([
      { path: [], axis: 'row', rect: { x: 536, y: 0, width: 8, height: 640 }, room, percent: 50, limits: { min: 360 / 1072 * 100, max: 100 - 360 / 1072 * 100 } },
      { path: [1], axis: 'column', rect: { x: 544, y: 316, width: 536, height: 8 }, room: { x: 544, y: 0, width: 536, height: 640 }, percent: 50, limits: { min: 240 / 632 * 100, max: 100 - 240 / 632 * 100 } },
    ]);
  });

  it('offsets everything by the room it is given, and fills it to the last pixel', () => {
    const placed = boxes(row(leaf('a'), leaf('b'), 60), { x: 48, y: 41, width: 1392, height: 859 });
    const [a, b] = placed.panes.map(entry => entry.rect), [line] = placed.dividers;
    expect(a.x).toBe(48);
    expect(a.width).toBeCloseTo(1384 * .6, 9);
    expect(line.rect.x).toBe(a.x + a.width);
    expect(b.x).toBe(line.rect.x + 8);
    expect(b.x + b.width).toBeCloseTo(1440, 9);
    expect(a.y).toBe(41); expect(a.height).toBe(859);
  });

  it('keeps both subtrees at their minimum, and at 50 when the room is too small for that', () => {
    const wide = boxes(row(leaf('a'), leaf('b'), 5), room).panes.map(entry => entry.rect.width);
    expect(wide[0]).toBeCloseTo(360, 9); expect(wide[1]).toBeCloseTo(712, 9);
    const high = boxes(column(leaf('a'), leaf('b'), 99), room).panes.map(entry => entry.rect.height);
    expect(high[0]).toBeCloseTo(392, 9); expect(high[1]).toBeCloseTo(240, 9);
    expect(boxes(row(leaf('a'), leaf('b'), 5), { ...room, width: 700 }).panes.map(entry => entry.rect.width)).toEqual([346, 346]);
  });

  it('lists the panes of a deeper tree in reading order, left before right and top before bottom', () => {
    const grid = row(column(leaf('a'), leaf('c')), column(leaf('b'), leaf('d')));
    expect(boxes(grid, { x: 0, y: 0, width: 1440, height: 900 }).panes.map(entry => entry.pane)).toEqual(['a', 'c', 'b', 'd']);
    expect(panes(grid)).toEqual(['a', 'c', 'b', 'd']);
  });
});

describe('room for a layout', () => {
  it('needs 360 × 240 for every pane and 8 px for every divider', () => {
    expect(minSize(leaf('a'))).toEqual({ width: 360, height: 240 });
    expect(minSize(row(leaf('a'), leaf('b')))).toEqual({ width: 728, height: 240 });
    expect(minSize(oneB)).toEqual({ width: 728, height: 488 });
    expect(minSize(row(leaf('a'), row(leaf('b'), leaf('c'))))).toEqual({ width: 1096, height: 240 });
    expect(minSize(column(row(leaf('a'), leaf('b')), row(leaf('c'), leaf('d'))))).toEqual({ width: 728, height: 488 });
  });

  it('does not fit when any pane would be under 360 × 240', () => {
    expect(fits(oneB, room)).toBe(true);
    expect(fits(oneB, { width: 728, height: 488 })).toBe(true);
    expect(fits(oneB, { width: 727, height: 640 })).toBe(false);
    expect(fits(oneB, { width: 1080, height: 487 })).toBe(false);
    expect(fits(leaf('a'), { width: 360, height: 240 })).toBe(true);
    expect(fits(leaf('a'), { width: 359, height: 240 })).toBe(false);
    expect(fits(row(leaf('a'), row(leaf('b'), leaf('c'))), { width: 1095, height: 900 })).toBe(false);
  });

  it('needs, for two panes in a row, 728 px and a window of at least 720 px', () => {
    expect(canSplit(728, 800)).toBe(true);
    expect(canSplit(727, 800)).toBe(false);
    expect(canSplit(1000, 719)).toBe(false);
    expect(canSplit(1392, 1440)).toBe(true);
  });

  it('limits a divider by what the subtrees on either side need along its axis', () => {
    const split = row(leaf('a'), row(leaf('b'), leaf('c'))), size = 1440;
    const { min, max } = ratioLimits(split, size);
    expect(min / 100 * shareOf(size)).toBeCloseTo(360, 9);
    expect(max / 100 * shareOf(size)).toBeCloseTo(shareOf(size) - 728, 9);
    expect(clampRatio(split, size, 5)).toBe(min);
    expect(clampRatio(split, size, 95)).toBe(max);
    expect(clampRatio(split, size)).toBe(max); // Even would leave the two panes on the right under their minimum.
    // Side by side the second subtree needs only 360 across, however it is split down.
    expect(ratioLimits(row(leaf('a'), column(leaf('b'), leaf('c'))), size).max).toBeCloseTo(100 - 360 / shareOf(size) * 100, 9);
    expect(ratioLimits(split, 1000)).toEqual({ min: 50, max: 50 });
  });
});

describe('moving a divider', () => {
  it('sets the ratio of the split at a path, evens it, and clamps what is not a percent', () => {
    expect(splitAt(setRatio(oneB, [1], 70), [1])?.ratio).toBe(70);
    expect(splitAt(setRatio(oneB, [1], 70), [])?.ratio).toBe(50);
    expect(splitAt(evenRatio(setRatio(oneB, [1], 70), [1]), [1])?.ratio).toBe(50);
    expect(splitAt(setRatio(oneB, [], 140), [])?.ratio).toBe(100);
    expect(splitAt(setRatio(oneB, [], Number.NaN), [])?.ratio).toBe(50);
    expect(setRatio(oneB, [0], 10)).toBe(oneB);
    expect(setRatio(oneB, [1, 1, 1], 10)).toBe(oneB);
  });

  describe('along a row', () => {
    const share = shareOf(1392); // 1384 px between the panes
    const limits = ratioLimits(row(leaf('a'), leaf('b')), 1392);

    it('settles on 40, 50 and 60 % within 12 px and nowhere else', () => {
      expect(snapPercent(50.4, share, limits)).toBe(50);
      expect(snapPercent(60 + 11 / share * 100, share, limits)).toBe(60);
      expect(snapPercent(40 - 11 / share * 100, share, limits)).toBe(40);
      const away = 60 + 13 / share * 100;
      expect(snapPercent(away, share, limits)).toBeCloseTo(away, 6);
    });

    it('keeps both panes at least 360 px wide', () => {
      expect(limits.min / 100 * share).toBeCloseTo(360, 6);
      expect(limits.max / 100 * share).toBeCloseTo(share - 360, 6);
      expect(snapPercent(1, share, limits)).toBe(limits.min);
      expect(snapPercent(99, share, limits)).toBe(limits.max);
    });

    it('holds at the middle when the room is too small for two minimum panes', () => {
      const small = ratioLimits(row(leaf('a'), leaf('b')), 708);
      expect(small).toEqual({ min: 50, max: 50 });
      expect(snapPercent(30, shareOf(708), small)).toBe(50);
    });

    it('reads a pointer position as the percent whose divider is centred on it', () => {
      expect(percentAt(48 + 4 + 692, 48, 1440)).toBeCloseTo(50, 6);
      expect(percentAt(48 + 4, 48, 1440)).toBeCloseTo(0, 6);
      expect(percentAt(10, 10, 14)).toBe(50);
    });

    it('moves 2 % with ← and →, to the limits with Home and End, and ignores ↑ and ↓', () => {
      expect(nudgePercent('ArrowRight', 50, limits, 'row')).toBe(52);
      expect(nudgePercent('ArrowLeft', 50, limits, 'row')).toBe(48);
      expect(nudgePercent('Home', 50, limits, 'row')).toBe(limits.min);
      expect(nudgePercent('End', 50, limits, 'row')).toBe(limits.max);
      expect(nudgePercent('ArrowRight', limits.max - 1, limits, 'row')).toBe(limits.max);
      expect(nudgePercent('ArrowDown', 50, limits, 'row')).toBeUndefined();
      expect(nudgePercent('a', 50, limits, 'row')).toBeUndefined();
    });
  });

  describe('along a column', () => {
    const size = 640, share = shareOf(size); // 632 px between the panes
    const limits = ratioLimits(column(leaf('a'), leaf('b')), size);

    it('keeps both panes at least 240 px high and snaps like a row does', () => {
      expect(limits.min / 100 * share).toBeCloseTo(240, 6);
      expect(limits.max / 100 * share).toBeCloseTo(share - 240, 6);
      expect(snapPercent(50 + 10 / share * 100, share, limits)).toBe(50);
      expect(snapPercent(60 - 12 / share * 100, share, limits)).toBe(60);
      expect(snapPercent(99, share, limits)).toBe(limits.max);
      expect(snapPercent(1, share, limits)).toBe(limits.min);
    });

    it('reads the pointer\'s height, and moves 2 % with ↑ and ↓ and not with ← and →', () => {
      expect(percentAt(100 + 4 + share / 2, 100, 100 + size)).toBeCloseTo(50, 6);
      expect(nudgePercent('ArrowDown', 50, limits, 'column')).toBe(52);
      expect(nudgePercent('ArrowUp', 50, limits, 'column')).toBe(48);
      expect(nudgePercent('Home', 50, limits, 'column')).toBe(limits.min);
      expect(nudgePercent('End', 50, limits, 'column')).toBe(limits.max);
      expect(nudgePercent('ArrowLeft', 50, limits, 'column')).toBeUndefined();
      expect(nudgePercent('ArrowRight', 50, limits, 'column')).toBeUndefined();
    });
  });
});

describe('the pane next to a pane', () => {
  it('gives the pane left, right, above or below, by the centres of the boxes', () => {
    expect(neighbour(oneB, 'a', 'right', room)).toBe('b'); // Both on the right overlap equally; the upper one comes first.
    expect(neighbour(oneB, 'b', 'left', room)).toBe('a');
    expect(neighbour(oneB, 'c', 'left', room)).toBe('a');
    expect(neighbour(oneB, 'b', 'down', room)).toBe('c');
    expect(neighbour(oneB, 'c', 'up', room)).toBe('b');
    expect(neighbour(oneB, 'a', 'left', room)).toBeUndefined();
    expect(neighbour(oneB, 'a', 'up', room)).toBeUndefined();
    expect(neighbour(oneB, 'a', 'down', room)).toBeUndefined();
    expect(neighbour(oneB, 'b', 'up', room)).toBeUndefined();
    expect(neighbour(oneB, 'c', 'down', room)).toBeUndefined();
    expect(neighbour(oneB, 'c', 'right', room)).toBeUndefined();
    expect(neighbour(oneB, 'zz', 'left', room)).toBeUndefined();
  });

  it('picks the pane whose box is across from the one it leaves when the others are uneven', () => {
    // a over b on the left (a taller), c on the right; from c going left is the pane whose centre is nearer its own.
    const uneven = row(column(leaf('a'), leaf('b'), 70), leaf('c'));
    expect(neighbour(uneven, 'c', 'left', room)).toBe('a');
    expect(neighbour(uneven, 'a', 'down', room)).toBe('b');
    expect(neighbour(uneven, 'b', 'right', room)).toBe('c');
    expect(neighbour(row(leaf('a'), column(leaf('b'), leaf('c'), 20)), 'a', 'right', room)).toBe('c');
  });

  it('does not take a pane that is only diagonally across', () => {
    const grid = row(column(leaf('a'), leaf('c')), column(leaf('b'), leaf('d')));
    expect(neighbour(grid, 'a', 'right')).toBe('b');
    expect(neighbour(grid, 'a', 'down')).toBe('c');
    expect(neighbour(grid, 'd', 'left')).toBe('c');
    expect(neighbour(grid, 'd', 'up')).toBe('b');
  });
});

describe('reading a saved tree', () => {
  it('keeps a valid tree as it is', () => {
    const four = row(column(leaf('a'), leaf('c'), 30), column(leaf('b'), leaf('d'), 70), 45);
    expect(readLayout(JSON.parse(JSON.stringify(four)))).toEqual(four);
    expect(readLayout(oneB)).toEqual(oneB);
  });

  it('brings a ratio into 0 to 100 and gives a ratio that is no number 50', () => {
    expect(readLayout({ ...row(leaf('a'), leaf('b')), ratio: 400 })).toMatchObject({ ratio: 100 });
    expect(readLayout({ ...row(leaf('a'), leaf('b')), ratio: -3 })).toMatchObject({ ratio: 0 });
    expect(readLayout({ ...row(leaf('a'), leaf('b')), ratio: 'wide' })).toMatchObject({ ratio: 50 });
  });

  it('is no tree unless it holds two to four panes with distinct known ids', () => {
    const five = row(row(leaf('a'), leaf('b')), row(leaf('c'), row(leaf('d'), leaf('e'))));
    for (const garbage of [undefined, null, 3, 'a', [], {}, leaf('a'), { axis: 'row' }, { ...row(leaf('a'), leaf('a')) }, row(leaf('a'), leaf('q')), row(leaf('a'), { pane: 4 } as never), { ...row(leaf('a'), leaf('b')), axis: 'diagonal' }, row(leaf('a'), column(leaf('b'), { axis: 'row' } as never)), five]) {
      expect(readLayout(garbage)).toBeUndefined();
    }
  });
});
