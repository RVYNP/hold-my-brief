import { describe, expect, it } from 'vitest';
import { middleTruncate, titleHints } from '../src/tab-titles';

const tab = (path: string, title = path.split(/[\\/]/).pop()!) => ({ path, title });
const hints = (...tabs: ReturnType<typeof tab>[]) => Object.fromEntries(titleHints(tabs));

describe('tab titles that need telling apart', () => {
  it('says nothing about tabs with their own title', () => {
    expect(hints(tab('/a/one.pdf'), tab('/b/two.pdf'))).toEqual({});
    expect(hints()).toEqual({});
    expect(hints(tab('/only/source.pdf'))).toEqual({});
  });

  it('gives same-titled tabs the folder that sets each apart', () => {
    expect(hints(tab('/lib/03_wwe_mag/source.pdf'), tab('/lib/09_dirtrider/source.pdf'))).toEqual({
      '/lib/03_wwe_mag/source.pdf': '03_wwe_mag',
      '/lib/09_dirtrider/source.pdf': '09_dirtrider',
    });
  });

  it('leaves the tabs that are not duplicated alone, in a mixed set', () => {
    expect(hints(tab('/a/source.pdf'), tab('/a/notes.md'), tab('/b/source.pdf'))).toEqual({ '/a/source.pdf': 'a', '/b/source.pdf': 'b' });
  });

  it('goes up as many folders as it takes, and no further', () => {
    expect(hints(tab('/x/mags/09/source.pdf'), tab('/y/mags/10/source.pdf'), tab('/y/mags/09/source.pdf'))).toEqual({
      '/x/mags/09/source.pdf': 'x/mags/09',
      '/y/mags/10/source.pdf': 'y/mags/10',
      '/y/mags/09/source.pdf': 'y/mags/09',
    });
    // One folder is enough for these two even though they share a grandparent.
    expect(hints(tab('/lib/mags/a/source.pdf'), tab('/lib/mags/b/source.pdf'))).toEqual({ '/lib/mags/a/source.pdf': 'a', '/lib/mags/b/source.pdf': 'b' });
  });

  it('reads Windows paths, and paths of different depth', () => {
    expect(hints(tab('C:\\Docs\\Work\\source.pdf'), tab('C:\\Docs\\Home\\source.pdf'))).toEqual({ 'C:\\Docs\\Work\\source.pdf': 'Work', 'C:\\Docs\\Home\\source.pdf': 'Home' });
    // A file at the top has no folder to name, so its hint is empty and the other's is its folder.
    expect(hints(tab('/source.pdf'), tab('/a/source.pdf'))).toEqual({ '/a/source.pdf': 'a' });
  });

  it('compares the title as shown, so two books with one title and different files are told apart', () => {
    expect(hints(tab('/lib/a/one.epub', 'Dune'), tab('/lib/b/two.epub', 'Dune'), tab('/lib/c/three.epub', 'Emma'))).toEqual({ '/lib/a/one.epub': 'a', '/lib/b/two.epub': 'b' });
  });

  it('falls back to the file name when the folder is the same', () => {
    expect(hints(tab('/lib/one.epub', 'Dune'), tab('/lib/two.epub', 'Dune'))).toEqual({ '/lib/one.epub': 'one.epub', '/lib/two.epub': 'two.epub' });
  });

  it('shortens the content id a browser-build path starts with', () => {
    const idA = 'a'.repeat(64), idB = 'b'.repeat(64);
    expect(hints(tab(`${idA}/source.pdf`), tab(`${idB}/source.pdf`))).toEqual({ [`${idA}/source.pdf`]: 'aaaaaa', [`${idB}/source.pdf`]: 'bbbbbb' });
  });
});

describe('cutting a name in the middle', () => {
  // One unit per character, so the budget is easy to read.
  const within = (limit: number) => (candidate: string) => candidate.length <= limit;

  it('leaves a name that fits as it is', () => {
    expect(middleTruncate('plate 15.jpg', within(12))).toBe('plate 15.jpg');
    expect(middleTruncate('plate 15.jpg', within(40))).toBe('plate 15.jpg');
  });

  it('keeps the start and the end of a long name, as wide as the limit allows', () => {
    const cut = middleTruncate('Haeckel - Kunstformen der Natur, plate 15.jpg', within(26));
    expect(cut.length).toBeGreaterThanOrEqual(25); expect(cut.length).toBeLessThanOrEqual(26);
    expect(cut.startsWith('Haeckel -')).toBe(true);
    expect(cut.endsWith('plate 15.jpg')).toBe(true);
    expect(cut).toContain('…');
  });

  it('tells two names that share their start apart by their ends', () => {
    const a = middleTruncate('Haeckel - Hexacoralla (Kunstformen der Natur).jpg', within(24));
    const b = middleTruncate('Haeckel - Kunstformen der Natur, plate 15.jpg', within(24));
    expect(a).not.toBe(b);
    expect(a.endsWith('Natur).jpg')).toBe(true);
    expect(b.endsWith('plate 15.jpg')).toBe(true);
  });

  it('always shows the extension, even when only it fits', () => {
    expect(middleTruncate('a-very-long-name-indeed.jpeg', within(6))).toBe('….jpeg');
    expect(middleTruncate('a-very-long-name-indeed.jpeg', within(1))).toBe('….jpeg');
  });

  it('cuts a name without an extension, and a dotfile, like any other', () => {
    expect(middleTruncate('README-for-the-whole-collection', within(11))).toMatch(/^.+….+$/);
    expect(middleTruncate('README-for-the-whole-collection', within(11)).length).toBeLessThanOrEqual(11);
    expect(middleTruncate('.hidden-file-with-a-long-name', within(9)).length).toBeLessThanOrEqual(9);
  });

  it('handles an empty name and a single character that does not fit', () => {
    expect(middleTruncate('', within(0))).toBe('');
    expect(middleTruncate('W', () => false)).toBe('W');
    expect(middleTruncate('', () => false)).toBe('');
  });

  it('keeps a measure that is not one unit per character honest', () => {
    const wide = (candidate: string) => [...candidate].reduce((sum, letter) => sum + (letter === 'W' || letter === '…' ? 2 : 1), 0) <= 12;
    const cut = middleTruncate('WWWWWWWWWWWW-WWWWWWWWWWWW.png', wide);
    expect(wide(cut)).toBe(true);
    expect(cut.endsWith('.png')).toBe(true);
  });
});
