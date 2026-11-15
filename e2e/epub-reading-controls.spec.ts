import { test, expect, type Page } from '@playwright/test';
import { ZipWriter, Uint8ArrayWriter, TextReader } from '@zip.js/zip.js';
import { chapterBook } from './epub-book';

type Book = Parameters<typeof chapterBook>[0];
const novel: Book = { chapters: 4, paragraphs: 40, nested: true };
const reference: Book = { chapters: 4, paragraphs: 40, code: true };

type BookFile = { name: string; mimeType: string; buffer: Buffer };
async function bookFile(options: Book): Promise<BookFile> {
  return { name: 'chapters.epub', mimeType: 'application/epub+zip', buffer: await chapterBook(options) };
}
async function openFile(page: Page, file: BookFile) {
  await page.locator('#file-input').setInputFiles(file);
  await expect(page.locator('#position')).toContainText('%');
  await expect(page.locator('#view-controls')).toBeVisible();
  await page.locator('.reader-host').focus();
}
async function openBook(page: Page, options: Book, width = 1440) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/');
  await openFile(page, await bookFile(options));
}
const footer = (page: Page) => page.locator('#position');
const flowOf = (page: Page) => page.evaluate(() => (document.querySelector('foliate-view') as unknown as { renderer: HTMLElement }).renderer.getAttribute('flow'));
const percent = async (page: Page) => Number(/(\d+(?:\.\d+)?)%/.exec(await footer(page).innerText())![1]);
/** The font size the book's text is drawn at, read from the content frame. */
const renderedFont = (page: Page) => page.evaluate(() => {
  const view = document.querySelector('foliate-view') as unknown as { renderer: { getContents: () => { doc: Document }[] } };
  const doc = view.renderer.getContents()[0].doc;
  return parseFloat(doc.defaultView!.getComputedStyle(doc.body).fontSize);
});
const contents = (page: Page) => page.locator('#contents');
async function openContents(page: Page) {
  await page.locator('#view-contents').click();
  await expect(contents(page)).toBeVisible();
}

test('a reflowable EPUB shows Contents, Pages | Scroll and A− size A+ in the pill, and none of the zoom controls', async ({ page }) => {
  await openBook(page, novel);
  const pill = page.locator('#view-controls');
  await expect(pill.locator('#view-contents')).toHaveText('Contents');
  await expect(pill.locator('#flow-pages')).toHaveText('Pages');
  await expect(pill.locator('#flow-scroll')).toHaveText('Scroll');
  await expect(pill.locator('#text-smaller')).toHaveText('A−');
  await expect(pill.locator('#text-size')).toHaveText('18');
  await expect(pill.locator('#text-larger')).toHaveText('A+');
  for (const id of ['zoom-out', 'zoom-level', 'zoom-in', 'hand-tool', 'view-layout', 'view-previews']) await expect(pill.locator(`#${id}`)).toBeHidden();
  await expect(pill.locator('#flow-pages')).toHaveAttribute('aria-pressed', 'true');
  await expect(pill.locator('#flow-scroll')).toHaveAttribute('aria-pressed', 'false');
});

test('Contents opens above the pill, lists cleaned labels with their nesting and pages, marks the current entry, and navigates', async ({ page }) => {
  await openBook(page, novel);
  await openContents(page);
  const entries = contents(page).locator('.outline-entry');
  // The title page keeps its raw label (cleaning finds nothing); the chapters are cleaned; the subsection is nested one level.
  await expect(entries.locator('.outline-label')).toHaveText(['THE GENERATED   BOOK.', 'Chapter 1', 'A subsection', 'Chapter 2', 'Chapter 3', 'Chapter 4'].map(text => text.replace(/\s+/g, ' ')));
  await expect(entries.locator('.outline-page').first()).toHaveText(/^p\. ~1$/);
  for (const page_ of await entries.locator('.outline-page').allInnerTexts()) expect(page_).toMatch(/^p\. ~\d+$/);
  const depths = await entries.evaluateAll(buttons => buttons.map(button => (button as HTMLElement).style.getPropertyValue('--depth')));
  expect(depths).toEqual(['0', '0', '1', '0', '0', '0']);
  // The subsection points into the chapter, so it is on a later page than the chapter's own start.
  const pages = (await entries.locator('.outline-page').allInnerTexts()).map(text => Number(/\d+/.exec(text)![0]));
  expect(pages[2]).toBeGreaterThan(pages[1]);
  expect(pages[3]).toBeGreaterThan(pages[2]);
  // It stands above the pill, not under the toolbar.
  const [box, pill] = await Promise.all([contents(page).boundingBox(), page.locator('#view-controls').boundingBox()]);
  expect(box!.y + box!.height).toBeLessThanOrEqual(pill!.y);
  // The reader is at the title page, which is the current entry.
  await expect(contents(page).locator('[aria-current=location] .outline-label')).toHaveText('THE GENERATED BOOK.');
  await expect(contents(page).locator('[aria-current=location]')).toBeFocused();
  await page.getByRole('button', { name: /^Chapter 3/ }).click();
  await expect(contents(page)).toBeHidden();
  await expect(footer(page)).toContainText('Chapter 3 of 4');
  await expect(page.locator('.reader-host')).toBeFocused();
  await openContents(page);
  await expect(contents(page).locator('[aria-current=location] .outline-label')).toHaveText('Chapter 3');
  await expect(contents(page).locator('[aria-current=location]')).toHaveCount(1);
});

test('in Contents, the arrow keys move and Enter goes there and closes; Escape closes without moving', async ({ page }) => {
  await openBook(page, novel);
  await openContents(page);
  await page.keyboard.press('ArrowDown'); // The title page is current; Chapter 1 follows.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(contents(page)).toBeHidden();
  await expect(footer(page)).toContainText('Chapter 2 of 4');
  const where = await footer(page).innerText();
  await openContents(page);
  await page.keyboard.press('Escape');
  await expect(contents(page)).toBeHidden();
  await expect(footer(page)).toHaveText(where);
});

test('the Contents command in the palette opens the same popover', async ({ page }) => {
  await openBook(page, novel);
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox').fill('contents');
  await page.keyboard.press('Enter');
  await expect(contents(page).locator('.outline-entry')).toHaveCount(6);
  const [box, pill] = await Promise.all([contents(page).boundingBox(), page.locator('#view-controls').boundingBox()]);
  expect(box!.y + box!.height).toBeLessThanOrEqual(pill!.y);
});

test('a code-heavy book opens in Scroll and a novel in Pages', async ({ page }) => {
  await openBook(page, reference);
  await expect(page.locator('#flow-scroll')).toHaveAttribute('aria-pressed', 'true');
  expect(await flowOf(page)).toBe('scrolled');
  await page.goto('/');
  await openFile(page, await bookFile({ chapters: 4, paragraphs: 40 }));
  await expect(page.locator('#flow-pages')).toHaveAttribute('aria-pressed', 'true');
  expect(await flowOf(page)).toBe('paginated');
});

/** The percentage once the footer has stopped moving. */
async function settledPercent(page: Page) {
  let last = -1;
  await expect.poll(async () => { const now = await percent(page), same = now === last; last = now; return same; }).toBe(true);
  return last;
}
async function goToSection(page: Page, section: number) {
  await page.keyboard.press('Control+g');
  await page.locator('#target').fill(String(section));
  await page.getByRole('button', { name: 'Go to location', exact: true }).click();
}

test('Scroll scrolls continuously, and switching back to Pages keeps the place', async ({ page }) => {
  await openBook(page, { chapters: 4, paragraphs: 40 });
  await page.locator('#flow-scroll').click();
  await expect(page.locator('#flow-scroll')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => flowOf(page)).toBe('scrolled');
  await goToSection(page, 3); // The third spine item is Chapter 2: the first is the title page.
  await expect(footer(page)).toContainText('Chapter 2 of 4');
  await page.mouse.move(720, 450);
  const start = await settledPercent(page);
  await page.mouse.wheel(0, 400);
  await expect.poll(() => percent(page)).toBeGreaterThan(start);
  const first = await settledPercent(page);
  await page.mouse.wheel(0, 400);
  await expect.poll(() => percent(page)).toBeGreaterThan(first);
  const scrolled = await settledPercent(page);
  // Continuous: two wheel steps of the same size moved the place by about the same amount, not a page at a time.
  expect(Math.abs((scrolled - first) - (first - start))).toBeLessThan(0.6 * (first - start));
  await expect(footer(page)).toContainText('Chapter 2 of 4');
  await page.locator('#flow-pages').click();
  await expect.poll(() => flowOf(page)).toBe('paginated');
  await expect(page.locator('#flow-pages')).toHaveAttribute('aria-pressed', 'true');
  await expect(footer(page)).toContainText('Chapter 2 of 4');
  // The page that holds the place is within a page or two of it.
  expect(Math.abs((await settledPercent(page)) - scrolled)).toBeLessThan(4);
  await page.locator('#flow-scroll').click();
  await expect.poll(() => flowOf(page)).toBe('scrolled');
  await expect(footer(page)).toContainText('Chapter 2 of 4');
  expect(Math.abs((await settledPercent(page)) - scrolled)).toBeLessThan(4);
});

test('a wheel gesture that starts at the end of a chapter carries on into the next', async ({ page }) => {
  await openBook(page, { chapters: 4, paragraphs: 14 });
  await page.locator('#flow-scroll').click();
  await expect.poll(() => flowOf(page)).toBe('scrolled');
  await page.keyboard.press('Control+g');
  await page.locator('#target').fill('2'); // The second spine item is Chapter 1.
  await page.getByRole('button', { name: 'Go to location', exact: true }).click();
  await expect(footer(page)).toContainText('Chapter 1 of 4');
  await page.mouse.move(720, 450);
  // Scroll to the end of the chapter, pause so the gesture ends, then scroll again.
  for (let n = 0; n < 12 && !/Chapter 2 of 4/.test(await footer(page).innerText()); n++) {
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(260);
  }
  await expect(footer(page)).toContainText('Chapter 2 of 4');
});

test('the choice of Pages or Scroll is kept for the document across a reload', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const file = await bookFile(reference);
  await openFile(page, file);
  await expect(page.locator('#flow-scroll')).toHaveAttribute('aria-pressed', 'true'); // Chosen for it by the code samples.
  await page.locator('#flow-pages').click();
  await expect.poll(() => flowOf(page)).toBe('paginated');
  await expect.poll(() => page.evaluate(() => Object.entries(localStorage).some(([key, value]) => key.startsWith('hold-my-brief:') && value.includes('"flow":"paginated"')))).toBe(true);
  await page.reload();
  await openFile(page, file);
  await expect(page.locator('#flow-pages')).toHaveAttribute('aria-pressed', 'true'); // The reader's choice wins over the book's look.
  expect(await flowOf(page)).toBe('paginated');
  await page.locator('#flow-scroll').click();
  await expect.poll(() => page.evaluate(() => Object.entries(localStorage).some(([key, value]) => key.startsWith('hold-my-brief:') && value.includes('"flow":"scrolled"')))).toBe(true);
  await page.reload();
  const novelFile = await bookFile({ chapters: 4, paragraphs: 40 });
  await openFile(page, novelFile);
  await page.locator('#flow-scroll').click();
  await expect.poll(() => page.evaluate(() => Object.entries(localStorage).some(([key, value]) => key.startsWith('hold-my-brief:') && value.includes('"flow":"scrolled"')))).toBe(true);
  await page.reload();
  await openFile(page, novelFile);
  await expect(page.locator('#flow-scroll')).toHaveAttribute('aria-pressed', 'true'); // A novel kept in Scroll stays there.
});

test('the command palette switches between Pages view and Scroll view', async ({ page }) => {
  await openBook(page, { chapters: 4, paragraphs: 40 });
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox').fill('scroll view');
  await page.keyboard.press('Enter');
  await expect.poll(() => flowOf(page)).toBe('scrolled');
  await expect(page.locator('#flow-scroll')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox').fill('pages view');
  await page.keyboard.press('Enter');
  await expect.poll(() => flowOf(page)).toBe('paginated');
  await expect(page.locator('#flow-pages')).toHaveAttribute('aria-pressed', 'true');
});

test('A+ and A− step the text size within the Appearance bounds, in both flows', async ({ page }) => {
  await openBook(page, { chapters: 4, paragraphs: 40 });
  await expect.poll(() => renderedFont(page)).toBe(18);
  await page.locator('#text-larger').click();
  await expect(page.locator('#text-size')).toHaveText('20');
  await expect.poll(() => renderedFont(page)).toBe(20);
  await page.locator('#flow-scroll').click();
  await expect.poll(() => flowOf(page)).toBe('scrolled');
  await page.locator('#text-larger').click();
  await expect(page.locator('#text-size')).toHaveText('22');
  await expect.poll(() => renderedFont(page)).toBe(22);
  await page.locator('#text-smaller').click();
  await page.locator('#text-smaller').click();
  await expect.poll(() => renderedFont(page)).toBe(18);
  // The same option the Appearance text settings edit.
  await page.getByRole('button', { name: 'Reader menu' }).click();
  await page.getByRole('button', { name: /Appearance and text/ }).click();
  await expect(page.locator('#appearance .stepper-value').first()).toHaveText('18 px');
  await page.keyboard.press('Escape');
  for (let n = 0; n < 12; n++) { if (await page.locator('#text-smaller').isDisabled()) break; await page.locator('#text-smaller').click(); }
  await expect(page.locator('#text-size')).toHaveText('12');
  await expect(page.locator('#text-smaller')).toBeDisabled();
  for (let n = 0; n < 16; n++) { if (await page.locator('#text-larger').isDisabled()) break; await page.locator('#text-larger').click(); }
  await expect(page.locator('#text-size')).toHaveText('40');
  await expect(page.locator('#text-larger')).toBeDisabled();
});

/** A fixed-layout EPUB of `pages` one-line pages whose contents list every page. */
async function fixedBook(pages: number) {
  const writer = new ZipWriter(new Uint8ArrayWriter(), { useWebWorkers: false });
  const ids = Array.from({ length: pages }, (_, i) => i + 1);
  const files: Record<string, string> = {
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    'OPS/book.opf': `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">fixed-contents-${pages}</dc:identifier><dc:title>Fixed contents</dc:title><dc:language>en</dc:language><meta property="rendition:layout">pre-paginated</meta></metadata><manifest>${ids.map(n => `<item id="p${n}" href="p${n}.xhtml" media-type="application/xhtml+xml"/>`).join('')}<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine>${ids.map(n => `<itemref idref="p${n}"/>`).join('')}</spine></package>`,
    'OPS/nav.xhtml': `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol>${ids.map(n => `<li><a href="p${n}.xhtml">Plate ${n}</a></li>`).join('')}</ol></nav></body></html>`,
  };
  for (const n of ids) files[`OPS/p${n}.xhtml`] = `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Page ${n}</title><meta name="viewport" content="width=600,height=800"/></head><body><h1>Fixed page ${n}</h1></body></html>`;
  for (const [name, text] of Object.entries(files)) await writer.add(name, new TextReader(text), { level: name === 'mimetype' ? 0 : 6, lastModDate: new Date('2026-01-01T00:00:00Z'), extendedTimestamp: false });
  return Buffer.from(await writer.close());
}

test('Contents of a fixed-layout EPUB shows the spine page each entry starts on, not a text-size estimate', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.locator('#file-input').setInputFiles({ name: 'fixed.epub', mimeType: 'application/epub+zip', buffer: await fixedBook(4) });
  await expect(page.locator('#position')).toContainText('Page 1 of 4');
  await page.getByRole('button', { name: 'Reader menu' }).click();
  await page.getByRole('button', { name: /^Contents/ }).click();
  const entries = contents(page).locator('.outline-entry');
  await expect(entries.locator('.outline-label')).toHaveText(['Plate 1', 'Plate 2', 'Plate 3', 'Plate 4']);
  await expect(entries.locator('.outline-page')).toHaveText(['p. 1', 'p. 2', 'p. 3', 'p. 4']);
});
