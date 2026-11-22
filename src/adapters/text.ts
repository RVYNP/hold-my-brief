import MarkdownIt, { type Token } from 'markdown-it';
import type { Locator, OutlineItem, Position, ReaderAdapter, ReaderContext, ReaderOptions, ReaderSource } from '../types';
import { copyBlock, flash, iconMarkup, icons, openCodeSheet, type Sheet } from '../code-viewer';
import { highlightCode } from '../code-highlight';
import { markLines } from '../epub-code';
import { excerpt, findMatches, searchUnits, type DocumentSearch, type SearchHit, type SearchOptions, type UnitText } from '../search';
import { parseCalloutMarker, renderChartBlock, renderFlowBlock, renderSvgBlock } from '../visual-blocks';

/** What ends a run of inline text: a match never crosses one of these. */
const blockSelector = 'p, h1, h2, h3, h4, h5, h6, li, td, th, pre, blockquote, figure, div, span[data-source-line]';

type SourceBlock = { element: HTMLElement; line: number; endLine: number };
type TextAnchor = Locator & { line: number; blockLine: number; offset: number; context: string; contextOffset: number; fraction: number };

/** Decode without replacing damaged bytes. Unmarked UTF-16 and UTF-32 are unsupported. */
export function decodeText(bytes: Uint8Array): string {
  const starts = (...prefix: number[]) => prefix.every((byte, index) => bytes[index] === byte);
  if (starts(0xff, 0xfe, 0, 0) || starts(0, 0, 0xfe, 0xff)) throw new Error('UTF-32 is not supported. Save this document as UTF-8 or BOM-marked UTF-16.');
  let encoding = 'utf-8';
  if (starts(0xff, 0xfe)) encoding = 'utf-16le';
  if (starts(0xfe, 0xff)) encoding = 'utf-16be';
  let text: string;
  try { text = new TextDecoder(encoding, { fatal: true }).decode(bytes); }
  catch { throw new Error('This document contains invalid or unsupported text encoding. Save it as UTF-8 or BOM-marked UTF-16.'); }
  if (text.includes('\0')) throw new Error('This document contains binary data or unmarked UTF-16. Save it as UTF-8 or BOM-marked UTF-16.');
  return text.replace(/\r\n?/g, '\n');
}

export function sourceLineOffsets(text: string): number[] {
  const offsets = [0];
  for (let index = 0; index < text.length; index++) if (text.charCodeAt(index) === 10) offsets.push(index + 1);
  return offsets;
}

export function lineAtOffset(offsets: number[], offset: number): number {
  let low = 0, high = offsets.length;
  while (low < high) { const mid = (low + high) >>> 1; if (offsets[mid] <= offset) low = mid + 1; else high = mid; }
  return Math.max(1, low);
}

/** Only relative paths below the authorized document directory can reach the resolver. */
export function localImagePath(input: string): string | null {
  let path: string;
  try { path = decodeURIComponent(input); } catch { return null; }
  if (!path || /[\x00-\x1f\x7f\\]/.test(path) || /^[a-z][a-z\d+.-]*:/i.test(path) || path.startsWith('/') || /[?#]/.test(path)) return null;
  const pieces = path.split('/').filter(piece => piece && piece !== '.');
  if (!pieces.length || pieces.some(piece => piece === '..' || piece.includes(':'))) return null;
  return pieces.join('/');
}

export function externalLink(input: string): string | null {
  try {
    const url = new URL(input);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const marker = (token: Token) => ` data-source-line="${(token.map?.[0] ?? 0) + 1}" data-source-end="${(token.map?.[1] ?? 1) + 1}"`;

export function renderMarkdown(source: string): { html: string; outline: OutlineItem[] } {
  const md = new MarkdownIt('commonmark', { html: false, linkify: false, breaks: false }).enable(['table', 'strikethrough']);
  const outline: OutlineItem[] = [];
  const slugs = new Set<string>();
  md.core.ruler.after('inline', 'reader_metadata', state => {
    state.tokens.forEach((token, index) => {
      if (token.type === 'heading_open') {
        const inline = state.tokens[index + 1];
        const label = inline.children?.filter(child => ['text', 'code_inline'].includes(child.type)).map(child => child.content).join('') || inline.content;
        const base = label.toLocaleLowerCase().replace(/[^\p{L}\p{N}_\s-]/gu, '').trim().replace(/\s+/g, '-') || 'heading';
        let id = base, count = 0;
        while (slugs.has(id)) id = `${base}-${++count}`;
        slugs.add(id);
        // A data attribute, not an id: ids share one namespace with the reader's own elements, so a
        // heading named "Contents" or "Menu" would shadow the reader's dialogs of that name.
        token.attrSet('data-heading', id);
        outline.push({ label, target: `heading:${id}` });
      }
      if (token.type === 'inline' && state.tokens[index - 1]?.type === 'paragraph_open' && state.tokens[index - 2]?.type === 'list_item_open') {
        const first = token.children?.[0];
        const task = first?.type === 'text' ? /^\[([ xX])\]\s+/.exec(first.content) : null;
        if (first && task && token.children) {
          first.content = first.content.slice(task[0].length);
          const checkbox = new state.Token('html_inline', '', 0);
          checkbox.content = `<input type="checkbox" disabled aria-label="${task[1] === ' ' ? 'Incomplete task' : 'Completed task'}"${task[1] === ' ' ? '' : ' checked'}> `;
          token.children.unshift(checkbox);
        }
      }
      if (token.type === 'blockquote_open') {
        const nextParagraph = state.tokens[index + 1];
        const nextInline = state.tokens[index + 2];
        const firstChild = nextParagraph?.type === 'paragraph_open' && nextInline?.type === 'inline' ? nextInline.children?.[0] : undefined;
        if (firstChild?.type === 'text') {
          const callout = parseCalloutMarker(firstChild.content);
          if (callout) {
            token.attrSet('class', `hmb-callout hmb-callout-${callout.kind}`);
            token.attrSet('data-callout', callout.kind);
            firstChild.content = callout.rest;
            const head = new state.Token('html_inline', '', 0);
            head.content = `<strong class="hmb-callout-title">${escape(callout.title)}</strong>`;
            nextInline.children!.unshift(head);
            // Strip a leading softbreak immediately after the [!KIND] line so the body starts cleanly.
            const after = nextInline.children![1];
            if (after?.type === 'text' && !after.content) {
              nextInline.children!.splice(1, 1);
              if (nextInline.children![1]?.type === 'softbreak') nextInline.children!.splice(1, 1);
            }
          }
        }
      }
      if (token.map && ['paragraph_open', 'heading_open', 'table_open'].includes(token.type)) {
        token.attrSet('data-source-line', String(token.map[0] + 1));
        token.attrSet('data-source-end', String(token.map[1] + 1));
      }
    });
  });
  // Tight lists still need a semantic source anchor; spans retain CommonMark's list spacing.
  md.renderer.rules.paragraph_open = (tokens, index, options, _env, renderer) => tokens[index].hidden ? `<span${marker(tokens[index])}>` : renderer.renderToken(tokens, index, options);
  md.renderer.rules.paragraph_close = (tokens, index, options, _env, renderer) => tokens[index].hidden ? '</span>\n' : renderer.renderToken(tokens, index, options);
  // The header sits outside the `pre`, so the block's text, its source-line marker and every offset into it are the code alone.
  md.renderer.rules.fence = (tokens, index) => {
    const language = tokens[index].info.trim().split(/\s+/)[0].toLowerCase();
    if (language === 'chart') {
      const rendered = renderChartBlock(tokens[index].content);
      if (rendered) return `<div${marker(tokens[index])}>${rendered}</div>`;
    } else if (language === 'flow') {
      const rendered = renderFlowBlock(tokens[index].content);
      if (rendered) return `<div${marker(tokens[index])}>${rendered}</div>`;
    } else if (language === 'svg') {
      const rendered = renderSvgBlock(tokens[index].content);
      if (rendered) return `<div${marker(tokens[index])}>${rendered}</div>`;
    }
    const named = language ? `, ${escape(language)}` : '';
    const action = (name: 'copy' | 'open', label: string, paths: string) => `<button type="button" tabindex="0" class="code-action" data-code-action="${name}" aria-label="${label} code${named}" title="${label} code${named}">${iconMarkup(paths)}<span>${label}</span></button>`;
    return `<figure class="code-block"${language ? ` data-language="${escape(language)}"` : ''}><div class="code-head">${language ? `<span class="code-lang">${escape(language)}</span>` : ''}<span class="code-actions">${action('copy', 'Copy', icons.copy)}${action('open', 'Open', icons.open)}</span></div>`
      + `<pre tabindex="0" role="region" aria-label="Code block"${marker(tokens[index])}><code>${highlightCode(tokens[index].content, language) ?? escape(tokens[index].content)}</code></pre></figure>\n`;
  };
  md.renderer.rules.code_block = md.renderer.rules.fence;
  md.renderer.rules.table_open = (tokens, index, options, _env, renderer) => `<div class="reader-table-scroll" tabindex="0" role="region" aria-label="Table">${renderer.renderToken(tokens, index, options)}`;
  md.renderer.rules.table_close = () => '</table></div>\n';
  md.renderer.rules.image = (tokens, index) => {
    const token = tokens[index], input = String(token.attrGet('src') ?? ''), relative = localImagePath(input);
    const alt = token.content || 'Document image';
    return `<span class="reader-image-placeholder" role="img" aria-label="${escape(alt)}"${relative ? ` data-relative-image="${escape(relative)}"` : ''}>${escape(alt)} (${relative ? 'image unavailable' : 'external or out-of-scope image blocked'})</span>`;
  };
  md.renderer.rules.link_open = (tokens, index) => {
    const href = String(tokens[index].attrGet('href') ?? '');
    if (href.startsWith('#')) return `<a href="#" data-internal-link="${escape(href.slice(1))}">`;
    const external = externalLink(href);
    return external ? `<a href="#" data-external-link="${escape(external)}" title="Open in browser">` : '<a href="#" aria-disabled="true" title="Only document headings and external web links are supported">';
  };
  return { html: md.render(source), outline };
}

const styles = `
.reader-text-content{box-sizing:border-box;min-height:100%;color:inherit;overflow-wrap:anywhere;max-width:calc(var(--measure) + 2 * var(--reader-margin));margin-inline:auto;font-family:var(--font-read);font-synthesis:weight style}
.reader-text-content[data-wrap="false"]{max-width:none}
.reader-text-content :is(p,h1,h2,h3,h4,h5,h6,blockquote,ul,ol,table){margin-top:0;margin-bottom:1em}
.reader-text-content :is(h1,h2,h3,h4,h5,h6){line-height:1.25;font-family:inherit;font-weight:400}
.reader-text-content h1{font-size:2em;letter-spacing:normal;color:inherit}
.reader-text-content h2{font-size:1.5em}.reader-text-content h3{font-size:1.25em}
.reader-text-content a{color:var(--accent-ink);text-decoration:underline}
.reader-text-content pre,.reader-table-scroll{max-width:100%;overflow:auto;overscroll-behavior:contain}
.reader-text-content .code-block{margin:0 0 1em;border:1px solid var(--hairline);border-radius:8px;background:var(--code);overflow:hidden}
.reader-text-content .code-head{display:flex;align-items:center;gap:8px;min-height:28px;padding:2px 6px 0 1em;user-select:none;-webkit-user-select:none}
.reader-text-content .code-lang{font:11px/1 var(--font-mono);color:var(--muted)}
.reader-text-content .code-actions{display:flex;gap:2px;margin-left:auto}
.reader-text-content .code-action{display:inline-flex;align-items:center;gap:5px;padding:3px 6px;border:0;border-radius:4px;background:none;color:var(--muted);font:11px/1 var(--font-ui);cursor:pointer}
.reader-text-content .code-action:hover{background:var(--hover);color:var(--fg)}
.reader-text-content .code-action svg{flex:none}
.reader-text-content pre{margin:0;padding:.25em 1em .9em;background:none;font:.88em/1.5 var(--font-mono);white-space:pre;overflow-wrap:normal;tab-size:4}
.reader-text-content[data-wrap="true"] pre{white-space:pre-wrap;overflow-wrap:anywhere}
/* A wrapped line hangs 2ch in from where its own line begins; markLines gives each line its indent. */
.reader-text-content[data-wrap="true"] pre [data-hmb-line]{display:inline-block;padding-left:calc(1ch * (var(--hmb-indent, 0) + 2));text-indent:calc(-1ch * (var(--hmb-indent, 0) + 2))}
.reader-text-content pre code{font:inherit}
.reader-text-content pre code :is(.hljs-keyword,.hljs-built_in,.hljs-literal,.hljs-type,.hljs-selector-tag){color:var(--code-keyword)}
.reader-text-content pre code :is(.hljs-string,.hljs-regexp,.hljs-symbol,.hljs-attr-value){color:var(--code-string)}
.reader-text-content pre code :is(.hljs-title,.hljs-function,.hljs-attr,.hljs-property,.hljs-variable,.hljs-name){color:var(--code-name)}
.reader-text-content pre code .hljs-number{color:var(--code-number)}
.reader-text-content pre code :is(.hljs-comment,.hljs-quote,.hljs-meta){color:var(--code-comment);font-style:italic}
.reader-text-content pre code .hljs-addition{color:var(--code-string);background:color-mix(in srgb,var(--code-string) 12%,transparent)}
.reader-text-content pre code .hljs-deletion{color:var(--code-keyword);background:color-mix(in srgb,var(--code-keyword) 12%,transparent)}
.reader-text-content :not(pre)>code{padding:.05em .35em;border:1px solid var(--hairline);border-radius:4px;background:var(--code);font:.88em var(--font-mono);-webkit-box-decoration-break:clone;box-decoration-break:clone}
@media (forced-colors:active),(prefers-contrast:more){.reader-text-content pre code [class*='hljs-']{color:inherit;background:none;font-style:inherit}}
@media (forced-colors:active){.reader-text-content .code-block,.reader-text-content :not(pre)>code{background:none;border-color:CanvasText}.reader-text-content .code-action:hover{background:none;outline:1px solid CanvasText}}
.reader-text-content table{border-collapse:collapse;overflow-wrap:normal}
.reader-text-content th,.reader-text-content td{border:1px solid var(--rule);padding:.4em .6em}
.reader-text-content blockquote{margin-left:0;border-left:3px solid var(--rule);padding-left:1em}
.reader-text-content img{max-width:100%;height:auto}
.reader-image-placeholder{display:inline-block;border:1px dashed var(--rule);padding:.5em;font-size:.9em}
.reader-text-chunk{white-space:pre-wrap;min-height:1lh}
.reader-text-content[data-wrap="false"] .reader-text-chunk{white-space:pre;overflow-wrap:normal}
.reader-text-content :focus-visible{outline:2px solid var(--accent);outline-offset:3px}
/* The current search result: a soft highlight that stays legible in light and dark themes. */
.reader-text-content mark.search-hit{background:var(--search-hit, #ffe08a);color:inherit;border-radius:2px;padding:0 .5px}
.reader-text-content pre mark.search-hit{color:var(--ink)}
/* Safe declarative visuals (charts, flows, inline SVG) and GitHub-style callouts. */
.reader-text-content .hmb-visual{margin:0 0 1.15em;padding:12px 14px;border:1px solid var(--hairline);border-radius:10px;background:var(--card)}
.reader-text-content .hmb-visual-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 10px;margin:0 0 10px;font-family:var(--font-ui)}
.reader-text-content .hmb-visual-head strong{font-size:13px;font-weight:600;color:var(--fg)}
.reader-text-content .hmb-visual-head span{font-size:12px;color:var(--muted)}
.reader-text-content .hmb-visual-body{overflow-x:auto}
.reader-text-content .hmb-visual-body svg{display:block;max-width:100%;height:auto;margin-inline:auto}
.reader-text-content .hmb-metrics-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px}
.reader-text-content .hmb-metric-card{display:flex;flex-direction:column;gap:3px;padding:10px 12px;border:1px solid var(--hairline);border-radius:8px;background:var(--bg);font-family:var(--font-ui)}
.reader-text-content .hmb-metric-label{font-size:11px;font-weight:500;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
.reader-text-content .hmb-metric-value{font-size:20px;line-height:1.2;font-weight:600;color:var(--fg);font-variant-numeric:tabular-nums}
.reader-text-content .hmb-metric-note{font-size:11px;color:var(--muted)}
.reader-text-content blockquote.hmb-callout{margin:0 0 1em;padding:.65em .95em;border-left:3px solid var(--accent-ink);border-radius:0 8px 8px 0;background:color-mix(in srgb,var(--accent-soft) 42%,transparent)}
.reader-text-content blockquote.hmb-callout-warning,.reader-text-content blockquote.hmb-callout-caution{border-left-color:var(--code-keyword);background:color-mix(in srgb,var(--code-keyword) 10%,transparent)}
.reader-text-content blockquote.hmb-callout-tip{border-left-color:var(--code-string);background:color-mix(in srgb,var(--code-string) 10%,transparent)}
.reader-text-content .hmb-callout-title{display:block;margin-bottom:.25em;font:600 11.5px/1.2 var(--font-ui);letter-spacing:.04em;text-transform:uppercase;color:var(--accent-ink)}
.reader-text-content blockquote.hmb-callout-warning .hmb-callout-title,.reader-text-content blockquote.hmb-callout-caution .hmb-callout-title{color:var(--code-keyword)}
.reader-text-content blockquote.hmb-callout-tip .hmb-callout-title{color:var(--code-string)}
.reader-text-content blockquote.hmb-callout>:last-child{margin-bottom:0}
`;

export class TextAdapter implements ReaderAdapter {
  readonly mode = 'scroll' as const;
  private host!: HTMLElement;
  private content!: HTMLElement;
  private context!: ReaderContext;
  private format: 'md' | 'txt' = 'txt';
  private source = '';
  private offsets = [0];
  private blocks: SourceBlock[] = [];
  private headings: OutlineItem[] = [];
  private history: Locator[] = [];
  private anchor: TextAnchor | null = null;
  private resize?: ResizeObserver;
  private disposed = false;
  private atEnd = false;
  /** Host size the current anchor was captured against; a mismatch means pending reflow, not reading. */
  private anchorGeometry = '';
  private frame = 0;
  private imageUrls: string[] = [];
  private listener?: (event: Event) => void;
  private codeListener?: (event: Event) => void;
  private codeKeyListener?: (event: Event) => void;
  private options!: ReaderOptions;
  /** The code sheet over the reading surface, while one is open. */
  private sheet?: Sheet;
  private copyTimers = new Map<HTMLElement, { current?: number }>();
  /** `<mark>` elements currently inserted by `revealSearchMatch`, removed on the next reveal. */
  private marks: HTMLElement[] = [];

  async open(source: ReaderSource, host: HTMLElement, context: ReaderContext, options: ReaderOptions): Promise<void> {
    if (source.format !== 'md' && source.format !== 'txt') throw new Error('The text reader supports Markdown and plain text files.');
    this.source = decodeText(source.bytes);
    this.format = source.format;
    this.host = host;
    this.context = context;
    this.offsets = sourceLineOffsets(this.source);
    this.content = document.createElement('article');
    this.content.className = 'reader-text-content';
    this.content.setAttribute('aria-label', source.name);
    if (this.format === 'md') {
      const rendered = renderMarkdown(this.source);
      this.content.innerHTML = rendered.html;
      this.headings = rendered.outline;
      markLines(this.content);
      // Cutting a line out of a token that starts or ends on the cut leaves the original token behind with no text in it.
      for (const left of Array.from(this.content.querySelectorAll('pre [class*="hljs-"]:empty'))) left.remove();
    } else {
      // Group source lines to avoid one DOM element per line in large plain-text documents.
      for (let line = 0; line < this.offsets.length; line += 80) {
        const chunk = document.createElement('div');
        chunk.className = 'reader-text-chunk';
        chunk.dataset.sourceLine = String(line + 1);
        chunk.dataset.sourceEnd = String(Math.min(line + 80, this.offsets.length) + 1);
        chunk.textContent = this.source.slice(this.offsets[line], this.offsets[line + 80] ?? this.source.length);
        this.content.append(chunk);
      }
    }
    const style = document.createElement('style'); style.textContent = styles;
    host.replaceChildren(style, this.content);
    host.classList.add('text-reader');
    host.style.overflow = 'auto';
    host.style.overflowAnchor = 'none';
    this.blocks = Array.from(this.content.querySelectorAll<HTMLElement>('[data-source-line]')).map(element => ({ element, line: Number(element.dataset.sourceLine), endLine: Number(element.dataset.sourceEnd) }));
    this.listener = event => {
      const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a') : null;
      if (!target) return;
      event.preventDefault();
      if (event.type === 'auxclick' && (event as MouseEvent).button !== 1) return;
      if (target.dataset.internalLink !== undefined) {
        let id: string;
        try { id = decodeURIComponent(target.dataset.internalLink); } catch { return; }
        void this.goTo(`heading:${id}`).catch(context.onError);
      } else if (target.dataset.externalLink) void context.openExternal(target.dataset.externalLink).catch(context.onError);
    };
    this.content.addEventListener('click', this.listener);
    this.content.addEventListener('auxclick', this.listener);
    this.codeListener = event => {
      const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button[data-code-action]') : null;
      const pre = button?.closest('.code-block')?.querySelector<HTMLElement>('pre');
      if (!button || !pre) return;
      if (button.dataset.codeAction === 'open') {
        this.sheet = openCodeSheet({ host, block: pre, fontSize: this.options.fontSize, beside: true, restore: () => button.focus({ preventScroll: true }), copy: block => this.copyCode(block) });
        return;
      }
      const label = button.querySelector('span')!;
      void this.copyCode(pre).then(done => {
        if (!done) return;
        let timers = this.copyTimers.get(button);
        if (!timers) this.copyTimers.set(button, timers = {});
        flash(timers, copied => { label.textContent = copied ? 'Copied' : 'Copy'; button.querySelector('svg')!.innerHTML = copied ? icons.done : icons.copy; });
      });
    };
    this.content.addEventListener('click', this.codeListener);
    this.codeKeyListener = event => {
      if ((event as KeyboardEvent).key !== ' ' && (event as KeyboardEvent).key !== 'Enter') return;
      if (event.target instanceof Element && event.target.closest('button[data-code-action]')) event.stopPropagation();
    };
    this.content.addEventListener('keydown', this.codeKeyListener);
    host.addEventListener('scroll', this.onScroll, { passive: true });
    this.applyOptions(options);
    host.scrollTop = 0;
    this.publish();
    this.resize = new ResizeObserver(() => {
      if (!this.disposed && this.anchor) void this.restore(this.anchor);
    });
    this.resize.observe(host);
    // Resource resolution is delegated to the native boundary; never fetch document URLs.
    void this.loadImages();
  }

  private async loadImages(): Promise<void> {
    if (!this.context.resolveImage) return;
    const placeholders = Array.from(this.content.querySelectorAll<HTMLElement>('[data-relative-image]'));
    // Bound concurrent native reads and decodes.
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(2, placeholders.length) }, async () => {
      while (next < placeholders.length && !this.disposed) {
        const placeholder = placeholders[next++];
        try {
          const url = await this.context.resolveImage!(placeholder.dataset.relativeImage!);
          if (!/^(blob:|data:image\/(?:png|jpeg|gif|webp|avif|bmp|svg\+xml);)/i.test(url)) throw new Error('Unsafe image resource');
          if (this.disposed) { if (url.startsWith('blob:')) URL.revokeObjectURL(url); return; }
          if (url.startsWith('blob:')) this.imageUrls.push(url);
          const img = document.createElement('img');
          img.alt = placeholder.getAttribute('aria-label') ?? '';
          img.decoding = 'async';
          img.onload = () => { if (!this.disposed && this.anchor) void this.restore(this.anchor); };
          img.onerror = () => { if (!this.disposed) img.replaceWith(placeholder); };
          img.src = url;
          placeholder.replaceWith(img);
        } catch { /* The visible, accessible placeholder explains an unavailable resource. */ }
      }
    }));
  }

  private geometry(): string { return `${this.host.clientWidth}x${this.host.clientHeight}`; }

  private onScroll = (): void => {
    if (this.disposed || this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      if (this.disposed) return;
      // Every restore writes scrollTop, so a scroll event can be delivered after the host has
      // resized but before the ResizeObserver runs. Capturing then would read the reflowed
      // layout and permanently replace the anchor; re-anchor instead.
      if (this.anchor && this.geometry() !== this.anchorGeometry) { void this.restore(this.anchor); return; }
      this.atEnd = this.host.scrollHeight > this.host.clientHeight && this.host.scrollTop >= this.host.scrollHeight - this.host.clientHeight - 2;
      this.publish();
    });
  };

  private capture(): TextAnchor {
    const top = this.host.getBoundingClientRect().top;
    const block = this.blocks.find(candidate => candidate.element.getBoundingClientRect().bottom > top + 1) ?? this.blocks.at(-1);
    const text = block?.element.textContent ?? '';
    let offset = 0;
    if (block) {
      const walker = document.createTreeWalker(block.element, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      // Find the first text line still visible; text-node offsets survive reflow.
      while ((node = walker.nextNode())) {
        const length = node.textContent?.length ?? 0;
        if (!length) continue;
        const range = document.createRange(); range.selectNodeContents(node);
        if (range.getBoundingClientRect().bottom <= top + 1) { offset += length; continue; }
        let low = 0, high = length;
        while (low < high) {
          const mid = (low + high) >>> 1;
          range.setStart(node, mid); range.setEnd(node, Math.min(mid + 1, length));
          if (range.getBoundingClientRect().bottom <= top + 1) low = mid + 1; else high = mid;
        }
        offset += low; break;
      }
    }
    const blockStart = this.offsets[(block?.line ?? 1) - 1] ?? 0;
    const blockEnd = this.offsets[(block?.endLine ?? 2) - 1] ?? this.source.length;
    const char = this.format === 'txt' ? blockStart + offset : blockStart + Math.round((blockEnd - blockStart) * offset / Math.max(1, text.length));
    const contextStart = Math.max(0, offset - 24);
    return { kind: this.format, line: lineAtOffset(this.offsets, char), blockLine: block?.line ?? 1, offset, context: text.slice(contextStart, offset + 48), contextOffset: offset - contextStart, fraction: this.atEnd ? 1 : Math.min(1, char / Math.max(1, this.source.length)) };
  }

  getPosition(): Position {
    const locator = this.capture();
    let label = `Line ${locator.line} of ${this.offsets.length}`;
    if (this.format === 'md') {
      const heading = Array.from(this.content.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6')).filter(element => Number(element.dataset.sourceLine) <= locator.line).at(-1);
      label = heading?.textContent || 'Start of document';
    }
    return { label, fraction: locator.fraction, locator,
      scrub: { current: this.atEnd ? this.offsets.length : locator.line, total: this.offsets.length, unit: 'line' } };
  }

  private publish(): void { const position = this.getPosition(); this.anchor = position.locator as TextAnchor; this.anchorGeometry = this.geometry(); this.context.onPosition(position); }

  private remember(): void { this.history.push(this.getPosition().locator); if (this.history.length > 20) this.history.shift(); }

  async navigate(action: 'next' | 'previous' | 'screen-next' | 'screen-previous' | 'start' | 'end' | 'back'): Promise<void> {
    if (action === 'back') { const previous = this.history.pop(); if (previous) await this.restore(previous); return; }
    if (action === 'start') { this.host.scrollTop = 0; this.atEnd = false; }
    else if (action === 'end') { this.host.scrollTop = this.host.scrollHeight; this.atEnd = true; }
    else {
      const direction = action === 'next' || action === 'screen-next' ? 1 : -1;
      this.host.scrollTop += direction * this.host.clientHeight * .9;
      this.atEnd = this.host.scrollHeight > this.host.clientHeight && this.host.scrollTop >= this.host.scrollHeight - this.host.clientHeight - 2;
    }
    this.publish();
  }

  async goTo(target: string): Promise<void> {
    if (target.startsWith('heading:')) {
      const element = Array.from(this.content.querySelectorAll<HTMLElement>('[data-heading]')).find(candidate => candidate.dataset.heading === target.slice(8));
      if (!element) throw new Error('This heading could not be found.');
      this.remember();
      await this.restore({ kind: this.format, blockLine: Number(element.dataset.sourceLine), line: Number(element.dataset.sourceLine), offset: 0 });
      return;
    }
    if (!/^\d+$/.test(target.trim())) throw new Error(`Enter a source line between 1 and ${this.offsets.length}.`);
    const line = Number(target);
    if (!Number.isSafeInteger(line) || line < 1 || line > this.offsets.length) throw new Error(`Enter a source line between 1 and ${this.offsets.length}.`);
    const block = this.blocks.filter(candidate => candidate.line <= line).at(-1) ?? this.blocks[0];
    this.remember();
    const start = this.offsets[(block?.line ?? 1) - 1] ?? 0;
    const end = this.offsets[(block?.endLine ?? 2) - 1] ?? this.source.length;
    const offset = this.format === 'txt' ? this.offsets[line - 1] - start : Math.round((this.offsets[line - 1] - start) / Math.max(1, end - start) * (block?.element.textContent?.length ?? 0));
    await this.restore({ kind: this.format, blockLine: block?.line ?? 1, line, offset });
  }

  async restore(locator: Locator): Promise<void> {
    if (this.disposed || locator.kind !== this.format) return;
    let block = this.blocks.find(candidate => candidate.line === locator.blockLine) ?? this.blocks.find(candidate => candidate.line === locator.line);
    let offset = typeof locator.offset === 'number' && Number.isFinite(locator.offset) ? Math.max(0, Math.floor(locator.offset)) : 0;
    const context = typeof locator.context === 'string' ? locator.context : '';
    if (context) {
      const preferred = block?.element.textContent?.indexOf(context) ?? -1;
      if (preferred >= 0) offset = preferred + (Number(locator.contextOffset) || 0);
      else {
        const found = this.blocks.find(candidate => candidate.element.textContent?.includes(context));
        if (found) { block = found; offset = (found.element.textContent?.indexOf(context) ?? 0) + (Number(locator.contextOffset) || 0); }
      }
    }
    if (!block) {
      const fraction = typeof locator.fraction === 'number' && Number.isFinite(locator.fraction) ? Math.min(1, Math.max(0, locator.fraction)) : 0;
      const line = lineAtOffset(this.offsets, fraction * this.source.length);
      block = this.blocks.filter(candidate => candidate.line <= line).at(-1) ?? this.blocks[0];
    }
    if (block) {
      let targetTop = block.element.getBoundingClientRect().top;
      const walker = document.createTreeWalker(block.element, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      let last: Node | null = null;
      // An offset on the boundary between two text nodes is the start of the second: a code block's lines are one node each.
      while ((node = walker.nextNode())) {
        const length = node.textContent?.length ?? 0;
        if (!length) continue;
        last = node;
        if (offset >= length) { offset -= length; continue; }
        last = null;
        const range = document.createRange();
        range.setStart(node, offset); range.setEnd(node, offset + 1);
        const rect = range.getBoundingClientRect(); if (rect.height) targetTop = rect.top;
        break;
      }
      if (last && offset === 0) {
        const length = last.textContent?.length ?? 0, range = document.createRange();
        range.setStart(last, length - 1); range.setEnd(last, length);
        const rect = range.getBoundingClientRect(); if (rect.height) targetTop = rect.top;
      }
      this.host.scrollTop += targetTop - this.host.getBoundingClientRect().top - 2;
    } else this.host.scrollTop = 0;
    this.atEnd = locator.fraction === 1;
    if (this.atEnd) this.host.scrollTop = this.host.scrollHeight;
    this.publish();
  }

  private copyCode(block: HTMLElement): Promise<boolean> { return copyBlock(block).then(() => true, error => { this.context.onError(error); return false; }); }

  private applyOptions(options: ReaderOptions): void {
    this.options = options;
    this.content.style.fontSize = `${options.fontSize}px`;
    this.content.style.lineHeight = String(options.lineHeight);
    this.content.style.padding = `${options.margin}px`;
    // A readable measure: in a wide window prose stops at about 70 characters (56ch of the interface
    // face, whose average letter is narrower than its '0') and centres instead of running the full
    // width. Unwrapped text (logs, code) keeps every column.
    this.content.style.setProperty('--reader-margin', `${options.margin}px`);
    this.content.style.setProperty('--measure', '56ch');
    this.content.dataset.wrap = String(options.wrap);
  }

  async setOptions(options: ReaderOptions): Promise<void> { const anchor = this.getPosition().locator; this.applyOptions(options); await this.restore(anchor); }
  outline(): OutlineItem[] { return [...this.headings]; }

  async readText(limit: number): Promise<{ label: string; text: string }> {
    const { label, locator } = this.getPosition();
    const line = Math.max(1, Number((locator as TextAnchor).line) || 1);
    const start = this.offsets[line - 1] ?? 0;
    return { label, text: this.source.slice(start, start + limit) };
  }

  /**
   * The text nodes the reader sees, in order. Search and `mark` both walk exactly this list, so an
   * offset into the concatenated text always lands on the characters it names. The code blocks'
   * header (language label, Copy and Open buttons) is interface, not document text, and is left out.
   */
  private textNodes(): Text[] {
    const nodes: Text[] = [];
    const walker = this.content.ownerDocument.createTreeWalker(this.content, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
      // Empty text nodes are left behind where a code block's lines were cut apart.
      if (node.data.length === 0 || node.parentElement?.closest('.code-head')) continue;
      nodes.push(node);
    }
    return nodes;
  }

  /**
   * Markdown is searched as rendered, so a query is what the reader sees: no `**`, backticks, link
   * syntax or heading `#`s. Offsets are into the concatenated text nodes, the same string `mark`
   * walks. A match never crosses a block (paragraph, heading, list item, table cell, code block),
   * and whitespace runs and soft line breaks are ignored. Each hit reports its source line: the
   * block's first line plus the line breaks before the match (a table cell reports its table's line).
   * Plain text is searched as written: see `searchSource`.
   */
  async search(query: string, options: SearchOptions = {}): Promise<DocumentSearch> {
    if (this.disposed) return { hits: [], truncated: false };
    if (this.format === 'txt') return this.searchSource(query, options);
    const needle = query.replace(/\s+/g, ' ');
    const hits: SearchHit[] = [];
    const limit = 2000;
    let truncated = false;
    const searchUnit = (text: string, base: number, block: Element) => {
      if (truncated || !text.trim()) return;
      // Whitespace runs collapse to one space; `from`/`to` map each collapsed character back to the run it came from.
      const from: number[] = [], to: number[] = [], parts: string[] = [];
      for (const [run, index] of Array.from(text.matchAll(/\s+|\S/g), found => [found[0], found.index!] as const)) {
        parts.push(/\s/.test(run[0]) ? ' ' : run);
        from.push(index); to.push(index + run.length);
      }
      const carrier = block.closest<HTMLElement>('[data-source-line]');
      const blockLine = Number(carrier?.dataset.sourceLine) || 1;
      // Only a block that carries its own marker has line breaks that are source lines. A fence's code starts on the line after it.
      const own = carrier === block;
      const firstLine = blockLine + (own && block.tagName === 'PRE' && /^[\s>]*(`{3,}|~{3,})/.test(this.source.slice(this.offsets[blockLine - 1], this.offsets[blockLine])) ? 1 : 0);
      let breaks = 0, scanned = 0;
      for (const match of findMatches(parts.join(''), needle, options)) {
        if (hits.length >= limit) { truncated = true; return; }
        const start = from[match.start], end = to[match.end - 1];
        for (; scanned < start; scanned++) if (text.charCodeAt(scanned) === 10) breaks++;
        const line = own ? firstLine + breaks : blockLine;
        hits.push({ text: text.slice(start, end), excerpt: excerpt(text, start, end), start: base + start, end: base + end, unit: line, unitLabel: `Line ${line}` });
      }
    };
    const blockOf = (node: Text) => node.parentElement?.closest(blockSelector) ?? this.content;
    let base = 0, unit = '', unitBase = 0, unitBlock: Element | undefined;
    const flush = () => { if (unitBlock) searchUnit(unit, unitBase, unitBlock); unit = ''; };
    for (const node of this.textNodes()) {
      const block = blockOf(node);
      if (block !== unitBlock) { flush(); unitBlock = block; unitBase = base; }
      unit += node.data;
      base += node.data.length;
    }
    flush();
    return { hits, truncated };
  }

  /**
   * Plain text: the rendered text is exactly the source (the chunks are consecutive slices of it), so
   * search the source one line at a time, exactly as written. Hit offsets are source offsets, which
   * `mark` lands on, and the result does not depend on `<mark>` elements already splitting the text.
   */
  private searchSource(query: string, options: SearchOptions): DocumentSearch {
    const units: UnitText[] = [];
    for (let line = 0; line < this.offsets.length; line++) {
      const text = this.source.slice(this.offsets[line], this.offsets[line + 1] ?? this.source.length);
      if (text.trim()) units.push({ text, number: line + 1, label: `Line ${line + 1}` });
    }
    const { hits, truncated } = searchUnits(units, query, options);
    return { hits: hits.map(hit => ({ ...hit, start: this.offsets[hit.unit - 1] + hit.start, end: this.offsets[hit.unit - 1] + hit.end })), truncated };
  }

  /** Scrolls the block holding a match into view and marks the matched text. */
  async revealSearchMatch(hit: SearchHit): Promise<void> {
    if (this.disposed) return;
    this.clearSearchHighlights();
    const first = this.mark(hit.start, hit.end);
    const block = first?.parentElement?.closest<HTMLElement>('[data-source-line]') ?? this.blocks.filter(candidate => candidate.line <= hit.unit).at(-1)?.element;
    block?.scrollIntoView({ block: 'center' });
    // Focus stays wherever it was: the find bar keeps the caret while stepping through
    // results, and moving focus to the reader would swallow the next Enter.
    this.publish();
  }

  /**
   * Marks the range `[start, end)` of the rendered text piece by piece: one `<mark class="search-hit">`
   * per text node the match overlaps, so a match that crosses inline elements (or the token spans of
   * a highlighted code block) is marked in full. Every piece is found before the DOM changes; each
   * mark is recorded so `clearSearchHighlights` can unwrap it. Returns the first mark.
   */
  private mark(start: number, end: number): HTMLElement | undefined {
    const owner = this.content.ownerDocument;
    const pieces: { node: Text; from: number; to: number }[] = [];
    let position = 0;
    for (const node of this.textNodes()) {
      const nodeStart = position;
      position += node.data.length;
      // A start on the boundary between two nodes belongs to the second.
      if (position <= start) continue;
      if (nodeStart >= end) break;
      pieces.push({ node, from: Math.max(start, nodeStart) - nodeStart, to: Math.min(end, position) - nodeStart });
    }
    for (const piece of pieces) {
      const range = owner.createRange();
      try {
        range.setStart(piece.node, piece.from);
        range.setEnd(piece.node, piece.to);
      } catch { continue; }
      const mark = owner.createElement('mark');
      mark.className = 'search-hit';
      try { mark.append(range.extractContents()); } catch { continue; }
      range.insertNode(mark);
      this.marks.push(mark);
    }
    return this.marks[0];
  }

  clearSearchHighlights(): void {
    for (const mark of this.marks) {
      const parent = mark.parentNode;
      if (!parent) continue;
      mark.replaceWith(...Array.from(mark.childNodes));
      parent.normalize();
    }
    this.marks = [];
  }

  destroy(): void {
    this.disposed = true;
    this.resize?.disconnect();
    if (this.frame) cancelAnimationFrame(this.frame);
    this.host?.removeEventListener('scroll', this.onScroll);
    this.sheet?.close(false);
    for (const timers of this.copyTimers.values()) clearTimeout(timers.current);
    this.copyTimers.clear();
    if (this.codeListener) this.content?.removeEventListener('click', this.codeListener);
    if (this.codeKeyListener) this.content?.removeEventListener('keydown', this.codeKeyListener);
    if (this.listener) { this.content?.removeEventListener('click', this.listener); this.content?.removeEventListener('auxclick', this.listener); }
    this.imageUrls.forEach(url => URL.revokeObjectURL(url));
    this.imageUrls = []; this.blocks = []; this.history = []; this.source = ''; this.anchor = null;
    this.content?.remove();
  }
}
