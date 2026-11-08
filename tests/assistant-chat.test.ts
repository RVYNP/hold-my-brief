import { describe, expect, it } from 'vitest';
import { fromChatCompletion, toChatCompletions } from '../src/assistant-chat';
import type { Message } from '../src/assistant';

const tools = [{ name: 'search', description: 'Find text', input_schema: { type: 'object' as const, properties: { query: { type: 'string' } }, required: ['query'] } }];
const base = { model: 'm', system: 'be brief', tools, max_tokens: 1024 };

describe('toChatCompletions', () => {
  it('puts the system prompt first and maps tools to functions', () => {
    const body = toChatCompletions({ ...base, messages: [{ role: 'user', content: 'hi' }], tool_choice: 'auto' });
    expect(body.messages).toEqual([{ role: 'system', content: 'be brief' }, { role: 'user', content: 'hi' }]);
    expect(body.tools).toEqual([{ type: 'function', function: { name: 'search', description: 'Find text', parameters: tools[0].input_schema } }]);
    expect(body.tool_choice).toBe('auto');
    expect(body.max_tokens).toBe(1024);
  });

  it('turns a multi-round tool conversation into calls and tool messages', () => {
    const messages: Message[] = [
      { role: 'user', content: 'find darcy' },
      { role: 'assistant', content: [{ type: 'text', text: 'Looking.' }, { type: 'tool_use', id: 'a', name: 'search', input: { query: 'darcy' } }, { type: 'tool_use', id: 'b', name: 'search', input: { query: 'x' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: '12 matches' }, { type: 'tool_result', tool_use_id: 'b', content: 'no such thing', is_error: true }] },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'c', name: 'search', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c', content: 'ok' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] },
    ];
    const { messages: out } = toChatCompletions({ ...base, messages });
    expect(out.slice(1)).toEqual([
      { role: 'user', content: 'find darcy' },
      { role: 'assistant', content: 'Looking.', tool_calls: [{ id: 'a', type: 'function', function: { name: 'search', arguments: '{"query":"darcy"}' } }, { id: 'b', type: 'function', function: { name: 'search', arguments: '{"query":"x"}' } }] },
      { role: 'tool', tool_call_id: 'a', content: '12 matches' },
      { role: 'tool', tool_call_id: 'b', content: 'Error: no such thing' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'c', type: 'function', function: { name: 'search', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'c', content: 'ok' },
      { role: 'assistant', content: 'Done.' },
    ]);
  });
});

describe('fromChatCompletion', () => {
  it('reads text and stop reasons', () => {
    expect(fromChatCompletion({ choices: [{ message: { content: 'Hello' }, finish_reason: 'stop' }] })).toEqual({ content: [{ type: 'text', text: 'Hello' }], stop_reason: 'end_turn' });
    expect(fromChatCompletion({ choices: [{ message: { content: '' }, finish_reason: 'length' }] })).toEqual({ content: [], stop_reason: 'max_tokens' });
    expect(fromChatCompletion({})).toEqual({ content: [], stop_reason: null });
  });

  it('reads tool calls with parsed arguments, surviving malformed ones', () => {
    const result = fromChatCompletion({ choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [
      { id: 'a', function: { name: 'search', arguments: '{"query":"darcy"}' } },
      { id: 'b', function: { name: 'search', arguments: '{"query":' } },
      { id: 'c', function: { name: 'search', arguments: '' } },
      { id: 'd', function: { name: 'search', arguments: '[1]' } },
    ] } }] });
    expect(result.stop_reason).toBe('tool_use');
    expect(result.content).toEqual([
      { type: 'tool_use', id: 'a', name: 'search', input: { query: 'darcy' } },
      { type: 'tool_use', id: 'b', name: 'search', input: {} },
      { type: 'tool_use', id: 'c', name: 'search', input: {} },
      { type: 'tool_use', id: 'd', name: 'search', input: {} },
    ]);
  });

  it('round-trips a tool conversation', () => {
    const response = fromChatCompletion({ choices: [{ finish_reason: 'tool_calls', message: { content: 'Looking.', tool_calls: [{ id: 'a', function: { name: 'search', arguments: '{"query":"q"}' } }] } }] });
    const messages: Message[] = [{ role: 'user', content: 'q?' }, { role: 'assistant', content: response.content }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: 'r' }] }];
    const out = toChatCompletions({ ...base, messages }).messages;
    expect(out[2]).toEqual({ role: 'assistant', content: 'Looking.', tool_calls: [{ id: 'a', type: 'function', function: { name: 'search', arguments: '{"query":"q"}' } }] });
    expect(out[3]).toEqual({ role: 'tool', tool_call_id: 'a', content: 'r' });
  });
});
