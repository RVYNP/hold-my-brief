import { test, expect, type Page } from '@playwright/test';
import { seedLibrary, treeLibrary } from './home-fixture';
import { chooseFromViewMenu, libraryPage, libraryTab, openLibraryTab } from './library-controls';
import { warmDevServer } from './warm';
import { railHome } from './toolbar-tabs';

// The library is an ordinary tab, the Library tab: at most one, opened by the panel's title, a double-click on a folder or collection, Home's
// Open in library buttons and the palette; retargeted rather than duplicated; restored with the session. The docked panel is its only navigation.
test.beforeAll(async ({ browser, baseURL }) => { await warmDevServer(browser, baseURL); });

const folder = (name: string, path: string) => `f:root-${name}:${path}`;
const node = (page: Page, id: string) => page.locator(`#library-root .tree-row[data-node="${id}"]`);
const tabTitles = (page: Page) => page.locator('#tab-list .tab-title');
const count = (page: Page) => page.locator('.library-result-count');

async function seed(page: Page) {
  await page.setViewportSize({ width: 1080, height: 700 });
  const { documents, collections } = treeLibrary(40);
  await seedLibrary(page, documents, collections);
  await expect(page.locator('#library-root')).toBeVisible();
}

test('the panel title opens the Library tab on all documents; there is no sidebar and no Back to reading', async ({ page }) => {
  await seed(page);
  await expect(libraryTab(page)).toHaveCount(0);
  await openLibraryTab(page);
  await expect(libraryTab(page)).toHaveCount(1);
  await expect(libraryTab(page)).toHaveClass(/is-active/);
  await expect(libraryTab(page).locator('.tab-title')).toHaveText('All documents');
  await expect(page.locator('#filename')).toHaveText('All documents');
  await expect(page.locator('.library-scope-label')).toHaveText('All documents');
  await expect(count(page)).toHaveText('40 references');
  // It is a page of the reading panel, beside the docked panel, not laid over anything.
  await expect(page.locator('#empty')).toBeHidden();
  const box = (await libraryPage(page).boundingBox())!, panel = (await page.locator('#library-root .library-panel').boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(panel.x + panel.width);
  // The panel marks it: its title is the current place.
  await expect(page.locator('#library-root .library-title-button')).toHaveAttribute('aria-current', 'location');
  // What the board had is gone.
  await expect(page.getByRole('button', { name: /Back to reading/ })).toHaveCount(0);
  for (const gone of ['.library-board-nav', '.library-navigation', '.library-filter', '.library-board-back', '.is-board']) await expect(page.locator(gone)).toHaveCount(0);
  // Escape does not dismiss it.
  await page.locator('.library-search').focus();
  await page.keyboard.press('Escape');
  await expect(libraryPage(page)).toBeVisible();
});

test('double-clicking a folder or a collection retargets the one tab, and the panel marks the scope', async ({ page }) => {
  await seed(page);
  const magazine = node(page, folder('refs', '03_vintage_magazine'));
  await magazine.dblclick();
  await expect(libraryTab(page)).toHaveCount(1);
  await expect(libraryTab(page).locator('.tab-title')).toHaveText('refs › 03_vintage_magazine');
  await expect(page.locator('.library-scope-label')).toHaveText('refs › 03_vintage_magazine');
  await expect(count(page)).toHaveText('2 references');
  await expect(magazine).toHaveClass(/is-scope/);
  // The tree's folder is as it was before the double-click.
  await expect(magazine).toHaveAttribute('aria-expanded', 'false');

  await node(page, 'c:c-Fashion photo and catalogues').dblclick();
  await expect(tabTitles(page)).toHaveText(['Fashion photo and catalogues']);
  await expect(count(page)).toHaveText('2 references');
  await expect(node(page, 'c:c-Fashion photo and catalogues')).toHaveClass(/is-scope/);
  await expect(magazine).not.toHaveClass(/is-scope/);
  await expect(page.locator('#library-root .library-title-button')).not.toHaveAttribute('aria-current', 'location');

  // The title goes back to every document: still the same tab.
  await openLibraryTab(page);
  await expect(tabTitles(page)).toHaveText(['All documents']);
  await expect(node(page, 'c:c-Fashion photo and catalogues')).not.toHaveClass(/is-scope/);
});

test('the scope menu in the header offers what the tree has no row for, and retargets the same tab', async ({ page }) => {
  await seed(page);
  await openLibraryTab(page);
  const menu = page.locator('.library-scope-menu');
  await page.locator('.library-scope-button').click();
  await expect(menu.getByRole('menuitemradio')).toHaveText([/^All documents\d+$/, /^Favorites\d+$/, /^Continue reading\d+$/, /^Unfiled\d+$/, /^refs\d+$/, /^reference-docs\d+$/, /^Design materials\d+$/]);
  await expect(menu.getByRole('menuitemradio', { name: 'All documents' })).toHaveAttribute('aria-checked', 'true');
  await menu.getByRole('menuitemradio', { name: 'Continue reading' }).click();
  await expect(menu).toBeHidden();
  await expect(tabTitles(page)).toHaveText(['Continue reading']);
  await expect(count(page)).toHaveText('2 references');

  await page.locator('.library-scope-button').click();
  await menu.getByRole('menuitemradio', { name: 'Unfiled' }).click();
  await expect(tabTitles(page)).toHaveText(['Unfiled']);

  await page.locator('.library-scope-button').click();
  await menu.getByRole('menuitemradio', { name: 'refs' }).click();
  await expect(tabTitles(page)).toHaveText(['refs']);
  await expect(libraryTab(page)).toHaveCount(1);
});

test('Home\'s Open in library buttons and the palette open the tab, and a second opener retargets it', async ({ page }) => {
  await seed(page);
  await page.getByRole('button', { name: 'Open in library: Favorites' }).click();
  await expect(libraryTab(page)).toHaveCount(1);
  await expect(tabTitles(page)).toHaveText(['Favorites']);
  await expect(page.locator('.library-scope-label')).toHaveText('Favorites');

  await railHome(page).click();
  await expect(libraryPage(page)).toBeHidden();
  await page.getByRole('button', { name: 'Open in library: Continue reading' }).click();
  await expect(libraryTab(page)).toHaveCount(1);
  await expect(tabTitles(page)).toHaveText(['Continue reading']);
  await expect(count(page)).toHaveText('2 references');

  // The palette command shows the tab as it is (it names no scope), from another tab as from Home.
  await railHome(page).click();
  await page.keyboard.press('Control+k');
  await page.locator('#palette-input').fill('library tab');
  await page.keyboard.press('Enter');
  await expect(libraryTab(page)).toHaveClass(/is-active/);
  await expect(tabTitles(page)).toHaveText(['Continue reading']);

  // With no tab open it opens one on all documents.
  await libraryTab(page).locator('.tab-close').click();
  await expect(libraryTab(page)).toHaveCount(0);
  await page.keyboard.press('Control+k');
  await page.locator('#palette-input').fill('library tab');
  await page.keyboard.press('Enter');
  await expect(tabTitles(page)).toHaveText(['All documents']);
});

test('the Library tab survives a reload, on the same scope, and closing it forgets the scope', async ({ page }) => {
  await seed(page);
  await node(page, folder('refs', '03_vintage_magazine')).dblclick();
  await expect(tabTitles(page)).toHaveText(['refs › 03_vintage_magazine']);
  await page.reload();
  await expect(libraryTab(page)).toHaveCount(1);
  await expect(libraryTab(page)).toHaveClass(/is-active/);
  await expect(tabTitles(page)).toHaveText(['refs › 03_vintage_magazine']);
  await expect(libraryPage(page)).toBeVisible();
  await expect(count(page)).toHaveText('2 references');
  await expect(node(page, folder('refs', '03_vintage_magazine'))).toHaveClass(/is-scope/);

  await libraryTab(page).locator('.tab-close').click();
  await expect(libraryTab(page)).toHaveCount(0);
  await expect(libraryPage(page)).toBeHidden();
  await expect(railHome(page)).toHaveAttribute('aria-current', 'page');
  await expect(node(page, folder('refs', '03_vintage_magazine'))).not.toHaveClass(/is-scope/);
  await openLibraryTab(page);
  await expect(tabTitles(page)).toHaveText(['All documents']);
  await expect(count(page)).toHaveText('40 references');
});

test('a tab change is stored within the task that made it', async ({ page }) => {
  await seed(page);
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('hold-my-brief-tabs') ?? 'null')?.tabs?.map((tab: { format: string }) => tab.format) ?? []);
  expect(await stored()).toEqual([]);
  // The click and the read run in one task: a write that waits for a timer would not have happened yet.
  const written = await page.evaluate(async () => {
    const button = [...document.querySelectorAll<HTMLButtonElement>('#library-root button')].find(item => item.textContent?.trim() === 'Library')!;
    button.click();
    await Promise.resolve();
    return JSON.parse(localStorage.getItem('hold-my-brief-tabs') ?? 'null')?.tabs?.map((tab: { format: string }) => tab.format) ?? [];
  });
  expect(written).toEqual(['library']);
  // Closing it is stored the same way.
  const cleared = await page.evaluate(async () => {
    document.querySelector<HTMLElement>('#tab-list .tab[data-kind=library] .tab-close')!.click();
    await Promise.resolve();
    return JSON.parse(localStorage.getItem('hold-my-brief-tabs') ?? 'null')?.tabs?.length;
  });
  expect(cleared).toBe(0);
});

test('a Library tab that was behind a document comes back where it was', async ({ page }) => {
  await seed(page);
  await openLibraryTab(page);
  await page.locator('.library-search').fill('Layer');
  await expect(count(page)).toHaveText('1 reference');
  // The only match is selected already, so one click opens it.
  await page.locator('#library-page [data-doc-path]').first().locator('.library-document-open').click();
  await expect(libraryTab(page)).toHaveCount(1);
  await expect(page.locator('#tab-list .tab.is-active .tab-title')).toHaveText('Layer-Notes.md');
  await expect(libraryPage(page)).toBeHidden();
  await libraryTab(page).click();
  await expect(libraryPage(page)).toBeVisible();
  await expect(page.locator('.library-search')).toHaveValue('Layer');
  await expect(count(page)).toHaveText('1 reference');
});

test('opening a document from the tab opens or focuses its tab; ⌘/Ctrl-click and middle-click open it in the background', async ({ page }) => {
  await seed(page);
  await openLibraryTab(page);
  await chooseFromViewMenu(page, 'List');
  const row = (name: string) => page.locator('#library-page .library-document', { hasText: name });
  const search = page.locator('.library-search');

  // A click selects (the first of the matches is selected already); a second click on the selected one opens its tab.
  await search.fill('Notes');
  await expect(count(page)).toHaveText('3 references');
  await expect(row('Photoshop-Notes.md')).toHaveClass(/is-selected/);
  await row('Brush-Notes.md').locator('.library-document-open').click();
  await expect(row('Brush-Notes.md')).toHaveClass(/is-selected/);
  await expect(row('Photoshop-Notes.md')).not.toHaveClass(/is-selected/);
  await expect(page.locator('#tab-list .tab[data-kind=document]')).toHaveCount(0);
  await row('Brush-Notes.md').locator('.library-document-open').click();
  await expect(page.locator('#tab-list .tab.is-active .tab-title')).toHaveText('Brush-Notes.md');
  await expect(libraryPage(page)).toBeHidden();
  await expect(tabTitles(page)).toHaveText(['All documents', 'Brush-Notes.md']);

  // Back on the Library tab, the same document focuses the tab it already has instead of opening another.
  await libraryTab(page).click();
  await row('Brush-Notes.md').locator('.library-document-open').click();
  await expect(page.locator('#tab-list .tab.is-active .tab-title')).toHaveText('Brush-Notes.md');
  await expect(tabTitles(page)).toHaveText(['All documents', 'Brush-Notes.md']);

  // ⌘/Ctrl-click and a middle click leave the Library tab in front and give the document a tab beside it.
  await libraryTab(page).click();
  await search.fill('Layer-Notes');
  await row('Layer-Notes.md').locator('.library-document-open').click({ modifiers: ['ControlOrMeta'] });
  await expect(tabTitles(page)).toHaveText(['All documents', 'Layer-Notes.md', 'Brush-Notes.md']); // Beside the tab that is showing.
  await expect(libraryTab(page)).toHaveClass(/is-active/);
  await expect(libraryPage(page)).toBeVisible();
  await search.fill('Photoshop-Notes');
  await row('Photoshop-Notes.md').locator('.library-document-open').click({ button: 'middle' });
  await expect(tabTitles(page)).toHaveText(['All documents', 'Layer-Notes.md', 'Photoshop-Notes.md', 'Brush-Notes.md']); // The next one lands after the last background tab.
  await expect(libraryTab(page)).toHaveClass(/is-active/);
});

test('the Library tab is a tab like the rest: it is reached with the tab keys', async ({ page }) => {
  await seed(page);
  await openLibraryTab(page);
  await page.locator('#library-root').getByRole('button', { name: 'Library', exact: true }).focus();
  await page.keyboard.press('Alt+1');
  await expect(libraryTab(page)).toHaveClass(/is-active/);
  await railHome(page).click();
  await page.keyboard.press('Control+Tab');
  await expect(libraryTab(page)).toHaveClass(/is-active/);
  await expect(libraryPage(page)).toBeVisible();
});
