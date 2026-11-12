import { test, expect, type Page } from '@playwright/test';
import { addMenuItem, chooseFromViewMenu, openSearch, viewMenuButton } from './library-controls';

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

test('the drawer has three rows of chrome: header, chips, search and sort', async ({ page }) => {
  await page.setViewportSize({ width: 1080, height: 680 });
  await page.goto('/');
  const panel = page.locator('.library-panel');
  await expect(page.locator('.library-header h2')).toHaveText('Library');
  // The old controls are gone, not hidden.
  for (const gone of ['.library-tools', '.library-sort', '.library-view-toggle', '.library-add', '.library-panel > select', '.library-facets select[aria-label="Filter by format"]']) await expect(page.locator(gone)).toHaveCount(0);
  await addFiles(page);
  const y = async (selector: string) => (await page.locator(selector).first().boundingBox())!;
  const header = await y('.library-header'), chips = await y('.library-scope'), bar = await y('.library-searchbar'), list = await y('.library-documents');
  // One line each, in order, and the documents start close under them.
  expect(header.height).toBeLessThan(36); expect(chips.height).toBeLessThan(32); expect(bar.height).toBeLessThan(34);
  expect(header.y + header.height).toBeLessThanOrEqual(chips.y + 1); expect(chips.y + chips.height).toBeLessThanOrEqual(bar.y + 1); expect(bar.y + bar.height).toBeLessThanOrEqual(list.y + 4);
  expect(list.y - (await panel.boundingBox())!.y).toBeLessThan(120);
  expect(await panel.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect(await page.locator('.library-scope').evaluate(el => el.scrollWidth <= el.clientWidth || getComputedStyle(el).overflowX === 'auto')).toBe(true);
  // The header carries + (add files, sources) and → (the board).
  await expect(page.getByRole('button', { name: 'Open library board' })).toBeVisible();
  await page.getByRole('button', { name: 'Add files or manage sources' }).click();
  await expect(page.getByRole('menuitem')).toHaveText(['Add files…', 'Sources…']);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menuitem', { name: 'Add local documents or images' })).toBeHidden();
});

test('the scope chip opens the collection menu and the file-type chips filter, one at a time, for the types the library holds', async ({ page }) => {
  await page.setViewportSize({ width: 1080, height: 680 });
  await page.goto('/');
  await expect(page.locator('.library-type-chip')).toHaveCount(0);
  await addFiles(page);
  const chips = page.locator('.library-type-chip');
  await expect(chips).toHaveText(['Markdown', 'Text', 'Images']);
  await expect(page.locator('.library-scope-label')).toHaveText('All references');
  await page.getByRole('button', { name: /Choose collection and filters/ }).click();
  await expect(page.locator('#library-scope-menu')).toBeVisible();
  await expect(page.locator('.library-filter-name').first()).toHaveText('All references');
  await page.keyboard.press('Escape');
  await expect(page.locator('#library-scope-menu')).toBeHidden();

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

test('the search field is a button until used, Escape clears then folds it, and an empty blur folds it', async ({ page }) => {
  await page.setViewportSize({ width: 1080, height: 680 });
  await page.goto('/');
  await addFiles(page);
  const field = page.locator('.library-search'), toggle = page.getByRole('button', { name: 'Show search' });
  await page.locator('#workspace').click({ position: { x: 600, y: 300 } });
  await expect(field).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(field).toBeFocused();
  await field.fill('alpha');
  await expect(page.locator('.library-result-count')).toHaveText('1 reference');
  await page.keyboard.press('Escape'); // Clears the text, keeps the field.
  await expect(field).toHaveValue('');
  await expect(field).toBeVisible();
  await page.keyboard.press('Escape'); // Nothing typed: folds into its button.
  await expect(field).toBeHidden();
  await expect(toggle).toBeFocused();
  await expect(page.locator('#library-root')).toBeVisible();
  await toggle.click();
  await field.fill('beta');
  await page.locator('.library-header h2').click(); // Typed text keeps the field open on blur.
  await expect(field).toBeVisible();
  await field.fill('');
  await page.locator('.library-header h2').click();
  await expect(field).toBeHidden();
  // Ctrl+B, which used to focus the search, still lands in it.
  await page.locator('#workspace').click({ position: { x: 600, y: 300 } });
  await page.keyboard.press('Control+b'); await expect(page.locator('#library-root')).toBeHidden();
  await page.keyboard.press('Control+b');
  await expect(field).toBeFocused();
  // Opened with the drawer, the field is not yet the user's: Escape closes the drawer as it always has.
  await page.keyboard.press('Escape');
  await expect(page.locator('#library-root')).toBeHidden();
});

test('Recent ☰ is one menu for sort, view and availability, with a Size slider for the grid that is remembered per scope', async ({ page }) => {
  await page.setViewportSize({ width: 1080, height: 680 });
  await page.goto('/');
  await addFiles(page);
  const button = viewMenuButton(page), menu = page.locator('.library-view-menu');
  await expect(button).toContainText('Recent');
  await button.click();
  await expect(menu.getByRole('group')).toHaveCount(3);
  await expect(menu.getByRole('group', { name: 'Sort by' }).getByRole('menuitemradio')).toHaveText(['Recent', 'Name A–Z']);
  await expect(menu.getByRole('group', { name: 'View as' }).getByRole('menuitemradio')).toHaveText(['List', 'Grid']);
  await expect(menu.getByRole('group', { name: 'Show' }).getByRole('menuitemradio')).toHaveText(['Any availability', 'Ready', 'Missing']);
  await expect(menu.getByRole('menuitemradio', { name: 'List', exact: true })).toHaveAttribute('aria-checked', 'true'); // A drawer under 400 px opens on list.
  await expect(menu.getByLabel('Tile size')).toBeHidden(); // Only the grid has a size.
  await page.keyboard.press('Escape');

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
  // A 440 px drawer for the grid, so the column counts have margin on both sides whatever the scrollbar gutter or fonts of the machine:
  // the content box is about 405-430 px (the panel's padding, and a scrollbar gutter on some systems), which holds 3 tiles of 120 px (3.3-3.5 columns' worth) and 4 of 90 px (4.4-4.6).
  await page.evaluate(() => localStorage.setItem('hold-my-brief:library-width', '440'));
  await page.reload();
  await expect(page.locator('#library-root')).toBeVisible();
  await expect(page.locator('.library-documents .library-tile')).toHaveCount(4); // Not Home's tiles, which a reload shows too.
  const columns = () => page.evaluate(() => new Set(Array.from(document.querySelectorAll<HTMLElement>('.library-documents .library-tile')).map(tile => tile.dataset.column)).size);
  expect(await columns()).toBe(3);
  await button.click();
  const size = menu.getByLabel('Tile size');
  await expect(size).toBeVisible();
  await size.fill('90');
  await expect.poll(columns).toBe(4);
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.locator('.library-documents .library-tile')).toHaveCount(4);
  await expect.poll(columns).toBe(4);
  // It is kept for this scope only: Favorites has no saved size and no saved view.
  expect(await page.evaluate(() => Object.keys(localStorage).filter(key => key.includes('library-tile-size')))).toEqual(['hold-my-brief:library-tile-size:all']);
});

test('list rows carry a 32 x 43 cover and grid tiles their title, two lines at most', async ({ page }) => {
  await page.setViewportSize({ width: 1080, height: 680 });
  await page.goto('/');
  await addFiles(page);
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
