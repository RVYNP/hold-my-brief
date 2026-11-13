import type { Offset } from './pan';
import { SURFACE } from './zoom-gesture';

/**
 * Which point of the view a zoom or fit change holds still: the centre of the viewport (a zoom, as in Figma: the
 * document point you are looking at stays where you are looking at it) or the line at its top edge (fit width,
 * which keeps your reading position and lets the page centre sideways).
 */
export type Hold = 'centre' | 'top';

/** One axis of a held point: the fraction of the page it sits at, and where in the panel it is to stay (from the panel's inner edge). */
export type Axis = { f: number; at: number };
/** A document point to hold still while the page is redrawn at another size; an axis left out is not held. */
export type Spot = { x?: Axis; y?: Axis };
/** A spot, with the scroll container it is in and the way to slide a page that fits (`Panner.slideTo`); without it the page only scrolls. */
export type Anchor = Spot & { host: HTMLElement; slide?: (offset: Offset) => void };

/** The page's start and size in scroll-content coordinates. */
function pageBox(host: HTMLElement) {
  const surface = host.querySelector<HTMLElement>(SURFACE);
  if (!surface) return undefined;
  const box = surface.getBoundingClientRect(), edge = host.getBoundingClientRect();
  if (!box.width || !box.height) return undefined;
  return { x: box.left - edge.left - host.clientLeft + host.scrollLeft, y: box.top - edge.top - host.clientTop + host.scrollTop, width: box.width, height: box.height };
}

/**
 * The document point `hold` names in the page now on screen (slid or not: the page's box is where it is drawn), or nothing when
 * the scroller shows no page box this can follow (reflowable text, a fixed-layout book that scrolls inside its own renderer).
 * The fraction may lie outside the page: a page smaller than the panel is centred in it by the layout.
 */
export function holdView(host: HTMLElement | undefined, hold: Hold): Spot | undefined {
  const page = host && pageBox(host);
  if (!host || !page) return undefined;
  const x = { at: host.clientWidth / 2 }, y = { at: hold === 'centre' ? host.clientHeight / 2 : 0 };
  const spot: Spot = { y: { f: (host.scrollTop + y.at - page.y) / page.height, at: y.at } };
  if (hold === 'centre') spot.x = { f: (host.scrollLeft + x.at - page.x) / page.width, at: x.at };
  return spot;
}

/**
 * Puts the held point back where it was in the panel, now the page is redrawn. Where the page overflows it scrolls there as far as
 * the scroll range reaches (the point cannot be held past the end of the page: the page then rests against that end, as the scaled
 * preview of a gesture already showed). Where the page fits, the layout centres it, so the whole move is a slide, which never takes
 * the page more than KEEP px out of view (see `Panner.slideTo`).
 */
export function restoreView(anchor: Anchor) {
  const { host } = anchor, page = pageBox(host);
  if (!page) return;
  const slide = { x: 0, y: 0 };
  for (const [axis, spot, origin, size, max, scroll] of [
    ['x', anchor.x, page.x, page.width, host.scrollWidth - host.clientWidth, 'scrollLeft'],
    ['y', anchor.y, page.y, page.height, host.scrollHeight - host.clientHeight, 'scrollTop'],
  ] as const) {
    if (!spot) continue;
    const wanted = origin + spot.f * size - spot.at;
    if (max > 1) host[scroll] = Math.max(0, Math.min(max, wanted));
    else { host[scroll] = 0; slide[axis] = -wanted; }
  }
  // An image is centred inside a frame at least as large as the panel, so the frame's fractions say nothing about where the picture is: it only scrolls.
  if (!host.querySelector(':scope > .image-frame') && (Math.abs(slide.x) > .25 || Math.abs(slide.y) > .25)) anchor.slide?.(slide);
}
