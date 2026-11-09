import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assignCoverSlots, collectionDisplayName, coverHash, coverHue, coverInkRgb, coverMotif, coverSecondaryInk, coverTintRgb, fileTitle, fileVersion, groupIntoShelves } from '../src/shelf';
import { motifs } from '../src/dither';
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
  it('gives the same collection the same hue and motif every time, and the different ones differ', () => {
    for (const id of ids) { expect(coverHue(id)).toBe(coverHue(id)); expect(coverMotif(id)).toBe(coverMotif(id)); expect(coverHue(id)).toBeGreaterThanOrEqual(0); expect(coverHue(id)).toBeLessThan(360); }
    expect(new Set(ids.map(coverHue)).size).toBeGreaterThan(7);
    expect(new Set(ids.map(id => coverMotif(id))).size).toBeGreaterThanOrEqual(3);
    expect(coverMotif(undefined)).toBe('neutral');
    expect(coverHash('a')).not.toBe(coverHash('b'));
    for (const id of ids) expect(motifs).toContain(coverMotif(id));
  });
  it('never gives two siblings the same motif or a close hue, whatever their ids hash to', () => {
    const siblings = ['languages', 'creative-apps', 'libraries-tools', 'x', 'y', 'z'];
    assignCoverSlots([siblings]);
    try {
      expect(new Set(siblings.map(id => coverMotif(id))).size).toBe(siblings.length);
      const hues = siblings.map(coverHue).sort((a, b) => a - b);
      const gaps = hues.map((hue, index) => (index ? hue - hues[index - 1] : hue + 360 - hues[hues.length - 1]));
      expect(Math.min(...gaps)).toBeGreaterThanOrEqual(40);
    } finally { assignCoverSlots([]); }
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

  describe.each(palettes.flatMap(name => (['light', 'dark'] as const).map((mode, column) => ({ name: `${name} ${mode}`, mode, column, found: tokens(name) }))))('$name', ({ mode, column, found }) => {
    const ink = found.ink[column], muted = found.muted[column], hover = found.hover[column];
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
    it('reads on the neutral tint of a document with no collection', () => {
      expect(contrast(ink, hover)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(small, hover)).toBeGreaterThanOrEqual(4.5);
    });
    it('keeps the art a quiet texture: its ink sits 1.4 to 1.9 times the tint\'s luminance step away', () => {
      for (const id of ids) {
        const ratio = contrast(unpack(coverInkRgb(id, mode)), unpack(coverTintRgb(id, mode)));
        expect(ratio, id).toBeGreaterThanOrEqual(1.4); expect(ratio, id).toBeLessThanOrEqual(1.9);
      }
    });
  });
});
