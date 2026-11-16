import { writeFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { calloutBook } from './epub-book';

/** Set CALLOUT_SHOTS to a directory to also save a screenshot of every case; CALLOUT_DUMP to a file to append each case's computed colours (to compare two builds). */
const shots = process.env.CALLOUT_SHOTS, dump = process.env.CALLOUT_DUMP;

type Frame = { renderer: { getContents: () => { doc: Document }[] } };
const flowOf = (page: Page) => page.evaluate(() => (document.querySelector('.reader-host:not(.staging):not(.tab-hidden) foliate-view') as unknown as { renderer: HTMLElement }).renderer.getAttribute('flow'));

type Theme = { name: string; palette: string; mode: 'light' | 'dark' };
const themes: Theme[] = [{ name: 'Brief dark', palette: 'brief', mode: 'dark' }, { name: 'Aurora', palette: 'aurora', mode: 'dark' }, { name: 'Brief light', palette: 'brief', mode: 'light' }];

async function open(page: Page, theme: Theme, flow: 'pages' | 'scroll', night: boolean) {
  await page.addInitScript(record => localStorage.setItem('hold-my-brief:appearance', JSON.stringify(record)), { mode: theme.mode, palette: theme.palette, accent: null, page: 'theme' });
  await page.setViewportSize({ width: 1080, height: 760 });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme.mode);
  await page.locator('#file-input').setInputFiles({ name: 'callouts.epub', mimeType: 'application/epub+zip', buffer: await calloutBook({ night }) });
  await expect(page.locator('#position')).toContainText('%');
  await expect(page.locator('#view-controls')).toBeVisible();
  await expect(page.locator('.reader-host.staging')).toHaveCount(0);
  await page.locator(flow === 'scroll' ? '#flow-scroll' : '#flow-pages').click();
  await expect.poll(() => flowOf(page)).toBe(flow === 'scroll' ? 'scrolled' : 'paginated');
}

/** Every publisher box in the frame: its computed background, rule colours and the contrast of each text in it, as the frame drew them. */
const measure = (page: Page) => page.evaluate(() => {
  const view = document.querySelector('.reader-host:not(.staging):not(.tab-hidden) foliate-view') as unknown as Frame;
  const doc = view.renderer.getContents()[0].doc, win = doc.defaultView!;
  const canvas = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
  canvas.canvas.width = canvas.canvas.height = 1;
  const rgba = (css: string) => { canvas.clearRect(0, 0, 1, 1); canvas.fillStyle = css; canvas.fillRect(0, 0, 1, 1); return Array.from(canvas.getImageData(0, 0, 1, 1).data); };
  const luminance = ([r, g, b]: number[]) => [r, g, b].map(c => c / 255).map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (a: number[], b: number[]) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const paper = rgba(win.getComputedStyle(doc.documentElement).getPropertyValue('--theme-bg-color').trim());
  const backdrop = (element: Element) => {
    for (let node: Element | null = element; node && node !== doc.documentElement; node = node.parentElement) {
      const color = rgba(win.getComputedStyle(node).backgroundColor);
      if (color[3] > 0) return color;
    }
    return paper;
  };
  const boxes = Array.from(doc.querySelectorAll('div.note, div.warning, div.night, aside, table.reference th')).map(box => {
    const style = win.getComputedStyle(box), background = rgba(style.backgroundColor);
    const texts = [box, ...Array.from(box.querySelectorAll('*'))].filter(element => Array.from(element.childNodes).some(child => child.nodeType === Node.TEXT_NODE && child.textContent?.trim()))
      .map(element => { const color = rgba(win.getComputedStyle(element).color); return { name: element.tagName.toLowerCase(), color, ratio: ratio(color, backdrop(element)) }; });
    const left = rgba(style.borderLeftColor);
    return { name: `${box.tagName.toLowerCase()}.${box.className}`, background, left, rule: ratio(left, background), width: parseFloat(style.borderLeftWidth), texts };
  });
  return { boxes, paper, ink: rgba(win.getComputedStyle(doc.documentElement).color) };
});

const named = (m: Awaited<ReturnType<typeof measure>>, name: string) => m.boxes.find(box => box.name === name)!;
/** The computed background of a text-free rule: it holds no text, so no theme may map it. */
const ruleBackground = (page: Page, selector: string) => page.evaluate(selector => {
  const view = document.querySelector('.reader-host:not(.staging):not(.tab-hidden) foliate-view') as unknown as Frame;
  const doc = view.renderer.getContents()[0].doc;
  return doc.defaultView!.getComputedStyle(doc.querySelector(selector)!).backgroundColor;
}, selector);
const luminanceOf = ([r, g, b]: number[]) => [r, g, b].map(c => c / 255).map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);

for (const theme of themes) for (const flow of ['pages', 'scroll'] as const) {
  test(`publisher callouts in ${flow}, ${theme.name}: ${theme.mode === 'dark' ? 'mapped into the dark page and readable' : 'unchanged'}`, async ({ page }) => {
    await open(page, theme, flow, false);
    let seen = '';
    await expect.poll(async () => { const next = JSON.stringify((await measure(page)).boxes.map(box => box.name)); const done = next === seen && next.includes('aside'); seen = next; return done; }).toBe(true);
    const m = await measure(page);
    if (dump) writeFileSync(dump, `${JSON.stringify({ theme: theme.name, flow, boxes: m.boxes.map(({ name, background, left, texts }) => ({ name, background, left, texts: texts.map(({ name, color }) => ({ name, color })) })) })}\n`, { flag: 'a' });
    if (shots) {
      await page.evaluate(() => { const view = document.querySelector('.reader-host:not(.staging):not(.tab-hidden) foliate-view') as unknown as Frame; view.renderer.getContents()[0].doc.querySelector('div.note')!.scrollIntoView(); });
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${shots}/${theme.name.toLowerCase().replace(' ', '-')}-${flow}.png` });
    }
    expect(await ruleBackground(page, 'hr.rule'), 'a text-free rule keeps the publisher colour in every theme').toBe('rgb(204, 204, 204)');
    expect(m.boxes.map(box => box.name)).toEqual(['div.note', 'div.warning', 'th.', 'th.', 'aside.']);
    for (const box of m.boxes) for (const text of box.texts) expect(text.ratio, `${box.name} ${text.name}`).toBeGreaterThanOrEqual(4.5);
    if (theme.mode === 'dark') {
      for (const box of m.boxes) {
        expect(luminanceOf(box.background), `${box.name} is mapped to a dark box`).toBeLessThan(0.18);
        expect(box.width, `${box.name} keeps its rule`).toBeGreaterThan(0);
        expect(box.rule, `${box.name}'s rule shows`).toBeGreaterThanOrEqual(3);
      }
      // A hint of the original hue survives: the note is bluish, the warning warm.
      const note = named(m, 'div.note').background, warning = named(m, 'div.warning').background;
      expect(note[2], 'note leans blue').toBeGreaterThan(note[0]);
      expect(warning[0], 'warning leans warm').toBeGreaterThan(warning[2]);
    } else {
      // A light page leaves a light box alone: the publisher's own colours.
      expect(named(m, 'div.note').background.slice(0, 3)).toEqual([0xf1, 0xf6, 0xfb]);
      expect(named(m, 'div.warning').background.slice(0, 3)).toEqual([0xff, 0xf5, 0xee]);
      expect(named(m, 'div.warning').texts.map(text => text.color.slice(0, 3))).toEqual([[0x5a, 0x2a, 0x00], [0x5a, 0x2a, 0x00]]);
      expect(named(m, 'div.note').left.slice(0, 3)).toEqual([0x2f, 0x6d, 0xb5]);
      expect(named(m, 'div.warning').left.slice(0, 3)).toEqual([0xc4, 0x56, 0x1a]);
    }
  });
}

test('a publisher-dark callout on a light page is mapped to a light box and its text reads', async ({ page }) => {
  await open(page, themes[2], 'pages', true);
  await expect.poll(async () => (await measure(page)).boxes.some(box => box.name === 'div.night')).toBe(true);
  const night = named(await measure(page), 'div.night');
  expect(luminanceOf(night.background), 'a dark box on a light page is lightened').toBeGreaterThanOrEqual(0.18);
  expect(night.texts.length).toBeGreaterThan(0);
  for (const text of night.texts) expect(text.ratio).toBeGreaterThanOrEqual(4.5);
  expect(night.rule, 'its rule shows').toBeGreaterThanOrEqual(3);
  expect(await ruleBackground(page, 'hr.dark-rule'), 'a text-free dark rule keeps the publisher colour on a light page').toBe('rgb(51, 51, 51)');
});
