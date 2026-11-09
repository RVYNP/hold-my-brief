import { describe, expect, it } from 'vitest';
import { emptyLibrary, type Library } from '../src/catalog-types';
import { applyLibraryChange, localDocument, normalizeLibrary } from '../src/library-model';

const create = (library: Library, id: string, name: string, parentId: string | null = null) => applyLibraryChange(library, { action: 'createCollection', id, name, parentId });

describe('library migration and personal organization', () => {
  it('preserves a legacy assignment, favorite and last-read time without reviving a deliberately empty assignment', () => {
    const library = normalizeLibrary({
      documents: [
        { path: 'book.pdf', name: 'Book', format: 'pdf', lastOpened: 42, collectionId: 'anatomy', favorite: true },
        { path: 'note.md', name: 'Note', format: 'md', lastOpened: 7, collectionId: 'anatomy', collectionIds: [], favorite: false },
      ], collections: [{ id: 'anatomy', name: 'Anatomy' }],
    });
    expect(library.documents[0]).toMatchObject({ collectionIds: ['anatomy'], favorite: true, lastOpened: 42 });
    expect(library.documents[1].collectionIds).toEqual([]);
    expect(library.documents[0]).not.toHaveProperty('collectionId');
    expect(normalizeLibrary(library)).toEqual(library);
  });

  it('rejects a descendant move without altering the existing tree', () => {
    const library = emptyLibrary();
    create(library, 'research', 'Research'); create(library, 'anatomy', 'Anatomy', 'research');
    const before = structuredClone(library);
    expect(() => applyLibraryChange(library, { action: 'moveCollection', id: 'research', parentId: 'anatomy' })).toThrow(/descendants/);
    expect(library).toEqual(before);
  });

  it('keeps an item in multiple collections and removes only the deleted membership', () => {
    const library = emptyLibrary();
    create(library, 'anatomy', 'Anatomy'); create(library, 'project', 'Project'); create(library, 'head', 'Head', 'anatomy');
    library.documents.push(localDocument('head.pdf', 'Head', 'pdf'));
    applyLibraryChange(library, { action: 'updateDocument', path: 'head.pdf', collectionIds: ['anatomy', 'project'], favorite: true, tags: ['head'], notes: 'Page 12' });
    applyLibraryChange(library, { action: 'deleteCollection', id: 'anatomy' });
    expect(library.documents[0]).toMatchObject({ path: 'head.pdf', collectionIds: ['project'], favorite: true, tags: ['head'], notes: 'Page 12' });
    expect(library.collections.find(item => item.id === 'head')?.parentId).toBeNull();
  });

  it('sets and clears a generated cover seed', () => {
    const library = emptyLibrary();
    library.documents.push(localDocument('a.pdf', 'A', 'pdf'));
    applyLibraryChange(library, { action: 'setCoverSeed', path: 'a.pdf', coverSeed: 4242 });
    expect(library.documents[0].coverSeed).toBe(4242);
    applyLibraryChange(library, { action: 'setCoverSeed', path: 'a.pdf', coverSeed: null });
    expect('coverSeed' in library.documents[0]).toBe(false);
    expect(() => applyLibraryChange(library, { action: 'setCoverSeed', path: 'a.pdf', coverSeed: -1 })).toThrow(/32-bit/);
    expect(() => applyLibraryChange(library, { action: 'setCoverSeed', path: 'missing', coverSeed: 1 })).toThrow(/no longer/);
  });

  it('preserves source memberships when personal organization changes and refuses invented source memberships', () => {
    const library = emptyLibrary();
    library.collections.push({ id: 'source-board', name: 'Board', parentId: null, sourceId: 'folder:0123456789abcdef' });
    library.collections.push({ id: 'other-board', name: 'Other', parentId: null, sourceId: 'folder:0123456789abcdef' });
    create(library, 'favorites', 'Project picks');
    library.documents.push({ ...localDocument('ref:portrait', 'Portrait', 'png'), collectionIds: ['source-board'] });
    const change = { action: 'updateDocument' as const, path: 'ref:portrait', collectionIds: ['favorites'], favorite: true, tags: ['lighting'], notes: 'Use the rim light' };
    applyLibraryChange(library, change);
    expect(library.documents[0].collectionIds).toEqual(['source-board', 'favorites']);
    const before = structuredClone(library);
    expect(() => applyLibraryChange(library, { ...change, collectionIds: ['other-board'] })).toThrow(/source/);
    expect(library).toEqual(before);
  });

  it('refuses a delete that would create ambiguous sibling collections', () => {
    const library = emptyLibrary();
    create(library, 'parent', 'Research'); create(library, 'nested', 'Notes', 'parent'); create(library, 'root-notes', 'Notes');
    const before = structuredClone(library);
    expect(() => applyLibraryChange(library, { action: 'deleteCollection', id: 'parent' })).toThrow(/name/);
    expect(library).toEqual(before);
  });
});
