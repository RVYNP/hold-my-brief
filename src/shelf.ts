// Pure helpers for the reference shelf: display names, the version in a file name, generated covers and
// the grouping of a collection's documents into shelves. No DOM, so every edge stays testable.
import { oklchToRgb } from './colour';
import { artTone, motifFor, type Motif } from './dither';

const knownExtension = /\.(pdf|epub|md|markdown|txt|png|jpe?g|webp|gif|avif|bmp)$/i;
// A date may be the whole name (`2026-10-29.md`); a number or `master` needs a name before it.
const trailingVersion = /(?:^|-)(\d{4}-\d{2}-\d{2})$|-(v?\d+(?:\.\d+)*|master)$/;

/** A file name without its extension (only the ones the library knows, so `Rust-Book-1.99` keeps `.99`). */
export function withoutExtension(name: string): string { return name.replace(knownExtension, ''); }

/** The version or date a file name ends with, if any: `Rust-Book-1.99.epub` -> `1.99`, `Docs-2026-10-29.epub` -> `2026-10-29`, `FFmpeg-master-Docs-2026-11-03.epub` -> `2026-11-03`. */
export function fileVersion(name: string): string | undefined {
  const found = trailingVersion.exec(withoutExtension(name));
  return found ? found[1] ?? found[2] : undefined;
}

/** A readable title from a file name: no extension, no trailing version, hyphens and underscores as spaces. */
export function fileTitle(name: string): string {
  const bare = withoutExtension(name);
  const spaced = (text: string) => text.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return spaced(bare.replace(trailingVersion, '')) || spaced(bare) || name;
}

/** A collection's name as shown: ordering prefix dropped (`2-creative-apps` -> `Creative apps`), separators as spaces, first letter upper. Stored names never change. */
export function collectionDisplayName(name: string): string {
  const shown = name.replace(/^\d+[-_. ]+/, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return shown ? shown.charAt(0).toUpperCase() + shown.slice(1) : name;
}

/** Collections in the order shelves are laid out: by stored name, numbers by value, so `2-x` comes before `10-x`. */
export const compareCollections = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });

export type ShelfCollection = { id: string; name: string; parentId: string | null };
export type Shelf<T> = { id: string; name: string; items: T[] };

/**
 * Splits `items` (already filtered, sorted and in scope) into the shelves of collection `scopeId`: first
 * what sits directly in it (or in none of its children), under its own name, then one shelf per child by
 * collection name. An item joins the first child it, or something beneath that child, belongs to. Empty
 * shelves are left out. Returns undefined when the collection has no children: a plain grid.
 */
export function groupIntoShelves<T extends { collectionIds: string[] }>(scopeId: string, collections: readonly ShelfCollection[], items: readonly T[]): Shelf<T>[] | undefined {
  const scope = collections.find(collection => collection.id === scopeId); if (!scope) return undefined;
  const children = collections.filter(collection => collection.parentId === scopeId && collection.id !== scopeId).sort(compareCollections);
  if (!children.length) return undefined;
  const childrenOf = new Map<string | null, ShelfCollection[]>();
  for (const collection of collections) { const list = childrenOf.get(collection.parentId); if (list) list.push(collection); else childrenOf.set(collection.parentId, [collection]); }
  const covered = children.map(child => {
    const ids = new Set<string>([child.id]); const queue = [child.id];
    for (let id = queue.pop(); id !== undefined; id = queue.pop()) for (const next of childrenOf.get(id) ?? []) if (!ids.has(next.id)) { ids.add(next.id); queue.push(next.id); }
    return ids;
  });
  const own: T[] = []; const shelves = children.map(child => ({ id: child.id, name: collectionDisplayName(child.name), items: [] as T[] }));
  for (const item of items) {
    const index = covered.findIndex(ids => item.collectionIds.some(id => ids.has(id)));
    (index < 0 ? own : shelves[index].items).push(item);
  }
  return [{ id: scope.id, name: collectionDisplayName(scope.name), items: own }, ...shelves].filter(shelf => shelf.items.length);
}

/** Generated covers are always 3:4, width over height. */
export const coverRatio = 3 / 4;

/** OKLCH lightness and chroma of a generated cover's plain tint, per colour scheme. */
export const coverTint = { light: { lightness: .93, chroma: .03 }, dark: { lightness: .30, chroma: .035 } } as const;
/** Share of `--ink` in the colour of a cover's small print (format, version); the rest is `--muted`, which on its own falls just short of 4.5:1 on the tint. */
export const coverSecondaryInk = .3;

/** Vertical layout of shelves in the grid, in px: space above every shelf but the first, the header's height, and the space under it. */
export const shelfLayout = { gap: 16, head: 18, below: 6 } as const;

/** A 32-bit hash of a collection id (FNV-1a with a final mix, so near-identical ids still differ in every bit the cover reads). */
export function coverHash(collectionId: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < collectionId.length; index++) hash = Math.imul(hash ^ collectionId.charCodeAt(index), 0x01000193);
  hash ^= hash >>> 16; hash = Math.imul(hash, 0x85ebca6b); hash ^= hash >>> 13; hash = Math.imul(hash, 0xc2b2ae35); hash ^= hash >>> 16;
  return hash >>> 0;
}

/** Hue (degrees) of a collection's covers. */
export const coverHue = (collectionId: string) => coverHash(collectionId) % 360;

/** The motif of a collection's cover art: the same collection always gets the same one. */
export const coverMotif = (collectionId: string | undefined): Motif => motifFor(collectionId === undefined ? undefined : coverHash(collectionId));

/** Plain tint of a cover as a packed colour, for the given scheme (no collection: undefined, the cover uses `--hover`). */
export function coverTintRgb(collectionId: string, scheme: 'light' | 'dark'): number {
  return oklchToRgb(coverTint[scheme].lightness, coverTint[scheme].chroma, coverHue(collectionId));
}

/** Colour of the art's ink for a collection and scheme, as a packed colour. */
export function coverInkRgb(collectionId: string, scheme: 'light' | 'dark'): number {
  const { lightness, chroma } = artTone[scheme].ink;
  return oklchToRgb(lightness, chroma, coverHue(collectionId));
}

/** The CSS fill of a generated cover: the shelf's tint in the current scheme, or the neutral hover tone when the document has no collection. */
export function coverFill(collectionId: string | undefined): string {
  if (!collectionId) return 'var(--hover)';
  const hue = coverHue(collectionId), { light, dark } = coverTint;
  return `light-dark(oklch(${light.lightness} ${light.chroma} ${hue}), oklch(${dark.lightness} ${dark.chroma} ${hue}))`;
}
