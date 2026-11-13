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

/** The part of a tab that survives a restart: enough to draw it and to reopen it. */
export type SavedTab = { path: string; name: string; format: string };
/** The saved session: the tabs in order, and which one was showing (an index into `tabs`; none means Home). */
export type TabSession = { tabs: SavedTab[]; active: number | null };

export const emptySession = (): TabSession => ({ tabs: [], active: null });

/** Reads a session from untrusted storage: malformed entries and duplicates are dropped and `active` is kept pointing at the same tab. */
export function readSession(value: unknown): TabSession {
  const raw = value as { tabs?: unknown; active?: unknown } | null | undefined;
  if (!raw || !Array.isArray(raw.tabs)) return emptySession();
  const tabs: SavedTab[] = [];
  let active: number | null = null;
  raw.tabs.forEach((entry, index) => {
    const tab = entry as Partial<SavedTab> | null;
    if (!tab || typeof tab.path !== 'string' || !tab.path || tabs.length >= MAX_TABS || tabs.some(kept => kept.path === tab.path)) return;
    if (index === raw.active) active = tabs.length;
    tabs.push({ path: tab.path, name: typeof tab.name === 'string' && tab.name ? tab.name : tab.path.split(/[\\/]/).pop() ?? tab.path, format: typeof tab.format === 'string' ? tab.format : '' });
  });
  return { tabs, active };
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
