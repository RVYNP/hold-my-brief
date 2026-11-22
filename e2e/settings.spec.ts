import { test, expect, type Locator, type Page } from '@playwright/test';
import { chapterBook } from './epub-book';
import { mockDesktop } from './desktop-mock';
import { pagedPdf } from './paged-pdf';
import { openMore, openSettings } from './settings-controls';

// Pin, lock and the ⋯ menu live in Settings; the open document's own actions are the view controls' More menu.
const headings = (sheet: Locator) => sheet.locator('.settings-section:not([hidden]) > .settings-heading h3').allInnerTexts();
const librarySide = (sheet: Locator, name: 'Left' | 'Right') => sheet.getByRole('radiogroup', { name: 'SIDE' }).getByRole('radio', { name, exact: true });
const windowState = (page: Page) => page.evaluate(() => window.__mockWindow);

test('the toolbar holds only the documents: no pin, lock or ⋯ menu, and the rail\'s Settings opens Appearance, Library and More in the browser build', async ({ page }) => {
  await page.setViewportSize({ width: 1080, height: 760 });
  await page.goto('/');
  await expect(page.locator('#library-rail')).toBeVisible();
  await expect(page.locator('#pin, #lock, #menu-toggle, #menu')).toHaveCount(0);
  await expect(page.locator('.toolbar #settings-toggle')).toBeHidden();

  const sheet = await openSettings(page);
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
  await expect(sheet.getByRole('heading', { name: 'Settings', level: 2 })).toBeVisible();
  expect(await headings(sheet)).toEqual(['Appearance', 'Library', 'More']);
  await expect(sheet.locator('#settings-window')).toBeHidden();

  // More: what the ⋯ menu listed besides the document's own actions (the assistant is the desktop app's).
  const more = sheet.locator('#settings-more');
  await expect(more.getByRole('button')).toHaveText(['All commands…Ctrl K', 'Keyboard shortcuts', 'Clear recent files', 'Delete saved reading data…']);
  await more.getByRole('button', { name: 'Keyboard shortcuts' }).click();
  await expect(sheet).toBeHidden();
  await expect(page.locator('#shortcuts')).toBeVisible();
});

test('desktop: Settings starts with Window; Keep on top and Lock size follow their shortcuts while it is open, and the sizes do what the menu items did', async ({ page }) => {
  await mockDesktop(page);
  await page.setViewportSize({ width: 1080, height: 760 });
  await page.goto('/');
  await expect(page.locator('#library-rail')).toBeVisible();
  await expect(page.locator('#pin, #lock, #menu-toggle')).toHaveCount(0);

  const sheet = await openSettings(page);
  expect(await headings(sheet)).toEqual(['Window', 'Agent control', 'Appearance', 'Library', 'More']);
  const pin = sheet.getByRole('switch', { name: 'Keep on top' }), lock = sheet.getByRole('switch', { name: 'Lock size' });
  await expect(pin).toHaveAttribute('aria-checked', 'false');
  await expect(sheet.locator('#settings-window')).toContainText('Ctrl+Shift+T');
  await expect(sheet.locator('#settings-window')).toContainText('Ctrl+Shift+L');

  await page.keyboard.press('Control+Shift+T');
  await expect(pin).toHaveAttribute('aria-checked', 'true');
  expect((await windowState(page)).pinned).toBe(true);
  await page.keyboard.press('Control+Shift+T');
  await expect(pin).toHaveAttribute('aria-checked', 'false');
  await page.keyboard.press('Control+Shift+L');
  await expect(lock).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#caption-maximize')).toBeDisabled();
  await lock.click();
  await expect(lock).toHaveAttribute('aria-checked', 'false');
  await pin.click();
  await expect(pin).toHaveAttribute('aria-checked', 'true');

  // The palette changes the same state; the switches are right the next time the sheet opens.
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: 'Go to, find or run a command' }).fill('Toggle size lock');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await windowState(page)).locked).toBe(true);
  await openSettings(page);
  await expect(pin).toHaveAttribute('aria-checked', 'true');
  await expect(lock).toHaveAttribute('aria-checked', 'true');

  await sheet.getByRole('button', { name: /^Compact/ }).click();
  expect(await windowState(page)).toMatchObject({ width: 420, height: 620 });
  await sheet.getByRole('button', { name: /^Reading/ }).click();
  expect(await windowState(page)).toMatchObject({ width: 760, height: 900 });
  await expect(sheet.getByRole('button', { name: 'AI assistant…' })).toBeVisible();
});

test('Settings › Library › Right moves the library, and a reload keeps it', async ({ page }) => {
  await page.setViewportSize({ width: 1080, height: 760 });
  await page.goto('/');
  const rail = page.locator('#library-rail');
  await expect(rail).toHaveAttribute('data-library-side', 'left');
  const sheet = await openSettings(page);
  await expect(librarySide(sheet, 'Left')).toHaveAttribute('aria-checked', 'true');
  await librarySide(sheet, 'Right').click();
  await expect(rail).toHaveAttribute('data-library-side', 'right');
  expect((await rail.boundingBox())!.x).toBeGreaterThan(1080 / 2);
  await page.reload();
  await expect(rail).toHaveAttribute('data-library-side', 'right');
  await expect(librarySide(await openSettings(page), 'Right')).toHaveAttribute('aria-checked', 'true');
});

for (const desktop of [false, true]) {
  test(`at 420 × 620 the toolbar's Settings button opens the same dialog${desktop ? ' with Window' : ''}, which scrolls inside the window`, async ({ page }) => {
    if (desktop) await mockDesktop(page);
    await page.goto('/');
    await expect(page.locator('#library-rail')).toBeHidden();
    await expect(page.locator('#pin, #lock, #menu-toggle')).toHaveCount(0);
    await expect(page.locator('#library-toggle')).toBeVisible();
    await expect(page.locator('#title')).toBeVisible();
    await page.locator('#settings-toggle').click();
    const sheet = page.getByRole('dialog', { name: 'Settings' });
    await expect(sheet).toBeVisible();
    expect(await headings(sheet)).toEqual(desktop ? ['Window', 'Agent control', 'Appearance', 'Library', 'More'] : ['Appearance', 'Library', 'More']);

    const inside = async (box: Promise<{ x: number; y: number; width: number; height: number } | null>) => {
      const at = (await box)!;
      expect(at.x).toBeGreaterThanOrEqual(0); expect(at.y).toBeGreaterThanOrEqual(0);
      expect(at.x + at.width).toBeLessThanOrEqual(420); expect(at.y + at.height).toBeLessThanOrEqual(620);
    };
    await inside(sheet.boundingBox());
    // The sections scroll inside the sheet; the page behind never grows a scrollbar.
    const body = sheet.locator('.settings-body');
    expect(await body.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
    expect(await page.evaluate(() => document.scrollingElement!.scrollHeight <= innerHeight)).toBe(true);
    const last = sheet.getByRole('button', { name: 'Delete saved reading data…' });
    await last.scrollIntoViewIfNeeded();
    await inside(last.boundingBox());
    await expect(sheet.getByRole('button', { name: 'Close settings' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
  });
}

test('pill › More: Go to…, Back after jump and the page commands; Go to… opens the go-to field; Escape and a press elsewhere close it', async ({ page }) => {
  await page.setViewportSize({ width: 1080, height: 760 });
  await page.goto('/');
  await page.locator('#file-input').setInputFiles({ name: 'five.pdf', mimeType: 'application/pdf', buffer: pagedPdf(5) });
  await expect(page.locator('#position')).toContainText('Page 1 of 5');
  await expect(page.locator('#view-controls')).toBeVisible();
  await expect(page.locator('#view-more')).toHaveAttribute('aria-haspopup', 'menu');
  await expect(page.locator('#view-more')).toHaveAttribute('aria-label', 'More');

  const menu = await openMore(page);
  await expect(page.locator('#view-more')).toHaveAttribute('aria-expanded', 'true');
  await expect(menu.getByRole('menuitem')).toHaveText(['Go to…Ctrl G', 'Back after jumpAlt ←', 'Rotate page 90°']);
  await expect(menu.getByRole('menuitemcheckbox')).toHaveText(['Two-page spreadCtrl 3', 'Cover page alone']);
  await expect(menu.getByRole('menuitemcheckbox', { name: 'Cover page alone' })).toBeDisabled();
  await expect(menu.getByRole('menuitem', { name: 'Contents' })).toHaveCount(0); // This PDF has no outline.
  await menu.getByRole('menuitem', { name: 'Go to…' }).click();
  await expect(menu).toBeHidden();
  await expect(page.locator('#jump')).toBeVisible();
  await expect(page.locator('#target')).toBeFocused();
  await page.locator('#target').fill('4');
  await page.getByRole('button', { name: 'Go to location', exact: true }).click();
  await expect(page.locator('#position')).toContainText('Page 4 of 5');
  // The closing dialog hands focus to the page; only then is the button ours to focus.
  await expect(page.locator('#jump')).toBeHidden();
  await expect(page.locator('.reader-host:not(.staging):not(.tab-hidden)')).toBeFocused();
  // From the keyboard: Enter opens it on its first item, Escape closes it and focus is back on the button.
  await page.locator('#view-more').focus();
  await page.keyboard.press('Enter');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Go to…' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(page.locator('#view-more')).toBeFocused();
  // A choice made after opening it from the keyboard returns focus to the button too.
  await page.keyboard.press('Enter');
  await menu.getByRole('menuitem', { name: 'Rotate page 90°' }).click();
  await expect(menu).toBeHidden();
  await expect(page.locator('#view-more')).toBeFocused();
  // A press elsewhere closes it.
  await page.locator('#view-more').click();
  await expect(menu).toBeVisible();
  await page.mouse.click(300, 400);
  await expect(menu).toBeHidden();
  await expect(page.locator('#view-more')).toHaveAttribute('aria-expanded', 'false');
});

test('pill › More of a reflowable book has no Contents (its pill has one already)', async ({ page }) => {
  await page.setViewportSize({ width: 1080, height: 760 });
  await page.goto('/');
  await page.locator('#file-input').setInputFiles({ name: 'chapters.epub', mimeType: 'application/epub+zip', buffer: await chapterBook({ chapters: 4, paragraphs: 20 }) });
  await expect(page.locator('#position')).toContainText('%');
  await expect(page.locator('#view-controls.is-reading')).toBeVisible();
  await expect(page.locator('#view-contents')).toBeVisible();
  const menu = await openMore(page);
  await expect(menu.getByRole('menuitem')).toHaveText(['Go to…Ctrl G', 'Back after jumpAlt ←']);
  await expect(menu.getByRole('menuitem', { name: 'Contents' })).toHaveCount(0);
});
