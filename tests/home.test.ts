import { describe, expect, it } from 'vitest';
import { homeSections, openedAt, openedOrder, recentTiles, shelfLimit, shelfRatio, type HomeDocument, type HomeRecent } from '../src/home';

const recent = (path: string, name = path, format = 'pdf'): HomeRecent => ({ path, name, format, lastOpened: 1 });
const doc = (path: string, lastOpened = 0, extra: Partial<HomeDocument> = {}): HomeDocument => ({ path, name: path, format: 'pdf', lastOpened, ...extra });
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

describe('Recently opened', () => {
  it('is empty when nothing has been opened', () => {
    const sections = homeSections({ recents: [], documents: [doc('a.pdf')] });
    expect(sections.recent).toEqual([]);
  });

  it('keeps up to the first four recents in order', () => {
    const recents = Array.from({ length: 6 }, (_, index) => recent(`b${index}.pdf`, `Book ${index}.pdf`));
    const { recent: tiles } = homeSections({ recents, documents: [] });
    expect(paths(tiles)).toEqual(['b0.pdf', 'b1.pdf', 'b2.pdf', 'b3.pdf']);
    expect(tiles[0].title).toBe('Book 0');
  });

  it('borrows the library cover seed and shelf for a recent that is also a library entry', () => {
    const { recent: tiles } = homeSections({ recents: [recent('a.pdf')], documents: [doc('a.pdf', 9, { coverSeed: 77, collectionIds: ['shelf'] })] });
    expect(tiles[0]).toMatchObject({ seed: 77, shelfId: 'shelf', title: 'a' });
  });

  it('prefers a known book title over the file name for the cover and the label', () => {
    const { recent: tiles } = homeSections({ recents: [recent('book.epub', 'book_v2.epub', 'epub')], documents: [], titleOf: () => 'The Real Title' });
    expect(tiles[0]).toMatchObject({ title: 'The Real Title', label: 'The Real Title', name: 'book_v2.epub' });
  });

  it('still shows a missing original: it was looked at', () => {
    const { recent: tiles } = homeSections({ recents: [recent('gone.pdf')], documents: [doc('gone.pdf', 3, { availability: 'missing' })] });
    expect(tiles[0].missing).toBe(true);
  });

  it('carries progress onto the card, and none where there is none', () => {
    const progress = { 'a.pdf': { fraction: .25, page: 3, pages: 12 } };
    const [first] = homeSections({ recents: [recent('a.pdf')], documents: [], progress }).recent;
    expect(first.progress).toEqual(progress['a.pdf']);
    expect(homeSections({ recents: [recent('b.pdf')], documents: [], progress }).recent[0]).not.toHaveProperty('progress');
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

describe('the file-type shelves', () => {
  const library = [
    doc('b.pdf', 0), doc('a.pdf', 0), doc('old.pdf', 5), doc('new.pdf', 9),
    doc('book.epub', 3, { format: 'epub' }),
    doc('notes.md', 0, { format: 'md' }), doc('outline.markdown', 4, { format: 'markdown' }),
  ];
  const typesOf = (documents: HomeDocument[], recents: HomeRecent[] = []) => homeSections({ recents, documents }).types;

  it('comes in the order PDFs, EPUBs, Markdown, Text, Images, leaving out a type the library does not have', () => {
    const shelves = typesOf(library);
    expect(shelves.map(({ type, title }) => [type, title])).toEqual([['pdf', 'PDFs'], ['epub', 'EPUBs'], ['md', 'Markdown']]);
    const everything = typesOf([...library, doc('t.txt', 0, { format: 'txt' }), doc('p.PNG', 0, { format: 'PNG' }), doc('j.jpg', 0, { format: 'jpg' })]);
    expect(everything.map(({ title }) => title)).toEqual(['PDFs', 'EPUBs', 'Markdown', 'Text', 'Images']);
    expect(paths(everything[4].tiles).sort()).toEqual(['j.jpg', 'p.PNG']);
    expect(typesOf([])).toEqual([]);
  });

  it('lists the opened documents most recent first, then the never-opened ones by title', () => {
    expect(paths(typesOf(library)[0].tiles)).toEqual(['new.pdf', 'old.pdf', 'a.pdf', 'b.pdf']);
    expect(paths(typesOf(library)[2].tiles)).toEqual(['outline.markdown', 'notes.md']);
  });

  it('orders by the title the card prints: an EPUB\'s own title, not its file name', () => {
    const books = [doc('1.epub', 0, { format: 'epub' }), doc('2.epub', 0, { format: 'epub' })];
    const { types } = homeSections({ recents: [], documents: books, titleOf: item => item.path === '1.epub' ? 'Zebra' : 'Aardvark' });
    expect(paths(types[0].tiles)).toEqual(['2.epub', '1.epub']);
  });

  it('caps a shelf and carries each document\'s progress', () => {
    const many = Array.from({ length: shelfLimit + 5 }, (_, index) => doc(`p${index}.pdf`, index + 1));
    const progress = { 'p30.pdf': { fraction: .5, page: 5, pages: 10 } };
    const [shelf] = homeSections({ recents: [], documents: many, progress }).types;
    expect(shelf.tiles).toHaveLength(shelfLimit);
    expect(paths(shelf.tiles)).not.toContain('p0.pdf');
    expect(shelf.tiles.find(tile => tile.path === 'p30.pdf')!.progress).toEqual(progress['p30.pdf']);
    expect(shelf.tiles[0]).not.toHaveProperty('progress');
  });
});

describe('Home as a whole', () => {
  it('has Recently opened (up to four cards), Continue reading, then a shelf per type, in that order', () => {
    const documents = [doc('a.pdf', 9), doc('b.pdf', 5), doc('book.epub', 7, { format: 'epub' }), doc('notes.md', 3, { format: 'md' })];
    const progress = { 'a.pdf': { fraction: .5, page: 5, pages: 10 }, 'notes.md': { fraction: .4 } };
    const sections = homeSections({ recents: [recent('a.pdf'), recent('book.epub', 'book.epub', 'epub')], documents, progress });
    expect(Object.keys(sections)).toEqual(['recent', 'reading', 'types']);
    expect(paths(sections.recent)).toEqual(['a.pdf', 'book.epub']);
    expect(paths(sections.reading)).toEqual(['a.pdf', 'notes.md']);
    expect(sections.types.map(shelf => shelf.title)).toEqual(['PDFs', 'EPUBs', 'Markdown']);
  });

  it('has no Text or Images shelf when the library has none, and no Recently opened when nothing was opened', () => {
    const sections = homeSections({ recents: [], documents: [doc('a.pdf')] });
    expect(sections.recent).toEqual([]);
    expect(sections.types.map(shelf => shelf.type)).toEqual(['pdf']);
  });
});

describe('recentTiles', () => {
  it('is what the rail shows: recents with the library cover, capped by `limit`', () => {
    const recents = ['a', 'b', 'c'].map(name => recent(`${name}.pdf`));
    expect(paths(recentTiles(recents, [], { limit: 2 }))).toEqual(['a.pdf', 'b.pdf']);
  });
});

describe('shelfRatio', () => {
  it('keeps a shelf cover between square and the 125 x 170 slot', () => {
    expect(shelfRatio(.5)).toBeCloseTo(125 / 170);
    expect(shelfRatio(3 / 4)).toBeCloseTo(.75);
    expect(shelfRatio(2)).toBe(1);
    expect(shelfRatio(Number.NaN)).toBeCloseTo(.75);
  });
});

describe('openedOrder', () => {
  it('keeps only documents that were opened, latest first, reading dates and numeric strings', () => {
    const ordered = openedOrder([doc('never', undefined), doc('old', 10), { ...doc('new'), lastOpened: '30' }, doc('mid', 20), doc('zero', 0)]);
    expect(ordered.map(item => item.path)).toEqual(['new', 'mid', 'old']);
  });
});

describe('titles of generic file names', () => {
  it('a card for a generic file name is titled by its folder, and a named file keeps its own name', () => {
    const [generic, named] = recentTiles([{ path: '/refs/03_wwe_mag/source.pdf', name: 'source.pdf', format: 'pdf' }, { path: '/refs/x/Rust-Book-1.99.epub', name: 'Rust-Book-1.99.epub', format: 'epub' }], []);
    expect(generic).toMatchObject({ title: '03_wwe_mag', label: '03_wwe_mag', name: 'source.pdf' });
    expect(named).toMatchObject({ title: 'Rust Book', label: 'Rust-Book-1.99.epub' });
  });
  it('an EPUB\'s own title wins over a generic name', () => {
    const [book] = recentTiles([{ path: '/refs/x/source.epub', name: 'source.epub', format: 'epub' }], [], { titleOf: () => 'A Real Title' });
    expect(book).toMatchObject({ title: 'A Real Title', label: 'A Real Title' });
  });
});
