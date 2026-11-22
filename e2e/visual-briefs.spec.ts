import { expect, test } from '@playwright/test';
import { mockDesktop } from './desktop-mock';
import { openSettings } from './settings-controls';

const visualMarkdown = `# Agent Visual Brief

> [!TIP] Live update
> Reusing \`--id\` updates this brief in place.

> [!WARNING]
> External URLs and scripts are always stripped.

\`\`\`chart
{
  "type": "metrics",
  "title": "IPC Benchmarks",
  "items": [
    { "label": "Warm round-trip", "value": "14 ms", "tone": "positive" },
    { "label": "Prompt tokens", "value": "0", "note": "CLI-first" }
  ]
}
\`\`\`

\`\`\`chart
{
  "type": "hbar",
  "title": "Latency Comparison",
  "unit": "ms",
  "data": [
    { "label": "hmb CLI", "value": 14, "highlight": true },
    { "label": "Browser automation", "value": 420 }
  ]
}
\`\`\`

\`\`\`flow
title: Control Bridge
direction: LR
Agent[hmb CLI] --NDJSON--> Socket(Local Socket) -> UI[Hold My Brief]
\`\`\`

\`\`\`svg
<svg viewBox="0 0 120 40" width="120" height="40">
  <script>window.__svgPwned = true;</script>
  <rect x="2" y="2" width="116" height="36" rx="6" fill="var(--accent-soft)" stroke="var(--accent-ink)" />
  <text x="60" y="24" text-anchor="middle" font-size="12" fill="var(--fg)">Safe SVG</text>
</svg>
\`\`\`
`;

test('Markdown renders callouts, metric/bar charts, flow diagrams and sanitized inline SVGs cleanly', async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 760 });
  await page.goto('/');

  await page.locator('#file-input').setInputFiles({
    name: 'brief.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(visualMarkdown, 'utf-8'),
  });

  const article = page.locator('.reader-text-content');
  await expect(article).toBeVisible();

  await expect(article.locator('blockquote.hmb-callout-tip')).toContainText('Live update');
  await expect(article.locator('blockquote.hmb-callout-warning')).toContainText('External URLs');
  await expect(article.locator('.hmb-metrics-grid .hmb-metric-card')).toHaveCount(2);
  await expect(article.locator('.hmb-chart svg')).toHaveCount(1);
  await expect(article.locator('.hmb-flow svg')).toContainText('Local Socket');
  await expect(article.locator('.hmb-svg svg')).toContainText('Safe SVG');
  await expect(article.locator('.hmb-svg script')).toHaveCount(0);

  expect(await page.evaluate(() => (window as unknown as { __svgPwned?: boolean }).__svgPwned)).toBeUndefined();

  // Every visual figure fits inside the reading column with positive geometry.
  const boxes = await article.locator('.hmb-visual').evaluateAll(nodes =>
    nodes.map(node => {
      const r = node.getBoundingClientRect();
      return { width: r.width, height: r.height };
    }),
  );
  expect(boxes.length).toBe(4);
  for (const box of boxes) {
    expect(box.width).toBeGreaterThan(100);
    expect(box.height).toBeGreaterThan(30);
  }
});

test('standalone .svg files open in the image viewer with scripts stripped', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 640 });
  await page.goto('/');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="160" viewBox="0 0 320 160">
    <script>window.__svgFilePwned = true;</script>
    <rect x="8" y="8" width="304" height="144" rx="12" fill="var(--card)" stroke="var(--accent-ink)" stroke-width="2" />
    <text x="160" y="86" text-anchor="middle" font-size="20" fill="var(--fg)">Diagram</text>
  </svg>`;

  await page.locator('#file-input').setInputFiles({
    name: 'architecture.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(svg, 'utf-8'),
  });

  const img = page.locator('.image-reader img');
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate(el => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  expect(await page.evaluate(() => (window as unknown as { __svgFilePwned?: boolean }).__svgFilePwned)).toBeUndefined();
});

test('desktop Settings shows the Agent control switch', async ({ page }) => {
  await mockDesktop(page);
  await page.setViewportSize({ width: 1080, height: 760 });
  await page.goto('/');

  const sheet = await openSettings(page);
  await expect(sheet.locator('#settings-control')).toBeVisible();
  await expect(sheet.getByRole('switch', { name: 'Local CLI and agents' })).toBeVisible();
});

test('a brief asking for a split the window cannot make opens as a tab, and the reply says why', async ({ page }) => {
  await mockDesktop(page);
  await page.setViewportSize({ width: 640, height: 760 });
  await page.goto('/');
  await page.evaluate(() => {
    for (const id of ['plan', 'notes', 'diagram']) {
      const path = `hold-my-brief:brief/${id}`;
      window.__mockBriefs[path] = { id, path, title: id, format: 'md', content: `# ${id}\n\nBody.`, updatedAt: 0 };
    }
  });
  const brief = async (id: string, split?: 'right') => {
    const request = `r-${id}`;
    await page.evaluate(([request, id, split]) => window.__mockEmit('control-request', { id: request, method: 'brief', params: { id, path: `hold-my-brief:brief/${id}`, title: id, format: 'md', ...(split ? { split } : {}) } }), [request, id, split] as const);
    await expect.poll(() => page.evaluate(request => window.__mockReplies.some(reply => reply.id === request), request)).toBe(true);
    const reply = await page.evaluate(request => window.__mockReplies.find(reply => reply.id === request)!, request);
    expect(reply.ok, reply.error ?? '').toBe(true);
    return reply.result as { paneId: string; splitRefused?: string };
  };

  await brief('plan');
  const narrow = await brief('notes', 'right');
  expect(narrow.splitRefused).toBe('The window is too narrow to split');
  expect(narrow.paneId).toBe('a');
  await expect(page.locator('#workspace')).not.toHaveClass(/is-split/);

  await page.setViewportSize({ width: 1080, height: 760 });
  const wide = await brief('diagram', 'right');
  expect(wide.splitRefused).toBeUndefined();
  expect(wide.paneId).not.toBe('a');
  await expect(page.locator('#workspace')).toHaveClass(/is-split/);
});
