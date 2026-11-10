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
    expect(row.id).toBe('recent');
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
    expect(rows.map(row => row.id)).toEqual(['recent', 'library']);
    expect(rows[1].items.map(item => item.path)).toEqual(['newer.pdf', 'old.pdf', 'unused.pdf']);
  });

  it('leaves out the recent section when nothing was opened from the list, and orders the library by last opened then name', () => {
    const rows = homeRows([], [doc('b.pdf', 2), doc('a.pdf', 8), doc('d.pdf'), doc('c.pdf')]);
    expect(rows.map(row => row.id)).toEqual(['library']);
    expect(rows[0].items.map(item => item.path)).toEqual(['a.pdf', 'b.pdf', 'c.pdf', 'd.pdf']);
  });

  it('shows favorites only when there are some, may repeat a recent, and keeps both out of the library selection', () => {
    expect(homeRows([], [doc('a.pdf')]).map(row => row.id)).toEqual(['library']);
    const rows = homeRows(
      [recent('r.pdf')],
      [doc('r.pdf', 5, { favorite: true }), doc('f.pdf', 3, { favorite: true }), doc('other.pdf', 1)],
    );
    expect(rows.map(row => [row.id, row.items.map(item => item.path)])).toEqual([
      ['recent', ['r.pdf']], ['favorites', ['r.pdf', 'f.pdf']], ['library', ['other.pdf']],
    ]);
  });

  it('prefers a known book title over the file name for the cover and the label', () => {
    const [row] = homeRows([], [doc('book.epub', 1, { name: 'book_v2.epub', format: 'epub' })], '', () => 'The Real Title');
    expect(row.items[0]).toMatchObject({ title: 'The Real Title', label: 'The Real Title', name: 'book_v2.epub' });
  });

  it('still shows a missing original: it was looked at', () => {
    const [row] = homeRows([recent('gone.pdf')], [doc('gone.pdf', 3, { availability: 'missing' })]);
    expect(row.items[0].missing).toBe(true);
  });

  it('filters recents before the row cap and excludes those PDFs from the library row', () => {
    const textRecents = Array.from({ length: homeRowLimit + 1 }, (_, index) => ({
      path: `notes-${index}.txt`, name: `notes-${index}.txt`, format: 'txt',
    }));
    const rows = homeRows([...textRecents, recent('scan.pdf')], [doc('scan.pdf', 8), doc('other.pdf', 2)], 'pdf');
    expect(rows.map(row => row.items.map(item => item.path))).toEqual([['scan.pdf'], ['other.pdf']]);
  });

  it.each([
    ['pdf', ['scan.pdf']], ['epub', ['book.epub']],
    ['md', ['notes.md', 'outline.markdown']], ['txt', ['plain.txt']],
    ['image', ['photo.jpg', 'sketch.png']], ['missing', []],
  ] as const)('selects only %s files, including aliases and case-insensitive formats', (selected, paths) => {
    const files = [
      doc('scan.pdf', 0, { format: 'PDF' }), doc('book.epub', 0, { format: 'epub' }),
      doc('notes.md', 0, { format: 'md' }), doc('outline.markdown', 0, { format: 'markdown' }),
      doc('plain.txt', 0, { format: 'txt' }), doc('photo.jpg', 0, { format: 'jpg' }),
      doc('sketch.png', 0, { format: 'PNG' }),
    ];
    expect(homeRows([], files, selected).flatMap(row => row.items.map(item => item.path))).toEqual(paths);
  });
});
