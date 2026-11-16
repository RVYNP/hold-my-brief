import { test, expect, type Page } from '@playwright/test';
import { seedLibrary, type FixtureDocument } from './home-fixture';
import { pagedPdf } from './paged-pdf';

// The rail and the docked panel stand in one column that runs to the window's bottom. The panel's box keeps its 6 px margin, but what shows under it
// is the same glass as the strip around it, so the column has no band of another tone at its foot: the pixels 2 px above the window's bottom equal
// the ones 12 px above, at the rail, in the middle of the panel and in the lane between the panel and the reading area.
const documents: FixtureDocument[] = [{ name: 'Alpha.pdf', format: 'pdf', opened: 1, content: pagedPdf(3), progress: { fraction: .4, page: 2, pages: 3 } }];
const themes: [string, object][] = [
  ['Brief light', { mode: 'light', palette: 'brief', accent: null, page: 'theme' }],
  ['Brief dark', { mode: 'dark', palette: 'brief', accent: null, page: 'theme' }],
  ['Aurora', { palette: 'aurora' }],
];

async function open(page: Page, side: 'left' | 'right', record: object, view: 'home' | 'pdf', panel: 'open' | 'closed') {
  await page.setViewportSize({ width: 1080, height: 760 });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce', forcedColors: 'none', contrast: 'no-preference' });
  await page.addInitScript(([value, kept, appearance]) => {
    localStorage.setItem('hold-my-brief:library-side', value as string);
    if (kept === 'closed') { localStorage.setItem('hold-my-brief:library-wide', 'closed'); localStorage.setItem('hold-my-brief:library-narrow', 'closed'); }
    localStorage.setItem('hold-my-brief:appearance', appearance as string);
  }, [side, panel, JSON.stringify(record)]);
  await seedLibrary(page, documents, []);
  await expect(page.getByRole('heading', { name: 'Home', level: 1 })).toBeVisible();
  await expect(page.locator('#library-rail')).toHaveAttribute('data-library-side', side);
  await expect(page.locator('canvas.home-ground:not(.is-leaving)')).toHaveCount(1);
  if (view === 'pdf') {
    await page.locator('#empty [data-home-path]').first().click();
    await expect(page.locator('#position')).toContainText(/Page \d of 3/);
    await expect(page.locator('#loading')).toBeHidden();
    await expect(page.locator('.pdf-render-status')).toHaveCount(0);
  }
  await expect(page.locator('#library-root')).toBeVisible({ visible: panel === 'open' });
  await page.mouse.move(540, 300); // Off the bottom edge: the footer rests.
  await page.waitForTimeout(400);
}

/** Reads a screenshot back through a canvas: the rgb at each [x, y]. */
const sample = (page: Page, png: Buffer, points: [number, number][]) => page.evaluate(async ([encoded, at]) => {
  const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(encoded as string), character => character.charCodeAt(0))], { type: 'image/png' }));
  const context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d')!;
  context.drawImage(bitmap, 0, 0);
  return (at as [number, number][]).map(([x, y]) => [...context.getImageData(x, y, 1, 1).data.slice(0, 3)]);
}, [png.toString('base64'), points] as const);

/** Compares the pixels 2 px above the window's bottom with the ones 12 px above, at each x. */
async function expectContinuous(page: Page, columns: [string, number][]) {
  const png = await page.screenshot({ animations: 'disabled' }), height = 760;
  const foot = await sample(page, png, columns.map(([, x]) => [x, height - 2])), above = await sample(page, png, columns.map(([, x]) => [x, height - 12]));
  columns.forEach(([label, x], index) => {
    const worst = Math.max(...foot[index]!.map((value, channel) => Math.abs(value - above[index]![channel]!)));
    expect(worst, `${label} (x ${x}): ${foot[index]} 2 px up, ${above[index]} 12 px up`).toBeLessThanOrEqual(2);
  });
}

for (const side of ['left', 'right'] as const) for (const view of ['home', 'pdf'] as const) for (const [name, record] of themes) {
  test(`library on the ${side}, ${view === 'home' ? 'Home' : 'a PDF'}, ${name}: the column is one tone to the window's bottom, docked`, async ({ page }) => {
    await open(page, side, record, view, 'open');
    const panel = (await page.locator('#library-root > .library-panel').boundingBox())!, workspace = (await page.locator('#workspace').boundingBox())!;
    const edge = side === 'left' ? panel.x + panel.width : panel.x, lane = (edge + (side === 'left' ? workspace.x : workspace.x + workspace.width)) / 2;
    expect(Math.abs(lane - edge)).toBeGreaterThan(4);
    await expectContinuous(page, [['rail column', side === 'left' ? 20 : 1080 - 1 - 20], ['middle of the panel', panel.x + panel.width / 2], ['lane', lane]]);
    expect(760 - (panel.y + panel.height), 'the panel keeps its 6 px margin').toBeCloseTo(6, 0);
  });
}

for (const side of ['left', 'right'] as const) for (const view of ['home', 'pdf'] as const) for (const [name, record] of themes) {
  test(`library on the ${side}, ${view === 'home' ? 'Home' : 'a PDF'}, ${name}: the rail column is one tone to the window's bottom, panel closed`, async ({ page }) => {
    await open(page, side, record, view, 'closed');
    await expectContinuous(page, [['rail column', side === 'left' ? 20 : 1080 - 1 - 20]]);
  });
}
