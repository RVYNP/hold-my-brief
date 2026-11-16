import { test, expect, type Page } from '@playwright/test';
import { pngFixture } from './png-fixture';

// An image tab keeps the end of its name, and the image pager steps in the tab showing instead of opening a tab for every image.

const image = (name: string, width: number, shade: number) => ({ name, mimeType: 'image/png', buffer: pngFixture(width, 200, [shade, 120, 200]) });
const tabs = (page: Page) => page.locator('#tab-list .tab');
const pager = (page: Page) => page.locator('.library-image-navigation');
const step = (page: Page, direction: 'previous' | 'next') => page.getByRole('button', { name: direction === 'next' ? 'Next image in collection' : 'Previous image in collection' });
const level = (page: Page) => page.locator('#zoom-level');

test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 1080, height: 680 }); });

/** Three images in the library, in name order, none of them open yet. */
async function libraryOf(page: Page, names: string[]) {
  await page.goto('/');
  await page.locator('.library-panel input[type=file]').setInputFiles(names.map((name, index) => image(name, 300 + 20 * index, 40 * index + 20)));
  await expect(page.getByRole('treeitem', { name: names[0] })).toBeVisible();
}
/** Opens an image from the library tree. */
async function openFromLibrary(page: Page, name: string) { await page.getByRole('treeitem', { name }).click(); }

test('stepping with the pager replaces the image in the tab; an image already open in another tab is shown, not duplicated', async ({ page }) => {
  await libraryOf(page, ['plate-1.png', 'plate-2.png', 'plate-3.png']);
  await openFromLibrary(page, 'plate-1.png');
  await expect(tabs(page)).toHaveCount(1);
  await expect(pager(page)).toContainText('1 / 3');
  const forward = step(page, 'next');
  await forward.click(); await expect(pager(page)).toContainText('2 / 3');
  await forward.focus(); await page.keyboard.press('Enter');
  await expect(pager(page)).toContainText('3 / 3');
  await expect(tabs(page)).toHaveCount(1);
  await expect(tabs(page).first().locator('.tab-title')).toHaveText('plate-3.png');
  await expect(tabs(page).first().locator('.tab-format')).toHaveText('PNG');
  await expect(forward).toBeDisabled();

  // Back to the first, then open the second from the tree: a second tab. Stepping onto it from the first switches to it.
  await step(page, 'previous').click(); await step(page, 'previous').click();
  await expect(pager(page)).toContainText('1 / 3');
  await openFromLibrary(page, 'plate-2.png');
  await expect(tabs(page)).toHaveCount(2);
  await expect(tabs(page).nth(1)).toHaveClass(/is-active/);
  await tabs(page).first().click();
  await expect(pager(page)).toContainText('1 / 3');
  await step(page, 'next').click();
  await expect(tabs(page)).toHaveCount(2);
  await expect(tabs(page).nth(1)).toHaveClass(/is-active/);
  await expect(tabs(page).first().locator('.tab-title')).toHaveText('plate-1.png');
  await expect(pager(page)).toContainText('2 / 3');
});

test('the tab keeps its place in the strip when the pager steps, and the image that left keeps its own zoom', async ({ page }) => {
  await libraryOf(page, ['plate-1.png', 'plate-2.png', 'plate-3.png']);
  await openFromLibrary(page, 'plate-2.png');
  await expect(tabs(page)).toHaveCount(1);
  await openFromLibrary(page, 'plate-1.png');
  await expect(tabs(page)).toHaveCount(2);
  await expect(tabs(page).nth(1).locator('.tab-title')).toHaveText('plate-1.png');
  await page.locator('.image-reader:not(.tab-hidden)').focus(); await page.keyboard.press('Shift+Digit0');
  await expect(level(page)).toHaveText('100%');
  await page.locator('.image-reader:not(.tab-hidden)').focus(); await page.keyboard.press('Control+Equal');
  const zoomed = await level(page).textContent();
  expect(zoomed).not.toBe('100%');
  // Plate 2 is open in the first tab, so stepping onto it switches there; step on from it to plate 3 and the first tab's image is replaced.
  await step(page, 'next').click();
  await expect(tabs(page).first()).toHaveClass(/is-active/);
  await step(page, 'next').click();
  await expect(pager(page)).toContainText('3 / 3');
  await expect(tabs(page)).toHaveCount(2);
  await expect(tabs(page).first().locator('.tab-title')).toHaveText('plate-3.png');
  await expect(tabs(page).nth(1).locator('.tab-title')).toHaveText('plate-1.png');
  // Back through plate 2 to plate 1, which is open in the second tab: its zoom is as it was left.
  await step(page, 'previous').click();
  await expect(pager(page)).toContainText('2 / 3');
  await step(page, 'previous').click();
  await expect(pager(page)).toContainText('1 / 3');
  await expect(tabs(page).nth(1)).toHaveClass(/is-active/);
  await expect(level(page)).toHaveText(zoomed!);
});

test('an image\'s zoom is restored when the pager steps away from it in its tab and back', async ({ page }) => {
  await libraryOf(page, ['plate-1.png', 'plate-2.png', 'plate-3.png']);
  await openFromLibrary(page, 'plate-1.png');
  await page.locator('.image-reader:not(.tab-hidden)').focus(); await page.keyboard.press('Shift+Digit0');
  await page.locator('.image-reader:not(.tab-hidden)').focus(); await page.keyboard.press('Control+Equal');
  const zoomed = await level(page).textContent();
  expect(zoomed).not.toBe('100%');
  await step(page, 'next').click();
  await expect(pager(page)).toContainText('2 / 3');
  await expect(tabs(page)).toHaveCount(1);
  await step(page, 'previous').click();
  await expect(pager(page)).toContainText('1 / 3');
  await expect(tabs(page)).toHaveCount(1);
  await expect(level(page)).toHaveText(zoomed!);
});

test('image tabs of one series keep the end of their names, and the full name stays in the tooltip and the accessible name', async ({ page }) => {
  const names = ['Haeckel - Hexacoralla (Kunstformen der Natur).jpg', 'Haeckel - Kunstformen der Natur, plate 15.jpg'];
  await page.goto('/');
  for (const name of names) { await page.locator('#file-input').setInputFiles({ ...image(name, 300, 90), mimeType: 'image/jpeg' }); await expect(tabs(page).last()).toHaveClass(/is-active/); }
  const first = tabs(page).nth(0).locator('.tab-title'), second = tabs(page).nth(1).locator('.tab-title');
  await expect(tabs(page)).toHaveCount(2);
  await expect(first).toBeVisible(); await expect(second).toBeVisible();
  await expect(first).toHaveText(/Natur\)\.jpg$/);
  await expect(second).toHaveText(/plate 15\.jpg$/);
  await expect(first).toHaveText(/^Haeckel/); await expect(second).toHaveText(/^Haeckel/);
  expect(await first.textContent()).not.toBe(await second.textContent());
  for (const [index, name] of names.entries()) {
    await expect(tabs(page).nth(index)).toHaveAttribute('title', new RegExp(name.replace(/[.()]/g, '\\$&')));
    await expect(page.getByRole('tab', { name: new RegExp(name.replace(/[.()]/g, '\\$&')) })).toHaveCount(1);
  }
  // Neither title is wider than its box: the cut came from the measure, not from the CSS ellipsis.
  for (const title of [first, second]) expect(await title.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  // The active tab is wider (140 px, bold) and is measured again when the other one becomes active.
  const before = await first.textContent();
  await tabs(page).nth(0).click();
  await expect(tabs(page).nth(0)).toHaveClass(/is-active/);
  await expect(first).toHaveText(/Natur\)\.jpg$/);
  expect(await first.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect((await first.textContent())!.length).toBeGreaterThanOrEqual(before!.length);
});

test('a short image name, and a name of another format, are shown as they were', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles(image('plate.png', 300, 90));
  await page.locator('#file-input').setInputFiles({ name: `${'a long text file name '.repeat(4)}.txt`, mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await expect(tabs(page).nth(0).locator('.tab-title')).toHaveText('plate.png');
  const text = tabs(page).nth(1).locator('.tab-title');
  await expect(text).toHaveText(/^a long text file name a long/);
  expect(await text.textContent()).not.toContain('…');
});
