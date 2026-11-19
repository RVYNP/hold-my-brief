import type { Page } from '@playwright/test';

/** What Home draws text on straight from the ground (no card behind it): the title, section headings and shelf captions. */
const textBoxes = ['#empty h1', '.home-section h2', '.home-card-title', '.home-card-meta'];

/**
 * The lowest contrast of Home's text against the ground, measured the way the browser composites it. The worst ground pixel is one of the
 * three drawn tones; each is laid over the whole ground canvas in turn, every text is made transparent, and the page is read back under
 * each text's own box (its colour taken beforehand, composited over the pixel if it has alpha). The page must show Home with its ground
 * drawn, tall enough that every text is in the window. Leaves the ground canvas filled with the last tone: reload before reusing the page.
 */
export async function lowestTextContrast(page: Page): Promise<{ ratio: number; label: string; tone: string; texts: number }> {
  const boxes = await page.evaluate(selectors => {
    const out: { label: string; rect: [number, number, number, number]; colour: number[] }[] = [];
    // Computed colours may come in any syntax (color(srgb …) for a mixed token); a 1 px canvas turns each into 8-bit channels and alpha.
    const swatch = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
    swatch.canvas.width = swatch.canvas.height = 1;
    for (const selector of selectors) for (const node of document.querySelectorAll<HTMLElement>(selector)) {
      if (node.closest('.home-recent-open') || !node.textContent?.trim()) continue; // a recent card has its own background
      const range = document.createRange(); range.selectNodeContents(node); // the text's own box: a pill chip's corners are not under its label
      const box = range.getBoundingClientRect();
      swatch.clearRect(0, 0, 1, 1); swatch.fillStyle = getComputedStyle(node).color; swatch.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = swatch.getImageData(0, 0, 1, 1).data;
      out.push({ label: `${selector} "${node.textContent.trim().slice(0, 24)}"`, rect: [box.left, box.top, box.right, box.bottom], colour: [r, g, b, a / 255] });
    }
    return out;
  }, textBoxes);
  const height = page.viewportSize()!.height;
  for (const box of boxes) if (box.rect[3] > height) throw new Error(`${box.label} is below the window: use a taller viewport`);
  const tones = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas.home-ground:not(.is-leaving)')!, data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    const seen = new Set<string>();
    for (let index = 0; index < data.length; index += 4) if (data[index + 3] === 255) seen.add(`rgb(${data[index]}, ${data[index + 1]}, ${data[index + 2]})`);
    return [...seen];
  });
  if (tones.length !== 3) throw new Error(`the ground draws ${tones.length} tones, not 3`);
  const hide = await page.addStyleTag({ content: '*, *::before, *::after { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; caret-color: transparent !important; }' });
  let lowest = { ratio: Infinity, label: '', tone: '', texts: boxes.length };
  for (const tone of tones) {
    await page.evaluate(fill => {
      const canvas = document.querySelector<HTMLCanvasElement>('canvas.home-ground:not(.is-leaving)')!, context = canvas.getContext('2d')!;
      context.globalCompositeOperation = 'source-over'; context.fillStyle = fill; context.fillRect(0, 0, canvas.width, canvas.height);
    }, tone);
    const png = (await page.screenshot({ animations: 'disabled' })).toString('base64');
    const ratios = await page.evaluate(async ({ png, boxes }) => {
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
        const [left, top, right, bottom] = box.rect.map((value, index) => index < 2 ? Math.floor(value) : Math.ceil(value));
        const data = context.getImageData(left, top, right - left, bottom - top).data;
        let lowest = Infinity;
        const [r, g, b, a] = box.colour;
        for (let index = 0; index < data.length; index += 4) {
          const back = [data[index], data[index + 1], data[index + 2]];
          const ink = [r, g, b].map((channel, i) => channel * a + back[i] * (1 - a));
          const light = lum(back[0], back[1], back[2]), text = lum(ink[0], ink[1], ink[2]);
          lowest = Math.min(lowest, (Math.max(light, text) + 0.05) / (Math.min(light, text) + 0.05));
        }
        return { label: box.label, ratio: lowest };
      });
    }, { png, boxes });
    for (const item of ratios) if (item.ratio < lowest.ratio) lowest = { ratio: item.ratio, label: item.label, tone, texts: boxes.length };
  }
  await hide.evaluate(node => (node as Element).remove());
  return lowest;
}
