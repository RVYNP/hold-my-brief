import { describe, expect, it } from 'vitest';
import { homeRowLimit, homeRows, openedAt, type HomeDocument, type HomeRecent } from '../src/home';

const recent = (path: string, name = path): HomeRecent => ({ path, name, format: 'pdf', lastOpened: 1 });
const doc = (path: string, lastOpened = 0, extra: Partial<HomeDocument> = {}): HomeDocument => ({ path, name: path, format: 'pdf', lastOpened, ...extra });

describe('openedAt', () => {
  it('reads a number, a numeric string, or a date, and treats anything else as never', () => {
    expect(openedAt(12)).toBe(12);
    expect(openedAt('12')).toBe(12);
    expect(openedAt('2026-11-01T00:00:00.000Z')).toBe(Date.parse('2026-11-01T00:00:00.000Z'));
    expect(openedAt(undefined)).toBe(0);
    expect(openedAt('')).toBe(0);
    expect(openedAt('soon')).toBe(0);
    expect(openedAt(Number.NaN)).toBe(0);
  });
});

describe('homeRows', () => {
  it('is empty when nothing has been opened and the library is empty', () => {
    expect(homeRows([], [])).toEqual([]);
  });

  it('keeps recents in store order and caps the row', () => {
    const recents = Array.from({ length: homeRowLimit + 3 }, (_, index) => recent(`b${index}.pdf`, `Book ${index}.pdf`));
    const [row] = homeRows(recents, []);
    expect(row.title).toBe('Recently opened');
    expect(row.items.map(item => item.path)).toEqual(recents.slice(0, homeRowLimit).map(item => item.path));
    expect(row.items[0].title).toBe('Book 0');
  });

  it('borrows the library cover seed and shelf for a recent that is also a library entry', () => {
    const [row] = homeRows(
      [recent('a.pdf', 'a.pdf')],
      [doc('a.pdf', 9, { name: 'a.pdf', coverSeed: 77, collectionIds: ['shelf'] })],
    );
    expect(row.items[0]).toMatchObject({ seed: 77, shelfId: 'shelf', title: 'a' });
  });

  it('puts library entries that are not recent on a second row, most recently opened first', () => {
    const rows = homeRows(
      [recent('now.pdf')],
      [doc('now.pdf', 5), doc('old.pdf', 1), doc('newer.pdf', 4), doc('unused.pdf', 0)],
    );
    expect(rows.map(row => row.title)).toEqual(['Recently opened', 'In the library']);
    expect(rows[1].items.map(item => item.path)).toEqual(['newer.pdf', 'old.pdf', 'unused.pdf']);
  });

  it('uses the library as the opening row when there are no recents', () => {
    const [row] = homeRows([], [doc('b.pdf', 2), doc('a.pdf', 8)]);
    expect(row).toMatchObject({ id: 'recent', title: 'Recently opened' });
    expect(row.items.map(item => item.path)).toEqual(['a.pdf', 'b.pdf']);
  });

  it('calls an unopened library what it is', () => {
    const [row] = homeRows([], [doc('b.pdf'), doc('a.pdf')]);
    expect(row).toMatchObject({ id: 'library', title: 'In the library' });
    expect(row.items.map(item => item.name)).toEqual(['a.pdf', 'b.pdf']);
  });

  it('still shows a missing original: it was looked at', () => {
    const [row] = homeRows([recent('gone.pdf')], [doc('gone.pdf', 3, { availability: 'missing' })]);
    expect(row.items[0].missing).toBe(true);
  });
});
