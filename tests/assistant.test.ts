import { describe, expect, it, vi, type Mock } from 'vitest';
import { ASSISTANT_COMMANDS, Cancelled, MAX_TOOL_ROUNDS, chooseModel, converse, looksLikeQuestion, readerTools, type ContentBlock, type Message, type ModelResponse, type ReaderEnvironment, type Send, type Tool } from '../src/assistant';
import { COMMANDS } from '../src/commands';
import type { LibraryDocument } from '../src/catalog-types';

const reply = (...content: ContentBlock[]): ModelResponse => ({ content, stop_reason: content.some(block => block.type === 'tool_use') ? 'tool_use' : 'end_turn' });
const call = (id: string, name: string, input: Record<string, unknown> = {}): ContentBlock => ({ type: 'tool_use', id, name, input });
// The history array is extended in place, so each request's messages are snapshotted as sent.
const scripted = (...responses: ModelResponse[]) => { const sent: Message[][] = []; const send = vi.fn<Send>(async body => { sent.push(structuredClone(body.messages as Message[])); return responses.shift() ?? reply({ type: 'text', text: 'out of script' }); }); return Object.assign(send, { sent }); };
const tool = (name: string, run: Tool['run']): Tool => ({ name, description: name, input_schema: { type: 'object', properties: {} }, run });
const options = (send: Mock<Send>, tools: Tool[]) => ({ send, model: 'claude-test', system: 'system', tools });

describe('assistant conversation', () => {
  it('runs the tools the model asks for and returns its final answer with the steps taken', async () => {
    const history: Message[] = [];
    const goTo = tool('go_to', async input => ({ result: { position: `Page ${input.target}` }, step: `Went to page ${input.target}` }));
    const send = scripted(reply({ type: 'text', text: 'Going there.' }, call('t1', 'go_to', { target: '7' })), reply({ type: 'text', text: 'You are on page 7.' }));
    const turn = await converse(history, 'take me to page 7', options(send, [goTo]));

    expect(turn).toEqual({ answer: 'You are on page 7.', steps: ['Went to page 7'] });
    // The tool result answers the call it belongs to, in the next user turn.
    expect(history.map(message => message.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(history[2].content).toEqual([{ type: 'tool_result', tool_use_id: 't1', content: '{"position":"Page 7"}' }]);
    // Every request carries the model, the tool definitions without their implementations, and the
    // conversation as it stood: the question first, then the call and its result.
    const body = send.mock.calls[1][0];
    expect(body.model).toBe('claude-test');
    expect(body.tools).toEqual([{ name: 'go_to', description: 'go_to', input_schema: { type: 'object', properties: {} } }]);
    expect(send.sent[0]).toEqual([{ role: 'user', content: 'take me to page 7' }]);
    expect(send.sent[1].map(message => message.role)).toEqual(['user', 'assistant', 'user']);
    expect(send.sent[1][2].content).toEqual([{ type: 'tool_result', tool_use_id: 't1', content: '{"position":"Page 7"}' }]);
  });

  it('reports a failing or unknown tool to the model as an error and keeps going', async () => {
    const history: Message[] = [];
    const broken = tool('find_in_document', async () => { throw new Error('No text layer in this document'); });
    const send = scripted(reply(call('a', 'find_in_document', { query: 'x' }), call('b', 'delete_everything')), reply({ type: 'text', text: 'It has no text.' }));
    const turn = await converse(history, 'find x', options(send, [broken]));

    expect(turn.answer).toBe('It has no text.');
    expect(history[2].content).toEqual([
      { type: 'tool_result', tool_use_id: 'a', content: 'No text layer in this document', is_error: true },
      { type: 'tool_result', tool_use_id: 'b', content: 'There is no tool called delete_everything.', is_error: true },
    ]);
  });

  it('stops a model that never finishes and leaves a history a follow-up can continue', async () => {
    const history: Message[] = [];
    const noop = tool('reader_state', async () => ({ result: {} }));
    const send: Mock<Send> = vi.fn<Send>(async () => reply(call(`c${send.mock.calls.length}`, 'reader_state')));
    const turn = await converse(history, 'loop', options(send, [noop]));

    expect(turn.answer).toMatch(`stopped after ${MAX_TOOL_ROUNDS} steps`);
    expect(send).toHaveBeenCalledTimes(MAX_TOOL_ROUNDS + 1);
    // The unanswered tool call is dropped: every remaining call has its result right after it.
    const last = history.at(-1)!;
    expect(last.role).toBe('user');
    for (let index = 1; index < history.length; index += 2) {
      const calls = (history[index].content as ContentBlock[]).filter(block => block.type === 'tool_use').map(block => block.type === 'tool_use' && block.id);
      const results = (history[index + 1].content as ContentBlock[]).map(block => block.type === 'tool_result' && block.tool_use_id);
      expect(results).toEqual(calls);
    }
  });

  it('stops before the next request or tool once cancelled, so a closed answer cannot act', async () => {
    let closed = false;
    const goTo = vi.fn<Tool['run']>(async () => ({ result: {} }));
    const send = scripted(reply(call('a', 'reader_state'), call('b', 'go_to', { target: '9' })));
    const state = tool('reader_state', async () => { closed = true; return { result: {} }; });
    await expect(converse([], 'go', { ...options(send, [state, tool('go_to', goTo)]), cancelled: () => closed })).rejects.toBeInstanceOf(Cancelled);
    expect(goTo).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('keeps only the text of a reply cut off mid tool call, so a follow-up stays valid', async () => {
    const history: Message[] = [];
    const send = scripted({ content: [{ type: 'text', text: 'Partial' }, call('x', 'go_to')], stop_reason: 'max_tokens' });
    const turn = await converse(history, 'q', options(send, []));
    expect(turn.answer).toBe('Partial');
    expect(history.at(-1)).toEqual({ role: 'assistant', content: [{ type: 'text', text: 'Partial' }] });
  });
});

describe('reader tools', () => {
  const doc = (name: string, extra: Partial<LibraryDocument> = {}): LibraryDocument => ({ path: `/books/${name}`, name, format: 'pdf', lastOpened: 0, collectionIds: [], favorite: false, tags: [], notes: '', ...extra });
  const environment = (overrides: Partial<ReaderEnvironment> = {}): ReaderEnvironment => ({
    snapshot: () => ({}), hasDocument: () => true,
    goTo: async target => `Page ${target}`, readText: async () => ({ label: 'Page 1', text: 'text' }),
    search: async () => ({ hits: [], truncated: false }), showMatch: async () => 'Page 1', outline: () => [],
    library: async () => [doc('Rust Book.pdf', { tags: ['rust'] }), doc('Tauri Guide.pdf')], open: async () => true,
    setAppearance: () => 'Brief · Dark', runCommand: async id => id,
    filterLibrary: async () => ({ colour: null, query: '', matches: 0, names: [], pending: 0 }), colourNames: ['green'],
    ...overrides,
  });
  const byName = (tools: Tool[], name: string) => tools.find(candidate => candidate.name === name)!;

  it('opens only documents it found, by id, and never sends full paths or private notes', async () => {
    const open = vi.fn(async () => true);
    const library = async () => [doc('Rust Book.pdf', { tags: ['rust'], path: '/Users/me/Books/lang/Rust Book.pdf', notes: 'secret plan' }), doc('Tauri Guide.pdf')];
    const tools = readerTools(environment({ open, library }));
    await expect(byName(tools, 'open_document').run({ id: '/etc/passwd' })).rejects.toThrow('search_library');
    // Notes are not searched, so a probe for their contents finds nothing.
    expect((await byName(tools, 'search_library').run({ query: 'secret' })).result).toEqual([]);
    const found = await byName(tools, 'search_library').run({ query: 'RUST' });
    expect(found.result).toEqual([{ id: 'doc-1', name: 'Rust Book.pdf', folder: 'lang', format: 'pdf', favorite: false, tags: ['rust'], available: true }]);
    expect(JSON.stringify(found.result)).not.toContain('/Users/me');
    // The folder name is searchable ("the lang books").
    expect((await byName(tools, 'search_library').run({ query: 'lang' })).result).toHaveLength(1);
    await expect(byName(tools, 'open_document').run({ id: 'doc-1' })).resolves.toMatchObject({ step: 'Opened Rust Book.pdf' });
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ path: '/Users/me/Books/lang/Rust Book.pdf' }));
  });

  it('offers only commands that exist in the catalog', () => {
    for (const id of Object.keys(ASSISTANT_COMMANDS)) expect(COMMANDS.some(command => command.id === id), id).toBe(true);
  });

  it('filters the library only by a known colour, and reports what it shows', async () => {
    let pending = 0;
    const filterLibrary = vi.fn(async (change: { colour?: string | null; query?: string }) => ({ colour: change.colour ?? null, query: change.query ?? '', matches: 3, names: ['a', 'b', 'c'], pending }));
    const tools = readerTools(environment({ filterLibrary, colourNames: ['green', 'red'] }));
    await expect(byName(tools, 'filter_library').run({ colour: 'chartreuse' })).rejects.toThrow('green, red');
    expect(filterLibrary).not.toHaveBeenCalled();
    const shown = await byName(tools, 'filter_library').run({ colour: 'Green', query: 'packaging' });
    expect(filterLibrary).toHaveBeenCalledWith({ colour: 'green', query: 'packaging' });
    expect(shown.step).toBe('Library: green “packaging” · 3 matches');
    // A count taken while pictures are still being measured is labelled as partial.
    pending = 12;
    expect((await byName(tools, 'filter_library').run({ colour: 'red' })).step).toBe('Library: red · 3 matches (12 still being measured)');
    await byName(tools, 'filter_library').run({ colour: null });
    expect(filterLibrary).toHaveBeenLastCalledWith({ colour: null, query: undefined });
  });

  it('shows a match only from the latest search, by index', async () => {
    const hit = { text: 'Darcy', excerpt: 'Mr. Darcy danced', start: 0, end: 5, unit: 3, unitLabel: 'Page 3' };
    const showMatch = vi.fn(async () => 'Page 3 of 9');
    const tools = readerTools(environment({ search: async () => ({ hits: [hit], truncated: false }), showMatch }));
    await expect(byName(tools, 'show_match').run({ index: 0 })).rejects.toThrow('find_in_document first');
    const found = await byName(tools, 'find_in_document').run({ query: 'Darcy' });
    expect(found.result).toEqual({ total: 1, more: false, matches: [{ index: 0, where: 'Page 3', excerpt: 'Mr. Darcy danced' }] });
    await expect(byName(tools, 'show_match').run({ index: 1 })).rejects.toThrow();
    await expect(byName(tools, 'show_match').run({ index: 0 })).resolves.toMatchObject({ result: { position: 'Page 3 of 9' } });
    expect(showMatch).toHaveBeenCalledWith(hit, 'Darcy');
  });

  it('runs only allow-listed commands and needs a document for document tools', async () => {
    const runCommand = vi.fn(async (id: string) => id);
    const tools = readerTools(environment({ runCommand, hasDocument: () => false }));
    await expect(byName(tools, 'run_command').run({ command: 'clear-data' })).rejects.toThrow('not a command');
    await expect(byName(tools, 'run_command').run({ command: 'pin' })).resolves.toMatchObject({ result: { done: 'pin' } });
    expect(runCommand).toHaveBeenCalledTimes(1);
    for (const name of ['read_current_text', 'find_in_document', 'go_to', 'contents'])
      await expect(byName(tools, name).run({ query: 'x', target: '1' })).rejects.toThrow('No document is open');
  });
});

describe('palette and model choices', () => {
  it('treats questions and requests to explain as questions, and phrases and commands as not', () => {
    for (const query of ['what is a lifetime?', 'Why does Darcy refuse', 'summarize this chapter', 'explain borrowing', 'is this the last page'])
      expect(looksLikeQuestion(query)).toBe(true);
    for (const query of ['borrow checker', 'fit page', 'dark mode', 'Mr. Darcy', 'island'])
      expect(looksLikeQuestion(query)).toBe(false);
  });

  it('keeps a saved model that is still offered, else prefers the newest Sonnet', () => {
    const models = [{ id: 'claude-opus-9' }, { id: 'claude-sonnet-9' }, { id: 'claude-sonnet-8' }];
    expect(chooseModel(models, 'claude-sonnet-8', 'anthropic')).toBe('claude-sonnet-8');
    expect(chooseModel(models, 'claude-retired', 'anthropic')).toBe('claude-sonnet-9');
    expect(chooseModel([{ id: 'claude-haiku-9' }], null, 'anthropic')).toBe('claude-haiku-9');
    expect(chooseModel([], null, 'anthropic')).toBeUndefined();
  });

  it('chooses per provider', () => {
    const routed = [{ id: 'meta/llama' }, { id: 'openai/gpt-5' }, { id: 'anthropic/claude-sonnet-9' }];
    expect(chooseModel(routed, null, 'openrouter')).toBe('anthropic/claude-sonnet-9');
    expect(chooseModel(routed.slice(0, 2), null, 'openrouter')).toBe('openai/gpt-5');
    expect(chooseModel([{ id: 'meta/llama' }], null, 'openrouter')).toBe('meta/llama');
    expect(chooseModel(routed, 'meta/llama', 'openrouter')).toBe('meta/llama');
    const openai = [{ id: 'o3' }, { id: 'gpt-5-mini' }, { id: 'gpt-5' }];
    expect(chooseModel(openai, null, 'openai')).toBe('gpt-5');
    expect(chooseModel([{ id: 'gpt-5-nano' }, { id: 'o3' }], null, 'openai')).toBe('gpt-5-nano');
    expect(chooseModel([{ id: 'o3' }], null, 'openai')).toBe('o3');
  });
});
