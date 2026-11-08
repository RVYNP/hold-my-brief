import { test, expect, type Page } from '@playwright/test';
import { ZipWriter, Uint8ArrayWriter, TextReader } from '@zip.js/zip.js';

/** A PDF whose pages carry "Page N" and the given MediaBox sizes. */
function spreadPdf(sizes: [number, number][]) {
  const stream = (text: string) => `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`;
  const pages = sizes.map((_, i) => 4 + i * 2);
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pages.map(id => `${id} 0 R`).join(' ')}] /Count ${sizes.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ...sizes.flatMap(([width, height], i) => [
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pages[i] + 1} 0 R >>`,
      stream(`BT /F1 28 Tf 30 ${height - 60} Td (Page ${i + 1}) Tj ET`),
    ]),
  ];
  let out = '%PDF-1.7\n'; const offsets: number[] = [];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out);
}

async function fixedEpub(pages: number, rtl = false) {
  const writer = new ZipWriter(new Uint8ArrayWriter(), { useWebWorkers: false });
  const items = Array.from({ length: pages }, (_, i) => i + 1);
  const files: Record<string, string> = {
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    'OPS/book.opf': `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">float-reader-spread-${rtl ? 'rtl' : 'ltr'}</dc:identifier><dc:title>Spread publication</dc:title><dc:language>en</dc:language><meta property="rendition:layout">pre-paginated</meta></metadata><manifest>${items.map(n => `<item id="p${n}" href="p${n}.xhtml" media-type="application/xhtml+xml"/>`).join('')}<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine${rtl ? ' page-progression-direction="rtl"' : ''}>${items.map(n => `<itemref idref="p${n}"/>`).join('')}</spine></package>`,
    'OPS/nav.xhtml': '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol><li><a href="p1.xhtml">Cover</a></li></ol></nav></body></html>',
  };
  for (const n of items) files[`OPS/p${n}.xhtml`] = `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Page ${n}</title><meta name="viewport" content="width=600,height=800"/><style>body { margin: 0; background: white; color: #181818; }</style></head><body><h1>Fixed page ${n}</h1></body></html>`;
  for (const [name, text] of Object.entries(files)) await writer.add(name, new TextReader(text), { level: name === 'mimetype' ? 0 : 6, lastModDate: new Date('2026-01-01T00:00:00Z'), extendedTimestamp: false });
  return Buffer.from(await writer.close());
}

const pageBoxes = (page: Page) => page.locator('.pdf-spread .pdf-page').evaluateAll(elements => elements.map(element => {
  const box = element.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height };
}));
const menu = async (page: Page, name: RegExp) => {
  await page.getByRole('button', { name: 'Reader menu' }).click();
  await page.getByRole('button', { name }).click();
};

test('PDF two-page spread pairs, navigates, snaps, waits for width and resumes', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.goto('/');
  // Seven pages (odd count) with a landscape page 4 beside a portrait page 5.
  const file = { name: 'spread.pdf', mimeType: 'application/pdf', buffer: spreadPdf([[400, 600], [400, 600], [400, 600], [600, 400], [400, 600], [400, 600], [400, 600]]) };
  await page.locator('#file-input').setInputFiles(file);
  await expect(page.locator('#position')).toContainText('Page 1 of 7');
  await expect(page.locator('#view-single')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.reader-host').focus();
  await page.keyboard.press('Control+3');
  await expect(page.locator('#view-spread')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#filekind')).toHaveAttribute('title', 'PDF · Two-page view');
  // The cover stands alone on the right half of the open book.
  await expect(page.locator('.pdf-spread')).toHaveAttribute('data-side', 'right');
  await expect(page.locator('#position')).toContainText('Page 1 of 7');
  const cover = await page.locator('.pdf-spread').evaluate(spread => {
    const page = spread.querySelector('.pdf-page')!.getBoundingClientRect(), box = spread.getBoundingClientRect();
    return { left: page.left - box.left, right: box.right - page.right, half: box.width / 2 };
  });
  expect(cover.right).toBeLessThan(1); expect(Math.abs(cover.left - cover.half)).toBeLessThan(1);

  await page.keyboard.press('PageDown');
  await expect(page.locator('#position')).toContainText('Pages 2–3 of 7');
  await expect(page.locator('.pdf-spread .textLayer')).toHaveCount(2);
  await expect(page.locator('.pdf-spread .textLayer').first()).toContainText('Page 2');
  await page.screenshot({ path: 'test-results/reader-pdf-spread.png' });
  let [left, right] = await pageBoxes(page);
  expect(Math.abs(left.x + left.width - right.x)).toBeLessThan(1); // edge to edge
  expect(Math.abs(left.height - right.height)).toBeLessThan(1);

  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#position')).toContainText('Pages 4–5 of 7');
  [left, right] = await pageBoxes(page);
  // Mixed sizes share one height; the landscape page is simply wider.
  expect(Math.abs(left.height - right.height)).toBeLessThan(1);
  expect(left.width).toBeGreaterThan(right.width * 2);
  // Fit page fits the whole spread inside the panel.
  const panel = (await page.locator('.reader-host').boundingBox())!;
  expect(left.x).toBeGreaterThanOrEqual(panel.x); expect(right.x + right.width).toBeLessThanOrEqual(panel.x + panel.width);

  await page.keyboard.press('Space');
  await expect(page.locator('#position')).toContainText('Pages 6–7 of 7');
  await page.keyboard.press('PageDown');
  await page.waitForTimeout(300);
  await expect(page.locator('#position')).toContainText('Pages 6–7 of 7');

  // Go to a page shows the spread that contains it; Back returns to the previous spread.
  await page.keyboard.press('Control+g'); await page.locator('#target').fill('5'); await page.getByRole('button', { name: 'Go to location', exact: true }).click();
  await expect(page.locator('#position')).toContainText('Pages 4–5 of 7');
  await expect(page.locator('#jump')).not.toBeVisible();
  await page.locator('.reader-host').focus(); await page.keyboard.press('Alt+ArrowLeft');
  await expect(page.locator('#position')).toContainText('Pages 6–7 of 7');
  await page.keyboard.press('PageUp');
  await expect(page.locator('#position')).toContainText('Pages 4–5 of 7');

  // The scrubber previews and snaps to spreads.
  await page.locator('#progress').fill('3');
  await expect(page.locator('#position')).toContainText('Pages 2–3 of 7');
  await expect(page.locator('#progress')).toHaveAttribute('aria-valuenow', '2');

  // Without a cover page, pairs start at page 1 and the odd final page stands alone on the left.
  await menu(page, /Cover page alone/);
  await expect(page.locator('#position')).toContainText('Pages 1–2 of 7');
  await page.locator('.reader-host').focus(); await page.keyboard.press('End');
  await expect(page.locator('#position')).toContainText('Page 7 of 7');
  await expect(page.locator('.pdf-spread')).toHaveAttribute('data-side', 'left');
  await page.keyboard.press('Home'); await page.keyboard.press('PageDown');
  await expect(page.locator('#position')).toContainText('Pages 3–4 of 7');

  // An idle spread must not refit itself (the resize-debounce loop the single-page tests also guard).
  await expect(page.locator('.pdf-render-status')).toHaveCount(0);
  const canvas = await page.locator('.pdf-spread canvas').first().elementHandle();
  await page.waitForTimeout(450);
  await expect(page.locator('.pdf-spread')).toHaveCount(1);
  expect(await canvas!.evaluate(element => element.isConnected)).toBe(true);

  // Too narrow for two pages: single pages, an explanation, and an automatic return when wider.
  await page.setViewportSize({ width: 520, height: 700 });
  await expect(page.locator('#position')).toContainText('Page 3 of 7');
  await expect(page.locator('.pdf-spread')).toHaveCount(0);
  await expect(page.locator('#view-spread')).toHaveAttribute('aria-description', /wide/);
  await expect(page.locator('#view-spread')).toHaveAttribute('aria-pressed', 'true');
  await page.setViewportSize({ width: 1000, height: 700 });
  await expect(page.locator('#position')).toContainText('Pages 3–4 of 7');
  await expect(page.locator('#view-spread')).not.toHaveAttribute('aria-description', /.+/);

  // Mode and pairing persist per document; the saved place is the first visible page.
  await page.waitForTimeout(900);
  await page.reload(); await page.locator('#file-input').setInputFiles(file);
  await expect(page.locator('#position')).toContainText('Pages 3–4 of 7');
  await expect(page.locator('#view-spread')).toHaveAttribute('aria-pressed', 'true');
  // Switching back to single page keeps the place.
  await page.locator('#view-single').click();
  await expect(page.locator('#position')).toContainText('Page 3 of 7');
  await expect(page.locator('.pdf-page')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('fixed-layout EPUB shows spreads with the cover alone and moves by spread', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.goto('/');
  await page.locator('#file-input').setInputFiles({ name: 'spread.epub', mimeType: 'application/epub+zip', buffer: await fixedEpub(5) });
  await expect(page.locator('#position')).toContainText('Page 1 of 5');
  await page.locator('.reader-host').focus();
  await page.keyboard.press('Control+3');
  await expect(page.locator('#position')).toContainText('Page 1 of 5');
  await expect(page.locator('#filekind')).toHaveAttribute('title', 'EPUB · Two-page view');
  await page.keyboard.press('PageDown');
  await expect(page.locator('#position')).toContainText('Pages 2–3 of 5');
  const visible = () => page.frames().filter(frame => frame.url().startsWith('blob:')).map(frame => frame.locator('h1'));
  await expect.poll(async () => (await Promise.all(visible().map(h => h.textContent().catch(() => '')))).sort().join('|')).toContain('Fixed page 2|Fixed page 3');
  await page.screenshot({ path: 'test-results/reader-epub-spread.png' });
  await page.keyboard.press('PageDown');
  await expect(page.locator('#position')).toContainText('Pages 4–5 of 5');
  await menu(page, /Cover page alone/);
  await expect(page.locator('#position')).toContainText('Pages 3–4 of 5');
  await page.locator('.reader-host').focus(); await page.keyboard.press('End');
  await expect(page.locator('#position')).toContainText('Page 5 of 5');
  await page.locator('#view-single').click();
  await expect(page.locator('#position')).toContainText('Page 5 of 5');
  await expect(page.locator('#filekind')).toHaveAttribute('title', 'EPUB · Page view');
  expect(errors).toEqual([]);
});

test('right-to-left fixed-layout EPUB places the earlier page of a spread on the right', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.goto('/');
  await page.locator('#file-input').setInputFiles({ name: 'rtl.epub', mimeType: 'application/epub+zip', buffer: await fixedEpub(4, true) });
  await expect(page.locator('#position')).toContainText('Page 1 of 4');
  await page.locator('.reader-host').focus();
  await page.keyboard.press('Control+3'); await page.keyboard.press('PageDown');
  await expect(page.locator('#position')).toContainText('Pages 2–3 of 4');
  const left = async (text: string) => {
    for (const frame of page.frames()) if (await frame.locator('h1').textContent({ timeout: 500 }).catch(() => '') === text) return (await (await frame.frameElement()).boundingBox())!.x;
    return Number.NaN;
  };
  await expect.poll(async () => await left('Fixed page 2') > await left('Fixed page 3')).toBe(true);
});
