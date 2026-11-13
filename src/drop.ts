/**
 * What dropping documents on the window means, apart from the DOM: which dropped names can be opened, where their tabs go,
 * and how the lists are worded. Pure, so the rules are unit-tested; `main.ts` and `tab-strip.ts` do the drawing and the opening.
 */

/** The file types the reader opens: the same list as the open dialog's filter and the native side's `document_format`. */
export const DOCUMENT_EXTENSIONS: readonly string[] = ['pdf', 'epub', 'md', 'markdown', 'txt', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp'];

/** The last part of a path or file name, whichever separator it uses. */
export const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path;

export const isDocumentName = (name: string) => {
  const dot = name.lastIndexOf('.');
  return dot > 0 && DOCUMENT_EXTENSIONS.includes(name.slice(dot + 1).toLowerCase());
};

/** Splits dropped items (paths or files) into those that can be opened and the names of those that cannot, each in drop order. */
export function splitDropped<T>(items: readonly T[], nameOf: (item: T) => string): { openable: T[]; unsupported: string[] } {
  const openable: T[] = [], unsupported: string[] = [];
  for (const item of items) {
    if (isDocumentName(nameOf(item))) openable.push(item); else unsupported.push(nameOf(item));
  }
  return { openable, unsupported };
}

/** One notice for everything that was left out. */
export function unsupportedNotice(names: readonly string[]): string | undefined {
  if (!names.length) return undefined;
  const shown = names.slice(0, 4).join(', '), more = names.length > 4 ? ` and ${names.length - 4} more` : '';
  return `Not opened, unsupported file type: ${shown}${more}. Drop a PDF, EPUB, Markdown, text or image file.`;
}

/**
 * The index a drop opens its first tab at. Over the tab strip it is the marked slot (clamped to the strip); anywhere else
 * the new tabs follow the one being read, or go to the end when Home is showing.
 */
export function insertionIndex(slot: number | undefined, activeIndex: number, count: number): number {
  if (slot !== undefined) return Math.max(0, Math.min(count, slot));
  return activeIndex >= 0 ? Math.min(count, activeIndex + 1) : count;
}

/** The names the drop overlay lists: the first few, and how many more. */
export function overlayNames(names: readonly string[], shown = 3): string {
  if (!names.length) return '';
  return names.length > shown ? `${names.slice(0, shown).join('  ·  ')}  ·  +${names.length - shown} more` : names.join('  ·  ');
}

/** "+ 1 file", "+ 3 files": the label on the ghost tab. */
export const ghostLabel = (count: number) => `+ ${count} ${count === 1 ? 'file' : 'files'}`;
