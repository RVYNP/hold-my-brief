/**
 * The tab model: which documents are open as tabs, in what order, which tab is showing, and which tabs may keep a live
 * reader. Pure data and decisions, no DOM and no adapters, so the rules are unit-tested; `main.ts` owns what a tab
 * actually holds (adapter, host, view state) and carries out what this module decides.
 *
 * A tab's identity is its document's `path` (the library path in the browser build, the canonical file path on the desktop):
 * a document is open at most once, so opening one that is already open focuses its tab.
 */

/** At most this many tabs keep a live adapter and host; the least recently shown ones hibernate. */
export const MAX_LIVE_TABS = 3;
/** Upper bound on tabs, so the saved session and the strip stay sane. */
export const MAX_TABS = 64;

/** What the model needs to know about a tab; the owner adds whatever else a tab carries. */
export type TabBase = { path: string };

/** The Library tab's identity: no document has this path, so it can sit in the tab list beside documents and be saved with them. */
export const LIBRARY_PATH = 'hold-my-brief:library';

/** The part of a tab that survives a restart: enough to draw it and to reopen its document. The Library tab (format `library`) also saves its `scope`. */
export type SavedTab = { path: string; name: string; format: string; scope?: string };
/** One pane of a saved split: the documents it holds, in order (by `path`), and the one it shows. */
export type SavedPane = { tabs: string[]; shown: string };
/** A saved split: what each pane holds and shows, the divider's place (the left pane's percent of the room the panes share) and the pane that was active. */
export type SavedSplit = { left: SavedPane; right: SavedPane; ratio: number; active: 'left' | 'right' };
/**
 * The saved session: the tabs in order, and which one was showing (an index into `tabs`; none means Home). While split, `tabs` is the Library tab (if open),
 * the left pane's tabs, then the right pane's, so a build that does not know `split` still restores every document, in one strip; `active` is then the tab
 * the active pane shows, or the Library tab or none (Home) while one of them covers the panes.
 */
export type TabSession = { tabs: SavedTab[]; active: number | null; split?: SavedSplit };

export const emptySession = (): TabSession => ({ tabs: [], active: null });

const record = (value: unknown): Record<string, unknown> => typeof value === 'object' && value !== null ? Object.fromEntries(Object.entries(value)) : {};

/**
 * Reads a saved split against the tabs that were kept: each pane keeps the documents it names that are open (once, in the order named), a document no pane
 * names joins the left one, and a pane shows the tab it names or else its first. A split that leaves a pane with no document is no split; a ratio or an
 * active pane that is not valid takes its default.
 */
function readSplit(value: unknown, tabs: readonly SavedTab[]): SavedSplit | undefined {
  const raw = record(value);
  const documents = tabs.filter(tab => tab.path !== LIBRARY_PATH).map(tab => tab.path), taken = new Set<string>();
  const pane = (entry: unknown) => {
    const named = record(entry), paths: string[] = [];
    if (Array.isArray(named.tabs)) for (const path of named.tabs) if (typeof path === 'string' && documents.includes(path) && !taken.has(path)) { taken.add(path); paths.push(path); }
    return { paths, shown: named.shown };
  };
  const right = pane(raw.right), left = pane(raw.left);
  left.paths.push(...documents.filter(path => !taken.has(path)));
  if (!left.paths.length || !right.paths.length) return undefined;
  const shownOf = (side: { paths: string[]; shown: unknown }) => typeof side.shown === 'string' && side.paths.includes(side.shown) ? side.shown : side.paths[0];
  const ratio = typeof raw.ratio === 'number' && Number.isFinite(raw.ratio) ? Math.max(0, Math.min(100, raw.ratio)) : 50;
  return { left: { tabs: left.paths, shown: shownOf(left) }, right: { tabs: right.paths, shown: shownOf(right) }, ratio, active: raw.active === 'right' ? 'right' : 'left' };
}

/** Reads a session from untrusted storage: malformed entries and duplicates are dropped and `active` is kept pointing at the same tab; a saved split is kept when it still holds a document on each side. */
export function readSession(value: unknown): TabSession {
  const raw = value as { tabs?: unknown; active?: unknown; split?: unknown } | null | undefined;
  if (!raw || !Array.isArray(raw.tabs)) return emptySession();
  const tabs: SavedTab[] = [];
  let active: number | null = null;
  raw.tabs.forEach((entry, index) => {
    const tab = entry as Partial<SavedTab> | null;
    if (!tab || typeof tab.path !== 'string' || !tab.path || tabs.length >= MAX_TABS || tabs.some(kept => kept.path === tab.path)) return;
    if (index === raw.active) active = tabs.length;
    tabs.push({ path: tab.path, name: typeof tab.name === 'string' && tab.name ? tab.name : tab.path.split(/[\\/]/).pop() ?? tab.path, format: typeof tab.format === 'string' ? tab.format : '', ...(typeof tab.scope === 'string' && tab.scope ? { scope: tab.scope } : {}) });
  });
  const split = readSplit(raw.split, tabs);
  return { tabs, active, ...(split ? { split } : {}) };
}

export class TabList<T extends TabBase> {
  private items: T[] = [];
  private showing: string | undefined;
  private live = new Set<string>();
  private used = new Map<string, number>();
  private clock = 0;

  get tabs(): readonly T[] { return this.items; }
  get size() { return this.items.length; }
  /** The tab showing, or undefined when Home is. */
  get active(): T | undefined { return this.items.find(tab => tab.path === this.showing); }
  get activeIndex() { return this.items.findIndex(tab => tab.path === this.showing); }

  find(path: string): T | undefined { return this.items.find(tab => tab.path === path); }
  indexOf(path: string) { return this.items.findIndex(tab => tab.path === path); }

  /** Shows Home (`undefined`) or a tab, and counts it as just used. */
  activate(path: string | undefined) {
    if (path !== undefined && !this.find(path)) return;
    this.showing = path;
    if (path !== undefined) this.used.set(path, ++this.clock);
  }

  /**
   * Opens `tab` at `at` (the end by default) and shows it, or, when its document is already open, only shows the existing
   * tab (which keeps its place). Returns the tab that is now showing and whether it is new.
   */
  open(tab: T, at?: number): { tab: T; created: boolean } {
    const existing = this.find(tab.path);
    if (existing) { this.activate(existing.path); return { tab: existing, created: false }; }
    const index = at === undefined ? this.items.length : Math.max(0, Math.min(this.items.length, at));
    this.items.splice(index, 0, tab);
    this.activate(tab.path);
    return { tab, created: true };
  }

  /** Adds `tab` at `at` (the end by default) without showing it: a document opened in the background. False when it is already open (nothing changes). */
  add(tab: T, at?: number): boolean {
    if (this.find(tab.path)) return false;
    this.items.splice(at === undefined ? this.items.length : Math.max(0, Math.min(this.items.length, at)), 0, tab);
    return true;
  }

  /**
   * Closes a tab. Closing the showing tab shows its right neighbour, or its left one when it was last, or Home when none is left;
   * closing any other tab changes nothing about what is showing. Returns the tab now showing.
   */
  close(path: string): T | undefined {
    const index = this.indexOf(path);
    if (index < 0) return this.active;
    const wasShowing = this.showing === path;
    this.items.splice(index, 1); this.live.delete(path); this.used.delete(path);
    if (wasShowing) this.activate((this.items[index] ?? this.items[index - 1])?.path);
    return this.active;
  }

  /**
   * Takes a tab out without closing its document: the tab itself is returned (so another list can adopt it) with whether it held a live reader.
   * What the list shows follows the way closing does, and nothing is shown once the list is empty.
   */
  detach(path: string): { tab: T; live: boolean } | undefined {
    const index = this.indexOf(path);
    if (index < 0) return undefined;
    const [tab] = this.items.splice(index, 1), live = this.live.delete(path);
    this.used.delete(path);
    if (this.showing === path) this.showing = (this.items[index] ?? this.items[index - 1])?.path; // The neighbour is not counted as used: only a tab that was shown is.
    return { tab, live };
  }

  /** The tab shown most recently, leaving out `path`; undefined when none of the others was ever shown. */
  mostRecent(path?: string): T | undefined {
    let best: T | undefined, at = 0;
    for (const tab of this.items) { const when = tab.path === path ? 0 : this.used.get(tab.path) ?? 0; if (when > at) { at = when; best = tab; } }
    return best;
  }

  /**
   * Puts `tab` where the tab at `path` is, showing it if that one was showing, and drops the old one: the same slot with another
   * document in it. Nothing changes when `path` is not open, or when `tab`'s document is already open in another tab.
   */
  replace(path: string, tab: T): boolean {
    const index = this.indexOf(path);
    if (index < 0 || (tab.path !== path && this.find(tab.path))) return false;
    const wasShowing = this.showing === path;
    this.items[index] = tab;
    this.live.delete(path); this.used.delete(path);
    if (wasShowing) this.activate(tab.path);
    return true;
  }

  /** Moves a tab so that it ends at index `to` of the list. */
  move(path: string, to: number) {
    const from = this.indexOf(path);
    if (from < 0) return;
    const [tab] = this.items.splice(from, 1);
    this.items.splice(Math.max(0, Math.min(this.items.length, to)), 0, tab);
  }

  /** The tab `step` places from the showing one, wrapping; from Home, forward goes to the first tab and backward to the last. */
  neighbour(step: 1 | -1): T | undefined {
    if (!this.items.length) return undefined;
    const at = this.activeIndex;
    if (at < 0) return step > 0 ? this.items[0] : this.items[this.items.length - 1];
    return this.items[(at + step + this.items.length) % this.items.length];
  }

  /** Ctrl+1…8 select that tab and Ctrl+9 the last one, as browsers do; a number past the end selects nothing. */
  byNumber(digit: number): T | undefined {
    return digit === 9 ? this.items[this.items.length - 1] : this.items[digit - 1];
  }

  isLive(path: string) { return this.live.has(path); }
  get liveCount() { return this.live.size; }
  markLive(path: string) { if (this.find(path)) this.live.add(path); }
  markHibernated(path: string) { this.live.delete(path); }

  /**
   * The live tabs that must hibernate so that at most `limit` stay live, least recently shown first. The showing tab is never
   * one of them, however long ago it was used, so a limit of 0 still keeps it.
   */
  hibernation(limit = MAX_LIVE_TABS): string[] {
    const ordered = [...this.live].sort((a, b) => (this.used.get(b) ?? 0) - (this.used.get(a) ?? 0));
    const keep = new Set(ordered.filter(path => path === this.showing));
    for (const path of ordered) if (keep.size < Math.max(limit, 1)) keep.add(path);
    return ordered.filter(path => !keep.has(path)).reverse();
  }

  /** The tabs as they are saved, with `describe` giving each one's name and format. */
  session(describe: (tab: T) => SavedTab): TabSession {
    const at = this.activeIndex;
    return { tabs: this.items.map(describe), active: at < 0 ? null : at };
  }
}

/**
 * Where a dragged tab lands: `centres` are the horizontal centres of the other tabs (the dragged one left out), in order, and
 * `x` is the pointer. The tab goes after every tab whose centre the pointer has passed.
 */
export function slotAt(centres: readonly number[], x: number): number {
  let slot = 0;
  for (const centre of centres) if (x > centre) slot++;
  return slot;
}

/**
 * Split right: the tab at `path` leaves `list` for a new list of its own, which shows it. Every other tab stays, and `list` shows the one of them
 * that was shown most recently (the neighbour the closing rule picks when none was; the first tab when Home was showing and none ever was). Undefined,
 * and nothing changed, when `path` is not in `list`.
 */
export function splitOff<T extends TabBase>(list: TabList<T>, path: string): TabList<T> | undefined {
  const taken = list.detach(path);
  if (!taken) return undefined;
  const recent = list.mostRecent();
  if (recent) list.activate(recent.path); else if (!list.active && list.size) list.activate(list.tabs[0].path);
  const right = new TabList<T>();
  right.add(taken.tab); if (taken.live) right.markLive(path);
  right.activate(path);
  return right;
}

/**
 * Split left: every tab but the one at `path` leaves `list` for a new list of its own, and `list` keeps that tab, shown. The new list shows the tab `list`
 * was showing if it left, else the one shown most recently, else its first. Undefined, and nothing changed, when `path` is not in `list` or is its only tab.
 */
export function splitOffRest<T extends TabBase>(list: TabList<T>, path: string): TabList<T> | undefined {
  if (!list.find(path) || list.size < 2) return undefined;
  const showing = list.active?.path, recent = list.mostRecent(path)?.path;
  const rest = new TabList<T>();
  for (const tab of [...list.tabs]) {
    if (tab.path === path) continue;
    const taken = list.detach(tab.path)!;
    rest.add(taken.tab); if (taken.live) rest.markLive(tab.path);
  }
  rest.activate(showing !== path && showing && rest.find(showing) ? showing : recent && rest.find(recent) ? recent : rest.tabs[0].path);
  list.activate(path);
  return rest;
}

/** Moves the tab at `path` from one list to another, at `at` (the end by default), and shows it there; the list it left shows the tab it would show after closing it. */
export function moveAcross<T extends TabBase>(from: TabList<T>, to: TabList<T>, path: string, at?: number): boolean {
  if (to.find(path)) return false;
  const taken = from.detach(path);
  if (!taken) return false;
  to.add(taken.tab, at); if (taken.live) to.markLive(path);
  to.activate(path);
  return true;
}

/** Ends a split: every tab of `right` follows those of `left`, in order, and `showing` (a path of either) is the one shown. Returns `left`. */
export function mergeLists<T extends TabBase>(left: TabList<T>, right: TabList<T>, showing: string | undefined): TabList<T> {
  for (const tab of [...right.tabs]) {
    const live = right.isLive(tab.path);
    right.detach(tab.path);
    left.add(tab); if (live) left.markLive(tab.path);
  }
  left.activate(showing);
  return left;
}

/**
 * Starts a saved split from `list`, which holds every document tab: the tabs `split.right` names leave for a new list, in the order saved, and each list
 * shows the tab saved for it. Undefined, and nothing changed, when that would leave a side with no tab (a split that no longer holds a document on each side).
 */
export function restoreSplit<T extends TabBase>(list: TabList<T>, split: SavedSplit): TabList<T> | undefined {
  const named = split.right.tabs.filter(path => list.find(path));
  if (!named.length || named.length >= list.size) return undefined;
  const right = new TabList<T>();
  for (const path of named) right.add(list.detach(path)!.tab);
  const shown = (side: SavedPane, tabs: TabList<T>) => tabs.find(side.shown) ? side.shown : tabs.tabs[0].path;
  list.activate(shown(split.left, list)); right.activate(shown(split.right, right));
  return right;
}
