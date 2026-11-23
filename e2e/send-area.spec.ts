import { expect, test, type Page } from '@playwright/test';
import { mockDesktop } from './desktop-mock';
import { pagedPdf, pageColour } from './paged-pdf';
import { pngFixture } from './png-fixture';

const AGENT = { enabled: true, running: true };
const HOST = '.reader-host:not(.staging):not(.tab-hidden)';

async function control<T>(page: Page, request: string, method: string, params: Record<string, unknown>): Promise<T> {
  await page.evaluate(([request, method, params]) => window.__mockEmit('control-request', { id: request, method, params }), [request, method, params] as const);
  await expect.poll(() => page.evaluate(request => window.__mockReplies.some(reply => reply.id === request), request)).toBe(true);
  const reply = await page.evaluate(request => window.__mockReplies.find(reply => reply.id === request)!, request);
  expect(reply.ok, reply.error ?? '').toBe(true);
  return reply.result as T;
}

/** Opens a generated document through the Library, the way `hmb show` names one, with Agent control as `control` says. */
async function openDocument(page: Page, name: string, format: string, bytes: Buffer, control_: typeof AGENT | null = AGENT, viewport = { width: 1080, height: 760 }) {
  await mockDesktop(page, { control: control_ });
  await page.setViewportSize(viewport);
  await page.goto('/');
  const id = `folder:485e41a8d1a72538:${name}`;
  await page.evaluate(([id, name, format, bytes]) => { window.__mockLibrary[id] = { name, format, bytes }; }, [id, name, format, [...bytes]] as const);
  await control(page, 'r-show', 'show', { path: id });
  await expect(page.locator(`${HOST} ${format === 'pdf' ? 'canvas' : 'img'}`).first()).toBeVisible();
  await expect(page.locator('#loading')).toBeHidden();
  if (format === 'pdf') await expect(page.locator('#position')).toContainText('Page 1 of');
  if (control_) await expect(page.locator('#settings-control [role="switch"]')).toHaveAttribute('aria-checked', String(control_.enabled));
}

const areas = (page: Page) => page.evaluate(() => window.__mockAreas);
const overlay = (page: Page) => page.locator('.area-overlay');
/** A box in CSS px from the top-left of the reading surface, dragged with the mouse. */
async function drag(page: Page, box: { x: number; y: number; w: number; h: number }, { release = true } = {}) {
  const host = (await page.locator(HOST).boundingBox())!;
  await page.mouse.move(host.x + box.x, host.y + box.y);
  await page.mouse.down();
  await page.mouse.move(host.x + box.x + box.w / 2, host.y + box.y + box.h / 2, { steps: 3 });
  await page.mouse.move(host.x + box.x + box.w, host.y + box.y + box.h, { steps: 3 });
  if (release) await page.mouse.up();
}
const pngSize = (png: number[]) => { const view = new DataView(new Uint8Array(png).buffer); return { signature: png.slice(0, 8), width: view.getUint32(16), height: view.getUint32(20) }; };
const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
/** Where each element matched by `selector` is on the reading surface, in CSS px from its top-left corner, with the pixels of its bitmap when it has one. */
const placesOf = (page: Page, selector: string) => page.evaluate(([host, selector]) => {
  const origin = document.querySelector(host)!.getBoundingClientRect();
  return [...document.querySelectorAll<HTMLElement>(`${host} ${selector}`)].map(element => {
    const rect = element.getBoundingClientRect();
    const bitmap = element as HTMLCanvasElement | HTMLImageElement;
    return { x: rect.left - origin.left, y: rect.top - origin.top, w: rect.width, h: rect.height, pixelsWidth: bitmap instanceof HTMLCanvasElement ? bitmap.width : bitmap.naturalWidth, pixelsHeight: bitmap instanceof HTMLCanvasElement ? bitmap.height : bitmap.naturalHeight };
  });
}, [HOST, selector] as const);
const four = (value: number) => Math.round(value * 10000) / 10000;
/** The colour of a pixel of a PNG the reader sent. */
const pixelOf = (page: Page, png: number[], x: number, y: number) => page.evaluate(async ([png, x, y]) => {
  const bitmap = await createImageBitmap(new Blob([new Uint8Array(png)], { type: 'image/png' }));
  const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
  const context = canvas.getContext('2d')!; context.drawImage(bitmap, 0, 0);
  return [...context.getImageData(x, y, 1, 1).data].slice(0, 3);
}, [png, x, y] as const);

test('a box dragged over a PDF page sends that area, as a PNG at the page canvas\'s scale, with its page and place', async ({ page }) => {
  await openDocument(page, 'plan.pdf', 'pdf', pagedPdf(3));
  const [sheet] = await placesOf(page, '.pdf-page canvas');
  const box = { x: sheet.x + sheet.w * 0.2, y: sheet.y + sheet.h * 0.3, w: sheet.w * 0.5, h: sheet.h * 0.25 };

  await page.keyboard.press('Control+Shift+A');
  await expect(overlay(page)).toBeVisible();
  await expect(overlay(page).locator('.area-hint')).toHaveText('Drag a box to send · Esc to cancel');
  expect(await overlay(page).evaluate(element => getComputedStyle(element).cursor)).toBe('crosshair');
  await drag(page, box, { release: false });
  await expect(overlay(page).locator('.area-box')).toBeVisible();
  await page.mouse.up();

  await expect(overlay(page)).toHaveCount(0);
  await expect.poll(async () => (await areas(page)).length).toBe(1);
  await expect(page.locator('#notice')).toContainText('Sent area to agent');
  const [sent] = await areas(page);
  const scale = sheet.pixelsWidth / sheet.w;
  expect(pngSize(sent.png)).toEqual({ signature: SIGNATURE, width: Math.round(box.w * scale), height: Math.round(box.h * scale) });
  expect(sent.meta).toMatchObject({ paneId: 'a', path: expect.stringContaining('plan.pdf'), title: 'plan.pdf', page: 1 });
  expect(sent.meta.box.x).toBeCloseTo(0.2, 2); expect(sent.meta.box.y).toBeCloseTo(0.3, 2);
  expect(sent.meta.box.w).toBeCloseTo(0.5, 2); expect(sent.meta.box.h).toBeCloseTo(0.25, 2);
  expect(sent.meta.box).toEqual({ x: four(sent.meta.box.x), y: four(sent.meta.box.y), w: four(sent.meta.box.w), h: four(sent.meta.box.h) });
  // The picture is the page's own pixels: page 1's fill, not the grey around it.
  const [r, g, b] = pageColour(1);
  const [red, green, blue] = await pixelOf(page, sent.png, 3, 3);
  expect([Math.abs(red - r), Math.abs(green - g), Math.abs(blue - b)].every(difference => difference <= 2)).toBe(true);
});

test('a box over the second page of a two-page spread is that page\'s; one across both is a single image with the page under its centre', async ({ page }) => {
  await openDocument(page, 'spread.pdf', 'pdf', pagedPdf(3), AGENT, { width: 1180, height: 760 });
  await page.keyboard.press('Control+3');
  await page.keyboard.press('PageDown');
  await expect(page.locator('.pdf-spread .pdf-page canvas')).toHaveCount(2);
  await expect(page.locator('#position')).toContainText('2');
  const [left, right] = await placesOf(page, '.pdf-page canvas');

  // Wholly on the second page of the spread (page 3).
  const second = { x: right.x + right.w * 0.1, y: right.y + right.h * 0.5, w: right.w * 0.4, h: right.h * 0.2 };
  await page.keyboard.press('Control+Shift+A'); await drag(page, second);
  await expect.poll(async () => (await areas(page)).length).toBe(1);
  let sent = (await areas(page))[0];
  expect(sent.meta.page).toBe(3);
  expect(sent.meta.box.x).toBeCloseTo(0.1, 2); expect(sent.meta.box.y).toBeCloseTo(0.5, 2); expect(sent.meta.box.w).toBeCloseTo(0.4, 2);
  expect(pngSize(sent.png).width).toBe(Math.round(second.w * right.pixelsWidth / right.w));

  // Across the seam, the centre on the left page (page 2): one image holding both pages' pixels.
  const across = { x: left.x + left.w * 0.4, y: left.y + left.h * 0.3, w: left.w * 0.6 + right.w * 0.3, h: left.h * 0.2 };
  await page.keyboard.press('Control+Shift+A'); await drag(page, across);
  await expect.poll(async () => (await areas(page)).length).toBe(2);
  sent = (await areas(page))[1];
  expect(sent.meta.page).toBe(2);
  expect(sent.meta.box.x).toBeCloseTo(0.4, 2); expect(sent.meta.box.w).toBeCloseTo(0.6, 2);
  const { width, height } = pngSize(sent.png);
  expect(width).toBe(Math.round(across.w * left.pixelsWidth / left.w)); expect(height).toBe(Math.round(across.h * left.pixelsHeight / left.h));
  const colour = (n: number) => pageColour(n);
  const at = async (x: number) => pixelOf(page, sent.png, x, 2);
  const near = (a: number[], b: number[]) => a.every((value, index) => Math.abs(value - b[index]) <= 2);
  expect(near(await at(2), colour(2))).toBe(true);
  expect(near(await at(width - 3), colour(3))).toBe(true);
});

test('a zoomed page gives the same place on the page as a fit one', async ({ page }) => {
  await openDocument(page, 'zoom.pdf', 'pdf', pagedPdf(2));
  await page.keyboard.press('Control+0');
  const [fit] = await placesOf(page, '.pdf-page canvas');
  await page.keyboard.press('Shift+0'); // Actual size: the page is larger than before.
  await expect.poll(async () => (await placesOf(page, '.pdf-page canvas'))[0].w).not.toBe(fit.w);
  const [zoomed] = await placesOf(page, '.pdf-page canvas');
  // The part of the page 25–75 % across and 10–30 % down, wherever it is on screen (the surface may be scrolled).
  const host = (await page.locator(HOST).boundingBox())!;
  const box = { x: Math.max(0, zoomed.x + zoomed.w * 0.25), y: Math.max(0, zoomed.y + zoomed.h * 0.1), w: zoomed.w * 0.5, h: zoomed.h * 0.2 };
  box.w = Math.min(box.w, host.width - box.x - 2); box.h = Math.min(box.h, host.height - box.y - 2);
  await page.keyboard.press('Control+Shift+A'); await drag(page, box);
  await expect.poll(async () => (await areas(page)).length).toBe(1);
  const { meta, png } = (await areas(page))[0];
  expect(meta.page).toBe(1);
  expect(meta.box.x).toBeCloseTo(Math.max(0, (box.x - zoomed.x) / zoomed.w), 3);
  expect(meta.box.y).toBeCloseTo(Math.max(0, (box.y - zoomed.y) / zoomed.h), 3);
  expect(meta.box.w).toBeCloseTo(box.w / zoomed.w, 3);
  expect(pngSize(png).width).toBe(Math.round(box.w * zoomed.pixelsWidth / zoomed.w));
});

test('a box dragged over an image sends its pixels at the image\'s own resolution, with no page', async ({ page }) => {
  await openDocument(page, 'chart.png', 'png', pngFixture(1200, 800, [30, 140, 220]));
  const [shown] = await placesOf(page, '.image-frame img');
  const box = { x: shown.x + shown.w * 0.25, y: shown.y + shown.h * 0.5, w: shown.w * 0.5, h: shown.h * 0.25 };

  await page.keyboard.press('Control+k');
  await page.locator('#palette-input').fill('send area');
  const row = page.locator('#palette-list .palette-row', { hasText: 'Send area to agent' });
  await expect(row).toHaveAttribute('aria-disabled', 'false');
  await page.keyboard.press('Enter');
  await expect(overlay(page)).toBeVisible();
  await drag(page, box);

  await expect.poll(async () => (await areas(page)).length).toBe(1);
  const { meta, png } = (await areas(page))[0];
  expect(pngSize(png)).toEqual({ signature: SIGNATURE, width: Math.round(box.w * 1200 / shown.w), height: Math.round(box.h * 800 / shown.h) });
  expect('page' in meta).toBe(false);
  expect(meta).toMatchObject({ paneId: 'a', title: 'chart.png' });
  expect(meta.box.x).toBeCloseTo(0.25, 2); expect(meta.box.y).toBeCloseTo(0.5, 2); expect(meta.box.w).toBeCloseTo(0.5, 2); expect(meta.box.h).toBeCloseTo(0.25, 2);
  const [red, green, blue] = await pixelOf(page, png, 4, 4);
  expect([red, green, blue]).toEqual([30, 140, 220]);
  await expect(page.locator('#notice')).toContainText('Sent area to agent');
});

test('a larger area is scaled down to 2048 px on its longer side, keeping its aspect', async ({ page }) => {
  await openDocument(page, 'big.png', 'png', pngFixture(4400, 2800, [200, 80, 40]), AGENT, { width: 1400, height: 900 });
  const [shown] = await placesOf(page, '.image-frame img');
  await page.keyboard.press('Control+Shift+A');
  await expect(overlay(page)).toBeVisible();
  await drag(page, { x: shown.x + 1, y: shown.y + 1, w: shown.w - 2, h: shown.h - 2 });
  await expect.poll(async () => (await areas(page)).length).toBe(1);
  const { width, height } = pngSize((await areas(page))[0].png);
  expect(width).toBe(2048);
  expect(Math.abs(height - 2048 * 2800 / 4400)).toBeLessThanOrEqual(2);
});

test('Escape, a tiny box, a click outside the pane and a tab switch send nothing and take the overlay away', async ({ page }) => {
  await openDocument(page, 'plan.pdf', 'pdf', pagedPdf(3));
  const [sheet] = await placesOf(page, '.pdf-page canvas');
  const inside = { x: sheet.x + 30, y: sheet.y + 30 };

  await page.keyboard.press('Control+Shift+A');
  await expect(overlay(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(overlay(page)).toHaveCount(0);

  await page.keyboard.press('Control+Shift+A');
  await drag(page, { ...inside, w: 7, h: 40 });
  await expect(overlay(page)).toHaveCount(0);
  await page.keyboard.press('Control+Shift+A');
  await drag(page, { ...inside, w: 40, h: 7 });
  await expect(overlay(page)).toHaveCount(0);

  await page.keyboard.press('Control+Shift+A');
  await expect(overlay(page)).toBeVisible();
  const surface = (await page.locator(HOST).boundingBox())!;
  await page.mouse.click(surface.x + surface.width / 2, surface.y - 6); // The toolbar, above the pane.
  await expect(overlay(page)).toHaveCount(0);

  // Showing another tab takes it away.
  const other = 'folder:485e41a8d1a72538:other.pdf';
  await page.evaluate(([id, bytes]) => { window.__mockLibrary[id] = { name: 'other.pdf', format: 'pdf', bytes }; }, [other, [...pagedPdf(2)]] as const);
  await page.keyboard.press('Control+Shift+A');
  await expect(overlay(page)).toBeVisible();
  await control(page, 'r-other', 'show', { path: other });
  await expect(overlay(page)).toHaveCount(0);
  await control(page, 'r-back', 'show', { path: `folder:485e41a8d1a72538:plan.pdf` });
  await expect(page.locator('#position')).toContainText('Page 1 of 3');

  // An overlay left up while a drag is half done goes with Escape too.
  await page.keyboard.press('Control+Shift+A');
  await drag(page, { ...inside, w: 80, h: 80 }, { release: false });
  await page.keyboard.press('Escape');
  await expect(overlay(page)).toHaveCount(0);
  await page.mouse.up();

  await page.waitForTimeout(300);
  expect(await areas(page)).toEqual([]);
  await expect(page.locator('#notice')).toBeHidden();
});

test('a layout change while the overlay is up cancels it and sends nothing', async ({ page }) => {
  await openDocument(page, 'plan.pdf', 'pdf', pagedPdf(3));
  await page.keyboard.press('Control+Shift+A');
  await expect(overlay(page)).toBeVisible();
  const before = (await page.locator(HOST).boundingBox())!;
  await control(page, 'r-library', 'cmd', { command: 'library' }); // The library drawer changes the reading surface's size without a window resize.
  await expect.poll(async () => (await page.locator(HOST).boundingBox())!.width).not.toBe(before.width);
  await expect(overlay(page)).toHaveCount(0);
  expect(await areas(page)).toEqual([]);
});

test('hmb cmd send-area-to-agent is refused and starts nothing', async ({ page }) => {
  await openDocument(page, 'plan.pdf', 'pdf', pagedPdf(3));
  await page.evaluate(() => window.__mockEmit('control-request', { id: 'r-area', method: 'cmd', params: { command: 'send-area-to-agent' } }));
  await expect.poll(() => page.evaluate(() => window.__mockReplies.some(reply => reply.id === 'r-area'))).toBe(true);
  const reply = await page.evaluate(() => window.__mockReplies.find(reply => reply.id === 'r-area')!);
  expect(reply.ok).toBe(false);
  expect(reply.error).toBe('Only the user can send an area.');
  await expect(overlay(page)).toHaveCount(0);
  expect(await areas(page)).toEqual([]);
});

test('scrolling, zooming and page keys do nothing while the overlay is up', async ({ page }) => {
  await openDocument(page, 'plan.pdf', 'pdf', pagedPdf(3));
  await page.keyboard.press('Control+2'); // Fit width: the page is taller than the surface, so it scrolls.
  await expect.poll(() => page.locator(HOST).evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  const state = () => page.evaluate(host => { const element = document.querySelector(host)!; return { top: element.scrollTop, width: document.querySelector(`${host} canvas`)!.getBoundingClientRect().width, position: document.querySelector('#position')!.textContent }; }, HOST);
  const before = await state();
  await page.keyboard.press('Control+Shift+A');
  const box = (await page.locator('.area-overlay').boundingBox())!;
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.wheel(0, 400);
  await page.keyboard.down('Control'); await page.mouse.wheel(0, -400); await page.keyboard.up('Control');
  for (const key of ['Control+=', 'Control+-', 'PageDown', 'ArrowDown', 'Space', 'Shift+0', 'Alt+ArrowLeft']) await page.keyboard.press(key);
  await page.waitForTimeout(250);
  expect(await state()).toEqual(before);
  await page.keyboard.press('Escape');
  await expect(overlay(page)).toHaveCount(0);
});

test('the command is unavailable, with its reason, on a Markdown brief and with Agent control off', async ({ page }) => {
  const reason = async (query = 'send area') => {
    await page.keyboard.press('Control+k');
    await page.locator('#palette-input').fill(query);
    const row = page.locator('#palette-list .palette-row', { hasText: 'Send area to agent' });
    await expect(row).toHaveAttribute('aria-disabled', 'true');
    const text = await row.textContent();
    await page.keyboard.press('Escape');
    return text ?? '';
  };
  await mockDesktop(page, { control: AGENT });
  await page.setViewportSize({ width: 1080, height: 760 });
  await page.goto('/');
  await page.evaluate(() => { window.__mockBriefs['hold-my-brief:brief/plan'] = { id: 'plan', path: 'hold-my-brief:brief/plan', title: 'plan', format: 'md', content: '# Plan\n\nBody text.', updatedAt: Date.now() }; });
  await control(page, 'r-brief', 'show', { path: 'hold-my-brief:brief/plan' });
  await expect(page.locator('.reader-text-content')).toContainText('Body text');
  expect(await reason()).toContain('Area capture works on PDF pages and images; select text instead.');
  await page.keyboard.press('Control+Shift+A');
  await expect(overlay(page)).toHaveCount(0);
  expect(await areas(page)).toEqual([]);
});

test('with Agent control off the command is unavailable on a PDF and nothing is sent', async ({ page }) => {
  await openDocument(page, 'plan.pdf', 'pdf', pagedPdf(1), { enabled: false, running: false });
  await page.keyboard.press('Control+k');
  await page.locator('#palette-input').fill('send area');
  const row = page.locator('#palette-list .palette-row', { hasText: 'Send area to agent' });
  await expect(row).toHaveAttribute('aria-disabled', 'true');
  await expect(row).toContainText('Agent control');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+Shift+A');
  await expect(overlay(page)).toHaveCount(0);
  expect(await areas(page)).toEqual([]);
});
