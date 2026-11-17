import { test, expect, type Locator, type Page } from '@playwright/test';
import { chapterBook } from './epub-book';
import { pagedPdf } from './paged-pdf';
import { lowestRowContrast } from './pane-row-contrast';

/** Which pane of a split is the active one: a 2 px line along its top edge, the other panes dimmed (hillclimb 2C). */

const pdf = { name: 'half-tone.pdf', mimeType: 'application/pdf', buffer: pagedPdf(5) };
const edge = (page: Page, side: 'a' | 'b') => page.locator(`.pane-strip[data-pane=${side}] .pane-edge`);
const dim = (page: Page, side: 'a' | 'b') => page.locator(`.pane-body[data-pane=${side}] .pane-dim`);
/** Whether a row has stepped back: its shown tab has no card and its title is the muted ink, instead of the selected look (an opacity would take the text below AA). */
const quiet = (page: Page, side: 'a' | 'b') => page.locator(`.pane-strip[data-pane=${side}]`).evaluate(row => {
  const tab = row.querySelector('.tab.is-active')!, probe = document.createElement('span');
  probe.style.color = 'var(--muted)'; row.append(probe);
  const muted = getComputedStyle(probe).color; probe.remove();
  return getComputedStyle(tab).backgroundColor === 'rgba(0, 0, 0, 0)' && getComputedStyle(tab.querySelector('.tab-title')!).color === muted;
});
const box = async (locator: Locator) => (await locator.boundingBox())!;

/** The PDF on the left, the EPUB on the right, the PDF the active pane. */
async function splitPdfEpub(page: Page) {
  await page.goto('/');
  const epub = { name: 'pride.epub', mimeType: 'application/epub+zip', buffer: await chapterBook({ chapters: 4, paragraphs: 30 }) };
  for (const [file, format] of [[pdf, 'PDF'], [epub, 'EPUB']] as const) {
    await page.locator('#file-input').setInputFiles(file);
    await expect(page.locator('#tab-list .tab.is-active .tab-format')).toHaveText(format);
  }
  await page.keyboard.press('Control+k'); await page.locator('#palette-input').fill('Split right'); await page.keyboard.press('Enter');
  await expect(page.locator('.pane-strip[data-pane=b] .tab')).toHaveCount(1);
  await page.locator('.reader-host[data-pane=a]:not(.tab-hidden)').click({ position: { x: 40, y: 200 } });
  await expect(page.locator('#workspace')).toHaveAttribute('data-active', 'a');
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce', forcedColors: 'none', contrast: 'no-preference' });
});

test('the active pane has the line along its top edge, the other pane is dimmed and its row steps back, and a click swaps them', async ({ page }) => {
  await splitPdfEpub(page);
  await expect(edge(page, 'a')).toBeVisible();
  const row = await box(page.locator('.pane-strip[data-pane=a]')), line = await box(edge(page, 'a'));
  expect(Math.abs(line.width - row.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(line.x - row.x)).toBeLessThanOrEqual(1);
  expect(Math.round(line.height)).toBe(2);
  await expect(edge(page, 'b')).toBeHidden();
  await expect(dim(page, 'a')).toBeHidden();
  await expect(dim(page, 'b')).toBeVisible();
  await expect.poll(() => quiet(page, 'b')).toBe(true);
  expect(await quiet(page, 'a')).toBe(false);
  // The dimming covers the page from below the row to the pane's bottom, and lets a press through.
  const body = await box(page.locator('.pane-body[data-pane=b]')), shade = await box(dim(page, 'b')), strip = await box(page.locator('.pane-strip[data-pane=b]'));
  expect(shade).toEqual(body);
  expect(shade.y).toBeGreaterThanOrEqual(strip.y + strip.height - 1);
  expect(await dim(page, 'b').evaluate(shade => getComputedStyle(shade).pointerEvents)).toBe('none');
  await page.locator('.reader-host[data-pane=b]:not(.tab-hidden)').click({ position: { x: 60, y: 200 } });
  await expect(page.locator('#workspace')).toHaveAttribute('data-active', 'b');
  await expect(edge(page, 'b')).toBeVisible();
  await expect(edge(page, 'a')).toBeHidden();
  await expect(dim(page, 'a')).toBeVisible();
  await expect(dim(page, 'b')).toBeHidden();
  await expect.poll(() => quiet(page, 'a')).toBe(true);
  expect(await quiet(page, 'b')).toBe(false);
});

test('the marks fade over 120 ms, and show nothing while Home covers the split or a folded split shows one pane', async ({ page }) => {
  await splitPdfEpub(page);
  expect(await page.locator('.pane-strip[data-pane=b] .tab-title').evaluate(title => getComputedStyle(title).transitionDuration)).toBe('0s'); // Reduced motion: at once.
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  expect(await page.locator('.pane-strip[data-pane=b] .tab-title').evaluate(title => getComputedStyle(title).transitionDuration)).toBe('0.12s, 0.12s, 0.12s, 0.12s');
  expect(await dim(page, 'b').evaluate(shade => getComputedStyle(shade).transitionDuration)).toContain('0.12s');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('#home-tab').click();
  await expect(page.locator('#workspace')).toHaveClass(/is-covered/);
  for (const side of ['a', 'b'] as const) { await expect(edge(page, side)).toBeHidden(); await expect(dim(page, side)).toBeHidden(); }
  await expect.poll(() => quiet(page, 'b')).toBe(false);
  await page.locator('.pane-strip[data-pane=a] .tab').first().click();
  await expect(page.locator('#workspace')).not.toHaveClass(/is-covered/);
  await expect(edge(page, 'a')).toBeVisible();
  await page.setViewportSize({ width: 700, height: 760 });
  await expect(page.locator('#workspace')).toHaveClass(/is-single/);
  for (const side of ['a', 'b'] as const) { await expect(edge(page, side)).toBeHidden(); await expect(dim(page, side)).toBeHidden(); }
  expect(await quiet(page, 'a')).toBe(false);
  expect(await quiet(page, 'b')).toBe(false);
});

test('forced colours draw the edge in the system highlight and do not dim the other pane', async ({ page }) => {
  await splitPdfEpub(page);
  await page.emulateMedia({ forcedColors: 'active' });
  await expect(edge(page, 'a')).toBeVisible();
  await expect(dim(page, 'b')).toBeHidden();
  expect(await edge(page, 'a').evaluate(line => getComputedStyle(line).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
});

// Every palette: the seven families in light and in dark, and the ten glow themes (each has one scheme of its own, which src/theme.ts's glowSchemes keeps).
const everyTheme: [string, string, string][] = [
  ...['brief', 'lilac', 'birch', 'graphite', 'arctic', 'blossom', 'peony'].flatMap(palette => [[`${palette} light`, palette, 'light'], [`${palette} dark`, palette, 'dark']] as [string, string, string][]),
  ...([['aurora', 'dark'], ['dusk', 'dark'], ['nebula', 'dark'], ['solar', 'dark'], ['ember', 'dark'], ['orchid', 'dark'], ['glacier', 'light'], ['peach', 'light'], ['lagoon', 'light'], ['moss', 'light']]).map(([palette, scheme]) => [palette, palette, scheme] as [string, string, string]),
];

test('the row of the pane that is not active keeps its text at 4.5:1 and its icons at 3:1 in all 24 theme/mode combinations', async ({ page }) => {
  test.setTimeout(180_000);
  await splitPdfEpub(page);
  await expect.poll(() => quiet(page, 'b')).toBe(true);
  await page.mouse.move(700, 600); // away from the rows: no hover
  expect(everyTheme).toHaveLength(24);
  const worst: Record<string, string> = {};
  for (const [name, palette, scheme] of everyTheme) {
    await page.evaluate(([palette, scheme]) => { document.documentElement.dataset.palette = palette; document.documentElement.dataset.theme = scheme; }, [palette, scheme]);
    expect(await page.evaluate(() => { const probe = document.createElement('span'); probe.style.color = 'light-dark(rgb(1, 1, 1), rgb(2, 2, 2))'; document.body.append(probe); const colour = getComputedStyle(probe).color; probe.remove(); return colour; }), `${name}: the scheme in use`).toBe(scheme === 'dark' ? 'rgb(2, 2, 2)' : 'rgb(1, 1, 1)');
    const lowest = await lowestRowContrast(page, '.pane-strip[data-pane=b]');
    worst[name] = `text ${lowest.text.ratio.toFixed(2)} (${lowest.text.label}), icons ${lowest.icon.ratio.toFixed(2)} (${lowest.icon.label})`;
    expect(lowest.texts, name).toBeGreaterThanOrEqual(2); // the title and the format at least
    expect(lowest.icons, name).toBeGreaterThanOrEqual(2); // the × and the +
    expect(lowest.text.ratio, `${name}: ${lowest.text.label}`).toBeGreaterThanOrEqual(4.5);
    expect(lowest.icon.ratio, `${name}: ${lowest.icon.label}`).toBeGreaterThanOrEqual(3);
  }
  console.log('worst inactive row contrast:', JSON.stringify(worst));
});
