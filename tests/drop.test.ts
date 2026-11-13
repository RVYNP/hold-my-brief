import { describe, expect, it } from 'vitest';
import { baseName, ghostLabel, insertionIndex, isDocumentName, overlayNames, splitDropped, unsupportedNotice } from '../src/drop';

describe('what can be dropped', () => {
  it('knows the document and image types, whatever the case', () => {
    for (const name of ['a.pdf', 'B.EPUB', 'notes.md', 'notes.markdown', 'x.txt', 'p.png', 'p.JPG', 'p.jpeg', 'p.webp', 'p.gif', 'p.avif', 'p.bmp']) expect(isDocumentName(name), name).toBe(true);
    for (const name of ['a.zip', 'a.docx', 'pdf', '.pdf', 'archive.pdf.exe', 'noextension', '']) expect(isDocumentName(name), name).toBe(false);
  });

  it('takes the name from a path of either kind', () => {
    expect(baseName('C:\\Users\\me\\Books\\Dune.epub')).toBe('Dune.epub');
    expect(baseName('/Users/me/Books/Dune.epub')).toBe('Dune.epub');
    expect(baseName('Dune.epub')).toBe('Dune.epub');
  });

  it('splits a drop into what opens and what is listed as unsupported, both in drop order', () => {
    const paths = ['/a/one.pdf', '/a/two.zip', '/a/three.txt', '/a/four.docx', '/a/five.png'];
    expect(splitDropped(paths, baseName)).toEqual({ openable: ['/a/one.pdf', '/a/three.txt', '/a/five.png'], unsupported: ['two.zip', 'four.docx'] });
    expect(splitDropped([], baseName)).toEqual({ openable: [], unsupported: [] });
  });

  it('words one notice for everything left out, and none when nothing is', () => {
    expect(unsupportedNotice([])).toBeUndefined();
    expect(unsupportedNotice(['a.zip'])).toBe('Not opened, unsupported file type: a.zip. Drop a PDF, EPUB, Markdown, text or image file.');
    expect(unsupportedNotice(['a.zip', 'b.docx'])).toContain('a.zip, b.docx');
    expect(unsupportedNotice(['1', '2', '3', '4', '5', '6'])).toContain('1, 2, 3, 4 and 2 more');
  });
});

describe('where the tabs go', () => {
  it('opens at the marked slot over the strip, kept inside it', () => {
    expect(insertionIndex(0, 2, 4)).toBe(0);
    expect(insertionIndex(2, 0, 4)).toBe(2);
    expect(insertionIndex(4, 0, 4)).toBe(4);
    expect(insertionIndex(9, 0, 4)).toBe(4);
    expect(insertionIndex(-3, 0, 4)).toBe(0);
  });

  it('opens after the active tab anywhere else', () => {
    expect(insertionIndex(undefined, 0, 4)).toBe(1);
    expect(insertionIndex(undefined, 2, 4)).toBe(3);
    expect(insertionIndex(undefined, 3, 4)).toBe(4);
  });

  it('appends when Home is showing or nothing is open', () => {
    expect(insertionIndex(undefined, -1, 4)).toBe(4);
    expect(insertionIndex(undefined, -1, 0)).toBe(0);
  });
});

describe('the words on the overlay and the ghost tab', () => {
  it('lists a few names and counts the rest', () => {
    expect(overlayNames([])).toBe('');
    expect(overlayNames(['a.pdf'])).toBe('a.pdf');
    expect(overlayNames(['a.pdf', 'b.md', 'c.txt'])).toBe('a.pdf  ·  b.md  ·  c.txt');
    expect(overlayNames(['a', 'b', 'c', 'd', 'e'])).toBe('a  ·  b  ·  c  ·  +2 more');
  });

  it('counts files on the ghost tab', () => {
    expect(ghostLabel(1)).toBe('+ 1 file');
    expect(ghostLabel(3)).toBe('+ 3 files');
  });
});
