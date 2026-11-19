import { test, expect, type Locator } from '@playwright/test';
import { pagedPdf } from './paged-pdf';
import { openSettings, runFromPalette } from './settings-controls';
test('compact text workflow, semantic resume, invalid replacement preserves document', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Hand it over.' })).toBeVisible();
  const text = Array.from({ length: 240 }, (_, i) => `Line ${i + 1}: A quiet place to read, beside the work in progress.`).join('\n');
  const file = { name: 'reading.txt', mimeType: 'text/plain', buffer: Buffer.from(text) };
  await page.locator('#file-input').setInputFiles(file);
  await expect(page.locator('#filename')).toHaveText('reading.txt');
  await page.keyboard.press('Control+g');
  await page.locator('#target').fill('100'); await page.getByRole('button', { name: 'Go to location', exact: true }).click();
  await expect(page.locator('#position')).toContainText('100');
  await page.waitForTimeout(800);
  await page.reload(); await page.locator('#file-input').setInputFiles(file);
  await expect(page.locator('#position')).toContainText('100');
  await page.locator('#file-input').setInputFiles({ name: 'broken.txt', mimeType: 'text/plain', buffer: Buffer.from([0xff, 0x00, 0xff]) });
  await expect(page.locator('#notice')).toContainText('encoding');
  await expect(page.locator('#filename')).toHaveText('reading.txt');
  await page.keyboard.press('Control+g'); await page.locator('#target').fill('9999'); await page.getByRole('button', { name: 'Go to location', exact: true }).click();
  await expect(page.locator('#jump-error')).not.toBeEmpty();
  await page.keyboard.press('Escape');
  await expect(page.locator('.reader-host')).toBeFocused();
});
test('Markdown uses safe content, an outline and compact accessible controls', async ({ page }) => {
  const remote: string[] = [];
  page.on('request', req => { if (!req.url().startsWith('http://127.0.0.1') && !req.url().startsWith('data:') && !req.url().startsWith('blob:')) remote.push(req.url()); });
  await page.goto('/');
  await page.locator('#file-input').setInputFiles({ name: 'notes.md', mimeType: 'text/markdown', buffer: Buffer.from('# Reading notes\n\n- [x] Keep your place\n\n| A | B |\n| --- | --- |\n| One | Two |\n\n![remote](https://example.com/tracker.png)\n\n<script>window.pwned=true</script>\n\n## Next steps\n\n' + 'A paragraph to read.\n\n'.repeat(80)) });
  await expect(page.locator('#filename')).toHaveText('notes.md');
  await expect(page.locator('.reader-host table')).toBeVisible();
  await expect(page.locator('.reader-host input[type=checkbox]')).toBeChecked();
  expect(await page.evaluate(() => (window as unknown as {pwned?: boolean}).pwned)).toBeUndefined();
  expect(remote).toEqual([]);
  await page.setViewportSize({ width: 360, height: 420 });
  await runFromPalette(page, 'Contents');
  await page.locator('#outline-list').getByRole('button', { name: 'Next steps' }).click();
  await expect(page.locator('#position')).toContainText('Next steps');
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
});
test('document headings never take over the reader\'s own elements', async ({ page }) => {
  await page.goto('/');
  // Headings named like the reader's dialogs ("Contents", "Settings", "Jump") used to become ids that
  // shadowed them, so the Contents popover would not open on a document that has a Contents heading.
  const filler = Array.from({ length: 30 }, (_, i) => `Paragraph ${i + 1}, long enough that each heading sits screens apart from the next one.`).join('\n\n');
  const markdown = ['# Contents', filler, '## Settings', filler, '## Jump', filler].join('\n\n');
  await page.locator('#file-input').setInputFiles({ name: 'guide.md', mimeType: 'text/markdown', buffer: Buffer.from(markdown) });
  await expect(page.locator('#filename')).toHaveText('guide.md');
  expect(await page.evaluate(() => ['contents', 'settings', 'jump'].filter(id => document.querySelectorAll(`[id="${id}"]`).length !== 1))).toEqual([]);
  await runFromPalette(page, 'Contents');
  await page.locator('#outline-list').getByRole('button', { name: 'Jump' }).click();
  await expect(page.locator('#position')).toContainText('Jump');
});
test('text settings live in the appearance sheet, apply to the open text and keep a readable measure', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const prose = Array.from({ length: 40 }, (_, i) => `Paragraph ${i + 1} reads beside the work in progress, long enough to wrap across a wide window several times over.`).join('\n\n');
  await page.locator('#file-input').setInputFiles({ name: 'notes.md', mimeType: 'text/markdown', buffer: Buffer.from(prose) });
  await expect(page.locator('#filename')).toHaveText('notes.md');
  const content = page.locator('.reader-text-content');
  // In a wide window prose stops at a readable measure and centres in the reading panel (beside the docked library panel) instead of spanning it.
  const box = (await content.boundingBox())!, work = (await page.locator('#workspace').boundingBox())!;
  expect(box.width).toBeLessThan(760);
  expect(Math.abs(box.x + box.width / 2 - (work.x + work.width / 2))).toBeLessThan(40);

  await page.keyboard.press('Control+k');
  await page.locator('#palette-input').fill('text size');
  await page.keyboard.press('Enter');
  const sheet = page.locator('#settings');
  // One page: no tabs, and "Text size & spacing" only moves focus to the size stepper.
  await expect(sheet.getByRole('tab')).toHaveCount(0);
  await expect(sheet.getByRole('button', { name: 'Smaller text' })).toBeFocused();
  await sheet.getByRole('button', { name: 'Larger text' }).click();
  await expect(content).toHaveCSS('font-size', '20px');
  await expect(sheet.locator('.appearance-preview')).toHaveCSS('font-size', '20px');
  await sheet.getByRole('radio', { name: 'Loose' }).click();
  await expect(content).toHaveCSS('line-height', '44px');
  await expect(sheet.locator('.appearance-preview')).toHaveCSS('line-height', '44px');
  await sheet.getByRole('radio', { name: 'Wide' }).click();
  await expect(sheet.locator('.appearance-preview')).toHaveCSS('padding-left', '40px');
  // Markdown always wraps, so the plain-text wrap choice is not offered.
  await expect(sheet.getByRole('radio', { name: 'Keep as written' })).toBeHidden();
  await page.keyboard.press('Escape');

  // Page-based documents zoom instead: one note stands in for the preview and the text rows, and the colour rows stay (a PDF or image still has a page tone to reach).
  const pageDocuments = [
    { name: 'flat.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64') },
    { name: 'paged.pdf', mimeType: 'application/pdf', buffer: pagedPdf(2) },
  ];
  for (const file of pageDocuments) {
    await page.locator('#file-input').setInputFiles(file);
    await expect(page.locator('#filename')).toHaveText(file.name);
    await openSettings(page);
    await expect(sheet.locator('.appearance-note')).toHaveText('Page tone and text settings apply to Markdown, plain text and reflowable books. PDF pages, fixed-layout books and images keep their colors and zoom instead (Ctrl + and Ctrl −).');
    await expect(sheet.locator('.appearance-preview')).toBeHidden();
    await expect(sheet.getByRole('button', { name: 'Larger text' })).toBeHidden();
    await expect(sheet.getByRole('radiogroup', { name: 'PAGE' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
  }
});
test('appearance is one page: no tabs, seven themes and ten glows named by their buttons, a status line that follows the preview, and it fits the compact window', async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 620 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  // Plain text shows every row, LINES included: the tallest the sheet gets.
  await page.locator('#file-input').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('A line of text.\n'.repeat(60)) });
  await expect(page.locator('#filename')).toHaveText('notes.txt');
  const sheet = await openSettings(page);
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('tab')).toHaveCount(0);
  const families = sheet.locator('.theme-row:not(.theme-row-glow) .theme-card'), glows = sheet.locator('.theme-row-glow .theme-card');
  await expect(families).toHaveCount(7);
  await expect(glows).toHaveCount(10);
  // Swatches carry no visible names: the button's label and title are the name.
  for (const card of [...await families.all(), ...await glows.all()]) {
    const name = await card.getAttribute('aria-label');
    expect(name).toBeTruthy();
    await expect(card).toHaveAttribute('title', name!);
    expect((await card.innerText()).trim()).toBe('');
  }
  await expect(sheet.getByRole('radio', { name: 'Orchid' })).toBeVisible();

  const hint = sheet.locator('.appearance-hint'), brief = sheet.getByRole('radio', { name: 'Brief' });
  const ring = (card: Locator) => card.locator('.theme-disc').evaluate(disc => getComputedStyle(disc).boxShadow);
  await expect(hint).toHaveText('Brief · Hover to preview, click to keep.');
  expect(await ring(brief)).toContain('3.5px');
  await sheet.getByRole('radio', { name: 'Nebula' }).hover();
  await expect(hint).toHaveText('Nebula · Click to keep, or move away for Brief.');
  // The kept ring steps aside for the swatch being previewed.
  await expect.poll(() => ring(brief)).not.toContain('3.5px');
  await page.mouse.move(10, 10);
  await expect(hint).toHaveText('Brief · Hover to preview, click to keep.');
  await expect.poll(() => ring(brief)).toContain('3.5px');

  // A glow theme has one mode: the mode control is disabled, and the line says so.
  await sheet.getByRole('radio', { name: 'Aurora' }).click();
  await page.mouse.move(10, 10);
  const modes = sheet.getByRole('radiogroup', { name: 'Mode' });
  await expect(modes.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true');
  for (const mode of await modes.getByRole('radio').all()) await expect(mode).toBeDisabled();
  await expect(sheet.locator('.appearance-mode-note')).toHaveText('Glow themes have one mode.');
  await expect(hint).toHaveText('Aurora · Glow themes have one mode.');

  // Everything fits at 420 × 620: no inner scrolling, and within the window less 40 px.
  const fit = await sheet.evaluate(element => {
    const overflows = (selector: string) => { const node = element.querySelector<HTMLElement>(selector)!; return node.scrollWidth > node.clientWidth; };
    return { scrolls: element.scrollHeight > element.clientHeight, height: element.getBoundingClientRect().height, hint: overflows('.appearance-hint'), glows: overflows('.theme-row-glow'), accents: overflows('.swatches') };
  });
  expect(fit).toEqual({ scrolls: false, height: expect.any(Number), hint: false, glows: false, accents: false });
  expect(fit.height).toBeLessThanOrEqual(620 - 40);
  await expect(sheet.getByRole('radio', { name: 'Keep as written' })).toBeVisible();
});
test('a glow theme fixes the scheme, disables the mode control, and a normal family brings the mode back', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  const root = page.locator('html');
  const sheet = await openSettings(page);
  const modes = sheet.locator('.appearance-modes');
  await sheet.getByRole('radio', { name: 'Light' }).click();
  await expect(sheet.locator('.theme-row-glow .theme-card')).toHaveCount(10);
  await sheet.getByRole('radio', { name: 'Aurora' }).hover();
  await expect(root).toHaveAttribute('data-palette', 'aurora');
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await sheet.getByRole('radio', { name: 'Aurora' }).click();
  await expect(modes.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true');
  await expect(modes.getByRole('radio', { name: 'Light' })).toBeDisabled();
  await expect(sheet.locator('.appearance-mode-note')).toHaveText('Glow themes have one mode.');
  // The window is the page colour under the two glows, and the toolbar lets them through.
  expect(await root.evaluate(element => getComputedStyle(element).backgroundImage.match(/radial-gradient/g)?.length)).toBe(2);
  // (A runner whose OS asks for reduced transparency gets the opaque fallback instead, which is the next check's subject.)
  const reduced = await page.evaluate(() => matchMedia('(prefers-reduced-transparency: reduce), (prefers-contrast: more), (forced-colors: active)').matches);
  expect(await page.locator('.toolbar').evaluate(element => getComputedStyle(element).backgroundColor)).toBe(reduced ? 'rgb(7, 17, 15)' : 'rgba(0, 0, 0, 0)');
  await sheet.getByRole('radio', { name: 'Peach' }).click();
  await expect(root).toHaveAttribute('data-theme', 'light');
  await page.mouse.move(5, 5);
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(root).toHaveAttribute('data-palette', 'peach');
  await expect(root).toHaveAttribute('data-theme', 'light');
  // Back to a normal family: the earlier mode choice (Light) is restored and the control works again.
  await openSettings(page);
  await sheet.getByRole('radio', { name: 'Lilac' }).click();
  await expect(modes.getByRole('radio', { name: 'Light' })).toBeEnabled();
  await expect(modes.getByRole('radio', { name: 'Light' })).toHaveAttribute('aria-checked', 'true');
  await expect(root).toHaveAttribute('data-theme', 'light');
  await expect(sheet.locator('.appearance-mode-note')).toBeHidden();
  // With more contrast asked for, the glow is not drawn and the toolbar is the opaque page colour.
  await sheet.getByRole('radio', { name: 'Aurora' }).click();
  await page.emulateMedia({ contrast: 'more' });
  expect(await root.evaluate(element => getComputedStyle(element).getPropertyValue('--grad-a'))).toBe('transparent');
  expect(await page.locator('.toolbar').evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(7, 17, 15)');
});
test('appearance previews on hover, keeps on click, restores on Escape and persists', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  const root = page.locator('html');
  await expect(root).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(root).toHaveAttribute('data-theme', 'dark');
  const sheet = await openSettings(page);
  await sheet.getByRole('radio', { name: 'Arctic' }).hover();
  await expect(root).toHaveAttribute('data-palette', 'arctic');
  await page.keyboard.press('Escape');
  await expect(root).toHaveAttribute('data-palette', 'brief');
  await expect(sheet).toBeVisible();
  await sheet.getByRole('radio', { name: 'Birch' }).click();
  await sheet.getByRole('radio', { name: 'Light' }).click();
  await sheet.getByRole('radio', { name: 'Sepia' }).click();
  await page.mouse.move(10, 10);
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await page.reload();
  await expect(root).toHaveAttribute('data-palette', 'birch');
  await expect(root).toHaveAttribute('data-theme', 'light');
  await expect(root).toHaveAttribute('data-page', 'sepia');
});
