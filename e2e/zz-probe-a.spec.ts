import { test, expect } from '@playwright/test';

/** A PDF whose pages carry no text operators at all: only a full-page image, i.e. a scan without OCR. */
function imageOnlyPdf(pages = 3) {
  const stream = (text: string) => `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`;
  const pageIds = Array.from({ length: pages }, (_, i) => 5 + i * 2);
  // One 4x4 opaque greyscale image, reused by every page.
  const pixels = Buffer.alloc(4 * 4, 0x80).toString('latin1');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pages} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /XObject << /Im0 ${pageIds[pages - 1] + 1} 0 R >> >>`,
    ...Array.from({ length: pages }, (_, i) => [
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 600] /Resources 4 0 R /Contents ${pageIds[i] + 1} 0 R >>`,
      stream('q 400 0 0 600 0 0 cm /Im0 Do Q'),
    ]),
    `<< /Type /XObject /Subtype /Image /Width 4 /Height 4 /ColorSpace /DeviceGray /BitsPerComponent 8 /Length ${pixels.length} >>\nstream\n${pixels}\nendstream`,
  ];
  let out = '%PDF-1.7\n'; const offsets: number[] = [];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}

test('probe: image-only pages', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await page.locator('#file-input').setInputFiles({ name: 'scan.pdf', mimeType: 'application/pdf', buffer: imageOnlyPdf() });
  await expect(page.locator('#position')).toContainText('Page 1 of 3');
  await expect(page.locator('.pdf-render-status')).toHaveCount(0);
  console.log('SCAN-NOTES=', await page.locator('.pdf-scan-note').count());
  console.log('FILEKIND-TITLE=', JSON.stringify(await page.locator('#filekind').getAttribute('title')));
  console.log('NOTICE-HIDDEN=', await page.locator('#notice').getAttribute('hidden'));
  console.log('NOTICE-TEXT=', JSON.stringify(await page.locator('#notice span').textContent()));
  console.log('ERRORS=', JSON.stringify(errors));
});
