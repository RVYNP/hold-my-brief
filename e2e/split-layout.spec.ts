import { test, expect, type Locator, type Page } from '@playwright/test';
import { chapterBook } from './epub-book';
import { pagedPdf } from './paged-pdf';

/** The split's boxes at 1440 × 900, with the panel docked left, docked right and collapsed, evenly split and with the divider at 60 %: the same as before the panes were placed from the layout tree (within half a pixel). */

const pdf = { name: 'half-tone.pdf', mimeType: 'application/pdf', buffer: pagedPdf(5) };
const markdown = { name: 'moby.md', mimeType: 'text/markdown', buffer: Buffer.from(['# Moby', '', ...Array.from({ length: 80 }, (_, i) => `Line ${i + 1}: call me Ishmael.`)].join('\n\n')) };

type Box = { x: number; y: number; width: number; height: number };
const box = async (locator: Locator): Promise<Box> => { const { x, y, width, height } = (await locator.boundingBox())!; return { x, y, width, height }; };
const run = async (page: Page, name: string) => { await page.keyboard.press('Control+k'); await page.locator('#palette-input').fill(name); await page.keyboard.press('Enter'); await expect(page.locator('#palette')).toBeHidden(); };

/** What `main` drew (measured on it before the layout tree), in CSS px at 1440 × 900. */
const GOLDEN: Record<string, Record<'even' | 'sixty', Record<string, Box>>> = {
  left: {
    even: {
      'row a': { x: 334, y: 41, width: 549, height: 28 },
      'body a': { x: 334, y: 69, width: 549, height: 831 },
      'host a': { x: 334, y: 69, width: 549, height: 831 },
      'row b': { x: 891, y: 41, width: 549, height: 28 },
      'body b': { x: 891, y: 69, width: 549, height: 831 },
      'host b': { x: 891, y: 69, width: 549, height: 831 },
      'divider': { x: 883, y: 41, width: 8, height: 859 },
    },
    sixty: {
      'row a': { x: 334, y: 41, width: 658.797, height: 28 },
      'body a': { x: 334, y: 69, width: 658.797, height: 831 },
      'host a': { x: 334, y: 69, width: 658.797, height: 831 },
      'row b': { x: 1000.797, y: 41, width: 439.203, height: 28 },
      'body b': { x: 1000.797, y: 69, width: 439.203, height: 831 },
      'host b': { x: 1000.797, y: 69, width: 439.203, height: 831 },
      'divider': { x: 992.797, y: 41, width: 8, height: 859 },
    },
  },
  right: {
    even: {
      'row a': { x: 0, y: 41, width: 549, height: 28 },
      'body a': { x: 0, y: 69, width: 549, height: 831 },
      'host a': { x: 0, y: 69, width: 549, height: 831 },
      'row b': { x: 557, y: 41, width: 549, height: 28 },
      'body b': { x: 557, y: 69, width: 549, height: 831 },
      'host b': { x: 557, y: 69, width: 549, height: 831 },
      'divider': { x: 549, y: 41, width: 8, height: 859 },
    },
    sixty: {
      'row a': { x: 0, y: 41, width: 658.797, height: 28 },
      'body a': { x: 0, y: 69, width: 658.797, height: 831 },
      'host a': { x: 0, y: 69, width: 658.797, height: 831 },
      'row b': { x: 666.797, y: 41, width: 439.203, height: 28 },
      'body b': { x: 666.797, y: 69, width: 439.203, height: 831 },
      'host b': { x: 666.797, y: 69, width: 439.203, height: 831 },
      'divider': { x: 658.797, y: 41, width: 8, height: 859 },
    },
  },
  collapsed: {
    even: {
      'row a': { x: 48, y: 41, width: 692, height: 28 },
      'body a': { x: 48, y: 69, width: 692, height: 831 },
      'host a': { x: 48, y: 69, width: 692, height: 831 },
      'row b': { x: 748, y: 41, width: 692, height: 28 },
      'body b': { x: 748, y: 69, width: 692, height: 831 },
      'host b': { x: 748, y: 69, width: 692, height: 831 },
      'divider': { x: 740, y: 41, width: 8, height: 859 },
    },
    sixty: {
      'row a': { x: 48, y: 41, width: 830.391, height: 28 },
      'body a': { x: 48, y: 69, width: 830.391, height: 831 },
      'host a': { x: 48, y: 69, width: 830.391, height: 831 },
      'row b': { x: 886.391, y: 41, width: 553.609, height: 28 },
      'body b': { x: 886.391, y: 69, width: 553.609, height: 831 },
      'host b': { x: 886.391, y: 69, width: 553.609, height: 831 },
      'divider': { x: 878.391, y: 41, width: 8, height: 859 },
    },
  },
};

async function measure(page: Page) {
  const out: Record<string, Box> = {};
  for (const side of ['a', 'b']) {
    out[`row ${side}`] = await box(page.locator(`.pane-strip[data-pane=${side}]`));
    out[`body ${side}`] = await box(page.locator(`.pane-body[data-pane=${side}]`));
    out[`host ${side}`] = await box(page.locator(`.reader-host[data-pane=${side}]:not(.tab-hidden)`));
  }
  out.divider = await box(page.locator('.pane-divider'));
  return out;
}

const cases = [['left', 'docked left'], ['right', 'docked right'], ['collapsed', 'collapsed']] as const;
for (const [mode, label] of cases) {
  test(`the panes, rows and divider keep their boxes: panel ${label}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(side => localStorage.setItem('hold-my-brief:library-side', side), mode === 'right' ? 'right' : 'left');
    await page.goto('/');
    for (const [file, format] of [[pdf, 'PDF'], [markdown, 'MD']] as const) {
      await page.locator('#file-input').setInputFiles(file);
      await expect(page.locator('#tab-list .tab.is-active')).toHaveAttribute('data-format', format);
    }
    if (mode === 'collapsed') await page.keyboard.press('Control+b');
    await expect(page.locator('#reader-layout.library-open')).toHaveCount(mode === 'collapsed' ? 0 : 1);
    await run(page, 'Split right');
    await expect(page.locator('.pane-strip[data-pane=b] .tab')).toHaveCount(1);
    await expect(page.locator('.reader-host[data-pane=b]:not(.tab-hidden)')).toBeVisible();
    await expect(page.locator('.reader-host[data-pane=a]:not(.tab-hidden)')).toBeVisible();
    await expect.poll(async () => (await box(page.locator('.pane-divider'))).width).toBe(8);
    const even = await measure(page);
    await page.locator('.pane-divider').focus();
    for (let step = 0; step < 5; step++) await page.keyboard.press('ArrowRight');
    await expect(page.locator('.pane-divider')).toHaveAttribute('aria-valuenow', '60');
    const sixty = await measure(page);
    for (const [name, got] of Object.entries({ even, sixty }) as ['even' | 'sixty', Record<string, Box>][]) {
      for (const [part, want] of Object.entries(GOLDEN[mode][name])) {
        for (const edge of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(got[part][edge] - want[edge]), `${name} ${part} ${edge}`).toBeLessThanOrEqual(.5);
      }
    }
  });
}
