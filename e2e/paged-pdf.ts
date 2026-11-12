/**
 * A raw PDF of `count` pages (300 x 400 pt). Page n is filled with its own colour, so a thumbnail can be told
 * from its neighbours by pixels, and carries its number as large text. `labels` is a /PageLabels /Nums body.
 */
export function pagedPdf(count: number, labels = '') {
  const stream = (text: string) => `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`;
  const objects = [
    `<< /Type /Catalog /Pages 2 0 R${labels ? ` /PageLabels << /Nums [${labels}] >>` : ''} >>`,
    `<< /Type /Pages /Kids [${Array.from({ length: count }, (_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${count} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  for (let n = 1; n <= count; n++) {
    const [r, g, b] = pageColour(n);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + (n - 1) * 2} 0 R >>`);
    objects.push(stream(`${r / 255} ${g / 255} ${b / 255} rg 0 0 300 400 re f 1 1 1 rg BT /F1 120 Tf 90 150 Td (${n}) Tj ET`));
  }
  let out = '%PDF-1.7\n'; const offsets: number[] = [];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out);
}
/** Saturated colours a long way apart from each other, one per page. */
export function pageColour(n: number): [number, number, number] {
  const hue = (n * 47) % 360, f = (k: number) => { const t = (k + hue / 30) % 12; return .5 - .4 * Math.max(-1, Math.min(t - 3, Math.min(9 - t, 1))); };
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}
