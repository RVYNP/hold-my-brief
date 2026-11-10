import type { LibraryDocument } from './catalog-types';

export function searchText(document: LibraryDocument): string {
  return [document.name, document.path, document.notes, ...document.tags, document.source?.repository, document.source?.sourcePath]
    .filter(Boolean).join(' ').toLocaleLowerCase();
}

export function isImage(document: { format: string }): boolean {
  return ['png', 'jpeg', 'jpg', 'webp', 'gif', 'avif', 'bmp'].includes(document.format.toLowerCase());
}

/** Shared choices for Home and the library. These only filter metadata; files are never converted. */
export const fileTypeChoices = [
  ['', 'All formats'], ['pdf', 'PDFs'], ['epub', 'EPUBs'],
  ['md', 'Markdown'], ['txt', 'Text'], ['image', 'Images'],
] as const;

export function matchesFileType(document: { format: string }, selected: string): boolean {
  if (!selected) return true;
  const format = document.format.toLowerCase();
  if (selected === 'image') return isImage(document);
  if (selected === 'md') return format === 'md' || format === 'markdown';
  return format === selected;
}
