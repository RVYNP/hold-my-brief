import { expect, test } from '@playwright/test';
import { chooseLibrarySide, libraryToggle } from './library-controls';

/**
 * Find in document. Each format stores its text differently, so every test drives the same
 * user-visible contract: Ctrl+F opens the bar, a query reports a count, Enter walks the
 * matches and the reader moves, and a format with no text says so rather than "no matches".
 */

const markdown = [
  '# Reading notes',
  '',
  'The lighthouse stood at the edge of the harbour.',
  '',
  'Every evening the keeper climbed the stairs, and every evening the lamp turned.',
  '',
  '## Harbour history',
  '',
  'The harbour was dredged twice. Nobody remembered the lighthouse lamp going out.',
].join('\n');

const openMarkdown = async (page: import('@playwright/test').Page) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles({ name: 'notes.md', mimeType: 'text/markdown', buffer: Buffer.from(markdown) });
  await expect(page.locator('#filename')).toHaveText('notes.md');
};

test('Ctrl+F counts matches, Enter steps through them and marks the current one', async ({ page }) => {
  await openMarkdown(page);

  await page.keyboard.press('Control+f');
  await expect(page.locator('#find-bar')).toBeVisible();
  await expect(page.locator('#find-query')).toBeFocused();

  await page.locator('#find-query').fill('harbour');
  // "harbour" appears twice in body text and once in the "Harbour history" heading.
  await expect(page.locator('#find-status')).toHaveText('1 of 3');
  await expect(page.locator('#find-previous')).toBeEnabled();

  await page.keyboard.press('Enter');
  await expect(page.locator('#find-status')).toHaveText('2 of 3');

  await page.keyboard.press('Shift+Enter');
  await expect(page.locator('#find-status')).toHaveText('1 of 3');
  // Stepping back from the first result wraps to the last.
  await page.keyboard.press('Shift+Enter');
  await expect(page.locator('#find-status')).toHaveText('3 of 3');
  await page.keyboard.press('Enter');
  await expect(page.locator('#find-status')).toHaveText('1 of 3');

  await expect(page.locator('mark.search-hit').first()).toContainText(/harbour/i);
});

test('beside the library the find field is never under the drawer, on either side', async ({ page }) => {
  await page.setViewportSize({ width: 1080, height: 680 });
  await openMarkdown(page);
  if (!(await page.locator('#library-root').isVisible())) await libraryToggle(page).click();
  await expect(page.locator('#library-root')).toBeVisible();
  await page.keyboard.press('Control+f');
  await page.locator('#find-query').fill('harbour');
  // Both ends of the field and the close button must be what a click there reaches, not the drawer.
  const reachable = () => page.evaluate(() => {
    const hit = (element: Element | null, x: number) => { const box = element!.getBoundingClientRect(); return element!.contains(document.elementFromPoint(x(box), box.top + box.height / 2)); };
    return [hit(document.querySelector('#find-query'), box => box.left + 3), hit(document.querySelector('#find-query'), box => box.right - 3), hit(document.querySelector('#find-close'), box => box.left + box.width / 2)];
  });
  expect(await reachable()).toEqual([true, true, true]);
  await chooseLibrarySide(page, 'right');
  await expect(page.locator('#library-rail')).toHaveAttribute('data-library-side', 'right');
  await page.locator('#find-query').focus();
  expect(await reachable()).toEqual([true, true, true]);
});

test('match case narrows results and whole word excludes longer words', async ({ page }) => {
  await openMarkdown(page);
  await page.keyboard.press('Control+f');
  await page.locator('#find-query').fill('harbour');
  await expect(page.locator('#find-status')).toHaveText('1 of 3');

  await page.locator('#find-case').click();
  await expect(page.locator('#find-case')).toHaveAttribute('aria-pressed', 'true');
  // The capitalised heading "Harbour history" no longer matches, leaving the two lowercase ones.
  await expect(page.locator('#find-status')).toHaveText('1 of 2');

  // "lamp" is a whole word; "lighth" is a prefix of "lighthouse", which whole-word mode rejects.
  await page.locator('#find-case').click();
  await page.locator('#find-word').click();
  await page.locator('#find-query').fill('lighth');
  await expect(page.locator('#find-status')).toHaveText('No matches');
  await page.locator('#find-query').fill('lamp');
  await expect(page.locator('#find-status')).toHaveText('1 of 2');
});

test('a query with no matches says so and an empty query is quiet', async ({ page }) => {
  await openMarkdown(page);
  await page.keyboard.press('Control+f');
  await expect(page.locator('#find-status')).toHaveText('');
  await page.locator('#find-query').fill('zebra crossing');
  await expect(page.locator('#find-status')).toHaveText('No matches');
  await expect(page.locator('#find-next')).toBeDisabled();
  await page.locator('#find-query').fill('');
  await expect(page.locator('#find-status')).toHaveText('');
});

test('Escape closes the bar and returns focus to the reading surface', async ({ page }) => {
  await openMarkdown(page);
  await page.keyboard.press('Control+f');
  await expect(page.locator('#find-bar')).toBeVisible();
  await page.locator('#find-query').fill('harbour');
  await expect(page.locator('mark.search-hit')).toHaveCount(0);
  await page.waitForTimeout(200);
  await expect(page.locator('mark.search-hit').first()).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.locator('#find-bar')).toBeHidden();
  // Closing clears the marks so nothing stale is left highlighted.
  await expect(page.locator('mark.search-hit')).toHaveCount(0);
});

test('Ctrl+F does not open the find bar before a document is open', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Control+f');
  // The browser's own find dialog must not appear either: the app leaves this to the palette.
  await expect(page.locator('#find-bar')).toBeHidden();
});

test('searching navigates a long text document to the matched line', async ({ page }) => {
  const lines = Array.from({ length: 400 }, (_, index) => `Line ${index + 1}: ordinary text`);
  lines[321] = 'Line 322: the only needle in this haystack';
  lines.unshift('# Long document');
  await page.goto('/');
  await page.locator('#file-input').setInputFiles({ name: 'long.md', mimeType: 'text/markdown', buffer: Buffer.from(lines.join('\n')) });
  await expect(page.locator('#filename')).toHaveText('long.md');

  await page.keyboard.press('Control+f');
  await page.locator('#find-query').fill('needle');
  await expect(page.locator('#find-status')).toHaveText('1 of 1');

  // The scrubber follows the reader, so its value proves the view actually moved.
  await expect.poll(() => page.locator('#progress').evaluate((input: HTMLInputElement) => Number(input.value))).toBeGreaterThan(50);
  await expect(page.locator('mark.search-hit').first()).toContainText('needle');
  // Revealing the match scrolls the reading surface only: the window chrome must not move (the
  // footer rests below the window edge, so a scrollable #app once slid the toolbar off the top).
  expect(await page.evaluate(() => document.getElementById('app')!.scrollTop)).toBe(0);
  expect((await page.locator('.toolbar').boundingBox())!.y).toBe(0);
});

test('the palette reaches find, so Ctrl+F is not the only route', async ({ page }) => {
  await openMarkdown(page);
  await page.keyboard.press('Control+k');
  await page.locator('#palette-input').fill('find');
  await page.keyboard.press('Enter');
  await expect(page.locator('#find-bar')).toBeVisible();
});

// Find matches the text on the page, not the Markdown source: a reader types what they see.
const inline = [
  '# Mixed *inline* title',
  '',
  'Start with **bold words here** and _em phrase_ then `inline code` plus a [link text](https://example.com/page) end.',
  '',
  'First line of a soft break',
  'second line of it.',
  '',
  'Next block begins here.',
  '',
  ...Array.from({ length: 120 }, (_, index) => `Filler paragraph number ${index + 1} to make the document scroll.`),
].join('\n');

const openInline = async (page: import('@playwright/test').Page) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles({ name: 'inline.md', mimeType: 'text/markdown', buffer: Buffer.from(inline) });
  await expect(page.locator('#filename')).toHaveText('inline.md');
  await page.keyboard.press('Control+f');
  await expect(page.locator('#find-bar')).toBeVisible();
};

const markedText = (page: import('@playwright/test').Page) =>
  page.locator('.reader-text-content mark.search-hit').evaluateAll(marks => marks.map(mark => mark.textContent).join(''));

for (const [name, query, shown] of [
  ['a bold boundary', 'words here and', 'words here and'],
  ['inline code', 'then inline code plus', 'then inline code plus'],
  ['a link', 'plus a link text end', 'plus a link text end'],
  ['an em boundary and a different case', 'AND EM PHRASE THEN', 'and em phrase then'],
  ['a soft line break, matched with a space', 'soft break second line', 'soft break\nsecond line'],
] as const) {
  test(`find across ${name} matches the rendered text and marks exactly it`, async ({ page }) => {
    await openInline(page);
    await page.locator('#find-query').fill(query);
    await expect(page.locator('#find-status')).toHaveText('1 of 1');
    await expect.poll(() => markedText(page)).toBe(shown);
  });
}

test('find never matches markup the reader does not see, or text across blocks', async ({ page }) => {
  await openInline(page);
  for (const query of ['here** and', '_em phrase_', '`inline', '](https://', '# Mixed', 'titleStart', 'it.Next']) {
    await page.locator('#find-query').fill(query);
    await expect(page.locator('#find-status')).toHaveText('No matches');
    await expect(page.locator('mark.search-hit')).toHaveCount(0);
  }
  await page.locator('#find-query').fill('mixed inline title');
  await expect(page.locator('#find-status')).toHaveText('1 of 1');
  await expect.poll(() => markedText(page)).toBe('Mixed inline title');
});

test('Escape removes every mark and leaves the text unchanged', async ({ page }) => {
  await openInline(page);
  const text = () => page.locator('.reader-text-content').evaluate(element => element.textContent);
  const before = await text();
  await page.locator('#find-query').fill('words here and');
  await expect(page.locator('#find-status')).toHaveText('1 of 1');
  expect(await page.locator('mark.search-hit').count()).toBeGreaterThan(1);
  expect(await text()).toBe(before);
  await page.keyboard.press('Escape');
  await expect(page.locator('mark.search-hit')).toHaveCount(0);
  expect(await text()).toBe(before);
});

const savedPlaces = (page: import('@playwright/test').Page) => page.evaluate(() => Object.entries(localStorage)
  .filter(([key]) => key.startsWith('hold-my-brief:'))
  .map(([, value]) => { try { return (JSON.parse(value) as { locator?: unknown }).locator; } catch { return undefined; } })
  .filter(Boolean));

const openInlineQuiet = async (page: import('@playwright/test').Page) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles({ name: 'inline.md', mimeType: 'text/markdown', buffer: Buffer.from(inline) });
  await expect(page.locator('#filename')).toHaveText('inline.md');
};

test('find does not change the saved place', async ({ page }) => {
  await openInlineQuiet(page);
  await expect.poll(async () => (await savedPlaces(page)).length).toBeGreaterThan(0);
  await page.waitForTimeout(600);
  const before = await savedPlaces(page);
  const label = await page.locator('#position').textContent();

  // The match is already on screen at the top, so revealing it does not scroll: any change to the place would come from find itself.
  await page.keyboard.press('Control+f');
  await page.locator('#find-query').fill('words here and');
  await expect(page.locator('#find-status')).toHaveText('1 of 1');
  expect(await markedText(page)).toBe('words here and');
  await page.waitForTimeout(600);
  expect(await savedPlaces(page)).toEqual(before);
  await page.keyboard.press('Escape');
  await expect(page.locator('mark.search-hit')).toHaveCount(0);
  await page.waitForTimeout(600);
  expect(await savedPlaces(page)).toEqual(before);
  expect(await page.locator('#position').textContent()).toBe(label);
});

test('the place reached by a find is the same after a reload', async ({ page }) => {
  await openInlineQuiet(page);
  await page.keyboard.press('Control+f');
  await page.locator('#find-query').fill('filler paragraph number 100 to');
  await expect(page.locator('#find-status')).toHaveText('1 of 1');
  expect(await markedText(page)).toBe('Filler paragraph number 100 to');
  await page.keyboard.press('Escape');
  await expect(page.locator('mark.search-hit')).toHaveCount(0);
  await expect.poll(async () => (await savedPlaces(page)).some(place => (place as { fraction?: number }).fraction! > 0.3)).toBe(true);
  await page.waitForTimeout(600);
  const before = await savedPlaces(page);
  const label = await page.locator('#position').textContent();

  await page.reload();
  await page.locator('#file-input').setInputFiles({ name: 'inline.md', mimeType: 'text/markdown', buffer: Buffer.from(inline) });
  await expect(page.locator('#filename')).toHaveText('inline.md');
  await expect(page.locator('#position')).toHaveText(label!);
  await page.waitForTimeout(600);
  expect(await savedPlaces(page)).toEqual(before);
});

test('plain text is searched as written, markup characters included, one line at a time', async ({ page }) => {
  const source = ['Some **bold words here** and `code`', 'second  line', 'third line'].join('\n');
  await page.goto('/');
  await page.locator('#file-input').setInputFiles({ name: 'plain.txt', mimeType: 'text/plain', buffer: Buffer.from(source) });
  await expect(page.locator('#filename')).toHaveText('plain.txt');
  await page.keyboard.press('Control+f');
  await page.locator('#find-query').fill('words here** and `c');
  await expect(page.locator('#find-status')).toHaveText('1 of 1');
  await expect.poll(() => markedText(page)).toBe('words here** and `c');
  // Text and spacing are exact: no crossing a line, no collapsing of a double space.
  await page.locator('#find-query').fill('code second');
  await expect(page.locator('#find-status')).toHaveText('No matches');
  await page.locator('#find-query').fill('second line');
  await expect(page.locator('#find-status')).toHaveText('No matches');
  await page.locator('#find-query').fill('second  line');
  await expect(page.locator('#find-status')).toHaveText('1 of 1');
});
