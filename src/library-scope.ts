// What the Library tab shows: the whole library, one of its shelves of documents, a collection, an indexed folder or a source. Pure
// (no DOM), so the saved form and the tab's title are unit-tested; `library.ts` owns the scope that is showing.
import type { Collection, SourceRoot } from './catalog-types';
import { collectionDisplayName } from './shelf';

export type Scope =
  | { kind: 'all' | 'favorites' | 'reading' | 'unfiled' }
  | { kind: 'collection' | 'source'; id: string }
  | { kind: 'folder'; id: string; path: string };

const plain = ['all', 'favorites', 'reading', 'unfiled'] as const;

/** The scope as saved with the Library tab: `all`, `collection:<id>`, `source:<name>`, `folder:<root id, URI-encoded>:<path>`. */
export function scopeKey(scope: Scope): string {
  if (scope.kind === 'folder') return `folder:${encodeURIComponent(scope.id)}:${scope.path}`;
  return 'id' in scope ? `${scope.kind}:${scope.id}` : scope.kind;
}

/** Reads a saved scope; anything unrecognised is `undefined`. */
export function parseScope(key: unknown): Scope | undefined {
  if (typeof key !== 'string') return undefined;
  const plainKind = plain.find(kind => kind === key);
  if (plainKind) return { kind: plainKind };
  const colon = key.indexOf(':'), kind = key.slice(0, colon), rest = key.slice(colon + 1);
  if (colon < 0 || !rest && kind !== 'folder') return undefined;
  if (kind === 'collection' || kind === 'source') return { kind, id: rest };
  if (kind !== 'folder') return undefined;
  const split = rest.indexOf(':');
  if (split <= 0) return undefined;
  try { return { kind: 'folder', id: decodeURIComponent(rest.slice(0, split)), path: rest.slice(split + 1) }; } catch { return undefined; }
}

export const sameScope = (a: Scope, b: Scope) => scopeKey(a) === scopeKey(b);

const plainTitles = { all: 'All documents', favorites: 'Favorites', reading: 'Continue reading', unfiled: 'Unfiled' } as const;

/**
 * The Library tab's title: the scope's name. A folder is its source's name and then the folder (`refs › 03_wwe_mag`), a collection its display
 * name, a source the name it was indexed under.
 */
export function scopeTitle(scope: Scope, library: { collections: readonly Collection[]; roots: readonly SourceRoot[] }): string {
  if (scope.kind === 'source') return scope.id;
  if (scope.kind === 'collection') { const named = library.collections.find(item => item.id === scope.id); return named ? collectionDisplayName(named.name) : 'Collection'; }
  if (scope.kind === 'folder') {
    const root = library.roots.find(item => item.id === scope.id)?.name ?? 'Folder', folder = scope.path.split('/').filter(Boolean).pop();
    return folder ? `${root} › ${folder}` : root;
  }
  return plainTitles[scope.kind];
}
