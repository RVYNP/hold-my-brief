/**
 * Sending an area of a page to an agent: the geometry that turns a box the user dragged over the reading surface into the pixels to crop
 * and the place on the page to report. The adapters measure (where each page is on screen, how many pixels its canvas has) and draw;
 * this module knows nothing of the DOM.
 */

/** A rectangle: its top-left corner, width and height. */
export type Box = { x: number; y: number; w: number; h: number };

/** One page as the user sees it: `rect` is where it is on screen and `pixelsWidth` × `pixelsHeight` the bitmap the adapter can crop from. */
export type AreaPage = { page?: number; rect: Box; pixelsWidth: number; pixelsHeight: number };

/** Copies `source` (in the page's bitmap, pixels) to `dest` (in the output image, pixels). */
export type AreaDraw = { index: number; source: Box; dest: Box };

export type AreaPlan = {
  /** The size of the image to make, in pixels. */
  width: number;
  height: number;
  draws: AreaDraw[];
  /** The page under the box's centre (the one with most of the box when the centre is over none), and its number if it has one. */
  index: number;
  page?: number;
  /** The part of the box over that page, as fractions 0–1 of its width and height, four decimals. */
  box: Box;
};

/** The longest side, in pixels, an area's image may have. */
export const AREA_MAX_SIDE = 2048;
/** A drag smaller than this in either direction, in CSS px, is a slip and sends nothing. */
export const AREA_MIN_SIDE = 8;

const fraction = (value: number) => Math.round(Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)) * 10000) / 10000;
const meet = (a: Box, b: Box): Box | undefined => {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y), right = Math.min(a.x + a.w, b.x + b.w), bottom = Math.min(a.y + a.h, b.y + b.h);
  return right > x && bottom > y ? { x, y, w: right - x, h: bottom - y } : undefined;
};

/** The box between two points, whichever corner the drag started from. */
export function boxBetween(from: { x: number; y: number }, to: { x: number; y: number }): Box {
  return { x: Math.min(from.x, to.x), y: Math.min(from.y, to.y), w: Math.abs(to.x - from.x), h: Math.abs(to.y - from.y) };
}

/** Whether a dragged box is big enough to send. */
export const worthSending = (box: Box) => box.w >= AREA_MIN_SIDE && box.h >= AREA_MIN_SIDE;

/**
 * What to crop for `box` (CSS px in the reading surface) from `pages` (their rectangles in the same space). The part of the box outside every
 * page is dropped. The image is made at the first page's bitmap scale, so a page drawn at 2× gives twice the pixels of the box, and it is
 * scaled down, keeping its aspect, when its longer side would pass `maxSide`. Undefined when the box is over no page.
 */
export function planArea(box: Box, pages: readonly AreaPage[], maxSide = AREA_MAX_SIDE): AreaPlan | undefined {
  const hits = pages.map((page, index) => ({ page, index, part: meet(box, page.rect) })).filter((hit): hit is { page: AreaPage; index: number; part: Box } => Boolean(hit.part) && hit.page.rect.w > 0 && hit.page.rect.h > 0);
  if (!hits.length) return undefined;
  const left = Math.min(...hits.map(hit => hit.part.x)), top = Math.min(...hits.map(hit => hit.part.y));
  const clip: Box = { x: left, y: top, w: Math.max(...hits.map(hit => hit.part.x + hit.part.w)) - left, h: Math.max(...hits.map(hit => hit.part.y + hit.part.h)) - top };
  const first = hits[0].page, natural = first.pixelsWidth / first.rect.w;
  const longest = Math.max(clip.w, clip.h) * natural, scale = natural * (longest > maxSide ? maxSide / longest : 1);
  const draws = hits.map(({ page, index, part }): AreaDraw => ({
    index,
    source: { x: (part.x - page.rect.x) * page.pixelsWidth / page.rect.w, y: (part.y - page.rect.y) * page.pixelsHeight / page.rect.h, w: part.w * page.pixelsWidth / page.rect.w, h: part.h * page.pixelsHeight / page.rect.h },
    dest: { x: (part.x - clip.x) * scale, y: (part.y - clip.y) * scale, w: part.w * scale, h: part.h * scale },
  }));
  const centre = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  const under = hits.find(({ page }) => centre.x >= page.rect.x && centre.x < page.rect.x + page.rect.w && centre.y >= page.rect.y && centre.y < page.rect.y + page.rect.h)
    ?? hits.reduce((best, hit) => (hit.part.w * hit.part.h > best.part.w * best.part.h ? hit : best));
  const onPage = meet(clip, under.page.rect)!, rect = under.page.rect;
  return {
    width: Math.max(1, Math.round(clip.w * scale)), height: Math.max(1, Math.round(clip.h * scale)),
    draws, index: under.index, ...(under.page.page === undefined ? {} : { page: under.page.page }),
    box: { x: fraction((onPage.x - rect.x) / rect.w), y: fraction((onPage.y - rect.y) / rect.h), w: fraction(onPage.w / rect.w), h: fraction(onPage.h / rect.h) },
  };
}

/** What an adapter hands back for an area: the picture and where it is. `page` is 1-based and absent for an image. */
export type AreaCapture = { png: Blob; width: number; height: number; page?: number; box: Box };

/** A canvas as a PNG. */
export const canvasPng = (canvas: HTMLCanvasElement) => new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('The area could not be turned into an image.'))), 'image/png'));
