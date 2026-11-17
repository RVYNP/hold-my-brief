import type { Page } from '@playwright/test';

/** What the row of a pane that is not the active one draws: text (4.5:1) and icons (3:1), by selector. */
const inks = [
  { selector: '.tab-title', kind: 'text' }, { selector: '.tab-format', kind: 'text' }, { selector: '.tab-where', kind: 'text' }, { selector: '.tab-hint', kind: 'text' },
  { selector: '.tab-close', kind: 'icon' }, { selector: '.tab-add', kind: 'icon' }, { selector: '.tab-overflow', kind: 'icon' }, { selector: '.pane-fold', kind: 'icon' },
] as const;

/**
 * The lowest contrast of a row's text and icons against what is drawn under them, measured the way the browser composites it: every ink is made
 * transparent, the row is read back under each ink's own box, and the ink's computed colour (taken beforehand, composited over the pixel if it has alpha)
 * is compared with each of those pixels. The row must be showing and not under the page's dimming (the dimming covers the page, not the row).
 */
export async function lowestRowContrast(page: Page, row: string): Promise<{ text: { ratio: number; label: string }; icon: { ratio: number; label: string }; texts: number; icons: number }> {
  const boxes = await page.evaluate(({ row, inks }) => {
    const out: { label: string; kind: string; rect: [number, number, number, number]; colour: number[] }[] = [];
    const swatch = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!; // turns any colour syntax into 8-bit channels and alpha
    swatch.canvas.width = swatch.canvas.height = 1;
    for (const { selector, kind } of inks) for (const node of document.querySelectorAll<HTMLElement>(`${row} ${selector}`)) {
      if (node.closest('[hidden]') || getComputedStyle(node).display === 'none' || (kind === 'text' && !node.textContent?.trim() && !node.querySelector('svg'))) continue;
      const range = document.createRange(); range.selectNodeContents(node);
      const box = kind === 'text' ? range.getBoundingClientRect() : (node.querySelector('svg') ?? node).getBoundingClientRect();
      if (!box.width || !box.height) continue;
      swatch.clearRect(0, 0, 1, 1); swatch.fillStyle = getComputedStyle(node).color; swatch.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = swatch.getImageData(0, 0, 1, 1).data;
      let opacity = 1; // an opacity on the row or any ancestor fades the ink as well
      for (let up: Element | null = node; up; up = up.parentElement) opacity *= Number(getComputedStyle(up).opacity);
      out.push({ label: `${selector} "${(node.textContent ?? '').trim().slice(0, 16)}"`, kind, rect: [box.left, box.top, box.right, box.bottom], colour: [r, g, b, a / 255 * opacity] });
    }
    return out;
  }, { row, inks });
  const rowBox = (await page.locator(row).boundingBox())!;
  const clip = { x: Math.floor(rowBox.x), y: Math.floor(rowBox.y), width: Math.ceil(rowBox.width), height: Math.ceil(rowBox.height) };
  const hide = await page.addStyleTag({ content: `${row} *, ${row} *::before, ${row} *::after { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; transition: none !important; }` });
  const png = (await page.screenshot({ animations: 'disabled', clip })).toString('base64');
  await hide.evaluate(node => (node as Element).remove());
  const ratios = await page.evaluate(async ({ png, boxes, clip }) => {
    const image = new Image();
    image.src = `data:image/png;base64,${png}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d', { willReadFrequently: true })!;
    context.drawImage(image, 0, 0);
    const lin = (value: number) => { const c = value / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const lum = (r: number, g: number, b: number) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    return boxes.map(box => {
      const left = Math.max(0, Math.floor(box.rect[0] - clip.x)), top = Math.max(0, Math.floor(box.rect[1] - clip.y));
      const right = Math.min(canvas.width, Math.ceil(box.rect[2] - clip.x)), bottom = Math.min(canvas.height, Math.ceil(box.rect[3] - clip.y));
      const data = context.getImageData(left, top, right - left, bottom - top).data;
      let lowest = Infinity;
      const [r, g, b, a] = box.colour;
      for (let index = 0; index < data.length; index += 4) {
        const back = [data[index], data[index + 1], data[index + 2]];
        const ink = [r, g, b].map((channel, i) => channel * a + back[i] * (1 - a));
        const light = lum(back[0], back[1], back[2]), mark = lum(ink[0], ink[1], ink[2]);
        lowest = Math.min(lowest, (Math.max(light, mark) + 0.05) / (Math.min(light, mark) + 0.05));
      }
      return { label: box.label, kind: box.kind, ratio: lowest };
    });
  }, { png, boxes, clip });
  const lowest = (kind: string) => ratios.filter(item => item.kind === kind).reduce((worst, item) => item.ratio < worst.ratio ? item : worst, { label: '', ratio: Infinity });
  return { text: lowest('text'), icon: lowest('icon'), texts: ratios.filter(item => item.kind === 'text').length, icons: ratios.filter(item => item.kind === 'icon').length };
}
