import { test, expect, type Locator, type Page } from '@playwright/test';
import { bigLibrary, seedLibrary, type FixtureCollection, type FixtureDocument } from './home-fixture';

const PAGED = { fraction: 39 / 145, page: 40, pages: 146 };
const mixed: FixtureDocument[] = [
  { name: 'Alpha.pdf', format: 'pdf', opened: 1, progress: PAGED, favorite: true, collections: ['Alpha shelf'] },
  { name: 'Beta.epub', format: 'epub', opened: 2, progress: { fraction: .5 }, collections: ['Alpha shelf'] },
  { name: 'Notes.md', format: 'md', opened: 3, favorite: true, collections: ['Reading list'] },
  { name: 'Plain.txt', format: 'txt', opened: 4, progress: { fraction: .4 }, collections: ['Reading list'] },
  { name: 'Photo.png', format: 'png', opened: 5 },
  { name: 'Done.pdf', format: 'pdf', opened: 6, progress: { fraction: 1, page: 10, pages: 10 } },
  { name: 'Quiet.pdf', format: 'pdf', collections: ['Alpha shelf'] },
  ...Array.from({ length: 6 }, (_, index): FixtureDocument => ({ name: `Extra ${index + 1}.txt`, format: 'txt', opened: 7 + index })),
];
const mixedCollections: FixtureCollection[] = [{ name: 'Alpha shelf' }, { name: 'Reading list' }, { name: 'Empty shelf' }];

test.beforeEach(async ({ page }) => {
  // The drawer starts closed so Home is what the window shows.
  await page.addInitScript(() => { localStorage.setItem('hold-my-brief:library-wide', 'closed'); localStorage.setItem('hold-my-brief:library-narrow', 'closed'); });
  await page.setViewportSize({ width: 1080, height: 760 });
});

const region = (page: Page, name: string) => page.getByRole('region', { name, exact: true });
const columns = (grid: Locator) => grid.evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length);
const chip = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const cardPaths = async (scope: Locator) => { await scope.locator('[data-home-path]').first().waitFor(); return scope.locator('[data-home-path]').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.homePath!.split('/').pop())); };

test('the sections are labelled regions in order: chips, Jump back in, then shelves; empty ones are not drawn', async ({ page }) => {
  await seedLibrary(page, mixed, mixedCollections);
  await expect(page.getByRole('heading', { name: 'Home', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2 })).toHaveText(['Jump back in', 'Continue reading', 'Favorites', 'Collections']);
  for (const name of ['Jump back in', 'Continue reading', 'Favorites', 'Collections']) await expect(region(page, name)).toBeVisible();
  await expect(page.locator('.home-chip')).toHaveText(['All', 'PDF', 'EPUB', 'Markdown', 'Text', 'Images']);
  // The old masonry sections and the File type select are gone.
  await expect(page.locator('#home-format, .home-grid, .home-tile')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /Recently opened|Library$/ })).toHaveCount(0);
  // Shelves are lists, and each card is a button named by its title.
  await expect(region(page, 'Favorites').getByRole('list')).toBeVisible();
  await expect(region(page, 'Favorites').getByRole('listitem')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Open Alpha.pdf', exact: true }).first()).toBeVisible();
  // Open files and Browse library stay.
  await expect(page.getByRole('button', { name: 'Open files' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Browse library' })).toBeVisible();
});

test('a library with nothing starred, in progress or collected leaves those sections out; one with no opened file says so', async ({ page }) => {
  await seedLibrary(page, [{ name: 'a.txt', format: 'txt', opened: 1 }, { name: 'b.txt', format: 'txt', opened: 2 }]);
  await expect(region(page, 'Jump back in')).toBeVisible();
  await expect(page.getByRole('heading', { level: 2 })).toHaveText(['Jump back in']);
  await expect(page.locator('.home-chip')).toHaveCount(0); // One type: nothing to choose between.
  await seedLibrary(page, [{ name: 'a.txt', format: 'txt' }]);
  await expect(page.locator('#empty.is-home')).toBeVisible();
  await expect(page.getByRole('heading', { level: 2 })).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('Nothing opened yet');
});

test('the chips offer only the types the library has, and filter every section', async ({ page }) => {
  await seedLibrary(page, mixed.filter(item => item.format !== 'png'), mixedCollections);
  await expect(page.locator('.home-chip')).toHaveText(['All', 'PDF', 'EPUB', 'Markdown', 'Text']);
  await expect(chip(page, 'All')).toHaveAttribute('aria-pressed', 'true');
  await chip(page, 'PDF').click();
  await expect(chip(page, 'PDF')).toHaveAttribute('aria-pressed', 'true');
  await expect(chip(page, 'PDF')).toBeFocused();
  expect(await cardPaths(region(page, 'Jump back in'))).toEqual(['Alpha.pdf', 'Done.pdf']);
  expect(await cardPaths(region(page, 'Continue reading'))).toEqual(['Alpha.pdf']);
  expect(await cardPaths(region(page, 'Favorites'))).toEqual(['Alpha.pdf']);
  // Collections count only PDFs: Reading list has none, so it goes.
  await expect(region(page, 'Collections').getByRole('listitem')).toHaveCount(1);
  await expect(region(page, 'Collections')).toContainText('Alpha shelf');
  await expect(region(page, 'Collections')).toContainText('2 references');
  await chip(page, 'Text').click();
  expect(await cardPaths(region(page, 'Jump back in'))).toEqual(['Plain.txt', 'Extra 1.txt', 'Extra 2.txt', 'Extra 3.txt', 'Extra 4.txt', 'Extra 5.txt', 'Extra 6.txt']);
  await expect(page.getByRole('heading', { name: 'Favorites' })).toHaveCount(0);
  await chip(page, 'All').click();
  await expect(page.getByRole('heading', { level: 2 })).toHaveText(['Jump back in', 'Continue reading', 'Favorites', 'Collections']);
});

test('Jump back in is the 8 most recently opened, in 4, 2 (also at 420) or 1 columns, as 52 px cards with a 39 x 52 cover and a progress line', async ({ page }) => {
  await seedLibrary(page, mixed, mixedCollections);
  const grid = region(page, 'Jump back in').getByRole('list');
  const cards = grid.getByRole('listitem');
  await expect(cards).toHaveCount(8);
  expect(await cardPaths(grid)).toEqual(['Alpha.pdf', 'Beta.epub', 'Notes.md', 'Plain.txt', 'Photo.png', 'Done.pdf', 'Extra 1.txt', 'Extra 2.txt']);
  expect(await columns(grid)).toBe(4);
  const box = async (index: number) => (await cards.nth(index).boundingBox())!;
  expect((await box(0)).height).toBeCloseTo(52, 0);
  expect((await box(3)).y).toBeCloseTo((await box(0)).y, 0);
  expect((await box(4)).y).toBeGreaterThan((await box(0)).y + 52); // Two rows.
  const cover = (await cards.nth(0).locator('.library-tile-media').boundingBox())!;
  expect(cover.width).toBeCloseTo(39, 0); expect(cover.height).toBeCloseTo(52, 0); expect(cover.x).toBeCloseTo((await box(0)).x, 0);
  // Title on one line with an ellipsis; a 3 px line only where there is progress.
  await expect(cards.nth(0).locator('.home-card-title')).toHaveText('Alpha');
  expect((await cards.nth(0).locator('.home-progress').boundingBox())!.height).toBeCloseTo(3, 0);
  await expect(cards.nth(4).locator('.home-progress')).toHaveCount(0); // Photo: no progress.
  const fill = await cards.nth(0).locator('.home-progress > i').evaluate(node => (node as HTMLElement).style.width);
  expect(parseFloat(fill)).toBeCloseTo(26.9, 0);
  await page.setViewportSize({ width: 760, height: 760 });
  expect(await columns(grid)).toBe(2);
  await expect(cards).toHaveCount(8);
  await page.setViewportSize({ width: 420, height: 620 });
  expect(await columns(grid)).toBe(2); // 2 x 4 in the compact window.
  await expect(cards).toHaveCount(8);
  expect((await cards.nth(1).boundingBox())!.y).toBeCloseTo((await cards.nth(0).boundingBox())!.y, 0);
  expect((await cards.nth(2).boundingBox())!.y).toBeGreaterThan((await cards.nth(0).boundingBox())!.y + 52);
  await page.setViewportSize({ width: 360, height: 620 });
  expect(await columns(grid)).toBe(1); // Below about 380 px of content width.
  await expect(cards).toHaveCount(8);
  await page.setViewportSize({ width: 420, height: 620 });
  // No sideways overflow in the compact window.
  expect(await page.locator('#empty').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
});

test('Jump back in is at most 8 however many were opened, and a card with a long title ellipsizes on one line', async ({ page }) => {
  const long = 'A very long title that cannot possibly fit on one line of a narrow card at all.txt';
  await seedLibrary(page, [{ name: long, format: 'txt', opened: 1 }, ...Array.from({ length: 12 }, (_, index): FixtureDocument => ({ name: `n${index}.txt`, format: 'txt', opened: index + 2 }))]);
  await expect(region(page, 'Jump back in').getByRole('listitem')).toHaveCount(8);
  const title = region(page, 'Jump back in').locator('.home-card-title').first();
  expect(await title.evaluate(node => node.scrollWidth > node.clientWidth && getComputedStyle(node).textOverflow === 'ellipsis' && getComputedStyle(node).whiteSpace === 'nowrap')).toBe(true);
});

test('a Jump back in card opens its document in a tab', async ({ page }) => {
  await seedLibrary(page, mixed, mixedCollections);
  await page.getByRole('button', { name: 'Open Notes.md', exact: true }).first().click();
  await expect(page.locator('#tab-list .tab.is-active .tab-title')).toHaveText('Notes.md');
  await expect(page.locator('#empty')).toBeHidden();
  // The Home tab shows Home again, and a card for an open document focuses its tab instead of opening a second.
  await page.locator('#home-tab').click();
  await expect(page.locator('#empty')).toBeVisible();
  await page.getByRole('button', { name: 'Open Notes.md', exact: true }).first().click();
  await expect(page.locator('#tab-list .tab')).toHaveCount(1);
});

test('shelf cards: Continue reading carries progress, Favorites the format, Collections a mosaic and a count', async ({ page }) => {
  await seedLibrary(page, mixed, mixedCollections);
  const reading = region(page, 'Continue reading');
  expect(await cardPaths(reading)).toEqual(['Alpha.pdf', 'Beta.epub', 'Plain.txt']); // Done.pdf is Finished; Notes was never read.
  await expect(reading.getByRole('listitem').nth(0).locator('.home-card-meta')).toHaveText('PDF · p. 40 / 146');
  await expect(reading.getByRole('listitem').nth(1).locator('.home-card-meta')).toHaveText('EPUB · 50 %');
  const first = reading.getByRole('listitem').first();
  expect((await first.boundingBox())!.width).toBeCloseTo(124, 0);
  const cover = (await first.locator('.library-tile-media').boundingBox())!;
  expect(cover.width).toBeCloseTo(124, 0); expect(cover.height).toBeGreaterThanOrEqual(124); expect(cover.height).toBeLessThanOrEqual(165.5);
  const favorites = region(page, 'Favorites');
  await expect(favorites.getByRole('listitem').nth(0).locator('.home-card-meta')).toHaveText('PDF');
  await expect(favorites.getByRole('listitem').nth(1).locator('.home-card-meta')).toHaveText('MD');
  const title = reading.locator('.home-card-title').first();
  expect(await title.evaluate(node => getComputedStyle(node).webkitLineClamp)).toBe('2');
  expect(await title.evaluate(node => [getComputedStyle(node).fontSize, getComputedStyle(node).fontWeight])).toEqual(['12px', '600']);
  expect(await region(page, 'Favorites').locator('h2').evaluate(node => [getComputedStyle(node).fontSize, getComputedStyle(node).fontWeight])).toEqual(['17px', '700']);
  const collections = region(page, 'Collections');
  await expect(collections.getByRole('listitem')).toHaveCount(2); // Empty shelf has no documents.
  const alpha = collections.getByRole('listitem').first();
  await expect(alpha.locator('.home-card-title')).toHaveText('Alpha shelf');
  await expect(alpha.locator('.home-card-meta')).toHaveText('3 references');
  const mosaic = (await alpha.locator('.home-mosaic').boundingBox())!;
  expect(mosaic.width).toBeCloseTo(124, 0); expect(mosaic.height).toBeCloseTo(124, 0);
  await expect(alpha.locator('.home-mosaic-cell')).toHaveCount(4);
  await expect(alpha.locator('.home-mosaic-cell .library-tile-media')).toHaveCount(3); // Three documents: the fourth cell is the quiet fill.
  const empty = alpha.locator('.home-mosaic-cell').nth(3);
  expect(await empty.evaluate(node => getComputedStyle(node).backgroundColor)).toBe(await page.locator('#empty').evaluate(() => { const probe = document.createElement('i'); probe.style.background = 'var(--hover)'; document.body.append(probe); const color = getComputedStyle(probe).backgroundColor; probe.remove(); return color; }));
});

test('Show all and a collection card open the library on that scope', async ({ page }) => {
  await seedLibrary(page, mixed, mixedCollections);
  const scope = page.locator('.library-filter[aria-pressed=true] .library-filter-name');
  await region(page, 'Continue reading').getByRole('button', { name: 'Show all: Continue reading' }).click();
  await expect(scope).toHaveText('Continue reading');
  await expect(page.locator('#library-root.is-board')).toBeVisible(); // The board, where there is room.
  await expect(page.locator('[data-doc-path]')).toHaveCount(3);
  await expect(page.locator('[data-doc-path]').filter({ hasText: 'Done.pdf' })).toHaveCount(0);
  await page.locator('#library-toggle').click(); // Back to Home.
  await expect(page.locator('#library-root')).toBeHidden();
  await region(page, 'Favorites').getByRole('button', { name: 'Show all: Favorites' }).click();
  await expect(scope).toHaveText('Favorites');
  await expect(page.locator('[data-doc-path]')).toHaveCount(2);
  await page.locator('#library-toggle').click();
  await region(page, 'Collections').getByRole('button', { name: 'Show all: Collections' }).click();
  await expect(scope).toHaveText('All references');
  await page.locator('#library-toggle').click();
  await region(page, 'Collections').getByRole('button', { name: /Collection Alpha shelf/ }).click();
  await expect(scope).toHaveText('Alpha shelf');
  await expect(page.locator('[data-doc-path]')).toHaveCount(3);
});

test.describe('shelf scrolling', () => {
  const many = Array.from({ length: 24 }, (_, index): FixtureDocument => ({ name: `Fav ${String(index + 1).padStart(2, '0')}.txt`, format: 'txt', favorite: true, opened: index + 1 }));
  const track = (page: Page) => region(page, 'Favorites').getByRole('list');
  const left = (page: Page) => track(page).evaluate(node => node.scrollLeft);

  test('the ‹ › buttons show on hover where there is more, and page the shelf', async ({ page }) => {
    await seedLibrary(page, [...many, { name: 'x.md', format: 'md', opened: 99 }]);
    const shelf = region(page, 'Favorites');
    const previous = shelf.getByRole('button', { name: 'Scroll Favorites back' }), next = shelf.getByRole('button', { name: 'Scroll Favorites forward' });
    expect(await track(page).evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true);
    expect(await track(page).evaluate(node => getComputedStyle(node).scrollbarWidth)).toBe('none');
    await expect(previous).toBeHidden(); // At the start there is nothing behind.
    await expect(next).toHaveCSS('opacity', '0');
    await track(page).hover();
    await expect(next).toHaveCSS('opacity', '1');
    await next.click();
    await expect.poll(() => left(page)).toBeGreaterThan(200);
    await expect(previous).toBeVisible();
    await previous.click();
    await expect.poll(() => left(page)).toBeLessThan(5);
    // Snaps to a card: after a page the first visible card sits at the shelf's left edge.
    await next.click();
    await expect.poll(async () => track(page).evaluate(node => { const box = node.getBoundingClientRect(); return [...node.children].some(card => Math.abs(card.getBoundingClientRect().left - box.left) < 2); })).toBe(true);
    // To the end: next goes away.
    await track(page).evaluate(node => { node.scrollLeft = node.scrollWidth; });
    await expect(next).toBeHidden();
  });

  test('the trackpad and the wheel scroll it sideways; a vertical wheel scrolls the page', async ({ page }) => {
    await seedLibrary(page, many);
    await track(page).scrollIntoViewIfNeeded();
    const box = (await track(page).boundingBox())!;
    await page.mouse.move(box.x + 200, box.y + 60);
    await page.mouse.wheel(400, 0);
    await expect.poll(() => left(page)).toBeGreaterThan(100);
    let settled = -1; await expect.poll(async () => { const now = await left(page); const done = now === settled; settled = now; return done; }).toBe(true);
    const before = await left(page);
    const page0 = await page.locator('#empty').evaluate(node => node.scrollTop);
    await page.mouse.wheel(0, 120);
    await expect.poll(() => page.locator('#empty').evaluate(node => node.scrollTop)).toBeGreaterThanOrEqual(page0);
    expect(await left(page)).toBe(before);
  });

  test('a sideways drag scrolls it without opening the card under the pointer', async ({ page }) => {
    await seedLibrary(page, many);
    const card = track(page).getByRole('listitem').first();
    const box = (await card.boundingBox())!;
    await page.mouse.move(box.x + 60, box.y + 60); await page.mouse.down();
    await page.mouse.move(box.x - 140, box.y + 62, { steps: 12 });
    await page.mouse.up();
    await expect.poll(() => left(page)).toBeGreaterThan(100);
    await expect(page.locator('#tab-list .tab')).toHaveCount(0);
    // A plain click still opens.
    await region(page, 'Favorites').getByRole('button', { name: 'Open Fav 05.txt' }).click();
    await expect(page.locator('#tab-list .tab.is-active .tab-title')).toHaveText('Fav 05.txt');
  });

  test('arrow keys move within a shelf and Tab moves between sections', async ({ page }) => {
    await seedLibrary(page, [...many, { name: 'Zeta.pdf', format: 'pdf', collections: ['Z'] }], [{ name: 'Z' }]);
    const cards = region(page, 'Favorites').getByRole('button', { name: /^Open Fav/ });
    await cards.first().focus();
    await page.keyboard.press('ArrowRight');
    await expect(cards.nth(1)).toBeFocused();
    await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
    await expect(cards.nth(3)).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(cards.nth(2)).toBeFocused();
    await page.keyboard.press('End');
    await expect(cards.last()).toBeFocused();
    await expect.poll(() => left(page)).toBeGreaterThan(0); // The last card was brought into view.
    await page.keyboard.press('Home');
    await expect(cards.first()).toBeFocused();
    // One tab stop per shelf: Tab leaves for "Show all"'s neighbour, not the second card.
    await page.keyboard.press('Tab');
    await expect(cards.nth(1)).not.toBeFocused();
    await expect(region(page, 'Collections').getByRole('button', { name: /Collection Z/ })).toHaveAttribute('tabindex', '0');
    // Enter opens.
    await cards.nth(2).focus(); await page.keyboard.press('Enter');
    await expect(page.locator('#tab-list .tab.is-active .tab-title')).toHaveText('Fav 03.txt');
  });

  test('reduced motion pages the shelf at once', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await seedLibrary(page, many);
    await track(page).hover();
    const before = Date.now();
    await region(page, 'Favorites').getByRole('button', { name: 'Scroll Favorites forward' }).click();
    expect(await left(page)).toBeGreaterThan(200);
    expect(Date.now() - before).toBeLessThan(2000);
  });
});

test('a document dragged up or down from Home still opens in a new tab', async ({ page }) => {
  await seedLibrary(page, mixed.filter(item => item.format === 'txt'), []);
  const card = page.getByRole('button', { name: 'Open Plain.txt', exact: true }).first();
  const box = (await card.boundingBox())!;
  await page.mouse.move(box.x + 60, box.y + 20); await page.mouse.down();
  await page.mouse.move(box.x + 62, box.y + 120, { steps: 8 });
  await page.mouse.move(540, 500, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('#tab-list .tab.is-active .tab-title')).toHaveText('Plain.txt');
});

test('Home with a 300-document library renders at once and scrolls', async ({ page }) => {
  const { documents, collections } = bigLibrary(300);
  await seedLibrary(page, documents, collections);
  await expect(page.getByRole('heading', { level: 2 })).toHaveText(['Jump back in', 'Continue reading', 'Favorites', 'Collections']);
  await expect(region(page, 'Jump back in').getByRole('listitem')).toHaveCount(8);
  await expect(region(page, 'Collections').getByRole('listitem')).toHaveCount(25);
  expect(await region(page, 'Continue reading').getByRole('listitem').count()).toBeGreaterThan(5);
  // A repaint (a chip) of the whole page is quick.
  const time = await page.evaluate(async () => {
    const start = performance.now();
    (document.querySelector('.home-chip[data-type="pdf"]') as HTMLElement).click();
    await new Promise(resolve => requestAnimationFrame(() => resolve(0)));
    return performance.now() - start;
  });
  expect(time).toBeLessThan(1500); // A chip repaints every section; this is a jank bound, not a benchmark.
  await chip(page, 'All').click();
  // Scrolls: the last shelf comes into view, and there is no sideways overflow.
  const scroller = page.locator('#empty');
  expect(await scroller.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
  await scroller.evaluate(node => { node.scrollTop = node.scrollHeight; });
  await expect(region(page, 'Collections')).toBeInViewport();
  expect(await scroller.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  // A shelf of many cards stays one row.
  const favorites = region(page, 'Favorites').getByRole('list');
  expect(await favorites.evaluate(node => (node as HTMLElement).offsetHeight)).toBeLessThan(260);
});

test('a glow theme renders the cards on the card colour, and the chips and progress line use the theme tokens', async ({ page }) => {
  await seedLibrary(page, mixed, mixedCollections);
  await expect(page.locator('.home-progress').first()).toBeVisible();
  const tokens = () => page.evaluate(() => {
    const colour = (variable: string) => { const probe = document.createElement('i'); probe.style.background = `var(${variable})`; document.body.append(probe); const value = getComputedStyle(probe).backgroundColor; probe.remove(); return value; };
    const paint = (selector: string) => getComputedStyle(document.querySelector(selector)!).backgroundColor;
    return { card: paint('.home-jump-open'), fill: paint('.home-chip[aria-pressed=true]'), idle: paint('.home-chip[aria-pressed=false]'), line: paint('.home-progress'), accent: getComputedStyle(document.querySelector('.home-progress > i')!).backgroundColor, hover: colour('--hover'), cardToken: colour('--card'), fg: colour('--fg'), hairline: colour('--hairline'), accentToken: colour('--accent') };
  });
  const plain = await tokens();
  expect(plain.card).toBe(plain.hover);
  expect(plain.fill).toBe(plain.fg); expect(plain.idle).toBe(plain.hover); expect(plain.line).toBe(plain.hairline); expect(plain.accent).toBe(plain.accentToken);
  await page.evaluate(() => { document.documentElement.dataset.palette = 'aurora'; document.documentElement.dataset.theme = 'dark'; });
  const glow = await tokens();
  expect(glow.card).toBe(glow.cardToken);
  expect(glow.fill).toBe(glow.fg);
  await expect(page.locator('.home-jump-open').first()).toBeVisible();
  await page.evaluate(() => { document.documentElement.dataset.palette = 'peach'; document.documentElement.dataset.theme = 'light'; });
  expect((await tokens()).card).toBe((await tokens()).cardToken);
});

test('the first launch with nothing saved keeps the empty screen', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#empty-open')).toBeVisible();
  await expect(page.locator('#empty.is-home')).toHaveCount(0);
});

test('the chips stay on one row at every width and scroll sideways with a fade, no scrollbar, and the keyboard reaches them all', async ({ page }) => {
  await seedLibrary(page, mixed, mixedCollections);
  const row = page.locator('.home-chips');
  const oneRow = () => row.evaluate(node => new Set([...node.children].map(chip => Math.round(chip.getBoundingClientRect().top))).size === 1);
  expect(await oneRow()).toBe(true);
  expect(await row.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true); // Wide: all fit, no fade.
  // The fade is written in the first animation frame after the row is laid out: wait for it instead of reading it before it exists.
  await expect.poll(() => row.evaluate(node => node.style.getPropertyValue('--fade-end'))).toBe('0px');
  await page.setViewportSize({ width: 420, height: 620 });
  expect(await oneRow()).toBe(true);
  expect(await row.evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true);
  expect(await row.evaluate(node => getComputedStyle(node).scrollbarWidth)).toBe('none');
  await expect.poll(() => row.evaluate(node => node.style.getPropertyValue('--fade-end'))).toBe('28px');
  expect(await row.evaluate(node => node.style.getPropertyValue('--fade-start'))).toBe('0px');
  expect(await row.evaluate(node => getComputedStyle(node).maskImage)).toContain('linear-gradient');
  // Tab brings the last chip into view, and the fade moves to the other edge.
  await chip(page, 'Images').focus();
  await expect.poll(() => row.evaluate(node => { const box = node.getBoundingClientRect(), last = node.lastElementChild!.getBoundingClientRect(); return last.right <= box.right + .5 && last.left >= box.left; })).toBe(true);
  await expect.poll(() => row.evaluate(node => node.style.getPropertyValue('--fade-start'))).toBe('28px');
  await expect.poll(() => row.evaluate(node => node.style.getPropertyValue('--fade-end'))).toBe('0px');
  await page.keyboard.press('Enter');
  await expect(chip(page, 'Images')).toHaveAttribute('aria-pressed', 'true');
  expect(await oneRow()).toBe(true);
  await page.setViewportSize({ width: 300, height: 620 });
  expect(await oneRow()).toBe(true);
});
