import { test, expect, type Locator, type Page } from '@playwright/test';
import { seedLibrary, type FixtureCollection, type FixtureDocument } from './home-fixture';
import { lowestTextContrast } from './home-contrast';
import { pagedPdf } from './paged-pdf';
import { warmDevServer } from './warm';
import { railHome } from './toolbar-tabs';

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

test('Home is a heading over its sections: no header buttons, no band, sheen or plate', async ({ page }) => {
  await seedLibrary(page, documents, collections);
  const title = page.getByRole('heading', { name: 'Home', level: 1 });
  await expect(title).toBeVisible();
  await expect(page.locator('#empty').getByRole('button', { name: /Open files|Browse library/ })).toHaveCount(0);
  await expect(page.locator('#empty-open, #home-browse')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Shuffle background' })).toHaveCount(0);
  await expect(page.locator('.home-banner, .home-banner-art, .home-banner-plate, .home-banner-sheen')).toHaveCount(0);
  const look = await title.evaluate(node => ({ background: getComputedStyle(node).backgroundImage, height: node.getBoundingClientRect().height }));
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
    const clip = { x: 0, y: 40, width: 1080, height: 720 };
    await keepAppearance(page, { ...record, banner: 'none', backgroundStrength: .1 });
    await expect(canvases(page)).toHaveCount(0);
    const without = await page.screenshot({ clip, animations: 'disabled' });
    await keepAppearance(page, { ...record, banner: 'flow', backgroundStrength: .1 });
    await pixels(page);
    await expect(shown(page)).toHaveCSS('opacity', '0.1');
    // A repaint after the first draw (a theme colour that settled late) cross-fades two canvases, and a screenshot inside that fade can see neither at any strength:
    // the window differs from the one without a ground as soon as the picture is on screen, so the screenshot is retaken until it does.
    await expect.poll(async () => (await page.screenshot({ clip, animations: 'disabled' })).equals(without), { message: name }).toBe(false);
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
  await railHome(page).click();
  await expect(shown(page)).toBeVisible();
  await page.keyboard.press('Control+k');
  await page.locator('#palette-input').fill('library tab');
  await page.keyboard.press('Enter');
  await expect(page.locator('#library-page')).toBeVisible();
  await expect(page.locator('#empty')).toBeHidden();
  await expect(shown(page)).toBeHidden();
  await railHome(page).click();
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
    await keepAppearance(page, { ...record, banner: 'flow', backgroundStrength: .1 });
    await pixels(page);
    const withGround = await page.screenshot({ clip: toolbar, animations: 'disabled' });
    await keepAppearance(page, { ...record, banner: 'none', backgroundStrength: .1 });
    await expect(canvases(page)).toHaveCount(0);
    const without = await page.screenshot({ clip: toolbar, animations: 'disabled' });
    // The empty strip between the tabs and the buttons is identical to the bit. Across the whole bar an icon's anti-aliasing may move one level when a compositing layer is added or gone (the dither at 10 % would be 20 levels or more).
    expect(await channelDiff(page, withGround, without, 300, 900), name).toBe(0);
    expect(await channelDiff(page, withGround, without), name).toBeLessThanOrEqual(1);
  }
});

test('STRENGTH sets the opacity live, from 2 to 30 %, and is kept', async ({ page }) => {
  await seedLibrary(page, documents, collections);
  await pixels(page);
  expect(await opacityOf(shown(page))).toBe('0.06');
  const sheet = await openSheet(page);
  const slider = sheet.locator('input[type=range]');
  await expect(sheet.locator('.sheet-label', { hasText: 'BACKGROUND' })).toBeVisible();
  await expect(sheet.locator('.sheet-label', { hasText: 'STRENGTH' })).toBeVisible();
  await expect(sheet.locator('.sheet-label', { hasText: 'BANNER' })).toHaveCount(0);
  await expect(slider).toHaveAttribute('min', '2');
  await expect(slider).toHaveAttribute('max', '30');
  await expect(slider).toHaveAttribute('step', '1');
  await expect(slider).toHaveValue('6');
  await expect(sheet.locator('.strength-value')).toHaveText('6 %');
  await expect(slider).toBeEnabled();
  await slider.fill('9');
  await expect(sheet.locator('.strength-value')).toHaveText('9 %');
  await expect.poll(() => opacityOf(shown(page))).toBe('0.09');
  await slider.fill('2');
  await expect.poll(() => opacityOf(shown(page))).toBe('0.02');
  await slider.fill('30');
  await expect.poll(() => opacityOf(shown(page))).toBe('0.3');
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).backgroundStrength, appearanceKey)).toBe(.3);
  await page.reload();
  await pixels(page);
  expect(await opacityOf(shown(page))).toBe('0.3');
  const again = await openSheet(page);
  await expect(again.locator('input[type=range]')).toHaveValue('30');
  await expect(again.locator('.strength-value')).toHaveText('30 %');
});

test('BACKGROUND None removes the ground, greys STRENGTH, and a pattern brings them back', async ({ page }) => {
  await seedLibrary(page, documents, collections);
  await pixels(page);
  const sheet = await openSheet(page);
  await expect(sheet.locator('[data-banner]')).toHaveText(['Flow', 'Arcs', 'Stripes', 'Contours', 'Truchet', 'None']);
  await expect(sheet.locator('[data-banner=flow]')).toHaveAttribute('aria-checked', 'true');
  await sheet.locator('[data-banner=none]').click();
  await expect(canvases(page)).toHaveCount(0);
  await expect(page.locator('#empty').getByRole('heading', { name: 'Home' })).toBeVisible();
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
});

test('a saved record with banner none and no strength shows no ground; STRENGTH reads 6 % and is disabled', async ({ page }) => {
  await seedLibrary(page, documents, collections);
  await keepAppearance(page, { mode: 'light', palette: 'brief', accent: null, page: 'theme', banner: 'none' });
  await expect(canvases(page)).toHaveCount(0);
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
  for (const bad of [0.5, 0.31, 0.01, -1, '0.1', null]) {
    await keepAppearance(page, { mode: 'light', palette: 'brief', banner: 'arcs', backgroundStrength: bad });
    await pixels(page);
    expect(await opacityOf(shown(page)), String(bad)).toBe('0.06');
  }
});

test('the picture is the day\'s: a seed saved today stays on show after a reload, and another day\'s is replaced', async ({ page }) => {
  await seedLibrary(page, documents, collections);
  const key = 'hold-my-brief:home-banner';
  const day = (offset: number) => page.evaluate(offset => {
    const date = new Date(); date.setDate(date.getDate() + offset);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }, offset);
  const today = await day(0);
  await page.evaluate(([key, today]) => localStorage.setItem(key, JSON.stringify({ day: today, seed: 12345 })), [key, today]);
  await page.reload();
  const kept = await pixels(page);
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), key)).toEqual({ day: today, seed: 12345 });
  await page.reload();
  expect(await pixels(page)).toBe(kept);
  await page.evaluate(([key, yesterday]) => localStorage.setItem(key, JSON.stringify({ day: yesterday, seed: 12345 })), [key, await day(-1)]);
  await page.reload();
  expect(await pixels(page)).not.toBe(kept);
  expect((await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), key)).day).toBe(today);
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
  const sheet = await openSheet(page);
  await sheet.locator('[data-banner=stripes]').click();
  await expect(canvases(page)).toHaveCount(2);
  expect(await canvases(page).first().evaluate(node => getComputedStyle(node).transitionDuration)).toBe('0.6s');
  await expect(canvases(page)).toHaveCount(1);
  const still = await pixels(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await sheet.locator('[data-banner=contours]').click();
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
  // Settle on state, not a sleep: fonts, every Home thumbnail (pdf.js paints it over a few frames of its own) and every Home image are
  // loaded and decoded, and one 500 ms window has had no frame.
  // A tile far below the fold is never asked for (Home fills tiles within 120 px of the viewport), so only the ones the lazy fill would reach count.
  await expect.poll(() => page.evaluate(() => new Promise<number>(done => {
    const pending = [...document.querySelectorAll('.library-tile-media[data-path]:not(.is-loaded):not(.is-unavailable)')];
    const look = new IntersectionObserver(entries => { look.disconnect(); done(entries.filter(entry => entry.isIntersecting).length); }, { rootMargin: '120px' });
    if (pending.length) for (const media of pending) look.observe(media); else done(0);
  }))).toBe(0);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.querySelectorAll('img')].map(async image => { if (!image.complete) await new Promise(done => { image.addEventListener('load', done, { once: true }); image.addEventListener('error', done, { once: true }); }); await image.decode().catch(() => undefined); }));
  });
  await expect.poll(async () => {
    await page.evaluate(() => { (window as unknown as { __frames: number }).__frames = 0; });
    await page.waitForTimeout(500);
    return page.evaluate(() => (window as unknown as { __frames: number }).__frames);
  }, { timeout: 5000, intervals: [0] }).toBe(0);
  await page.waitForTimeout(2000);
  expect(await page.evaluate(() => (window as unknown as { __frames: number }).__frames)).toBe(0);
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
});

// Every palette: the seven families in light and in dark, and the ten glow themes (each has one scheme of its own).
const families = ['brief', 'lilac', 'birch', 'graphite', 'arctic', 'blossom', 'peony'];
const glowThemes = ['aurora', 'dusk', 'nebula', 'solar', 'ember', 'orchid', 'glacier', 'peach', 'lagoon', 'moss'];
const everyTheme: [string, object][] = [
  ...families.flatMap(palette => [[`${palette} light`, { mode: 'light', palette }], [`${palette} dark`, { mode: 'dark', palette }]] as [string, object][]),
  ...glowThemes.map(palette => [palette, { palette }] as [string, object]),
];

// T (groundInkStrength in theme.ts): up to it Home's muted text is plain --muted, above it the text deepens toward --fg. Plain --muted passes 4.5:1 in all 24 theme/mode combinations up to T in Chromium and WebKit.
const inkStart = .08;

// Home's text on the ground at the first strength above T, at 20 % and at the slider's maximum, read from the sheet: see home-contrast.ts for the measurement.
test('Home text drawn on the ground reads at 4.5:1 against the worst ground pixel at T + 1 %, 20 % and the slider\'s maximum, in all 17 palettes (the families in light and dark)', async ({ page }) => {
  test.setTimeout(420_000);
  await page.setViewportSize({ width: 1080, height: 1500 });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await seedLibrary(page, documents, collections);
  const sheet = await openSheet(page);
  const maximum = Number(await sheet.locator('input[type=range]').getAttribute('max')) / 100;
  expect(maximum).toBe(.3);
  const worst: Record<string, string> = {};
  for (const strength of [Math.round((inkStart + .01) * 100) / 100, .2, maximum]) {
    for (const [name, record] of everyTheme) {
      await keepAppearance(page, { ...record, banner: 'flow', backgroundStrength: strength });
      await pixels(page);
      expect(await opacityOf(shown(page))).toBe(String(strength));
      await expect(page.locator('.home-card-meta').first()).toBeVisible();
      const lowest = await lowestTextContrast(page);
      worst[`${name} ${Math.round(strength * 100)} %`] = `${lowest.ratio.toFixed(2)} (${lowest.label}, ground tone ${lowest.tone})`;
      expect(lowest.texts, name).toBeGreaterThan(12);
      expect(lowest.ratio, `${name} at ${Math.round(strength * 100)} %: ${lowest.ratio}`).toBeGreaterThanOrEqual(4.5);
    }
  }
  expect(Object.keys(worst)).toHaveLength(72); // 24 theme/mode combinations at 3 strengths
  console.log('worst text contrast:', JSON.stringify(worst));
});

// Home's muted text (what is drawn on the ground in --muted) keeps --muted up to T (8 %) and deepens toward --fg above it. Text already in --fg never changes.
test('Home\'s muted text is exactly --muted at 6 % and at T (8 %), its --fg text is exactly --fg, and above T the muted text deepens toward --fg (darker in light themes, lighter in dark ones)', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1080, height: 1500 });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await seedLibrary(page, documents, collections);
  const sheet = await openSheet(page);
  const maximum = Number(await sheet.locator('input[type=range]').getAttribute('max')) / 100;
  /** The computed colour of each Home text (as the browser serialises it) next to the computed --muted and --fg, and the lightness of each. */
  const read = () => page.evaluate(() => {
    const swatch = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
    swatch.canvas.width = swatch.canvas.height = 1;
    const lightness = (css: string) => {
      swatch.clearRect(0, 0, 1, 1); swatch.fillStyle = css; swatch.fillRect(0, 0, 1, 1);
      const [r, g, b] = swatch.getImageData(0, 0, 1, 1).data, lin = (v: number) => { const c = v / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; };
      return .2126 * lin(r) + .7152 * lin(g) + .0722 * lin(b);
    };
    const probe = (token: string) => { const node = document.createElement('i'); node.style.color = `var(${token})`; document.querySelector('#empty.is-home')!.append(node); const colour = getComputedStyle(node).color; node.remove(); return colour; };
    const muted = probe('--muted'), fg = probe('--fg');
    const texts = (selector: string) => [...document.querySelectorAll(selector)].filter(node => !node.closest('.home-recent-open') && node.textContent?.trim()).map(node => getComputedStyle(node).color);
    return {
      muted, fg, mutedLightness: lightness(muted), fgLightness: lightness(fg),
      mutedTexts: ['.home-card-meta'].map(selector => ({ selector, colours: texts(selector), lightness: texts(selector).map(lightness) })),
      fgTexts: ['#empty h1', '.home-section h2', '.home-card-title'].map(selector => ({ selector, colours: texts(selector) })),
    };
  });
  for (const [name, record] of themes) {
    for (const strength of [.06, inkStart]) {
      await keepAppearance(page, { ...record, banner: 'flow', backgroundStrength: strength });
      await pixels(page);
      const now = await read();
      for (const group of now.mutedTexts) {
        expect(group.colours.length, `${name} ${group.selector}`).toBeGreaterThan(0);
        for (const colour of group.colours) expect(colour, `${name} ${strength} ${group.selector}`).toBe(now.muted);
      }
      for (const group of now.fgTexts) {
        expect(group.colours.length, `${name} ${group.selector}`).toBeGreaterThan(0);
        for (const colour of group.colours) expect(colour, `${name} ${strength} ${group.selector}`).toBe(now.fg);
      }
    }
    await keepAppearance(page, { ...record, banner: 'flow', backgroundStrength: maximum });
    await pixels(page);
    const top = await read();
    const lighter = top.fgLightness > top.mutedLightness; // --fg is lighter than --muted in the dark themes
    for (const group of top.mutedTexts) {
      expect(group.colours.length, `${name} ${group.selector}`).toBeGreaterThan(0);
      for (const light of group.lightness) expect(lighter ? light > top.mutedLightness : light < top.mutedLightness, `${name} at the maximum ${group.selector}`).toBe(true);
    }
    for (const group of top.fgTexts) for (const colour of group.colours) expect(colour, `${name} ${group.selector}`).toBe(top.fg);
  }
});

test('the ink deepens as the slider rises above T (8 %) and is whole at the maximum, live without a reload', async ({ page }) => {
  await page.setViewportSize({ width: 1080, height: 1500 });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await seedLibrary(page, documents, collections);
  await keepAppearance(page, { mode: 'light', palette: 'brief', banner: 'flow', backgroundStrength: .06 });
  const sheet = await openSheet(page);
  const slider = sheet.locator('input[type=range]'), file = page.locator('.home-card-meta').first();
  const colour = () => file.evaluate(node => {
    const swatch = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
    swatch.canvas.width = swatch.canvas.height = 1; swatch.fillStyle = getComputedStyle(node).color; swatch.fillRect(0, 0, 1, 1);
    const [r, g, b] = swatch.getImageData(0, 0, 1, 1).data;
    return (r + g + b) / 3;
  });
  const seen: number[] = [];
  for (const value of ['8', '15', '20', '30']) { await slider.fill(value); await expect(sheet.locator('.strength-value')).toHaveText(`${value} %`); seen.push(await colour()); }
  expect(seen[1]).toBeLessThan(seen[0]);
  expect(seen[2]).toBeLessThan(seen[1]);
  expect(seen[3]).toBeLessThan(seen[2]);
  await slider.fill('6'); // back under T: the muted ink again
  expect(await colour()).toBe(seen[0]);
});
