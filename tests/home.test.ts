import { describe, expect, it } from 'vitest';
import { homeIsEmpty, homeSections, homeTypes, jumpLimit, openedAt, recentTiles, shelfLimit, shelfRatio, type HomeCollection, type HomeDocument, type HomeRecent } from '../src/home';

const recent = (path: string, name = path, format = 'pdf'): HomeRecent => ({ path, name, format, lastOpened: 1 });
const doc = (path: string, lastOpened = 0, extra: Partial<HomeDocument> = {}): HomeDocument => ({ path, name: path, format: 'pdf', lastOpened, ...extra });
const shelf = (id: string, name = id, parentId: string | null = null): HomeCollection => ({ id, name, parentId });
const paths = (items: { path: string }[]) => items.map(item => item.path);

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

describe('Jump back in', () => {
  it('is empty when nothing has been opened', () => {
    const sections = homeSections({ recents: [], documents: [doc('a.pdf')] });
    expect(sections.jump).toEqual([]);
  });

  it('keeps the recents in the store\'s order and stops at eight', () => {
    const recents = Array.from({ length: jumpLimit + 4 }, (_, index) => recent(`b${index}.pdf`, `Book ${index}.pdf`));
    const { jump } = homeSections({ recents, documents: [] });
    expect(jump).toHaveLength(8);
    expect(paths(jump)).toEqual(recents.slice(0, 8).map(item => item.path));
    expect(jump[0].title).toBe('Book 0');
  });

  it('borrows the library cover seed and shelf for a recent that is also a library entry', () => {
    const { jump } = homeSections({ recents: [recent('a.pdf')], documents: [doc('a.pdf', 9, { coverSeed: 77, collectionIds: ['shelf'] })] });
    expect(jump[0]).toMatchObject({ seed: 77, shelfId: 'shelf', title: 'a' });
  });

  it('prefers a known book title over the file name for the cover and the label', () => {
    const { jump } = homeSections({ recents: [recent('book.epub', 'book_v2.epub', 'epub')], documents: [], titleOf: () => 'The Real Title' });
    expect(jump[0]).toMatchObject({ title: 'The Real Title', label: 'The Real Title', name: 'book_v2.epub' });
  });

  it('still shows a missing original: it was looked at', () => {
    const { jump } = homeSections({ recents: [recent('gone.pdf')], documents: [doc('gone.pdf', 3, { availability: 'missing' })] });
    expect(jump[0].missing).toBe(true);
  });

  it('carries progress onto the card, and none where there is none', () => {
    const progress = { 'a.pdf': { fraction: .25, page: 3, pages: 12 } };
    const { jump } = homeSections({ recents: [recent('a.pdf'), recent('b.pdf')], documents: [], progress });
    expect(jump[0].progress).toEqual(progress['a.pdf']);
    expect(jump[1]).not.toHaveProperty('progress');
  });
});

describe('Continue reading', () => {
  const progress = {
    'half.pdf': { fraction: .5, page: 5, pages: 10 },
    'done.pdf': { fraction: 1, page: 10, pages: 10 },
    'start.pdf': { fraction: 0, page: 1, pages: 10 },
    'text.md': { fraction: .4 },
    'old.pdf': { fraction: .2, page: 2, pages: 10 },
    'recent-only.pdf': { fraction: .3, page: 3, pages: 10 },
  };

  it('lists opened documents past the start and short of Finished, most recent first', () => {
    const documents = [doc('half.pdf', 5), doc('done.pdf', 9), doc('start.pdf', 8), doc('text.md', 7, { format: 'md' }), doc('old.pdf', 1), doc('never.pdf', 0)];
    const { reading } = homeSections({ recents: [], documents, progress });
    expect(paths(reading)).toEqual(['text.md', 'half.pdf', 'old.pdf']);
  });

  it('puts the recents first, in their order, then the rest by last opened; a recent outside the library counts', () => {
    const documents = [doc('half.pdf', 50), doc('old.pdf', 99), doc('text.md', 70, { format: 'md' })];
    const { reading } = homeSections({ recents: [recent('recent-only.pdf'), recent('old.pdf')], documents, progress });
    expect(paths(reading)).toEqual(['recent-only.pdf', 'old.pdf', 'text.md', 'half.pdf']);
  });

  it('shows each document once and caps the shelf', () => {
    const many = Array.from({ length: shelfLimit + 5 }, (_, index) => doc(`p${index}.pdf`, index + 1));
    const reached = Object.fromEntries(many.map(item => [item.path, { fraction: .5, page: 5, pages: 10 }]));
    const { reading } = homeSections({ recents: [recent('p1.pdf'), recent('p1.pdf')], documents: many, progress: reached });
    expect(reading).toHaveLength(shelfLimit);
    expect(new Set(paths(reading)).size).toBe(shelfLimit);
    expect(reading[0].path).toBe('p1.pdf');
  });
});

describe('Favorites', () => {
  it('lists starred documents, most recently opened first, and may repeat a recent', () => {
    const documents = [doc('r.pdf', 5, { favorite: true }), doc('f.pdf', 3, { favorite: true }), doc('other.pdf', 9), doc('g.pdf', 8, { favorite: true })];
    const sections = homeSections({ recents: [recent('r.pdf')], documents });
    expect(paths(sections.favorites)).toEqual(['g.pdf', 'r.pdf', 'f.pdf']);
    expect(paths(sections.jump)).toEqual(['r.pdf']);
  });
});

describe('Collections', () => {
  const collections = [shelf('b', 'B shelf'), shelf('a', 'A shelf'), shelf('a-child', 'Child', 'a'), shelf('empty', 'Empty'), shelf('gone', 'Gone'), shelf('x', 'Orphan', 'unknown-parent')];
  it('has one card per top-level collection with a document, sorted by name, counting sub-collections', () => {
    const documents = [doc('1.pdf', 0, { collectionIds: ['a'] }), doc('2.pdf', 0, { collectionIds: ['a-child'] }), doc('3.pdf', 0, { collectionIds: ['b'] }), doc('4.pdf', 0, { collectionIds: ['x'] }), doc('5.pdf')];
    const { collections: cards } = homeSections({ recents: [], documents, collections });
    expect(cards.map(card => [card.id, card.name, card.count])).toEqual([['a', 'A shelf', 2], ['b', 'B shelf', 1], ['x', 'Orphan', 1]]);
  });

  it('mosaics the first four covers of the collection, fewer when it has fewer', () => {
    const documents = Array.from({ length: 6 }, (_, index) => doc(`d${index}.pdf`, 0, { collectionIds: ['a'] }));
    documents.push(doc('s.pdf', 0, { collectionIds: ['b'] }));
    const cards = homeSections({ recents: [], documents, collections }).collections;
    expect(paths(cards[0].covers)).toEqual(['d0.pdf', 'd1.pdf', 'd2.pdf', 'd3.pdf']);
    expect(cards[0].count).toBe(6);
    expect(paths(cards[1].covers)).toEqual(['s.pdf']);
  });

  it('leaves out a removed collection and a collection with no documents', () => {
    const cards = homeSections({ recents: [], documents: [doc('1.pdf', 0, { collectionIds: ['gone'] })], collections: [{ ...shelf('gone'), removed: true }, shelf('empty')] }).collections;
    expect(cards).toEqual([]);
  });

  it('counts only what the chip lets through', () => {
    const documents = [doc('1.pdf', 0, { collectionIds: ['a'] }), doc('2.md', 0, { collectionIds: ['a'], format: 'md' }), doc('3.pdf', 0, { collectionIds: ['b'] })];
    const cards = homeSections({ recents: [], documents, collections, format: 'md' }).collections;
    expect(cards.map(card => [card.id, card.count, paths(card.covers)])).toEqual([['a', 1, ['2.md']]]);
  });
});

describe('the file type chips', () => {
  const files = [
    doc('scan.pdf', 0, { format: 'PDF' }), doc('book.epub', 0, { format: 'epub' }),
    doc('notes.md', 0, { format: 'md' }), doc('outline.markdown', 0, { format: 'markdown' }),
    doc('plain.txt', 0, { format: 'txt' }), doc('photo.jpg', 0, { format: 'jpg' }), doc('sketch.png', 0, { format: 'PNG' }),
  ];
  it.each([
    ['pdf', ['scan.pdf']], ['epub', ['book.epub']], ['md', ['notes.md', 'outline.markdown']],
    ['txt', ['plain.txt']], ['image', ['photo.jpg', 'sketch.png']], ['missing', []],
  ] as const)('selects only %s files, including aliases and case-insensitive formats, in every section', (selected, expected) => {
    const starred = files.map(file => ({ ...file, favorite: true, collectionIds: ['all'] }));
    const everything = Object.fromEntries(files.map(file => [file.path, { fraction: .5 }]));
    const sections = homeSections({ recents: files, documents: starred, collections: [shelf('all')], format: selected, progress: everything });
    expect(paths(sections.jump).sort()).toEqual([...expected].sort());
    expect(paths(sections.reading).sort()).toEqual([...expected].sort());
    expect(paths(sections.favorites).sort()).toEqual([...expected].sort());
    expect(sections.collections.flatMap(card => paths(card.covers)).sort()).toEqual([...expected].sort());
  });

  it('filters recents before the cap', () => {
    const texts = Array.from({ length: jumpLimit + 1 }, (_, index) => recent(`notes-${index}.txt`, undefined, 'txt'));
    const { jump } = homeSections({ recents: [...texts, recent('scan.pdf')], documents: [], format: 'pdf' });
    expect(paths(jump)).toEqual(['scan.pdf']);
  });

  it('offers All and each type the library has, in a fixed order, and nothing when there is no choice', () => {
    expect(homeTypes([], files).map(([value]) => value)).toEqual(['', 'pdf', 'epub', 'md', 'txt', 'image']);
    expect(homeTypes([], [doc('a.pdf', 0, { format: 'pdf' }), doc('b.epub', 0, { format: 'epub' })]).map(([, label]) => label)).toEqual(['All', 'PDF', 'EPUB']);
    expect(homeTypes([], [doc('a.pdf'), doc('b.pdf')])).toEqual([]);
    expect(homeTypes([recent('r.txt', undefined, 'txt')], [doc('a.pdf')]).map(([value]) => value)).toEqual(['', 'pdf', 'txt']);
  });
});

describe('Home as a whole', () => {
  it('is empty when nothing is opened, starred, in progress or collected', () => {
    expect(homeIsEmpty(homeSections({ recents: [], documents: [] }))).toBe(true);
    expect(homeIsEmpty(homeSections({ recents: [], documents: [doc('a.pdf')] }))).toBe(true);
    expect(homeIsEmpty(homeSections({ recents: [recent('a.pdf')], documents: [] }))).toBe(false);
  });

  it('has no "Recently added" shelf: the catalog keeps no added time per document', () => {
    expect(Object.keys(homeSections({ recents: [], documents: [] })).sort()).toEqual(['collections', 'favorites', 'jump', 'reading']);
  });
});

describe('recentTiles', () => {
  it('is what the rail shows: recents with the library cover, capped by `limit`', () => {
    const recents = ['a', 'b', 'c'].map(name => recent(`${name}.pdf`));
    expect(paths(recentTiles(recents, [], { limit: 2 }))).toEqual(['a.pdf', 'b.pdf']);
  });
});

describe('shelfRatio', () => {
  it('keeps a shelf cover between square and the 124 x 165 slot', () => {
    expect(shelfRatio(.5)).toBeCloseTo(124 / 165);
    expect(shelfRatio(3 / 4)).toBeCloseTo(.75);
    expect(shelfRatio(2)).toBe(1);
    expect(shelfRatio(Number.NaN)).toBeCloseTo(.75);
  });
});
