import { test, expect, type Page } from '@playwright/test';
import { pagedPdf } from './paged-pdf';

const text = (name: string) => ({ name, mimeType: 'text/plain', buffer: Buffer.from(Array.from({ length: 240 }, (_, i) => `${name} line ${i + 1}: a quiet place to read.`).join('\n')) });
const open = (page: Page, name: string) => page.locator('#file-input').setInputFiles(text(name));
const pdf = (name: string) => ({ name, mimeType: 'application/pdf', buffer: pagedPdf(5) });
const tab = (page: Page, name: string) => page.locator('#tab-list .tab', { hasText: name });
const titles = (page: Page) => page.locator('#tab-list .tab-title');
const hosts = (page: Page) => page.locator('.reader-host:not(.staging)');
const shown = (page: Page, name: string) => expect(page.locator('#tab-list .tab.is-active .tab-title')).toHaveText(name);
const goTo = async (page: Page, target: string) => {
  await page.keyboard.press('Control+g'); await page.locator('#target').fill(target);
  await page.getByRole('button', { name: 'Go to location', exact: true }).click();
  await expect(page.locator('#position')).toContainText(target);
  await expect(page.locator('#jump')).toBeHidden();
};
const openAll = async (page: Page, ...names: string[]) => { for (const name of names) { await open(page, name); await shown(page, name); } };

test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 1080, height: 680 }); });

test('every document opens in its own tab, and only three keep a live page', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#home-tab')).toHaveClass(/is-active/);
  await openAll(page, 'a.txt', 'b.txt', 'c.txt', 'd.txt');
  await expect(titles(page)).toHaveText(['a.txt', 'b.txt', 'c.txt', 'd.txt']);
  await expect(page.locator('#home-tab')).not.toHaveClass(/is-active/);
  await expect(hosts(page)).toHaveCount(3);
  await expect(page.locator('.reader-host:not(.staging):not(.tab-hidden)')).toHaveCount(1);
  await expect(page.locator('#empty')).toBeHidden();
  // The page indicator is on the tab being read only.
  await expect(page.locator('#tab-list .tab-where')).toHaveText(['', '', '', /^\d+ \/ \d+$/]);
  // A document that is open already is shown, not opened again.
  await open(page, 'b.txt');
  await shown(page, 'b.txt');
  await expect(titles(page)).toHaveCount(4);
});

test('switching tabs keeps each tab\'s place, zoom, hand tool and find text; a hibernated tab reopens where it was', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles(pdf('plates.pdf'));
  await shown(page, 'plates.pdf');
  await page.locator('.pdf-reader').focus();
  await goTo(page, '3');
  await page.keyboard.press('Shift+Digit0');
  await expect(page.locator('#zoom-level')).toHaveText('100%');
  await page.keyboard.press('h');
  await expect(page.locator('#hand-tool')).toHaveAttribute('aria-pressed', 'true');

  await open(page, 'notes.txt'); await shown(page, 'notes.txt');
  await goTo(page, '100');
  await page.keyboard.press('Control+f'); await page.locator('#find-query').fill('line 5');
  await expect(page.locator('#find-bar')).toBeVisible();
  await expect(page.locator('#find-status')).toContainText(/of \d+/); // The search has run and moved to its first match, so this is the place to come back to.
  const notesPlace = (await page.locator('#position').textContent())!;
  await expect(page.locator('#view-controls')).toBeHidden(); // Text has no zoom pill; the PDF's did not follow it here.

  await tab(page, 'plates.pdf').click(); await shown(page, 'plates.pdf');
  await expect(page.locator('#position')).toContainText('3');
  await expect(page.locator('#zoom-level')).toHaveText('100%');
  await expect(page.locator('#hand-tool')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#find-bar')).toBeHidden();
  await expect(page.locator('#loading')).toBeHidden(); // A live tab comes back at once, with no reload.

  await tab(page, 'notes.txt').click(); await shown(page, 'notes.txt');
  await expect(page.locator('#position')).toHaveText(notesPlace);
  await expect(page.locator('#find-bar')).toBeVisible();
  await expect(page.locator('#find-query')).toHaveValue('line 5');

  // Push the PDF out of the three live tabs, then bring it back: it reopens at its page and its zoom.
  await openAll(page, 'x.txt', 'y.txt');
  await expect(hosts(page)).toHaveCount(3);
  await expect(page.locator('.pdf-reader')).toHaveCount(0);
  await tab(page, 'plates.pdf').click(); await shown(page, 'plates.pdf');
  await expect(page.locator('.pdf-reader:not(.staging)')).toBeVisible();
  await expect(page.locator('#position')).toContainText('3');
  await expect(page.locator('#zoom-level')).toHaveText('100%');
  await expect(hosts(page)).toHaveCount(3);
});

test('a tab closes by its ×, by Ctrl+W and by middle-click, and the neighbour takes over; the last one shows Home', async ({ page }) => {
  await page.goto('/');
  await openAll(page, 'a.txt', 'b.txt', 'c.txt', 'd.txt');
  await tab(page, 'b.txt').click(); await shown(page, 'b.txt');
  await page.locator('.reader-host:not(.staging):not(.tab-hidden)').focus();
  await page.keyboard.press('Control+w');
  await shown(page, 'c.txt'); // The right neighbour.
  await tab(page, 'd.txt').click({ button: 'middle' });
  await expect(titles(page)).toHaveText(['a.txt', 'c.txt']);
  await shown(page, 'c.txt'); // Closing another tab leaves what is showing alone.
  await tab(page, 'c.txt').locator('.tab-close').click();
  await shown(page, 'a.txt'); // Last in the strip: the left neighbour.
  await page.locator('.reader-host:not(.staging):not(.tab-hidden)').focus();
  await page.keyboard.press('Control+w');
  await expect(titles(page)).toHaveCount(0);
  await expect(page.locator('#home-tab')).toHaveClass(/is-active/);
  await expect(page.locator('#empty')).toBeVisible();
  await expect(page.locator('#position')).toBeDisabled();
  await expect(hosts(page)).toHaveCount(0);
});

test('Ctrl+Tab, Ctrl+Alt+arrows, Alt+1…9 and ⌘+1…9 move between tabs', async ({ page }) => {
  await page.goto('/');
  await openAll(page, 'a.txt', 'b.txt', 'c.txt');
  await page.keyboard.press('Control+Tab'); await shown(page, 'a.txt'); // Wraps.
  await page.keyboard.press('Control+Shift+Tab'); await shown(page, 'c.txt');
  await page.keyboard.press('Control+Alt+ArrowLeft'); await shown(page, 'b.txt');
  await page.keyboard.press('Control+Alt+ArrowRight'); await shown(page, 'c.txt');
  await page.keyboard.press('Alt+Digit1'); await shown(page, 'a.txt');
  await page.keyboard.press('Alt+Digit2'); await shown(page, 'b.txt');
  await page.keyboard.press('Alt+Digit9'); await shown(page, 'c.txt');
  await page.keyboard.press('Meta+Digit1'); await shown(page, 'a.txt');
  await page.keyboard.press('Meta+Digit9'); await shown(page, 'c.txt');
  await page.keyboard.press('Alt+Digit7'); await shown(page, 'c.txt'); // No seventh tab: nothing happens.
  // Home takes part: forward from it is the first tab.
  await page.locator('#home-tab').click();
  await expect(page.locator('#empty')).toBeVisible();
  await page.keyboard.press('Control+Tab'); await shown(page, 'a.txt');
  // Ctrl+T asks for a file in a new tab.
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('Control+t');
  await (await chooser).setFiles(text('fresh.txt'));
  await shown(page, 'fresh.txt');
  await expect(titles(page)).toHaveText(['a.txt', 'b.txt', 'c.txt', 'fresh.txt']);
});

test('Actual size is Shift+0, Ctrl+1 no longer is, and typing in a field ignores it', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles(pdf('plates.pdf'));
  await shown(page, 'plates.pdf');
  await page.locator('.pdf-reader').focus();
  await page.keyboard.press('Control+0');
  const fit = await page.locator('#zoom-level').textContent();
  expect(fit).not.toBe('100%');
  await page.keyboard.press('Control+1');
  await expect(page.locator('#zoom-level')).toHaveText(fit!);
  await page.keyboard.press('Control+f');
  await page.keyboard.press('Shift+Digit0');
  await expect(page.locator('#find-query')).toHaveValue(')');
  await expect(page.locator('#zoom-level')).toHaveText(fit!);
  await page.keyboard.press('Escape');
  await page.locator('.pdf-reader').focus();
  await page.keyboard.press('Shift+Digit0');
  await expect(page.locator('#zoom-level')).toHaveText('100%');
  await page.locator('#zoom-level').click();
  await expect(page.getByRole('menuitem', { name: /Actual size/ })).toContainText('Shift 0');
});

test('a compact window has no strip: the title names the document and counts the tabs, and opens the list', async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 620 });
  await page.goto('/');
  await openAll2(page, 'a.txt', 'b.txt');
  await expect(page.locator('#tab-strip')).toBeHidden();
  await expect(page.locator('#title')).toBeVisible();
  await expect(page.locator('#filename')).toHaveText('b.txt');
  await expect(page.locator('#tab-count')).toHaveText('2');
  await page.locator('#title').click();
  const menu = page.locator('#tab-menu');
  await expect(menu).toBeVisible();
  await expect(menu.locator('.tab-menu-row .tab-menu-title')).toHaveText(['Home', 'a.txt', 'b.txt', 'New tab…']);
  await expect(menu.locator('.tab-menu-row.is-active')).toHaveText(/b\.txt/);
  await menu.getByRole('menuitem', { name: /a\.txt/ }).click();
  await expect(menu).toBeHidden();
  await expect(page.locator('#filename')).toHaveText('a.txt');
  // Closing from the list.
  await page.locator('#title').click();
  await menu.getByRole('menuitem', { name: /b\.txt/ }).getByRole('button', { name: /Close/ }).click();
  await expect(page.locator('#tab-count')).toHaveText('1');
  await expect(menu).toBeVisible(); // The list stays open for closing more.
  await menu.getByRole('menuitem', { name: 'Home' }).click();
  await expect(page.locator('#empty')).toBeVisible();
  await expect(page.locator('#filename')).toHaveText('Hold My Brief');
});

async function openAll2(page: Page, ...names: string[]) { for (const name of names) { await open(page, name); await expect(page.locator('#filename')).toHaveText(name); } }

test('tabs are reordered by dragging, and middle drag-free clicks still select', async ({ page }) => {
  await page.goto('/');
  await openAll(page, 'a.txt', 'b.txt', 'c.txt');
  const box = async (name: string) => (await tab(page, name).boundingBox())!;
  const a = await box('a.txt'), c = await box('c.txt'), y = a.y + a.height / 2;
  await page.mouse.move(a.x + a.width / 2, y); await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 20, y, { steps: 3 });
  await expect(tab(page, 'a.txt')).toHaveClass(/is-dragging/);
  await page.mouse.move(c.x + c.width - 4, y, { steps: 8 });
  await page.mouse.up();
  await expect(titles(page)).toHaveText(['b.txt', 'c.txt', 'a.txt']);
  await shown(page, 'c.txt'); // Dragging does not select.
  await expect(tab(page, 'a.txt')).not.toHaveClass(/is-dragging/);
  // And back to the front.
  const last = await box('a.txt'), first = await box('b.txt');
  await page.mouse.move(last.x + last.width / 2, y); await page.mouse.down();
  await page.mouse.move(first.x + 2, y, { steps: 10 });
  await page.mouse.up();
  await expect(titles(page)).toHaveText(['a.txt', 'b.txt', 'c.txt']);
  await tab(page, 'b.txt').click(); await shown(page, 'b.txt'); // A plain click selects.
});

test('too many tabs scroll the strip, and the ⌄ at its end lists them all', async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 680 });
  await page.goto('/');
  const names = Array.from({ length: 12 }, (_, i) => `document-with-a-long-name-${i + 1}.txt`);
  await openAll(page, ...names);
  const list = page.locator('#tab-list');
  expect(await list.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  await expect(page.locator('#tab-overflow')).toBeVisible();
  await expect(tab(page, names[11])).toBeInViewport(); // The active tab is kept in view.
  await page.locator('#tab-overflow').click();
  await expect(page.locator('#tab-menu .tab-menu-row .tab-menu-title')).toHaveCount(14);
  await page.locator('#tab-menu').getByRole('menuitem', { name: new RegExp(names[0]) }).click();
  await shown(page, names[0]);
  await expect(tab(page, names[0])).toBeInViewport();
  // The toolbar's empty space still drags the window; the tabs and the buttons do not.
  expect(await page.locator('#tab-strip').getAttribute('data-tauri-drag-region')).not.toBeNull();
  expect(await tab(page, names[0]).getAttribute('data-tauri-drag-region')).toBeNull();
  await expect(page.locator('#tab-add')).toBeVisible();
});

test('the tabs, their order and the active one come back after a reload; only the active one opens, the rest when selected', async ({ page }) => {
  await page.goto('/');
  await openAll(page, 'a.txt', 'b.txt', 'c.txt');
  await goTo(page, '77');
  await tab(page, 'c.txt').dragTo(tab(page, 'a.txt'));
  await expect(titles(page)).toHaveText(['c.txt', 'a.txt', 'b.txt']);
  await tab(page, 'a.txt').click(); await shown(page, 'a.txt');
  await goTo(page, '33');
  await page.waitForTimeout(900);
  await page.reload();
  await expect(titles(page)).toHaveText(['c.txt', 'a.txt', 'b.txt']);
  await shown(page, 'a.txt');
  await expect(page.locator('#position')).toContainText('33');
  await expect(hosts(page)).toHaveCount(1);
  await tab(page, 'c.txt').click(); await shown(page, 'c.txt');
  await expect(page.locator('#position')).toContainText('77');
  await expect(hosts(page)).toHaveCount(2);
  // Home showing is remembered as well.
  await page.locator('#home-tab').click();
  await page.waitForTimeout(100);
  await page.reload();
  await expect(page.locator('#home-tab')).toHaveClass(/is-active/);
  await expect(titles(page)).toHaveCount(3);
  await expect(hosts(page)).toHaveCount(0);
});

test('a restored tab whose file is gone says so, offers Locate and Close, and never breaks the launch', async ({ page }) => {
  await page.goto('/');
  await openAll(page, 'real.txt');
  await page.waitForTimeout(300);
  await page.evaluate(() => localStorage.setItem('hold-my-brief-tabs', JSON.stringify({ tabs: [{ path: 'gone/ghost.pdf', name: 'ghost.pdf', format: 'pdf' }, { path: 'also/missing.txt', name: 'missing.txt', format: 'txt' }], active: 0 })));
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.reload();
  await expect(titles(page)).toHaveText(['ghost.pdf', 'missing.txt']);
  await shown(page, 'ghost.pdf');
  const state = page.locator('#tab-state');
  await expect(state).toBeVisible();
  await expect(state.locator('#tab-state-title')).toHaveText('File not found');
  await expect(state.getByRole('button', { name: 'Locate…' })).toBeVisible();
  await expect(page.locator('#position')).toBeDisabled();
  // The other tab is untouched until it is selected, and then says the same.
  await tab(page, 'missing.txt').click();
  await expect(state.locator('#tab-state-title')).toHaveText('File not found');
  await state.getByRole('button', { name: 'Close tab' }).click();
  await shown(page, 'ghost.pdf');
  await state.getByRole('button', { name: 'Close tab' }).click();
  await expect(titles(page)).toHaveCount(0);
  await expect(page.locator('#empty')).toBeVisible();
  await expect(state).toBeHidden();
  expect(errors).toEqual([]);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('hold-my-brief-tabs')!))).toEqual({ tabs: [], active: null });
});

test('opening from the library or the rail shows the tab a document is already in', async ({ page }) => {
  await page.goto('/');
  await openAll(page, 'a.txt', 'b.txt');
  const drawer = page.locator('#library-root');
  await expect(drawer).toBeVisible(); // Open at this width.
  await drawer.getByText('a.txt').first().dblclick();
  await shown(page, 'a.txt');
  await expect(titles(page)).toHaveCount(2);
});

test('cancelling a slow open leaves every tab exactly as it was, and a late result is ignored', async ({ page }) => {
  await page.goto('/');
  await openAll(page, 'a.txt', 'b.txt');
  await goTo(page, '40');
  await page.evaluate(() => {
    const original = File.prototype.arrayBuffer;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    (window as unknown as { __release: () => void }).__release = release;
    File.prototype.arrayBuffer = async function (this: File) { if (this.name === 'slow.txt') await gate; return original.call(this); };
  });
  await open(page, 'slow.txt');
  await expect(page.locator('#loading')).toBeVisible();
  await page.locator('#cancel').click();
  await expect(page.locator('#loading')).toBeHidden();
  await page.evaluate(() => (window as unknown as { __release: () => void }).__release());
  await page.waitForTimeout(500);
  await expect(titles(page)).toHaveText(['a.txt', 'b.txt']);
  await shown(page, 'b.txt');
  await expect(page.locator('#position')).toContainText('40');
  await expect(hosts(page)).toHaveCount(2);
  await expect(page.locator('#loading')).toBeHidden();
  await tab(page, 'a.txt').click(); await shown(page, 'a.txt'); // The other tab still works.
});
