import { test, expect, type Page } from '@playwright/test';

async function openText(page: Page, name: string, mimeType: string, source: string) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.locator('#file-input').setInputFiles({ name, mimeType, buffer: Buffer.from(source) });
  await expect(page.locator('#filename')).toHaveText(name);
  await expect(page.locator('#view-controls')).toBeVisible();
}
const proseFont = (page: Page) => page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.reader-text-content')!).fontSize));
const body = Array.from({ length: 30 }, (_, index) => `Paragraph ${index + 1} of plain reflowing text.`).join('\n\n');
const zoomControls = ['zoom-out', 'zoom-level', 'zoom-in', 'hand-tool', 'view-layout', 'view-previews'];

test('a Markdown document with headings shows Contents and A− size A+, no Pages | Scroll, and none of the zoom controls', async ({ page }) => {
  await openText(page, 'guide.md', 'text/markdown', `# Guide\n\n${body}\n\n## Details\n\n${body}\n`);
  const pill = page.locator('#view-controls');
  await expect(pill.locator('#view-contents')).toBeVisible();
  await expect(pill.locator('#text-smaller')).toBeVisible();
  await expect(pill.locator('#text-larger')).toBeVisible();
  await expect(pill.locator('#text-size')).toHaveText('18');
  await expect(pill.locator('#view-flow')).toBeHidden();
  await expect(pill.locator('#flow-pages')).toBeHidden();
  await expect(pill.locator('#view-flow-sep')).toBeHidden();
  for (const id of zoomControls) await expect(pill.locator(`#${id}`)).toBeHidden();
  await expect(pill.locator('.view-sep:visible')).toHaveCount(2); // Contents | size, and size | More.
});

test('Contents opens the Markdown outline above the pill and goes to the heading', async ({ page }) => {
  await openText(page, 'guide.md', 'text/markdown', `# Guide\n\n${body}\n\n## Details\n\n${body}\n`);
  await page.locator('#view-contents').click();
  const dialog = page.locator('#contents');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.outline-entry')).toHaveText(['Guide', 'Details']);
  await dialog.locator('.outline-entry', { hasText: 'Details' }).click();
  await expect(dialog).toBeHidden();
});

test('Contents closes, focus in the reader, when another document is shown; scrolling the same one leaves it open', async ({ page }) => {
  await openText(page, 'guide.md', 'text/markdown', `# Guide\n\n${body}\n\n## Details\n\n${body}\n`);
  const dialog = page.locator('#contents');
  await page.locator('#view-contents').click();
  await expect(dialog).toBeVisible();
  await page.locator('.reader-host:not(.tab-hidden)').first().evaluate(host => { const scroller = [host, ...host.querySelectorAll('*')].find(el => el.scrollHeight > el.clientHeight + 50); scroller?.scrollBy(0, 200); });
  await page.waitForTimeout(300);
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.outline-entry')).toHaveText(['Guide', 'Details']);
  await page.locator('#file-input').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from(body) });
  await expect(page.locator('#filename')).toHaveText('notes.txt');
  await expect(dialog).toBeHidden();
  await expect(page.locator('.reader-host:focus, .reader-host:focus-within').first()).toBeAttached();
});

test('A+ and A− change the Markdown text size, within the limits of the Appearance setting', async ({ page }) => {
  await openText(page, 'guide.md', 'text/markdown', `# Guide\n\n${body}\n`);
  const size = page.locator('#text-size'), larger = page.locator('#text-larger'), smaller = page.locator('#text-smaller');
  const before = await proseFont(page);
  await larger.click();
  await expect(size).toHaveText('20');
  await expect.poll(() => proseFont(page)).toBeGreaterThan(before);
  await smaller.click(); await smaller.click();
  await expect(size).toHaveText('16');
  await expect.poll(() => proseFont(page)).toBeLessThan(before);
  for (let step = 0; step < 10; step++) if (await smaller.isEnabled()) await smaller.click();
  await expect(size).toHaveText('12');
  await expect(smaller).toBeDisabled();
  for (let step = 0; step < 20; step++) if (await larger.isEnabled()) await larger.click();
  await expect(size).toHaveText('40');
  await expect(larger).toBeDisabled();
});

test('a text file with no headings shows only A− size A+', async ({ page }) => {
  await openText(page, 'notes.txt', 'text/plain', body);
  const pill = page.locator('#view-controls');
  await expect(pill.locator('#text-smaller')).toBeVisible();
  await expect(pill.locator('#text-size')).toHaveText('18');
  await expect(pill.locator('#text-larger')).toBeVisible();
  for (const id of ['view-contents', 'view-contents-sep', 'view-flow', 'view-flow-sep', ...zoomControls]) await expect(pill.locator(`#${id}`)).toBeHidden();
  await expect(pill.locator('.view-sep:visible')).toHaveCount(1); // Size | More.
  await page.locator('#text-larger').click();
  await expect(page.locator('#text-size')).toHaveText('20');
});

test('the More menu leaves Contents to the pill for Markdown too', async ({ page }) => {
  await openText(page, 'guide.md', 'text/markdown', `# Guide\n\n${body}\n`);
  await page.locator('#view-more').click();
  await expect(page.getByRole('menuitem', { name: 'Go to…' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Contents' })).toHaveCount(0);
});
