import { describe, expect, it } from 'vitest';
import { AREA_MAX_SIDE, boxBetween, planArea, worthSending } from '../src/area';

/** A page of 600 × 800 CSS px whose bitmap has `dpr` pixels per CSS px. */
const page = (number: number, x: number, y = 0, dpr = 1) => ({ page: number, rect: { x, y, w: 600, h: 800 }, pixelsWidth: 600 * dpr, pixelsHeight: 800 * dpr });

describe('planArea', () => {
  it('reports a box on one page as fractions of that page and crops at the bitmap scale', () => {
    const plan = planArea({ x: 160, y: 120, w: 300, h: 200 }, [page(7, 100, 20, 2)])!;
    expect(plan.page).toBe(7);
    expect(plan.box).toEqual({ x: 0.1, y: 0.125, w: 0.5, h: 0.25 });
    expect([plan.width, plan.height]).toEqual([600, 400]); // 2 pixels per CSS px
    expect(plan.draws).toEqual([{ index: 0, source: { x: 120, y: 200, w: 600, h: 400 }, dest: { x: 0, y: 0, w: 600, h: 400 } }]);
  });

  it('names the page under the centre of a box spanning a spread, and measures the box on that page', () => {
    const spread = [page(2, 0), page(3, 600)];
    // 400 px wide from x = 300 to 700: the centre (500) is on the left page, so is its part of the box.
    expect(planArea({ x: 300, y: 100, w: 400, h: 100 }, spread)).toMatchObject({ page: 2, width: 400, height: 100, box: { x: 0.5, y: 0.125, w: 0.5, h: 0.125 } });
    // From x = 400 to 900 the centre (650) is on the right page.
    const right = planArea({ x: 400, y: 100, w: 500, h: 100 }, spread)!;
    expect(right.page).toBe(3);
    expect(right.box).toEqual({ x: 0, y: 0.125, w: 0.5, h: 0.125 });
    // One image: each page's part lands side by side.
    expect(right.draws.map(draw => [draw.index, draw.source.x, draw.source.w, draw.dest.x, draw.dest.w])).toEqual([[0, 400, 200, 0, 200], [1, 0, 300, 200, 300]]);
  });

  it('works on the second page of a spread as the only page under the box', () => {
    const plan = planArea({ x: 750, y: 400, w: 150, h: 80 }, [page(4, 0), page(5, 600)])!;
    expect(plan.page).toBe(5);
    expect(plan.box).toEqual({ x: 0.25, y: 0.5, w: 0.25, h: 0.1 });
    expect(plan.draws).toHaveLength(1);
    expect(plan.draws[0].index).toBe(1);
  });

  it('follows a zoomed page: the same part of the page gives the same fractions at any size', () => {
    const at = (zoom: number) => planArea({ x: 50 * zoom, y: 80 * zoom, w: 120 * zoom, h: 160 * zoom }, [{ page: 1, rect: { x: 0, y: 0, w: 600 * zoom, h: 800 * zoom }, pixelsWidth: 1200, pixelsHeight: 1600 }])!;
    for (const zoom of [0.5, 1, 3]) expect(at(zoom).box).toEqual({ x: 0.0833, y: 0.1, w: 0.2, h: 0.2 });
    expect([at(0.5).width, at(3).width]).toEqual([Math.round(120 * 0.5 * 4), Math.round(120 * 3 * 2 / 3)]); // 4 and 2/3 bitmap pixels per CSS px
  });

  it('drops what is outside every page, and refuses a box over none', () => {
    const plan = planArea({ x: -50, y: 700, w: 200, h: 300 }, [page(1, 0)])!;
    expect(plan.box).toEqual({ x: 0, y: 0.875, w: 0.25, h: 0.125 });
    expect([plan.width, plan.height]).toEqual([150, 100]);
    expect(planArea({ x: 700, y: 0, w: 50, h: 50 }, [page(1, 0)])).toBeUndefined();
    expect(planArea({ x: 0, y: 0, w: 50, h: 50 }, [])).toBeUndefined();
  });

  it('names the page with most of the box when the centre is over none', () => {
    // The centre (y = 840) is in the gap below the page.
    expect(planArea({ x: 10, y: 700, w: 100, h: 280 }, [page(9, 0)])).toMatchObject({ page: 9 });
  });

  it('scales down, keeping the aspect, to 2048 px on the longer side', () => {
    const plan = planArea({ x: 0, y: 0, w: 600, h: 800 }, [page(1, 0, 0, 4)])!;
    expect([plan.width, plan.height]).toEqual([1536, AREA_MAX_SIDE]);
    expect(plan.draws[0].source).toEqual({ x: 0, y: 0, w: 2400, h: 3200 });
    expect(plan.draws[0].dest).toEqual({ x: 0, y: 0, w: 1536, h: 2048 });
  });

  it('has no page number for an image', () => {
    const plan = planArea({ x: 0, y: 0, w: 50, h: 40 }, [{ rect: { x: 0, y: 0, w: 100, h: 80 }, pixelsWidth: 1000, pixelsHeight: 800 }])!;
    expect('page' in plan).toBe(false);
    expect(plan.box).toEqual({ x: 0, y: 0, w: 0.5, h: 0.5 });
    expect([plan.width, plan.height]).toEqual([500, 400]);
  });
});

describe('the dragged box', () => {
  it('is the same from any corner', () => {
    expect(boxBetween({ x: 40, y: 10 }, { x: 10, y: 30 })).toEqual({ x: 10, y: 10, w: 30, h: 20 });
  });
  it('must be at least 8 × 8 px', () => {
    expect(worthSending({ x: 0, y: 0, w: 8, h: 8 })).toBe(true);
    expect(worthSending({ x: 0, y: 0, w: 7.9, h: 100 })).toBe(false);
    expect(worthSending({ x: 0, y: 0, w: 100, h: 7 })).toBe(false);
  });
});
