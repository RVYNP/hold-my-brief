import { test, expect, type Locator, type Page } from '@playwright/test';
import { pagedPdf } from './paged-pdf';
import { chooseLibrarySide } from './library-controls';
import { seedLibrary, type FixtureDocument } from './home-fixture';

const open = (page: Page, name: string) => page.locator('#file-input').setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(`${name}\n\nBody of ${name}.\n`) });
const shown = (page: Page, name: string) => expect(page.locator('#filename')).toHaveText(name);

test('the icon rail stands at 720 px and up: 48 px wide, on the saved side, absent when compact; the panel beside it docks, taking its width from the page, and collapses to give it back', async ({ page }) => {
  await page.setViewportSize({ width: 1080, height: 680 });
  await page.goto('/');
  const rail = page.locator('#library-rail'), info = page.locator('#library-root');
  const library = rail.getByRole('button', { name: 'Library', exact: true });
  await expect(rail).toBeVisible();
  const box = (await rail.boundingBox())!;
  expect([Math.round(box.x), Math.round(box.width)]).toEqual([6, 48]);

  // The panel is open at first at this width, beside the icon rail, and its icon is the pressed one; the toolbar's button is the compact window's.
  await expect(info).toBeVisible();
  await expect(library).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#library-toggle')).toBeHidden();
  await page.locator('#file-input').setInputFiles({ name: 'alpha.txt', mimeType: 'text/plain', buffer: Buffer.from('alpha\n\nBody.\n') });
  await expect(page.locator('#filename')).toHaveText('alpha.txt');
  const geometry = async () => ({ workspace: await page.locator('#workspace').boundingBox(), host: await page.locator('.reader-host:not(.staging):not(.tab-hidden)').boundingBox() });
  // Docked: the reading panel starts after the 6 px margin, the rail, a 6 px gap, the 270 px panel, its 10 px handle and a 6 px margin.
  expect(Math.round((await info.boundingBox())!.x)).toBe(60);
  await expect.poll(async () => { const at = (await geometry()).workspace!; return [Math.round(at.x), Math.round(at.width)]; }).toEqual([346, 1080 - 346]);
  const open = await geometry();
  expect(open.host!.x).toBeGreaterThanOrEqual(open.workspace!.x);

  // Pressing the active icon collapses the panel (the icon rail stays) and the page takes the width back; pressing it again, or Ctrl+B, opens it.
  await library.click();
  await expect(info).toBeHidden();
  await expect(rail).toBeVisible();
  await expect(library).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => { const at = (await geometry()).workspace!; return [Math.round(at.x), Math.round(at.width)]; }).toEqual([0, 1080]);
  await library.click();
  await expect(info).toBeVisible();
  await page.keyboard.press('Control+b');
  await expect(info).toBeHidden();
  await page.keyboard.press('Control+b');
  await expect(info).toBeVisible();
  await expect.poll(geometry).toEqual(open);

  // On the right once the library is kept there, with the find bar clear of the rail.
  await chooseLibrarySide(page, 'right');
  await expect.poll(async () => { const at = (await geometry()).workspace!; return [Math.round(at.x), Math.round(at.width)]; }).toEqual([0, 1080 - 346]);
  expect((await info.boundingBox())!.x + (await info.boundingBox())!.width).toBeLessThanOrEqual(1080 - 60 + .5);
  await library.click(); await expect(info).toBeHidden();
  const right = (await rail.boundingBox())!;
  expect(right.x).toBeGreaterThan(1080 - 6 - 48 - 1);
  await page.keyboard.press('Control+f');
  const find = page.locator('#find-bar');
  await expect(find).toBeVisible();
  const bar = (await find.boundingBox())!;
  expect(bar.x + bar.width).toBeLessThanOrEqual(right.x);
  await page.keyboard.press('Escape');

  // Compact windows have no icon rail, and keep the sheet.
  await page.setViewportSize({ width: 600, height: 680 });
  await expect(rail).toBeHidden();
  await expect(page.locator('#library-toggle')).toBeVisible();
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
  if (await page.locator('#library-root').isVisible()) await page.locator('#library-rail').getByRole('button', { name: 'Library', exact: true }).click();
  await expect(page.locator('#library-root')).toBeHidden();
  await expect(page.locator('#library-rail')).toBeVisible();
  await page.locator('.pdf-reader').focus();
  await page.keyboard.press('Control+3');
  for (let step = 0; step < 3; step++) await page.keyboard.press('Control+-');
  await page.getByRole('button', { name: 'Hand tool' }).click();
  await page.keyboard.press('Control+4');
  await expect(page.locator('#page-strip')).toBeVisible();
}

for (const side of ['right', 'left'] as const) {
  test(`with the icon rail on the ${side}, the rail, the page strip, the footer and the view controls never overlap, and the footer stays whole and clickable`, async ({ page }) => {
    await openReading(page, side);
    const rail = page.locator('#library-rail'), strip = page.locator('#page-strip'), pill = page.locator('#view-controls'), footer = page.locator('footer');
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
    const other = side === 'right' ? 'left' : 'right';
    await chooseLibrarySide(page, other);
    await expect(rail).toBeVisible();
    await expect(rail).toHaveAttribute('data-library-side', other);
    // The pill and the strip re-resolve against the rail on its new side (on the next frame).
    await expect.poll(async () => { const [railBox, pillBox, stripBox] = [await boxOf(rail), await boxOf(pill), await boxOf(strip)]; return apart(railBox, pillBox) && apart(railBox, stripBox); }).toBe(true);
  });
}

for (const side of ['left', 'right'] as const) {
  test(`the open panel docked ${side}, beside the icon rail, with the page strip, ends above the footer and the strip and the pill start beside both`, async ({ page }) => {
    await openReading(page, side);
    await page.locator('#library-rail').getByRole('button', { name: 'Library', exact: true }).click();
    const drawer = page.locator('#library-root'), rail = page.locator('#library-rail'), strip = page.locator('#page-strip'), footer = page.locator('footer'), pill = page.locator('#view-controls');
    await expect(drawer).toBeVisible();
    await page.mouse.move(486, 855);
    await expect.poll(async () => { const box = await boxOf(footer); return Math.round(box.y + box.height); }).toBe(858);
    const [d, r, s, f, p] = [await boxOf(drawer), await boxOf(rail), await boxOf(strip), await boxOf(footer), await boxOf(pill)];
    expect(apart(d, s) && apart(d, f) && apart(s, f) && apart(r, d) && apart(r, s) && apart(r, f) && apart(d, p) && apart(r, p)).toBe(true);
    expect(d.y + d.height).toBeLessThanOrEqual(f.y + .5);
    if (side === 'left') expect(s.x).toBeGreaterThanOrEqual(d.x + d.width); else expect(s.x + s.width).toBeLessThanOrEqual(d.x);
  });
}

test('a compact window has no icon rail and its sheet still covers the whole layout', async ({ page }) => {
  await openReading(page, 'left');
  await page.setViewportSize({ width: 600, height: 700 });
  await expect(page.locator('#library-rail')).toBeHidden();
  await page.locator('#library-toggle').click();
  await expect(page.locator('#library-root')).toBeVisible();
  const layout = await boxOf(page.locator('#reader-layout')), sheet = await boxOf(page.locator('#library-root'));
  expect(Math.round(sheet.y + sheet.height)).toBe(Math.round(layout.y + layout.height));
});

test('the rail has exactly four buttons; the library side is chosen in Settings › Appearance, shared with the palette command, and a reload keeps it', async ({ page }) => {
  await page.setViewportSize({ width: 1080, height: 680 });
  await page.goto('/');
  const rail = page.locator('#library-rail'), key = 'hold-my-brief:library-side';
  const side = () => page.evaluate(k => localStorage.getItem(k), key);
  await expect(rail).toBeVisible();
  await expect(rail).toHaveAttribute('data-library-side', 'left');

  // Library, Search, Add files, then a spacer, then Settings: no Home, Favorites, Collections and no side button.
  const buttons = rail.getByRole('button');
  expect(await buttons.evaluateAll(list => list.map(button => button.getAttribute('aria-label')))).toEqual(['Library', 'Search', 'Add files', 'Settings']);
  const ys = await buttons.evaluateAll(list => list.map(button => { const box = button.getBoundingClientRect(); return [Math.round(box.y), Math.round(box.y + box.height)]; }));
  expect(ys.map(([top]) => top)).toEqual([...ys.map(([top]) => top)].sort((a, b) => a - b));
  expect(ys[3]![0]! - ys[2]![1]!).toBeGreaterThan(100); // the spacer
  expect(await page.getByRole('button', { name: /Move library/ }).count()).toBe(0);
  // The rail's own context menu is gone with the button: right-clicking it opens nothing.
  await rail.click({ button: 'right', position: { x: 30, y: 200 } });
  await expect(page.getByRole('menu')).toHaveCount(0);

  // Settings opens Appearance, where the side is a two-option control that keeps the same saved setting.
  await rail.getByRole('button', { name: 'Settings', exact: true }).click();
  const sheet = page.locator('#appearance');
  await expect(sheet).toBeVisible();
  const left = sheet.getByRole('radio', { name: 'Library on the left' }), right = sheet.getByRole('radio', { name: 'Library on the right' });
  await expect(left).toHaveAttribute('aria-checked', 'true');
  await expect(right).toHaveAttribute('aria-checked', 'false');
  await right.click();
  expect(await side()).toBe('right');
  await expect(right).toHaveAttribute('aria-checked', 'true');
  await expect(left).toHaveAttribute('aria-checked', 'false');
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(rail).toHaveAttribute('data-library-side', 'right');
  expect((await boxOf(rail)).x).toBeGreaterThan(1080 - 6 - 48 - 1);
  // The panel beside it follows to the right.
  expect((await boxOf(page.locator('#library-root'))).x).toBeGreaterThan(1080 / 2);

  // The palette command moves the same preference, and the rail and the sheet follow.
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: 'Go to, find or run a command' }).fill('Move library to other side');
  await page.keyboard.press('Enter');
  await expect(rail).toHaveAttribute('data-library-side', 'left');
  expect(await side()).toBe('left');
  expect((await boxOf(rail)).x).toBeLessThan(10);
  expect((await boxOf(page.locator('#library-root'))).x).toBeLessThan(1080 / 2);
  await rail.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(left).toHaveAttribute('aria-checked', 'true');
  await right.click();
  await page.keyboard.press('Escape');

  // The side survives a reload, rail and panel alike, and Settings shows it.
  await page.reload();
  await expect(rail).toBeVisible();
  await expect(rail).toHaveAttribute('data-library-side', 'right');
  expect((await boxOf(rail)).x).toBeGreaterThan(1080 - 6 - 48 - 1);
  await expect(page.locator('#library-root')).toBeVisible();
  expect((await boxOf(page.locator('#library-root'))).x).toBeGreaterThan(1080 / 2);
  await rail.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(sheet.getByRole('radio', { name: 'Library on the right' })).toHaveAttribute('aria-checked', 'true');
});

test('a user with the library kept on the right (the setting stored before Settings had a control) still has it there', async ({ page }) => {
  await page.setViewportSize({ width: 1080, height: 680 });
  await page.addInitScript(() => localStorage.setItem('hold-my-brief:library-side', 'right'));
  await page.goto('/');
  await expect(page.locator('#library-rail')).toHaveAttribute('data-library-side', 'right');
  await page.locator('#library-rail').getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Library on the right' })).toHaveAttribute('aria-checked', 'true');
});

test('rail tooltips show only while the panel is closed: an open panel names the view itself and the tip would sit over its title and filter field', async ({ page }) => {
  await page.setViewportSize({ width: 1080, height: 680 });
  await page.goto('/');
  const rail = page.locator('#library-rail'), info = page.locator('#library-root');
  const search = rail.getByRole('button', { name: 'Search', exact: true });
  const tip = (locator: Locator) => locator.evaluate(button => { const style = getComputedStyle(button, '::after'); return { content: style.content, display: style.display, opacity: style.opacity }; });
  await expect(info).toBeVisible();
  await search.hover();
  await page.waitForTimeout(600); // longer than the tooltip's hover delay
  const open = await tip(search);
  expect(open.content === 'none' || open.display === 'none' || open.opacity === '0').toBe(true);
  // Closed, the same hover draws it, with the shortcut.
  await rail.getByRole('button', { name: 'Library', exact: true }).click();
  await expect(info).toBeHidden();
  await page.mouse.move(600, 300); await search.hover();
  await expect.poll(async () => (await tip(search)).opacity).toBe('1');
  expect((await tip(search)).display).not.toBe('none');
  expect(await search.getAttribute('data-tip')).toBe('Search  Ctrl+Shift+F');
  // Open again: no tooltip is drawn, even with the pointer still resting on the icon.
  await rail.getByRole('button', { name: 'Library', exact: true }).click();
  await expect(info).toBeVisible();
  await search.hover(); await page.waitForTimeout(600);
  const again = await tip(search);
  expect(again.content === 'none' || again.display === 'none' || again.opacity === '0').toBe(true);
});

const homeDocuments: FixtureDocument[] = [
  { name: 'Alpha.pdf', format: 'pdf', opened: 1, favorite: true }, { name: 'Beta.txt', format: 'txt', opened: 2 }, { name: 'Gamma.md', format: 'md', opened: 3 }, { name: 'Delta.txt', format: 'txt', opened: 4 },
];
for (const width of [1440, 900]) for (const side of ['left', 'right'] as const) {
  test(`at ${width} px the panel opens docked on the ${side}: Home's first chip and card, and the reader's page, lie beside it and never under it`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.addInitScript(([value]) => { localStorage.setItem('hold-my-brief:library-wide', 'closed'); localStorage.setItem('hold-my-brief:library-side', value!); }, [side]);
    await seedLibrary(page, homeDocuments);
    const rail = page.locator('#library-rail'), info = page.locator('#library-root'), panel = page.locator('.library-panel');
    await expect(page.getByRole('heading', { name: 'Home', level: 1 })).toBeVisible();
    await expect(info).toBeHidden();
    await rail.getByRole('button', { name: 'Library', exact: true }).click();
    await expect(info).toBeVisible();
    // The panel's edge nearest the page, and what lies on the page's side of it.
    const beyond = async (target: Locator) => {
      const edge = await boxOf(panel), at = await boxOf(target);
      return side === 'left' ? at.x - (edge.x + edge.width) : edge.x - (at.x + at.width);
    };
    const chip = page.locator('#empty .home-chip').first(), card = page.locator('#empty [data-home-path]').first();
    await expect(chip).toBeVisible(); await expect(card).toBeVisible();
    await expect.poll(() => beyond(chip)).toBeGreaterThanOrEqual(0);
    await expect.poll(() => beyond(card)).toBeGreaterThanOrEqual(0);
    // The reading panel itself is what is left of the window, and Home's content is laid out inside it.
    const work = await boxOf(page.locator('#workspace'));
    expect(Math.round(work.width)).toBe(width - 270 - 76);
    const homeBox = await boxOf(page.locator('#empty'));
    expect(homeBox.x).toBeGreaterThanOrEqual(work.x - .5); expect(homeBox.x + homeBox.width).toBeLessThanOrEqual(work.x + work.width + .5);

    // The same for a document: its page box starts beside the panel, at the panel's own width.
    await page.locator('#file-input').setInputFiles({ name: 'dock.pdf', mimeType: 'application/pdf', buffer: pagedPdf(3) });
    await expect(page.locator('#position')).toContainText('Page 1 of 3');
    await expect(page.locator('#loading')).toBeHidden();
    const sheet = page.locator('.pdf-page canvas').first();
    await expect(sheet).toBeVisible();
    await expect.poll(() => beyond(sheet)).toBeGreaterThanOrEqual(0);
    await expect.poll(async () => Math.round((await boxOf(page.locator('.pdf-reader'))).width)).toBe(width - 270 - 76);
    // Collapsing it hands the width back, and the page is fitted to the whole window again.
    await rail.getByRole('button', { name: 'Library', exact: true }).click();
    await expect(info).toBeHidden();
    await expect.poll(async () => Math.round((await boxOf(page.locator('.pdf-reader'))).width)).toBe(width);
  });
}

test('Ctrl+Shift+F and the Search icon open the panel, if it is closed, and focus its filter field, which is always visible under the header with a count in its placeholder', async ({ page }) => {
  await page.setViewportSize({ width: 1080, height: 680 });
  await seedLibrary(page, homeDocuments);
  const field = page.getByRole('searchbox', { name: 'Filter the library' }), info = page.locator('#library-root');
  await expect(info).toBeVisible();
  await expect(field).toBeVisible(); // always shown: no icon opens it
  await expect(field).toHaveAttribute('placeholder', 'Filter 4 documents');
  expect(await page.getByRole('button', { name: 'Filter the library' }).count()).toBe(0);
  const header = await boxOf(page.locator('.library-header')), filter = await boxOf(field);
  expect(filter.y).toBeGreaterThanOrEqual(header.y + header.height - 1);
  await page.locator('#workspace').click({ position: { x: 300, y: 300 } });
  await page.keyboard.press('Control+Shift+F');
  await expect(field).toBeFocused();
  // Closed, it opens the panel first.
  await page.locator('#workspace').click({ position: { x: 300, y: 300 } });
  await page.keyboard.press('Control+b');
  await expect(info).toBeHidden();
  await page.keyboard.press('Control+Shift+F');
  await expect(info).toBeVisible();
  await expect(field).toBeFocused();
  // The Search icon does the same, and pressing it again keeps the panel open on the field.
  await page.locator('#workspace').click({ position: { x: 300, y: 300 } });
  await page.locator('#library-rail').getByRole('button', { name: 'Search', exact: true }).click();
  await expect(field).toBeFocused();
  await page.locator('#library-rail').getByRole('button', { name: 'Search', exact: true }).click();
  await expect(info).toBeVisible();
  await expect(field).toBeFocused();
});

test('in a compact window the page strip also ends above the footer, and the pill stays above the strip', async ({ page }) => {
  await openReading(page, 'left');
  await page.setViewportSize({ width: 600, height: 760 });
  const strip = page.locator('#page-strip'), footer = page.locator('footer'), pill = page.locator('#view-controls');
  await expect(strip).toBeVisible();
  await page.mouse.move(300, 757);
  await expect.poll(async () => { const box = await boxOf(footer); return Math.round(box.y + box.height); }).toBe(760);
  const [s, f, p] = [await boxOf(strip), await boxOf(footer), await boxOf(pill)];
  expect(apart(s, f) && apart(p, s) && apart(p, f)).toBe(true);
  expect(s.x).toBe(0); expect(s.width).toBe(600);
});
