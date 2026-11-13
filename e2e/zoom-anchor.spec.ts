import { test, expect, type Page } from '@playwright/test';
import { crc32, deflateSync } from 'node:zlib';
import { pagedPdf } from './paged-pdf';

/**
 * A zoom must not snap the view to the page's centre or top. Discrete zooms (buttons, shortcuts, a typed percentage, the presets,
 * Actual size) hold the document point at the centre of the viewport, as in Figma; a wheel or pinch holds the point under the
 * pointer, and nothing moves when it settles; Fit width keeps the line at the top of the view. The scroll container's limits still
 * apply: against an edge the page stays against that edge, and a page that now fits an axis is centred on it by the layout.
 */

const HOST = '.pdf-reader';
type Layout = 'single' | 'spread' | 'image';
const hostOf = (layout: Layout) => layout === 'image' ? '.image-reader' : HOST;
const surfaceOf = (layout: Layout) => layout === 'spread' ? ':scope > .pdf-spread' : layout === 'image' ? ':scope > .image-frame' : ':scope > .pdf-page';
type Side = 'left' | 'right';

/** Opens a three-page PDF at 1080 x 680 with the library closed to its rail on `side`, settled; the spread starts at its first pair (pages 2-3). */
async function open(page: Page, layout: Layout, side: Side) {
  await page.setViewportSize({ width: 1080, height: 680 });
  await page.goto('/');
  await page.locator('#file-input').setInputFiles({ name: 'anchor.pdf', mimeType: 'application/pdf', buffer: pagedPdf(3) });
  await expect(page.locator('#position')).toContainText('Page 1 of');
  await expect(page.locator('#loading')).toBeHidden();
  await expect(page.locator('#view-controls')).toBeVisible();
  if (side === 'right') {
    if (!(await page.locator('#library-root').isVisible())) await page.keyboard.press('Control+b');
    await page.getByRole('button', { name: 'Move library to the right' }).click();
  }
  if (await page.locator('#library-root').isVisible()) await page.getByRole('button', { name: 'Close library', exact: true }).first().click();
  await expect(page.locator('#library-root')).toBeHidden();
  await expect(page.locator('#library-rail')).toHaveAttribute('data-library-side', side);
  if (layout === 'spread') {
    await page.locator('#view-spread').click();
    await page.locator(HOST).focus(); await page.keyboard.press('PageDown');
    await expect(page.locator('#position')).toContainText('Pages 2–3 of 3');
  }
  await settled(page, layout);
}
async function settled(page: Page, layout: Layout) {
  await expect(page.locator('.pdf-render-status')).toHaveCount(0);
  await expect(page.locator(hostOf(layout))).not.toHaveClass(/zoom-preview/);
  await expect(page.locator(layout === 'spread' ? '.pdf-spread' : layout === 'image' ? '.image-frame' : '.pdf-page')).toHaveCount(1);
}
const level = (page: Page) => page.locator('#zoom-level');
const field = (page: Page) => page.getByRole('textbox', { name: 'Zoom percentage' });
async function typeZoom(page: Page, percent: number) {
  await level(page).click();
  await expect(field(page)).toBeFocused();
  await field(page).fill(String(percent)); await page.keyboard.press('Enter');
  await expect(level(page)).toHaveText(`${percent}%`);
}
/** Zooms to `percent` by typing it, with the page drawn there. */
async function zoomTo(page: Page, layout: Layout, percent: number) {
  await typeZoom(page, percent); await settled(page, layout);
  await page.locator(hostOf(layout)).focus();
}

/** The view as the user sees it: where the page lies in the scroll content, how far it is scrolled, and the panel's size. */
type View = { ox: number; oy: number; w: number; h: number; sl: number; st: number; cw: number; ch: number; maxX: number; maxY: number };
const view = (page: Page, layout: Layout) => page.evaluate(({ host, surface }) => {
  const el = document.querySelector<HTMLElement>(host)!, box = el.querySelector<HTMLElement>(surface)!.getBoundingClientRect(), edge = el.getBoundingClientRect();
  return { ox: box.left - edge.left - el.clientLeft + el.scrollLeft, oy: box.top - edge.top - el.clientTop + el.scrollTop, w: box.width, h: box.height,
    sl: el.scrollLeft, st: el.scrollTop, cw: el.clientWidth, ch: el.clientHeight, maxX: el.scrollWidth - el.clientWidth, maxY: el.scrollHeight - el.clientHeight };
}, { host: hostOf(layout), surface: surfaceOf(layout) }) as Promise<View>;
/** Scrolls the host to a fraction of its scroll range on each axis and waits for the scroll to land. */
async function scrollTo(page: Page, layout: Layout, fx: number, fy: number) {
  await page.evaluate(({ host, fx, fy }) => { const el = document.querySelector<HTMLElement>(host)!; el.scrollTo((el.scrollWidth - el.clientWidth) * fx, (el.scrollHeight - el.clientHeight) * fy); }, { host: hostOf(layout), fx, fy });
  const now = await view(page, layout);
  expect(now.maxX, 'the page must overflow sideways for this to mean anything').toBeGreaterThan(40); expect(now.maxY).toBeGreaterThan(40);
}
const clamp = (value: number, high: number) => Math.max(0, Math.min(high, value));
/** The document point held by the viewport centre, as a fraction of the page box. */
const centreOf = (v: View) => ({ x: (v.sl + v.cw / 2 - v.ox) / v.w, y: (v.st + v.ch / 2 - v.oy) / v.h });

/**
 * The document point that was at the viewport centre is still there (within 2 px) on every axis where the scroll limits allow it;
 * where they do not, the page sits against that limit. On an axis the page now fits, it is centred and not scrolled.
 */
function expectHeld(before: View, after: View, note: string) {
  const held = centreOf(before);
  for (const axis of ['x', 'y'] as const) {
    const [size, origin, scroll, panel, max] = axis === 'x' ? [after.w, after.ox, after.sl, after.cw, after.maxX] : [after.h, after.oy, after.st, after.ch, after.maxY];
    const ideal = origin + held[axis] * size - panel / 2;
    if (max <= 1) { expect(scroll, `${note}: ${axis} fits, so it is not scrolled`).toBe(0); continue; }
    expect(Math.abs(scroll - clamp(ideal, max)), `${note}: ${axis} scroll ${scroll} vs held ${clamp(ideal, max).toFixed(1)} (ideal ${ideal.toFixed(1)}, max ${max})`).toBeLessThanOrEqual(2);
  }
}
/** The centre-held point is out of reach on neither axis, so a test that expects it held proves something. */
function expectReachable(before: View, after: View, note: string) {
  const held = centreOf(before);
  for (const [axis, size, origin, panel, max] of [['x', after.w, after.ox, after.cw, after.maxX], ['y', after.h, after.oy, after.ch, after.maxY]] as const) {
    const ideal = origin + held[axis] * size - panel / 2;
    if (max <= 1) continue; // Fits this axis: the layout centres it.
    expect(ideal, `${note}: ${axis} ideal ${ideal.toFixed(1)} must lie inside 0..${max}`).toBeGreaterThanOrEqual(-2); expect(ideal).toBeLessThanOrEqual(max + 2);
  }
}

/** `height` shortens the window so that the page still overflows at the target zoom (a page at 100 % is shorter than the usual panel). */
type Route = { name: string; from: number; to: number; at: [number, number]; run: (page: Page) => Promise<void>; reachable: boolean; height?: number };
const ROUTES: Route[] = [
  { name: 'the zoom in button', from: 300, to: 400, at: [1, 1], reachable: true, run: page => page.getByRole('button', { name: 'Zoom in' }).click() },
  { name: 'Ctrl +', from: 300, to: 400, at: [1, 1], reachable: true, run: page => page.keyboard.press('Control+Equal') },
  { name: 'a typed percentage', from: 300, to: 400, at: [1, 1], reachable: true, run: page => typeZoom(page, 400) },
  { name: 'the 200% preset', from: 400, to: 200, at: [.5, .5], reachable: true, run: async page => { await level(page).click(); await page.locator('#zoom-menu [role^="menuitem"]', { hasText: '200%' }).click(); } },
  { name: 'the zoom out button', from: 400, to: 300, at: [.5, .5], reachable: true, run: page => page.getByRole('button', { name: 'Zoom out' }).click() },
  // From the bottom-right corner back out to actual size the corner itself is held: the centre point cannot be, the scroll limit is in the way.
  { name: 'Actual size (Ctrl 1) from a corner', from: 300, to: 100, at: [1, 1], reachable: false, run: page => page.keyboard.press('Control+1') },
  { name: 'Actual size (Ctrl 1)', from: 300, to: 100, at: [.5, .5], reachable: true, height: 360, run: page => page.keyboard.press('Control+1') },
];
for (const layout of ['single', 'spread'] as const) for (const side of ['left', 'right'] as const) for (const route of ROUTES) {
  test(`${route.name} holds the viewport centre instead of snapping, ${layout} view, rail on the ${side}`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await open(page, layout, side);
    if (route.height) await page.setViewportSize({ width: 1080, height: route.height });
    await zoomTo(page, layout, route.from);
    await scrollTo(page, layout, route.at[0], route.at[1]);
    const before = await view(page, layout);
    await route.run(page);
    await expect(level(page)).toHaveText(`${route.to}%`); await settled(page, layout);
    const after = await view(page, layout);
    if (route.reachable) expectReachable(before, after, route.name);
    expectHeld(before, after, route.name);
    // Neither a late render nor the hand tool's bookkeeping moves it afterwards.
    await page.waitForTimeout(400);
    expectHeld(before, await view(page, layout), `${route.name}, after a pause`);
    expect(errors).toEqual([]);
  });
}

for (const layout of ['single', 'spread'] as const) for (const side of ['left', 'right'] as const) {
  test(`a zoom from Fit holds the viewport centre, ${layout} view, rail on the ${side}`, async ({ page }) => {
    await open(page, layout, side);
    await expect(level(page)).toHaveAttribute('data-fit', 'page');
    // At Fit page the whole page is in view, so the point at the viewport centre is the page's middle; zooming keeps it in the middle, not at the top.
    const fit = await view(page, layout), held = { x: (fit.cw / 2 - fit.ox) / fit.w, y: (fit.ch / 2 - fit.oy) / fit.h };
    await page.locator(HOST).focus(); await page.keyboard.press('Control+Equal');
    await expect(level(page)).toHaveAttribute('data-fit', ''); await settled(page, layout);
    const after = await view(page, layout);
    expect(after.maxY, 'zoomed past fit, the page overflows').toBeGreaterThan(1);
    expectHeld({ ...fit, sl: 0, st: 0 }, after, 'zoom in from fit');
    // The point at the centre is the page's own centre (give or take the page's margin), not its top.
    expect(Math.abs(held.y - .5)).toBeLessThan(.1);
    const centre = centreOf(after);
    expect(Math.abs(centre.y - held.y) * after.h).toBeLessThanOrEqual(2);
  });
}

for (const layout of ['single', 'spread'] as const) for (const side of ['left', 'right'] as const) {
  test(`Fit width keeps the line at the top of the view instead of jumping to the page top, ${layout} view, rail on the ${side}`, async ({ page }) => {
    await open(page, layout, side);
    await zoomTo(page, layout, 300);
    await scrollTo(page, layout, .5, .5);
    const before = await view(page, layout), top = (before.st - before.oy) / before.h;
    expect(before.st, 'scrolled well down the page').toBeGreaterThan(100);
    await page.keyboard.press('Control+2');
    await expect(level(page)).toHaveAttribute('data-fit', 'width'); await settled(page, layout);
    const after = await view(page, layout);
    expect(after.maxY, 'fit width of a tall page still scrolls vertically').toBeGreaterThan(40);
    // The line stays at the top of the view, unless the shorter scroll range of the fitted page stops short of it (a spread is wide, so short).
    const expected = clamp(after.oy + top * after.h, after.maxY);
    expect(Math.abs(after.st - expected), `top line ${top.toFixed(3)} of the page: scrolled ${after.st}, expected ${expected.toFixed(1)}`).toBeLessThanOrEqual(2);
    expect(after.st).toBeGreaterThan(40);
    // Fit page may centre: the whole page is shown, so nothing is scrolled.
    await page.keyboard.press('Control+0');
    await expect(level(page)).toHaveAttribute('data-fit', 'page'); await settled(page, layout);
    expect((await view(page, layout)).st).toBe(0);
  });
}

/** The fraction of the page under the client point (x, y), read from the page's box as it is drawn (a gesture preview included). */
const under = (page: Page, layout: Layout, x: number, y: number) => page.evaluate(({ surface, x, y }) => {
  const box = document.querySelector<HTMLElement>(`.pdf-reader > ${surface}`)!.getBoundingClientRect();
  return { fx: (x - box.left) / box.width, fy: (y - box.top) / box.height, w: box.width, h: box.height };
}, { surface: layout === 'spread' ? '.pdf-spread' : '.pdf-page', x, y });
/** The point under the pointer is still under it, within 2 px at the new size. */
function expectUnder(before: { fx: number; fy: number }, after: { fx: number; fy: number; w: number; h: number }, note: string) {
  expect(Math.abs(after.fx - before.fx) * after.w, `${note}: x`).toBeLessThanOrEqual(2);
  expect(Math.abs(after.fy - before.fy) * after.h, `${note}: y`).toBeLessThanOrEqual(2);
}

for (const layout of ['single', 'spread'] as const) for (const side of ['left', 'right'] as const) {
  test(`Ctrl + wheel and a pinch keep the point under the pointer, and nothing moves when they settle, ${layout} view, rail on the ${side}`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await open(page, layout, side);
    await zoomTo(page, layout, 300);
    await scrollTo(page, layout, .4, .4);
    const host = (await page.locator(HOST).boundingBox())!, pointer = { x: host.x + host.width * .4, y: host.y + host.height * .35 };
    let held = await under(page, layout, pointer.x, pointer.y);

    // Wheel: in, then out. The page shown while the gesture runs is the scaled old one; what the crisp render replaces it with must sit where it was.
    for (const notches of [-3, 2]) {
      await page.mouse.move(pointer.x, pointer.y);
      await page.keyboard.down('Control');
      for (let i = 0; i < Math.abs(notches); i++) await page.mouse.wheel(0, Math.sign(notches) * 100);
      await page.keyboard.up('Control');
      await expect(page.locator(HOST)).toHaveClass(/zoom-preview/);
      const preview = await under(page, layout, pointer.x, pointer.y);
      expectUnder(held, preview, `wheel ${notches}, while scaling`);
      await settled(page, layout);
      expectUnder(preview, await under(page, layout, pointer.x, pointer.y), `wheel ${notches}, on settling`);
      await page.waitForTimeout(300);
      expectUnder(held, await under(page, layout, pointer.x, pointer.y), `wheel ${notches}, after a pause`);
    }

    // Pinch (WebKit gesture events): the same, committed at gestureend.
    held = await under(page, layout, pointer.x, pointer.y);
    await page.evaluate(async ({ x, y, host }) => {
      const el = document.querySelector(host) as HTMLElement;
      const send = (type: string, scale: number) => el.dispatchEvent(Object.assign(new Event(type, { bubbles: true, cancelable: true }), { scale, clientX: x, clientY: y }));
      send('gesturestart', 1);
      for (const scale of [1.1, 1.3, 1.6]) { send('gesturechange', scale); await new Promise(resolve => requestAnimationFrame(resolve)); }
    }, { x: pointer.x, y: pointer.y, host: HOST });
    const preview = await under(page, layout, pointer.x, pointer.y);
    expectUnder(held, preview, 'pinch, while scaling');
    await page.evaluate(({ x, y, host }) => (document.querySelector(host) as HTMLElement).dispatchEvent(Object.assign(new Event('gestureend', { bubbles: true, cancelable: true }), { scale: 1.6, clientX: x, clientY: y })), { x: pointer.x, y: pointer.y, host: HOST });
    await settled(page, layout);
    expectUnder(preview, await under(page, layout, pointer.x, pointer.y), 'pinch, on settling');
    expect(errors).toEqual([]);
  });
}

/** A solid PNG of the given size. */
function png(width: number, height: number) {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]), out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(crc32(body), body.length + 4); return out;
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const row = Buffer.alloc(1 + width * 3, 90); row[0] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))), chunk('IEND', Buffer.alloc(0))]);
}

test('an image holds the viewport centre through a zoom too', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width: 1080, height: 680 });
  await page.goto('/');
  await page.locator('#file-input').setInputFiles({ name: 'plate.png', mimeType: 'image/png', buffer: png(600, 400) });
  await expect(page.locator('#filename')).toHaveText('plate.png');
  await expect(page.locator('#view-controls')).toBeVisible();
  await expect(level(page)).toHaveAttribute('data-fit', 'page');
  if (await page.locator('#library-root').isVisible()) await page.locator('#library-toggle').click();
  await typeZoom(page, 300); await settled(page, 'image'); await page.locator('.image-reader').focus(); // 1800 x 1200: past the panel both ways.
  await scrollTo(page, 'image', .8, .7);
  const before = await view(page, 'image');
  await page.keyboard.press('Control+Equal');
  await expect(level(page)).toHaveText('400%'); await settled(page, 'image');
  const after = await view(page, 'image');
  expectReachable(before, after, 'image zoom in'); expectHeld(before, after, 'image zoom in');
  await page.locator('#zoom-level').click();
  await page.locator('#zoom-menu [role^="menuitem"]', { hasText: '200%' }).click();
  await expect(level(page)).toHaveText('200%'); await settled(page, 'image');
  expectHeld(after, await view(page, 'image'), 'image zoom out');
  expect(errors).toEqual([]);
});
