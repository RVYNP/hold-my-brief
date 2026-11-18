// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { guardResource, sanitizeEpubMarkup, validArchivePath } from '../src/adapters/epub';

const chapter = (body: string, head = '') => `<html xmlns="http://www.w3.org/1999/xhtml"><head>${head}</head><body>${body}</body></html>`;
const parse = (markup: string) => new DOMParser().parseFromString(markup, 'application/xhtml+xml');

describe('EPUB content boundary', () => {
  it('removes scripts, event handlers, frames, forms and redirects before rendering', () => {
    const output = parse(sanitizeEpubMarkup(chapter('<script>parent.__TAURI_INTERNALS__.invoke("danger")</script><p onclick="alert(1)">Keep text</p><iframe srcdoc="bad"/><form><input/></form>', '<base href="https://bad.test/"/><meta http-equiv="refresh" content="0;url=https://bad.test/"/>')));
    expect(output.querySelector('script,iframe,form,input,base,[onclick]')).toBeNull();
    expect(output.querySelector('body')?.textContent).toContain('Keep text');
    const csp = output.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content');
    expect(csp).toContain("script-src 'none'"); expect(csp).toContain("connect-src 'none'");
    expect(output.querySelector('meta[http-equiv="refresh"]')).toBeNull();
  });
  it('keeps archive images before rewriting and blob resources after rewriting', () => {
    const before = parse(sanitizeEpubMarkup(chapter('<img src="../images/cover.png"/><a href="chapter2.xhtml#note">Footnote</a>')));
    expect(before.querySelector('img')?.getAttribute('src')).toBe('../images/cover.png');
    const after = parse(sanitizeEpubMarkup(chapter('<img src="blob:https://app.test/123"/><img src="https://bad.test/track"/><img src="missing.png"/>'), 'application/xhtml+xml', true));
    expect(Array.from(after.querySelectorAll('img')).map(img => img.getAttribute('src'))).toEqual(['blob:https://app.test/123', null, null]);
  });
  it('preserves a clickable HTTPS link but removes executable URLs and automatic fetch hints', () => {
    const doc = parse(sanitizeEpubMarkup(chapter('<a href="https://example.test/" ping="https://track.test/">Site</a><a href="javascript:alert(1)">Bad</a><img srcset="https://bad.test/a 2x"/>', '<link rel="prefetch" href="https://bad.test/"/>')));
    expect(doc.querySelectorAll('a')[0].getAttribute('href')).toBe('https://example.test/');
    expect(doc.querySelectorAll('a')[1].getAttribute('href')).toBeNull();
    expect(doc.querySelector('[ping],[srcset],link')).toBeNull();
  });
  it('keeps fixed-layout viewport and provides an unsupported-media placeholder', () => {
    const doc = parse(sanitizeEpubMarkup(chapter('<video src="movie.mp4"/><p>Following passage</p>', '<meta name="viewport" content="width=800,height=1000"/>')));
    expect(doc.querySelector('meta[name="viewport"]')?.getAttribute('content')).toBe('width=800,height=1000');
    expect(doc.querySelector('video')).toBeNull();
    expect(doc.querySelector('body')?.textContent).toContain('Embedded audio/video is unavailable');
    expect(doc.querySelector('body')?.textContent).toContain('Following passage');
  });
  it('rejects malformed XML explicitly', () => {
    expect(() => sanitizeEpubMarkup('<html><broken></html>')).toThrow('malformed');
  });
  it.each(['../outside', '/absolute', 'C:/file', 'a\\file', 'OPS/../../bad', 'https://example.test/a'])('rejects unsafe archive resource %s', path => {
    expect(validArchivePath(path)).toBe(false);
  });
  it('accepts normal package resources and Unicode paths', () => {
    expect(validArchivePath('OPS/chapters/étude.xhtml')).toBe(true);
    expect(validArchivePath('META-INF/container.xml')).toBe(true);
  });

  describe('every markup type, whatever the manifest calls it', () => {
    const hostile = chapter('<p style="background:url(https://example.invalid/a.png)">Chapter text</p><iframe src="https://example.invalid/f"/><form action="https://example.invalid/post"><input/></form><img src="https://example.invalid/x.png"/>', '<style>p { background: url(https://example.invalid/y.png); } @import "https://example.invalid/z.css";</style><meta http-equiv="refresh" content="0;url=https://example.invalid/"/>');
    const handled = async (type: string, data = hostile) => {
      const detail: { data: unknown; type: unknown } = { data, type };
      guardResource(detail);
      return { type: detail.type, markup: String(await detail.data) };
    };
    it.each(['application/xml', 'text/xml; charset=utf-8', 'TEXT/XML', 'application/x-dtbncx+xml'])('sanitizes %s as XHTML and carries the per-chapter policy', async declared => {
      const { type, markup } = await handled(declared);
      expect(type).toBe('application/xhtml+xml');
      expect(markup).not.toContain('example.invalid');
      const doc = parse(markup);
      expect(doc.querySelector('iframe,form,input,img[src],meta[http-equiv=refresh]')).toBeNull();
      expect(doc.querySelector('body')?.textContent).toContain('Chapter text');
      expect(doc.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content')).toContain("frame-src 'none'");
    });
    it('puts a document with another root into an XHTML page that carries the policy', async () => {
      const { type, markup } = await handled('application/xml', '<chapter><title>Opening</title><iframe src="https://example.invalid/f"/><p>Words</p></chapter>');
      const doc = parse(markup);
      expect(type).toBe('application/xhtml+xml');
      expect(doc.documentElement.namespaceURI).toBe('http://www.w3.org/1999/xhtml');
      expect(doc.querySelector('head > meta[http-equiv="Content-Security-Policy"]')).not.toBeNull();
      expect(doc.querySelector('body')?.textContent).toContain('Words');
      expect(doc.querySelector('iframe')).toBeNull();
    });
    it('keeps the type of HTML and SVG, and sanitizes SVG, which has no element to carry a policy', async () => {
      expect((await handled('text/html')).type).toBe('text/html');
      const svg = await handled('image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg"><style>@import url(https://example.invalid/s.css); rect { fill: red }</style><foreignObject><iframe xmlns="http://www.w3.org/1999/xhtml"/></foreignObject><rect fill="url(https://example.invalid/g)" width="1" height="1"/><script>1</script></svg>');
      expect(svg.type).toBe('image/svg+xml');
      expect(svg.markup).not.toContain('example.invalid');
      expect(svg.markup).not.toMatch(/iframe|script|foreignObject|Content-Security-Policy/i);
    });
    it.each(['application/javascript', 'text/plain', 'audio/mpeg', 'application/pdf'])('delivers %s as inert bytes', declared => {
      const detail = { data: 'x', type: declared };
      guardResource(detail);
      expect(detail.type).toBe('application/octet-stream');
    });
    it.each(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'font/woff2', 'application/vnd.ms-opentype', 'text/css; charset=utf-8'])('leaves %s alone', declared => {
      const data = Promise.resolve('x'), detail = { data, type: declared };
      guardResource(detail);
      expect(detail.type).toBe(declared); expect(detail.data).toBe(data);
    });
    it('treats a stylesheet url that hides behind an escape or a comment as the url it is', () => {
      const out = parse(sanitizeEpubMarkup(chapter('<p>x</p>', '<style>a { background: u\\72l(https://example.invalid/e.png) } b { background: URL( "https://example.invalid/f.png" ) } i { background: url(data:image/png;base64,AAAA) } u { content: "\\201C" }</style>'), 'application/xhtml+xml', true)).querySelector('style')!.textContent!;
      expect(out).not.toContain('example.invalid');
    });
    it('keeps a stylesheet without fetches exactly as it was', () => {
      const css = 'p { content: "\\201C"; background: url(blob:https://app.test/1) } q { fill: url(#a) }';
      expect(parse(sanitizeEpubMarkup(chapter('<p>x</p>', `<style>${css}</style>`), 'application/xhtml+xml', true)).querySelector('style')?.textContent).toBe(css);
    });
  });
  describe('meta', () => {
    it('drops http-equiv and every other attribute from a viewport meta', () => {
      const doc = parse(sanitizeEpubMarkup(chapter('<p>x</p>', '<meta name="viewport" http-equiv="refresh" content="0;url=x" charset="utf-8" data-x="1"/>')));
      const metas = Array.from(doc.querySelectorAll('meta[name="viewport"]'));
      expect(metas).toHaveLength(1);
      expect(metas[0].getAttributeNames().sort()).toEqual(['content', 'name']);
      expect(doc.querySelector('meta[http-equiv="refresh"]')).toBeNull();
    });
    it('removes a viewport meta with no content, a policy of the book, and any other meta', () => {
      const doc = parse(sanitizeEpubMarkup(chapter('<p>x</p>', '<meta name="viewport"/><meta http-equiv="Content-Security-Policy" content="default-src *"/><meta charset="utf-8"/><meta name="author" content="a"/>')));
      expect(Array.from(doc.querySelectorAll('meta')).map(meta => meta.getAttribute('http-equiv'))).toEqual(['Content-Security-Policy']);
      expect(doc.querySelector('meta')?.getAttribute('content')).toContain("script-src 'none'");
    });
  });
});
