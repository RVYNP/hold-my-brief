import { test, expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { crc32, deflateSync } from 'node:zlib';
import { pagedPdf } from './paged-pdf';

// pagedPdf pages are 300 x 400 pt, which is 400 x 533.33 CSS px at 100 % (a PDF point is 96/72 CSS px).
const PAGE_WIDTH = 400, PAGE_HEIGHT = 400 * 96 / 72;
/** The zoom ladder, in percent. */
const LADDER = [10, 25, 33, 50, 67, 75, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400, 600, 800];

/** A three-page PDF open at 1080 x 680 with the library drawer closed, settled on page 1. */
async function openPdf(page: Page, buffer = pagedPdf(3)) {
  await page.setViewportSize({ width: 1080, height: 680 });
  await page.goto('/');
  await openFile(page, buffer);
}
async function openFile(page: Page, buffer: Buffer) {
  await page.locator('#file-input').setInputFiles({ name: 'zoom.pdf', mimeType: 'application/pdf', buffer });
  await expect(page.locator('#position')).toContainText('Page 1 of');
  await expect(page.locator('#loading')).toBeHidden();
  await expect(page.locator('#view-controls')).toBeVisible();
  if (await page.locator('#library-root').isVisible()) await page.locator('#library-toggle').click();
  await expect(page.locator('#library-root')).toBeHidden();
  await settled(page);
}
const level = (page: Page) => page.locator('#zoom-level');
/** The level shown, as a number of percent. */
const percent = async (page: Page) => Number((await level(page).textContent())!.replace('%', ''));
/** The fit in force ('page' or 'width'), or '' once a zoom has been chosen. */
const fitOf = (page: Page, fit: 'page' | 'width' | '') => expect(level(page)).toHaveAttribute('data-fit', fit);
/** No render in flight and no gesture preview on the page. */
async function settled(page: Page) {
  await expect(page.locator('.pdf-render-status')).toHaveCount(0);
  await expect(page.locator('.pdf-reader')).not.toHaveClass(/zoom-preview/);
  await expect(page.locator('.pdf-page')).toHaveCount(1);
}
const menu = (page: Page) => page.getByRole('menu', { name: 'Zoom' });
const field = (page: Page) => page.getByRole('textbox', { name: 'Zoom percentage' });
const item = (page: Page, name: string) => page.locator('#zoom-menu [role^="menuitem"]', { hasText: name });
async function openMenu(page: Page) {
  await level(page).click();
  await expect(menu(page)).toBeVisible();
  await expect(field(page)).toBeFocused();
}
const pageBox = async (page: Page) => (await page.locator('.pdf-page').boundingBox())!;
/** Actual size by its shortcut, with the page settled at it. */
async function actualSize(page: Page) {
  await page.locator('.pdf-reader').focus(); await page.keyboard.press('Control+1');
  await expect(level(page)).toHaveText('100%'); await fitOf(page, ''); await settled(page);
}

test('the zoom level is a menu button showing the real scale: field, commands with their keys, a check on the fit, then presets', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await openPdf(page);
  await expect(level(page)).toHaveAttribute('aria-haspopup', 'menu');
  await expect(level(page)).toHaveAttribute('aria-expanded', 'false');
  // A fit is a mode, and the label is the scale it comes to: the page height over its height at 100 %.
  await fitOf(page, 'page');
  await expect(level(page)).toHaveText(/^\d+%$/);
  expect(Math.abs((await percent(page)) - (await pageBox(page)).height / PAGE_HEIGHT * 100)).toBeLessThanOrEqual(1);
  await openMenu(page);
  await expect(level(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(field(page)).toHaveValue(`${await percent(page)}%`);
  const entries = menu(page).locator('[role^="menuitem"]');
  await expect(entries).toHaveText(['Zoom inCtrl +', 'Zoom outCtrl −', 'Fit pageCtrl 0', 'Fit widthCtrl 2', 'Actual size (100%)Ctrl 1', '50%', '200%']);
  // The fit in force carries the check; no fit, no check.
  const checked = async () => menu(page).locator('[aria-checked=true]').allTextContents();
  expect(await checked()).toEqual(['Fit pageCtrl 0']);
  await expect(menu(page).getByRole('menuitemradio', { name: /Fit page/ })).toHaveAttribute('aria-checked', 'true');
  await expect(menu(page).getByRole('menuitemradio', { name: /Fit width/ })).toHaveAttribute('aria-checked', 'false');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+2'); await fitOf(page, 'width'); await openMenu(page);
  expect(await checked()).toEqual(['Fit widthCtrl 2']);
  await page.keyboard.press('Escape');
  await actualSize(page); await openMenu(page);
  expect(await checked()).toEqual([]);
  await expect(field(page)).toHaveValue('100%');
  // The menu opens above the pill, which sits at the bottom of the panel, and inside the window.
  const pill = (await page.locator('#view-controls').boundingBox())!, box = (await page.locator('#zoom-menu').boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(pill.y);
  expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(1080);
  expect(errors).toEqual([]);
});

test('100 % is the page at its physical size at CSS resolution, whatever the window, and Ctrl 1 is its shortcut', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await openPdf(page);
  await actualSize(page);
  let box = await pageBox(page);
  expect(box.width).toBeCloseTo(PAGE_WIDTH, 0); expect(box.height).toBeCloseTo(PAGE_HEIGHT, 0);
  const canvas = (await page.locator('.pdf-page canvas').boundingBox())!;
  expect(canvas.width).toBeCloseTo(PAGE_WIDTH, 0);
  // A window that is smaller or larger does not change it: it is a scale, not a fit.
  await page.setViewportSize({ width: 700, height: 500 }); await page.waitForTimeout(400); await settled(page);
  box = await pageBox(page); expect(box.width).toBeCloseTo(PAGE_WIDTH, 0); expect(box.height).toBeCloseTo(PAGE_HEIGHT, 0);
  await expect(level(page)).toHaveText('100%');
  await page.setViewportSize({ width: 1080, height: 900 }); await page.waitForTimeout(400); await settled(page);
  box = await pageBox(page); expect(box.width).toBeCloseTo(PAGE_WIDTH, 0);
  // The menu entry is the same thing as the key.
  await page.keyboard.press('Control+0'); await fitOf(page, 'page');
  await openMenu(page); await item(page, 'Actual size').click();
  await expect(level(page)).toHaveText('100%'); await fitOf(page, ''); await settled(page);
  expect((await pageBox(page)).width).toBeCloseTo(PAGE_WIDTH, 0);
  expect(errors).toEqual([]);
});

test('a fit keeps following the window and the label keeps showing the real scale', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await openPdf(page);
  const matches = async () => {
    const shown = await percent(page), box = await pageBox(page);
    expect(Math.abs(shown - box.height / PAGE_HEIGHT * 100), `label ${shown}% against a ${box.height} px page`).toBeLessThanOrEqual(1);
  };
  await fitOf(page, 'page'); await matches();
  const before = await percent(page);
  // Fit page: a shorter window refits the page, and the label follows it.
  await page.setViewportSize({ width: 1080, height: 480 });
  await expect.poll(() => percent(page)).toBeLessThan(before - 10);
  await settled(page); await fitOf(page, 'page'); await matches();
  const host = (await page.locator('.pdf-reader').boundingBox())!, box = await pageBox(page);
  expect(box.y + box.height).toBeLessThanOrEqual(host.y + host.height + 1); // It still fits.
  // Fit width: the page is as wide as the panel less its padding; a narrower window narrows it, and the label with it.
  await page.keyboard.press('Control+2'); await fitOf(page, 'width'); await settled(page);
  await page.setViewportSize({ width: 900, height: 680 }); await page.waitForTimeout(500); await settled(page);
  const wide = await percent(page); await matches();
  await page.setViewportSize({ width: 700, height: 680 }); await expect.poll(() => percent(page)).toBeLessThan(wide);
  await settled(page); await fitOf(page, 'width'); await matches();
  expect(errors).toEqual([]);
});

test('the zoom menu opens and closes by mouse and keyboard, and returns focus to its button', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await openPdf(page);
  const closed = async () => { await expect(menu(page)).toBeHidden(); await expect(level(page)).toHaveAttribute('aria-expanded', 'false'); };

  // Click toggles; Escape closes with focus back on the button.
  await openMenu(page);
  await level(page).click(); await closed();
  await openMenu(page);
  await page.keyboard.press('Escape'); await closed(); await expect(level(page)).toBeFocused();

  // The button opens it from the keyboard: Enter, Space and the arrow keys.
  for (const key of ['Enter', ' ', 'ArrowDown', 'ArrowUp']) {
    await level(page).focus(); await page.keyboard.press(key);
    await expect(menu(page)).toBeVisible(); await expect(field(page)).toBeFocused();
    await page.keyboard.press('Escape'); await closed(); await expect(level(page)).toBeFocused();
  }

  // Arrows move through the field and the entries, wrapping; Home and End jump between entries.
  await openMenu(page);
  await page.keyboard.press('ArrowDown'); await expect(item(page, 'Zoom in')).toBeFocused();
  await page.keyboard.press('ArrowDown'); await expect(item(page, 'Zoom out')).toBeFocused();
  await page.keyboard.press('ArrowDown'); await expect(item(page, 'Fit page')).toBeFocused();
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await expect(item(page, 'Actual size')).toBeFocused();
  await page.keyboard.press('End'); await expect(item(page, '200%')).toBeFocused();
  await page.keyboard.press('ArrowDown'); await expect(field(page)).toBeFocused();
  await page.keyboard.press('ArrowUp'); await expect(item(page, '200%')).toBeFocused();
  await page.keyboard.press('Home'); await expect(item(page, 'Zoom in')).toBeFocused();
  await page.keyboard.press('ArrowUp'); await expect(field(page)).toBeFocused();

  // Tab closes it and leaves focus on the button.
  await page.keyboard.press('Tab'); await closed(); await expect(level(page)).toBeFocused();

  // A press outside closes it; the page takes focus when it is what was pressed.
  await openMenu(page);
  const sheet = (await page.locator('.pdf-reader').boundingBox())!;
  await page.mouse.click(sheet.x + sheet.width - 40, sheet.y + 40); await closed(); // Clear of the rail along the panel's left edge.
  await expect(page.locator('.pdf-reader')).toBeFocused();
  // Palette (another popover) takes over: the menu does not stay behind it.
  await openMenu(page);
  await page.keyboard.press('Control+k');
  await closed(); await page.keyboard.press('Escape');

  // Choosing an entry closes it too, and a menu opened by the keyboard returns to the button.
  await level(page).focus(); await page.keyboard.press('Enter');
  await item(page, '50%').click(); await closed(); await expect(level(page)).toHaveText('50%');
  expect(errors).toEqual([]);
});

test('typing a percentage applies on Enter, reverts when invalid and clamps to the range', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await openPdf(page);
  const typed = async (text: string) => { await field(page).fill(text); await page.keyboard.press('Enter'); };

  await page.locator('.pdf-reader').focus();
  await openMenu(page); await typed('135');
  await expect(menu(page)).toBeHidden(); await expect(level(page)).toHaveText('135%'); await fitOf(page, ''); await expect(page.locator('.pdf-reader')).toBeFocused(); // Opened with the pointer: the page keeps focus.
  await settled(page);
  const natural = await pageBox(page);
  expect(natural.width).toBeCloseTo(PAGE_WIDTH * 1.35, 0); // A true scale: 135 % of the page's size, not of the fit.

  // The field shows the current level when reopened; garbage reverts it, leaves the menu open and changes nothing.
  await openMenu(page); await expect(field(page)).toHaveValue('135%');
  await typed('abc'); await expect(menu(page)).toBeVisible(); await expect(field(page)).toHaveValue('135%'); await expect(level(page)).toHaveText('135%');
  await typed('-5'); await expect(field(page)).toHaveValue('135%');
  await typed(''); await expect(field(page)).toHaveValue('135%');
  expect((await pageBox(page)).width).toBeCloseTo(natural.width, 0);

  // Out of range clamps; a trailing percent sign is fine.
  await typed('9000'); await expect(menu(page)).toBeHidden(); await expect(level(page)).toHaveText('800%'); await settled(page);
  await openMenu(page); await typed('3%'); await expect(level(page)).toHaveText('10%'); await settled(page);
  await openMenu(page); await typed(' 70 % '); await expect(level(page)).toHaveText('70%'); await settled(page);

  // Escape abandons what was typed.
  await openMenu(page); await field(page).fill('250'); await page.keyboard.press('Escape');
  await expect(menu(page)).toBeHidden(); await expect(level(page)).toHaveText('70%');
  await openMenu(page); await expect(field(page)).toHaveValue('70%');
  expect(errors).toEqual([]);
});

test('menu entries apply the presets, actual size and the fits; any zoom leaves the fit', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await openPdf(page);
  const choose = async (name: string, shown: string | RegExp) => { await openMenu(page); await item(page, name).click(); await expect(level(page)).toHaveText(shown); await settled(page); };
  const width = async () => (await pageBox(page)).width;

  await choose('50%', '50%'); await fitOf(page, ''); expect(await width()).toBeCloseTo(PAGE_WIDTH / 2, 0);
  await choose('200%', '200%'); expect(await width()).toBeCloseTo(PAGE_WIDTH * 2, 0);
  await choose('Actual size', '100%'); expect(await width()).toBeCloseTo(PAGE_WIDTH, 0);
  await choose('Zoom in', '110%'); await choose('Zoom in', '125%'); await choose('Zoom out', '110%');
  await choose('Fit width', /^\d+%$/); await fitOf(page, 'width');
  await expect(level(page)).toHaveAttribute('title', /Fit width/);
  expect(Math.abs((await percent(page)) - (await width()) / PAGE_WIDTH * 100)).toBeLessThanOrEqual(1);
  await choose('Fit page', /^\d+%$/); await fitOf(page, 'page');
  // Zooming from a fit leaves it, to the next rung from the level the fit came to; it keeps the fit to return to.
  await choose('Fit width', /^\d+%$/); const fitted = await percent(page);
  await choose('50%', '50%'); await fitOf(page, '');
  await choose('Fit width', String(fitted) + '%');
  await openMenu(page); await item(page, 'Zoom in').click(); await settled(page); await fitOf(page, '');
  expect(await percent(page)).toBe(LADDER.find(rung => rung > fitted + .5));
  // Zoom out from a fit snaps down the same way.
  await page.keyboard.press('Control+2'); await fitOf(page, 'width'); await settled(page);
  await openMenu(page); await item(page, 'Zoom out').click(); await settled(page); await fitOf(page, '');
  expect(await percent(page)).toBe(LADDER.filter(rung => rung < fitted - .5).at(-1));
  // At the top of the range the menu entry is disabled like the pill's button.
  await openMenu(page); await field(page).fill('800'); await page.keyboard.press('Enter'); await expect(level(page)).toHaveText('800%'); await settled(page);
  await openMenu(page); await expect(item(page, 'Zoom in')).toBeDisabled(); await expect(item(page, 'Zoom out')).toBeEnabled(); await page.keyboard.press('Escape');
  // Double-clicking the level still toggles the fits; from a zoom it first returns to the fit it came from (fit width, chosen last).
  await level(page).dblclick(); await fitOf(page, 'width'); await settled(page);
  await level(page).dblclick(); await fitOf(page, 'page'); await settled(page);
  await level(page).dblclick(); await fitOf(page, 'width'); await settled(page);
  await expect(menu(page)).toBeHidden();
  expect(errors).toEqual([]);
});

test('buttons and shortcuts step along the ladder and stop at its ends', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await openPdf(page);
  const zoomIn = page.getByRole('button', { name: 'Zoom in' }), zoomOut = page.getByRole('button', { name: 'Zoom out' });
  await actualSize(page);
  const up = LADDER.slice(LADDER.indexOf(100) + 1);
  for (const [index, expected] of up.entries()) {
    // The button and both keys of the shortcut share one state.
    if (index % 2 === 0) await zoomIn.click(); else await page.keyboard.press('Control+Equal');
    await expect(level(page)).toHaveText(`${expected}%`);
  }
  await settled(page);
  await expect(zoomIn).toBeDisabled(); await expect(zoomOut).toBeEnabled();
  await page.keyboard.press('Control+Equal'); await expect(level(page)).toHaveText('800%');
  const down = [...LADDER.slice(0, -1)].reverse();
  for (const [index, expected] of down.entries()) {
    if (index % 2 === 0) await zoomOut.click(); else await page.keyboard.press('Control+Minus');
    await expect(level(page)).toHaveText(`${expected}%`);
    if (expected >= 50) await settled(page);
  }
  await settled(page);
  await expect(zoomOut).toBeDisabled(); await expect(zoomIn).toBeEnabled();
  await page.keyboard.press('Control+Minus'); await expect(level(page)).toHaveText('10%');
  // From between rungs the next step snaps to the neighbouring rung.
  await openMenu(page); await field(page).fill('135'); await page.keyboard.press('Enter'); await expect(level(page)).toHaveText('135%');
  await zoomIn.click(); await expect(level(page)).toHaveText('150%');
  await openMenu(page); await field(page).fill('135'); await page.keyboard.press('Enter'); await expect(level(page)).toHaveText('135%');
  await zoomOut.click(); await expect(level(page)).toHaveText('125%');
  expect(errors).toEqual([]);
});

/** Where the point `at` of the page, given as a fraction of it, is on screen now. */
async function onScreen(page: Page, fraction: { x: number; y: number }) {
  const box = await pageBox(page);
  return { x: box.x + fraction.x * box.width, y: box.y + fraction.y * box.height };
}

test('Ctrl + wheel zooms toward the pointer: the page point under it stays under it, then renders crisply', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await openPdf(page);
  await actualSize(page);
  const sheet = await pageBox(page);
  const fraction = { x: .6, y: .4 }, pointer = { x: sheet.x + fraction.x * sheet.width, y: sheet.y + fraction.y * sheet.height };
  const near = (actual: { x: number; y: number }, note: string) => { expect(Math.abs(actual.x - pointer.x), `${note}: x ${actual.x} vs ${pointer.x}`).toBeLessThanOrEqual(3); expect(Math.abs(actual.y - pointer.y), `${note}: y ${actual.y} vs ${pointer.y}`).toBeLessThanOrEqual(3); };
  // Whether the webview would zoom the whole interface: nothing may leave the capture phase unprevented.
  await page.evaluate(() => { (window as unknown as { unprevented: number }).unprevented = 0; addEventListener('wheel', event => { if (!event.defaultPrevented) (window as unknown as { unprevented: number }).unprevented++; }); });
  const canvas = await page.locator('.pdf-page canvas').elementHandle();

  await page.mouse.move(pointer.x, pointer.y);
  await page.keyboard.down('Control');
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -100);
  await page.keyboard.up('Control');
  // The level follows the gesture: four notches is 1.49^4, about 495 % of 100 %: wide enough that the page overflows the panel and the point can be held.
  await expect(level(page)).toHaveText(/^4[0-9]{2}%$/);
  await settled(page);
  expect(await page.evaluate(canvas => document.querySelector('.pdf-page canvas') !== canvas, canvas)).toBe(true); // A fresh render, not the scaled bitmap.
  near(await onScreen(page, fraction), 'after zooming in');
  expect(await page.evaluate(() => (window as unknown as { unprevented: number }).unprevented)).toBe(0);
  // The page is as large as the level says, at the crisp size.
  const zoomed = await pageBox(page), shown = await percent(page);
  expect(zoomed.width).toBeCloseTo(PAGE_WIDTH * shown / 100, 0);

  // Out again, partway: the same point stays put.
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, 20); // A light touch (about 0.82x): the page still overflows sideways, so the point can be held.
  await page.keyboard.up('Control');
  await expect.poll(() => percent(page)).toBe(Math.round(shown * Math.exp(-.2)));
  await settled(page);
  near(await onScreen(page, fraction), 'after zooming out');
  expect(errors).toEqual([]);
});

test('a wheel gesture from a fit leaves the fit, starting from the scale the fit came to', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await openPdf(page);
  await fitOf(page, 'page');
  const start = await percent(page), sheet = await pageBox(page);
  await page.mouse.move(sheet.x + sheet.width / 2, sheet.y + sheet.height / 2);
  await page.keyboard.down('Control'); await page.mouse.wheel(0, -100); await page.keyboard.up('Control');
  await expect.poll(() => percent(page)).toBe(Math.round(start * Math.exp(.4)));
  await fitOf(page, ''); await settled(page);
  // And it can come back.
  await page.keyboard.press('Control+0'); await fitOf(page, 'page'); await settled(page);
  expect(Math.abs((await percent(page)) - start)).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

test('during a wheel gesture the page is only scaled about the pointer; one render follows when it settles', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await openPdf(page);
  await actualSize(page);
  const sheet = await pageBox(page);
  const fraction = { x: .7, y: .25 }, pointer = { x: sheet.x + fraction.x * sheet.width, y: sheet.y + fraction.y * sheet.height };
  await page.evaluate(() => {
    const host = document.querySelector('.pdf-reader')!, w = window as unknown as { renders: number; surfaces: Element[] };
    w.renders = 0; w.surfaces = [];
    new MutationObserver(records => { for (const record of records) for (const node of record.addedNodes) if (node instanceof HTMLElement && node.classList.contains('pdf-page')) w.renders++; }).observe(host, { childList: true });
  });
  // Fourteen events in one turn are one gesture, painted once per frame (about 5.4x).
  const measured = await page.evaluate(async ({ x, y }) => {
    const host = document.querySelector('.pdf-reader') as HTMLElement, sheet = host.querySelector('.pdf-page') as HTMLElement;
    for (let i = 0; i < 14; i++) host.dispatchEvent(new WheelEvent('wheel', { deltaY: -12, ctrlKey: true, clientX: x, clientY: y, bubbles: true, cancelable: true }));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const box = sheet.getBoundingClientRect();
    return { preview: host.classList.contains('zoom-preview'), same: host.querySelector('.pdf-page') === sheet, left: box.left, top: box.top, width: box.width, height: box.height, layout: sheet.offsetWidth, renders: (window as unknown as { renders: number }).renders };
  }, pointer);
  expect(measured.preview).toBe(true);
  expect(measured.same).toBe(true); expect(measured.renders).toBe(0); // Nothing re-rendered yet.
  expect(measured.width / measured.layout).toBeGreaterThan(1.5); // Scaled by transform alone.
  const held = { x: measured.left + fraction.x * measured.width, y: measured.top + fraction.y * measured.height };
  expect(Math.abs(held.x - pointer.x)).toBeLessThanOrEqual(3); expect(Math.abs(held.y - pointer.y)).toBeLessThanOrEqual(3);
  await expect.poll(() => percent(page)).toBeGreaterThan(300);
  await settled(page);
  expect(await page.evaluate(() => (window as unknown as { renders: number }).renders)).toBe(1);
  const final = await onScreen(page, fraction);
  expect(Math.abs(final.x - pointer.x)).toBeLessThanOrEqual(3); expect(Math.abs(final.y - pointer.y)).toBeLessThanOrEqual(3);
  // The panel never refits on its own afterwards.
  await page.waitForTimeout(450);
  expect(await page.evaluate(() => (window as unknown as { renders: number }).renders)).toBe(1);
  expect(errors).toEqual([]);
});

test('wheel zoom clamps to the range; plain wheel and Ctrl + wheel on reflowable text do not change zoom', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await openPdf(page);
  await actualSize(page);
  const sheet = await pageBox(page), x = sheet.x + sheet.width / 2, y = sheet.y + sheet.height / 2;
  await page.mouse.move(x, y);
  await page.keyboard.down('Control');
  for (let i = 0; i < 14; i++) await page.mouse.wheel(0, -100);
  await expect(level(page)).toHaveText('800%'); await settled(page);
  for (let i = 0; i < 20; i++) await page.mouse.wheel(0, 100);
  await expect(level(page)).toHaveText('10%'); await settled(page);
  await page.keyboard.up('Control');
  // A wheel without Ctrl scrolls as it always did.
  await page.keyboard.press('Control+0'); await fitOf(page, 'page');
  const fitted = await percent(page);
  await page.mouse.wheel(0, 200); await page.waitForTimeout(200);
  await fitOf(page, 'page'); expect(await percent(page)).toBe(fitted);

  // Markdown has no zoom: the wheel is claimed (the interface does not scale) and nothing else happens.
  await page.locator('#file-input').setInputFiles({ name: 'notes.md', mimeType: 'text/markdown', buffer: Buffer.from('# Notes\n\nPlain reflowing text.') });
  await expect(page.locator('#filename')).toHaveText('notes.md');
  const before = await page.evaluate(() => getComputedStyle(document.querySelector('.reader-host')!).fontSize);
  await page.keyboard.down('Control'); await page.mouse.wheel(0, -100); await page.keyboard.up('Control');
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('.reader-host')!).fontSize)).toBe(before);
  await expect(page.locator('#view-controls')).toBeHidden();
  expect(errors).toEqual([]);
});

test('a trackpad pinch (WebKit gesture events) zooms toward the pointer and settles on gestureend', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await openPdf(page);
  await actualSize(page);
  const sheet = await pageBox(page);
  const fraction = { x: .6, y: .6 }, pointer = { x: sheet.x + fraction.x * sheet.width, y: sheet.y + fraction.y * sheet.height };
  const prevented = await page.evaluate(async ({ x, y }) => {
    const host = document.querySelector('.pdf-reader') as HTMLElement, results: boolean[] = [];
    const send = (type: string, scale: number) => {
      const event = Object.assign(new Event(type, { bubbles: true, cancelable: true }), { scale, clientX: x, clientY: y });
      host.dispatchEvent(event); results.push(event.defaultPrevented);
    };
    send('gesturestart', 1);
    for (const scale of [1.2, 2, 3, 4, 4.5]) { send('gesturechange', scale); await new Promise(resolve => requestAnimationFrame(resolve)); }
    // A ctrl+wheel that a webview also sends for the same pinch must not zoom twice.
    host.dispatchEvent(new WheelEvent('wheel', { deltaY: -50, ctrlKey: true, clientX: x, clientY: y, bubbles: true, cancelable: true }));
    send('gestureend', 4.5);
    return results;
  }, pointer);
  expect(prevented.every(Boolean)).toBe(true);
  await expect(level(page)).toHaveText('450%'); // 100 % x the final pinch scale, committed at gestureend.
  await settled(page);
  const final = await onScreen(page, fraction);
  expect(Math.abs(final.x - pointer.x)).toBeLessThanOrEqual(3); expect(Math.abs(final.y - pointer.y)).toBeLessThanOrEqual(3);
  expect(errors).toEqual([]);
});

test('the hand tool and the saved zoom keep working after a gesture', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await openPdf(page);
  await actualSize(page);
  const host = page.locator('.pdf-reader'), hand = page.getByRole('button', { name: 'Hand tool' });
  const sheet = await pageBox(page);
  await page.mouse.move(sheet.x + sheet.width / 2, sheet.y + sheet.height / 2);
  await page.keyboard.down('Control');
  for (let i = 0; i < 3; i++) await page.mouse.wheel(0, -100);
  await page.keyboard.up('Control');
  await expect(level(page)).toHaveText(/^3[0-9]{2}%$/); await settled(page);
  const zoom = (await level(page).textContent())!;
  await host.focus(); await page.keyboard.press('h');
  await expect(hand).toHaveAttribute('aria-pressed', 'true');
  const scroll = () => host.evaluate(el => [el.scrollLeft, el.scrollTop]);
  const [left, top] = await scroll(), box = (await host.boundingBox())!;
  await page.mouse.move(box.x + 300, box.y + 300); await page.mouse.down();
  await page.mouse.move(box.x + 260, box.y + 240, { steps: 4 }); await page.mouse.up();
  expect(await scroll()).toEqual([left + 40, top + 60]);
  await expect(level(page)).toHaveText(zoom);
  // The zoom is part of the saved reading state, in the new form: a true scale, not a fit, with the marker that says so.
  await page.waitForTimeout(800);
  const saved = JSON.parse(await page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith('hold-my-brief:') && key.length > 40).map(([, value]) => value)[0]));
  expect(saved.options).toMatchObject({ fitted: false, zoom: Number(zoom.replace('%', '')) / 100, zoomModel: 2 });
  expect(errors).toEqual([]);
});

test('a two-page spread zooms to a true scale too', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await openPdf(page);
  await page.locator('#view-spread').click();
  await page.locator('.pdf-reader').focus(); await page.keyboard.press('PageDown');
  await expect(page.locator('#position')).toContainText('Pages 2–3 of 3');
  await expect(page.locator('.pdf-spread .pdf-page')).toHaveCount(2); await expect(page.locator('.pdf-render-status')).toHaveCount(0);
  await page.keyboard.press('Control+1'); await expect(level(page)).toHaveText('100%'); await fitOf(page, '');
  await expect(page.locator('.pdf-render-status')).toHaveCount(0);
  const spread = (await page.locator('.pdf-spread').boundingBox())!;
  expect(spread.width).toBeCloseTo(PAGE_WIDTH * 2, 0); expect(spread.height).toBeCloseTo(PAGE_HEIGHT, 0);
  await page.keyboard.press('Control+0'); await fitOf(page, 'page'); await expect(page.locator('.pdf-render-status')).toHaveCount(0);
  const fit = (await page.locator('.pdf-spread').boundingBox())!;
  expect(Math.abs((await percent(page)) - fit.height / PAGE_HEIGHT * 100)).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

/** A solid-colour PNG of exactly the requested size. */
function png(width: number, height: number) {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]), out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(crc32(body), body.length + 4); return out;
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const row = Buffer.alloc(1 + width * 3); for (let x = 0; x < width; x++) row.set([200, 90, 60], 1 + x * 3);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))), chunk('IEND', Buffer.alloc(0))]);
}

test('an image is 100 % at one image pixel per CSS pixel; Ctrl + wheel zooms it and leaves no transform behind', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width: 1080, height: 680 });
  await page.goto('/');
  await page.locator('#file-input').setInputFiles({ name: 'plate.png', mimeType: 'image/png', buffer: png(600, 400) });
  await expect(page.locator('#filename')).toHaveText('plate.png');
  await expect(page.locator('#view-controls')).toBeVisible();
  await fitOf(page, 'page');
  const img = page.locator('.image-frame img');
  // A fit shows the scale it came to, and keeps following the window.
  const fitBox = (await img.boundingBox())!;
  expect(Math.abs((await percent(page)) - fitBox.width / 600 * 100)).toBeLessThanOrEqual(1);
  await page.setViewportSize({ width: 1080, height: 400 });
  await expect.poll(async () => (await img.boundingBox())!.width).toBeLessThan(fitBox.width - 20);
  expect(Math.abs((await percent(page)) - (await img.boundingBox())!.width / 600 * 100)).toBeLessThanOrEqual(1);
  await page.setViewportSize({ width: 1080, height: 680 });

  await page.locator('.image-reader').focus(); await page.keyboard.press('Control+1');
  await expect(level(page)).toHaveText('100%'); await fitOf(page, '');
  const before = (await img.boundingBox())!;
  expect(before.width).toBeCloseTo(600, 0); expect(before.height).toBeCloseTo(400, 0);
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.keyboard.down('Control');
  for (let i = 0; i < 2; i++) await page.mouse.wheel(0, -100);
  await page.keyboard.up('Control');
  await expect(level(page)).toHaveText(/^2[0-9]{2}%$/);
  await expect(page.locator('.image-reader')).not.toHaveClass(/zoom-preview/);
  expect(await page.locator('.image-frame').evaluate(el => el.style.transform)).toBe('');
  const after = (await img.boundingBox())!;
  expect(after.width).toBeCloseTo(600 * (await percent(page)) / 100, 0);
  expect(errors).toEqual([]);
});

test('pointer use of the menu leaves keyboard focus on the page; the keyboard path returns it to the button', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await openPdf(page);
  const host = page.locator('.pdf-reader'), position = page.locator('#position');
  await host.focus();
  // Mouse: a preset click, then a second press of the button, and a double-click, all leave the page focused and PageDown working.
  await openMenu(page); await item(page, '50%').click();
  await expect(level(page)).toHaveText('50%'); await expect(host).toBeFocused();
  await page.keyboard.press('PageDown'); await expect(position).toContainText('Page 2 of 3'); await settled(page);
  await openMenu(page); await level(page).click(); await expect(menu(page)).toBeHidden(); await expect(host).toBeFocused();
  await level(page).dblclick(); await fitOf(page, 'page'); await expect(host).toBeFocused();
  await page.keyboard.press('PageUp'); await expect(position).toContainText('Page 1 of 3');
  // Keyboard: opened from the button, a choice leaves focus on the button, as Escape and Tab do.
  await level(page).focus(); await page.keyboard.press('Enter'); await expect(field(page)).toBeFocused();
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await fitOf(page, ''); await expect(level(page)).toBeFocused();
  expect(errors).toEqual([]);
});

// --- Saved zoom from before zoom was a true scale -------------------------------------------------------------------------

/** Opens `buffer` at 1080 x 680 after writing `options` as the document's saved view, as an older build would have left it. */
async function openWithSaved(page: Page, buffer: Buffer, options: Record<string, unknown>, locator: Record<string, unknown> = { kind: 'pdf', page: 1, x: 0, y: 0 }) {
  await page.setViewportSize({ width: 1080, height: 680 });
  await page.goto('/');
  const id = createHash('sha256').update(buffer).digest('hex');
  await page.evaluate(([key, value]) => localStorage.setItem(key, value), [`hold-my-brief:${id}`, JSON.stringify({ locator, options })]);
  await openFile(page, buffer);
  return id;
}
const savedOptions = (page: Page, id: string) => page.evaluate(key => JSON.parse(localStorage.getItem(key)!).options, `hold-my-brief:${id}`);
const legacy = { fontSize: 18, lineHeight: 1.65, margin: 24, wrap: true, rotation: 0, spread: false, cover: true };

test('a zoom saved as a multiplier of the fit opens at the same size, once, and is saved in the new form', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  const buffer = pagedPdf(3);
  // What fit page drew, for this window, before any of it.
  await openPdf(page, buffer);
  const fitWidth = (await pageBox(page)).width, fitPercent = await percent(page);

  // The old build left { fit: 'page', zoom: 1.5 }: one and a half times the fit.
  let id = await openWithSaved(page, buffer, { ...legacy, fit: 'page', zoom: 1.5 });
  await fitOf(page, '');
  expect((await pageBox(page)).width).toBeCloseTo(fitWidth * 1.5, 0);
  expect(Math.abs((await percent(page)) - fitPercent * 1.5)).toBeLessThanOrEqual(1);
  // Saved again, in the new form, with its marker: a true scale, not converted a second time.
  await expect.poll(async () => (await savedOptions(page, id)).zoomModel).toBe(2);
  const converted = await savedOptions(page, id);
  expect(converted).toMatchObject({ fitted: false, fit: 'page' });
  expect(converted.zoom).toBeCloseTo(fitWidth * 1.5 / PAGE_WIDTH, 2);
  await page.reload();
  await openFile(page, buffer);
  expect((await pageBox(page)).width).toBeCloseTo(fitWidth * 1.5, 0);
  expect((await savedOptions(page, id)).zoom).toBeCloseTo(converted.zoom, 6);
  // A window of another size does not change a true scale (the old meaning would have).
  await page.setViewportSize({ width: 800, height: 600 }); await page.waitForTimeout(400); await settled(page);
  expect((await pageBox(page)).width).toBeCloseTo(fitWidth * 1.5, 0);

  // Fit width and a multiplier below 1.
  const wideWidth = await (async () => { await page.keyboard.press('Control+2'); await settled(page); await page.setViewportSize({ width: 1080, height: 680 }); await page.waitForTimeout(400); await settled(page); return (await pageBox(page)).width; })();
  id = await openWithSaved(page, buffer, { ...legacy, fit: 'width', zoom: .5 });
  await fitOf(page, '');
  expect((await pageBox(page)).width).toBeCloseTo(wideWidth * .5, 0);

  // A multiplier of 1 was the fit itself, so it stays a fit, which follows the window; either fit.
  id = await openWithSaved(page, buffer, { ...legacy, fit: 'width', zoom: 1 });
  await fitOf(page, 'width');
  expect((await pageBox(page)).width).toBeCloseTo(wideWidth, 0);
  await expect.poll(async () => (await savedOptions(page, id)).zoomModel).toBe(2);
  expect(await savedOptions(page, id)).toMatchObject({ fitted: true, fit: 'width' });
  id = await openWithSaved(page, buffer, { ...legacy, fit: 'page', zoom: 1 });
  await fitOf(page, 'page');
  expect((await pageBox(page)).width).toBeCloseTo(fitWidth, 0);
  // Options saved without any view at all open fitted too.
  await openWithSaved(page, buffer, { fontSize: 18 });
  await fitOf(page, 'page');
  expect(errors).toEqual([]);
});

test('options already in the new form are not converted', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  const buffer = pagedPdf(3);
  const id = await openWithSaved(page, buffer, { ...legacy, fit: 'page', fitted: false, zoom: 1.5, zoomModel: 2 });
  await fitOf(page, ''); await expect(level(page)).toHaveText('150%');
  expect((await pageBox(page)).width).toBeCloseTo(PAGE_WIDTH * 1.5, 0); // 150 % of the page, not of a fit.
  await page.waitForTimeout(800);
  expect(await savedOptions(page, id)).toMatchObject({ fitted: false, zoom: 1.5, zoomModel: 2 });
  expect(errors).toEqual([]);
});

// --- Limits ---------------------------------------------------------------------------------------------------------------------

/** A one-page PDF of `width` x `height` points with a solid fill, so a painted canvas can be told from a blank one. */
function sheetPdf(width: number, height: number) {
  const stream = (text: string) => `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Contents 4 0 R >>`,
    stream(`0.2 0.5 0.9 rg 0 0 ${width} ${height} re f`),
  ];
  let out = '%PDF-1.7\n'; const offsets: number[] = [];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out);
}
/** The canvas backing store's size, and whether its middle pixel is painted. */
const canvasState = (page: Page) => page.evaluate(() => {
  const canvas = document.querySelector('.pdf-page canvas') as HTMLCanvasElement;
  const pixel = canvas.getContext('2d')!.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data;
  return { width: canvas.width, height: canvas.height, painted: pixel[3] === 255 && pixel[2] > pixel[0] };
});

test('800 % of an ordinary page draws within the canvas budget: pixels capped, never a blank or failed canvas', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await openPdf(page, sheetPdf(612, 792));
  await page.locator('.pdf-reader').focus(); await page.keyboard.press('Control+1');
  await openMenu(page); await field(page).fill('800'); await page.keyboard.press('Enter');
  await expect(level(page)).toHaveText('800%'); await settled(page);
  const box = await pageBox(page);
  expect(box.width).toBeCloseTo(612 * 96 / 72 * 8, 0); // 6 528 x 8 448 CSS px.
  const canvas = await canvasState(page);
  expect(canvas.width * canvas.height).toBeLessThanOrEqual(16_000_000 * 1.02); // The renderer's pixel budget: past about 430 % a Letter page is drawn at fewer device pixels than it is shown at.
  expect(Math.max(canvas.width, canvas.height)).toBeLessThanOrEqual(16_384);   // And the side every webview's canvas allows.
  expect(canvas.painted).toBe(true);
  expect(errors).toEqual([]);
});

test('a very large sheet stops at the zoom its size allows, and still draws', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await openPdf(page, sheetPdf(3370, 4768)); // A0, at 100 % 4 493 x 6 357 CSS px.
  await page.locator('.pdf-reader').focus(); await page.keyboard.press('Control+1');
  const zoomIn = page.getByRole('button', { name: 'Zoom in' });
  await openMenu(page); await field(page).fill('800'); await page.keyboard.press('Enter');
  // 24 000 CSS px along the long side: 24 000 / (4768 x 96/72) = 377 %.
  await expect(level(page)).toHaveText('377%'); await settled(page);
  await expect(zoomIn).toBeDisabled();
  const box = await pageBox(page);
  expect(Math.max(box.width, box.height)).toBeLessThanOrEqual(24_001);
  const canvas = await canvasState(page);
  expect(canvas.width * canvas.height).toBeLessThanOrEqual(16_000_000 * 1.02);
  expect(canvas.painted).toBe(true);
  // Zooming in again goes nowhere; Ctrl + wheel stops there too.
  await page.keyboard.press('Control+Equal');
  const sheet = await pageBox(page);
  await page.mouse.move(Math.max(sheet.x, 300), Math.max(sheet.y, 300));
  await page.keyboard.down('Control'); await page.mouse.wheel(0, -100); await page.keyboard.up('Control');
  await page.waitForTimeout(400); await settled(page);
  await expect(level(page)).toHaveText('377%');
  expect(errors).toEqual([]);
});
