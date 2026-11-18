import { test, expect, type Frame, type Page } from '@playwright/test';
import { xmlChapterBook } from './epub-book';

/** The book's content frame. Foliate keeps its iframe in a closed shadow root, so it is found as a frame of the page, not by selector. */
const frameOf = (page: Page): Frame => page.frames().filter(frame => frame.url().startsWith('blob:')).at(-1)!;

test('a spine item declared application/xml is sanitized and loads nothing from outside', async ({ page, baseURL }) => {
  const local = new URL(baseURL!).host, outside: string[] = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (!['blob:', 'data:', 'about:'].includes(url.protocol) && url.host !== local) outside.push(request.url());
  });
  await page.goto('/');
  await page.locator('#file-input').setInputFiles({ name: 'xml.epub', mimeType: 'application/epub+zip', buffer: await xmlChapterBook() });
  await expect(page.locator('#position')).toContainText('%');
  await expect(page.locator('.reader-host.staging')).toHaveCount(0);
  await expect.poll(() => frameOf(page).locator('p').first().textContent()).toContain('The first chapter text is still here.');
  const frame = frameOf(page);
  expect(await frame.locator('iframe, form, input, img[src^="http"]').count()).toBe(0);
  expect(await frame.locator('meta[http-equiv]').evaluateAll(metas => metas.map(meta => meta.getAttribute('http-equiv')))).toEqual(['Content-Security-Policy']);
  expect(await frame.locator('meta[name="viewport"]').evaluateAll(metas => metas.map(meta => meta.getAttributeNames().sort()))).toEqual([['content', 'name']]);
  expect(await frame.locator('html').innerHTML()).not.toContain('example.invalid');
  expect(outside).toEqual([]);
});
