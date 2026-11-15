import { test, expect, type Page } from '@playwright/test';
import { seedLibrary, type FixtureDocument } from './home-fixture';

const documents: FixtureDocument[] = [
  { name: 'Alpha.pdf', format: 'pdf', opened: 1 },
  { name: 'Notes.md', format: 'md', opened: 2 },
  { name: 'Plain.txt', format: 'txt', opened: 3 },
];
const band = (page: Page) => page.locator('.home-banner');
const canvases = (page: Page) => page.locator('.home-banner-art canvas');
/** The picture on show once any cross-fade is over: one canvas, and its pixels. */
async function pixels(page: Page) {
  await expect(canvases(page)).toHaveCount(1);
  return canvases(page).evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL());
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('hold-my-brief:library-wide', 'closed'); localStorage.setItem('hold-my-brief:library-narrow', 'closed'); });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 1080, height: 760 });
});

async function openSheet(page: Page) {
  await page.getByRole('button', { name: 'Reader menu' }).click();
  await page.getByRole('button', { name: /Appearance and text/ }).click();
  const sheet = page.locator('#appearance');
  await expect(sheet).toBeVisible();
  return sheet;
}

test('Home shows the band with the title, both buttons and Reshuffle, over a pixelated canvas', async ({ page }) => {
  await seedLibrary(page, documents);
  await expect(band(page)).toBeVisible();
  await expect(page.locator('.home-bar')).toHaveCount(0);
  const plate = page.locator('.home-banner-plate');
  await expect(plate.getByRole('heading', { name: 'Home', level: 1 })).toBeVisible();
  await expect(plate.getByRole('button', { name: 'Open files' })).toBeVisible();
  await expect(plate.getByRole('button', { name: 'Browse library' })).toBeVisible();
  await expect(plate.getByRole('button', { name: 'New banner pattern' })).toBeVisible();
  await expect(page.locator('#empty-open')).toHaveText('Open files');
  await expect(page.locator('#home-browse')).toHaveText('Browse library');
  await pixels(page);
  const look = await band(page).evaluate(node => {
    const box = node.getBoundingClientRect(), style = getComputedStyle(node), canvas = getComputedStyle(node.querySelector('canvas')!), plate = node.querySelector('.home-banner-plate')!.getBoundingClientRect();
    const top = document.querySelector('#empty')!.getBoundingClientRect().top, toolbar = document.querySelector('.toolbar')!.getBoundingClientRect().bottom, chip = document.querySelector('.home-chip')?.getBoundingClientRect();
    return {
      height: box.height, radius: style.borderTopLeftRadius, contain: style.contain, plate: plate.height, fromPage: box.top - top, pageGap: top - toolbar, toChips: chip ? chip.top - box.bottom : null,
      blend: canvas.mixBlendMode, opacity: canvas.opacity, rendering: canvas.imageRendering, width: box.width, content: document.querySelector('.home-section')!.getBoundingClientRect().width,
      backdrop: [node, ...node.querySelectorAll('*')].map(item => getComputedStyle(item).backdropFilter).filter(value => value && value !== 'none'),
      grid: [(node.querySelector('canvas') as HTMLCanvasElement).width, (node.querySelector('canvas') as HTMLCanvasElement).height], shown: node.querySelector('canvas')!.getBoundingClientRect().width,
    };
  });
  expect(look.height).toBe(140);
  expect(look.radius).toBe('9px');
  expect(look.contain).toContain('paint');
  expect(look.plate).toBe(48);
  expect(look.fromPage).toBe(18); // the page starts at the toolbar's edge, as the bar did
  expect(look.pageGap).toBeLessThanOrEqual(1);
  expect(look.toChips).toBe(12);
  expect(look.width).toBe(look.content); // the width of the Home content
  expect(look.blend).toBe('multiply');
  expect(look.opacity).toBe('0.6');
  expect(look.rendering).toBe('pixelated');
  expect(look.backdrop).toEqual([]);
  expect(look.grid[1]).toBe(70); // one dither pixel per 2 CSS px
  expect(look.grid[0]).toBeGreaterThanOrEqual(look.width / 2);
  expect(look.grid[0]).toBeLessThan(look.width / 2 + 16);
  expect(look.shown).toBe(look.grid[0] * 2); // never stretched: the extra bucket width is clipped
});

test('the dark theme screens the art over the band at .85', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await seedLibrary(page, documents);
  await pixels(page);
  const look = await canvases(page).evaluate(node => ({ blend: getComputedStyle(node).mixBlendMode, opacity: getComputedStyle(node).opacity }));
  expect(look).toEqual({ blend: 'screen', opacity: '0.85' });
});

test('Reshuffle changes the canvas pixels, and the seed survives a reload', async ({ page }) => {
  await seedLibrary(page, documents);
  const before = await pixels(page);
  await page.getByRole('button', { name: 'New banner pattern' }).click();
  await expect.poll(() => canvases(page).count()).toBeGreaterThan(0);
  await expect.poll(async () => (await canvases(page).count()) === 1 && await pixels(page) !== before).toBe(true);
  const after = await pixels(page);
  await page.reload();
  await expect(band(page)).toBeVisible();
  expect(await pixels(page)).toBe(after);
});

test('a banner set to none shows the plain bar, and choosing a pattern brings the band back', async ({ page }) => {
  await seedLibrary(page, documents);
  await expect(band(page)).toBeVisible();
  const sheet = await openSheet(page);
  await expect(sheet.locator('[data-banner]')).toHaveText(['Flow', 'Arcs', 'Stripes', 'Contours', 'Truchet', 'None']);
  await expect(sheet.locator('[data-banner=flow]')).toHaveAttribute('aria-checked', 'true');
  await sheet.locator('[data-banner=none]').click();
  await expect(page.locator('.home-bar')).toBeVisible();
  await expect(band(page)).toHaveCount(0);
  await expect(page.locator('.home-bar').getByRole('heading', { name: 'Home' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New banner pattern' })).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('hold-my-brief:appearance')!).banner)).toBe('none');
  await page.reload();
  await expect(page.locator('.home-bar')).toBeVisible();
  await expect(band(page)).toHaveCount(0);
  const again = await openSheet(page);
  await again.locator('[data-banner=truchet]').click();
  await expect(band(page)).toBeVisible();
  await expect(page.locator('.home-bar')).toHaveCount(0);
  await pixels(page);
});

test('a pattern choice repaints the band in place', async ({ page }) => {
  await seedLibrary(page, documents);
  const before = await pixels(page);
  const sheet = await openSheet(page);
  await sheet.locator('[data-banner=stripes]').click();
  await expect(sheet.locator('[data-banner=stripes]')).toHaveAttribute('aria-checked', 'true');
  await expect.poll(async () => (await canvases(page).count()) === 1 && await pixels(page) !== before).toBe(true);
});

test('below 720 px the band is 64 px tall and its plate fills it', async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 700 });
  await seedLibrary(page, documents);
  await expect(band(page)).toBeVisible();
  expect((await band(page).boundingBox())!.height).toBe(64);
  expect((await page.locator('.home-banner-plate').boundingBox())!.height).toBe(64);
  await expect(page.getByRole('button', { name: 'Browse library' })).toBeVisible();
  await page.setViewportSize({ width: 800, height: 700 });
  await expect.poll(async () => (await band(page).boundingBox())!.height).toBe(140);
});

test('the band re-renders on a theme change', async ({ page }) => {
  await seedLibrary(page, documents);
  const before = await pixels(page);
  const sheet = await openSheet(page);
  await sheet.locator('[data-mode=dark]').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect.poll(async () => (await canvases(page).count()) === 1 && await pixels(page) !== before).toBe(true);
  const dark = await pixels(page);
  await sheet.locator('[data-choice=lilac]').click();
  await expect.poll(async () => (await canvases(page).count()) === 1 && await pixels(page) !== dark).toBe(true);
});

test('a changed picture cross-fades two canvases over 600 ms, and skips the fade under reduced motion', async ({ page }) => {
  await seedLibrary(page, documents);
  await pixels(page);
  await page.getByRole('button', { name: 'New banner pattern' }).click();
  await expect(canvases(page)).toHaveCount(2);
  expect(await canvases(page).first().evaluate(node => getComputedStyle(node).transitionDuration)).toBe('0.6s');
  await expect(canvases(page)).toHaveCount(1);
  const still = await pixels(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'New banner pattern' }).click();
  const swapped = () => canvases(page).evaluateAll((nodes, old) => ({ count: nodes.length, changed: (nodes.at(-1) as HTMLCanvasElement).toDataURL() !== old }), still);
  let first = 0;
  await expect.poll(async () => { const now = await swapped(); if (now.changed && !first) first = now.count; return first; }).toBeGreaterThan(0);
  expect(first).toBe(1); // without the skip, the old canvas would still be fading out beside the new one
  expect(await canvases(page).evaluate(node => getComputedStyle(node).transitionDuration)).toBe('0s');
});

test('no animation frame fires while Home sits idle for 2 s', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __frames: number };
    w.__frames = 0;
    const request = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => request(time => { w.__frames++; callback(time); });
  });
  await seedLibrary(page, documents);
  await pixels(page);
  await page.waitForTimeout(500); // the first paint's own frame
  await page.evaluate(() => { (window as unknown as { __frames: number }).__frames = 0; });
  await page.waitForTimeout(2000);
  expect(await page.evaluate(() => (window as unknown as { __frames: number }).__frames)).toBe(0);
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
});
