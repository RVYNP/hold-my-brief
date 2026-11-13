import { test, expect } from '@playwright/test';
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
  await page.getByRole('button', { name: 'Reader menu' }).click();
  await page.getByRole('button', { name: 'Contents', exact: true }).click();
  await page.locator('#outline-list').getByRole('button', { name: 'Next steps' }).click();
  await expect(page.locator('#position')).toContainText('Next steps');
  await expect(page.getByRole('button', { name: 'Pin', exact: true })).toBeVisible();
});
test('document headings never take over the reader\'s own elements', async ({ page }) => {
  await page.goto('/');
  // Headings named like the reader's dialogs ("Contents", "Menu", "Appearance") used to become ids that
  // shadowed them, so the Contents popover would not open on a document that has a Contents heading.
  const filler = Array.from({ length: 30 }, (_, i) => `Paragraph ${i + 1}, long enough that each heading sits screens apart from the next one.`).join('\n\n');
  const markdown = ['# Contents', filler, '## Menu', filler, '## Appearance', filler, '## Jump', filler].join('\n\n');
  await page.locator('#file-input').setInputFiles({ name: 'guide.md', mimeType: 'text/markdown', buffer: Buffer.from(markdown) });
  await expect(page.locator('#filename')).toHaveText('guide.md');
  expect(await page.evaluate(() => ['contents', 'menu', 'appearance', 'jump'].filter(id => document.querySelectorAll(`[id="${id}"]`).length !== 1))).toEqual([]);
  await page.getByRole('button', { name: 'Reader menu' }).click();
  await page.getByRole('button', { name: 'Contents', exact: true }).click();
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
  // In a wide window prose stops at a readable measure and centres instead of spanning the window.
  const box = (await content.boundingBox())!;
  expect(box.width).toBeLessThan(760);
  expect(Math.abs(box.x + box.width / 2 - 720)).toBeLessThan(40);

  await page.keyboard.press('Control+k');
  await page.locator('#palette-input').fill('text size');
  await page.keyboard.press('Enter');
  const sheet = page.locator('#appearance');
  await expect(sheet.getByRole('tab', { name: 'Text' })).toHaveAttribute('aria-selected', 'true');
  await sheet.getByRole('button', { name: 'Larger text' }).click();
  await expect(content).toHaveCSS('font-size', '20px');
  await sheet.getByRole('radio', { name: 'Loose' }).click();
  await expect(content).toHaveCSS('line-height', '44px');
  // Markdown always wraps, so the plain-text wrap choice is not offered.
  await expect(sheet.getByRole('radio', { name: 'Keep as written' })).toBeHidden();
  await page.keyboard.press('Escape');

  // Page-based documents zoom instead: the Text tab explains rather than offering controls that do nothing.
  await page.locator('#file-input').setInputFiles({ name: 'flat.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64') });
  await expect(page.locator('#filename')).toHaveText('flat.png');
  await page.getByRole('button', { name: 'Reader menu' }).click();
  await page.getByRole('button', { name: /Appearance and text/ }).click();
  await sheet.getByRole('tab', { name: 'Text' }).click();
  await expect(sheet.getByRole('button', { name: 'Larger text' })).toBeHidden();
  await expect(sheet.locator('.appearance-text-note')).toBeVisible();
});
test('a glow theme fixes the scheme, disables the mode control, and a normal family brings the mode back', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  const root = page.locator('html');
  await page.getByRole('button', { name: 'Reader menu' }).click();
  await page.getByRole('button', { name: /Appearance/ }).click();
  const sheet = page.locator('#appearance');
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
  await page.getByRole('button', { name: 'Reader menu' }).click();
  await page.getByRole('button', { name: /Appearance/ }).click();
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
  await page.getByRole('button', { name: 'Reader menu' }).click();
  await page.getByRole('button', { name: /Appearance/ }).click();
  const sheet = page.locator('#appearance');
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
