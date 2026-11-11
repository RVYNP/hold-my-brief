import type { DocumentSearch, SearchHit, SearchOptions } from './search';

export type ImageFormat = 'png' | 'jpg' | 'jpeg' | 'webp' | 'gif' | 'avif' | 'bmp';
export type Format = 'pdf' | 'epub' | 'md' | 'txt' | ImageFormat;
export type Locator = { kind: Format; [key: string]: unknown };
export type Position = {
  label: string; fraction: number; locator: Locator;
  /** `cover` is present when page values map to two-page spreads with that pairing. */
  scrub: { current: number; total: number; unit: 'page' | 'line' | 'percent'; cover?: boolean };
  /** Two-page view state when it was requested: showing pairs, or single pages until the panel is wide enough. */
  spread?: 'active' | 'waiting';
  /**
   * True when the document has no usable text layer at all, so text cannot be selected or
   * searched anywhere in it. A property of the whole document, not of the page on screen:
   * it is what lets the reader say so once instead of annotating every page.
   */
  imageOnly?: boolean;
};
export type OutlineItem = { label: string; target: string };
export type ReaderOptions = { fontSize: number; lineHeight: number; margin: number; wrap: boolean; fit: 'page' | 'width'; zoom: number; rotation: number; spread: boolean; cover: boolean };
export const defaultOptions: ReaderOptions = { fontSize: 18, lineHeight: 1.65, margin: 24, wrap: true, fit: 'page', zoom: 1, rotation: 0, spread: false, cover: true };
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
  /** The element that scrolls page-based content, for the view controls and hand tool; absent when content reflows instead of zooming. */
  scroller?(): HTMLElement | undefined;
  destroy(): void;
}
