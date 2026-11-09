// Intake: the review sheet that opens when new references arrive (Add files, Index a folder). The pure half (what
// arrived, how it groups, where a group can move) is testable on its own; `createIntake` builds the sheet's body
// inside a dialog the library opened, and leaves every change to the library through the host.
import type { Collection, LibraryDocument } from './catalog-types';
import { collectionDisplayName, compareCollections, coverRatio, fileVersion, type ShelfCollection } from './shelf';
import type { Thumbnail } from './thumbnails';

/** Most arrivals shown per shelf; the rest are only counted. */
export const intakeLimit = 60;

/** The documents of `after` whose path is not in `before`, in order. */
export function newArrivals<T extends { path: string }>(before: ReadonlySet<string>, after: readonly T[]): T[] {
  return after.filter(doc => !before.has(doc.path));
}

export const intakeTitle = (count: number) => `${count} new ${count === 1 ? 'reference' : 'references'}`;

/** Where the arrivals came from: the folder (indexed folders name their documents' source), up to two named, else `fallback` ('Added files'). */
export function intakeSource(arrived: readonly { source?: { repository: string } }[], fallback = 'Added files'): string {
  const names = [...new Set(arrived.map(doc => doc.source?.repository).filter((name): name is string => Boolean(name)))];
  return names.length === 0 ? fallback : names.length <= 2 ? names.join(', ') : `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
}

export type IntakeGroup<T> = { id: string | undefined; name: string; items: T[]; shown: T[]; more: number };

/**
 * Arrivals grouped by their first (known) collection, in collection name order (numbers by value, so `2-x` before `10-x`),
 * those in none last under 'Unfiled'. `shown` is the first `limit` of each group and `more` the rest, never hidden from `items`.
 */
export function intakeGroups<T extends { collectionIds: string[] }>(items: readonly T[], collections: readonly ShelfCollection[], limit = intakeLimit): IntakeGroup<T>[] {
  const known = new Map(collections.map(collection => [collection.id, collection])); const found = new Map<string | undefined, T[]>();
  for (const item of items) { const id = item.collectionIds.find(candidate => known.has(candidate)); const list = found.get(id); if (list) list.push(item); else found.set(id, [item]); }
  const order = [...found.keys()].sort((a, b) => a === undefined ? 1 : b === undefined ? -1 : compareCollections(known.get(a)!, known.get(b)!));
  return order.map(id => { const list = found.get(id)!; return { id, name: id === undefined ? 'Unfiled' : collectionDisplayName(known.get(id)!.name), items: list, shown: list.slice(0, limit), more: Math.max(0, list.length - limit) }; });
}

export type MoveTarget = { id: string | null; label: string };

/**
 * Where a group sitting on `from` can be moved: every personal collection but `from` itself (indexed folder collections
 * are owned by their source), labelled by its path of display names, then Unfiled when `from` is a personal collection that can be left.
 */
export function moveTargets(collections: readonly Collection[], from: string | undefined): MoveTarget[] {
  const byId = new Map(collections.map(collection => [collection.id, collection]));
  const label = (collection: Collection) => { const names: string[] = []; const seen = new Set<string>(); for (let at: Collection | undefined = collection; at && !seen.has(at.id); at = at.parentId ? byId.get(at.parentId) : undefined) { seen.add(at.id); names.unshift(collectionDisplayName(at.name)); } return names.join(' › '); };
  const targets: MoveTarget[] = collections.filter(collection => !collection.sourceId && collection.id !== from).map(collection => ({ id: collection.id, label: label(collection) })).sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base', numeric: true }));
  const current = from === undefined ? undefined : byId.get(from);
  if (current && !current.sourceId) targets.push({ id: null, label: 'Unfiled' });
  return targets;
}

/** A document's collections after its group moves from `from` to `to` (null: Unfiled): the target comes first, so it is the shelf the document is grouped and covered by; `from` is left when it is personal, and memberships owned by an indexed folder are always kept. */
export function movedCollectionIds(ids: readonly string[], collections: readonly Collection[], from: string | undefined, to: string | null): string[] {
  const owned = (id: string) => collections.find(collection => collection.id === id)?.sourceId !== undefined;
  const kept = ids.filter(id => id !== from || owned(id));
  return to === null ? kept : [to, ...kept.filter(id => id !== to)];
}

// ---- the sheet ----------------------------------------------------------------------------------------------

export type IntakeHost = {
  documents(): readonly LibraryDocument[];
  collections(): readonly Collection[];
  /** The title shown for a document (an EPUB's own, else the file's). */
  label(doc: LibraryDocument): string;
  /** True when the document shows a generated cover until (unless) its picture loads. */
  generated(doc: LibraryDocument): boolean;
  /** The generated cover of a document on a shelf: the library's own tile art. */
  cover(doc: LibraryDocument, shelfId: string | undefined): HTMLElement;
  /** The picture of a document, for formats that have one. */
  picture(doc: LibraryDocument): { peek(): Thumbnail | undefined; request(wants: () => boolean): Promise<Thumbnail | undefined> } | undefined;
  /** Gives each of the documents a new random cover seed. Resolves once the library has changed (or the change failed). */
  reroll(paths: string[]): Promise<void>;
  /** Moves the documents' membership from the shelf `from` to `to` (see `movedCollectionIds`). */
  move(paths: string[], from: string | undefined, to: string | null): Promise<void>;
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); node.className = className; if (text !== undefined) node.textContent = text; return node;
}
function control(text: string, className: string, label?: string, key?: string) {
  const node = el('button', className, text); node.type = 'button'; if (label) node.setAttribute('aria-label', label); if (key) node.dataset.intakeFocus = key; return node;
}

/**
 * Fills a dialog the library opened (`content` and `actions` of its `openDialog`) with the intake sheet for the
 * documents at `paths`: the source as a mono line, then a header and a grid of covers per shelf. Re-rolling or moving
 * goes through the host and rebuilds the body, keeping scroll and focus. 'Keep all' (and Esc) just close: the books
 * are already in the library, this is a review.
 */
export function createIntake(host: IntakeHost, paths: readonly string[], source: string, view: { dialog: HTMLDialogElement; content: HTMLElement; actions: HTMLElement }) {
  const { dialog, content, actions } = view; const wanted = new Set(paths);
  const subline = el('p', 'library-intake-source', source); const body = el('div', 'library-intake-body'); content.replaceChildren(subline, body);
  const newPatterns = control('New patterns', 'library-intake-patterns'); const keep = control('Keep all', 'primary', undefined, 'keep');
  keep.onclick = () => dialog.close(); actions.replaceChildren(newPatterns, keep);
  const loaders = new Map<Element, () => void>(); let observer: IntersectionObserver | undefined; let openMenu: { menu: HTMLElement; trigger: HTMLElement } | undefined;

  function closeMenu(refocus: boolean) { if (!openMenu) return; const { menu, trigger } = openMenu; openMenu = undefined; menu.hidden = true; trigger.setAttribute('aria-expanded', 'false'); if (refocus) trigger.focus(); }
  const arrived = () => host.documents().filter(doc => wanted.has(doc.path));
  async function run(action: () => Promise<void>, key: string) { await action(); build(); dialog.querySelector<HTMLElement>(`[data-intake-focus="${CSS.escape(key)}"]`)?.focus(); }
  /** Re-reads the title of one arrival (an EPUB's own, once known) without rebuilding the sheet. */
  function retitle(path: string) {
    const node = body.querySelector<HTMLElement>(`[data-intake-path="${CSS.escape(path)}"]`), doc = arrived().find(item => item.path === path); if (!node || !doc) return;
    node.querySelector('.library-cover')?.replaceWith(host.cover(doc, node.dataset.shelf || undefined));
    for (const name of node.querySelectorAll('.library-tile-name')) name.textContent = host.label(doc);
    node.querySelector('.library-reroll')?.setAttribute('aria-label', `New cover pattern for ${host.label(doc)}`);
  }

  function tile(doc: LibraryDocument, shelfId: string | undefined) {
    const item = el('div', 'library-intake-tile'); item.setAttribute('role', 'listitem'); item.dataset.intakePath = doc.path; item.dataset.shelf = shelfId ?? ''; const title = host.label(doc), generated = host.generated(doc), picture = host.picture(doc);
    const media = el('span', 'library-tile-media'); media.style.setProperty('--ratio', String(coverRatio));
    const format = doc.format.toUpperCase(), version = fileVersion(doc.name);
    if (generated) media.append(host.cover(doc, shelfId)); else media.append(el('span', 'library-tile-format', format));
    if (picture) {
      const image = el('img'); image.alt = ''; image.hidden = true; image.decoding = 'async'; media.append(image);
      const scrim = el('span', 'library-tile-scrim'); scrim.append(el('span', 'library-tile-name', title), el('span', 'library-tile-meta', [format, version].filter(Boolean).join(' · '))); media.append(scrim);
      const show = (thumbnail: Thumbnail) => { media.style.setProperty('--ratio', String(thumbnail.ratio)); image.src = thumbnail.url; image.hidden = false; media.classList.add('is-loaded'); };
      const cached = picture.peek();
      if (cached) show(cached);
      else { loaders.set(media, () => void picture.request(() => dialog.open && media.isConnected).then(thumbnail => { if (thumbnail && media.isConnected) show(thumbnail); })); observer?.observe(media); }
    }
    item.append(media);
    if (generated) {
      // Hidden by the stylesheet once a real picture has loaded over the generated cover.
      const reroll = control('↻', 'library-reroll', `New cover pattern for ${title}`, `reroll:${doc.path}`);
      reroll.onclick = () => void run(() => host.reroll([doc.path]), `reroll:${doc.path}`);
      item.append(reroll);
    }
    return item;
  }

  function group(entry: IntakeGroup<LibraryDocument>) {
    const section = el('section', 'library-intake-group'); section.setAttribute('aria-label', entry.name);
    const head = el('div', 'library-intake-head'); head.append(el('span', 'library-shelf-name', entry.name), el('span', 'library-shelf-count', String(entry.items.length)));
    const targets = moveTargets(host.collections(), entry.id);
    if (targets.length) {
      const trigger = control('shelf ▾', 'library-intake-shelf', `Move the books of ${entry.name} to another shelf`); trigger.setAttribute('aria-haspopup', 'menu'); trigger.setAttribute('aria-expanded', 'false'); trigger.dataset.intakeFocus = `shelf:${entry.id ?? ''}`;
      const menu = el('div', 'library-item-menu library-intake-menu'); menu.setAttribute('role', 'menu'); menu.hidden = true;
      for (const target of targets) {
        const choice = control(target.label, '', undefined); choice.setAttribute('role', 'menuitem');
        choice.onclick = () => { closeMenu(false); void run(() => host.move(entry.items.map(doc => doc.path), entry.id, target.id), `shelf:${target.id ?? ''}`); };
        menu.append(choice);
      }
      trigger.onclick = () => { if (openMenu?.menu === menu) { closeMenu(true); return; } closeMenu(false); menu.hidden = false; trigger.setAttribute('aria-expanded', 'true'); openMenu = { menu, trigger }; menu.querySelector('button')?.focus(); };
      menu.addEventListener('keydown', event => {
        const items = [...menu.querySelectorAll('button')]; const at = items.indexOf(document.activeElement as HTMLButtonElement);
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeMenu(true); }
        else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); items[(at + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus(); }
        else if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); items[event.key === 'Home' ? 0 : items.length - 1]?.focus(); }
        else if (event.key === 'Tab') closeMenu(false);
      });
      head.append(trigger, menu);
    }
    const list = el('div', 'library-intake-tiles'); list.setAttribute('role', 'list');
    for (const doc of entry.shown) list.append(tile(doc, entry.id));
    section.append(head, list);
    if (entry.more) section.append(el('p', 'library-intake-more', `and ${entry.more} more`));
    return section;
  }

  /** Fades the bottom of the scroll area only while there is more below it. */
  const fade = () => body.classList.toggle('has-more', body.scrollTop + body.clientHeight < body.scrollHeight - 1);
  body.addEventListener('scroll', fade, { passive: true }); const sizes = new ResizeObserver(fade);

  function build() {
    const scrolled = body.scrollTop; observer?.disconnect(); loaders.clear(); openMenu = undefined;
    observer = new IntersectionObserver(entries => { for (const found of entries) if (found.isIntersecting) { observer?.unobserve(found.target); loaders.get(found.target)?.(); loaders.delete(found.target); } }, { root: body, rootMargin: '160px' });
    body.replaceChildren(...intakeGroups(arrived(), host.collections()).map(group)); body.scrollTop = scrolled;
    // The body's own size and its groups' (a picture arriving changes a tile's height) both move the fade.
    sizes.disconnect(); sizes.observe(body); for (const section of body.children) sizes.observe(section); fade();
  }
  newPatterns.onclick = () => void run(() => host.reroll(arrived().filter(doc => host.generated(doc)).map(doc => doc.path)), 'keep');
  body.addEventListener('pointerdown', event => { if (openMenu && !openMenu.menu.contains(event.target as Node) && !openMenu.trigger.contains(event.target as Node)) closeMenu(false); });
  dialog.addEventListener('close', () => { observer?.disconnect(); observer = undefined; sizes.disconnect(); });
  build(); return { focus: () => keep.focus(), retitle };
}
