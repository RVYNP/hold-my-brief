import { expect, test, type Page } from '@playwright/test';
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

/** Sends one control request as the native bridge does and returns the reader's reply, which must be ok. */
async function control<T>(page: Page, request: string, method: string, params: Record<string, unknown>): Promise<T> {
  await page.evaluate(([request, method, params]) => window.__mockEmit('control-request', { id: request, method, params }), [request, method, params] as const);
  await expect.poll(() => page.evaluate(request => window.__mockReplies.some(reply => reply.id === request), request)).toBe(true);
  const reply = await page.evaluate(request => window.__mockReplies.find(reply => reply.id === request)!, request);
  expect(reply.ok, reply.error ?? '').toBe(true);
  return reply.result as T;
}

const putBrief = (page: Page, id: string, content: string) => page.evaluate(([id, content]) => {
  const path = `hold-my-brief:brief/${id}`;
  window.__mockBriefs[path] = { id, path, title: id, format: 'md', content, updatedAt: Date.now() };
}, [id, content] as const);

const pushBrief = (page: Page, request: string, id: string, split?: 'right') =>
  control<{ paneId: string; splitRefused?: string }>(page, request, 'brief', { id, path: `hold-my-brief:brief/${id}`, title: id, format: 'md', ...(split ? { split } : {}) });

test('a brief split the window cannot make opens as a tab and the reply says why; briefs are never saved in the session', async ({ page }) => {
  await mockDesktop(page);
  await page.setViewportSize({ width: 640, height: 760 });
  await page.goto('/');
  for (const id of ['plan', 'notes', 'diagram']) await putBrief(page, id, `# ${id}\n\nBody.`);

  await pushBrief(page, 'r-plan', 'plan');
  const narrow = await pushBrief(page, 'r-notes', 'notes', 'right');
  expect(narrow.splitRefused).toBe('The window is too narrow to split');
  expect(narrow.paneId).toBe('a');
  await expect(page.locator('#workspace')).not.toHaveClass(/is-split/);

  await page.setViewportSize({ width: 1080, height: 760 });
  const wide = await pushBrief(page, 'r-diagram', 'diagram', 'right');
  expect(wide.splitRefused).toBeUndefined();
  expect(wide.paneId).not.toBe('a');
  await expect(page.locator('#workspace')).toHaveClass(/is-split/);

  // The split holds only briefs: no session names one, and the last carries no layout, so the next launch restores no empty pane.
  await expect.poll(() => page.evaluate(() => window.__mockSessions.length)).toBeGreaterThan(0);
  const sessions = await page.evaluate(() => window.__mockSessions);
  expect(sessions.flatMap(session => session.tabs.map(tab => tab.path)).filter(path => path.startsWith('hold-my-brief:brief/'))).toEqual([]);
  expect(sessions.at(-1)!.layout).toBeUndefined();
});

test('pushing a brief again updates its tab in place and keeps the reader\'s place', async ({ page }) => {
  await mockDesktop(page);
  await page.setViewportSize({ width: 1080, height: 760 });
  await page.goto('/');
  const sections = (word: string) => Array.from({ length: 40 }, (_, i) => `## Section ${i + 1}\n\n${i === 35 ? `${word} text in section 36.` : 'Filler paragraph. '.repeat(12)}`).join('\n\n');
  await putBrief(page, 'plan', `# Plan\n\n${sections('Old')}`);
  await pushBrief(page, 'r-1', 'plan');
  await control(page, 'r-goto', 'goto', { heading: 'Section 36' });
  await expect(page.getByText('Old text in section 36.')).toBeInViewport();
  type Status = { panes: { tabs: { path: string }[] }[]; active: { path: string; position: string } | null };
  const tabsOf = (status: Status) => status.panes.flatMap(pane => pane.tabs.map(tab => tab.path));
  const before = await control<Status>(page, 'r-status-1', 'status', {});

  await putBrief(page, 'plan', `# Plan\n\n${sections('New')}`);
  await pushBrief(page, 'r-2', 'plan');
  await expect(page.getByText('New text in section 36.')).toBeInViewport();
  const after = await control<Status>(page, 'r-status-2', 'status', {});
  expect(tabsOf(after).filter(path => path === 'hold-my-brief:brief/plan')).toHaveLength(1);
  expect(tabsOf(after)).toEqual(tabsOf(before));
  expect(after.active?.path).toBe('hold-my-brief:brief/plan');
  expect(after.active?.position).toBe(before.active?.position);
});

/** The reader has heard from `control_status`; events are recorded (or not) from here on. */
const controlSeen = (page: Page, on: boolean) => expect(page.locator('#settings-control [role="switch"]')).toHaveAttribute('aria-checked', String(on));
const recorded = (page: Page, type: string) => page.evaluate(type => window.__mockEvents.filter(event => event.type === type), type);
const selectParagraph = (page: Page, text: string) => page.evaluate(text => {
  const paragraph = [...document.querySelectorAll('.reader-text-content p')].find(element => element.textContent?.includes(text))!;
  getSelection()!.selectAllChildren(paragraph);
}, text);
const SETTLE = 1500; // The reader waits 600 ms after the last selection change before it reports one.
const agentBrief = '# Plan\n\nWhich option should the agent take first?\n\nSecond paragraph, also worth sending.';

async function openAgentBrief(page: Page, control: { enabled: boolean; running: boolean }) {
  await mockDesktop(page, { control });
  await page.setViewportSize({ width: 1080, height: 760 });
  await page.goto('/');
  await controlSeen(page, control.enabled);
  await putBrief(page, 'plan', agentBrief);
  await pushBrief(page, 'r-plan', 'plan');
  await expect(page.locator('.reader-text-content')).toContainText('Second paragraph');
}

test('selecting text in a brief records one selection event once it has settled, and the same selection is not sent again', async ({ page }) => {
  await openAgentBrief(page, { enabled: true, running: true });
  await selectParagraph(page, 'Which option');
  await expect.poll(() => recorded(page, 'selection')).toHaveLength(1);
  await page.waitForTimeout(SETTLE);
  const [event] = await recorded(page, 'selection');
  expect(await recorded(page, 'selection')).toHaveLength(1);
  expect(event).toMatchObject({ type: 'selection', paneId: 'a', path: 'hold-my-brief:brief/plan', title: 'plan', text: 'Which option should the agent take first?' });
  expect(typeof event!.where).toBe('string');

  // Another selection is another event; clearing one says nothing.
  await selectParagraph(page, 'Second paragraph');
  await expect.poll(() => recorded(page, 'selection')).toHaveLength(2);
  await page.evaluate(() => getSelection()!.removeAllRanges());
  await page.waitForTimeout(SETTLE);
  expect(await recorded(page, 'selection')).toHaveLength(2);
});

test('Send selection to agent records a send event from the palette and from its shortcut', async ({ page }) => {
  await openAgentBrief(page, { enabled: true, running: true });
  await selectParagraph(page, 'Which option');
  await page.keyboard.press('Control+k');
  await page.locator('#palette-input').fill('send selection');
  const row = page.locator('#palette-list .palette-row', { hasText: 'Send selection to agent' });
  await expect(row).toHaveAttribute('aria-disabled', 'false');
  await page.keyboard.press('Enter');
  await expect.poll(() => recorded(page, 'send')).toHaveLength(1);
  await expect(page.locator('#notice')).toContainText('Sent to agent');
  expect((await recorded(page, 'send'))[0]).toMatchObject({ type: 'send', paneId: 'a', path: 'hold-my-brief:brief/plan', text: 'Which option should the agent take first?' });

  await page.locator('.reader-host:not(.staging)').focus();
  await selectParagraph(page, 'Second paragraph');
  await page.keyboard.press('Control+Shift+Enter');
  await expect.poll(() => recorded(page, 'send')).toHaveLength(2);
  expect((await recorded(page, 'send'))[1]).toMatchObject({ text: 'Second paragraph, also worth sending.' });
});

test('closing a brief records a tab event, and showing it recorded one before', async ({ page }) => {
  await openAgentBrief(page, { enabled: true, running: true });
  await control(page, 'r-close', 'close', { id: 'plan' });
  await expect.poll(() => recorded(page, 'tab').then(events => events.map(event => event.action))).toEqual(['shown', 'closed']);
  const [, closed] = await recorded(page, 'tab');
  expect(closed).toMatchObject({ type: 'tab', action: 'closed', paneId: 'a', path: 'hold-my-brief:brief/plan', title: 'plan', format: 'md', brief: true });
});

test('with Agent control off nothing is recorded and Send selection to agent is unavailable', async ({ page }) => {
  await openAgentBrief(page, { enabled: false, running: false });
  await selectParagraph(page, 'Which option');
  await page.waitForTimeout(SETTLE);
  await page.keyboard.press('Control+k');
  await page.locator('#palette-input').fill('send selection');
  const row = page.locator('#palette-list .palette-row', { hasText: 'Send selection to agent' });
  await expect(row).toHaveAttribute('aria-disabled', 'true');
  await expect(row).toContainText('Agent control');
  await page.keyboard.press('Escape');
  await control(page, 'r-close', 'close', { id: 'plan' });
  await page.waitForTimeout(SETTLE);
  expect(await page.evaluate(() => window.__mockEvents)).toEqual([]);
});

test('show and close take the Library ids that status reports: an open tab is shown in whichever pane holds it, never opened twice', async ({ page }) => {
  await mockDesktop(page);
  await page.setViewportSize({ width: 1080, height: 760 });
  await page.goto('/');
  const ids = ['folder:485e41a8d1a72538:reports/alpha.md', 'folder:485e41a8d1a72538:reports/beta.md'];
  await page.evaluate(ids => { for (const id of ids) window.__mockLibrary[id] = { name: id.split('/').pop()!, format: 'md', text: `# ${id.split('/').pop()}\n\nBody.` }; }, ids);
  type Status = { panes: { id: string; tabs: { path: string; active: boolean }[] }[]; active: { paneId: string; path: string } | null };
  const status = (request: string) => control<Status>(page, request, 'status', {});
  const paths = (s: Status) => s.panes.flatMap(pane => pane.tabs.map(tab => tab.path));

  await control(page, 'r-show-a', 'show', { path: ids[0] });
  const beta = await control<{ path: string; paneId: string }>(page, 'r-show-b', 'show', { path: ids[1], split: 'right' });
  expect(beta.path).toBe(ids[1]);
  await expect(page.locator('#workspace')).toHaveClass(/is-split/);
  const both = await status('r-status-1');
  expect(paths(both).sort()).toEqual([...ids].sort());
  expect(both.active!.path).toBe(ids[1]);

  const again = await control<{ path: string; paneId: string }>(page, 'r-show-a-again', 'show', { path: ids[0] });
  expect(again.path).toBe(ids[0]);
  const after = await status('r-status-2');
  expect(paths(after).sort()).toEqual([...ids].sort());
  expect(after.active).toMatchObject({ path: ids[0], paneId: again.paneId });
  expect(again.paneId).not.toBe(beta.paneId);

  const closed = await control<{ closed: string[] }>(page, 'r-close', 'close', { path: ids[0] });
  expect(closed.closed).toEqual([ids[0]]);
  expect(paths(await status('r-status-3'))).toEqual([ids[1]]);
});
