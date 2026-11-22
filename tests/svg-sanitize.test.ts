// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { sanitizeSvg } from '../src/svg-sanitize';

describe('sanitizeSvg', () => {
  it('keeps clean graphics and adds xmlns + viewBox', () => {
    const clean = sanitizeSvg('<svg width="200" height="100"><rect x="4" y="4" width="192" height="92" fill="var(--card)" stroke="var(--accent-ink)" /><text x="100" y="55">Hello</text></svg>');
    expect(clean).not.toBeNull();
    expect(clean).toContain('viewBox="0 0 200 100"');
    expect(clean).toContain('fill="var(--card)"');
    expect(clean).toContain('Hello');
  });

  it('strips scripts, foreignObject, event handlers, animations and style tags', () => {
    const hostile = `<svg viewBox="0 0 100 100" onload="alert(1)">
      <script>alert(1)</script>
      <style>rect { fill: url(https://evil.example/a); }</style>
      <foreignObject><div xmlns="http://www.w3.org/1999/xhtml">html</div></foreignObject>
      <rect x="0" y="0" width="50" height="50" onclick="steal()" fill="red" />
      <animate attributeName="x" from="0" to="10" dur="1s" />
    </svg>`;
    const clean = sanitizeSvg(hostile)!;
    expect(clean).not.toContain('script');
    expect(clean).not.toContain('foreignObject');
    expect(clean).not.toContain('onload');
    expect(clean).not.toContain('onclick');
    expect(clean).not.toContain('style');
    expect(clean).not.toContain('animate');
    expect(clean).toContain('fill="red"');
  });

  it('blocks external hrefs, javascript URIs and non-local url() references', () => {
    const hostile = `<svg viewBox="0 0 100 100" xmlns:xlink="http://www.w3.org/1999/xlink">
      <defs><linearGradient id="g1"><stop offset="0%" stop-color="var(--accent)" /></linearGradient></defs>
      <use href="https://evil.example/x.svg#a" />
      <use xlink:href="javascript:alert(1)" />
      <use href="#ok" />
      <rect fill="url(https://evil.example/img)" stroke="url(#g1)" width="10" height="10" />
    </svg>`;
    const clean = sanitizeSvg(hostile)!;
    expect(clean).not.toContain('evil.example');
    expect(clean).not.toContain('javascript:');
    expect(clean).toContain('href="#ok"');
    expect(clean).toContain('stroke="url(#g1)"');
  });

  it('resolves allowed CSS variables when a resolver is provided', () => {
    const clean = sanitizeSvg(
      '<svg viewBox="0 0 10 10"><rect width="10" height="10" fill="var(--accent)" stroke="var(--unknown, #111)" /></svg>',
      name => (name === '--accent' ? '#fa4848' : undefined),
    )!;
    expect(clean).toContain('fill="#fa4848"');
    expect(clean).not.toContain('--unknown');
  });

  it('rejects non-svg roots and malformed XML', () => {
    expect(sanitizeSvg('<html><body>hi</body></html>')).toBeNull();
    expect(sanitizeSvg('<svg><rect></svg>')).toBeNull();
  });
});
