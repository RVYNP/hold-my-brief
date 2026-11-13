// How far into a document the reader is, in the one shape the saved position, the library and Home share.
// `page`/`pages` are present for fixed-layout documents (PDF, fixed-layout EPUB); reflowable ones (EPUB text, Markdown, text) have only the fraction.
import type { Position } from './types';

export type Progress = { fraction: number; page?: number; pages?: number };

/**
 * What to save beside a position, or nothing when it says nothing about progress (a single image, a position that is not a number).
 * In two-page view the position is the first page of the pair, and a page turn leaves the fraction short of 1 (it counts the pair's
 * first page only), so showing the last pair is the end of the document: its fraction is saved as 1.
 */
export function progressOf(position: Pick<Position, 'fraction' | 'scrub' | 'spread'>): Progress | undefined {
  const { scrub, fraction } = position;
  if (!Number.isFinite(fraction)) return undefined;
  const clamped = Math.min(1, Math.max(0, fraction));
  if (scrub.unit === 'page') {
    if (scrub.total <= 1) return undefined;
    const lastSpread = position.spread === 'active' && scrub.current + 1 >= scrub.total;
    return { fraction: lastSpread ? 1 : clamped, page: scrub.current, pages: scrub.total };
  }
  return { fraction: clamped };
}

/**
 * A paged document is "finished" on its last page, or at its very end (fraction 1: an explicit jump to the end, or the last pair of
 * a two-page view, see `progressOf`). Reflowable text is finished once the rounded percentage reaches 100.
 */
export function isFinished(progress: Progress): boolean {
  return progress.page !== undefined && progress.pages !== undefined ? progress.page >= progress.pages || progress.fraction >= .999 : progress.fraction >= .995;
}

/**
 * The words for a list row: `p. 12 / 96`, `38 %`, or `Finished`. Nothing for a document never opened (no progress) and for a
 * reflowable one still at its start, where there is no percentage worth saying.
 */
export function formatProgress(progress: Progress | undefined): string | undefined {
  if (!progress || !Number.isFinite(progress.fraction)) return undefined;
  if (isFinished(progress)) return 'Finished';
  if (progress.page !== undefined && progress.pages !== undefined) return `p. ${progress.page} / ${progress.pages}`;
  const percent = Math.round(progress.fraction * 100);
  return percent > 0 ? `${percent} %` : undefined;
}

/** Past the start and short of Finished: what "Continue reading" lists, and the library's scope of the same name. */
export function inProgress(progress: Progress | undefined): progress is Progress {
  return Boolean(progress) && Number.isFinite(progress!.fraction) && progress!.fraction > 0 && formatProgress(progress) !== undefined && !isFinished(progress!);
}
