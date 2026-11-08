import './assistant.css';
import { native } from './bridge';
import { chooseModel, converse, readerTools, SYSTEM_PROMPT, type Message, type ModelResponse, type Provider, type ReaderEnvironment, type Send } from './assistant';
import { fromChatCompletion, toChatCompletions, type ChatCompletion } from './assistant-chat';

/**
 * The assistant's two surfaces: a settings dialog that turns it on with the user's own Anthropic
 * key (and off again, forgetting the key), and an answer sheet that drops from the toolbar over
 * the top of the page with the answer, a line per action taken and a follow-up field.
 *
 * The key never comes back to the webview: Rust verifies it, keeps it in the system credential
 * store and makes every request (src-tauri/src/assistant.rs).
 */

export type AssistantPanel = {
  /** True once a key is saved, so the palette can offer to ask the assistant. */
  ready: () => boolean;
  ask: (question: string) => void;
  openSettings: () => void;
  isOpen: () => boolean;
  close: () => void;
};

const modelKey = (provider: Provider) => `hold-my-brief:assistant-model:${provider}`;
type ModelInfo = { id: string; displayName: string };
type Status = { configured: boolean; provider: Provider | null };
const providers: Record<Provider, { name: string; placeholder: string; keyUrl: string; sentTo: string }> = {
  anthropic: { name: 'Anthropic', placeholder: 'sk-ant-…', keyUrl: 'https://console.anthropic.com/settings/keys', sentTo: 'to Anthropic' },
  openrouter: { name: 'OpenRouter', placeholder: 'sk-or-…', keyUrl: 'https://openrouter.ai/keys', sentTo: 'to OpenRouter, which passes it to the model\'s provider' },
  openai: { name: 'OpenAI', placeholder: 'sk-…', keyUrl: 'https://platform.openai.com/api-keys', sentTo: 'to OpenAI' },
};
// The Anthropic-only build kept one global choice; carry it over once.
const legacyModel = localStorage.getItem('hold-my-brief:assistant-model');
if (legacyModel !== null) {
  if (localStorage.getItem(modelKey('anthropic')) === null) localStorage.setItem(modelKey('anthropic'), legacyModel);
  localStorage.removeItem('hold-my-brief:assistant-model');
}

const sparkle = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M9.94 15.5a2 2 0 0 0-1.44-1.44l-6.13-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.13a.5.5 0 0 1 .96 0l1.58 6.13a2 2 0 0 0 1.44 1.44l6.13 1.58a.5.5 0 0 1 0 .96l-6.13 1.58a2 2 0 0 0-1.44 1.44l-1.58 6.13a.5.5 0 0 1-.96 0z"/></svg>';

/** Paragraphs, "-" or "1." lists, **bold** and `code`, built from text nodes so model output can never inject markup. */
function renderAnswer(text: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const inline = (parent: HTMLElement, line: string) => {
    for (const part of line.split(/(\*\*[^*]+\*\*|`[^`]+`)/)) {
      if (!part) continue;
      const tag = part.startsWith('**') && part.endsWith('**') ? 'strong' : part.startsWith('`') && part.endsWith('`') ? 'code' : undefined;
      if (tag) { const element = document.createElement(tag); element.textContent = part.slice(tag === 'strong' ? 2 : 1, tag === 'strong' ? -2 : -1); parent.append(element); }
      else parent.append(part);
    }
  };
  for (const block of text.split(/\n{2,}/)) {
    const lines = block.split('\n').filter(line => line.trim());
    if (!lines.length) continue;
    const ordered = lines.every(line => /^\s*\d+[.)]\s/.test(line));
    if (ordered || lines.every(line => /^\s*[-*•]\s/.test(line))) {
      const list = document.createElement(ordered ? 'ol' : 'ul');
      for (const line of lines) { const item = document.createElement('li'); inline(item, line.replace(/^\s*(\d+[.)]|[-*•])\s+/, '')); list.append(item); }
      fragment.append(list);
    } else {
      const paragraph = document.createElement('p');
      lines.forEach((line, index) => { if (index) paragraph.append(document.createElement('br')); inline(paragraph, line.replace(/^#+\s+/, '')); });
      fragment.append(paragraph);
    }
  }
  return fragment;
}

export function createAssistantPanel(layout: HTMLElement, options: { env: ReaderEnvironment; desktop: boolean; returnFocus: () => void; openExternal: (url: string) => Promise<void> }): AssistantPanel {
  const { env, desktop, returnFocus } = options;
  const store = navigator.userAgent.includes('Mac') ? 'macOS Keychain' : 'Windows Credential Manager';
  let configured = false;
  let connected: Provider | null = null;
  let chosen: Provider = 'anthropic';
  let history: Message[] = [];
  let conversation = 0;
  let busy = false;
  // Search results and library listings are remembered for the whole conversation, so a follow-up
  // can say "open the second one" or "show that match".
  let tools = readerTools(env);

  const sheet = document.createElement('section');
  sheet.id = 'answer';
  sheet.hidden = true;
  sheet.tabIndex = -1;
  sheet.setAttribute('aria-label', 'Assistant');
  sheet.innerHTML = `
    <div class="answer-head">${sparkle}<p class="answer-question"></p><button type="button" class="sheet-close" aria-label="Close answer" title="Close (Esc)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>
    <ol class="answer-steps" aria-label="What the assistant did"></ol>
    <div class="answer-text" aria-live="polite"></div>
    <form class="answer-follow"><input type="text" autocomplete="off" spellcheck="true" aria-label="Follow-up question" placeholder="Ask a follow-up…"></form>`;
  layout.prepend(sheet);
  const questionLine = sheet.querySelector<HTMLElement>('.answer-question')!;
  const stepsList = sheet.querySelector<HTMLOListElement>('.answer-steps')!;
  const answer = sheet.querySelector<HTMLElement>('.answer-text')!;
  const follow = sheet.querySelector<HTMLFormElement>('.answer-follow')!;
  const followInput = follow.querySelector('input')!;

  const settings = document.createElement('dialog');
  settings.id = 'assistant-settings';
  settings.setAttribute('aria-labelledby', 'assistant-title');
  settings.innerHTML = `
    <div class="dialog-head"><h2 id="assistant-title">AI assistant</h2><button type="button" data-assistant-close aria-label="Close">×</button></div>
    <p class="assistant-intro">Ask about what you're reading, or have it find, open and change things for you. It uses your own API key from Anthropic, OpenRouter or OpenAI, one at a time, and is off until you add one.</p>
    <div class="choices" role="radiogroup" aria-label="Provider">${(Object.keys(providers) as Provider[]).map(id => `<button type="button" role="radio" data-provider="${id}" aria-checked="false">${providers[id].name}</button>`).join('')}</div>
    <div class="assistant-on" hidden><p class="assistant-connected"></p><label for="assistant-model">Model</label><select id="assistant-model"></select><p class="assistant-error" role="alert"></p></div>
    <dl class="assistant-terms">
      <dt>Sent</dt><dd>Only when you ask: your question and what it reads to answer it, such as the page you're on, search results, the contents, and the titles, tags and folders of library documents. It goes <span data-sent-to></span>.</dd>
      <dt>Never sent</dt><dd>Full file paths and your notes.</dd>
      <dt>Your key</dt><dd>Kept in ${store}, never in the app's files.</dd>
    </dl>
    <form class="assistant-off">
      <label for="assistant-key">Anthropic API key</label><input id="assistant-key" type="password" autocomplete="off" spellcheck="false" placeholder="sk-ant-…"><p class="assistant-error" role="alert"></p><div class="dialog-actions"><button type="button" class="link-button" data-get-key>Get a key</button><button type="submit" class="primary">Turn on</button></div></form>
    <div class="dialog-actions assistant-on" hidden><button type="button" class="link-button danger-text" data-forget>Turn off and forget key</button><button type="button" class="primary" data-assistant-close>Done</button></div>`;
  document.body.append(settings);
  const off = settings.querySelector<HTMLFormElement>('.assistant-off')!;
  // Everything that only makes sense with no key, and everything that only does with one.
  const whenOff = settings.querySelectorAll<HTMLElement>('.assistant-off, .assistant-intro, .choices');
  const whenOn = settings.querySelectorAll<HTMLElement>('.assistant-on');
  const keyInput = settings.querySelector<HTMLInputElement>('#assistant-key')!;
  const keyLabel = settings.querySelector<HTMLElement>('label[for=assistant-key]')!;
  const modelSelect = settings.querySelector<HTMLSelectElement>('#assistant-model')!;
  const connectedLine = settings.querySelector<HTMLElement>('.assistant-connected')!;
  const sentTo = settings.querySelector<HTMLElement>('[data-sent-to]')!;
  const choices = settings.querySelectorAll<HTMLButtonElement>('[data-provider]');
  const errors = settings.querySelectorAll<HTMLElement>('.assistant-error');
  const showError = (message: string) => errors.forEach(element => { element.textContent = message; });

  async function loadModels(): Promise<string | undefined> {
    const provider = connected;
    if (!provider) return undefined;
    const models = await native<ModelInfo[]>('assistant_models');
    modelSelect.replaceChildren(...models.map(model => new Option(model.displayName || model.id, model.id)));
    const chosenModel = chooseModel(models, localStorage.getItem(modelKey(provider)), provider);
    if (chosenModel) { modelSelect.value = chosenModel; localStorage.setItem(modelKey(provider), chosenModel); }
    return chosenModel;
  }
  function showState() {
    whenOff.forEach(element => { element.hidden = configured; }); whenOn.forEach(element => { element.hidden = !configured; }); showError('');
    const info = providers[configured && connected ? connected : chosen];
    connectedLine.textContent = `Connected to ${info.name}.`;
    keyInput.placeholder = info.placeholder;
    keyLabel.textContent = `${info.name} API key`;
    sentTo.textContent = info.sentTo;
    choices.forEach(button => button.setAttribute('aria-checked', String(button.dataset.provider === chosen)));
  }
  function applyStatus(status: Status) { configured = status.configured; connected = status.configured ? status.provider : null; if (connected) chosen = connected; }
  choices.forEach(button => { button.onclick = () => { chosen = button.dataset.provider as Provider; showError(''); showState(); }; });

  off.onsubmit = event => {
    event.preventDefault();
    const submit = off.querySelector<HTMLButtonElement>('[type=submit]')!;
    submit.disabled = true; showError(''); submit.textContent = 'Checking key…';
    void native<Status>('assistant_set_key', { provider: chosen, key: keyInput.value })
      .then(async status => { applyStatus(status); keyInput.value = ''; showState(); await loadModels(); })
      .catch(error => showError(String(error)))
      .finally(() => { submit.disabled = false; submit.textContent = 'Turn on'; });
  };
  modelSelect.onchange = () => { if (connected) localStorage.setItem(modelKey(connected), modelSelect.value); };
  settings.querySelector<HTMLButtonElement>('[data-forget]')!.onclick = () => {
    void native<Status>('assistant_forget_key').then(status => { applyStatus(status); close(); showState(); }).catch(error => showError(String(error)));
  };
  settings.querySelector<HTMLButtonElement>('[data-get-key]')!.onclick = () => void options.openExternal(providers[chosen].keyUrl).catch(error => showError(String(error)));
  settings.querySelectorAll<HTMLButtonElement>('[data-assistant-close]').forEach(button => { button.onclick = () => settings.close(); });

  showState();

  const send: Send = body => {
    if (connected === null || connected === 'anthropic') return native<ModelResponse>('assistant_send', { body });
    const { model, system, messages, tools: toolList, max_tokens } = body;
    // Same fields converse() sends; toChatCompletions drops everything else (tool_choice included:
    // the loop never sets it, and Anthropic's shape for it is not the Chat Completions one).
    const request = toChatCompletions({ model: String(model), system: String(system), messages: Array.isArray(messages) ? messages : [], tools: Array.isArray(toolList) ? toolList : [], max_tokens: Number(max_tokens) });
    return native<ChatCompletion>('assistant_send', { body: request }).then(fromChatCompletion);
  };

  function close() {
    if (sheet.hidden) return;
    // Bumping the conversation makes the running loop stop at its next request or tool call.
    ++conversation; history = []; tools = readerTools(env); busy = false;
    sheet.hidden = true; sheet.removeAttribute('aria-busy');
    returnFocus();
  }

  function ask(question: string) {
    const text = question.trim();
    if (!text || busy) return;
    if (!configured) { openSettings(); return; }
    const token = conversation;
    busy = true;
    sheet.hidden = false;
    questionLine.textContent = text; questionLine.title = text;
    stepsList.replaceChildren();
    answer.classList.remove('answer-error'); answer.replaceChildren(); answer.textContent = 'Thinking…'; answer.classList.add('answer-pending');
    followInput.value = ''; followInput.placeholder = 'Ask a follow-up…'; followInput.disabled = true; sheet.setAttribute('aria-busy', 'true');
    sheet.focus();
    void (async () => {
      const model = (connected && localStorage.getItem(modelKey(connected))) || await loadModels();
      if (!model) throw new Error('No model is available to this API key.');
      return converse(history, text, {
        send, model, system: SYSTEM_PROMPT, tools, cancelled: () => token !== conversation,
        onStep: step => { if (token !== conversation) return; const item = document.createElement('li'); item.textContent = step; stepsList.append(item); },
      });
    })().then(turn => {
      if (token !== conversation) return;
      answer.replaceChildren(turn.answer ? renderAnswer(turn.answer) : 'Done.');
    }).catch(error => {
      if (token !== conversation) return;
      // A failed request leaves no usable turn behind, so the next question starts clean.
      history = []; tools = readerTools(env);
      followInput.placeholder = 'Ask again…';
      answer.classList.add('answer-error'); answer.textContent = String(error instanceof Error ? error.message : error);
    }).finally(() => {
      if (token !== conversation) return;
      busy = false; answer.classList.remove('answer-pending');
      followInput.disabled = false; sheet.removeAttribute('aria-busy');
      // Only take focus if the reader is still in the sheet; someone back on the page keeps their keys.
      if (sheet.contains(document.activeElement)) followInput.focus();
    });
  }

  function openSettings() {
    if (!desktop) return;
    showState();
    settings.showModal();
    if (configured) void loadModels().catch(error => showError(String(error)));
    else keyInput.focus();
  }

  sheet.querySelector<HTMLButtonElement>('.sheet-close')!.onclick = close;
  sheet.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } });
  follow.onsubmit = event => { event.preventDefault(); ask(followInput.value); };

  if (desktop) void native<Status>('assistant_status').then(applyStatus).catch(() => { configured = false; connected = null; });

  return { ready: () => desktop && configured, ask, openSettings, isOpen: () => !sheet.hidden, close };
}
