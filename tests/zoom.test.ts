import { describe, expect, it } from 'vitest';
import { clampZoom, migrateLegacyZoom, pageFraction, parseZoomInput, roundZoom, scrollToHold, stepZoom, wheelFactor, ZOOM_MAX, ZOOM_MIN, ZOOM_MODEL, ZOOM_PRESETS, ZOOM_STEPS, zoomAbout, zoomPercent } from '../src/zoom';
import { defaultOptions } from '../src/types';

describe('zoom ladder', () => {
  it('is the documented ladder, ascending, from the floor to the ceiling', () => {
    expect(ZOOM_STEPS.map(zoomPercent)).toEqual([10, 25, 33, 50, 67, 75, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400, 600, 800]);
    expect(ZOOM_STEPS[0]).toBe(ZOOM_MIN);
    expect(ZOOM_STEPS.at(-1)).toBe(ZOOM_MAX);
    expect([...ZOOM_STEPS].sort((a, b) => a - b)).toEqual([...ZOOM_STEPS]);
  });

  it('steps from a rung to the next rung', () => {
    expect(stepZoom(1, 1)).toBe(1.1);
    expect(stepZoom(1, -1)).toBe(.9);
    expect(stepZoom(.25, 1)).toBe(.33);
    expect(stepZoom(2, 1)).toBe(2.5);
    expect(stepZoom(4, 1)).toBe(6);
    expect(stepZoom(.25, -1)).toBe(.1);
  });

  it('snaps to the next rung from a level a fit came to, in either direction', () => {
    expect(stepZoom(.8217, 1)).toBe(.9);
    expect(stepZoom(.8217, -1)).toBe(.75);
    expect(stepZoom(1.3, 1)).toBe(1.5);
    expect(stepZoom(1.3, -1)).toBe(1.25);
    expect(stepZoom(5, 1)).toBe(6);
    expect(stepZoom(.05, 1)).toBe(.1);
  });

  it('treats a value within half a percent of a rung as on it', () => {
    expect(stepZoom(1.004, 1)).toBe(1.1);
    expect(stepZoom(.996, -1)).toBe(.9);
  });

  it('stops at the ends and recovers from a stored value outside the range', () => {
    expect(stepZoom(ZOOM_MAX, 1)).toBe(ZOOM_MAX);
    expect(stepZoom(ZOOM_MIN, -1)).toBe(ZOOM_MIN);
    expect(stepZoom(9, 1)).toBe(ZOOM_MAX);
    expect(stepZoom(9, -1)).toBe(8);
    expect(stepZoom(.05, -1)).toBe(ZOOM_MIN);
  });

  it('walks the whole ladder up and back down', () => {
    let zoom: number = ZOOM_MIN; const up = [zoom];
    for (let i = 0; i < 30 && zoom < ZOOM_MAX; i++) up.push(zoom = stepZoom(zoom, 1));
    expect(up).toEqual([...ZOOM_STEPS]);
    const down = [zoom];
    for (let i = 0; i < 30 && zoom > ZOOM_MIN; i++) down.push(zoom = stepZoom(zoom, -1));
    expect(down).toEqual([...ZOOM_STEPS].reverse());
  });

  it('stops at the limits of a page too large for the full range, which end on no rung', () => {
    const large = { min: ZOOM_MIN, max: 5.33 };
    expect(stepZoom(4, 1, large)).toBe(5.33);
    expect(stepZoom(5.33, 1, large)).toBe(5.33);
    expect(stepZoom(5.33, -1, large)).toBe(4);
    expect(stepZoom(7, -1, large)).toBe(4);
    expect(stepZoom(3, 1, { min: ZOOM_MIN, max: 3 })).toBe(3);
  });

  it('offers 50 and 200 % as presets, both on the ladder', () => {
    expect(ZOOM_PRESETS.map(zoomPercent)).toEqual([50, 200]);
    for (const preset of ZOOM_PRESETS) expect(ZOOM_STEPS).toContain(preset);
  });
});

describe('zoom field', () => {
  it('reads a bare number, a percentage and stray spaces', () => {
    expect(parseZoomInput('135')).toBe(1.35);
    expect(parseZoomInput('135%')).toBe(1.35);
    expect(parseZoomInput('  70 % ')).toBe(.7);
    expect(parseZoomInput('100')).toBe(1);
  });

  it('rounds a decimal percentage to a whole percent', () => {
    expect(parseZoomInput('87.6')).toBe(.88);
    expect(parseZoomInput('33.2%')).toBe(.33);
  });

  it('clamps to the supported range', () => {
    expect(parseZoomInput('9000')).toBe(ZOOM_MAX);
    expect(parseZoomInput('80000%')).toBe(ZOOM_MAX);
    expect(parseZoomInput('1')).toBe(ZOOM_MIN);
    expect(parseZoomInput('9.9')).toBe(ZOOM_MIN);
    expect(parseZoomInput('900')).toBe(ZOOM_MAX);
  });

  it('clamps to the limits of the page on screen, never rounding past them', () => {
    expect(parseZoomInput('800', { min: ZOOM_MIN, max: 5.337 })).toBe(5.33);
    expect(parseZoomInput('10', { min: .124, max: 8 })).toBe(.13);
  });

  it('rejects what is not a positive number, so the field reverts', () => {
    for (const text of ['', ' ', 'abc', '12a', '-50', '+50', '0', '0%', '1,5', '1e3', '%', '50 %%', 'NaN', 'Infinity']) expect(parseZoomInput(text), text).toBeUndefined();
  });

  it('clamps and rounds stored values', () => {
    expect(clampZoom(NaN)).toBe(1);
    expect(clampZoom(90)).toBe(ZOOM_MAX);
    expect(clampZoom(.01)).toBe(ZOOM_MIN);
    expect(roundZoom(1.2349)).toBe(1.23);
    expect(roundZoom(.995)).toBe(1);
  });
});

describe('saved zoom from before zoom was a true scale', () => {
  it('versions what a saved zoom means', () => {
    expect(ZOOM_MODEL).toBe(2);
    expect(defaultOptions.zoomModel).toBe(ZOOM_MODEL);
    expect(defaultOptions.fitted).toBe(true);
  });

  it('keeps a multiplier of 1 as the fit it was, whichever the fit', () => {
    expect(migrateLegacyZoom({ fit: 'page', zoom: 1 }, .82)).toEqual({ fit: 'page', fitted: true, zoom: 1 });
    expect(migrateLegacyZoom({ fit: 'width', zoom: 1.004 }, 1.31)).toEqual({ fit: 'width', fitted: true, zoom: 1 });
  });

  it('turns any other multiplier into the true scale the page was drawn at, keeping its fit for a later return', () => {
    // Fit page drew the page at 82 %; 1.5x of that was 123 %.
    const converted = migrateLegacyZoom({ fit: 'page', zoom: 1.5 }, .82);
    expect(converted.fitted).toBe(false); expect(converted.fit).toBe('page');
    expect(converted.zoom).toBeCloseTo(1.23, 12);
    expect(migrateLegacyZoom({ fit: 'width', zoom: .5 }, 1.31)).toEqual({ fit: 'width', fitted: false, zoom: 1.31 * .5 });
  });

  it('does not round, so the page keeps its size exactly, but stays in range', () => {
    expect(migrateLegacyZoom({ fit: 'page', zoom: 1.37 }, .8217).zoom).toBe(.8217 * 1.37);
    expect(migrateLegacyZoom({ fit: 'page', zoom: 4 }, 3).zoom).toBe(ZOOM_MAX);
    expect(migrateLegacyZoom({ fit: 'page', zoom: .25 }, .3).zoom).toBe(ZOOM_MIN);
    expect(migrateLegacyZoom({ fit: 'page', zoom: 4 }, 3, { min: ZOOM_MIN, max: 5 }).zoom).toBe(5);
  });

  it('is the multiplier itself where the format never scaled by the fit (a fixed-layout book, base 1)', () => {
    expect(migrateLegacyZoom({ fit: 'page', zoom: 1.5 }, 1)).toEqual({ fit: 'page', fitted: false, zoom: 1.5 });
  });

  it('keeps the fit rather than guess when nothing is known', () => {
    expect(migrateLegacyZoom({ fit: 'page', zoom: 2 }, undefined)).toEqual({ fit: 'page', fitted: true, zoom: 1 });
    expect(migrateLegacyZoom({ fit: 'width', zoom: NaN }, .8)).toEqual({ fit: 'width', fitted: true, zoom: 1 });
    expect(migrateLegacyZoom({ fit: 'page', zoom: 2 }, 0)).toEqual({ fit: 'page', fitted: true, zoom: 1 });
    expect(migrateLegacyZoom({ fit: 'page', zoom: -2 }, .8)).toEqual({ fit: 'page', fitted: true, zoom: 1 });
  });
});

describe('wheel and pinch factor', () => {
  it('zooms in for a negative delta and out for a positive one, by reciprocal amounts', () => {
    expect(wheelFactor(-10)).toBeGreaterThan(1);
    expect(wheelFactor(10)).toBeLessThan(1);
    expect(wheelFactor(-10) * wheelFactor(10)).toBeCloseTo(1, 10);
    expect(wheelFactor(0)).toBe(1);
  });

  it('follows a trackpad pinch (small deltas) proportionally', () => {
    expect(Math.log(wheelFactor(-2))).toBeCloseTo(Math.log(wheelFactor(-1)) * 2, 10);
  });

  it('caps a mouse-wheel notch so it is a step, not a jump', () => {
    expect(wheelFactor(-100)).toBe(wheelFactor(-40));
    expect(wheelFactor(-100)).toBeLessThan(1.6);
    expect(wheelFactor(100)).toBe(wheelFactor(40));
  });

  it('reads line and page deltas as larger ones', () => {
    expect(wheelFactor(-1, 1)).toBeCloseTo(wheelFactor(-16), 10);
    expect(wheelFactor(-1, 2)).toBeCloseTo(wheelFactor(-40), 10);
  });
});

describe('zooming about the pointer', () => {
  const identity = { scale: 1, x: 0, y: 0 };
  /** Where a page point lands on screen under a pose. */
  const drawn = (pose: { scale: number; x: number; y: number }, point: { x: number; y: number }) => ({ x: pose.x + pose.scale * point.x, y: pose.y + pose.scale * point.y });

  it('keeps the point under the pointer where it was', () => {
    const at = { x: 120, y: 80 };
    const pose = zoomAbout(identity, 2, at, .25, 4);
    expect(pose.scale).toBe(2);
    expect(drawn(pose, at)).toEqual(at);
  });

  it('keeps it there across several steps and a change of direction', () => {
    const at = { x: 300, y: 50 };
    let pose = identity;
    for (const factor of [1.2, 1.5, .8, 2, .5]) { pose = zoomAbout(pose, factor, at, .1, 10); expect(drawn(pose, at).x).toBeCloseTo(at.x, 9); expect(drawn(pose, at).y).toBeCloseTo(at.y, 9); }
    expect(pose.scale).toBeCloseTo(1.2 * 1.5 * .8 * 2 * .5, 9);
  });

  it('follows a pointer that moves between steps', () => {
    const first = zoomAbout(identity, 2, { x: 100, y: 100 }, .25, 4);
    const page = { x: (140 - first.x) / first.scale, y: (90 - first.y) / first.scale }; // The page point under (140, 90) before the second step.
    const second = zoomAbout(first, 1.5, { x: 140, y: 90 }, .25, 4);
    expect(second.scale).toBe(3);
    expect(drawn(second, page).x).toBeCloseTo(140, 9);
    expect(drawn(second, page).y).toBeCloseTo(90, 9);
  });

  it('stops at the limits and keeps the pointer still when it does', () => {
    const at = { x: 40, y: 60 };
    const top = zoomAbout({ scale: 3, x: -10, y: -20 }, 5, at, .25, 4);
    expect(top.scale).toBe(4);
    expect(drawn(top, { x: (at.x + 10) / 3, y: (at.y + 20) / 3 })).toEqual(expect.objectContaining({ x: expect.closeTo(at.x, 9), y: expect.closeTo(at.y, 9) }));
    const atTop = zoomAbout(top, 2, at, .25, 4);
    expect(atTop).toEqual(top);
    expect(zoomAbout(identity, .001, at, .25, 4).scale).toBe(.25);
  });

  it('finds the page fraction under the pointer and the scroll that holds it after a re-render', () => {
    // A 400 x 500 page laid out with its corner at (50, 30); scaled 2x about the pointer at (250, 280).
    const origin = { x: 50, y: 30 }, pointer = { x: 250, y: 280 };
    const pose = zoomAbout(identity, 2, { x: pointer.x - origin.x, y: pointer.y - origin.y }, .25, 4);
    const held = pageFraction(pose, { x: pointer.x - origin.x, y: pointer.y - origin.y }, { width: 400, height: 500 });
    expect(held).toEqual({ x: .5, y: .5 });
    // Re-rendered at 2x (800 x 1000), in a scroller whose content starts the page 16 px in and which has not scrolled:
    // the page centre must end up under the pointer.
    const scrollLeft = scrollToHold(16, held.x, 800, 200), scrollTop = scrollToHold(16, held.y, 1000, 250);
    expect(16 + held.x * 800 - scrollLeft).toBe(200);
    expect(16 + held.y * 1000 - scrollTop).toBe(250);
  });
});
