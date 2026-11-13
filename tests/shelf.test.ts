import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assignCoverSlots, collectionDisplayName, coverFamily, coverFill, coverHash, coverHue, coverSecondaryInk, coverSeedOf, coverStyle, coverTintRgb, displayTitle, fileTitle, fileVersion, groupIntoShelves, isGenericName, parentFolder, unfiledHue } from '../src/shelf';
import { coverFamilies, coverPalette, familyFor, seedFrom } from '../src/procedural-cover';
import { contrast, palettes, type Rgb } from '../src/theme';

describe('version and title from a file name', () => {
  it('reads the version or date a name ends with', () => {
    expect(fileVersion('Rust-Book-1.99.epub')).toBe('1.99');
    expect(fileVersion('Photoshop-UXP-Docs-2026-10-29.epub')).toBe('2026-10-29');
    expect(fileVersion('FFmpeg-master-Docs-2026-11-03.epub')).toBe('2026-11-03');
    expect(fileVersion('Just-1.59.0-Manual.epub')).toBeUndefined();
    expect(fileVersion('Tauri-2-Docs.epub')).toBeUndefined();
    expect(fileVersion('Notes-v2.1.md')).toBe('v2.1');
    expect(fileVersion('Nodejs-master.epub')).toBe('master');
    expect(fileVersion('readme.txt')).toBeUndefined();
    expect(fileVersion('2026-10-29.md')).toBe('2026-10-29');
  });
  it('cleans a file name into a title: no extension, no version, hyphens as spaces', () => {
    expect(fileTitle('Rust-Book-1.99.epub')).toBe('Rust Book');
    expect(fileTitle('Photoshop-UXP-Docs-2026-10-29.epub')).toBe('Photoshop UXP Docs');
    expect(fileTitle('FFmpeg-master-Docs-2026-11-03.epub')).toBe('FFmpeg master Docs');
    expect(fileTitle('my_notes.md')).toBe('my notes');
    expect(fileTitle('Meeting-notes-2026-10-29.md')).toBe('Meeting notes');
    expect(fileTitle('2026-10-29.md')).toBe('2026 10 29');
    expect(fileTitle('Unknown')).toBe('Unknown');
  });
});

describe('collection display names', () => {
  it('drops the ordering prefix and tidies separators, leaving the stored name alone', () => {
    expect(collectionDisplayName('1-languages')).toBe('Languages');
    expect(collectionDisplayName('2-creative-apps')).toBe('Creative apps');
    expect(collectionDisplayName('10_data_tools')).toBe('Data tools');
    expect(collectionDisplayName('3. Libraries')).toBe('Libraries');
    expect(collectionDisplayName('anatomy')).toBe('Anatomy');
    expect(collectionDisplayName('Already Fine')).toBe('Already Fine');
    expect(collectionDisplayName('2024')).toBe('2024');
    expect(collectionDisplayName('7-')).toBe('7-');
  });
});

describe('shelves', () => {
  const collections = [
    { id: 'root', name: 'reference', parentId: null }, { id: 'b', name: '2-creative-apps', parentId: 'root' }, { id: 'a', name: '1-languages', parentId: 'root' },
    { id: 'c', name: '10-misc', parentId: 'root' }, { id: 'a1', name: 'rust', parentId: 'a' }, { id: 'lone', name: 'lone', parentId: null },
  ];
  const doc = (name: string, ...collectionIds: string[]) => ({ name, collectionIds });
  const items = [doc('loose', 'root'), doc('py', 'a'), doc('ae', 'b'), doc('rust', 'a1'), doc('misc', 'c'), doc('also-loose', 'root', 'zzz'), doc('both', 'b', 'a')];

  it('puts the collection\'s own documents first, then a shelf per child in name order, numbers by value', () => {
    const shelves = groupIntoShelves('root', collections, items)!;
    expect(shelves.map(shelf => shelf.name)).toEqual(['Reference', 'Languages', 'Creative apps', 'Misc']);
    expect(shelves[0].items.map(item => item.name)).toEqual(['loose', 'also-loose']);
    expect(shelves[1].items.map(item => item.name)).toEqual(['py', 'rust', 'both']);
    expect(shelves[2].items.map(item => item.name)).toEqual(['ae']);
    expect(shelves[3].items.map(item => item.name)).toEqual(['misc']);
    expect(shelves.map(shelf => shelf.id)).toEqual(['root', 'a', 'b', 'c']);
  });
  it('hides empty shelves and keeps the order given within a shelf', () => {
    const shelves = groupIntoShelves('root', collections, [doc('z', 'b'), doc('y', 'b')])!;
    expect(shelves.map(shelf => shelf.name)).toEqual(['Creative apps']);
    expect(shelves[0].items.map(item => item.name)).toEqual(['z', 'y']);
  });
  it('has no shelves for a collection without children, or an unknown one', () => {
    expect(groupIntoShelves('lone', collections, items)).toBeUndefined();
    expect(groupIntoShelves('a1', collections, items)).toBeUndefined();
    expect(groupIntoShelves('missing', collections, items)).toBeUndefined();
  });
  it('survives a parent cycle', () => {
    const loop = [{ id: 'x', name: 'x', parentId: 'y' }, { id: 'y', name: 'y', parentId: 'x' }];
    expect(groupIntoShelves('x', loop, [doc('d', 'y')])!.map(shelf => shelf.id)).toEqual(['y']);
  });
});

describe('generated cover colours', () => {
  const ids = ['languages', 'creative-apps', 'libraries-tools', 'f0c1e1b2-7d51-4a8e-8f1a-0d2d4d9a1b11', 'a', 'b', 'c', '1', '2', '3'];
  it('gives the same collection the same hue every time, and the different ones differ', () => {
    for (const id of ids) { expect(coverHue(id)).toBe(coverHue(id)); expect(coverHue(id)).toBeGreaterThanOrEqual(0); expect(coverHue(id)).toBeLessThan(360); }
    expect(new Set(ids.map(coverHue)).size).toBeGreaterThan(7);
    expect(coverHue(undefined)).toBe(unfiledHue);
    expect(coverHash('a')).not.toBe(coverHash('b'));
  });
  it('never gives two siblings the same pattern family or a close hue, whatever their ids hash to', () => {
    const siblings = ['languages', 'creative-apps', 'libraries-tools', 'x', 'y', 'z', 'w', 'v'].slice(0, coverFamilies.length);
    assignCoverSlots([siblings]);
    try {
      expect(new Set(siblings.map(id => coverFamily(id))).size).toBe(siblings.length);
      for (const id of siblings) expect(coverFamilies).toContain(coverFamily(id));
      const hues = siblings.map(coverHue).sort((a, b) => a - b);
      const gaps = hues.map((hue, index) => (index ? hue - hues[index - 1] : hue + 360 - hues[hues.length - 1]));
      expect(Math.min(...gaps)).toBeGreaterThanOrEqual(40);
    } finally { assignCoverSlots([]); }
  });
  it('styles a cover by its shelf (hue, family) and its book (seed): the seed picks the family only where the shelf has no slot', () => {
    const seed = seedFrom('/books/rust.epub');
    assignCoverSlots([['a', 'b', 'c']]);
    try {
      expect(coverStyle(seed, 'b')).toEqual({ hue: coverHue('b'), family: coverFamily('b') });
      expect(coverStyle(seed ^ 0xff000000, 'b')).toEqual(coverStyle(seed, 'b'));
      expect(coverStyle(seed, 'unknown-shelf')).toEqual({ hue: coverHue('unknown-shelf'), family: familyFor(seed) });
      expect(coverStyle(seed, undefined)).toEqual({ hue: unfiledHue, family: familyFor(seed) });
    } finally { assignCoverSlots([]); }
  });
  it('seeds a book from its own seed when it has one, else from its path', () => {
    expect(coverSeedOf({ path: '/a.md' })).toBe(seedFrom('/a.md'));
    expect(coverSeedOf({ path: '/a.md', coverSeed: 7 })).toBe(7);
    expect(coverSeedOf({ path: '/a.md', coverSeed: 0 })).toBe(0);
    expect(coverSeedOf({ path: '/a.md' })).not.toBe(coverSeedOf({ path: '/b.md' }));
  });

  // Read from disk, like the palette contrast test: the tokens are the stylesheet's own.
  const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
  const hex = (value: string): Rgb => [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16)) as Rgb;
  const unpack = (value: number): Rgb => [value >> 16 & 255, value >> 8 & 255, value & 255];
  const mix = (a: Rgb, b: Rgb, weight: number): Rgb => a.map((channel, i) => Math.round(channel * weight + b[i] * (1 - weight))) as Rgb;
  function tokens(name: string) {
    const block = new RegExp(`\\[data-palette='${name}'\\] \\{([^}]*)\\}`).exec(css)![1]; const found: Record<string, [Rgb, Rgb]> = {};
    for (const [, token, light, dark] of block.matchAll(/--([\w-]+): light-dark\((#[0-9a-f]{6}), (#[0-9a-f]{6})\)/gi)) found[token] = [hex(light), hex(dark)];
    return found;
  }
  const hues = Array.from({ length: 36 }, (_, index) => index * 10);

  it('fills a cover with the ground tone of its palette in both schemes, light first', () => {
    const [light, dark] = (['light', 'dark'] as const).map(mode => coverPalette(coverHue('x'), mode)[0].join(' '));
    expect(coverFill('x')).toBe(`light-dark(rgb(${light}), rgb(${dark}))`);
    expect(coverFill(undefined)).toBe(`light-dark(rgb(${coverPalette(unfiledHue, 'light')[0].join(' ')}), rgb(${coverPalette(unfiledHue, 'dark')[0].join(' ')}))`);
  });

  describe.each(palettes.flatMap(name => (['light', 'dark'] as const).map((mode, column) => ({ name: `${name} ${mode}`, mode, column, found: tokens(name) }))))('$name', ({ mode, column, found }) => {
    const ink = found.ink[column], muted = found.muted[column];
    const small = mix(ink, muted, coverSecondaryInk);
    it('reads the title and the small print at 4.5:1 or better on every shelf tint', () => {
      for (const id of ids) {
        const tint = unpack(coverTintRgb(id, mode));
        expect(contrast(ink, tint), `${id} title`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(small, tint), `${id} small print`).toBeGreaterThanOrEqual(4.5);
      }
    });
    it('reads at 4.5:1 or better on the tint of every hue, not just the sampled shelves', () => {
      for (const hue of hues) {
        const id = Array.from({ length: 4000 }, (_, index) => `h${index}`).find(candidate => coverHue(candidate) === hue)!;
        const tint = unpack(coverTintRgb(id, mode));
        expect(contrast(ink, tint), `hue ${hue}`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(small, tint), `hue ${hue}`).toBeGreaterThanOrEqual(4.5);
      }
    });
    it('reads on the tint of a document with no collection', () => {
      const tint = unpack(coverTintRgb(undefined, mode));
      expect(contrast(ink, tint)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(small, tint)).toBeGreaterThanOrEqual(4.5);
    });
    it('keeps the plain band the very colour of the art\'s ground tone, so the two meet without a seam', () => {
      for (const id of [...ids, undefined]) expect(unpack(coverTintRgb(id, mode)), String(id)).toEqual(coverPalette(coverHue(id), mode)[0]);
    });
  });
});

describe('generic file names', () => {
  it('knows the stems that name nothing, with or without a number, and digits-only ones', () => {
    for (const name of ['source.pdf', 'Source.PDF', 'document.epub', 'scan.png', 'file.txt', 'untitled.md', 'Untitled 2.md', 'scan_001.pdf', '0042.png', '7']) expect(isGenericName(name), name).toBe(true);
    for (const name of ['Rust-Book-1.99.epub', 'sources.pdf', 'source-notes.md', '2026-10-29.md', 'a1.pdf', 'report.pdf']) expect(isGenericName(name), name).toBe(false);
  });
});

describe('parentFolder', () => {
  it('is the last folder of either path style, and nothing for a bare name or a browser content id', () => {
    expect(parentFolder('/Users/x/work/refs/03_wwe_mag/source.pdf')).toBe('03_wwe_mag');
    expect(parentFolder('C:\\Users\\x\\refs\\09_dirtrider\\source.pdf')).toBe('09_dirtrider');
    expect(parentFolder('C:\\scan.pdf')).toBeUndefined(); // a drive root is no folder
    expect(parentFolder('\\\\?\\C:\\refs\\09_x\\source.pdf')).toBe('09_x'); // extended-length prefix
    expect(parentFolder('\\\\?\\C:\\source.pdf')).toBeUndefined();
    expect(parentFolder('source.pdf')).toBeUndefined();
    expect(parentFolder('folder:485e41a8d1a72538:03_wwe_mag/source.pdf')).toBe('03_wwe_mag'); // a watched folder's item id, as tabs and Home keep it
    expect(parentFolder('folder:485e41a8d1a72538:refs/09_x/issues/source.pdf')).toBe('issues');
    expect(parentFolder('folder:485e41a8d1a72538:source.pdf')).toBeUndefined(); // at the watched folder's top: the root id is no folder
    expect(parentFolder(`${'ab'.repeat(32)}/source.pdf`)).toBeUndefined();
  });
});

describe('displayTitle', () => {
  const generic = { name: 'source.pdf', path: '/refs/03_wwe_mag/source.pdf' };
  it('uses the folder for a generic file name', () => { expect(displayTitle(generic)).toBe('03_wwe_mag'); expect(displayTitle(generic, undefined, true)).toBe('03_wwe_mag'); });
  it('prefers an EPUB\'s own title, even over a generic name', () => { expect(displayTitle({ name: 'source.epub', path: '/refs/x/source.epub' }, ' Real Book ')).toBe('Real Book'); });
  it('keeps the file name (or its cleaned form) when the name says something', () => {
    const named = { name: 'Rust-Book-1.99.epub', path: '/refs/1-languages/Rust-Book-1.99.epub' };
    expect(displayTitle(named)).toBe('Rust-Book-1.99.epub');
    expect(displayTitle(named, undefined, true)).toBe('Rust Book');
  });
  it('falls back to the file name for a generic name with no folder to borrow', () => {
    expect(displayTitle({ name: 'source.pdf', path: 'source.pdf' })).toBe('source.pdf');
    expect(displayTitle({ name: 'source.pdf', path: `${'cd'.repeat(32)}/source.pdf` }, undefined, true)).toBe('source');
  });
});
