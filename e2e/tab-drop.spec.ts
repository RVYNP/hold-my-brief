import { test, expect, type Locator, type Page } from '@playwright/test';

const body = (name: string) => `${name}\n${Array.from({ length: 80 }, (_, i) => `${name} line ${i + 1}`).join('\n')}`;
const file = (name: string) => ({ name, mimeType: 'text/plain', buffer: Buffer.from(body(name)) });
const open = (page: Page, name: string) => page.locator('#file-input').setInputFiles(file(name));
const tab = (page: Page, name: string) => page.locator('#tab-list .tab', { hasText: name });
const titles = (page: Page) => page.locator('#tab-list .tab-title');
const shown = (page: Page, name: string) => expect(page.locator('#tab-list .tab.is-active .tab-title')).toHaveText(name);
const openAll = async (page: Page, ...names: string[]) => { for (const name of names) { await open(page, name); await shown(page, name); } };

/** A drag event carrying `names` as files, fired at the page the way the browser fires it from the desktop. */
async function drag(page: Page, type: 'dragenter' | 'dragover' | 'dragleave' | 'drop', names: string[], x: number, y: number) {
  const transfer = await page.evaluateHandle(entries => {
    const data = new DataTransfer();
    for (const entry of entries) data.items.add(new File([entry.text], entry.name, { type: 'text/plain' }));
    return data;
  }, names.map(name => ({ name, text: body(name) })));
  await page.dispatchEvent('body', type, { dataTransfer: transfer, clientX: x, clientY: y });
}
const centre = async (locator: Locator) => { const box = (await locator.boundingBox())!; return { x: box.x + box.width / 2, y: box.y + box.height / 2, box }; };
/** A point on the strip just past the right edge of tab `index`, which is the slot after it. */
const afterTab = async (page: Page, index: number) => { const box = (await page.locator('#tab-list .tab').nth(index).boundingBox())!; return { x: box.x + box.width + 1, y: box.y + box.height / 2 }; };
const READING = { x: 600, y: 400 };
/** Files added to the library without being opened. The intake sheet that offers their covers is dismissed. */
async function addToLibrary(page: Page, ...names: string[]) {
  await page.locator('.library-panel input[type=file]').setInputFiles(names.map(file));
  await expect(page.locator('.library-intake')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.library-intake')).toHaveCount(0);
}

test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 1080, height: 680 }); });

test('dropping several files opens each in a new tab, in order, after the active tab; unsupported ones get one notice', async ({ page }) => {
  await page.goto('/');
  await openAll(page, 'a.txt', 'b.txt', 'c.txt');
  await tab(page, 'a.txt').click(); await shown(page, 'a.txt');
  await drag(page, 'drop', ['x.txt', 'y.md', 'archive.zip', 'z.docx'], READING.x, READING.y);
  await expect(titles(page)).toHaveText(['a.txt', 'x.txt', 'y.md', 'b.txt', 'c.txt']);
  await shown(page, 'y.md'); // The last one dropped is the one showing.
  await expect(page.locator('#notice')).toContainText('archive.zip, z.docx');
  await expect(page.locator('#notice')).not.toContainText('one document at a time');
  await expect(page.locator('#drop-overlay')).toBeHidden();
  // Each opened for real.
  await tab(page, 'x.txt').click(); await expect(page.locator('#position')).toContainText('Line 1');
});

test('a dropped file that is already open is shown instead of opened twice, and the others still open', async ({ page }) => {
  await page.goto('/');
  await openAll(page, 'a.txt', 'b.txt');
  await drag(page, 'drop', ['a.txt', 'n.txt'], READING.x, READING.y);
  await expect(titles(page)).toHaveText(['a.txt', 'b.txt', 'n.txt']);
  await shown(page, 'n.txt');
});

test('over the strip a marker shows the slot and a ghost tab counts the files; dropping there opens them at that index', async ({ page }) => {
  await page.goto('/');
  await openAll(page, 'a.txt', 'b.txt', 'c.txt');
  const marker = page.locator('.tab-drop-marker'), ghost = page.locator('.tab-drop-ghost'), overlay = page.locator('#drop-overlay');
  const first = await afterTab(page, 0);
  await drag(page, 'dragenter', ['p.txt', 'q.txt'], first.x, first.y);
  await drag(page, 'dragover', ['p.txt', 'q.txt'], first.x, first.y);
  await expect(marker).toBeVisible();
  await expect(ghost).toHaveText('+ 2 files');
  await expect(overlay).toBeHidden();
  const markerBox = (await marker.boundingBox())!, boundary = (await tab(page, 'a.txt').boundingBox())!;
  expect(markerBox.width).toBe(2); expect(markerBox.height).toBe(24);
  expect(Math.abs(markerBox.x - (boundary.x + boundary.width))).toBeLessThan(6); // Between the first and second tab.
  // Past the last tab the slot is the end.
  const last = await afterTab(page, 2);
  await drag(page, 'dragover', ['p.txt', 'q.txt'], last.x + 5, last.y);
  const endBox = (await marker.boundingBox())!, lastTab = (await tab(page, 'c.txt').boundingBox())!;
  expect(Math.abs(endBox.x - (lastTab.x + lastTab.width))).toBeLessThan(6);
  await drag(page, 'dragover', ['p.txt', 'q.txt'], first.x, first.y);
  await drag(page, 'drop', ['p.txt', 'q.txt'], first.x, first.y);
  await expect(titles(page)).toHaveText(['a.txt', 'p.txt', 'q.txt', 'b.txt', 'c.txt']);
  await expect(marker).toBeHidden();
  // At the very front too.
  const front = (await tab(page, 'a.txt').boundingBox())!;
  await drag(page, 'drop', ['f.txt'], front.x + 2, front.y + front.height / 2);
  await expect(titles(page)).toHaveText(['f.txt', 'a.txt', 'p.txt', 'q.txt', 'b.txt', 'c.txt']);
});

test('over the reading area an overlay invites the drop, and it goes when the drag leaves', async ({ page }) => {
  await page.goto('/');
  await openAll(page, 'a.txt');
  const overlay = page.locator('#drop-overlay');
  await drag(page, 'dragenter', ['one.txt', 'two.txt'], READING.x, READING.y);
  await expect(overlay).toBeVisible();
  await expect(overlay).toContainText('Drop to open in a new tab');
  await expect(page.locator('.tab-drop-marker')).toBeHidden();
  const box = (await overlay.boundingBox())!, panel = (await page.locator('#workspace').boundingBox())!;
  expect(Math.round(box.x - panel.x)).toBe(12); expect(Math.round(box.y - panel.y)).toBe(13); // 12 px inside the panel's 1 px top border.
  await page.dispatchEvent('body', 'dragleave', { relatedTarget: null });
  await expect(overlay).toBeHidden();
});

test('a compact window has no strip, and a drop still opens its tabs after the active one', async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 620 });
  await page.goto('/');
  await open(page, 'a.txt'); await expect(page.locator('#filename')).toHaveText('a.txt');
  await open(page, 'b.txt'); await expect(page.locator('#filename')).toHaveText('b.txt');
  await page.locator('#title').click();
  await page.locator('#tab-menu').getByRole('menuitem', { name: /a\.txt/ }).click();
  await expect(page.locator('#filename')).toHaveText('a.txt');
  await drag(page, 'dragover', ['x.txt'], 200, 300);
  await expect(page.locator('#drop-overlay')).toBeVisible();
  await drag(page, 'drop', ['x.txt', 'y.txt'], 200, 300);
  await expect(page.locator('#filename')).toHaveText('y.txt');
  await expect(page.locator('#tab-count')).toHaveText('4');
  await page.locator('#title').click();
  await expect(page.locator('#tab-menu .tab-menu-row .tab-menu-title')).toHaveText(['Home', 'a.txt', 'x.txt', 'y.txt', 'b.txt', 'New tab…']);
});

test('a library row dragged onto the strip opens in a new tab at that spot, or after the tab being read; a short drag or an Escape opens nothing', async ({ page }) => {
  await page.goto('/');
  await openAll(page, 'a.txt', 'b.txt', 'c.txt');
  // Two documents that are in the library but not open.
  await addToLibrary(page, 'lib1.txt', 'lib2.txt');
  const row = (name: string) => page.locator('.library-document', { hasText: name }).locator('.library-document-open');
  await expect(row('lib1.txt')).toBeVisible();
  const from = await centre(row('lib1.txt'));
  const target = await afterTab(page, 0);
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move(from.x + 3, from.y + 1);
  await expect(page.locator('.open-drag-ghost')).toHaveCount(0); // Under the threshold it is still a click.
  await page.mouse.move(target.x, target.y, { steps: 10 });
  await expect(page.locator('.open-drag-ghost')).toHaveCount(1);
  await expect(page.locator('.tab-drop-marker')).toBeVisible();
  await expect(page.locator('.tab-drop-ghost')).toHaveText('+ 1 file');
  await page.mouse.up();
  await expect(titles(page)).toHaveText(['a.txt', 'lib1.txt', 'b.txt', 'c.txt']);
  await shown(page, 'lib1.txt');
  await expect(page.locator('.open-drag-ghost')).toHaveCount(0);
  await expect(page.locator('.tab-drop-marker')).toBeHidden();
  // Released over the reading area: after the tab being read.
  await tab(page, 'c.txt').click(); await shown(page, 'c.txt');
  const second = await centre(row('lib2.txt'));
  await page.mouse.move(second.x, second.y); await page.mouse.down();
  await page.mouse.move(READING.x, READING.y, { steps: 10 });
  await expect(page.locator('#drop-overlay')).toBeVisible();
  await page.mouse.up();
  await expect(titles(page)).toHaveText(['a.txt', 'lib1.txt', 'b.txt', 'c.txt', 'lib2.txt']);
  await expect(page.locator('#drop-overlay')).toBeHidden();
  // A drag that ends back in the library opens nothing, and Escape cancels one.
  const again = await centre(row('lib1.txt'));
  await page.mouse.move(again.x, again.y); await page.mouse.down();
  await page.mouse.move(again.x, again.y + 60, { steps: 6 });
  await page.mouse.up();
  await expect(titles(page)).toHaveCount(5);
  await shown(page, 'lib2.txt');
  await page.mouse.move(again.x, again.y); await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 6 });
  await page.keyboard.press('Escape');
  await expect(page.locator('.open-drag-ghost')).toHaveCount(0);
  await expect(page.locator('.tab-drop-marker')).toBeHidden();
  await page.mouse.up();
  await expect(titles(page)).toHaveCount(5);
});

test('a plain click on a library row, a rail cover or a Home tile still opens it in a new tab', async ({ page }) => {
  await page.goto('/');
  await openAll(page, 'a.txt');
  await addToLibrary(page, 'lib1.txt', 'lib2.txt');
  await page.locator('.library-document', { hasText: 'lib1.txt' }).locator('.library-document-open').click();
  await shown(page, 'lib1.txt');
  await expect(titles(page)).toHaveText(['a.txt', 'lib1.txt']);
  // The rail holds what has been opened: close that tab, and its cover opens it again.
  await tab(page, 'lib1.txt').locator('.tab-close').click();
  await page.locator('#library-toggle').click();
  await expect(page.locator('#library-root')).toBeHidden();
  await page.locator('#library-rail .library-rail-cover[aria-label="lib1.txt"]').click();
  await shown(page, 'lib1.txt');
  await expect(titles(page)).toHaveText(['a.txt', 'lib1.txt']);
  // Home: its cards are what was opened last.
  await tab(page, 'a.txt').hover(); await tab(page, 'a.txt').locator('.tab-close').click(); // The × of a tab that is not showing appears on hover.
  await tab(page, 'lib1.txt').locator('.tab-close').click();
  await expect(page.locator('#empty')).toBeVisible();
  await page.locator('.home-open[aria-label="Open lib1.txt"]').click();
  await shown(page, 'lib1.txt');
  await expect(titles(page)).toHaveText(['lib1.txt']);
});

test('a rail cover dragged onto the strip, and a Home tile dragged to the reading area, open in new tabs', async ({ page }) => {
  await page.goto('/');
  await openAll(page, 'a.txt', 'b.txt');
  await addToLibrary(page, 'lib1.txt', 'lib2.txt');
  await page.locator('.library-document', { hasText: 'lib1.txt' }).locator('.library-document-open').click();
  await shown(page, 'lib1.txt');
  await tab(page, 'lib1.txt').locator('.tab-close').click(); await shown(page, 'b.txt');
  // lib2 is opened and closed too, so that Home has a card for it (Home shows what was opened).
  await page.locator('.library-document', { hasText: 'lib2.txt' }).locator('.library-document-open').click();
  await shown(page, 'lib2.txt');
  await tab(page, 'lib2.txt').locator('.tab-close').click(); await shown(page, 'b.txt');
  await page.locator('#library-toggle').click();
  await expect(page.locator('#library-root')).toBeHidden();
  const cover = page.locator('#library-rail .library-rail-cover[aria-label="lib1.txt"]');
  await expect(cover).toBeVisible();
  const from = await centre(cover), target = await afterTab(page, 0);
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 10 });
  await expect(page.locator('.tab-drop-marker')).toBeVisible();
  await page.mouse.up();
  await expect(titles(page)).toHaveText(['a.txt', 'lib1.txt', 'b.txt']);
  // From Home a tile dropped on the page opens after the tab showing; with Home showing, that is the end.
  await page.locator('#home-tab').click();
  const tile = page.locator('.home-open[aria-label="Open lib2.txt"]');
  await expect(tile).toBeVisible();
  const tileAt = await centre(tile);
  await page.mouse.move(tileAt.x, tileAt.y); await page.mouse.down();
  await page.mouse.move(tileAt.x + 40, tileAt.y + 40, { steps: 6 });
  await page.mouse.move(READING.x + 100, READING.y + 100, { steps: 10 });
  await page.mouse.up();
  await shown(page, 'lib2.txt');
  await expect(titles(page)).toHaveText(['a.txt', 'lib1.txt', 'b.txt', 'lib2.txt']);
});
