import { test, expect, type Locator, type Page } from '@playwright/test';
import { seedLibrary, treeLibrary } from './home-fixture';
import { warmDevServer } from './warm';

// The info rail's tree (src/library-tree*.ts) and the icon rail beside it (src/icon-rail.ts), on a library shaped like a real catalog:
// source roots (`refs`, `reference-docs`, `Design materials`) with numbered subfolders, many documents called `source.pdf`, user
// collections, and loose files.
test.beforeAll(async ({ browser, baseURL }) => { await warmDevServer(browser, baseURL); });
const root = (name: string) => `r:root-${name}`;
const folder = (name: string, path: string) => `f:root-${name}:${path}`;
const rows = (page: Page) => page.locator('#library-root .tree-row');
const node = (page: Page, id: string) => page.locator(`#library-root .tree-row[data-node="${id}"]`);
const document_ = (page: Page, rootName: string, relativePath: string) => node(page, `d:fx-${`${rootName}:${relativePath}`.replace(/[^A-Za-z0-9.-]+/g, '_')}/${relativePath}`);
const iconRail = (page: Page) => page.locator('#library-rail');
const icon = (page: Page, name: string) => iconRail(page).getByRole('button', { name, exact: true });
const focused = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset?.node ?? null);

async function seed(page: Page, size = 40, width = 1080) {
  await page.setViewportSize({ width, height: 700 });
  const { documents, collections } = treeLibrary(size);
  await seedLibrary(page, documents, collections);
  if (width >= 720) await expect(page.locator('#library-root')).toBeVisible();
}
const expand = async (page: Page, id: string) => { if (await node(page, id).getAttribute('aria-expanded') !== 'true') await node(page, id).locator('.tree-chevron').click(); await expect(node(page, id)).toHaveAttribute('aria-expanded', 'true'); };

test('the library is a nested folder tree: a root per source folder, subfolders with document counts, documents as file names with progress, collections and loose files', async ({ page }) => {
  await seed(page);
  const tree = page.getByRole('tree', { name: 'Library' });
  await expect(tree).toBeVisible();
  await expect(page.locator('#library-root h2')).toContainText('Library');
  await expect(page.locator('.library-title-count')).toHaveText('40');

  // Sections are quiet captions; each source root is a bold top-level row, open at first, its subfolders closed.
  const captions = page.locator('#library-root .tree-row.is-section');
  await expect(captions).toHaveText([/^Folders\s*37$/, /^Collections\s*3$/, /^Loose files\s*3$/]);
  const refs = node(page, root('refs'));
  await expect(refs).toHaveAttribute('aria-expanded', 'true');
  await expect(refs.locator('.tree-label')).toHaveCSS('font-weight', '650');
  const magazine = node(page, folder('refs', '03_vintage_magazine'));
  await expect(magazine).toHaveAttribute('aria-expanded', 'false');
  await expect(magazine.locator('.tree-meta')).toHaveText('2'); // source.pdf and covers/january.png

  // Rows are 26 px, indented 14 px a level; the folder glyph opens with the folder.
  const box = async (locator: Locator) => (await locator.boundingBox())!;
  expect(Math.round((await box(magazine)).height)).toBe(26);
  await expand(page, folder('refs', '03_vintage_magazine'));
  await expect(magazine.locator('.tree-icon svg')).toBeVisible();
  const source = document_(page, 'refs', '03_vintage_magazine/source.pdf');
  await expect(source).toBeVisible();
  await expect(source.locator('.tree-label')).toHaveText('source.pdf');
  expect(Math.round((await box(source.locator('.tree-icon'))).x - (await box(magazine.locator('.tree-icon'))).x)).toBe(14);
  // Progress is right-aligned mono text, in #46's words.
  await expect(source.locator('.tree-meta')).toHaveText('p. 62 / 88');
  await expect(source.locator('.tree-meta')).toHaveCSS('font-family', /mono|Menlo|Consolas|monospace/i);
  await expand(page, folder('refs', '09_motorcycle_catalogues'));
  await expand(page, folder('refs', '09_motorcycle_catalogues/issues'));
  await expect(document_(page, 'refs', '09_motorcycle_catalogues/issues/autumn.pdf').locator('.tree-meta')).toHaveText('Finished');
  await expand(page, folder('reference-docs', '1-languages'));
  await expect(document_(page, 'reference-docs', '1-languages/Rust-Book-1.99.epub').locator('.tree-meta')).toHaveText('37 %');

  // Many documents share the name `source.pdf`: each is its own row, under its own folder.
  await expand(page, folder('refs', '01_art_nouveau_posters'));
  const sources = await page.locator('#library-root .tree-row.is-document', { hasText: /^source\.pdf/ }).evaluateAll(list => list.map(row => (row as HTMLElement).dataset.docPath));
  expect(sources.length).toBeGreaterThanOrEqual(2);
  expect(new Set(sources).size).toBe(sources.length);

  // Collections are nested by parent, with documents inside; loose files are listed on their own.
  const collections = node(page, 'c:c-Fashion photo and catalogues');
  await expect(collections).toBeVisible();
  await expect(collections.locator('.tree-meta')).toHaveText('2');
  await expect(node(page, 's:loose')).toBeVisible();
  await expect(node(page, 'l:fx-loose-note.md/loose-note.md')).toBeVisible();
});

test('expand and collapse are saved per node and come back after a reload; closing a root keeps its own state', async ({ page }) => {
  await seed(page);
  const magazine = folder('refs', '03_vintage_magazine');
  await expand(page, magazine);
  await node(page, root('reference-docs')).locator('.tree-chevron').click();
  await expect(node(page, root('reference-docs'))).toHaveAttribute('aria-expanded', 'false');
  await page.reload();
  await expect(node(page, magazine)).toHaveAttribute('aria-expanded', 'true');
  await expect(node(page, root('refs'))).toHaveAttribute('aria-expanded', 'true');
  await expect(node(page, root('reference-docs'))).toHaveAttribute('aria-expanded', 'false');
  await expect(node(page, folder('reference-docs', '1-languages'))).toHaveCount(0);
  // A section folds too, and so does what was open under it after a collapse.
  await node(page, 's:folders').click();
  await expect(node(page, 's:folders')).toHaveAttribute('aria-expanded', 'false');
  await expect(node(page, root('refs'))).toHaveCount(0);
  await page.reload();
  await expect(node(page, 's:folders')).toHaveAttribute('aria-expanded', 'false');
  await node(page, 's:folders').click();
  await expect(node(page, magazine)).toHaveAttribute('aria-expanded', 'true');
});

test('a document opens from its row, ⌘/Ctrl-click opens it in a background tab, and the open document is marked with its folders open', async ({ page }) => {
  await seed(page);
  await expand(page, folder('reference-docs', '2-creative-apps'));
  await expand(page, folder('reference-docs', '2-creative-apps/drafts'));
  const photoshop = document_(page, 'reference-docs', '2-creative-apps/drafts/Photoshop-Notes.md');
  const layers = document_(page, 'reference-docs', '2-creative-apps/drafts/Layer-Notes.md');

  // ⌘/Ctrl-click: a tab appears beside the one showing and nothing else changes (Home stays).
  await expect(page.locator('#tab-count')).toHaveText('');
  await layers.click({ modifiers: [process.platform === 'darwin' ? 'Meta' : 'Control'] });
  await expect(page.locator('#tab-count')).toHaveText('1');
  await expect(page.locator('#tab-list [role=tab]')).toHaveCount(1);
  await expect(page.locator('#home-tab')).toHaveAttribute('aria-selected', 'true');
  await expect(layers).not.toHaveClass(/is-active/);

  // A plain click opens it and shows it; the row is marked (accent-soft, 600) and not the background one.
  await photoshop.click();
  await expect(page.locator('#filename')).toHaveText('Photoshop-Notes.md');
  await expect(page.locator('#tab-count')).toHaveText('2');
  await expect(photoshop).toHaveClass(/is-active/);
  await expect(photoshop).toHaveAttribute('aria-selected', 'true');
  await expect(photoshop).toHaveCSS('font-weight', '600');
  await expect(layers).not.toHaveClass(/is-active/);
  // Clicking an open document's row shows its tab instead of opening it again.
  await layers.click();
  await expect(page.locator('#filename')).toHaveText('Layer-Notes.md');
  await expect(page.locator('#tab-count')).toHaveText('2');
  await expect(layers).toHaveClass(/is-active/);

  // The open document's ancestors open by themselves: close them all, then show the tab again.
  await node(page, root('reference-docs')).locator('.tree-chevron').click();
  await expect(node(page, folder('reference-docs', '2-creative-apps'))).toHaveCount(0);
  await page.locator('#tab-list [role=tab]', { hasText: 'Photoshop-Notes.md' }).click();
  await expect(page.locator('#filename')).toHaveText('Photoshop-Notes.md');
  await expect(node(page, root('reference-docs'))).toHaveAttribute('aria-expanded', 'true');
  await expect(node(page, folder('reference-docs', '2-creative-apps/drafts'))).toHaveAttribute('aria-expanded', 'true');
  await expect(photoshop).toHaveClass(/is-active/);
});

test('the tree has an ARIA tree\'s keyboard: arrows, Home/End, Enter, left to the parent, type-ahead', async ({ page }) => {
  await seed(page);
  const tree = page.getByRole('tree', { name: 'Library' });
  await expect(tree.locator('[tabindex="0"]')).toHaveCount(1); // one tab stop
  await node(page, 's:folders').focus();
  await page.keyboard.press('ArrowDown');
  expect(await focused(page)).toBe(root('Design materials'));
  await page.keyboard.press('ArrowUp');
  expect(await focused(page)).toBe('s:folders');
  await page.keyboard.press('End');
  expect(await focused(page)).toMatch(/^l:/); // the last loose file
  await page.keyboard.press('Home');
  expect(await focused(page)).toBe('s:folders');

  // Right opens a closed folder, then enters it; Left leaves it for its parent (closing it first when open).
  await node(page, root('refs')).focus();
  const magazine = folder('refs', '03_vintage_magazine');
  await node(page, magazine).focus();
  await page.keyboard.press('ArrowRight');
  await expect(node(page, magazine)).toHaveAttribute('aria-expanded', 'true');
  expect(await focused(page)).toBe(magazine);
  await page.keyboard.press('ArrowRight');
  expect((await focused(page))!.startsWith('f:') || (await focused(page))!.startsWith('d:')).toBe(true);
  expect(await focused(page)).not.toBe(magazine);
  await page.keyboard.press('ArrowLeft');
  expect(await focused(page)).toBe(magazine);
  await page.keyboard.press('ArrowLeft');
  await expect(node(page, magazine)).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('ArrowLeft');
  expect(await focused(page)).toBe(root('refs'));

  // Enter toggles a folder and opens a document; ⌘/Ctrl-Enter gives a background tab.
  await node(page, magazine).focus();
  await page.keyboard.press('Enter');
  await expect(node(page, magazine)).toHaveAttribute('aria-expanded', 'true');
  await expand(page, folder('reference-docs', '2-creative-apps'));
  await expand(page, folder('reference-docs', '2-creative-apps/drafts'));
  await document_(page, 'reference-docs', '2-creative-apps/Brush-Notes.md').focus();
  await page.keyboard.press('Control+Enter');
  await expect(page.locator('#tab-count')).toHaveText('1');
  await expect(page.locator('#home-tab')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  await expect(page.locator('#filename')).toHaveText('Brush-Notes.md');
  await expect(page.locator('.reader-host:not(.staging):not(.tab-hidden)')).toBeFocused(); // the document is read: the page takes focus

  // Typing jumps to the next row whose name starts with the letters, wherever they are in the list.
  await node(page, root('Design materials')).focus();
  await page.keyboard.type('refs');
  expect(await focused(page)).toBe(root('refs'));
  await page.keyboard.press('ArrowDown'); await page.waitForTimeout(800);
  await page.keyboard.type('09_');
  expect(await focused(page)).toBe(folder('refs', '09_motorcycle_catalogues'));
});

test('the filter narrows the tree as you type, highlights the matches, opens the folders above them, and clears with Escape', async ({ page }) => {
  await seed(page);
  const toggle = page.getByRole('button', { name: 'Filter the library' });
  await toggle.click();
  const field = page.getByRole('searchbox', { name: 'Filter the library' });
  await expect(field).toBeFocused();
  await field.fill('motorcycle spring');
  // Only the document whose folder and file name say both words is left, with every folder above it open and the words marked.
  await expect(page.locator('#library-root .tree-row.is-document')).toHaveCount(1);
  const spring = document_(page, 'refs', '09_motorcycle_catalogues/issues/spring.pdf');
  await expect(spring).toBeVisible();
  await expect(node(page, folder('refs', '09_motorcycle_catalogues'))).toHaveAttribute('aria-expanded', 'true');
  await expect(node(page, folder('refs', '09_motorcycle_catalogues/issues'))).toHaveAttribute('aria-expanded', 'true');
  await expect(node(page, folder('refs', '09_motorcycle_catalogues')).locator('mark')).toHaveText('motorcycle');
  await expect(spring.locator('mark')).toHaveText('spring');
  await expect(page.locator('.library-title-count')).toHaveText('1');
  await expect(node(page, root('reference-docs'))).toHaveCount(0);
  // A folder's name matches everything in it, and a word that is nowhere says so.
  await field.fill('vintage');
  await expect(page.locator('#library-root .tree-row.is-document')).toHaveCount(2);
  await field.fill('zzzz');
  await expect(page.getByText('No matching references')).toBeVisible();
  await expect(page.locator('.library-title-count')).toHaveText('0');
  // Escape clears what was typed; Escape again folds the field and returns to the tree; the saved open state is what it was.
  await page.keyboard.press('Escape');
  await expect(field).toHaveValue('');
  await expect(node(page, folder('refs', '03_vintage_magazine'))).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('Escape');
  await expect(field).toBeHidden();
  await expect(page.locator('#library-root')).toBeVisible();
  expect(await focused(page)).not.toBeNull();
  // Arrow Down from the field moves into the tree.
  await toggle.click(); await field.fill('rust');
  await page.keyboard.press('ArrowDown');
  expect(await focused(page)).toMatch(/^s:/);
});

test('the icon rail: Library, Home, Favorites, Collections, Search and Add files, with the side switch and Appearance at its foot, tooltips with shortcuts, and the active icon filled', async ({ page }) => {
  await seed(page);
  const names = ['Library', 'Home', 'Favorites', 'Collections', 'Search', 'Add files', 'Move library to the right', 'Appearance'];
  const buttons = iconRail(page).getByRole('button');
  await expect(buttons).toHaveText(names.map(() => ''));
  expect(await buttons.evaluateAll(list => list.map(button => button.getAttribute('aria-label')))).toEqual(names);
  // Top to bottom, the two foot buttons below the rest.
  const ys = await buttons.evaluateAll(list => list.map(button => Math.round(button.getBoundingClientRect().y)));
  expect([...ys].sort((a, b) => a - b)).toEqual(ys);
  expect(ys[7]! - ys[5]!).toBeGreaterThan(100);
  expect(await buttons.evaluateAll(list => list.map(button => button.getAttribute('data-tip')))).toEqual(['Library  Ctrl+B', 'Home', 'Favorites', 'Collections', 'Search  Ctrl+Shift+F', 'Add files', 'Move library to the right', 'Appearance']);

  // The pressed icon is the one filled with the accent-soft tone; the others are not.
  const fill = (name: string) => icon(page, name).evaluate(button => getComputedStyle(button).backgroundColor);
  await expect(icon(page, 'Library')).toHaveAttribute('aria-pressed', 'true');
  const soft = await fill('Library');
  expect(await fill('Favorites')).not.toBe(soft);

  // Favorites, Collections and Search open the info rail on that view; the active icon collapses it.
  await icon(page, 'Favorites').click();
  await expect(page.locator('#library-root h2')).toContainText('Favorites');
  await expect(icon(page, 'Favorites')).toHaveAttribute('aria-pressed', 'true');
  await expect(icon(page, 'Library')).toHaveAttribute('aria-pressed', 'false');
  await icon(page, 'Collections').click();
  await expect(page.locator('#library-root h2')).toContainText('Collections');
  await icon(page, 'Search').click();
  await expect(page.locator('#library-root h2')).toContainText('Search');
  await expect(page.getByRole('searchbox', { name: 'Filter the library' })).toBeFocused();
  await icon(page, 'Search').click();
  await expect(page.locator('#library-root')).toBeHidden();
  await expect(icon(page, 'Search')).toHaveAttribute('aria-pressed', 'false');
  // Ctrl+Shift+F is Search from anywhere.
  await page.keyboard.press('Control+Shift+F');
  await expect(page.getByRole('searchbox', { name: 'Filter the library' })).toBeFocused();

  // Appearance opens the appearance sheet; Add files opens its menu beside the icon, with Sources, even with the info rail closed.
  await icon(page, 'Search').click();
  await expect(page.locator('#library-root')).toBeHidden();
  await icon(page, 'Appearance').click();
  await expect(page.locator('#appearance')).toBeVisible();
  await page.keyboard.press('Escape');
  await icon(page, 'Add files').click();
  const menu = page.getByRole('menu').filter({ has: page.getByRole('menuitem', { name: 'Index folders and manage source locations' }) });
  await expect(menu).toBeVisible();
  const menuBox = (await menu.boundingBox())!, addBox = (await icon(page, 'Add files').boundingBox())!;
  expect(menuBox.x).toBeGreaterThan(addBox.x + addBox.width);
  await menu.getByRole('menuitem', { name: 'Index folders and manage source locations' }).click();
  await expect(page.getByRole('dialog', { name: 'Sources and originals' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(icon(page, 'Add files')).toBeFocused();

  // Home shows the Home tab from a document, and is the pressed icon while nothing else is.
  await icon(page, 'Library').click();
  await expand(page, folder('reference-docs', '2-creative-apps'));
  await expand(page, folder('reference-docs', '2-creative-apps/drafts'));
  await document_(page, 'reference-docs', '2-creative-apps/Brush-Notes.md').click();
  await expect(page.locator('#filename')).toHaveText('Brush-Notes.md');
  await icon(page, 'Library').click();
  await expect(icon(page, 'Home')).toHaveAttribute('aria-pressed', 'false');
  await icon(page, 'Home').click();
  await expect(page.locator('#home-tab')).toHaveAttribute('aria-selected', 'true');
  await expect(icon(page, 'Home')).toHaveAttribute('aria-pressed', 'true');
});

test('Favorites is a flat list of rows with covers; Collections is the collections tree alone; both open documents', async ({ page }) => {
  await seed(page);
  await icon(page, 'Favorites').click();
  const list = page.locator('#library-root .library-documents');
  await expect(list).toBeVisible();
  await expect(page.getByRole('tree', { name: 'Library' })).toBeHidden();
  const favorites = list.locator('.library-document');
  expect(await favorites.count()).toBeGreaterThanOrEqual(2);
  await expect(page.locator('.library-title-count')).toHaveText(String(await favorites.count()));
  await expect(favorites.first().locator('.library-tile-media')).toBeVisible();
  expect(await favorites.evaluateAll(rowsList => rowsList.map(row => row.querySelector('.library-document-name')?.textContent)))
    .toContain('01_art_nouveau_posters'); // a generic file name shows its folder
  await expect(list.locator('.library-favorite[aria-pressed=true]')).toHaveCount(await favorites.count());

  await icon(page, 'Collections').click();
  await expect(page.getByRole('tree', { name: 'Library' })).toBeVisible();
  await expect(page.locator('#library-root .tree-row.is-section')).toHaveCount(0);
  await expect(node(page, 'c:c-Fashion photo and catalogues')).toBeVisible();
  await expect(node(page, 'c:c-Reading list')).toBeVisible();
  await expect(node(page, root('refs'))).toHaveCount(0);
  await expect(page.locator('.library-title-count')).toHaveText('3');
  await node(page, 'c:c-Reading list').locator('.tree-chevron').click();
  await expect(page.locator('#library-root .tree-row.is-document', { hasText: 'Brush-Notes.md' })).toBeVisible();
  await page.locator('#library-root .tree-row.is-document', { hasText: 'Brush-Notes.md' }).click();
  await expect(page.locator('#filename')).toHaveText('Brush-Notes.md');
});

test('a double-click on a folder opens the board scoped to it, and a right-click on a document is the item menu', async ({ page }) => {
  await seed(page);
  await node(page, folder('refs', '03_vintage_magazine')).dblclick();
  const rootBox = page.locator('#library-root');
  await expect(rootBox).toHaveClass(/is-board/);
  await expect(page.locator('.library-scope-name')).toHaveText('03_vintage_magazine');
  await expect(page.locator('.library-result-count')).toHaveText('2 references');
  // The icon rail stays beside the board.
  expect((await iconRail(page).boundingBox())!.width).toBe(48);
  expect((await rootBox.boundingBox())!.x).toBeGreaterThanOrEqual(54);
  await page.keyboard.press('Escape');
  await expect(rootBox).not.toHaveClass(/is-board/);
  // The tree's folder is as it was before the double-click.
  await expect(node(page, folder('refs', '03_vintage_magazine'))).toHaveAttribute('aria-expanded', 'false');

  await expand(page, folder('refs', '01_art_nouveau_posters'));
  const target = document_(page, 'refs', '01_art_nouveau_posters/source.pdf');
  await target.click({ button: 'right' });
  const menu = page.locator('#library-root .library-item-menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem')).toContainText(['Open in new tab', 'Remove from favorites', 'Details', 'Organize…', 'Remove from library…']);
  await menu.getByRole('menuitem', { name: 'Remove from favorites' }).click();
  await icon(page, 'Favorites').click();
  await expect(page.locator('#library-root .library-document', { hasText: '01_art_nouveau_posters' })).toHaveCount(0);
  await icon(page, 'Library').click();
  await expand(page, folder('refs', '01_art_nouveau_posters'));
  await target.click({ button: 'right' });
  await menu.getByRole('menuitem', { name: 'Open in new tab' }).click();
  await expect(page.locator('#tab-count')).toHaveText('1');
});

test('a generic file name is shown by its folder on Home, in the library rows and on tabs; the tree keeps the file name', async ({ page }) => {
  await seed(page, 20);
  await expand(page, folder('refs', '03_vintage_magazine'));
  await expect(document_(page, 'refs', '03_vintage_magazine/source.pdf').locator('.tree-label')).toHaveText('source.pdf');
  await document_(page, 'refs', '03_vintage_magazine/source.pdf').click();
  await expect(page.locator('#filename')).toHaveText('03_vintage_magazine');
  await expect(page.locator('#tab-list [role=tab]').first()).toContainText('03_vintage_magazine');
  await icon(page, 'Library').click();
  await icon(page, 'Home').click();
  const card = page.locator('#empty .jump-card, #empty [data-path]').filter({ hasText: '03_vintage_magazine' });
  await expect(card.first()).toBeVisible();
});

test('the compact sheet shows the same tree and closes once a document is chosen', async ({ page }) => {
  await seed(page, 40, 420);
  await expect(page.locator('#library-rail')).toBeHidden();
  await page.locator('#library-toggle').click();
  const tree = page.getByRole('tree', { name: 'Library' });
  await expect(tree).toBeVisible();
  await expect(node(page, root('refs'))).toBeVisible();
  await expect(page.locator('#library-root .library-close')).toBeVisible();
  const sheet = (await page.locator('.library-panel').boundingBox())!;
  expect(sheet.width).toBeLessThanOrEqual(420);
  expect(await tree.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expand(page, folder('reference-docs', '2-creative-apps'));
  await page.keyboard.press('Tab');
  await document_(page, 'reference-docs', '2-creative-apps/Brush-Notes.md').click();
  await expect(page.locator('#filename')).toHaveText('Brush-Notes.md');
  await expect(page.locator('#library-root')).toBeHidden();
});

test('a library of 300 nested documents opens, filters and expands without a long task', async ({ page }) => {
  await seed(page, 300);
  await page.evaluate(() => {
    const longest = { ms: 0 };
    Object.assign(window, { longest });
    new PerformanceObserver(list => { for (const entry of list.getEntries()) longest.ms = Math.max(longest.ms, entry.duration); }).observe({ entryTypes: ['longtask'] });
  });
  await expect(page.locator('.library-title-count')).toHaveText('300');
  expect(await rows(page).count()).toBeLessThan(40); // only what is open is in the DOM
  // Filtering opens every folder above the matches: the worst case for the DOM, timed in the page.
  await page.getByRole('button', { name: 'Filter the library' }).click();
  const took = await page.evaluate(() => {
    const field = document.getElementById('library-tree-filter') as HTMLInputElement;
    const start = performance.now(); field.value = 'e'; field.dispatchEvent(new Event('input', { bubbles: true }));
    const typing = performance.now() - start;
    return { typing, rows: document.querySelectorAll('#library-root .tree-row').length };
  });
  expect(took.rows).toBeGreaterThan(200);
  expect(took.typing).toBeLessThan(250);
  // Scrolling through the long list and clearing the filter do not stall either.
  await page.locator('.library-tree').evaluate(element => { element.scrollTop = element.scrollHeight; });
  await page.keyboard.press('Escape');
  await expect(rows(page).first()).toBeVisible();
  const longest = await page.evaluate(() => Reflect.get(window, 'longest').ms as number);
  expect(longest).toBeLessThan(250);
});
