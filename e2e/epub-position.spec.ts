import { test, expect, type Page } from '@playwright/test';
import { chapterBook } from './epub-book';

async function openBook(page: Page, width: number, options: Parameters<typeof chapterBook>[0] = {}) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/');
  await page.locator('#file-input').setInputFiles({ name: 'chapters.epub', mimeType: 'application/epub+zip', buffer: await chapterBook(options) });
  await expect(page.locator('#position')).toContainText('%');
  await page.locator('.reader-host').focus();
}
const footer = (page: Page) => page.locator('#position');
/** Turns one page and waits for the footer to say so. */
async function turn(page: Page) {
  const before = await footer(page).innerText();
  await page.keyboard.press('PageDown');
  await expect(footer(page)).not.toHaveText(before);
}
const percent = async (page: Page) => Number(/·\s*(\d+(?:\.\d+)?)%/.exec(await footer(page).innerText())![1]);

/**
 * The horizontal extent of the text on the page now, in window pixels, from the range Foliate reports as visible.
 * Foliate replaces a section's frame while the page settles (and when columns change); until it reports again the last range belongs to a
 * frame that is gone, so this waits for a range whose frame is live and has text.
 */
async function textSpan(page: Page) {
  type Span = { width: number; left: number; right: number; centre: number; hostCentre: number; hostWidth: number };
  let span: Span | null = null;
  await expect.poll(async () => {
    span = await page.evaluate(() => {
      const range = (document.querySelector('foliate-view') as unknown as { lastLocation?: { range?: Range } }).lastLocation?.range;
      const frame = range?.startContainer.ownerDocument?.defaultView?.frameElement?.getBoundingClientRect();
      if (!range || !frame) return null;
      const sides = Array.from(range.getClientRects()).filter(rect => rect.width > 0).map(rect => [rect.left + frame.left, rect.right + frame.left]);
      if (!sides.length) return null;
      const left = Math.min(...sides.map(side => side[0])), right = Math.max(...sides.map(side => side[1]));
      const host = document.querySelector('.reader-host')!.getBoundingClientRect();
      return { width: right - left, left, right, centre: (left + right) / 2, hostCentre: host.left + host.width / 2, hostWidth: host.width };
    });
    return span !== null;
  }).toBe(true);
  return span as unknown as Span;
}

for (const width of [1440, 900]) {
  test(`reflowed text sits in the middle of the reading area at ${width} px, at a readable measure`, async ({ page }) => {
    await openBook(page, width);
    await turn(page); // A page of running text, not the title page.
    await expect.poll(async () => (await textSpan(page)).width).toBeGreaterThan(0);
    const span = await textSpan(page);
    expect(Math.abs(span.centre - span.hostCentre)).toBeLessThan(24);
    // About 66 characters of 18 px serif text: roughly 450 to 600 px, and well short of the window.
    expect(span.right - span.left).toBeGreaterThan(420);
    expect(span.right - span.left).toBeLessThan(620);
    expect(span.left).toBeGreaterThan(100);
  });
}

test('the footer shows chapter, page, a percentage that moves with every early page turn, and time left', async ({ page }) => {
  await openBook(page, 1440);
  await expect(footer(page)).toHaveText(/^p\. ~1 of ~\d+ · \d+\.\d% · (<1|\d+) min left in chapter$/); // The title page is not a chapter.
  const first = await percent(page);
  for (let n = 0; n < 3; n++) await turn(page);
  expect(await percent(page)).toBeGreaterThan(first);
  await expect(footer(page)).toHaveText(/^Chapter 1 of 4 · p\. ~\d+ of ~\d+ · \d+\.\d% · \d+ min left in chapter$/);
  await expect(footer(page)).not.toContainText('≈');
});

test('Chapter n of N advances when a chapter boundary is crossed, numbered from the contents rather than the book title', async ({ page }) => {
  await openBook(page, 1440, { chapters: 4, paragraphs: 14 });
  const seen: string[] = [];
  for (let n = 0; n < 14 && !seen.includes('Chapter 3 of 4'); n++) {
    const match = /Chapter \d+ of \d+/.exec(await footer(page).innerText());
    const chapter = match?.[0] ?? '';
    if (seen.at(-1) !== chapter) seen.push(chapter);
    await turn(page);
  }
  const now = /Chapter \d+ of \d+/.exec(await footer(page).innerText())?.[0] ?? '';
  if (seen.at(-1) !== now) seen.push(now);
  expect(seen.slice(0, 4)).toEqual(['', 'Chapter 1 of 4', 'Chapter 2 of 4', 'Chapter 3 of 4']);
  expect(await footer(page).innerText()).not.toMatch(/GENERATED/i);
});

test('a book with a page list counts its own pages, without an estimate mark', async ({ page }) => {
  await openBook(page, 1440, { pageList: true });
  await turn(page);
  await expect(footer(page)).toContainText(/p\. \d+ of 24 · /);
  await expect(footer(page)).not.toContainText('~');
  await page.keyboard.press('End');
  await expect(footer(page)).toContainText('100.0%');
});

test('two columns only when the two-page option is on, and they are centred together', async ({ page }) => {
  await openBook(page, 1440);
  await turn(page);
  await expect.poll(async () => (await textSpan(page)).width).toBeGreaterThan(0);
  const single = (await textSpan(page)).width;
  await page.keyboard.press('Control+3');
  await expect.poll(async () => (await textSpan(page)).width).toBeGreaterThan(single * 1.8);
  const span = await textSpan(page);
  expect(Math.abs(span.centre - span.hostCentre)).toBeLessThan(24);
  expect(span.width).toBeLessThan(span.hostWidth);
  await page.keyboard.press('Control+3');
  await expect.poll(async () => (await textSpan(page)).width).toBeLessThan(single * 1.2);
});
