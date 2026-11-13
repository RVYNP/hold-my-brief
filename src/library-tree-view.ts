// Paints the info rail's tree (see library-tree.ts) and gives it the keyboard of an ARIA tree: one tab stop, arrows move and
// open, Home/End jump, Enter opens a document or toggles a folder, typing jumps to the next name that starts with it.
// A tree is a flat list of `treeitem`s carrying their level, so only the rows that are showing exist in the DOM.
import type { LibraryDocument } from './catalog-types';
import { highlightRuns, openByDefault, treeRows, type TreeNode, type TreeRow } from './library-tree';
import { isImage } from './library-query';

export type TreeHost = {
  /** A document was chosen: shown now, or (`background`) only given a tab. `siblings` are the images next to it, for the image pager. */
  open: (doc: LibraryDocument, background: boolean, siblings: readonly LibraryDocument[]) => void;
  /** The context menu of a document, folder or collection row was asked for, at a point or (from the keyboard) beside `anchor`. */
  menu: (node: TreeNode, anchor: HTMLElement, at: { x: number; y: number } | undefined) => void;
  /** A folder or collection was double-clicked: the board scoped to it. */
  scope: (node: TreeNode) => void;
};

export type TreeInput = {
  sections: readonly TreeNode[];
  query: string;
  /** More text a document is known by, for the filter (title, tags). */
  extra: (doc: LibraryDocument) => string;
  /** The ids a filter forces open. */
  forced: ReadonlySet<string>;
  activePath: string | undefined;
  /** The reading progress to show for a document, if any. */
  progress: (doc: LibraryDocument) => string | undefined;
};

const svg = (paths: string, size = 14) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const sheet = '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>';
export const treeIcons = {
  folder: svg('<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>'),
  folderOpen: svg('<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>'),
  collection: svg('<path d="m16 6 4 14"/><path d="M12 6v14"/><path d="M8 8v12"/><path d="M4 4v16"/>'),
  pdf: svg(`${sheet}<path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>`),
  txt: svg(`${sheet}<path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>`),
  md: svg(`${sheet}<path d="m10 13-2 2 2 2"/><path d="m14 17 2-2-2-2"/>`),
  epub: svg('<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>'),
  image: svg('<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>'),
};
const chevron = '<svg class="tree-chevron-icon" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>';

/** The glyph for a document of `format`, in the tree and in the favorites list. */
export function formatIcon(format: string): string {
  const key = format.toLowerCase();
  if (isImage({ format })) return treeIcons.image;
  return key === 'markdown' ? treeIcons.md : (treeIcons as Record<string, string>)[key] ?? treeIcons.txt;
}

const storageKey = 'hold-my-brief:library-tree';
function readOpen(): Map<string, boolean> {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) ?? '{}') as Record<string, unknown>;
    return new Map(Object.entries(parsed).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean'));
  } catch { return new Map(); }
}

export function createTreeView(root: HTMLElement, host: TreeHost) {
  root.classList.add('library-tree'); root.setAttribute('role', 'tree');
  // What the user opened or closed, by node id; a node with no saved state follows `openByDefault`.
  const saved = readOpen();
  let input: TreeInput | undefined; let rows: TreeRow[] = []; let focusedId: string | undefined;
  const isOpen = (node: TreeNode) => input?.forced.has(node.id) || (saved.get(node.id) ?? openByDefault(node));
  let typed = ''; let typedTimer = 0;

  const persist = () => { try { localStorage.setItem(storageKey, JSON.stringify(Object.fromEntries(saved))); } catch { /* Optional preference. */ } };
  function setOpen(node: TreeNode, open: boolean) {
    if (!node.children.length || isOpen(node) === open) return;
    // A filter holds its folders open: closing one by hand is the filter's to allow only once it is cleared.
    if (input?.forced.has(node.id)) return;
    if (open === openByDefault(node)) saved.delete(node.id); else saved.set(node.id, open);
    persist(); paint();
  }
  const allNodes = new Map<string, TreeNode>();
  /** Opens every node in `ids` (the ancestors of a document); true when something changed. A node a filter has hidden is skipped. */
  function openAll(ids: readonly string[] | undefined): boolean {
    let changed = false;
    for (const id of ids ?? []) {
      const node = allNodes.get(id); if (!node || isOpen(node)) continue;
      if (openByDefault(node)) saved.delete(id); else saved.set(id, true);
      changed = true;
    }
    if (changed) persist();
    return changed;
  }

  function label(node: TreeNode) {
    const text = document.createElement('span'); text.className = 'tree-label';
    const query = input?.query ?? '';
    if (!query.trim()) { text.textContent = node.label; return text; }
    for (const [run, marked] of highlightRuns(node.label, query)) {
      if (marked) { const mark = document.createElement('mark'); mark.textContent = run; text.append(mark); } else text.append(run);
    }
    return text;
  }
  function render(row: TreeRow): HTMLElement {
    const { node } = row; const item = document.createElement('div');
    item.className = `tree-row is-${node.kind}`; item.setAttribute('role', 'treeitem'); item.id = `tree:${node.id}`; item.dataset.node = node.id; item.dataset.kind = node.kind;
    item.setAttribute('aria-level', String(row.level)); item.setAttribute('aria-setsize', String(row.setSize)); item.setAttribute('aria-posinset', String(row.position));
    item.style.setProperty('--depth', String(Math.max(0, row.level - 2))); item.tabIndex = -1;
    const expandable = node.children.length > 0;
    const open = expandable && isOpen(node);
    if (expandable) item.setAttribute('aria-expanded', String(open));
    if (node.kind === 'section') {
      item.append(label(node));
      const count = document.createElement('span'); count.className = 'tree-meta'; count.textContent = String(node.count); item.append(count);
      return item;
    }
    const lead = document.createElement('span'); lead.className = 'tree-chevron'; if (expandable) lead.innerHTML = chevron; item.append(lead);
    const glyph = document.createElement('span'); glyph.className = 'tree-icon';
    const doc = node.doc;
    glyph.innerHTML = doc ? formatIcon(doc.format) : node.kind === 'collection' ? treeIcons.collection : open ? treeIcons.folderOpen : treeIcons.folder;
    item.append(glyph, label(node));
    const meta = document.createElement('span'); meta.className = 'tree-meta';
    if (doc) {
      meta.textContent = input?.progress(doc) ?? '';
      item.dataset.docPath = doc.path; item.dataset.docName = node.label; item.title = doc.path;
      if ((doc.availability ?? 'ready') === 'missing') { item.classList.add('is-missing'); meta.textContent = 'Missing'; }
      if (doc.path === input?.activePath) { item.classList.add('is-active'); item.setAttribute('aria-selected', 'true'); item.setAttribute('aria-current', 'true'); }
    } else meta.textContent = String(node.count);
    item.append(meta);
    return item;
  }

  function paint(next?: TreeInput) {
    if (next) input = next;
    if (!input) return;
    allNodes.clear();
    const index = (node: TreeNode) => { allNodes.set(node.id, node); node.children.forEach(index); };
    input.sections.forEach(index);
    const hadFocus = root.contains(document.activeElement); const scrolled = root.scrollTop;
    rows = treeRows(input.sections, id => { const node = allNodes.get(id); return node ? isOpen(node) : false; });
    const fragment = document.createDocumentFragment();
    for (const row of rows) fragment.append(render(row));
    root.replaceChildren(fragment);
    root.scrollTop = scrolled;
    const target = rows.find(row => row.node.id === focusedId) ?? rows.find(row => row.node.doc?.path === input?.activePath) ?? rows[0];
    focusedId = target?.node.id;
    const element = target && elementOf(target.node.id);
    if (element) { element.tabIndex = 0; if (hadFocus) element.focus({ preventScroll: true }); }
  }
  const elementOf = (id: string) => root.querySelector<HTMLElement>(`[data-node="${CSS.escape(id)}"]`) ?? undefined;
  function focusRow(id: string | undefined, scroll = true) {
    if (!id) return;
    const element = elementOf(id); if (!element) return;
    root.querySelector<HTMLElement>('[tabindex="0"]')?.setAttribute('tabindex', '-1');
    element.tabIndex = 0; focusedId = id; element.focus({ preventScroll: !scroll });
    if (scroll) element.scrollIntoView({ block: 'nearest' });
  }
  const rowIndex = (id: string | undefined) => rows.findIndex(row => row.node.id === id);
  const parentOf = (index: number) => { const level = rows[index]!.level; for (let at = index - 1; at >= 0; at--) if (rows[at]!.level < level) return rows[at]; return undefined; };

  function siblingImages(index: number): LibraryDocument[] {
    const parent = parentOf(index); const out: LibraryDocument[] = [];
    if (!parent) return out;
    for (const child of parent.node.children) if (child.doc && isImage(child.doc)) out.push(child.doc);
    return out;
  }
  function activate(index: number, background: boolean) {
    const row = rows[index]; if (!row) return;
    const { node } = row;
    if (node.doc) host.open(node.doc, background, siblingImages(index));
    else setOpen(node, !isOpen(node));
  }

  root.addEventListener('click', event => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('.tree-row'); if (!target || !root.contains(target)) return;
    const index = rowIndex(target.dataset.node); if (index < 0) return;
    const { node } = rows[index]!;
    focusRow(node.id, false);
    if (!node.doc && event.detail >= 2 && node.scope) { setOpen(node, !isOpen(node)); host.scope(node); return; } // the first click toggled it; a double-click leaves it as it was
    activate(index, node.doc !== undefined && (event.metaKey || event.ctrlKey));
  });
  // A middle click opens in a background tab as well, as a browser's link does.
  root.addEventListener('auxclick', event => {
    if (event.button !== 1) return;
    const target = (event.target as HTMLElement).closest<HTMLElement>('.tree-row'); const index = target ? rowIndex(target.dataset.node) : -1;
    if (index >= 0 && rows[index]!.node.doc) { event.preventDefault(); activate(index, true); }
  });
  root.addEventListener('contextmenu', event => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('.tree-row'); const index = target ? rowIndex(target.dataset.node) : -1;
    const node = index >= 0 ? rows[index]!.node : undefined;
    if (!target || !node || node.kind === 'section') return;
    event.preventDefault(); focusRow(node.id, false);
    host.menu(node, target, event.clientX || event.clientY ? { x: event.clientX, y: event.clientY } : undefined);
  });
  root.addEventListener('focusin', event => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('.tree-row'); if (!target || target.dataset.node === focusedId) return;
    root.querySelector<HTMLElement>('[tabindex="0"]')?.setAttribute('tabindex', '-1'); target.tabIndex = 0; focusedId = target.dataset.node;
  });
  root.addEventListener('keydown', event => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('.tree-row'); if (!target) return;
    const index = rowIndex(target.dataset.node); if (index < 0) return;
    const row = rows[index]!; const { node } = row; const open = node.children.length > 0 && isOpen(node);
    const go = (at: number) => { event.preventDefault(); focusRow(rows[Math.max(0, Math.min(rows.length - 1, at))]?.node.id); };
    if (event.altKey) return;
    // Only letters typed one after another form a search: any other key starts the next one afresh.
    if (event.key.length !== 1) { typed = ''; window.clearTimeout(typedTimer); }
    switch (event.key) {
      case 'ArrowDown': go(index + 1); return;
      case 'ArrowUp': go(index - 1); return;
      case 'Home': go(0); return;
      case 'End': go(rows.length - 1); return;
      case 'ArrowRight':
        event.preventDefault();
        if (node.children.length && !open) setOpen(node, true); else if (open) go(index + 1);
        return;
      case 'ArrowLeft': {
        event.preventDefault();
        if (open) setOpen(node, false); else { const parent = parentOf(index); if (parent) focusRow(parent.node.id); }
        return;
      }
      case 'Enter': case ' ':
        event.preventDefault(); activate(index, node.doc !== undefined && (event.metaKey || event.ctrlKey)); return;
      case 'ContextMenu': case 'F10':
        if (event.key === 'F10' && !event.shiftKey) return;
        if (node.kind !== 'section') { event.preventDefault(); host.menu(node, target, undefined); }
        return;
    }
    // Type-ahead: letters typed in quick succession jump to the next row whose name starts with them.
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
      typed += event.key.toLocaleLowerCase(); window.clearTimeout(typedTimer); typedTimer = window.setTimeout(() => { typed = ''; }, 700);
      const from = typed.length > 1 ? index : index + 1;
      for (let step = 0; step < rows.length; step++) {
        const at = (from + step) % rows.length;
        if (rows[at]!.node.label.toLocaleLowerCase().startsWith(typed)) { event.preventDefault(); focusRow(rows[at]!.node.id); break; }
      }
    }
  });

  return {
    paint,
    focus: () => { const id = focusedId ?? rows[0]?.node.id; focusRow(id); },
    /** Opens the folders above a document (its ancestors in the tree) and brings its row into view; false when nothing had to open. */
    reveal: (ancestors: readonly string[] | undefined, id: string) => {
      const changed = openAll(ancestors);
      if (changed) paint();
      elementOf(id)?.scrollIntoView({ block: 'nearest' });
      return changed;
    },
    /** Forgets saved state for nodes that no longer exist. */
    prune: (known: ReadonlySet<string>) => { let changed = false; for (const id of [...saved.keys()]) if (!known.has(id)) { saved.delete(id); changed = true; } if (changed) persist(); },
    rowCount: () => rows.length,
  };
}
