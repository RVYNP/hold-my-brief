import { test, expect, type Locator, type Page } from '@playwright/test';
import { chapterBook } from './epub-book';
import { pagedPdf } from './paged-pdf';

/** Split view: two documents side by side, a row of tabs per pane, a divider, and the side the commands act on. */

const pdf = { name: 'half-tone.pdf', mimeType: 'application/pdf', buffer: pagedPdf(5) };
const markdown = { name: 'moby.md', mimeType: 'text/markdown', buffer: Buffer.from(['# Moby', '', ...Array.from({ length: 80 }, (_, i) => `Line ${i + 1}: call me Ishmael.`)].join('\n\n')) };
const extra = { name: 'extra.txt', mimeType: 'text/plain', buffer: Buffer.from(Array.from({ length: 60 }, (_, i) => `extra line ${i + 1}`).join('\n')) };

const box = async (locator: Locator) => (await locator.boundingBox())!;
const row = (page: Page, side: 'a' | 'b') => page.locator(`.pane-strip[data-pane=${side}] .tab`);
const barTabs = (page: Page) => page.locator('#tab-list .tab');
const divider = (page: Page) => page.locator('.pane-divider');
const run = async (page: Page, name: string) => { await page.keyboard.press('Control+k'); await page.locator('#palette-input').fill(name); await page.keyboard.press('Enter'); await expect(page.locator('#palette')).toBeHidden(); };
const goTo = async (page: Page, target: string) => {
  await page.keyboard.press('Control+g'); await page.locator('#target').fill(target);
  await page.getByRole('button', { name: 'Go to location', exact: true }).click();
  await expect(page.locator('#jump')).toBeHidden();
};

/** The three documents open (PDF, EPUB, Markdown), the PDF shown, then the EPUB, so the PDF is the one shown most recently besides it. */
async function openThree(page: Page) {
  await page.goto('/');
  const epub = { name: 'pride.epub', mimeType: 'application/epub+zip', buffer: await chapterBook({ chapters: 4, paragraphs: 30 }) };
  for (const [file, format] of [[pdf, 'PDF'], [epub, 'EPUB'], [markdown, 'MD']] as const) {
    await page.locator('#file-input').setInputFiles(file);
    await expect(page.locator('#tab-list .tab.is-active .tab-format')).toHaveText(format);
  }
  await page.locator('#tab-list .tab[data-path]').nth(0).click();
  await expect(page.locator('#position')).toContainText('Page 1 of 5');
  await page.locator('#tab-list .tab[data-path]').nth(1).click();
  await expect(page.locator('#position')).toContainText('%');
}
/** The panel closed, so the icon rail's 48 px is not room for the panes. */
const closeLibrary = async (page: Page) => {
  if (await page.locator('#reader-layout.library-open').count()) await page.keyboard.press('Control+b');
  await expect(page.locator('#reader-layout.library-open')).toHaveCount(0);
};
async function split(page: Page) {
  await openThree(page);
  await run(page, 'Split right');
  await expect(row(page, 'b')).toHaveCount(1);
}

test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 1440, height: 900 }); });

test('Split right moves the shown tab to a new right pane; the others stay on the left', async ({ page }) => {
  await split(page);
  await expect(page.locator('.pane-strip:visible')).toHaveCount(2);
  await expect(row(page, 'b').locator('.tab-format')).toHaveText(['EPUB']);
  await expect(row(page, 'a').locator('.tab-format')).toHaveText(['PDF', 'MD']);
  await expect(barTabs(page)).toHaveCount(0);
  await expect(page.locator('#home-tab')).toBeVisible();
  // Each pane shows its own document, and the divider sits in the middle of the room they share.
  const left = await box(page.locator('.pane-body[data-pane=a]')), right = await box(page.locator('.pane-body[data-pane=b]')), line = await box(divider(page));
  expect(Math.abs(line.x + line.width / 2 - (left.x + (right.x + right.width - left.x) / 2))).toBeLessThanOrEqual(1);
  expect(line.width).toBe(8);
  expect(Math.abs(left.width - right.width)).toBeLessThanOrEqual(1);
  // The right pane's pill is the live one (the EPUB's reading controls); the left pane keeps a pill of its own.
  await expect(page.locator('.pane-body[data-pane=b] #view-controls')).toBeVisible();
  await expect(page.locator('.pane-body[data-pane=a] .pill-ghost')).toBeVisible();
  await expect(page.locator('#view-controls, .pill-ghost')).toHaveCount(2);
  const pdfPage = await box(page.locator('.reader-host[data-pane=a]:not(.tab-hidden)'));
  expect(pdfPage.x + pdfPage.width).toBeLessThanOrEqual(left.x + left.width + .5);
  const book = await box(page.locator('.reader-host[data-pane=b]:not(.tab-hidden)'));
  expect(book.x).toBeGreaterThanOrEqual(right.x - .5);
});

test('the active pane owns find, the shown tab\'s sheen and the progress line', async ({ page }) => {
  await split(page);
  // The EPUB's pane is the active one after the split; its tab carries the sheen, the other pane's shown tab does not.
  const sheen = (side: 'a' | 'b') => page.locator(`.pane-strip[data-pane=${side}] .tab.is-active`).evaluate(tab => getComputedStyle(tab, '::before').display);
  expect(await sheen('b')).not.toBe('none');
  expect(await sheen('a')).toBe('none');
  // Click the left pane and turn pages there.
  await page.locator('.reader-host[data-pane=a]:not(.tab-hidden)').click({ position: { x: 40, y: 200 } });
  await page.keyboard.press('PageDown');
  await expect(page.locator('#position')).toContainText('Page 2 of 5');
  expect(await sheen('a')).not.toBe('none');
  expect(await sheen('b')).toBe('none');
  await page.keyboard.press('Control+f');
  await expect(page.locator('.pane-body[data-pane=a] #find-bar')).toBeVisible();
  await page.locator('#find-query').fill('3');
  await expect(page.locator('#find-status')).toContainText('1');
  // The progress line sits under the left pane while it is active, and under the right one when that is clicked.
  const left = await box(page.locator('.pane-body[data-pane=a]')), right = await box(page.locator('.pane-body[data-pane=b]'));
  let line = await box(page.locator('#progress'));
  expect(line.x).toBeGreaterThanOrEqual(left.x - .5); expect(line.x + line.width).toBeLessThanOrEqual(left.x + left.width + .5);
  await page.locator('.reader-host[data-pane=b]:not(.tab-hidden)').click({ position: { x: 60, y: 200 } });
  await expect(page.locator('#position')).toContainText('%');
  await expect(page.locator('#position')).not.toContainText('Page');
  line = await box(page.locator('#progress'));
  expect(line.x).toBeGreaterThanOrEqual(right.x - .5); expect(line.x + line.width).toBeLessThanOrEqual(right.x + right.width + .5);
  await expect(page.locator('#find-bar')).toBeHidden();
  await expect(page.locator('.pane-body[data-pane=b] #view-controls')).toBeVisible();
});

test('opening a document while split lands in the active pane, and an open one is focused where it is', async ({ page }) => {
  await split(page);
  // A document that is in the library and not open: open it with the right pane active, and it lands in the right row.
  await page.locator('#file-input').setInputFiles(extra);
  await expect(row(page, 'b').locator('.tab-title')).toHaveCount(2);
  await row(page, 'b').last().hover();
  await row(page, 'b').last().locator('.tab-close').click();
  await expect(row(page, 'b').locator('.tab-title')).toHaveCount(1);
  await page.getByRole('treeitem', { name: 'extra.txt' }).click();
  await expect(row(page, 'b').locator('.tab-title')).toHaveText([/./, 'extra.txt']);
  await expect(row(page, 'a').locator('.tab-title')).toHaveCount(2);
  await expect(barTabs(page)).toHaveCount(0);
  // A document that is already open in the other pane is shown there, and that pane becomes the active one.
  await page.getByRole('treeitem', { name: 'moby.md' }).click();
  await expect(page.locator('.pane-strip[data-pane=a] .tab.is-active .tab-title')).toHaveText(/moby/i);
  await expect(row(page, 'a').locator('.tab-title')).toHaveCount(2);
  await expect(page.locator('.pane-strip[data-pane=a]')).not.toHaveClass(/is-inactive/);
});

test('moving a tab to the other side, then closing the split, returns every tab to the top bar left to right', async ({ page }) => {
  await split(page);
  await page.keyboard.press('Control+\\'); // The left pane (the PDF) is the one that moves.
  await expect(page.locator('#workspace')).toHaveAttribute('data-active', 'a');
  await run(page, 'Move tab to the other side');
  await expect(row(page, 'b').locator('.tab-format')).toHaveText(['EPUB', 'PDF']);
  await expect(row(page, 'a').locator('.tab-format')).toHaveText(['MD']);
  await run(page, 'Close the split');
  await expect(page.locator('.pane-strip:visible')).toHaveCount(0);
  await expect(divider(page)).toBeHidden();
  await expect(barTabs(page).locator('.tab-format')).toHaveText(['MD', 'EPUB', 'PDF']);
  await expect(page.locator('#tab-list .tab.is-active .tab-format')).toHaveText('PDF');
  await expect(page.locator('#position')).toContainText('Page 1 of 5');
  // Every pane's host is back in the one reading panel, at its full size.
  const work = await box(page.locator('#workspace')), host = await box(page.locator('.reader-host:not(.staging):not(.tab-hidden)'));
  expect(host.x + host.width).toBeLessThanOrEqual(work.x + work.width + .5);
  expect(host.width).toBeGreaterThan(work.width / 2);
});

test('closing the last tab of a pane ends the split', async ({ page }) => {
  await split(page);
  await row(page, 'b').first().hover();
  await row(page, 'b').first().locator('.tab-close').click();
  await expect(page.locator('.pane-strip:visible')).toHaveCount(0);
  await expect(barTabs(page).locator('.tab-format')).toHaveText(['PDF', 'MD']);
  await expect(page.locator('#tab-list .tab.is-active .tab-format')).toHaveText('PDF');
});

test('a divider moved just before the page goes away is stored by pagehide, without waiting for the drag to rest', async ({ page }) => {
  await split(page);
  const handle = divider(page);
  await handle.focus();
  const stored = await page.evaluate(() => {
    const ratio = () => JSON.parse(localStorage.getItem('hold-my-brief-tabs')!).split.ratio;
    const before = ratio();
    document.querySelector('.pane-divider')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    const unsaved = ratio();
    window.dispatchEvent(new Event('pagehide'));
    return { before, unsaved, after: ratio() };
  });
  expect(stored.unsaved).toBe(stored.before);
  expect(stored.after).toBe(stored.before + 2);
});

test('the divider drags with a snap to 40, 50 and 60 %, resets on a double-click and moves 2 % with the arrows', async ({ page }) => {
  await split(page);
  const handle = divider(page);
  await expect(handle).toHaveAttribute('role', 'separator');
  await expect(handle).toHaveAttribute('aria-orientation', 'vertical');
  await expect(handle).toHaveAttribute('aria-valuenow', '50');
  const left = await box(page.locator('.pane-body[data-pane=a]')), right = await box(page.locator('.pane-body[data-pane=b]'));
  const share = right.x + right.width - left.x - 8;
  const percent = async () => { const at = await box(handle); return Math.round((at.x - left.x) / share * 1000) / 10; };
  // Let go 10 px past the 60 % mark (about 60.7 %): within the snap distance, so it settles on 60.
  const at = await box(handle), y = at.y + at.height / 2, target = left.x + share * .6 + 4 + 10;
  await page.mouse.move(at.x + 4, y); await page.mouse.down(); await page.mouse.move(target, y, { steps: 6 }); await page.mouse.up();
  await expect(handle).toHaveAttribute('aria-valuenow', '60');
  expect(Math.abs(await percent() - 60)).toBeLessThan(.2);
  // Away from the marks it stays where it is let go.
  const free = left.x + share * .65 + 4;
  const now = await box(handle);
  await page.mouse.move(now.x + 4, y); await page.mouse.down(); await page.mouse.move(free, y, { steps: 6 }); await page.mouse.up();
  await expect(handle).toHaveAttribute('aria-valuenow', '65');
  await handle.dblclick();
  await expect(handle).toHaveAttribute('aria-valuenow', '50');
  expect(Math.abs(await percent() - 50)).toBeLessThan(.2);
  await handle.focus();
  await page.keyboard.press('ArrowRight');
  await expect(handle).toHaveAttribute('aria-valuenow', '52');
  expect(Math.abs(await percent() - 52)).toBeLessThan(.2);
  await page.keyboard.press('Home');
  const narrow = await box(page.locator('.pane-body[data-pane=a]'));
  expect(narrow.width).toBeGreaterThanOrEqual(359.5); expect(narrow.width).toBeLessThanOrEqual(360.5);
  await page.keyboard.press('End');
  const wide = await box(page.locator('.pane-body[data-pane=b]'));
  expect(wide.width).toBeGreaterThanOrEqual(359.5); expect(wide.width).toBeLessThanOrEqual(360.5);
});

test('the rail and the docked panel are the same boxes with and without a split', async ({ page }) => {
  await openThree(page);
  const boxes = async () => ({ rail: await box(page.locator('#library-rail')), panel: await box(page.locator('#library-root')), work: await box(page.locator('#workspace')), toolbar: await box(page.locator('.toolbar')) });
  const before = await boxes();
  await run(page, 'Split right');
  await expect(row(page, 'b')).toHaveCount(1);
  const during = await boxes();
  for (const name of ['rail', 'panel', 'work', 'toolbar'] as const) for (const key of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(during[name][key] - before[name][key]), `${name}.${key}`).toBeLessThanOrEqual(.5);
  // The panes divide the reading area beside the panel: the left pane starts where the workspace does.
  const left = await box(page.locator('.pane-body[data-pane=a]'));
  expect(left.x).toBeGreaterThanOrEqual(during.work.x - .5);
  await run(page, 'Close the split');
  await expect(row(page, 'b')).toHaveCount(0);
  const after = await boxes();
  for (const name of ['rail', 'panel', 'work', 'toolbar'] as const) for (const key of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(after[name][key] - before[name][key]), `${name}.${key}`).toBeLessThanOrEqual(.5);
});

test('Home and the Library page take the whole reading area; a pane tab brings the split back as it was', async ({ page }) => {
  await split(page);
  const left = await box(page.locator('.pane-body[data-pane=a]'));
  await page.locator('#home-tab').click();
  await expect(page.locator('#empty')).toBeVisible();
  await expect(page.locator('.reader-host[data-pane=a]:not(.tab-hidden)')).toBeHidden();
  await expect(divider(page)).toBeHidden();
  await expect(page.locator('#home-tab')).toHaveClass(/is-active/);
  // A tab of either pane returns to the split as it was.
  await row(page, 'a').first().click();
  await expect(page.locator('#empty')).toBeHidden();
  await expect(row(page, 'a').locator('.tab-format')).toHaveText(['PDF', 'MD']);
  expect(Math.abs((await box(page.locator('.pane-body[data-pane=a]'))).width - left.width)).toBeLessThanOrEqual(.5);
});

test('Ctrl \\ splits when not split, then moves the focus between the panes', async ({ page }) => {
  await openThree(page);
  await page.keyboard.press('Control+\\');
  await expect(row(page, 'b')).toHaveCount(1);
  await expect(page.locator('#workspace')).toHaveAttribute('data-active', 'b');
  await page.keyboard.press('Control+\\');
  await expect(page.locator('#workspace')).toHaveAttribute('data-active', 'a');
  await expect(page.locator('#position')).toContainText('Page 1 of 5');
  await page.keyboard.press('Control+\\');
  await expect(page.locator('#workspace')).toHaveAttribute('data-active', 'b');
  // Ctrl W closes the active pane's shown tab; Ctrl Tab cycles that pane's tabs.
  await page.keyboard.press('Control+\\');
  await page.keyboard.press('Control+Tab');
  await expect(page.locator('.pane-strip[data-pane=a] .tab.is-active .tab-format')).toHaveText('MD');
});

test('Split right says why it cannot run', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles(pdf);
  await expect(page.locator('#position')).toContainText('Page 1 of 5');
  await page.keyboard.press('Control+k'); await page.locator('#palette-input').fill('Split right');
  await expect(page.locator('#palette-list')).toContainText('Open a second document');
  await page.keyboard.press('Escape');
  await page.locator('#file-input').setInputFiles(markdown);
  await expect(page.locator('#tab-list .tab')).toHaveCount(2);
  await page.setViewportSize({ width: 800, height: 700 });
  await page.keyboard.press('Control+k'); await page.locator('#palette-input').fill('Split right');
  await expect(page.locator('#palette-list')).toContainText('too narrow');
});

test('reloading while split brings the split back with every document at its place', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles(pdf);
  await expect(page.locator('#position')).toContainText('Page 1 of 5');
  await goTo(page, '4');
  await expect(page.locator('#position')).toContainText('Page 4 of 5');
  await page.locator('#file-input').setInputFiles(markdown);
  await expect(page.locator('#tab-list .tab')).toHaveCount(2);
  await run(page, 'Split right');
  await expect(row(page, 'b')).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('hold-my-brief-tabs')!).split?.right.tabs.length)).toBe(1);
  await expect.poll(() => page.evaluate(() => Object.entries(localStorage).some(([key, value]) => key.startsWith('hold-my-brief:') && JSON.parse(value).locator?.page === 4))).toBe(true);
  await page.reload();
  await expect(row(page, 'a').locator('.tab-format')).toHaveText(['PDF']);
  await expect(row(page, 'b').locator('.tab-format')).toHaveText(['MD']);
  await expect(barTabs(page)).toHaveCount(0);
  await page.locator('.reader-host[data-pane=a]:not(.tab-hidden)').click({ position: { x: 40, y: 200 } });
  await expect(page.locator('#position')).toContainText('Page 4 of 5');
});

test('a click on a pane while the split is still restoring keeps that pane active, and the other document still opens at its place', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles(pdf);
  await expect(page.locator('#position')).toContainText('Page 1 of 5');
  await goTo(page, '4');
  await expect(page.locator('#position')).toContainText('Page 4 of 5');
  await page.locator('#file-input').setInputFiles(markdown);
  await expect(page.locator('#tab-list .tab')).toHaveCount(2);
  await goTo(page, '60');
  await expect(page.locator('#position')).toContainText('Moby · ≈34% position');
  await run(page, 'Split right');
  await expect(row(page, 'b')).toHaveCount(1);
  const where = (side: 'a' | 'b') => page.locator(`.pane-strip[data-pane=${side}] .tab.is-active .tab-where`);
  await expect(where('b')).toHaveText('34 %');
  await expect(where('a')).toHaveText('4 / 5');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('hold-my-brief-tabs')!).split?.right.tabs.length)).toBe(1);
  await expect.poll(() => page.evaluate(() => Object.entries(localStorage).filter(([key, value]) => key.startsWith('hold-my-brief:') && /"locator"/.test(value)).length)).toBe(2);
  // The restore opens the PDF pane first and the Markdown pane (the active one) second. Hold the Markdown reader's code back so that the user's click lands in between.
  const { promise: held, resolve: release } = Promise.withResolvers<void>();
  await page.route(/\/(assets\/text-[^/]*\.js|src\/adapters\/text\.ts)/, async route => { await held; await route.continue(); });
  await page.reload();
  await expect(where('a')).toHaveText('4 / 5');
  await page.locator('.reader-host[data-pane=a]:not(.tab-hidden)').click({ position: { x: 40, y: 200 } });
  await expect(page.locator('#position')).toContainText('Page 4 of 5');
  release();
  await expect(where('b')).toHaveText('34 %');
  await expect(page.locator('#position')).toContainText('Page 4 of 5');
  await expect(page.locator('.pane-strip[data-pane=a]')).not.toHaveClass(/is-inactive/);
  await expect(page.locator('.pane-strip[data-pane=b]')).toHaveClass(/is-inactive/);
  await expect(page.locator('.reader-host[data-pane=a]:not(.tab-hidden)')).toBeFocused();
});

test('a press on a pane whose document has not mounted yet still makes that pane the active one', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles(pdf);
  await expect(page.locator('#position')).toContainText('Page 1 of 5');
  await goTo(page, '4');
  await expect(page.locator('#position')).toContainText('Page 4 of 5');
  await page.locator('#file-input').setInputFiles(markdown);
  await expect(page.locator('#tab-list .tab')).toHaveCount(2);
  await goTo(page, '60');
  await expect(page.locator('#position')).toContainText('Moby · ≈34% position');
  await run(page, 'Split right');
  await expect(row(page, 'b')).toHaveCount(1);
  const where = (side: 'a' | 'b') => page.locator(`.pane-strip[data-pane=${side}] .tab.is-active .tab-where`);
  await expect(where('b')).toHaveText('34 %');
  await expect(where('a')).toHaveText('4 / 5');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('hold-my-brief-tabs')!).split?.right.tabs.length)).toBe(1);
  await expect.poll(() => page.evaluate(() => Object.entries(localStorage).filter(([key, value]) => key.startsWith('hold-my-brief:') && /"locator"/.test(value)).length)).toBe(2);
  // The restore opens the PDF pane first. Hold the PDF reader's code back: its pane is empty, with nothing in it to press, until the chunk arrives.
  const { promise: held, resolve: release } = Promise.withResolvers<void>();
  await page.route(/\/(assets\/pdf-[^/]*\.js|src\/adapters\/pdf\.ts)/, async route => { await held; await route.continue(); });
  await page.reload();
  await expect(row(page, 'a').locator('.tab-format')).toHaveText(['PDF']);
  await expect(row(page, 'b').locator('.tab-format')).toHaveText(['MD']);
  const area = await box(page.locator('.pane-body[data-pane=a]'));
  const x = area.x + area.width / 2, y = area.y + area.height / 2;
  // What the press meets is the workspace itself: no reading surface of the pane exists yet.
  expect(await page.evaluate(([px, py]) => document.elementFromPoint(px, py)?.id, [x, y])).toBe('workspace');
  await page.mouse.click(x, y);
  release();
  await expect(where('a')).toHaveText('4 / 5');
  await expect(where('b')).toHaveText('34 %');
  await expect(page.locator('#workspace')).toHaveAttribute('data-active', 'a');
  await expect(page.locator('#position')).toContainText('Page 4 of 5');
  await expect(page.locator('.pane-strip[data-pane=b]')).toHaveClass(/is-inactive/);
  await expect(page.locator('.reader-host[data-pane=a]:not(.tab-hidden)')).toBeFocused();
});

test('the icon rail\'s room is not counted: a 760 px window with the panel closed is too narrow to split', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles(pdf);
  await expect(page.locator('#position')).toContainText('Page 1 of 5');
  await page.locator('#file-input').setInputFiles(markdown);
  await expect(page.locator('#tab-list .tab')).toHaveCount(2);
  await closeLibrary(page);
  await page.setViewportSize({ width: 760, height: 800 });
  await page.keyboard.press('Control+k'); await page.locator('#palette-input').fill('Split right');
  await expect(page.locator('#palette-list')).toContainText('too narrow');
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 800, height: 800 });
  await page.keyboard.press('Control+k'); await page.locator('#palette-input').fill('Split right');
  await expect(page.locator('#palette-list')).not.toContainText('too narrow');
});

test('a divider moved to the limit keeps both panes at 360 px when the window shrinks', async ({ page }) => {
  await split(page);
  await closeLibrary(page);
  const handle = divider(page);
  await handle.focus();
  await page.keyboard.press('End');
  await page.setViewportSize({ width: 1000, height: 900 });
  await expect(page.locator('#workspace')).not.toHaveClass(/is-single/);
  for (const side of ['a', 'b']) await expect.poll(async () => (await box(page.locator(`.pane-body[data-pane=${side}]`))).width, { message: side }).toBeGreaterThanOrEqual(359.5);
  // The place the user set comes back when there is room again.
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect.poll(async () => (await box(page.locator('.pane-body[data-pane=b]'))).width).toBeLessThan(359.5 + 1);
});

test('a window that shrinks while split shows the active pane only', async ({ page }) => {
  await split(page);
  await page.setViewportSize({ width: 800, height: 700 });
  await expect(page.locator('#workspace')).toHaveClass(/is-single/);
  await expect(page.locator('.reader-host[data-pane=a]:not(.tab-hidden)')).toBeHidden();
  const work = await box(page.locator('#workspace')), shown = await box(page.locator('.reader-host[data-pane=b]:not(.tab-hidden)'));
  expect(shown.width).toBeGreaterThan(work.width - 60);
  await page.keyboard.press('Control+\\');
  await expect(page.locator('.reader-host[data-pane=a]:not(.tab-hidden)')).toBeVisible();
  await expect(page.locator('.reader-host[data-pane=b]:not(.tab-hidden)')).toBeHidden();
});

test('a library row dragged onto a pane\'s row or reading surface opens in that pane', async ({ page }) => {
  await split(page);
  await page.locator('#file-input').setInputFiles(extra);
  await expect(row(page, 'b').locator('.tab-title')).toHaveCount(2);
  const closeExtra = async () => { await row(page, 'b').last().hover(); await row(page, 'b').last().locator('.tab-close').click(); await expect(row(page, 'b').locator('.tab-title')).toHaveCount(1); };
  await closeExtra();
  const source = page.locator('#library-root .tree-row.is-document', { hasText: 'extra.txt' });
  const drag = async (to: { x: number; y: number }) => {
    const from = await box(source);
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2); await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2 + 40, from.y + from.height / 2, { steps: 4 });
    await page.mouse.move(to.x, to.y, { steps: 10 });
    await page.mouse.up();
  };
  // Onto the right pane's row, past its last tab: the document opens at the end of that row.
  const rightRow = await box(page.locator('.pane-strip[data-pane=b]'));
  await drag({ x: rightRow.x + rightRow.width - 20, y: rightRow.y + rightRow.height / 2 });
  await expect(row(page, 'b').locator('.tab-title')).toHaveText([/./, 'extra.txt']);
  await closeExtra();
  // Onto the left pane's reading surface: it opens in the left pane, which becomes the active one.
  const leftBody = await box(page.locator('.pane-body[data-pane=a]'));
  await drag({ x: leftBody.x + leftBody.width / 2, y: leftBody.y + leftBody.height / 2 });
  await expect(row(page, 'a').locator('.tab-title')).toHaveText(['half-tone.pdf', 'extra.txt', 'moby.md']); // After the tab being read, as a drop on a single reading area does.
  await expect(page.locator('#workspace')).toHaveAttribute('data-active', 'a');
  await expect(row(page, 'b').locator('.tab-title')).toHaveCount(1);
});

test('the Library tab stays in the top bar while split, covers the panes, and closing it brings the split back', async ({ page }) => {
  await split(page);
  const left = await box(page.locator('.pane-body[data-pane=a]'));
  await page.locator('#library-root').getByRole('button', { name: 'Library', exact: true }).click();
  await expect(page.locator('#library-page')).toBeVisible();
  await expect(barTabs(page)).toHaveCount(1);
  await expect(page.locator('#tab-list .tab[data-kind=library]')).toHaveClass(/is-active/);
  await expect(page.locator('.reader-host[data-pane=b]:not(.tab-hidden)')).toBeHidden();
  await expect(row(page, 'a')).toHaveCount(2);
  await row(page, 'b').first().click();
  await expect(page.locator('#library-page')).toBeHidden();
  await expect(page.locator('#workspace')).toHaveAttribute('data-active', 'b');
  expect(Math.abs((await box(page.locator('.pane-body[data-pane=a]'))).width - left.width)).toBeLessThanOrEqual(.5);
  // With the split ended, the Library tab leads the strip again.
  await run(page, 'Close the split');
  await expect(barTabs(page).first()).toHaveAttribute('data-kind', 'library');
  await expect(barTabs(page)).toHaveCount(4);
});

test('each pane\'s zoom label follows its own page through a split, a divider drag, a dock and a window resize', async ({ page }) => {
  const second = { name: 'second.pdf', mimeType: 'application/pdf', buffer: pagedPdf(6) };
  await page.goto('/');
  for (const [file, count] of [[pdf, 1], [second, 2]] as const) {
    await page.locator('#file-input').setInputFiles(file);
    await expect(page.locator('#tab-list .tab[data-path]')).toHaveCount(count);
    await expect(page.locator('#tab-list .tab.is-active')).toContainText(file.name.replace('.pdf', ''));
  }
  await expect(page.locator('#position')).toContainText('Page 1 of 6');
  // 0 while the page is being redrawn (it is replaced, not resized).
  const pageWidth = async (side: 'a' | 'b') => (await page.locator(`.reader-host[data-pane=${side}]:not(.tab-hidden) .pdf-page`).first().boundingBox({ timeout: 1000 }).catch(() => null))?.width ?? 0;
  const label = async (text: string) => Number(/(\d+)\s*%/.exec(text)![1]) / 100;
  const live = async () => label((await page.locator('#zoom-level span').textContent())!);
  const still = async (side: 'a' | 'b') => label((await page.locator(`.pane-body[data-pane=${side}] .pill-ghost [data-was=zoom-level] span`).textContent())!);
  // The page's width at 100 %, read once from the unsplit page: every later label must give the same figure from the width on screen.
  const full = (await pageWidth('a')) / await live();
  const agree = async (side: 'a' | 'b', read: () => Promise<number>, step: string) => {
    await expect.poll(async () => Math.abs((await pageWidth(side)) / await read() / full - 1), { message: `${side}: ${step}`, timeout: 5000 }).toBeLessThan(.01);
  };
  // A page is redrawn a moment after its pane changes size: wait until the widths read the same twice running, then compare.
  const settle = async (sides: ('a' | 'b')[] = ['a', 'b']) => {
    let last = '';
    await expect.poll(async () => { const now = (await Promise.all(sides.map(pageWidth))).join(':'); const held = now === last; last = now; return held; }, { intervals: [100, 100, 100, 200, 200], timeout: 10000 }).toBe(true);
  };
  const both = async (step: string) => {
    await settle();
    await agree('b', live, `live, ${step}`);
    await agree('a', () => still('a'), `still, ${step}`);
  };
  await run(page, 'Split right');
  await expect(row(page, 'b')).toHaveCount(1);
  await both('after the split');
  await page.keyboard.press('Control+b');
  await both('library docked');
  const handle = divider(page), at = await box(handle);
  await page.mouse.move(at.x + 4, at.y + at.height / 2); await page.mouse.down(); await page.mouse.move(at.x + 4 + 150, at.y + at.height / 2, { steps: 6 }); await page.mouse.up();
  await both('after a divider drag');
  await handle.focus(); await page.keyboard.press('Home');
  await both('divider at the left limit');
  await page.keyboard.press('End');
  await both('divider at the right limit');
  await handle.dblclick();
  await both('after a snap back to 50 %');
  await page.keyboard.press('Control+b');
  await both('library closed');
  await page.setViewportSize({ width: 1100, height: 800 });
  await both('window resized');
  await run(page, 'Close the split');
  await expect(row(page, 'b')).toHaveCount(0);
  await settle(['a']);
  await agree('a', live, 'split ended');
});

// A still, not a check: `HMB_SHOT=1 npx playwright test e2e/split.spec.ts -g "split view still"` writes docs/media/split-view.png (Brief, light, 1440 × 900; documents built by the fixtures).
test('split view still', async ({ page }) => {
  test.skip(!process.env.HMB_SHOT, 'writes docs/media/split-view.png only when HMB_SHOT is set');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.addInitScript(() => localStorage.setItem('hold-my-brief:appearance', JSON.stringify({ mode: 'system', palette: 'brief', accent: null, page: 'theme' })));
  await split(page);
  await page.locator('.reader-host[data-pane=a]:not(.tab-hidden)').click({ position: { x: 40, y: 200 } });
  await page.keyboard.press('PageDown');
  await expect(page.locator('#position')).toContainText('Page 2 of 5');
  await page.mouse.move(700, 880);
  await page.screenshot({ path: 'docs/media/split-view.png' });
});
