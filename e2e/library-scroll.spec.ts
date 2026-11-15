import { test, expect, type Page } from '@playwright/test';
import { seedLibrary, type FixtureCollection, type FixtureDocument } from './home-fixture';
import { chooseFromViewMenu, openBoard } from './library-controls';
import { pngFixture } from './png-fixture';
import { warmDevServer } from './warm';

// The library board has no pages: the whole filtered and sorted set is one scroll, rendered in batches as the end of what is shown comes near.
// Every fixture is generated: 1,000 documents named `Reference 0001.md` … `Reference 1000.md`.
test.beforeAll(async ({ browser, baseURL }) => { await warmDevServer(browser, baseURL); });

const total = 1000;
const name = (index: number, format: string) => `Reference ${String(index).padStart(4, '0')}.${format}`;
const picture = pngFixture(16, 24, [90, 120, 160]);
const rows = (page: Page) => page.locator('.library-documents .library-document');
const tiles = (page: Page) => page.locator('.library-documents .library-tile');

async function seed(page: Page, documents: FixtureDocument[], collections: FixtureCollection[] = []) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await seedLibrary(page, documents, collections);
  await expect(page.locator('#library-root')).toBeVisible();
  await openBoard(page);
}
const texts = (count = total): FixtureDocument[] => Array.from({ length: count }, (_, index) => ({ name: name(index + 1, 'md'), format: 'md' }));
const pictures = (count = total): FixtureDocument[] => Array.from({ length: count }, (_, index) => ({ name: name(index + 1, 'png'), format: 'png', content: picture }));
/** Scrolls the list to its end, again each time a batch moves the end further down, until the sentinel is gone (everything is rendered); reports how many documents are rendered. */
const scrollToEnd = (page: Page) => page.evaluate(async () => {
  const list = document.querySelector<HTMLElement>('.library-documents')!;
  for (let frame = 0; frame < 3000 && list.querySelector('.library-sentinel'); frame++) { list.scrollTop = list.scrollHeight; await new Promise(resolve => requestAnimationFrame(() => resolve(undefined))); }
  list.scrollTop = list.scrollHeight;
  return list.querySelectorAll('.library-document').length;
});
const scrollTop = (page: Page) => page.evaluate(() => document.querySelector('.library-documents')!.scrollTop);
const focusFirst = (page: Page) => page.locator('.library-documents .library-document-open').first().focus();

test('no pager: the board lists every document in one scroll and reaches the last one', async ({ page }) => {
  await seed(page, texts());
  await expect(page.locator('.library-result-count')).toHaveText(`${total} references`);
  // Nothing that looks like pages, and the whole set is not in the DOM up front.
  await expect(page.locator('.library-pager')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /library page/i })).toHaveCount(0);
  await expect(page.locator('#library-root')).not.toContainText(/\d+\s*[–-]\s*\d+\s*\/\s*\d+/);
  expect(await rows(page).count()).toBeGreaterThan(0);
  expect(await rows(page).count()).toBeLessThan(200);
  await expect.poll(() => scrollToEnd(page)).toBe(total);
  const last = rows(page).filter({ hasText: name(total, 'md') });
  await expect(last).toBeInViewport();
  await expect(rows(page).first()).toContainText(name(1, 'md'));
});

test('End focuses the last item, however many are rendered; arrows cross a batch boundary', async ({ page }) => {
  await seed(page, texts());
  await focusFirst(page);
  await page.keyboard.press('End');
  await expect(rows(page)).toHaveCount(total);
  const focused = page.locator('.library-document-open:focus');
  await expect(focused).toHaveAccessibleName(new RegExp(name(total, 'md')));
  await expect(focused).toBeInViewport();
  await page.keyboard.press('Home');
  await expect(focused).toHaveAccessibleName(new RegExp(name(1, 'md')));
  expect(await scrollTop(page)).toBe(0);
  // 70 steps down pass the first batch (60 rows): the next batch is rendered on demand and the focus keeps going.
  for (let step = 0; step < 70; step++) await page.keyboard.press('ArrowDown');
  await expect(focused).toHaveAccessibleName(new RegExp(name(71, 'md')));
  await page.keyboard.press('ArrowUp');
  await expect(focused).toHaveAccessibleName(new RegExp(name(70, 'md')));
});

test('selection, the detail strip and the item menu work on a document from a later batch', async ({ page }) => {
  await seed(page, texts());
  await focusFirst(page);
  await page.keyboard.press('End');
  const open = page.locator('.library-document-open:focus');
  await expect(open).toHaveAccessibleName(new RegExp(name(total, 'md')));
  await open.click();
  await expect(open).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.library-detail-name')).toHaveText(name(total, 'md'));
  const more = page.getByRole('button', { name: `More actions for ${name(total, 'md')}` });
  await more.click();
  await expect(page.locator('.library-item-menu:not(.library-view-menu):not(.library-add-menu)').getByRole('menuitem', { name: 'Details' })).toBeVisible();
  await page.keyboard.press('Escape');
  // An edit re-renders the board without losing the place: the same documents stay rendered and the list stays where it was.
  await page.getByRole('button', { name: `Favorite ${name(total, 'md')}` }).click();
  await expect(page.getByRole('button', { name: `Unfavorite ${name(total, 'md')}` })).toBeInViewport();
  await expect(rows(page)).toHaveCount(total);
});

test('a filter or a sort change starts again at the top', async ({ page }) => {
  await seed(page, texts());
  await expect.poll(() => scrollToEnd(page)).toBe(total);
  expect(await scrollTop(page)).toBeGreaterThan(1000);
  await chooseFromViewMenu(page, 'Name A–Z');
  await expect.poll(() => scrollTop(page)).toBe(0);
  expect(await rows(page).count()).toBeLessThan(200);
  await expect.poll(() => scrollToEnd(page)).toBe(total);
  const search = page.locator('.library-search');
  await search.fill('Reference 09');
  const expected = texts().filter(document => document.name.includes('09')).length; // 119: 0009, 0090–0099, 0109, … 0900–0999
  await expect(page.locator('.library-result-count')).toHaveText(`${expected} references`);
  expect(await scrollTop(page)).toBe(0);
  await expect.poll(() => scrollToEnd(page)).toBe(expected);
});

test('thumbnails are requested only for tiles near the viewport', async ({ page }) => {
  // The browser build makes an image's thumbnail with createImageBitmap(file, { resizeWidth }): count those, which are the requests that reached the work.
  await page.addInitScript(() => {
    const original = window.createImageBitmap.bind(window);
    Object.assign(window, {
      thumbnailsMade: 0,
      createImageBitmap: (source: ImageBitmapSource, options?: ImageBitmapOptions) => { if (options?.resizeWidth) Object.assign(window, { thumbnailsMade: Number(Reflect.get(window, 'thumbnailsMade')) + 1 }); return original(source, options); },
    });
  });
  await seed(page, pictures());
  const made = () => page.evaluate(() => Number(Reflect.get(window, 'thumbnailsMade')));
  const loaded = page.locator('.library-documents .library-tile-media.is-loaded');
  await expect(tiles(page).first()).toBeVisible();
  await expect.poll(() => loaded.count()).toBeGreaterThan(0);
  // The first screen: a handful of tiles, not everything rendered so far, and nowhere near the 1,000 of the set.
  await expect.poll(made).toBeGreaterThan(0);
  expect(await made()).toBeLessThanOrEqual(30);
  // All 1,000 rendered and the view at the end: only the tiles around the end were asked for, none of the ~950 in between.
  await focusFirst(page);
  await page.keyboard.press('End');
  await expect(tiles(page)).toHaveCount(total);
  await expect(tiles(page).last().locator('.library-tile-media')).toHaveClass(/is-loaded/);
  expect(await made()).toBeLessThanOrEqual(80);
  expect(await loaded.count()).toBeLessThanOrEqual(80);
  await expect(tiles(page).nth(500).locator('.library-tile-media')).not.toHaveClass(/is-loaded/);
});

test('a shelf header is drawn once, however many batches its tiles span', async ({ page }) => {
  const shelves = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'];
  const documents: FixtureDocument[] = [
    ...Array.from({ length: 10 }, (_, index): FixtureDocument => ({ name: name(index + 1, 'png'), format: 'png', content: picture, collections: ['Parent'] })),
    ...shelves.flatMap((shelf, at) => Array.from({ length: 198 }, (_, index): FixtureDocument => ({ name: name(11 + at * 198 + index, 'png'), format: 'png', content: picture, collections: [shelf] }))),
  ];
  const collections: FixtureCollection[] = [{ name: 'Parent' }, ...shelves.map(shelf => ({ name: shelf, parent: 'Parent' }))];
  await seed(page, documents, collections);
  await page.getByRole('button', { name: 'Parent', exact: true }).click();
  await expect(page.locator('.library-result-count')).toHaveText(`${documents.length} references`);
  await expect(page.locator('.library-shelf-head')).toHaveCount(1); // The collection's own documents need no header; the first shelf starts after them.
  // Scroll down frame by frame, as a batch lands after another: after every one no shelf has a second header, though the batch boundaries (30, 60, 90 …) fall inside shelves of 198.
  const walked = await page.locator('.library-documents').evaluate(async list => {
    const counts = new Set<number>(); let duplicated = false;
    for (let frame = 0; frame < 3000 && list.querySelector('.library-sentinel'); frame++) {
      list.scrollTop = list.scrollHeight; await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)));
      const heads = Array.from(list.querySelectorAll<HTMLElement>('.library-shelf-head'), head => head.dataset.shelf);
      if (new Set(heads).size !== heads.length) duplicated = true;
      counts.add(list.querySelectorAll('.library-tile').length);
    }
    return { duplicated, batches: counts.size, last: list.querySelectorAll('.library-tile').length };
  });
  expect(walked.duplicated).toBe(false);
  expect(walked.batches).toBeGreaterThan(20);
  expect(walked.last).toBe(documents.length);
  await expect(tiles(page)).toHaveCount(documents.length);
  await expect(page.locator('.library-shelf-head')).toHaveCount(shelves.length);
  // In the DOM order, a shelf's tiles follow its header and number what the header says.
  const runs = await page.locator('.library-documents').evaluate(list => {
    const result: { shelf: string; count: number; tiles: number }[] = [];
    for (const child of Array.from(list.children)) {
      if (child.classList.contains('library-shelf-head')) result.push({ shelf: (child as HTMLElement).dataset.shelf!, count: Number(child.querySelector('.library-shelf-count')!.textContent), tiles: 0 });
      else if (child.classList.contains('library-tile') && result.length) result[result.length - 1].tiles++;
    }
    return result;
  });
  expect(runs).toHaveLength(shelves.length);
  for (const run of runs) expect(run.tiles).toBe(run.count);
});
