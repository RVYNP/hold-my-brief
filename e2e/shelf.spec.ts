import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { addMenuItem, chooseFromViewMenu } from './library-controls';

/**
 * The reference shelf: EPUB titles and covers read from the files themselves, generated covers for what has no
 * picture, and a collection with sub-collections shown as shelves. Uses the real guides in ~/Books/reference-docs
 * and Pride and Prejudice (an EPUB that has a cover image); skipped where they are not on the machine.
 */
const guides = join(homedir(), 'Books', 'reference-docs');
const languages = ['Rust-Book-1.99.epub', 'Cargo-Book-1.99.epub', 'Python-3.13-Library-Reference.epub'].map(name => join(guides, '1-languages', name));
const creative = ['Photoshop-UXP-Docs-2026-10-29.epub', 'ComfyUI-Docs-2026-11-03.epub'].map(name => join(guides, '2-creative-apps', name));
const pride = '/tmp/hmb-media/prideandprejudice.epub';
const present = [...languages, ...creative, pride].every(path => existsSync(path));
test.skip(!present, 'needs ~/Books/reference-docs and /tmp/hmb-media/prideandprejudice.epub');

async function addFiles(page: Page, files: string[]) {
  const item = await addMenuItem(page, 'Add local documents or images');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), item.click()]);
  await chooser.setFiles(files);
}
/** Files whose covers are generated open the intake sheet; keeping everything closes it. */
async function keepAll(page: Page) {
  await page.getByRole('button', { name: 'Keep all' }).click();
  await expect(page.locator('.library-dialog')).toHaveCount(0);
}
async function newCollection(page: Page, name: string, parent?: string) {
  await page.getByRole('button', { name: 'New personal collection' }).click();
  await page.getByLabel('Collection name').fill(name);
  if (parent) await page.getByLabel('Parent collection').selectOption({ label: parent }); // option labels are display names, like the rail
  await page.getByRole('button', { name: 'Create collection' }).click();
  await expect(page.locator('.library-dialog')).toHaveCount(0);
}

async function buildShelves(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open library board' }).click();
  await expect(page.locator('#library-root')).toHaveClass(/is-board/);
  await newCollection(page, 'reference');
  await newCollection(page, '1-languages', 'Reference');
  await addFiles(page, languages);
  await keepAll(page);
  await expect(page.locator('.library-tile')).toHaveCount(languages.length);
  await newCollection(page, '2-creative-apps', 'Reference');
  await addFiles(page, creative);
  await keepAll(page);
  await expect(page.locator('.library-tile')).toHaveCount(creative.length);
  await page.locator('.library-filter', { hasText: /^Reference/ }).click();
  await addFiles(page, [pride]);
  await expect(page.locator('.library-tile')).toHaveCount(languages.length + creative.length + 1);
}

test('EPUB tiles show their real title, the version in the file name and no border; a cover image becomes the picture', async ({ page }) => {
  await buildShelves(page);
  const tile = (name: string) => page.locator('.library-tile', { has: page.locator('.library-cover-title', { hasText: name }) });
  await expect(tile('The Rust Programming Language')).toHaveCount(1);
  await expect(tile('The Cargo Book')).toHaveCount(1);
  await expect(tile('Python 3.13 Library Reference')).toHaveCount(1);
  await expect(tile('UXP for Adobe Photoshop')).toHaveCount(1);
  await expect(tile('The Rust Programming Language').locator('.library-cover-meta')).toHaveText('EPUB1.99');
  await expect(tile('UXP for Adobe Photoshop').locator('.library-cover-meta')).toHaveText('EPUB2026-10-29');
  await expect(tile('ComfyUI Documentation').locator('.library-cover-meta')).toHaveText('EPUB2026-11-03');
  // A generated cover is borderless, 3:4, and its art is drawn unsmoothed.
  const cover = tile('The Rust Programming Language').locator('.library-cover');
  expect(await cover.evaluate(node => { const style = getComputedStyle(node); return [style.borderTopWidth, style.outlineStyle, getComputedStyle(node.parentElement!).boxShadow]; })).toEqual(['0px', 'none', 'none']);
  const box = (await tile('The Rust Programming Language').locator('.library-tile-media').boundingBox())!;
  expect(box.height / box.width).toBeCloseTo(4 / 3, 1);
  expect(await cover.locator('.library-cover-art').evaluate(node => getComputedStyle(node).imageRendering)).toBe('pixelated');
  // Pride and Prejudice has a cover image: it is the thumbnail, and no generated cover is drawn over it.
  const prideTile = page.locator('.library-tile', { has: page.locator('[data-format=epub] .library-tile-name', { hasText: 'Pride and Prejudice' }) });
  await expect(prideTile.locator('.library-tile-media.is-loaded')).toHaveCount(1);
  await expect(prideTile.locator('.library-tile-media > img')).toHaveJSProperty('complete', true);
  expect(await prideTile.locator('.library-tile-media > img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(100);
  await expect(prideTile.locator('.library-cover')).toBeHidden();
  const picture = (await prideTile.locator('.library-tile-media').boundingBox())!;
  expect(picture.height / picture.width).toBeCloseTo(2304 / 1482, 1);
  // The detail strip names the book and keeps the file name in small mono type.
  await tile('The Rust Programming Language').locator('.library-document-open').click();
  await expect(page.locator('.library-detail-name')).toHaveText('The Rust Programming Language');
  await expect(page.locator('.library-detail-file')).toHaveText('Rust-Book-1.99.epub');
  await expect(page.locator('.library-detail-creator')).toContainText('Steve Klabnik');
  expect(await page.locator('.library-detail-file').evaluate(node => getComputedStyle(node).fontFamily)).toContain('JetBrains Mono');
});

test('a collection with sub-collections shows its own documents first, then one headed shelf per child in name order; filters apply inside each shelf', async ({ page }) => {
  await buildShelves(page);
  const heads = page.locator('.library-shelf-head');
  // What sits directly in Reference needs no header (the scope row names it); each child collection gets one.
  await expect(heads).toHaveCount(2);
  await expect(heads.locator('.library-shelf-name')).toHaveText(['Languages', 'Creative apps']);
  await expect(heads.locator('.library-shelf-count')).toHaveText(['3', '2']);
  // The rail and the scope row show display names; the stored names are untouched.
  await expect(page.locator('.library-board-rail .library-filter-name')).toContainText(['Reference', 'Languages', 'Creative apps']);
  await expect(page.locator('.library-scope-label')).toHaveText('Reference');
  await expect(page.getByRole('button', { name: '1-languages', exact: true })).toHaveCount(0);
  // Headers sit above their tiles, in DOM order: shelf by shelf, so keyboard order follows.
  const order = await page.locator('.library-documents').evaluate(documents => Array.from(documents.children).filter(node => node.matches('.library-shelf-head, .library-tile')).map(node => node.matches('.library-shelf-head') ? `# ${node.querySelector('.library-shelf-name')!.textContent}` : (node as HTMLElement).dataset.docName));
  expect(order[0]).toBe('Pride and Prejudice');
  expect(order.indexOf('# Languages')).toBe(1); expect(order.indexOf('# Creative apps')).toBe(5);
  const geometry = await page.locator('.library-documents').evaluate(documents => {
    const at = (node: Element) => node.getBoundingClientRect();
    return Array.from(documents.querySelectorAll('.library-shelf-head')).map(head => ({ name: head.textContent, top: at(head).top, below: Array.from(documents.querySelectorAll(`.library-tile`)).filter(tile => at(tile).top >= at(head).bottom - 1).length }));
  });
  expect(geometry.map(item => item.top)).toEqual([...geometry.map(item => item.top)].sort((a, b) => a - b));
  const dark = await page.locator('.library-shelf-name').first().evaluate(node => getComputedStyle(node).textTransform);
  expect(dark).toBe('uppercase');
  // A shelf header is above every tile of its shelf and below every tile of the one before.
  const languagesTop = (await heads.nth(0).boundingBox())!.y, languagesTiles = await page.locator('.library-tile').evaluateAll(nodes => nodes.map(node => [(node as HTMLElement).dataset.docName, node.getBoundingClientRect().top, node.getBoundingClientRect().bottom] as const));
  const above = languagesTiles.find(([name]) => name === 'Pride and Prejudice')!; expect(above[1]).toBeLessThan(languagesTop);
  // A header is a break: more air above it than the few px between rows.
  expect(languagesTop - above[2]).toBeGreaterThanOrEqual(24);
  // Search applies inside each shelf, and shelves with nothing left hide.
  await page.locator('.library-search').fill('comfyui');
  await expect(heads.locator('.library-shelf-name')).toHaveText(['Creative apps']);
  await expect(page.locator('.library-tile')).toHaveCount(1);
  await page.locator('.library-search').fill('');
  await expect(heads).toHaveCount(2);
  // Search also finds an EPUB by the title inside it, not only by its file name.
  await page.locator('.library-search').fill('programming language');
  await expect(page.locator('.library-tile')).toHaveCount(1);
  await expect(heads.locator('.library-shelf-name')).toHaveText(['Languages']);
  await page.locator('.library-search').fill('');
  // A child collection on its own is a plain grid, no header.
  await page.locator('.library-filter', { hasText: /^Languages/ }).click();
  await expect(heads).toHaveCount(0);
  await expect(page.locator('.library-tile')).toHaveCount(3);
  // List view is unchanged: rows, no shelf headers, the title shown and the file name in the meta line.
  await page.locator('.library-filter', { hasText: /^Reference/ }).click();
  await chooseFromViewMenu(page, 'List');
  await expect(heads).toHaveCount(0);
  await expect(page.locator('.library-document')).toHaveCount(6);
  await expect(page.locator('.library-document-name', { hasText: 'The Rust Programming Language' })).toHaveCount(1);
  await expect(page.locator('.library-row-meta', { hasText: 'Rust-Book-1.99.epub' })).toHaveCount(1);
});

test('generated covers follow the colour scheme, and a shelf keeps one tint', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await buildShelves(page);
  await expect(page.locator('.library-tile-media.is-loaded')).toHaveCount(1);
  const fills = await page.locator('.library-tile-media:not(.is-loaded) .library-cover').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).backgroundColor));
  const lightness = (rgb: string) => { const [r, g, b] = rgb.match(/\d+/g)!.map(Number); return (r + g + b) / 3 / 255; };
  expect(fills.length).toBe(5);
  for (const fill of fills) expect(lightness(fill)).toBeLessThan(.4);
  const byShelf = await page.locator('.library-tile:has(.library-tile-media:not(.is-loaded) .library-cover)').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.docName + '|' + getComputedStyle(node.querySelector('.library-cover')!).backgroundColor));
  const tint = (name: string) => byShelf.find(entry => entry.startsWith(name))!.split('|')[1];
  expect(tint('The Rust Programming Language')).toBe(tint('The Cargo Book'));
  expect(tint('The Rust Programming Language')).not.toBe(tint('UXP for Adobe Photoshop'));
});

test('every cover is its own pattern, a shelf shares one tint, and ↻ re-rolls only the cover it is on', async ({ page }) => {
  await buildShelves(page);
  const covers = page.locator('.library-tile:has(.library-tile-media:not(.is-loaded) .library-cover)');
  await expect(covers).toHaveCount(5);
  const art = (name: string) => page.locator('.library-tile', { has: page.locator('.library-cover-title', { hasText: name }) }).locator('.library-cover-art');
  const sources = async () => Promise.all(['The Rust Programming Language', 'The Cargo Book', 'Python 3.13 Library Reference', 'UXP for Adobe Photoshop', 'ComfyUI Documentation'].map(name => art(name).getAttribute('src')));
  const before = await sources();
  expect(new Set(before).size).toBe(5);
  for (const source of before) expect(source).toMatch(/^data:image\/png;base64,/);
  // The ↻ is hidden until the cover is pointed at, then says what it does and for which book.
  const tile = page.locator('.library-tile', { has: page.locator('.library-cover-title', { hasText: 'The Cargo Book' }) });
  const reroll = tile.getByRole('button', { name: 'New cover pattern for The Cargo Book' });
  await expect(reroll).toHaveCSS('opacity', '0');
  await tile.hover();
  await expect(reroll).toHaveCSS('opacity', '1');
  await reroll.click();
  await expect.poll(async () => (await sources())[1]).not.toBe(before[1]);
  const after = await sources();
  expect(after.filter((source, index) => source !== before[index])).toHaveLength(1);
  // The book keeps its new pattern while the detail strip shows the very same cover.
  await tile.locator('.library-document-open').click();
  await expect(page.locator('.library-detail-preview .library-cover-art')).toHaveAttribute('src', after[1]!);
  // The item menu offers a new pattern, and Reset cover once the book has one of its own.
  await tile.hover(); await tile.getByRole('button', { name: /More actions for/ }).click();
  await expect(page.getByRole('menuitem', { name: 'Reset cover' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Reset cover' }).click();
  await expect.poll(async () => (await sources())[1]).toBe(before[1]);
  await tile.hover(); await tile.getByRole('button', { name: /More actions for/ }).click();
  await expect(page.getByRole('menuitem', { name: 'New cover pattern' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Reset cover' })).toHaveCount(0);
  // A cover that shows a real picture has nothing to re-roll.
  await page.keyboard.press('Escape');
  const prideTile = page.locator('.library-tile', { has: page.locator('[data-format=epub] .library-tile-name', { hasText: 'Pride and Prejudice' }) });
  await expect(prideTile.getByRole('button', { name: /New cover pattern/ })).toBeHidden();
});

test('Index a folder explains what it takes', async ({ page }) => {
  await page.setViewportSize({ width: 1080, height: 700 });
  await page.goto('/');
  await (await addMenuItem(page, 'Index folders and manage source locations')).click();
  // Folder indexing is desktop-only; the browser preview says so rather than offering the button.
  await expect(page.locator('.library-dialog')).toContainText('require the desktop app');
});
