import { test, expect, type Page } from '@playwright/test';
import { pagedPdf } from './paged-pdf';

/** A three-page PDF open at 1080 x 680 with the library drawer closed, settled on page 1. */
async function openPdf(page: Page) {
  await page.setViewportSize({ width: 1080, height: 680 });
  await page.goto('/');
  await page.locator('#file-input').setInputFiles({ name: 'zoom.pdf', mimeType: 'application/pdf', buffer: pagedPdf(3) });
  await expect(page.locator('#position')).toContainText('Page 1 of 3');
  await expect(page.locator('#loading')).toBeHidden();
  await expect(page.locator('#view-controls')).toBeVisible();
  if (await page.locator('#library-root').isVisible()) await page.locator('#library-toggle').click();
  await expect(page.locator('#library-root')).toBeHidden();
  await settled(page);
}
const level = (page: Page) => page.locator('#zoom-level');
/** No render in flight and no gesture preview on the page. */
async function settled(page: Page) {
  await expect(page.locator('.pdf-render-status')).toHaveCount(0);
  await expect(page.locator('.pdf-reader')).not.toHaveClass(/zoom-preview/);
  await expect(page.locator('.pdf-page')).toHaveCount(1);
}
const menu = (page: Page) => page.getByRole('menu', { name: 'Zoom' });
const field = (page: Page) => page.getByRole('textbox', { name: 'Zoom percentage' });
const item = (page: Page, name: string) => page.getByRole('menuitem', { name, exact: false });
async function openMenu(page: Page) {
  await level(page).click();
  await expect(menu(page)).toBeVisible();
  await expect(field(page)).toBeFocused();
}

test('the zoom level is a menu button: field, zoom and fit commands with their keys, then presets', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await openPdf(page);
  await expect(level(page)).toHaveAttribute('aria-haspopup', 'menu');
  await expect(level(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(level(page)).toHaveText('Fit');
  await openMenu(page);
  await expect(level(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(field(page)).toHaveValue('100%');
  const entries = menu(page).getByRole('menuitem');
  await expect(entries).toHaveText(['Zoom inCtrl +', 'Zoom outCtrl −', 'Fit pageCtrl 0', 'Fit widthCtrl 2', '50%', '100%', '200%']);
  // The menu opens above the pill, which sits at the bottom of the panel, and inside the window.
  const pill = (await page.locator('#view-controls').boundingBox())!, box = (await page.locator('#zoom-menu').boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(pill.y);
  expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(1080);
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

  // Choosing an entry closes it too.
  await openMenu(page);
  await item(page, 'Zoom in').click(); await closed(); await expect(level(page)).toHaveText('110%'); await expect(level(page)).toBeFocused();
  expect(errors).toEqual([]);
});

test('typing a percentage applies on Enter, reverts when invalid and clamps to the range', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await openPdf(page);
  const typed = async (text: string) => { await field(page).fill(text); await page.keyboard.press('Enter'); };

  await page.locator('.pdf-reader').focus();
  await openMenu(page); await typed('135');
  await expect(menu(page)).toBeHidden(); await expect(level(page)).toHaveText('135%'); await expect(page.locator('.pdf-reader')).toBeFocused(); // Opened with the pointer: the page keeps focus.
  await settled(page);
  const natural = (await page.locator('.pdf-page').boundingBox())!;

  // The field shows the current level when reopened; garbage reverts it, leaves the menu open and changes nothing.
  await openMenu(page); await expect(field(page)).toHaveValue('135%');
  await typed('abc'); await expect(menu(page)).toBeVisible(); await expect(field(page)).toHaveValue('135%'); await expect(level(page)).toHaveText('135%');
  await typed('-5'); await expect(field(page)).toHaveValue('135%');
  await typed(''); await expect(field(page)).toHaveValue('135%');
  expect((await page.locator('.pdf-page').boundingBox())!.width).toBeCloseTo(natural.width, 0);

  // Out of range clamps; a trailing percent sign is fine.
  await typed('900'); await expect(menu(page)).toBeHidden(); await expect(level(page)).toHaveText('400%'); await settled(page);
  await openMenu(page); await typed('3%'); await expect(level(page)).toHaveText('25%'); await settled(page);
  await openMenu(page); await typed(' 70 % '); await expect(level(page)).toHaveText('70%'); await settled(page);

  // Escape abandons what was typed.
  await openMenu(page); await field(page).fill('250'); await page.keyboard.press('Escape');
  await expect(menu(page)).toBeHidden(); await expect(level(page)).toHaveText('70%');
  await openMenu(page); await expect(field(page)).toHaveValue('70%');
  expect(errors).toEqual([]);
});

test('menu entries zoom in and out along the ladder, apply the presets and switch fit', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await openPdf(page);
  const choose = async (name: string, shown: string) => { await openMenu(page); await item(page, name).click(); await expect(level(page)).toHaveText(shown); await settled(page); };
  const width = async () => (await page.locator('.pdf-page').boundingBox())!.width;
  const fitWidth = await width();

  await choose('50%', '50%'); expect(await width()).toBeCloseTo(fitWidth / 2, 0);
  await choose('200%', '200%'); expect(await width()).toBeCloseTo(fitWidth * 2, 0);
  await choose('100%', 'Fit'); expect(await width()).toBeCloseTo(fitWidth, 0);
  await choose('Zoom in', '110%'); await choose('Zoom in', '125%'); await choose('Zoom out', '110%');
  await choose('Fit width', 'Width');
  await expect(level(page)).toHaveAttribute('title', /Fit width/);
  await choose('Fit page', 'Fit');
  // The 100% preset keeps the current fit: after fit width it is the width fit, not the page fit.
  await choose('Fit width', 'Width'); await choose('50%', '50%'); await choose('100%', 'Width');
  // At the ends of the ladder the menu entry is disabled like the pill's button.
  await choose('200%', '200%');
  await openMenu(page); await field(page).fill('400'); await page.keyboard.press('Enter'); await expect(level(page)).toHaveText('400%'); await settled(page);
  await openMenu(page); await expect(item(page, 'Zoom in')).toBeDisabled(); await expect(item(page, 'Zoom out')).toBeEnabled(); await page.keyboard.press('Escape');
  // Double-clicking the level still toggles fit page / fit width.
  await level(page).dblclick(); await expect(level(page)).toHaveText('Width'); await settled(page);
  await level(page).dblclick(); await expect(level(page)).toHaveText('Fit'); await settled(page);
  await expect(menu(page)).toBeHidden();
  expect(errors).toEqual([]);
});

test('buttons and shortcuts step along the ladder and stop at its ends', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await openPdf(page);
  const up = ['110%', '125%', '150%', '175%', '200%', '250%', '300%', '400%'];
  const zoomIn = page.getByRole('button', { name: 'Zoom in' }), zoomOut = page.getByRole('button', { name: 'Zoom out' });
  await page.locator('.pdf-reader').focus();
  for (const [index, expected] of up.entries()) {
    // The button and both keys of the shortcut share one state.
    if (index % 2 === 0) await zoomIn.click(); else await page.keyboard.press('Control+Equal');
    await expect(level(page)).toHaveText(expected);
  }
  await settled(page);
  await expect(zoomIn).toBeDisabled(); await expect(zoomOut).toBeEnabled();
  await page.keyboard.press('Control+Equal'); await expect(level(page)).toHaveText('400%');
  for (const expected of [...up.slice(0, -1).reverse(), 'Fit', '90%', '75%', '67%', '50%', '33%', '25%']) {
    if (expected === '175%' || expected === '90%') await zoomOut.click(); else await page.keyboard.press('Control+Minus');
    await expect(level(page)).toHaveText(expected);
  }
  await settled(page);
  await expect(zoomOut).toBeDisabled(); await expect(zoomIn).toBeEnabled();
  await page.keyboard.press('Control+Minus'); await expect(level(page)).toHaveText('25%');
  // From between rungs the next step snaps to the neighbouring rung.
  await openMenu(page); await field(page).fill('135'); await page.keyboard.press('Enter'); await expect(level(page)).toHaveText('135%');
  await zoomIn.click(); await expect(level(page)).toHaveText('150%');
  await openMenu(page); await field(page).fill('135'); await page.keyboard.press('Enter'); await expect(level(page)).toHaveText('135%');
  await zoomOut.click(); await expect(level(page)).toHaveText('125%');
  expect(errors).toEqual([]);
});

/** Where the point `at` of the page, given as a fraction of it, is on screen now. */
async function onScreen(page: Page, fraction: { x: number; y: number }) {
  const box = (await page.locator('.pdf-page').boundingBox())!;
  return { x: box.x + fraction.x * box.width, y: box.y + fraction.y * box.height };
}

test('Ctrl + wheel zooms toward the pointer: the page point under it stays under it, then renders crisply', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await openPdf(page);
  const sheet = (await page.locator('.pdf-page').boundingBox())!;
  const fraction = { x: .6, y: .4 }, pointer = { x: sheet.x + fraction.x * sheet.width, y: sheet.y + fraction.y * sheet.height };
  const near = (actual: { x: number; y: number }, note: string) => { expect(Math.abs(actual.x - pointer.x), `${note}: x ${actual.x} vs ${pointer.x}`).toBeLessThanOrEqual(3); expect(Math.abs(actual.y - pointer.y), `${note}: y ${actual.y} vs ${pointer.y}`).toBeLessThanOrEqual(3); };
  // Whether the webview would zoom the whole interface: nothing may leave the capture phase unprevented.
  await page.evaluate(() => { (window as unknown as { unprevented: number }).unprevented = 0; addEventListener('wheel', event => { if (!event.defaultPrevented) (window as unknown as { unprevented: number }).unprevented++; }); });
  const canvas = await page.locator('.pdf-page canvas').elementHandle();

  await page.mouse.move(pointer.x, pointer.y);
  await page.keyboard.down('Control');
  for (let i = 0; i < 3; i++) await page.mouse.wheel(0, -100);
  await page.keyboard.up('Control');
  // The level follows the gesture: three notches is 1.49^3, about 332%.
  await expect(level(page)).toHaveText(/^3[0-9]{2}%$/);
  await settled(page);
  expect(await page.evaluate(canvas => document.querySelector('.pdf-page canvas') !== canvas, canvas)).toBe(true); // A fresh render, not the scaled bitmap.
  near(await onScreen(page, fraction), 'after zooming in');
  expect(await page.evaluate(() => (window as unknown as { unprevented: number }).unprevented)).toBe(0);
  // The page is as large as the level says: width scaled by the same factor, at the crisp size.
  const zoomed = (await page.locator('.pdf-page').boundingBox())!, percent = Number((await level(page).textContent())!.replace('%', ''));
  expect(zoomed.width / sheet.width).toBeCloseTo(percent / 100, 1);

  // Out again, partway: the same point stays put.
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, 20); // A light touch (about 0.82x): the page still overflows sideways, so the point can be held.
  await page.keyboard.up('Control');
  await expect(level(page)).toHaveText(/^2[0-9]{2}%$/);
  await settled(page);
  near(await onScreen(page, fraction), 'after zooming out');
  expect(errors).toEqual([]);
});

test('during a wheel gesture the page is only scaled about the pointer; one render follows when it settles', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await openPdf(page);
  const sheet = (await page.locator('.pdf-page').boundingBox())!;
  const fraction = { x: .7, y: .25 }, pointer = { x: sheet.x + fraction.x * sheet.width, y: sheet.y + fraction.y * sheet.height };
  await page.evaluate(() => {
    const host = document.querySelector('.pdf-reader')!, w = window as unknown as { renders: number; surfaces: Element[] };
    w.renders = 0; w.surfaces = [];
    new MutationObserver(records => { for (const record of records) for (const node of record.addedNodes) if (node instanceof HTMLElement && node.classList.contains('pdf-page')) w.renders++; }).observe(host, { childList: true });
  });
  // Ten events in one turn are one gesture, painted once per frame.
  const measured = await page.evaluate(async ({ x, y }) => {
    const host = document.querySelector('.pdf-reader') as HTMLElement, sheet = host.querySelector('.pdf-page') as HTMLElement;
    for (let i = 0; i < 10; i++) host.dispatchEvent(new WheelEvent('wheel', { deltaY: -12, ctrlKey: true, clientX: x, clientY: y, bubbles: true, cancelable: true }));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const box = sheet.getBoundingClientRect();
    return { preview: host.classList.contains('zoom-preview'), same: host.querySelector('.pdf-page') === sheet, left: box.left, top: box.top, width: box.width, height: box.height, layout: sheet.offsetWidth, renders: (window as unknown as { renders: number }).renders };
  }, pointer);
  expect(measured.preview).toBe(true);
  expect(measured.same).toBe(true); expect(measured.renders).toBe(0); // Nothing re-rendered yet.
  expect(measured.width / measured.layout).toBeGreaterThan(1.5); // Scaled by transform alone.
  const held = { x: measured.left + fraction.x * measured.width, y: measured.top + fraction.y * measured.height };
  expect(Math.abs(held.x - pointer.x)).toBeLessThanOrEqual(3); expect(Math.abs(held.y - pointer.y)).toBeLessThanOrEqual(3);
  await expect(level(page)).not.toHaveText('Fit');
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
  const sheet = (await page.locator('.pdf-page').boundingBox())!, x = sheet.x + sheet.width / 2, y = sheet.y + sheet.height / 2;
  await page.mouse.move(x, y);
  await page.keyboard.down('Control');
  for (let i = 0; i < 14; i++) await page.mouse.wheel(0, -100);
  await expect(level(page)).toHaveText('400%'); await settled(page);
  for (let i = 0; i < 20; i++) await page.mouse.wheel(0, 100);
  await expect(level(page)).toHaveText('25%'); await settled(page);
  await page.keyboard.up('Control');
  // A wheel without Ctrl scrolls as it always did.
  await page.keyboard.press('Control+0'); await expect(level(page)).toHaveText('Fit');
  await page.mouse.wheel(0, 200); await page.waitForTimeout(200);
  await expect(level(page)).toHaveText('Fit');

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
  const sheet = (await page.locator('.pdf-page').boundingBox())!;
  const fraction = { x: .6, y: .6 }, pointer = { x: sheet.x + fraction.x * sheet.width, y: sheet.y + fraction.y * sheet.height };
  const prevented = await page.evaluate(async ({ x, y }) => {
    const host = document.querySelector('.pdf-reader') as HTMLElement, results: boolean[] = [];
    const send = (type: string, scale: number) => {
      const event = Object.assign(new Event(type, { bubbles: true, cancelable: true }), { scale, clientX: x, clientY: y });
      host.dispatchEvent(event); results.push(event.defaultPrevented);
    };
    send('gesturestart', 1);
    for (const scale of [1.1, 1.3, 1.7, 2.2, 2.6]) { send('gesturechange', scale); await new Promise(resolve => requestAnimationFrame(resolve)); }
    // A ctrl+wheel that a webview also sends for the same pinch must not zoom twice.
    host.dispatchEvent(new WheelEvent('wheel', { deltaY: -50, ctrlKey: true, clientX: x, clientY: y, bubbles: true, cancelable: true }));
    send('gestureend', 2.6);
    return results;
  }, pointer);
  expect(prevented.every(Boolean)).toBe(true);
  await expect(level(page)).toHaveText('260%'); // 100 % x the final pinch scale, committed at gestureend.
  await settled(page);
  const final = await onScreen(page, fraction);
  expect(Math.abs(final.x - pointer.x)).toBeLessThanOrEqual(3); expect(Math.abs(final.y - pointer.y)).toBeLessThanOrEqual(3);
  expect(errors).toEqual([]);
});

test('the hand tool and the saved zoom keep working after a gesture', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await openPdf(page);
  const host = page.locator('.pdf-reader'), hand = page.getByRole('button', { name: 'Hand tool' });
  const sheet = (await page.locator('.pdf-page').boundingBox())!;
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
  // The zoom is part of the saved reading state: it is in the position the reader reports for saving.
  await page.waitForTimeout(800);
  const saved = await page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith('hold-my-brief:')).map(([, value]) => value).join('\n'));
  expect(saved).toContain(`"zoom":${Number(zoom.replace('%', '')) / 100}`);
  expect(errors).toEqual([]);
});

test('Ctrl + wheel zooms an image too, and leaves no transform behind', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width: 1080, height: 680 });
  await page.goto('/');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await page.locator('#file-input').setInputFiles({ name: 'dot.png', mimeType: 'image/png', buffer: png });
  await expect(page.locator('#filename')).toHaveText('dot.png');
  await expect(page.locator('#view-controls')).toBeVisible();
  const before = (await page.locator('.image-frame img').boundingBox())!;
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.keyboard.down('Control');
  for (let i = 0; i < 2; i++) await page.mouse.wheel(0, -100);
  await page.keyboard.up('Control');
  await expect(level(page)).toHaveText(/^2[0-9]{2}%$/);
  await expect(page.locator('.image-reader')).not.toHaveClass(/zoom-preview/);
  expect(await page.locator('.image-frame').evaluate(el => el.style.transform)).toBe('');
  const after = (await page.locator('.image-frame img').boundingBox())!;
  expect(after.width / before.width).toBeCloseTo(Number((await level(page).textContent())!.replace('%', '')) / 100, 1);
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
  await level(page).dblclick(); await expect(level(page)).toHaveText('Fit'); await expect(host).toBeFocused();
  await page.keyboard.press('PageUp'); await expect(position).toContainText('Page 1 of 3');
  // Keyboard: opened from the button, a choice leaves focus on the button, as Escape and Tab do.
  await level(page).focus(); await page.keyboard.press('Enter'); await expect(field(page)).toBeFocused();
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await expect(level(page)).toHaveText('110%'); await expect(level(page)).toBeFocused();
  expect(errors).toEqual([]);
});
