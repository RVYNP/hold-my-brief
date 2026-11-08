import { looksLikeQuestion } from './assistant';
import { groupCommands, parseIntent, scoreCommand, searchCommands, unavailableReason, type Command, type CommandGroup } from './commands';

/**
 * A keyboard-first palette over the command catalog.
 *
 * The listbox is driven by `aria-activedescendant` rather than moving DOM focus, so the
 * text field keeps focus (and typing) while arrow keys move the highlight. Every row is a
 * real element with an id so screen readers announce the active option.
 *
 * Availability is evaluated at render time: a command that needs a document stays visible
 * but disabled, with the reason as its description, which is why the empty document case
 * teaches rather than hides.
 *
 * A query is also read as a request (see `parseIntent`): a number goes there, "find …" finds,
 * and free text that names no command is offered as a find in the open document. With the AI
 * assistant on, any text can also be asked; a question leads the list.
 */

export type PaletteContext = {
  hasDocument: () => boolean;
  desktop: boolean;
  /** Runs a command by id. Errors are the caller's to report. */
  run: (id: string) => void | Promise<void>;
  /** Goes to a typed location, read the way Go to location reads it. */
  goTo: (target: string) => void | Promise<void>;
  /** Opens the find bar on `text`. */
  find: (text: string) => void;
  /** The opt-in assistant, when the desktop app has one turned on. */
  assistant?: { ready: () => boolean; ask: (question: string) => void };
};

/** One selectable line: a catalog command or a typed request. */
type Row = { label: string; shortcut?: string; reason?: string; run: () => void | Promise<void> };

export type Palette = {
  /** The dialog element, to be appended to the document once. */
  element: HTMLDialogElement;
  open: () => void;
  close: () => void;
  isOpen: () => boolean;
};

const MAX_ROWS = 60;

export function createPalette(context: PaletteContext): Palette {
  const dialog = document.createElement('dialog');
  dialog.id = 'palette';
  dialog.className = 'palette';
  dialog.setAttribute('aria-label', 'Command palette');
  dialog.innerHTML = `
    <div class="palette-search">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      <input id="palette-input" type="text" role="combobox" aria-expanded="true" aria-autocomplete="list" aria-controls="palette-list" aria-label="Go to, find or run a command" spellcheck="false" autocomplete="off" placeholder="Type a page, a phrase or a command…">
      <kbd class="palette-esc">Esc</kbd>
    </div>
    <div id="palette-list" class="palette-list" role="listbox" aria-label="Matches"></div>
    <p id="palette-empty" class="palette-empty" hidden>No matching command.</p>`;

  const input = dialog.querySelector<HTMLInputElement>('#palette-input')!;
  const list = dialog.querySelector<HTMLElement>('#palette-list')!;
  const empty = dialog.querySelector<HTMLElement>('#palette-empty')!;

  let rows: Row[] = [];
  let enabled: boolean[] = [];
  let actived = 0;

  function render(query: string): void {
    const state = { hasDocument: context.hasDocument(), desktop: context.desktop };
    const needsDocument = state.hasDocument ? undefined : 'Open a document first';
    const text = query.trim();
    const commands = searchCommands(query).slice(0, MAX_ROWS);
    const toRow = (command: Command): Row => ({ label: command.label, shortcut: command.shortcut, reason: unavailableReason(command, state), run: () => context.run(command.id) });

    let sections: { group?: CommandGroup; rows: Row[] }[];
    if (!text) {
      // Headings help when browsing an unfiltered list, but while searching they would fight
      // the ranking (a weak "Navigate" hit would sit above the best "View" hit), so a query
      // shows one flat relevance-ordered list.
      sections = groupCommands(commands).map(section => ({ group: section.group, rows: section.commands.map(toRow) }));
    } else {
      const intent = parseIntent(query);
      const request: Row[] = intent?.kind === 'goto' ? [{ label: `Go to ${intent.target}`, reason: needsDocument, run: () => context.goTo(intent.target) }]
        : intent?.kind === 'find' ? [{ label: `Find “${intent.text}”`, shortcut: 'Ctrl F', reason: needsDocument, run: () => context.find(intent.text) }]
        : [];
      // Free text that names no command well is most likely words from the document, so the
      // find leads; when a command matches by name, the find follows the commands instead.
      const fallback: Row[] = !intent && text.length >= 2 && state.hasDocument ? [{ label: `Find “${text}” in document`, shortcut: 'Ctrl F', run: () => context.find(text) }] : [];
      const named = commands.some(command => (scoreCommand(command, query) ?? 0) >= 700);
      const assistant = context.assistant;
      const ask: Row[] = assistant?.ready() && text.length >= 2 ? [{ label: `Ask the assistant “${text}”`, run: () => assistant.ask(text) }] : [];
      // A command named by the query keeps the lead even when it reads like a question ("show shortcuts").
      const question = !intent && !named && looksLikeQuestion(text);
      sections = [{ rows: [...(question ? ask : []), ...request, ...(named ? [] : fallback), ...commands.map(toRow), ...(named ? fallback : []), ...(question ? [] : ask)] }];
    }
    rows = sections.flatMap(section => section.rows);
    enabled = rows.map(row => !row.reason);
    // Prefer selecting the first usable row so Enter does something sensible straight away;
    // when every match is disabled, the first row still describes the intent best.
    const firstEnabled = enabled.findIndex(Boolean);
    actived = firstEnabled === -1 ? 0 : firstEnabled;
    list.replaceChildren();
    if (!text && !state.hasDocument) {
      const caption = document.createElement('p');
      caption.className = 'palette-note';
      caption.setAttribute('aria-hidden', 'true');
      caption.textContent = 'Dimmed commands need an open document.';
      list.append(caption);
    }
    empty.hidden = rows.length > 0;

    let index = 0;
    for (const section of sections) {
      if (!section.rows.length) continue;
      if (section.group) {
        const heading = document.createElement('div');
        heading.className = 'palette-group';
        heading.id = `palette-group-${section.group.toLowerCase()}`;
        heading.setAttribute('role', 'presentation');
        heading.textContent = section.group;
        list.append(heading);
      }
      const group = document.createElement('div');
      group.setAttribute('role', 'group');
      if (section.group) group.setAttribute('aria-labelledby', `palette-group-${section.group.toLowerCase()}`);
      for (const entry of section.rows) {
        const position = index++;
        const row = document.createElement('div');
        row.id = `palette-row-${position}`;
        row.className = 'palette-row';
        row.setAttribute('role', 'option');
        row.setAttribute('aria-selected', 'false');
        row.setAttribute('aria-disabled', String(!enabled[position]));
        row.dataset.index = String(position);
        if (entry.reason) row.title = entry.reason;
        const name = document.createElement('span');
        name.className = 'palette-label';
        name.textContent = entry.label;
        row.append(name);
        if (entry.shortcut) {
          const keys = document.createElement('kbd');
          keys.textContent = entry.shortcut;
          row.append(keys);
        }
        // A disabled row explains itself rather than just going grey. "Open a document first" would repeat
        // down every unavailable row, so with no document open it is said once above the list and kept on
        // the rows only for screen readers and hover; any other reason stays on its row.
        if (entry.reason) {
          const note = document.createElement('span');
          note.className = entry.reason === needsDocument ? 'palette-hint palette-hint-quiet' : 'palette-hint';
          note.textContent = entry.reason;
          row.append(note);
        }
        group.append(row);
      }
      list.append(group);
    }
    highlight(actived);
  }

  function highlight(next: number): void {
    const elements = list.querySelectorAll<HTMLElement>('.palette-row');
    if (!elements.length) { input.removeAttribute('aria-activedescendant'); return; }
    actived = Math.max(0, Math.min(elements.length - 1, next));
    elements.forEach((element, index) => element.setAttribute('aria-selected', String(index === actived)));
    input.setAttribute('aria-activedescendant', elements[actived].id);
    elements[actived].scrollIntoView({ block: 'nearest' });
  }

  /** Moves the highlight by `step`, skipping disabled rows and wrapping. */
  function step(delta: number): void {
    if (!enabled.length) return;
    let next = actived;
    for (let tried = 0; tried < enabled.length; tried++) {
      next = (next + delta + enabled.length) % enabled.length;
      if (enabled[next]) break;
    }
    highlight(next);
  }

  function choose(index: number): void {
    const row = rows[index];
    if (!row || !enabled[index]) return;
    close();
    void Promise.resolve(row.run()).catch(() => {});
  }

  function close(): void {
    if (dialog.open) dialog.close();
    input.value = '';
  }

  input.addEventListener('input', () => render(input.value));

  input.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown') { event.preventDefault(); step(1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); step(-1); }
    else if (event.key === 'Home' && !input.value) { event.preventDefault(); highlight(0); }
    else if (event.key === 'End' && !input.value) { event.preventDefault(); highlight(rows.length - 1); }
    else if (event.key === 'Enter') { event.preventDefault(); choose(actived); }
    else if (event.key === 'Escape') { event.preventDefault(); close(); }
  });

  // Pointer selection; mousedown is prevented on the list so the input keeps focus.
  list.addEventListener('mousedown', event => event.preventDefault());
  list.addEventListener('click', event => {
    const row = (event.target as Element).closest<HTMLElement>('.palette-row');
    if (row) choose(Number(row.dataset.index));
  });
  list.addEventListener('mousemove', event => {
    const row = (event.target as Element).closest<HTMLElement>('.palette-row');
    if (row && Number(row.dataset.index) !== actived) highlight(Number(row.dataset.index));
  });

  // Clicking the backdrop (outside the dialog box) dismisses.
  dialog.addEventListener('click', event => { if (event.target === dialog) close(); });

  return {
    element: dialog,
    open: () => {
      if (dialog.open) return;
      input.value = '';
      render('');
      dialog.showModal();
      input.focus();
    },
    close,
    isOpen: () => dialog.open,
  };
}
