import { test, expect, type Page } from '@playwright/test';
import { chapterBook } from './epub-book';

const footer = (page: Page) => page.locator('#position');
const percent = async (page: Page) => Number(/(\d+(?:\.\d+)?)%/.exec(await footer(page).innerText())![1]);
async function settledPercent(page: Page) {
  let last = -1;
  await expect.poll(async () => { const now = await percent(page), same = now === last; last = now; return same; }).toBe(true);
  return last;
}
async function goToPercent(page: Page, value: number) {
  await page.keyboard.press('Control+g');
  await page.locator('#target').fill(`${value}%`);
  await page.getByRole('button', { name: 'Go to location', exact: true }).click();
}

/** A reference book of `chapters` spine items, each opening with a code listing, in a 1080 × 760 window and in Scroll. */
async function openInScroll(page: Page, chapters: number) {
  await page.setViewportSize({ width: 1080, height: 760 });
  await page.goto('/');
  await page.locator('#file-input').setInputFiles({ name: 'large.epub', mimeType: 'application/epub+zip', buffer: await chapterBook({ chapters, paragraphs: 3, code: true }) });
  await expect(footer(page)).toContainText('%');
  await expect(page.locator('#view-controls')).toBeVisible();
  await expect(page.locator('.reader-host.staging')).toHaveCount(0);
  await page.locator('.reader-host:not(.staging):not(.tab-hidden)').focus();
  await page.locator('#flow-scroll').click();
  await expect(page.locator('#flow-scroll')).toHaveAttribute('aria-pressed', 'true');
}

test('jumping about a large Scroll book with code listings raises no page error', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(`${error.message}\n${error.stack ?? ''}`));
  await openInScroll(page, 320);

  await goToPercent(page, 90);
  await expect.poll(() => settledPercent(page)).toBeGreaterThan(85);
  await goToPercent(page, 10);
  await expect.poll(() => settledPercent(page)).toBeLessThan(15);
  await page.waitForTimeout(1500); // Foliate repaints and the ink pass run a frame or more after the jump.
  expect(errors).toEqual([]);
});

for (const flow of ['scroll', 'pages'] as const) {
  test(`a frame with a root but no body is not laid out again in ${flow}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(`${error.message}\n${error.stack ?? ''}`));
    await openInScroll(page, 40);
    if (flow === 'pages') {
      await page.locator('#flow-pages').click();
      await expect(page.locator('#flow-pages')).toHaveAttribute('aria-pressed', 'true');
    }
    await goToPercent(page, 50);
    await expect.poll(() => settledPercent(page)).toBeGreaterThan(45);

    // Foliate lays the section on show out again whenever margin, gap or size change (Paginator.render, also from its ResizeObserver); a frame between
    // two navigations or being torn down can have a documentElement and no body then, and setStylesImportant(doc.body, ...) destructures null.
    await page.evaluate(() => {
      const renderer = (document.querySelector('.reader-host:not(.staging):not(.tab-hidden) foliate-view') as unknown as { renderer: HTMLElement & { getContents(): { doc: Document }[] } }).renderer;
      const doc = renderer.getContents()[0].doc;
      if (!doc.documentElement) throw new Error('the frame has no root');
      doc.body.remove();
      renderer.setAttribute('margin', '41px');
    });
    await page.waitForTimeout(300);
    expect(errors).toEqual([]);
  });
}
