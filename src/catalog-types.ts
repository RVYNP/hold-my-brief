export type Availability = 'ready' | 'missing';
export type Provenance = {
  sourceId: string;
  recordId: string;
  repository: string;
  sourcePath: string;
  revision: string;
  rootId?: string;
  relativePath?: string;
  removed?: boolean;
};
export type LibraryDocument = {
  path: string;
  name: string;
  format: string;
  lastOpened: number | string;
  collectionIds: string[];
  favorite: boolean;
  tags: string[];
  notes: string;
  source?: Provenance;
  coverSeed?: number;
  availability?: Availability;
};
export type Collection = {
  id: string;
  name: string;
  parentId: string | null;
  sourceId?: string;
  removed?: boolean;
};
export type SourceRoot = { id: string; name: string; path: string | null; managed: boolean };
export type ImportReceipt = {
  sourceId: string;
  repository: string;
  revision: string;
  sections: string[];
  collectionIds: string[];
  importedAt: number;
};
export type Library = {
  documents: LibraryDocument[];
  collections: Collection[];
  roots: SourceRoot[];
  imports: ImportReceipt[];
};
export type LibraryChange =
  | { action: 'createCollection'; id: string; name: string; parentId: string | null }
  | { action: 'renameCollection'; id: string; name: string }
  | { action: 'moveCollection'; id: string; parentId: string | null }
  | { action: 'deleteCollection'; id: string }
  | { action: 'updateDocument'; path: string; collectionIds: string[]; favorite: boolean; tags: string[]; notes: string }
  | { action: 'removeDocument'; path: string }
  | { action: 'setCoverSeed'; path: string; coverSeed: number | null };
export const emptyLibrary = (): Library => ({ documents: [], collections: [], roots: [], imports: [] });
