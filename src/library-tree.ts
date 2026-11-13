// The info rail's tree: the library as nested folders with the documents inside them. Pure (no DOM), so the shape,
// the counts, the filter and the expand rules are unit-tested; `library-tree-view.ts` paints it.
//
// Three sections, each a top-level node:
//   FOLDERS      one root per indexed source folder, subfolders from each document's relative path, documents as leaves.
//   COLLECTIONS  the user's own collections nested by parentId, documents as leaves. A collection that mirrors an
//                indexed folder (it carries a `sourceId`) is not listed: FOLDERS already shows that structure.
//   LOOSE FILES  documents that are not under a source root (added by hand).
import type { Collection, Library, LibraryDocument } from './catalog-types';
import { collectionDisplayName, compareCollections, displayTitle } from './shelf';

export type TreeKind = 'section' | 'root' | 'folder' | 'collection' | 'document';
export type SectionId = 'folders' | 'collections' | 'loose';
/** What a folder or collection node stands for when the board is scoped to it. */
export type TreeScope = { kind: 'folder'; rootId: string; path: string } | { kind: 'collection'; id: string };
export type TreeNode = {
  /** Unique in the whole tree, and stable across rebuilds: expand state is saved by it. */
  id: string;
  kind: TreeKind;
  label: string;
  /** Documents beneath this node (a document: 1). */
  count: number;
  children: TreeNode[];
  doc?: LibraryDocument;
  scope?: TreeScope;
};
export type LibraryTree = {
  /** The non-empty sections, in the order they are shown. */
  sections: TreeNode[];
  /** Where each document sits in FOLDERS: the ids of its ancestors, outermost first (section, root, folders). */
  ancestors: Map<string, string[]>;
  /** Every document in the library. */
  total: number;
};

const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }) || (a < b ? -1 : a > b ? 1 : 0);
const sectionLabels: Record<SectionId, string> = { folders: 'Folders', collections: 'Collections', loose: 'Loose files' };
export const sectionId = (section: SectionId) => `s:${section}`;

function section(id: SectionId, children: TreeNode[]): TreeNode {
  return { id: sectionId(id), kind: 'section', label: sectionLabels[id], count: children.reduce((sum, node) => sum + (node.kind === 'document' ? 1 : node.count), 0), children };
}

/** Folders first, then documents, each in natural name order (so `2-x` comes before `10-x`). */
function sortChildren(nodes: TreeNode[]) {
  nodes.sort((a, b) => (a.kind === 'document' ? 1 : 0) - (b.kind === 'document' ? 1 : 0) || natural(a.label, b.label) || natural(a.id, b.id));
}

const documentNode = (id: string, label: string, doc: LibraryDocument): TreeNode => ({ id, kind: 'document', label, count: 1, children: [], doc });

type Trie = { node: TreeNode; folders: Map<string, Trie> };

function foldersSection(library: Library, ancestors: Map<string, string[]>, loose: LibraryDocument[]): TreeNode | undefined {
  const roots = new Map(library.roots.map(root => [root.id, root]));
  const tries = new Map<string, Trie>();
  for (const doc of library.documents) {
    const rootId = doc.source?.rootId, root = rootId ? roots.get(rootId) : undefined;
    if (!root || !rootId) { loose.push(doc); continue; }
    let trie = tries.get(rootId);
    if (!trie) { trie = { node: { id: `r:${rootId}`, kind: 'root', label: root.name, count: 0, children: [], scope: { kind: 'folder', rootId, path: '' } }, folders: new Map() }; tries.set(rootId, trie); }
    const parts = (doc.source?.relativePath ?? doc.name).split(/[\\/]/).filter(Boolean);
    const dirs = parts.slice(0, -1);
    const trail = [sectionId('folders'), trie.node.id];
    let at = trie; let path = '';
    for (const dir of dirs) {
      path = path ? `${path}/${dir}` : dir;
      let next = at.folders.get(dir);
      if (!next) { next = { node: { id: `f:${rootId}:${path}`, kind: 'folder', label: dir, count: 0, children: [], scope: { kind: 'folder', rootId, path } }, folders: new Map() }; at.folders.set(dir, next); at.node.children.push(next.node); }
      at = next; trail.push(next.node.id);
    }
    at.node.children.push(documentNode(`d:${doc.path}`, doc.name, doc));
    ancestors.set(doc.path, trail);
  }
  if (!tries.size) return undefined;
  const finish = (node: TreeNode): number => {
    node.count = node.kind === 'document' ? 1 : node.children.reduce((sum, child) => sum + finish(child), 0);
    sortChildren(node.children);
    return node.count;
  };
  const nodes = [...tries.values()].map(trie => trie.node);
  for (const node of nodes) finish(node);
  nodes.sort((a, b) => natural(a.label, b.label) || natural(a.id, b.id));
  return section('folders', nodes);
}

function collectionsSection(library: Library): TreeNode | undefined {
  const personal = library.collections.filter(collection => !collection.sourceId);
  if (!personal.length) return undefined;
  const ids = new Set(personal.map(collection => collection.id));
  const byParent = new Map<string | null, Collection[]>();
  for (const collection of personal) {
    // A parent that is not a personal collection (or is missing) leaves the collection at the top, so nothing is hidden.
    const parent = collection.parentId && ids.has(collection.parentId) ? collection.parentId : null;
    byParent.set(parent, [...(byParent.get(parent) ?? []), collection]);
  }
  const members = new Map<string, LibraryDocument[]>();
  for (const doc of library.documents) for (const id of new Set(doc.collectionIds)) if (ids.has(id)) members.set(id, [...(members.get(id) ?? []), doc]);
  const seen = new Set<string>();
  const build = (collection: Collection): TreeNode | undefined => {
    if (seen.has(collection.id)) return undefined; // a corrupt parent cycle: the first visit wins
    seen.add(collection.id);
    const subs = (byParent.get(collection.id) ?? []).sort(compareCollections).map(build).filter((node): node is TreeNode => Boolean(node));
    const docs = (members.get(collection.id) ?? []).map(doc => documentNode(`cd:${collection.id}:${doc.path}`, displayTitle(doc), doc));
    sortChildren(docs);
    const beneath = new Set<string>(); for (const doc of members.get(collection.id) ?? []) beneath.add(doc.path);
    for (const sub of subs) collect(sub, beneath);
    return { id: `c:${collection.id}`, kind: 'collection', label: collectionDisplayName(collection.name), count: beneath.size, children: [...subs, ...docs], scope: { kind: 'collection', id: collection.id } };
  };
  const top = (byParent.get(null) ?? []).sort(compareCollections).map(build).filter((node): node is TreeNode => Boolean(node));
  // Collections left out by a cycle still show, at the top.
  for (const collection of personal) if (!seen.has(collection.id)) { const node = build(collection); if (node) top.push(node); }
  return top.length ? section('collections', top) : undefined;
}

function collect(node: TreeNode, into: Set<string>) {
  if (node.doc) into.add(node.doc.path); else for (const child of node.children) collect(child, into);
}

export function buildLibraryTree(library: Library): LibraryTree {
  const ancestors = new Map<string, string[]>(); const loose: LibraryDocument[] = [];
  const folders = foldersSection(library, ancestors, loose);
  const collections = collectionsSection(library);
  const looseNodes = loose.map(doc => documentNode(`l:${doc.path}`, displayTitle(doc), doc));
  sortChildren(looseNodes);
  const sections = [folders, collections, looseNodes.length ? section('loose', looseNodes) : undefined].filter((node): node is TreeNode => Boolean(node));
  return { sections, ancestors, total: library.documents.length };
}

/** A section's tree alone (the Collections view). */
export const sectionOf = (tree: LibraryTree, id: SectionId): TreeNode | undefined => tree.sections.find(node => node.id === sectionId(id));

export type TreeRow = { node: TreeNode; /** 1 for a section caption, 2 for what sits directly in it. */ level: number; setSize: number; position: number };

/** The rows on screen: every node whose ancestors are all open, in order. A section stays a caption row; its children sit one level below. */
export function treeRows(sections: readonly TreeNode[], isOpen: (id: string) => boolean): TreeRow[] {
  const rows: TreeRow[] = [];
  const walk = (nodes: readonly TreeNode[], level: number) => {
    nodes.forEach((node, index) => {
      rows.push({ node, level, setSize: nodes.length, position: index + 1 });
      if (node.children.length && isOpen(node.id)) walk(node.children, level + 1);
    });
  };
  walk(sections, 1);
  return rows;
}

/** A node is open unless its saved state says otherwise: sections and source roots start open, everything beneath starts closed. */
export const openByDefault = (node: TreeNode) => node.kind === 'section' || node.kind === 'root';

const words = (query: string) => query.toLocaleLowerCase().split(/\s+/).filter(Boolean);

/** How many different documents `nodes` hold: one in a folder and in a collection is still one. */
function uniqueDocuments(nodes: readonly TreeNode[]): number {
  const paths = new Set<string>(); for (const node of nodes) collect(node, paths);
  return paths.size;
}

export type TreeFilter = { sections: TreeNode[]; /** Every folder, collection and section that still has something in it: the filter opens them all, so a match is never hidden. */ open: Set<string>; documents: number };

/**
 * The tree narrowed to `query` (every word must be found). A node's text is its own name plus the names of the folders it
 * sits in, so `wwe source` finds `03_wwe_mag/source.pdf`; `extra` adds what else a document is known by (its title, tags). A folder is
 * kept when anything inside it is; one that matches by name keeps everything inside it. Counts are recounted for what is left.
 */
export function filterTree(sections: readonly TreeNode[], query: string, extra: (doc: LibraryDocument) => string = () => ''): TreeFilter {
  const needles = words(query);
  if (!needles.length) return { sections: [...sections], open: new Set(), documents: uniqueDocuments(sections) };
  const open = new Set<string>();
  const visit = (node: TreeNode, trail: string): TreeNode | undefined => {
    const own = node.kind === 'section' ? '' : node.label.toLocaleLowerCase();
    const text = `${trail} ${own} ${node.doc ? extra(node.doc).toLocaleLowerCase() : ''}`;
    if (node.doc) return needles.every(word => text.includes(word)) ? node : undefined;
    const below = node.kind === 'section' ? trail : `${trail} ${own}`;
    const children = node.children.map(child => visit(child, below)).filter((child): child is TreeNode => Boolean(child));
    if (!children.length) return undefined;
    open.add(node.id);
    return { ...node, children, count: children.reduce((sum, child) => sum + child.count, 0) };
  };
  const kept = sections.map(node => visit(node, '')).filter((node): node is TreeNode => Boolean(node));
  return { sections: kept, open, documents: uniqueDocuments(kept) };
}

/** The pieces of `label` to emphasise for `query`: `[text, matched]` runs, in order. A label no word touches is one unmatched run. */
export function highlightRuns(label: string, query: string): [string, boolean][] {
  const needles = words(query); if (!needles.length) return [[label, false]];
  const lower = label.toLocaleLowerCase(); const marked = new Array<boolean>(label.length).fill(false);
  if (lower.length !== label.length) return [[label, false]]; // case mapping changed the length: skip rather than mis-mark
  for (const word of needles) for (let at = lower.indexOf(word); at >= 0; at = lower.indexOf(word, at + word.length)) marked.fill(true, at, at + word.length);
  const runs: [string, boolean][] = [];
  for (let index = 0; index < label.length; index++) {
    const last = runs[runs.length - 1];
    if (last && last[1] === marked[index]) last[0] += label[index]; else runs.push([label[index], marked[index]]);
  }
  return runs;
}
