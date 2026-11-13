import { scrollToHold } from './zoom';
import { SURFACE } from './zoom-gesture';

/**
 * Which point of the view a zoom or fit change holds still: the centre of the viewport (a zoom, as in Figma: the
 * document point you are looking at stays where you are looking at it) or the line at its top edge (fit width,
 * which keeps your reading position). Horizontally it is always the centre.
 */
export type Hold = 'centre' | 'top';

/** A document point, as a fraction of the page box on each axis, to be put back where it was after the page is redrawn at another size. */
export type Anchor = { host: HTMLElement; hold: Hold; fx: number; fy: number };

/** Where the held point sits in the panel, from the scroll container's inner edge. */
const heldAt = (host: HTMLElement, hold: Hold) => ({ x: host.clientWidth / 2, y: hold === 'centre' ? host.clientHeight / 2 : 0 });
/** The page's start and size in scroll-content coordinates. */
function pageBox(host: HTMLElement) {
  const surface = host.querySelector<HTMLElement>(SURFACE);
  if (!surface) return undefined;
  const box = surface.getBoundingClientRect(), edge = host.getBoundingClientRect();
  if (!box.width || !box.height) return undefined;
  return { x: box.left - edge.left - host.clientLeft + host.scrollLeft, y: box.top - edge.top - host.clientTop + host.scrollTop, width: box.width, height: box.height };
}

/**
 * Notes which document point `hold` names in the page now on screen, or returns nothing when the scroller shows no
 * page box this can follow (reflowable text, a fixed-layout book that scrolls inside its own renderer).
 * The fraction may lie outside the page: a page smaller than the panel is centred in it by the layout.
 */
export function holdView(host: HTMLElement | undefined, hold: Hold): Anchor | undefined {
  const page = host && pageBox(host);
  if (!host || !page) return undefined;
  const at = heldAt(host, hold);
  return { host, hold, fx: (host.scrollLeft + at.x - page.x) / page.width, fy: (host.scrollTop + at.y - page.y) / page.height };
}

/**
 * Scrolls the redrawn page so the noted point is back where it was in the panel. The scroll container limits it: against an
 * edge the page stays against that edge, and an axis on which the page now fits is not scrolled (the layout centres it there).
 */
export function restoreView(anchor: Anchor) {
  const { host, hold, fx, fy } = anchor, page = pageBox(host);
  if (!page) return;
  const at = heldAt(host, hold);
  host.scrollLeft = scrollToHold(page.x, fx, page.width, at.x);
  host.scrollTop = scrollToHold(page.y, fy, page.height, at.y);
}
