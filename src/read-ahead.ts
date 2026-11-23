/** How many of the most recent documents are read ahead. */
export const RECENT_LIMIT = 5;

export type ReadAheadInput = {
  /** The session's tabs in strip order, with what each holds right now. */
  tabs: readonly { path: string; loaded: boolean; ephemeral?: boolean; problem?: boolean }[];
  /** The Continue reading shelf's paths, in its order. */
  reading: readonly string[];
  /** The recents' paths, most recent first. */
  recents: readonly string[];
  /** The paths that are not tabs of documents (the Library page). */
  skip?: (path: string) => boolean;
};

/**
 * The documents to warm after the first one of a launch has rendered, in order: the other tabs restored from the session, the
 * Continue reading items, then the five most recent documents. Without duplicates, and without a document that is already open and loaded.
 */
export function readAheadPaths({ tabs, reading, recents, skip = () => false }: ReadAheadInput): string[] {
  const loaded = new Set(tabs.filter(tab => tab.loaded).map(tab => tab.path));
  const restored = tabs.filter(tab => !tab.loaded && !tab.ephemeral && !tab.problem).map(tab => tab.path);
  const seen = new Set<string>();
  return [...restored, ...reading, ...recents.slice(0, RECENT_LIMIT)]
    .filter(path => !loaded.has(path) && !skip(path) && !seen.has(path) && seen.add(path));
}
