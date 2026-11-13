import { test, expect, type Page } from '@playwright/test';
import { pagedPdf, pageColour } from './paged-pdf';

// Instrumentation the tests attach to the page.
declare global { interface Window { thumbnailRenders: number; hostSizes: Set<string>; stripFlips: boolean[]; scrolls: string[] } }

const markdown = () => ({ name: 'notes.md', mimeType: 'text/markdown', buffer: Buffer.from('# Notes\n\nA short document.\n'.repeat(40)) });

const PAGES = 9;
async function openPdf(page: Page, { count = PAGES, labels = '', viewport = { width: 1080, height: 700 }, name = 'strip.pdf' } = {}) {
  await page.setViewportSize(viewport);
  await page.goto('/');
  await page.locator('#file-input').setInputFiles({ name, mimeType: 'application/pdf', buffer: pagedPdf(count, labels) });
  await expect(page.locator('#position')).toContainText(`Page 1 of ${count}`);
  await expect(page.locator('#loading')).toBeHidden();
  if (await page.locator('#library-root').isVisible()) await page.locator('#library-toggle').click();
  await expect(page.locator('#library-root')).toBeHidden();
  await page.locator('.pdf-reader').focus();
}

/** The footer's lane: the room under the strip that the open footer takes, which the strip and the page area both leave free. */
const footerLane = (page: Page) => page.locator('footer').evaluate(el => el.getBoundingClientRect().height);
const strip = (page: Page) => page.locator('#page-strip');
const listbox = (page: Page) => page.getByRole('listbox', { name: 'Page previews' });
const options = (page: Page) => listbox(page).getByRole('option');
/** The option for a page or, in two-page view, a spread ("Page 5", "Pages 4–5"). */
const option = (page: Page, label: number | string) => listbox(page).getByRole('option', { name: `${String(label).includes('–') ? 'Pages' : 'Page'} ${label}`, exact: true });
/** What the items in the DOM say, in order: sequence numbers, never the printed labels. */
const labels = (page: Page) => options(page).evaluateAll(items => items.map(item => item.querySelector('.page-strip-label')!.textContent));
const currentLabel = (page: Page) => page.locator('#page-strip .page-strip-item.is-current .page-strip-label');
const palette = (page: Page) => page.getByRole('combobox', { name: 'Go to, find or run a command' });
const position = (page: Page) => page.locator('#position');
async function runCommand(page: Page, query: string) {
  await page.keyboard.press('Control+k');
  await palette(page).fill(query);
  await page.keyboard.press('Enter');
}
async function goTo(page: Page, target: number) {
  await page.keyboard.press('Control+g'); await page.locator('#target').fill(String(target));
  await page.getByRole('button', { name: 'Go to location', exact: true }).click();
}
/** How far the current item's middle is from the strip's middle, in px; null when the current item is not drawn. */
const offCentre = (page: Page) => page.evaluate(() => {
  const scroller = document.querySelector('.page-strip-scroller'), item = document.querySelector('.page-strip-item.is-current');
  if (!scroller || !item) return null;
  const a = scroller.getBoundingClientRect(), b = item.getBoundingClientRect();
  return b.left + b.width / 2 - (a.left + a.width / 2);
});
const expectCentred = (page: Page) => expect.poll(async () => Math.abs((await offCentre(page)) ?? 1e9), { message: 'the current page is in the middle of the strip' }).toBeLessThanOrEqual(2);
const scrollLeft = (page: Page) => page.locator('.page-strip-scroller').evaluate(el => el.scrollLeft);
/** The colour of a thumbnail's top-left corner, which is page-coloured before the number is drawn. */
const thumbnailColour = (page: Page, number: number, scope = '#page-strip') => page.locator(`${scope} canvas[data-page="${number}"]`).evaluate((canvas: HTMLCanvasElement) => {
  const data = canvas.getContext('2d')!.getImageData(3, 3, 1, 1).data; return [data[0], data[1], data[2], data[3]];
});
async function expectPainted(page: Page, numbers: number[], scope = '#page-strip') {
  for (const number of numbers) {
    const [r, g, b] = pageColour(number);
    await expect.poll(async () => { const [pr, pg, pb, pa] = await thumbnailColour(page, number, scope); return pa === 255 && Math.abs(pr - r) < 8 && Math.abs(pg - g) < 8 && Math.abs(pb - b) < 8; }, { message: `thumbnail of page ${number} shows its own colour` }).toBe(true);
  }
}
const host = (page: Page) => page.locator('.pdf-reader');
const hostHeight = (page: Page) => host(page).evaluate(el => el.clientHeight);
const mainSize = (page: Page) => page.locator('.pdf-page canvas').first().evaluate((canvas: HTMLCanvasElement) => `${canvas.style.width}x${canvas.style.height}`);
const stored = (page: Page) => page.evaluate(() => localStorage.getItem('hold-my-brief:page-strip'));
/** Waits until no deferred refit is pending, then returns the settled host height. */
async function settledHeight(page: Page) {
  let last = -1;
  await expect.poll(async () => { const height = await hostHeight(page); const same = height === last; last = height; await page.waitForTimeout(150); return same; }, { timeout: 8000 }).toBe(true);
  return last;
}
/** Counts the thumbnails pdf.js draws: a canvas that is never attached, is ~88 px tall (a page being 300 x 400 pt) and has no data-page. */
async function countThumbnailRenders(page: Page) {
  // The strip's own canvases carry data-page, and the library samples colours on 32 px canvases of its own at any moment after a document opens. None of those are renders.
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    window.thumbnailRenders = 0;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: Parameters<typeof original>) {
      if (!this.isConnected && !this.dataset.page && this.height >= 80 && this.height <= 100) window.thumbnailRenders++;
      return original.apply(this, args) as never;
    } as typeof original;
  });
}
const rendered = (page: Page) => page.evaluate(() => window.thumbnailRenders);
/** Waits for the render count to stop moving: the queue has gone quiet. */
async function quiet(page: Page) {
  let last = -1;
  await expect.poll(async () => { const now = await rendered(page); const same = now === last; last = now; await page.waitForTimeout(250); return same; }, { timeout: 8000 }).toBe(true);
  return last;
}

test('the strip is a centred filmstrip of the whole document: the current page in the middle, ringed, earlier pages to its left', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await openPdf(page);
  await expect(strip(page)).toBeHidden();
  expect(await stored(page)).toBeNull();
  await expect(page.getByRole('button', { name: 'Page previews' })).toHaveAttribute('aria-pressed', 'false');

  await page.keyboard.press('Control+4');
  await expect(strip(page)).toBeVisible();
  expect(await stored(page)).toBe('on');
  await expect(page.getByRole('button', { name: 'Page previews' })).toHaveAttribute('aria-pressed', 'true');
  // The nine pages all fit in the band: every one is listed, from the first, with the current page marked.
  await expect.poll(() => labels(page)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9']);
  await expect(options(page).first()).toHaveAttribute('aria-selected', 'true');
  await expect(options(page)).toHaveCount(9);
  await expectPainted(page, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  await expectCentred(page);
  // Every thumbnail is the page's natural shape (300 x 400 = 3:4).
  const shape = () => strip(page).locator('canvas').first().evaluate((canvas: HTMLCanvasElement) => canvas.getBoundingClientRect().width / canvas.getBoundingClientRect().height);
  await expect.poll(shape).toBeCloseTo(.75, 2);

  // A page turn moves the ring and the middle: page 5 is current, pages 1–4 are to its left, 6–9 to its right.
  await goTo(page, 5);
  await expect(position(page)).toContainText('Page 5 of 9');
  await expect(currentLabel(page)).toHaveText('5');
  await expectCentred(page);
  const xs = await options(page).evaluateAll(items => items.map(item => item.getBoundingClientRect().x));
  expect(xs).toEqual([...xs].sort((a, b) => a - b));
  const ring = await page.locator('.page-strip-item.is-current').evaluate(el => getComputedStyle(el).boxShadow);
  expect(ring).toContain('2px');
  await expect(page.locator('.page-strip-item.is-before')).toHaveCount(4);
  const [before, now] = await page.evaluate(() => ['.page-strip-item.is-before', '.page-strip-item.is-current'].map(selector => Number(getComputedStyle(document.querySelector(selector)!).opacity)));
  expect(before).toBeLessThan(now); // Earlier pages fade back.

  // A click is a page turn: the footer, the saved reading position and the strip all follow, and the strip comes back to the middle.
  await option(page, 8).click();
  await expect(position(page)).toContainText('Page 8 of 9');
  await expect(currentLabel(page)).toHaveText('8');
  await expectCentred(page);
  await expect(page.locator('.textLayer')).toContainText('8');

  // Off by the pill's button, on again by the palette; the preference reaches a reload.
  await page.getByRole('button', { name: 'Page previews' }).click();
  await expect(strip(page)).toBeHidden();
  expect(await stored(page)).toBe('off');
  await runCommand(page, 'page previews');
  await expect(strip(page)).toBeVisible();
  expect(await stored(page)).toBe('on');

  await page.reload();
  await page.locator('#file-input').setInputFiles({ name: 'again.pdf', mimeType: 'application/pdf', buffer: pagedPdf(PAGES) });
  await expect(position(page)).toContainText('of 9');
  await expect(strip(page)).toBeVisible();
  await expect.poll(() => options(page).count()).toBe(9);
  expect(errors).toEqual([]);
});

test('page turns follow in the strip: the middle glides by one page, and jumps when motion is reduced', async ({ page }) => {
  // Every offset the strip is scrolled to is recorded, so a glide (many steps) can be told from a jump (one).
  await page.addInitScript(() => {
    window.scrolls = [];
    addEventListener('DOMContentLoaded', () => document.addEventListener('scroll', event => {
      if ((event.target as Element)?.classList?.contains('page-strip-scroller')) window.scrolls.push(String((event.target as Element).scrollLeft));
    }, true));
  });
  await openPdf(page, { count: 20 });
  await page.keyboard.press('Control+4');
  await expectPainted(page, [1, 2]);
  await expectCentred(page);
  await page.evaluate(() => { window.scrolls.length = 0; });
  await page.keyboard.press('PageDown');
  await expect(position(page)).toContainText('Page 2 of 20');
  await expectCentred(page);
  await page.waitForTimeout(150);
  const glided = await page.evaluate(() => [...new Set(window.scrolls)]);
  expect(glided.length).toBeGreaterThan(2); // Intermediate offsets between where it was and the middle of page 2.
  expect(glided.at(-1)).toBe(String(Math.round(1 * 74 + 33)));

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => { window.scrolls.length = 0; });
  await page.keyboard.press('PageDown');
  await expect(position(page)).toContainText('Page 3 of 20');
  await expectCentred(page);
  await page.waitForTimeout(150); // Scroll events are delivered a frame after the scroll.
  const jumped = await page.evaluate(() => [...new Set(window.scrolls)]);
  expect(jumped).toEqual([String(2 * 74 + 33)]);
});

test('page turns with the strip on never refit the page or raise an error', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await openPdf(page, { count: 12 });
  await page.keyboard.press('Control+4');
  await expect(strip(page)).toBeVisible();
  await expectPainted(page, [1, 2, 3]);
  const settled = await settledHeight(page), size = await mainSize(page);
  // Every size the reading surface takes from here on is recorded.
  await host(page).evaluate(el => {
    window.hostSizes = new Set([`${el.clientWidth}x${el.clientHeight}`]);
    new ResizeObserver(() => window.hostSizes.add(`${el.clientWidth}x${el.clientHeight}`)).observe(el);
  });
  for (let turn = 2; turn <= 12; turn++) {
    await page.keyboard.press('PageDown');
    await expect(page.locator('#position')).toContainText(`Page ${turn} of 12`);
    expect(await hostHeight(page)).toBe(settled);
  }
  for (let turn = 11; turn >= 1; turn--) {
    await page.keyboard.press('PageUp');
    await expect(page.locator('#position')).toContainText(`Page ${turn} of 12`);
    expect(await hostHeight(page)).toBe(settled);
  }
  await page.waitForTimeout(300); // A refit would be queued 100 ms after a resize.
  expect(await page.evaluate(() => [...window.hostSizes])).toHaveLength(1);
  expect(await mainSize(page)).toBe(size);
  expect(errors).toEqual([]);
});

test('on the last page the strip keeps its height, the page keeps its size, and nothing lies to the right; off gives the height back', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await openPdf(page);
  const full = await settledHeight(page), fullCanvas = await mainSize(page);

  await page.keyboard.press('Control+4');
  await expect(strip(page)).toBeVisible();
  const band = (await strip(page).boundingBox())!;
  expect(band.height).toBeGreaterThanOrEqual(100);
  const fitted = await settledHeight(page);
  const lane = await footerLane(page);
  expect(lane).toBe(30);
  expect(fitted).toBe(full - Math.round(band.height) - lane); // The page area gave up exactly the strip's height and the footer's lane, once.
  const panelBox = (await page.locator('#workspace').boundingBox())!;
  expect(Math.round(band.y + band.height)).toBe(Math.round(panelBox.y + panelBox.height - lane)); // The strip ends where the footer's lane begins.
  const stripCanvas = await mainSize(page);
  expect(stripCanvas).not.toBe(fullCanvas);

  await page.keyboard.press('End');
  await expect(position(page)).toContainText('Page 9 of 9');
  await expect(currentLabel(page)).toHaveText('9');
  await expectCentred(page); // The last page is in the middle too: the strip has room past it.
  expect(await page.evaluate(() => { const items = [...document.querySelectorAll('.page-strip-item')], current = document.querySelector('.page-strip-item.is-current')!; return items.filter(item => item.getBoundingClientRect().x > current.getBoundingClientRect().x).length; })).toBe(0);
  expect((await strip(page).boundingBox())!.height).toBe(band.height);
  await page.keyboard.press('PageUp');
  await expect(position(page)).toContainText('Page 8 of 9');
  await expect(currentLabel(page)).toHaveText('8');
  const previousPage = await mainSize(page);
  await page.keyboard.press('PageDown');
  await expect(position(page)).toContainText('Page 9 of 9');
  // The last page is exactly as big as the page before it, and nothing moved.
  expect(await mainSize(page)).toBe(previousPage);
  expect(await settledHeight(page)).toBe(fitted);

  await page.keyboard.press('Control+4');
  await expect(strip(page)).toBeHidden();
  await expect.poll(() => hostHeight(page)).toBe(full);
  await expect.poll(() => mainSize(page)).toBe(fullCanvas);
  expect(errors).toEqual([]);
});

test('only thumbnails near the view are rendered: opening, jumping far and holding PgDn never draw the rest of a long document', async ({ page }) => {
  await countThumbnailRenders(page);
  await openPdf(page, { count: 60 });
  await page.keyboard.press('Control+4');
  await expectPainted(page, [1, 2, 3, 4]);
  // Turning the strip on refits the page once, after a debounce; a render it supersedes can leave a started thumbnail behind, which is a
  // refit's doing and not a turn's. Wait for the refit to land (and for it to finish drawing) before counting.
  await settledHeight(page);
  await expect(page.locator('.pdf-render-status')).toHaveCount(0);
  // Page 1 is in the middle: about 7 items to its right are in view, 2 more are look-ahead, and none to its left exist.
  const opened = await quiet(page);
  expect(opened).toBeGreaterThanOrEqual(7);
  expect(opened).toBeLessThanOrEqual(11);
  expect(await options(page).count()).toBeLessThanOrEqual(12);
  expect(await page.locator('#page-strip canvas[data-page="30"]').count()).toBe(0);

  // Seven turns in one task, as a held key delivers them: the strip follows the page it lands on and draws what is new around it.
  await page.evaluate(() => { for (let i = 0; i < 7; i++) document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true })); });
  await expect(position(page)).toContainText('Page 8 of 60');
  await expectCentred(page);
  await expectPainted(page, [8, 12, 15]);
  const held = await quiet(page);
  expect(held - opened).toBeLessThanOrEqual(10); // The items that came into view; each page at most once, as the cache holds the rest.
  expect(held).toBeLessThan(20);

  // A jump a long way off draws the neighbourhood of the landing and nothing in between.
  await goTo(page, 50);
  await expect(position(page)).toContainText('Page 50 of 60');
  await expectCentred(page);
  await expectPainted(page, [50, 47, 53]);
  const far = await quiet(page);
  expect(far - held).toBeLessThanOrEqual(20); // About nineteen items are near the middle: half a strip each way, and two more beyond.
  expect(far).toBeLessThan(45); // Drawing the document eagerly would be 60.
  expect(await options(page).count()).toBeLessThanOrEqual(20);
  expect(await labels(page)).not.toContain('1');
  expect(await page.locator('#page-strip canvas[data-page="30"]').count()).toBe(0);
});

test('scrolling the strip looks ahead without changing the reading position, and the next turn or a click brings it back', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await openPdf(page, { count: 60 });
  await page.keyboard.press('Control+4');
  await expectPainted(page, [1, 2, 3]);
  await expectCentred(page);
  const start = await scrollLeft(page), saved = await position(page).textContent();
  const middle = (await listbox(page).boundingBox())!;
  await page.mouse.move(middle.x + middle.width / 2, middle.y + middle.height / 2);

  // A mouse's vertical wheel scrolls it sideways; the page, the footer and the strip's own ring stay where they were.
  await page.mouse.wheel(0, 1100);
  await expect.poll(() => scrollLeft(page)).toBeGreaterThan(start + 900);
  await expect(position(page)).toHaveText(saved!);
  await expect(currentLabel(page)).toHaveText('1');
  expect(Math.abs((await offCentre(page)) ?? 0)).toBeGreaterThan(500);
  // Pages far ahead are drawn once the scroll settles, and a trackpad's sideways wheel scrolls too.
  await expect.poll(() => labels(page)).toContain('16');
  await expectPainted(page, [16]);
  const ahead = await scrollLeft(page);
  await page.mouse.wheel(-300, 0);
  await expect.poll(() => scrollLeft(page)).toBeLessThan(ahead - 200);
  await expect(position(page)).toHaveText(saved!);

  // Dragging scrolls it the same way, and a drag is not a click on whatever it ended over.
  const before = await scrollLeft(page);
  await page.mouse.move(middle.x + middle.width / 2 + 200, middle.y + middle.height / 2);
  await page.mouse.down(); await page.mouse.move(middle.x + middle.width / 2 - 100, middle.y + middle.height / 2, { steps: 10 }); await page.mouse.up();
  expect(await scrollLeft(page)).toBeGreaterThan(before + 200);
  await expect(position(page)).toHaveText(saved!);
  await expect(position(page)).toContainText('Page 1 of 60');

  // The next page turn recentres.
  await page.keyboard.press('PageDown');
  await expect(position(page)).toContainText('Page 2 of 60');
  await expectCentred(page);

  // A click on a page that was scrolled to jumps there, and recentres.
  await page.mouse.wheel(0, 1000);
  await expect.poll(() => labels(page)).toContain('22');
  await option(page, 22).click();
  await expect(position(page)).toContainText('Page 22 of 60');
  await expect(currentLabel(page)).toHaveText('22');
  await expectCentred(page);
  expect(errors).toEqual([]);
});

test('two-page view lists spreads as joined pairs, the cover rule included, ringed in the middle, and a click opens that spread', async ({ page }) => {
  await openPdf(page);
  await page.keyboard.press('Control+4'); await page.keyboard.press('Control+3');
  await expect(position(page)).toContainText('Page 1 of 9'); // The cover stands alone.
  await expect.poll(() => labels(page)).toEqual(['1', '2–3', '4–5', '6–7', '8–9']);
  await expect(option(page, '2–3').locator('canvas')).toHaveCount(2); // A spread is two pages side by side.
  await expect(option(page, 1).locator('canvas')).toHaveCount(1);
  await expectPainted(page, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  await expect(currentLabel(page)).toHaveText('1');
  await expectCentred(page);

  await page.keyboard.press('PageDown');
  await expect(position(page)).toContainText('Pages 2–3 of 9');
  await expect(currentLabel(page)).toHaveText('2–3');
  await expectCentred(page);

  await option(page, '6–7').click();
  await expect(position(page)).toContainText('Pages 6–7 of 9');
  await expect(currentLabel(page)).toHaveText('6–7');
  await expectCentred(page);
  // Page 7 is the current spread's second page: the spread is one item, so there is no item for it alone.
  await expect(listbox(page).getByRole('option', { name: 'Page 7', exact: true })).toHaveCount(0);
  await page.keyboard.press('PageDown');
  await expect(position(page)).toContainText('Pages 8–9 of 9');
  await expect(currentLabel(page)).toHaveText('8–9');

  // Without the cover rule pairs start at page 1.
  await page.keyboard.press('Home');
  await runCommand(page, 'cover page alone');
  await expect(position(page)).toContainText('Pages 1–2 of 9');
  await expect.poll(() => labels(page)).toEqual(['1–2', '3–4', '5–6', '7–8', '9']);
  await expect(currentLabel(page)).toHaveText('1–2');
  await expectCentred(page);
});

test('items are labelled by sequence number, never by the labels a PDF prints on its pages', async ({ page }) => {
  await openPdf(page, { labels: '0 << /S /r >> 3 << /S /D >>' });
  await page.keyboard.press('Control+4');
  // Pages 1-3 print as i-iii and page 4 as "1": the strip says 1 2 3 4 …, and so do the accessible names.
  await expect.poll(() => labels(page)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9']);
  expect(await options(page).evaluateAll(items => items.map(item => item.getAttribute('aria-label')))).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(n => `Page ${n}`));
  await expect(listbox(page)).not.toContainText(/\b(ii|iii)\b/);
  await option(page, 4).click();
  await expect(position(page)).toContainText('Page 4 of 9 · 1'); // The footer still says what the book prints.
  await expect(currentLabel(page)).toHaveText('4');
  await page.keyboard.press('Control+3');
  await expect.poll(() => labels(page)).toEqual(['1', '2–3', '4–5', '6–7', '8–9']); // A spread of pages printed 4–1… never mixes the two.
});

test('Ctrl 4 and the palette command toggle previews for a PDF; neither exists for Markdown', async ({ page }) => {
  await page.setViewportSize({ width: 1080, height: 700 });
  await page.goto('/');
  const rows = () => page.getByRole('option', { name: /Page previews/ });
  // No document: the command is listed but cannot run yet, like every other view command.
  await page.keyboard.press('Control+k'); await palette(page).fill('page previews');
  await expect(rows()).toHaveCount(1); await expect(rows()).toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.press('Escape');

  await page.locator('#file-input').setInputFiles(markdown());
  await expect(page.locator('#filename')).toHaveText('notes.md');
  await page.locator('.reader-host').focus();
  await page.keyboard.press('Control+4');
  await expect(strip(page)).toBeHidden();
  await expect(page.locator('#notice')).toBeHidden();
  expect(await stored(page)).toBeNull();
  await expect(page.locator('#view-previews')).toBeHidden();
  await page.keyboard.press('Control+k'); await palette(page).fill('page previews');
  await expect(rows()).toHaveCount(0);
  await page.keyboard.press('Escape');
  const markdownHeight = await page.locator('.reader-host').evaluate(el => el.clientHeight);

  // A PDF has all of it; a PDF opened after Markdown has the strip back, and Markdown after a PDF gives its room back.
  await page.locator('#file-input').setInputFiles({ name: 'strip.pdf', mimeType: 'application/pdf', buffer: pagedPdf(PAGES) });
  await expect(page.locator('#position')).toContainText('Page 1 of 9');
  await expect(page.locator('#view-previews')).toBeVisible();
  await page.keyboard.press('Control+k'); await palette(page).fill('page previews');
  await expect(rows()).toHaveCount(1); await expect(rows()).not.toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.press('Enter');
  await expect(strip(page)).toBeVisible();
  await page.locator('#file-input').setInputFiles(markdown());
  await expect(page.locator('#filename')).toHaveText('notes.md');
  await expect(strip(page)).toBeHidden();
  await expect.poll(() => page.locator('.reader-host').evaluate(el => el.clientHeight)).toBe(markdownHeight);
  await page.locator('#file-input').setInputFiles({ name: 'strip.pdf', mimeType: 'application/pdf', buffer: pagedPdf(PAGES) });
  await expect(page.locator('#position')).toContainText('Page 1 of 9');
  await expect(strip(page)).toBeVisible();
  await expect.poll(async () => (await labels(page)).slice(0, 3)).toEqual(['1', '2', '3']); // The drawer is open here, so the strip is narrower and lists fewer.
});

test('below 360 px of panel height the strip is hidden without flicker and returns with the height, the choice kept', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await openPdf(page);
  await page.keyboard.press('Control+4');
  await expect(strip(page)).toBeVisible();
  const chrome = await page.evaluate(() => innerHeight - document.querySelector<HTMLElement>('#workspace')!.clientHeight);
  const toggle = page.getByRole('button', { name: 'Page previews' });
  // Record every show and hide, so a strip that blinks while it settles cannot pass.
  await page.evaluate(() => {
    const nav = document.querySelector<HTMLElement>('#page-strip')!;
    window.stripFlips = [];
    new MutationObserver(() => window.stripFlips.push(nav.hidden)).observe(nav, { attributes: true, attributeFilter: ['hidden'] });
  });
  const flips = () => page.evaluate(() => window.stripFlips);

  await page.setViewportSize({ width: 1080, height: 360 + chrome });
  await expect(page.locator('#workspace')).toHaveJSProperty('clientHeight', 360);
  await expect(strip(page)).toBeVisible(); // 360 is enough.
  await page.setViewportSize({ width: 1080, height: 359 + chrome });
  await expect(page.locator('#workspace')).toHaveJSProperty('clientHeight', 359);
  await expect(strip(page)).toBeHidden();
  expect(await stored(page)).toBe('on'); // Hidden, not turned off.
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(toggle).toHaveAttribute('title', /Hidden while the reading area is shorter than 360 px/);
  // The page uses the whole panel again and then stays still: nothing flips the strip back.
  const full = await settledHeight(page);
  expect(full).toBeGreaterThan(300);
  await page.waitForTimeout(500);
  expect(await hostHeight(page)).toBe(full);
  expect(await flips()).toEqual([true]);
  // Ctrl 4 changes the preference even while the strip is out of room; the strip itself waits for height.
  await page.keyboard.press('Control+4');
  expect(await stored(page)).toBe('off');
  await page.keyboard.press('Control+4');
  expect(await stored(page)).toBe('on');
  await expect(strip(page)).toBeHidden();
  await page.setViewportSize({ width: 1080, height: 700 });
  await expect(strip(page)).toBeVisible();
  await expect.poll(() => labels(page)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9']);
  expect(await flips()).toEqual([true, false]);
  expect(errors).toEqual([]);
});

test('the view-controls pill stays above the strip, and a position chosen without it returns when it goes', async ({ page }) => {
  await openPdf(page);
  const pill = page.locator('#view-controls'), grip = page.getByRole('button', { name: 'Move view controls' });
  const workspace = page.locator('#workspace');
  const dragToBottom = async () => {
    const handle = (await grip.boundingBox())!, panel = (await workspace.boundingBox())!;
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2); await page.mouse.down();
    await page.mouse.move(panel.x + panel.width / 2, panel.y + panel.height - 2, { steps: 8 }); await page.mouse.up();
  };
  const bottomEdge = async () => { const box = (await pill.boundingBox())!; return box.y + box.height; };
  // Chosen with no strip: as low as the footer clearance allows.
  await dragToBottom();
  const panel = (await workspace.boundingBox())!, low = await bottomEdge();
  expect(low).toBeCloseTo(panel.y + panel.height - 36, 0);

  await page.keyboard.press('Control+4');
  await expect(strip(page)).toBeVisible();
  const top = () => strip(page).boundingBox().then(box => box!.y);
  await expect.poll(async () => Math.abs(await bottomEdge() - (await top() - 8)) <= 1).toBe(true); // Lifted to just above the strip.
  await page.keyboard.press('Control+4');
  await expect(strip(page)).toBeHidden();
  await expect.poll(async () => Math.abs(await bottomEdge() - low) <= 1.5).toBe(true); // Back where it was put.

  // The default spot clears the strip as well, and so does a drag made with the strip on.
  await grip.dblclick();
  await page.keyboard.press('Control+4');
  await expect(strip(page)).toBeVisible();
  expect(await pill.evaluate(el => el.getAttribute('style'))).toBeFalsy();
  expect(await bottomEdge()).toBeLessThanOrEqual(await top() - 8 + .5);
  await dragToBottom();
  expect(await bottomEdge()).toBeLessThanOrEqual(await top() - 8 + .5);
  expect(await bottomEdge()).toBeGreaterThan(await top() - 8 - 1.5);
});

test('the strip is a listbox: Tab reaches it, arrows move its focus without turning pages, Enter and Space jump', async ({ page }) => {
  await openPdf(page);
  await page.keyboard.press('Control+4');
  await expect.poll(() => options(page).count()).toBe(9);
  await expect(listbox(page)).toHaveAttribute('aria-orientation', 'horizontal');
  const active = () => listbox(page).getAttribute('aria-activedescendant').then(id => page.locator(`[id="${id}"] .page-strip-label`).textContent());
  const focused = () => page.evaluate(() => document.activeElement?.getAttribute('role'));
  // Tab from the page reaches the listbox, which starts on the current page and shows a focus ring on it.
  for (let i = 0; i < 14 && (await focused()) !== 'listbox'; i++) await page.keyboard.press('Tab');
  expect(await focused()).toBe('listbox');
  expect(await active()).toBe('1');
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('.page-strip-item.is-active')!).outlineStyle)).not.toBe('none');

  // Arrows move the focus, not the page; the strip follows it.
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
  expect(await active()).toBe('4');
  await page.keyboard.press('ArrowLeft');
  expect(await active()).toBe('3');
  await expect(position(page)).toContainText('Page 1 of 9');
  await expect(page.locator('.page-strip-item.is-active .page-strip-label')).toHaveText('3');
  await expect.poll(async () => { const box = (await page.locator('.page-strip-item.is-active').boundingBox())!, list = (await listbox(page).boundingBox())!; return Math.abs(box.x + box.width / 2 - (list.x + list.width / 2)); }).toBeLessThanOrEqual(2);
  // Enter goes to the focused page, and the focus is on the current page again.
  await page.keyboard.press('Enter');
  await expect(position(page)).toContainText('Page 3 of 9');
  await expect(currentLabel(page)).toHaveText('3');
  expect(await active()).toBe('3');
  expect(await focused()).toBe('listbox'); // The focus stayed in the strip.
  // Space does the same, and Home and End go to the ends.
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Space');
  await expect(position(page)).toContainText('Page 5 of 9');
  await page.keyboard.press('End');
  expect(await active()).toBe('9');
  await page.keyboard.press('Home');
  expect(await active()).toBe('1');
  await expect(position(page)).toContainText('Page 5 of 9');
  // Page keys are not the strip's: they still turn pages from it.
  await page.keyboard.press('PageUp');
  await expect(position(page)).toContainText('Page 4 of 9');
  await expect(currentLabel(page)).toHaveText('4');
  expect(await active()).toBe('4');
  // Leaving the strip hands the keys back to the page.
  await page.keyboard.press('Shift+Tab');
  await page.locator('.pdf-reader').focus();
  await page.keyboard.press('ArrowRight');
  await expect(position(page)).toContainText('Page 5 of 9');
});

test('hovering or dragging the progress bar previews the page under the pointer, spread-aware, with or without the strip; it hides on leave', async ({ page }) => {
  await openPdf(page);
  const bar = page.locator('#progress'), card = page.locator('#progress-preview');
  const tooltip = await bar.getAttribute('title');
  // The footer opens at the window's edge; the pointer then moves up onto the bar. Page n of 9 is n-1 eighths of the way along the thumb's travel.
  const onBar = async (number: number, total = 9) => {
    const box = (await bar.boundingBox())!;
    await page.mouse.move(box.x + 6 + (number - 1) / (total - 1) * (box.width - 12), box.y + box.height / 2, { steps: 4 });
  };
  await page.mouse.move(540, 698); await page.waitForTimeout(300);
  await onBar(5);
  await expect(card).toBeVisible();
  await expect(card).toContainText('Page 5 of 9');
  await expectPainted(page, [5], '#progress-preview'); // The strip is closed: the card draws from the thumbnail cache on its own.
  await expect(bar).not.toHaveAttribute('title', /.+/);
  const box = (await card.boundingBox())!, foot = (await page.locator('footer').boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(foot.y); // Above the pointer, never over the bar it belongs to.
  // The card follows the pointer along the bar.
  await onBar(8);
  await expect(card).toContainText('Page 8 of 9');
  await expectPainted(page, [8], '#progress-preview');
  const moved = (await card.boundingBox())!;
  expect(moved.x).toBeGreaterThan(box.x + 100);
  // Leaving hides it and gives the bar its tooltip back.
  await page.mouse.move(540, 300);
  await expect(card).toBeHidden();
  await expect(bar).toHaveAttribute('title', tooltip!);
  expect(await page.evaluate(() => document.querySelector('#position')!.textContent)).toContain('Page 1 of 9'); // Hovering never moves the reader.

  // With the strip open it is the same card, drawn from the same cache.
  await page.keyboard.press('Control+4');
  await expect(strip(page)).toBeVisible();
  await page.locator('.pdf-reader').focus();
  await page.mouse.move(540, 698); await page.waitForTimeout(300);
  await onBar(3);
  await expect(card).toContainText('Page 3 of 9');
  await expectPainted(page, [3], '#progress-preview');
  await page.mouse.move(540, 300);
  await expect(card).toBeHidden();

  // Dragging: the card follows the thumb, and releasing jumps there.
  await page.mouse.move(540, 698); await page.waitForTimeout(300);
  await onBar(2);
  await page.mouse.down();
  await onBar(7);
  await expect(card).toContainText('Page 7 of 9');
  await expectPainted(page, [7], '#progress-preview');
  await page.mouse.up();
  await expect(position(page)).toContainText('Page 7 of 9');
  await page.mouse.move(540, 300);
  await expect(card).toBeHidden();

  // Two-page view previews the spread the page belongs to, the cover rule holding.
  await page.locator('.pdf-reader').focus(); // The bar had the focus after the drag.
  await page.keyboard.press('Control+3');
  await expect(position(page)).toContainText('Pages 6–7 of 9');
  await page.mouse.move(540, 698); await page.waitForTimeout(300);
  await onBar(5);
  await expect(card).toContainText('Pages 4–5 of 9');
  await expect(card.locator('canvas')).toHaveCount(2);
  await expectPainted(page, [4, 5], '#progress-preview');
  await onBar(1);
  await expect(card).toContainText('Page 1 of 9');
  await expect(card.locator('canvas')).toHaveCount(1);
});

test('the progress bar of a document without pages keeps its own tooltip and shows no preview', async ({ page }) => {
  await page.setViewportSize({ width: 1080, height: 700 });
  await page.goto('/');
  await page.locator('#file-input').setInputFiles(markdown());
  await expect(page.locator('#filename')).toHaveText('notes.md');
  const bar = page.locator('#progress'), tooltip = await bar.getAttribute('title');
  await page.mouse.move(540, 698); await page.waitForTimeout(300);
  const box = (await bar.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
  await page.waitForTimeout(200);
  await expect(page.locator('#progress-preview')).toBeHidden();
  await expect(bar).toHaveAttribute('title', tooltip!);
});

test('a rotated document is previewed rotated, and the strip starts beside the library drawer', async ({ page }) => {
  await openPdf(page);
  await page.keyboard.press('Control+4');
  await expectPainted(page, [1, 2, 3]);
  const canvas = strip(page).locator('canvas').first();
  const ratio = () => canvas.evaluate((el: HTMLCanvasElement) => el.getBoundingClientRect().width / el.getBoundingClientRect().height);
  await expect.poll(ratio).toBeCloseTo(.75, 2);
  await runCommand(page, 'rotate page');
  await expect.poll(ratio).toBeCloseTo(4 / 3, 1); // Landscape; a thumbnail is whole pixels, so not exactly 4:3.
  await expectPainted(page, [1, 2, 3]);
  const before = (await strip(page).boundingBox())!;
  await page.locator('#library-toggle').click();
  await expect(page.locator('#library-root')).toBeVisible();
  const drawer = (await page.locator('#library-root').boundingBox())!;
  await expect.poll(async () => (await strip(page).boundingBox())!.x).toBeGreaterThanOrEqual(drawer.x + drawer.width - 1);
  expect((await strip(page).boundingBox())!.x).toBeGreaterThan(before.x);
});

test('with the strip on, the hand tool slides a fitting page above the strip, never into it', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await openPdf(page);
  await page.keyboard.press('Control+4');
  await expect(strip(page)).toBeVisible();
  await expectPainted(page, [1, 2, 3]);
  const size = await settledHeight(page), sheet = page.locator('.pdf-page');
  await expect(page.locator('#zoom-level')).toHaveAttribute('data-fit', 'page');
  await page.keyboard.press('h');
  await expect(page.getByRole('button', { name: 'Hand tool' })).toHaveAttribute('aria-pressed', 'true');

  // Drag from the panel's top-left to the window's bottom-right corner, further than the page can go: the slide must stop at its clamp.
  const panel = (await host(page).boundingBox())!, band = (await strip(page).boundingBox())!;
  expect(panel.y + panel.height).toBeLessThanOrEqual(band.y + .5); // The slide's panel is the page area alone.
  await page.mouse.move(panel.x + 82, panel.y + 10); await page.mouse.down(); // beside the library rail
  await page.mouse.move(1079, 699, { steps: 10 }); await page.mouse.up();
  const slid = (await sheet.boundingBox())!;
  // At least 64 px of the page stay inside that panel: so its top edge stops 64 px above the strip, and its bottom is clipped there.
  expect(slid.y).toBeCloseTo(panel.y + panel.height - 64, 0);
  expect(slid.y + 64).toBeLessThanOrEqual(band.y + .5);
  // The strip is untouched and still on top: the page after the current one is what is under the pointer, and it works.
  const first = (await option(page, 2).boundingBox())!;
  expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('#page-strip') !== null, [first.x + first.width / 2, first.y + first.height / 2])).toBe(true);
  expect((await strip(page).boundingBox())!).toEqual(band);
  expect(await hostHeight(page)).toBe(size);
  await option(page, 2).click();
  await expect(page.locator('#position')).toContainText('Page 2 of 9');
  await expect(currentLabel(page)).toHaveText('2');
  // Turning the strip off gives the host its height back.
  await page.keyboard.press('Control+4');
  await expect(strip(page)).toBeHidden();
  await expect.poll(async () => hostHeight(page)).toBe(size + Math.round(band.height) + await footerLane(page));
  expect(errors).toEqual([]);
});
