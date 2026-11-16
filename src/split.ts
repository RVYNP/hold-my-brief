/**
 * The split's numbers and rules, free of the DOM so they are unit-tested: how much room two panes need, where the divider snaps and what the
 * keyboard does to it. A divider position is a percentage (0–100) of the room the two panes share (the reading width less the divider itself).
 */

/** The divider's width, in CSS px. */
export const DIVIDER_WIDTH = 8;
/** The narrowest a pane may be. */
export const MIN_PANE_WIDTH = 360;
/** Below this window width a split shows one pane at a time. */
export const MIN_SPLIT_WINDOW = 720;
/** Where the divider settles when it is let go close to them, and how close counts (CSS px). */
export const SNAP_POINTS = [40, 50, 60] as const;
export const SNAP_DISTANCE = 12;
/** What ← and → move the divider by, in percent. */
export const KEY_STEP = 2;
export const DEFAULT_PERCENT = 50;

/** The room two panes share, given the width the reading area has: what is left after the divider. */
export const shareOf = (readingWidth: number) => readingWidth - DIVIDER_WIDTH;

/** Whether a reading area `workspaceWidth` wide, in a window `windowWidth` wide, has room for two panes. */
export function canSplit(workspaceWidth: number, windowWidth: number): boolean {
  return windowWidth >= MIN_SPLIT_WINDOW && workspaceWidth >= 2 * MIN_PANE_WIDTH + DIVIDER_WIDTH;
}

/** The smallest and largest percent that keep both panes at least `MIN_PANE_WIDTH` wide (a share too small for that gives 50 for both). */
export function percentLimits(share: number): { min: number; max: number } {
  if (share < 2 * MIN_PANE_WIDTH) return { min: 50, max: 50 };
  const min = MIN_PANE_WIDTH / share * 100;
  return { min, max: 100 - min };
}

export const clampPercent = (percent: number, share: number) => { const { min, max } = percentLimits(share); return Math.max(min, Math.min(max, percent)); };

/** A dragged position: it settles on 40, 50 or 60 % when within `SNAP_DISTANCE` px of it, and always keeps both panes at their minimum. */
export function snapPercent(percent: number, share: number): number {
  const near = SNAP_POINTS.find(point => Math.abs(percent - point) / 100 * share <= SNAP_DISTANCE);
  return clampPercent(near ?? percent, share);
}

/** The percent a pointer at `x` means: the divider's centre follows it, between `left` and `right`, the ends of the room the panes share with the divider. */
export function percentAt(x: number, left: number, right: number): number {
  const share = shareOf(right - left);
  return share > 0 ? (x - left - DIVIDER_WIDTH / 2) / share * 100 : DEFAULT_PERCENT;
}

/** What a key does to the divider at `percent`: ← and → move it by `KEY_STEP`, Home and End go to the limits; undefined for any other key. */
export function nudgePercent(key: string, percent: number, share: number): number | undefined {
  const { min, max } = percentLimits(share);
  if (key === 'ArrowLeft') return clampPercent(percent - KEY_STEP, share);
  if (key === 'ArrowRight') return clampPercent(percent + KEY_STEP, share);
  if (key === 'Home') return min;
  if (key === 'End') return max;
  return undefined;
}
