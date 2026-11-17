import { test, expect, type Frame, type Page } from '@playwright/test';
import { chapterBook, codeBook } from './epub-book';

/** Set CODE_SHOTS to a directory to also save screenshots of a framed pandoc listing. */
const shots = process.env.CODE_SHOTS;

const flowOf = (page: Page) => page.evaluate(() => (document.querySelector('.reader-host:not(.staging):not(.tab-hidden) foliate-view') as unknown as { renderer: HTMLElement }).renderer.getAttribute('flow'));
/** The book's content frame. Foliate keeps its iframe in a closed shadow root, so it is found as a frame of the page, not by selector. */
const frameOf = (page: Page): Frame => page.frames().filter(frame => frame.url().startsWith('blob:')).at(-1)!;

async function open(page: Page, book: Buffer, scheme: 'light' | 'dark', flow: 'pages' | 'scroll', ready?: string) {
  await page.emulateMedia({ colorScheme: scheme });
  await page.setViewportSize({ width: 1080, height: 760 });
  await page.goto('/');
  await page.locator('#file-input').setInputFiles({ name: 'code.epub', mimeType: 'application/epub+zip', buffer: book });
  await expect(page.locator('#position')).toContainText('%');
  await expect(page.locator('#view-controls')).toBeVisible();
  await expect(page.locator('.reader-host.staging')).toHaveCount(0);
  await page.locator(flow === 'scroll' ? '#flow-scroll' : '#flow-pages').click();
  await expect.poll(() => flowOf(page)).toBe(flow === 'scroll' ? 'scrolled' : 'paginated');
  // The flow change re-lays the book out and goes back to the place, queued behind aria-busy; a renderer call made meanwhile can wait on that load forever.
  await expect(page.locator('.reader-host:not(.staging):not(.tab-hidden)')).not.toHaveAttribute('aria-busy', 'true');
  if (ready) await expect(frameOf(page).locator(ready)).toBeVisible();
}

/** What a listing's frame looks like: its own box, the box of a `pre` nested in it, and the label next to its first line. */
const look = (page: Page, selector: string) => frameOf(page).locator(selector).evaluate(element => {
  const doc = element.ownerDocument, win = doc.defaultView!, style = win.getComputedStyle(element);
  const pre = element.localName === 'pre' ? null : element.querySelector('pre'), nested = pre && win.getComputedStyle(pre);
  const shadow = Array.from(doc.documentElement.children).find(child => child.shadowRoot)!.shadowRoot!;
  const tags = Array.from(shadow.querySelectorAll<HTMLElement>('.language')).filter(tag => !tag.hidden);
  const box = Array.from(element.getClientRects()).find(rect => rect.width > 0 && rect.height > 0)!;
  // The label that sits inside this block's top-left corner. A listing that runs over a page turn is several boxes, and the label is on the first; its bounding rect would reach up into the next column.
  const tag = tags.find(candidate => { const rect = candidate.getBoundingClientRect(); return rect.left >= box.left && rect.left < box.right && rect.top >= box.top && rect.top < box.bottom; });
  const walker = doc.createTreeWalker(pre ?? element, NodeFilter.SHOW_TEXT);
  let first = walker.nextNode();
  while (first && !first.textContent?.trim()) first = walker.nextNode();
  const range = doc.createRange();
  if (first) range.selectNodeContents(first);
  const line = first ? Array.from(range.getClientRects()).find(rect => rect.width > 0) : undefined;
  const label = tag?.getBoundingClientRect(), tagStyle = tag && win.getComputedStyle(tag);
  return {
    radius: style.borderTopLeftRadius, border: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth], borderStyle: style.borderTopStyle,
    background: style.backgroundColor, labelled: element.hasAttribute('data-hmb-labelled'),
    nested: nested ? { border: [nested.borderTopWidth, nested.borderLeftWidth], radius: nested.borderTopLeftRadius, background: nested.backgroundColor } : null,
    label: tag && label && tagStyle ? { text: tag.textContent, hidden: tag.getAttribute('aria-hidden'), events: tagStyle.pointerEvents, size: tagStyle.fontSize, family: tagStyle.fontFamily, color: tagStyle.color, left: label.left - box.left, top: label.top - box.top, bottom: label.bottom, right: label.right } : null,
    line: line ? { top: line.top, left: line.left } : null,
  };
});

/** Turns to the listing `selector` in the first chapter, in whichever flow the book is in. */
const reveal = (page: Page, selector: string) => page.evaluate(async selector => {
  const view = document.querySelector('.reader-host:not(.staging):not(.tab-hidden) foliate-view') as unknown as { renderer: { goTo: (target: { index: number; anchor: (doc: Document) => Element }) => Promise<void> } };
  await view.renderer.goTo({ index: 0, anchor: doc => doc.querySelector(selector)! });
}, selector);

/** `look` once the block's label has been placed: it is positioned after the frame's layout settles. */
async function labelled(page: Page, selector: string) {
  await expect.poll(async () => (await look(page, selector)).label !== null).toBe(true);
  return look(page, selector);
}

for (const flow of ['pages', 'scroll'] as const) {
  test(`pandoc and Sphinx listings get the frame and a language label, a bare pre only the frame, in ${flow}`, async ({ page }) => {
    await open(page, await codeBook(), 'light', flow, 'div.sourceCode#cb2');
    const sphinx = 'div.highlight';
    for (const selector of ['div.sourceCode#cb2', sphinx]) {
      const seen = await labelled(page, selector);
      expect(seen.radius).toBe('8px');
      expect(seen.border).toEqual(['1px', '1px', '1px', '1px']);
      expect(seen.borderStyle).toBe('solid');
      // The pre inside is not a second box.
      expect(seen.nested!.border).toEqual(['0px', '0px']);
      expect(seen.nested!.radius).toBe('7px');
      expect(seen.labelled).toBe(true);
      const label = seen.label!;
      expect(label.text).toBe('python');
      expect(label.hidden).toBe('true');
      expect(label.events).toBe('none');
      expect(label.size).toBe('11px');
      expect(label.family).toMatch(/mono|Menlo|Consolas/i);
      expect(label.left, 'label in the left corner').toBeLessThan(24);
      expect(label.top, 'label near the top edge').toBeLessThan(12);
      // It never covers the first line.
      expect(label.bottom).toBeLessThanOrEqual(seen.line!.top + 0.5);
    }
    // The publisher's background stays: pandoc's pre paints #f0f0f0, Sphinx's wrapper #f3f3f3.
    expect((await look(page, 'div.sourceCode#cb2')).nested!.background).toBe('rgb(240, 240, 240)');
    expect((await look(page, sphinx)).background).toBe('rgb(243, 243, 243)');
    // A label shows without hover or focus.
    await expect(frameOf(page).locator('.language', { hasText: 'python' }).first()).toBeVisible();
    await expect(frameOf(page).getByRole('button', { name: 'Open code' })).toBeHidden();
    if (shots) { await reveal(page, 'div.sourceCode#cb2'); await page.waitForTimeout(600); await page.screenshot({ path: `${shots}/pandoc-light-${flow}.png` }); }
  });

  test(`a bare pre is framed and filled, and has no label, in ${flow}`, async ({ page }) => {
    await open(page, await chapterBook({ code: true }), 'light', flow, 'h1');
    // The first chapter is the title page; the code is at the head of the next ones.
    await page.evaluate(async () => { await (document.querySelector('.reader-host:not(.staging):not(.tab-hidden) foliate-view') as unknown as { renderer: { goTo: (target: { index: number }) => Promise<void> } }).renderer.goTo({ index: 1 }); });
    await expect.poll(() => frameOf(page).locator('pre').count().catch(() => 0)).toBe(1);
    await expect(frameOf(page).locator('pre')).toBeVisible();
    const seen = await look(page, 'pre');
    expect(seen.radius).toBe('8px');
    expect(seen.border).toEqual(['1px', '1px', '1px', '1px']);
    expect(seen.background, 'a listing with no background gets the tint').not.toBe('rgba(0, 0, 0, 0)');
    expect(seen.labelled).toBe(false);
    expect(seen.label).toBeNull();
    expect(await frameOf(page).locator('.language:visible').count()).toBe(0);
  });
}

test('on a dark page the listings are framed, and keep the mapped background', async ({ page }) => {
  await open(page, await codeBook(), 'dark', 'scroll', 'div.sourceCode#cb2');
  const seen = await labelled(page, 'div.sourceCode#cb2');
  expect(seen.radius).toBe('8px');
  expect(seen.label!.text).toBe('python');
  // The label's ink is the page's ink at 60 %: legible against the dark box.
  expect(seen.label!.color).toMatch(/^(rgba\(\d+, \d+, \d+, 0\.6\d*\)|color\(srgb [^)]*\/ 0\.6\d*\))$/);
  if (shots) { await reveal(page, 'div.sourceCode#cb2'); await page.waitForTimeout(600); await page.screenshot({ path: `${shots}/pandoc-dark-scroll.png` }); }
});

test('Open and Copy still appear on hover over a labelled listing, beside its label', async ({ page }) => {
  await open(page, await codeBook(), 'light', 'pages', 'div.sourceCode#cb2');
  await frameOf(page).locator('div.sourceCode#cb2').hover();
  await expect(frameOf(page).getByRole('button', { name: 'Open code' })).toBeVisible();
  await expect(frameOf(page).getByRole('button', { name: 'Copy code' })).toBeVisible();
  await expect(frameOf(page).locator('.language', { hasText: 'python' }).first()).toBeVisible();
});

for (const flow of ['pages', 'scroll'] as const) {
  test(`a saved place inside a framed listing is restored there in ${flow}`, async ({ page }) => {
    const book = await codeBook();
    await open(page, book, 'light', flow, 'div.sourceCode#cb2');
    const view = '.reader-host:not(.staging):not(.tab-hidden) foliate-view';
    // The first line of the 60-line listing that is in view, by its number.
    const topLine = () => page.evaluate(selector => {
      const foliate = document.querySelector(selector) as unknown as { renderer: { getContents: () => { doc: Document }[] } };
      const doc = foliate.renderer.getContents()[0].doc, host = document.querySelector('.reader-host:not(.staging):not(.tab-hidden)')!.getBoundingClientRect();
      const frame = doc.defaultView!.frameElement!.getBoundingClientRect();
      const lines = Array.from(doc.querySelectorAll<HTMLElement>('#cb3 [data-hmb-line]'));
      const shown = lines.find(line => { const rect = line.getBoundingClientRect(); return frame.left + rect.left >= host.left - 1 && frame.left + rect.left < host.right && frame.top + rect.top >= host.top - 1 && frame.top + rect.bottom <= host.bottom + 1; });
      return Number(/^cb3-(\d+)$/.exec(shown?.id ?? '')?.[1] ?? 0);
    }, view);
    // Read down into the 60-line listing the way a reader does, a page at a time.
    await page.locator('.reader-host').focus();
    for (let turns = 0; turns < 40 && (await topLine()) < 20; turns++) {
      const before = await page.locator('#position').innerText();
      await page.keyboard.press('PageDown');
      await expect(page.locator('#position')).not.toHaveText(before);
    }
    // The view may still be easing to its stop: take the line once it has been the same on two reads.
    let before = -1;
    await expect.poll(async () => { const now = await topLine(); const settled = now === before; before = now; return settled && now >= 20; }, { intervals: [300] }).toBe(true);
    // The place is written 650 ms after the last move, so an earlier turn's write can already be there: wait for the one at this line (the one before it may be the partly visible top of the page), by its text offset.
    const wanted = await page.evaluate(([selector, line]) => {
      const foliate = document.querySelector(selector as string) as unknown as { renderer: { getContents: () => { doc: Document }[] } };
      const doc = foliate.renderer.getContents()[0].doc, range = doc.createRange();
      range.setStart(doc.body, 0); range.setEndBefore(doc.getElementById(`cb3-${line}`)!);
      return range.toString().length;
    }, [view, Math.max(1, before - 2)] as const);
    await expect.poll(() => page.evaluate(() => Math.max(0, ...Object.entries(localStorage).filter(([key]) => key.startsWith('hold-my-brief:')).map(([, value]) => { try { return Number(JSON.parse(value).locator?.offset) || 0; } catch { return 0; } })))).toBeGreaterThanOrEqual(wanted);
    await page.reload();
    await page.locator('#file-input').setInputFiles({ name: 'code.epub', mimeType: 'application/epub+zip', buffer: book });
    await expect(page.locator('#position')).toContainText('%');
    // The flow is part of the saved options: the book reopens in it without a click.
    await expect.poll(() => flowOf(page)).toBe(flow === 'scroll' ? 'scrolled' : 'paginated');
  // The flow change re-lays the book out and goes back to the place, queued behind aria-busy; a renderer call made meanwhile can wait on that load forever.
  await expect(page.locator('.reader-host:not(.staging):not(.tab-hidden)')).not.toHaveAttribute('aria-busy', 'true');
    await expect(frameOf(page).locator('div.sourceCode#cb3')).toBeAttached();
    await expect.poll(topLine).toBe(before);
  });
}
