import { test, expect, type Page } from '@playwright/test';
import { ZipWriter, Uint8ArrayWriter, TextReader } from '@zip.js/zip.js';
import { createHash } from 'node:crypto';
import { crc32, deflateSync } from 'node:zlib';

// A solid-colour PNG of exactly the requested size, so tile proportions are known to the test.
function pngFixture(width: number, height: number, [r, g, b]: [number, number, number]) {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]); const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(crc32(body), body.length + 4); return out;
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const row = Buffer.alloc(1 + width * 3); for (let x = 0; x < width; x++) row.set([r, g, b], 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const pngFiles = [[80, 120], [120, 80], [100, 100], [60, 140], [120, 90], [90, 120]].map(([width, height], i) => ({ name: `plate-${i + 1}.png`, mimeType: 'image/png', buffer: pngFixture(width, height, [40 * i + 20, 120, 200 - 30 * i]) }));

/** Distinct masonry columns the tiles occupy (each tile carries its column). */
const tileColumns = (page: Page) => page.locator('.library-documents .library-tile').evaluateAll(nodes => new Set(nodes.map(node => node.getAttribute('data-column'))).size);

async function recordFixture(name: string, buffer: Buffer, properties: Record<string, unknown>) {
  await test.info().attach('fixture-manifest.json', { body: JSON.stringify({ schema: 1, name, bytes: buffer.length, sha256: createHash('sha256').update(buffer).digest('hex'), origin: 'Synthetic, generated from this test source', ...properties }, null, 2), contentType: 'application/json' });
}

function pdfFixture() {
  const stream = (text: string) => `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R /PageLabels << /Nums [0 << /S /r >>] >> >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 600] /Resources << /Font << /F1 6 0 R >> >> /Contents 7 0 R /Annots [10 0 R] >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 400] /Resources << /Font << /F1 6 0 R >> >> /Contents 8 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 1200] /Resources << /Font << /F1 6 0 R >> >> /Contents 9 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    stream('BT /F1 24 Tf 25 550 Td (First page with selectable text) Tj ET'),
    stream('BT /F1 24 Tf 25 350 Td (Second page landscape) Tj ET'),
    stream('BT /F1 24 Tf 25 1150 Td (Third page tall) Tj ET'),
    '<< /Type /Annot /Subtype /Link /Rect [25 490 250 530] /Border [0 0 1] /Dest [4 0 R /XYZ 0 400 0] >>',
  ];
  let out = '%PDF-1.7\n'; const offsets = [0];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out);
}

/**
 * A PDF built from `kinds`: a `text` page draws one line of text, an `image` page is one
 * full-page image with no text operators at all (a scan without OCR: no text layer, which
 * is what `Position.imageOnly` reports).
 */
function scanPdf(kinds: ('text' | 'image')[]) {
  const stream = (text: string) => `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`;
  const pixels = Buffer.alloc(4 * 4, 0x80).toString('latin1'); // One 4 x 4 opaque grey tile, reused by every image page.
  const n = kinds.length, image = 3 + 2 * n, font = image + 1;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${kinds.map((_, i) => `${3 + i} 0 R`).join(' ')}] /Count ${n} >>`,
    ...kinds.map((_, i) => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 600] /Resources << /XObject << /Im0 ${image} 0 R >> /Font << /F1 ${font} 0 R >> >> /Contents ${3 + n + i} 0 R >>`),
    ...kinds.map((kind, i) => stream(kind === 'text' ? `BT /F1 24 Tf 25 550 Td (Text page ${i + 1}) Tj ET` : 'q 400 0 0 600 0 0 cm /Im0 Do Q')),
    `<< /Type /XObject /Subtype /Image /Width 4 /Height 4 /ColorSpace /DeviceGray /BitsPerComponent 8 /Length ${pixels.length} >>\nstream\n${pixels}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.7\n'; const offsets: number[] = [];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}

async function epubFixture(fixed = false) {
  const writer = new ZipWriter(new Uint8ArrayWriter(), { useWebWorkers: false });
  const files: Record<string, string> = {
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    'OPS/book.opf': `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">float-reader-${fixed ? 'fixed' : 'flow'}</dc:identifier><dc:title>Test publication</dc:title><dc:language>en</dc:language>${fixed ? '<meta property="rendition:layout">pre-paginated</meta>' : ''}</metadata><manifest><item id="c1" href="one.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="two.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>`,
    'OPS/nav.xhtml': '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol><li><a href="one.xhtml">Opening chapter</a></li><li><a href="two.xhtml">Second chapter</a></li></ol></nav></body></html>',
  };
  for (const [index, name] of ['one', 'two'].entries()) files[`OPS/${name}.xhtml`] = `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter ${index + 1}</title>${fixed ? '<meta name="viewport" content="width=800,height=1000"/>' : ''}<style>body { color: #181818; background: white; } h1 { color: #48298a; }</style></head><body><h1>${index ? 'Second chapter' : 'Opening chapter'}</h1><a href="${index ? 'one' : 'two'}.xhtml#note">Jump to other chapter</a><p id="note">The footnote destination.</p>${Array.from({ length: fixed ? 2 : 80 }, (_, n) => `<p>Passage ${n + 1}: The reader keeps a stable place beside your work. This paragraph supplies natural flowing text across several displayed pages.</p>`).join('')}<img src="https://should-never-fetch.invalid/tracker.png"/><script>parent.document.body.dataset.compromised='yes'; fetch('https://should-never-fetch.invalid/script');</script></body></html>`;
  for (const [name, text] of Object.entries(files)) await writer.add(name, new TextReader(text), { level: name === 'mimetype' ? 0 : 6, lastModDate: new Date('2026-01-01T00:00:00Z'), extendedTimestamp: false });
  return Buffer.from(await writer.close());
}

test('PDF paints text and mixed page geometry, uses physical labels and internal link/back', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  const buffer = pdfFixture(); await recordFixture('mixed-pages.pdf', buffer, { pages: 3, textLayer: true, pageLabels: 'Roman', geometry: 'mixed' });
  await page.locator('#file-input').setInputFiles({ name: 'mixed-pages.pdf', mimeType: 'application/pdf', buffer });
  await expect(page.locator('#filename')).toHaveText('mixed-pages.pdf');
  await expect(page.locator('#position')).toContainText('Page 1 of 3');
  await expect(page.locator('#position')).toContainText('i');
  await expect(page.locator('.textLayer')).toContainText('First page with selectable text');
  expect(await page.locator('.pdf-page canvas').evaluate((canvas: HTMLCanvasElement) => canvas.width > 0 && canvas.height > canvas.width)).toBe(true);
  await page.screenshot({ path: 'test-results/reader-pdf.png' });
  await page.locator('.pdf-link').click();
  await expect(page.locator('#position')).toContainText('Page 2 of 3');
  await expect(page.locator('.textLayer')).toContainText('Second page landscape');
  await page.locator('.reader-host').focus(); await page.keyboard.press('Alt+ArrowLeft');
  await expect(page.locator('#position')).toContainText('Page 1 of 3');
  await page.keyboard.press('PageDown'); await page.keyboard.press('PageDown');
  await expect(page.locator('#position')).toContainText('Page 3 of 3');
  await expect(page.locator('.textLayer')).toContainText('Third page tall');
  await page.keyboard.press('Control+2');
  await expect.poll(() => page.locator('.reader-host').evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
  await page.keyboard.press('Space');
  await expect(page.locator('#position')).toContainText('Page 3 of 3');
  await expect.poll(() => page.locator('.reader-host').evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('PDF loading does not change scroll geometry or repeatedly refit an idle page', async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 620 });
  await page.goto('/');
  await page.locator('#file-input').setInputFiles({ name: 'loading-layout.pdf', mimeType: 'application/pdf', buffer: pdfFixture() });
  await expect(page.locator('#position')).toContainText('Page 1 of 3');
  const host = page.locator('.pdf-reader');
  await host.focus();

  for (const scrolled of [false, true]) {
    if (scrolled) {
      await page.keyboard.press('Control+2');
      await expect(page.locator('.pdf-render-status')).toHaveCount(0);
      await page.keyboard.press('Space');
      await expect.poll(() => host.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    }
    await host.evaluate(el => {
      delete (el as HTMLElement).dataset.loadingGeometry;
      const before = [el.clientWidth, el.clientHeight, el.scrollWidth, el.scrollHeight, el.scrollLeft, el.scrollTop];
      const observer = new MutationObserver(() => {
        const status = el.querySelector('.pdf-render-status');
        if (!status) return;
        const box = status.getBoundingClientRect(), viewport = el.getBoundingClientRect();
        observer.disconnect();
        (el as HTMLElement).dataset.loadingGeometry = JSON.stringify({ before, during: [el.clientWidth, el.clientHeight, el.scrollWidth, el.scrollHeight, el.scrollLeft, el.scrollTop], visible: box.top >= viewport.top && box.bottom <= viewport.bottom && box.left >= viewport.left && box.right <= viewport.right });
      });
      observer.observe(el, { childList: true });
    });
    // Reapply the current fit mode, as a resize refresh does.
    await page.keyboard.press(scrolled ? 'Control+2' : 'Control+0');
    await expect(host).toHaveAttribute('data-loading-geometry', /.+/);
    const geometry = JSON.parse((await host.getAttribute('data-loading-geometry'))!);
    expect(geometry.during).toEqual(geometry.before);
    expect(geometry.visible).toBe(true);
    await expect(page.locator('.pdf-render-status')).toHaveCount(0);
    // Pin down the exact canvas that is on screen NOW. Previously the handle was taken
    // after `toHaveCount(0)` without waiting for a canvas, so it could bind to the
    // outgoing surface and detach for reasons unrelated to idle refitting (observed
    // flaky on macOS/arm64). Measured note: a *pre-existing* second resize debounce
    // (stale ResizeObserver size captured in `before`, firing after the 100 ms timer)
    // is re-applying the page about 95 ms after the fit re-apply. That is page
    // behaviour, deliberately NOT asserted here -- this test pins the loading status
    // and the committed canvas, not the deferred re-render.
    const canvas = await page.locator('.pdf-page canvas').elementHandle();
    await expect.poll(() => page.evaluate(() => document.querySelectorAll('.pdf-page').length)).toBe(1);
    await page.waitForTimeout(450); // Several 100 ms resize-debounce periods must remain idle.
    // Exactly one surface may exist: a refit loop would leave none, append extras, or
    // leave the canvas detached.
    await expect(page.locator('.pdf-page')).toHaveCount(1);
    expect(await page.locator('.pdf-page canvas').evaluate(el => el.isConnected)).toBe(true);
    await expect(page.locator('#position')).toContainText('Page 1 of 3');
  }
});

test('the opening strip is chrome: it never takes height from the reading area or covers the find bar', async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 620 });
  await page.goto('/');
  await page.locator('#file-input').setInputFiles({ name: 'strip.pdf', mimeType: 'application/pdf', buffer: pdfFixture() });
  await expect(page.locator('#position')).toContainText('Page 1 of 3');
  const layout = () => page.evaluate(() => document.getElementById('reader-layout')!.clientHeight);
  const strip = (hidden: boolean) => page.evaluate(hidden => { document.getElementById('loading')!.hidden = hidden; }, hidden);
  // Showing the strip on a settled document must not move the reading area. In flow it took 47 px of
  // height, which is what made the adapter fit the page to the wrong box while a document opened.
  const settled = await layout();
  await strip(false);
  expect(await layout()).toBe(settled);
  await strip(true);
  expect(await layout()).toBe(settled);
  // The find bar owns the same top edge of the reading panel, so the strip has to sit below it.
  await page.keyboard.press('Control+f');
  await expect(page.locator('#find-bar')).toBeVisible();
  await strip(false);
  const covered = await page.evaluate(() => {
    const bar = document.getElementById('find-bar')!.getBoundingClientRect();
    const box = document.getElementById('loading')!.getBoundingClientRect();
    const field = document.getElementById('find-query')!;
    const fieldBox = field.getBoundingClientRect();
    const hit = document.elementFromPoint(fieldBox.x + fieldBox.width / 2, fieldBox.y + fieldBox.height / 2);
    return { overlap: Math.max(0, Math.min(bar.bottom, box.bottom) - Math.max(bar.top, box.top)), reachable: hit === field || (!!hit && field.contains(hit)) };
  });
  expect(covered.overlap).toBe(0);
  expect(covered.reachable).toBe(true);
  await strip(true);
  // In a compact window the library covers the reading panel with a scrim and makes it inert, so the
  // strip has to live outside that panel: Cancel is the only way to stop a slow open.
  await page.locator('#library-toggle').click();
  await expect(page.locator('#library-root')).toBeVisible();
  await strip(false);
  const cancel = await page.evaluate(() => {
    const button = document.getElementById('cancel')!;
    const box = button.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return { inert: !!button.closest('[inert]'), reachable: hit === button || (!!hit && button.contains(hit)) };
  });
  expect(cancel.inert, 'the strip must not sit inside the inert reading panel').toBe(false);
  expect(cancel.reachable, 'Cancel must be clickable over the compact library sheet').toBe(true);
  await strip(true);
});

test('opening a document reveals the page at its settled size and rasterises it once', async ({ page }) => {
  // A page fitted while the opening strip was in flow was revealed at the wrong size and rendered
  // again a moment later. The 300x400 case also covers the toolbar: if its subtitle wraps while a
  // document loads, the reading area changes height and the page is refitted for an unrelated reason.
  for (const viewport of [{ width: 420, height: 620 }, { width: 300, height: 400 }]) {
    await page.setViewportSize(viewport);
    await page.goto('/');
    // Each window size opens the document for the first time: a saved position would restore and
    // render again, which is a different behaviour from the one under test.
    await page.evaluate(() => localStorage.clear());
    await page.goto('/');
    // Record what the reading area really was while the strip was up, what the page looked like at
    // the instant it was revealed, and how many times it rendered.
    await page.evaluate(() => {
      type Snapshot = { layout: number; bitmap: number[] };
      const probe: { appends: number; whileLoading: number; revealed: Snapshot; settled: Snapshot } =
        { appends: 0, whileLoading: 0, revealed: { layout: 0, bitmap: [] }, settled: { layout: 0, bitmap: [] } };
      (window as unknown as { __fitProbe: typeof probe }).__fitProbe = probe;
      const layout = () => document.getElementById('reader-layout')!.clientHeight;
      const bitmap = () => { const canvas = document.querySelector<HTMLCanvasElement>('.pdf-page canvas'); return canvas ? [canvas.width, canvas.height] : []; };
      new MutationObserver(records => {
        for (const record of records) {
          for (const node of record.addedNodes) if (node instanceof HTMLElement && node.classList.contains('pdf-page')) probe.appends++;
          const target = record.target;
          if (!(target instanceof HTMLElement) || target.id !== 'loading') continue;
          if (!target.hidden) probe.whileLoading = layout();
          else {
            probe.revealed = { layout: layout(), bitmap: bitmap() };
            setTimeout(() => { probe.settled = { layout: layout(), bitmap: bitmap() }; }, 450);
          }
        }
      }).observe(document.getElementById('app')!, { attributes: true, attributeFilter: ['hidden'], subtree: true, childList: true });
    });
    await page.locator('#file-input').setInputFiles({ name: 'opening-fit.pdf', mimeType: 'application/pdf', buffer: pdfFixture() });
    await expect(page.locator('#position')).toContainText('Page 1 of 3');
    await expect(page.locator('.pdf-render-status')).toHaveCount(0);
    type Probe = { appends: number; whileLoading: number; revealed: { layout: number; bitmap: number[] }; settled: { layout: number; bitmap: number[] } };
    const read = () => page.evaluate(() => (window as unknown as { __fitProbe: Probe }).__fitProbe);
    await expect.poll(async () => (await read()).settled.bitmap.length).toBe(2);
    const { appends, whileLoading, revealed, settled } = await read();
    const where = `${viewport.width}x${viewport.height}`;
    expect(whileLoading, `${where}: the strip really was up while the document loaded`).toBeGreaterThan(0);
    expect(revealed.layout, `${where}: the strip took height from the reading area`).toBe(whileLoading);
    expect(revealed.layout, `${where}: the reading area moved under the strip`).toBe(settled.layout);
    expect(revealed.bitmap, `${where}: the page was revealed at a size it then left`).toEqual(settled.bitmap);
    expect(appends, `${where}: the page was rasterised more than once`).toBe(1);
  }
});

test('library drawer floats over the page and never resizes it, while drag, keyboard, double-click, right dock and persistence still work', async ({ page }) => {
  await page.setViewportSize({ width: 1080, height: 680 });
  await page.goto('/');
  await page.locator('#file-input').setInputFiles({ name: 'library-resize.pdf', mimeType: 'application/pdf', buffer: pdfFixture() });
  await expect(page.locator('#position')).toContainText('Page 1 of 3');
  await expect(page.locator('.pdf-render-status')).toHaveCount(0);
  // The 47 px loading bar changes the host height, so the first canvas sizing can be the
  // loading-visible fit (325x487 instead of 356x534). Wait for the bar to go before touching
  // anything else.
  await expect(page.locator('#loading')).toBeHidden();
  const handle = page.getByRole('separator', { name: 'Resize library' });
  const panel = page.locator('.library-panel'), host = page.locator('.pdf-reader'), workspace = page.locator('#workspace');
  const canvas = page.locator('.pdf-page canvas');
  // The library is open by default at >=720 px, so close it to measure the untouched page first.
  await page.locator('#library-toggle').click();
  await expect(page.locator('#library-root')).toBeHidden();
  // Everything the drawer must leave alone: the reading panel's box, its client width, the page
  // box and the backing bitmap. Any of those changing when the drawer opens, is dragged or is
  // docked is exactly the regression this test exists for (it used to shrink #workspace and
  // refit the PDF).
  const pageGeometry = async () => ({
    workspace: await workspace.boundingBox(),
    hostClientWidth: await host.evaluate(el => el.clientWidth),
    canvasBox: await canvas.boundingBox(),
    bitmap: await canvas.evaluate((el: HTMLCanvasElement) => ({ width: el.width, height: el.height })),
  });
  // Hiding the loading bar is not enough: a pre-existing deferred ResizeObserver re-applies the fit
  // roughly 100 ms later (see the note in the loading-geometry test above), so the very first
  // samples can still be a mid-flight page. Sample until two reads 200 ms apart agree -- the
  // baseline must be the settled page, otherwise this comparison measures the pending refit
  // instead of the drawer. Any refit *after* this point is the regression under test.
  await expect.poll(async () => {
    const before = JSON.stringify(await pageGeometry());
    await page.waitForTimeout(200);
    return JSON.stringify(await pageGeometry()) === before;
  }, { timeout: 5000 }).toBe(true);
  const untouched = await pageGeometry();
  // Absolute, layout-stable expectations only: the workspace and host widths. The bitmap stays in
  // the relative pageGeometry() comparison below, which is the actual regression guard -- pinning
  // its exact pixel size here would depend on the loading-bar race described above.
  expect(untouched.workspace!.width).toBe(1080);
  expect(untouched.hostClientWidth).toBe(1080);

  // Opening the drawer rolls over the page instead of narrowing it.
  await page.locator('#library-toggle').click();
  await expect(page.locator('#library-root')).toBeVisible();
  await expect(handle).toHaveAttribute('aria-valuenow', '270');
  expect(await pageGeometry()).toEqual(untouched);

  const box = (await handle.boundingBox())!, y = box.y + box.height / 2;
  await page.mouse.move(box.x + 5, y); await page.mouse.down();
  await page.mouse.move(box.x + 45, y, { steps: 6 });
  // The drawer follows the pointer live; the page underneath must not move or refit.
  await expect(handle).toHaveAttribute('aria-valuenow', '310');
  expect(await pageGeometry()).toEqual(untouched);
  await page.mouse.move(box.x + 75, y, { steps: 6 }); await page.mouse.up();
  await expect(handle).toHaveAttribute('aria-valuenow', '340');
  expect(Math.round((await panel.boundingBox())!.width)).toBe(340);
  expect(await pageGeometry()).toEqual(untouched);
  await expect(page.locator('.pdf-render-status')).toHaveCount(0);
  await page.waitForTimeout(450); // Several resize-debounce periods must remain idle.
  await expect(page.locator('.pdf-page')).toHaveCount(1);
  expect(await pageGeometry()).toEqual(untouched);

  await handle.focus();
  for (const [key, width] of [['ArrowRight', 356], ['Shift+ArrowLeft', 292], ['End', 520], ['Home', 240], ['Enter', 270], ['End', 520]] as const) {
    await page.keyboard.press(key); await expect(handle).toHaveAttribute('aria-valuenow', String(width));
  }
  await handle.dblclick(); await expect(handle).toHaveAttribute('aria-valuenow', '270');
  await page.keyboard.press('Shift+ArrowRight'); await expect(handle).toHaveAttribute('aria-valuenow', '334');

  await page.getByRole('button', { name: 'Move library to the right' }).click();
  await expect(page.getByRole('button', { name: 'Move library to the left' })).toBeVisible();
  const docked = async () => (await panel.boundingBox())!.x > (await workspace.boundingBox())!.x;
  expect(await docked()).toBe(true);
  // Mirroring the drawer is a pure overlay too: the page keeps its box and its bitmap.
  expect(await pageGeometry()).toEqual(untouched);

  // Grid view is a pure overlay as well. Adding six images makes the collection mostly pictures, so it
  // opens as a grid; widening to 480 px changes the column count, never the page, and the masonry never
  // scrolls sideways or lets a tile out of the drawer.
  const documents = page.locator('.library-documents');
  await page.locator('.library-panel input[type=file]').setInputFiles(pngFiles);
  await expect(page.locator('.library-tile')).toHaveCount(7);
  await expect(documents).toHaveClass(/library-grid/);
  const columns = () => tileColumns(page);
  const contained = () => documents.evaluate(el => {
    const area = el.getBoundingClientRect();
    return el.scrollWidth <= el.clientWidth && Array.from(el.querySelectorAll('.library-tile')).every(tile => { const box = tile.getBoundingClientRect(); return box.left >= area.left - 1 && box.right <= area.right + 1; });
  });
  expect(await columns()).toBe(2);
  expect(await contained()).toBe(true);
  expect(await pageGeometry()).toEqual(untouched);
  // Right-docked, so dragging the handle left widens the drawer (334 -> 480) and right narrows it again.
  const drag = async (delta: number) => {
    const grip = (await handle.boundingBox())!, y = grip.y + grip.height / 2;
    await page.mouse.move(grip.x + 5, y); await page.mouse.down(); await page.mouse.move(grip.x + 5 + delta, y, { steps: 6 }); await page.mouse.up();
  };
  await drag(-146); await expect(handle).toHaveAttribute('aria-valuenow', '480');
  await expect.poll(columns).toBe(3);
  expect(await contained()).toBe(true);
  expect(await pageGeometry()).toEqual(untouched);
  await drag(146); await expect(handle).toHaveAttribute('aria-valuenow', '334');
  await expect.poll(columns).toBe(2);
  expect(await pageGeometry()).toEqual(untouched);
  await page.getByRole('button', { name: 'List view' }).click();
  await expect(documents).toHaveClass(/library-list/);
  await expect(page.locator('.library-document')).toHaveCount(7);
  expect(await pageGeometry()).toEqual(untouched);
  await page.getByRole('button', { name: 'Grid view' }).click();
  await expect(documents).toHaveClass(/library-grid/);
  expect(await pageGeometry()).toEqual(untouched);

  // Board: the drawer opened across the whole reading panel. It is still out of flow, so the page is covered
  // and inert but never resized or refitted, the drawer width is not rewritten, and Escape or the back button
  // returns to the drawer exactly as it was.
  await page.getByRole('button', { name: 'Open library board' }).click();
  const root = page.locator('#library-root');
  await expect(root).toHaveClass(/is-board/);
  await expect(handle).toBeHidden();
  await expect(workspace).toHaveJSProperty('inert', true);
  expect(Math.round((await panel.boundingBox())!.width)).toBe(1080 - 12);
  await expect.poll(columns).toBe(5);
  expect(await contained()).toBe(true);
  expect(await pageGeometry()).toEqual(untouched);
  await expect(page.locator('.library-detail')).toBeHidden();
  // The board pre-selects the document being read, and pressing a selected tile opens it, so select another one.
  await page.locator('.library-tile:not(.is-selected)').first().click();
  await expect(page.locator('.library-tile.is-selected')).toHaveCount(1);
  await expect(root).toHaveClass(/is-board/);
  expect(await pageGeometry()).toEqual(untouched);
  await page.keyboard.press('Escape');
  await expect(root).not.toHaveClass(/is-board/);
  await expect(handle).toHaveAttribute('aria-valuenow', '334');
  expect(Math.round((await panel.boundingBox())!.width)).toBe(334);
  await expect(workspace).toHaveJSProperty('inert', false);
  expect(await docked()).toBe(true);
  expect(await pageGeometry()).toEqual(untouched);
  await page.getByRole('button', { name: 'Open library board' }).click();
  await page.getByRole('button', { name: /Back to reading/ }).click();
  await expect(root).not.toHaveClass(/is-board/);
  expect(await pageGeometry()).toEqual(untouched);
  await page.reload();
  await expect(handle).toHaveAttribute('aria-valuenow', '334');
  expect(await docked()).toBe(true);
  // Arrows move the separator visually, so Left widens a right-docked library.
  await handle.focus(); await page.keyboard.press('ArrowLeft'); await expect(handle).toHaveAttribute('aria-valuenow', '350');
  // A narrower window re-clamps (55% of 800 px) without forgetting the preferred width.
  await page.keyboard.press('End'); await expect(handle).toHaveAttribute('aria-valuenow', '520');
  await page.setViewportSize({ width: 800, height: 680 });
  await expect(handle).toHaveAttribute('aria-valuenow', '440'); await expect(handle).toHaveAttribute('aria-valuemax', '440');
  await page.setViewportSize({ width: 1080, height: 680 }); await expect(handle).toHaveAttribute('aria-valuenow', '520');

  // Every width keeps the masonry inside the drawer, and the view is remembered for the collection.
  // Count only drawer tiles: Home uses the same card classes and can have a different column count.
  await handle.focus(); await page.keyboard.press('End');
  expect(await columns()).toBeGreaterThanOrEqual(3);
  expect(await contained()).toBe(true);
  await handle.focus(); await page.keyboard.press('Home'); await expect(handle).toHaveAttribute('aria-valuenow', '240');
  await expect.poll(columns).toBe(2);
  expect(await contained()).toBe(true);
  await page.getByRole('button', { name: 'List view' }).click();
  await expect(documents).toHaveClass(/library-list/);
  await page.reload();
  await expect(documents).toHaveClass(/library-list/);
  await page.getByRole('button', { name: 'Grid view' }).click();
  await expect(documents).toHaveClass(/library-grid/);
});

test('library thumbnails are made once and survive searching, sorting and switching view', async ({ page }) => {
  // Every thumbnail is an object URL, so counting createObjectURL calls counts pictures made.
  await page.addInitScript(() => {
    const create = URL.createObjectURL.bind(URL); let count = 0;
    URL.createObjectURL = blob => { count++; return create(blob); };
    Object.defineProperty(window, 'objectUrlCount', { get: () => count });
  });
  await page.setViewportSize({ width: 1080, height: 680 });
  await page.goto('/');
  await expect(page.locator('#library-root')).toBeVisible();
  await page.locator('.library-panel input[type=file]').setInputFiles(pngFiles);
  const loaded = page.locator('.library-tile-media.is-loaded');
  await expect(loaded).toHaveCount(6);
  const made = () => page.evaluate(() => Reflect.get(window, 'objectUrlCount') as number);
  const sources = () => page.locator('.library-tile-media img').evaluateAll(images => images.map(image => image.getAttribute('src')));
  const before = { made: await made(), sources: await sources() };
  expect(before.made).toBe(6);
  // Typing re-renders the list on every keystroke; a match keeps its picture and nothing is fetched again.
  const search = page.getByRole('searchbox');
  await search.pressSequentially('plate-');
  await expect(loaded).toHaveCount(6);
  await search.fill('plate-3');
  await expect(page.locator('.library-tile')).toHaveCount(1);
  await expect(loaded).toHaveCount(1);
  expect(before.sources).toContain(await page.locator('.library-tile-media img').getAttribute('src'));
  await search.fill('');
  await page.locator('.library-sort').selectOption('name');
  await page.getByRole('button', { name: 'List view' }).click();
  await page.getByRole('button', { name: 'Grid view' }).click();
  await expect(loaded).toHaveCount(6);
  expect(await made()).toBe(before.made);
  expect(new Set(await sources())).toEqual(new Set(before.sources));
});

test('a PDF whose page is one huge image gets a real thumbnail, not a blank page', async ({ page }) => {
  // pdf.js removes images above its pixel cap, which used to leave 148 MB scans as white tiles. This page is
  // one 8000 x 8000 (64 Mpx) black image: it compresses to a few KB, but must still be drawn.
  const objects = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>'),
    Buffer.from('<< /Length 31 >>\nstream\nq 100 0 0 100 0 0 cm /Im0 Do Q\nendstream'),
  ];
  const pixels = deflateSync(Buffer.alloc(8000 * 8000));
  objects.push(Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width 8000 /Height 8000 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${pixels.length} >>\nstream\n`), pixels, Buffer.from('\nendstream')]));
  const parts = [Buffer.from('%PDF-1.7\n')]; const offsets: number[] = []; let size = parts[0].length;
  objects.forEach((body, index) => { offsets.push(size); const part = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), body, Buffer.from('\nendobj\n')]); parts.push(part); size += part.length; });
  parts.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${size}\n%%EOF`));
  await page.setViewportSize({ width: 1080, height: 680 });
  await page.goto('/');
  await page.locator('.library-panel input[type=file]').setInputFiles({ name: 'huge-scan.pdf', mimeType: 'application/pdf', buffer: Buffer.concat(parts) });
  const media = page.locator('.library-tile-media.is-loaded');
  await expect(media).toHaveCount(1, { timeout: 60000 });
  const mean = await media.locator('img').evaluate(async (image: HTMLImageElement) => {
    await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = 16; canvas.height = 16;
    const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0, 16, 16);
    const data = context.getImageData(0, 0, 16, 16).data; let sum = 0;
    for (let i = 0; i < data.length; i += 4) sum += data[i];
    return sum / (data.length / 4);
  });
  expect(mean, 'a blank page is white (255); the black image must show').toBeLessThan(40);
});

test('the grid keeps the sort order for Tab and screen readers even though tiles sit in masonry columns', async ({ page }) => {
  await page.setViewportSize({ width: 1080, height: 680 });
  await page.goto('/');
  await page.locator('.library-panel input[type=file]').setInputFiles([...pngFiles].reverse());
  await expect(page.locator('.library-tile')).toHaveCount(6);
  await page.locator('.library-sort').selectOption('name');
  const order = () => page.locator('.library-tile-open').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label')));
  // DOM (and so Tab) order is the sorted list, not column by column.
  await expect.poll(order).toEqual([1, 2, 3, 4, 5, 6].map(n => `Open plate-${n}.png`));
  // ...while the tiles really are spread over several columns, each starting a column in reading order.
  expect(await tileColumns(page)).toBeGreaterThan(1);
  await page.locator('.library-tile-open').first().focus();
  await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
  await expect(page.locator('.library-tile-open:focus')).toHaveAttribute('aria-label', 'Open plate-2.png');
});

test('in the board a tile is a toggle: pressing selects it, pressing the selected one opens it', async ({ page }) => {
  await page.setViewportSize({ width: 1080, height: 680 });
  await page.goto('/');
  await page.locator('.library-panel input[type=file]').setInputFiles(pngFiles);
  await expect(page.locator('.library-tile')).toHaveCount(6);
  await page.getByRole('button', { name: 'Open library board' }).click();
  const selected = page.locator('.library-tile-open[aria-pressed=true]');
  await expect(selected).toHaveCount(1);
  const other = page.locator('.library-tile-open[aria-pressed=false]').first();
  const name = (await other.getAttribute('aria-label'))!.replace(/^Select /, '');
  await other.click();
  // Exposed to assistive technology: pressed, and now named for what activating it does.
  await expect(page.getByRole('button', { name: `Open ${name}` })).toHaveAttribute('aria-pressed', 'true');
  await expect(selected).toHaveCount(1);
  await expect(page.locator('#library-root')).toHaveClass(/is-board/);
  await page.getByRole('button', { name: `Open ${name}` }).click();
  await expect(page.locator('#filename')).toHaveText(name);
  await expect(page.locator('#library-root')).not.toHaveClass(/is-board/);
});

test('tiles built while the library is hidden still load their pictures once it opens', async ({ page }) => {
  // Compact window: the library is closed, so the grid is built with no width and its tiles are attached
  // only when the window grows and the drawer opens.
  await page.goto('/');
  await expect(page.locator('#library-root')).toBeHidden();
  await page.locator('.library-panel input[type=file]').setInputFiles(pngFiles);
  // The tiles exist in the sorted list but have no width to be seen in, so nothing is loaded yet.
  await expect(page.locator('.library-tile')).toHaveCount(6);
  await expect(page.locator('.library-tile-media.is-loaded')).toHaveCount(0);
  await page.setViewportSize({ width: 1080, height: 680 });
  await expect(page.locator('#library-root')).toBeVisible();
  await expect(page.locator('.library-tile')).toHaveCount(6);
  await expect(page.locator('.library-tile-media.is-loaded')).toHaveCount(6);
});

test('compact library sheet shows the grid in two columns without sideways overflow', async ({ page }) => {
  await page.goto('/');
  await page.locator('#library-toggle').click();
  await expect(page.locator('#library-root')).toBeVisible();
  await page.locator('.library-panel input[type=file]').setInputFiles(pngFiles);
  const documents = page.locator('.library-documents');
  await expect(documents).toHaveClass(/library-grid/);
  await expect(page.locator('.library-tile')).toHaveCount(6);
  await expect.poll(() => tileColumns(page)).toBe(2);
  const fit = await page.evaluate(() => {
    const area = document.querySelector('.library-documents')!, panel = document.querySelector('.library-panel')!;
    const inside = Array.from(area.querySelectorAll('.library-tile')).every(tile => { const box = tile.getBoundingClientRect(), edge = panel.getBoundingClientRect(); return box.left >= edge.left && box.right <= edge.right; });
    return { scrolls: area.scrollWidth > area.clientWidth, panelScrolls: panel.scrollWidth > panel.clientWidth, inside, sheet: Math.round(panel.getBoundingClientRect().width) };
  });
  expect(fit).toEqual({ scrolls: false, panelScrolls: false, inside: true, sheet: 306 });
  // The scope popover opens inside the sheet and the Escape key closes it before the sheet itself.
  await page.getByRole('button', { name: /Choose collection and filters/ }).click();
  await expect(page.locator('#library-scope-menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#library-scope-menu')).toBeHidden();
  await expect(page.locator('#library-root')).toBeVisible();
});

test('the colour filter narrows the library to a named hue with a removable chip, on top of search, and swatches set it', async ({ page }) => {
  const solid = (name: string, colour: [number, number, number]) => ({ name: `${name}.png`, mimeType: 'image/png', buffer: pngFixture(90, 120, colour) });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.locator('.library-panel input[type=file]').setInputFiles([solid('green-one', [46, 139, 58]), solid('green-two', [60, 160, 70]), solid('red-one', [192, 48, 32]), solid('blue-one', [48, 80, 192]), solid('grey-one', [128, 128, 128])]);
  // A picture's colours are measured when its thumbnail is made.
  await expect(page.locator('.library-tile-media.is-loaded')).toHaveCount(5);
  const chip = page.locator('.library-colour-chip'), tiles = page.locator('.library-tile');
  await expect(chip).toBeHidden();
  await page.getByRole('button', { name: /Choose collection and filters/ }).click();
  await page.getByLabel('Filter by colour').selectOption('green');
  await expect(chip).toHaveText(/Green/);
  await expect(tiles).toHaveCount(2);
  await expect(page.locator('.library-result-count')).toHaveText('2 references');
  // It sits on top of the search: the same hue with a title that matches only one of them.
  await page.getByRole('searchbox').fill('green-two');
  await expect(tiles).toHaveCount(1);
  await page.getByRole('searchbox').fill('red-one');
  await expect(tiles).toHaveCount(0);
  await page.getByRole('searchbox').fill('');
  await expect(tiles).toHaveCount(2);
  // The chip removes it again, and the select follows.
  await page.getByRole('button', { name: 'Remove colour filter: green' }).click();
  await expect(chip).toBeHidden();
  await expect(tiles).toHaveCount(5);
  await expect(page.getByLabel('Filter by colour')).toHaveValue('');
  // In the board, a swatch of the selected reference sets the filter to its hue.
  await page.getByRole('button', { name: 'Open library board' }).click();
  await page.locator('.library-tile', { has: page.getByLabel('Select red-one.png') }).click();
  await expect(page.locator('.library-detail-name')).toHaveText('red-one.png');
  await page.getByRole('button', { name: 'Filter the library by red' }).first().click();
  await expect(chip).toHaveText(/Red/);
  await expect(tiles).toHaveCount(1);
});

test('the library board browses at full width and a detail strip joins from 1200 px', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.locator('.library-panel input[type=file]').setInputFiles(pngFiles);
  await expect(page.locator('.library-tile')).toHaveCount(6);
  // The palette command opens the board (and the drawer if it was closed).
  await page.mouse.click(1100, 450); // Shortcuts belong to the reading panel, not the library's own fields.
  await page.keyboard.press('Control+k');
  await page.locator('#palette-input').fill('library board');
  await page.keyboard.press('Enter');
  await expect(page.locator('#library-root')).toHaveClass(/is-board/);
  await expect(page.locator('.library-detail')).toBeVisible();
  await expect.poll(() => tileColumns(page)).toBe(6);
  // The first reference is selected and described; a click moves the selection without opening anything.
  await expect(page.locator('.library-detail-name')).toHaveCount(1);
  const tiles = page.locator('.library-tile');
  await tiles.nth(1).click();
  const name = (await tiles.nth(1).locator('.library-tile-open').getAttribute('aria-label'))!.replace(/^(Open|Select) /, '');
  await expect(page.locator('.library-detail-name')).toHaveText(name);
  await expect(page.locator('#library-root')).toHaveClass(/is-board/);
  await expect(page.locator('#filename')).not.toHaveText(name);
  // Enter opens the selected reference and leaves the board.
  await tiles.nth(1).locator('.library-tile-open').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#filename')).toHaveText(name);
  await expect(page.locator('#library-root')).not.toHaveClass(/is-board/);
  // Below 720 px there is no board: the sheet is all there is.
  await page.setViewportSize({ width: 420, height: 620 });
  await page.locator('#library-toggle').click();
  await expect(page.locator('.library-board-toggle')).toBeHidden();
});

test('browser library lists one document per file however it is added or opened', async ({ page }) => {
  const plate = pngFiles[0];
  const openButtons = page.locator('.library-document-open');
  await page.goto('/');
  // Added to the library, then the same file opened directly.
  await page.locator('.library-panel input[type=file]').setInputFiles(plate);
  await expect(page.locator('.library-document')).toHaveCount(1);
  await page.locator('#file-input').setInputFiles(plate);
  await expect(page.locator('#filename')).toHaveText(plate.name);
  await expect(page.locator('.library-document')).toHaveCount(1);
  // One pick holding the same file again plus a different one commits in a single step: only the different one is new.
  await page.locator('.library-panel input[type=file]').setInputFiles([plate, pngFiles[1]]);
  await expect(page.locator('.library-document')).toHaveCount(2);
  expect(await openButtons.evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')))).toEqual(expect.arrayContaining([`Open ${plate.name}`, `Open ${pngFiles[1].name}`]));
  expect(new Set(await openButtons.evaluateAll(nodes => nodes.map(node => (node as HTMLElement).title))).size).toBe(2);
  // Opened first (a fresh browser context has an empty library), then added.
  const fresh = await page.context().browser()!.newContext();
  const other = await fresh.newPage();
  await other.goto(page.url());
  await other.locator('#file-input').setInputFiles(plate);
  await expect(other.locator('.library-document')).toHaveCount(1);
  await other.locator('.library-panel input[type=file]').setInputFiles([plate, pngFiles[1]]);
  await expect(other.locator('.library-document')).toHaveCount(2);
  await fresh.close();
});

test('PDF page-bitmap cache never reuses pixels across rotation', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await page.locator('#file-input').setInputFiles({ name: 'rotation.pdf', mimeType: 'application/pdf', buffer: pdfFixture() });
  await expect(page.locator('.textLayer')).toContainText('First page with selectable text');
  // Vertical centre of the painted text, as a fraction of canvas height. Page 1 carries its
  // only line near the top, so upright reads < .5 and a 180° turn must read > .5.
  const inkCentre = () => page.locator('.pdf-page canvas').evaluate((canvas: HTMLCanvasElement) => {
    const { data, width, height } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
    let sum = 0, count = 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const i = (y * width + x) * 4; if (data[i + 3] > 0 && data[i] < 128) { sum += y; count++; } }
    return count ? sum / count / height : -1;
  });
  const rotate = async () => {
    await page.getByRole('button', { name: 'Reader menu' }).click();
    await page.getByRole('button', { name: 'Rotate page 90°' }).click();
    await expect(page.locator('.pdf-render-status')).toHaveCount(0);
    await expect(page.locator('.textLayer')).toContainText('First page');
  };
  const upright = await inkCentre();
  expect(upright).toBeGreaterThan(0); expect(upright).toBeLessThan(.5);
  // 0° and 180° share pixel dimensions, so a size-only cache key would blit the upright page.
  await rotate(); await rotate();
  expect(await inkCentre()).toBeGreaterThan(.5);
  await rotate(); await rotate();
  expect(Math.abs(await inkCentre() - upright)).toBeLessThan(.02);
  expect(errors).toEqual([]);
});

test('reflowable EPUB renders real chapters, blocks scripts/network, and follows links/back', async ({ page }) => {
  const remote: string[] = [], errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', req => { if (req.url().includes('should-never-fetch')) remote.push(req.url()); });
  await page.goto('/');
  const buffer = await epubFixture(); await recordFixture('flow.epub', buffer, { chapters: 2, layout: 'reflowable', hostileContent: ['script', 'external image'] });
  const file = { name: 'flow.epub', mimeType: 'application/epub+zip', buffer };
  await page.locator('#file-input').setInputFiles(file);
  await expect(page.locator('#filename')).toHaveText('flow.epub');
  await expect(page.locator('#position')).toContainText('Opening chapter');
  const content = () => page.frames().find(frame => frame.url().startsWith('blob:'))!;
  await expect.poll(() => !!content()).toBe(true);
  await expect(content().locator('h1')).toHaveText('Opening chapter');
  await page.screenshot({ path: 'test-results/reader-epub.png' });
  expect(await content().evaluate(() => window.frameElement?.getAttribute('sandbox'))).toBe('allow-same-origin');
  expect(await page.locator('body').getAttribute('data-compromised')).toBeNull();
  await content().getByRole('link', { name: 'Jump to other chapter' }).click();
  await expect(page.locator('#position')).toContainText('Second chapter');
  await page.locator('.reader-host').focus(); await page.keyboard.press('Alt+ArrowLeft');
  await expect(page.locator('#position')).toContainText('Opening chapter');
  await page.keyboard.press('Control+g'); await page.locator('#target').fill('70%'); await page.getByRole('button', { name: 'Go to location', exact: true }).click();
  await expect(page.locator('#position')).toContainText('Second chapter');
  await page.setViewportSize({ width: 760, height: 900 });
  await expect(page.locator('#position')).toContainText('Second chapter');
  await page.locator('.reader-host').focus(); await page.keyboard.press('Control+Equal');
  await expect(page.locator('#position')).toContainText('Second chapter');
  await expect.poll(async () => Number(await page.locator('#progress').getAttribute('aria-valuenow'))).toBeGreaterThan(60);
  await page.waitForTimeout(900); // Wait for the public settled-position persistence contract.
  const before = Number(await page.locator('#progress').getAttribute('aria-valuenow'));
  await page.reload(); await page.locator('#file-input').setInputFiles(file);
  await expect(page.locator('#position')).toContainText('Second chapter');
  const after = Number(await page.locator('#progress').getAttribute('aria-valuenow'));
  expect(Math.abs(before - after)).toBeLessThan(5);
  expect(remote).toEqual([]); expect(errors).toEqual([]);
});

test('fixed-layout EPUB keeps physical single pages and supports next/fit', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  const buffer = await epubFixture(true); await recordFixture('fixed.epub', buffer, { pages: 2, layout: 'pre-paginated', viewport: '800 x 1000' });
  await page.locator('#file-input').setInputFiles({ name: 'fixed.epub', mimeType: 'application/epub+zip', buffer });
  await expect(page.locator('#filename')).toHaveText('fixed.epub');
  await expect(page.locator('#filekind')).toHaveAttribute('title', /Page view/);
  await expect(page.locator('#position')).toContainText('Page 1 of 2');
  const first = page.frames().find(frame => frame.url().startsWith('blob:'))!;
  await expect(first.locator('h1')).toHaveText('Opening chapter');
  expect(await first.evaluate(() => window.frameElement?.getAttribute('sandbox'))).toBe('allow-same-origin');
  await page.keyboard.press('PageDown');
  await expect(page.locator('#position')).toContainText('Page 2 of 2');
  await page.keyboard.press('Control+2');
  expect(errors).toEqual([]);
});

test('PDF view controls zoom, pan 1:1 by hand tool and middle button, and keep links clickable', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await page.locator('#file-input').setInputFiles({ name: 'hand.pdf', mimeType: 'application/pdf', buffer: pdfFixture() });
  await expect(page.locator('.textLayer')).toContainText('First page with selectable text');
  const host = page.locator('.pdf-reader'), hand = page.getByRole('button', { name: 'Hand tool' });
  const scroll = () => host.evaluate(el => [el.scrollLeft, el.scrollTop]);
  await expect(page.locator('#view-controls')).toBeVisible();
  await expect(page.locator('#zoom-level')).toHaveText('Fit');
  await expect(hand).toHaveAttribute('aria-disabled', 'true');
  await expect(hand).toHaveAttribute('title', 'Zoom in to pan');
  await host.focus(); await page.keyboard.press('h');
  await expect(hand).toHaveAttribute('aria-pressed', 'false'); // Nothing overflows yet.
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Zoom in' }).click();
  await page.keyboard.press('Control+Equal'); // Shortcut and pill share one zoom state.
  await expect(page.locator('#zoom-level')).toHaveText('150%');
  await expect(page.locator('.pdf-render-status')).toHaveCount(0);
  await expect(hand).toHaveAttribute('aria-disabled', 'false');
  await expect(host).toBeFocused(); // Pill clicks leave keyboard focus on the page.
  await page.keyboard.press('h');
  await expect(hand).toHaveAttribute('aria-pressed', 'true');
  await expect(host).toHaveClass(/hand-tool/);
  await expect(page.locator('#filekind')).toHaveAttribute('title', /^PDF · 150% · Hand$/m);

  // A drag moves the page exactly with the pointer and does not select text.
  const box = (await host.boundingBox())!;
  const [left, top] = await scroll();
  await page.mouse.move(box.x + 200, box.y + 300); await page.mouse.down();
  await page.mouse.move(box.x + 160, box.y + 240, { steps: 4 }); await page.mouse.up();
  expect(await scroll()).toEqual([left + 40, top + 60]);
  expect(await page.evaluate(() => getSelection()?.toString())).toBe('');

  // A drag that starts on a link pans without following it; a still click follows it.
  const link = page.locator('.pdf-link');
  await link.scrollIntoViewIfNeeded();
  const target = (await link.boundingBox())!;
  await page.mouse.move(target.x + 20, target.y + target.height / 2); await page.mouse.down();
  await page.mouse.move(target.x + 50, target.y + target.height / 2 + 10, { steps: 4 }); await page.mouse.up();
  await page.waitForTimeout(200);
  await expect(page.locator('#position')).toContainText('Page 1 of 3');
  await link.click();
  await expect(page.locator('#position')).toContainText('Page 2 of 3');

  // Middle-button drag pans with the hand tool off (page 1 overflows on both axes at 150%).
  await page.keyboard.press('h');
  await expect(hand).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(page.locator('#position')).toContainText('Page 1 of 3');
  await expect(page.locator('.pdf-render-status')).toHaveCount(0);
  await host.evaluate(el => { el.scrollLeft = 0; el.scrollTop = 0; });
  await page.mouse.move(box.x + 200, box.y + 300); await page.mouse.down({ button: 'middle' });
  await page.mouse.move(box.x + 170, box.y + 270, { steps: 4 }); await page.mouse.up({ button: 'middle' });
  expect(await scroll()).toEqual([30, 30]);

  // Returning to fit makes the hand tool unavailable again; a new document resets it.
  await page.keyboard.press('h');
  await page.locator('#zoom-level').click();
  await expect(page.locator('#zoom-level')).toHaveText('Fit');
  await expect(hand).toHaveAttribute('aria-disabled', 'true');
  await expect(hand).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#zoom-level').click();
  await expect(page.locator('#zoom-level')).toHaveText('Width');
  await page.locator('#file-input').setInputFiles({ name: 'notes.md', mimeType: 'text/markdown', buffer: Buffer.from('# Notes\n\nPlain reflowing text.') });
  await expect(page.locator('#filename')).toHaveText('notes.md');
  await expect(page.locator('#view-controls')).toBeHidden();
  expect(errors).toEqual([]);
});

test('image-only PDF pages carry no note, say so in the tooltip and explain a select-drag once', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.goto('/');
  const buffer = scanPdf(['text', 'image', 'image', 'text']);
  const file = { name: 'mixed-scan.pdf', mimeType: 'application/pdf', buffer };
  await recordFixture('mixed-scan.pdf', buffer, { pages: 4, textLayer: 'pages 1 and 4 only' });
  const open = () => page.locator('#file-input').setInputFiles(file);
  const host = page.locator('.pdf-reader'), notice = page.locator('#notice'), title = page.locator('#filekind');
  const tip = /^Image-only page: text can't be selected or searched$/m;
  const noNote = async () => {
    await expect(page.locator('.pdf-scan-note')).toHaveCount(0);
    await expect(page.locator('.pdf-page', { hasText: 'Image-only' })).toHaveCount(0);
  };
  const turn = async (key: string, position: string) => { await host.focus(); await page.keyboard.press(key); await expect(page.locator('#position')).toContainText(position); };
  const drag = async (button: 'left' | 'middle' = 'left', selector = '.pdf-page') => {
    const box = (await page.locator(selector).first().boundingBox())!, x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.mouse.move(x, y); await page.mouse.down({ button }); await page.mouse.move(x + 40, y + 20, { steps: 5 }); await page.mouse.up({ button });
  };
  const zoomTo = async (level: string, button: 'Zoom in' | 'Zoom out') => {
    // One step at a time: a click is applied asynchronously, so wait for the label to move before the next.
    for (let i = 0; i < 14; i++) {
      const current = (await page.locator('#zoom-level').textContent())!;
      if (current === level) break;
      await page.getByRole('button', { name: button }).click();
      await expect(page.locator('#zoom-level')).not.toHaveText(current);
    }
    await expect(page.locator('#zoom-level')).toHaveText(level); await expect(page.locator('.pdf-render-status')).toHaveCount(0);
  };
  const message = "This page is a scanned image, so its text can't be selected or searched.";

  await open();
  await expect(page.locator('.textLayer')).toContainText('Text page 1');
  await expect(title).not.toHaveAttribute('title', /Image-only/); // The cover has text.
  await noNote();
  await drag(); await expect(notice).toBeHidden(); // A select-drag on a text page never explains anything.

  // Tooltip: exactly while an image-only page is on screen, never duplicated.
  await turn('PageDown', 'Page 2 of 4');
  await expect(title).toHaveAttribute('title', tip);
  expect((await title.getAttribute('title'))!.match(/Image-only page/g)).toHaveLength(1);
  await noNote();
  await turn('PageDown', 'Page 3 of 4'); await expect(title).toHaveAttribute('title', tip);
  await turn('PageDown', 'Page 4 of 4'); await expect(title).not.toHaveAttribute('title', /Image-only/); await noNote();
  await turn('PageUp', 'Page 3 of 4'); await expect(title).toHaveAttribute('title', tip);

  // Intent cue: not for clicks, middle drags or hand drags; yes for the first select-drag only.
  { const box = (await page.locator('.pdf-page').first().boundingBox())!; await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); } await expect(notice).toBeHidden();
  await drag('middle'); await expect(notice).toBeHidden();
  await zoomTo('150%', 'Zoom in');
  await host.focus(); await page.keyboard.press('h');
  await expect(page.getByRole('button', { name: 'Hand tool' })).toHaveAttribute('aria-pressed', 'true');
  await drag(); await expect(notice).toBeHidden();
  await page.keyboard.press('h');
  await expect(page.getByRole('button', { name: 'Hand tool' })).toHaveAttribute('aria-pressed', 'false');
  await noNote();
  await drag(); await expect(notice).toBeVisible(); await expect(notice).toContainText(message);
  await expect(page.locator('#retry-save')).toBeHidden();
  await page.getByRole('button', { name: 'Dismiss message' }).click(); await expect(notice).toBeHidden();
  await drag(); await expect(notice).toBeHidden(); // Once per opened document.

  // Opening the document again re-arms it; two-page view and zoom levels never draw a note.
  await open(); await expect(page.locator('#position')).toContainText('Page 3 of 4'); await expect(page.locator('.reader-host.staging')).toHaveCount(0); // The saved place is restored.
  await page.locator('.reader-host').focus(); await page.keyboard.press('Control+3');
  await expect(page.locator('.pdf-spread')).toHaveAttribute('data-side', 'both');
  await expect(page.locator('#position')).toContainText('Pages 2–3 of 4');
  await expect(page.locator('.pdf-spread .pdf-page')).toHaveCount(2);
  await expect(title).toHaveAttribute('title', tip); await noNote();
  await page.keyboard.press('Control+2'); await noNote();
  await page.keyboard.press('Control+0'); await noNote();
  await page.keyboard.press('Control+0'); await zoomTo('70%', 'Zoom out'); await noNote();
  await zoomTo('150%', 'Zoom in'); await noNote();
  await page.keyboard.press('Control+0'); await expect(page.locator('#zoom-level')).toHaveText('Fit');
  await expect(page.locator('.pdf-render-status')).toHaveCount(0); await expect(title).toHaveAttribute('title', tip); // Text has been read, so the page is known to be image-only.
  await drag('left', '.pdf-spread .pdf-page:nth-child(2)'); await expect(notice).toBeVisible(); await expect(notice).toContainText(message);

  // A PDF with no text on any page is image-only on every page, and the find bar still answers.
  await page.locator('#file-input').setInputFiles({ name: 'scan.pdf', mimeType: 'application/pdf', buffer: scanPdf(['image', 'image', 'image']) });
  await expect(page.locator('#position')).toContainText('Page 1 of 3');
  await expect(title).toHaveAttribute('title', tip); await noNote();
  expect(errors).toEqual([]);
});

test('fixed-layout EPUB pans inside its zoomed page frame and keeps frame links clickable', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await page.locator('#file-input').setInputFiles({ name: 'fixed-hand.epub', mimeType: 'application/epub+zip', buffer: await epubFixture(true) });
  await expect(page.locator('#position')).toContainText('Page 1 of 2');
  await expect(page.locator('#view-controls')).toBeVisible();
  await page.locator('.reader-host').focus(); await page.keyboard.press('Control+Equal');
  const hand = page.getByRole('button', { name: 'Hand tool' });
  await expect(hand).toHaveAttribute('aria-disabled', 'false');
  await hand.click();
  await expect(hand).toHaveAttribute('aria-pressed', 'true');
  const scroll = () => page.evaluate(() => { const r = (document.querySelector('foliate-view') as HTMLElement & { renderer: HTMLElement }).renderer; return [r.scrollLeft, r.scrollTop]; });
  const [left, top] = await scroll();
  const box = (await page.locator('.reader-host').boundingBox())!;
  // Raw CDP input: Playwright's page.mouse drag stalls over these script-less sandboxed frames
  // (observed with the hand tool off as well), so the drag is dispatched below its drag-and-drop layer.
  const cdp = await page.context().newCDPSession(page);
  const mouse = (type: 'mouseMoved' | 'mousePressed' | 'mouseReleased', dx: number, dy: number) => cdp.send('Input.dispatchMouseEvent', { type, x: box.x + 200 + dx, y: box.y + 300 + dy, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x + 200, y: box.y + 300 });
  await mouse('mousePressed', 0, 0);
  for (let step = 1; step <= 5; step++) await mouse('mouseMoved', -6 * step, -10 * step);
  await mouse('mouseReleased', -30, -50);
  expect(await scroll()).toEqual([left + 30, top + 50]);
  const frame = page.frames().find(f => f.url().startsWith('blob:'))!;
  await frame.getByRole('link', { name: 'Jump to other chapter' }).click();
  await expect(page.locator('#position')).toContainText('Page 2 of 2');
  expect(errors).toEqual([]);
});

/** Opens the fixture PDF at the given viewport with the library drawer closed, and waits for a settled page. */
async function openPdfForPill(page: Page, viewport: { width: number; height: number }) {
  await page.setViewportSize(viewport);
  await page.goto('/');
  await page.locator('#file-input').setInputFiles({ name: 'pill.pdf', mimeType: 'application/pdf', buffer: pdfFixture() });
  await expect(page.locator('#position')).toContainText('Page 1 of 3');
  await expect(page.locator('#loading')).toBeHidden();
  await expect(page.locator('#view-controls')).toBeVisible();
  if (await page.locator('#library-root').isVisible()) await page.locator('#library-toggle').click();
  await expect(page.locator('#library-root')).toBeHidden();
}

test('view controls pill moves by its grip, stays inside the panel, persists, resets, and never refits the page', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await openPdfForPill(page, { width: 1080, height: 700 });
  const pill = page.locator('#view-controls'), grip = page.getByRole('button', { name: 'Move view controls' });
  const workspace = page.locator('#workspace'), host = page.locator('.pdf-reader'), canvas = page.locator('.pdf-page canvas');
  await expect(grip).toHaveAttribute('title', 'Drag to move · double-click to reset');
  const geometry = async () => ({
    workspace: await workspace.boundingBox(), hostClientWidth: await host.evaluate(el => el.clientWidth),
    canvasBox: await canvas.boundingBox(), bitmap: await canvas.evaluate((el: HTMLCanvasElement) => ({ width: el.width, height: el.height })),
  });
  // Wait out the deferred refit so the baseline is the settled page; anything after it is the regression.
  await expect.poll(async () => { const before = JSON.stringify(await geometry()); await page.waitForTimeout(200); return JSON.stringify(await geometry()) === before; }, { timeout: 5000 }).toBe(true);
  const untouched = await geometry();
  const inside = async () => {
    const box = (await pill.boundingBox())!, panel = (await workspace.boundingBox())!;
    // The panel's top border is 1 px; the pill keeps 8 px from every edge and 36 px above the bottom.
    expect(box.x).toBeGreaterThanOrEqual(panel.x + 8 - .5); expect(box.y).toBeGreaterThanOrEqual(panel.y + 1 + 8 - .5);
    expect(box.x + box.width).toBeLessThanOrEqual(panel.x + panel.width - 8 + .5); expect(box.y + box.height).toBeLessThanOrEqual(panel.y + panel.height - 36 + .5);
    return box;
  };
  const home = await inside();
  expect(await pill.evaluate(el => el.getAttribute('style'))).toBeFalsy(); // Untouched: pure CSS placement.
  expect(await page.evaluate(() => localStorage.getItem('hold-my-brief:view-controls'))).toBeNull();

  // A plain click on the grip is not a move.
  await grip.click(); expect(await pill.evaluate(el => el.getAttribute('style'))).toBeFalsy();

  // Drag past the top-left corner: the pill follows, clamps to the 8 px margin, and the page is untouched.
  const panel = (await workspace.boundingBox())!, handle = (await grip.boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2); await page.mouse.down();
  await page.mouse.move(panel.x + 200, panel.y + 120, { steps: 6 });
  await page.mouse.move(panel.x + 1, panel.y + 1, { steps: 6 }); await page.mouse.up();
  const moved = await inside();
  expect(moved.x).toBeCloseTo(panel.x + 8, 0); expect(moved.y).toBeCloseTo(panel.y + 1 + 8, 0);
  expect(await geometry()).toEqual(untouched);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('hold-my-brief:view-controls')!))).toEqual({ x: expect.any(Number), y: expect.any(Number) });

  // The buttons keep working where the pill now sits.
  await page.locator('#zoom-in').click();
  await expect(page.locator('#zoom-level')).not.toHaveText('Fit');
  await page.locator('#zoom-level').click();
  await expect(page.locator('#zoom-level')).toHaveText('Fit');
  await expect.poll(async () => JSON.stringify(await geometry()) === JSON.stringify(untouched)).toBe(true);

  // A reload keeps the position.
  await page.reload();
  await page.locator('#file-input').setInputFiles({ name: 'pill.pdf', mimeType: 'application/pdf', buffer: pdfFixture() });
  await expect(page.locator('#position')).toContainText('Page 1 of 3');
  await expect(pill).toBeVisible();
  await expect.poll(async () => Math.abs((await pill.boundingBox())!.x - moved.x) < 1.5 && Math.abs((await pill.boundingBox())!.y - moved.y) < 1.5).toBe(true);

  // Shrinking the window keeps it inside and proportional; growing it back restores the position.
  await page.setViewportSize({ width: 420, height: 500 });
  await expect.poll(async () => (await pill.boundingBox())!.x + (await pill.boundingBox())!.width <= (await workspace.boundingBox())!.width - 8 + .5).toBe(true);
  await inside();
  await page.setViewportSize({ width: 1080, height: 700 });
  await expect.poll(async () => Math.abs((await pill.boundingBox())!.x - moved.x) < 1.5 && Math.abs((await pill.boundingBox())!.y - moved.y) < 1.5).toBe(true);

  // Double-click resets to the CSS placement and clears the stored position.
  await grip.dblclick();
  await expect.poll(async () => { const box = (await pill.boundingBox())!; return Math.abs(box.x - home.x) < 1.5 && Math.abs(box.y - home.y) < 1.5; }).toBe(true);
  expect(await pill.evaluate(el => el.style.left)).toBe('');
  expect(await page.evaluate(() => localStorage.getItem('hold-my-brief:view-controls'))).toBeNull();

  // Keyboard: arrows move 16 px (Shift 64 px) from wherever the pill is; Home resets.
  await grip.focus(); await page.keyboard.press('ArrowUp');
  let box = (await pill.boundingBox())!;
  expect(box.x).toBeCloseTo(home.x, 0); expect(box.y).toBeCloseTo(home.y - 16, 0);
  await page.keyboard.press('ArrowLeft');
  box = (await pill.boundingBox())!; expect(box.x).toBeCloseTo(home.x - 16, 0);
  await page.keyboard.press('Shift+ArrowUp');
  box = (await pill.boundingBox())!; expect(box.y).toBeCloseTo(home.y - 80, 0);
  await page.keyboard.press('Shift+ArrowDown'); await page.keyboard.press('ArrowDown');
  box = (await pill.boundingBox())!; expect(box.y).toBeCloseTo(home.y, 0);
  for (let i = 0; i < 40; i++) await page.keyboard.press('Shift+ArrowUp'); // Held against the top edge, never outside.
  await inside();
  expect(await geometry()).toEqual(untouched);
  await page.keyboard.press('Home');
  await expect.poll(async () => { const b = (await pill.boundingBox())!; return Math.abs(b.x - home.x) < 1.5 && Math.abs(b.y - home.y) < 1.5; }).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem('hold-my-brief:view-controls'))).toBeNull();
  expect(errors).toEqual([]);
});

test('a moved view-controls pill steps out from under the library drawer and returns when it closes', async ({ page }) => {
  await openPdfForPill(page, { width: 1080, height: 700 });
  const pill = page.locator('#view-controls'), grip = page.getByRole('button', { name: 'Move view controls' }), workspace = page.locator('#workspace');
  const panel = (await workspace.boundingBox())!, handle = (await grip.boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2); await page.mouse.down();
  await page.mouse.move(panel.x + 1, panel.y + 1, { steps: 8 }); await page.mouse.up();
  const corner = (await pill.boundingBox())!;
  expect(corner.x).toBeCloseTo(panel.x + 8, 0);

  await page.locator('#library-toggle').click();
  await expect(page.locator('#library-root')).toBeVisible();
  const drawer = (await page.locator('#library-root').boundingBox())!;
  await expect.poll(async () => (await pill.boundingBox())!.x >= drawer.x + drawer.width + 8 - .5).toBe(true);
  expect((await pill.boundingBox())!.x + (await pill.boundingBox())!.width).toBeLessThanOrEqual(panel.x + panel.width - 8 + .5);

  // Docking the drawer to the other side moves the pill back to its own place.
  await page.getByRole('button', { name: 'Move library to the right' }).click();
  await expect.poll(async () => Math.abs((await pill.boundingBox())!.x - corner.x) < 1.5).toBe(true);
  await page.getByRole('button', { name: 'Move library to the left' }).click();
  await expect.poll(async () => (await pill.boundingBox())!.x >= drawer.x + drawer.width + 8 - .5).toBe(true);

  await page.locator('#library-toggle').click();
  await expect(page.locator('#library-root')).toBeHidden();
  await expect.poll(async () => Math.abs((await pill.boundingBox())!.x - corner.x) < 1.5).toBe(true);
});
