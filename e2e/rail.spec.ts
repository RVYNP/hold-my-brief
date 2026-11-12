import { test, expect, type Page } from '@playwright/test';

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
