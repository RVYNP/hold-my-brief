import { emptyLibrary, type Collection, type Library, type LibraryChange, type LibraryDocument } from './catalog-types';

export function normalizeLibrary(value: unknown): Library {
  if (value === undefined) return emptyLibrary();
  if (!value || typeof value !== 'object') throw Error('Saved library is unreadable. The original has not been replaced.');
  const saved = value as Partial<Library>;
  if (!Array.isArray(saved.documents) || !Array.isArray(saved.collections)) throw Error('Saved library is unreadable. The original has not been replaced.');
  return {
    documents: saved.documents.map(document => {
      const legacy = document as LibraryDocument & { collectionId?: string | null };
      const { collectionId, ...current } = legacy;
      if (typeof current.path !== 'string' || typeof current.name !== 'string') throw Error('Saved library contains an invalid document.');
      return { ...current, collectionIds: current.collectionIds ?? (collectionId ? [collectionId] : []), tags: current.tags ?? [], notes: current.notes ?? '' };
    }),
    collections: saved.collections.map(collection => ({ ...collection, parentId: collection.parentId ?? null })),
    roots: saved.roots ?? [],
    imports: saved.imports ?? [],
  };
}

export function localDocument(path: string, name: string, format: string, collectionId: string | null = null): LibraryDocument {
  return { path, name, format, lastOpened: 0, collectionIds: collectionId ? [collectionId] : [], favorite: false, tags: [], notes: '', availability: 'ready' };
}

export function requireCollection(library: Library, id: string | null): Collection | undefined {
  if (id === null) return undefined;
  const collection = library.collections.find(item => item.id === id);
  if (!collection) throw Error('Collection no longer exists.');
  return collection;
}

function mutableCollection(library: Library, id: string): Collection {
  const collection = requireCollection(library, id)!;
  if (collection.sourceId) throw Error('Indexed folder collections are managed by their source folder. Create a personal collection instead.');
  return collection;
}

function validParent(library: Library, parentId: string | null, id?: string) {
  let current = requireCollection(library, parentId);
  const visited = new Set<string>();
  while (current) {
    if (current.id === id || visited.has(current.id)) throw Error('A collection cannot be inside itself or its descendants.');
    if (current.sourceId) throw Error('Choose a personal collection as the parent.');
    visited.add(current.id);
    current = requireCollection(library, current.parentId);
  }
}

function collectionName(library: Library, name: string, parentId: string | null, except?: string): string {
  const trimmed = name.trim();
  if (!trimmed || Array.from(trimmed).length > 120) throw Error('Use a collection name between 1 and 120 characters.');
  if (library.collections.some(item => item.id !== except && item.parentId === parentId && item.name.toLowerCase() === trimmed.toLowerCase())) {
    throw Error('A collection with this name already exists in this folder.');
  }
  return trimmed;
}

export function applyLibraryChange(library: Library, change: LibraryChange) {
  switch (change.action) {
    case 'createCollection': {
      if (!change.id.trim() || change.id.length > 120 || library.collections.some(item => item.id === change.id)) throw Error('Collection ID must be unique and nonempty.');
      validParent(library, change.parentId);
      library.collections.push({ id: change.id, name: collectionName(library, change.name, change.parentId), parentId: change.parentId });
      break;
    }
    case 'renameCollection': {
      const collection = mutableCollection(library, change.id);
      collection.name = collectionName(library, change.name, collection.parentId, change.id);
      break;
    }
    case 'moveCollection': {
      const collection = mutableCollection(library, change.id);
      validParent(library, change.parentId, change.id);
      collectionName(library, collection.name, change.parentId, change.id);
      collection.parentId = change.parentId;
      break;
    }
    case 'deleteCollection': {
      const collection = mutableCollection(library, change.id);
      const children = library.collections.filter(item => item.parentId === change.id);
      for (const child of children) collectionName(library, child.name, collection.parentId, child.id);
      for (const child of children) child.parentId = collection.parentId;
      library.collections = library.collections.filter(item => item.id !== change.id);
      for (const document of library.documents) document.collectionIds = document.collectionIds.filter(id => id !== change.id);
      break;
    }
    case 'updateDocument': {
      const document = library.documents.find(item => item.path === change.path);
      if (!document) throw Error('Document is no longer in the library.');
      for (const id of change.collectionIds) requireCollection(library, id);
      const imported = new Set(library.collections.filter(item => item.sourceId).map(item => item.id));
      const owned = document.collectionIds.filter(id => imported.has(id));
      if (change.collectionIds.some(id => imported.has(id) && !owned.includes(id))) throw Error('Indexed folder memberships are managed by their source folder.');
      if (change.notes.length > 65536) throw Error('Notes must be no longer than 65,536 characters.');
      const tags = [...new Set(change.tags.map(tag => tag.trim()).filter(Boolean))];
      if (tags.length > 100 || tags.some(tag => Array.from(tag).length > 80)) throw Error('Use at most 100 tags, each no longer than 80 characters.');
      document.collectionIds = [...new Set([...owned, ...change.collectionIds])];
      document.favorite = change.favorite;
      document.tags = tags;
      document.notes = change.notes;
      break;
    }
    case 'removeDocument': {
      if (!library.documents.some(item => item.path === change.path)) throw Error('Document is no longer in the library.');
      library.documents = library.documents.filter(item => item.path !== change.path);
      break;
    }
    case 'setCoverSeed': {
      const document = library.documents.find(item => item.path === change.path);
      if (!document) throw Error('Document is no longer in the library.');
      if (change.coverSeed === null) delete document.coverSeed;
      else if (Number.isInteger(change.coverSeed) && change.coverSeed >= 0 && change.coverSeed <= 0xffffffff) document.coverSeed = change.coverSeed;
      else throw Error('Cover seed must be an unsigned 32-bit integer.');
      break;
    }
  }
}
