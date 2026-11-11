import { describe, expect, it } from 'vitest';
import { COMMANDS, INTERFACE_SHORTCUTS, SHORTCUTS, appliesTo, groupCommands, parseIntent, scoreCommand, searchCommands, shortcutFor, shortcutReference, unavailableReason, type Command } from '../src/commands';

const byId = (id: string): Command => {
  const found = COMMANDS.find(command => command.id === id);
  if (!found) throw new Error(`No command ${id}`);
  return found;
};

describe('command catalog', () => {
  it('has unique ids', () => {
    const ids = COMMANDS.map(command => command.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every command a label and a known group', () => {
    for (const command of COMMANDS) {
      expect(command.label.trim().length).toBeGreaterThan(0);
      expect(groupCommands([command])).toHaveLength(1);
    }
  });

  it('lists every command under exactly one group when grouped', () => {
    const grouped = groupCommands(COMMANDS);
    const listed = grouped.flatMap(section => section.commands);
    expect(listed).toHaveLength(COMMANDS.length);
    expect(new Set(listed.map(command => command.id)).size).toBe(COMMANDS.length);
    expect(grouped.map(section => section.group)).toEqual(['File', 'Navigate', 'View', 'Window', 'Reading', 'Data']);
  });
});

describe('shortcut matching', () => {
  const event = (key: string, modifiers: Partial<{ ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }> = {}) => ({ key, ctrlKey: false, altKey: false, shiftKey: false, ...modifiers });

  it('reaches the palette on Ctrl+K and not on a bare k', () => {
    expect(shortcutFor(event('k', { ctrlKey: true }))).toBe('command-palette');
    expect(shortcutFor(event('k'))).toBeUndefined();
  });

  it('reaches the palette regardless of caps lock or shift-held key case', () => {
    // event.key is "K" when Shift produces it; we lower-case before comparing.
    expect(shortcutFor(event('K', { ctrlKey: true }))).toBe('command-palette');
  });

  it('requires exact modifier state so Ctrl+Shift+K is not Ctrl+K', () => {
    expect(shortcutFor(event('k', { ctrlKey: true, shiftKey: true }))).toBeUndefined();
    expect(shortcutFor(event('t', { ctrlKey: true, shiftKey: true }))).toBe('pin');
    expect(shortcutFor(event('t', { ctrlKey: true }))).toBeUndefined();
  });

  it('reaches zoom-in through both + and = but not from the bare keys', () => {
    expect(shortcutFor(event('+', { ctrlKey: true }))).toBe('larger');
    expect(shortcutFor(event('=', { ctrlKey: true }))).toBe('larger');
    expect(shortcutFor(event('='))).toBeUndefined();
  });

  it('reaches page previews on Ctrl+4 and nowhere else', () => {
    expect(shortcutFor(event('4', { ctrlKey: true }))).toBe('page-strip');
    expect(shortcutFor(event('4'))).toBeUndefined();
    expect(shortcutFor(event('4', { ctrlKey: true, shiftKey: true }))).toBeUndefined();
    expect(byId('page-strip').shortcut).toBe('Ctrl 4');
  });

  it('ignores the meta key so OS-level shortcuts still reach the webview', () => {
    expect(shortcutFor(event('k', { metaKey: true }))).toBeUndefined();
    expect(shortcutFor(event('o', { ctrlKey: true, metaKey: true }))).toBeUndefined();
  });

  it('never maps one key combination to two different commands', () => {
    const seen = new Set<string>();
    for (const shortcut of SHORTCUTS) {
      const signature = `${shortcut.ctrl ? 'c' : ''}${shortcut.alt ? 'a' : ''}${shortcut.shift ? 's' : ''}:${shortcut.key}`;
      expect(seen.has(signature), `duplicate binding ${signature}`).toBe(false);
      seen.add(signature);
    }
  });

  it('binds every shortcut to a command that exists', () => {
    for (const shortcut of SHORTCUTS) {
      if (INTERFACE_SHORTCUTS.includes(shortcut.id)) continue;
      expect(COMMANDS.some(command => command.id === shortcut.id), shortcut.id).toBe(true);
    }
  });

  it('keeps interface shortcuts out of the dispatchable catalog', () => {
    // The palette opens the palette; it is not a row inside it.
    for (const id of INTERFACE_SHORTCUTS) expect(COMMANDS.some(command => command.id === id), id).toBe(false);
  });
});

describe('command availability', () => {
  const open = { hasDocument: true, desktop: true };

  it('blocks document commands until a document is open', () => {
    expect(unavailableReason(byId('fit-page'), open)).toBeUndefined();
    expect(unavailableReason(byId('fit-page'), { ...open, hasDocument: false })).toBe('Open a document first');
  });

  it('blocks native-only commands in the browser preview', () => {
    expect(unavailableReason(byId('pin'), open)).toBeUndefined();
    expect(unavailableReason(byId('pin'), { ...open, desktop: false })).toBe('Available in the desktop app');
  });

  it('reports the document reason first when both are missing', () => {
    const requiresBoth: Command = { id: 'x', label: 'X', group: 'View', requiresDocument: true, requiresDesktop: true };
    expect(unavailableReason(requiresBoth, { hasDocument: false, desktop: false })).toBe('Open a document first');
  });

  it('always allows commands with no requirements', () => {
    expect(unavailableReason(byId('open'), { hasDocument: false, desktop: false })).toBeUndefined();
  });

  it('offers page previews to PDFs only, and says why a document of another format cannot use them', () => {
    const previews = byId('page-strip'), pdf = { hasDocument: true, desktop: false, format: 'pdf' };
    expect(appliesTo(previews, 'pdf')).toBe(true);
    expect(appliesTo(previews, 'md')).toBe(false);
    expect(appliesTo(previews, 'epub')).toBe(false);
    expect(appliesTo(previews, undefined)).toBe(false);
    expect(appliesTo(byId('fit-page'), 'md')).toBe(true);
    expect(unavailableReason(previews, pdf)).toBeUndefined();
    expect(unavailableReason(previews, { ...pdf, format: 'md' })).toBe('Available for PDF documents');
    expect(unavailableReason(previews, { ...pdf, hasDocument: false })).toBe('Open a document first');
  });
});

describe('command scoring and search', () => {
  it('returns nothing for a query that matches no command', () => {
    expect(searchCommands('zzzzqqq')).toEqual([]);
  });

  it('returns every command in catalog order for an empty query', () => {
    expect(searchCommands('')).toEqual([...COMMANDS]);
    expect(searchCommands('   ')).toEqual([...COMMANDS]);
  });

  it('ranks an exact label match first', () => {
    expect(searchCommands('fit page')[0].id).toBe('fit-page');
  });

  it('finds commands by a prefix of the label', () => {
    expect(searchCommands('conten')[0].id).toBe('outline');
  });

  it('matches a word inside the label, not only its first word', () => {
    expect(searchCommands('library').some(command => command.id === 'library')).toBe(true);
    expect(searchCommands('lock')[0].id).toBe('lock');
  });

  it('finds commands through keywords and synonyms', () => {
    expect(searchCommands('dark')[0].id).toBe('appearance');
    expect(searchCommands('toc')[0].id).toBe('outline');
    // "jump" is a keyword of 'goto' but also a word in "Back after jump"; both are real hits,
    // so assert reachability rather than a single winner.
    expect(searchCommands('jump').map(command => command.id)).toEqual(expect.arrayContaining(['goto', 'back']));
  });

  it('is case- and whitespace-insensitive', () => {
    expect(searchCommands('  FiT   PaGe  ')[0].id).toBe('fit-page');
    expect(searchCommands('fit page')).toEqual(searchCommands('FIT PAGE'));
  });

  it('finds a command from letters scattered across its label', () => {
    // No contiguous "tp" in "Toggle pin", but the letters appear in order.
    expect(scoreCommand(byId('pin'), 'tp')).toBeDefined();
    expect(searchCommands('tp').some(command => command.id === 'pin')).toBe(true);
  });

  it('prefers a label match over a keyword match of the same letters', () => {
    // "spread" appears in the label of 'spread' and in the keywords of 'cover'.
    expect(searchCommands('spread')[0].id).toBe('spread');
  });

  it('ranks the best match first even when it sits in a later group', () => {
    // "fit" prefix-matches 'Fit page' and 'Fit width' (View) and is only a scattered
    // subsequence of "First location" (Navigate). Ranking must win over group order, which
    // is why the palette groups only for an unfiltered list.
    const ranked = searchCommands('fit').map(command => command.id);
    expect(ranked.slice(0, 2)).toEqual(['fit-page', 'fit-width']);
    expect(groupCommands([byId('start'), byId('fit-page')]).map(section => section.group)).toEqual(['Navigate', 'View']);
  });

  it('breaks ties by catalog order so results are stable', () => {
    const first = searchCommands('e').map(command => command.id);
    const second = searchCommands('e').map(command => command.id);
    expect(second).toEqual(first);
  });

  it('never returns a command twice even when several keywords match', () => {
    const ids = searchCommands('zoom').map(command => command.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('scores a match on the label above the same match on a keyword', () => {
    const labelMatch = scoreCommand({ id: 'a', label: 'Bravo', group: 'View' }, 'bravo')!;
    const keywordMatch = scoreCommand({ id: 'b', label: 'Alpha', group: 'View', keywords: ['bravo'] }, 'bravo')!;
    expect(labelMatch).toBeGreaterThan(keywordMatch);
  });
});

describe('typed requests', () => {
  it('reads a bare or prefixed number as a location', () => {
    for (const query of ['40', ' page 40 ', 'p40', 'p. 40', 'go to 40', 'goto 40', 'line 40'])
      expect(parseIntent(query)).toEqual({ kind: 'goto', target: '40' });
    expect(parseIntent('35%')).toEqual({ kind: 'goto', target: '35%' });
    expect(parseIntent('jump to 12.5%')).toEqual({ kind: 'goto', target: '12.5%' });
  });

  it('reads a find verb as the words after it', () => {
    expect(parseIntent('find borrow checker')).toEqual({ kind: 'find', text: 'borrow checker' });
    expect(parseIntent('search for Darcy')).toEqual({ kind: 'find', text: 'Darcy' });
    expect(parseIntent("where's Netherfield")).toEqual({ kind: 'find', text: 'Netherfield' });
  });

  it('leaves command names and incomplete requests to the command search', () => {
    for (const query of ['go to', 'page', 'find', 'fit', 'dark mode', 'page forty', '40 pages'])
      expect(parseIntent(query)).toBeUndefined();
  });
});

describe('shortcut reference', () => {
  const rows = (desktop: boolean) => shortcutReference({ desktop }).flatMap(section => section.rows.map(row => `${row.label}: ${row.keys.join(' ')}`));

  it('lists every catalog shortcut with the keys the palette shows, so the two cannot drift', () => {
    for (const command of COMMANDS.filter(entry => entry.shortcut))
      expect(rows(true)).toContain(`${command.label.replace(/…$/, '')}: ${command.shortcut}`);
  });

  it('leaves desktop-only shortcuts out of the browser preview', () => {
    const desktopOnly = COMMANDS.filter(entry => entry.shortcut && entry.requiresDesktop);
    expect(desktopOnly.length).toBeGreaterThan(0);
    for (const command of desktopOnly) expect(rows(false).some(row => row.startsWith(`${command.label}:`))).toBe(false);
  });
});
