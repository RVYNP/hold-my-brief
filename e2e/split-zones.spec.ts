import { test, expect, type Locator, type Page } from '@playwright/test';
import { chapterBook } from './epub-book';
import { pagedPdf } from './paged-pdf';

/** Split view, drop zones: a tab dragged over any pane splits it from the outer quarter of a side and moves into it from the centre; and the pane map a folded split shows. */

const pdf = { name: 'half-tone.pdf', mimeType: 'application/pdf', buffer: pagedPdf(5) };
const markdown = { name: 'moby.md', mimeType: 'text/markdown', buffer: Buffer.from(['# Moby', '', ...Array.from({ length: 80 }, (_, i) => `Line ${i + 1}: call me Ishmael.`)].join('\n\n')) };
const text = { name: 'extra.txt', mimeType: 'text/plain', buffer: Buffer.from(Array.from({ length: 60 }, (_, i) => `extra line ${i + 1}`).join('\n')) };

const box = async (locator: Locator) => (await locator.boundingBox())!;
const workspace = (page: Page) => page.locator('#workspace');
const preview = (page: Page) => page.locator('#split-preview');
/** A pane's row, found by the format of a tab in it, and the pane's id. */
const rowOf = (page: Page, format: string) => page.locator('.pane-strip', { has: page.locator('.tab-format', { hasText: format }) });
const tabIn = (page: Page, format: string) => rowOf(page, format).locator('.tab', { has: page.locator('.tab-format', { hasText: format }) });
const formatsIn = (page: Page, format: string) => rowOf(page, format).locator('.tab-format');
const bodyOf = async (page: Page, format: string) => page.locator(`.pane-body[data-pane=${await rowOf(page, format).getAttribute('data-pane')}]`);
const panesShown = (page: Page) => page.locator('.pane-strip:visible');
const setLibrary = async (page: Page, open: boolean) => {
  if ((await page.locator('#reader-layout.library-open').count() > 0) !== open) await page.keyboard.press('Control+b');
  await expect(page.locator('#reader-layout.library-open')).toHaveCount(open ? 1 : 0);
};
const point = (rect: { x: number; y: number; width: number; height: number }, across: number, down = .5) => ({ x: rect.x + rect.width * across, y: rect.y + rect.height * down });

/** Presses on `from`, moves the pointer to `to` in steps, and leaves the button down. */
async function pick(page: Page, from: Locator, to: { x: number; y: number }) {
  const start = await box(from);
  const x = start.x + start.width / 2, y = start.y + start.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + 12, y, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 10 });
}
/** Drags a tab onto a point and lets go. */
async function drag(page: Page, from: Locator, to: { x: number; y: number }) { await pick(page, from, to); await page.mouse.up(); }
/** Presses on `from` and goes straight to `to` with no sideways step first, and leaves the button down: the way a tab is pulled down onto a bottom quarter. */
async function pickStraight(page: Page, from: Locator, to: { x: number; y: number }) {
  const start = await box(from);
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2); await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 40 });
}

/** The PDF, an EPUB, a Markdown file and a text file open, the library closed; then Split right with the EPUB: the PDF, MD and TXT on the left, the EPUB on the right. */
async function openSplit(page: Page) {
  await page.goto('/');
  const epub = { name: 'pride.epub', mimeType: 'application/epub+zip', buffer: await chapterBook({ chapters: 4, paragraphs: 30 }) };
  for (const [file, format] of [[pdf, 'PDF'], [epub, 'EPUB'], [markdown, 'MD'], [text, 'TXT']] as const) {
    await page.locator('#file-input').setInputFiles(file);
    await expect(page.locator('#tab-list .tab.is-active .tab-format')).toHaveText(format);
  }
  await setLibrary(page, false);
  await page.locator('#tab-list .tab', { has: page.locator('.tab-format', { hasText: 'EPUB' }) }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Split right', exact: true }).click();
  await expect(formatsIn(page, 'EPUB')).toHaveText(['EPUB']);
  await expect(formatsIn(page, 'PDF')).toHaveText(['PDF', 'MD', 'TXT']);
}

test.describe('1440 × 900', () => {
  test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 1440, height: 900 }); });

  test('the bottom quarter of the right pane splits it down, with the dragged tab below, and shades the lower half', async ({ page }) => {
    await openSplit(page);
    const right = await box(await bodyOf(page, 'EPUB'));
    await pick(page, tabIn(page, 'TXT'), point(right, .5, .9));
    await expect(preview(page)).toBeVisible();
    const shade = await box(preview(page)), whole = await box(rowOf(page, 'EPUB'));
    expect(Math.abs(shade.x - right.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(shade.width - right.width)).toBeLessThanOrEqual(1);
    expect(shade.y).toBeGreaterThan(whole.y + (right.y + right.height - whole.y) * .45);
    expect(Math.abs(shade.y + shade.height - (right.y + right.height))).toBeLessThanOrEqual(1);
    const style = await preview(page).evaluate(node => { const css = getComputedStyle(node); return { width: css.outlineWidth, fill: css.backgroundColor }; });
    expect(style.width).toBe('2px');
    expect(style.fill).not.toBe('rgba(0, 0, 0, 0)');
    await page.mouse.up();
    await expect(preview(page)).toBeHidden();
    await expect(panesShown(page)).toHaveCount(3);
    await expect(formatsIn(page, 'TXT')).toHaveText(['TXT']);
    await expect(formatsIn(page, 'EPUB')).toHaveText(['EPUB']);
    await expect(formatsIn(page, 'PDF')).toHaveText(['PDF', 'MD']);
    const above = await box(rowOf(page, 'EPUB')), below = await box(rowOf(page, 'TXT'));
    expect(below.y).toBeGreaterThan(above.y + 200);
    expect(Math.abs(below.x - above.x)).toBeLessThanOrEqual(1);
    await expect(tabIn(page, 'TXT')).toHaveClass(/is-active/);
    await expect(workspace(page)).toHaveAttribute('data-active', (await rowOf(page, 'TXT').getAttribute('data-pane'))!);
  });

  test('a tab pulled straight down from its row onto the bottom quarter of a pane splits it down', async ({ page }) => {
    await openSplit(page);
    // Dragging from a pane's own row: the left pane's Markdown tab onto the bottom quarter of the same pane, directly below the tab.
    const tab = tabIn(page, 'MD'), start = await box(tab);
    const left = await box(await bodyOf(page, 'PDF'));
    await pickStraight(page, tab, { x: start.x + start.width / 2, y: left.y + left.height * .92 });
    await expect(tab).toHaveClass(/is-carried/);
    await expect(preview(page)).toBeVisible();
    const shade = await box(preview(page));
    expect(shade.y).toBeGreaterThan(left.y + left.height * .45);
    await page.mouse.up();
    await expect(preview(page)).toBeHidden();
    await expect(panesShown(page)).toHaveCount(3);
    await expect(formatsIn(page, 'MD')).toHaveText(['MD']);
    await expect(formatsIn(page, 'PDF')).toHaveText(['PDF', 'TXT']);
    expect((await box(rowOf(page, 'MD'))).y).toBeGreaterThan((await box(rowOf(page, 'PDF'))).y + 200);
  });

  test('not split, a tab pulled straight down from the main row onto the bottom quarter splits the window down', async ({ page }) => {
    await page.goto('/');
    for (const [file, format] of [[pdf, 'PDF'], [markdown, 'MD']] as const) {
      await page.locator('#file-input').setInputFiles(file);
      await expect(page.locator('#tab-list .tab.is-active .tab-format')).toHaveText(format);
    }
    await setLibrary(page, false);
    const reading = await box(workspace(page));
    const tab = page.locator('#tab-list .tab', { has: page.locator('.tab-format', { hasText: 'MD' }) }), start = await box(tab);
    await pickStraight(page, tab, { x: start.x + start.width / 2, y: reading.y + reading.height * .92 });
    await expect(tab).toHaveClass(/is-carried/);
    await expect(preview(page)).toBeVisible();
    await page.mouse.up();
    await expect(workspace(page)).toHaveClass(/is-split/);
    await expect(formatsIn(page, 'MD')).toHaveText(['MD']);
    await expect(formatsIn(page, 'PDF')).toHaveText(['PDF']);
    expect((await box(rowOf(page, 'MD'))).y).toBeGreaterThan((await box(rowOf(page, 'PDF'))).y + 200);
  });

  test('a press on a tab without moving still selects it, and its close button still closes it', async ({ page }) => {
    await openSplit(page);
    await tabIn(page, 'MD').click();
    await expect(tabIn(page, 'MD')).toHaveClass(/is-active/);
    await tabIn(page, 'TXT').click();
    await expect(tabIn(page, 'TXT')).toHaveClass(/is-active/);
    await tabIn(page, 'MD').hover();
    await tabIn(page, 'MD').locator('.tab-close').click();
    await expect(formatsIn(page, 'PDF')).toHaveText(['PDF', 'TXT']);
  });

  test('the top quarter splits up: the dragged tab is above, and the upper half is shaded', async ({ page }) => {
    await openSplit(page);
    const right = await box(await bodyOf(page, 'EPUB'));
    await pick(page, tabIn(page, 'TXT'), point(right, .5, .1));
    await expect(preview(page)).toBeVisible();
    const shade = await box(preview(page));
    expect(shade.height).toBeLessThan(right.height * .75);
    expect(shade.y).toBeLessThanOrEqual(right.y);
    await page.mouse.up();
    await expect(panesShown(page)).toHaveCount(3);
    const top = await box(rowOf(page, 'TXT')), bottom = await box(rowOf(page, 'EPUB'));
    expect(top.y).toBeLessThan(bottom.y);
    expect(Math.abs(top.x - bottom.x)).toBeLessThanOrEqual(1);
    await expect(formatsIn(page, 'TXT')).toHaveText(['TXT']);
    await expect(formatsIn(page, 'EPUB')).toHaveText(['EPUB']);
  });

  test('the left and right quarters of a pane split it sideways, the dragged tab on the side it was dropped (a pane needs 728 px to split sideways)', async ({ page }) => {
    await page.setViewportSize({ width: 1800, height: 900 });
    await openSplit(page);
    const right = await box(await bodyOf(page, 'EPUB'));
    await drag(page, tabIn(page, 'TXT'), point(right, .08));
    await expect(panesShown(page)).toHaveCount(3);
    const left = await box(rowOf(page, 'TXT')), middle = await box(rowOf(page, 'EPUB'));
    expect(left.x).toBeLessThan(middle.x);
    expect(Math.abs(left.y - middle.y)).toBeLessThanOrEqual(1);
    // The left pane's own Markdown tab, on its right edge: the new pane lies between the PDF's pane and the TXT pane.
    const first = await box(await bodyOf(page, 'PDF'));
    await drag(page, tabIn(page, 'MD'), point(first, .92));
    await expect(panesShown(page)).toHaveCount(4);
    const [pdfAt, mdAt, txtAt] = await Promise.all(['PDF', 'MD', 'TXT'].map(async format => (await box(rowOf(page, format))).x));
    expect(pdfAt).toBeLessThan(mdAt);
    expect(mdAt).toBeLessThan(txtAt);
  });

  test('splitting a pane with one of its own tabs puts that tab in the new pane; its only tab does nothing', async ({ page }) => {
    await openSplit(page);
    const own = await box(await bodyOf(page, 'PDF'));
    await drag(page, tabIn(page, 'MD'), point(own, .5, .92));
    await expect(panesShown(page)).toHaveCount(3);
    await expect(formatsIn(page, 'MD')).toHaveText(['MD']);
    await expect(formatsIn(page, 'PDF')).toHaveText(['PDF', 'TXT']);
    expect((await box(rowOf(page, 'MD'))).y).toBeGreaterThan((await box(rowOf(page, 'PDF'))).y + 200);
    // The right pane's only tab, over its own edge: no preview, no change.
    const right = await box(await bodyOf(page, 'EPUB'));
    await pick(page, tabIn(page, 'EPUB'), point(right, .92));
    await expect(preview(page)).toBeHidden();
    await page.mouse.up();
    await expect(panesShown(page)).toHaveCount(3);
    await expect(formatsIn(page, 'EPUB')).toHaveText(['EPUB']);
  });

  test('the centre of a pane moves the tab there, and shows the whole pane shaded', async ({ page }) => {
    await openSplit(page);
    const right = await box(await bodyOf(page, 'EPUB'));
    await pick(page, tabIn(page, 'MD'), point(right, .5));
    await expect(preview(page)).toBeVisible();
    const shade = await box(preview(page));
    expect(Math.abs(shade.x - right.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(shade.width - right.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(shade.height - right.height)).toBeLessThanOrEqual(1);
    await page.mouse.up();
    await expect(panesShown(page)).toHaveCount(2);
    await expect(formatsIn(page, 'EPUB')).toHaveText(['EPUB', 'MD']);
    await expect(formatsIn(page, 'PDF')).toHaveText(['PDF', 'TXT']);
    await expect(tabIn(page, 'MD')).toHaveClass(/is-active/);
  });

  test('a corner goes to the nearer side', async ({ page }) => {
    await page.setViewportSize({ width: 1800, height: 900 });
    await openSplit(page);
    const right = await box(await bodyOf(page, 'EPUB'));
    await pick(page, tabIn(page, 'TXT'), { x: right.x + right.width * .05, y: right.y + right.height * .2 });
    const shade = await box(preview(page));
    expect(shade.width).toBeLessThan(right.width * .6); // The left side, not the top.
    expect(shade.height).toBeGreaterThan(right.height);
    await page.keyboard.press('Escape');
    await page.mouse.up();
  });

  test('Escape in the middle of a drag over an edge: no preview, and no change', async ({ page }) => {
    await openSplit(page);
    const right = await box(await bodyOf(page, 'EPUB'));
    await pick(page, tabIn(page, 'TXT'), point(right, .5, .92));
    await expect(preview(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(preview(page)).toBeHidden();
    await page.mouse.up();
    await expect(panesShown(page)).toHaveCount(2);
    await expect(formatsIn(page, 'PDF')).toHaveText(['PDF', 'MD', 'TXT']);
    await expect(formatsIn(page, 'EPUB')).toHaveText(['EPUB']);
  });

  test('at four panes an edge shows no preview and changes nothing, but the centre still moves the tab', async ({ page }) => {
    test.setTimeout(90_000);
    await openSplit(page);
    await drag(page, tabIn(page, 'TXT'), point(await box(await bodyOf(page, 'EPUB')), .5, .92)); // EPUB over TXT on the right.
    await drag(page, tabIn(page, 'MD'), point(await box(await bodyOf(page, 'PDF')), .5, .92)); // PDF over MD on the left.
    await expect(panesShown(page)).toHaveCount(4);
    // Every pane's document is up (the fourth pane's split reopens the ones put to sleep), so the press on a tab below is not behind that work.
    await expect(page.locator('.reader-host:not(.tab-hidden)')).toHaveCount(4);
    await expect(page.locator('#loading')).toBeHidden();
    const before = await Promise.all(['PDF', 'MD', 'EPUB', 'TXT'].map(async format => box(rowOf(page, format))));
    const target = await bodyOf(page, 'MD');
    for (const [across, down] of [[.92, .5], [.08, .5], [.5, .92], [.5, .08]]) {
      await pick(page, tabIn(page, 'EPUB'), point(await box(target), across, down));
      await expect(tabIn(page, 'EPUB'), 'the drag is live, so a hidden preview means the drop is refused').toHaveClass(/is-carried/);
      await expect(preview(page)).toBeHidden();
      await page.mouse.up();
      await expect(panesShown(page)).toHaveCount(4);
    }
    expect(await Promise.all(['PDF', 'MD', 'EPUB', 'TXT'].map(async format => box(rowOf(page, format))))).toEqual(before);
    for (const format of ['PDF', 'MD', 'EPUB', 'TXT']) await expect(formatsIn(page, format)).toHaveText([format]);
    // The centre moves it: the EPUB joins the Markdown file's pane, and its own pane closes.
    await pick(page, tabIn(page, 'EPUB'), point(await box(target), .5));
    await expect(tabIn(page, 'EPUB'), 'the drag is live').toHaveClass(/is-carried/);
    const state = await page.evaluate(() => JSON.stringify({
      workspace: document.querySelector('#workspace')!.className,
      panes: [...document.querySelectorAll('.pane-body')].map(body => { const { left, top, right, bottom } = body.getBoundingClientRect(); return [(body as HTMLElement).dataset.pane, left, top, right, bottom].join(' '); }),
      strips: [...document.querySelectorAll('.pane-strip')].map(row => { const { left, top, right, bottom } = row.getBoundingClientRect(); return [(row as HTMLElement).dataset.pane, left, top, right, bottom].join(' '); }),
    }));
    await expect(preview(page), `where the pointer is: ${JSON.stringify(point(await box(target), .5))}; ${state}`).toBeVisible();
    await page.mouse.up();
    await expect(panesShown(page)).toHaveCount(3);
    await expect(formatsIn(page, 'MD')).toHaveText(['MD', 'EPUB']);
  });

  test('not split, the top and bottom quarters split the reading area too; the middle does nothing', async ({ page }) => {
    await page.goto('/');
    for (const [file, format] of [[pdf, 'PDF'], [markdown, 'MD']] as const) {
      await page.locator('#file-input').setInputFiles(file);
      await expect(page.locator('#tab-list .tab.is-active .tab-format')).toHaveText(format);
    }
    await setLibrary(page, false);
    const reading = await box(workspace(page));
    const tab = page.locator('#tab-list .tab', { has: page.locator('.tab-format', { hasText: 'MD' }) });
    await pick(page, tab, point(reading, .5));
    await expect(preview(page)).toBeHidden();
    await page.mouse.up();
    await expect(workspace(page)).not.toHaveClass(/is-split/);
    await pick(page, tab, point(reading, .5, .92));
    const shade = await box(preview(page));
    expect(shade.y).toBeGreaterThan(reading.y + reading.height * .45);
    expect(shade.width).toBeGreaterThan(reading.width * .85);
    await page.mouse.up();
    await expect(workspace(page)).toHaveClass(/is-split/);
    await expect(formatsIn(page, 'MD')).toHaveText(['MD']);
    expect((await box(rowOf(page, 'MD'))).y).toBeGreaterThan((await box(rowOf(page, 'PDF'))).y + 200);
    // Back to one pane, then the top quarter: the dragged tab is above.
    await page.keyboard.press('Control+k'); await page.locator('#palette-input').fill('Close the split'); await page.keyboard.press('Enter');
    await expect(workspace(page)).not.toHaveClass(/is-split/);
    await drag(page, page.locator('#tab-list .tab', { has: page.locator('.tab-format', { hasText: 'MD' }) }), point(reading, .5, .08));
    await expect(workspace(page)).toHaveClass(/is-split/);
    expect((await box(rowOf(page, 'MD'))).y).toBeLessThan((await box(rowOf(page, 'PDF'))).y);
  });
});

test.describe('700 × 760', () => {
  test('three panes fold to one with a map button reading "3 panes"; its menu shows another pane; the room back unfolds them in their layout', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openSplit(page);
    await drag(page, tabIn(page, 'TXT'), point(await box(await bodyOf(page, 'EPUB')), .5, .92)); // PDF + MD on the left; EPUB over TXT on the right.
    await expect(panesShown(page)).toHaveCount(3);
    const wide = await Promise.all(['PDF', 'EPUB', 'TXT'].map(async format => box(await bodyOf(page, format))));
    await tabIn(page, 'TXT').click();
    await page.setViewportSize({ width: 700, height: 760 });
    await expect(workspace(page)).toHaveClass(/is-single/);
    await expect(panesShown(page)).toHaveCount(1);
    const fold = page.getByRole('button', { name: /^Panes, 3; showing / });
    await expect(fold).toBeVisible();
    await expect(fold).toHaveText('3 panes');
    await expect(fold.locator('svg.pane-map rect')).toHaveCount(3);
    await expect(fold.locator('svg.pane-map rect.is-active')).toHaveCount(1);
    await expect(fold).toHaveAttribute('aria-haspopup', 'menu');
    await fold.click();
    const rows = page.getByRole('menuitem');
    await expect(rows).toHaveCount(3);
    for (let index = 0; index < 3; index++) {
      await expect(rows.nth(index).locator('svg.pane-map rect')).toHaveCount(3);
      await expect(rows.nth(index).locator('svg.pane-map rect.is-active')).toHaveCount(1);
    }
    // In reading order: the left pane (showing the Markdown file), then the right pane's two (the EPUB, the text file).
    await expect(rows.nth(0)).toContainText(/moby/);
    await expect(rows.nth(2)).toContainText(/extra/);
    await rows.nth(0).click();
    await expect(page.getByRole('menuitem')).toHaveCount(0);
    await expect(rowOf(page, 'PDF')).toBeVisible();
    await expect(panesShown(page)).toHaveCount(1);
    await expect(page.getByRole('button', { name: /^Panes, 3; showing moby/ })).toHaveText('3 panes');
    await page.keyboard.press('Control+\\');
    await expect(panesShown(page)).toHaveCount(1);
    await expect(rowOf(page, 'EPUB')).toBeVisible();
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(workspace(page)).not.toHaveClass(/is-single/);
    await expect(panesShown(page)).toHaveCount(3);
    await expect(page.getByRole('button', { name: /^Panes, / })).toBeHidden();
    const back = await Promise.all(['PDF', 'EPUB', 'TXT'].map(async format => box(await bodyOf(page, format))));
    for (const [index, rect] of back.entries()) for (const key of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(rect[key] - wide[index][key])).toBeLessThanOrEqual(1);
  });
});
