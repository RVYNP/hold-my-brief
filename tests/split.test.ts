import { describe, expect, it } from 'vitest';
import { canSplit, clampPercent, nudgePercent, percentAt, percentLimits, shareOf, snapPercent } from '../src/split';

describe('room for a split', () => {
  it('needs two panes of 360 px and the divider, in a window of at least 720 px', () => {
    expect(canSplit(728, 800)).toBe(true);
    expect(canSplit(727, 800)).toBe(false);
    expect(canSplit(1000, 719)).toBe(false);
    expect(canSplit(1392, 1440)).toBe(true);
  });
});

describe('the divider', () => {
  const share = shareOf(1392); // 1384 px between the panes

  it('settles on 40, 50 and 60 % within 12 px and nowhere else', () => {
    expect(snapPercent(50.4, share)).toBe(50);
    expect(snapPercent(60 + 11 / share * 100, share)).toBe(60);
    expect(snapPercent(40 - 11 / share * 100, share)).toBe(40);
    const away = 60 + 13 / share * 100;
    expect(snapPercent(away, share)).toBeCloseTo(away, 6);
  });

  it('keeps both panes at least 360 px wide', () => {
    const { min, max } = percentLimits(share);
    expect(min / 100 * share).toBeCloseTo(360, 6);
    expect(max / 100 * share).toBeCloseTo(share - 360, 6);
    expect(clampPercent(5, share)).toBe(min);
    expect(clampPercent(99, share)).toBe(max);
    expect(snapPercent(1, share)).toBe(min);
  });

  it('holds at the middle when the room is too small for two minimum panes', () => {
    expect(percentLimits(700)).toEqual({ min: 50, max: 50 });
    expect(snapPercent(30, 700)).toBe(50);
  });

  it('reads a pointer position as the percent whose divider is centred on it', () => {
    // A room from x = 48 to 1440: share 1384, a divider centred at 48 + 4 + 692 puts pane A at 50 %.
    expect(percentAt(48 + 4 + 692, 48, 1440)).toBeCloseTo(50, 6);
    expect(percentAt(48 + 4, 48, 1440)).toBeCloseTo(0, 6);
  });

  it('moves 2 % with the arrows and to the limits with Home and End', () => {
    const { min, max } = percentLimits(share);
    expect(nudgePercent('ArrowRight', 50, share)).toBe(52);
    expect(nudgePercent('ArrowLeft', 50, share)).toBe(48);
    expect(nudgePercent('Home', 50, share)).toBe(min);
    expect(nudgePercent('End', 50, share)).toBe(max);
    expect(nudgePercent('ArrowRight', max - 1, share)).toBe(max);
    expect(nudgePercent('a', 50, share)).toBeUndefined();
  });
});
