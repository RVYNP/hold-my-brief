import type { SearchHit, SearchOptions } from './search';

/**
 * The find bar: a search field over the open document with previous/next navigation.
 *
 * It owns no document state. The adapter searches and reveals; this collects the query,
 * debounces it, keeps the current result index and reports counts. Keeping the adapter
 * interface this narrow is what lets one bar drive PDF pages, EPUB sections and text lines.
 */

/** Wait after the last keystroke before searching, so typing does not search per character. */
const SEARCH_DEBOUNCE = 140;

/** Cap on results per search; mirrors the adapter-side cap so the label stays honest. */
const MAX_HITS = 2000;

export type FindTarget = {
  search?: (query: string, options?: SearchOptions) => Promise<{ hits: SearchHit[]; truncated: boolean; unavailable?: string }>;
  revealSearchMatch?: (hit: SearchHit) => Promise<void>;
  clearSearchHighlights?: () => void;
};

export type FindBarContext = {
  /** The adapter to search, or undefined when no document is open. */
  target: () => FindTarget | undefined;
  /** True for formats with no text at all, so the bar can say why rather than "no matches". */
  formatIsImage: () => boolean;
  onError: (error: unknown) => void;
};

export type FindBar = {
  /** The bar element, to be inserted into the document once. */
  element: HTMLElement;
  /** Shows the bar and focuses its field; `query`, when given, replaces the field and searches. */
  open: (query?: string) => void;
  close: () => void;
  isOpen: () => boolean;
  /** Reruns the current query, e.g. after a document change while the bar is open. */
  refresh: () => void;
};

export function createFindBar(context: FindBarContext): FindBar {
  const bar = document.createElement('div');
  bar.id = 'find-bar';
  bar.hidden = true;
  bar.setAttribute('role', 'search');
  bar.setAttribute('aria-label', 'Find in document');
  bar.innerHTML = `
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
    <input id="find-query" type="search" autocomplete="off" spellcheck="false" aria-label="Find in document" placeholder="Find in document…">
    <span id="find-status" role="status" aria-live="polite"></span>
    <button id="find-case" type="button" aria-label="Match case" aria-pressed="false" title="Match case">Aa</button>
    <button id="find-word" type="button" aria-label="Whole word" aria-pressed="false" title="Whole word">ab</button>
    <button id="find-previous" type="button" aria-label="Previous match" title="Previous match (Shift+Enter)" disabled>↑</button>
    <button id="find-next" type="button" aria-label="Next match" title="Next match (Enter)" disabled>↓</button>
    <button id="find-close" type="button" aria-label="Close find" title="Close find (Esc)">×</button>`;

  const input = field<HTMLInputElement>('#find-query');
  const status = field<HTMLElement>('#find-status');
  const previous = field<HTMLButtonElement>('#find-previous');
  const next = field<HTMLButtonElement>('#find-next');
  const caseToggle = field<HTMLButtonElement>('#find-case');
  const wordToggle = field<HTMLButtonElement>('#find-word');

  let hits: SearchHit[] = [];
  let current = -1;
  let options: SearchOptions = {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  let token = 0;

  function field<T extends HTMLElement>(selector: string): T {
    const found = bar.querySelector<T>(selector);
    if (!found) throw new Error(`Find bar is missing ${selector}`);
    return found;
  }

  function setStatus(text: string, enabled: boolean): void {
    status.textContent = text;
    previous.disabled = !enabled;
    next.disabled = !enabled;
  }

  function report(): void {
    if (!input.value.trim()) return setStatus('', false);
    if (!hits.length) return setStatus('No matches', false);
    const trimmed = hits.length >= MAX_HITS ? ` (first ${MAX_HITS})` : '';
    setStatus(`${current + 1} of ${hits.length}${trimmed}`, true);
  }

  function clearHighlight(): void {
    try { context.target()?.clearSearchHighlights?.(); } catch { /* nothing to clear */ }
  }

  async function reveal(): Promise<void> {
    const hit = current >= 0 ? hits[current] : undefined;
    if (!hit) return;
    try { await context.target()?.revealSearchMatch?.(hit); }
    catch (error) { context.onError(error); }
    report();
  }

  async function run(): Promise<void> {
    const query = input.value;
    const runToken = ++token;
    if (!query.trim()) { hits = []; current = -1; clearHighlight(); return report(); }
    const target = context.target();
    if (!target?.search) {
      hits = []; current = -1;
      return setStatus(context.formatIsImage() ? 'Images have no text to search' : 'This document cannot be searched', false);
    }
    try {
      const result = await target.search(query, options);
      if (runToken !== token) return; // A newer keystroke superseded this search.
      if (result.unavailable) { hits = []; current = -1; return setStatus(result.unavailable, false); }
      hits = result.hits; current = hits.length ? 0 : -1;
      report();
      if (current >= 0) await reveal();
    } catch (error) { if (runToken === token) context.onError(error); }
  }

  async function step(direction: 1 | -1): Promise<void> {
    if (!hits.length) return;
    current = (current + direction + hits.length) % hits.length;
    await reveal();
  }

  function close(): void {
    bar.hidden = true;
    clearHighlight();
    hits = []; current = -1; input.value = '';
    token++;
  }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    // Drop the old marks immediately so stale highlights never sit over changed text.
    clearHighlight();
    timer = setTimeout(() => void run(), SEARCH_DEBOUNCE);
  });

  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (hits.length) void step(event.shiftKey ? -1 : 1);
      else void run();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  });

  for (const [toggle, key] of [[caseToggle, 'matchCase'], [wordToggle, 'wholeWord']] as const) {
    toggle.addEventListener('click', () => {
      const pressed = toggle.getAttribute('aria-pressed') !== 'true';
      toggle.setAttribute('aria-pressed', String(pressed));
      options = { ...options, [key]: pressed };
      void run();
    });
  }

  previous.addEventListener('click', () => void step(-1));
  next.addEventListener('click', () => void step(1));
  field('#find-close').addEventListener('click', () => close());

  return {
    element: bar,
    open: (query?: string) => {
      bar.hidden = false;
      if (query !== undefined) input.value = query;
      input.focus();
      input.select();
      if (input.value.trim()) void run();
    },
    close,
    isOpen: () => !bar.hidden,
    refresh: () => { if (!bar.hidden) void run(); },
  };
}
