import { describe, expect, it } from 'vitest';
import { buildLibraryTree, filterTree, highlightRuns, openByDefault, sectionOf, treeRows, type TreeNode } from '../src/library-tree';
import { emptyLibrary, type Collection, type Library, type LibraryDocument } from '../src/catalog-types';

const doc = (path: string, extra: Partial<LibraryDocument> = {}): LibraryDocument => ({ path, name: path.split('/').pop()!, format: 'pdf', lastOpened: 0, collectionIds: [], favorite: false, tags: [], notes: '', ...extra });
const inRoot = (rootId: string, relativePath: string, extra: Partial<LibraryDocument> = {}) => doc(`/lib/${rootId}/${relativePath}`, { source: { sourceId: `folder:${rootId}`, recordId: relativePath, repository: rootId, sourcePath: relativePath, revision: '1', rootId, relativePath }, ...extra });
const collection = (id: string, name: string, parentId: string | null = null, sourceId?: string): Collection => ({ id, name, parentId, ...(sourceId ? { sourceId } : {}) });

/** The real catalog's shape, with made-up names: two source roots, many `source.pdf`, folder-derived collections, a user collection, loose files. */
function library(): Library {
  return {
    ...emptyLibrary(),
    roots: [{ id: 'b', name: 'reference-docs', path: null, managed: false }, { id: 'a', name: 'refs', path: null, managed: false }],
    collections: [
      collection('folder:a:collection', 'refs', null, 'folder:a'), collection('folder:a:03', '03_wwe_mag', 'folder:a:collection', 'folder:a'),
      collection('fashion', 'Fashion photo and catalogues'), collection('fashion-90s', '90s', 'fashion'),
    ],
    documents: [
      inRoot('a', '03_wwe_mag/source.pdf', { collectionIds: ['folder:a:03', 'fashion-90s'] }),
      inRoot('a', '09_dirtrider/source.pdf', { collectionIds: ['fashion'] }),
      inRoot('a', '09_dirtrider/issues/may.pdf'),
      inRoot('a', '10_misc/a/b/deep.pdf'),
      inRoot('a', '2_early/source.pdf'),
      inRoot('b', '1-languages/Rust-Book-1.99.epub', { format: 'epub' }),
      inRoot('b', 'top-level.md', { format: 'md' }),
      doc('/added/loose-one.pdf'), doc('/added/source.pdf'),
    ],
  };
}
const find = (nodes: TreeNode[], id: string): TreeNode | undefined => { for (const node of nodes) { if (node.id === id) return node; const inner = find(node.children, id); if (inner) return inner; } return undefined; };
const labels = (nodes: readonly TreeNode[]) => nodes.map(node => node.label);

describe('buildLibraryTree', () => {
  const tree = buildLibraryTree(library());
  const folders = sectionOf(tree, 'folders')!;

  it('makes a FOLDERS root per source root, in name order, each counting the documents beneath it', () => {
    expect(labels(folders.children)).toEqual(['reference-docs', 'refs']);
    expect(folders.children.map(node => node.count)).toEqual([2, 5]);
    expect(folders.count).toBe(7);
  });

  it('nests subfolders from the relative path: folders first in natural order, then documents, with counts of everything beneath', () => {
    const refs = folders.children[1]!;
    expect(labels(refs.children)).toEqual(['2_early', '03_wwe_mag', '09_dirtrider', '10_misc']);
    const dirt = refs.children[2]!;
    expect(dirt.kind).toBe('folder');
    expect(labels(dirt.children)).toEqual(['issues', 'source.pdf']);
    expect(dirt.count).toBe(2);
    const misc = refs.children[3]!;
    expect(misc.count).toBe(1);
    expect(labels(find([misc], 'f:a:10_misc/a')!.children)).toEqual(['b']);
    expect(find([misc], 'd:/lib/a/10_misc/a/b/deep.pdf')!.kind).toBe('document');
  });

  it('keeps same-named documents apart by identity, and lists a document directly under its root at the root', () => {
    expect(find(folders.children, 'd:/lib/a/03_wwe_mag/source.pdf')!.doc!.path).toBe('/lib/a/03_wwe_mag/source.pdf');
    expect(find(folders.children, 'd:/lib/a/09_dirtrider/source.pdf')!.doc!.path).toBe('/lib/a/09_dirtrider/source.pdf');
    expect(labels(folders.children[0]!.children)).toEqual(['1-languages', 'top-level.md']);
  });

  it('scopes roots and folders for the board', () => {
    expect(folders.children[1]!.scope).toEqual({ kind: 'folder', rootId: 'a', path: '' });
    expect(find(folders.children, 'f:a:09_dirtrider/issues')!.scope).toEqual({ kind: 'folder', rootId: 'a', path: '09_dirtrider/issues' });
  });

  it('records each document\'s ancestors outermost first, so opening it can expand them', () => {
    expect(tree.ancestors.get('/lib/a/09_dirtrider/issues/may.pdf')).toEqual(['s:folders', 'r:a', 'f:a:09_dirtrider', 'f:a:09_dirtrider/issues']);
    expect(tree.ancestors.get('/added/loose-one.pdf')).toBeUndefined();
  });

  it('lists only user collections, nested by parentId, with unique documents beneath each; folder-derived collections stay in FOLDERS', () => {
    const collections = sectionOf(tree, 'collections')!;
    expect(labels(collections.children)).toEqual(['Fashion photo and catalogues']);
    const fashion = collections.children[0]!;
    expect(fashion.count).toBe(2);
    expect(labels(fashion.children)).toEqual(['90s', '09_dirtrider']);
    expect(fashion.children[0]!.kind).toBe('collection');
    expect(fashion.children[0]!.count).toBe(1);
    expect(fashion.scope).toEqual({ kind: 'collection', id: 'fashion' });
    expect(find([collections], 'c:folder:a:03')).toBeUndefined();
  });

  it('lists loose files (documents under no source root), with a generic name shown by its folder', () => {
    const loose = sectionOf(tree, 'loose')!;
    expect(labels(loose.children)).toEqual(['added', 'loose-one.pdf']);
    expect(loose.count).toBe(2);
  });

  it('leaves empty sections out, and a lone document with no root is loose', () => {
    expect(buildLibraryTree(emptyLibrary()).sections).toEqual([]);
    const only = buildLibraryTree({ ...emptyLibrary(), documents: [doc('/x/one.pdf')] });
    expect(only.sections.map(node => node.label)).toEqual(['Loose files']);
    // A document whose root is unknown is loose too: nothing is hidden.
    const orphan = buildLibraryTree({ ...emptyLibrary(), documents: [inRoot('gone', 'a/b.pdf')] });
    expect(orphan.sections.map(node => node.label)).toEqual(['Loose files']);
  });

  it('shows an empty personal collection, and survives a parent cycle and an unknown parent without hiding anything', () => {
    const odd = buildLibraryTree({ ...emptyLibrary(), collections: [collection('x', 'x', 'y'), collection('y', 'y', 'x'), collection('z', 'z', 'missing')] });
    const top = sectionOf(odd, 'collections')!;
    expect(find([top], 'c:x')).toBeDefined(); expect(find([top], 'c:y')).toBeDefined(); expect(find([top], 'c:z')!.count).toBe(0);
  });
});

describe('treeRows', () => {
  const tree = buildLibraryTree(library());
  it('lists only what its open ancestors show, with ARIA levels and positions', () => {
    const rows = treeRows(tree.sections, id => id === 's:folders' || id === 'r:a');
    expect(rows.map(row => row.node.label)).toEqual(['Folders', 'reference-docs', 'refs', '2_early', '03_wwe_mag', '09_dirtrider', '10_misc', 'Collections', 'Loose files']);
    expect(rows[0]).toMatchObject({ level: 1, setSize: 3, position: 1 });
    expect(rows[3]).toMatchObject({ level: 3, setSize: 4, position: 1 });
  });
  it('opens sections and roots by default and nothing deeper', () => {
    const folders = sectionOf(tree, 'folders')!;
    expect([folders, folders.children[0]!, folders.children[0]!.children[0]!].map(openByDefault)).toEqual([true, true, false]);
  });
});

describe('filterTree', () => {
  const tree = buildLibraryTree(library());
  it('is the whole tree for an empty query', () => {
    const all = filterTree(tree.sections, '  ');
    expect(all.sections).toEqual(tree.sections); expect(all.documents).toBe(9); expect(all.open.size).toBe(0);
  });
  it('keeps matches with their ancestors, opens those ancestors, and recounts', () => {
    const result = filterTree(tree.sections, 'deep');
    expect(result.documents).toBe(1);
    expect(labels(result.sections)).toEqual(['Folders']);
    expect([...result.open].sort()).toEqual(['f:a:10_misc', 'f:a:10_misc/a', 'f:a:10_misc/a/b', 'r:a', 's:folders']);
    expect(find(result.sections, 'r:a')!.count).toBe(1);
    expect(find(result.sections, 'f:a:09_dirtrider')).toBeUndefined();
  });
  it('matches a folder\'s name for everything inside it, and words split between folder and file', () => {
    const wwe = filterTree(tree.sections, 'wwe');
    expect(wwe.documents).toBe(1); // the one document, found in FOLDERS and in COLLECTIONS' 90s
    expect(labels(wwe.sections)).toEqual(['Folders', 'Collections']);
    const split = filterTree(tree.sections, 'wwe source');
    expect(find(split.sections, 'd:/lib/a/03_wwe_mag/source.pdf')).toBeDefined();
    expect(find(split.sections, 'd:/lib/a/09_dirtrider/source.pdf')).toBeUndefined();
  });
  it('can use what else a document is known by, and finds nothing for an unknown word', () => {
    const titled = filterTree(tree.sections, 'pride', item => item.format === 'epub' ? 'Pride and Prejudice' : '');
    expect(titled.documents).toBe(1);
    expect(filterTree(tree.sections, 'zzz').sections).toEqual([]);
  });
});

describe('highlightRuns', () => {
  it('marks every word wherever it occurs, case-insensitively, in order', () => {
    expect(highlightRuns('03_WWE_mag', 'wwe MAG')).toEqual([['03_', false], ['WWE', true], ['_', false], ['mag', true]]);
    expect(highlightRuns('source.pdf', 'xyz')).toEqual([['source.pdf', false]]);
    expect(highlightRuns('abc', '')).toEqual([['abc', false]]);
  });
});
