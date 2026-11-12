import { describe, expect, it } from 'vitest';
import { centreScroll, itemAt, itemCount, itemIndex, itemLeft, itemPages, itemsAround, itemsInView, itemWidth, maxScroll, spanWidth, stripLabel, type StripLayout } from '../src/page-strip-window';
import { spreadPages } from '../src/spread';

const layout = (count: number, spread = false, cover = true, page = 66, gap = 8): StripLayout => ({ count, spread, cover, page, gap });
const everyItem = (lay: StripLayout) => Array.from({ length: itemCount(lay) }, (_, index) => itemPages(lay, index));

describe('which pages an item stands for', () => {
  it('is one item per page in single-page view', () => {
    expect(everyItem(layout(5))).toEqual([[1], [2], [3], [4], [5]]);
    expect(itemIndex(layout(5), 4)).toBe(3);
  });

  it('pairs spreads the way the reader does, the cover alone', () => {
    // 8 pages with a cover: 1 | 2–3 | 4–5 | 6–7 | 8
    expect(everyItem(layout(8, true, true))).toEqual([[1], [2, 3], [4, 5], [6, 7], [8]]);
    expect(everyItem(layout(9, true, true))).toEqual([[1], [2, 3], [4, 5], [6, 7], [8, 9]]);
  });

  it('pairs from the first page when the cover rule is off', () => {
    // 7 pages without a cover: 1–2 | 3–4 | 5–6 | 7
    expect(everyItem(layout(7, true, false))).toEqual([[1, 2], [3, 4], [5, 6], [7]]);
    expect(everyItem(layout(8, true, false))).toEqual([[1, 2], [3, 4], [5, 6], [7, 8]]);
  });

  it('agrees with spreadPages for every page, and finds each page in its own item', () => {
    for (const count of [1, 2, 3, 4, 7, 8, 12, 13]) for (const cover of [true, false]) for (const spread of [false, true]) {
      const lay = layout(count, spread, cover);
      for (let page = 1; page <= count; page++) {
        const index = itemIndex(lay, page);
        expect(itemPages(lay, index), `page ${page} of ${count}, spread ${spread}, cover ${cover}`).toEqual(spread ? spreadPages(page, count, cover) : [page]);
        expect(itemPages(lay, index)).toContain(page);
      }
      // Items tile the document: every page appears once, in order.
      expect(everyItem(lay).flat()).toEqual(Array.from({ length: count }, (_, i) => i + 1));
    }
  });

  it('has no items for an empty document or an index outside it', () => {
    expect(itemCount(layout(0))).toBe(0);
    expect(itemCount(layout(0, true))).toBe(0);
    expect(itemPages(layout(5), 5)).toEqual([]);
    expect(itemPages(layout(5), -1)).toEqual([]);
    expect(itemIndex(layout(5), 99)).toBe(4);
    expect(itemIndex(layout(5), 0)).toBe(0);
  });
});

describe('labels', () => {
  it('are sequence numbers: "20" for a page, "20–21" for a spread', () => {
    expect(stripLabel([20])).toBe('20');
    expect(stripLabel([20, 21])).toBe('20–21');
    expect(stripLabel([])).toBe('');
  });

  it('come from the pages the item stands for, whatever a PDF prints on them', () => {
    // The labels a document prints (iv, 1, 4–1…) are never an input: an item knows page numbers only.
    const lay = layout(60, true, true);
    expect(stripLabel(itemPages(lay, itemIndex(lay, 20)))).toBe('20–21');
    expect(stripLabel(itemPages(lay, itemIndex(lay, 21)))).toBe('20–21');
    expect(stripLabel(itemPages(lay, 0))).toBe('1');
  });
});

describe('where items sit', () => {
  it('lays single pages out edge to edge with the gap between', () => {
    const lay = layout(10);
    expect([0, 1, 2].map(index => itemLeft(lay, index))).toEqual([0, 74, 148]);
    expect(itemWidth(lay, 3)).toBe(66);
    expect(spanWidth(lay)).toBe(10 * 66 + 9 * 8);
  });

  it('gives a spread two slots, a lone cover one, and starts later spreads after it', () => {
    const lay = layout(8, true, true);
    expect(itemWidth(lay, 0)).toBe(66);
    expect(itemWidth(lay, 1)).toBe(132);
    expect(itemLeft(lay, 1)).toBe(66 + 8);
    expect(itemLeft(lay, 2)).toBe(66 + 8 + 132 + 8);
    expect(itemWidth(lay, 4)).toBe(66); // the lone last page
    expect(spanWidth(lay)).toBe(66 + 3 * (132 + 8) + 8 + 66);
    // Without the cover rule every spread is two slots wide.
    const plain = layout(8, true, false);
    expect(itemLeft(plain, 1)).toBe(132 + 8);
    expect(spanWidth(plain)).toBe(4 * 132 + 3 * 8);
  });

  it('centres an item by scrolling to the middle of its box', () => {
    const lay = layout(10);
    expect(centreScroll(lay, 0)).toBe(33);
    expect(centreScroll(lay, 5)).toBe(Math.round(5 * 74 + 33));
    expect(maxScroll(lay)).toBe(centreScroll(lay, 9));
    expect(maxScroll(layout(0))).toBe(0);
  });

  it('finds the item at a position, clamping at both ends', () => {
    const lay = layout(10);
    expect(itemAt(lay, -50)).toBe(0);
    expect(itemAt(lay, 0)).toBe(0);
    expect(itemAt(lay, 73)).toBe(0); // the gap after item 0
    expect(itemAt(lay, 74)).toBe(1);
    expect(itemAt(lay, 10_000)).toBe(9);
    const spread = layout(8, true, true);
    expect(itemAt(spread, 65)).toBe(0);
    expect(itemAt(spread, 74)).toBe(1);
    expect(itemAt(spread, 74 + 132 + 8)).toBe(2);
  });
});

describe('which items are drawn around the current page at a given width', () => {
  it('has the current page in the middle, earlier pages to its left and later ones to its right', () => {
    const lay = layout(100), window = itemsAround(lay, 49, 1000)!; // page 50
    expect(window.first).toBeLessThan(49);
    expect(window.last).toBeGreaterThan(49);
    // 1000 px shows 500 px each side of the centre of item 49: seven items (74 px each) left and right, plus the one in the middle.
    expect(window.last - 49).toBe(49 - window.first);
    expect(window.last - window.first + 1).toBeGreaterThanOrEqual(13);
    expect(window.last - window.first + 1).toBeLessThanOrEqual(15);
  });

  it('widens with the viewport and narrows with it', () => {
    const lay = layout(100), size = (width: number) => { const w = itemsAround(lay, 49, width)!; return w.last - w.first + 1; };
    expect(size(400)).toBeLessThan(size(1000));
    expect(size(1000)).toBeLessThan(size(1600));
    expect(size(100)).toBeGreaterThanOrEqual(1);
  });

  it('stops at the document: the first page has nothing to its left, the last nothing to its right', () => {
    const lay = layout(100);
    expect(itemsAround(lay, 0, 1000)!.first).toBe(0);
    expect(itemsAround(lay, 99, 1000)!.last).toBe(99);
    expect(itemsAround(lay, 0, 1000)!.last).toBeGreaterThan(5); // but plenty to its right
    expect(itemsAround(lay, 99, 1000)!.first).toBeLessThan(94);
  });

  it('draws a document shorter than the viewport whole', () => {
    expect(itemsAround(layout(5), 2, 1000)).toEqual({ first: 0, last: 4 });
    expect(itemsAround(layout(0), 0, 1000)).toBeUndefined();
  });

  it('adds the overscan on both sides', () => {
    const lay = layout(100), base = itemsAround(lay, 49, 1000)!, wide = itemsAround(lay, 49, 1000, 148)!;
    expect(base.first - wide.first).toBe(2);
    expect(wide.last - base.last).toBe(2);
  });

  it('counts spreads as items, each two slots wide', () => {
    const lay = layout(100, true, true), window = itemsAround(lay, itemIndex(lay, 50), 1000)!;
    const middle = itemIndex(lay, 50);
    expect(window.first).toBeLessThan(middle);
    expect(window.last).toBeGreaterThan(middle);
    expect(window.last - window.first + 1).toBeLessThanOrEqual(9); // 1000 / 140 px, rounded up
    expect(window.last - window.first + 1).toBeGreaterThanOrEqual(7);
  });

  it('follows the scroll offset: scrolling ahead brings later items into view and drops earlier ones', () => {
    const lay = layout(100), here = itemsInView(lay, centreScroll(lay, 20), 1000)!, ahead = itemsInView(lay, centreScroll(lay, 40), 1000)!;
    expect(ahead.first).toBeGreaterThan(here.last);
    expect(ahead.first).toBeLessThanOrEqual(40);
    expect(ahead.last).toBeGreaterThanOrEqual(40);
  });
});
