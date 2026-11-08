import MarkdownIt, { type Token } from 'markdown-it';
import type { Locator, OutlineItem, Position, ReaderAdapter, ReaderContext, ReaderOptions, ReaderSource } from '../types';
import { searchUnits, type DocumentSearch, type SearchHit, type SearchOptions, type UnitText } from '../search';

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
        token.attrSet('id', id);
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
      if (token.map && ['paragraph_open', 'heading_open', 'table_open'].includes(token.type)) {
        token.attrSet('data-source-line', String(token.map[0] + 1));
        token.attrSet('data-source-end', String(token.map[1] + 1));
      }
    });
  });
  // Tight lists still need a semantic source anchor; spans retain CommonMark's list spacing.
  md.renderer.rules.paragraph_open = (tokens, index, options, _env, renderer) => tokens[index].hidden ? `<span${marker(tokens[index])}>` : renderer.renderToken(tokens, index, options);
  md.renderer.rules.paragraph_close = (tokens, index, options, _env, renderer) => tokens[index].hidden ? '</span>\n' : renderer.renderToken(tokens, index, options);
  md.renderer.rules.fence = (tokens, index) => `<pre tabindex="0" role="region" aria-label="Code block"${marker(tokens[index])}><code>${escape(tokens[index].content)}</code></pre>\n`;
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
.reader-text-content{box-sizing:border-box;min-height:100%;color:inherit;overflow-wrap:anywhere;max-width:calc(var(--measure) + 2 * var(--reader-margin));margin-inline:auto}
.reader-text-content[data-wrap="false"]{max-width:none}
.reader-text-content :is(p,h1,h2,h3,h4,h5,h6,pre,blockquote,ul,ol,table){margin-top:0;margin-bottom:1em}
.reader-text-content :is(h1,h2,h3,h4,h5,h6){line-height:1.25}
.reader-text-content h1{font-size:2em;letter-spacing:normal;color:inherit}
.reader-text-content h2{font-size:1.5em}.reader-text-content h3{font-size:1.25em}
.reader-text-content a{color:var(--accent-ink);text-decoration:underline}
.reader-text-content pre,.reader-table-scroll{max-width:100%;overflow:auto;overscroll-behavior:contain}
.reader-text-content pre{padding:.7em;background:var(--code);white-space:pre;overflow-wrap:normal}
.reader-text-content code{font-family:Consolas,monospace;font-size:.88em}
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
          if (!/^(blob:|data:image\/(?:png|jpeg|gif|webp|avif|bmp);)/i.test(url)) throw new Error('Unsafe image resource');
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
      const element = Array.from(this.content.querySelectorAll<HTMLElement>('[id]')).find(candidate => candidate.id === target.slice(8));
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
      while ((node = walker.nextNode())) {
        const length = node.textContent?.length ?? 0;
        if (!length) continue;
        if (offset > length) { offset -= length; continue; }
        if (length) {
          const range = document.createRange();
          range.setStart(node, Math.min(offset, length - 1)); range.setEnd(node, Math.min(offset + 1, length));
          const rect = range.getBoundingClientRect(); if (rect.height) targetTop = rect.top;
        }
        break;
      }
      this.host.scrollTop += targetTop - this.host.getBoundingClientRect().top - 2;
    } else this.host.scrollTop = 0;
    this.atEnd = locator.fraction === 1;
    if (this.atEnd) this.host.scrollTop = this.host.scrollHeight;
    this.publish();
  }

  private applyOptions(options: ReaderOptions): void {
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
   * Searches the decoded source, one unit per source line, so every hit knows its line and
   * absolute offset. Searching the source (rather than the rendered DOM) keeps results in
   * document order and lets a hit be navigated straight to a source line, exactly like Go to.
   */
  async search(query: string, options: SearchOptions = {}): Promise<DocumentSearch> {
    if (this.disposed) return { hits: [], truncated: false };
    const units: UnitText[] = [];
    for (let line = 0; line < this.offsets.length; line++) {
      const start = this.offsets[line];
      const text = this.source.slice(start, this.offsets[line + 1] ?? this.source.length);
      if (text.trim()) units.push({ text, number: line + 1, label: `Line ${line + 1}` });
    }
    const { hits, truncated } = searchUnits(units, query, options);
    return { hits: hits.map(hit => ({ ...hit, start: this.offsets[hit.unit - 1] + hit.start, end: this.offsets[hit.unit - 1] + hit.end })), truncated };
  }

  /** Scrolls the block holding a match into view and marks the matched text. */
  async revealSearchMatch(hit: SearchHit): Promise<void> {
    if (this.disposed) return;
    this.clearSearchHighlights();
    const block = this.blocks.filter(candidate => candidate.line <= hit.unit).at(-1) ?? this.blocks[0];
    if (!block) return;
    const offset = this.renderedOffset(block, hit);
    if (offset >= 0) this.mark(block.element, offset, hit.text.length);
    block.element.scrollIntoView({ block: 'center' });
    // Focus stays wherever it was: the find bar keeps the caret while stepping through
    // results, and moving focus to the reader would swallow the next Enter.
    this.publish();
  }

  /**
   * Finds where a source match sits in a block's rendered text.
   *
   * Source and rendering disagree on offsets: Markdown drops or rewrites syntax, HTML entities
   * change length, and whitespace is collapsed. Scaling the source offset proportionally gets
   * close, but is off by a character whenever the block begins with trimmed space, which is why
   * the last step is to find the matched text itself inside the rendered string. If the text is
   * not there (the match was syntax, or spans inline elements), the scaled guess is used.
   */
  private renderedOffset(block: SourceBlock, hit: SearchHit): number {
    const blockStart = this.offsets[block.line - 1] ?? 0;
    const rendered = block.element.textContent ?? '';
    const sourceSpan = (this.offsets[block.endLine - 1] ?? this.source.length) - blockStart;
    const scaled = this.format === 'txt'
      ? hit.start - blockStart
      : Math.round((hit.start - blockStart) / Math.max(1, sourceSpan) * rendered.length);
    // Plain text renders 1:1, so its offset is already exact.
    if (this.format === 'txt') return Math.max(0, scaled);
    // Prefer the literal match, searching near the scaled position first so a repeated word
    // in the same block is not confused with this one.
    const needle = hit.text;
    if (!needle) return Math.max(0, scaled);
    const near = rendered.indexOf(needle, Math.max(0, scaled - 2));
    if (near >= 0) return near;
    const anywhere = rendered.indexOf(needle);
    return anywhere >= 0 ? anywhere : Math.max(0, scaled);
  }

  /**
   * Wraps the matched range in a `<mark>` when it sits inside one text node. A match spanning
   * elements is navigated but not marked, because splitting the DOM across nodes could move
   * the reading anchor.
   */
  private mark(root: HTMLElement, offset: number, length: number): void {
    const owner = root.ownerDocument;
    const walker = owner.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let remaining = offset;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const size = node.textContent?.length ?? 0;
      if (remaining > size) { remaining -= size; continue; }
      if (size === 0) break;
      const range = owner.createRange();
      try {
        range.setStart(node, Math.min(remaining, size));
        range.setEnd(node, Math.min(size, remaining + length));
      } catch { return; }
      const mark = owner.createElement('mark');
      mark.className = 'search-hit';
      try { mark.append(range.extractContents()); } catch { return; }
      range.insertNode(mark);
      this.marks.push(mark);
      return;
    }
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
    if (this.listener) { this.content?.removeEventListener('click', this.listener); this.content?.removeEventListener('auxclick', this.listener); }
    this.imageUrls.forEach(url => URL.revokeObjectURL(url));
    this.imageUrls = []; this.blocks = []; this.history = []; this.source = ''; this.anchor = null;
    this.content?.remove();
  }
}
