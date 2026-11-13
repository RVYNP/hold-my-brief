import { test, expect, type Page } from '@playwright/test';
import { ZipWriter, Uint8ArrayWriter, TextReader } from '@zip.js/zip.js';
import { pagedPdf } from './paged-pdf';

const PAGES = 30;
/** A reflowable EPUB long enough to scroll through, so a position partway in is a real percentage. */
async function longEpub() {
  const writer = new ZipWriter(new Uint8ArrayWriter(), { useWebWorkers: false });
  const chapter = (title: string) => `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head><body><h1>${title}</h1>${Array.from({ length: 80 }, (_, n) => `<p>Passage ${n + 1}: The reader keeps a stable place beside your work. This paragraph supplies natural flowing text across several displayed pages.</p>`).join('')}</body></html>`;
  const files: Record<string, string> = {
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    'OPS/book.opf': '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">progress-flow</dc:identifier><dc:title>Progress book</dc:title><dc:language>en</dc:language></metadata><manifest><item id="c1" href="one.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="two.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>',
    'OPS/nav.xhtml': '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol><li><a href="one.xhtml">One</a></li><li><a href="two.xhtml">Two</a></li></ol></nav></body></html>',
    'OPS/one.xhtml': chapter('Chapter one'), 'OPS/two.xhtml': chapter('Chapter two'),
  };
  for (const [name, text] of Object.entries(files)) await writer.add(name, new TextReader(text), { level: name === 'mimetype' ? 0 : 6, lastModDate: new Date('2026-01-01T00:00:00Z'), extendedTimestamp: false });
  return Buffer.from(await writer.close());
}

async function start(page: Page) {
  await page.setViewportSize({ width: 1080, height: 680 });
  await page.addInitScript(() => localStorage.setItem('hold-my-brief:library-view:all', 'list'));
  await page.goto('/');
}
async function goTo(page: Page, target: string) {
  await page.keyboard.press('Control+g'); await page.locator('#target').fill(target);
  await page.getByRole('button', { name: 'Go to location', exact: true }).click();
}
/** Closes the library and opens it again, which is when it reads what was saved. */
async function reopenLibrary(page: Page) {
  const drawer = page.locator('#library-root');
  if (await drawer.isVisible()) await page.locator('#library-toggle').click();
  await expect(drawer).toBeHidden();
  await page.locator('#library-toggle').click();
  await expect(drawer).toBeVisible();
}

test('a PDF row says which page the reader got to, the rail cover repeats it, and the last page is Finished', async ({ page }) => {
  await start(page);
  await page.locator('#file-input').setInputFiles({ name: 'progress.pdf', mimeType: 'application/pdf', buffer: pagedPdf(PAGES) });
  await expect(page.locator('#position')).toContainText(`Page 1 of ${PAGES}`);
  await expect(page.locator('#loading')).toBeHidden();
  await goTo(page, '12');
  await expect(page.locator('#position')).toContainText(`Page 12 of ${PAGES}`);

  await reopenLibrary(page);
  const meta = page.locator('.library-document[data-doc-path] .library-row-meta');
  await expect(meta).toHaveText(`PDF · p. 12 / ${PAGES} · Reading`);

  // The closed library's cover is named with it.
  await page.locator('#library-toggle').click();
  await expect(page.locator('.library-rail-cover')).toHaveAttribute('title', `progress.pdf · p. 12 / ${PAGES}`);

  await goTo(page, String(PAGES));
  await expect(page.locator('#position')).toContainText(`Page ${PAGES} of ${PAGES}`);
  await reopenLibrary(page);
  await expect(meta).toHaveText('PDF · Finished · Reading');
});

test('an EPUB row shows a percentage, and a text file does too', async ({ page }) => {
  await start(page);
  await page.locator('#file-input').setInputFiles({ name: 'progress.epub', mimeType: 'application/epub+zip', buffer: await longEpub() });
  await expect(page.locator('#filename')).toHaveText('progress.epub');
  await expect(page.locator('#position')).toContainText('One');
  await goTo(page, '40%');
  await expect(page.locator('#position')).toContainText(/≈(3\d|4\d)%/);
  const shown = Number(/≈(\d+)%/.exec(await page.locator('#position').innerText())![1]);

  await reopenLibrary(page);
  const epub = page.locator('.library-document[data-doc-path$="progress.epub"] .library-row-meta');
  await expect(epub).toHaveText(`EPUB · ${shown} % · Reading · progress.epub`);

  // A text file, jumped to a line in its middle.
  await page.locator('#file-input').setInputFiles({ name: 'long.txt', mimeType: 'text/plain', buffer: Buffer.from(Array.from({ length: 200 }, (_, n) => `Line number ${n + 1}.`).join('\n')) });
  await expect(page.locator('#filename')).toHaveText('long.txt');
  await goTo(page, '100');
  await reopenLibrary(page);
  await expect(page.locator('.library-document[data-doc-path$="long.txt"] .library-row-meta')).toHaveText(/^TXT · (4\d|5\d) % · Reading$/);
});

test('progress for the browser build survives a reload', async ({ page }) => {
  await start(page);
  await page.locator('#file-input').setInputFiles({ name: 'progress.pdf', mimeType: 'application/pdf', buffer: pagedPdf(PAGES) });
  await expect(page.locator('#position')).toContainText(`Page 1 of ${PAGES}`);
  await goTo(page, '7');
  await expect(page.locator('#position')).toContainText(`Page 7 of ${PAGES}`);
  await expect.poll(() => page.evaluate(() => Object.entries(localStorage).some(([key, value]) => key.startsWith('hold-my-brief:') && value.includes('"pages":30')))).toBe(true);
  await page.reload();
  await expect(page.locator('.library-document[data-doc-path] .library-row-meta')).toHaveText(`PDF · p. 7 / ${PAGES}`);
});
