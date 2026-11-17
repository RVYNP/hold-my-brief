import { expect, test, type Page } from '@playwright/test';

/** Set CODE_SHOTS to a directory to also save screenshots of the blocks. */
const shots = process.env.CODE_SHOTS;

const SHELL = ['$ npm install --save-dev lighthouse', '$ npm run build -- --watch', '  indented line'].join('\n');
const markdown = [
  '# Notes',
  '',
  'Before the blocks, a paragraph.',
  '',
  '```shell',
  SHELL,
  '```',
  '',
  'Between the blocks, with `inline code` that is a chip.',
  '',
  '```',
  'a block with no language',
  '```',
  '',
  'An indented block follows.',
  '',
  '    indented one',
  '    indented two',
  '',
  'After the blocks, a paragraph.',
].join('\n');

const clipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText()).then(text => text.replace(/\r\n/g, '\n'));

async function openDoc(page: Page, source = markdown, scheme: 'light' | 'dark' = 'light') {
  await page.emulateMedia({ colorScheme: scheme });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.locator('#file-input').setInputFiles({ name: 'code.md', mimeType: 'text/markdown', buffer: Buffer.from(source) });
  await expect(page.locator('#filename')).toHaveText('code.md');
  await expect(page.locator('.code-block').first()).toBeVisible();
}

test('each block has a frame, a header and its language; code is set in JetBrains Mono', async ({ page }) => {
  await openDoc(page);
  const blocks = page.locator('.reader-host .code-block');
  await expect(blocks).toHaveCount(3);
  for (const index of [0, 1, 2]) {
    const block = blocks.nth(index);
    await expect(block.locator('.code-head')).toBeVisible();
    expect(await block.evaluate(element => getComputedStyle(element).borderTopLeftRadius)).toBe('8px');
    expect(await block.locator('pre code').evaluate(element => getComputedStyle(element).fontFamily)).toMatch(/^"?JetBrains Mono"?,/);
    // The header is outside the pre: the block's text is the code alone.
    expect(await block.locator('pre').evaluate(element => element.querySelector('.code-head, button') === null)).toBe(true);
  }
  await expect(blocks.nth(0)).toHaveAttribute('data-language', 'shell');
  await expect(blocks.nth(0).locator('.code-lang')).toHaveText('shell');
  await expect(blocks.nth(1)).not.toHaveAttribute('data-language');
  await expect(blocks.nth(1).locator('.code-lang')).toHaveCount(0);
  await expect(blocks.nth(2).locator('.code-lang')).toHaveCount(0);
  await expect(blocks.nth(0).getByRole('button', { name: 'Copy code, shell' })).toBeVisible();
  await expect(blocks.nth(1).getByRole('button', { name: 'Copy code', exact: true })).toBeVisible();
  const chip = page.locator('.reader-host p code').first();
  const style = await chip.evaluate(element => { const css = getComputedStyle(element); return { radius: css.borderTopLeftRadius, family: css.fontFamily, border: css.borderTopWidth }; });
  expect(style.radius).toBe('4px');
  expect(style.border).toBe('1px');
  expect(style.family).toMatch(/^"?JetBrains Mono"?,/);
});

test('Copy puts the exact source on the clipboard and says Copied; Open shows the sheet', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openDoc(page);
  const block = page.locator('.reader-host .code-block').first();
  await block.getByRole('button', { name: 'Copy code, shell' }).click();
  await expect(block.getByRole('button', { name: 'Copy code, shell' })).toContainText('Copied');
  expect(await clipboard(page)).toBe(SHELL + '\n');
  await expect(block.getByRole('button', { name: 'Copy code, shell' })).toContainText('Copy', { timeout: 3000 });
  await expect(block.getByRole('button', { name: 'Copy code, shell' })).not.toContainText('Copied');

  const opener = block.getByRole('button', { name: 'Open code, shell' });
  await opener.click();
  const sheet = page.getByRole('dialog', { name: 'Code, shell' });
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('.code-sheet-language')).toHaveText('shell');
  await expect(sheet.locator('.code-sheet-code')).toHaveText(SHELL + '\n');
  // The sheet covers the reading surface even after the document scrolled.
  const covers = await page.evaluate(() => {
    const host = document.querySelector('.reader-host:not(.staging)')!.getBoundingClientRect(), scrim = document.querySelector('.code-scrim')!.getBoundingClientRect();
    return Math.abs(host.left - scrim.left) < 1 && Math.abs(host.top - scrim.top) < 1 && Math.abs(host.width - scrim.width) < 1 && Math.abs(host.height - scrim.height) < 1;
  });
  expect(covers).toBe(true);
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(opener).toBeFocused();
});

test('Copy and Open are reached with Tab and show a focus ring', async ({ page }) => {
  await openDoc(page);
  const copy = page.getByRole('button', { name: 'Copy code, shell' });
  await copy.focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Open code, shell' })).toBeFocused();
  expect(await page.getByRole('button', { name: 'Open code, shell' }).evaluate(element => getComputedStyle(element).outlineStyle)).not.toBe('none');
  await page.keyboard.press('Tab');
  await expect(page.locator('.reader-host .code-block').first().locator('pre')).toBeFocused();
});

test('Space on a focused Copy button copies and does not scroll the page', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const filler = Array.from({ length: 120 }, (_, i) => `Filler paragraph ${i + 1}.\n`).join('\n');
  await openDoc(page, ['```shell', SHELL, '```', '', filler].join('\n'));
  const host = page.locator('.reader-host:not(.staging)');
  expect(await host.evaluate(element => element.scrollHeight - element.clientHeight)).toBeGreaterThan(900);
  const copy = page.getByRole('button', { name: 'Copy code, shell' });
  await copy.focus();
  const before = await host.evaluate(element => element.scrollTop);
  await page.keyboard.press('Space');
  await expect(copy).toContainText('Copied');
  // A screen-next scroll is most of the host's height; the few pixels the reader settles by after opening are not.
  expect(Math.abs(await host.evaluate(element => element.scrollTop) - before)).toBeLessThan(await host.evaluate(element => element.clientHeight / 2));
  expect(await clipboard(page)).toBe(SHELL + '\n');
});

test('find highlights a word inside a block and Enter steps through the matches', async ({ page }) => {
  await openDoc(page);
  await page.keyboard.press('Control+f');
  await expect(page.locator('#find-query')).toBeFocused();
  await page.locator('#find-query').fill('indented');
  // One in the shell block, one in the sentence before the indented block, two in it.
  await expect(page.locator('#find-status')).toHaveText('1 of 4');
  await page.keyboard.press('Enter');
  await expect(page.locator('#find-status')).toHaveText('2 of 4');
  await expect(page.locator('mark.search-hit')).toHaveText('indented');
  await expect(page.locator('.code-block mark.search-hit')).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect(page.locator('#find-status')).toHaveText('3 of 4');
  await expect(page.locator('.code-block pre mark.search-hit')).toHaveText('indented');
  await page.keyboard.press('Enter');
  await expect(page.locator('#find-status')).toHaveText('4 of 4');
  await expect(page.locator('.code-block pre mark.search-hit')).toHaveText('indented');
  // Stepping past the last result wraps to the first, in the shell block.
  await page.keyboard.press('Enter');
  await expect(page.locator('#find-status')).toHaveText('1 of 4');
  await expect(page.locator('.code-block[data-language="shell"] pre mark.search-hit')).toHaveText('indented');
  await page.locator('#find-query').fill('lighthouse');
  await expect(page.locator('#find-status')).toHaveText('1 of 1');
  await page.keyboard.press('Enter');
  await expect(page.locator('.code-block pre mark.search-hit')).toHaveText('lighthouse');
});

test('a place inside a code block is restored there after a reload', async ({ page }) => {
  const lines = Array.from({ length: 160 }, (_, i) => `line_${i + 1} = compute(${i + 1})  # a comment that makes this line longer`);
  const source = ['# Long listing', '', 'Intro.', '', '```python', ...lines, '```', '', 'Outro.'].join('\n');
  const file = { name: 'code.md', mimeType: 'text/markdown', buffer: Buffer.from(source) };
  await openDoc(page, source);
  await page.keyboard.press('Control+g');
  await page.locator('#target').fill('100');
  await page.getByRole('button', { name: 'Go to location', exact: true }).click();
  await expect(page.locator('#position')).toContainText('Long listing');
  // The first listing line still in view, and how far the host has scrolled.
  const topLine = () => page.evaluate(() => {
    const host = document.querySelector('.reader-host:not(.staging)')!, top = host.getBoundingClientRect().top;
    const line = Array.from(host.querySelectorAll('pre [data-hmb-line]')).find(element => element.getBoundingClientRect().bottom > top + 1);
    return { scroll: host.scrollTop, text: /line_\d+/.exec(line?.textContent ?? '')?.[0] ?? '' };
  });
  const before = await topLine();
  expect(before.scroll).toBeGreaterThan(500);
  expect(before.text).toMatch(/^line_\d+$/);
  await page.waitForTimeout(800);
  await page.reload();
  await page.locator('#file-input').setInputFiles(file);
  await expect(page.locator('.code-block').first()).toBeVisible();
  await expect.poll(async () => Math.abs((await topLine()).scroll - before.scroll)).toBeLessThan(30);
  expect((await topLine()).text).toBe(before.text);
});

test('selecting across blocks and copying leaves out the label and the buttons', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openDoc(page);
  await page.evaluate(() => {
    const paragraphs = Array.from(document.querySelectorAll('.reader-host article p'));
    const first = paragraphs.find(p => p.textContent?.startsWith('Before'))!, last = paragraphs.find(p => p.textContent?.startsWith('After'))!;
    const range = document.createRange();
    range.setStart(first.firstChild!, 0); range.setEnd(last.firstChild!, 5);
    const selection = getSelection()!; selection.removeAllRanges(); selection.addRange(range);
  });
  await page.keyboard.press('ControlOrMeta+c');
  const copied = await clipboard(page);
  expect(copied).toContain('npm install');
  expect(copied).toContain('indented two');
  expect(copied).not.toContain('shell');
  expect(copied).not.toContain('Copy');
  expect(copied).not.toContain('Open');
});

for (const scheme of ['light', 'dark'] as const) {
  test(`the blocks keep their frame in the ${scheme} scheme`, async ({ page }) => {
    test.skip(!shots, 'screenshots only with CODE_SHOTS');
    await openDoc(page, markdown, scheme);
    await expect(page.locator('.reader-host .code-block').first()).toBeVisible();
    await page.screenshot({ path: `${shots}/markdown-code-${scheme}.png` });
  });
}
