import { test, expect, type Locator, type Page } from '@playwright/test';
import { pathOfItem, seedLibrary, treeLibrary } from './home-fixture';
import { warmDevServer } from './warm';
import { railHome } from './toolbar-tabs';

// The library panel's tree (src/library-tree*.ts) and the icon rail beside it (src/icon-rail.ts), on a library shaped like a real catalog:
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

  // Sections are quiet captions, in the order Favorites, Collections, Folders, Loose files; each source root is a bold top-level row, open at first, its subfolders closed.
  const captions = page.locator('#library-root .tree-row.is-section');
  await expect(captions).toHaveText([/^Favorites\s*\d+$/, /^Collections\s*3$/, /^Folders\s*37$/, /^Loose files\s*3$/]);
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
  // Exactly the three open ones (01_art_nouveau_posters, 03_vintage_magazine, 09_motorcycle_catalogues), each under its own folder: one collapsing into another would show two.
  expect(sources.map(path => path!.split('/').slice(-2, -1)[0]).sort()).toEqual(['01_art_nouveau_posters', '03_vintage_magazine', '09_motorcycle_catalogues']);
  expect(new Set(sources).size).toBe(3);

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
  await expect(railHome(page)).toHaveAttribute('aria-current', 'page');
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
  expect(await focused(page)).toBe('s:favorites');

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
  await expect(railHome(page)).toHaveAttribute('aria-current', 'page');
  await page.keyboard.press('Enter');
  await expect(page.locator('#filename')).toHaveText('Brush-Notes.md');
  await expect(page.locator('.reader-host:not(.staging):not(.tab-hidden)')).toBeFocused(); // the document is read: the page takes focus

  // Typing jumps to the next row whose name starts with the letters, wherever they are in the list.
  await node(page, root('Design materials')).focus();
  await page.keyboard.type('refs');
  expect(await focused(page)).toBe(root('refs'));
  await page.keyboard.press('ArrowDown');
  await page.keyboard.type('09_');
  expect(await focused(page)).toBe(folder('refs', '09_motorcycle_catalogues'));
  // A Shift pressed on its own (as for '_' or a capital) keeps the letters typed so far.
  await page.keyboard.press('Home'); // a navigation key starts the next search afresh
  await page.keyboard.type('ref');
  expect(await focused(page)).toBe(root('reference-docs')); // 'reference-docs' sorts before 'refs'; the "Reading list" collection above it does not start with 'ref'
  await page.keyboard.down('Shift'); await page.keyboard.up('Shift');
  await page.keyboard.type('s');
  expect(await focused(page)).toBe(root('refs')); // 'refs', not a fresh search for 'f' or 's'
});

test('the filter is always under the header, narrows the tree as you type, highlights the matches, opens the folders above them, and clears with Escape', async ({ page }) => {
  await seed(page);
  const field = page.getByRole('searchbox', { name: 'Filter the library' });
  await expect(field).toBeVisible();
  await expect(field).toHaveAttribute('placeholder', 'Filter 40 documents');
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
  // Escape clears what was typed, and the saved open state is what it was; the field stays, and with nothing typed Escape closes the panel as it does anywhere in it.
  await page.keyboard.press('Escape');
  await expect(field).toHaveValue('');
  await expect(field).toBeVisible();
  await expect(node(page, folder('refs', '03_vintage_magazine'))).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('Escape');
  await expect(page.locator('#library-root')).toBeHidden();
  // Arrow Down from the field moves into the tree.
  await icon(page, 'Library').click(); await field.fill('rust');
  await page.keyboard.press('ArrowDown');
  expect(await focused(page)).toMatch(/^s:/);
});

test('the icon rail: Home, Add files, Library and Search at the top, Settings at the foot; each does one thing, and Library wears the fill while the panel is open', async ({ page }) => {
  await seed(page);
  const names = ['Home', 'Add files', 'Library', 'Search', 'Settings'];
  const buttons = iconRail(page).getByRole('button');
  await expect(buttons).toHaveText(names.map(() => ''));
  expect(await buttons.evaluateAll(list => list.map(button => button.getAttribute('aria-label')))).toEqual(names);
  expect(await buttons.evaluateAll(list => list.map(button => button.getAttribute('data-tip')))).toEqual(['Home', 'Add files', 'Library  Ctrl+B', 'Search  Ctrl+Shift+F', 'Settings']);
  // Top to bottom: the four top icons evenly stacked, Settings apart from them at the foot.
  const ys = await buttons.evaluateAll(list => list.map(button => Math.round(button.getBoundingClientRect().y)));
  expect([...ys].sort((a, b) => a - b)).toEqual(ys);
  expect(new Set(ys.slice(1, 4).map((y, i) => y - ys[i]!)).size).toBe(1);
  expect(ys[4]! - ys[3]!).toBeGreaterThan(100);

  // Library is the pressed icon while the panel is open, and collapses it; the filled tone is the accent-soft one.
  const fill = (name: string) => icon(page, name).evaluate(button => getComputedStyle(button).backgroundColor);
  await expect(icon(page, 'Library')).toHaveAttribute('aria-pressed', 'true');
  expect(await fill('Library')).not.toBe(await fill('Search'));
  await icon(page, 'Library').click();
  await expect(page.locator('#library-root')).toBeHidden();
  await expect(icon(page, 'Library')).toHaveAttribute('aria-pressed', 'false');
  // Search opens the panel on its filter field; Ctrl+Shift+F is Search from anywhere.
  await icon(page, 'Search').click();
  await expect(page.locator('#library-root')).toBeVisible();
  await expect(page.getByRole('searchbox', { name: 'Filter the library' })).toBeFocused();
  await icon(page, 'Library').click();
  await page.keyboard.press('Control+Shift+F');
  await expect(page.getByRole('searchbox', { name: 'Filter the library' })).toBeFocused();

  // Settings opens the Settings sheet; Add files opens its menu beside the icon, with Sources, even with the panel closed.
  await icon(page, 'Library').click();
  await expect(page.locator('#library-root')).toBeHidden();
  await icon(page, 'Settings').click();
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
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
});

test('FAVORITES lists exactly the favorites, flat, with progress; COLLECTIONS nests; sections keep their own saved open state; every section opens documents', async ({ page }) => {
  await seed(page);
  const captions = page.locator('#library-root .tree-row.is-section');
  await expect(captions).toHaveCount(4);
  await expect(page.getByRole('tree', { name: 'Library' })).toBeVisible();
  const { documents } = treeLibrary(40);
  const wanted = documents.filter(item => item.favorite).map(item => pathOfItem(item)).sort();
  expect(wanted.length).toBeGreaterThanOrEqual(2);
  // Flat: every favorite is a document row directly under the FAVORITES caption (level 2), once.
  const favorites = page.locator('#library-root .tree-row.is-document[id^="tree:fv:"]');
  expect(await favorites.evaluateAll(list => list.map(row => (row as HTMLElement).dataset.docPath!).sort())).toEqual(wanted);
  expect(await favorites.evaluateAll(list => list.every(row => row.getAttribute('aria-level') === '2'))).toBe(true);
  await expect(captions.first()).toHaveText(new RegExp(`^Favorites\\s*${wanted.length}$`));
  // The favorite with reading progress shows it, and a generic file name shows its folder.
  await expect(page.locator('#library-root .tree-row[id^="tree:fv:"] .tree-label', { hasText: '01_art_nouveau_posters' })).toBeVisible();
  await expect(page.locator('#library-root .tree-row[id^="tree:fv:"][data-doc-path$="Rust-Book-1.99.epub"] .tree-meta')).toHaveText('37 %');

  // COLLECTIONS: the collections tree with documents inside, nested.
  await expect(node(page, 'c:c-Fashion photo and catalogues')).toBeVisible();
  await expect(node(page, 'c:c-Reading list')).toBeVisible();
  await node(page, 'c:c-Reading list').locator('.tree-chevron').click();
  const brush = page.locator('#library-root .tree-row.is-document', { hasText: 'Brush-Notes.md' });
  await expect(brush.first()).toBeVisible();

  // A section folds on its own and the state is saved like a folder's.
  await node(page, 's:favorites').click();
  await expect(node(page, 's:favorites')).toHaveAttribute('aria-expanded', 'false');
  await expect(favorites).toHaveCount(0);
  await expect(node(page, root('refs'))).toBeVisible();
  await page.reload();
  await expect(node(page, 's:favorites')).toHaveAttribute('aria-expanded', 'false');
  await node(page, 's:favorites').click();
  await expect(favorites).toHaveCount(wanted.length);

  // A document opens from a favorites row, and ⌘/Ctrl-click opens a background tab from it.
  const rust = page.locator('#library-root .tree-row[id^="tree:fv:"][data-doc-path$="Rust-Book-1.99.epub"]');
  await rust.click({ modifiers: [process.platform === 'darwin' ? 'Meta' : 'Control'] });
  await expect(page.locator('#tab-count')).toHaveText('1');
  await brush.first().click();
  await expect(page.locator('#filename')).toHaveText('Brush-Notes.md');

  // The keyboard walks across sections: Down from the last favorite reaches the COLLECTIONS caption.
  await favorites.last().focus();
  await page.keyboard.press('ArrowDown');
  expect(await focused(page)).toBe('s:collections');
  await page.keyboard.type('Fold');
  expect(await focused(page)).toBe('s:folders'); // type-ahead jumps between sections too
});

test('a new collection starts from the COLLECTIONS caption: its + and its menu', async ({ page }) => {
  await seed(page);
  const caption = node(page, 's:collections');
  await caption.hover();
  await caption.locator('.tree-add').click();
  const dialog = page.getByRole('dialog', { name: 'New collection' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Collection name').fill('Shelf from the panel');
  await dialog.getByRole('button', { name: 'Create collection' }).click();
  await expect(node(page, 's:collections').locator('.tree-meta')).toHaveText('3');
  await expect(page.locator('#library-root .tree-row.is-collection', { hasText: 'Shelf from the panel' })).toBeVisible();
  // From the keyboard, the caption's menu has it too.
  await node(page, 's:collections').focus();
  await page.keyboard.press('Shift+F10');
  await expect(page.locator('.library-item-menu:not(.library-view-menu):not(.library-add-menu)').getByRole('menuitem')).toHaveText(['New collection…']);
});

test('a double-click on a folder shows it in the Library tab, and a right-click on a document is the item menu', async ({ page }) => {
  await seed(page);
  await node(page, folder('refs', '03_vintage_magazine')).dblclick();
  const rootBox = page.locator('#library-root');
  await expect(page.locator('#library-page')).toBeVisible();
  await expect(page.locator('.library-scope-name')).toHaveText('refs › 03_vintage_magazine');
  await expect(page.locator('.library-result-count')).toHaveText('2 references');
  // The icon rail and the panel stay beside the page, and the page does not reach under them.
  expect((await iconRail(page).boundingBox())!.width).toBe(36);
  expect((await rootBox.boundingBox())!.x).toBeGreaterThanOrEqual(46);
  const panel = (await rootBox.boundingBox())!, view = (await page.locator('#library-page').boundingBox())!;
  expect(view.x).toBeGreaterThanOrEqual(panel.x + panel.width);
  await expect(node(page, folder('refs', '03_vintage_magazine'))).toHaveClass(/is-scope/);
  // The tree's folder is as it was before the double-click.
  await expect(node(page, folder('refs', '03_vintage_magazine'))).toHaveAttribute('aria-expanded', 'false');

  await expand(page, folder('refs', '01_art_nouveau_posters'));
  const target = document_(page, 'refs', '01_art_nouveau_posters/source.pdf');
  await target.click({ button: 'right' });
  const menu = page.locator('.library-item-menu:not(.library-view-menu):not(.library-add-menu)');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem')).toContainText(['Open in new tab', 'Remove from favorites', 'Details', 'Organize…', 'Remove from library…']);
  await menu.getByRole('menuitem', { name: 'Remove from favorites' }).click();
  // It leaves FAVORITES (its row in FOLDERS stays).
  await expect(page.locator('#library-root .tree-row[id^="tree:fv:"]', { hasText: '01_art_nouveau_posters' })).toHaveCount(0);
  await expect(target).toBeVisible();
  await expand(page, folder('refs', '01_art_nouveau_posters'));
  await target.click({ button: 'right' });
  await menu.getByRole('menuitem', { name: 'Open in new tab' }).click();
  await expect(page.locator('#tab-count')).toHaveText('2'); // The Library tab and the document, in the background.
});

test('a generic file name is shown by its folder on Home, in the library rows and on tabs; the tree keeps the file name', async ({ page }) => {
  await seed(page, 20);
  await expand(page, folder('refs', '03_vintage_magazine'));
  await expect(document_(page, 'refs', '03_vintage_magazine/source.pdf').locator('.tree-label')).toHaveText('source.pdf');
  await document_(page, 'refs', '03_vintage_magazine/source.pdf').click();
  await expect(page.locator('#filename')).toHaveText('03_vintage_magazine');
  await expect(page.locator('#tab-list [role=tab]').first()).toContainText('03_vintage_magazine');
  await railHome(page).click();
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

test('a library of 300 nested documents opens, and filters to every folder, with only the open rows in the DOM', async ({ page }) => {
  await seed(page, 300);
  await expect(page.locator('.library-title-count')).toHaveText('300');
  expect(await rows(page).count()).toBeLessThan(60); // only what is open is in the DOM
  // Filtering opens every folder above the matches: the worst case for the DOM.
  const took = await page.evaluate(() => {
    const field = document.getElementById('library-tree-filter') as HTMLInputElement;
    field.value = 'e'; field.dispatchEvent(new Event('input', { bubbles: true }));
    return { rows: document.querySelectorAll('#library-root .tree-row').length };
  });
  expect(took.rows).toBeGreaterThan(200);
  // Scrolling through the long list and clearing the filter leave the tree standing.
  await page.locator('.library-tree').evaluate(element => { element.scrollTop = element.scrollHeight; });
  await page.keyboard.press('Escape');
  await expect(rows(page).first()).toBeVisible();
});
