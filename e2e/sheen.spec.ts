import { test, expect, type Page } from '@playwright/test';
import { seedLibrary } from './home-fixture';
import { chapterBook } from './epub-book';
import { pagedPdf } from './paged-pdf';
import { railHome } from './toolbar-tabs';

/**
 * The sheen: each theme's accent gradient, drawn in six places only (src/style.css, src/library.css). Forced colours and more
 * contrast give every one of them back its flat token.
 */
const gradients = (image: string) => image.split('linear-gradient(').length - 1;
const paint = (page: Page, selector: string, pseudo?: string) => page.locator(selector).first().evaluate((node, which) => {
  const style = getComputedStyle(node, which ?? null);
  return { image: style.backgroundImage, display: style.display, content: style.content, position: style.position, width: parseFloat(style.width), height: parseFloat(style.height), radius: style.borderTopLeftRadius };
}, pseudo);
/** The RGB of the reading progress line at each fraction of its width, read back from a screenshot, with half of it filled. */
async function progressLine(page: Page, fractions: number[]) {
  await page.locator('#file-input').setInputFiles({ name: 'long.txt', mimeType: 'text/plain', buffer: Buffer.from(Array.from({ length: 240 }, (_, i) => `line ${i + 1}: a quiet place to read.`).join('\n')) });
  await expect(page.locator('#progress')).toBeEnabled();
  // Drag the scrubber to the middle without letting go: the fill is where the app puts it, and it is held there while scrubbing.
  await page.locator('#progress').evaluate(node => { node.value = String((Number(node.min) + Number(node.max)) / 2); node.dispatchEvent(new Event('input')); });
  await expect(page.locator('#progress')).toHaveCSS('--scrub-fill', /^5\d(\.\d+)?%$/);
  const box = (await page.locator('#progress').boundingBox())!;
  const y = Math.floor(box.y + box.height / 2 - 0.5);
  const colours: number[][] = [];
  for (const fraction of fractions) {
    const png = await page.screenshot({ clip: { x: Math.floor(box.x + box.width * fraction), y, width: 1, height: 1 } });
    colours.push(await page.evaluate(async encoded => {
      const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(encoded), character => character.charCodeAt(0))], { type: 'image/png' }));
      const context = new OffscreenCanvas(1, 1).getContext('2d')!;
      context.drawImage(bitmap, 0, 0);
      return Array.from(context.getImageData(0, 0, 1, 1).data.slice(0, 3));
    }, png.toString('base64')));
  }
  return colours;
}
const apart = (a: number[], b: number[]) => Math.max(...a.map((channel, i) => Math.abs(channel - b[i])));
const flatness = [{ forcedColors: 'active' }, { contrast: 'more' }] as const;

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1080, height: 680 });
  // A runner can have Increase contrast or forced colours on in the OS: pin them off so the sheen is measured as drawn.
  await page.emulateMedia({ forcedColors: 'none', contrast: 'no-preference' });
});

/** Home with one document being read, the drawer closed. */
const seeded = async (page: Page) => {
  await page.addInitScript(() => { localStorage.setItem('hold-my-brief:library-wide', 'closed'); localStorage.setItem('hold-my-brief:library-narrow', 'closed'); });
  await seedLibrary(page, [{ name: 'Plain.txt', format: 'txt', opened: 1, progress: { fraction: .4 } }]);
};

/** The pressed #view-controls buttons: Pages in the Pages | Scroll control of a reflowable book, and Single page for a PDF. Opens both and waits on aria-pressed. */
const pressedViewControls = ['#flow-pages[aria-pressed=true]', '#view-single[aria-pressed=true]'];
async function openViewControls(page: Page) {
  await page.locator('#file-input').setInputFiles({ name: 'book.epub', mimeType: 'application/epub+zip', buffer: await chapterBook() });
  await expect(page.locator(pressedViewControls[0])).toHaveCount(1);
  await page.locator('#file-input').setInputFiles({ name: 'plain.pdf', mimeType: 'application/pdf', buffer: pagedPdf(3) });
  await expect(page.locator(pressedViewControls[1])).toHaveCount(1);
}

test('the active tab has a 2 px sheen line on its top edge that takes no room', async ({ page }) => {
  await page.goto('/');
  await expect(railHome(page)).toHaveAttribute('aria-current', 'page');

  for (const name of ['a.txt', 'b.txt']) {
    await page.locator('#file-input').setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(`${name}\n\nBody of ${name}.\n`) });
    await expect(page.locator('#tab-list .tab.is-active .tab-title')).toHaveText(name);
  }
  const line = await paint(page, '#tab-list .tab.is-active', '::before');
  expect(line.image).toContain('linear-gradient');
  expect([line.position, line.height, line.radius]).toEqual(['absolute', 2, '1px']);
  const box = (await page.locator('#tab-list .tab.is-active').boundingBox())!;
  expect(line.width).toBeCloseTo(Math.min(120, box.width - 2 - 16), 0); // Inset 8 px from each side of the padding box, at most 120 px.
  expect(box.height).toBeCloseTo(28, 0);
  // Only the tab being read has it.
  expect((await paint(page, '#tab-list .tab:not(.is-active)', '::before')).image).toBe('none');
});

test('the Home progress fill and the sheets carry the sheen', async ({ page }) => {
  await seeded(page);
  expect((await paint(page, '.home-progress > i')).image).toContain('linear-gradient');
  expect((await paint(page, '.home-progress')).height).toBe(3);
  expect((await paint(page, '#appearance')).image).toContain('linear-gradient');
});

test('the reading progress shows the sheen across the whole bar, and the fill reveals its left part', async ({ page }) => {
  await page.goto('/');
  const [early, late, unread] = await progressLine(page, [0.05, 0.45, 0.9]);
  expect(apart(early, late), 'the fill changes along its length').toBeGreaterThan(8);
  expect(apart(late, unread), 'the unread part is the track').toBeGreaterThan(8);
});

test('the primary button, the pressed rail icon, the pressed view controls and the docked library panel carry the sheen', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#library-rail').getByRole('button', { name: 'Library', exact: true })).toHaveAttribute('aria-pressed', 'true');
  for (const selector of ['#empty-open', '#library-rail .icon-rail-button[aria-pressed=true]', '.library-panel']) expect((await paint(page, selector)).image, selector).toContain('linear-gradient');
  await openViewControls(page);
  for (const selector of pressedViewControls) expect((await paint(page, selector)).image, selector).toContain('linear-gradient');
});

for (const emulation of flatness) {
  test(`${Object.keys(emulation)[0]} ${Object.values(emulation)[0]} shows the progress, tab, sheets and Home flat`, async ({ page }) => {
    await seeded(page);
    await page.emulateMedia({ forcedColors: 'none', contrast: 'no-preference', ...emulation });
    expect((await paint(page, '.home-progress > i')).image).toBe('none');
    await page.locator('#file-input').setInputFiles({ name: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('a.txt\n\nBody of a.txt.\n') });
    await expect(page.locator('#tab-list .tab.is-active .tab-title')).toHaveText('a.txt');
    expect((await paint(page, '#tab-list .tab.is-active', '::before')).display).toBe('none');
    expect((await paint(page, '#appearance')).image).toBe('none');
  });

  test(`${Object.keys(emulation)[0]} ${Object.values(emulation)[0]} shows the reading progress in one flat accent`, async ({ page }) => {
    await page.goto('/');
    await page.emulateMedia({ forcedColors: 'none', contrast: 'no-preference', ...emulation });
    const [early, late, unread] = await progressLine(page, [0.05, 0.45, 0.9]);
    expect(apart(early, late), 'the fill is one colour').toBeLessThanOrEqual(2);
    // Forced colours repaint the whole control in system colours, so there the track is not to be told apart from the fill.
    if ('contrast' in emulation) expect(apart(late, unread), 'the unread part is the track').toBeGreaterThan(8);
  });

  test(`${Object.keys(emulation)[0]} ${Object.values(emulation)[0]} shows the primary button, the pressed rail icon, the pressed view controls and the library panel flat`, async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#library-rail').getByRole('button', { name: 'Library', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.emulateMedia({ forcedColors: 'none', contrast: 'no-preference', ...emulation });
    for (const selector of ['#empty-open', '#library-rail .icon-rail-button[aria-pressed=true]', '.library-panel']) expect((await paint(page, selector)).image, selector).not.toContain('linear-gradient');
    await openViewControls(page);
    for (const selector of pressedViewControls) expect((await paint(page, selector)).image, selector).not.toContain('linear-gradient');
  });
}
