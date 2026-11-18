import { describe, expect, it, vi } from 'vitest';
import { converse, type ContentBlock, type ModelResponse, type Send, type Tool } from '../src/assistant';
import { toChatCompletions } from '../src/assistant-chat';
import fixture from './fixtures/assistant-requests.json';

/**
 * The requests the assistant sends today, recorded from converse() and toChatCompletions(). The
 * native side's strict message check (`requests_sent_today_are_accepted_unchanged` in
 * src-tauri/src/assistant.rs) reads the same file, so tightening one side cannot silently break the other.
 * When this fails on purpose (the app's requests changed), replace the file with the recorded value
 * from the diff and check that the native test still accepts it.
 */
const reply = (...content: ContentBlock[]): ModelResponse => ({ content, stop_reason: content.some(block => block.type === 'tool_use') ? 'tool_use' : 'end_turn' });
const tool = (name: string, run: Tool['run'], endsTurn = false): Tool => ({ name, description: `${name} tool`, input_schema: { type: 'object', properties: { target: { type: 'string' } } }, run, endsTurn });

async function record() {
  const bodies: Record<string, unknown>[] = [];
  const responses = [
    reply({ type: 'text', text: 'Going there.' }, { type: 'tool_use', id: 't1', name: 'go_to', input: { target: '7' } }, { type: 'tool_use', id: 't2', name: 'missing', input: {} }),
    reply({ type: 'text', text: 'You are on page 7.' }),
    reply({ type: 'tool_use', id: 't3', name: 'open_document', input: { target: 'doc-1' } }),
    reply({ type: 'text', text: 'It says hello.' }),
  ];
  const send = vi.fn<Send>(async body => { bodies.push(structuredClone(body)); return responses.shift()!; });
  const tools = [tool('go_to', async input => ({ result: { position: `Page ${input.target}` }, step: 'Went to page 7' })), tool('open_document', async () => ({ result: { opened: 'Book' }, step: 'Opened Book' }), true)];
  const history: Parameters<typeof converse>[0] = [];
  const options = { send, model: 'model-1', system: 'You are the assistant.', tools };
  await converse(history, 'take me to page 7', options);
  await converse(history, 'open the book', options);
  await converse(history, 'what does it say?', options);
  expect(responses).toHaveLength(0);
  return bodies;
}

describe('assistant request fixtures', () => {
  it('match what converse and toChatCompletions send', async () => {
    const anthropic = await record();
    const chat = anthropic.map(body => toChatCompletions(body as Parameters<typeof toChatCompletions>[0]));
    const recorded = { anthropic, chat };
    expect(fixture).toEqual(recorded);
  });

  it('cover a tool call, a tool error, a turn-ending tool and a follow-up', async () => {
    const { anthropic, chat } = fixture;
    const text = JSON.stringify(anthropic);
    for (const part of ['"tool_use"', '"tool_result"', '"is_error":true', 'Opened Book']) expect(text).toContain(part);
    expect(JSON.stringify(chat)).toContain('"tool_calls"');
    expect(chat.at(-1)?.messages.at(-1)).toEqual({ role: 'user', content: 'what does it say?' });
  });
});
