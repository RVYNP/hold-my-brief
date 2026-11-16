import { test, expect, type Locator, type Page } from '@playwright/test';
import { chapterBook } from './epub-book';
import { pagedPdf } from './paged-pdf';

/** Split view, second half: the right-click menus (tabs, the library tree, Home), folding when the reading area is too narrow for two panes, and the split coming back after a restart. */

const pdf = { name: 'half-tone.pdf', mimeType: 'application/pdf', buffer: pagedPdf(5) };
const markdown = { name: 'moby.md', mimeType: 'text/markdown', buffer: Buffer.from(['# Moby', '', ...Array.from({ length: 80 }, (_, i) => `Line ${i + 1}: call me Ishmael.`)].join('\n\n')) };
const extra = { name: 'extra.txt', mimeType: 'text/plain', buffer: Buffer.from(Array.from({ length: 60 }, (_, i) => `extra line ${i + 1}`).join('\n')) };

const box = async (locator: Locator) => (await locator.boundingBox())!;
const row = (page: Page, side: 'a' | 'b') => page.locator(`.pane-strip[data-pane=${side}] .tab`);
const barTabs = (page: Page) => page.locator('#tab-list .tab');
const workspace = (page: Page) => page.locator('#workspace');
const menuItem = (page: Page, name: string) => page.getByRole('menuitem', { name, exact: true });
const run = async (page: Page, name: string) => { await page.keyboard.press('Control+k'); await page.locator('#palette-input').fill(name); await page.keyboard.press('Enter'); await expect(page.locator('#palette')).toBeHidden(); };
const goTo = async (page: Page, target: string) => {
  await page.keyboard.press('Control+g'); await page.locator('#target').fill(target);
  await page.getByRole('button', { name: 'Go to location', exact: true }).click();
  await expect(page.locator('#jump')).toBeHidden();
};
/** The library panel closed (the icon rail's room is not room for panes), or open. */
const setLibrary = async (page: Page, open: boolean) => {
  if ((await page.locator('#reader-layout.library-open').count() > 0) !== open) await page.keyboard.press('Control+b');
  await expect(page.locator('#reader-layout.library-open')).toHaveCount(open ? 1 : 0);
};

/** The PDF, an EPUB and a Markdown file open, the PDF shown first, then the EPUB: the same start as split.spec.ts. */
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
/** Three documents open and split with the EPUB on the right (the library panel is as the window's width leaves it). */
async function openSplit(page: Page) {
  await openThree(page);
  await run(page, 'Split right');
  await expect(row(page, 'b')).toHaveCount(1);
}

for (const size of [{ width: 1440, height: 900 }, { width: 1080, height: 760 }]) {
  test.describe(`${size.width} × ${size.height}`, () => {
    test.beforeEach(async ({ page }) => { await page.setViewportSize(size); });

    test('right-click a tab ▸ Split right gives what the palette\'s Split right gives', async ({ page }) => {
      await openThree(page);
      await setLibrary(page, false);
      await barTabs(page).filter({ has: page.locator('.tab-format', { hasText: 'EPUB' }) }).click({ button: 'right' });
      await expect(page.getByRole('menuitem')).toHaveText(['Split right', 'Close']);
      await menuItem(page, 'Split right').click();
      await expect(row(page, 'b').locator('.tab-format')).toHaveText(['EPUB']);
      await expect(row(page, 'a').locator('.tab-format')).toHaveText(['PDF', 'MD']);
      await expect(barTabs(page)).toHaveCount(0);
      await expect(workspace(page)).toHaveAttribute('data-active', 'b');
      await expect(page.locator('.pane-body[data-pane=b] #view-controls')).toBeVisible();
      const left = await box(page.locator('.pane-body[data-pane=a]')), right = await box(page.locator('.pane-body[data-pane=b]'));
      expect(Math.abs(left.width - right.width)).toBeLessThanOrEqual(1);
    });

    test('right-clicking a tab that is not the one showing splits that tab off, and Close closes it', async ({ page }) => {
      await openThree(page);
      await setLibrary(page, false);
      await barTabs(page).filter({ has: page.locator('.tab-format', { hasText: 'MD' }) }).click({ button: 'right' });
      await menuItem(page, 'Split right').click();
      await expect(row(page, 'b').locator('.tab-format')).toHaveText(['MD']);
      await expect(row(page, 'a').locator('.tab-format')).toHaveText(['PDF', 'EPUB']);
      // While split the tab's menu is Move to the other side, Close and Close the split.
      await row(page, 'a').first().click({ button: 'right' });
      await expect(page.getByRole('menuitem')).toHaveText(['Move to the other side', 'Close', 'Close the split']);
      await menuItem(page, 'Move to the other side').click();
      await expect(row(page, 'b').locator('.tab-format')).toHaveText(['MD', 'PDF']);
      await expect(row(page, 'a').locator('.tab-format')).toHaveText(['EPUB']);
      await row(page, 'b').first().click({ button: 'right' });
      await menuItem(page, 'Close').click();
      await expect(row(page, 'b').locator('.tab-format')).toHaveText(['PDF']);
      await row(page, 'a').first().click({ button: 'right' });
      await menuItem(page, 'Close the split').click();
      await expect(page.locator('.pane-strip:visible')).toHaveCount(0);
      await expect(barTabs(page).locator('.tab-format')).toHaveText(['EPUB', 'PDF']);
    });

    test('Split right is disabled in a tab\'s menu with one document, and says why', async ({ page }) => {
      await page.goto('/');
      await page.locator('#file-input').setInputFiles(pdf);
      await expect(page.locator('#position')).toContainText('Page 1 of 5');
      await setLibrary(page, false);
      await barTabs(page).first().click({ button: 'right' });
      await expect(menuItem(page, 'Split right')).toBeDisabled();
      await expect(menuItem(page, 'Split right')).toHaveAttribute('title', 'Open a second document to split');
      await expect(menuItem(page, 'Close')).toBeEnabled();
    });

    test('Shift+F10 on a focused tab opens its menu and Escape closes it, returning to the tab', async ({ page }) => {
      await openThree(page);
      await setLibrary(page, false);
      const tab = barTabs(page).nth(1);
      await tab.focus();
      await page.keyboard.press('Shift+F10');
      await expect(menuItem(page, 'Split right')).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('menu')).toHaveCount(0);
      await expect(tab).toBeFocused();
      await page.keyboard.press('ContextMenu');
      await expect(menuItem(page, 'Close')).toBeVisible();
      await page.keyboard.press('ArrowDown');
      await expect(menuItem(page, 'Close')).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('menu')).toHaveCount(0);
      // The same keys work on a pane's row.
      await tab.press('Enter');
      await run(page, 'Split right');
      await row(page, 'a').first().focus();
      await page.keyboard.press('Shift+F10');
      await expect(page.getByRole('menuitem')).toHaveText(['Move to the other side', 'Close', 'Close the split']);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('menu')).toHaveCount(0);
      await expect(row(page, 'a').first()).toBeFocused();
    });

    test('right-click a Home card ▸ Open in split right puts that document on the right, the others on the left', async ({ page }) => {
      await openThree(page);
      await page.locator('#file-input').setInputFiles(extra);
      await expect(page.locator('#tab-list .tab.is-active .tab-format')).toHaveText('TXT');
      await setLibrary(page, false);
      await barTabs(page).last().hover();
      await barTabs(page).last().locator('.tab-close').click();
      await page.locator('#home-tab').click();
      const card = page.locator('.home-open', { hasText: 'extra' }).first();
      await card.click({ button: 'right' });
      await expect(page.getByRole('menuitem')).toHaveText(['Open', 'Open in split right']);
      await menuItem(page, 'Open in split right').click();
      await expect(row(page, 'b').locator('.tab-title')).toHaveText(['extra.txt']);
      await expect(row(page, 'a').locator('.tab-format')).toHaveText(['PDF', 'EPUB', 'MD']);
      await expect(page.locator('.pane-body[data-pane=b]')).toBeVisible();
      await expect(page.locator('#empty')).toBeHidden();
      await expect(page.locator('.reader-host[data-pane=b]:not(.tab-hidden)')).toBeVisible();
    });

    test('Home\'s menu keys work, its Open opens the document, and Open in split right is disabled with no document open', async ({ page }) => {
      await page.goto('/');
      await page.locator('#file-input').setInputFiles(pdf);
      await expect(page.locator('#position')).toContainText('Page 1 of 5');
      await setLibrary(page, false);
      await barTabs(page).first().hover();
      await barTabs(page).first().locator('.tab-close').click();
      await expect(page.locator('#empty.is-home')).toBeVisible();
      const card = page.locator('.home-open', { hasText: 'half-tone' }).first();
      await card.focus();
      await page.keyboard.press('Shift+F10');
      await expect(menuItem(page, 'Open in split right')).toBeDisabled();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('menu')).toHaveCount(0);
      await expect(card).toBeFocused();
      await card.click({ button: 'right' });
      await menuItem(page, 'Open').click();
      await expect(barTabs(page).locator('.tab-title')).toHaveText(['half-tone.pdf']);
    });
  });
}

test.describe('1440 × 900', () => {
  test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 1440, height: 900 }); });

  test('right-click a library tree row ▸ Open in split right puts that document in the right pane', async ({ page }) => {
    await openThree(page);
    await page.locator('#file-input').setInputFiles(extra);
    await expect(page.locator('#tab-list .tab.is-active .tab-format')).toHaveText('TXT');
    await barTabs(page).last().hover();
    await barTabs(page).last().locator('.tab-close').click();
    await setLibrary(page, true);
    await page.getByRole('treeitem', { name: 'extra.txt' }).click({ button: 'right' });
    await expect(menuItem(page, 'Open in split right')).toBeEnabled();
    await menuItem(page, 'Open in split right').click();
    await expect(row(page, 'b').locator('.tab-title')).toHaveText(['extra.txt']);
    await expect(row(page, 'a').locator('.tab-format')).toHaveText(['PDF', 'EPUB', 'MD']);
    await expect(workspace(page)).toHaveAttribute('data-active', 'b');
    // With the split open the next one goes to the right pane too, and a document open on the left crosses over.
    await page.getByRole('treeitem', { name: 'moby.md' }).click({ button: 'right' });
    await menuItem(page, 'Open in split right').click();
    await expect(row(page, 'b').locator('.tab-title')).toHaveText(['extra.txt', 'moby.md']);
    await expect(row(page, 'a').locator('.tab-format')).toHaveText(['PDF', 'EPUB']);
  });

  test('a tree row of a document that is already open is moved to the right pane, not opened twice', async ({ page }) => {
    await openThree(page);
    await setLibrary(page, true);
    await page.getByRole('treeitem', { name: 'moby.md' }).click({ button: 'right' });
    await menuItem(page, 'Open in split right').click();
    await expect(row(page, 'b').locator('.tab-format')).toHaveText(['MD']);
    await expect(row(page, 'a').locator('.tab-format')).toHaveText(['PDF', 'EPUB']);
    await expect(page.locator('.pane-strip[data-pane=b] .tab.is-active .tab-format')).toHaveText('MD');
  });

  test('the tree\'s Open in split right is disabled while no other document is open', async ({ page }) => {
    await page.goto('/');
    await page.locator('#file-input').setInputFiles(pdf);
    await expect(page.locator('#position')).toContainText('Page 1 of 5');
    await setLibrary(page, true);
    await page.getByRole('treeitem', { name: 'half-tone.pdf' }).click({ button: 'right' });
    await expect(menuItem(page, 'Open in split right')).toBeDisabled();
    await page.keyboard.press('Escape');
  });

  test('Escape closes the tree row\'s menu, and Shift+F10 opens it from the keyboard', async ({ page }) => {
    await openThree(page);
    await setLibrary(page, true);
    const rowItem = page.getByRole('treeitem', { name: 'moby.md' });
    await rowItem.focus();
    await page.keyboard.press('Shift+F10');
    await expect(menuItem(page, 'Open in new tab')).toBeFocused();
    await expect(menuItem(page, 'Open in split right')).toBeEnabled();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(rowItem).toBeFocused();
  });
});

test.describe('1080 × 760', () => {
  test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 1080, height: 760 }); });

  /** The library panel at 340 px (the default is 280): 1080 less the panel and its margin is then under the 728 px two panes need. */
  const widePanel = (page: Page) => page.addInitScript(() => localStorage.setItem('hold-my-brief:library-width', '340'));

  test('docking the library folds the split to the active pane, "Other side" swaps the panes, and closing the library unfolds it', async ({ page }) => {
    await widePanel(page);
    await openThree(page);
    await setLibrary(page, false);
    await run(page, 'Split right');
    await expect(row(page, 'b')).toHaveCount(1);
    await expect(workspace(page)).not.toHaveClass(/is-single/);
    await expect(page.getByRole('button', { name: /Other side/ })).toHaveCount(0);
    await expect(page.locator('.pane-divider')).toBeVisible();
    await setLibrary(page, true);
    await expect(workspace(page)).toHaveClass(/is-single/);
    await expect(page.locator('.pane-divider')).toBeHidden();
    // The active pane (the EPUB's, on the right) is the one that shows; its row ends with the button, which counts the other side's tabs.
    const fold = page.getByRole('button', { name: /Other side/ });
    await expect(fold).toBeVisible();
    await expect(fold).toHaveText('⫴ Other side (2)');
    await expect(page.locator('.pane-strip[data-pane=a]')).toBeHidden();
    await expect(page.locator('.reader-host[data-pane=b]:not(.tab-hidden)')).toBeVisible();
    await expect(page.locator('.reader-host[data-pane=a]:not(.tab-hidden)')).toBeHidden();
    const shown = await box(page.locator('.pane-body[data-pane=b]'));
    expect(shown.width).toBeGreaterThan(360);
    await fold.click();
    await expect(workspace(page)).toHaveAttribute('data-active', 'a');
    await expect(page.locator('.reader-host[data-pane=a]:not(.tab-hidden)')).toBeVisible();
    await expect(page.locator('.reader-host[data-pane=b]:not(.tab-hidden)')).toBeHidden();
    await expect(page.locator('#position')).toContainText('Page 1 of 5');
    await expect(page.getByRole('button', { name: /Other side/ })).toHaveText('⫴ Other side (1)');
    await expect(page.locator('.pane-strip[data-pane=b]')).toBeHidden();
    // The library's room back: both panes unfold by themselves.
    await setLibrary(page, false);
    await expect(workspace(page)).not.toHaveClass(/is-single/);
    await expect(page.getByRole('button', { name: /Other side/ })).toBeHidden();
    await expect(page.locator('.pane-divider')).toBeVisible();
    await expect(page.locator('.reader-host[data-pane=a]:not(.tab-hidden)')).toBeVisible();
    await expect(page.locator('.reader-host[data-pane=b]:not(.tab-hidden)')).toBeVisible();
  });

  test('a folded split\'s menus: the tree opens a document in the right pane, which then shows', async ({ page }) => {
    await widePanel(page);
    await openThree(page);
    await setLibrary(page, false);
    await run(page, 'Split right');
    await expect(row(page, 'b')).toHaveCount(1);
    await page.locator('#file-input').setInputFiles(extra);
    await expect(row(page, 'b').locator('.tab-title')).toHaveCount(2);
    await row(page, 'b').last().hover();
    await row(page, 'b').last().locator('.tab-close').click();
    await setLibrary(page, true);
    await expect(workspace(page)).toHaveClass(/is-single/);
    await page.getByRole('treeitem', { name: 'extra.txt' }).click({ button: 'right' });
    await expect(menuItem(page, 'Open in split right')).toBeEnabled();
    await menuItem(page, 'Open in split right').click();
    await expect(workspace(page)).toHaveAttribute('data-active', 'b');
    await expect(page.locator('.pane-strip[data-pane=b] .tab.is-active .tab-title')).toHaveText('extra.txt');
    await expect(page.getByRole('button', { name: /Other side/ })).toHaveText('⫴ Other side (2)');
  });
});

test.describe('700 × 760', () => {
  test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 700, height: 760 }); });

  test('Split right is disabled in every menu', async ({ page }) => {
    await page.goto('/');
    for (const [file, count] of [[pdf, '1'], [markdown, '2']] as const) {
      await page.locator('#file-input').setInputFiles(file);
      await expect(page.locator('#tab-count')).toHaveText(count);
    }
    // The compact window's list of tabs: a row's menu.
    await page.locator('#title').click();
    await page.locator('#tab-menu .tab-menu-row', { hasText: 'half-tone' }).click({ button: 'right' });
    await expect(menuItem(page, 'Split right')).toBeDisabled();
    await expect(menuItem(page, 'Split right')).toHaveAttribute('title', 'The window is too narrow to split');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    // The library's row (the panel is a sheet at this width).
    await page.locator('#library-toggle').click();
    await page.getByRole('treeitem', { name: 'half-tone.pdf' }).click({ button: 'right' });
    await expect(menuItem(page, 'Open in split right')).toBeDisabled();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    // Home's card.
    await page.locator('#title').click();
    await page.locator('#tab-menu .tab-menu-row', { hasText: 'Home' }).click();
    await page.locator('.home-open', { hasText: 'moby' }).first().click({ button: 'right' });
    await expect(menuItem(page, 'Open in split right')).toBeDisabled();
    await expect(menuItem(page, 'Open')).toBeEnabled();
    // The palette's command says the same, from a document.
    await page.keyboard.press('Escape');
    await page.locator('#title').click();
    await page.locator('#tab-menu .tab-menu-row', { hasText: 'half-tone' }).click();
    await page.keyboard.press('Control+k'); await page.locator('#palette-input').fill('Split right');
    await expect(page.locator('#palette-list')).toContainText('too narrow');
    await page.keyboard.press('Escape');
    await expect(page.locator('.pane-strip:visible')).toHaveCount(0);
  });
});

test.describe('the split after a restart', () => {
  test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 1440, height: 900 }); });

  test('reloading brings back the split: both rows, the ratio, the active pane and every shown document\'s place', async ({ page }) => {
    await openThree(page);
    await setLibrary(page, false);
    // The PDF on the left at page 4 (it was the left pane's first tab), the EPUB split off to the right.
    await page.locator('#tab-list .tab[data-path]').nth(0).click();
    await goTo(page, '4');
    await expect(page.locator('#position')).toContainText('Page 4 of 5');
    await page.locator('#tab-list .tab[data-path]').nth(1).click();
    await run(page, 'Split right');
    await expect(row(page, 'b').locator('.tab-format')).toHaveText(['EPUB']);
    await goTo(page, '50%');
    await expect(page.locator('#position')).toContainText('50');
    const epubPlace = await page.locator('#position').textContent();
    // The divider to 56 %, then the left pane active again.
    await page.locator('.pane-divider').focus();
    for (let step = 0; step < 3; step++) await page.keyboard.press('ArrowRight');
    await expect(page.locator('.pane-divider')).toHaveAttribute('aria-valuenow', '56');
    await page.locator('.reader-host[data-pane=a]:not(.tab-hidden)').click({ position: { x: 40, y: 200 } });
    await expect(workspace(page)).toHaveAttribute('data-active', 'a');
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('hold-my-brief-tabs')!).split?.active)).toBe('left');
    await expect.poll(() => page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith('hold-my-brief:')).some(([, value]) => { try { return JSON.parse(value).locator?.page === 4; } catch { return false; } }))).toBe(true);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('hold-my-brief-tabs')!));
    expect(stored.split).toMatchObject({ ratio: 56, active: 'left', left: { tabs: expect.arrayContaining([expect.any(String)]) }, right: { tabs: [expect.stringContaining('pride')] } });

    await page.reload();
    await expect(row(page, 'a').locator('.tab-format')).toHaveText(['PDF', 'MD']);
    await expect(row(page, 'b').locator('.tab-format')).toHaveText(['EPUB']);
    await expect(barTabs(page)).toHaveCount(0);
    await expect(workspace(page)).toHaveClass(/is-split/);
    await expect(page.locator('.pane-divider')).toHaveAttribute('aria-valuenow', '56');
    await expect(workspace(page)).toHaveAttribute('data-active', 'a');
    // Both shown documents are open again where they were: the PDF's page here, the EPUB's place after the focus moves to its pane.
    await expect(page.locator('#position')).toContainText('Page 4 of 5');
    await expect(page.locator('.reader-host[data-pane=a]:not(.tab-hidden)')).toBeVisible();
    await expect(page.locator('.reader-host[data-pane=b]:not(.tab-hidden)')).toBeVisible();
    await expect(page.locator('.pane-strip[data-pane=a] .tab.is-active .tab-format')).toHaveText('PDF');
    await expect(page.locator('.pane-strip[data-pane=b] .tab.is-active .tab-format')).toHaveText('EPUB');
    await expect(row(page, 'b').locator('.tab-where')).not.toHaveText('');
    await page.locator('.reader-host[data-pane=b]:not(.tab-hidden)').click({ position: { x: 60, y: 200 } });
    await expect(workspace(page)).toHaveAttribute('data-active', 'b');
    await expect(page.locator('#position')).toHaveText(epubPlace!);
    // The tab that was not shown opens at its place when selected, as it does without a split.
    await row(page, 'a').filter({ hasText: 'moby' }).click();
    await expect(page.locator('#position')).toContainText('%');
    // The split can still be closed after a restart.
    await run(page, 'Close the split');
    await expect(barTabs(page).locator('.tab-format')).toHaveText(['PDF', 'MD', 'EPUB']);
  });

  test('a restored split keeps the right pane active, and the Library tab stays in the top bar', async ({ page }) => {
    await openSplit(page);
    await setLibrary(page, false);
    await page.locator('#library-rail').getByRole('button', { name: /Library/ }).first().click();
    await page.locator('#library-root').getByRole('button', { name: 'Library', exact: true }).click();
    await expect(page.locator('#library-page')).toBeVisible();
    await expect(barTabs(page)).toHaveCount(1);
    await row(page, 'b').first().click();
    await expect(workspace(page)).toHaveAttribute('data-active', 'b');
    const shownFormat = () => page.evaluate(() => { const saved = JSON.parse(localStorage.getItem('hold-my-brief-tabs')!); return saved.tabs[saved.active]?.format ?? null; });
    await expect.poll(shownFormat).toBe('epub');
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('hold-my-brief-tabs')!).split?.active)).toBe('right');
    await page.reload();
    await expect(row(page, 'b').locator('.tab-format')).toHaveText(['EPUB']);
    await expect(workspace(page)).toHaveAttribute('data-active', 'b');
    await expect(barTabs(page)).toHaveCount(1);
    await expect(barTabs(page).first()).toHaveAttribute('data-kind', 'library');
    await expect(page.locator('#library-page')).toBeHidden();
    // The Library page covering the panes comes back covering them, and a pane's tab brings the split back.
    await barTabs(page).first().click();
    await expect(page.locator('#library-page')).toBeVisible();
    await expect.poll(shownFormat).toBe('library');
    await page.reload();
    await expect(page.locator('#library-page')).toBeVisible();
    await expect(row(page, 'a').locator('.tab-format')).toHaveText(['PDF', 'MD']);
    await expect(row(page, 'b').locator('.tab-format')).toHaveText(['EPUB']);
    await row(page, 'a').first().click();
    await expect(page.locator('#library-page')).toBeHidden();
    await expect(workspace(page)).toHaveAttribute('data-active', 'a');
  });

  test('a session written before the split existed, or with garbage in its split, restores the tabs as they were', async ({ page }) => {
    const tabs = [{ path: 'one.pdf', name: 'one.pdf', format: 'pdf' }, { path: 'two.md', name: 'two.md', format: 'md' }, { path: 'three.txt', name: 'three.txt', format: 'txt' }];
    await page.goto('/');
    // The app writes its own (empty) session once it has started; this one goes in after that.
    await expect.poll(() => page.evaluate(() => localStorage.getItem('hold-my-brief-tabs'))).not.toBeNull();
    for (const split of [undefined, 'nope', 7, { left: { tabs: ['one.pdf'] } }, { left: { tabs: ['zzz'] }, right: { tabs: ['yyy'] }, ratio: 'x', active: 4 }, { left: { tabs: 'one.pdf' }, right: null }]) {
      await page.evaluate(session => localStorage.setItem('hold-my-brief-tabs', JSON.stringify(session)), { tabs, active: 1, ...(split === undefined ? {} : { split }) });
      await page.reload();
      await expect(barTabs(page).locator('.tab-title')).toHaveText(['one.pdf', 'two.md', 'three.txt']);
      await expect(barTabs(page).nth(1)).toHaveClass(/is-active/);
      await expect(page.locator('.pane-strip:visible')).toHaveCount(0);
      await expect(workspace(page)).not.toHaveClass(/is-split/);
    }
  });
});

test.describe('stills for the pull request', () => {
  test.skip(!process.env.HMB_SHOT, 'writes test-results/sv2b-*.png only when HMB_SHOT is set');
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.addInitScript(() => localStorage.setItem('hold-my-brief:appearance', JSON.stringify({ mode: 'dark', palette: 'brief', accent: null, page: 'theme' })));
  });

  test('Brief dark, library docked, a 60 / 40 split', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openSplit(page);
    await expect(page.locator('#reader-layout.library-open')).toHaveCount(1);
    await page.locator('.pane-divider').focus();
    for (let step = 0; step < 5; step++) await page.keyboard.press('ArrowRight');
    await expect(page.locator('.pane-divider')).toHaveAttribute('aria-valuenow', '60');
    await page.locator('.reader-host[data-pane=a]:not(.tab-hidden)').click({ position: { x: 40, y: 200 } });
    await page.mouse.move(700, 880);
    await page.screenshot({ path: 'test-results/sv2b-split-60-40-library-docked.png' });
  });

  test('a folded split at 1080 × 760 with the library docked', async ({ page }) => {
    await page.setViewportSize({ width: 1080, height: 760 });
    await page.addInitScript(() => localStorage.setItem('hold-my-brief:library-width', '340'));
    await openThree(page);
    await setLibrary(page, false);
    await run(page, 'Split right');
    await expect(row(page, 'b')).toHaveCount(1);
    await setLibrary(page, true);
    await expect(workspace(page)).toHaveClass(/is-single/);
    await expect(page.getByRole('button', { name: /Other side/ })).toBeVisible();
    await page.mouse.move(700, 740);
    await page.screenshot({ path: 'test-results/sv2b-split-folded-1080.png' });
  });
});
