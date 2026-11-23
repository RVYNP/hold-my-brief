import { expect, type Locator, type Page } from '@playwright/test';
import { openSettings } from './settings-controls';

/** The Sort and filter button: the one menu for sort and availability. */
export const viewMenuButton = (page: Page) => page.getByRole('button', { name: /Sort and filter options/ });

/** The Library tab's page, in the reading panel. */
export const libraryPage = (page: Page) => page.locator('#library-page');

/** The pinned Library tab at the front of the top bar. */
export const libraryTab = (page: Page) => page.locator('#library-pin');

/** Chooses List or Grid (the toggle beside the sort button) or a radio item of the sort menu (Recent, Name A–Z, Any availability, Ready, Missing) and closes the menu. */
export async function chooseFromViewMenu(page: Page, name: string) {
  if (name === 'List' || name === 'Grid') { await page.getByRole('button', { name: `${name} view` }).click(); return; }
  await viewMenuButton(page).click();
  await page.getByRole('menuitemradio', { name, exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.library-view-menu:not(.library-scope-menu)')).toBeHidden();
}

/** Opens the Library tab on all documents (the panel's "Library" title, a button) and waits for its page. */
export async function openLibraryTab(page: Page) {
  await page.locator('#library-root').getByRole('button', { name: 'Library', exact: true }).click();
  await expect(libraryPage(page)).toBeVisible();
}

/** The Library tab's search field, which is always shown there. */
export async function openSearch(page: Page): Promise<Locator> {
  const field = page.locator('.library-search');
  await expect(field).toBeVisible();
  return field;
}

/** Opens the Add files menu (the icon rail's button from 720 px up, the header's + below it) and returns one of its items ('Add local documents or images' or 'Index folders and manage source locations'). */
export async function addMenuItem(page: Page, name: string) {
  const door = page.viewportSize()!.width >= 720 ? page.locator('#library-rail').getByRole('button', { name: 'Add files', exact: true }) : page.getByRole('button', { name: 'Add files or manage sources' });
  await door.click();
  return page.getByRole('menuitem', { name });
}

/** A saved choice for the whole library, so a test that needs tiles does not depend on the default (grid only when half the documents can show a picture). */
export const preferGrid = (page: Page) => page.addInitScript(() => localStorage.setItem('hold-my-brief:library-view:all', 'grid'));

/** The library's door at the window's width: the icon rail's Library button from 720 px up, the toolbar's button below it. */
export const libraryToggle = (page: Page) => page.viewportSize()!.width >= 720 ? page.locator('#library-rail').getByRole('button', { name: 'Library', exact: true }) : page.locator('#library-toggle');

/** Puts the library on `side` with Settings › General › Library (a no-op when it is already there). */
export async function chooseLibrarySide(page: Page, side: 'left' | 'right') {
  const sheet = await openSettings(page);
  await sheet.getByRole('tab', { name: 'General', exact: true }).click();
  await sheet.getByRole('radiogroup', { name: 'SIDE' }).getByRole('radio', { name: side === 'right' ? 'Right' : 'Left', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(page.locator('#library-rail')).toHaveAttribute('data-library-side', side);
}
