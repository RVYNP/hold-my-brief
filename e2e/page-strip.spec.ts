import { test, expect, type Page } from '@playwright/test';
import { pagedPdf, pageColour } from './paged-pdf';

// Instrumentation the tests attach to the page.
declare global { interface Window { thumbnailRenders: number; hostSizes: Set<string>; stripFlips: boolean[] } }

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
const strip = (page: Page) => page.getByRole('navigation', { name: 'Next pages' });
const goButtons = (page: Page) => strip(page).getByRole('button');
const names = (page: Page) => goButtons(page).evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label')));
const palette = (page: Page) => page.getByRole('combobox', { name: 'Go to, find or run a command' });
async function runCommand(page: Page, query: string) {
  await page.keyboard.press('Control+k');
  await palette(page).fill(query);
  await page.keyboard.press('Enter');
}
/** The colour of a strip thumbnail's top-left corner, which is page-coloured before the number is drawn. */
const thumbnailColour = (page: Page, number: number) => page.locator(`#page-strip canvas[data-page="${number}"]`).evaluate((canvas: HTMLCanvasElement) => {
  const data = canvas.getContext('2d')!.getImageData(3, 3, 1, 1).data; return [data[0], data[1], data[2], data[3]];
});
async function expectPainted(page: Page, numbers: number[]) {
  for (const number of numbers) {
    const [r, g, b] = pageColour(number);
    await expect.poll(async () => { const [pr, pg, pb, pa] = await thumbnailColour(page, number); return pa === 255 && Math.abs(pr - r) < 8 && Math.abs(pg - g) < 8 && Math.abs(pb - b) < 8; }, { message: `thumbnail of page ${number} shows its own colour` }).toBe(true);
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

test('the strip lists the next pages, follows page turns, navigates by click, and the choice survives a reload', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await openPdf(page);
  await expect(strip(page)).toBeHidden();
  expect(await stored(page)).toBeNull();
  await expect(page.getByRole('button', { name: 'Page previews' })).toHaveAttribute('aria-pressed', 'false');

  await page.keyboard.press('Control+4');
  await expect(strip(page)).toBeVisible();
  expect(await stored(page)).toBe('on');
  await expect(page.getByRole('button', { name: 'Page previews' })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => names(page)).toEqual(['Go to page 2', 'Go to page 3', 'Go to page 4']);
  await expectPainted(page, [2, 3, 4]);
  // Every thumbnail wears the label the footer would show, and is the page's natural shape (300 x 400 = 3:4).
  await expect(goButtons(page)).toHaveText(['2', '3', '4']);
  // Polled: the strip lists again after the refit that follows turning it on, replacing its canvases.
  const shape = () => strip(page).locator('canvas').first().evaluate((canvas: HTMLCanvasElement) => canvas.getBoundingClientRect().width / canvas.getBoundingClientRect().height);
  await expect.poll(shape).toBeCloseTo(.75, 2);

  await page.keyboard.press('PageDown');
  await expect(page.locator('#position')).toContainText('Page 2 of');
  await expect.poll(() => names(page)).toEqual(['Go to page 3', 'Go to page 4', 'Go to page 5']);
  await expectPainted(page, [3, 4, 5]);

  // A click is a page turn: the footer, the saved reading position and the strip all follow.
  await page.getByRole('button', { name: 'Go to page 5' }).click();
  await expect(page.locator('#position')).toContainText('Page 5 of 9');
  await expect.poll(() => names(page)).toEqual(['Go to page 6', 'Go to page 7', 'Go to page 8']);
  await expectPainted(page, [6, 7, 8]);
  await expect(page.locator('.textLayer')).toContainText('5');

  // Off by the pill's button, on again by the palette; the preference reaches a reload.
  await page.getByRole('button', { name: 'Page previews' }).click();
  await expect(strip(page)).toBeHidden();
  expect(await stored(page)).toBe('off');
  await runCommand(page, 'page previews');
  await expect(strip(page)).toBeVisible();
  expect(await stored(page)).toBe('on');

  await page.reload();
  await page.locator('#file-input').setInputFiles({ name: 'again.pdf', mimeType: 'application/pdf', buffer: pagedPdf(PAGES) });
  await expect(page.locator('#position')).toContainText('of 9');
  await expect(strip(page)).toBeVisible();
  await expect.poll(() => names(page)).toHaveLength(3);
  expect(errors).toEqual([]);
});

test('on the last page the strip is empty but keeps its height, and the page keeps its size; off gives the height back', async ({ page }) => {
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
  await expect(page.locator('#position')).toContainText('Page 9 of 9');
  await expect(goButtons(page)).toHaveCount(0);
  await expect(strip(page)).toContainText('End of document');
  expect((await strip(page).boundingBox())!.height).toBe(band.height);
  await page.keyboard.press('PageUp');
  await expect(page.locator('#position')).toContainText('Page 8 of 9');
  await expect.poll(() => names(page)).toEqual(['Go to page 9']);
  const previousPage = await mainSize(page);
  await page.keyboard.press('PageDown');
  await expect(page.locator('#position')).toContainText('Page 9 of 9');
  await expect(goButtons(page)).toHaveCount(0);
  // The last page is exactly as big as the page before it, and nothing moved.
  expect(await mainSize(page)).toBe(previousPage);
  expect(await settledHeight(page)).toBe(fitted);

  await page.keyboard.press('Control+4');
  await expect(strip(page)).toBeHidden();
  await expect.poll(() => hostHeight(page)).toBe(full);
  await expect.poll(() => mainSize(page)).toBe(fullCanvas);
  expect(errors).toEqual([]);
});

test('page turns with the strip on never refit the page or raise an error', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await openPdf(page, { count: 12 });
  await page.keyboard.press('Control+4');
  await expect(strip(page)).toBeVisible();
  await expectPainted(page, [2, 3, 4]);
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

test('holding PgDn renders thumbnails for the page it lands on, not for every page it passes', async ({ page }) => {
  // pdf.js draws a thumbnail into a canvas that is never attached to the page, is 88 px tall (the strip's thumbnail
  // height, a page being 300 x 400 pt) and has no data-page. The strip's own canvases carry data-page, and the test
  // reads them back while a page turn may have just replaced them; the library samples colours on 32 px canvases of
  // its own at any moment after a document opens. None of those are renders.
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    window.thumbnailRenders = 0;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: Parameters<typeof original>) {
      if (!this.isConnected && !this.dataset.page && this.height >= 80 && this.height <= 100) window.thumbnailRenders++;
      return original.apply(this, args) as never;
    } as typeof original;
  });
  await openPdf(page, { count: 20 });
  await page.keyboard.press('Control+4');
  await expectPainted(page, [2, 3, 4]);
  // Turning the strip on refits the page once, after a debounce; a render it supersedes can leave a started thumbnail behind, which is a
  // refit's doing and not a turn's. Wait for the refit to land (and for it to finish drawing) before counting.
  await settledHeight(page);
  await expect(page.locator('.pdf-render-status')).toHaveCount(0);
  await expectPainted(page, [2, 3, 4]);
  const rendered = () => page.evaluate(() => window.thumbnailRenders);
  const before = await rendered();
  expect(before).toBeGreaterThanOrEqual(3);
  // Seven turns in one task, as a held key delivers them: only the page it lands on ever finishes.
  await page.evaluate(() => { for (let i = 0; i < 7; i++) document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true })); });
  await expect(page.locator('#position')).toContainText('Page 8 of 20');
  await expect.poll(() => names(page)).toEqual(['Go to page 9', 'Go to page 10', 'Go to page 11']);
  await expectPainted(page, [9, 10, 11]);
  expect(await rendered() - before).toBeLessThanOrEqual(3);
  // One more turn finds two of its three thumbnails in the cache and draws only the new one.
  const warm = await rendered();
  await page.keyboard.press('PageDown');
  await expect(page.locator('#position')).toContainText('Page 9 of 20');
  await expectPainted(page, [10, 11, 12]);
  expect(await rendered() - warm).toBeLessThanOrEqual(1);
});

test('two-page view lists the next two spreads, the cover rule included, and a click opens that spread', async ({ page }) => {
  await openPdf(page);
  await page.keyboard.press('Control+4'); await page.keyboard.press('Control+3');
  await expect(page.locator('#position')).toContainText('Page 1 of 9'); // The cover stands alone.
  await expect.poll(() => names(page)).toEqual(['Go to page 2–3', 'Go to page 4–5']);
  await expect(goButtons(page)).toHaveText(['2–3', '4–5']);
  await expect(strip(page).locator('canvas')).toHaveCount(4); // A spread is two pages side by side.
  await expectPainted(page, [2, 3, 4, 5]);

  await page.keyboard.press('PageDown');
  await expect(page.locator('#position')).toContainText('Pages 2–3 of 9');
  await expect.poll(() => names(page)).toEqual(['Go to page 4–5', 'Go to page 6–7']);

  await page.getByRole('button', { name: 'Go to page 6–7' }).click();
  await expect(page.locator('#position')).toContainText('Pages 6–7 of 9');
  await expect.poll(() => names(page)).toEqual(['Go to page 8–9']);
  await page.keyboard.press('PageDown');
  await expect(page.locator('#position')).toContainText('Pages 8–9 of 9');
  await expect(goButtons(page)).toHaveCount(0);

  // Without the cover rule pairs start at page 1.
  await page.keyboard.press('Home');
  await runCommand(page, 'cover page alone');
  await expect(page.locator('#position')).toContainText('Pages 1–2 of 9');
  await expect.poll(() => names(page)).toEqual(['Go to page 3–4', 'Go to page 5–6']);
});

test('thumbnails carry the labels the footer uses, Roman numerals included', async ({ page }) => {
  await openPdf(page, { labels: '0 << /S /r >> 3 << /S /D >>' });
  await page.keyboard.press('Control+4');
  // Pages 1-3 are i-iii, page 4 is "1": the strip says what the footer would.
  await expect.poll(() => names(page)).toEqual(['Go to page ii', 'Go to page iii', 'Go to page 1']);
  await expect(goButtons(page)).toHaveText(['ii', 'iii', '1']);
  await page.getByRole('button', { name: 'Go to page 1' }).click();
  await expect(page.locator('#position')).toContainText('Page 4 of 9 · 1');
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
  await expect.poll(() => names(page)).toEqual(['Go to page 2', 'Go to page 3', 'Go to page 4']);
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
  await expect.poll(() => names(page)).toEqual(['Go to page 2', 'Go to page 3', 'Go to page 4']);
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

test('the keyboard reaches the thumbnails by Tab, keeps turning pages from them, and Space presses the focused one', async ({ page }) => {
  await openPdf(page);
  await page.keyboard.press('Control+4');
  await expect.poll(() => names(page)).toEqual(['Go to page 2', 'Go to page 3', 'Go to page 4']);
  // Tab from the page reaches a thumbnail, and it shows a focus ring.
  const focusedInStrip = () => page.evaluate(() => document.activeElement?.closest('#page-strip') ? document.activeElement.getAttribute('aria-label') : null);
  for (let i = 0; i < 14 && !(await focusedInStrip()); i++) await page.keyboard.press('Tab');
  expect(await focusedInStrip()).toBe('Go to page 2');
  expect(await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle)).not.toBe('none');
  await page.keyboard.press('Tab');
  expect(await focusedInStrip()).toBe('Go to page 3');
  // Page and arrow keys are not swallowed: they turn pages, and focus stays on the second button, which now lists the next page.
  await page.keyboard.press('PageDown');
  await expect(page.locator('#position')).toContainText('Page 2 of 9');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#position')).toContainText('Page 3 of 9');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#position')).toContainText('Page 2 of 9');
  await expect.poll(focusedInStrip).toBe('Go to page 4');
  // Space is the button's own: it goes to the page on the focused thumbnail, and so does Enter.
  await page.keyboard.press('Space');
  await expect(page.locator('#position')).toContainText('Page 4 of 9');
  await expect.poll(focusedInStrip).toBe('Go to page 6');
  await page.keyboard.press('Enter');
  await expect(page.locator('#position')).toContainText('Page 6 of 9');
});

test('a rotated document is previewed rotated, and the strip starts beside the library drawer', async ({ page }) => {
  await openPdf(page);
  await page.keyboard.press('Control+4');
  await expectPainted(page, [2, 3, 4]);
  const canvas = strip(page).locator('canvas').first();
  const ratio = () => canvas.evaluate((el: HTMLCanvasElement) => el.getBoundingClientRect().width / el.getBoundingClientRect().height);
  await expect.poll(ratio).toBeCloseTo(.75, 2);
  await runCommand(page, 'rotate page');
  await expect.poll(ratio).toBeCloseTo(4 / 3, 2);
  await expectPainted(page, [2, 3, 4]);
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
  await expectPainted(page, [2, 3, 4]);
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
  // The strip is untouched and still on top: its first thumbnail is what is under the pointer, and it works.
  const first = (await goButtons(page).first().boundingBox())!;
  expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('#page-strip') !== null, [first.x + first.width / 2, first.y + first.height / 2])).toBe(true);
  expect((await strip(page).boundingBox())!).toEqual(band);
  expect(await hostHeight(page)).toBe(size);
  await goButtons(page).first().click();
  await expect(page.locator('#position')).toContainText('Page 2 of 9');
  await expect.poll(() => names(page)).toEqual(['Go to page 3', 'Go to page 4', 'Go to page 5']);
  // Turning the strip off gives the host its height back.
  await page.keyboard.press('Control+4');
  await expect(strip(page)).toBeHidden();
  await expect.poll(async () => hostHeight(page)).toBe(size + Math.round(band.height) + await footerLane(page));
  expect(errors).toEqual([]);
});
