import { expect, type Locator, type Page } from '@playwright/test';

/** Opens the Settings sheet with the window's own door: the icon rail's Settings from 720 px up, the toolbar's Settings button below it. */
export async function openSettings(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const sheet = page.locator('#settings');
  await expect(sheet).toBeVisible();
  return sheet;
}

/** Opens the More menu of the view controls (the document's own actions) and returns it. */
export async function openMore(page: Page): Promise<Locator> {
  await page.locator('#view-more').click();
  const menu = page.getByRole('menu', { name: 'More' });
  await expect(menu).toBeVisible();
  return menu;
}

/** Runs a command from the palette by its label, as the keyboard reaches commands that have no other control. */
export async function runFromPalette(page: Page, label: string) {
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: 'Go to, find or run a command' }).fill(label);
  await page.keyboard.press('Enter');
}
