/**
 * The preview that floats over the footer's progress bar: hover or drag it and a card above the pointer shows the page
 * (or spread) under it, with "Page N of M". It is a PDF feature, drawn from the same thumbnails as the page strip and
 * working whether or not the strip is open; for any other document the bar keeps its own tooltip.
 */
import { pagesLabel, spreadPages } from './spread';
import { drawThumbnail } from './page-strip';
import type { PageThumbnails } from './types';

/** What the preview needs to know about the open document; `undefined` when it has no pages to show. */
export type ProgressContext = { source: PageThumbnails; spread: boolean; cover: boolean; total: number };
/** Wait (ms) before an uncached thumbnail is requested, so sweeping across the bar asks only for where the pointer rests. */
const DWELL_MS = 70;
/** The range thumb's travel is inset by its radius at both ends, in CSS px. */
const THUMB_INSET = 6;
const MARGIN = 8;

/** Wires the card to `scrubber`; the card is appended to `container` (the app), which clips and positions it. */
export function createProgressPreview(scrubber: HTMLInputElement, container: HTMLElement, context: () => ProgressContext | undefined) {
  const card = document.createElement('div');
  card.id = 'progress-preview'; card.hidden = true; card.setAttribute('aria-hidden', 'true');
  const pages = document.createElement('div'); pages.className = 'progress-preview-pages';
  const label = document.createElement('div'); label.className = 'progress-preview-label';
  card.append(pages, label); container.append(card);
  const tooltip = scrubber.title;
  let shown = '', request: AbortController | undefined, dwell: ReturnType<typeof setTimeout> | undefined;

  /** The page under the pointer: the bar's value if the pointer were pressed there. */
  function pageAt(clientX: number, total: number) {
    const box = scrubber.getBoundingClientRect(), travel = Math.max(1, box.width - 2 * THUMB_INSET);
    const fraction = Math.max(0, Math.min(1, (clientX - box.left - THUMB_INSET) / travel));
    return Math.max(1, Math.min(total, Math.round(1 + fraction * (total - 1))));
  }
  function hide() {
    shown = ''; clearTimeout(dwell); request?.abort(); request = undefined;
    card.hidden = true; scrubber.title = tooltip;
  }
  /** Centres the card over the pointer, kept inside the window. */
  function follow(clientX: number) {
    const bounds = container.getBoundingClientRect();
    card.style.left = `${Math.max(MARGIN, Math.min(bounds.width - card.offsetWidth - MARGIN, clientX - bounds.left - card.offsetWidth / 2))}px`;
  }
  function show(clientX: number) {
    const now = context();
    if (!now || scrubber.disabled) return hide();
    const number = pageAt(clientX, now.total), group = now.spread ? spreadPages(number, now.total, now.cover) : [number];
    scrubber.removeAttribute('title'); // The card says where the bar goes; a native tooltip over it would say it twice.
    card.hidden = false;
    const key = `${group.join(',')}:${now.total}`;
    if (key !== shown) {
      shown = key; request?.abort(); clearTimeout(dwell);
      label.textContent = pagesLabel(group, now.total);
      pages.replaceChildren(...group.map(page => {
        const canvas = document.createElement('canvas'); canvas.dataset.page = String(page); canvas.setAttribute('aria-hidden', 'true');
        const bitmap = now.source.cached(page);
        if (bitmap) drawThumbnail(canvas, bitmap); else canvas.classList.add('is-blank');
        return canvas;
      }));
      const missing = group.filter(page => !now.source.cached(page));
      if (missing.length) {
        const controller = request = new AbortController();
        dwell = setTimeout(() => {
          for (const page of missing) void now.source.render(page, controller.signal, true).then(bitmap => {
            const canvas = bitmap && !controller.signal.aborted ? pages.querySelector<HTMLCanvasElement>(`canvas[data-page="${page}"]`) : null;
            if (canvas && bitmap) { drawThumbnail(canvas, bitmap); canvas.classList.remove('is-blank'); follow(clientX); }
          });
        }, DWELL_MS);
      }
    }
    follow(clientX);
  }

  scrubber.addEventListener('pointerenter', event => show(event.clientX));
  scrubber.addEventListener('pointermove', event => show(event.clientX));
  // While the thumb is dragged the bar holds the pointer, so the card follows it past the bar's ends and goes when it is let go.
  scrubber.addEventListener('pointerleave', hide);
  scrubber.addEventListener('pointercancel', hide);
  scrubber.addEventListener('blur', hide);
}
