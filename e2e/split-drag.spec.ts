import { test, expect, type Locator, type Page } from '@playwright/test';
import { chapterBook } from './epub-book';
import { pagedPdf } from './paged-pdf';
import { expectFormats } from './toolbar-tabs';

/** Split view, third part: drag a tab onto the other pane's row, onto a pane's page, or onto the reading area's outer quarters to split (the drop zones of every pane are in split-zones.spec.ts). */

const pdf = { name: 'half-tone.pdf', mimeType: 'application/pdf', buffer: pagedPdf(5) };
const markdown = { name: 'moby.md', mimeType: 'text/markdown', buffer: Buffer.from(['# Moby', '', ...Array.from({ length: 80 }, (_, i) => `Line ${i + 1}: call me Ishmael.`)].join('\n\n')) };

const box = async (locator: Locator) => (await locator.boundingBox())!;
const row = (page: Page, side: 'a' | 'b') => page.locator(`.pane-strip[data-pane=${side}] .tab`);
const formats = (page: Page, side: 'a' | 'b') => row(page, side).locator('.tab-format');
const barTabs = (page: Page) => page.locator('#tab-list .tab');
const workspace = (page: Page) => page.locator('#workspace');
const preview = (page: Page) => page.locator('#split-preview');
const setLibrary = async (page: Page, open: boolean) => {
  if ((await page.locator('#reader-layout.library-open').count() > 0) !== open) await page.keyboard.press('Control+b');
  await expect(page.locator('#reader-layout.library-open')).toHaveCount(open ? 1 : 0);
};
/** The library panel at 340 px (the default is 280): 1080 less the panel and its margin is then under the 728 px two panes need. */
const widePanel = (page: Page) => page.addInitScript(() => localStorage.setItem('hold-my-brief:library-width', '340'));
const tabOf = (page: Page, format: string) => page.locator(`.tab[data-format="${format}"]`);

/** The PDF, an EPUB and a Markdown file open, the PDF shown, so the reading area is not split and the EPUB is a tab that is not showing. */
async function openThree(page: Page) {
  await page.goto('/');
  const epub = { name: 'pride.epub', mimeType: 'application/epub+zip', buffer: await chapterBook({ chapters: 4, paragraphs: 30 }) };
  for (const [file, format] of [[pdf, 'PDF'], [epub, 'EPUB'], [markdown, 'MD']] as const) {
    await page.locator('#file-input').setInputFiles(file);
    await expect(page.locator('#tab-list .tab.is-active')).toHaveAttribute('data-format', format);
  }
  await page.locator('#tab-list .tab[data-path]').nth(0).click();
  await expect(page.locator('#position')).toContainText('Page 1 of 5');
}
/** Split with the EPUB on the right and the PDF and Markdown file on the left. */
async function openSplit(page: Page) {
  await openThree(page);
  await tabOf(page, 'EPUB').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Split right', exact: true }).click();
  await expect(formats(page, 'b')).toHaveText(['EPUB']);
  await expect(formats(page, 'a')).toHaveText(['PDF', 'MD']);
}

/** Presses on `from`, moves the pointer to `to` in steps, and leaves the button down. */
async function pick(page: Page, from: Locator, to: { x: number; y: number }) {
  const start = await box(from);
  const x = start.x + start.width / 2, y = start.y + start.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + 12, y, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 10 });
}
const point = (rect: { x: number; y: number; width: number; height: number }, across: number, down = .5) => ({ x: rect.x + rect.width * across, y: rect.y + rect.height * down });

test.describe('1440 × 900', () => {
  test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 1440, height: 900 }); });

  test('dragging the EPUB tab over the right quarter shows the right half shaded; letting go splits with the EPUB on the right, active', async ({ page }) => {
    await openThree(page);
    await setLibrary(page, false);
    const reading = await box(workspace(page));
    await pick(page, tabOf(page, 'EPUB'), point(reading, .9));
    await expect(preview(page)).toBeVisible();
    const shade = await box(preview(page));
    expect(shade.x).toBeGreaterThan(reading.x + reading.width * .45);
    expect(Math.abs(shade.x + shade.width - (reading.x + reading.width))).toBeLessThanOrEqual(1);
    expect(shade.height).toBeGreaterThan(reading.height - 2);
    const style = await preview(page).evaluate(node => { const css = getComputedStyle(node); return { width: css.outlineWidth, colour: css.outlineColor, fill: css.backgroundColor, accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() }; });
    expect(style.width).toBe('2px');
    expect(style.fill).not.toBe('rgba(0, 0, 0, 0)');
    await page.mouse.up();
    await expect(preview(page)).toBeHidden();
    await expect(formats(page, 'b')).toHaveText(['EPUB']);
    await expect(formats(page, 'a')).toHaveText(['PDF', 'MD']);
    await expect(workspace(page)).toHaveAttribute('data-active', 'b');
    await expect(row(page, 'b').first()).toHaveClass(/is-active/);
    await expect(page.locator('.reader-host[data-pane=b]:not(.tab-hidden)')).toBeVisible();
    // The same split the menu's Split right gives: both panes of an even width.
    const left = await box(page.locator('.pane-body[data-pane=a]')), right = await box(page.locator('.pane-body[data-pane=b]'));
    expect(Math.abs(left.width - right.width)).toBeLessThanOrEqual(1);
  });

  test('over the left quarter the shade is the left half, and the dragged tab becomes the left pane', async ({ page }) => {
    await openThree(page);
    await setLibrary(page, false);
    const reading = await box(workspace(page));
    await pick(page, tabOf(page, 'EPUB'), point(reading, .1));
    await expect(preview(page)).toBeVisible();
    const shade = await box(preview(page));
    expect(shade.x).toBeLessThanOrEqual(reading.x + 60); // The icon rail's room is not reading area.
    expect(shade.x + shade.width).toBeLessThan(reading.x + reading.width * .55);
    await page.mouse.up();
    await expect(formats(page, 'a')).toHaveText(['EPUB']);
    await expect(formats(page, 'b')).toHaveText(['PDF', 'MD']);
    await expect(workspace(page)).toHaveAttribute('data-active', 'a');
    await expect(row(page, 'a').first()).toHaveClass(/is-active/);
    await expect(row(page, 'b').first()).toHaveClass(/is-active/); // The PDF, which was showing, stays shown on the right.
    await expect(page.locator('.reader-host[data-pane=a]:not(.tab-hidden)')).toBeVisible();
    await expect(page.locator('.reader-host[data-pane=b]:not(.tab-hidden)')).toBeVisible();
  });

  test('over the middle of the reading area nothing is previewed, and letting go changes nothing', async ({ page }) => {
    await openThree(page);
    await setLibrary(page, false);
    await pick(page, tabOf(page, 'EPUB'), point(await box(workspace(page)), .5));
    await expect(preview(page)).toBeHidden();
    await page.mouse.up();
    await expect(workspace(page)).not.toHaveClass(/is-split/);
    await expectFormats(barTabs(page), ['PDF', 'EPUB', 'MD']);
    await expect(tabOf(page, 'PDF')).toHaveClass(/is-active/);
  });

  test('Escape during a drag puts the tab back and previews nothing; letting go afterwards does nothing', async ({ page }) => {
    await openThree(page);
    await setLibrary(page, false);
    await pick(page, tabOf(page, 'EPUB'), point(await box(workspace(page)), .9));
    await expect(preview(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(preview(page)).toBeHidden();
    const again = point(await box(workspace(page)), .92);
    await page.mouse.move(again.x, again.y, { steps: 3 });
    await expect(preview(page)).toBeHidden();
    await page.mouse.up();
    await expect(workspace(page)).not.toHaveClass(/is-split/);
    await expectFormats(barTabs(page), ['PDF', 'EPUB', 'MD']);
    await expect(tabOf(page, 'PDF')).toHaveClass(/is-active/);
    // The tab was not selected by the release either.
    await expect(page.locator('#tab-list .tab.is-active')).toHaveAttribute('data-format', 'PDF');
  });

  test('releasing a dragged tab over no target does nothing: the tab is where it was', async ({ page }) => {
    await openThree(page);
    await setLibrary(page, false);
    await pick(page, tabOf(page, 'MD'), point(await box(workspace(page)), .5)); // The middle of the page: the top quarter is a drop zone now.
    await expect(preview(page)).toBeHidden();
    await page.mouse.up();
    await expectFormats(barTabs(page), ['PDF', 'EPUB', 'MD']);
    await expect(workspace(page)).not.toHaveClass(/is-split/);
  });

  test('a drag inside one row still reorders', async ({ page }) => {
    await openThree(page);
    const first = await box(barTabs(page).first()), last = await box(barTabs(page).last());
    await pick(page, barTabs(page).last(), { x: first.x + 2, y: last.y + last.height / 2 });
    await expect(preview(page)).toBeHidden();
    await page.mouse.up();
    await expectFormats(barTabs(page), ['MD', 'PDF', 'EPUB']);
  });

  test('a drag between two rows: the MD tab goes from the left row to the right row at the slot, and is shown', async ({ page }) => {
    await openSplit(page);
    const target = await box(row(page, 'b').first());
    await pick(page, row(page, 'a').nth(1), { x: target.x + 6, y: target.y + target.height / 2 }); // Before the EPUB.
    await expect(page.locator('.pane-strip[data-pane=b] .tab-drop-marker')).toBeVisible();
    await page.mouse.up();
    await expect(formats(page, 'b')).toHaveText(['MD', 'EPUB']);
    await expect(formats(page, 'a')).toHaveText(['PDF']);
    await expect(row(page, 'b').first()).toHaveClass(/is-active/);
    await expect(workspace(page)).toHaveAttribute('data-active', 'b');
    await expect(page.locator('#position')).toContainText('Moby');
  });

  test('dropping after the last tab of the other row puts the tab at the end', async ({ page }) => {
    await openSplit(page);
    const last = await box(row(page, 'b').last());
    await pick(page, row(page, 'a').first(), { x: last.x + last.width + 20, y: last.y + last.height / 2 });
    await page.mouse.up();
    await expect(formats(page, 'b')).toHaveText(['EPUB', 'PDF']);
    await expect(formats(page, 'a')).toHaveText(['MD']);
  });

  test('a tab dropped on the other pane\'s page moves there, after its last tab, and shows', async ({ page }) => {
    await openSplit(page);
    const page_ = await box(page.locator('.pane-body[data-pane=b]'));
    await pick(page, row(page, 'a').first(), point(page_, .5));
    await expect(preview(page)).toBeVisible();
    const shade = await box(preview(page));
    expect(Math.abs(shade.x - page_.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(shade.width - page_.width)).toBeLessThanOrEqual(1);
    await page.mouse.up();
    await expect(preview(page)).toBeHidden();
    await expect(formats(page, 'b')).toHaveText(['EPUB', 'PDF']);
    await expect(formats(page, 'a')).toHaveText(['MD']);
    await expect(row(page, 'b').last()).toHaveClass(/is-active/);
    await expect(page.locator('#position')).toContainText('Page 1 of 5');
  });

  test('a tab dropped on its own pane does nothing, even a pane\'s only tab', async ({ page }) => {
    await openSplit(page);
    const own = await box(page.locator('.pane-body[data-pane=b]'));
    await pick(page, row(page, 'b').first(), point(own, .5));
    await expect(preview(page)).toBeHidden();
    await page.mouse.up();
    await expect(formats(page, 'b')).toHaveText(['EPUB']);
    await expect(formats(page, 'a')).toHaveText(['PDF', 'MD']);
    const left = await box(page.locator('.pane-body[data-pane=a]'));
    await pick(page, row(page, 'a').first(), point(left, .5));
    await expect(preview(page)).toBeHidden();
    await page.mouse.up();
    await expect(formats(page, 'a')).toHaveText(['PDF', 'MD']);
  });

  test('Escape while dragging between rows leaves both rows as they were', async ({ page }) => {
    await openSplit(page);
    const target = await box(row(page, 'b').first());
    await pick(page, row(page, 'a').nth(1), { x: target.x + 6, y: target.y + target.height / 2 });
    await expect(page.locator('.pane-strip[data-pane=b] .tab-drop-marker')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.tab-drop-marker:visible')).toHaveCount(0);
    await page.mouse.up();
    await expect(formats(page, 'b')).toHaveText(['EPUB']);
    await expect(formats(page, 'a')).toHaveText(['PDF', 'MD']);
  });

  test('a drag inside one pane row reorders it', async ({ page }) => {
    await openSplit(page);
    const first = await box(row(page, 'a').first());
    await pick(page, row(page, 'a').nth(1), { x: first.x + 2, y: first.y + first.height / 2 });
    await page.mouse.up();
    await expect(formats(page, 'a')).toHaveText(['MD', 'PDF']);
    await expect(formats(page, 'b')).toHaveText(['EPUB']);
  });

  test('the Library tab can not be dragged into a pane', async ({ page }) => {
    await openSplit(page);
    await setLibrary(page, false);
    await page.locator('#library-rail').getByRole('button', { name: /Library/ }).first().click();
    await page.locator('#library-root').getByRole('button', { name: 'Library', exact: true }).click();
    await expect(barTabs(page)).toHaveCount(1);
    await pick(page, barTabs(page).first(), point(await box(page.locator('.pane-body[data-pane=b]')), .5));
    await expect(preview(page)).toBeHidden();
    await page.mouse.up();
    await expect(barTabs(page)).toHaveCount(1);
    await expect(formats(page, 'b')).toHaveText(['EPUB']);
    await expect(formats(page, 'a')).toHaveText(['PDF', 'MD']);
  });

  test('with one document open there is nothing to split off, so no preview shows', async ({ page }) => {
    await page.goto('/');
    await page.locator('#file-input').setInputFiles(markdown);
    await expect(page.locator('#tab-list .tab.is-active')).toHaveAttribute('data-format', 'MD');
    await setLibrary(page, false);
    await pick(page, barTabs(page).first(), point(await box(workspace(page)), .9));
    await expect(preview(page)).toBeHidden();
    await page.mouse.up();
    await expect(workspace(page)).not.toHaveClass(/is-split/);
  });
});

test.describe('700 × 760', () => {
  test('the toolbar has no tabs to drag; a folded split\'s row can be dragged, but no preview shows and nothing moves or splits', async ({ page }) => {
    await page.setViewportSize({ width: 1080, height: 760 });
    await openSplit(page);
    await page.setViewportSize({ width: 700, height: 760 });
    await expect(workspace(page)).toHaveClass(/is-single/);
    await expect(page.locator('#tab-strip')).toBeHidden();
    const shown = row(page, 'b').first(), reading = await box(workspace(page));
    await expect(shown).toBeVisible();
    await pick(page, shown, point(reading, .92));
    await expect(preview(page)).toBeHidden();
    await page.mouse.up();
    await pick(page, row(page, 'b').first(), point(reading, .08));
    await expect(preview(page)).toBeHidden();
    await page.mouse.up();
    await expect(formats(page, 'b')).toHaveText(['EPUB']);
    await expect(formats(page, 'a')).toHaveText(['PDF', 'MD']);
  });
});

test('where two 360 px panes do not fit (the library docked in a 1080 px window) no preview shows over the edge and no split forms', async ({ page }) => {
  await page.setViewportSize({ width: 1080, height: 760 });
  await widePanel(page);
  await openThree(page);
  await setLibrary(page, true);
  const reading = await box(workspace(page));
  expect(reading.width).toBeLessThan(2 * 360 + 8);
  await pick(page, tabOf(page, 'EPUB'), point(reading, .92));
  await expect(preview(page)).toBeHidden();
  await page.mouse.up();
  await expect(workspace(page)).not.toHaveClass(/is-split/);
  await expectFormats(barTabs(page), ['PDF', 'EPUB', 'MD']);
});

test('the folded split\'s pane map draws a cell per pane in an SVG, the active one filled, with "n panes" beside it', async ({ page }) => {
  await page.setViewportSize({ width: 1080, height: 760 });
  await widePanel(page);
  await openThree(page);
  await setLibrary(page, false);
  await tabOf(page, 'EPUB').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Split right', exact: true }).click();
  await expect(formats(page, 'b')).toHaveText(['EPUB']);
  await setLibrary(page, true);
  await expect(workspace(page)).toHaveClass(/is-single/);
  const fold = page.getByRole('button', { name: /^Panes, / });
  await expect(fold).toBeVisible();
  await expect(fold).toHaveText('2 panes');
  await expect(fold).toHaveAccessibleName(/^Panes, 2; showing THE GENERATED BOOK/);
  await expect(fold.locator('svg.pane-map rect')).toHaveCount(2);
  await expect(fold.locator('svg.pane-map rect.is-active')).toHaveCount(1);
  // The active pane is the right one: its cell is the second, and is filled with the accent; the other is outlined in the muted ink.
  const [first, second] = await fold.locator('svg.pane-map rect').evaluateAll(cells => cells.map(cell => { const css = getComputedStyle(cell); return { x: cell.getBoundingClientRect().x, fill: css.fill, stroke: css.stroke }; }));
  expect(second.x).toBeGreaterThan(first.x);
  const ink = await page.evaluate(() => { const probe = document.createElement('i'); document.body.append(probe); const read = (name: string) => { probe.style.color = `var(${name})`; return getComputedStyle(probe).color; }; const out = { accent: read('--accent'), muted: read('--muted'), inkOfText: read('--accent-ink') }; probe.remove(); return out; });
  expect(second.fill).toBe(ink.accent);
  expect(first.fill).toBe('none');
  expect(first.stroke).toBe(ink.muted);
  const text = await fold.locator('.pane-fold-count').evaluate(node => { const css = getComputedStyle(node); return { weight: css.fontWeight, size: css.fontSize, colour: css.color }; });
  expect(text.weight).toBe('600');
  expect(text.size).toBe('12px');
  expect(text.colour).toBe(ink.inkOfText);
});
