import { native } from './bridge';
import { chooseModel, converse, readerTools, SYSTEM_PROMPT, type Message, type ModelResponse, type ReaderEnvironment } from './assistant';

/**
 * The assistant's two surfaces: a settings dialog that turns it on with the user's own Anthropic
 * key (and off again, forgetting the key), and an answer sheet that drops from the toolbar over
 * the top of the page with the answer, a line per action taken and a follow-up field.
 *
 * The key never comes back to the webview: Rust verifies it, keeps it in the system credential
 * store and makes every request (src-tauri/src/assistant.rs).
 */

export type AssistantPanel = {
  /** True once a key is saved, so the palette can offer "Ask Claude". */
  ready: () => boolean;
  ask: (question: string) => void;
  openSettings: () => void;
  isOpen: () => boolean;
  close: () => void;
};

const modelKey = 'hold-my-brief:assistant-model';
type ModelInfo = { id: string; displayName: string };

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
    <p>Ask about what you're reading, or ask it to find, open and change things for you. It uses Claude with your own Anthropic API key.</p>
    <p class="assistant-privacy">Off until you add a key. When it's on, your questions and the text it reads to answer them (the page you're on, search results, the contents, and the titles, tags and folder names of library documents) are sent to Anthropic. Never full file paths or your notes. Nothing is sent until you ask. The key is kept in ${store}, never in the app's files.</p>
    <form class="assistant-off"><label for="assistant-key">Anthropic API key</label><input id="assistant-key" type="password" autocomplete="off" spellcheck="false" placeholder="sk-ant-…"><p class="assistant-error" role="alert"></p><div class="dialog-actions"><button type="button" class="link-button" data-get-key>Get a key</button><button type="submit" class="primary">Turn on</button></div></form>
    <div class="assistant-on" hidden><label for="assistant-model">Model</label><select id="assistant-model"></select><p class="assistant-error" role="alert"></p><div class="dialog-actions"><button type="button" class="link-button danger-text" data-forget>Turn off and forget key</button><button type="button" class="primary" data-assistant-close>Done</button></div></div>`;
  document.body.append(settings);
  const off = settings.querySelector<HTMLFormElement>('.assistant-off')!;
  const on = settings.querySelector<HTMLElement>('.assistant-on')!;
  const keyInput = settings.querySelector<HTMLInputElement>('#assistant-key')!;
  const modelSelect = settings.querySelector<HTMLSelectElement>('#assistant-model')!;
  const errors = settings.querySelectorAll<HTMLElement>('.assistant-error');
  const showError = (message: string) => errors.forEach(element => { element.textContent = message; });

  async function loadModels(): Promise<string | undefined> {
    const models = await native<ModelInfo[]>('assistant_models');
    modelSelect.replaceChildren(...models.map(model => new Option(model.displayName || model.id, model.id)));
    const chosen = chooseModel(models, localStorage.getItem(modelKey));
    if (chosen) { modelSelect.value = chosen; localStorage.setItem(modelKey, chosen); }
    return chosen;
  }
  function showState() { off.hidden = configured; on.hidden = !configured; showError(''); }

  off.onsubmit = event => {
    event.preventDefault();
    const submit = off.querySelector<HTMLButtonElement>('[type=submit]')!;
    submit.disabled = true; showError(''); submit.textContent = 'Checking key…';
    void native<{ configured: boolean }>('assistant_set_key', { key: keyInput.value })
      .then(async status => { configured = status.configured; keyInput.value = ''; showState(); await loadModels(); })
      .catch(error => showError(String(error)))
      .finally(() => { submit.disabled = false; submit.textContent = 'Turn on'; });
  };
  modelSelect.onchange = () => localStorage.setItem(modelKey, modelSelect.value);
  settings.querySelector<HTMLButtonElement>('[data-forget]')!.onclick = () => {
    void native<{ configured: boolean }>('assistant_forget_key').then(status => { configured = status.configured; close(); showState(); }).catch(error => showError(String(error)));
  };
  settings.querySelector<HTMLButtonElement>('[data-get-key]')!.onclick = () => void options.openExternal('https://console.anthropic.com/settings/keys').catch(error => showError(String(error)));
  settings.querySelectorAll<HTMLButtonElement>('[data-assistant-close]').forEach(button => { button.onclick = () => settings.close(); });

  const send = (body: Record<string, unknown>) => native<ModelResponse>('assistant_send', { body });

  function close() {
    if (sheet.hidden) return;
    // Bumping the conversation makes the running loop stop at its next request or tool call.
    ++conversation; history = []; tools = readerTools(env); busy = false;
    sheet.hidden = true;
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
    followInput.value = ''; followInput.disabled = true;
    sheet.focus();
    void (async () => {
      const model = localStorage.getItem(modelKey) ?? await loadModels();
      if (!model) throw new Error('No Claude model is available to this API key.');
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
      answer.classList.add('answer-error'); answer.textContent = String(error instanceof Error ? error.message : error);
    }).finally(() => {
      if (token !== conversation) return;
      busy = false; answer.classList.remove('answer-pending');
      followInput.disabled = false;
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

  if (desktop) void native<{ configured: boolean }>('assistant_status').then(status => { configured = status.configured; }).catch(() => { configured = false; });

  return { ready: () => desktop && configured, ask, openSettings, isOpen: () => !sheet.hidden, close };
}
