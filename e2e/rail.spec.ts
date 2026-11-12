import { test, expect, type Locator, type Page } from '@playwright/test';
import { pagedPdf } from './paged-pdf';

const open = (page: Page, name: string) => page.locator('#file-input').setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(`${name}\n\nBody of ${name}.\n`) });
const shown = (page: Page, name: string) => expect(page.locator('#filename')).toHaveText(name);

test('a closed library is a rail of recent covers: titled, ringed on the open one, one click to open, swapped with the drawer, absent when compact, and never moving the page', async ({ page }) => {
  await page.setViewportSize({ width: 1080, height: 680 });
  await page.goto('/');
  const rail = page.locator('#library-rail'), covers = rail.locator('.library-rail-cover'), drawer = page.locator('#library-root');
  const toggle = rail.getByRole('button', { name: 'Open library' });

  // The library is open at first at this width; closing it leaves the rail, with nothing to show but the toggle.
  await page.locator('#library-toggle').click();
  await expect(drawer).toBeHidden();
  await expect(rail).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(covers).toHaveCount(0);
  const box = (await rail.boundingBox())!;
  expect(Math.round(box.width)).toBe(60);

  // Opening documents fills the rail, most recent first, each cover named by its document, the open one ringed.
  for (const name of ['alpha.txt', 'beta.txt', 'gamma.txt']) { await open(page, name); await shown(page, name); }
  await expect(covers).toHaveCount(3);
  await expect(covers.nth(0)).toHaveAttribute('aria-label', 'gamma.txt');
  await expect(covers.nth(1)).toHaveAttribute('aria-label', 'beta.txt');
  await expect(covers.nth(2)).toHaveAttribute('title', 'alpha.txt');
  const cover = (await covers.nth(0).boundingBox())!;
  expect([Math.round(cover.width), Math.round(cover.height)]).toEqual([40, 54]);
  await expect(covers.nth(0)).toHaveAttribute('aria-current', 'true');
  await expect(covers.nth(1)).not.toHaveAttribute('aria-current', 'true');

  // The rail overlays the reading panel: the panel and the reading surface keep their boxes whether the rail or the drawer stands there.
  const geometry = async () => ({ workspace: await page.locator('#workspace').boundingBox(), host: await page.locator('.reader-host:not(.staging)').boundingBox() });
  const withRail = await geometry();
  expect(withRail.workspace!.width).toBe(1080);

  // A click opens that document, and the ring follows it.
  await covers.nth(2).click();
  await shown(page, 'alpha.txt');
  await expect(covers.nth(0)).toHaveAttribute('aria-label', 'alpha.txt');
  await expect(covers.nth(0)).toHaveAttribute('aria-current', 'true');
  expect(await geometry()).toEqual(withRail);

  // The toggle swaps the rail for the drawer and back.
  await toggle.click();
  await expect(drawer).toBeVisible();
  await expect(rail).toBeHidden();
  await expect(page.locator('#library-toggle')).toHaveAttribute('aria-expanded', 'true');
  expect(await geometry()).toEqual(withRail);
  await page.getByRole('button', { name: 'Close library', exact: true }).first().click();
  await expect(drawer).toBeHidden();
  await expect(rail).toBeVisible();
  expect(await geometry()).toEqual(withRail);

  // The same on the right once the library is docked there, and the view controls stay clear of the rail.
  await page.keyboard.press('Control+b');
  await page.getByRole('button', { name: 'Move library to the right' }).click();
  await page.getByRole('button', { name: 'Close library', exact: true }).first().click();
  await expect(rail).toBeVisible();
  const right = (await rail.boundingBox())!;
  expect(right.x).toBeGreaterThan(1080 - 6 - 60 - 1);
  expect(await geometry()).toEqual(withRail);
  await page.keyboard.press('Control+f');
  const find = page.locator('#find-bar');
  await expect(find).toBeVisible();
  const bar = (await find.boundingBox())!;
  expect(bar.x + bar.width).toBeLessThanOrEqual(right.x);
  await page.keyboard.press('Escape');

  // Compact windows have no rail, and keep the sheet.
  await page.setViewportSize({ width: 600, height: 680 });
  await expect(rail).toBeHidden();
});

type Box = { x: number; y: number; width: number; height: number };
const apart = (a: Box, b: Box) => a.x + a.width <= b.x + .5 || b.x + b.width <= a.x + .5 || a.y + a.height <= b.y + .5 || b.y + b.height <= a.y + .5;
const boxOf = async (locator: Locator) => (await locator.boundingBox())!;

/** A PDF open in a 973 x 858 window, library closed, two-page spread, zoomed out, page previews on: everything that can stand along an edge is there. */
async function openReading(page: Page, side: 'left' | 'right') {
  await page.setViewportSize({ width: 973, height: 858 });
  await page.goto('/');
  await page.evaluate(value => localStorage.setItem('hold-my-brief:library-side', value), side);
  await page.reload();
  await page.locator('#file-input').setInputFiles({ name: 'rail.pdf', mimeType: 'application/pdf', buffer: pagedPdf(9) });
  await expect(page.locator('#position')).toContainText('Page 1 of 9');
  await expect(page.locator('#loading')).toBeHidden();
  if (await page.locator('#library-root').isVisible()) await page.locator('#library-toggle').click();
  await expect(page.locator('#library-rail')).toBeVisible();
  await page.locator('.pdf-reader').focus();
  await page.keyboard.press('Control+3');
  for (let step = 0; step < 3; step++) await page.keyboard.press('Control+-');
  await page.getByRole('button', { name: 'Hand tool' }).click();
  await page.keyboard.press('Control+4');
  await expect(page.getByRole('navigation', { name: 'Next pages' })).toBeVisible();
}

for (const side of ['right', 'left'] as const) {
  test(`with the rail on the ${side}, the rail, the page strip, the footer and the view controls never overlap, and the footer stays whole and clickable`, async ({ page }) => {
    await openReading(page, side);
    const rail = page.locator('#library-rail'), strip = page.getByRole('navigation', { name: 'Next pages' }), pill = page.locator('#view-controls'), footer = page.locator('footer');
    await expect(rail).toHaveAttribute('data-library-side', side);

    // The footer opens over the bottom edge when the pointer rests there; measure it open, as the reader sees it.
    const openFooter = async () => {
      await page.mouse.move(486, 855);
      await expect.poll(async () => { const box = await boxOf(footer); return Math.round(box.y + box.height); }).toBe(858);
    };
    const clear = async () => {
      await openFooter();
      const [railBox, stripBox, footerBox, pillBox] = [await boxOf(rail), await boxOf(strip), await boxOf(footer), await boxOf(pill)];
      for (const [name, a, b] of [['rail/strip', railBox, stripBox], ['rail/footer', railBox, footerBox], ['rail/pill', railBox, pillBox], ['strip/footer', stripBox, footerBox], ['strip/pill', stripBox, pillBox], ['footer/pill', footerBox, pillBox]] as const) expect(apart(a, b), name).toBe(true);
      // The strip stops at the rail's inner edge, on whichever side that is, and the rail ends above the footer.
      if (side === 'right') expect(stripBox.x + stripBox.width).toBeLessThanOrEqual(railBox.x);
      else expect(stripBox.x).toBeGreaterThanOrEqual(railBox.x + railBox.width);
      expect(railBox.y + railBox.height).toBeLessThanOrEqual(footerBox.y + .5);
      // The footer is whole inside the window, and its two arrows are what is under the pointer at their centres.
      expect(footerBox.x).toBeGreaterThanOrEqual(0); expect(footerBox.x + footerBox.width).toBeLessThanOrEqual(973 + .5);
      for (const id of ['previous', 'next', 'position', 'progress']) {
        const target = await boxOf(page.locator(`#${id}`));
        expect(await page.evaluate(([x, y, wanted]) => document.elementFromPoint(x as number, y as number)?.closest('footer button, footer input')?.id === wanted, [target.x + target.width / 2, target.y + target.height / 2, id]), `${id} is not covered`).toBe(true);
      }
    };
    await clear();

    // A pill dragged into the corner beside the rail, or against the strip and the footer's lane, is steered clear of all three.
    const grip = page.getByRole('button', { name: 'Move view controls' });
    for (const corner of [{ x: side === 'right' ? 966 : 6, y: 700 }, { x: side === 'right' ? 966 : 6, y: 845 }, { x: 486, y: 845 }, { x: side === 'right' ? 6 : 966, y: 845 }]) {
      const handle = await boxOf(grip);
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2); await page.mouse.down();
      await page.mouse.move(corner.x, corner.y, { steps: 8 }); await page.mouse.up();
      await clear();
    }
    // The saved placement is re-resolved against the other side's rail too.
    await page.keyboard.press('Control+b');
    await page.getByRole('button', { name: `Move library to the ${side === 'right' ? 'left' : 'right'}` }).click();
    await page.getByRole('button', { name: 'Close library', exact: true }).first().click();
    await expect(rail).toBeVisible();
    const other = side === 'right' ? 'left' : 'right';
    await expect(rail).toHaveAttribute('data-library-side', other);
    const [railBox, pillBox, stripBox] = [await boxOf(rail), await boxOf(pill), await boxOf(strip)];
    expect(apart(railBox, pillBox) && apart(railBox, stripBox)).toBe(true);
  });
}

for (const side of ['left', 'right'] as const) {
  test(`the open drawer docked ${side}, with the page strip, ends above the footer and the strip starts beside it`, async ({ page }) => {
    await openReading(page, side);
    await page.locator('#library-toggle').click();
    const drawer = page.locator('#library-root'), strip = page.getByRole('navigation', { name: 'Next pages' }), footer = page.locator('footer');
    await expect(drawer).toBeVisible();
    await page.mouse.move(486, 855);
    await expect.poll(async () => { const box = await boxOf(footer); return Math.round(box.y + box.height); }).toBe(858);
    const [d, s, f] = [await boxOf(drawer), await boxOf(strip), await boxOf(footer)];
    expect(apart(d, s) && apart(d, f) && apart(s, f)).toBe(true);
    expect(d.y + d.height).toBeLessThanOrEqual(f.y + .5);
    if (side === 'left') expect(s.x).toBeGreaterThanOrEqual(d.x + d.width); else expect(s.x + s.width).toBeLessThanOrEqual(d.x);
  });
}

test('a compact window has no rail and its sheet still covers the whole layout', async ({ page }) => {
  await openReading(page, 'left');
  await page.setViewportSize({ width: 600, height: 700 });
  await expect(page.locator('#library-rail')).toBeHidden();
  await page.locator('#library-toggle').click();
  await expect(page.locator('#library-root')).toBeVisible();
  const layout = await boxOf(page.locator('#reader-layout')), sheet = await boxOf(page.locator('#library-root'));
  expect(Math.round(sheet.y + sheet.height)).toBe(Math.round(layout.y + layout.height));
});

test('the rail has a side button and a context menu; both move the one saved side, which the drawer and the palette share and a reload keeps', async ({ page }) => {
  await page.setViewportSize({ width: 1080, height: 680 });
  await page.goto('/');
  const rail = page.locator('#library-rail'), key = 'hold-my-brief:library-side';
  const side = () => page.evaluate(k => localStorage.getItem(k), key);
  if (await page.locator('#library-root').isVisible()) await page.locator('#library-toggle').click();
  await expect(rail).toBeVisible();
  await expect(rail).toHaveAttribute('data-library-side', 'left');

  // The button at the rail's foot says where it will go, and goes there.
  const toRight = rail.getByRole('button', { name: 'Move library to the right' });
  await expect(toRight).toBeVisible();
  const foot = await boxOf(toRight), railBox = await boxOf(rail);
  expect(foot.y + foot.height).toBeGreaterThan(railBox.y + railBox.height - 16);
  await toRight.click();
  expect(await side()).toBe('right');
  await expect(rail).toHaveAttribute('data-library-side', 'right');
  expect((await boxOf(rail)).x).toBeGreaterThan(1080 - 6 - 60 - 1);
  await expect(rail.getByRole('button', { name: 'Move library to the left' })).toBeVisible();

  // The context menu offers both sides, marks the current one, and Escape closes it without a change.
  await rail.click({ button: 'right', position: { x: 30, y: 200 } });
  const menu = page.getByRole('menu').filter({ has: page.getByRole('menuitemradio', { name: 'Keep library on the left' }) });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitemradio', { name: 'Keep library on the right' })).toHaveAttribute('aria-checked', 'true');
  await expect(menu.getByRole('menuitemradio', { name: 'Keep library on the left' })).toHaveAttribute('aria-checked', 'false');
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  expect(await side()).toBe('right');
  await rail.click({ button: 'right', position: { x: 30, y: 200 } });
  await menu.getByRole('menuitemradio', { name: 'Keep library on the left' }).click();
  await expect(menu).toBeHidden();
  expect(await side()).toBe('left');
  await expect(rail).toHaveAttribute('data-library-side', 'left');
  expect((await boxOf(rail)).x).toBeLessThan(10);
  // Choosing the side the library is already on changes nothing.
  await rail.click({ button: 'right', position: { x: 30, y: 200 } });
  await menu.getByRole('menuitemradio', { name: 'Keep library on the left' }).click();
  expect(await side()).toBe('left');
  // A click elsewhere closes the menu too.
  await rail.click({ button: 'right', position: { x: 30, y: 200 } });
  await expect(menu).toBeVisible();
  await page.mouse.click(600, 300);
  await expect(menu).toBeHidden();

  // The drawer's dock button and the palette command move the same preference, and the rail follows.
  await page.keyboard.press('Control+b');
  await page.getByRole('button', { name: 'Move library to the right' }).click();
  expect(await side()).toBe('right');
  await page.getByRole('button', { name: 'Close library', exact: true }).first().click();
  await expect(rail).toBeVisible();
  await expect(rail).toHaveAttribute('data-library-side', 'right');
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: 'Go to, find or run a command' }).fill('Move library to other side');
  await page.keyboard.press('Enter');
  await expect(rail).toHaveAttribute('data-library-side', 'left');
  expect(await side()).toBe('left');
  await rail.getByRole('button', { name: 'Move library to the right' }).click();

  // The side survives a reload, rail and drawer alike.
  await page.reload();
  if (await page.locator('#library-root').isVisible()) await page.locator('#library-toggle').click();
  await expect(rail).toBeVisible();
  await expect(rail).toHaveAttribute('data-library-side', 'right');
  expect((await boxOf(rail)).x).toBeGreaterThan(1080 - 6 - 60 - 1);
  await page.locator('#library-toggle').click();
  await expect(page.getByRole('button', { name: 'Move library to the left' })).toBeVisible();
  expect((await boxOf(page.locator('#library-root'))).x).toBeGreaterThan(1080 / 2);
});

test('in a compact window the page strip also ends above the footer, and the pill stays above the strip', async ({ page }) => {
  await openReading(page, 'left');
  await page.setViewportSize({ width: 600, height: 760 });
  const strip = page.getByRole('navigation', { name: 'Next pages' }), footer = page.locator('footer'), pill = page.locator('#view-controls');
  await expect(strip).toBeVisible();
  await page.mouse.move(300, 757);
  await expect.poll(async () => { const box = await boxOf(footer); return Math.round(box.y + box.height); }).toBe(760);
  const [s, f, p] = [await boxOf(strip), await boxOf(footer), await boxOf(pill)];
  expect(apart(s, f) && apart(p, s) && apart(p, f)).toBe(true);
  expect(s.x).toBe(0); expect(s.width).toBe(600);
});
