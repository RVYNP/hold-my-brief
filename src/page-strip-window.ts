/**
 * The page strip's arithmetic: which pages an item stands for, where it sits along the track, which items are
 * near enough to the viewport to be drawn, and what it is called. Nothing here touches the DOM or a PDF.
 *
 * Items are single pages, or whole spreads in two-page view, paired exactly as `spreadPages` pairs them (so the
 * cover rule holds). The track has half a viewport of room at both ends, so that the first and the last item can
 * be centred too: an item's centre, in track coordinates, is then the scroll offset that centres it.
 */
import { spreadPages } from './spread';

export type StripLayout = {
  /** Pages in the document. */
  count: number;
  /** Items are spreads (two-page view) rather than single pages. */
  spread: boolean;
  /** Whether page 1 stands alone in a spread. */
  cover: boolean;
  /** Width of one page's slot, CSS px. */
  page: number;
  /** Space between items, CSS px. */
  gap: number;
};

const total = (layout: StripLayout) => Math.max(0, Math.trunc(layout.count) || 0);
/** A cover shown alone takes the first item to itself, so every later spread starts on an even page. */
const coverAlone = (layout: StripLayout) => layout.spread && layout.cover && total(layout) > 0;

/** How many items the document makes. */
export function itemCount(layout: StripLayout): number {
  const count = total(layout);
  if (!layout.spread || !count) return count;
  return layout.cover ? Math.ceil((count + 1) / 2) : Math.ceil(count / 2);
}

/** The pages of item `index`, empty when there is no such item. */
export function itemPages(layout: StripLayout, index: number): number[] {
  const count = total(layout);
  if (!Number.isInteger(index) || index < 0 || index >= itemCount(layout)) return [];
  if (!layout.spread) return [index + 1];
  return spreadPages(coverAlone(layout) ? (index === 0 ? 1 : index * 2) : index * 2 + 1, count, layout.cover);
}

/** The item that shows `page`, clamped into the document. */
export function itemIndex(layout: StripLayout, page: number): number {
  const count = total(layout);
  if (!count) return 0;
  const p = Math.max(1, Math.min(count, Math.trunc(Number.isFinite(page) ? page : 1)));
  if (!layout.spread) return p - 1;
  const first = spreadPages(p, count, layout.cover)[0];
  return coverAlone(layout) ? (first === 1 ? 0 : first / 2) : (first - 1) / 2;
}

/** What an item is called: sequence numbers, "20" or "20–21", never the PDF's printed page labels. */
export function stripLabel(pages: readonly number[]): string {
  return pages.length > 1 ? `${pages[0]}–${pages.at(-1)}` : String(pages[0] ?? '');
}

/** Width of item `index`: a lone page takes one slot, a spread two. */
export function itemWidth(layout: StripLayout, index: number): number {
  return itemPages(layout, index).length * layout.page;
}

/** Left edge of item `index` along the items' own span (before the track's end room). */
export function itemLeft(layout: StripLayout, index: number): number {
  if (index <= 0) return 0;
  const full = (layout.spread ? 2 : 1) * layout.page + layout.gap;
  return coverAlone(layout) ? layout.page + layout.gap + (index - 1) * full : index * full;
}

/** Width of the items' own span. */
export function spanWidth(layout: StripLayout): number {
  const last = itemCount(layout) - 1;
  return last < 0 ? 0 : itemLeft(layout, last) + itemWidth(layout, last);
}

/** The scroll offset that puts the centre of item `index` in the middle of a viewport (end room is half the viewport). */
export function centreScroll(layout: StripLayout, index: number): number {
  return Math.round(itemLeft(layout, index) + itemWidth(layout, index) / 2);
}

/** Largest scroll offset: the last item's centre. */
export function maxScroll(layout: StripLayout): number {
  const last = itemCount(layout) - 1;
  return last < 0 ? 0 : centreScroll(layout, last);
}

/** The item whose box, or the gap after it, holds span coordinate `x`; clamped to the first and last item. */
export function itemAt(layout: StripLayout, x: number): number {
  const items = itemCount(layout);
  if (items <= 1) return 0;
  let low = 0, high = items - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (itemLeft(layout, mid) <= x) low = mid; else high = mid - 1;
  }
  return low;
}

/**
 * Items whose boxes come within `overscan` px of a viewport `viewport` px wide scrolled to `scroll`, as an
 * inclusive range, or `undefined` for an empty document. `scroll` is a track offset, so the viewport covers
 * span coordinates `scroll - viewport / 2` to `scroll + viewport / 2`.
 */
export function itemsInView(layout: StripLayout, scroll: number, viewport: number, overscan = 0): { first: number; last: number } | undefined {
  const items = itemCount(layout);
  if (!items) return undefined;
  const left = scroll - viewport / 2 - overscan, right = scroll + viewport / 2 + overscan;
  let first = itemAt(layout, left);
  if (itemLeft(layout, first) + itemWidth(layout, first) < left && first < items - 1) first++;
  const last = itemAt(layout, right);
  return { first: Math.min(first, last), last };
}

/**
 * The items drawn while the strip rests on `current`: the ones in view when it is centred, plus `overscan` px of
 * look-ahead each side. The strip draws no more than this until it is scrolled.
 */
export function itemsAround(layout: StripLayout, current: number, viewport: number, overscan = 0): { first: number; last: number } | undefined {
  return itemsInView(layout, centreScroll(layout, current), viewport, overscan);
}
