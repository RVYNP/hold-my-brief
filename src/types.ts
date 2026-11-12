import type { DocumentSearch, SearchHit, SearchOptions } from './search';
import { ZOOM_MODEL, type ZoomLimits } from './zoom';

export type ImageFormat = 'png' | 'jpg' | 'jpeg' | 'webp' | 'gif' | 'avif' | 'bmp';
export type Format = 'pdf' | 'epub' | 'md' | 'txt' | ImageFormat;
export type Locator = { kind: Format; [key: string]: unknown };
export type Position = {
  label: string; fraction: number; locator: Locator;
  /** `cover` is present when page values map to two-page spreads with that pairing. */
  scrub: { current: number; total: number; unit: 'page' | 'line' | 'percent'; cover?: boolean };
  /** Two-page view state when it was requested: showing pairs, or single pages until the panel is wide enough. */
  spread?: 'active' | 'waiting';
  /** True while a page on screen has no text layer, so its text cannot be selected or searched. */
  imageOnly?: boolean;
};
export type OutlineItem = { label: string; target: string };
/**
 * `fit` is the fit mode in force while `fitted`, and the one the level returns to otherwise. While not `fitted`, `zoom` is a true
 * scale (1 = actual size, see zoom.ts); while fitted the page follows the window and `zoom` is not used. `zoomModel` says which meaning
 * of `zoom` a saved value carries: options saved before it existed held a multiplier of the fit and are converted on open.
 */
export type ReaderOptions = { fontSize: number; lineHeight: number; margin: number; wrap: boolean; fit: 'page' | 'width'; fitted: boolean; zoom: number; zoomModel: number; rotation: number; spread: boolean; cover: boolean };
export const defaultOptions: ReaderOptions = { fontSize: 18, lineHeight: 1.65, margin: 24, wrap: true, fit: 'page', fitted: true, zoom: 1, zoomModel: ZOOM_MODEL, rotation: 0, spread: false, cover: true };
export type ReaderSource = { name: string; bytes: Uint8Array; format: Format; path?: string };
export type ReaderContext = {
  onPosition: (position: Position) => void;
  onError: (error: unknown) => void;
  openExternal: (url: string) => Promise<void>;
  requestPassword: () => Promise<string | null>;
  resolveImage?: (relative: string) => Promise<string>;
  /** A same-origin content frame finished loading. Pointer input inside it never reaches the host, so the hand tool listens there directly. */
  onFrame?: (doc: Document) => void;
};
/** Page thumbnails for the strip and the progress-bar preview: one bounded cache, rendered one at a time once the page itself is on screen. */
export interface PageThumbnails {
  /** A thumbnail already rendered, 88 CSS px tall, or `undefined`. */
  cached(page: number): HTMLCanvasElement | undefined;
  /**
   * Renders a thumbnail, or finds it in the cache. Aborting `signal` drops the request (and stops the render if it
   * is the one running); a dropped or failed request resolves to `undefined`. `urgent` goes before queued requests.
   */
  render(page: number, signal: AbortSignal, urgent?: boolean): Promise<HTMLCanvasElement | undefined>;
  /** Turns to the page, or the spread that holds it, the way a page turn does. */
  open(page: number): Promise<void>;
}
/** What the strip needs to know about the committed view. */
export type PreviewView = {
  source: PageThumbnails;
  /** Pages in the document. */
  count: number;
  /** The pages on screen: one, or a two-page spread. */
  pages: number[];
  /** Two-page view is showing. */
  spread: boolean;
  /** Whether page 1 stands alone in two-page view. */
  cover: boolean;
  /** Width over height of the current page as it is drawn (rotation included). */
  aspect: number;
  /** Changes when thumbnails drawn so far no longer match (rotation). */
  revision: string;
};
/** Where an adapter reports the committed view: the strip below the reading surface, which lives outside the adapter's host. */
export interface PreviewSink {
  show(view: PreviewView): void;
}
export interface ReaderAdapter {
  readonly mode: 'fixed' | 'paginated' | 'scroll';
  /** True when the adapter honours `ReaderOptions.spread`. */
  readonly spreads?: boolean;
  open(source: ReaderSource, host: HTMLElement, context: ReaderContext, options: ReaderOptions): Promise<void>;
  navigate(action: 'next' | 'previous' | 'screen-next' | 'screen-previous' | 'start' | 'end' | 'back'): Promise<void>;
  goTo(target: string): Promise<void>;
  getPosition(): Position;
  restore(locator: Locator): Promise<void>;
  setOptions(options: ReaderOptions): Promise<void>;
  outline(): OutlineItem[];
  /**
   * Finds `query` in the document's text. Absent when the format cannot expose text at all,
   * such as images, where the find bar explains instead of searching.
   *
   * Adapters extract their own plain text (PDF text layer, EPUB document text, the source
   * string for Markdown/TXT) and report matches in their own units: pages, sections or
   * source lines. The find bar only shows results and asks `revealSearchMatch` to navigate.
   */
  search?(query: string, options?: SearchOptions): Promise<DocumentSearch>;
  /**
   * Shows one match from the most recent `search`: navigates so it is visible and marks it so
   * the reader can see which of several matches on a page they are on.
   */
  revealSearchMatch?(hit: SearchHit): Promise<void>;
  /** Clears the current match marking without changing position. */
  clearSearchHighlights?(): void;
  /**
   * Plain text at the reader's current place, for the assistant: the page or spread on screen
   * (PDF), the current section (EPUB) or source lines from the top of the view (Markdown, TXT).
   * At most `limit` characters. Absent when the format has no text at all (images).
   */
  readText?(limit: number): Promise<{ label: string; text: string }>;
  /**
   * The zoom being drawn now, as the level the interface shows (1 = actual size), also while a fit is in force and the window
   * decides it. Absent when the format does not zoom, or nothing is drawn yet.
   */
  zoomLevel?(): number | undefined;
  /** The zoom range the page on screen can be drawn at, narrower than zoom.ts's for a very large page. */
  zoomLimits?(): ZoomLimits;
  /** What an old saved zoom, a multiplier of the fit, multiplies to give a true scale for the pages now drawn (see `migrateLegacyZoom`). */
  legacyZoomBase?(fit: 'page' | 'width'): number | undefined;
  /** The element that scrolls page-based content, for the view controls and hand tool; absent when content reflows instead of zooming. */
  scroller?(): HTMLElement | undefined;
  /**
   * Reports the committed view to `sink` after every page turn until it is replaced or `undefined` is
   * passed. Absent when the format has no pages to preview (only PDF has).
   */
  setPreviews?(sink: PreviewSink | undefined): void;
  /** Thumbnails of any page, for the strip and the progress-bar preview; present with `setPreviews`. */
  readonly thumbnails?: PageThumbnails;
  destroy(): void;
}
