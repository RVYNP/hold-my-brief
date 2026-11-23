import { test, expect, type Locator, type Page } from '@playwright/test';
import { bigLibrary, seedLibrary, type FixtureDocument } from './home-fixture';
import { pagedPdf } from './paged-pdf';
import { railHome } from './toolbar-tabs';

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
const mixedCollections = [{ name: 'Alpha shelf' }, { name: 'Reading list' }, { name: 'Empty shelf' }];
const everySection = ['Recently opened', 'Continue reading', 'PDFs', 'EPUBs', 'Markdown', 'Text', 'Images'];
const viewports = [{ width: 1080, height: 760 }, { width: 1440, height: 900 }];

test.beforeEach(async ({ page }) => {
  // The drawer starts closed so Home is what the window shows.
  await page.addInitScript(() => { localStorage.setItem('hold-my-brief:library-wide', 'closed'); localStorage.setItem('hold-my-brief:library-narrow', 'closed'); });
  await page.setViewportSize(viewports[0]);
});

const region = (page: Page, name: string) => page.getByRole('region', { name, exact: true });
const cardPaths = async (scope: Locator) => { await scope.locator('[data-home-path]').first().waitFor(); return scope.locator('[data-home-path]').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.homePath!.split('/').pop())); };
/** The pseudo-element a cover's stroke is drawn with, as the browser computes it. */
const strokeOf = (art: Locator) => art.evaluate(node => {
  const after = getComputedStyle(node, '::after');
  return { content: after.content, blend: after.mixBlendMode, top: after.borderTopWidth, right: after.borderRightWidth, bottom: after.borderBottomWidth, left: after.borderLeftWidth, style: after.borderTopStyle, colour: after.borderTopColor, radius: after.borderTopLeftRadius, position: after.position, events: after.pointerEvents };
});

for (const viewport of viewports) {
  test.describe(`${viewport.width} x ${viewport.height}`, () => {
    test.beforeEach(async ({ page }) => { await page.setViewportSize(viewport); });

    test('Home is a heading, Recently opened, Continue reading and a shelf per file type; empty ones are not drawn', async ({ page }) => {
      await seedLibrary(page, mixed, mixedCollections);
      await expect(page.getByRole('heading', { name: 'Home', level: 1 })).toBeVisible();
      await expect(page.getByRole('heading', { level: 2 })).toHaveText(everySection);
      for (const name of everySection) await expect(region(page, name)).toBeVisible();
      // Shelves are lists, and each card is a button named by its title.
      await expect(region(page, 'PDFs').getByRole('list')).toBeVisible();
      await expect(region(page, 'PDFs').getByRole('listitem')).toHaveCount(3);
      await expect(page.getByRole('button', { name: 'Open Alpha.pdf', exact: true }).first()).toBeVisible();
      await seedLibrary(page, mixed.filter(item => item.format !== 'png' && item.format !== 'txt'), mixedCollections);
      await expect(page.getByRole('heading', { level: 2 })).toHaveText(['Recently opened', 'Continue reading', 'PDFs', 'EPUBs', 'Markdown']);
    });

    test('Home has no chips, no Open files or Browse library, no Open in library and no Favorites or Collections', async ({ page }) => {
      await seedLibrary(page, mixed, mixedCollections);
      await expect(region(page, 'PDFs')).toBeVisible();
      const home = page.locator('#empty');
      await expect(home.locator('.home-chip, .home-chips, #home-browse, #empty-open, .home-file, .home-all')).toHaveCount(0);
      await expect(home.getByRole('button', { name: /Open files|Browse library|Open in library/ })).toHaveCount(0);
      await expect(home.getByRole('group', { name: 'File type' })).toHaveCount(0);
      await expect(home.getByRole('heading', { name: /Favorites|Collections/ })).toHaveCount(0);
      await expect(home.locator('.home-collection, .home-mosaic')).toHaveCount(0);
    });

    test('Recently opened shows up to four recent cards in a horizontal row, each with title, type at bottom left and progress at bottom right', async ({ page }) => {
      await seedLibrary(page, mixed, mixedCollections);
      const section = region(page, 'Recently opened');
      const cards = section.locator('.home-recent-open');
      await expect(section.locator('[data-home-path]')).toHaveCount(4);
      await expect(cards).toHaveCount(4);
      expect(await cardPaths(section)).toEqual(['Alpha.pdf', 'Beta.epub', 'Notes.md', 'Plain.txt']);
      const card = cards.first();
      await expect(card.locator('.home-card-title')).toHaveText('Alpha');
      await expect(card.locator('.home-recent-type')).toHaveText('PDF');
      await expect(card.locator('.home-recent-progress')).toHaveText('p. 40 / 146');
      const box = (await card.boundingBox())!, secondBox = (await cards.nth(1).boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(220); expect(box.width).toBeLessThanOrEqual(269); expect(box.height).toBeCloseTo(114, 0);
      expect(Math.abs(secondBox.y - box.y)).toBeLessThan(2); // Side by side on the top row.
      expect(secondBox.x).toBeGreaterThan(box.x + box.width);
      const cover = (await card.locator('.library-tile-media').boundingBox())!;
      expect(cover.x).toBeCloseTo(box.x, 0); expect(cover.height).toBeCloseTo(114, 0);
      const title = (await card.locator('.home-card-title').boundingBox())!, type = (await card.locator('.home-recent-type').boundingBox())!, progress = (await card.locator('.home-recent-progress').boundingBox())!;
      expect(title.x).toBeGreaterThanOrEqual(cover.x + cover.width); // Beside the cover.
      expect(type.x).toBeLessThan(progress.x); // Type left, progress right, on one line.
      expect(Math.abs(type.y - progress.y)).toBeLessThan(2);
      expect(box.x + box.width - (progress.x + progress.width)).toBeLessThan(16);
      expect(box.y + box.height - (type.y + type.height)).toBeLessThan(16);
      expect(title.y + title.height).toBeLessThan(type.y); // The title is above the foot.
      expect(await card.locator('.home-card-title').evaluate(node => [getComputedStyle(node).fontWeight, getComputedStyle(node).fontSize])).toEqual(['600', '12px']);
      expect(await card.locator('.home-recent-type').evaluate(node => [getComputedStyle(node).fontFamily.toLowerCase().includes('mono'), getComputedStyle(node).textTransform, getComputedStyle(node).fontSize])).toEqual([true, 'uppercase', '11px']);
      expect(await section.locator('h2').evaluate(node => [getComputedStyle(node).fontSize, getComputedStyle(node).fontWeight])).toEqual(['13px', '600']);
    });

    test('Recently opened with nothing read shows the type and no progress; with nothing opened it is not drawn', async ({ page }) => {
      await seedLibrary(page, [{ name: 'Photo.png', format: 'png', opened: 1 }]);
      const card = region(page, 'Recently opened').locator('.home-recent-open');
      await expect(card.locator('.home-recent-type')).toHaveText('PNG');
      await expect(card.locator('.home-recent-progress')).toHaveText('');
      await seedLibrary(page, [{ name: 'Photo.png', format: 'png' }]);
      await expect(region(page, 'Images')).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Recently opened' })).toHaveCount(0);
    });

    test('Continue reading keeps its order and one caption line, file type and progress; its covers are 125 wide, 5 px apart', async ({ page }) => {
      await seedLibrary(page, mixed, mixedCollections);
      const reading = region(page, 'Continue reading');
      expect(await cardPaths(reading)).toEqual(['Alpha.pdf', 'Beta.epub', 'Plain.txt']); // Done.pdf is Finished; Notes was never read.
      await expect(reading.getByRole('listitem').nth(0).locator('.home-card-meta')).toHaveText('PDF · p. 40 / 146');
      await expect(reading.getByRole('listitem').nth(1).locator('.home-card-meta')).toHaveText('EPUB · 50 %');
      const first = reading.getByRole('listitem').first(), second = reading.getByRole('listitem').nth(1);
      const one = (await first.boundingBox())!, two = (await second.boundingBox())!;
      expect(one.width).toBeCloseTo(125, 0);
      expect(two.x - (one.x + one.width)).toBeCloseTo(5, 0);
      const cover = (await first.locator('.library-tile-media').boundingBox())!;
      expect(cover.width).toBeCloseTo(125, 0); expect(cover.height).toBeGreaterThanOrEqual(125); expect(cover.height).toBeLessThanOrEqual(170.5);
      const meta = first.locator('.home-card-meta');
      expect(await meta.evaluate(node => (node as HTMLElement).offsetHeight < 2 * parseFloat(getComputedStyle(node).lineHeight))).toBe(true);
      const title = reading.locator('.home-card-title').first();
      expect(await title.evaluate(node => getComputedStyle(node).webkitLineClamp)).toBe('2');
      expect(await title.evaluate(node => [getComputedStyle(node).fontSize, getComputedStyle(node).fontWeight])).toEqual(['12px', '600']);
      expect(await reading.locator('h2').evaluate(node => [getComputedStyle(node).fontSize, getComputedStyle(node).fontWeight])).toEqual(['17px', '700']);
    });

    test('each Continue reading cover has a 1 px blended hairline that follows its corners; the type shelves\' covers have none', async ({ page }) => {
      await seedLibrary(page, mixed, mixedCollections);
      const arts = region(page, 'Continue reading').locator('.home-card-art');
      await expect(arts).toHaveCount(3);
      for (let index = 0; index < 3; index++) {
        const art = arts.nth(index);
        const stroke = await strokeOf(art);
        expect(stroke).toMatchObject({ blend: 'overlay', top: '1px', right: '1px', bottom: '1px', left: '1px', style: 'solid', position: 'absolute', events: 'none' });
        expect(stroke.content).not.toBe('none');
        expect(Number(/\/ ([\d.]+)\)$/.exec(stroke.colour)?.[1])).toBeCloseTo(.35, 2); // The ink at about 35 %, not an opaque border.
        const media = art.locator('.library-tile-media');
        expect(stroke.radius).toBe(await media.evaluate(node => getComputedStyle(node).borderTopLeftRadius));
        const outer = (await art.boundingBox())!, inner = (await media.boundingBox())!;
        expect(outer.x).toBeCloseTo(inner.x, 0); expect(outer.y).toBeCloseTo(inner.y, 0); expect(outer.width).toBeCloseTo(inner.width, 0); expect(outer.height).toBeCloseTo(inner.height, 0);
      }
      for (const name of ['PDFs', 'EPUBs', 'Markdown', 'Text', 'Images']) {
        const covers = region(page, name).locator('.home-card-art');
        expect(await covers.count()).toBeGreaterThan(0);
        await expect(region(page, name).locator('.has-stroke')).toHaveCount(0);
        for (let index = 0; index < await covers.count(); index++) expect((await strokeOf(covers.nth(index))).content, name).toBe('none');
      }
    });

    test('the type shelves list opened documents first, most recent first, then never-opened ones by title, with a caption of type and progress', async ({ page }) => {
      await seedLibrary(page, [
        { name: 'Zed.pdf', format: 'pdf' }, { name: 'Apple.pdf', format: 'pdf' }, { name: 'Mid.pdf', format: 'pdf', opened: 5 }, { name: 'New.pdf', format: 'pdf', opened: 2, progress: PAGED },
        { name: 'Notes.md', format: 'md', opened: 3 },
      ]);
      const pdfs = region(page, 'PDFs');
      expect(await cardPaths(pdfs)).toEqual(['New.pdf', 'Mid.pdf', 'Apple.pdf', 'Zed.pdf']);
      await expect(pdfs.locator('.home-card-meta')).toHaveText(['PDF · p. 40 / 146', 'PDF', 'PDF', 'PDF']);
      await expect(region(page, 'Markdown').locator('.home-card-meta')).toHaveText(['MD']);
      await expect(page.getByRole('heading', { level: 2 })).toHaveText(['Recently opened', 'Continue reading', 'PDFs', 'Markdown']);
    });

    test('a card in the PDFs shelf opens that PDF in a tab', async ({ page }) => {
      await seedLibrary(page, [
        { name: 'First.pdf', format: 'pdf', opened: 1, content: pagedPdf(2) },
        { name: 'Quiet.pdf', format: 'pdf', content: pagedPdf(3) },
      ]);
      await region(page, 'PDFs').getByRole('button', { name: 'Open Quiet.pdf', exact: true }).click();
      await expect(page.locator('#tab-list .tab.is-active .tab-title')).toHaveText('Quiet.pdf');
      await expect(page.locator('#position')).toContainText('Page 1 of 3');
      await expect(page.locator('#empty')).toBeHidden();
    });
  });
}

test('a library of one type and never opened has that shelf and nothing else under the heading', async ({ page }) => {
  await seedLibrary(page, [{ name: 'a.txt', format: 'txt', opened: 1 }, { name: 'b.txt', format: 'txt', opened: 2 }]);
  await expect(page.getByRole('heading', { level: 2 })).toHaveText(['Recently opened', 'Text']);
  await seedLibrary(page, [{ name: 'a.txt', format: 'txt' }]);
  await expect(page.locator('#empty.is-home')).toBeVisible();
  await expect(page.getByRole('heading', { level: 2 })).toHaveText(['Text']);
  await expect(page.getByRole('status')).toHaveCount(0);
});

test('a long title on the Recently opened card stays inside it, in at most three lines', async ({ page }) => {
  const long = 'A very long title that cannot possibly fit on one line of a narrow card at all, so it wraps and then it stops.txt';
  await seedLibrary(page, [{ name: long, format: 'txt', opened: 1 }]);
  const card = region(page, 'Recently opened').locator('.home-recent-open');
  const title = card.locator('.home-card-title');
  expect(await title.evaluate(node => getComputedStyle(node).webkitLineClamp)).toBe('3');
  const box = (await card.boundingBox())!, text = (await title.boundingBox())!;
  expect(box.height).toBeCloseTo(114, 0);
  expect(text.y).toBeGreaterThanOrEqual(box.y); expect(text.y + text.height).toBeLessThanOrEqual(box.y + box.height);
  expect(text.x + text.width).toBeLessThanOrEqual(box.x + box.width + .5);
  await expect(card.locator('.home-recent-foot')).toBeVisible();
});

test('a Recently opened card opens its document in a tab', async ({ page }) => {
  await seedLibrary(page, mixed.filter(item => item.format === 'txt'), []);
  await region(page, 'Recently opened').getByRole('button', { name: 'Open Plain.txt', exact: true }).click();
  await expect(page.locator('#tab-list .tab.is-active .tab-title')).toHaveText('Plain.txt');
  await expect(page.locator('#empty')).toBeHidden();
  // The Home tab shows Home again, and a card for an open document focuses its tab instead of opening a second.
  await railHome(page).click();
  await expect(page.locator('#empty')).toBeVisible();
  await region(page, 'Recently opened').getByRole('button', { name: 'Open Plain.txt', exact: true }).click();
  await expect(page.locator('#tab-list .tab')).toHaveCount(1);
});

test.describe('shelf scrolling', () => {
  const many = Array.from({ length: 24 }, (_, index): FixtureDocument => ({ name: `Fav ${String(index + 1).padStart(2, '0')}.txt`, format: 'txt', favorite: true, opened: index + 1 }));
  const track = (page: Page) => region(page, 'Text').getByRole('list');
  const left = (page: Page) => track(page).evaluate(node => node.scrollLeft);

  test('the ‹ › buttons show on hover where there is more, and page the shelf', async ({ page }) => {
    await seedLibrary(page, [...many, { name: 'x.md', format: 'md', opened: 99 }]);
    const shelf = region(page, 'Text');
    const previous = shelf.getByRole('button', { name: 'Scroll Text back' }), next = shelf.getByRole('button', { name: 'Scroll Text forward' });
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
    await region(page, 'Text').getByRole('button', { name: 'Open Fav 05.txt' }).click();
    await expect(page.locator('#tab-list .tab.is-active .tab-title')).toHaveText('Fav 05.txt');
  });

  test('arrow keys move within a shelf and Tab moves between sections', async ({ page }) => {
    await seedLibrary(page, [...many, { name: 'Zeta.png', format: 'png' }]);
    const cards = region(page, 'Text').getByRole('button', { name: /^Open Fav/ });
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
    // One tab stop per shelf: Tab leaves for the next shelf, not the second card.
    await page.keyboard.press('Tab');
    await expect(cards.nth(1)).not.toBeFocused();
    await expect(region(page, 'Images').getByRole('button', { name: /^Open Zeta/ })).toBeFocused();
    // Enter opens.
    await cards.nth(2).focus(); await page.keyboard.press('Enter');
    await expect(page.locator('#tab-list .tab.is-active .tab-title')).toHaveText('Fav 03.txt');
  });

  test('reduced motion pages the shelf at once', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await seedLibrary(page, many);
    await track(page).hover();
    const before = Date.now();
    await region(page, 'Text').getByRole('button', { name: 'Scroll Text forward' }).click();
    expect(await left(page)).toBeGreaterThan(200);
    expect(Date.now() - before).toBeLessThan(2000);
  });
});

test('a document dragged up or down from a shelf still opens in a new tab', async ({ page }) => {
  await seedLibrary(page, mixed.filter(item => item.format === 'txt'), []);
  const card = region(page, 'Text').getByRole('button', { name: 'Open Plain.txt', exact: true });
  const box = (await card.boundingBox())!;
  await page.mouse.move(box.x + 60, box.y + 20); await page.mouse.down();
  await page.mouse.move(box.x + 62, box.y + 120, { steps: 8 });
  await page.mouse.move(540, 500, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('#tab-list .tab.is-active .tab-title')).toHaveText('Plain.txt');
});

test('Home with a 300-document library renders at once, a capped shelf per type, and scrolls', async ({ page }) => {
  const { documents, collections } = bigLibrary(300);
  await seedLibrary(page, documents, collections);
  await expect(page.getByRole('heading', { level: 2 })).toHaveText(everySection);
  await expect(region(page, 'Recently opened').locator('[data-home-path]')).toHaveCount(4);
  for (const name of ['PDFs', 'EPUBs', 'Markdown', 'Text', 'Images']) await expect(region(page, name).getByRole('listitem')).toHaveCount(30);
  expect(await region(page, 'Continue reading').getByRole('listitem').count()).toBeGreaterThan(5);
  // Scrolls: the last shelf comes into view, and there is no sideways overflow.
  const scroller = page.locator('#empty');
  expect(await scroller.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
  await scroller.evaluate(node => { node.scrollTop = node.scrollHeight; });
  await expect(region(page, 'Images')).toBeInViewport();
  expect(await scroller.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  // A shelf of many cards stays one row.
  const texts = region(page, 'Text').getByRole('list');
  expect(await texts.evaluate(node => (node as HTMLElement).offsetHeight)).toBeLessThan(260);
});

test('a glow theme renders the Recently opened card on the card colour', async ({ page }) => {
  await seedLibrary(page, mixed, mixedCollections);
  await expect(page.locator('.home-recent-open').first()).toBeVisible();
  const tokens = () => page.evaluate(() => {
    const colour = (variable: string) => { const probe = document.createElement('i'); probe.style.background = `var(${variable})`; document.body.append(probe); const value = getComputedStyle(probe).backgroundColor; probe.remove(); return value; };
    return { card: getComputedStyle(document.querySelector('.home-recent-open')!).backgroundColor, hover: colour('--hover'), cardToken: colour('--card') };
  });
  const plain = await tokens();
  expect(plain.card).toBe(plain.hover);
  await page.evaluate(() => { document.documentElement.dataset.palette = 'aurora'; document.documentElement.dataset.theme = 'dark'; });
  const glow = await tokens();
  expect(glow.card).toBe(glow.cardToken);
  await page.evaluate(() => { document.documentElement.dataset.palette = 'peach'; document.documentElement.dataset.theme = 'light'; });
  expect((await tokens()).card).toBe((await tokens()).cardToken);
});

test('the first launch with nothing saved keeps the empty screen', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#empty-open')).toBeVisible();
  await expect(page.locator('#empty.is-home')).toHaveCount(0);
});
