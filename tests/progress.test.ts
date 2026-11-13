import { describe, expect, it } from 'vitest';
import { formatProgress, isFinished, progressOf } from '../src/progress';
import { homeRows } from '../src/home';
import { railItems } from '../src/library-rail';

describe('formatProgress', () => {
  it('names the page and the total for a fixed-layout document', () => {
    expect(formatProgress({ fraction: 11 / 96, page: 12, pages: 96 })).toBe('p. 12 / 96');
    expect(formatProgress({ fraction: 0, page: 1, pages: 96 })).toBe('p. 1 / 96');
  });

  it('gives a percentage for a reflowable document, rounded', () => {
    expect(formatProgress({ fraction: .384 })).toBe('38 %');
    expect(formatProgress({ fraction: .386 })).toBe('39 %');
    expect(formatProgress({ fraction: .994 })).toBe('99 %');
  });

  it('says Finished at the last page or the end of the text', () => {
    expect(formatProgress({ fraction: 1, page: 96, pages: 96 })).toBe('Finished');
    expect(formatProgress({ fraction: .95, page: 96, pages: 96 })).toBe('Finished');
    // Two-page view saves the first page of the final spread; the end of the document is then told by the fraction.
    expect(formatProgress({ fraction: 1, page: 95, pages: 96 })).toBe('Finished');
    expect(formatProgress({ fraction: 94 / 96, page: 95, pages: 96 })).toBe('p. 95 / 96');
    expect(formatProgress({ fraction: .995 })).toBe('Finished');
    expect(formatProgress({ fraction: 1 })).toBe('Finished');
    expect(isFinished({ fraction: .5, page: 48, pages: 96 })).toBe(false);
  });

  it('says nothing for a document never opened, or a reflowable one still at its start', () => {
    expect(formatProgress(undefined)).toBeUndefined();
    expect(formatProgress({ fraction: 0 })).toBeUndefined();
    expect(formatProgress({ fraction: .004 })).toBeUndefined();
    expect(formatProgress({ fraction: Number.NaN })).toBeUndefined();
  });
});

describe('progressOf', () => {
  const scrub = (unit: 'page' | 'line' | 'percent', current: number, total: number) => ({ current, total, unit });
  it('keeps the page and the page count for pages', () => {
    expect(progressOf({ fraction: .125, scrub: scrub('page', 12, 96) })).toEqual({ fraction: .125, page: 12, pages: 96 });
  });
  it('keeps only the fraction for percent and line positions', () => {
    expect(progressOf({ fraction: .38, scrub: scrub('percent', 38, 100) })).toEqual({ fraction: .38 });
    expect(progressOf({ fraction: .5, scrub: scrub('line', 20, 40) })).toEqual({ fraction: .5 });
  });
  it('has no progress for a single image or a position that is not a number, and clamps the rest', () => {
    expect(progressOf({ fraction: 0, scrub: scrub('page', 1, 1) })).toBeUndefined();
    expect(progressOf({ fraction: Number.NaN, scrub: scrub('percent', 0, 100) })).toBeUndefined();
    expect(progressOf({ fraction: 1.2, scrub: scrub('line', 40, 40) })).toEqual({ fraction: 1 });
  });
});

describe('progress on Home and the rail', () => {
  const recents = [{ path: 'a', name: 'a.pdf', format: 'pdf', lastOpened: 2 }, { path: 'b', name: 'b.epub', format: 'epub', lastOpened: 1 }];
  const progress = { a: { fraction: .125, page: 12, pages: 96 } };
  it('carries a document\'s progress onto its tile, and none where it has none', () => {
    const [first, second] = homeRows(recents, [], '', undefined, progress).find(row => row.id === 'recent')!.items;
    expect(first!.progress).toEqual(progress.a);
    expect(second).not.toHaveProperty('progress');
    expect(railItems(recents, [], undefined, progress)[0]!.progress).toEqual(progress.a);
  });
});
