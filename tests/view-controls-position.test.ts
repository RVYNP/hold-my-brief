import { describe, expect, it } from 'vitest';
import { avoidBand, clampPoint, nudgeFor, parsePlacement, pillBottomClearance, pillMargin, placementOf, resolvePlacement, serialisePlacement } from '../src/view-controls-position';

const panel = { width: 1000, height: 600 }, pill = { width: 200, height: 32 };

describe('view-controls clamping', () => {
  it('leaves a point that already fits alone', () => {
    expect(clampPoint({ left: 300, top: 200 }, panel, pill)).toEqual({ left: 300, top: 200 });
  });

  it('keeps the whole pill inside the panel with the margin on every side', () => {
    expect(clampPoint({ left: -50, top: -50 }, panel, pill)).toEqual({ left: pillMargin, top: pillMargin });
    expect(clampPoint({ left: 5000, top: 5000 }, panel, pill)).toEqual({ left: 1000 - 200 - pillMargin, top: 600 - 32 - pillBottomClearance });
  });

  it('never lets the pill into the footer band at the bottom', () => {
    expect(clampPoint({ left: 100, top: 590 }, panel, pill).top + pill.height).toBe(panel.height - pillBottomClearance);
  });

  it('pins a panel too small for the pill to the top-left margin', () => {
    expect(clampPoint({ left: 40, top: 40 }, { width: 150, height: 50 }, pill)).toEqual({ left: pillMargin, top: pillMargin });
  });

  it('treats a non-finite point as the top-left margin', () => {
    expect(clampPoint({ left: NaN, top: Infinity }, panel, pill)).toEqual({ left: pillMargin, top: pillMargin });
  });
});

describe('view-controls placement fractions', () => {
  it('stores the centre as a fraction of the panel', () => {
    expect(placementOf({ left: 400, top: 284 }, panel, pill)).toEqual({ x: .5, y: .5 });
  });

  it('round-trips through pixels', () => {
    const point = { left: 123, top: 77 };
    expect(resolvePlacement(placementOf(point, panel, pill), panel, pill)).toEqual(point);
  });

  it('keeps a proportional position when the panel is resized', () => {
    const placement = placementOf({ left: 400, top: 284 }, panel, pill);
    expect(resolvePlacement(placement, { width: 500, height: 300 }, pill)).toEqual({ left: 150, top: 134 });
  });

  it('clamps fractions at the panel edges to the inside', () => {
    expect(resolvePlacement({ x: 0, y: 0 }, panel, pill)).toEqual({ left: pillMargin, top: pillMargin });
    expect(resolvePlacement({ x: 1, y: 1 }, panel, pill)).toEqual({ left: 1000 - 200 - pillMargin, top: 600 - 32 - pillBottomClearance });
  });

  it('clamps a point outside the panel before turning it into fractions', () => {
    expect(placementOf({ left: -500, top: 9999 }, panel, pill)).toEqual({ x: 0, y: 1 });
  });

  it('falls back to the centre for an unmeasured panel', () => {
    expect(placementOf({ left: 10, top: 10 }, { width: 0, height: 0 }, pill)).toEqual({ x: .5, y: .5 });
  });
});

describe('view-controls and the library drawer', () => {
  const band = { left: 6, right: 286 };

  it('ignores a missing or empty band', () => {
    expect(avoidBand({ left: 20, top: 100 }, panel, pill, null)).toEqual({ left: 20, top: 100 });
    expect(avoidBand({ left: 20, top: 100 }, panel, pill, { left: 50, right: 50 })).toEqual({ left: 20, top: 100 });
  });

  it('shifts a pill under a left drawer out to its right, keeping the margin', () => {
    expect(avoidBand({ left: 100, top: 100 }, panel, pill, band)).toEqual({ left: 294, top: 100 });
  });

  it('shifts a pill under a right drawer out to its left', () => {
    const right = { left: 714, right: 994 };
    expect(avoidBand({ left: 600, top: 100 }, panel, pill, right)).toEqual({ left: 714 - pillMargin - 200, top: 100 });
  });

  it('leaves a pill that is already clear alone', () => {
    expect(avoidBand({ left: 400, top: 100 }, panel, pill, band)).toEqual({ left: 400, top: 100 });
  });

  it('keeps the position when the drawer leaves no room on either side', () => {
    expect(avoidBand({ left: 100, top: 100 }, { width: 400, height: 600 }, pill, { left: 6, right: 394 })).toEqual({ left: 100, top: 100 });
  });

  it('resolves a stored placement clear of the drawer, still inside the panel', () => {
    const resolved = resolvePlacement({ x: .2, y: .5 }, panel, pill, band);
    expect(resolved.left).toBeGreaterThanOrEqual(band.right + pillMargin);
    expect(resolved.left + pill.width).toBeLessThanOrEqual(panel.width - pillMargin);
  });
});

describe('view-controls storage', () => {
  it('round-trips a placement', () => {
    expect(parsePlacement(serialisePlacement({ x: .123456, y: .9 }))).toEqual({ x: .1235, y: .9 });
  });

  it('treats anything unusable as no custom position', () => {
    for (const saved of [null, '', 'nope', 'null', '[]', '{"x":1}', '{"x":"1","y":0}', '{"x":2,"y":0}', '{"x":0,"y":-1}', '{"x":null,"y":0}']) expect(parsePlacement(saved)).toBeNull();
  });
});

describe('view-controls keyboard nudges', () => {
  it('moves 16 px per arrow and 64 px with Shift', () => {
    expect(nudgeFor('ArrowUp', false)).toEqual({ dx: 0, dy: -16 });
    expect(nudgeFor('ArrowDown', false)).toEqual({ dx: 0, dy: 16 });
    expect(nudgeFor('ArrowLeft', true)).toEqual({ dx: -64, dy: 0 });
    expect(nudgeFor('ArrowRight', true)).toEqual({ dx: 64, dy: 0 });
  });

  it('ignores other keys', () => {
    expect(nudgeFor('Home', false)).toBeNull();
    expect(nudgeFor('a', false)).toBeNull();
  });
});
