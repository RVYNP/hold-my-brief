import { expect, test, type Page } from '@playwright/test';
import { pagedPdf } from './paged-pdf';

/** Set CODE_SHOTS to a directory to also save screenshots of the coloured blocks. */
const shots = process.env.CODE_SHOTS;

const TS = [
  'interface User { id: number; name: string }',
  '',
  '// Greets a user',
  'export function greet(user: User): string {',
  '  const label = `Hello, ${user.name}`;',
  '  return label.length > 0 ? label : "anonymous";',
  '}',
].join('\n');
const BASH = ['#!/usr/bin/env bash', '# build and test', 'set -e', 'for f in src/*.ts; do', '  echo "checking $f" | grep -c 42', 'done'].join('\n');
const JSON_TEXT = ['{', '  "name": "hold-my-brief",', '  "version": 1,', '  "private": true,', '  "tags": ["a", "b"]', '}'].join('\n');
const DIFF = ['--- a/readme.md', '+++ b/readme.md', '@@ -1,3 +1,3 @@', ' context line', '-removed line', '+added line'].join('\n');
const UNKNOWN = 'const x = "not coloured";';
const NONE = 'a block with no language: const y = 2;';
const blocks: { language: string; source: string }[] = [
  { language: 'ts', source: TS }, { language: 'bash', source: BASH }, { language: 'json', source: JSON_TEXT }, { language: 'diff', source: DIFF },
  { language: 'foo', source: UNKNOWN }, { language: '', source: NONE },
];
const markdown = ['# Syntax', '', ...blocks.flatMap(({ language, source }) => ['```' + language, source, '```', ''])].join('\n');

async function openDoc(page: Page, scheme: 'light' | 'dark' = 'light', appearance?: { mode: 'light' | 'dark'; palette: string }) {
  await page.emulateMedia({ colorScheme: scheme });
  await page.setViewportSize({ width: 1440, height: 900 });
  if (appearance) await page.addInitScript(record => localStorage.setItem('hold-my-brief:appearance', JSON.stringify(record)), { ...appearance, accent: null, page: 'theme' });
  await page.goto('/');
  await page.locator('#file-input').setInputFiles({ name: 'syntax.md', mimeType: 'text/markdown', buffer: Buffer.from(markdown) });
  await expect(page.locator('#filename')).toHaveText('syntax.md');
  await expect(page.locator('.code-block').first()).toBeVisible();
}

const families = ['brief', 'lilac', 'birch', 'graphite', 'arctic', 'blossom', 'peony'];
const glows = { aurora: 'dark', dusk: 'dark', nebula: 'dark', solar: 'dark', ember: 'dark', orchid: 'dark', glacier: 'light', peach: 'light', lagoon: 'light', moss: 'light' } as const;
const tones = ['theme', 'white', 'sepia', 'dim'];

test('every token reaches 4.5:1 on the block, in every palette, mode and page tone', async ({ page }) => {
  await openDoc(page);
  const result = await page.evaluate(({ families, glows, tones }) => {
    const groups: Record<string, string[]> = {
      keyword: ['keyword', 'built_in', 'literal', 'type', 'selector-tag'],
      string: ['string', 'regexp', 'symbol', 'attr-value'],
      name: ['title', 'function', 'attr', 'property', 'variable', 'name'],
      number: ['number'],
      comment: ['comment', 'quote', 'meta'],
    };
    const swatch = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
    swatch.canvas.width = swatch.canvas.height = 1;
    const rgba = (value: string) => { swatch.clearRect(0, 0, 1, 1); swatch.fillStyle = '#000'; swatch.fillStyle = value; swatch.fillRect(0, 0, 1, 1); const d = swatch.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
    const lin = (value: number) => { const c = value / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const lum = ([r, g, b]: number[]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    const ratio = (a: number[], b: number[]) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    // A box's colour as drawn: its own background over each ancestor's, down to the first opaque one.
    const over = (top: number[], below: number[]) => [0, 1, 2].map(i => top[i] * top[3] + below[i] * (1 - top[3]));
    const backdrop = (element: Element) => {
      const layers: number[][] = [];
      for (let up: Element | null = element; up; up = up.parentElement) { const layer = rgba(getComputedStyle(up).backgroundColor); if (layer[3] > 0) layers.push(layer); if (layer[3] === 1) break; }
      return layers.reduceRight((below, layer) => over(layer, below), [255, 255, 255]);
    };
    const root = document.documentElement;
    const appearances: [string, string][] = [...families.flatMap(name => [[name, 'light'], [name, 'dark']] as [string, string][]), ...Object.entries(glows)];
    const failures: string[] = [], seen = new Set<string>();
    let checked = 0;
    for (const [palette, scheme] of appearances) for (const tone of tones) {
      root.dataset.theme = scheme; root.dataset.palette = palette;
      if (tone === 'theme') delete root.dataset.page; else root.dataset.page = tone;
      const label = `${palette} ${scheme} ${tone}`;
      for (const block of document.querySelectorAll<HTMLElement>('.reader-host .code-block')) {
        const base = backdrop(block);
        const tokenColour = (token: string) => { const probe = document.createElement('span'); probe.style.color = `var(--code-${token})`; block.append(probe); const colour = rgba(getComputedStyle(probe).color); probe.remove(); return colour; };
        const colours = Object.fromEntries(Object.keys(groups).map(token => [token, tokenColour(token)]));
        for (const span of block.querySelectorAll<HTMLElement>('pre [class*="hljs-"]')) {
          const style = getComputedStyle(span), ink = rgba(style.color), tint = rgba(style.backgroundColor);
          const ground = tint[3] > 0 ? over(tint, base) : base;
          const classes = Array.from(span.classList, name => name.replace(/^hljs-/, ''));
          const token = Object.keys(groups).find(name => classes.some(c => groups[name].includes(c)));
          const addition = classes.includes('addition') ? 'string' : classes.includes('deletion') ? 'keyword' : '';
          const named = addition || token;
          const value = ratio(ink, ground);
          checked++;
          if (named) {
            seen.add(named + (addition ? ' diff' : ''));
            if (ink.some((channel, i) => Math.abs(channel - colours[named][i]) > 0.5)) failures.push(`${label}: .${span.className} is not --code-${named}`);
          }
          if (value < 4.5) failures.push(`${label}: ${named ?? 'ink'} .${span.className} ${value.toFixed(2)}:1`);
        }
      }
    }
    return { failures, seen: [...seen].sort(), checked };
  }, { families, glows, tones });
  expect(result.failures).toEqual([]);
  expect(result.seen).toEqual(['comment', 'keyword', 'keyword diff', 'name', 'number', 'string', 'string diff']);
  // 24 appearances (7 families x 2 modes, 10 glow themes) x 4 page tones, each with its spans.
  expect(result.checked).toBeGreaterThan(24 * 4 * 40);
});

test('the text of every block is its fence source, to the character', async ({ page }) => {
  await openDoc(page);
  const texts = await page.locator('.reader-host .code-block pre').evaluateAll(elements => elements.map(element => element.textContent));
  expect(texts).toEqual(blocks.map(({ source }) => source + '\n'));
  await expect(page.locator('.reader-host .code-block').nth(0).locator('pre [class*="hljs-"]').first()).toBeVisible();
});

test('an unknown language and a block with no language are not coloured, and the label still shows', async ({ page }) => {
  await openDoc(page);
  const unknown = page.locator('.reader-host .code-block[data-language="foo"]');
  await expect(unknown.locator('.code-lang')).toHaveText('foo');
  await expect(unknown.locator('[class*="hljs-"]')).toHaveCount(0);
  const none = page.locator('.reader-host .code-block:not([data-language])');
  await expect(none).toHaveCount(1);
  await expect(none.locator('[class*="hljs-"]')).toHaveCount(0);
  await expect(page.locator('.reader-host .code-block[data-language="ts"] [class*="hljs-"]').first()).toBeAttached();
});

test('find steps through matches inside coloured blocks, and a place inside one is restored', async ({ page }) => {
  await openDoc(page);
  await page.keyboard.press('Control+f');
  await page.locator('#find-query').fill('greet');
  // "Greets" in the comment, "greet" in the function name.
  await expect(page.locator('#find-status')).toHaveText('1 of 2');
  await page.keyboard.press('Enter');
  await expect(page.locator('#find-status')).toHaveText('2 of 2');
  await expect(page.locator('.code-block pre mark.search-hit')).toHaveText('greet');
  await expect(page.locator('.code-block pre .hljs-title mark.search-hit')).toHaveCount(1);
  // A match that crosses a token boundary is marked in every piece.
  await page.locator('#find-query').fill('const label');
  await expect(page.locator('#find-status')).toHaveText('1 of 1');
  await expect(page.locator('.code-block pre mark.search-hit')).toHaveText(['const', ' label']);
  await page.locator('#find-query').fill('const');
  await expect(page.locator('#find-status')).toContainText('of');
  await page.keyboard.press('Enter');
  await expect(page.locator('.code-block pre mark.search-hit').first()).toBeVisible();
  // The coloured text is intact after the marks are taken away again.
  await page.locator('#find-query').fill('');
  const first = await page.locator('.reader-host .code-block pre').first().evaluate(element => element.textContent);
  expect(first).toBe(TS + '\n');
});

test('a find hit inside a code token keeps the block ink, not the token colour', async ({ page }) => {
  await openDoc(page, 'dark', { mode: 'dark', palette: 'brief' });
  await page.keyboard.press('Control+f');
  await page.locator('#find-query').fill('Greets');
  await expect(page.locator('#find-status')).toHaveText('1 of 1');
  const mark = page.locator('.code-block pre .hljs-comment mark.search-hit');
  await expect(mark).toHaveText('Greets');
  const [hit, ink] = await Promise.all([
    mark.evaluate(element => getComputedStyle(element).color),
    mark.evaluate(element => getComputedStyle(element.closest('pre code')!).color),
  ]);
  expect(hit).toBe(ink);
});

test('a place inside a coloured code block is restored there after a reload', async ({ page }) => {
  const lines = Array.from({ length: 160 }, (_, i) => `value_${i + 1} = compute(${i + 1})  # a comment that makes this line longer`);
  const long = ['# Long listing', '', 'Intro.', '', '```python', ...lines, '```', '', 'Outro.'].join('\n');
  const file = { name: 'long.md', mimeType: 'text/markdown', buffer: Buffer.from(long) };
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.locator('#file-input').setInputFiles(file);
  await expect(page.locator('.code-block pre .hljs-comment').first()).toBeAttached();
  await page.keyboard.press('Control+g');
  await page.locator('#target').fill('100');
  await page.getByRole('button', { name: 'Go to location', exact: true }).click();
  await expect(page.locator('#position')).toContainText('Long listing');
  const topLine = () => page.evaluate(() => {
    const host = document.querySelector('.reader-host:not(.staging)')!, top = host.getBoundingClientRect().top;
    const line = Array.from(host.querySelectorAll('pre [data-hmb-line]')).find(element => element.getBoundingClientRect().bottom > top + 1);
    return { scroll: host.scrollTop, text: /value_\d+/.exec(line?.textContent ?? '')?.[0] ?? '' };
  });
  const before = await topLine();
  expect(before.scroll).toBeGreaterThan(500);
  expect(before.text).toMatch(/^value_\d+$/);
  await expect.poll(() => page.evaluate(() => Math.max(0, ...Object.entries(localStorage).filter(([key]) => key.startsWith('hold-my-brief:')).map(([, value]) => { try { return Number(JSON.parse(value).locator?.line) || 0; } catch { return 0; } })))).toBeGreaterThan(50);
  await page.reload();
  await page.locator('#file-input').setInputFiles(file);
  await expect(page.locator('.code-block pre .hljs-comment').first()).toBeAttached();
  await expect.poll(async () => Math.abs((await topLine()).scroll - before.scroll)).toBeLessThan(30);
  expect((await topLine()).text).toBe(before.text);
});

test('the code sheet keeps the colours of the block it opens', async ({ page }) => {
  await openDoc(page);
  const block = page.locator('.reader-host .code-block[data-language="ts"]');
  const colours = (selector: string) => page.evaluate(selector => {
    const spans = Array.from(document.querySelectorAll<HTMLElement>(selector)).filter(span => span.textContent?.trim());
    const map = new Map<string, string>();
    for (const span of spans) map.set(span.textContent!.trim(), `${getComputedStyle(span).color} ${getComputedStyle(span).fontStyle}`);
    return Object.fromEntries(map);
  }, selector);
  const inBlock = await colours('.reader-host .code-block[data-language="ts"] pre [class*="hljs-"]');
  await block.getByRole('button', { name: 'Open code, ts' }).click();
  const sheet = page.getByRole('dialog', { name: 'Code, ts' });
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('.code-sheet-code')).toHaveText(TS + '\n');
  const inSheet = await page.evaluate(() => {
    const out: Record<string, string> = {};
    for (const span of document.querySelectorAll<HTMLElement>('.code-sheet-code span')) if (span.textContent?.trim()) out[span.textContent.trim()] = `${getComputedStyle(span).color} ${getComputedStyle(span).fontStyle}`;
    return out;
  });
  // Every word the block coloured is coloured in the sheet, in the same colour (the sheet only raises a colour that would not read on its card).
  const words = ['export', 'function', 'const', 'string', '// Greets a user'];
  for (const word of words) {
    expect(inBlock[word], word).toBeDefined();
    expect(inSheet[word], word).toBeDefined();
  }
  const ink = await sheet.locator('.code-sheet-code').evaluate(element => getComputedStyle(element).color);
  for (const word of ['export', 'const']) expect(inSheet[word].split(' ')[0]).not.toBe(ink);
  expect(inSheet['// Greets a user']).toContain('italic');
  expect(inSheet.export).toBe(inBlock.export);
  expect(inSheet['// Greets a user']).toBe(inBlock['// Greets a user']);
});

test('forced colours and increased contrast leave every token in the block\'s ink', async ({ page }) => {
  await openDoc(page);
  const flat = () => page.evaluate(() => {
    const ink = getComputedStyle(document.querySelector('.reader-host .code-block pre code')!).color;
    return Array.from(document.querySelectorAll<HTMLElement>('.reader-host .code-block pre [class*="hljs-"]')).filter(span => {
      const style = getComputedStyle(span);
      return style.color !== ink || style.fontStyle !== 'normal' || !/, 0\)$/.test(style.backgroundColor);
    }).length;
  });
  expect(await flat()).toBeGreaterThan(10);
  await page.emulateMedia({ contrast: 'more' });
  expect(await flat()).toBe(0);
  await page.emulateMedia({ contrast: 'no-preference', forcedColors: 'active' });
  expect(await flat()).toBe(0);
});

test('opening only a PDF loads no highlighting code; opening Markdown does', async ({ page }) => {
  const loaded: string[] = [];
  page.on('request', request => { if (/highlight|code-highlight|adapters\/text|assets\/text-/.test(request.url())) loaded.push(request.url()); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.locator('#file-input').setInputFiles({ name: 'only.pdf', mimeType: 'application/pdf', buffer: pagedPdf(2) });
  await expect(page.locator('#filename')).toHaveText('only.pdf');
  await expect(page.locator('.reader-host canvas').first()).toBeVisible();
  expect(loaded).toEqual([]);
  await page.locator('#file-input').setInputFiles({ name: 'syntax.md', mimeType: 'text/markdown', buffer: Buffer.from(markdown) });
  await expect(page.locator('.code-block').first()).toBeVisible();
  await expect.poll(() => loaded.length).toBeGreaterThan(0);
});

for (const shot of [
  { name: 'brief-light', scheme: 'light', palette: 'brief' }, { name: 'brief-dark', scheme: 'dark', palette: 'brief' },
  { name: 'aurora', scheme: 'dark', palette: 'aurora' }, { name: 'peach', scheme: 'light', palette: 'peach' },
] as const) {
  test(`screenshot: ${shot.name}`, async ({ page }) => {
    test.skip(!shots, 'screenshots only with CODE_SHOTS');
    await openDoc(page, shot.scheme, { mode: shot.scheme, palette: shot.palette });
    await expect(page.locator('html')).toHaveAttribute('data-palette', shot.palette);
    await page.screenshot({ path: `${shots}/markdown-syntax-${shot.name}.png` });
  });
}
