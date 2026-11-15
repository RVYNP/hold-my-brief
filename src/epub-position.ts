/**
 * The words of a reflowable EPUB's footer: which chapter, which page, how far through, how long is left.
 * Pure: the adapter hands in what Foliate reported and these functions only decide how it reads.
 */

/** Characters per line the text column aims at. */
export const MEASURE_CHARS = 66;
/** Average advance of a character in running prose (spaces included), as a fraction of the font size: about 0.4 to 0.45 em in serif faces. */
const CHAR_EM = 0.42;
/** Words a minute when the reader's own speed is not known. */
export const DEFAULT_WPM = 250;

const ROMAN = /^m{0,3}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/i;
const VALUES: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
const squash = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/** A roman or decimal chapter number as an integer, or undefined if it is neither. */
export function chapterNumber(token: string): number | undefined {
  if (/^\d+$/.test(token)) return Number(token) || undefined;
  if (!token || !ROMAN.test(token)) return undefined;
  let total = 0;
  const digits = [...token.toLowerCase()].map(letter => VALUES[letter]);
  digits.forEach((value, i) => { total += value < (digits[i + 1] ?? 0) ? -value : value; });
  return total || undefined;
}

/** The chapter number a contents entry names with a "CHAPTER <roman or number>" token (any case), if it does. */
export function labelChapterNumber(label: string): number | undefined {
  const match = /\bchapter\s+([ivxlcdm]+|\d+)\b/i.exec(label);
  return match ? chapterNumber(match[1]) : undefined;
}

/**
 * A contents entry as a chapter name. Whitespace collapses; a label holding "CHAPTER II" (any case) is that chapter and
 * nothing else ("I hope Mr. Bingley will like it. CHAPTER II." is "Chapter 2"); any other label loses a trailing period.
 * A label that is only the book's own title is the title page, not a chapter, and gives undefined.
 */
export function cleanChapterLabel(label: string | null | undefined, bookTitle?: string): string | undefined {
  const text = (label ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return undefined;
  const number = labelChapterNumber(text);
  if (number) return `Chapter ${number}`;
  const clean = text.replace(/\.+$/, '').trim();
  if (!clean) return undefined;
  if (bookTitle && squash(clean) === squash(bookTitle)) return undefined;
  return clean;
}

/** A contents entry as the chapter functions see it: its label and the nearest ancestor entry that resolved to a section. */
export type ChapterNode<T> = { label: string; parent?: T };

/**
 * Which contents entries are the book's numbered chapters, in the order given. When any entry names a chapter, only those count
 * (a preface or a part title is not "Chapter 1"); a book that never says "chapter" counts every entry that is not its title page
 * and is not nested under another counted entry (a subsection belongs to the chapter above it).
 */
export function numberedChapters<T extends ChapterNode<T>>(entries: readonly T[], bookTitle?: string): T[] {
  const kept = entries.filter(entry => cleanChapterLabel(entry.label, bookTitle));
  const named = kept.filter(entry => labelChapterNumber(entry.label));
  if (named.length) return named;
  const keptSet = new Set(kept);
  const nested = (entry: T) => { for (let up = entry.parent; up; up = up.parent) if (keptSet.has(up)) return true; return false; };
  return kept.filter(entry => !nested(entry));
}

/**
 * The chapter each contents entry belongs to: its own number, or that of its nearest ancestor that is a numbered chapter.
 * Entries with neither (the title page, a preface, a part title) are absent.
 */
export function chapterMap<T extends ChapterNode<T>>(entries: readonly T[], bookTitle?: string): Map<T, { n: number; total: number }> {
  const chapters = numberedChapters(entries, bookTitle), total = chapters.length;
  const numbered = new Map(chapters.map((entry, i) => [entry, { n: i + 1, total }]));
  const map = new Map<T, { n: number; total: number }>();
  for (const entry of entries) {
    for (let at: T | undefined = entry; at; at = at.parent) {
      const found = numbered.get(at);
      if (found) { map.set(entry, found); break; }
    }
  }
  return map;
}

/** `Chapter 3 of 61`. */
export const chapterLabel = (n: number, total: number) => `Chapter ${n} of ${total}`;

/** A fraction as a percentage that still moves on the first page turns: always one decimal, never rounded up to 100 early. */
export function formatPercent(fraction: number): string {
  const percent = Math.max(0, Math.min(100, (Number.isFinite(fraction) ? fraction : 0) * 100));
  return `${percent >= 99.95 && percent < 100 ? '99.9' : percent.toFixed(1)}%`;
}

export type PageInfo = { page: string; pages: string; estimated: boolean };
/** `p. 34 of 412`, or `p. ~34 of ~412` when the count is an estimate. */
export const formatPage = ({ page, pages, estimated }: PageInfo) => estimated ? `p. ~${page} of ~${pages}` : `p. ${page} of ${pages}`;

/** The page of a Foliate location (a fixed span of the book's text): its number from 1 and how many there are. */
export function estimatedPage(location: { current: number; total: number } | undefined): PageInfo | undefined {
  if (!location || !Number.isFinite(location.current) || !Number.isFinite(location.total) || location.total < 1) return undefined;
  const pages = Math.max(1, Math.round(location.total));
  return { page: String(Math.max(1, Math.min(pages, Math.floor(location.current) + 1))), pages: String(pages), estimated: true };
}

/** `12 min left in chapter`, or `<1 min left in chapter` for the last half minute or so. */
export function formatTimeLeft(words: number, wpm: number = DEFAULT_WPM): string | undefined {
  if (!Number.isFinite(words) || !(wpm > 0)) return undefined;
  const minutes = Math.round(Math.max(0, words) / wpm);
  return minutes < 1 ? '<1 min left in chapter' : `${minutes} min left in chapter`;
}

export type FooterParts = { chapter?: { n: number; total: number }; page?: PageInfo; fraction: number; words?: number; wpm?: number };
/** `Chapter 3 of 61 · p. ~34 of ~412 · 8.3% · 12 min left in chapter`; a part the book cannot tell is left out. */
export function footerLabel({ chapter, page, fraction, words, wpm }: FooterParts): string {
  return [chapter && chapterLabel(chapter.n, chapter.total), page && formatPage(page), formatPercent(fraction), words === undefined ? undefined : formatTimeLeft(words, wpm)].filter(Boolean).join(' · ');
}

/**
 * The `max-inline-size` that gives a text column of about 66 characters at `fontSize`. Foliate sets columns `size - gap` wide,
 * where `gap` is `g / (1 - g)` of the size for the `g` the `gap` attribute names, so the text is size × (1 - 2g) / (1 - g).
 */
export function readingMeasure(fontSize: number, g: number): number {
  const share = Math.max(0, Math.min(.3, Number.isFinite(g) ? g : 0));
  return Math.round(MEASURE_CHARS * Math.max(8, fontSize) * CHAR_EM * (1 - share) / (1 - 2 * share));
}
