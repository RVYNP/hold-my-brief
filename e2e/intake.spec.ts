import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { libraryToggle, openBoard } from './library-controls';

/**
 * Intake: the sheet that opens when files arrive in the library, with each book's generated cover, a ↻ to re-roll it,
 * 'shelf ▾' to move the group, and 'Keep all'. Uses the real guides in ~/Books/reference-docs and Pride and Prejudice
 * (an EPUB with a cover image); skipped where they are not on the machine.
 */
const guides = join(homedir(), 'Books', 'reference-docs');
const languages = ['Rust-Book-1.99.epub', 'Cargo-Book-1.99.epub', 'Python-3.13-Library-Reference.epub', 'Nodejs-24-API.epub'].map(name => join(guides, '1-languages', name));
const creative = ['Photoshop-UXP-Docs-2026-10-29.epub', 'ComfyUI-Docs-2026-11-03.epub', 'After-Effects-Scripting-Guide-2026-09-10.epub'].map(name => join(guides, '2-creative-apps', name));
const pride = '/tmp/hmb-media/prideandprejudice.epub';
const present = [...languages, ...creative, pride].every(path => existsSync(path));
test.skip(!present, 'needs ~/Books/reference-docs and /tmp/hmb-media/prideandprejudice.epub');

async function open(page: Page) {
  await page.setViewportSize({ width: 1080, height: 700 });
  await page.goto('/');
  if (!(await page.locator('#library-root').isVisible())) await libraryToggle(page).click();
}
const dialog = (page: Page) => page.locator('.library-dialog.library-intake');
// Only covers that are showing: one under a loaded picture (Pride and Prejudice) is hidden.
const arts = (page: Page) => dialog(page).locator('.library-intake-tile .library-tile-media:not(.is-loaded) .library-cover-art');
const sources = (page: Page) => arts(page).evaluateAll(nodes => nodes.map(node => (node as HTMLImageElement).src));

test('Add files opens a sheet titled by the count, naming its source, with one generated cover per book', async ({ page }) => {
  await open(page);
  await page.locator('.library-panel input[type=file]').setInputFiles([...languages, ...creative, pride]);
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByRole('heading')).toHaveText('8 new references');
  await expect(dialog(page).locator('.library-intake-source')).toHaveText('Added files');
  // Added to no collection, so one Unfiled shelf: header with its count, then the books in the order they came.
  await expect(dialog(page).locator('.library-intake-head .library-shelf-name')).toHaveText(['Unfiled']);
  await expect(dialog(page).locator('.library-intake-head .library-shelf-count')).toHaveText(['8']);
  await expect(dialog(page).locator('.library-intake-tile')).toHaveCount(8);
  // Pride and Prejudice has a real cover image: it shows that, and has nothing to re-roll.
  await expect(dialog(page).locator('.library-tile-media.is-loaded')).toHaveCount(1);
  await expect(dialog(page).getByRole('button', { name: /New cover pattern for/ })).toHaveCount(7);
  // Covers are 3:4 and 132 px wide; every one is its own pattern.
  const box = (await dialog(page).locator('.library-intake-tile .library-cover').first().boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(120); expect(box.width).toBeLessThanOrEqual(140);
  expect(box.height / box.width).toBeCloseTo(4 / 3, 1);
  expect(new Set(await sources(page)).size).toBe(7);
  await expect(dialog(page).locator('.library-cover-title', { hasText: 'The Rust Programming Language' })).toBeVisible();
  await expect(dialog(page).locator('.library-intake-tile', { has: page.locator('.library-cover-title', { hasText: 'The Rust Programming Language' }) }).locator('.library-cover-meta')).toHaveText('EPUB1.99');
});

test('↻ re-rolls one cover and no other, with the keyboard too; New patterns re-rolls them all; Keep all and Esc just close', async ({ page }) => {
  await open(page);
  await page.locator('.library-panel input[type=file]').setInputFiles([...languages.slice(0, 3), ...creative.slice(0, 2)]);
  await expect(dialog(page)).toBeVisible();
  const first = await sources(page); expect(first).toHaveLength(5);
  const reroll = dialog(page).getByRole('button', { name: 'New cover pattern for The Cargo Book' });
  await reroll.focus();
  await expect(reroll).toHaveCSS('opacity', '1'); // shown by focus alone
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await sources(page)).filter((source, index) => source !== first[index]).length).toBe(1);
  // The same ↻ keeps focus, so Enter again rolls once more.
  await expect(reroll).toBeFocused();
  const second = await sources(page);
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await sources(page)).filter((source, index) => source !== second[index]).length).toBe(1);
  await dialog(page).getByRole('button', { name: 'New patterns' }).click();
  await expect.poll(async () => (await sources(page)).filter((source, index) => source !== second[index]).length).toBe(5);
  // The books were already in the library: Keep all only closes, and so does Escape.
  await dialog(page).getByRole('button', { name: 'Keep all' }).click();
  await expect(page.locator('.library-dialog')).toHaveCount(0);
  await expect(page.locator('.library-title-count')).toHaveText('5');
  await page.locator('.library-panel input[type=file]').setInputFiles([creative[2]]);
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByRole('heading')).toHaveText('1 new reference');
  await page.keyboard.press('Escape');
  await expect(page.locator('.library-dialog')).toHaveCount(0);
  await expect(page.locator('.library-title-count')).toHaveText('6');
});

test('a lone file with a real cover is simply added, with no sheet', async ({ page }) => {
  await open(page);
  await page.locator('.library-panel input[type=file]').setInputFiles([pride]);
  await expect(page.locator('.library-title-count')).toHaveText('1');
  await openBoard(page);
  await expect(page.locator('.library-tile-media.is-loaded')).toHaveCount(1);
  await page.waitForTimeout(600);
  await expect(page.locator('.library-dialog')).toHaveCount(0);
  // Adding it again finds nothing new either.
  await page.locator('.library-panel input[type=file]').setInputFiles([pride]);
  await page.waitForTimeout(400);
  await expect(page.locator('.library-dialog')).toHaveCount(0);
});

test('a shelf header moves its books to another collection, which then covers them', async ({ page }) => {
  await open(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: 'Open library board' }).click();
  await page.getByRole('button', { name: 'New personal collection' }).click();
  await page.getByLabel('Collection name').fill('2-creative-apps');
  await page.getByRole('button', { name: 'Create collection' }).click();
  await expect(page.locator('.library-dialog')).toHaveCount(0);
  await page.locator('.library-filter', { hasText: /^All references/ }).click();
  await page.locator('.library-panel input[type=file]').setInputFiles(creative);
  await expect(dialog(page)).toBeVisible();
  const before = await dialog(page).locator('.library-intake-tile .library-cover').first().evaluate(node => getComputedStyle(node).backgroundColor);
  await dialog(page).getByRole('button', { name: /Move the books of Unfiled to another shelf/ }).click();
  await expect(page.getByRole('menuitem')).toHaveText(['Creative apps']);
  await page.getByRole('menuitem', { name: 'Creative apps' }).click();
  await expect(dialog(page).locator('.library-intake-head .library-shelf-name')).toHaveText(['Creative apps']);
  await expect(dialog(page).locator('.library-intake-tile')).toHaveCount(3);
  expect(await dialog(page).locator('.library-intake-tile .library-cover').first().evaluate(node => getComputedStyle(node).backgroundColor)).not.toBe(before);
  await dialog(page).getByRole('button', { name: 'Keep all' }).click();
  await page.locator('.library-filter', { hasText: /^Creative apps/ }).click();
  await expect(page.locator('.library-result-count')).toHaveText('3 references');
});
