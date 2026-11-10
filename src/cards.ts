// Reference cards shared by the library grid and the Home page: one generated cover, one tile frame, and one
// masonry placement, so a document looks and lays out the same on both surfaces. The surfaces keep their own
// behaviour (open, favorites, removal, which pictures to fetch); this file only builds and places the pieces.
import { coverArt } from './covers';
import { assignMasonry } from './library-layout';
import { coverFill, fileVersion } from './shelf';
import type { Thumbnail } from './thumbnails';

export type Appearance = 'light' | 'dark';

function make<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export type CoverSpec = { name: string; format: string; /** What the cover prints: the book's own title once known, else the cleaned file name. */ title: string; seed: number; shelfId: string | undefined };

/** A generated cover for a document with no picture: dithered art of its shelf in the top half, the title and the format (with the version in the file name) below. */
export function coverNode(spec: CoverSpec, appearance: Appearance): HTMLElement {
  const cover = make('span', 'library-cover'); cover.style.setProperty('--cover-fill', coverFill(spec.shelfId));
  const art = make('img', 'library-cover-art'); art.alt = ''; art.dataset.cover = spec.shelfId ?? ''; art.dataset.seed = String(spec.seed); art.src = coverArt(spec.seed, spec.shelfId, appearance);
  const meta = make('span', 'library-cover-meta'); meta.append(make('span', '', spec.format.toUpperCase())); const version = fileVersion(spec.name); if (version) meta.append(make('span', '', version));
  const text = make('span', 'library-cover-text'); text.append(make('span', 'library-cover-title', spec.title), meta);
  cover.append(art, text); return cover;
}

/** Re-draws the art of every cover under `root` for a new colour scheme. */
export function repaintCovers(root: ParentNode, appearance: Appearance) {
  for (const art of root.querySelectorAll<HTMLImageElement>('.library-cover-art')) art.src = coverArt(Number(art.dataset.seed), art.dataset.cover || undefined, appearance);
}

export type TileSpec = CoverSpec & {
  path: string;
  /** The name under the picture on hover. */
  label: string;
  /** Width / height: the picture's, else the cover's. */
  ratio: number;
  missing: boolean;
  /** The generated cover shows until a picture replaces it (and stays for a document that has no picture). */
  generated: boolean;
  /** A picture can be made for this document, so the media is observed and filled by its surface. */
  thumbnailable: boolean;
};

/** The picture box of a tile: a missing mark, or the generated cover and, when a picture can exist, its (still hidden) image, format hint and hover name. */
export function tileMedia(spec: TileSpec, appearance: Appearance): HTMLElement {
  const media = make('span', 'library-tile-media'); media.style.setProperty('--ratio', String(spec.ratio));
  const format = spec.format.toUpperCase();
  if (spec.missing) { media.append(make('span', 'library-tile-glyph'), make('span', 'library-tile-note', 'Missing')); return media; }
  if (spec.generated) media.append(coverNode(spec, appearance));
  if (spec.thumbnailable) {
    if (!spec.generated) media.append(make('span', 'library-tile-format', format));
    const image = make('img'); image.alt = ''; image.hidden = true; image.decoding = 'async'; media.dataset.path = spec.path; media.dataset.format = spec.format; media.append(image);
    const scrim = make('span', 'library-tile-scrim'); scrim.append(make('span', 'library-tile-name', spec.label), make('span', 'library-tile-meta', format)); media.append(scrim);
  }
  return media;
}

/** Shows a finished picture in a tile's media box. */
export function showPicture(media: HTMLElement, thumbnail: Thumbnail) {
  media.style.setProperty('--ratio', String(thumbnail.ratio));
  const image = media.querySelector<HTMLImageElement>(':scope > img')!; image.src = thumbnail.url; image.hidden = false; media.classList.add('is-loaded');
}

export function markUnavailable(media: HTMLElement) { media.classList.add('is-unavailable'); media.title = 'Thumbnail unavailable. Use More actions to locate the original.'; }

export type Placed = { node: HTMLElement; ratio: number; column: number };

/**
 * Places `tiles` (in reading order, absolutely positioned) into `columns` masonry columns starting at `left`/`top`
 * and returns the height used. A tile's column is only reassigned when `reassign` is set, so a picture that arrives
 * and changes a ratio moves what is below it and never reshuffles the grid.
 */
export function placeTiles(tiles: readonly Placed[], layout: { columns: number; tileWidth: number; gap: number; left: number; top: number; reassign: boolean }): number {
  const { columns, tileWidth, gap, left, top } = layout;
  if (layout.reassign) assignMasonry(tiles.map(tile => 1 / tile.ratio), columns, gap / tileWidth).forEach((indices, column) => { for (const at of indices) tiles[at].column = column; });
  const bottoms = new Array<number>(columns).fill(0);
  for (const tile of tiles) {
    const offset = bottoms[tile.column]; bottoms[tile.column] = offset + tileWidth / tile.ratio + gap;
    tile.node.dataset.column = String(tile.column); tile.node.style.width = `${tileWidth}px`; tile.node.style.left = `${left + tile.column * (tileWidth + gap)}px`; tile.node.style.top = `${top + offset}px`;
  }
  return Math.max(...bottoms) - gap;
}
