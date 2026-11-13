import { test, expect, type Locator, type Page } from '@playwright/test';
import { pngFixture } from './png-fixture';

// Image documents in a library collection get a previous/next pill. It lives in the footer's lane (above the open footer), the view
// controls stand above it, and the rail or drawer is beside it: none of the four may overlap, whatever the window width.

type Box = { x: number; y: number; width: number; height: number };
const boxOf = async (locator: Locator) => (await locator.boundingBox())!;
const apart = (a: Box, b: Box) => a.x + a.width <= b.x + .5 || b.x + b.width <= a.x + .5 || a.y + a.height <= b.y + .5 || b.y + b.height <= a.y + .5;
// The first has a name too long for any caption to fit: the pill must give way to the drawer, not run under it.
const plates = [[300, 200], [200, 300], [260, 260]].map(([width, height], i) => ({ name: i ? `plate-${i + 1}.png` : `plate-1-${'a-long-descriptive-file-name-'.repeat(4)}.png`, mimeType: 'image/png', buffer: pngFixture(width, height, [40 * i + 20, 120, 200 - 30 * i]) }));

const HEIGHT = 680;

async function openImages(page: Page, width: number, side: 'left' | 'right', drawerWidth = 270) {
  await page.setViewportSize({ width, height: HEIGHT });
  await page.goto('/');
  await page.evaluate(([value, drawer]) => { localStorage.removeItem('hold-my-brief:view-controls'); localStorage.setItem('hold-my-brief:library-side', value); localStorage.setItem('hold-my-brief:library-width', drawer); }, [side, String(drawerWidth)]);
  await page.reload();
  await page.locator('.library-panel input[type=file]').setInputFiles(plates.slice(1)); // Two images in the collection first, so the one opened next has neighbours for the arrows to walk to.
  await page.locator('#file-input').setInputFiles(plates[0]);
  await expect(page.locator('.library-image-navigation span')).toContainText('/ 3');
  await expect(page.locator('.library-image-navigation')).toBeVisible();
  await expect(page.locator('.image-frame img')).toBeVisible();
}

/** Opens the footer the way a reader does, by resting the pointer on the window's bottom edge, and waits for it to arrive. */
async function openFooter(page: Page, width: number) {
  await page.mouse.move(width / 2, HEIGHT - 3);
  await expect.poll(async () => { const box = await boxOf(page.locator('footer')); return Math.round(box.y + box.height); }).toBe(HEIGHT);
}

/** The nav, the view controls, the footer and the rail or drawer are pairwise apart, and both nav buttons are what the pointer would hit. */
async function expectClear(page: Page, width: number, aside: Locator | null) {
  const nav = page.locator('.library-image-navigation'), pill = page.locator('#view-controls'), footer = page.locator('footer');
  await expect(pill).toBeVisible();
  await openFooter(page, width);
  const boxes: [string, Box][] = [['nav', await boxOf(nav)], ['pill', await boxOf(pill)], ['footer', await boxOf(footer)]];
  if (aside) boxes.push(['aside', await boxOf(aside)]);
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(apart(boxes[i][1], boxes[j][1]), `${boxes[i][0]} and ${boxes[j][0]} overlap at ${width} px: ${JSON.stringify([boxes[i][1], boxes[j][1]])}`).toBe(true);
  const navBox = boxes[0][1];
  expect(navBox.x, 'nav inside the window').toBeGreaterThanOrEqual(0); expect(navBox.x + navBox.width).toBeLessThanOrEqual(width + .5);
  for (const direction of ['previous', 'next']) {
    const target = await boxOf(nav.locator(`[data-image-direction="${direction}"]`));
    const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-image-direction]')?.dataset.imageDirection, [target.x + target.width / 2, target.y + target.height / 2]);
    expect(hit, `${direction} button is hit-testable at ${width} px`).toBe(direction);
  }
}

for (const side of ['left', 'right'] as const) {
  test(`image navigation, the view controls, the footer and the ${side} rail or drawer never overlap, from 600 to 1400 px`, async ({ page }) => {
    // 720 and 790 px are the tightest widths: the widest drawer the window allows (see library-layout.ts) leaves the least room there.
    for (const [width, drawerWidth] of [[600, 270], [720, 270], [720, 520], [760, 270], [790, 270], [790, 520], [1080, 270], [1400, 520]]) {
      await openImages(page, width, side, drawerWidth);
      const rail = page.locator('#library-rail'), drawer = page.locator('#library-root');
      const compact = width < 720;
      // Closed: the rail stands at the edge from 720 px up; a compact window has nothing there.
      if (await drawer.isVisible()) await page.locator('#library-toggle').click();
      await expectClear(page, width, compact ? null : rail);
      // Open: the drawer takes the rail's place (a compact window's drawer is a sheet over a scrim, covering everything, so only the wide ones are measured).
      if (!compact) {
        await page.mouse.move(width / 2, HEIGHT / 2);
        await page.locator('#library-toggle').click(); await expect(drawer).toBeVisible();
        await expectClear(page, width, drawer);
      }
    }
  });
}

for (const side of ['left', 'right'] as const) {
  test(`a view-controls pill dragged anywhere stays clear of the image navigation, the footer and the ${side} rail or drawer, from 720 to 1080 px`, async ({ page }) => {
    test.setTimeout(150_000); // Ten placements, six drops each.
    for (const [width, drawerWidth] of [[720, 270], [720, 520], [760, 270], [790, 270], [1080, 270]]) {
      for (const drawerOpen of [false, true]) {
        await openImages(page, width, side, drawerWidth);
        const drawer = page.locator('#library-root'), aside = drawerOpen ? drawer : page.locator('#library-rail');
        if (await drawer.isVisible() !== drawerOpen) await page.locator('#library-toggle').click();
        await expect(aside).toBeVisible();
        const nav = page.locator('.library-image-navigation'), pill = page.locator('#view-controls'), footer = page.locator('footer'), grip = page.getByRole('button', { name: 'Move view controls' });
        // Drop the pill on the nav, on each of the bottom corners and the bottom centre of the panel, and against the rail or drawer.
        const navBox = await boxOf(nav), asideBox = await boxOf(aside);
        const beside = side === 'left' ? asideBox.x + asideBox.width + 4 : asideBox.x - 4;
        const targets = [{ x: navBox.x + navBox.width / 2, y: navBox.y + navBox.height / 2 }, { x: navBox.x + 10, y: navBox.y - 4 }, { x: width - 8, y: HEIGHT - 8 }, { x: width / 2, y: HEIGHT - 8 }, { x: beside, y: HEIGHT - 8 }, { x: beside, y: HEIGHT / 2 }];
        for (const target of targets) {
          await page.mouse.move(width / 2, HEIGHT / 2);
          const handle = await boxOf(grip);
          await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
          await page.mouse.down(); await page.mouse.move(target.x, target.y, { steps: 8 }); await page.mouse.up();
          await openFooter(page, width);
          const at = `at ${width} px (${drawerOpen ? 'drawer' : 'rail'}, drag to ${Math.round(target.x)},${Math.round(target.y)})`;
          const [pillBox, footerBox, navNow, asideNow] = [await boxOf(pill), await boxOf(footer), await boxOf(nav), await boxOf(aside)];
          expect(apart(pillBox, navNow), `pill ${JSON.stringify(pillBox)} over nav ${JSON.stringify(navNow)} ${at}`).toBe(true);
          expect(apart(pillBox, footerBox), `pill over footer ${at}`).toBe(true);
          expect(apart(pillBox, asideBox), `pill ${JSON.stringify(pillBox)} over rail/drawer ${JSON.stringify(asideNow)} ${at}`).toBe(true);
          expect(pillBox.x).toBeGreaterThanOrEqual(0); expect(pillBox.x + pillBox.width).toBeLessThanOrEqual(width + .5);
          await page.mouse.move(width / 2, HEIGHT / 2);
        }
      }
    }
  });
}

test('with the footer open, the arrows are clickable and walk the collection', async ({ page }) => {
  await openImages(page, 720, 'left');
  const caption = page.locator('.library-image-navigation span'), next = page.getByRole('button', { name: 'Next image in collection' });
  await openFooter(page, 720);
  const before = await caption.textContent();
  await next.click();
  await expect(caption).not.toHaveText(before!);
  await expect(caption).toContainText('/ 3');
});
