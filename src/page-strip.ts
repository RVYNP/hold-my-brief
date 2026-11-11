/**
 * Page previews: the strip of upcoming pages under a PDF.
 *
 * The PDF adapter decides what comes next and draws it; the strip lives outside the adapter's scroll
 * container (a sibling of the reading surface), so showing it, or turning a page, never changes the size
 * the page was fitted to. Everything here is the part with no PDF in it: which pages come next, the bitmap
 * cache and the strip's DOM.
 */
import { spreadPages } from './spread';
import type { PagePreview, PreviewSink } from './types';

/** Pages listed in single-page view, and spreads in two-page view. */
export const PREVIEW_PAGES = 3;
export const PREVIEW_SPREADS = 2;
/** Thumbnail height in CSS px. The strip's own height (`--page-strip-height`) adds its padding and the footer's hover band. */
export const THUMBNAIL_HEIGHT = 88;
/** Bitmaps kept for thumbnails, a tenth of the page cache: a thumbnail is ~100 KB, so this holds dozens. */
export const PREVIEW_CACHE_BYTES = 4 * 1024 * 1024;
/**
 * Reading-panel height (CSS px) below which the strip stays hidden. It is measured on the panel, which the strip
 * never resizes (the page area loses its height to the strip, the panel does not), so showing it cannot hide it again.
 */
export const MIN_PANEL_HEIGHT = 360;

/**
 * The pages that follow `shown`, grouped as the buttons they become: single pages, or whole spreads in
 * two-page view (paired as `spreadPages` pairs them, so the cover rule holds). Fewer groups, or none,
 * near the end of the document.
 */
export function nextPages(shown: readonly number[], count: number, spread: boolean, cover: boolean): number[][] {
  const total = Math.max(0, Math.trunc(count) || 0), groups: number[][] = [];
  let next = (shown.at(-1) ?? 0) + 1;
  while (next <= total && groups.length < (spread ? PREVIEW_SPREADS : PREVIEW_PAGES)) {
    const group = spread ? spreadPages(next, total, cover) : [next];
    groups.push(group); next = group.at(-1)! + 1;
  }
  return groups;
}

/** Decoded bitmaps kept under a byte budget; the least recently used go first, and a hit counts as a use. */
export class BitmapCache<T extends { width: number; height: number }> {
  private readonly entries = new Map<string, T>();
  private total = 0;
  constructor(private readonly limit: number) {}
  private static cost(bitmap: { width: number; height: number }) { return bitmap.width * bitmap.height * 4; }
  get bytes() { return this.total; }
  get(key: string): T | undefined {
    const hit = this.entries.get(key);
    if (hit) { this.entries.delete(key); this.entries.set(key, hit); }
    return hit;
  }
  set(key: string, bitmap: T) {
    this.delete(key);
    const cost = BitmapCache.cost(bitmap);
    if (cost > this.limit) return;
    for (const oldest of this.entries.keys()) { if (this.total + cost <= this.limit) break; this.delete(oldest); }
    this.entries.set(key, bitmap); this.total += cost;
  }
  private delete(key: string) {
    const old = this.entries.get(key);
    if (old && this.entries.delete(key)) this.total -= BitmapCache.cost(old);
  }
  clear() { this.entries.clear(); this.total = 0; }
}

export type PageStrip = {
  /** The `<nav>`, to be placed in the reading panel beside the reading surface. */
  element: HTMLElement;
  /** What an adapter reports to. */
  sink: PreviewSink;
  /** Empties the strip, for a document that is gone. */
  clear: () => void;
};

/** Builds the strip. `onError` receives a failed page turn. */
export function createPageStrip(onError: (error: unknown) => void): PageStrip {
  const element = document.createElement('nav');
  element.id = 'page-strip'; element.hidden = true; element.setAttribute('aria-label', 'Next pages');
  const end = document.createElement('p');
  end.className = 'page-strip-end'; end.textContent = 'End of document'; end.hidden = true;
  element.append(end);
  let listed: PagePreview[] = [];
  const buttons = () => Array.from(element.querySelectorAll<HTMLButtonElement>('button'));

  /** Scales every thumbnail by the same factor when the panel is too narrow for them at full size, so none is clipped or distorted. */
  function fit() {
    const style = getComputedStyle(element);
    const room = element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    if (!(room > 0) || !listed.length) return;
    const gap = parseFloat(style.columnGap) || 0;
    const natural = listed.reduce((sum, preview) => sum + preview.pages.reduce((width, page) => width + page.width, 0), 0) + gap * (listed.length - 1);
    const scale = Math.min(1, room / natural);
    buttons().forEach((button, index) => button.querySelectorAll('canvas').forEach((canvas, part) => {
      const page = listed[index]?.pages[part];
      if (!page) return;
      canvas.style.width = `${page.width * scale}px`; canvas.style.height = `${page.height * scale}px`;
    }));
  }
  let width = 0;
  new ResizeObserver(() => { if (element.clientWidth !== width) { width = element.clientWidth; fit(); } }).observe(element);

  const sink: PreviewSink = {
    show(previews) {
      listed = previews;
      const existing = buttons();
      // Buttons are reused by position, so a thumbnail focused with Tab stays focused while page keys turn the pages.
      previews.forEach((preview, index) => {
        let button = existing[index];
        if (!button) { button = document.createElement('button'); button.type = 'button'; button.className = 'page-strip-item'; element.insertBefore(button, end); }
        const pages = document.createElement('span'); pages.className = 'page-strip-pages';
        for (const page of preview.pages) {
          const canvas = document.createElement('canvas'); canvas.dataset.page = String(page.number); canvas.setAttribute('aria-hidden', 'true');
          pages.append(canvas);
        }
        const label = document.createElement('span'); label.className = 'page-strip-label'; label.textContent = preview.label;
        button.replaceChildren(pages, label);
        button.setAttribute('aria-label', `Go to page ${preview.label}`);
        button.onclick = () => { void preview.open().catch(onError); };
      });
      existing.slice(previews.length).forEach(button => button.remove());
      end.hidden = previews.length > 0;
      fit();
    },
    paint(page, bitmap) {
      const canvas = element.querySelector<HTMLCanvasElement>(`canvas[data-page="${page}"]`);
      if (!canvas) return;
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
    },
  };
  return { element, sink, clear() { listed = []; buttons().forEach(button => button.remove()); end.hidden = true; } };
}
