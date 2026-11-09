import type { LibraryDocument } from './catalog-types';
import type { LibraryFilterResult } from './library';
import type { SearchHit, SearchOptions } from './search';
import type { OutlineItem } from './types';
import { palettes } from './theme';

/**
 * The opt-in assistant: Claude or another model, through the user's own Anthropic, OpenRouter or
 * OpenAI API key, finding and changing things in the reader on request.
 *
 * This module is the conversation loop and the reader tools, free of DOM and network so both are
 * unit-tested. The network lives in Rust (src-tauri/src/assistant.rs), reached through `Send`;
 * the reader lives in main.ts, reached through `ReaderEnvironment`. Nothing here runs until the
 * user has saved a key and asks something.
 */

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };
export type Message = { role: 'user' | 'assistant'; content: string | ContentBlock[] };
export type ModelResponse = { content: ContentBlock[]; stop_reason: string | null };
/** Posts one Messages API request and returns the response. */
export type Send = (body: Record<string, unknown>) => Promise<ModelResponse>;

type Schema = { type: 'object'; properties: Record<string, unknown>; required?: string[] };
/** A tool the model may call. `run` returns what the model sees and, for actions, a line for the user. */
export type Tool = { name: string; description: string; input_schema: Schema; run: (input: Record<string, unknown>) => Promise<{ result: unknown; step?: string }> };

/** Tool rounds per question; a model that is still calling tools after this many is stopped. */
export const MAX_TOOL_ROUNDS = 8;
/** Characters of document text one `read_current_text` returns. */
export const READ_LIMIT = 12000;
const MAX_TOKENS = 1024;

export type Turn = { answer: string; steps: string[] };

/** Thrown when the conversation was closed while it was still working. */
export class Cancelled extends Error { constructor() { super('Cancelled'); } }

/**
 * Sends `question` after `history`, runs the tools the model asks for and returns its final
 * answer with a line per action taken. `history` is extended in place, so a follow-up question
 * continues the same conversation. `cancelled` is checked before every request and every tool,
 * so closing the answer stops the assistant from acting on the reader.
 */
export async function converse(history: Message[], question: string, options: { send: Send; model: string; system: string; tools: readonly Tool[]; onStep?: (step: string) => void; cancelled?: () => boolean }): Promise<Turn> {
  const { send, model, system, tools, onStep, cancelled = () => false } = options;
  const byName = new Map(tools.map(tool => [tool.name, tool]));
  const definitions = tools.map(({ name, description, input_schema }) => ({ name, description, input_schema }));
  const steps: string[] = [];
  history.push({ role: 'user', content: question });
  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    if (cancelled()) throw new Cancelled();
    const response = await send({ model, max_tokens: MAX_TOKENS, system, tools: definitions, messages: history });
    if (cancelled()) throw new Cancelled();
    const calls = response.content.filter((block): block is Extract<ContentBlock, { type: 'tool_use' }> => block.type === 'tool_use');
    const texts = response.content.filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text');
    if (response.stop_reason !== 'tool_use' || !calls.length) {
      // A reply cut off by max_tokens can end in a tool call that will never be answered; keep only
      // its text so the next follow-up is still a valid conversation.
      if (calls.length) { if (texts.length) history.push({ role: 'assistant', content: texts }); }
      else history.push({ role: 'assistant', content: response.content });
      return { answer: texts.map(block => block.text).join('\n\n').trim(), steps };
    }
    history.push({ role: 'assistant', content: response.content });
    if (round === MAX_TOOL_ROUNDS) break;
    const results: ContentBlock[] = [];
    for (const call of calls) {
      if (cancelled()) throw new Cancelled();
      const tool = byName.get(call.name);
      try {
        if (!tool) throw new Error(`There is no tool called ${call.name}.`);
        const { result, step } = await tool.run(call.input ?? {});
        if (step) { steps.push(step); onStep?.(step); }
        results.push({ type: 'tool_result', tool_use_id: call.id, content: typeof result === 'string' ? result : JSON.stringify(result) });
      } catch (error) {
        results.push({ type: 'tool_result', tool_use_id: call.id, content: error instanceof Error ? error.message : String(error), is_error: true });
      }
    }
    history.push({ role: 'user', content: results });
  }
  // The last response asked for more tools; drop it so a follow-up starts from a valid history.
  history.pop();
  return { answer: `I stopped after ${MAX_TOOL_ROUNDS} steps without finishing. Try a narrower question.`, steps };
}

/** What the reader can tell and do for the assistant, provided by main.ts. */
export type ReaderEnvironment = {
  snapshot: () => Record<string, unknown>;
  hasDocument: () => boolean;
  goTo: (target: string) => Promise<string>;
  readText: (limit: number) => Promise<{ label: string; text: string } | undefined>;
  search: (query: string, options: SearchOptions) => Promise<{ hits: SearchHit[]; truncated: boolean; unavailable?: string } | undefined>;
  showMatch: (hit: SearchHit, query: string) => Promise<string>;
  outline: () => OutlineItem[];
  library: () => Promise<LibraryDocument[]>;
  open: (document: LibraryDocument) => Promise<boolean>;
  /** Shows the library filtered by colour and/or text; colour null clears it. Returns what is shown. */
  filterLibrary: (change: { colour?: string | null; query?: string }) => Promise<LibraryFilterResult>;
  /** Colour names the library can filter by. */
  colourNames: readonly string[];
  setAppearance: (change: { mode?: string; theme?: string; page?: string }) => string;
  runCommand: (id: string) => Promise<string>;
};

/** Reader commands the assistant may run directly; dialogs, file pickers and data deletion stay with the user. */
export const ASSISTANT_COMMANDS: Readonly<Record<string, string>> = {
  library: 'show or hide the document library',
  back: 'return to where the reader was before the last jump',
  start: 'go to the first location', end: 'go to the last location',
  'fit-page': 'fit the whole page (PDF)', 'fit-width': 'fit the page width (PDF)', rotate: 'rotate the page 90 degrees',
  spread: 'toggle the two-page spread', cover: 'toggle whether the cover page stands alone in a spread',
  smaller: 'smaller text or zoom out', larger: 'larger text or zoom in',
  pin: 'toggle keeping the window above other apps', lock: 'toggle locking the window size',
  compact: 'resize to the compact 420 x 620 window', reading: 'resize to the larger reading window',
};

const MATCH_LIMIT = 15;
const LIBRARY_LIMIT = 20;
const needsDocument = () => new Error('No document is open. Open one from the library first.');
const text = (value: unknown, name: string) => { if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required.`); return value.trim(); };

/** The tools the model can use, bound to one reader. Search results and library listings are remembered so later calls can refer to them by index or path. */
export function readerTools(env: ReaderEnvironment): Tool[] {
  let matches: { query: string; hits: SearchHit[] } | undefined;
  const listed = new Map<string, LibraryDocument>();
  return [
    {
      name: 'reader_state', description: 'What is open and where the reader is: document name, format, position, window pin/lock state and appearance. Call this first when the question depends on the current document.',
      input_schema: { type: 'object', properties: {} },
      run: async () => ({ result: env.snapshot() }),
    },
    {
      name: 'read_current_text', description: `The plain text at the reader's current place (the page or spread on screen for PDF, the current chapter for EPUB, the lines from the top of the view for Markdown and text), up to ${READ_LIMIT} characters. Use it to answer questions about what the user is reading.`,
      input_schema: { type: 'object', properties: {} },
      run: async () => {
        if (!env.hasDocument()) throw needsDocument();
        const read = await env.readText(READ_LIMIT);
        if (!read) throw new Error('This document has no text to read (it is an image).');
        return { result: read, step: `Read ${read.label}` };
      },
    },
    {
      name: 'find_in_document', description: `Searches the whole open document for exact text and returns up to ${MATCH_LIMIT} matches with where they are and a short excerpt. Search for distinctive words, not whole sentences.`,
      input_schema: { type: 'object', properties: { query: { type: 'string' }, match_case: { type: 'boolean' }, whole_word: { type: 'boolean' } }, required: ['query'] },
      run: async input => {
        if (!env.hasDocument()) throw needsDocument();
        const query = text(input.query, 'query');
        const found = await env.search(query, { matchCase: input.match_case === true, wholeWord: input.whole_word === true });
        if (!found) throw new Error('This document cannot be searched (it is an image).');
        if (found.unavailable) throw new Error(found.unavailable);
        matches = { query, hits: found.hits };
        return {
          result: { total: found.hits.length, more: found.truncated, matches: found.hits.slice(0, MATCH_LIMIT).map((hit, index) => ({ index, where: hit.unitLabel, excerpt: hit.excerpt || hit.text })) },
          step: `Searched for “${query}”: ${found.hits.length}${found.truncated ? '+' : ''} ${found.hits.length === 1 ? 'match' : 'matches'}`,
        };
      },
    },
    {
      name: 'show_match', description: 'Takes the reader to one match from the last find_in_document and highlights it. Use this when the user wants to see or go to something you found.',
      input_schema: { type: 'object', properties: { index: { type: 'integer', minimum: 0 } }, required: ['index'] },
      run: async input => {
        const hit = matches?.hits[Number(input.index)];
        if (!matches || !hit) throw new Error('Call find_in_document first and use one of its match indexes.');
        const where = await env.showMatch(hit, matches.query);
        return { result: { position: where }, step: `Showed “${hit.text}” · ${where}` };
      },
    },
    {
      name: 'go_to', description: 'Moves the reader to a location: a physical page number for PDF and fixed-layout EPUB, a chapter number or percentage such as "35%" for reflowable EPUB, a source line number for Markdown and text, or a target from contents.',
      input_schema: { type: 'object', properties: { target: { type: 'string' } }, required: ['target'] },
      run: async input => {
        if (!env.hasDocument()) throw needsDocument();
        const where = await env.goTo(text(input.target, 'target'));
        return { result: { position: where }, step: `Went to ${where}` };
      },
    },
    {
      name: 'contents', description: 'The open document\'s table of contents or headings, each with a target that go_to accepts.',
      input_schema: { type: 'object', properties: {} },
      run: async () => {
        if (!env.hasDocument()) throw needsDocument();
        return { result: env.outline().slice(0, 300) };
      },
    },
    {
      name: 'search_library', description: `Finds documents in the user's library whose title, tags or folder name contain every word of the query (an empty query lists recent documents). Returns up to ${LIBRARY_LIMIT}, each with an id for open_document.`,
      input_schema: { type: 'object', properties: { query: { type: 'string' } } },
      run: async input => {
        const words = (typeof input.query === 'string' ? input.query : '').toLocaleLowerCase().split(/\s+/).filter(Boolean);
        // Only titles, tags and the containing folder's name are searched or sent: never full paths
        // (they carry the user's name and disk layout) and never private notes.
        const folder = (path: string) => path.split(/[\\/]/).slice(-2, -1)[0] ?? '';
        const documents = (await env.library()).filter(doc => {
          const haystack = [doc.name, folder(doc.path), ...doc.tags].join(' ').toLocaleLowerCase();
          return words.every(word => haystack.includes(word));
        }).slice(0, LIBRARY_LIMIT);
        return {
          result: documents.map(doc => {
            const id = `doc-${listed.size + 1}`;
            listed.set(id, doc);
            return { id, name: doc.name, folder: folder(doc.path), format: doc.format, favorite: doc.favorite, tags: doc.tags, available: doc.availability !== 'missing' };
          }),
        };
      },
    },
    {
      name: 'open_document', description: 'Opens a document from the library in the reader, by an id that search_library returned.',
      input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      run: async input => {
        const doc = listed.get(text(input.id, 'id'));
        if (!doc) throw new Error('Only ids returned by search_library can be opened.');
        if (!await env.open(doc)) throw new Error(`${doc.name} could not be opened.`);
        matches = undefined;
        return { result: { opened: doc.name }, step: `Opened ${doc.name}` };
      },
    },
    {
      name: 'filter_library', description: 'Shows the library to the user filtered by the dominant colour of each reference\'s thumbnail and/or by words in its title, tags or folder, e.g. "the green packaging scans". colour must be one of the listed names, or null to clear the colour. Returns how many match and the first titles.',
      input_schema: { type: 'object', properties: { colour: { type: ['string', 'null'], enum: [...env.colourNames, null] }, query: { type: 'string' } } },
      run: async input => {
        const colour = input.colour === null ? null : typeof input.colour === 'string' ? input.colour.toLowerCase() : undefined;
        if (colour && !env.colourNames.includes(colour)) throw new Error(`Use one of: ${env.colourNames.join(', ')}.`);
        const shown = await env.filterLibrary({ colour, query: typeof input.query === 'string' ? input.query : undefined });
        const what = [shown.colour, shown.query && `“${shown.query}”`].filter(Boolean).join(' ') || 'everything';
        // Colours not measured yet are not counted; say so rather than present a partial count as final.
        const pending = shown.pending ? ` (${shown.pending} still being measured)` : '';
        return { result: shown, step: `Library: ${what} · ${shown.matches} ${shown.matches === 1 ? 'match' : 'matches'}${pending}` };
      },
    },
    {
      name: 'set_appearance', description: `Changes how the reader looks. mode: system, light or dark. theme: ${palettes.join(', ')} (blossom and peony are the pink ones). page (text documents only): theme, white, sepia or dim.`,
      input_schema: { type: 'object', properties: { mode: { type: 'string', enum: ['system', 'light', 'dark'] }, theme: { type: 'string', enum: [...palettes] }, page: { type: 'string', enum: ['theme', 'white', 'sepia', 'dim'] } } },
      run: async input => {
        const summary = env.setAppearance({ mode: input.mode as string | undefined, theme: input.theme as string | undefined, page: input.page as string | undefined });
        return { result: { appearance: summary }, step: `Appearance: ${summary}` };
      },
    },
    {
      name: 'run_command', description: `Runs one reader command: ${Object.entries(ASSISTANT_COMMANDS).map(([id, does]) => `${id} (${does})`).join(', ')}.`,
      input_schema: { type: 'object', properties: { command: { type: 'string', enum: Object.keys(ASSISTANT_COMMANDS) } }, required: ['command'] },
      run: async input => {
        const id = text(input.command, 'command');
        if (!Object.hasOwn(ASSISTANT_COMMANDS, id)) throw new Error(`${id} is not a command the assistant can run.`);
        const done = await env.runCommand(id);
        return { result: { done }, step: done };
      },
    },
  ];
}

/** The standing instructions; the reader's state is fetched by tool so it is never stale. */
export const SYSTEM_PROMPT = `You are the assistant inside Hold My Brief, a small always-on-top desktop reader for PDF, EPUB, Markdown, text and images. The user asks you to find things, answer questions about what they are reading, or change the reader.
- Act instead of explaining: go to the place, show the match, switch the theme, open the document.
- Never guess page numbers, chapters or quotes. Find them with the tools first.
- Answers appear in a small panel: keep them to a few sentences, quote briefly, and say where (page, chapter or line).
- If something is not in the document or library, say so plainly.`;

const QUESTION = /\?\s*$|^(what|why|how|who|whom|whose|where|when|which|is|are|was|were|does|do|did|can|could|should|would|will|summari[sz]e|explain|tell|show|define|compare|list|translate)\b/i;
/** True when a palette query reads as a question for the assistant rather than a command or a phrase to find. */
export const looksLikeQuestion = (query: string) => QUESTION.test(query.trim());

export type Provider = 'anthropic' | 'openrouter' | 'openai';

/** Picks the model to use: the saved choice if still offered, otherwise a sensible default for the provider. */
export function chooseModel(models: readonly { id: string }[], saved: string | null, provider: Provider): string | undefined {
  if (saved && models.some(model => model.id === saved)) return saved;
  const find = (test: (id: string) => boolean) => models.find(model => test(model.id))?.id;
  if (provider === 'openrouter') return find(id => /^anthropic\/claude-sonnet/i.test(id)) ?? find(id => /^openai\/gpt-/i.test(id)) ?? models[0]?.id;
  if (provider === 'openai') return find(id => /^gpt-/i.test(id) && !/mini|nano/i.test(id)) ?? models[0]?.id;
  return find(id => /sonnet/i.test(id)) ?? models[0]?.id;
}
