import { test, expect, type Page } from '@playwright/test';
import { mockDesktop, type MockSession } from './desktop-mock';

declare global { interface Window { __mockOrder: string[] } }

const id = (name: string) => `folder:485e41a8d1a72538:reading/${name}.md`;
const tab = (name: string) => ({ path: id(name), name: `${name}.md`, format: 'md' });
const heading = (page: Page, name: string) => page.getByRole('heading', { name: `Title ${name}`, level: 1 });

/**
 * Starts the desktop mock with `session` saved and one Library document per name. `__mockOrder` records, in call order, every document the
 * reader read (`read <path>`) and every read-ahead it asked for (`prefetch`), so a test can tell when the call was made.
 */
async function launch(page: Page, names: string[], session: MockSession) {
  await mockDesktop(page, { session });
  await page.addInitScript(([names, prefix]) => {
    const w = window as unknown as { __mockLibrary: Window['__mockLibrary']; __TAURI_INTERNALS__: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> } };
    for (const name of names) w.__mockLibrary[`${prefix}${name}.md`] = { name: `${name}.md`, format: 'md', text: `# Title ${name}\n\nBody of ${name}.` };
    const order: string[] = [], invoke = w.__TAURI_INTERNALS__.invoke;
    Object.assign(window, { __mockOrder: order });
    w.__TAURI_INTERNALS__.invoke = (command, args) => {
      if (command === 'read_document_bytes') order.push(`read ${String(args?.path)}`);
      else if (command === 'prefetch_documents') order.push('prefetch');
      return invoke(command, args);
    };
  }, [names, id('').slice(0, -3)] as const);
  await page.setViewportSize({ width: 1080, height: 760 });
  await page.goto('/');
}
const prefetched = (page: Page) => page.evaluate(() => window.__mockPrefetch);
const calls = (page: Page) => page.waitForFunction(() => window.__mockPrefetch.length >= 1);

test('desktop: the first rendered document of a launch asks for the other restored tabs once, and later opens ask for nothing', async ({ page }) => {
  await launch(page, ['a', 'c', 'd'], { tabs: [tab('a'), tab('c')], active: 0 });
  await expect(heading(page, 'a')).toBeVisible();
  await calls(page);
  expect(await prefetched(page)).toEqual([[id('c')]]);

  await page.evaluate(request => window.__mockEmit('control-request', request), { id: 'show-d', method: 'show', params: { path: id('d') } });
  await expect(heading(page, 'd')).toBeVisible();
  await page.waitForFunction(() => window.__mockReplies.some(reply => reply.id === 'show-d'));
  expect(await prefetched(page)).toHaveLength(1);
});

test('desktop: a split session asks only once every pane has opened, and not for the documents the panes show', async ({ page }) => {
  await launch(page, ['a', 'b', 'c'], {
    tabs: [tab('a'), tab('c'), tab('b')], active: 0,
    layout: { tree: { axis: 'row', ratio: 50, first: { pane: 'a' }, second: { pane: 'b' } }, panes: { a: { tabs: [id('a'), id('c')], shown: id('a') }, b: { tabs: [id('b')], shown: id('b') } }, active: 'a' },
  });
  await expect(page.locator('#workspace')).toHaveClass(/is-split/);
  await expect(heading(page, 'a')).toBeVisible();
  await expect(heading(page, 'b')).toBeVisible();
  await calls(page);
  expect(await prefetched(page)).toEqual([[id('c')]]);
  // Both shown documents were read before the one call: it never competes with the restore's own opens.
  const order = await page.evaluate(() => window.__mockOrder);
  expect(order.indexOf('prefetch')).toBeGreaterThan(order.lastIndexOf(`read ${id('a')}`));
  expect(order.indexOf('prefetch')).toBeGreaterThan(order.lastIndexOf(`read ${id('b')}`));
  expect(order.filter(entry => entry === 'prefetch')).toHaveLength(1);
});
