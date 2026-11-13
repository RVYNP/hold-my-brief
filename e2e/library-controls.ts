import { expect, type Locator, type Page } from '@playwright/test';

/** The Recent ☰ button: the one menu for sort, view and availability. */
export const viewMenuButton = (page: Page) => page.getByRole('button', { name: /Sort, view and filter options/ });

/** Chooses a radio item of the Recent ☰ menu (Recent, Name A–Z, List, Grid, Any availability, Ready, Missing) and closes the menu. */
export async function chooseFromViewMenu(page: Page, name: string) {
  await viewMenuButton(page).click();
  await page.getByRole('menuitemradio', { name, exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.library-view-menu')).toBeHidden();
}

/** Opens the library board across the reading panel (from the info rail's → button) and waits for it. */
export async function openBoard(page: Page) {
  await page.getByRole('button', { name: 'Open library board' }).click();
  await expect(page.locator('#library-root')).toHaveClass(/is-board/);
}

/** The board's search field, which is always shown there. */
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

/** A saved choice for the whole library, so a test that needs tiles does not depend on the width-based default (a drawer under 400 px opens on list). */
export const preferGrid = (page: Page) => page.addInitScript(() => localStorage.setItem('hold-my-brief:library-view:all', 'grid'));

/** The library's door at the window's width: the icon rail's Library button from 720 px up, the toolbar's button below it. */
export const libraryToggle = (page: Page) => page.viewportSize()!.width >= 720 ? page.locator('#library-rail').getByRole('button', { name: 'Library', exact: true }) : page.locator('#library-toggle');
