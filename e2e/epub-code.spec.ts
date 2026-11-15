import { test, expect, type Page } from '@playwright/test';
import { codeBook } from './epub-book';

/** Set CODE_SHOTS to a directory to also save a screenshot of every case (the before/after pictures of a change to code blocks). */
const shots = process.env.CODE_SHOTS;

type Frame = { renderer: { getContents: () => { doc: Document }[] } };
const flowOf = (page: Page) => page.evaluate(() => (document.querySelector('.reader-host:not(.staging):not(.tab-hidden) foliate-view') as unknown as { renderer: HTMLElement }).renderer.getAttribute('flow'));

async function open(page: Page, width: number, height: number, scheme: 'light' | 'dark', flow: 'pages' | 'scroll') {
  await page.emulateMedia({ colorScheme: scheme });
  await page.setViewportSize({ width, height });
  await page.goto('/');
  await page.locator('#file-input').setInputFiles({ name: 'code.epub', mimeType: 'application/epub+zip', buffer: await codeBook() });
  await expect(page.locator('#position')).toContainText('%');
  await expect(page.locator('#view-controls')).toBeVisible();
  await expect(page.locator('.reader-host.staging')).toHaveCount(0);
  await page.locator(flow === 'scroll' ? '#flow-scroll' : '#flow-pages').click();
  await expect.poll(() => flowOf(page)).toBe(flow === 'scroll' ? 'scrolled' : 'paginated');
}

/** What the content frame drew: every code box's size, a code line's type, the widths of the prose and the code, and each code text's contrast. */
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
  const visible = (element: Element) => element.getClientRects().length > 0;
  const box = (element: Element) => ({ name: `${element.tagName.toLowerCase()}.${element.className}`, scroll: element.scrollWidth, client: element.clientWidth});
  // Where each line of a wrapped listing starts: the left edge of its first row and of its second, in characters of its own font.
  const hang = [doc.querySelector('#cb1-2'), Array.from(doc.querySelectorAll('.highlight pre [data-hmb-line]')).find(line => line.textContent?.includes('result_3'))].map(line => {
    if (!line) return null;
    const probe = doc.createElement('span');
    probe.style.cssText = 'display: inline-block; width: 10ch';
    line.append(probe);
    const ch = probe.getBoundingClientRect().width / 10;
    probe.remove();
    const range = doc.createRange();
    range.selectNodeContents(line);
    const rows = new Map<number, number>();
    for (const rect of Array.from(range.getClientRects())) if (rect.width > 0) rows.set(Math.round(rect.top), Math.min(rows.get(Math.round(rect.top)) ?? Infinity, rect.left));
    const lefts = Array.from(rows).sort((a, b) => a[0] - b[0]).map(([, left]) => left);
    return { ch, rows: lefts.length, first: lefts[0], second: lefts[1], indent: Number((line as HTMLElement).style.getPropertyValue('--hmb-indent')) };
  });
  const code = Array.from(doc.querySelectorAll('pre, div.sourceCode, div.highlight')).filter(visible);
  const line = doc.querySelector('pre.sourceCode code > span')!, sphinx = doc.querySelector('.highlight pre')!;
  const type = (element: Element) => { const style = win.getComputedStyle(element); return { lineHeight: parseFloat(style.lineHeight), fontSize: parseFloat(style.fontSize) }; };
  const texts = Array.from(doc.querySelectorAll('pre, pre *')).filter(element => Array.from(element.childNodes).some(child => child.nodeType === Node.TEXT_NODE && child.textContent?.trim()));
  const contrast = texts.map(element => ratio(rgba(win.getComputedStyle(element).color), backdrop(element)));
  return {
    boxes: code.map(box), hang, pandoc: type(line), sphinx: type(sphinx),
    prose: doc.querySelector('p')!.getClientRects()[0].width,
    wrapper: doc.querySelector('div.sourceCode')!.getClientRects()[0].width,
    shelf: Math.min(...Array.from(doc.querySelectorAll('div.sourceCode, .highlight')).map(element => luminance(backdrop(element)))),
    paper: luminance(paper), lowest: Math.min(...contrast), texts: texts.length,
  };
});

for (const flow of ['pages', 'scroll'] as const) for (const [width, height] of [[1080, 760], [420, 620]]) for (const scheme of ['light', 'dark'] as const) {
  test(`code blocks wrap and stay legible in ${flow} at ${width}×${height}, Brief ${scheme}`, async ({ page }) => {
    await open(page, width, height, scheme, flow);
    // Layout settles after the chapter loads: wait for the Sphinx block, the last one, to have been measured at the size it keeps.
    let seen = '';
    await expect.poll(async () => { const next = JSON.stringify((await measure(page)).boxes); const done = next === seen; seen = next; return done; }).toBe(true);
    const m = await measure(page);
    if (shots) {
      await page.evaluate(() => { const view = document.querySelector('.reader-host:not(.staging):not(.tab-hidden) foliate-view') as unknown as Frame; view.renderer.getContents()[0].doc.querySelector('div.sourceCode')!.scrollIntoView(); });
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${shots}/${flow}-${width}x${height}-${scheme}.png` });
    }
    expect(m.boxes.length).toBeGreaterThanOrEqual(8);
    for (const box of m.boxes) expect(box.scroll, `${box.name} scrolls sideways`).toBeLessThanOrEqual(box.client + 1);
    for (const type of [m.pandoc, m.sphinx]) {
      expect(type.fontSize).toBeGreaterThanOrEqual(12);
      expect(type.lineHeight).toBeLessThanOrEqual(1.5 * type.fontSize);
    }
    for (const line of m.hang) {
      expect(line, 'wrapped line to measure').not.toBeNull();
      expect(line!.rows, 'line wraps').toBeGreaterThanOrEqual(2);
      expect(line!.second, 'continuation starts right of its line').toBeGreaterThanOrEqual(line!.first + line!.ch);
      expect(line!.second - line!.first, 'continuation hangs 2ch from the line\'s indent').toBeCloseTo((line!.indent + 2) * line!.ch, 0);
    }
    if (flow === 'scroll' && width === 1080) expect(m.wrapper).toBeGreaterThan(m.prose + 1);
    if (flow === 'pages') expect(m.wrapper).toBeLessThanOrEqual(m.prose + 1);
    if (scheme === 'dark') {
      expect(m.shelf, 'code background stays bright on a dark page').toBeLessThan(0.18);
      expect(m.lowest).toBeGreaterThanOrEqual(4.5);
    }
  });
}
