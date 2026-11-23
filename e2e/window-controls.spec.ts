import { test, expect, type Page } from '@playwright/test';

// The browser build has no native frame, so these emulate the desktop titlebars the way the app does: a class on <html>.
const fills = (page: Page) => page.locator('.mac-control').evaluateAll(buttons => buttons.map(button => getComputedStyle(button).backgroundColor));
const outlines = (page: Page) => page.locator('.mac-control').evaluateAll(buttons => buttons.map(button => getComputedStyle(button).borderColor));

async function open(page: Page, titlebar: 'mac' | 'windows') {
  await page.setViewportSize({ width: 1299, height: 946 });
  await page.goto('/');
  await page.evaluate(name => document.documentElement.classList.add(`${name}-titlebar`), titlebar);
}

test('the macOS controls are three 12 px circles, 8 px apart, centred on the tab row and 12 px before Home', async ({ page }) => {
  await open(page, 'mac');
  const boxes = [];
  for (const id of ['mac-close', 'mac-minimize', 'mac-zoom']) boxes.push((await page.locator(`#${id}`).boundingBox())!);
  for (const box of boxes) { expect(box.width).toBe(12); expect(box.height).toBe(12); }
  expect(boxes[1].x - (boxes[0].x + 12)).toBe(8);
  expect(boxes[2].x - (boxes[1].x + 12)).toBe(8);
  const strip = (await page.locator('#tab-strip').boundingBox())!;
  expect(Math.abs(strip.x - (boxes[2].x + 12) - 12)).toBeLessThanOrEqual(1);
  // The tab row's centre is the toolbar's centre, 20 px down.
  for (const box of [...boxes, strip]) expect(box.y + box.height / 2).toBe(20);
  expect(await page.locator('.mac-control').evaluateAll(buttons => buttons.map(button => getComputedStyle(button).borderRadius))).toEqual(['50%', '50%', '50%']);
});

test('at rest the three controls share one fill; pointing at the group shows all three standard colours', async ({ page }) => {
  await open(page, 'mac');
  await page.mouse.move(700, 500);
  const rest = await fills(page);
  expect(new Set(rest).size).toBe(1);
  await page.locator('#mac-minimize').hover();
  expect(await fills(page)).toEqual(['rgb(255, 95, 87)', 'rgb(254, 188, 46)', 'rgb(40, 200, 64)']);
  await expect(page.locator('#mac-close svg')).toHaveCSS('opacity', '1');
  // Every glyph SVG fits inside the 10 px inner circle and is centred on its button.
  for (const id of ['mac-close', 'mac-minimize', 'mac-zoom']) {
    const btn = (await page.locator(`#${id}`).boundingBox())!;
    const svg = (await page.locator(`#${id} svg`).first().boundingBox())!;
    expect(Math.abs((svg.x + svg.width / 2) - (btn.x + btn.width / 2)), `${id} centre x`).toBeLessThanOrEqual(.5);
    expect(Math.abs((svg.y + svg.height / 2) - (btn.y + btn.height / 2)), `${id} centre y`).toBeLessThanOrEqual(.5);
  }
  await page.mouse.move(700, 500);
  expect(await fills(page)).toEqual(rest);
  await expect(page.locator('#mac-close svg')).toHaveCSS('opacity', '0');
});

test('in an inactive window the controls are outlined, not filled', async ({ page }) => {
  await open(page, 'mac');
  await page.mouse.move(700, 500);
  const [filled] = await outlines(page);
  await page.evaluate(() => document.documentElement.classList.add('window-inactive'));
  expect(await fills(page)).toEqual(['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)']);
  const outlined = await outlines(page);
  expect(new Set(outlined).size).toBe(1);
  expect(outlined[0]).not.toBe(filled);
  expect(await page.locator('.mac-control').first().evaluate(button => getComputedStyle(button).borderTopWidth)).toBe('1px');
});

test('Tab reaches the controls, draws a focus ring and Option turns the green one from full screen into zoom', async ({ page }) => {
  await open(page, 'mac');
  await page.mouse.move(700, 500);
  await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Minimize' })).toBeVisible();
  const zoom = page.getByRole('button', { name: 'Enter Full Screen' });
  await expect(zoom).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.locator('#mac-close')).toBeFocused();
  expect(await page.locator('#mac-close').evaluate(button => getComputedStyle(button).outlineStyle)).toBe('solid');
  await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
  await expect(page.locator('#mac-zoom')).toBeFocused();
  // Keyboard focus reveals the colours, as pointing does.
  expect(new Set(await fills(page)).size).toBe(3);
  await page.keyboard.down('Alt');
  await expect(page.getByRole('button', { name: 'Zoom', exact: true })).toBeVisible();
  await page.keyboard.up('Alt');
  await expect(zoom).toBeVisible();
});

test('on macOS the controls go in full screen, and their room with them', async ({ page }) => {
  await open(page, 'mac');
  const before = (await page.locator('#tab-strip').boundingBox())!.x;
  await page.evaluate(() => document.documentElement.classList.add('window-fullscreen'));
  await expect(page.locator('.mac-controls')).toBeHidden();
  expect((await page.locator('#tab-strip').boundingBox())!.x).toBeLessThan(before - 50);
});

test('the controls are not drawn outside macOS', async ({ page }) => {
  await open(page, 'windows');
  await expect(page.locator('.mac-controls')).toBeHidden();
});

test('on Windows the caption buttons start 12 px after the last toolbar item, quiet at rest and full strength on hover', async ({ page }) => {
  await open(page, 'windows');
  const last = (await page.locator('#tab-strip').boundingBox())!;
  const caption = (await page.locator('.caption').boundingBox())!;
  expect(caption.x - (last.x + last.width)).toBeGreaterThanOrEqual(12);
  await page.mouse.move(700, 500);
  const colour = (selector: string) => page.locator(selector).evaluate(button => getComputedStyle(button).color);
  const muted = await page.evaluate(() => { const probe = document.createElement('i'); probe.style.color = 'var(--muted)'; document.body.append(probe); const value = getComputedStyle(probe).color; probe.remove(); return value; });
  const fg = await page.evaluate(() => { const probe = document.createElement('i'); probe.style.color = 'var(--fg)'; document.body.append(probe); const value = getComputedStyle(probe).color; probe.remove(); return value; });
  expect(await colour('#caption-minimize')).toBe(muted);
  await page.locator('#caption-minimize').hover();
  expect(await colour('#caption-minimize')).toBe(fg);
  await page.locator('#caption-close').hover();
  expect(await page.locator('#caption-close').evaluate(button => getComputedStyle(button).backgroundColor)).toBe('rgb(196, 43, 28)');
});
