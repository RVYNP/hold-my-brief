import { test, expect, type Locator, type Page } from '@playwright/test';
import { chapterBook } from './epub-book';
import { pagedPdf } from './paged-pdf';
import { expectFormats } from './toolbar-tabs';

/** Tiling: any pane splits right or down, up to four panes, with keys, a Move to pane submenu, Close pane, a divider for every split, a reader budget shared by the window, and a restart that brings the tree back. */

const pdf = { name: 'half-tone.pdf', mimeType: 'application/pdf', buffer: pagedPdf(5) };
const second = { name: 'second.pdf', mimeType: 'application/pdf', buffer: pagedPdf(8) };
const markdown = { name: 'moby.md', mimeType: 'text/markdown', buffer: Buffer.from(['# Moby', '', ...Array.from({ length: 80 }, (_, i) => `Line ${i + 1}: call me Ishmael.`)].join('\n\n')) };

type Box = { x: number; y: number; width: number; height: number };
const box = async (locator: Locator): Promise<Box> => { const { x, y, width, height } = (await locator.boundingBox())!; return { x, y, width, height }; };
const body = (page: Page, id: string) => page.locator(`.pane-body[data-pane=${id}]`);
const row = (page: Page, id: string) => page.locator(`.pane-strip[data-pane=${id}] .tab`);
const tab = (page: Page, id: string, title: string) => row(page, id).filter({ has: page.locator('.tab-title', { hasText: title }) });
const shownWhere = (page: Page, id: string) => page.locator(`.pane-strip[data-pane=${id}] .tab.is-active .tab-where`);
/** The EPUB's tab and menu entries show the title in its metadata, not its file name. */
const BOOK = 'THE GENERATED BOOK';
const workspace = (page: Page) => page.locator('#workspace');
const menuItem = (page: Page, name: string) => page.getByRole('menuitem', { name, exact: true });
const run = async (page: Page, name: string) => { await page.keyboard.press('Control+k'); await page.locator('#palette-input').fill(name); await page.keyboard.press('Enter'); await expect(page.locator('#palette')).toBeHidden(); };
const goTo = async (page: Page, target: string) => {
  await page.keyboard.press('Control+g'); await page.locator('#target').fill(target);
  await page.getByRole('button', { name: 'Go to location', exact: true }).click();
  await expect(page.locator('#jump')).toBeHidden();
};
const near = (actual: Box, expected: Box, tolerance = 1.5) => { for (const key of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(actual[key] - expected[key]), key).toBeLessThanOrEqual(tolerance); };
const treeOf = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('hold-my-brief-tabs')!).layout.tree);
const pick = async (page: Page, id: string) => { await page.locator(`.reader-host[data-pane=${id}]:not(.tab-hidden)`).click({ position: { x: 40, y: 200 } }); await expect(workspace(page)).toHaveAttribute('data-active', id); };

test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 1440, height: 900 }); });

/** Two PDFs, an EPUB and a Markdown file open in the one pane, the second PDF at page 4 and zoomed; the library panel closed so the panes have the room. */
async function openFour(page: Page) {
  await page.goto('/');
  const epub = { name: 'pride.epub', mimeType: 'application/epub+zip', buffer: await chapterBook({ chapters: 4, paragraphs: 30 }) };
  for (const [file, format] of [[pdf, 'PDF'], [second, 'PDF'], [epub, 'EPUB'], [markdown, 'MD']] as const) {
    await page.locator('#file-input').setInputFiles(file);
    await expect(page.locator('#tab-list .tab.is-active')).toHaveAttribute('data-format', format);
    if (file.name === 'second.pdf') { await expect(page.locator('#position')).toContainText('Page 1 of 8'); await goTo(page, '4'); await expect(page.locator('#position')).toContainText('Page 4 of 8'); await page.keyboard.press('Control+='); }
  }
  if (await page.locator('#reader-layout.library-open').count()) await page.keyboard.press('Control+b');
  await expect(page.locator('#reader-layout.library-open')).toHaveCount(0);
}

/** The EPUB split off to the right, the Markdown file moved over to it and split down: three panes in the 1B layout (the PDFs on the left, the EPUB above the Markdown file), the Markdown pane active. */
async function openThreePanes(page: Page) {
  await openFour(page);
  await page.locator('#tab-list .tab[data-format="EPUB"]').click({ button: 'right' });
  await menuItem(page, 'Split right').click();
  await expect(row(page, 'b').locator('.tab-format')).toHaveText(['EPUB']);
  await row(page, 'a').filter({ has: page.locator('.tab-format', { hasText: 'MD' }) }).click({ button: 'right' });
  await menuItem(page, 'Move to the other side').click();
  await expect(row(page, 'b').locator('.tab-format')).toHaveText(['EPUB', 'MD']);
  await row(page, 'b').filter({ has: page.locator('.tab-format', { hasText: 'MD' }) }).click({ button: 'right' });
  await menuItem(page, 'Split down').click();
  await expect(row(page, 'c').locator('.tab-format')).toHaveText(['MD']);
  await expect(workspace(page)).toHaveAttribute('data-active', 'c');
}

/** The 1B boxes at 1440 × 900 with the panel closed: a pane's layer starts below its row of tabs, so the rows are 28 px high and the dividers 8. */
async function layoutOf(page: Page) {
  const [a, b, c] = await Promise.all(['a', 'b', 'c'].map(id => box(body(page, id))));
  return { a, b, c };
}

test('Split down: the EPUB split right, the Markdown file moved over and split down, make three panes in the 1B layout, each showing its document at its own place', async ({ page }) => {
  await openThreePanes(page);
  const { a, b, c } = await layoutOf(page);
  expect(a.x).toBeLessThan(b.x - 300);
  expect(Math.abs(b.x - c.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(b.width - c.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(a.width - b.width)).toBeLessThanOrEqual(1);
  expect(c.y).toBeGreaterThan(b.y + b.height);
  expect(Math.abs(b.height - c.height)).toBeLessThanOrEqual(1);
  // The PDF pane is the full height: its layer (below one row) ends where the Markdown pane's does, and the two on the right share the rest with a divider and a second row.
  expect(Math.abs(a.height - (b.height + c.height + 8 + 28))).toBeLessThanOrEqual(2);
  expect(Math.abs(a.y + a.height - (c.y + c.height))).toBeLessThanOrEqual(1);
  await expect(page.locator('.pane-divider')).toHaveCount(2);
  await expect(page.locator('.pane-divider[aria-orientation=vertical]')).toHaveCount(1);
  await expect(page.locator('.pane-divider[aria-orientation=horizontal]')).toHaveCount(1);
  // Every pane shows its own document, at its own place, with the page it was left at.
  await expect(page.locator('.pane-strip[data-pane=a] .tab.is-active .tab-title')).toHaveText('second.pdf');
  await expect(shownWhere(page, 'a')).toHaveText('4 / 8');
  await expect(page.locator('.pane-strip[data-pane=b] .tab.is-active .tab-format')).toHaveText('EPUB');
  await expect(page.locator('.pane-strip[data-pane=c] .tab.is-active .tab-format')).toHaveText('MD');
  for (const id of ['a', 'b', 'c']) await expect(page.locator(`.reader-host[data-pane=${id}]:not(.tab-hidden)`)).toBeVisible();
  // Each reader is drawn inside its own pane.
  for (const id of ['a', 'b', 'c']) near(await box(page.locator(`.reader-host[data-pane=${id}]:not(.tab-hidden)`)), await box(body(page, id)), 2);
  await expect(page.locator('#position')).toContainText('Moby');
  await expect(page.locator('.pane-strip[data-pane=c] .pane-edge')).toBeVisible();
  await expect(page.locator('.pane-strip[data-pane=a] .pane-edge')).toBeHidden();
  await expect(page.locator('#filename')).toHaveText('moby.md');
});

test('four panes: split the left pane down for a 2 × 2 layout; Split right is then unavailable and says why, and a PDF moved to the pane below keeps its page and zoom', async ({ page }) => {
  await openThreePanes(page);
  await pick(page, 'a');
  const zoom = await page.locator('#zoom-level').innerText();
  await expect(page.locator('#position')).toContainText('Page 4 of 8');
  await tab(page, 'a', 'second.pdf').click({ button: 'right' });
  await menuItem(page, 'Split down').click();
  await expect(row(page, 'd').locator('.tab-title')).toHaveText(['second.pdf']);
  await expect(row(page, 'a').locator('.tab-title')).toHaveText(['half-tone.pdf']);
  await expect(workspace(page)).toHaveAttribute('data-active', 'd');
  const [a, d, b, c] = await Promise.all(['a', 'd', 'b', 'c'].map(id => box(body(page, id))));
  expect(Math.abs(a.x - d.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(b.x - c.x)).toBeLessThanOrEqual(1);
  expect(d.y).toBeGreaterThan(a.y + a.height);
  expect(c.y).toBeGreaterThan(b.y + b.height);
  expect(Math.abs(a.height - b.height)).toBeLessThanOrEqual(1);
  expect(Math.abs(d.height - c.height)).toBeLessThanOrEqual(1);
  await expect(page.locator('.pane-divider')).toHaveCount(3);
  // The PDF below kept its page and its zoom.
  await expect(page.locator('#position')).toContainText('Page 4 of 8');
  expect(await page.locator('#zoom-level').innerText()).toBe(zoom);
  await expect(shownWhere(page, 'd')).toHaveText('4 / 8');
  // At four panes every split says why not, in the palette and in every tab's menu.
  await page.keyboard.press('Control+k'); await page.locator('#palette-input').fill('Split right');
  await expect(page.locator('#palette-list')).toContainText('A window holds at most four panes');
  await page.keyboard.press('Escape');
  await tab(page, 'a', 'half-tone.pdf').click({ button: 'right' });
  for (const name of ['Split right', 'Split down']) {
    await expect(menuItem(page, name)).toBeDisabled();
    await expect(menuItem(page, name)).toHaveAttribute('title', 'A window holds at most four panes');
  }
  await page.keyboard.press('Escape');
  const before = await treeOf(page);
  await page.keyboard.press('Control+Shift+\\');
  await expect(page.locator('.pane-strip')).toHaveCount(4);
  expect(await treeOf(page)).toEqual(before);
});

test('a pane under 2 × 360 + 8 px wide, or 2 × 240 + 8 px high, cannot be split along that axis, and the reason is the tooltip', async ({ page }) => {
  await openThreePanes(page);
  // The Markdown pane is 692 px wide (a column of the right half) and 411 px high, with one tab.
  const c = await box(body(page, 'c'));
  expect(c.width).toBeLessThan(728);
  await row(page, 'c').first().click({ button: 'right' });
  await expect(menuItem(page, 'Split right')).toBeDisabled();
  await expect(menuItem(page, 'Split right')).toHaveAttribute('title', 'This pane is too narrow to split');
  await expect(menuItem(page, 'Split down')).toBeDisabled();
  await expect(menuItem(page, 'Split down')).toHaveAttribute('title', 'This pane is too short to split');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+k'); await page.locator('#palette-input').fill('Split down');
  await expect(page.locator('#palette-list')).toContainText('This pane is too short to split');
  await page.keyboard.press('Escape');
  // The PDF pane is the whole height, so it can be split down; it is 692 px wide, so it cannot be split right.
  expect((await box(body(page, 'a'))).height).toBeGreaterThan(488);
  await tab(page, 'a', 'second.pdf').click({ button: 'right' });
  await expect(menuItem(page, 'Split down')).toBeEnabled();
  await expect(menuItem(page, 'Split right')).toBeDisabled();
  await expect(menuItem(page, 'Split right')).toHaveAttribute('title', 'This pane is too narrow to split');
  await page.keyboard.press('Escape');
});

test('keys: ⌥⌘ (Ctrl Alt) and the arrows move the focus to the neighbouring pane, Ctrl \\ cycles the panes in reading order, and Ctrl F searches the active pane\'s document', async ({ page }) => {
  await openThreePanes(page);
  await pick(page, 'a');
  await tab(page, 'a', 'second.pdf').click({ button: 'right' });
  await menuItem(page, 'Split down').click();
  await expect(page.locator('.pane-strip')).toHaveCount(4);
  // a above d on the left, b above c on the right: reading order a, d, b, c.
  await pick(page, 'c');
  await page.keyboard.press('Control+Alt+ArrowUp');
  await expect(workspace(page)).toHaveAttribute('data-active', 'b');
  await page.keyboard.press('Control+Alt+ArrowLeft');
  await expect(workspace(page)).toHaveAttribute('data-active', 'a');
  await page.keyboard.press('Control+Alt+ArrowDown');
  await expect(workspace(page)).toHaveAttribute('data-active', 'd');
  await page.keyboard.press('Control+Alt+ArrowRight'); // d has the bottom row's right neighbour: c.
  await expect(workspace(page)).toHaveAttribute('data-active', 'c');
  await page.keyboard.press('Control+Alt+ArrowUp');
  await expect(workspace(page)).toHaveAttribute('data-active', 'b');
  await page.keyboard.press('Control+Alt+ArrowUp'); // Nothing above the top row.
  await expect(workspace(page)).toHaveAttribute('data-active', 'b');
  for (const id of ['c', 'a', 'd', 'b']) {
    await page.keyboard.press('Control+\\');
    await expect(workspace(page)).toHaveAttribute('data-active', id);
  }
  // Find is the active pane's.
  await pick(page, 'c');
  await page.keyboard.press('Control+f');
  await expect(page.locator('.pane-body[data-pane=c] #find-bar')).toBeVisible();
  await page.locator('#find-query').fill('Ishmael');
  await expect(page.locator('#find-status')).toHaveText('1 of 80');
  await page.keyboard.press('Escape');
  await expect(page.locator('#find-bar')).toBeHidden();
  await pick(page, 'c');
  await page.keyboard.press('Control+Alt+ArrowUp');
  await expect(workspace(page)).toHaveAttribute('data-active', 'b');
  await page.keyboard.press('Control+f');
  await expect(page.locator('.pane-body[data-pane=b] #find-bar')).toBeVisible();
  await expect(page.locator('.pane-body[data-pane=c] #find-bar')).toBeHidden();
});

test('Ctrl Alt and the arrows are still Next tab and Previous tab while the window is not split', async ({ page }) => {
  await page.goto('/');
  for (const name of ['a.txt', 'b.txt', 'c.txt']) {
    await page.locator('#file-input').setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(`${name}\n`.repeat(30)) });
    await expect(page.locator('#filename')).toHaveText(name);
  }
  await page.keyboard.press('Control+Alt+ArrowLeft');
  await expect(page.locator('#filename')).toHaveText('b.txt');
  await page.keyboard.press('Control+Alt+ArrowRight');
  await expect(page.locator('#filename')).toHaveText('c.txt');
});

test('Ctrl Shift \\ splits down, and Ctrl \\ then moves to the next pane', async ({ page }) => {
  await page.goto('/');
  for (const name of ['a.txt', 'b.txt', 'c.txt']) {
    await page.locator('#file-input').setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(`${name}\n`.repeat(30)) });
    await expect(page.locator('#filename')).toHaveText(name);
  }
  if (await page.locator('#reader-layout.library-open').count()) await page.keyboard.press('Control+b');
  await page.keyboard.press('Control+Shift+\\');
  await expect(page.locator('.pane-divider[aria-orientation=horizontal]')).toHaveCount(1);
  await expect(row(page, 'b').locator('.tab-title')).toHaveText(['c.txt']);
  const [a, b] = await Promise.all([box(body(page, 'a')), box(body(page, 'b'))]);
  expect(b.y).toBeGreaterThan(a.y + a.height);
  expect(Math.abs(a.width - b.width)).toBeLessThanOrEqual(1);
  await expect(workspace(page)).toHaveAttribute('data-active', 'b');
  // The pane that is split is the one the key is pressed in, and the room it has decides: a pane 425 px high cannot be split down again.
  await page.keyboard.press('Control+\\');
  await expect(workspace(page)).toHaveAttribute('data-active', 'a');
  await page.keyboard.press('Control+Shift+\\');
  await expect(page.locator('.pane-strip')).toHaveCount(2);
  await expect(page.locator('#notice span')).toHaveText('This pane is too short to split');
});

test('Close pane: its tabs join the sibling and the layout goes back to what it was; closing a pane\'s last tab does the same', async ({ page }) => {
  await openThreePanes(page);
  const three = await layoutOf(page);
  await pick(page, 'a');
  await tab(page, 'a', 'second.pdf').click({ button: 'right' });
  await menuItem(page, 'Split down').click();
  await expect(page.locator('.pane-strip')).toHaveCount(4);
  // d (below a) goes: a is its sibling, which takes its tab and its room, and becomes the active pane.
  await tab(page, 'd', 'second.pdf').click({ button: 'right' });
  await menuItem(page, 'Close pane').click();
  await expect(page.locator('.pane-strip')).toHaveCount(3);
  await expect(row(page, 'a').locator('.tab-title')).toHaveText(['half-tone.pdf', 'second.pdf']);
  await expect(workspace(page)).toHaveAttribute('data-active', 'a');
  await expect(page.locator('.pane-divider')).toHaveCount(2);
  const again = await layoutOf(page);
  for (const id of ['a', 'b', 'c'] as const) near(again[id], three[id]);
  // The closed pane's id is free again, and the next split takes it.
  await tab(page, 'a', 'second.pdf').click({ button: 'right' });
  await menuItem(page, 'Split down').click();
  await expect(row(page, 'd').locator('.tab-title')).toHaveText(['second.pdf']);
  // The last tab of a pane: closing it closes the pane, and its room goes to the sibling.
  await row(page, 'd').first().hover();
  await row(page, 'd').first().locator('.tab-close').click();
  await expect(page.locator('.pane-strip')).toHaveCount(3);
  await expect(row(page, 'a').locator('.tab-title')).toHaveText(['half-tone.pdf']);
  near((await layoutOf(page)).a, three.a);
  // A pane that is not the first one: the Markdown pane goes to the EPUB above it.
  await tab(page, 'c', 'moby.md').click({ button: 'right' });
  await menuItem(page, 'Close pane').click();
  await expect(page.locator('.pane-strip')).toHaveCount(2);
  await expect(row(page, 'b').locator('.tab-format')).toHaveText(['EPUB', 'MD']);
  await expect(workspace(page)).toHaveAttribute('data-active', 'b');
  await expect(page.locator('.pane-divider')).toHaveCount(1);
});

test('Close the split merges every pane\'s tabs into one row in reading order, the shown tab stays shown, and the Library tab goes first', async ({ page }) => {
  await openThreePanes(page);
  await row(page, 'c').first().click({ button: 'right' });
  await menuItem(page, 'Close the split').click();
  await expect(page.locator('.pane-strip:visible')).toHaveCount(0);
  await expect(workspace(page)).not.toHaveClass(/is-split/);
  await expectFormats(page.locator('#tab-list .tab'), ['PDF', 'PDF', 'EPUB', 'MD']);
  await expect(page.locator('#tab-list .tab.is-active')).toHaveAttribute('data-format', 'MD');
  await expect(page.locator('.pane-divider:visible')).toHaveCount(0);
});

test('Move to pane ▸ names every other pane by the document it shows; with two panes it is the single item Move to the other side', async ({ page }) => {
  await openThreePanes(page);
  await row(page, 'a').first().click({ button: 'right' });
  await expect(menuItem(page, 'Move to the other side')).toHaveCount(0);
  const parent = menuItem(page, 'Move to pane');
  await expect(parent).toHaveAttribute('aria-haspopup', 'menu');
  await expect(parent).toHaveAttribute('aria-expanded', 'false');
  await parent.click();
  await expect(parent).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('menuitem')).toHaveText(['Split right', 'Split down', /^Move to pane/, 'Close', 'Close pane', 'Close the split', BOOK, 'moby.md']);
  // The keys: Left goes back to the entry, Escape closes the submenu and then the menu.
  await page.keyboard.press('ArrowLeft');
  await expect(parent).toBeFocused();
  await expect(menuItem(page, 'moby.md')).toBeHidden();
  await page.keyboard.press('ArrowRight');
  await expect(menuItem(page, BOOK)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menuItem(page, 'moby.md')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(parent).toBeFocused();
  await expect(page.getByRole('menu').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  // Choosing a pane moves the tab there: it is shown, and the pane becomes the active one.
  await row(page, 'a').first().click({ button: 'right' });
  await menuItem(page, 'Move to pane').click();
  await menuItem(page, 'moby.md').click();
  await expect(row(page, 'c').locator('.tab-title')).toHaveText(['moby.md', 'half-tone.pdf']);
  await expect(row(page, 'a').locator('.tab-title')).toHaveText(['second.pdf']);
  await expect(workspace(page)).toHaveAttribute('data-active', 'c');
  await expect(page.locator('.pane-strip[data-pane=c] .tab.is-active .tab-title')).toHaveText('half-tone.pdf');
  // The last tab of a pane moving away closes the pane.
  await row(page, 'a').first().click({ button: 'right' });
  await menuItem(page, 'Move to pane').click();
  await menuItem(page, BOOK).click();
  await expect(page.locator('.pane-strip')).toHaveCount(2);
  await expect(row(page, 'b').locator('.tab-title')).toHaveText([BOOK, 'second.pdf']);
  await row(page, 'b').first().click({ button: 'right' });
  await expect(menuItem(page, 'Move to the other side')).toBeVisible();
  await expect(menuItem(page, 'Move to pane')).toHaveCount(0);
  await page.keyboard.press('Escape');
});

test('dividers: each splits its own two groups, snaps at 50 %, evens on a double-click, and no drag takes a pane under 360 × 240', async ({ page }) => {
  await openThreePanes(page);
  const horizontal = page.locator('.pane-divider[aria-orientation=horizontal]'), vertical = page.locator('.pane-divider[aria-orientation=vertical]');
  await expect(horizontal).toHaveAttribute('aria-valuenow', '50');
  const drag = async (divider: Locator, to: { x?: number; y?: number }) => {
    const at = await box(divider), x = at.x + at.width / 2, y = at.y + at.height / 2;
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(to.x ?? x, to.y ?? y, { steps: 8 }); await page.mouse.up();
  };
  // Near the middle it settles on 50.
  const h = await box(horizontal);
  await drag(horizontal, { y: h.y + h.height / 2 + 9 });
  await expect(horizontal).toHaveAttribute('aria-valuenow', '50');
  // Elsewhere it stays where it was let go, and the vertical divider is not moved by it.
  await drag(horizontal, { y: h.y + 250 });
  await expect.poll(async () => Number(await horizontal.getAttribute('aria-valuenow'))).toBeGreaterThan(55);
  await expect(vertical).toHaveAttribute('aria-valuenow', '50');
  const [b, c] = await Promise.all([box(body(page, 'b')), box(body(page, 'c'))]);
  expect(b.height).toBeGreaterThan(c.height);
  await horizontal.dblclick();
  await expect(horizontal).toHaveAttribute('aria-valuenow', '50');
  // Neither divider takes a pane under 360 × 240 (a pane's height is its row, 28 px, and its layer).
  const minimum = async () => {
    for (const id of ['a', 'b', 'c']) {
      const pane = await box(body(page, id));
      expect(pane.width, `${id} width`).toBeGreaterThanOrEqual(359.5);
      expect(pane.height + 28, `${id} height`).toBeGreaterThanOrEqual(239.5);
    }
  };
  const room = await box(page.locator('#workspace'));
  await drag(horizontal, { y: room.y + 2 }); await minimum();
  await drag(horizontal, { y: room.y + room.height - 2 }); await minimum();
  await drag(vertical, { x: room.x + 2 }); await minimum();
  await drag(vertical, { x: room.x + room.width - 2 }); await minimum();
  await vertical.dblclick(); await expect(vertical).toHaveAttribute('aria-valuenow', '50');
  await horizontal.dblclick(); await expect(horizontal).toHaveAttribute('aria-valuenow', '50');
  // The keys move each by 2 % along its direction, and End goes to the limit.
  await horizontal.focus(); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
  await expect(horizontal).toHaveAttribute('aria-valuenow', '54');
  await page.keyboard.press('ArrowRight');
  await expect(horizontal).toHaveAttribute('aria-valuenow', '54');
  await page.keyboard.press('End'); await minimum();
  await expect(vertical).toHaveAttribute('aria-valuenow', '50');
});

test('reloading with three panes brings back the same tree, ratios, tabs, shown tabs, places and active pane', async ({ page }) => {
  await openThreePanes(page);
  await horizontalTo(page, 4);
  await page.locator('.pane-divider[aria-orientation=vertical]').focus();
  for (let step = 0; step < 5; step++) await page.keyboard.press('ArrowLeft');
  await pick(page, 'b');
  const snapshot = async () => ({
    tree: await treeOf(page),
    active: await workspace(page).getAttribute('data-active'),
    ratios: await page.locator('.pane-divider').evaluateAll(nodes => nodes.map(node => `${node.getAttribute('aria-orientation')}:${node.getAttribute('aria-valuenow')}`)),
    rows: await Promise.all(['a', 'b', 'c'].map(async id => ({ tabs: await row(page, id).locator('.tab-title').allInnerTexts(), shown: await page.locator(`.pane-strip[data-pane=${id}] .tab.is-active .tab-title`).innerText(), where: await shownWhere(page, id).innerText() }))),
  });
  // The places are written a moment after they change.
  await expect.poll(() => page.evaluate(() => Object.entries(localStorage).some(([key, value]) => key.startsWith('hold-my-brief:') && value.startsWith('{') && JSON.parse(value).locator?.page === 4))).toBe(true);
  const before = await snapshot();
  expect(before.active).toBe('b');
  expect(before.tree).toMatchObject({ axis: 'row', first: { pane: 'a' }, second: { axis: 'column', first: { pane: 'b' }, second: { pane: 'c' } } });
  await page.reload();
  for (const id of ['a', 'b', 'c']) await expect(page.locator(`.reader-host[data-pane=${id}]:not(.tab-hidden)`)).toBeVisible();
  await expect(shownWhere(page, 'a')).toHaveText('4 / 8');
  const after = await snapshot();
  expect(after).toEqual(before);
});

async function horizontalTo(page: Page, presses: number) {
  const divider = page.locator('.pane-divider[aria-orientation=horizontal]');
  await divider.focus();
  for (let step = 0; step < presses; step++) await page.keyboard.press('ArrowDown');
}

test('live readers: with four panes and eight tabs at most four readers are live, and every pane\'s shown tab is one of them', async ({ page }) => {
  await page.goto('/');
  const names = Array.from({ length: 8 }, (_, i) => `doc${i + 1}.txt`);
  for (const name of names) {
    await page.locator('#file-input').setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(Array.from({ length: 80 }, (_, i) => `${name} line ${i + 1}`).join('\n')) });
    await expect(page.locator('#filename')).toHaveText(name);
  }
  if (await page.locator('#reader-layout.library-open').count()) await page.keyboard.press('Control+b');
  // Three readers at most, however many tabs are open.
  await expect(page.locator('.reader-host')).toHaveCount(3);
  // doc5 to the right, doc6 to 8 over to it; then doc4 down from the left pane and doc8 down from the right one.
  await page.locator('#tab-list .tab', { hasText: 'doc5.txt' }).click({ button: 'right' });
  await menuItem(page, 'Split right').click();
  // Pressing in a pane that is not the active one makes it so, and its row scrolls to its shown tab: the pane is made active first, or the right-clicks below land on the neighbour that the scroll moves under the pointer.
  await pick(page, 'a');
  for (const name of ['doc6.txt', 'doc7.txt', 'doc8.txt']) {
    await tab(page, 'a', name).click({ button: 'right' });
    await menuItem(page, 'Move to the other side').click();
    await expect(tab(page, 'b', name)).toHaveCount(1);
  }
  await tab(page, 'a', 'doc4.txt').click({ button: 'right' });
  await menuItem(page, 'Split down').click();
  await tab(page, 'b', 'doc8.txt').click({ button: 'right' });
  await menuItem(page, 'Split down').click();
  await expect(page.locator('.pane-strip')).toHaveCount(4);
  expect(await Promise.all(['a', 'b', 'c', 'd'].map(id => row(page, id).count()))).toEqual([3, 3, 1, 1]);
  // Each pane's shown tab comes back by itself, wherever it had gone to sleep, and none of them takes the focus from the pane that was just made.
  await expect(page.locator('.reader-host:not(.tab-hidden)')).toHaveCount(4);
  await expect(workspace(page)).toHaveAttribute('data-active', 'd');
  // Show every tab of the two panes that have several, so each has been read in turn.
  for (const [id, shown] of [['a', ['doc1.txt', 'doc2.txt', 'doc3.txt']], ['b', ['doc5.txt', 'doc6.txt', 'doc7.txt']]] as const) {
    for (const name of shown) {
      await tab(page, id, name).click();
      await expect(page.locator(`.pane-strip[data-pane=${id}] .tab.is-active .tab-title`)).toHaveText(name);
      await expect(page.locator('.reader-host:not(.tab-hidden)')).toHaveCount(4);
    }
  }
  const live = await page.locator('.reader-host').count();
  expect(live).toBeLessThanOrEqual(4);
  for (const id of ['a', 'b', 'c', 'd']) await expect(page.locator(`.reader-host[data-pane=${id}]:not(.tab-hidden)`)).toBeVisible();
  // A hibernated tab comes back where it was when it is shown.
  await tab(page, 'a', 'doc1.txt').click();
  await expect(page.locator('.reader-host[data-pane=a]:not(.tab-hidden)')).toContainText('doc1.txt line 1');
  expect(await page.locator('.reader-host').count()).toBeLessThanOrEqual(4);
});

test('the footer\'s progress line and scrubber span the active pane\'s left and right edges', async ({ page }) => {
  await openThreePanes(page);
  const footer = page.locator('footer');
  for (const id of ['a', 'b', 'c']) {
    await pick(page, id);
    await expect.poll(async () => { const f = await box(footer), p = await box(body(page, id)); return Math.abs(f.x - p.x) + Math.abs(f.x + f.width - (p.x + p.width)); }).toBeLessThan(2);
    const f = await box(footer);
    expect(f.y).toBeGreaterThan(800);
  }
});

test.describe('stills for the pull request', () => {
  test.skip(!process.env.HMB_SHOT, 'writes docs/media/panes-1b-dark.png and panes-1c-dark.png only when HMB_SHOT is set');
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.addInitScript(() => localStorage.setItem('hold-my-brief:appearance', JSON.stringify({ mode: 'dark', palette: 'brief', accent: null, page: 'theme' })));
  });

  test('Brief dark, three panes (1B) and four (1C)', async ({ page }) => {
    await openThreePanes(page);
    await expect(page.locator('.reader-host:not(.tab-hidden)')).toHaveCount(3);
    await expect(page.locator('#loading')).toBeHidden();
    await page.mouse.move(700, 880);
    await page.screenshot({ path: 'docs/media/panes-1b-dark.png', animations: 'disabled' });
    await pick(page, 'a');
    await tab(page, 'a', 'second.pdf').click({ button: 'right' });
    await menuItem(page, 'Split down').click();
    await expect(page.locator('.pane-strip')).toHaveCount(4);
    await pick(page, 'c');
    await expect(page.locator('.reader-host:not(.tab-hidden)')).toHaveCount(4);
    await expect(page.locator('#loading')).toBeHidden();
    await page.mouse.move(700, 880);
    await page.screenshot({ path: 'docs/media/panes-1c-dark.png', animations: 'disabled' });
  });
});
