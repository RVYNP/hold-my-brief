import { test, expect, type Page } from '@playwright/test';
import { seedLibrary, type FixtureDocument } from './home-fixture';
import { pagedPdf } from './paged-pdf';

// The icon rail has no box: a 44 px wash from the window's edge implies it, and its icons stand on the toolbar's first control line
// (the Home button; with the library on the right, the ⋯ button, the toolbar's last). Brief light and dark, Aurora and Peach.
const documents: FixtureDocument[] = [{ name: 'Alpha.pdf', format: 'pdf', opened: 1, content: pagedPdf(3), progress: { fraction: .4, page: 2, pages: 3 } }];
const themes: [string, object][] = [
  ['Brief light', { mode: 'light', palette: 'brief', accent: null, page: 'theme' }],
  ['Brief dark', { mode: 'dark', palette: 'brief', accent: null, page: 'theme' }],
  ['Aurora', { palette: 'aurora' }],
  ['Peach', { palette: 'peach' }],
];

async function openHome(page: Page, side: 'left' | 'right', record: object | null = null, panel: 'closed' | 'open' = 'closed') {
  await page.setViewportSize({ width: 1080, height: 760 });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce', forcedColors: 'none', contrast: 'no-preference' });
  await page.addInitScript(([value, kept, appearance]) => {
    localStorage.setItem('hold-my-brief:library-side', value as string);
    if (kept === 'closed') { localStorage.setItem('hold-my-brief:library-wide', 'closed'); localStorage.setItem('hold-my-brief:library-narrow', 'closed'); }
    if (appearance) localStorage.setItem('hold-my-brief:appearance', appearance as string);
  }, [side, panel, record ? JSON.stringify(record) : null]);
  await seedLibrary(page, documents, []);
  await expect(page.getByRole('heading', { name: 'Home', level: 1 })).toBeVisible();
  await expect(page.locator('#library-rail')).toHaveAttribute('data-library-side', side);
  await expect(page.locator('canvas.home-ground:not(.is-leaving)')).toHaveCount(1);
  await page.mouse.move(540, 400);
}

/** The centre x of an element. */
const centre = async (page: Page, selector: string) => page.locator(selector).evaluateAll(nodes => nodes.map(node => { const box = node.getBoundingClientRect(); return box.left + box.width / 2; }));

/** Reads a screenshot back through a canvas: the rgb at each [x, y]. */
const sample = (page: Page, png: Buffer, points: [number, number][]) => page.evaluate(async ([encoded, at]) => {
  const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(encoded as string), character => character.charCodeAt(0))], { type: 'image/png' }));
  const context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d')!;
  context.drawImage(bitmap, 0, 0);
  return (at as [number, number][]).map(([x, y]) => [...context.getImageData(x, y, 1, 1).data.slice(0, 3)]);
}, [png.toString('base64'), points] as const);

for (const side of ['left', 'right'] as const) {
  test(`library on the ${side}: the rail has no box, its icons share the centre line of ${side === 'left' ? 'the toolbar\'s left padding' : '⋯'} at 20 px from the edge, and the panel docks at 46 px`, async ({ page }) => {
    await openHome(page, side);
    const rail = page.locator('#library-rail');
    const look = await rail.evaluate(node => { const style = getComputedStyle(node); return { border: style.borderTopWidth + style.borderRightWidth + style.borderBottomWidth + style.borderLeftWidth, radius: style.borderTopLeftRadius + style.borderTopRightRadius + style.borderBottomLeftRadius + style.borderBottomRightRadius, shadow: style.boxShadow, image: style.backgroundImage, colour: style.backgroundColor }; });
    expect(look).toEqual({ border: '0px0px0px0px', radius: '0px0px0px0px', shadow: 'none', image: 'none', colour: 'rgba(0, 0, 0, 0)' });

    const buttons = await centre(page, '.icon-rail-button'), target = side === 'left' ? 20 : (await centre(page, '#menu-toggle'))[0]!;
    expect(buttons.length).toBe(5);
    for (const x of buttons) expect(x).toBeCloseTo(target, 0);
    expect(side === 'left' ? target : 1080 - target).toBeCloseTo(20, 0);
    const box = (await rail.boundingBox())!;
    expect(box.width).toBe(36); expect(side === 'left' ? box.x : 1080 - box.x - box.width).toBe(2);
    for (const button of await page.locator('.icon-rail-button').all()) { const size = (await button.boundingBox())!; expect([size.width, size.height]).toEqual([36, 36]); }

    // The wash: its own layer from the toolbar's bottom edge to the window's bottom, 44 px from the window's edge, fading out.
    const wash = await rail.evaluate(node => { const style = getComputedStyle(node, '::before'), at = node.getBoundingClientRect(), layout = document.querySelector('#reader-layout')!.getBoundingClientRect(); return { width: style.width, image: style.backgroundImage, border: style.borderTopWidth, shadow: style.boxShadow, top: node.getBoundingClientRect().top - layout.top, bottom: innerHeight - at.bottom + parseFloat(style.bottom) }; });
    expect(wash.width).toBe('44px'); expect(wash.border).toBe('0px'); expect(wash.shadow).toBe('none');
    expect(wash.image).toContain(side === 'left' ? 'to right' : 'to left'); expect(wash.image).toMatch(/transparent|rgba\(0, 0, 0, 0\)/);
    expect(wash.top).toBe(0); expect(Math.abs(wash.bottom)).toBeLessThan(.5);
    const toolbar = (await page.locator('.toolbar').boundingBox())!, layout = (await page.locator('#reader-layout').boundingBox())!;
    expect(layout.y).toBeCloseTo(toolbar.y + toolbar.height, 0);
  });

  test(`library on the ${side}: the docked panel stands at 46 px, the reading panel after its 64 px`, async ({ page }) => {
    await openHome(page, side, null, 'open');
    await expect(page.locator('#library-root')).toBeVisible();
    const root = page.locator('#library-root'), edge = await root.evaluate((node, side) => parseFloat(getComputedStyle(node)[side === 'left' ? 'left' : 'right']), side);
    expect(edge).toBeCloseTo(46, 1);
    const panel = (await page.locator('#library-root > .library-panel').boundingBox())!, workspace = (await page.locator('#workspace').boundingBox())!, width = await root.evaluate(node => node.getBoundingClientRect().width);
    if (side === 'left') {
      expect(panel.x).toBeCloseTo(52, 0); // the root's own 6 px margin keeps the panel's box where it was relative to the root
      expect(workspace.x).toBeCloseTo(width - 10 + 64, 0);
    } else {
      expect(1080 - panel.x - panel.width).toBeCloseTo(52, 0);
      expect(1080 - workspace.x - workspace.width).toBeCloseTo(width - 10 + 64, 0);
    }
    expect(workspace.width).toBeCloseTo(1080 - (width - 10 + 64), 0);
    const rail = (await page.locator('#library-rail').boundingBox())!;
    expect(side === 'left' ? panel.x - (rail.x + rail.width) : (1080 - panel.x - panel.width) - (1080 - rail.x)).toBeGreaterThan(0);
  });
}

test('closed: the page strip, find bar, footer, view controls, image pager and Home\'s content clear the rail by 48 px, 52 px for Home', async ({ page }) => {
  await openHome(page, 'left');
  const read = () => page.evaluate(() => { const style = getComputedStyle(document.querySelector('#reader-layout')!), home = getComputedStyle(document.querySelector('#empty')!); return { library: style.getPropertyValue('--library-clear').trim(), workspace: style.getPropertyValue('--workspace-clear').trim(), home: home.paddingLeft, footer: document.querySelector('footer')!.getBoundingClientRect().left, loading: getComputedStyle(document.querySelector('#loading')!).left }; });
  expect(await read()).toMatchObject({ library: '48px', workspace: '48px', home: '52px', footer: 48, loading: '48px' });
});

const families = ['brief', 'lilac', 'birch', 'graphite', 'arctic', 'blossom', 'peony'];
const familyThemes = families.flatMap(palette => (['light', 'dark'] as const).map((mode): [string, object] => [`${palette} ${mode}`, { mode, palette, accent: null, page: 'theme' }]));
const difference = (a: number[], b: number[]) => Math.max(...a.map((value, index) => Math.abs(value - b[index]!)));

/** The pixel at 2 px and at 43 px from the window edge, with the wash and without it (its ::before hidden), and with `rule` (the wash as it was on main) when given. */
async function washAt(page: Page, side: 'left' | 'right', rule?: string) {
  const at = (distance: number): [number, number] => [side === 'left' ? distance : 1080 - 1 - distance, 380];
  const points: [number, number][] = [at(2), at(43)], shoot = async () => sample(page, await page.screenshot({ animations: 'disabled' }), points);
  const withWash = await shoot();
  const hide = async (content: string) => { const style = await page.addStyleTag({ content }); const taken = await shoot(); await style.evaluate(node => (node as Element).remove()); return taken; };
  const bare = await hide('#library-rail::before { display: none !important; }');
  const before = rule ? await hide(`#library-rail::before { background: ${rule} !important; }`) : null;
  return { edge: difference(withWash[0]!, bare[0]!), inner: difference(withWash[1]!, bare[1]!), sinceMain: before ? difference(withWash[0]!, before[0]!) : null };
}

/** Home, or a PDF at fit width (the panel closed either way). */
async function openSurface(page: Page, side: 'left' | 'right', record: object, surface: 'Home' | 'PDF') {
  await openHome(page, side, record);
  if (surface === 'Home') return;
  await page.locator('#empty [data-home-path]').first().click();
  await expect(page.locator('#position')).toContainText(/Page \d of 3/);
  await expect(page.locator('#loading')).toBeHidden();
  await expect(page.locator('.pdf-render-status')).toHaveCount(0);
  await page.locator('.pdf-reader').focus(); await page.keyboard.press('Control+2');
  await expect(page.locator('#zoom-level')).toHaveAttribute('data-fit', 'width');
  await page.mouse.move(540, 400);
  const sheet = () => page.locator('.pdf-page canvas').first().evaluate(canvas => { const box = canvas.getBoundingClientRect(); return [box.left, box.right].join(); });
  await expect.poll(async () => { const before = await sheet(); await page.waitForTimeout(300); return before === await sheet(); }).toBe(true);
}

// In the seven families the wash is the toolbar's own colour (--rail-wash = --chrome pulled 8 % toward --fg: plain --chrome is under 6 levels at 2 px in some family/mode/side): the rail reads as the toolbar folding down the window's edge. At 2 px from the edge
// it differs from the bare surface by at least 6 levels on its strongest channel, at 43 px it is gone, on Home and over a PDF, library on either side, light and dark.
const expectWash = (name: string, seen: Awaited<ReturnType<typeof washAt>>) => {
  expect(seen.inner, `${name}: inner edge`).toBeLessThanOrEqual(2);
  expect(seen.edge, `${name}: the window edge has the wash`).toBeGreaterThanOrEqual(6);
};
for (const side of ['left', 'right'] as const) {
  test(`the family wash shows: 2 px from the ${side} edge is at least 6 levels off the bare surface, 43 px is not, on Home, every family in light and dark`, async ({ page }) => {
    const edge: Record<string, number> = {};
    for (const [name, record] of familyThemes) {
      await openHome(page, side, record);
      const seen = await washAt(page, side);
      edge[name] = seen.edge;
      expectWash(name, seen);
    }
    console.log(`family wash at 2 px, largest channel difference from the bare surface, Home, ${side}:`, JSON.stringify(edge));
  });
  // A document is open on the page afterwards, so each family gets its own page.
  for (const [name, record] of familyThemes) test(`the family wash shows over a PDF: 2 px from the ${side} edge, ${name}`, async ({ page }) => {
    await openSurface(page, side, record, 'PDF');
    const seen = await washAt(page, side);
    console.log(`family wash at 2 px, PDF, ${side}, ${name}: ${seen.edge}`);
    expectWash(name, seen);
  });
}

// The glow themes keep --glass-raise: the pixel at 2 px is what main drew (its rule, forced back on), to the level.
for (const side of ['left', 'right'] as const) test(`the glow themes' wash is unchanged: Aurora and Peach at 2 px from the ${side} edge match --glass-raise to 1 level, 43 px is bare`, async ({ page }) => {
  for (const [name, record] of themes.slice(2)) {
    await openHome(page, side, record);
    const seen = await washAt(page, side, `linear-gradient(to ${side === 'left' ? 'right' : 'left'}, var(--glass-raise), transparent)`);
    expect(seen.sinceMain, `${name}: 2 px against main`).toBeLessThanOrEqual(1);
    expect(seen.inner, `${name}: inner edge`).toBeLessThanOrEqual(2);
    expect(seen.edge, `${name}: the window edge has the wash`).toBeGreaterThan(2);
  }
});


interface RailIcon { label: string; rect: number[]; colour: number[]; pressed: string | null }
/** Each rail icon: its box, its resting colour (--muted) as rgba, and whether it is pressed. */
const railIcons = (page: Page): Promise<RailIcon[]> => page.evaluate(() => {
  const swatch = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!; swatch.canvas.width = swatch.canvas.height = 1;
  return [...document.querySelectorAll<HTMLElement>('.icon-rail-button')].map(button => {
    const svg = button.querySelector('svg')!.getBoundingClientRect(), colour = getComputedStyle(button).color;
    swatch.clearRect(0, 0, 1, 1); swatch.fillStyle = colour; swatch.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = swatch.getImageData(0, 0, 1, 1).data;
    return { label: button.dataset.rail!, rect: [svg.left, svg.top, svg.right, svg.bottom], colour: [r, g, b, a / 255], pressed: button.getAttribute('aria-pressed') };
  });
});

/** The lowest contrast ratio of each icon's colour against the pixels of a screenshot taken with the icons' own drawing hidden. */
const contrastOf = (page: Page, png: Buffer | string, icons: RailIcon[]) => page.evaluate(async ({ png, icons }) => {
  const image = new Image(); image.src = `data:image/png;base64,${png}`; await image.decode();
  const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
  const context = canvas.getContext('2d', { willReadFrequently: true })!; context.drawImage(image, 0, 0);
  const lin = (value: number) => { const c = value / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const lum = (r: number, g: number, b: number) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return icons.map(icon => {
    const [left, top, right, bottom] = icon.rect.map((value, index) => index < 2 ? Math.floor(value) : Math.ceil(value));
    const data = context.getImageData(left, top, right - left, bottom - top).data, [r, g, b, a] = icon.colour;
    let lowest = Infinity;
    for (let index = 0; index < data.length; index += 4) {
      const ink = [r, g, b].map((channel, i) => channel * a + data[index + i]! * (1 - a)), back = lum(data[index]!, data[index + 1]!, data[index + 2]!), glyph = lum(ink[0]!, ink[1]!, ink[2]!);
      lowest = Math.min(lowest, (Math.max(back, glyph) + 0.05) / (Math.min(back, glyph) + 0.05));
    }
    return { label: icon.label, ratio: lowest };
  });
}, { png: typeof png === 'string' ? png : png.toString('base64'), icons });

/** The lowest rail-icon contrast over Home's ground at each of its three tones, with the icons' own drawing hidden. */
async function homeContrast(page: Page, name: string) {
  const icons = await railIcons(page);
  expect(icons.length).toBe(5);
  for (const icon of icons) expect(icon.pressed, 'at rest: the panel is closed').not.toBe('true');
  const tones = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas.home-ground:not(.is-leaving)')!, data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data, seen = new Set<string>();
    for (let index = 0; index < data.length; index += 4) if (data[index + 3] === 255) seen.add(`rgb(${data[index]}, ${data[index + 1]}, ${data[index + 2]})`);
    return [...seen];
  });
  expect(tones.length, name).toBe(3);
  const hide = await page.addStyleTag({ content: '.icon-rail-button svg { visibility: hidden !important; } .home-ground { transition: none !important; }' });
  let lowest = { ratio: Infinity, label: '', tone: '' };
  for (const tone of tones) {
    await page.evaluate(fill => { const canvas = document.querySelector<HTMLCanvasElement>('canvas.home-ground:not(.is-leaving)')!, context = canvas.getContext('2d')!; context.globalCompositeOperation = 'source-over'; context.fillStyle = fill; context.fillRect(0, 0, canvas.width, canvas.height); }, tone);
    const png = (await page.screenshot({ animations: 'disabled' })).toString('base64');
    for (const item of await contrastOf(page, png, icons)) if (item.ratio < lowest.ratio) lowest = { ...item, tone };
  }
  await hide.evaluate(node => (node as Element).remove());
  return lowest;
}

// Non-text contrast (WCAG 1.4.11): each rail icon at rest (--muted) against the pixels around it: the wash over Home's ground at 6 %, each of its three tones.
for (const side of ['left', 'right'] as const) test(`every rail icon reads at 3:1 over the wash and Home's ground at 6 %, library on the ${side}, in every family in light and dark, Aurora and Peach`, async ({ page }) => {
  const worst: Record<string, string> = {};
  for (const [name, record] of [...familyThemes, ...themes.slice(2)]) {
    await openHome(page, side, record);
    const lowest = await homeContrast(page, name);
    worst[name] = `${lowest.ratio.toFixed(2)} (${lowest.label}, ground tone ${lowest.tone})`;
    expect(lowest.ratio, `${name}: ${worst[name]}`).toBeGreaterThanOrEqual(3);
  }
  console.log(`worst rail icon contrast, library on the ${side}:`, JSON.stringify(worst));
});

// The rail is drawn over a document too (the panel closed: the reading surface starts after it, it never runs under the icons). A PDF at fit width is the worst case
// in the dark: white paper beside muted icons. Alpha.pdf is opened from Home, fitted to width, and every icon is held to 3:1 against the pixels under it.
for (const side of ['left', 'right'] as const) for (const [name, record] of familyThemes) test(`a PDF at fit width, the panel closed, library on the ${side}: the page stays out from under the rail and every rail icon reads at 3:1 in ${name}`, async ({ page }) => {
  await openSurface(page, side, record, 'PDF');
  const sheet = await page.locator('.pdf-page canvas').first().evaluate(canvas => { const box = canvas.getBoundingClientRect(); return [box.left, box.right]; });
  const icons = await railIcons(page);
  expect(icons.length).toBe(5);
  const hide = await page.addStyleTag({ content: '.icon-rail-button svg { visibility: hidden !important; }' });
  const ratios = await contrastOf(page, await page.screenshot({ animations: 'disabled' }), icons);
  await hide.evaluate(node => (node as Element).remove());
  console.log(`rail icons over a PDF at fit width, ${name}, library on the ${side}:`, JSON.stringify(ratios.map(item => `${item.label} ${item.ratio.toFixed(2)}`)));
  for (const item of ratios) expect(item.ratio, `${item.label}`).toBeGreaterThanOrEqual(3);
  expect(side === 'left' ? sheet[0]! : 1080 - sheet[1]!, 'the page starts after the rail (48 px) and its 16 px margin').toBeGreaterThanOrEqual(48 + 16 - .5);
});
