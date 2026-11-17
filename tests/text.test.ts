// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeText, externalLink, lineAtOffset, localImagePath, renderMarkdown, sourceLineOffsets, TextAdapter } from '../src/adapters/text';
import { defaultOptions, type ReaderContext } from '../src/types';

const utf8 = (value: string) => new TextEncoder().encode(value);
function utf16(value: string, little: boolean): Uint8Array {
  const result = new Uint8Array(2 + value.length * 2);
  result.set(little ? [255, 254] : [254, 255]);
  const view = new DataView(result.buffer);
  for (let index = 0; index < value.length; index++) view.setUint16(2 + index * 2, value.charCodeAt(index), little);
  return result;
}

describe('strict local text decoding', () => {
  it('reads Unicode UTF-8 with either newline style and preserves final lines', () => {
    expect(decodeText(utf8('A café 🦋\r\n第二行\n'))).toBe('A café 🦋\n第二行\n');
    expect(decodeText(new Uint8Array([239, 187, 191, ...utf8('BOM')]))).toBe('BOM');
    expect(decodeText(new Uint8Array())).toBe('');
  });
  it.each([true, false])('decodes BOM-marked UTF-16 (little endian: %s)', little => {
    expect(decodeText(utf16('Text 🦋\r\nمرحبا', little))).toBe('Text 🦋\nمرحبا');
  });
  it.each([
    [0xc3, 0x28], [0xed, 0xa0, 0x80], [0xff, 0xfe, 0x41],
    [0xfe, 0xff, 0xd8, 0], [0xff, 0xfe, 0, 0], [0, 0, 0xfe, 0xff], [65, 0, 66, 0],
  ])('rejects invalid/unsupported bytes without silent replacement: %j', (...bytes) => {
    expect(() => decodeText(new Uint8Array(bytes))).toThrow(/encoding|UTF-16|UTF-32/);
  });
  it('does not reject an explicitly encoded replacement character', () => expect(decodeText(utf8('literal \uFFFD'))).toBe('literal \uFFFD'));
  it('uses stable Unicode character offsets and source line numbers', () => {
    const offsets = sourceLineOffsets('a🦋\n你好\n');
    expect(offsets).toEqual([0, 4, 7]);
    expect([0, 3, 4, 6, 7].map(offset => lineAtOffset(offsets, offset))).toEqual([1, 1, 2, 2, 3]);
  });
});

describe('Markdown resources and semantics', () => {
  it.each(['https://host/image.png', '//host/x', 'data:image/png;base64,x', 'file:///C:/x', 'C:/x', '/x', '../x', 'a/../../x', '%2e%2e/x', '%2Fhost/x', 'a\\x', 'x%00.png', 'x?url=https://host'])('blocks unsafe image path %s', path => expect(localImagePath(path)).toBeNull());
  it('accepts relative resources for a separate authorization check', () => {
    expect(localImagePath('./images/a%20b.png')).toBe('images/a b.png');
    expect(localImagePath('images/cat.png')).toBe('images/cat.png');
  });
  it.each(['javascript:alert(1)', 'file:///C:/secret', 'data:text/html,x', 'mailto:user@example.test', 'relative.md'])('disallows non-web links %s', value => expect(externalLink(value)).toBeNull());
  it('opens only absolute, credential-free web links and never resolves relative, file or script links', () => {
    expect(externalLink('https://example.test/research/sources.md#rights')).toBe('https://example.test/research/sources.md#rights');
    expect(externalLink('../sources.md#rights')).toBeNull();
    expect(externalLink('file:///C:/private')).toBeNull();
    expect(externalLink('javascript:alert(1)')).toBeNull();
    expect(externalLink('https://user:secret@example.test')).toBeNull();
    const result = renderMarkdown('[Sources](https://example.test/research/sources.md#rights) [Relative](../sources.md)');
    const links = new DOMParser().parseFromString(result.html, 'text/html').querySelectorAll('a');
    expect(links[0].dataset.externalLink).toBe('https://example.test/research/sources.md#rights');
    expect(links[1].dataset.externalLink).toBeUndefined();
    expect(links[1].getAttribute('aria-disabled')).toBe('true');
  });
  it('renders CommonMark, table, task, strike, and code semantics with no automatic resources', () => {
    const result = renderMarkdown('# Heading\n\n- [x] Done\n- [ ] Pending\n\n~~removed~~ **bold**\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n```js\n<script>alert(1)</script>\n```\n\n![near](images/a.png) ![remote](https://example.test/tracker.png)\n\n<script src="https://example.test/x"></script>\n\n[web](https://example.test) [self](#heading)');
    const document = new DOMParser().parseFromString(result.html, 'text/html');
    expect(result.outline).toEqual([{ label: 'Heading', target: 'heading:heading' }]);
    expect(document.querySelector('h1')?.dataset.sourceLine).toBe('1');
    expect(document.querySelectorAll('input[type=checkbox]')).toHaveLength(2);
    expect(document.querySelector<HTMLInputElement>('input')?.checked).toBe(true);
    expect(document.querySelectorAll('s')).toHaveLength(1);
    expect(document.querySelector('.reader-table-scroll table')).not.toBeNull();
    expect(document.querySelector('pre[tabindex="0"] code')?.textContent).toBe('<script>alert(1)</script>\n');
    expect(document.querySelector('[src],[srcset],script,iframe,style')).toBeNull();
    expect(document.querySelector('[data-relative-image]')?.getAttribute('data-relative-image')).toBe('images/a.png');
    expect(document.querySelectorAll('[data-relative-image]')).toHaveLength(1);
    expect(document.querySelector('[data-external-link]')?.getAttribute('href')).toBe('#');
    expect(document.body.textContent).toContain('<script src="https://example.test/x"></script>');
  });
  it('keeps identical heading IDs unique and excludes task syntax outside lists', () => {
    const result = renderMarkdown('# A\n\n# A\n\n# A-1\n\n[x] text');
    expect(result.outline.map(item => item.target)).toEqual(['heading:a', 'heading:a-1', 'heading:a-1-1']);
    expect(result.html).not.toContain('<input');
  });
  it('escapes hostile image labels and resource attributes', () => {
    const result = renderMarkdown('![a \\" onerror=\\"evil](images/a.png)\n\n<div onclick="evil">literal</div>');
    const document = new DOMParser().parseFromString(result.html, 'text/html');
    expect(document.querySelector('[onerror],[onclick],img,script')).toBeNull();
  });
});

describe('TextAdapter interaction boundary', () => {
  let adapter: TextAdapter;
  let host: HTMLElement;
  let context: ReaderContext;
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0));
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => ({ top: 0, bottom: 20, height: 20, left: 0, right: 100, width: 100 }) });
    adapter = new TextAdapter();
    host = document.createElement('div'); document.body.append(host);
    context = { onPosition: vi.fn(), onError: vi.fn(), openExternal: vi.fn(async () => {}), requestPassword: vi.fn(async () => null) };
  });
  afterEach(() => { adapter.destroy(); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('opens the browser only after an explicit user activation', async () => {
    await adapter.open({ name: 'links.md', bytes: utf8('[Web](https://example.test)'), format: 'md' }, host, context, defaultOptions);
    expect(context.openExternal).not.toHaveBeenCalled();
    host.querySelector<HTMLAnchorElement>('a')!.click();
    expect(context.openExternal).toHaveBeenCalledExactlyOnceWith('https://example.test/');
  });
  it('resolves only authorized relative images, and refuses a remote resolver result', async () => {
    context.resolveImage = vi.fn(async () => 'https://example.test/blocked.png');
    await adapter.open({ name: 'images.md', bytes: utf8('![one](images/a.png) ![remote](https://example.test/r.png) ![escape](../private.png)'), format: 'md' }, host, context, defaultOptions);
    await vi.waitFor(() => expect(context.resolveImage).toHaveBeenCalledExactlyOnceWith('images/a.png'));
    expect(host.querySelector('img')).toBeNull();
    expect(host.textContent).toContain('image unavailable');
  });
  it('does not interpret plain text as markup and exposes source line position', async () => {
    await adapter.open({ name: 'plain.txt', bytes: utf8('<script>evil</script>\nsecond line'), format: 'txt' }, host, context, defaultOptions);
    expect(host.querySelector('article script')).toBeNull();
    expect(host.querySelector('article')?.textContent).toBe('<script>evil</script>\nsecond line');
    expect(adapter.getPosition().label).toMatch(/^Line \d+ of 2$/);
    expect(adapter.getPosition().locator).toMatchObject({ kind: 'txt', blockLine: 1 });
  });
  it('searches plain text by source line while a match is already marked', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    await adapter.open({ name: 'plain.txt', bytes: utf8('alpha\ngamma\ndelta beta\nomega'), format: 'txt' }, host, context, defaultOptions);
    const [beta] = (await adapter.search('beta')).hits;
    await adapter.revealSearchMatch(beta);
    expect(host.querySelectorAll('mark.search-hit')).toHaveLength(1);
    expect((await adapter.search('omega')).hits.map(hit => hit.unitLabel)).toEqual(['Line 4']);
    const across = (await adapter.search('delta beta')).hits;
    expect(across.map(hit => [hit.unitLabel, hit.text])).toEqual([['Line 3', 'delta beta']]);
    await adapter.revealSearchMatch(across[0]);
    expect(Array.from(host.querySelectorAll('mark.search-hit'), mark => mark.textContent).join('')).toBe('delta beta');
  });
  it('rejects invalid Go to values without saving history or moving', async () => {
    await adapter.open({ name: 'plain.txt', bytes: utf8('one\ntwo'), format: 'txt' }, host, context, defaultOptions);
    const restore = vi.spyOn(adapter, 'restore');
    for (const value of ['0', '3', '-1', 'NaN', '1.5', '1e0', '']) await expect(adapter.goTo(value)).rejects.toThrow('source line');
    await adapter.navigate('back');
    expect(restore).not.toHaveBeenCalled();
  });
  it('keeps only the most recent 20 explicit jump locations', async () => {
    await adapter.open({ name: 'plain.txt', bytes: utf8(Array(30).fill('line').join('\n')), format: 'txt' }, host, context, defaultOptions);
    const restore = vi.spyOn(adapter, 'restore').mockResolvedValue();
    for (let index = 1; index <= 25; index++) await adapter.goTo(String(index));
    restore.mockClear();
    for (let index = 0; index < 25; index++) await adapter.navigate('back');
    expect(restore).toHaveBeenCalledTimes(20);
  });
  it('keeps the semantic source anchor when typography changes', async () => {
    await adapter.open({ name: 'plain.txt', bytes: utf8('first\nsecond'), format: 'txt' }, host, context, defaultOptions);
    const position = adapter.getPosition();
    const restore = vi.spyOn(adapter, 'restore');
    await adapter.setOptions({ ...defaultOptions, fontSize: 24, margin: 12, wrap: false });
    expect(restore).toHaveBeenCalledWith(position.locator);
    expect(host.querySelector<HTMLElement>('article')!.style.fontSize).toBe('24px');
    expect(host.querySelector<HTMLElement>('article')!.dataset.wrap).toBe('false');
  });
});
