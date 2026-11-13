import { test, expect, type Page } from '@playwright/test';
import { crc32, deflateSync } from 'node:zlib';
import { pagedPdf } from './paged-pdf';
import { libraryToggle } from './library-controls';

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
  if (side === 'right') await page.locator('#library-rail').getByRole('button', { name: 'Move library to the right' }).click();
  if (await page.locator('#library-root').isVisible()) await libraryToggle(page).click();
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
 * The document point that was at the viewport centre is still at the centre (within 2 px) on both axes: by scrolling where the page overflows
 * (unless it has come up against the end of its scroll range), and by sliding the page where it fits (the layout would centre it). The page's box
 * is where it is drawn, slid or not.
 */
function expectHeld(before: View, after: View, note: string) {
  const held = centreOf(before);
  for (const axis of ['x', 'y'] as const) {
    const [size, origin, scroll, panel, max] = axis === 'x' ? [after.w, after.ox, after.sl, after.cw, after.maxX] : [after.h, after.oy, after.st, after.ch, after.maxY];
    // Where the page overflows only the scroll range can hold it: the point out of reach of it is the page resting against its end.
    const wanted = origin + held[axis] * size - panel / 2;
    if (max > 1 && (wanted < -1 || wanted > max + 1)) { expect(scroll, `${note}: ${axis} rests against the end of the page`).toBeGreaterThanOrEqual(wanted < 0 ? 0 : max - 1); expect(scroll).toBeLessThanOrEqual(wanted < 0 ? 1 : max); continue; }
    const at = origin - scroll + held[axis] * size;
    expect(Math.abs(at - panel / 2), `${note}: ${axis} point drawn at ${at.toFixed(1)}, held at ${panel / 2}`).toBeLessThanOrEqual(2);
  }
}

/** `height` shortens the window so that the page still overflows at the target zoom (a page at 100 % is shorter than the usual panel). */
type Route = { name: string; from: number; to: number; at: [number, number]; run: (page: Page) => Promise<void>; height?: number };
const ROUTES: Route[] = [
  { name: 'the zoom in button', from: 300, to: 400, at: [1, 1], run: page => page.getByRole('button', { name: 'Zoom in' }).click() },
  { name: 'Ctrl +', from: 300, to: 400, at: [1, 1], run: page => page.keyboard.press('Control+Equal') },
  { name: 'a typed percentage', from: 300, to: 400, at: [1, 1], run: page => typeZoom(page, 400) },
  { name: 'the 200% preset', from: 400, to: 200, at: [.5, .5], run: async page => { await level(page).click(); await page.locator('#zoom-menu [role^="menuitem"]', { hasText: '200%' }).click(); } },
  { name: 'the zoom out button', from: 400, to: 300, at: [.5, .5], run: page => page.getByRole('button', { name: 'Zoom out' }).click() },
  // Back out to a page that fits, from the corner: the page is slid so that the point stays at the centre.
  { name: 'Actual size (Shift 0) from a corner', from: 300, to: 100, at: [1, 1], run: page => page.keyboard.press('Shift+Digit0') },
  { name: 'Actual size (Shift 0)', from: 300, to: 100, at: [.5, .5], height: 360, run: page => page.keyboard.press('Shift+Digit0') },
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

type Shown = { before: Under; scaling: Under; settled: Under; later: Under; after: View };
type Under = Awaited<ReturnType<typeof under>>;
/** What was under the pointer before a gesture, while the page was scaled, once it was crisp and half a second later, with the view then. */
async function observe(page: Page, layout: Layout, pointer: { x: number; y: number }, gesture: () => Promise<unknown>, finish?: () => Promise<unknown>): Promise<Shown> {
  const before = await under(page, layout, pointer.x, pointer.y);
  await gesture();
  await expect(page.locator(hostOf(layout))).toHaveClass(/zoom-preview/);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); // The scaled page is painted once per frame.
  const scaling = await under(page, layout, pointer.x, pointer.y);
  await finish?.();
  await settled(page, layout);
  const settledAt = await under(page, layout, pointer.x, pointer.y), after = await view(page, layout);
  await page.waitForTimeout(500);
  return { before, scaling, settled: settledAt, later: await under(page, layout, pointer.x, pointer.y), after };
}
/**
 * A Ctrl + wheel gesture at `pointer`: one wheel event per delta, all sent in one turn so that they are one gesture however slow the machine is
 * (notches sent one by one can arrive more than the 160 ms that ends a gesture apart; the second gesture then starts from the page the first one
 * committed, which is correct but not what these cases measure).
 */
const wheelAt = (page: Page, layout: Layout, pointer: { x: number; y: number }, deltas: number[]) => observe(page, layout, pointer, async () => {
  await page.mouse.move(pointer.x, pointer.y);
  await page.evaluate(({ x, y, deltas }) => {
    const target = document.elementFromPoint(x, y)!;
    for (const deltaY of deltas) target.dispatchEvent(new WheelEvent('wheel', { deltaY, ctrlKey: true, clientX: x, clientY: y, bubbles: true, cancelable: true }));
  }, { x: pointer.x, y: pointer.y, deltas });
});
/**
 * Nothing moves when the gesture settles: the crisp page is where the scaled one was (to the pixel, give or take the half percent the zoom is
 * rounded to), and it stays there. The pointer's document point stays under the pointer within 2 px on every axis where that can be: always
 * where the page fits (it is slid there), and where it overflows unless the page has come up against the end of its scroll range, where it
 * rests (scaled and crisp alike) instead of being dragged past its own end.
 */
function expectNoSnap(shown: Shown, note: string) {
  const { before, scaling, settled, later, after } = shown;
  for (const axis of ['x', 'y'] as const) {
    const f = axis === 'x' ? 'fx' : 'fy', size = axis === 'x' ? settled.w : settled.h, rounding = .005 * size + 1.5;
    expect(Math.abs(settled[f] - scaling[f]) * size, `${note}: ${axis} jumped when the page settled (scaling ${scaling[f].toFixed(4)}, settled ${settled[f].toFixed(4)}, size ${size.toFixed(0)})`).toBeLessThanOrEqual(rounding);
    expect(Math.abs(later[f] - settled[f]) * size, `${note}: ${axis} drifted after settling`).toBeLessThanOrEqual(1);
    const [scroll, max] = axis === 'x' ? [after.sl, after.maxX] : [after.st, after.maxY];
    // The scroll that would put the point back under the pointer: out of reach of the scroll range, the page rests against its end instead.
    const wanted = scroll + (before[f] - settled[f]) * size, unreachable = max > 1 && (wanted < -1 || wanted > max + 1);
    if (!unreachable) {
      expect(Math.abs(settled[f] - before[f]) * size, `${note}: ${axis} point is no longer under the pointer (before ${before[f].toFixed(3)}, settled ${settled[f].toFixed(3)}, size ${size.toFixed(0)}, scroll ${scroll}/${max})`).toBeLessThanOrEqual(rounding);
      expect(Math.abs(scaling[f] - before[f]) * size, `${note}: ${axis} point left the pointer while scaling`).toBeLessThanOrEqual(rounding);
    }
  }
}
/** The client point at a fraction of the page's box. */
const onPage = async (page: Page, layout: Layout, fx: number, fy: number) => {
  const box = (await page.locator(layout === 'spread' ? '.pdf-spread' : '.pdf-page').first().boundingBox())!;
  return { x: box.x + box.width * fx, y: box.y + box.height * fy };
};
const hostSize = (page: Page, layout: Layout) => page.locator(hostOf(layout)).evaluate(el => [el.clientWidth, el.clientHeight]);
const fitPage = async (page: Page, layout: Layout) => { await page.locator(hostOf(layout)).focus(); await page.keyboard.press('Control+0'); await expect(level(page)).toHaveAttribute('data-fit', 'page'); await settled(page, layout); };

const NOTCH = 100; // Each wheel event is one firm notch: x1.49 in, / 1.49 out.
type Case = { name: string; at: [number, number]; deltas: number[]; from?: number };
const GESTURES: Case[] = [
  { name: 'zoom out from Fit, near the top-left (the page fits on both axes)', at: [.15, .15], deltas: [NOTCH, NOTCH, NOTCH] },
  { name: 'zoom out from Fit, near the bottom-right', at: [.85, .85], deltas: [NOTCH, NOTCH] },
  { name: 'zoom in a little from 50 %, the page still fits on both axes', at: [.2, .8], deltas: [-15], from: 50 },
  { name: 'zoom in from Fit until it overflows on y only (mixed axes), near the right edge', at: [.9, .2], deltas: [-20] },
  { name: 'zoom in from Fit until it overflows on y only (mixed axes), near the left edge', at: [.1, .8], deltas: [-20] },
  ...([[.04, .5, 'left edge'], [.96, .5, 'right edge'], [.5, .04, 'top edge'], [.5, .96, 'bottom edge'], [.04, .04, 'top-left corner'], [.96, .04, 'top-right corner'], [.04, .96, 'bottom-left corner'], [.96, .96, 'bottom-right corner']] as const)
    .map(([fx, fy, where]): Case => ({ name: `zoom in from Fit to overflow on both axes, at the page's ${where}`, at: [fx, fy], deltas: [-40, -40, -40] })),
  { name: 'zoom out from 300 % to 200 %, at the panel corner', at: [.5, .5], deltas: [NOTCH], from: 300 },
];
for (const layout of ['single', 'spread'] as const) for (const side of ['left', 'right'] as const) {
  test(`Ctrl + wheel never snaps when the page settles, whether it fits, overflows or both: the pointer's point stays put, ${layout} view, rail on the ${side}`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await open(page, layout, side);
    const size = await hostSize(page, layout);
    for (const c of GESTURES) {
      if (c.from) { await typeZoom(page, c.from); await settled(page, layout); if (c.from >= 150) await scrollTo(page, layout, 1, 1); }
      else await fitPage(page, layout);
      const pointer = c.from && c.from >= 150
        ? await page.locator(hostOf(layout)).boundingBox().then(box => ({ x: box!.x + box!.width - 110, y: box!.y + box!.height - 60 }))
        : await onPage(page, layout, c.at[0], c.at[1]);
      expectNoSnap(await wheelAt(page, layout, pointer, c.deltas), c.name);
      expect(await hostSize(page, layout), `${c.name}: the panel keeps its size, so nothing refits`).toEqual(size);
      await page.locator(hostOf(layout)).focus();
    }
    expect(errors).toEqual([]);
  });
}

for (const layout of ['single', 'spread'] as const) {
  test(`a gesture on a page slid by the hand tool holds the pointer's point, and discrete zooms hold the viewport centre, ${layout} view`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await open(page, layout, 'left');
    await page.getByRole('button', { name: 'Hand tool' }).click();
    await expect(page.getByRole('button', { name: 'Hand tool' })).toHaveAttribute('aria-pressed', 'true');
    const slide = async (dx: number, dy: number) => {
      const box = (await page.locator(HOST).boundingBox())!, from = { x: box.x + box.width - 120, y: box.y + 60 };
      await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(from.x + dx, from.y + dy, { steps: 6 }); await page.mouse.up();
    };
    for (const [name, deltas, at] of [['zoom out', [NOTCH, NOTCH], [.3, .3]], ['zoom in to overflow', [-40, -40], [.9, .8]], ['zoom in, mixed axes', [-20], [.2, .2]]] as const) {
      await fitPage(page, layout);
      await slide(-70, 50);
      await expect(page.locator(HOST)).toHaveClass(/page-moved/);
      expectNoSnap(await wheelAt(page, layout, await onPage(page, layout, at[0], at[1]), [...deltas]), `${name} on a slid page`);
      await page.locator(HOST).focus();
    }
    // A discrete zoom keeps the point at the viewport centre, the slide included: the page does not go back to the middle.
    await fitPage(page, layout);
    await slide(-90, 60);
    const before = await view(page, layout);
    await page.keyboard.press('Control+Minus');
    await expect(level(page)).toHaveAttribute('data-fit', ''); await settled(page, layout);
    expectHeld(before, await view(page, layout), 'Ctrl − on a slid page');
    expect(errors).toEqual([]);
  });
}

test('a page that fits sideways but not vertically is slid sideways and still scrolls vertically; no panel resize', async ({ page }) => {
  await open(page, 'single', 'left');
  const size = await hostSize(page, 'single');
  const pointer = await onPage(page, 'single', .9, .2);
  expectNoSnap(await wheelAt(page, 'single', pointer, [-20]), 'mixed zoom');
  const host = page.locator(HOST);
  await expect(host).toHaveClass(/page-moved-x/); await expect(host).not.toHaveClass(/page-moved-y/);
  expect(await host.evaluate(el => [el.scrollWidth - el.clientWidth <= 1, el.scrollHeight - el.clientHeight > 1])).toEqual([true, true]);
  const top = await page.locator('.pdf-page').boundingBox(); const scrolled = await host.evaluate(el => el.scrollTop);
  await page.mouse.move(pointer.x, pointer.y); await page.mouse.wheel(0, 120); // A plain wheel scrolls the page up and down.
  await expect.poll(() => host.evaluate(el => el.scrollTop)).toBeGreaterThan(scrolled + 50);
  const moved = await page.locator('.pdf-page').boundingBox();
  expect(moved!.x).toBeCloseTo(top!.x, 1); // Sideways it stays where the zoom held it.
  expect(await hostSize(page, 'single')).toEqual(size);
});

test('the hand tool scrolls only the axis that is not slid: a drag on a page slid sideways moves it up and down, never sideways', async ({ page }) => {
  await open(page, 'single', 'left');
  // A zoom at the left of the page slides it to the right (positive offset) while it overflows vertically; its right edge now lies past the panel's,
  // so the host has sideways scroll range that only a script write could use.
  await wheelAt(page, 'single', await onPage(page, 'single', .1, .8), [-40, -20]);
  const host = page.locator(HOST);
  await expect(host).toHaveClass(/page-moved-x/); await expect(host).not.toHaveClass(/page-moved-y/);
  expect(await host.evaluate(el => el.style.getPropertyValue('--pan-x'))).toMatch(/^[1-9]/);
  expect(await host.evaluate(el => el.scrollWidth - el.clientWidth), 'a translated page widens the scroll range').toBeGreaterThan(1);
  await page.getByRole('button', { name: 'Hand tool' }).click();
  await expect(page.getByRole('button', { name: 'Hand tool' })).toHaveAttribute('aria-pressed', 'true');
  const before = (await page.locator('.pdf-page').boundingBox())!, top = await host.evaluate(el => el.scrollTop);
  // A script write to the hidden axis is undone by the next layout check, so the page would not stay moved: watch every scroll position the host takes.
  await page.evaluate(() => { const w = window as unknown as { seen: number[] }; w.seen = []; addEventListener('scroll', event => w.seen.push((event.target as HTMLElement).scrollLeft), true); });
  const panel = (await host.boundingBox())!, from = { x: panel.x + panel.width - 150, y: panel.y + panel.height - 80 };
  await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(from.x - 90, from.y + 60, { steps: 8 });
  // Mid-drag, the page is where it was sideways: a script write to the hidden axis would already have moved it by the sideways range.
  expect((await page.locator('.pdf-page').boundingBox())!.x, 'mid-drag: sideways').toBeCloseTo(before.x, 1);
  expect(await host.evaluate(el => el.scrollLeft), 'mid-drag: scrollLeft').toBe(0);
  await page.mouse.up();
  expect(await page.evaluate(() => (window as unknown as { seen: number[] }).seen.filter(left => left !== 0)), 'the host never scrolled sideways').toEqual([]);
  const after = (await page.locator('.pdf-page').boundingBox())!;
  expect(after.x, 'sideways it stays where the zoom held it').toBeCloseTo(before.x, 1);
  expect(await host.evaluate(el => el.scrollLeft)).toBe(0);
  expect(await host.evaluate(el => el.scrollTop), 'up and down it scrolls 1:1').toBeCloseTo(top - 60, 0);
  await page.waitForTimeout(300);
  expect((await page.locator('.pdf-page').boundingBox())!.x).toBeCloseTo(before.x, 1); // And nothing jumps back later.
});

test('a page slid at a true zoom is put back when the window shrinks until it overflows, and then scrolls', async ({ page }) => {
  await open(page, 'single', 'left');
  await wheelAt(page, 'single', await onPage(page, 'single', .15, .15), [NOTCH]); // About 76 %: 304 x 405 px, slid off-centre.
  const host = page.locator(HOST);
  await expect(host).toHaveClass(/page-moved/);
  await page.setViewportSize({ width: 300, height: 260 }); // The window is no wider than the page, nor as tall: it overflows both ways.
  await expect(host).not.toHaveClass(/page-moved/);
  await expect(host).not.toHaveClass(/page-moved-x/); await expect(host).not.toHaveClass(/page-moved-y/);
  await settled(page, 'single');
  expect(await host.evaluate(el => el.scrollHeight - el.clientHeight > 1 || el.scrollWidth - el.clientWidth > 1), 'the page overflows now').toBe(true);
  const top = await host.evaluate(el => el.scrollTop), box = (await host.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.wheel(0, 120);
  await expect.poll(() => host.evaluate(el => el.scrollTop)).toBeGreaterThan(top);
});

for (const layout of ['single', 'spread'] as const) {
  test(`a trackpad pinch (WebKit gesture events) never snaps either, from a fit and from overflow, ${layout} view`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await open(page, layout, 'left');
    // As WKWebView reports them: events with `scale`, `clientX` and `clientY`, sent to the element under the fingers.
    const pinch = (pointer: { x: number; y: number }, scales: number[]) => observe(page, layout, pointer, async () => {
      await page.evaluate(async ({ x, y, scales }) => {
        const target = document.elementFromPoint(x, y)!;
        const send = (type: string, scale: number) => {
          const event = new Event(type, { bubbles: true, cancelable: true });
          Object.defineProperty(event, 'scale', { value: scale }); Object.defineProperty(event, 'clientX', { value: x }); Object.defineProperty(event, 'clientY', { value: y });
          target.dispatchEvent(event);
        };
        send('gesturestart', 1);
        for (const scale of scales) { send('gesturechange', scale); await new Promise(resolve => requestAnimationFrame(resolve)); }
      }, { x: pointer.x, y: pointer.y, scales });
    }, () => page.evaluate(({ x, y, scale }) => { // The page stays scaled until the fingers lift: the test looks at it, then lifts them.
      const event = new Event('gestureend', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'scale', { value: scale }); Object.defineProperty(event, 'clientX', { value: x }); Object.defineProperty(event, 'clientY', { value: y });
      document.elementFromPoint(x, y)!.dispatchEvent(event);
    }, { x: pointer.x, y: pointer.y, scale: scales.at(-1)! }));
    await fitPage(page, layout);
    expectNoSnap(await pinch(await onPage(page, layout, .15, .15), [.8, .5, .3]), 'pinch out from Fit near the top-left');
    await fitPage(page, layout);
    expectNoSnap(await pinch(await onPage(page, layout, .95, .5), [1.2, 2, 3.2]), 'pinch in from Fit near the right edge');
    await fitPage(page, layout);
    expectNoSnap(await pinch(await onPage(page, layout, .5, .96), [1.1, 1.3]), 'pinch in a little (mixed axes) near the bottom edge');
    expect(errors).toEqual([]);
  });
}

/** Lets the page present `count` frames: the view-state sync that follows an input is scheduled on animation frames, so a check made before they pass can miss a move. */
const afterFrames = (page: Page, count: number) => page.evaluate(count => new Promise<void>(resolve => { const next = (left: number) => left ? requestAnimationFrame(() => next(left - 1)) : resolve(); next(count); }), count);

for (const layout of ['single', 'spread'] as const) {
  test(`pressing or releasing Control or Shift, and Shift + wheel, never move or recentre the page, ${layout} view`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await open(page, layout, 'left');
    const box = () => page.locator(layout === 'spread' ? '.pdf-spread' : '.pdf-page').first().boundingBox();
    const scroll = () => page.locator(hostOf(layout)).evaluate(el => [el.scrollLeft, el.scrollTop]);
    const unmoved = async (note: string, state: [typeof before, number[]]) => {
      const now = await box(); expect(now!.x, `${note}: x`).toBeCloseTo(state[0]!.x, 1); expect(now!.y, `${note}: y`).toBeCloseTo(state[0]!.y, 1); expect(await scroll(), `${note}: scroll`).toEqual(state[1]);
    };
    const before = await box();
    const keys = async (note: string) => {
      const state: [typeof before, number[]] = [await box(), await scroll()];
      for (const key of ['Control', 'Shift', 'Alt']) { await page.keyboard.down(key); await afterFrames(page, 5); await unmoved(`${note}: ${key} down`, state); await page.keyboard.up(key); await afterFrames(page, 5); await unmoved(`${note}: ${key} up`, state); }
      await page.keyboard.down('Control'); await page.keyboard.down('Shift'); await afterFrames(page, 10); await page.keyboard.up('Shift'); await page.keyboard.up('Control'); await afterFrames(page, 10);
      await unmoved(`${note}: Control and Shift together`, state);
      return state;
    };
    // At Fit, after zooming out with the wheel (the page fits and may be slid), and after zooming in to overflow.
    await fitPage(page, layout);
    const pointer = await onPage(page, layout, .5, .5);
    await page.mouse.move(pointer.x, pointer.y);
    await keys('at Fit');
    let state: [typeof before, number[]] = [await box(), await scroll()];
    await page.keyboard.down('Shift'); await page.mouse.wheel(0, 120); await page.keyboard.up('Shift'); await afterFrames(page, 20);
    await unmoved('Shift + wheel at Fit (nothing to scroll)', state);

    expectNoSnap(await wheelAt(page, layout, await onPage(page, layout, .2, .2), [NOTCH, NOTCH]), 'zoom out');
    await page.mouse.move((await onPage(page, layout, .5, .5)).x, (await onPage(page, layout, .5, .5)).y);
    state = await keys('after zooming out');
    await page.keyboard.down('Shift'); await page.mouse.wheel(0, 120); await page.keyboard.up('Shift'); await afterFrames(page, 20);
    await unmoved('Shift + wheel on a slid page that fits', state);

    await fitPage(page, layout);
    expectNoSnap(await wheelAt(page, layout, await onPage(page, layout, .9, .5), [-40, -40, -40]), 'zoom in');
    await page.mouse.move(pointer.x, pointer.y);
    state = await keys('after zooming in');
    // Shift + wheel scrolls (sideways on Windows, vertically on a Mac): the page moves by exactly what it scrolled, and is never recentred.
    const [left, top] = await scroll(), natural = await box();
    // Upwards, so that a page resting against the far end (a zoom at its right edge does) can still scroll that way.
    await page.keyboard.down('Shift'); await page.mouse.wheel(0, -120); await page.keyboard.up('Shift');
    // The wheel's scroll is eased by the engine: read it once it has moved and stopped.
    let seen = ''; await expect.poll(async () => { const now = JSON.stringify(await scroll()); const stopped = now !== JSON.stringify([left, top]) && now === seen; seen = now; return stopped; }, { message: 'the wheel scrolled the page, and it has stopped' }).toBe(true);
    const [leftNow, topNow] = await scroll(), now = await box();
    expect(Math.abs(leftNow - left) + Math.abs(topNow - top), 'the wheel scrolled the page').toBeGreaterThan(20);
    expect(now!.x - natural!.x).toBeCloseTo(-(leftNow - left), 1); expect(now!.y - natural!.y).toBeCloseTo(-(topNow - top), 1);
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
  if (await page.locator('#library-root').isVisible()) await libraryToggle(page).click();
  await typeZoom(page, 300); await settled(page, 'image'); await page.locator('.image-reader').focus(); // 1800 x 1200: past the panel both ways.
  await scrollTo(page, 'image', .8, .7);
  const before = await view(page, 'image');
  await page.keyboard.press('Control+Equal');
  await expect(level(page)).toHaveText('400%'); await settled(page, 'image');
  const after = await view(page, 'image');
  expectHeld(before, after, 'image zoom in');
  await page.locator('#zoom-level').click();
  await page.locator('#zoom-menu [role^="menuitem"]', { hasText: '200%' }).click();
  await expect(level(page)).toHaveText('200%'); await settled(page, 'image');
  expectHeld(after, await view(page, 'image'), 'image zoom out');
  expect(errors).toEqual([]);
});
