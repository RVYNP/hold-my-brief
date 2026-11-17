/**
 * Opening and copying a code block of a reflowable EPUB. Two parts: the controls (Open, Copy) the reader draws in a corner of a block inside
 * the content frame, and the sheet that shows one block full-width over the reading area. The book's markup is not changed: the controls live
 * in a shadow root on the frame's `html` element, after `body`, so neither text offsets nor CFIs move; the sheet is built from a copy.
 */
import './code-viewer.css';
import { CODE_BLOCKS, LABELLED } from './epub-code';
import { liftInk, onAppearanceChange, parseRgb, rgbToHex, type Rgb } from './theme';

const XHTML = 'http://www.w3.org/1999/xhtml';
const SVG = 'http://www.w3.org/2000/svg';
/** How long a button says "Copied". */
const COPIED_MS = 1200;
/** Elements that hold a line-number column in publisher markup (Sphinx's table layout, `linenos` spans): never part of the code. */
const NUMBERS = '.linenos, .linenodiv, .lineno';
/** The size the controls take, and what separates them from the block's corner. */
const BUTTON = 24, GAP = 4, INSET = 8;
/** Where a language label sits: this far below the block's top edge, and in line with the code's own left padding (`0.9em` of the block's size, past the 1px border). */
const LABEL_TOP = 6;

/** The code block `node` belongs to, as the outermost of nested ones, or null when it is in none (or only in a line-number column). */
export function outerBlock(node: Node | null): HTMLElement | null {
  // The node is usually in a content frame, a realm of its own: `instanceof Element` is false there, so the node type says what it is.
  let block = (node?.nodeType === Node.ELEMENT_NODE ? node as Element : node?.parentElement)?.closest<HTMLElement>(CODE_BLOCKS) ?? null;
  for (let up = block?.parentElement?.closest<HTMLElement>(CODE_BLOCKS); up; up = block.parentElement?.closest<HTMLElement>(CODE_BLOCKS)) block = up;
  return block && !block.closest(NUMBERS) ? block : null;
}

/** The part of a block that is the code: Sphinx's table layout keeps it in one cell next to the line numbers. */
const contentOf = (block: Element): Element => block.querySelector('td.code') ?? block;

/** The exact text of a block: its own whitespace, line breaks written as `<br>`, and no line numbers. */
export function blockText(block: Element): string {
  let text = '';
  const walk = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) text += child.nodeValue ?? '';
      else if (child.nodeType === Node.ELEMENT_NODE && !(child as Element).matches(NUMBERS)) { if ((child as Element).localName === 'br') text += '\n'; else walk(child); }
    }
  };
  walk(contentOf(block));
  return text;
}

/** Class tokens that mark pandoc's highlighting itself, not a language. */
const PANDOC_FLAGS: Record<string, true> = { sourcecode: true, numbersource: true, numberlines: true, linenumbers: true, lineanchors: true };
/** `highlight-<name>` values that say a block has no language of its own (Sphinx's `highlight-default` is "the project's default"). */
const NO_LANGUAGE: Record<string, true> = { default: true, none: true };
/** The language a block's classes name: `language-x` or `lang-x`, pandoc's `sourceCode x` on its `pre`/`code`, Sphinx's `highlight-x` around it. */
export function languageOf(block: Element): string | undefined {
  // The Markdown reader names the language on the figure around its blocks.
  const tagged = block.closest<HTMLElement>('[data-language]')?.dataset.language;
  if (tagged) return tagged;
  const tokens = (element: Element) => Array.from(element.classList, name => name.toLowerCase());
  const named = [block, ...Array.from(block.querySelectorAll('pre, code'))];
  for (const element of named) for (const token of tokens(element)) { const match = /^(?:language|lang)-(.+)$/.exec(token); if (match) return match[1]; }
  for (const element of named) {
    if (!element.matches('pre, code')) continue;
    const list = tokens(element);
    if (list.includes('sourcecode')) { const language = list.find(token => !Object.hasOwn(PANDOC_FLAGS, token)); if (language) return language; }
  }
  const around: Element[] = [block];
  for (let up = block.parentElement; up && around.length < 4; up = up.parentElement) around.push(up);
  for (const element of around) for (const token of tokens(element)) {
    const match = /^highlight-(.+)$/.exec(token);
    if (match && !Object.hasOwn(NO_LANGUAGE, match[1])) return match[1];
  }
  return undefined;
}

/** Writes a block's text to the clipboard. */
export async function copyBlock(block: Element): Promise<void> {
  await navigator.clipboard.writeText(blockText(block));
}

/** Calls `mark(true)` now and `mark(false)` after COPIED_MS; a second call before then starts the time over. */
export function flash(timers: { current?: number }, mark: (copied: boolean) => void) {
  clearTimeout(timers.current);
  mark(true);
  timers.current = window.setTimeout(() => mark(false), COPIED_MS);
}

// --- The controls drawn in the content frame ---

export const icons = {
  open: '<path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="m21 3-7 7"/><path d="m3 21 7-7"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  done: '<path d="M20 6 9 17l-5-5"/>',
  close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
};
/** An icon as markup for HTML the app writes itself (the Markdown reader's block headers). */
export const iconMarkup = (paths: string, size = 12): string => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
/** An icon as an element of `doc`. A document of the book is XML, so its SVG is parsed as XML and imported rather than set as `innerHTML`. */
function icon(doc: Document, paths: string, size = 14): Element {
  const parsed = new DOMParser().parseFromString(`<svg xmlns="${SVG}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`, 'image/svg+xml');
  return doc.importNode(parsed.documentElement, true) as Element;
}

const controlStyles = `
:host { all: initial; position: absolute; top: 0; left: 0; z-index: 2147483647; pointer-events: none; }
.controls { position: absolute; display: none; align-items: center; gap: ${GAP}px; font: 12px/1 system-ui, sans-serif; pointer-events: auto; }
.controls[data-shown] { display: flex; }
.language { position: absolute; display: block; max-width: 24ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 11px/14px ui-monospace, "SF Mono", Menlo, Consolas, monospace; color: color-mix(in srgb, var(--hmb-ink, #000) 60%, transparent); pointer-events: none; user-select: none; }
.language[hidden] { display: none; }
button { all: unset; box-sizing: border-box; display: grid; place-items: center; width: ${BUTTON}px; height: ${BUTTON}px; border: 1px solid color-mix(in srgb, var(--hmb-ink, #000) 24%, transparent); border-radius: 6px; background: color-mix(in srgb, var(--hmb-paper, #fff) 92%, var(--hmb-ink, #000)); color: var(--hmb-ink, #000); cursor: pointer; }
button:hover { background: color-mix(in srgb, var(--hmb-paper, #fff) 82%, var(--hmb-ink, #000)); }
button:focus-visible { outline: 2px solid var(--hmb-accent, currentColor); outline-offset: 1px; }
svg { display: block; }
.copied { position: absolute; right: 100%; margin-right: ${GAP}px; white-space: nowrap; padding: 4px 7px; border: 1px solid color-mix(in srgb, var(--hmb-ink, #000) 24%, transparent); border-radius: 6px; background: color-mix(in srgb, var(--hmb-paper, #fff) 92%, var(--hmb-ink, #000)); color: var(--hmb-ink, #000); }
.copied:empty { display: none; }
@media (forced-colors: active) { button, .copied { border-color: ButtonText; background: ButtonFace; color: ButtonText; } }
`;

export type CodeHooks = {
  /** The reading area on screen, in the app's coordinates: the part of a block that is in view is where its controls go. */
  area: () => DOMRect;
  /** Opens `block` in the sheet. `restore` gives focus back to the block's Open button once the sheet is closed. */
  open: (block: HTMLElement, restore: () => void) => void;
  /** Resolves true once the text is on the clipboard, false when it could not be put there (and has been reported). */
  copy: (block: HTMLElement) => Promise<boolean>;
};

/**
 * Makes the code blocks of one content frame focusable and draws Open and Copy in the top-right corner of the one hovered or focused. A block
 * whose language is known also shows it, always, in its top-left corner; the book's markup gets one attribute for it and nothing else.
 * Tab reaches a block, then Open, then Copy, then goes on to what follows the block; Shift+Tab goes back the same way.
 */
export function attachCodeControls(doc: Document, hooks: CodeHooks): void {
  const view = doc.defaultView;
  if (!view || !doc.body) return;
  const labels = new Map<HTMLElement, HTMLElement>();
  for (const element of Array.from(doc.querySelectorAll<HTMLElement>(CODE_BLOCKS))) {
    if (outerBlock(element) !== element) continue;
    element.setAttribute('tabindex', '0');
    const language = languageOf(element);
    if (!language) continue;
    element.setAttribute(LABELLED, '');
    const tag = doc.createElementNS(XHTML, 'span') as HTMLElement;
    tag.className = 'language'; tag.setAttribute('aria-hidden', 'true'); tag.textContent = language;
    labels.set(element, tag);
  }

  const host = doc.createElementNS(XHTML, 'div') as HTMLElement;
  const shadow = host.attachShadow({ mode: 'open' });
  const style = doc.createElementNS(XHTML, 'style');
  style.textContent = controlStyles;
  const button = (name: string, paths: string) => {
    const element = doc.createElementNS(XHTML, 'button') as HTMLButtonElement;
    element.type = 'button'; element.setAttribute('aria-label', name); element.title = name;
    element.append(icon(doc, paths));
    return element;
  };
  const open = button('Open code', icons.open), copy = button('Copy code', icons.copy);
  const said = doc.createElementNS(XHTML, 'span');
  said.className = 'copied'; said.setAttribute('role', 'status');
  const controls = doc.createElementNS(XHTML, 'div') as HTMLElement;
  controls.className = 'controls';
  controls.append(said, open, copy);
  shadow.append(style, ...labels.values(), controls);
  doc.documentElement.append(host);

  // `keyboard` is who moved last: the pointer's block leads the controls until a key is pressed, the focused one until the pointer moves.
  let hover: HTMLElement | null = null, current: HTMLElement | null = null, pointer: { x: number; y: number } | undefined, keyboard = false;
  const timers: { current?: number } = {};
  const inControls = () => doc.activeElement === host;
  const focused = () => (inControls() ? current : outerBlock(doc.activeElement));
  const place = (block: HTMLElement) => {
    const rects = Array.from(block.getClientRects()).filter(rect => rect.width > 0 && rect.height > 0);
    if (!rects.length) return false;
    // A block that runs over a page turn or a column break is several boxes; the control goes on the one under the pointer, else the one in view.
    const frame = view.frameElement?.getBoundingClientRect(), area = hooks.area();
    const seen = (rect: DOMRect) => !frame || (frame.left + rect.right > area.left && frame.left + rect.left < area.right && frame.top + rect.bottom > area.top && frame.top + rect.top < area.bottom);
    const under = pointer && rects.find(rect => pointer!.x >= rect.left && pointer!.x <= rect.right && pointer!.y >= rect.top && pointer!.y <= rect.bottom);
    const rect = under ?? rects.find(seen) ?? rects[0];
    controls.style.left = `${Math.max(0, rect.right - INSET - 2 * BUTTON - GAP) + view.scrollX}px`;
    // A block taller than the screen keeps its controls at the top of what is in view, so they are in reach wherever it is read.
    const top = Math.max(rect.top, frame ? area.top - frame.top : rect.top);
    controls.style.top = `${Math.max(rect.top, Math.min(top, rect.bottom - BUTTON - 2 * INSET)) + INSET + view.scrollY}px`;
    return true;
  };
  const show = (block: HTMLElement | null) => {
    if (block !== current) said.textContent = '';
    current = block;
    if (block?.isConnected && place(block)) controls.setAttribute('data-shown', '');
    else { controls.removeAttribute('data-shown'); current = null; }
  };
  // A label goes at the top-left of the first box of its block. Layout moves under it (a style sheet arrives, an image loads, the window or the text size changes), so it is set again then. The frame is sandboxed without scripts, and WebKit never runs callbacks made in its realm, so the observers and the frame callback come from the app window, as Foliate's own do.
  const placeLabels = () => {
    for (const [block, tag] of labels) {
      const rect = block.isConnected ? Array.from(block.getClientRects()).find(box => box.width > 0 && box.height > 0) : undefined;
      tag.hidden = !rect;
      if (!rect) continue;
      tag.style.left = `${rect.left + 1 + 0.9 * parseFloat(view.getComputedStyle(block).fontSize) + view.scrollX}px`;
      tag.style.top = `${rect.top + LABEL_TOP + view.scrollY}px`;
    }
  };
  if (labels.size) {
    let queued = false;
    const relayout = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; if (view.document === doc) placeLabels(); });
    };
    const observer = new ResizeObserver(relayout);
    observer.observe(doc.documentElement); observer.observe(doc.body);
    for (const block of labels.keys()) observer.observe(block);
    if (doc.head) new MutationObserver(relayout).observe(doc.head, { childList: true, subtree: true, characterData: true, attributes: true });
    doc.addEventListener('load', relayout, true);
    view.addEventListener('resize', relayout);
    void doc.fonts?.ready.then(relayout);
    placeLabels();
  }
  const refresh = () => {
    const held = inControls() ? current : focused();
    show(keyboard ? held ?? hover : hover ?? held);
  };

  const track = (event: PointerEvent) => {
    if (event.target === host) return;
    // The browser repeats the pointer's last position after a scroll: that is not the pointer moving.
    if (!pointer || pointer.x !== event.clientX || pointer.y !== event.clientY) keyboard = false;
    pointer = { x: event.clientX, y: event.clientY };
    hover = outerBlock(event.target as Node);
    refresh();
  };
  doc.addEventListener('pointerover', track);
  // Within one block the controls follow the part of it on screen as it is scrolled under the pointer.
  doc.addEventListener('pointermove', track);
  doc.documentElement.addEventListener('pointerleave', () => { hover = null; pointer = undefined; refresh(); });
  doc.addEventListener('focusin', refresh);
  doc.addEventListener('keydown', () => { keyboard = true; }, true);
  doc.addEventListener('focusout', () => setTimeout(() => { if (view.document === doc) refresh(); }, 0));
  // Tab on a block goes to its Open button, which comes after the page's body in the frame and so is not where Tab would otherwise lead.
  doc.addEventListener('keydown', event => {
    const block = event.target as HTMLElement;
    if (event.key !== 'Tab' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || outerBlock(block) !== block) return;
    event.preventDefault();
    show(block);
    open.focus({ preventScroll: true });
  });
  shadow.addEventListener('keydown', raw => {
    const event = raw as KeyboardEvent, target = event.target as Element;
    // Space and Enter press the button; the page must not also turn on them.
    if (event.key === ' ' || event.key === 'Enter' || event.key === 'Escape') event.stopPropagation();
    if (event.key !== 'Tab' || !current) return;
    event.stopPropagation();
    if (event.shiftKey && target === open) { event.preventDefault(); current.focus({ preventScroll: true }); }
    // WebKit on macOS does not make buttons Tab stops by default, so the steps between the two buttons are routed here as well.
    else if (!event.shiftKey && target === open) { event.preventDefault(); copy.focus({ preventScroll: true }); }
    else if (event.shiftKey && target === copy) { event.preventDefault(); open.focus({ preventScroll: true }); }
    // The block takes focus so that the browser's own step from it leads on to what follows the block.
    else if (!event.shiftKey && target === copy) current.focus({ preventScroll: true });
  });
  open.addEventListener('click', () => {
    const block = current;
    if (!block) return;
    hooks.open(block, () => {
      if (!block.isConnected || view.document !== doc) return;
      hover = null;
      show(block);
      open.focus({ preventScroll: true });
    });
  });
  copy.addEventListener('click', () => {
    const block = current;
    if (!block) return;
    void hooks.copy(block).then(done => done && flash(timers, copied => {
      said.textContent = copied ? 'Copied' : '';
      copy.replaceChildren(icon(doc, copied ? icons.done : icons.copy));
    }));
  });
}

// --- The sheet ---

export type Sheet = { close: (restore?: boolean) => void };
let showing: Sheet | undefined;

export type SheetOptions = {
  /** The reading surface the sheet covers. */
  host: HTMLElement;
  block: HTMLElement;
  /** The reader's text size in pixels; the code is set at 0.9 of it. */
  fontSize: number;
  /** Called after the sheet closed, to give focus back. */
  restore: () => void;
  copy: CodeHooks['copy'];
  /** The host scrolls its own content, so a sheet inside it would scroll away: the sheet is mounted beside it and follows its box. */
  beside?: boolean;
};

const sameColor = (a: Rgb, b: Rgb) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

/**
 * A copy of a block's code as it reads in the frame: its text and the colours, weights and slants the book's styles give it, with colours
 * that would not read on the sheet raised the way the page raises them. Elements that change nothing are not kept.
 */
function codeNodes(block: Element, background: Rgb, ink: Rgb): { nodes: Node[]; color: Rgb } {
  const view = block.ownerDocument.defaultView, here = document;
  const lift = (value: string, fallback: Rgb) => { const color = parseRgb(value); return color ? liftInk(color, background, ink) ?? color : fallback; };
  const root = contentOf(block);
  const base = view ? lift(view.getComputedStyle(root).color, ink) : ink;
  const copy = (parent: Node, inherited: { color: Rgb; bold: boolean; italic: boolean }): Node[] => {
    const out: Node[] = [];
    for (const child of Array.from(parent.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) { out.push(here.createTextNode(child.nodeValue ?? '')); continue; }
      if (child.nodeType !== Node.ELEMENT_NODE || (child as Element).matches(NUMBERS)) continue;
      if ((child as Element).localName === 'br') { out.push(here.createTextNode('\n')); continue; }
      const style = view?.getComputedStyle(child as Element);
      const own = style ? { color: lift(style.color, inherited.color), bold: Number(style.fontWeight) >= 600, italic: style.fontStyle === 'italic' || style.fontStyle === 'oblique' } : inherited;
      const inner = copy(child, own);
      if (!inner.length) continue;
      if (sameColor(own.color, inherited.color) && own.bold === inherited.bold && own.italic === inherited.italic) { out.push(...inner); continue; }
      const span = here.createElement('span');
      if (!sameColor(own.color, inherited.color)) span.style.color = rgbToHex(own.color);
      if (own.bold !== inherited.bold) span.style.fontWeight = own.bold ? '700' : '400';
      if (own.italic !== inherited.italic) span.style.fontStyle = own.italic ? 'italic' : 'normal';
      span.append(...inner);
      out.push(span);
    }
    return out;
  };
  const rootStyle = view?.getComputedStyle(root);
  return { nodes: copy(root, { color: base, bold: Number(rootStyle?.fontWeight) >= 600, italic: rootStyle?.fontStyle === 'italic' }), color: base };
}

/** Shows one code block full-width over `host`. Esc, the Close button, or a click outside the sheet closes it and calls `restore`. */
export function openCodeSheet({ host, block, fontSize, restore, copy, beside }: SheetOptions): Sheet {
  showing?.close(false);
  const text = blockText(block), language = languageOf(block);
  const scrim = document.createElement('div');
  scrim.className = 'code-scrim';
  const sheet = document.createElement('section');
  sheet.className = 'code-sheet'; sheet.tabIndex = -1; sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true'); sheet.setAttribute('aria-label', language ? `Code, ${language}` : 'Code');
  sheet.style.setProperty('--code-size', `${fontSize * 0.9}px`);
  const button = (label: string, paths: string, role: string) => {
    const element = document.createElement('button');
    element.type = 'button'; element.className = 'code-sheet-button'; element.dataset.role = role;
    element.insertAdjacentHTML('beforeend', `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`);
    const caption = document.createElement('span');
    caption.textContent = label;
    element.append(caption);
    return { element, caption, mark: (paths: string) => { element.querySelector('svg')!.innerHTML = paths; } };
  };
  const header = document.createElement('header');
  header.className = 'code-sheet-head';
  if (language) { const tag = document.createElement('span'); tag.className = 'code-sheet-language'; tag.textContent = language; header.append(tag); }
  const copyButton = button('Copy', icons.copy, 'copy'), closeButton = button('Close', icons.close, 'close');
  const spacer = document.createElement('span');
  spacer.className = 'code-sheet-spacer';
  header.append(spacer, copyButton.element, closeButton.element);
  const body = document.createElement('div');
  body.className = 'code-sheet-body'; body.tabIndex = 0; body.setAttribute('role', 'region'); body.setAttribute('aria-label', 'Code listing');
  const gutter = document.createElement('div');
  gutter.className = 'code-sheet-gutter'; gutter.setAttribute('aria-hidden', 'true');
  const lines = text.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  gutter.textContent = lines.map((_, i) => i + 1).join('\n');
  const pre = document.createElement('pre');
  pre.className = 'code-sheet-code';
  body.append(gutter, pre);
  sheet.append(header, body);
  scrim.append(sheet);
  const mount = beside ? host.parentElement ?? host : host;
  mount.append(scrim);
  let follow: ResizeObserver | undefined;
  if (mount !== host) {
    const fit = () => { scrim.style.inset = 'auto'; scrim.style.left = `${host.offsetLeft}px`; scrim.style.top = `${host.offsetTop}px`; scrim.style.width = `${host.offsetWidth}px`; scrim.style.height = `${host.offsetHeight}px`; };
    fit();
    follow = new ResizeObserver(fit);
    follow.observe(host);
  }

  const render = () => {
    const style = getComputedStyle(sheet), background = parseRgb(style.backgroundColor), ink = parseRgb(style.color);
    if (!background || !ink) { pre.textContent = text; return; }
    const { nodes, color } = codeNodes(block, background, ink);
    pre.style.color = rgbToHex(color);
    pre.replaceChildren(...nodes);
  };
  render();
  // The frame's colours follow the theme once the app has repainted: the sheet rebuilds from them then.
  const stop = onAppearanceChange(() => requestAnimationFrame(() => { if (scrim.isConnected) render(); }));

  const timers: { current?: number } = {};
  let closed = false;
  const self: Sheet = {
    close(returnFocus = true) {
      if (closed) return;
      closed = true; showing = undefined;
      stop(); follow?.disconnect(); clearTimeout(timers.current);
      document.removeEventListener('keydown', onKey, true);
      scrim.remove();
      if (returnFocus) restore();
    },
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Tab' && sheet.contains(document.activeElement)) {
      // Focus stays in the sheet: Tab runs round its three stops.
      const stops: HTMLElement[] = [copyButton.element, body, closeButton.element], at = stops.indexOf(document.activeElement as HTMLElement);
      event.preventDefault();
      stops[at < 0 ? (event.shiftKey ? stops.length - 1 : 0) : (at + (event.shiftKey ? stops.length - 1 : 1)) % stops.length].focus();
    }
  };
  document.addEventListener('keydown', onKey, true);
  // Keys that are not shortcuts belong to the sheet: arrows and space scroll the code, and must not turn the page behind it.
  sheet.addEventListener('keydown', event => {
    // Esc closes the sheet only when it comes from inside it: the palette, find bar and menus keep their own Esc.
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); self.close(); return; }
    if (!event.ctrlKey && !event.metaKey && !event.altKey) event.stopPropagation();
  });
  // A press and release both outside the sheet close it. It waits for the release because a press moves focus, and focus must end on the Open button.
  let outside = false;
  scrim.addEventListener('pointerdown', event => { outside = event.target === scrim; });
  scrim.addEventListener('click', event => { if (outside && event.target === scrim) self.close(); outside = false; });
  closeButton.element.addEventListener('click', () => self.close());
  copyButton.element.addEventListener('click', () => {
    void copy(block).then(done => done && flash(timers, copied => { copyButton.caption.textContent = copied ? 'Copied' : 'Copy'; copyButton.mark(copied ? icons.done : icons.copy); }));
  });
  showing = self;
  sheet.focus({ preventScroll: true });
  return self;
}
