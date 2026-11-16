import { test, expect, type Locator, type Page } from '@playwright/test';
import { seedLibrary, type FixtureCollection, type FixtureDocument } from './home-fixture';
import { lowestTextContrast } from './home-contrast';
import { pagedPdf } from './paged-pdf';
import { warmDevServer } from './warm';

// Home's background: one canvas of dithered window glow behind Home's content, over the whole window below the toolbar,
// faint by default (6 %), with BACKGROUND (a pattern, or None) and STRENGTH in the Appearance sheet.
test.beforeAll(async ({ browser, baseURL }) => { await warmDevServer(browser, baseURL); });

const documents: FixtureDocument[] = [
  { name: 'Alpha.pdf', format: 'pdf', opened: 1, content: pagedPdf(3), progress: { fraction: .4, page: 2, pages: 3 }, favorite: true, collections: ['Alpha shelf'] },
  { name: 'Notes.md', format: 'md', opened: 2, favorite: true, progress: { fraction: .5 }, collections: ['Reading list'] },
  { name: 'Plain.txt', format: 'txt', opened: 3, progress: { fraction: .2 } },
];
const collections: FixtureCollection[] = [{ name: 'Alpha shelf' }, { name: 'Reading list' }];
const appearanceKey = 'hold-my-brief:appearance';

/** The canvases of the ground, a cross-fading one included. */
const canvases = (page: Page) => page.locator('canvas.home-ground');
/** The canvas on show: the entering one, never the one fading out (`showGround` marks it `is-leaving` in the same task that adds the new one). */
const shown = (page: Page) => page.locator('canvas.home-ground:not(.is-leaving)');
/** The pixels of the picture on show, read from the entering canvas so a cross-fade in progress cannot make the locator ambiguous. */
async function pixels(page: Page) {
  await expect(shown(page)).toHaveCount(1);
  return shown(page).evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL());
}
const opacityOf = (canvas: Locator) => canvas.evaluate(node => getComputedStyle(node).opacity);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('hold-my-brief:library-wide', 'closed'); localStorage.setItem('hold-my-brief:library-narrow', 'closed'); });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 1080, height: 760 });
});

/** Keeps an appearance record (the fields a build before the strength existed wrote, or all of them) and reloads on it. */
async function keepAppearance(page: Page, record: object) {
  await page.evaluate(([key, value]) => localStorage.setItem(key as string, JSON.stringify(value)), [appearanceKey, record]);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Home', level: 1 })).toBeVisible();
}
async function openSheet(page: Page) {
  await page.getByRole('button', { name: 'Reader menu' }).click();
  await page.getByRole('button', { name: /Appearance and text/ }).click();
  const sheet = page.locator('#appearance');
  await expect(sheet).toBeVisible();
  return sheet;
}
const themes: [string, object][] = [
  ['Brief light', { mode: 'light', palette: 'brief' }],
  ['Brief dark', { mode: 'dark', palette: 'brief' }],
  ['Aurora', { palette: 'aurora' }],
  ['Peach', { palette: 'peach' }],
];

test('Home is a plain bar again: the title, Open files, Browse library and a quiet Shuffle background; no band, sheen or plate', async ({ page }) => {
  await seedLibrary(page, documents, collections);
  const bar = page.locator('.home-bar');
  await expect(bar.getByRole('heading', { name: 'Home', level: 1 })).toBeVisible();
  await expect(bar.getByRole('button', { name: 'Open files' })).toBeVisible();
  await expect(bar.getByRole('button', { name: 'Browse library' })).toBeVisible();
  await expect(bar.locator('.home-actions').getByRole('button', { name: 'Shuffle background' })).toBeVisible();
  await expect(page.locator('.home-banner, .home-banner-art, .home-banner-plate, .home-banner-sheen')).toHaveCount(0);
  await expect(page.locator('#empty-open')).toHaveText('Open files');
  await expect(page.locator('#home-browse')).toHaveText('Browse library');
  const look = await bar.evaluate(node => ({ background: getComputedStyle(node).backgroundImage, height: node.getBoundingClientRect().height }));
  expect(look.background).toBe('none');
  expect(look.height).toBeLessThan(48);
});

test('the ground is one pixelated canvas, 6 % by default, at the window\'s left edge and the toolbar\'s bottom edge', async ({ page }) => {
  await seedLibrary(page, documents, collections);
  await pixels(page);
  await expect(canvases(page)).toHaveCount(1);
  await expect(shown(page)).toBeVisible();
  const look = await shown(page).evaluate(node => {
    const box = node.getBoundingClientRect(), style = getComputedStyle(node), canvas = node as HTMLCanvasElement;
    return {
      top: box.top, left: box.left, right: box.right, bottom: box.bottom, toolbar: document.querySelector('.toolbar')!.getBoundingClientRect().bottom,
      opacity: style.opacity, blend: style.mixBlendMode, rendering: style.imageRendering, events: style.pointerEvents,
      grid: [canvas.width, canvas.height], backdrop: style.backdropFilter, view: [innerWidth, innerHeight],
    };
  });
  expect(Math.abs(look.top - look.toolbar)).toBeLessThanOrEqual(.5);
  expect(look.toolbar).toBe(40);
  expect(look.left).toBe(0);
  expect(look.right).toBeGreaterThanOrEqual(look.view[0]);
  expect(look.bottom).toBeGreaterThanOrEqual(look.view[1]);
  expect(look.opacity).toBe('0.06');
  expect(look.blend).toBe('multiply');
  expect(look.rendering).toBe('pixelated');
  expect(look.events).toBe('none');
  expect(look.backdrop).toBe('none');
  // One dither pixel per 2 CSS px, drawn for the whole window: the rows of the toolbar are cut off the top, and the extra bucket width is clipped.
  expect(look.grid[1]).toBe(Math.round(look.view[1] / 2) - 20);
  expect(look.grid[0]).toBeGreaterThanOrEqual(look.view[0] / 2);
  expect(look.grid[0]).toBeLessThan(look.view[0] / 2 + 16);
  expect(look.bottom - look.top).toBe(look.grid[1] * 2);
});

test('the glow\'s geometry belongs to the window: with the library panel open the picture is the same, and still starts at the window\'s left edge', async ({ page }) => {
  await seedLibrary(page, documents, collections);
  const before = await pixels(page);
  const workspace = await page.locator('#workspace').boundingBox();
  await page.keyboard.press('Control+b');
  await expect.poll(async () => (await page.locator('#workspace').boundingBox())!.x).toBeGreaterThan(workspace!.x + 100);
  await expect.poll(async () => (await shown(page).boundingBox())!.x).toBe(0);
  expect(await pixels(page)).toBe(before);
  expect((await shown(page).boundingBox())!.y).toBe(40);
});

test('the blend follows the scheme only: multiply in light schemes (Peach included), lighten in dark schemes (Aurora included), over the workspace surface', async ({ page }) => {
  await seedLibrary(page, documents, collections);
  const blends: Record<string, string> = {};
  for (const [name, record] of themes) {
    await keepAppearance(page, record);
    await pixels(page);
    blends[name] = await shown(page).evaluate(node => getComputedStyle(node).mixBlendMode);
  }
  expect(blends).toEqual({ 'Brief light': 'multiply', 'Brief dark': 'lighten', Aurora: 'lighten', Peach: 'multiply' });
});

test('the ground paints over the workspace surface and under the content: at the maximum the window differs from the same one with BACKGROUND None', async ({ page }) => {
  await seedLibrary(page, documents, collections);
  for (const [name, record] of [themes[0], themes[1], themes[2]] as [string, object][]) {
    await keepAppearance(page, { ...record, banner: 'flow', backgroundStrength: .12 });
    await pixels(page);
    const clip = { x: 0, y: 40, width: 1080, height: 720 };
    const withGround = await page.screenshot({ clip, animations: 'disabled' });
    await keepAppearance(page, { ...record, banner: 'none', backgroundStrength: .12 });
    await expect(canvases(page)).toHaveCount(0);
    const without = await page.screenshot({ clip, animations: 'disabled' });
    expect(withGround.equals(without), name).toBe(false);
  }
});

test('the ground is hidden in a reader tab and in the Library tab, and back on Home', async ({ page }) => {
  await seedLibrary(page, documents, collections);
  await pixels(page);
  await expect(shown(page)).toBeVisible();
  await page.getByRole('button', { name: 'Open Alpha.pdf', exact: true }).first().click();
  await expect(page.locator('#tab-list .tab')).toHaveCount(1);
  await expect(page.locator('#empty')).toBeHidden();
  await expect(shown(page)).toBeHidden();
  await page.locator('#home-tab').click();
  await expect(shown(page)).toBeVisible();
  await page.locator('#home-browse').click();
  await expect(page.locator('#library-page')).toBeVisible();
  await expect(page.locator('#empty')).toBeHidden();
  await expect(shown(page)).toBeHidden();
  await page.locator('#home-tab').click();
  await expect(shown(page)).toBeVisible();
});

/** The largest difference in any channel between two screenshots of the same size, over the columns from `from` to `to` (or all). Decoded in the page, so no image library is needed. */
async function channelDiff(page: Page, a: Buffer, b: Buffer, from = 0, to = Infinity) {
  return page.evaluate(async ({ a, b, from, to }) => {
    const read = async (png: string) => {
      const image = new Image();
      image.src = `data:image/png;base64,${png}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d', { willReadFrequently: true })!;
      context.drawImage(image, 0, 0);
      return context.getImageData(0, 0, image.width, image.height);
    };
    const [first, second] = [await read(a), await read(b)];
    if (first.width !== second.width || first.height !== second.height) return Infinity;
    let most = 0;
    for (let y = 0; y < first.height; y++) for (let x = Math.max(0, from); x < Math.min(first.width, to); x++) for (let channel = 0; channel < 4; channel++) most = Math.max(most, Math.abs(first.data[(y * first.width + x) * 4 + channel] - second.data[(y * first.width + x) * 4 + channel]));
    return most;
  }, { a: a.toString('base64'), b: b.toString('base64'), from, to });
}

test('the toolbar never shows any of it: a pixel sample across the toolbar matches the same toolbar with BACKGROUND None, in all four themes', async ({ page }) => {
  await seedLibrary(page, documents, collections);
  const toolbar = { x: 0, y: 0, width: 1080, height: 40 };
  for (const [name, record] of themes) {
    await keepAppearance(page, { ...record, banner: 'flow', backgroundStrength: .12 });
    await pixels(page);
    const withGround = await page.screenshot({ clip: toolbar, animations: 'disabled' });
    await keepAppearance(page, { ...record, banner: 'none', backgroundStrength: .12 });
    await expect(canvases(page)).toHaveCount(0);
    const without = await page.screenshot({ clip: toolbar, animations: 'disabled' });
    // The empty strip between the tabs and the buttons is identical to the bit. Across the whole bar an icon's anti-aliasing may move one level when a compositing layer is added or gone (the dither at 12 % would be 20 levels or more).
    expect(await channelDiff(page, withGround, without, 300, 900), name).toBe(0);
    expect(await channelDiff(page, withGround, without), name).toBeLessThanOrEqual(1);
  }
});

test('STRENGTH sets the opacity live, from 2 to 12 %, and is kept', async ({ page }) => {
  await seedLibrary(page, documents, collections);
  await pixels(page);
  expect(await opacityOf(shown(page))).toBe('0.06');
  const sheet = await openSheet(page);
  const slider = sheet.locator('input[type=range]');
  await expect(sheet.locator('.sheet-label', { hasText: 'BACKGROUND' })).toBeVisible();
  await expect(sheet.locator('.sheet-label', { hasText: 'STRENGTH' })).toBeVisible();
  await expect(sheet.locator('.sheet-label', { hasText: 'BANNER' })).toHaveCount(0);
  await expect(slider).toHaveAttribute('min', '2');
  await expect(slider).toHaveAttribute('max', '12');
  await expect(slider).toHaveAttribute('step', '1');
  await expect(slider).toHaveValue('6');
  await expect(sheet.locator('.strength-value')).toHaveText('6 %');
  await expect(slider).toBeEnabled();
  await slider.fill('9');
  await expect(sheet.locator('.strength-value')).toHaveText('9 %');
  await expect.poll(() => opacityOf(shown(page))).toBe('0.09');
  await slider.fill('2');
  await expect.poll(() => opacityOf(shown(page))).toBe('0.02');
  await slider.fill('12');
  await expect.poll(() => opacityOf(shown(page))).toBe('0.12');
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).backgroundStrength, appearanceKey)).toBe(.12);
  await page.reload();
  await pixels(page);
  expect(await opacityOf(shown(page))).toBe('0.12');
  const again = await openSheet(page);
  await expect(again.locator('input[type=range]')).toHaveValue('12');
  await expect(again.locator('.strength-value')).toHaveText('12 %');
});

test('BACKGROUND None removes the ground and the shuffle button, greys STRENGTH, and a pattern brings them back', async ({ page }) => {
  await seedLibrary(page, documents, collections);
  await pixels(page);
  const sheet = await openSheet(page);
  await expect(sheet.locator('[data-banner]')).toHaveText(['Flow', 'Arcs', 'Stripes', 'Contours', 'Truchet', 'None']);
  await expect(sheet.locator('[data-banner=flow]')).toHaveAttribute('aria-checked', 'true');
  await sheet.locator('[data-banner=none]').click();
  await expect(canvases(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Shuffle background' })).toHaveCount(0);
  await expect(page.locator('.home-bar').getByRole('heading', { name: 'Home' })).toBeVisible();
  const slider = sheet.locator('input[type=range]');
  await expect(slider).toBeDisabled();
  await expect(slider).toHaveAttribute('aria-disabled', 'true');
  expect(await slider.evaluate(node => Number(getComputedStyle(node.closest('.strength')!).opacity))).toBeLessThan(.6);
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).banner, appearanceKey)).toBe('none');
  await page.reload();
  await expect(canvases(page)).toHaveCount(0);
  const again = await openSheet(page);
  await again.locator('[data-banner=truchet]').click();
  await expect(again.locator('input[type=range]')).toBeEnabled();
  await expect(again.locator('input[type=range]')).toHaveAttribute('aria-disabled', 'false');
  await pixels(page);
  await expect(page.getByRole('button', { name: 'Shuffle background' })).toBeVisible();
});

test('a saved record with banner none and no strength shows no ground; STRENGTH reads 6 % and is disabled', async ({ page }) => {
  await seedLibrary(page, documents, collections);
  await keepAppearance(page, { mode: 'light', palette: 'brief', accent: null, page: 'theme', banner: 'none' });
  await expect(canvases(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Shuffle background' })).toHaveCount(0);
  const sheet = await openSheet(page);
  await expect(sheet.locator('[data-banner=none]')).toHaveAttribute('aria-checked', 'true');
  await expect(sheet.locator('input[type=range]')).toHaveValue('6');
  await expect(sheet.locator('.strength-value')).toHaveText('6 %');
  await expect(sheet.locator('input[type=range]')).toBeDisabled();
  await expect(sheet.locator('input[type=range]')).toHaveAttribute('aria-disabled', 'true');
});

test('a saved record from before the strength shows its pattern at 6 %; an out-of-range or non-numeric strength loads as 6 %', async ({ page }) => {
  await seedLibrary(page, documents, collections);
  await keepAppearance(page, { mode: 'light', palette: 'brief', banner: 'arcs' });
  await pixels(page);
  expect(await opacityOf(shown(page))).toBe('0.06');
  for (const bad of [0.5, 0.2, 0.01, -1, '0.1', null]) {
    await keepAppearance(page, { mode: 'light', palette: 'brief', banner: 'arcs', backgroundStrength: bad });
    await pixels(page);
    expect(await opacityOf(shown(page)), String(bad)).toBe('0.06');
  }
});

test('Shuffle background changes the canvas pixels, and the seed survives a reload', async ({ page }) => {
  await seedLibrary(page, documents, collections);
  const before = await pixels(page);
  await page.getByRole('button', { name: 'Shuffle background' }).click();
  await expect.poll(() => canvases(page).count()).toBeGreaterThan(0);
  await expect.poll(async () => await pixels(page) !== before).toBe(true);
  await expect(canvases(page)).toHaveCount(1); // the leaving canvas is removed once the fade is over
  const after = await pixels(page);
  await page.reload();
  expect(await pixels(page)).toBe(after);
});

test('a pattern choice repaints the ground in place, and so does a theme change', async ({ page }) => {
  await seedLibrary(page, documents, collections);
  const before = await pixels(page);
  const sheet = await openSheet(page);
  await sheet.locator('[data-banner=stripes]').click();
  await expect(sheet.locator('[data-banner=stripes]')).toHaveAttribute('aria-checked', 'true');
  await expect.poll(async () => await pixels(page) !== before).toBe(true);
  await expect(canvases(page)).toHaveCount(1);
  const stripes = await pixels(page);
  await sheet.locator('[data-mode=dark]').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect.poll(async () => await pixels(page) !== stripes).toBe(true);
  await expect(canvases(page)).toHaveCount(1);
});

test('the ground has no tone of its own: its pixels are fully transparent or opaque hues', async ({ page }) => {
  await seedLibrary(page, documents, collections);
  await pixels(page);
  const alphas = await shown(page).evaluate(node => {
    const canvas = node as HTMLCanvasElement, data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    const seen = new Set<number>();
    for (let index = 3; index < data.length; index += 4) seen.add(data[index]);
    return [...seen].sort((a, b) => a - b);
  });
  expect(alphas).toEqual([0, 255]);
});

test('a changed picture cross-fades two canvases over 600 ms, and skips the fade under reduced motion', async ({ page }) => {
  await seedLibrary(page, documents, collections);
  await pixels(page);
  await page.getByRole('button', { name: 'Shuffle background' }).click();
  await expect(canvases(page)).toHaveCount(2);
  expect(await canvases(page).first().evaluate(node => getComputedStyle(node).transitionDuration)).toBe('0.6s');
  await expect(canvases(page)).toHaveCount(1);
  const still = await pixels(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Shuffle background' }).click();
  const swapped = () => canvases(page).evaluateAll((nodes, old) => ({ count: nodes.length, changed: (nodes.at(-1) as HTMLCanvasElement).toDataURL() !== old }), still);
  let first = 0;
  await expect.poll(async () => { const now = await swapped(); if (now.changed && !first) first = now.count; return first; }).toBeGreaterThan(0);
  expect(first).toBe(1); // without the skip, the old canvas would still be fading out beside the new one
  expect(await shown(page).evaluate(node => getComputedStyle(node).transitionDuration)).toBe('0s');
});

test('no animation frame fires while Home sits idle for 2 s', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __frames: number };
    w.__frames = 0;
    const request = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => request(time => { w.__frames++; callback(time); });
  });
  await seedLibrary(page, documents, collections);
  await pixels(page);
  await page.waitForTimeout(500); // the first paint's own frame
  await page.evaluate(() => { (window as unknown as { __frames: number }).__frames = 0; });
  await page.waitForTimeout(2000);
  expect(await page.evaluate(() => (window as unknown as { __frames: number }).__frames)).toBe(0);
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
});

// Home's text on the ground at the slider's maximum, read from the sheet: see home-contrast.ts for the measurement.
test('Home text drawn on the ground reads at 4.5:1 against the worst ground pixel at the slider\'s maximum, in Brief light, Brief dark, Aurora and Peach', async ({ page }) => {
  await page.setViewportSize({ width: 1080, height: 1500 });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await seedLibrary(page, documents, collections);
  const sheet = await openSheet(page);
  const maximum = Number(await sheet.locator('input[type=range]').getAttribute('max')) / 100;
  const worst: Record<string, string> = {};
  for (const [name, record] of themes) {
    await keepAppearance(page, { ...record, banner: 'flow', backgroundStrength: maximum });
    await pixels(page);
    expect(await opacityOf(shown(page))).toBe(String(maximum));
    await expect(page.locator('.home-all').first()).toBeVisible();
    const lowest = await lowestTextContrast(page);
    worst[name] = `${lowest.ratio.toFixed(2)} (${lowest.label}, ground tone ${lowest.tone})`;
    expect(lowest.texts, name).toBeGreaterThan(12);
    expect(lowest.ratio, `${name}: ${worst[name]}`).toBeGreaterThanOrEqual(4.5);
  }
  console.log(`worst text contrast at ${maximum * 100} %:`, JSON.stringify(worst));
});
