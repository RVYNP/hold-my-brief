import type { Browser } from '@playwright/test';

/**
 * Opens one text document in a throwaway page. A cold dev server finds the reader's dependencies the first time a document opens
 * and reloads every page it serves once they are bundled; doing that here keeps the reload from landing in the middle of a test.
 */
export async function warmDevServer(browser: Browser, baseURL: string | undefined) {
  const page = await browser.newPage({ baseURL });
  await page.goto('/');
  await page.locator('#file-input').setInputFiles({ name: 'warm.txt', mimeType: 'text/plain', buffer: Buffer.from('warm\n') });
  await page.locator('#filename').filter({ hasText: 'warm.txt' }).waitFor();
  await page.waitForTimeout(1500);
  await page.close();
}
