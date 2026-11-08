/**
 * The reader's command surface, as one list.
 *
 * Before this module the same actions were named in three places: the static markup in
 * `main.ts`, the `data-action` dispatch chain, and the `keydown` handler that duplicated a
 * subset of them with hard-coded key checks. Adding a command meant touching all three and
 * hoping they stayed in step. This catalog is the single source of truth for *what a command
 * is called, what searches for it, and which shortcut reaches it*; `main.ts` owns what each
 * one actually does.
 *
 * The module is deliberately free of DOM and reader state so it can be unit-tested, and so
 * the palette and the shortcut reference dialog can both be generated from it.
 */

export type CommandGroup = 'File' | 'Navigate' | 'View' | 'Window' | 'Reading' | 'Data';

export type Command = {
  /** Stable identifier, matching a handler branch in `main.ts`. */
  id: string;
  /** Short label shown in the palette and the menu. */
  label: string;
  /** Grouping heading in the palette. */
  group: CommandGroup;
  /** Extra words that should match this command but are not worth showing. */
  keywords?: readonly string[];
  /** Human-readable shortcut, shown right-aligned. Display only; matching lives in SHORTCUTS. */
  shortcut?: string;
  /** True when the command needs a document open. */
  requiresDocument?: boolean;
  /** True when the command needs the desktop app (native IPC). */
  requiresDesktop?: boolean;
};

/** Display order of the groups. */
const GROUP_ORDER: readonly CommandGroup[] = ['File', 'Navigate', 'View', 'Window', 'Reading', 'Data'];

/**
 * Ordering here is the palette's ordering for an empty query: the actions reached most often
 * come first inside each group, and groups read File → Navigate → View → Window → Reading → Data.
 */
export const COMMANDS: readonly Command[] = [
  { id: 'open', label: 'Open file…', group: 'File', keywords: ['load', 'recent'], shortcut: 'Ctrl O' },
  { id: 'library', label: 'Toggle document library', group: 'File', keywords: ['sidebar', 'books', 'collection'], shortcut: 'Ctrl B' },
  { id: 'library-board', label: 'Library board', group: 'File', keywords: ['board', 'grid', 'browse', 'collection'] },
  { id: 'find', label: 'Find in document…', group: 'Navigate', keywords: ['search', 'text', 'grep', 'locate'], shortcut: 'Ctrl F', requiresDocument: true },
  { id: 'goto', label: 'Go to location…', group: 'Navigate', keywords: ['jump', 'page', 'line', 'percentage'], shortcut: 'Ctrl G', requiresDocument: true },
  { id: 'outline', label: 'Contents', group: 'Navigate', keywords: ['toc', 'chapters', 'outline'], requiresDocument: true },
  { id: 'back', label: 'Back after jump', group: 'Navigate', keywords: ['history', 'return', 'previous location'], shortcut: 'Alt ←', requiresDocument: true },
  { id: 'start', label: 'First location', group: 'Navigate', keywords: ['beginning', 'home', 'top'], requiresDocument: true },
  { id: 'end', label: 'Last location', group: 'Navigate', keywords: ['finish', 'bottom'], requiresDocument: true },
  { id: 'screen-previous', label: 'Previous screen', group: 'Navigate', keywords: ['scroll up'], shortcut: 'Shift Space', requiresDocument: true },
  { id: 'screen-next', label: 'Next screen', group: 'Navigate', keywords: ['scroll down'], shortcut: 'Space', requiresDocument: true },
  { id: 'fit-page', label: 'Fit page', group: 'View', keywords: ['zoom', 'whole page'], shortcut: 'Ctrl 0', requiresDocument: true },
  { id: 'fit-width', label: 'Fit width', group: 'View', keywords: ['zoom', 'wide'], shortcut: 'Ctrl 2', requiresDocument: true },
  { id: 'rotate', label: 'Rotate page 90°', group: 'View', keywords: ['orientation', 'landscape', 'sideways'], requiresDocument: true },
  { id: 'spread', label: 'Two-page spread', group: 'View', keywords: ['facing', 'dual', 'pair'], shortcut: 'Ctrl 3', requiresDocument: true },
  { id: 'cover', label: 'Cover page alone', group: 'View', keywords: ['spread', 'first page'], requiresDocument: true },
  { id: 'smaller', label: 'Smaller text / zoom out', group: 'View', keywords: ['decrease', 'reduce', 'small'], shortcut: 'Ctrl −', requiresDocument: true },
  { id: 'larger', label: 'Larger text / zoom in', group: 'View', keywords: ['increase', 'grow', 'big'], shortcut: 'Ctrl +', requiresDocument: true },
  { id: 'appearance', label: 'Appearance and text…', group: 'View', keywords: ['dark', 'light', 'theme', 'colour', 'color', 'palette'] },
  { id: 'type', label: 'Text size & spacing…', group: 'Reading', keywords: ['typography', 'font', 'size', 'line', 'margin', 'spacing', 'wrap'], requiresDocument: true },
  { id: 'assistant', label: 'AI assistant…', group: 'Reading', keywords: ['ai', 'ask', 'claude', 'chat', 'question', 'api key', 'anthropic'], requiresDesktop: true },
  { id: 'pin', label: 'Toggle pin (always on top)', group: 'Window', keywords: ['float', 'above', 'sticky'], shortcut: 'Ctrl Shift T', requiresDesktop: true },
  { id: 'lock', label: 'Toggle size lock', group: 'Window', keywords: ['resize', 'resizable', 'fixed size'], shortcut: 'Ctrl Shift L', requiresDesktop: true },
  { id: 'compact', label: 'Compact window', group: 'Window', keywords: ['small', 'shrink'], requiresDesktop: true },
  { id: 'reading', label: 'Reading window', group: 'Window', keywords: ['large', 'grow'], requiresDesktop: true },
  { id: 'shortcuts', label: 'Keyboard shortcuts', group: 'Window', keywords: ['keys', 'help', 'reference', 'bindings', 'palette'] },
  { id: 'clear-recents', label: 'Clear recent files', group: 'Data', keywords: ['history', 'recents', 'remove'] },
  { id: 'clear-data', label: 'Delete saved reading data…', group: 'Data', keywords: ['reset', 'positions', 'progress', 'erase'] },
];

/** The keyboard model, kept separate from what each command does. */
export type Shortcut = {
  id: string;
  key: string;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
};

/**
 * Shortcuts handled by the global keydown listener. `key` is compared lower-cased against
 * `event.key.toLowerCase()`; `Ctrl +` also accepts `=` because shift-less keyboards emit it.
 *
 * `command-palette` is here so the binding is testable, but it is not a command in COMMANDS:
 * it is how the interface reaches the palette, not something the palette dispatches.
 */
export const SHORTCUTS: readonly Shortcut[] = [
  { id: 'command-palette', key: 'k', ctrl: true },
  { id: 'library', key: 'b', ctrl: true },
  { id: 'pin', key: 't', ctrl: true, shift: true },
  { id: 'lock', key: 'l', ctrl: true, shift: true },
  { id: 'open', key: 'o', ctrl: true },
  { id: 'goto', key: 'g', ctrl: true },
  { id: 'find', key: 'f', ctrl: true },
  { id: 'fit-page', key: '0', ctrl: true },
  { id: 'fit-width', key: '2', ctrl: true },
  { id: 'spread', key: '3', ctrl: true },
  { id: 'smaller', key: '-', ctrl: true },
  { id: 'larger', key: '+', ctrl: true },
  { id: 'larger', key: '=', ctrl: true },
  { id: 'back', key: 'arrowleft', alt: true },
];

/** Shortcut ids that are interface affordances rather than dispatchable commands. */
export const INTERFACE_SHORTCUTS: readonly string[] = ['command-palette'];

/**
 * Which action an event reaches, or undefined. Modifier state must match exactly, except
 * that `larger` is reachable through both `+` and `=`.
 */
export function shortcutFor(event: { key: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey?: boolean }): string | undefined {
  if (event.metaKey) return undefined;
  const key = event.key.toLowerCase();
  return SHORTCUTS.find(shortcut => shortcut.key === key
    && Boolean(shortcut.ctrl) === event.ctrlKey
    && Boolean(shortcut.alt) === event.altKey
    && Boolean(shortcut.shift) === event.shiftKey)?.id;
}

/** Why a command cannot run right now, or undefined when it can. */
export function unavailableReason(command: Command, context: { hasDocument: boolean; desktop: boolean }): string | undefined {
  if (command.requiresDocument && !context.hasDocument) return 'Open a document first';
  if (command.requiresDesktop && !context.desktop) return 'Available in the desktop app';
  return undefined;
}

/**
 * Scores a command against a query, or returns undefined when it does not match.
 *
 * Matching is deliberately forgiving, because the palette's job is to be quicker than the
 * menu: words may appear anywhere, prefixes count, and a subsequence of initials still matches
 * ("tp" finds "Toggle pin"). Score order favours, in turn, an exact label, a label prefix, a
 * word prefix inside the label, a label substring, then the same tests against keywords.
 */
export function scoreCommand(command: Command, query: string): number | undefined {
  const needle = query.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
  if (!needle) return 0;
  const label = command.label.toLocaleLowerCase();
  const words = label.split(/[\s/&]+/).filter(Boolean);
  const keywords = command.keywords ?? [];

  // An exact or prefix match on the label is what a user most likely meant.
  if (label === needle) return 1000;
  if (label.startsWith(needle)) return 900 - label.length / 100;

  // A word inside the label starting with the query outranks one buried mid-word.
  const wordIndex = words.findIndex(word => word.startsWith(needle));
  if (wordIndex >= 0) return 800 - wordIndex * 10 - label.length / 100;
  if (label.includes(needle)) return 700;

  // Keywords are synonyms: still a match, but a step below anything in the label. An exact
  // keyword ("jump" -> goto) is the user naming the thing, so it sits just under a word match
  // on the label but above a bare label substring.
  if (keywords.some(keyword => keyword.toLocaleLowerCase() === needle)) return 750;
  for (const keyword of keywords) {
    const term = keyword.toLocaleLowerCase();
    if (term.startsWith(needle)) return 500;
    if (term.includes(needle)) return 400;
  }

  // Initials / scattered subsequence, e.g. "tcp" for "Toggle cover page".
  if (isSubsequence(needle, label)) return 300 - label.length / 100;

  return undefined;
}

function isSubsequence(needle: string, haystack: string): boolean {
  let at = 0;
  for (const character of haystack) if (character === needle[at]) at++;
  return at === needle.length;
}

/** Every command matching `query`, best first, then in catalog order for equal scores. */
export function searchCommands(query: string, commands: readonly Command[] = COMMANDS): Command[] {
  return commands
    .map((command, index) => ({ command, index, score: scoreCommand(command, query) }))
    .filter((entry): entry is { command: Command; index: number; score: number } => entry.score !== undefined)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(entry => entry.command);
}

/** A typed request the catalog cannot express on its own: a place to go or words to find. */
export type Intent = { kind: 'goto'; target: string } | { kind: 'find'; text: string };

const GOTO_REQUEST = /^(?:go\s*to|goto|jump\s*to|page|pg|p\.?|line)?\s*(\d+(?:\.\d+)?%?)$/i;
const FIND_REQUEST = /^(?:find|search(?:\s+for)?|where\s+is|where's)\s+(.+)$/i;

/**
 * Reads a palette query as a request, without a model: "40", "page 40" and "35%" go to that
 * location (the adapter decides whether it is a page, a line or a percentage), and "find
 * lifetimes" finds the words after the verb. Anything else is left to the command search.
 */
export function parseIntent(query: string): Intent | undefined {
  const text = query.trim();
  const go = GOTO_REQUEST.exec(text);
  if (go) return { kind: 'goto', target: go[1] };
  const find = FIND_REQUEST.exec(text);
  if (find && find[1].trim()) return { kind: 'find', text: find[1].trim() };
  return undefined;
}

export type GroupedCommands = { group: CommandGroup; commands: Command[] };

/** Commands grouped for display, preserving catalog order within each group and dropping empty groups. */
export function groupCommands(commands: readonly Command[]): GroupedCommands[] {
  return GROUP_ORDER
    .map(group => ({ group, commands: commands.filter(command => command.group === group) }))
    .filter(section => section.commands.length > 0);
}
