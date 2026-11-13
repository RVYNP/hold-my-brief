import { describe, expect, it } from 'vitest';
import { titleHints } from '../src/tab-titles';

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
