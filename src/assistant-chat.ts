import type { ContentBlock, Message, ModelResponse, Tool } from './assistant';

/**
 * Translation between the assistant's Anthropic-shaped conversation and OpenAI Chat Completions,
 * which OpenRouter and OpenAI both speak. Pure: no network, no state.
 */

type ChatToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };
export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ChatToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };
export type ChatBody = {
  model: string;
  messages: ChatMessage[];
  tools?: { type: 'function'; function: { name: string; description: string; parameters: Tool['input_schema'] } }[];
  tool_choice?: unknown;
  max_tokens: number;
};
/** The parts of a Chat Completions response the assistant reads; everything is optional because providers vary. */
export type ChatCompletion = {
  choices?: { message?: { content?: string | null; tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[] }; finish_reason?: string | null }[];
};

export function toChatCompletions(request: { model: string; system: string; messages: readonly Message[]; tools?: readonly Pick<Tool, 'name' | 'description' | 'input_schema'>[]; max_tokens: number; tool_choice?: unknown }): ChatBody {
  const messages: ChatMessage[] = [{ role: 'system', content: request.system }];
  for (const message of request.messages) {
    if (typeof message.content === 'string') { messages.push({ role: message.role, content: message.content }); continue; }
    const blocks = message.content;
    const text = blocks.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n');
    if (message.role === 'assistant') {
      const calls: ChatToolCall[] = blocks.flatMap(block => block.type === 'tool_use' ? [{ id: block.id, type: 'function' as const, function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) } }] : []);
      messages.push({ role: 'assistant', content: text || null, ...(calls.length ? { tool_calls: calls } : {}) });
    } else {
      // Tool results must directly follow the assistant's calls, before any user text.
      for (const block of blocks) if (block.type === 'tool_result') messages.push({ role: 'tool', tool_call_id: block.tool_use_id, content: block.is_error ? `Error: ${block.content}` : block.content });
      if (text) messages.push({ role: 'user', content: text });
    }
  }
  const body: ChatBody = { model: request.model, messages, max_tokens: request.max_tokens };
  if (request.tools?.length) body.tools = request.tools.map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.input_schema } }));
  if (request.tool_choice !== undefined) body.tool_choice = request.tool_choice;
  return body;
}

const STOP: Record<string, string> = { tool_calls: 'tool_use', stop: 'end_turn', length: 'max_tokens' };

export function fromChatCompletion(response: ChatCompletion): ModelResponse {
  const choice = response?.choices?.[0];
  const message = choice?.message;
  const content: ContentBlock[] = [];
  if (typeof message?.content === 'string' && message.content) content.push({ type: 'text', text: message.content });
  for (const call of Array.isArray(message?.tool_calls) ? message.tool_calls : []) {
    let input: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(call.function?.arguments || '{}');
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) input = Object.fromEntries(Object.entries(parsed));
    } catch { /* malformed arguments: the tool reports what it is missing */ }
    content.push({ type: 'tool_use', id: call.id ?? `call_${content.length}`, name: call.function?.name ?? '', input });
  }
  const reason = choice?.finish_reason ?? null;
  // Some providers report "stop" while still returning tool calls.
  const stop_reason = content.some(block => block.type === 'tool_use') ? 'tool_use' : reason ? STOP[reason] ?? reason : null;
  return { content, stop_reason };
}
