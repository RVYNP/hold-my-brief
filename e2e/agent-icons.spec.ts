import { test, expect, type Locator, type Page } from '@playwright/test';
import { testIcon } from './agent-icon-fixture';
import { mockDesktop } from './desktop-mock';
import { openSettings } from './settings-controls';

// Settings › Agent control › Icons: a row per kind with a live preview (`listening`), Choose file… and Reset. The fallback is a squircle with the initial.
const row = (sheet: Locator, name: string) => sheet.getByRole('group', { name, exact: true });
const preview = (sheet: Locator, name: string) => row(sheet, name).locator('.agent-icon');
const chooses = (page: Page, file: string | { error: string }, name = 'icon.json') => page.evaluate(([picked, label]) => { window.__mockChosenIcon = typeof picked === 'string' ? { name: label, text: picked } : picked; }, [file, name] as const);
/** The computed colour a CSS value paints, as the page resolves it (light-dark() and var() included). */
const paint = (page: Page, value: string) => page.evaluate(value => { const probe = document.createElement('i'); probe.style.color = value; document.body.append(probe); const colour = getComputedStyle(probe).color; probe.remove(); return colour; }, value);
const turn = (icon: Locator) => icon.locator('.tint').evaluate(layer => layer.getAttribute('transform'));
const OMP_LIGHT = 'rgb(23, 135, 111)', OMP_DARK = 'rgb(98, 211, 182)';

async function open(page: Page) {
  await mockDesktop(page);
  await page.setViewportSize({ width: 1080, height: 760 });
  await page.goto('/');
  await expect(page.locator('#library-rail')).toBeVisible();
  return openSettings(page);
}

test('every known kind starts with the squircle and its initial in its own colour, and Reset has nothing to do', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  const sheet = await open(page);
  await expect(sheet.locator('.agent-icon-row')).toHaveCount(5);
  await expect(sheet.locator('.agent-icon-row .settings-name')).toHaveText(['omp' + 'Initial', 'Claude Code' + 'Initial', 'Codex' + 'Initial', 'Cursor' + 'Initial', 'Other agents' + 'Initial']);
  const omp = preview(sheet, 'omp');
  await expect(omp).toHaveAttribute('data-art', 'fallback');
  await expect(omp).toHaveAttribute('data-state', 'listening');
  await expect(omp.locator('text')).toHaveText('O');
  await expect(omp.locator('.agent-icon-shape')).toHaveCSS('fill', OMP_LIGHT);
  await expect(preview(sheet, 'Claude Code').locator('.agent-icon-shape')).toHaveCSS('fill', 'rgb(78, 98, 204)');
  await expect(omp).toHaveCSS('width', '30px');
  await expect(row(sheet, 'omp').getByRole('button', { name: 'Reset' })).toBeDisabled();
  const fills = await sheet.locator('.agent-icon-shape').evaluateAll(shapes => shapes.map(shape => getComputedStyle(shape).fill));
  expect(new Set(fills).size).toBe(5);

  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(omp.locator('.agent-icon-shape')).toHaveCSS('fill', OMP_DARK);
  await expect(preview(sheet, 'Claude Code').locator('.agent-icon-shape')).toHaveCSS('fill', 'rgb(163, 176, 255)');
});

test('a chosen Lottie file plays in the preview, its .tint layer takes the agent colour and its .fg layer the theme foreground; Reset brings the fallback back', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  const sheet = await open(page);
  await chooses(page, testIcon(), 'omp-icon.json');
  await row(sheet, 'omp').getByRole('button', { name: 'Choose file…' }).click();

  const omp = preview(sheet, 'omp');
  await expect(omp).toHaveAttribute('data-art', 'lottie');
  await expect(omp.locator('svg path').first()).toBeAttached();
  await expect(row(sheet, 'omp').locator('.agent-icon-source')).toHaveText('Your file');
  await expect(omp.locator('.tint path')).toHaveCSS('fill', OMP_LIGHT);
  await expect(omp.locator('.fg path')).toHaveCSS('fill', await paint(page, 'var(--fg)'));
  // The other kinds keep the fallback; the choice is saved per kind.
  await expect(preview(sheet, 'Claude Code')).toHaveAttribute('data-art', 'fallback');
  expect(await page.evaluate(() => Object.keys(window.__mockAgentIcons))).toEqual(['omp']);

  // It plays: the `listening` range of the file turns the rectangle, and it keeps turning (the range loops).
  const first = await turn(omp);
  await expect.poll(() => turn(omp), { timeout: 3000 }).not.toBe(first);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(omp.locator('.tint path')).toHaveCSS('fill', OMP_DARK);

  await row(sheet, 'omp').getByRole('button', { name: 'Reset' }).click();
  await expect(omp).toHaveAttribute('data-art', 'fallback');
  await expect(omp.locator('text')).toHaveText('O');
  await expect(row(sheet, 'omp').getByRole('button', { name: 'Reset' })).toBeDisabled();
  expect(await page.evaluate(() => Object.keys(window.__mockAgentIcons))).toEqual([]);
});

test('with Reduce Motion the preview shows the first frame of idle and never moves', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const sheet = await open(page);
  await chooses(page, testIcon());
  await row(sheet, 'Codex').getByRole('button', { name: 'Choose file…' }).click();
  const codex = preview(sheet, 'Codex');
  await expect(codex).toHaveAttribute('data-art', 'lottie');
  await expect(codex.locator('.tint')).toBeAttached();
  const still = await turn(codex);
  await page.waitForTimeout(600);
  expect(await turn(codex)).toBe(still);
  // Frame 0 of idle: the rectangle has not turned. Without Reduce Motion the same file has turned by then.
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect.poll(() => turn(codex), { timeout: 3000 }).not.toBe(still);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => turn(codex), { timeout: 3000 }).toBe(still);
});

test('a file that cannot be an icon is refused with its reasons and nothing is assigned', async ({ page }) => {
  const sheet = await open(page);
  const claude = row(sheet, 'Claude Code'), choose = claude.getByRole('button', { name: 'Choose file…' });
  const refusal = sheet.locator('.agent-icon-refusal');

  await chooses(page, testIcon(icon => { icon.markers = icon.markers.filter((marker: { cm: string }) => marker.cm !== 'acting'); }), 'few.json');
  await choose.click();
  await expect(refusal).toContainText('few.json: Missing marker: acting.');

  await chooses(page, testIcon(icon => { icon.assets = [{ id: 'image_0', w: 4, h: 4, u: 'images/', p: 'face.png', e: 0 }]; }), 'linked.json');
  await choose.click();
  await expect(refusal).toContainText('Asset "image_0" refers to a file outside the animation');
  await expect(refusal).toHaveCount(1);

  await chooses(page, '{ not json', 'broken.json');
  await choose.click();
  await expect(refusal).toContainText('broken.json: The file is not valid JSON.');

  await chooses(page, testIcon(icon => { icon.assets = [{ id: 'big', w: 4, h: 4, u: '', p: `data:image/png;base64,${'A'.repeat(600 * 1024)}`, e: 1 }]; }), 'big.json');
  await choose.click();
  await expect(refusal).toContainText('an icon may be at most 512 KB');

  // The native side refuses before the page sees the text (a file over the limit, a folder): its reason is shown as it is.
  await chooses(page, { error: 'The file is 900 KB; an icon may be at most 512 KB.' });
  await choose.click();
  await expect(refusal).toHaveText('The file is 900 KB; an icon may be at most 512 KB.');

  await expect(preview(sheet, 'Claude Code')).toHaveAttribute('data-art', 'fallback');
  expect(await page.evaluate(() => Object.keys(window.__mockAgentIcons))).toEqual([]);

  // A good file clears the refusal; a cancelled dialog changes nothing.
  await chooses(page, testIcon());
  await choose.click();
  await expect(refusal).toHaveCount(0);
  await expect(preview(sheet, 'Claude Code')).toHaveAttribute('data-art', 'lottie');
  await choose.click();
  await expect(preview(sheet, 'Claude Code')).toHaveAttribute('data-art', 'lottie');
});

test('icons assigned earlier are loaded at start, and an agent of a kind that has no row of its own gets one', async ({ page }) => {
  await mockDesktop(page);
  const stored = testIcon();
  await page.addInitScript(text => { window.__mockAgentIcons.cursor = text; }, stored);
  await page.setViewportSize({ width: 1080, height: 760 });
  await page.goto('/');
  await expect(page.locator('#library-rail')).toBeVisible();
  await page.evaluate(() => window.__mockEmit('control-agents', [{ kind: 'unknown', name: 'Night Shift', firstSeen: 1, lastRequest: 2, listening: false }]));
  const sheet = await openSettings(page);
  await expect(preview(sheet, 'Cursor')).toHaveAttribute('data-art', 'lottie');
  await expect(sheet.locator('.agent-icon-row')).toHaveCount(6);
  await expect(preview(sheet, 'Night Shift')).toHaveAttribute('data-art', 'fallback');
  await expect(preview(sheet, 'Night Shift').locator('text')).toHaveText('N');
});
