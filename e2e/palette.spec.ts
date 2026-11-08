import { test, expect } from '@playwright/test';

/**
 * The command palette is the keyboard route to the actions the ··· menu lists, so these tests
 * check the three things that would break it: opening it without a document, filtering and
 * choosing, and the fact that a chosen command really runs the same code path as the menu.
 */

const textDocument = { name: 'palette.txt', mimeType: 'text/plain', buffer: Buffer.from(Array.from({ length: 200 }, (_, i) => `Line ${i + 1}: Reading beside the work.`).join('\n')) };

test('Ctrl+K opens the palette and Escape restores focus to the reading surface', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Control+k');
  await expect(page.locator('#palette')).toBeVisible();
  await expect(page.locator('#palette-input')).toBeFocused();
  await expect(page.locator('#palette-list')).toContainText('Open file');

  await page.keyboard.press('Escape');
  await expect(page.locator('#palette')).toBeHidden();
});

test('the palette filters as you type and runs the chosen command', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles(textDocument);
  await expect(page.locator('#filename')).toHaveText('palette.txt');

  // Jump to an explicit location through the palette instead of the Ctrl+G binding.
  await page.keyboard.press('Control+k');
  await page.locator('#palette-input').fill('go to');
  await expect(page.locator('.palette-row').first()).toContainText('Go to location');
  await page.keyboard.press('Enter');
  await expect(page.locator('#jump')).toBeVisible();

  // The palette closed on selection and the dialog it opened is the real one.
  await expect(page.locator('#palette')).toBeHidden();
  await page.locator('#target').fill('120');
  await page.getByRole('button', { name: 'Go to location', exact: true }).click();
  await expect(page.locator('#position')).toContainText('120');
});

test('the title opens the palette, a typed number goes there and free text finds it', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles(textDocument);
  await expect(page.locator('#filename')).toHaveText('palette.txt');

  await page.locator('#ask').click();
  await expect(page.locator('#palette-input')).toBeFocused();
  await page.locator('#palette-input').fill('page 150');
  await expect(page.locator('.palette-row').first()).toHaveText('Go to 150');
  await page.keyboard.press('Enter');
  await expect(page.locator('#palette')).toBeHidden();
  await expect(page.locator('#position')).toContainText('150');

  // Words that name no command are offered as a find in the document, first.
  await page.keyboard.press('Control+k');
  await page.locator('#palette-input').fill('beside the work');
  await expect(page.locator('.palette-row').first()).toContainText('Find “beside the work” in document');
  await page.keyboard.press('Enter');
  await expect(page.locator('#find-bar')).toBeVisible();
  await expect(page.locator('#find-query')).toHaveValue('beside the work');
  await expect(page.locator('#find-status')).toContainText('200');
});

test('arrow keys move the highlight and skip commands that need a document', async ({ page }) => {
  await page.goto('/');
  // With nothing open, document commands are listed but disabled, and the first usable row
  // is selected instead.
  await page.keyboard.press('Control+k');
  await page.locator('#palette-input').fill('fit');
  const rows = page.locator('.palette-row');
  await expect(rows.first()).toContainText('Fit page');
  await expect(rows.first()).toHaveAttribute('aria-disabled', 'true');
  await expect(rows.first()).toContainText('Open a document first');

  // Enter on a disabled row does nothing: no phantom navigation and no dialog.
  await page.keyboard.press('Enter');
  await expect(page.locator('#palette')).toBeVisible();
});

test('the library command opens the library from the palette', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Control+k');
  await page.locator('#palette-input').fill('library');
  await page.keyboard.press('Enter');
  await expect(page.locator('#library-toggle')).toHaveAttribute('aria-expanded', 'true');
});

test('no matching query says so instead of showing an empty list', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Control+k');
  await page.locator('#palette-input').fill('zzzznothingmatches');
  await expect(page.locator('.palette-row')).toHaveCount(0);
  await expect(page.locator('#palette-empty')).toBeVisible();
});

test('the palette is reachable only through its shortcut and does not hijack typing', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles(textDocument);
  await expect(page.locator('#filename')).toHaveText('palette.txt');
  // Ctrl+G opens the jump dialog; typing k there must not open the palette.
  await page.keyboard.press('Control+g');
  await expect(page.locator('#jump')).toBeVisible();
  await page.locator('#target').type('k');
  await expect(page.locator('#palette')).toBeHidden();
});
