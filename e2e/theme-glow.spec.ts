import { test, expect, type Page } from '@playwright/test';

/**
 * Every family has the soft window glow: the window paints two radial glows over --chrome and the workspace
 * (Home, the stage around PDF pages) is a translucent panel over them. Reduced transparency drops both.
 */
const appearance = (mode: 'light' | 'dark', accent: string | null = null) => ({ mode, palette: 'brief', accent, page: 'theme' });

// Playwright's emulateMedia has no reducedTransparency option; ask the browser directly.
// A runner can have Reduce transparency, Increase contrast or forced colours switched on in the OS: pin all three, so the
// glow is measured as drawn and only the reduced case below turns it off.
const emulate = async (page: Page, reducedTransparency: 'reduce' | 'no-preference') => {
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setEmulatedMedia', { features: [
    { name: 'prefers-reduced-transparency', value: reducedTransparency },
    { name: 'prefers-contrast', value: 'no-preference' },
    { name: 'forced-colors', value: 'none' },
  ] });
};

async function open(page: Page, mode: 'light' | 'dark', accent: string | null = null) {
  await page.setViewportSize({ width: 1080, height: 760 });
  await emulate(page, 'no-preference');
  await page.addInitScript(record => localStorage.setItem('hold-my-brief:appearance', JSON.stringify(record)), appearance(mode, accent));
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', mode);
}

const paint = (page: Page) => page.evaluate(() => {
  // rgba(r, g, b, a) or, for a colour-mix, color(srgb r g b / a); no alpha part means opaque.
  const alpha = (colour: string) => { const match = /^rgba\(\s*[\d.]+,\s*[\d.]+,\s*[\d.]+,\s*([\d.]+)\)$|\/\s*([\d.]+)\)$/.exec(colour); return match ? Number(match[1] ?? match[2]) : 1; };
  const root = getComputedStyle(document.documentElement), workspace = getComputedStyle(document.querySelector('#workspace')!);
  return { image: root.backgroundImage, fixed: root.backgroundAttachment, workspaceAlpha: alpha(workspace.backgroundColor) };
});

for (const mode of ['light', 'dark'] as const) {
  test(`Brief ${mode} paints the window glow under a translucent workspace, and reduced transparency takes both away`, async ({ page }) => {
    await open(page, mode);
    const glow = await paint(page);
    expect(glow.image).not.toBe('none');
    expect(glow.fixed).toBe('fixed, fixed');
    expect(glow.workspaceAlpha).toBeLessThan(1);
    await page.screenshot({ path: `test-results/glow-brief-${mode}.png` });

    await emulate(page, 'reduce');
    await expect.poll(() => page.evaluate(() => matchMedia('(prefers-reduced-transparency: reduce)').matches)).toBe(true);
    const flat = await paint(page);
    // The glow's stops are transparent and the panel is the opaque surface: the paint goes with it.
    expect(flat.workspaceAlpha).toBe(1);
    expect(flat.image).not.toBe(glow.image);
    expect(flat.image).toMatch(/^(none|(radial-gradient\(ellipse [^)]*rgba\(0, 0, 0, 0\)[^)]*\)(, )?){2})$/);
    await page.screenshot({ path: `test-results/glow-brief-${mode}-reduced.png` });
  });
}

test('a custom accent leaves the glow on the family\'s own pair', async ({ page }) => {
  await open(page, 'light');
  const own = await paint(page);
  await page.close();
  const custom = await page.context().newPage();
  await open(custom, 'light', '#2f7d4f');
  await expect.poll(() => custom.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').includes('light-dark'))).toBe(true);
  expect(await paint(custom)).toEqual(own);
  await expect(custom.locator('html')).toHaveAttribute('data-theme', 'light');
});

// CIE76 ΔE between two sRGB pixels.
const lab = ([red, green, blue]: number[]) => {
  const linear = [red, green, blue].map(channel => { const value = channel / 255; return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4; });
  const x = (0.4124 * linear[0] + 0.3576 * linear[1] + 0.1805 * linear[2]) / 0.95047, y = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2], z = (0.0193 * linear[0] + 0.1192 * linear[1] + 0.9505 * linear[2]) / 1.08883;
  const f = (value: number) => value > 216 / 24389 ? Math.cbrt(value) : (24389 / 27 * value + 16) / 116;
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
};
const deltaE = (a: number[], b: number[]) => Math.hypot(...lab(a).map((value, index) => value - lab(b)[index]));

// The pixels of a page screenshot at the given points, read back through a canvas.
const pixels = (page: Page, shot: Buffer, points: [number, number][]) => page.evaluate(async ({ data, at }) => {
  const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode();
  const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
  const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0);
  return at.map(([x, y]) => [...context.getImageData(x, y, 1, 1).data].slice(0, 3));
}, { data: shot.toString('base64'), at: points });

// The docked library panel's glass runs on to the workspace's edge: the 10 px resize handle and the 6 px margin show the panel's own wash, not the bare window glow.
for (const [palette, mode] of [['brief', 'light'], ['aurora', 'dark']] as const) for (const side of ['left', 'right'] as const) {
  test(`${palette} ${mode}: with the library docked ${side} the gap beside the panel is not a glow stripe`, async ({ page }) => {
    await page.setViewportSize({ width: 1080, height: 760 });
    await emulate(page, 'no-preference');
    await page.addInitScript(({ record, side }) => { localStorage.setItem('hold-my-brief:appearance', JSON.stringify(record)); localStorage.setItem('hold-my-brief:library-side', side); }, { record: { mode, palette, accent: null, page: 'theme' }, side });
    await page.goto('/');
    await expect(page.locator('#library-root')).toBeVisible();
    await expect(page.locator('#library-rail')).toHaveAttribute('data-library-side', side);
    // Settle past the panel's and the workspace's opening motion.
    const panel = page.locator('#library-root .library-panel'), workspace = page.locator('#workspace');
    await expect.poll(async () => { const at = (await workspace.boundingBox())!; return Math.round(side === 'left' ? at.x : 1080 - at.x - at.width); }).toBeGreaterThan(300);
    await page.mouse.move(540, 400);
    const panelBox = (await panel.boundingBox())!, workspaceBox = (await workspace.boundingBox())!;
    const y = Math.round(760 * 0.25);
    const [edge, gapStart, gapEnd] = side === 'left'
      ? [panelBox.x + panelBox.width - 4, panelBox.x + panelBox.width, workspaceBox.x]
      : [panelBox.x + 4, workspaceBox.x + workspaceBox.width, panelBox.x];
    expect(gapEnd - gapStart).toBe(16);
    const shot = await page.screenshot({ path: `test-results/gap-${palette}-${side}.png` });
    // The middle of the gap (the panel's own shadow, which stays, falls across its edge) and the rail's 6 px margin at the window's edge (the one beside the panel is under the panel's own shadow too, on the right), against the panel's wash 4 px inside its edge.
    const railBox = (await page.locator('#library-rail').boundingBox())!;
    const middle = Math.floor(gapStart + 8), margins = [side === 'left' ? railBox.x - 3 : railBox.x + railBox.width + 3].map(Math.floor);
    const [reference, gap, ...rail] = await pixels(page, shot, [Math.round(edge), middle, ...margins].map(x => [x, y]));
    expect(deltaE(gap, reference), 'the middle of the gap').toBeLessThan(3);
    for (const [index, pixel] of rail.entries()) expect(deltaE(pixel, reference), `the rail's margin at x=${margins[index]}`).toBeLessThan(3);
  });
}
