import { describe, expect, it } from 'vitest';
import { chapterMap, chapterNumber, cleanChapterLabel, contentsLabel, estimatedPage, footerLabel, formatPage, formatPercent, formatTimeLeft, numberedChapters, readingMeasure } from '../src/epub-position';

describe('cleanChapterLabel', () => {
  it('keeps the chapter a "CHAPTER <roman>" token names and drops the rest', () => {
    expect(cleanChapterLabel('I hope Mr. Bingley will like it. CHAPTER II.')).toBe('Chapter 2');
    expect(cleanChapterLabel('  chapter   xiv  ')).toBe('Chapter 14');
    expect(cleanChapterLabel('Chapter 7: The Journey')).toBe('Chapter 7');
    expect(cleanChapterLabel('CHAPTER LXI.')).toBe('Chapter 61');
  });
  it('does not take a title page for a chapter', () => {
    expect(cleanChapterLabel('PRIDE. and PREJUDICE', 'Pride and Prejudice')).toBeUndefined();
    expect(cleanChapterLabel('Pride  and\nPrejudice.', 'PRIDE AND PREJUDICE')).toBeUndefined();
  });
  it('collapses whitespace and strips a trailing period from other labels', () => {
    expect(cleanChapterLabel('  A  Scandal\n in   Bohemia. ')).toBe('A Scandal in Bohemia');
    expect(cleanChapterLabel('Preface')).toBe('Preface');
  });
  it('gives nothing for an empty label, and does not read "chapter" inside a word as a number', () => {
    expect(cleanChapterLabel('  \n ')).toBeUndefined();
    expect(cleanChapterLabel(undefined)).toBeUndefined();
    expect(cleanChapterLabel('Chapters in brief')).toBe('Chapters in brief');
  });
});

describe('contentsLabel', () => {
  it('keeps the title after a chapter token', () => {
    expect(contentsLabel('Chapter 3: Working with Pointers')).toBe('Chapter 3: Working with Pointers');
    expect(contentsLabel('CHAPTER I. Down the Rabbit-Hole')).toBe('Chapter 1: Down the Rabbit-Hole');
    expect(contentsLabel('Chapter 9 – The End.')).toBe('Chapter 9: The End');
  });
  it('still drops text before the token, and gives a bare number when nothing follows', () => {
    expect(contentsLabel('I hope Mr. Bingley will like it. CHAPTER II.')).toBe('Chapter 2');
  });
  it('cleans other labels as cleanChapterLabel does and keeps the title page raw', () => {
    expect(contentsLabel('  A  Scandal\n in   Bohemia. ')).toBe('A Scandal in Bohemia');
    expect(contentsLabel('PRIDE. and PREJUDICE', 'Pride and Prejudice')).toBe('PRIDE. and PREJUDICE');
  });
});

describe('chapterNumber', () => {
  it('reads roman and decimal numbers, and only those', () => {
    expect([chapterNumber('IV'), chapterNumber('xlii'), chapterNumber('MCMXC'), chapterNumber('12')]).toEqual([4, 42, 1990, 12]);
    expect([chapterNumber('IIII'), chapterNumber('0'), chapterNumber('')]).toEqual([undefined, undefined, undefined]);
  });
});

describe('numberedChapters', () => {
  const entry = (label: string) => ({ label });
  it('counts only entries that name a chapter when any do, and never the title page', () => {
    const entries = ['PRIDE. and PREJUDICE', 'Preface', 'CHAPTER I.', 'CHAPTER II.', 'PART TWO', 'CHAPTER III.'].map(entry);
    expect(numberedChapters(entries, 'Pride and Prejudice').map(e => e.label)).toEqual(['CHAPTER I.', 'CHAPTER II.', 'CHAPTER III.']);
  });
  it('counts every entry but the title page when the book never says "chapter"', () => {
    const entries = ['Title', 'Opening', 'Second'].map(entry);
    expect(numberedChapters(entries, 'Title').map(e => e.label)).toEqual(['Opening', 'Second']);
  });
});

describe('chapterMap', () => {
  type Node = { label: string; parent?: Node };
  const node = (label: string, parent?: Node): Node => ({ label, parent });
  it('maps a subsection to the chapter above it when labels name chapters', () => {
    const one = node('CHAPTER I.'), section = node('Section A', one), two = node('CHAPTER II.');
    const map = chapterMap([one, section, two]);
    expect(map.get(section)).toEqual({ n: 1, total: 2 });
    expect(map.get(one)).toEqual({ n: 1, total: 2 });
    expect(map.get(two)).toEqual({ n: 2, total: 2 });
  });
  it('counts top-level entries only when no label names a chapter, and maps their children to them', () => {
    const title = node('The Book'), intro = node('Introduction'), background = node('Background', intro), scope = node('Scope', intro), methods = node('Methods');
    const entries = [title, intro, background, scope, methods];
    expect(numberedChapters(entries, 'The Book')).toEqual([intro, methods]);
    const map = chapterMap(entries, 'The Book');
    expect(map.get(background)).toEqual({ n: 1, total: 2 });
    expect(map.get(scope)).toEqual({ n: 1, total: 2 });
    expect(map.get(methods)).toEqual({ n: 2, total: 2 });
    expect(map.has(title)).toBe(false);
  });
});

describe('formatPercent', () => {
  it('shows a decimal so the first page turns move it', () => {
    expect(formatPercent(0)).toBe('0.0%');
    expect(formatPercent(0.0042)).toBe('0.4%');
    expect(formatPercent(0.0049)).toBe('0.5%');
    expect(formatPercent(0.083)).toBe('8.3%');
    expect(formatPercent(0.4)).toBe('40.0%');
  });
  it('reads 100% only at the very end, and survives bad numbers', () => {
    expect(formatPercent(0.9999)).toBe('99.9%');
    expect(formatPercent(1)).toBe('100.0%');
    expect(formatPercent(7)).toBe('100.0%');
    expect(formatPercent(NaN)).toBe('0.0%');
  });
});

describe('page, time and footer', () => {
  it('marks an estimated page count with a tilde and a printed one without', () => {
    expect(formatPage({ page: '34', pages: '412', estimated: true })).toBe('p. ~34 of ~412');
    expect(formatPage({ page: 'xii', pages: '340', estimated: false })).toBe('p. xii of 340');
  });
  it('turns a Foliate location into a one-based page, clamped to the count', () => {
    expect(estimatedPage({ current: 33, total: 412 })).toEqual({ page: '34', pages: '412', estimated: true });
    expect(estimatedPage({ current: 0, total: 1 })).toEqual({ page: '1', pages: '1', estimated: true });
    expect(estimatedPage({ current: 900, total: 412 })?.page).toBe('412');
    expect(estimatedPage({ current: 3, total: 0 })).toBeUndefined();
    expect(estimatedPage(undefined)).toBeUndefined();
  });
  it('rounds time left to the minute, and says so under half of one', () => {
    expect(formatTimeLeft(2501)).toBe('10 min left in chapter');
    expect(formatTimeLeft(250)).toBe('1 min left in chapter');
    expect(formatTimeLeft(100)).toBe('<1 min left in chapter');
    expect(formatTimeLeft(0)).toBe('<1 min left in chapter');
    expect(formatTimeLeft(3000, 300)).toBe('10 min left in chapter');
    expect(formatTimeLeft(100, 0)).toBeUndefined();
  });
  it('joins what the book can tell, leaving out what it cannot', () => {
    expect(footerLabel({ chapter: { n: 3, total: 61 }, page: { page: '34', pages: '412', estimated: true }, fraction: 0.083, words: 2900 }))
      .toBe('Chapter 3 of 61 · p. ~34 of ~412 · 8.3% · 12 min left in chapter');
    expect(footerLabel({ fraction: 0.001, words: 10 })).toBe('0.1% · <1 min left in chapter');
  });
});

describe('readingMeasure', () => {
  it('scales with the font size and makes up for the column gap', () => {
    expect(readingMeasure(18, 0)).toBe(499);
    expect(readingMeasure(24, 0)).toBeGreaterThan(readingMeasure(18, 0));
    expect(readingMeasure(18, 0.033)).toBeGreaterThan(readingMeasure(18, 0));
  });
});
