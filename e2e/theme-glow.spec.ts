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
