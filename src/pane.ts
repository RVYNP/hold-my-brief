import { defaultOptions, type Position, type ReaderAdapter, type ReaderOptions } from './types';
import type { Opened } from './bridge';
import type { Offset, Panner } from './pan';
import { progressOf, type Progress } from './progress';
import type { Placement } from './view-controls-position';
import { holdView, type Anchor, type Hold, type Spot } from './zoom-anchor';

/** What a pane needs from the window around it: where a position is stored, and how a failed save is told to the reader. */
export type PaneEnv = {
  persist: (doc: Opened, locator: Position['locator'], options: ReaderOptions, progress: Progress | undefined) => Promise<void>;
  notify: (message: string, retry?: boolean) => void;
};

/** What a pane takes up when a tab is shown in it. */
export type PaneContent = { reader?: ReaderAdapter; doc?: Opened; options?: ReaderOptions; position?: Position; host?: HTMLElement };

/**
 * One document's reading state: the adapter and the opened source it reads, its options and position, the element it is drawn in,
 * what is saved of it and when, the open that is in flight, the scroller the hand tool moves, and where its view pill sits.
 * The window (tabs, Home, the library, the window state) is not in here. `Target` is whatever the window calls the thing an open is filling.
 */
export class Pane<Target extends object = object> {
  reader: ReaderAdapter | undefined;
  /** The opened source (what `main.ts` called `active`). */
  active: Opened | undefined;
  options: ReaderOptions = { ...defaultOptions };
  position: Position | undefined;
  /** The element the reader is drawn in (what `main.ts` called `activeHost`). */
  host: HTMLElement | undefined;
  /** Counts opens; an open whose token is no longer the current one was given up and must drop its result. */
  request = 0;
  dirty = false;
  saveTimer: ReturnType<typeof setTimeout> | undefined;
  saveQueue: Promise<void> = Promise.resolve();
  /** Undoes the open in flight (its adapter, staging element and object URLs). */
  cancelPending: (() => void) | undefined;
  /** The scroller the hand tool is attached to; a fixed-layout EPUB replaces it when the page layout changes. */
  pannedScroller: HTMLElement | undefined;
  /** The reader the page strip is currently fed from. */
  stripReader: ReaderAdapter | undefined;
  /** What a pending open is filling, while the loading notice is up. */
  loadingTarget: Target | undefined;
  pillPlacement: Placement | null = null;

  constructor(private readonly env: PaneEnv) {}

  /** Takes `content` as what the pane shows; no content is an empty pane with default options. */
  show(content: PaneContent | undefined) {
    this.reader = content?.reader; this.active = content?.doc; this.options = content?.options ?? { ...defaultOptions };
    this.position = content?.position; this.host = content?.host;
  }

  /** Starts an open: any open in flight is given up, and the returned token is the one that may still finish. */
  beginLoad(target?: Target): number {
    const token = ++this.request; this.cancelPending?.();
    this.loadingTarget = target;
    return token;
  }
  /** Whether the open that holds `token` is still the one wanted. */
  isCurrent(token: number) { return token === this.request; }
  /** Ends the open that holds `token`; false (and nothing changed) when a later open or a cancel has taken over. */
  endLoad(token: number): boolean {
    if (token !== this.request) return false;
    this.cancelPending = undefined; this.loadingTarget = undefined;
    return true;
  }
  /** Gives up the open in flight; whatever the pane shows stays as it was. */
  cancelLoad() { ++this.request; this.cancelPending?.(); this.cancelPending = undefined; this.loadingTarget = undefined; }

  markDirty() { this.dirty = true; clearTimeout(this.saveTimer); this.saveTimer = setTimeout(() => void this.flush(), 650); }
  /** Writes the position and options once if they changed since the last write; resolves when everything queued is written. */
  flush(): Promise<void> {
    if (!this.active || !this.position || !this.dirty) return this.saveQueue;
    const doc = this.active, loc = structuredClone(this.position.locator), prefs = { ...this.options }, progress = progressOf(this.position); this.dirty = false;
    this.saveQueue = this.saveQueue.then(() => this.env.persist(doc, loc, prefs, progress)).catch(() => {
      if (this.active?.id === doc.id) this.dirty = true;
      this.env.notify('Progress could not be saved. Reading is still available.', true);
    });
    return this.saveQueue;
  }

  /**
   * Applies option changes to the reader and keeps them if it accepts them. `hold` is what a zoom or fit change holds still (see zoom-anchor.ts);
   * a failure puts the options back and is thrown. `shown` hears the position the reader reports afterwards.
   */
  async changeOptions(next: Partial<ReaderOptions>, hold: Hold | Spot | false, pan: Pick<Panner, 'recenter' | 'slideTo'>, shown: (position: Position) => void) {
    const open = this.reader;
    if (!open) return;
    const zooms = 'zoom' in next || 'fit' in next || 'fitted' in next;
    const host = open.scroller?.();
    // The point is read where the page is drawn, slid or not; only then does a slid page go back, so the redrawn page starts from its natural place.
    const spot = zooms && hold ? typeof hold === 'string' ? holdView(host, hold) : hold : undefined;
    if (zooms) pan.recenter();
    // Fit width wants the line at the top only as far as the page scrolls: a fit may centre, so it never slides the page.
    const held: Anchor | undefined = host && spot && { ...spot, host, ...(hold === 'top' ? {} : { slide: (offset: Offset) => pan.slideTo(offset) }) };
    const previous = this.options; this.options = { ...this.options, ...next };
    try {
      await open.setOptions(this.options, held);
      shown(open.getPosition());
    } catch (error) { this.options = previous; throw error; }
  }
}
