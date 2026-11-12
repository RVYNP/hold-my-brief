import { describe, expect, it } from 'vitest';
import { openedOrder, railItems, railLimit } from '../src/library-rail';
import type { HomeDocument, HomeRecent } from '../src/home';

const recent = (path: string): HomeRecent => ({ path, name: `${path}.pdf`, format: 'pdf', lastOpened: 1 });
const doc = (path: string, lastOpened: number | string | undefined, extra: Partial<HomeDocument> = {}): HomeDocument => ({ path, name: `${path}.pdf`, format: 'pdf', lastOpened, ...extra });

describe('railItems', () => {
  it('is empty with no recents, whatever the library holds', () => {
    expect(railItems([], [doc('a', 5)])).toEqual([]);
  });

  it('keeps the store order, most recent first, and stops at the rail limit', () => {
    const recents = Array.from({ length: railLimit + 4 }, (_, index) => recent(`r${index}`));
    expect(railItems(recents, []).map(item => item.path)).toEqual(recents.slice(0, railLimit).map(item => item.path));
  });

  it('borrows the library entry\'s cover and shows an EPUB\'s own title where one was read', () => {
    const [plain, book] = railItems([recent('a'), { path: 'b', name: 'b.epub', format: 'epub', lastOpened: 1 }], [doc('a', 5, { coverSeed: 7, collectionIds: ['shelf'] })], item => item.format === 'epub' ? 'Pride and Prejudice' : undefined);
    expect(plain).toMatchObject({ path: 'a', seed: 7, shelfId: 'shelf', label: 'a.pdf' });
    expect(book).toMatchObject({ path: 'b', label: 'Pride and Prejudice', title: 'Pride and Prejudice' });
  });

  it('marks a missing original', () => {
    expect(railItems([recent('a')], [doc('a', 1, { availability: 'missing' })])[0].missing).toBe(true);
  });
});

describe('openedOrder', () => {
  it('keeps only documents that were opened, latest first, reading dates and numeric strings', () => {
    const ordered = openedOrder([doc('never', undefined), doc('old', 10), doc('new', '30'), doc('mid', 20), doc('zero', 0)]);
    expect(ordered.map(item => item.path)).toEqual(['new', 'mid', 'old']);
  });
});
