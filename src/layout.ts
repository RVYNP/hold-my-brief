/**
 * How the panes of a window are laid out, free of the DOM so the rules are unit-tested. The panes are a binary tree: a leaf is a pane, a split puts two
 * subtrees side by side (`row`) or one above the other (`column`) with an 8 px divider between them. `ratio` is the first subtree's percent of the room
 * the two share (the split's extent along its axis less the divider). `boxes` turns a tree and a rectangle into pixels; the snapping and the keys that move
 * a divider are here too. Which tabs a pane holds is in `tabs.ts`; `main.ts` owns what a pane shows.
 */

export type Axis = 'row' | 'column';
/** A pane: `pane` is its id, which the page carries as `data-pane`. */
export type Leaf = { pane: string };
export type Split = { axis: Axis; ratio: number; first: Layout; second: Layout };
export type Layout = Leaf | Split;
/** Where a split is in a tree: the turns from the root, `0` for the first subtree and `1` for the second. The root is `[]`. */
export type Path = readonly (0 | 1)[];
export type Rect = { x: number; y: number; width: number; height: number };
export type Direction = 'left' | 'right' | 'up' | 'down';

/** The most panes a window shows. */
export const MAX_PANES = 4;
/** The divider's width (or height, between panes one above the other), in CSS px. */
export const DIVIDER_WIDTH = 8;
/** The narrowest and the shortest a pane may be (a pane's row of tabs is part of its height). */
export const MIN_PANE_WIDTH = 360;
export const MIN_PANE_HEIGHT = 240;
/** What a pane needs to be split along an axis: both halves at their minimum and the divider between them. */
export const SPLIT_WIDTH = 2 * MIN_PANE_WIDTH + DIVIDER_WIDTH;
export const SPLIT_HEIGHT = 2 * MIN_PANE_HEIGHT + DIVIDER_WIDTH;
/** Below this window width a split shows one pane at a time. */
export const MIN_SPLIT_WINDOW = 720;
/** Where a divider settles when it is let go close to them, and how close counts (CSS px). */
export const SNAP_POINTS = [40, 50, 60] as const;
export const SNAP_DISTANCE = 12;
/** What the arrow keys move a divider by, in percent. */
export const KEY_STEP = 2;
export const DEFAULT_PERCENT = 50;
/** The ids a pane may have: one per pane the window can show. */
export const PANE_IDS = ['a', 'b', 'c', 'd'] as const;

export const isSplit = (tree: Layout): tree is Split => 'axis' in tree;

/** The panes in reading order: left before right, top before bottom. */
export function panes(tree: Layout): string[] {
  return isSplit(tree) ? [...panes(tree.first), ...panes(tree.second)] : [tree.pane];
}

/** The first id of `PANE_IDS` that no pane of `tree` has; undefined when all are taken. */
export const freeId = (tree: Layout): string | undefined => PANE_IDS.find(id => !panes(tree).includes(id));

/** The pane that takes `pane`'s room when it goes: its sibling in the tree, or that sibling's first pane in reading order. Undefined when `pane` is not in the tree or is its only pane. */
export function receiver(tree: Layout, pane: string): string | undefined {
  if (!isSplit(tree)) return undefined;
  const { first, second } = tree;
  if (!isSplit(first) && first.pane === pane) return panes(second)[0];
  if (!isSplit(second) && second.pane === pane) return panes(first)[0];
  return receiver(first, pane) ?? receiver(second, pane);
}

/** The split at `path`, or undefined when there is none there. */
export function splitAt(tree: Layout, path: Path): Split | undefined {
  let node: Layout | undefined = tree;
  for (const turn of path) node = node && isSplit(node) ? (turn === 0 ? node.first : node.second) : undefined;
  return node && isSplit(node) ? node : undefined;
}

/** Rebuilds `tree` with `change` applied to the node at `path`. */
function replaceAt(tree: Layout, path: Path, change: (node: Layout) => Layout): Layout {
  if (!path.length) return change(tree);
  if (!isSplit(tree)) return tree;
  const [turn, ...rest] = path;
  return turn === 0 ? { ...tree, first: replaceAt(tree.first, rest, change) } : { ...tree, second: replaceAt(tree.second, rest, change) };
}

/**
 * Splits `pane` in two along `axis`: the new pane `newPane` takes half of its room, before it (left or above) or after it (right or below).
 * Undefined, and nothing changed, at `MAX_PANES`, when `pane` is not in the tree or when `newPane` already is.
 */
export function splitPane(tree: Layout, pane: string, axis: Axis, place: 'before' | 'after', newPane: string): Layout | undefined {
  const all = panes(tree);
  if (all.length >= MAX_PANES || !all.includes(pane) || all.includes(newPane)) return undefined;
  const into = (node: Layout): Layout => {
    if (isSplit(node)) return { ...node, first: into(node.first), second: into(node.second) };
    if (node.pane !== pane) return node;
    const added: Leaf = { pane: newPane };
    return { axis, ratio: DEFAULT_PERCENT, first: place === 'before' ? added : node, second: place === 'before' ? node : added };
  };
  return into(tree);
}

/** Takes `pane` out: its sibling takes the parent's place, and so its room. Undefined, and nothing changed, when `pane` is not in the tree or is its only pane. */
export function removePane(tree: Layout, pane: string): Layout | undefined {
  if (!isSplit(tree) || !panes(tree).includes(pane)) return undefined;
  const without = (node: Layout): Layout => {
    if (!isSplit(node)) return node;
    if (!isSplit(node.first) && node.first.pane === pane) return node.second;
    if (!isSplit(node.second) && node.second.pane === pane) return node.first;
    return { ...node, first: without(node.first), second: without(node.second) };
  };
  return without(tree);
}

/** Gives the panes new ids (`rename` is told each pane's id and returns its new one); the tree's shape and ratios stay. */
export function renamePanes(tree: Layout, rename: (pane: string) => string): Layout {
  return isSplit(tree) ? { ...tree, first: renamePanes(tree.first, rename), second: renamePanes(tree.second, rename) } : { pane: rename(tree.pane) };
}

const percentOf = (percent: number) => Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : DEFAULT_PERCENT;

/** Moves the divider of the split at `path` to `percent` (0–100; kept as given, `boxes` keeps both subtrees at their minimum). A path that is no split changes nothing. */
export function setRatio(tree: Layout, path: Path, percent: number): Layout {
  return splitAt(tree, path) ? replaceAt(tree, path, node => ({ ...node as Split, ratio: percentOf(percent) })) : tree;
}

/** Puts the divider of the split at `path` in the middle. */
export const evenRatio = (tree: Layout, path: Path): Layout => setRatio(tree, path, DEFAULT_PERCENT);

/** The smallest room `tree` can be drawn in. */
export function minSize(tree: Layout): { width: number; height: number } {
  if (!isSplit(tree)) return { width: MIN_PANE_WIDTH, height: MIN_PANE_HEIGHT };
  const first = minSize(tree.first), second = minSize(tree.second);
  return tree.axis === 'row'
    ? { width: first.width + DIVIDER_WIDTH + second.width, height: Math.max(first.height, second.height) }
    : { width: Math.max(first.width, second.width), height: first.height + DIVIDER_WIDTH + second.height };
}

/** Whether every pane of `tree` is at least `MIN_PANE_WIDTH` × `MIN_PANE_HEIGHT` in `rect`. */
export function fits(tree: Layout, rect: Pick<Rect, 'width' | 'height'>): boolean {
  const least = minSize(tree);
  return rect.width >= least.width && rect.height >= least.height;
}

/** Whether a reading area `workspaceWidth` wide, in a window `windowWidth` wide, has room for two panes side by side. */
export function canSplit(workspaceWidth: number, windowWidth: number): boolean {
  return windowWidth >= MIN_SPLIT_WINDOW && workspaceWidth >= SPLIT_WIDTH;
}

/** The room the two subtrees of a split share, given the split's extent along its axis: what is left after the divider. */
export const shareOf = (size: number) => size - DIVIDER_WIDTH;

export type Limits = { min: number; max: number };
/** The smallest and largest percent that keep both subtrees of `split` at their minimum along its axis, in a room `size` long (one too small for that gives 50 for both). */
export function ratioLimits(split: Split, size: number): Limits {
  const share = shareOf(size), extent = split.axis === 'row' ? 'width' : 'height';
  const first = minSize(split.first)[extent], second = minSize(split.second)[extent];
  if (share < first + second) return { min: DEFAULT_PERCENT, max: DEFAULT_PERCENT };
  return { min: first / share * 100, max: 100 - second / share * 100 };
}

const within = (percent: number, { min, max }: Limits) => Math.max(min, Math.min(max, percent));

/** `percent` (the split's own by default) kept within the limits of a room `size` long. */
export const clampRatio = (split: Split, size: number, percent = split.ratio) => within(percent, ratioLimits(split, size));

/** A dragged position: it settles on 40, 50 or 60 % when within `SNAP_DISTANCE` px of it (`share` is the room the subtrees share, in px), and always stays within `limits`. */
export function snapPercent(percent: number, share: number, limits: Limits): number {
  const near = SNAP_POINTS.find(point => Math.abs(percent - point) / 100 * share <= SNAP_DISTANCE);
  return within(near ?? percent, limits);
}

/** The percent a pointer at `position` (x for a row, y for a column) means: the divider's centre follows it, between `start` and `end`, the ends of the room the subtrees share with the divider. */
export function percentAt(position: number, start: number, end: number): number {
  const share = shareOf(end - start);
  return share > 0 ? (position - start - DIVIDER_WIDTH / 2) / share * 100 : DEFAULT_PERCENT;
}

/** What a key does to a divider at `percent`: ← and → (a row) or ↑ and ↓ (a column) move it by `KEY_STEP`, Home and End go to the limits; undefined for any other key. */
export function nudgePercent(key: string, percent: number, limits: Limits, axis: Axis): number | undefined {
  const [back, forward] = axis === 'row' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
  if (key === back) return within(percent - KEY_STEP, limits);
  if (key === forward) return within(percent + KEY_STEP, limits);
  if (key === 'Home') return limits.min;
  if (key === 'End') return limits.max;
  return undefined;
}

export type PaneBox = { pane: string; rect: Rect };
/** A divider: where it is, where the split's room is (the ends `percentAt` wants), the path of the split it belongs to, where it is drawn (`percent`, within `limits`). */
export type DividerBox = { path: Path; axis: Axis; rect: Rect; room: Rect; percent: number; limits: Limits };

/** Where every pane and divider of `tree` is in `rect`, in px, panes in reading order. A ratio a room is too small for is drawn at 50. */
export function boxes(tree: Layout, rect: Rect): { panes: PaneBox[]; dividers: DividerBox[] } {
  const result = { panes: [] as PaneBox[], dividers: [] as DividerBox[] };
  const place = (node: Layout, room: Rect, path: Path) => {
    if (!isSplit(node)) { result.panes.push({ pane: node.pane, rect: room }); return; }
    const row = node.axis === 'row', size = row ? room.width : room.height, limits = ratioLimits(node, size), percent = within(node.ratio, limits);
    const first = shareOf(size) * percent / 100, second = shareOf(size) - first;
    const cut = (offset: number, length: number): Rect => row ? { x: room.x + offset, y: room.y, width: length, height: room.height } : { x: room.x, y: room.y + offset, width: room.width, height: length };
    place(node.first, cut(0, first), [...path, 0]);
    result.dividers.push({ path, axis: node.axis, rect: cut(first, DIVIDER_WIDTH), room, percent, limits });
    place(node.second, cut(first + DIVIDER_WIDTH, second), [...path, 1]);
  };
  place(tree, rect, []);
  return result;
}

/** The pane next to `pane` in `direction`, by the centres of their boxes in `rect`: the nearest one in that direction that shares some of its edge; undefined when there is none. */
export function neighbour(tree: Layout, pane: string, direction: Direction, rect: Rect = { x: 0, y: 0, width: 1440, height: 900 }): string | undefined {
  const all = boxes(tree, rect).panes, from = all.find(entry => entry.pane === pane)?.rect;
  if (!from) return undefined;
  const horizontal = direction === 'left' || direction === 'right', sign = direction === 'left' || direction === 'up' ? -1 : 1;
  const centre = (box: Rect) => horizontal ? [box.x + box.width / 2, box.y + box.height / 2] : [box.y + box.height / 2, box.x + box.width / 2];
  const span = (box: Rect) => horizontal ? [box.y, box.y + box.height] : [box.x, box.x + box.width];
  const [mainFrom, crossFrom] = centre(from), [start, end] = span(from);
  let best: { pane: string; main: number; cross: number } | undefined;
  for (const other of all) {
    if (other.pane === pane) continue;
    const [main, cross] = centre(other.rect), [from2, to2] = span(other.rect);
    const ahead = (main - mainFrom) * sign;
    if (ahead <= 0 || to2 <= start || from2 >= end) continue;
    const distance = { pane: other.pane, main: ahead, cross: Math.abs(cross - crossFrom) };
    if (!best || distance.main < best.main || (distance.main === best.main && distance.cross < best.cross)) best = distance;
  }
  return best?.pane;
}

const record = (value: unknown): Record<string, unknown> => typeof value === 'object' && value !== null ? Object.fromEntries(Object.entries(value)) : {};

/** Reads a saved tree from untrusted storage: undefined unless it is a valid tree of two to `MAX_PANES` panes with distinct ids from `PANE_IDS`. A ratio that is not a number is 50; one out of range is brought into it. */
export function readLayout(value: unknown): Layout | undefined {
  const seen = new Set<string>();
  const read = (entry: unknown, depth: number): Layout | undefined => {
    const raw = record(entry);
    if (typeof raw.pane === 'string') {
      if (!(PANE_IDS as readonly string[]).includes(raw.pane) || seen.has(raw.pane)) return undefined;
      seen.add(raw.pane);
      return { pane: raw.pane };
    }
    if ((raw.axis !== 'row' && raw.axis !== 'column') || depth >= MAX_PANES) return undefined;
    const first = read(raw.first, depth + 1), second = first && read(raw.second, depth + 1);
    if (!first || !second) return undefined;
    return { axis: raw.axis, ratio: typeof raw.ratio === 'number' ? percentOf(raw.ratio) : DEFAULT_PERCENT, first, second };
  };
  const tree = read(value, 0);
  return tree && isSplit(tree) && seen.size <= MAX_PANES ? tree : undefined;
}

/** The narrowest share of a sketch's room either side of a split gets, in percent: a lopsided ratio still draws two cells you can see. */
const SKETCH_LIMIT = 20;

/**
 * A small picture of the layout for the pane map: every pane's cell in `rect`, panes in reading order, with `gap` between cells. It follows each split's own ratio (kept
 * within `SKETCH_LIMIT`..`100 - SKETCH_LIMIT`), unlike `boxes`, which holds every pane to its minimum size and so would draw every split in a room this small at 50.
 */
export function sketch(tree: Layout, rect: Rect, gap: number): PaneBox[] {
  if (!isSplit(tree)) return [{ pane: tree.pane, rect }];
  const row = tree.axis === 'row', share = Math.max(0, (row ? rect.width : rect.height) - gap);
  const first = share * Math.max(SKETCH_LIMIT, Math.min(100 - SKETCH_LIMIT, tree.ratio)) / 100;
  const cut = (offset: number, length: number): Rect => row ? { x: rect.x + offset, y: rect.y, width: length, height: rect.height } : { x: rect.x, y: rect.y + offset, width: rect.width, height: length };
  return [...sketch(tree.first, cut(0, first), gap), ...sketch(tree.second, cut(first + gap, share - first), gap)];
}
