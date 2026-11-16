import { test, expect, type Page } from '@playwright/test';
import { codeBook } from './epub-book';

/** Set CODE_SHOTS to a directory to also save screenshots: the hover controls, the open sheet and the Copied state. */
const shots = process.env.CODE_SHOTS;

const flowOf = (page: Page) => page.evaluate(() => (document.querySelector('.reader-host:not(.staging):not(.tab-hidden) foliate-view') as unknown as { renderer: HTMLElement }).renderer.getAttribute('flow'));
/** The book's content frame. Foliate keeps its iframe in a closed shadow root, so it is found as a frame of the page, not by selector. */
const frameOf = (page: Page) => page.frames().filter(frame => frame.url().startsWith('blob:')).at(-1)!;

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
  await expect(frameOf(page).locator('div.sourceCode#cb2')).toBeVisible();
}

/** The indented pandoc block (#cb2), exactly as the fixture writes it. */
const INDENTED = ['def outer(items):', '    for item in items:', '        if item:', '            with open(item) as handle:', '                return handle.read()', '    return None'].join('\n');
/** Chromium on Windows reads the clipboard back with CRLF whatever the page wrote; the written text itself is `\n` (tests/code-viewer.test.ts). */
const clipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText()).then((text) => text.replace(/\r\n/g, '\n'));
/** The Open and Copy buttons of the hovered block: where they sit in the block's corner, and how big they are. */
const corner = (page: Page, block: string) => frameOf(page).locator(block).evaluate(element => {
  const doc = element.ownerDocument, shadow = Array.from(doc.documentElement.children).find(child => child.shadowRoot)!.shadowRoot!;
  const box = element.getBoundingClientRect(), [open, copy] = ['Open code', 'Copy code'].map(label => shadow.querySelector(`button[aria-label="${label}"]`)!.getBoundingClientRect());
  return { open: { width: open.width, height: open.height }, copy: { width: copy.width, height: copy.height }, top: copy.top - box.top, right: box.right - copy.right, gap: copy.left - open.right };
});
const sheetOf = (page: Page) => page.getByRole('dialog', { name: /^Code/ });

for (const flow of ['pages', 'scroll'] as const) {
  test(`hover shows Open and Copy at the block's corner in ${flow}`, async ({ page }) => {
    await open(page, 1080, 760, 'light', flow);
        await expect(frameOf(page).getByRole('button', { name: 'Open code' })).toBeHidden();
    await frameOf(page).locator('div.sourceCode#cb2').hover();
    await expect(frameOf(page).getByRole('button', { name: 'Open code' })).toBeVisible();
    await expect(frameOf(page).getByRole('button', { name: 'Copy code' })).toBeVisible();
    const at = await corner(page, 'div.sourceCode#cb2');
    expect(at.open).toEqual({ width: 24, height: 24 });
    expect(at.copy).toEqual({ width: 24, height: 24 });
    expect(at.top).toBeCloseTo(8, 0);
    expect(at.right).toBeCloseTo(8, 0);
    if (shots) await page.screenshot({ path: `${shots}/hover-${flow}.png` });
    // The book's own markup is untouched but for a Tab stop on the block.
    expect(await frameOf(page).locator('div.sourceCode#cb2').evaluate(element => element.outerHTML.includes('<button'))).toBe(false);
    await page.mouse.move(2, 2);
    await expect(frameOf(page).getByRole('button', { name: 'Open code' })).toBeHidden();
  });
}

test('keyboard: Tab reaches Open, Enter opens the sheet, Esc closes it and focus returns', async ({ page }) => {
  await open(page, 1080, 760, 'light', 'scroll');
  const block = () => frameOf(page).locator('div.sourceCode#cb2');
  await block().focus();
  await expect(frameOf(page).getByRole('button', { name: 'Open code' })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(frameOf(page).getByRole('button', { name: 'Open code' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(frameOf(page).getByRole('button', { name: 'Copy code' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(frameOf(page).getByRole('button', { name: 'Open code' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(block()).toBeFocused();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(sheetOf(page)).toBeVisible();
  await expect(sheetOf(page)).toBeFocused();
  // Focus stays inside the sheet: Tab runs Copy, the listing, Close, and round to Copy.
  const sheet = sheetOf(page);
  for (const stop of [sheet.getByRole('button', { name: 'Copy' }), sheet.getByRole('region', { name: 'Code listing' }), sheet.getByRole('button', { name: 'Close' }), sheet.getByRole('button', { name: 'Copy' })]) {
    await page.keyboard.press('Tab');
    await expect(stop).toBeFocused();
  }
  await page.keyboard.press('Escape');
  await expect(sheetOf(page)).toHaveCount(0);
  await expect(frameOf(page).getByRole('button', { name: 'Open code' })).toBeFocused();
  // Past Copy, Tab goes on to what follows the block (here the next listing, which gets its own controls), not back to the same pair.
  await page.keyboard.press('Tab');
  await expect(frameOf(page).getByRole('button', { name: 'Copy code' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(frameOf(page).locator('div.sourceCode#cb3')).toBeFocused();
  await expect(frameOf(page).getByRole('button', { name: 'Open code' })).toBeVisible();
});

test('Esc belongs to the palette while it is open over the sheet, and closes the sheet afterwards', async ({ page }) => {
  await open(page, 1080, 760, 'light', 'scroll');
  await frameOf(page).locator('div.sourceCode#cb2').hover();
  await frameOf(page).getByRole('button', { name: 'Open code' }).click();
  await expect(sheetOf(page)).toBeVisible();
  await page.keyboard.press('Control+k');
  await expect(page.locator('#palette')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#palette')).toBeHidden();
  await expect(sheetOf(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheetOf(page)).toHaveCount(0);
});

test('copy puts the block\'s exact text on the clipboard and says Copied for a moment', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await open(page, 1080, 760, 'light', 'scroll');
    await frameOf(page).locator('div.sourceCode#cb2').hover();
  await frameOf(page).getByRole('button', { name: 'Copy code' }).click();
  await expect(frameOf(page).getByRole('status')).toHaveText('Copied');
  // The label sits beside the buttons: they stay where they were.
  expect((await corner(page, 'div.sourceCode#cb2')).right).toBeCloseTo(8, 0);
  if (shots) await page.screenshot({ path: `${shots}/copied.png` });
  expect(await clipboard(page)).toBe(INDENTED);
  await expect(frameOf(page).getByRole('status')).toBeHidden({ timeout: 3000 });
  // A Sphinx block keeps its trailing newline and carries no line numbers.
  await frameOf(page).locator('div.highlight').hover();
  await frameOf(page).getByRole('button', { name: 'Copy code' }).click();
  await expect.poll(() => clipboard(page)).toMatch(/^import json\n\ndef load\(path\):\n {4}result_3 = .*\n {4}result_4 = .*\n {4}return json\.loads\(path\) {2}# synthetic\n$/);
});

for (const flow of ['pages', 'scroll'] as const) for (const [width, height] of [[1080, 760], [420, 620]]) for (const scheme of ['light', 'dark'] as const) {
  test(`the sheet shows an unwrapped listing in ${flow} at ${width}×${height}, Brief ${scheme}`, async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await open(page, width, height, scheme, flow);
        await frameOf(page).locator('div.sourceCode#cb1').hover();
    await frameOf(page).getByRole('button', { name: 'Open code' }).click();
    const sheet = sheetOf(page);
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('.code-sheet-language')).toHaveText('python');
    const m = await sheet.evaluate(element => {
      const body = element.querySelector('.code-sheet-body') as HTMLElement, pre = element.querySelector('pre')!, gutter = element.querySelector('.code-sheet-gutter') as HTMLElement;
      const style = getComputedStyle(pre), rect = element.getBoundingClientRect(), host = element.closest('.reader-host')!.getBoundingClientRect();
      const lineHeight = parseFloat(style.lineHeight);
      const canvas = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
      canvas.canvas.width = canvas.canvas.height = 1;
      const rgba = (css: string) => { canvas.clearRect(0, 0, 1, 1); canvas.fillStyle = css; canvas.fillRect(0, 0, 1, 1); return Array.from(canvas.getImageData(0, 0, 1, 1).data); };
      const luminance = ([r, g, b]: number[]) => [r, g, b].map(c => c / 255).map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
      const ratio = (a: number[], b: number[]) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
      const card = rgba(getComputedStyle(element).backgroundColor);
      const texts = Array.from(pre.querySelectorAll('*')).concat(pre).filter(node => Array.from(node.childNodes).some(child => child.nodeType === Node.TEXT_NODE && child.textContent?.trim()));
      const lowest = Math.min(...texts.map(node => ratio(rgba(getComputedStyle(node).color), card)));
      const rows = (pre.textContent ?? '').replace(/\n$/, '').split('\n').length;
      const longest = Math.max(...(pre.textContent ?? '').split('\n').map(line => line.length));
      body.scrollLeft = body.scrollWidth;
      const scrolled = { right: pre.getBoundingClientRect().right, bodyRight: body.getBoundingClientRect().right, gutterLeft: gutter.getBoundingClientRect().left, bodyLeft: body.getBoundingClientRect().left };
      body.scrollLeft = 0;
      return {
        whiteSpace: style.whiteSpace, fontFamily: style.fontFamily, fontSize: parseFloat(style.fontSize), lineHeight,
        height: pre.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom), rows,
        numbers: gutter.textContent!.split('\n').length, gutterColor: getComputedStyle(gutter).color,
        overflowX: getComputedStyle(body).overflowX, overflowY: getComputedStyle(body).overflowY,
        scrollWidth: body.scrollWidth, clientWidth: body.clientWidth, longest, scrolled, lowest, texts: texts.length,
        left: rect.left - host.left, right: host.right - rect.right, width: rect.width, hostWidth: host.width, tall: rect.height, window: innerHeight, card,
      };
    });
    expect(m.whiteSpace).toBe('pre');
    expect(m.fontFamily).toContain('JetBrains Mono');
    expect(m.height, 'one row per line: nothing wraps').toBeCloseTo(m.rows * m.lineHeight, 0);
    expect(m.numbers).toBe(m.rows);
    expect(m.overflowX).toBe('auto');
    expect(m.overflowY).toBe('auto');
    // The lines are 100-140 characters: wider than the sheet at any size here, so the listing scrolls sideways and its end can be brought into view.
    expect(m.scrollWidth).toBeGreaterThan(m.clientWidth);
    expect(m.scrolled.right, 'the end of the longest line is in view after scrolling').toBeLessThanOrEqual(m.scrolled.bodyRight + 1);
    expect(m.scrolled.gutterLeft, 'line numbers stay put').toBeCloseTo(m.scrolled.bodyLeft, 0);
    expect(m.tall).toBeLessThanOrEqual(m.window * 0.8 + 1);
    if (width > 720) {
      expect(m.width).toBeLessThanOrEqual(1000);
      expect(m.width).toBeCloseTo(Math.min(1000, m.hostWidth), 0);
    } else {
      expect(m.left).toBeCloseTo(12, 0);
      expect(m.right).toBeCloseTo(12, 0);
    }
    expect(m.lowest, 'every colour of the listing reads on the sheet').toBeGreaterThanOrEqual(4.5);
    expect(m.texts).toBeGreaterThanOrEqual(3);
    if (shots) await page.screenshot({ path: `${shots}/sheet-${flow}-${width}x${height}-${scheme}.png` });
    // Copy in the sheet.
    await sheet.getByRole('button', { name: 'Copy' }).click();
    await expect(sheet.getByRole('button', { name: 'Copied' })).toBeVisible();
    expect(await clipboard(page)).toContain('def run(job):\n    result_1 = client.submit(');
    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(sheet).toHaveCount(0);
  });
}

test('the sheet scrolls vertically through a long listing and clicking outside closes it', async ({ page }) => {
  await open(page, 1080, 760, 'light', 'scroll');
    await frameOf(page).locator('div.sourceCode#cb3').hover();
  await frameOf(page).getByRole('button', { name: 'Open code' }).click();
  const sheet = sheetOf(page);
  await expect(sheet).toBeVisible();
  const body = sheet.locator('.code-sheet-body');
  expect(await body.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  await body.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(sheet.locator('.code-sheet-gutter')).toContainText('59');
  // Above the sheet, still on the reading surface.
  const area = (await page.locator('.reader-host:not(.staging):not(.tab-hidden)').boundingBox())!;
  await page.mouse.click(area.x + area.width / 2, area.y + 8);
  await expect(sheet).toHaveCount(0);
  await expect(frameOf(page).getByRole('button', { name: 'Open code' })).toBeFocused();
});
