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

/** Opens the search field from its button when it is folded away, and returns it. */
export async function openSearch(page: Page): Promise<Locator> {
  const field = page.locator('.library-search');
  if (!await field.isVisible()) await page.getByRole('button', { name: 'Show search' }).click();
  await expect(field).toBeVisible();
  return field;
}

/** Opens the + menu and returns one of its items ('Add local documents or images' or 'Index folders and manage source locations'). */
export async function addMenuItem(page: Page, name: string) {
  await page.getByRole('button', { name: 'Add files or manage sources' }).click();
  return page.getByRole('menuitem', { name });
}

/** A saved choice for the whole library, so a test that needs tiles does not depend on the width-based default (a drawer under 400 px opens on list). */
export const preferGrid = (page: Page) => page.addInitScript(() => localStorage.setItem('hold-my-brief:library-view:all', 'grid'));
