import { describe, expect, it } from 'vitest';
import { clampOffset, KEEP } from '../src/pan';

const panel = { left: 0, top: 0, right: 400, bottom: 600 };
/** A 200 x 300 page centred in the panel. */
const page = { left: 100, top: 150, right: 300, bottom: 450 };

describe('hand-tool page offset', () => {
  it('passes a small move through unchanged', () => {
    expect(clampOffset({ x: 30, y: -40 }, page, panel)).toEqual({ x: 30, y: -40 });
  });

  it('leaves exactly 64 px of the page inside the panel at each edge', () => {
    // Right/bottom: the page's left/top edge may come no closer than 64 px to the far edge.
    expect(clampOffset({ x: 9999, y: 9999 }, page, panel)).toEqual({ x: 400 - KEEP - 100, y: 600 - KEEP - 150 });
    // Left/top: the page's right/bottom edge may go no further than 64 px past the near edge.
    expect(clampOffset({ x: -9999, y: -9999 }, page, panel)).toEqual({ x: KEEP - 300, y: KEEP - 450 });
  });

  it('clamps each axis on its own', () => {
    expect(clampOffset({ x: 9999, y: 20 }, page, panel)).toEqual({ x: 236, y: 20 });
  });

  it('keeps all of a page that is narrower than the margin', () => {
    const sliver = { left: 190, top: 100, right: 210, bottom: 500 };
    expect(clampOffset({ x: 9999, y: 0 }, sliver, panel).x).toBe(400 - 20 - 190);
    expect(clampOffset({ x: -9999, y: 0 }, sliver, panel).x).toBe(20 - 210);
  });

  it('never demands more than the panel itself shows', () => {
    const narrow = { left: 0, top: 0, right: 40, bottom: 40 };
    const result = clampOffset({ x: 9999, y: -9999 }, page, narrow);
    expect(result.x).toBe(40 - 40 - 100); // The panel is 40 px wide, so at most 40 px are asked to stay.
    expect(result.y).toBe(40 - 450);
  });

  it('is the identity for a page already inside range at zero', () => {
    expect(clampOffset({ x: 0, y: 0 }, page, panel)).toEqual({ x: 0, y: 0 });
  });
});
