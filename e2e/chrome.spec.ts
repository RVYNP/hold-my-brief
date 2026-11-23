import { test, expect, type Page } from '@playwright/test';
import { addMenuItem, chooseFromViewMenu, libraryPage, openLibraryTab, viewMenuButton } from './library-controls';
import { railHome } from './toolbar-tabs';

// A 1 x 1 PNG: enough for a picture-type document.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const longName = 'A very long title that runs on past two lines of a small tile so that it has to be cut with an ellipsis at the end of the second line.png';
const files = [
  { name: 'alpha.txt', mimeType: 'text/plain', buffer: Buffer.from('alpha') },
  { name: 'beta.md', mimeType: 'text/markdown', buffer: Buffer.from('# beta') },
  { name: 'gamma.png', mimeType: 'image/png', buffer: png },
  { name: longName, mimeType: 'image/png', buffer: png },
];

async function addFiles(page: Page) {
  const item = await addMenuItem(page, 'Add local documents or images');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), item.click()]);
  await chooser.setFiles(files);
  // Text and Markdown get generated covers, so the intake sheet always opens; keep everything.
  await page.getByRole('button', { name: 'Keep all' }).click();
  await expect(page.locator('.library-dialog')).toHaveCount(0);
}
const names = (page: Page) => page.locator('.library-document-open .library-document-name').allTextContents();

test('the library panel is a one-line header over the tree; the Library tab has the chips, search and sort rows', async ({ page }) => {
  await page.setViewportSize({ width: 1080, height: 680 });
  await page.goto('/');
  await expect(page.locator('.library-header h2')).toContainText('Library');
  // The old drawer chrome is gone, not hidden: the scope popover, the search button, the dock button, the cover rail.
  for (const gone of ['.library-tools', '.library-sort', '.library-add', '.library-panel > select', '.library-search-toggle', '.library-dock', '.library-rail-cover', '.library-header-glyph', '.library-filter-toggle', '.library-board-toggle', '.library-new-collection', '.icon-rail-menu']) await expect(page.locator(gone)).toHaveCount(0);
  await addFiles(page);
  const panel = page.locator('.library-panel');
  const y = async (selector: string) => (await page.locator(selector).first().boundingBox())!;
  const header = await y('.library-header'), tree = await y('.library-tree');
  expect(header.height).toBeLessThan(36);
  expect(header.y + header.height).toBeLessThanOrEqual(tree.y + 1);
  expect(tree.y - (await panel.boundingBox())!.y).toBeLessThan(80);
  expect(await panel.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  // The header is the title (the button that opens the Library tab) and the count, and the filter field is always under it; + (add files) is the compact window's, and the icon rail has Add files.
  await expect(page.locator('.library-header button:visible')).toHaveText(['Library']);
  await expect(page.getByRole('searchbox', { name: 'Filter the library' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add files or manage sources' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Close library' }).first()).toBeHidden();
  await page.locator('#library-rail').getByRole('button', { name: 'Add files', exact: true }).click();
  await expect(page.getByRole('menuitem')).toHaveText(['Open file…', 'Add files…', 'Sources…']);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menuitem', { name: 'Add local documents or images' })).toBeHidden();

  // The Library tab: its own header row (scope, count, chips), a search and sort row, then the documents, one line each. The panel's header stays one line.
  await openLibraryTab(page);
  const tab = { header: await y('.library-header'), chips: await y('.library-scope'), bar: await y('.library-searchbar'), list: await y('.library-documents') };
  expect(tab.header.height).toBeLessThan(36);
  expect(tab.chips.height).toBeLessThan(36); expect(tab.bar.height).toBeLessThan(34);
  expect(tab.chips.y + tab.chips.height).toBeLessThanOrEqual(tab.bar.y + 1); expect(tab.bar.y + tab.bar.height).toBeLessThanOrEqual(tab.list.y + 4);
  await expect(page.getByRole('button', { name: 'Add files or manage sources' })).toBeHidden();
});

test('the Library tab\'s file-type chips filter, one at a time, for the types the library holds', async ({ page }) => {
  await page.setViewportSize({ width: 1080, height: 680 });
  await page.goto('/');
  await openLibraryTab(page);
  await expect(page.locator('.library-type-chip')).toHaveCount(0);
  await railHome(page).click();
  await addFiles(page);
  await openLibraryTab(page);
  const chips = page.locator('.library-type-chip');
  await expect(chips).toHaveText(['Markdown', 'Text', 'Images']);
  await expect(page.locator('.library-scope-label')).toHaveText('All documents');

  const count = page.locator('.library-result-count');
  await expect(count).toHaveText('4 references');
  await chips.filter({ hasText: 'Text' }).click();
  await expect(count).toHaveText('1 reference');
  await expect(chips.filter({ hasText: 'Text' })).toHaveAttribute('aria-pressed', 'true');
  await chips.filter({ hasText: 'Images' }).click(); // One at a time.
  await expect(count).toHaveText('2 references');
  await expect(chips.filter({ hasText: 'Text' })).toHaveAttribute('aria-pressed', 'false');
  await chips.filter({ hasText: 'Images' }).click(); // Again to clear.
  await expect(count).toHaveText('4 references');
});

test('the Library tab\'s search field is always there and Escape leaves it open; Ctrl+B still opens and closes the panel', async ({ page }) => {
  await page.setViewportSize({ width: 1080, height: 680 });
  await page.goto('/');
  await addFiles(page);
  await openLibraryTab(page);
  const field = page.locator('.library-search');
  await expect(field).toBeVisible();
  await field.fill('alpha');
  await expect(page.locator('.library-result-count')).toHaveText('1 reference');
  await field.fill('');
  await expect(page.locator('.library-result-count')).toHaveText('4 references');
  await page.keyboard.press('Escape');
  await expect(libraryPage(page)).toBeVisible();
  await expect(page.locator('#library-root')).toBeVisible();
  // Ctrl+B closes and opens the panel from the page, and focus lands on the tree.
  await page.locator('#workspace').click({ position: { x: 600, y: 300 } });
  await page.keyboard.press('Control+b'); await expect(page.locator('#library-root')).toBeHidden();
  await page.keyboard.press('Control+b');
  await expect(page.locator('#library-root .tree-row[tabindex="0"]')).toBeFocused();
  // Escape closes it, and focus returns to its icon.
  await page.keyboard.press('Escape');
  await expect(page.locator('#library-root')).toBeHidden();
  await expect(page.locator('#library-rail').getByRole('button', { name: 'Library', exact: true })).toBeFocused();
});

test('Recent ☰ is one menu for sort and availability, beside the List and Grid buttons, with a Size slider for the grid that is remembered per scope', async ({ page }) => {
  await page.setViewportSize({ width: 1080, height: 680 });
  await page.goto('/');
  await addFiles(page);
  await openLibraryTab(page);
  const button = viewMenuButton(page), menu = page.locator('.library-view-menu');
  await expect(button).toContainText('Recent');
  await button.click();
  await expect(menu.getByRole('group')).toHaveCount(2);
  await expect(menu.getByRole('group', { name: 'Sort by' }).getByRole('menuitemradio')).toHaveText(['Recent', 'Name A–Z']);
  await expect(menu.getByRole('group', { name: 'Show' }).getByRole('menuitemradio')).toHaveText(['Any availability', 'Ready', 'Missing']);
  await expect(page.getByRole('button', { name: 'Grid view' })).toHaveAttribute('aria-pressed', 'true'); // Half of the library has pictures: the page opens on the grid.
  await expect(page.getByRole('button', { name: 'List view' })).toHaveAttribute('aria-pressed', 'false');
  await expect(menu.getByLabel('Tile size')).toBeVisible();
  await page.keyboard.press('Escape');

  await chooseFromViewMenu(page, 'List');
  await expect(page.locator('.library-documents')).toHaveClass(/library-list/);
  await chooseFromViewMenu(page, 'Name A–Z');
  await expect(button).toContainText('Name A–Z');
  expect(await names(page)).toEqual([...(await names(page))].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true })));
  await chooseFromViewMenu(page, 'Ready');
  await expect(page.locator('.library-result-count')).toHaveText('4 references');
  await chooseFromViewMenu(page, 'Missing');
  await expect(page.locator('.library-result-count')).toHaveText('0 references');
  await chooseFromViewMenu(page, 'Any availability');

  // Grid: tiles with their titles under them, and the Size slider sets the minimum tile width.
  await chooseFromViewMenu(page, 'Grid');
  await expect(page.locator('.library-documents .library-tile')).toHaveCount(4);
  const tileWidth = async () => Math.round((await page.locator('.library-documents .library-tile').first().boundingBox())!.width);
  const before = await tileWidth();
  expect(before).toBeGreaterThanOrEqual(150); // the page's own minimum
  await button.click();
  const size = menu.getByLabel('Tile size');
  await expect(size).toBeVisible();
  await size.fill('90');
  await expect.poll(tileWidth).toBeLessThan(before - 20);
  await page.keyboard.press('Escape');
  await page.reload();
  await openLibraryTab(page);
  await expect(page.locator('.library-documents .library-tile')).toHaveCount(4);
  await expect.poll(tileWidth).toBeLessThan(before - 20);
  // It is kept for this scope only: Favorites has no saved size and no saved view.
  expect(await page.evaluate(() => Object.keys(localStorage).filter(key => key.includes('library-tile-size')))).toEqual(['hold-my-brief:library-tile-size:all']);
});

test('list rows carry a 32 x 43 cover and grid tiles their title, two lines at most', async ({ page }) => {
  await page.setViewportSize({ width: 1080, height: 680 });
  await page.goto('/');
  await addFiles(page);
  await openLibraryTab(page);
  await chooseFromViewMenu(page, 'List');
  const media = page.locator('.library-list .library-document-open .library-tile-media');
  await expect(media).toHaveCount(4);
  const box = (await media.first().boundingBox())!;
  expect([Math.round(box.width), Math.round(box.height)]).toEqual([32, 43]);
  await expect(page.locator('.library-document-name').filter({ hasText: 'alpha.txt' })).toBeVisible();
  await expect(page.locator('.library-row-meta').filter({ hasText: 'TXT' }).first()).toBeVisible();

  await chooseFromViewMenu(page, 'Grid');
  const captions = page.locator('.library-tile-caption');
  // A title goes under pictures only. A generated cover (text, Markdown) prints its own, so its tile has no caption.
  await expect(captions).toHaveCount(2);
  await expect(page.locator('.library-tile[data-doc-name="alpha.txt"], .library-tile[data-doc-name="beta.md"]')).toHaveCount(2);
  await expect(page.locator('.library-tile[data-doc-name="alpha.txt"] .library-tile-caption, .library-tile[data-doc-name="beta.md"] .library-tile-caption')).toHaveCount(0);
  await expect(captions.filter({ hasText: 'gamma.png' })).toBeVisible();
  const long = captions.filter({ hasText: 'A very long title' });
  // Two lines then an ellipsis: the clamp and the clipped box are what cut it; the full title stays the accessible text.
  expect(await long.evaluate(el => ({ clamp: getComputedStyle(el).webkitLineClamp, overflow: getComputedStyle(el).overflow, whiteSpace: getComputedStyle(el).whiteSpace, height: el.clientHeight, text: el.textContent }))).toEqual({ clamp: '2', overflow: 'hidden', whiteSpace: 'normal', height: 34, text: longName });
  // It wraps inside its tile instead of running past the edge on one line.
  expect(await long.evaluate(el => { const tile = el.closest('.library-tile')!.getBoundingClientRect(), box = el.getBoundingClientRect(); return el.scrollWidth <= el.clientWidth && box.left >= tile.left - 1 && box.right <= tile.right + 1; })).toBe(true);
  // The caption sits under its picture, inside the tile.
  const geometry = await long.evaluate(el => { const tile = el.closest('.library-tile')!.getBoundingClientRect(), picture = el.parentElement!.querySelector('.library-tile-media')!.getBoundingClientRect(), caption = el.getBoundingClientRect(); return { below: caption.top >= picture.bottom - 1, inside: caption.bottom <= tile.bottom + 1 }; });
  expect(geometry).toEqual({ below: true, inside: true });
  // Neighbouring tiles never overlap, whatever mix of captioned and plain tiles sits in a column.
  expect(await page.evaluate(() => { const boxes = Array.from(document.querySelectorAll('.library-documents .library-tile')).map(tile => tile.getBoundingClientRect()); return boxes.every((a, i) => boxes.every((b, j) => i === j || a.right <= b.left + 1 || b.right <= a.left + 1 || a.bottom <= b.top + 1 || b.bottom <= a.top + 1)); })).toBe(true);
  await page.locator('.library-document-open').filter({ hasText: /gamma/ }).first().hover();
  await expect(page.locator('.library-tile-scrim').first()).toBeHidden();
});
