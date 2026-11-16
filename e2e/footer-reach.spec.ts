import { test, expect, type Page } from '@playwright/test';

// The icon rail and the docked panel reach the window's bottom (keeping the 6 px margin they keep at the outer edge); the footer and its
// progress line belong to the reading area: they span #workspace, never the rail or the panel.
const note = Array.from({ length: 240 }, (_, i) => `line ${i + 1}: a quiet place to read.`).join('\n');

async function openDocked(page: Page, width: number, height: number, side: 'left' | 'right') {
  await page.setViewportSize({ width, height });
  await page.emulateMedia({ forcedColors: 'none', contrast: 'no-preference', reducedMotion: 'reduce' });
  await page.addInitScript(side => localStorage.setItem('hold-my-brief:library-side', side), side);
  await page.goto('/');
  await page.locator('#file-input').setInputFiles({ name: 'long.txt', mimeType: 'text/plain', buffer: Buffer.from(note) });
  await expect(page.locator('#progress')).toBeEnabled();
  await expect(page.locator('#library-root')).toBeVisible();
  await expect(page.locator('#library-rail')).toHaveAttribute('data-library-side', side);
  await page.mouse.move(width / 2, height / 2); // Off the bottom edge: the footer rests.
  await expect.poll(async () => Math.round((await page.locator('footer').boundingBox())!.y)).toBe(height - 3);
}

/** The pixels where two screenshots of the same size differ by more than the glow's own dithering (3 per channel), as [x, y, rgba of the first, rgba of the second]; read back through a canvas. */
const differences = (page: Page, a: Buffer, b: Buffer) => page.evaluate(async ([one, two]) => {
  const read = async (encoded: string) => {
    const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(encoded), character => character.charCodeAt(0))], { type: 'image/png' }));
    const context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d')!;
    context.drawImage(bitmap, 0, 0);
    return { width: bitmap.width, data: context.getImageData(0, 0, bitmap.width, bitmap.height).data };
  };
  const [first, second] = [await read(one), await read(two)], found: [number, number, string, string][] = [];
  for (let i = 0; i < first.data.length; i += 4) {
    const x = (i / 4) % first.width, y = Math.floor(i / 4 / first.width), left = first.data.slice(i, i + 4), right = second.data.slice(i, i + 4);
    if (left.some((channel, index) => Math.abs(channel - right[index]) > 3)) found.push([x, y, left.join(','), right.join(',')]);
  }
  return found.slice(0, 5);
}, [a.toString('base64'), b.toString('base64')] as const);

const box = async (page: Page, selector: string) => (await page.locator(selector).boundingBox())!;

for (const [width, height] of [[1080, 760], [1080, 560]] as const) for (const side of ['left', 'right'] as const) {
  test(`${width}x${height}, panel docked ${side}: the rail and panel reach 6 px from the bottom; the progress line stays inside the workspace`, async ({ page }) => {
    await openDocked(page, width, height, side);
    const rail = await box(page, '#library-rail'), panel = await box(page, '#library-root'), workspace = await box(page, '#workspace'), progress = await box(page, '#progress'), footer = await box(page, 'footer');
    expect(height - (rail.y + rail.height)).toBeGreaterThanOrEqual(5); expect(height - (rail.y + rail.height)).toBeLessThanOrEqual(7);
    expect(height - (panel.y + panel.height)).toBeGreaterThanOrEqual(5); expect(height - (panel.y + panel.height)).toBeLessThanOrEqual(7);
    expect(progress.x).toBeGreaterThanOrEqual(workspace.x - .5); expect(progress.x + progress.width).toBeLessThanOrEqual(workspace.x + workspace.width + .5);
    expect(footer.x).toBeGreaterThanOrEqual(workspace.x - .5); expect(footer.x + footer.width).toBeLessThanOrEqual(workspace.x + workspace.width + .5);
    // The panel's last row of content ends 6 px above the panel's bottom border, as the first starts below its top.
    const inner = await page.locator('.library-panel').evaluate(node => { const style = getComputedStyle(node); return { bottom: parseFloat(style.paddingBottom), border: parseFloat(style.borderBottomWidth) }; });
    expect(inner).toEqual({ bottom: 6, border: 1 });

    // With the footer down, the bottom 4 px beside the workspace are what they are without the footer: the footer draws nothing there. Beside the line itself it does.
    const beside = side === 'left' ? { x: 0, width: workspace.x } : { x: workspace.x + workspace.width, width: width - workspace.x - workspace.width };
    const strip = (clip: { x: number; width: number }) => page.screenshot({ clip: { ...clip, y: height - 4, height: 4 } });
    const withFooter = await strip(beside), insideWith = await strip({ x: workspace.x + 12, width: workspace.width - 24 });
    await page.addStyleTag({ content: 'footer { visibility: hidden !important; }' });
    expect(await differences(page, withFooter, await strip(beside)), 'pixels of the footer under the rail or the panel').toEqual([]);
    expect((await differences(page, insideWith, await strip({ x: workspace.x + 12, width: workspace.width - 24 }))).length, 'the footer draws the line in the workspace').toBeGreaterThan(0);
  });
}

test('hovering the bottom edge raises the footer inside the workspace only', async ({ page }) => {
  await openDocked(page, 1080, 680, 'right');
  const workspace = await box(page, '#workspace');
  await page.mouse.move(workspace.x + workspace.width / 2, 680 - 3);
  await expect.poll(async () => { const footer = await box(page, 'footer'); return Math.round(footer.y + footer.height); }).toBe(680);
  const footer = await box(page, 'footer');
  expect([Math.round(footer.x), Math.round(footer.width)]).toEqual([Math.round(workspace.x), Math.round(workspace.width)]);
});
