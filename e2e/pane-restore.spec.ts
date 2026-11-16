import { test, expect, type Page } from '@playwright/test';
import { chapterBook } from './epub-book';
import { pagedPdf } from './paged-pdf';

async function goTo(page: Page, target: string) {
  await page.keyboard.press('Control+g'); await page.locator('#target').fill(target);
  await page.getByRole('button', { name: 'Go to location', exact: true }).click();
}
/** The save is debounced; the browser build writes it to localStorage under the document's id. */
async function stored(page: Page) {
  return page.evaluate(() => Object.entries(localStorage)
    .filter(([key, text]) => key.startsWith('hold-my-brief:') && text.includes('"locator"'))
    .map(([, text]) => JSON.parse(text))[0] as { locator: { page?: number; cfi?: string }; options: { fit?: string; fitted?: boolean } } | undefined);
}

test('a PDF read to page 4 at fit width reopens on page 4', async ({ page }) => {
  const file = { name: 'eight.pdf', mimeType: 'application/pdf', buffer: pagedPdf(8) };
  await page.goto('/');
  await page.locator('#file-input').setInputFiles(file);
  await expect(page.locator('#position')).toContainText('Page 1 of 8');
  await page.keyboard.press('Control+2');
  await expect(page.locator('#zoom-level')).toHaveAttribute('data-fit', 'width');
  await goTo(page, '4');
  await expect(page.locator('#position')).toContainText('Page 4 of 8');
  await expect.poll(async () => { const s = await stored(page); return [s?.locator.page, s?.options.fit, s?.options.fitted]; }).toEqual([4, 'width', true]);
  await page.reload();
  await page.locator('#file-input').setInputFiles(file);
  await expect(page.locator('#position')).toContainText('Page 4 of 8');
  await expect(page.locator('#zoom-level')).toHaveAttribute('data-fit', 'width');
});

test('an EPUB read part-way in reopens at the same place', async ({ page }) => {
  const file = { name: 'chapters.epub', mimeType: 'application/epub+zip', buffer: await chapterBook({ chapters: 4, paragraphs: 40 }) };
  await page.setViewportSize({ width: 900, height: 700 });
  await page.goto('/');
  await page.locator('#file-input').setInputFiles(file);
  await expect(page.locator('#position')).toContainText('%');
  await goTo(page, '50%');
  await expect(page.locator('#jump')).toBeHidden();
  const before = await page.evaluate(() => (document.querySelector('foliate-view') as unknown as { lastLocation?: { cfi?: string } }).lastLocation?.cfi);
  expect(before).toBeTruthy();
  const label = await page.locator('#position').innerText();
  expect(label).toMatch(/4\d|5\d/);
  await expect.poll(async () => (await stored(page))?.locator.cfi).toBe(before);
  await page.reload();
  await page.locator('#file-input').setInputFiles(file);
  await expect(page.locator('#position')).toContainText('%');
  await expect(page.locator('#position')).toHaveText(label);
  const after = await page.evaluate(() => (document.querySelector('foliate-view') as unknown as { lastLocation?: { cfi?: string } }).lastLocation?.cfi);
  expect(after).toBe(before);
});
