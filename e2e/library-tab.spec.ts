import { test, expect, type Page } from '@playwright/test';
import { seedLibrary, treeLibrary } from './home-fixture';
import { chooseFromViewMenu, libraryPage, libraryTab, openLibraryTab } from './library-controls';
import { warmDevServer } from './warm';
import { railHome } from './toolbar-tabs';

// The library is an ordinary tab, the Library tab: at most one, opened by the panel's title, a double-click on a folder or collection
// and the palette; retargeted rather than duplicated; restored with the session. The docked panel is its only navigation.
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

test('All documents is pinned on the top bar, opens the Library page without a close button, and clears the icon rail when the sidebar is closed', async ({ page }) => {
  await seed(page);
  await expect(libraryTab(page)).toHaveCount(1);
  await expect(libraryTab(page)).toBeVisible();
  await expect(libraryTab(page)).not.toHaveClass(/is-active/);
  await expect(libraryTab(page).locator('.tab-title')).toHaveText('All documents');
  await expect(libraryTab(page).locator('.tab-close')).toHaveCount(0);
  await libraryTab(page).click();
  await expect(libraryPage(page)).toBeVisible();
  await expect(libraryTab(page)).toHaveClass(/is-active/);
  await expect(page.locator('#filename')).toHaveText('All documents');
  await expect(page.locator('.library-scope-label')).toHaveText('All documents');
  await expect(count(page)).toHaveText('40 references');
  // It is a page of the reading panel, beside the docked panel, not laid over anything.
  await expect(page.locator('#empty')).toBeHidden();
  const box = (await libraryPage(page).boundingBox())!, panel = (await page.locator('#library-root .library-panel').boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(panel.x + panel.width);
  // Collapsing the sidebar keeps the Library page clear of the icon rail (never drawn underneath the icons).
  await page.locator('#library-rail').getByRole('button', { name: 'Library', exact: true }).click();
  await expect(page.locator('#library-root')).toBeHidden();
  const closedBox = (await libraryPage(page).boundingBox())!, railBox = (await page.locator('#library-rail').boundingBox())!;
  expect(closedBox.x).toBeGreaterThanOrEqual(railBox.x + railBox.width);
  await page.locator('#library-rail').getByRole('button', { name: 'Library', exact: true }).click();
  await expect(page.locator('#library-root')).toBeVisible();
  // The panel marks it: its title is the current place.
  await expect(page.locator('#library-root .library-title-button')).toHaveAttribute('aria-current', 'location');
  // What the board had is gone.
  await expect(page.getByRole('button', { name: /Back to reading/ })).toHaveCount(0);
  for (const gone of ['.library-board-nav', '.library-navigation', '.library-filter', '.library-board-back', '.is-board']) await expect(page.locator(gone)).toHaveCount(0);
  // Escape and Ctrl+W do not dismiss or close the pinned tab.
  await page.locator('.library-search').focus();
  await page.keyboard.press('Escape');
  await expect(libraryPage(page)).toBeVisible();
  await page.locator('#library-pin').focus();
  await page.keyboard.press('Control+w');
  await expect(libraryTab(page)).toBeVisible();
  await expect(libraryPage(page)).toBeVisible();
});

test('double-clicking a folder or a collection retargets the pinned tab, and the panel marks the scope', async ({ page }) => {
  await seed(page);
  const magazine = node(page, folder('refs', '03_vintage_magazine'));
  await magazine.dblclick();
  await expect(libraryTab(page)).toHaveClass(/is-active/);
  await expect(libraryTab(page).locator('.tab-title')).toHaveText('refs › 03_vintage_magazine');
  await expect(page.locator('.library-scope-label')).toHaveText('refs › 03_vintage_magazine');
  await expect(count(page)).toHaveText('2 references');
  await expect(magazine).toHaveClass(/is-scope/);
  // The tree's folder is as it was before the double-click.
  await expect(magazine).toHaveAttribute('aria-expanded', 'false');

  await node(page, 'c:c-Fashion photo and catalogues').dblclick();
  await expect(libraryTab(page).locator('.tab-title')).toHaveText('Fashion photo and catalogues');
  await expect(count(page)).toHaveText('2 references');
  await expect(node(page, 'c:c-Fashion photo and catalogues')).toHaveClass(/is-scope/);
  await expect(magazine).not.toHaveClass(/is-scope/);
  await expect(page.locator('#library-root .library-title-button')).not.toHaveAttribute('aria-current', 'location');

  // The title goes back to every document: still the same pinned tab.
  await openLibraryTab(page);
  await expect(libraryTab(page).locator('.tab-title')).toHaveText('All documents');
  await expect(node(page, 'c:c-Fashion photo and catalogues')).not.toHaveClass(/is-scope/);
});

test('the scope menu in the header offers what the tree has no row for, and retargets the pinned tab', async ({ page }) => {
  await seed(page);
  await openLibraryTab(page);
  const menu = page.locator('.library-scope-menu');
  await page.locator('.library-scope-button').click();
  await expect(menu.getByRole('menuitemradio')).toHaveText([/^All documents\d+$/, /^Favorites\d+$/, /^Continue reading\d+$/, /^Unfiled\d+$/, /^refs\d+$/, /^reference-docs\d+$/, /^Design materials\d+$/]);
  await expect(menu.getByRole('menuitemradio', { name: 'All documents' })).toHaveAttribute('aria-checked', 'true');
  await menu.getByRole('menuitemradio', { name: 'Continue reading' }).click();
  await expect(menu).toBeHidden();
  await expect(libraryTab(page).locator('.tab-title')).toHaveText('Continue reading');
  await expect(count(page)).toHaveText('2 references');

  await page.locator('.library-scope-button').click();
  await menu.getByRole('menuitemradio', { name: 'Unfiled' }).click();
  await expect(libraryTab(page).locator('.tab-title')).toHaveText('Unfiled');

  await page.locator('.library-scope-button').click();
  await menu.getByRole('menuitemradio', { name: 'refs' }).click();
  await expect(libraryTab(page).locator('.tab-title')).toHaveText('refs');
  await expect(libraryTab(page)).toHaveCount(1);
});

test('the palette opens the pinned Library tab and shows it as it is, from Home as from another tab', async ({ page }) => {
  await seed(page);
  await openLibraryTab(page);
  await page.locator('.library-scope-button').click();
  await page.locator('.library-scope-menu').getByRole('menuitemradio', { name: 'Continue reading' }).click();
  await expect(libraryTab(page).locator('.tab-title')).toHaveText('Continue reading');
  await expect(count(page)).toHaveText('2 references');

  await railHome(page).click();
  await expect(libraryPage(page)).toBeHidden();
  await expect(libraryTab(page)).not.toHaveClass(/is-active/);
  // The palette command shows the pinned Library tab as it is (it names no scope).
  await page.keyboard.press('Control+k');
  await page.locator('#palette-input').fill('library tab');
  await page.keyboard.press('Enter');
  await expect(libraryTab(page)).toHaveClass(/is-active/);
  await expect(libraryTab(page).locator('.tab-title')).toHaveText('Continue reading');
});

test('the pinned Library tab survives a reload on the same scope', async ({ page }) => {
  await seed(page);
  await node(page, folder('refs', '03_vintage_magazine')).dblclick();
  await expect(libraryTab(page).locator('.tab-title')).toHaveText('refs › 03_vintage_magazine');
  await page.reload();
  await expect(libraryTab(page)).toHaveCount(1);
  await expect(libraryTab(page)).toHaveClass(/is-active/);
  await expect(libraryTab(page).locator('.tab-title')).toHaveText('refs › 03_vintage_magazine');
  await expect(libraryPage(page)).toBeVisible();
  await expect(count(page)).toHaveText('2 references');
  await expect(node(page, folder('refs', '03_vintage_magazine'))).toHaveClass(/is-scope/);

  await railHome(page).click();
  await expect(libraryPage(page)).toBeHidden();
  await expect(railHome(page)).toHaveAttribute('aria-current', 'page');
  await openLibraryTab(page);
  await expect(libraryTab(page).locator('.tab-title')).toHaveText('All documents');
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
  // Switching back to Home clears the active Library entry when on the default scope.
  const cleared = await page.evaluate(async () => {
    document.querySelector<HTMLButtonElement>('#library-rail [data-rail="home"]')!.click();
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
  await expect(tabTitles(page)).toHaveText(['Brush-Notes.md']);

  // Back on the Library tab, the same document focuses the tab it already has instead of opening another.
  await libraryTab(page).click();
  await row('Brush-Notes.md').locator('.library-document-open').click();
  await expect(page.locator('#tab-list .tab.is-active .tab-title')).toHaveText('Brush-Notes.md');
  await expect(tabTitles(page)).toHaveText(['Brush-Notes.md']);

  // ⌘/Ctrl-click and a middle click leave the Library tab in front and give the document a tab beside it.
  await libraryTab(page).click();
  await search.fill('Layer-Notes');
  await row('Layer-Notes.md').locator('.library-document-open').click({ modifiers: ['ControlOrMeta'] });
  await expect(tabTitles(page)).toHaveText(['Layer-Notes.md', 'Brush-Notes.md']); // Beside the pinned Library tab.
  await expect(libraryTab(page)).toHaveClass(/is-active/);
  await expect(libraryPage(page)).toBeVisible();
  await search.fill('Photoshop-Notes');
  await row('Photoshop-Notes.md').locator('.library-document-open').click({ button: 'middle' });
  await expect(tabTitles(page)).toHaveText(['Layer-Notes.md', 'Photoshop-Notes.md', 'Brush-Notes.md']); // The next one lands after the last background tab.
  await expect(libraryTab(page)).toHaveClass(/is-active/);
});

test('document tab keys jump to document tabs while All documents stays pinned on the top bar', async ({ page }) => {
  await seed(page);
  await openLibraryTab(page);
  await chooseFromViewMenu(page, 'List');
  // The first match is already selected, so one click opens it in a document tab beside the pinned tab.
  await page.locator('#library-page .library-document').first().locator('.library-document-open').click();
  await expect(page.locator('#tab-list .tab')).toHaveCount(1);
  await libraryTab(page).click();
  await expect(libraryTab(page)).toHaveClass(/is-active/);
  await page.keyboard.press('Alt+1');
  await expect(page.locator('#tab-list .tab').first()).toHaveClass(/is-active/);
  await expect(libraryPage(page)).toBeHidden();
  await libraryTab(page).click();
  await expect(libraryTab(page)).toHaveClass(/is-active/);
  await expect(libraryPage(page)).toBeVisible();
});
