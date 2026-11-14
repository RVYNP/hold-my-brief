// Reshoot the README media in docs/media against the current UI: Brief theme, light mode (the glow sheet shows each glow theme's own scheme).
// Documents are public-domain scans and books; nothing personal is committed.
// Usage: node scripts/reshoot-media.mjs <page-document.pdf> <book.epub> [public-domain-image ...]
//        (the optional images fill the library with real thumbnails; Haeckel's plates are what the README uses)
//        The dev server must be running; the script reads its address from HMB_URL (default http://127.0.0.1:1420/).
//        HMB_ONLY=tree,tabs reshoots just those stills (hero, home, tree, tabs, zoom, hand-tool, filmstrip, shelf, intake,
//        appearance, themes, glow, desktop). Needs public/pdfjs, which `npm ci` creates (postinstall); without it JPX scans render blank.
//        With sharp installed (`npm i --no-save sharp`) the PNGs are palette-quantised at the end, to about a third of their size.
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(join(process.cwd(), 'package.json'));
const { chromium } = require('playwright');
const MarkdownIt = require('markdown-it');

// Pinned Chrome for Testing on macOS; elsewhere Playwright's own Chromium (`npx playwright install chromium`).
const CHROME = join(process.env.HOME ?? '',
  'Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'docs', 'media');
const URL = process.env.HMB_URL ?? 'http://127.0.0.1:1420/';
const ONLY = new Set((process.env.HMB_ONLY ?? '').split(',').filter(Boolean));
const want = (...names) => ONLY.size === 0 || names.some(name => ONLY.has(name));

// Committed media uses only redistributable documents:
//  - a public-domain scan with a text layer (e.g. Internet Archive "The Half-Tone Process") for PDF
//    shots; pages without one are image-only (the tooltip says so, and a select-drag shows a notice),
//  - a public-domain book (e.g. Pride and Prejudice) for EPUB shots,
//  - public-domain images (e.g. Haeckel's plates from Wikimedia Commons), optional.
// In-copyright magazine scans are intentionally NOT committed.
// Pass the documents as arguments; the README documents the sources used.
const [PDF = '', BOOK = '', ...IMAGES] = process.argv.slice(2);
if (!PDF || !BOOK) {
  console.error('usage: node scripts/reshoot-media.mjs <page-document.pdf> <book.epub> [public-domain-image ...]');
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });

const COMPACT = { width: 420, height: 620 };
const READING = { width: 1080, height: 760 };
// Composite sheets (hero, theme sheets) follow the portfolio grid: white ground, square corners, a
// hairline instead of a shadow. They are laid out in README units (shown at 880 px), so the 14 px
// gutter reads the same in every sheet, then rendered at a scale that keeps captures at full resolution.
const README_WIDTH = 880;
const GUTTER = 14;
const SHEET_CSS = `body { margin: 0; background: #fff; }
  img { display: block; outline: 1px solid rgba(0,0,0,.08); outline-offset: -1px; }
  .label { font: 400 11px/15px 'JetBrains Mono', 'Cascadia Mono', Consolas, ui-monospace, monospace;
           letter-spacing: 1.5px; text-transform: uppercase; color: #6e695e; }`;

// Public-domain works, each with its opening line: the Markdown files that stand in for books (they get generated covers).
const OPENINGS = {
  'Moby-Dick': 'Call me Ishmael.',
  'Middlemarch': 'Miss Brooke had that kind of beauty which seems to be thrown into relief by poor dress.',
  'Frankenstein': 'You will rejoice to hear that no disaster has accompanied the commencement of an enterprise which you have regarded with such evil forebodings.',
  'Dracula': '3 May. Bistritz.—Left Munich at 8:35 P. M., on 1st May, arriving at Vienna early next morning.',
  'The Odyssey': 'Tell me, O Muse, of that ingenious hero who travelled far and wide after he had sacked the famous town of Troy.',
  'Leaves of Grass': 'I celebrate myself, and sing myself, and what I assume you shall assume, for every atom belonging to me as good belongs to you.',
  'The Origin of Species': 'When on board H.M.S. “Beagle,” as naturalist, I was much struck with certain facts in the distribution of the inhabitants of South America.',
  'Principia': 'The quantity of matter is the measure of the same, arising from its density and bulk conjointly.',
  'Great Expectations': 'My father’s family name being Pirrip, and my Christian name Philip, my infant tongue could make of both names nothing longer or more explicit than Pip.',
  'A Tale of Two Cities': 'It was the best of times, it was the worst of times, it was the age of wisdom, it was the age of foolishness.',
  'Walden': 'When I wrote the following pages, or rather the bulk of them, I lived alone, in the woods, a mile from any neighbor, in a house which I had built myself, on the shore of Walden Pond.',
};
const markdown = title => Buffer.from(`# ${title}\n\n${OPENINGS[title]}\n`);

async function open(browser, { viewport = COMPACT, palette = 'brief' } = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, colorScheme: 'light' });
  const page = await ctx.newPage();
  await page.goto(URL);
  await page.waitForTimeout(800);
  await page.evaluate(p => {
    localStorage.setItem('hold-my-brief:appearance', JSON.stringify({ mode: 'system', palette: p, accent: null, page: 'theme' }));
  }, palette);
  await page.reload();
  await page.waitForTimeout(800);
  return { ctx, page };
}

async function loadFile(page, path, waitMs = 6000) {
  await page.setInputFiles('#file-input', path);
  await page.waitForTimeout(waitMs);
}

async function jumpTo(page, target) {
  await page.keyboard.press('Control+g');
  await page.waitForTimeout(400);
  await page.fill('#target', String(target));
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1800);
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
}

async function settle(page) {
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await page.mouse.move(0, 0);
  await page.waitForTimeout(300);
}

async function shot(page, name) {
  await settle(page);
  return page.locator('#app').screenshot(name ? { path: join(OUT, name) } : {});
}

/** Shows or hides the info rail (the library's tree) beside the icon rail; the icon rail itself stays. Windows under 720 px have no rail. */
async function setInfoRail(page, show) {
  const library = page.locator('#library-rail [data-rail="library"]');
  if ((await library.getAttribute('aria-pressed') === 'true') !== show) await library.click();
  await page.waitForTimeout(500);
}

/** Waits until every picture on screen has loaded (or been marked unavailable); a path shown twice (Home repeats cards) counts once. */
const thumbnailsLoaded = (page, timeout = 30000) => page.waitForFunction(() => {
  const state = new Map();
  for (const m of document.querySelectorAll('.library-tile-media[data-path]')) state.set(m.dataset.path, state.get(m.dataset.path) || m.classList.contains('is-loaded') || m.classList.contains('is-unavailable'));
  return state.size > 0 && [...state.values()].every(Boolean);
}, null, { timeout }).then(() => page.waitForTimeout(600));

/** Waits for the PDF page on screen to finish drawing. */
async function pdfDrawn(page) {
  await page.waitForFunction(() => !document.querySelector('.pdf-render-status')).catch(() => {});
  await page.waitForTimeout(2500);
}

const dataUrl = png => `data:image/png;base64,${png.toString('base64')}`;

const browser = await chromium.launch(existsSync(CHROME) ? { executablePath: CHROME } : {});

// The demo library: public-domain documents in nested watched folders, with reading progress, favorites, two collections and one
// loose file. The real files (the PDF, the EPUB, the images) go in through the library's own file input; the Markdown stand-ins are
// small files named after public-domain works. Then the library's record is rewritten the way an indexed folder would have made it
// (a source root per watched folder, each document's path inside it), because the browser preview cannot index a folder.
const MIME = { pdf: 'application/pdf', epub: 'application/epub+zip', md: 'text/markdown', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const asFile = (name, buffer) => ({ name, mimeType: MIME[name.split('.').pop().toLowerCase()] ?? 'application/octet-stream', buffer });
// `source.pdf` is the generic name the app replaces with the folder's name (Home, tabs, board) and keeps in the tree.
const DEMO_PDF = 'source.pdf', DEMO_EPUB = 'Pride and Prejudice.epub';
const demoEntries = () => [
  { file: asFile(DEMO_EPUB, readFileSync(BOOK)), root: 'Classics', rel: 'Austen/Pride and Prejudice.epub', progress: { fraction: .37 }, ago: 25, favorite: true },
  ...['Great Expectations', 'A Tale of Two Cities'].map((title, index) => ({ file: asFile(`${title}.md`, markdown(title)), root: 'Classics', rel: `Dickens/${title}.md`, progress: { fraction: index ? 1 : .62 }, ago: index ? 3000 : 300 })),
  ...[['Moby-Dick', undefined, 90], ['Walden', .41, 600], ['Leaves of Grass', undefined, 4000]].map(([title, fraction, ago]) => ({ file: asFile(`${title}.md`, markdown(title)), root: 'Classics', rel: `American/${title}.md`, progress: fraction && { fraction }, ago, collection: title === 'Moby-Dick' ? 'Winter reading' : undefined, favorite: title === 'Moby-Dick' })),
  ...['Dracula', 'Frankenstein'].map((title, index) => ({ file: asFile(`${title}.md`, markdown(title)), root: 'Classics', rel: `Gothic and fantastic/${title}.md`, progress: index ? undefined : { fraction: .23 }, ago: 2000 + index * 500, collection: 'Winter reading' })),
  { file: asFile(DEMO_PDF, readFileSync(PDF)), root: 'Print history', rel: `02_half_tone/${DEMO_PDF}`, progress: { fraction: 47 / 145, page: 48, pages: 146 }, ago: 5, collection: 'Reference', favorite: true },
  ...IMAGES.map((path, index) => ({ file: asFile(basename(path), readFileSync(path)), root: 'Print history', rel: `01_plates/${basename(path)}`, ago: 700 + index * 60, collection: 'Reference' })),
  { file: asFile('Reading notes.md', Buffer.from('# Reading notes\n\nPages to come back to, in no particular order.\n')), ago: 1500 },
];

async function seedDemoLibrary(page) {
  const entries = demoEntries();
  await page.goto(URL);
  await page.waitForTimeout(800);
  await page.locator('input[type=file][multiple]').setInputFiles(entries.map(entry => entry.file));
  // Files without a cover of their own open the intake sheet; keep everything and let it close.
  await page.getByRole('button', { name: 'Keep all' }).click({ timeout: 60000 });
  await page.waitForSelector('.library-dialog', { state: 'detached' });
  const shown = new Map(entries.map(entry => [entry.file.name, {
    root: entry.root, rel: entry.rel, collection: entry.collection, favorite: Boolean(entry.favorite), ago: entry.ago, progress: entry.progress,
  }]));
  const collections = [{ id: 'demo-winter', name: 'Winter reading' }, { id: 'demo-reference', name: 'Reference' }];
  const done = await page.evaluate(async ({ shown, collections }) => {
    const db = await new Promise((ok, no) => { const r = indexedDB.open('hold-my-brief-library'); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
    const wait = request => new Promise((ok, no) => { request.onsuccess = () => ok(request.result); request.onerror = () => no(request.error); });
    const tx = db.transaction(['state', 'files'], 'readwrite');
    const lib = await wait(tx.objectStore('state').get('library'));
    const meta = new Map(shown);
    lib.collections = collections.map(({ id, name }) => ({ id, name, parentId: null }));
    const roots = new Map();
    let hit = 0;
    for (const doc of lib.documents) {
      const info = meta.get(doc.name); if (!info) continue;
      hit++;
      const id = doc.path.split('/')[0];
      doc.favorite = info.favorite; doc.lastOpened = Date.now() - info.ago * 60_000;
      doc.collectionIds = info.collection ? [collections.find(c => c.name === info.collection).id] : [];
      if (info.root) {
        roots.set(info.root, { id: `root-${info.root}`, name: info.root, path: null, managed: false });
        doc.source = { sourceId: `folder:${info.root}`, recordId: info.rel, repository: info.root, sourcePath: info.rel, revision: '1', rootId: `root-${info.root}`, relativePath: info.rel };
        // On the desktop a document's path ends in its folders, which is how a generic name like source.pdf finds its folder's name; keep the file under that path.
        const path = `${id}/${info.rel}`, files = tx.objectStore('files');
        files.put(await wait(files.get(doc.path)), path); files.delete(doc.path);
        doc.path = path;
      }
      if (info.progress) localStorage.setItem(`hold-my-brief:${id}`, JSON.stringify({ progress: info.progress }));
    }
    lib.roots = [...roots.values()];
    tx.objectStore('state').put(lib, 'library');
    await new Promise((ok, no) => { tx.oncomplete = ok; tx.onerror = () => no(tx.error); });
    db.close();
    return hit;
  }, { shown: [...shown], collections });
  if (done !== entries.length) throw new Error(`seeded ${done} of ${entries.length} documents`);
  await page.reload();
  await page.waitForTimeout(2500);
}

// Hero: the print manual as a two-page spread beside the book in the default compact window,
// one row at equal height.
if (want('hero')) {
  const wide = { width: 820, height: COMPACT.height };
  let spread, compact;
  {
    const { ctx, page } = await open(browser, { viewport: wide });
    await loadFile(page, PDF, 9000);
    await jumpTo(page, 48);
    await setInfoRail(page, false);
    await page.click('#view-spread');
    await page.waitForTimeout(1500);
    spread = await shot(page);
    await ctx.close();
  }
  {
    const { ctx, page } = await open(browser);
    await loadFile(page, BOOK, 10000);
    await jumpTo(page, '9%');
    compact = await shot(page);
    await ctx.close();
  }
  // Equal heights across the row: height × (sum of aspect ratios) + gutter = README width.
  const height = (README_WIDTH - GUTTER) / ((wide.width + COMPACT.width) / COMPACT.height);
  const sheet = await browser.newPage({ viewport: { width: README_WIDTH, height: Math.ceil(height) }, deviceScaleFactor: 2 * COMPACT.height / height });
  await sheet.setContent(`<style>${SHEET_CSS}
    .row { display: flex; gap: ${GUTTER}px; width: ${README_WIDTH}px; } img { height: ${height}px; }
  </style><div class="row"><img src="${dataUrl(spread)}"><img src="${dataUrl(compact)}"></div>`);
  await sheet.locator('.row').screenshot({ path: join(OUT, 'hero.png') });
  await sheet.close();
  console.log('hero');
}

// Home, the folder tree and the tabs: one session over the demo library. Home first (nothing open, the info rail away), then the
// info rail's tree with a few folders opened, then documents opened from the tree into tabs.
if (want('home', 'tree', 'tabs')) {
  const { ctx, page } = await open(browser, { viewport: READING });
  await seedDemoLibrary(page);
  await setInfoRail(page, false);
  await thumbnailsLoaded(page);
  if (want('home')) { await shot(page, 'home.png'); console.log('home'); }

  const row = text => page.locator('#library-root .tree-row', { hasText: text }).first();
  const openFolder = async text => { if (await row(text).getAttribute('aria-expanded') !== 'true') await row(text).locator('.tree-chevron').click(); };
  await setInfoRail(page, true);
  for (const folder of ['Austen', 'Dickens', 'American', '01_plates', '02_half_tone']) await openFolder(folder);
  // Tabs, left to right: the book (at 40 %), a Markdown file, two plates, and the print manual last, so it is the one open.
  await row('Pride and Prejudice').click();
  await page.waitForTimeout(7000);
  await jumpTo(page, '40%');
  await row('Moby-Dick').click();
  await page.waitForTimeout(1200);
  for (const image of IMAGES.slice(0, 2)) { await row(basename(image)).click(); await page.waitForTimeout(1500); }
  await row('source.pdf').click();
  await page.waitForTimeout(9000);
  await jumpTo(page, 48);
  await pdfDrawn(page);
  if (want('tree')) { await shot(page, 'tree.png'); console.log('tree'); }
  if (want('tabs')) {
    // The tab shot shows a plate, not the page the tree shot has open.
    if (IMAGES.length) { await page.locator('#tab-list .tab', { hasText: basename(IMAGES[0]).slice(0, 14) }).click(); await page.waitForTimeout(1500); }
    await setInfoRail(page, false);
    await shot(page, 'tabs.png');
    console.log('tabs');
  }
  await ctx.close();
}

// Zoom: the zoom menu open over a PDF page, with the typed-percentage field and the fits.
if (want('zoom')) {
  const { ctx, page } = await open(browser);
  await loadFile(page, PDF, 9000);
  await jumpTo(page, 48);
  await pdfDrawn(page);
  await page.click('#zoom-level');
  await page.waitForTimeout(700);
  await page.locator('#app').screenshot({ path: join(OUT, 'zoom.png') });
  await ctx.close();
  console.log('zoom');
}

// Hand tool: a plate zoomed in past the window, the hand switched on. The plate (an image) zooms like a PDF page.
if (want('hand-tool')) {
  const { ctx, page } = await open(browser);
  await loadFile(page, IMAGES[0] ?? PDF, 9000);
  if (!IMAGES.length) await jumpTo(page, 48);
  await page.click('#zoom-in');
  await page.click('#zoom-in');
  await page.click('#zoom-in');
  await page.click('#hand-tool');
  await page.waitForTimeout(1500);
  await shot(page, 'hand-tool.png');
  await ctx.close();
  console.log('hand-tool');
}

// Page previews: the filmstrip under the page, and the card that follows the pointer along the progress bar.
if (want('filmstrip')) {
  const { ctx, page } = await open(browser);
  await loadFile(page, PDF, 9000);
  await jumpTo(page, 48);
  await page.click('#view-previews');
  await page.waitForTimeout(3500);
  await pdfDrawn(page);
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  // The footer slides up when the pointer reaches the window's bottom edge, taking the bar with it: go there first, then onto the bar.
  await page.mouse.move(COMPACT.width / 2, COMPACT.height - 2);
  await page.waitForTimeout(900);
  const bar = await page.locator('#progress').boundingBox();
  // Hover over page 110 of 146 (the range thumb's travel is inset 6 px at each end), well clear of the current page in the strip.
  await page.mouse.move(bar.x + 6 + (bar.width - 12) * (109 / 145), bar.y + bar.height / 2, { steps: 4 });
  await page.waitForSelector('#progress-preview:not([hidden])');
  await page.waitForFunction(() => document.querySelector('#progress-preview canvas') && !document.querySelector('#progress-preview canvas.is-blank'), null, { timeout: 30000 });
  await page.waitForTimeout(2500);
  await page.locator('#app').screenshot({ path: join(OUT, 'filmstrip.png') });
  await ctx.close();
  console.log('filmstrip');
}

// Shelves: the library board with a parent collection whose children are shelves. Markdown files named after
// public-domain works get generated covers; the EPUB (a real cover image) and the PDF (its first page) are
// the real pictures. The collections are built the way e2e/shelf.spec.ts builds them.
if (want('shelf', 'intake')) {
  const works = {
    novels: ['Moby-Dick', 'Middlemarch', 'Frankenstein', 'Dracula'],
    poetry: ['The Odyssey', 'Leaves of Grass'],
    science: ['The Origin of Species', 'Principia'],
  };
  const dir = mkdtempSync(join(tmpdir(), 'hmb-shelf-'));
  const files = Object.fromEntries(Object.entries(works).map(([shelf, titles]) => [shelf, titles.map(title => {
    const path = join(dir, `${title}.md`);
    writeFileSync(path, markdown(title));
    return path;
  })]));
  const { ctx, page } = await open(browser, { viewport: { width: 1440, height: 900 } });
  await setInfoRail(page, true);
  await page.getByRole('button', { name: 'Open library board' }).click();
  await page.waitForSelector('#library-root.is-board');
  const addFiles = async paths => {
    await page.locator('#library-rail').getByRole('button', { name: 'Add files', exact: true }).click();
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('menuitem', { name: 'Add local documents or images' }).click()]);
    await chooser.setFiles(paths);
    await page.waitForTimeout(1500);
  };
  // Files with generated covers open the intake sheet; keeping everything closes it.
  const keepAll = async () => {
    await page.getByRole('button', { name: 'Keep all' }).click();
    await page.waitForSelector('.library-dialog', { state: 'detached' });
  };
  const newCollection = async (name, parent) => {
    await page.getByRole('button', { name: 'New personal collection' }).click();
    await page.getByLabel('Collection name').fill(name);
    if (parent) await page.getByLabel('Parent collection').selectOption({ label: parent });
    await page.getByRole('button', { name: 'Create collection' }).click();
    await page.waitForSelector('.library-dialog', { state: 'detached' });
  };
  const chooseFromViewMenu = async name => {
    await page.getByRole('button', { name: /Sort, view and filter options/ }).click();
    await page.getByRole('menuitemradio', { name, exact: true }).click();
    await page.keyboard.press('Escape');
    await page.waitForSelector('.library-view-menu', { state: 'hidden' });
  };
  // The real pictures sit in their own shelves: the EPUB's cover among the novels, the PDF's first page among the science.
  const pdf = join(dir, 'The Half-Tone Process.pdf');
  copyFileSync(PDF, pdf);
  const book = join(dir, 'Pride and Prejudice.epub');
  copyFileSync(BOOK, book);
  const extras = { novels: [book], science: [pdf] };
  await newCollection('classics');
  for (const [index, shelf] of Object.keys(works).entries()) {
    await newCollection(`${index + 1}-${shelf}`, 'Classics');
    await addFiles([...files[shelf], ...(extras[shelf] ?? [])]);
    // The first shelf's arrivals (generated covers and the EPUB's real one) are the intake still, shot before Keep all.
    if (index === 0) {
      await page.waitForSelector('.library-dialog');
      await page.waitForTimeout(1500);
      if (want('intake')) await shot(page, 'intake.png');
    }
    await keepAll();
  }
  await page.locator('.library-filter', { hasText: /^Classics/ }).click();
  await chooseFromViewMenu('Grid');
  await chooseFromViewMenu('Name A–Z');
  await page.waitForFunction(() => document.querySelectorAll('.library-tile-media.is-loaded').length >= 2, null, { timeout: 30000 });
  await page.locator('.library-tile', { hasText: 'Pride and Prejudice' }).locator('.library-tile-open').click();
  await page.waitForTimeout(900);
  if (want('shelf')) await shot(page, 'shelf.png');
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
  console.log('shelf');
}

// Appearance panel
if (want('appearance')) {
  const { ctx, page } = await open(browser);
  await loadFile(page, BOOK, 6000);
  await page.click('#menu-toggle');
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: /Appearance/ }).click();
  await page.waitForTimeout(900);
  await shot(page, 'appearance.png');
  await ctx.close();
  console.log('appearance');
}

// Theme sheets: the same window in every theme, composed into rows on white with the theme's name above each cell.
// themes.png is the seven standard themes reading the public-domain opening of Pride and Prejudice; glow.png is the
// ten glow themes (each with its own light or dark scheme) around a page of the print manual, where the glow shows.
async function themeSheet(cells, { columns, file }) {
  // Mono labels 8 px above each card, 7 px corners with a 20% muted hairline, and the gutter
  // repeated as padding around the set and between rows.
  const rows = Array.from({ length: Math.ceil(cells.length / columns) }, (_, row) => cells.slice(row * columns, (row + 1) * columns));
  const sheet = await browser.newPage({ viewport: { width: README_WIDTH, height: 400 }, deviceScaleFactor: 3 });
  await sheet.setContent(`<style>${SHEET_CSS}
    .grid { box-sizing: border-box; display: grid; grid-template-columns: repeat(${columns}, 1fr); column-gap: ${GUTTER}px; row-gap: 8px;
            width: ${README_WIDTH}px; padding: ${GUTTER}px; }
    .gap { grid-column: 1 / -1; height: ${GUTTER - 8}px; }
    img { width: 100%; border-radius: 7px; outline: none; box-shadow: 0 0 0 1px rgba(110,105,94,.2); }
  </style><div class="grid">${rows.map((row, index) => `${index ? '<div class="gap"></div>' : ''}${row.map(cell => `<div class="label">${cell.label}</div>`).join('')}${row.map(cell => `<img src="${dataUrl(cell.png)}">`).join('')}`).join('')}</div>`);
  await sheet.locator('.grid').screenshot({ path: join(OUT, file) });
  await sheet.close();
}

if (want('themes')) {
  const opening = [
    '# Chapter I',
    'It is a truth universally acknowledged, that a single man in possession of a good fortune must be in want of a wife.',
    'However little known the feelings or views of such a man may be on his first entering a neighbourhood, this truth is so well fixed in the minds of the surrounding families, that he is considered as the rightful property of some one or other of their daughters.',
    '“My dear Mr. Bennet,” said his lady to him one day, “have you heard that Netherfield Park is let at last?”',
  ].join('\n\n');
  const families = ['brief', 'lilac', 'birch', 'graphite', 'arctic', 'blossom', 'peony'];
  const cells = [];
  for (const palette of families) {
    const { ctx, page } = await open(browser, { palette });
    await page.setInputFiles('#file-input', { name: 'Pride and Prejudice.md', mimeType: 'text/markdown', buffer: Buffer.from(opening) });
    await page.waitForTimeout(1200);
    cells.push({ label: palette, png: await shot(page) });
    await ctx.close();
  }
  await themeSheet(cells, { columns: families.length, file: 'themes.png' });
  console.log('themes');
}

if (want('glow')) {
  const glows = ['aurora', 'dusk', 'nebula', 'solar', 'ember', 'orchid', 'glacier', 'peach', 'lagoon', 'moss'];
  const cells = [];
  for (const palette of glows) {
    const { ctx, page } = await open(browser, { palette });
    await loadFile(page, PDF, 9000);
    await jumpTo(page, 48);
    await pdfDrawn(page);
    cells.push({ label: palette, png: await shot(page) });
    await ctx.close();
  }
  await themeSheet(cells, { columns: 5, file: 'glow.png' });
  console.log('glow');
}

// Desktop: the reader pinned over a cluttered Windows desktop. The other windows show this
// repository's own stylesheet and user guide, so nothing third-party or personal is pictured.
if (want('desktop')) {
  const ROOT = join(HERE, '..');
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let reader;
  {
    const { ctx, page } = await open(browser);
    await loadFile(page, PDF, 9000);
    await jumpTo(page, 48);
    // The browser preview has no native frame and cannot pin: draw what the desktop app does on Windows
    // (its own caption buttons in the toolbar, the pinned state as updateWindow() in src/main.ts sets it).
    await page.evaluate(() => { document.documentElement.classList.add('windows-titlebar'); document.getElementById('pin').setAttribute('aria-pressed', 'true'); });
    reader = await shot(page);
    await ctx.close();
  }
  const highlight = line => /^\s*(\/\*|\*)/.test(line)
    ? `<span class="c">${esc(line)}</span>`
    : esc(line)
      .replace(/(--[\w-]+)(:)/g, '<span class="p">$1</span>$2')
      .replace(/(#[0-9a-fA-F]{3,8})/g, '<span class="v">$1</span>')
      .replace(/(\[data-palette=)('[^']+')(\])/g, '$1<span class="s">$2</span>$3');
  const code = readFileSync(join(ROOT, 'src/style.css'), 'utf8').split(/\r?\n/).slice(0, 44)
    .map((line, i) => `<div class="ln"><i>${i + 1}</i><span>${highlight(line) || ' '}</span></div>`).join('');
  const guide = new MarkdownIt().render(readFileSync(join(ROOT, 'docs/user-guide.md'), 'utf8').split(/\r?\n/).slice(0, 60).join('\n'));
  const icon = dataUrl(readFileSync(join(ROOT, 'src-tauri/icons-src/icon.png')));
  const file = (band, ext) => `<svg viewBox="0 0 40 48" width="34" height="40"><path d="M4 2h22l10 10v34H4z" fill="#fff" stroke="#c9c4ba"/><path d="M26 2v10h10" fill="#eee" stroke="#c9c4ba"/><rect x="4" y="30" width="32" height="12" fill="${band}"/><text x="20" y="39.5" text-anchor="middle" font-family="Segoe UI, Arial" font-size="8" font-weight="700" fill="#fff">${ext}</text></svg>`;
  const folder = `<svg viewBox="0 0 48 40" width="40" height="34"><path d="M2 6h16l4 4h24v28H2z" fill="#f2c55c"/><path d="M2 12h44v26H2z" fill="#f7d77e"/></svg>`;
  const clutter = [
    [folder, 'old portfolio'], [file('#d4483d', 'PDF'), 'brief_FINAL_v3.pdf'], [file('#3b82c4', 'PNG'), 'Screenshot 2026-11-04 141203.png'],
    [file('#6e695e', 'MD'), 'notes.md'], [file('#d4483d', 'PDF'), 'invoice_0412.pdf'], [folder, 'New folder (3)'], [file('#3b82c4', 'JPG'), 'ref_02.jpg'],
  ];
  const controls = '<span class="ctl"><svg viewBox="0 0 10 10"><path d="M0 5h10" stroke="currentColor"/></svg><svg viewBox="0 0 10 10"><rect x=".5" y=".5" width="9" height="9" fill="none" stroke="currentColor"/></svg><svg viewBox="0 0 10 10"><path d="M0 0l10 10M10 0L0 10" stroke="currentColor"/></svg></span>';
  const [W, H] = [1280, 800];
  const sheet = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
  await sheet.setContent(`<style>
    * { box-sizing: border-box; }
    body { margin: 0; font: 12px/1.4 'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif; color: #1a1a1a; }
    .desk { position: relative; width: ${W}px; height: ${H}px; overflow: hidden;
            background: radial-gradient(130% 100% at 75% 0%, #b9b2a3 0%, #8c8577 50%, #6e695e 100%); }
    .icons { position: absolute; left: 6px; top: 12px; display: grid; gap: 8px; width: 92px; }
    .icons div { display: grid; justify-items: center; gap: 3px; text-align: center; font-size: 11px; line-height: 1.25; color: #fff;
                 text-shadow: 0 1px 2px rgba(0,0,0,.55); overflow-wrap: anywhere; }
    .win { position: absolute; display: flex; flex-direction: column; overflow: hidden; background: #fff; border-radius: 8px;
           box-shadow: 0 0 0 1px rgba(0,0,0,.12), 0 8px 28px rgba(0,0,0,.22); }
    .bar { height: 32px; flex: none; display: flex; align-items: center; gap: 8px; padding-left: 12px; background: #f3f3f3; }
    .bar img { width: 16px; height: 16px; border-radius: 4px; }
    .bar .t { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ctl { display: flex; } .ctl svg { width: 46px; height: 10px; padding: 0 18px; color: #333; }
    .editor { left: 112px; top: 34px; width: 700px; height: 560px; }
    .editor .body { flex: 1; display: flex; font: 12px/19px 'JetBrains Mono', Consolas, monospace; }
    .side { width: 168px; padding: 10px 12px; background: #f7f7f7; border-right: 1px solid #e5e5e5; font: 12px/22px 'Segoe UI', sans-serif; color: #444; }
    .side b { display: block; font-size: 11px; font-weight: 600; letter-spacing: .04em; color: #777; }
    .side .on { margin: 0 -12px; padding: 0 12px; background: #e4e6f1; }
    .code { flex: 1; padding: 8px 0; overflow: hidden; white-space: pre; }
    .ln { display: flex; } .ln i { flex: none; width: 40px; padding-right: 14px; text-align: right; font-style: normal; color: #a0a0a0; }
    .c { color: #6a8a5a; } .p { color: #1f5fbf; } .v { color: #a3541c; } .s { color: #a11d6e; }
    .browser { left: 330px; top: 196px; width: 600px; height: 500px; }
    .tabs { height: 38px; display: flex; align-items: flex-end; padding-left: 8px; background: #e9e9e9; }
    .tab { width: 220px; padding: 8px 14px; background: #fff; border-radius: 8px 8px 0 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .tabs .ctl { margin-left: auto; align-self: center; }
    .url { height: 36px; display: flex; align-items: center; gap: 10px; padding: 0 10px; border-bottom: 1px solid #e5e5e5; color: #666; }
    .url span { flex: 1; padding: 5px 14px; background: #f1f1f1; border-radius: 16px; color: #333; }
    .doc { flex: 1; overflow: hidden; padding: 18px 36px; font: 13px/1.6 'Segoe UI', Helvetica, Arial, sans-serif; color: #1f2328; }
    .doc h1 { margin: 0 0 12px; padding-bottom: 6px; border-bottom: 1px solid #d1d9e0; font-size: 24px; font-weight: 600; }
    .doc h2 { margin: 18px 0 8px; padding-bottom: 4px; border-bottom: 1px solid #d1d9e0; font-size: 18px; font-weight: 600; }
    .doc p, .doc li { margin: 0 0 8px; } .doc ul { margin: 0 0 8px; padding-left: 20px; } .doc a { color: #0969da; text-decoration: none; }
    .doc code { padding: 1px 4px; background: #eff1f3; border-radius: 4px; font: 11.5px 'JetBrains Mono', Consolas, monospace; }
    .reader { right: 26px; top: 22px; width: 420px; }
    .reader > img { display: block; width: 420px; }
    .taskbar { position: absolute; left: 0; right: 0; bottom: 0; height: 48px; display: flex; align-items: center; justify-content: center; gap: 6px;
               background: rgba(243,243,243,.92); border-top: 1px solid rgba(0,0,0,.08); }
    .tile { position: relative; width: 36px; height: 36px; display: grid; place-items: center; border-radius: 6px; }
    .tile svg, .tile img { width: 22px; height: 22px; } .tile img { width: 24px; height: 24px; border-radius: 5px; }
    .tile.on::after { content: ''; position: absolute; bottom: -4px; width: 16px; height: 3px; border-radius: 2px; background: #5b5fc7; }
    .clock { position: absolute; right: 14px; top: 8px; text-align: right; line-height: 16px; }
  </style>
  <div class="desk">
    <div class="icons">${clutter.map(([svg, name]) => `<div>${svg}<span>${esc(name)}</span></div>`).join('')}</div>
    <div class="win editor">
      <div class="bar"><span class="t">style.css — hold-my-brief</span>${controls}</div>
      <div class="body"><div class="side"><b>EXPLORER</b>src<br>&nbsp;&nbsp;library.css<br>&nbsp;&nbsp;main.ts<br><div class="on">&nbsp;&nbsp;style.css</div>&nbsp;&nbsp;theme.ts<br>docs<br>README.md</div><div class="code">${code}</div></div>
    </div>
    <div class="win browser">
      <div class="tabs"><div class="tab">user-guide.md · RVYNP/hold-my-brief</div>${controls}</div>
      <div class="url">← → ↻ <span>github.com/RVYNP/hold-my-brief/blob/main/docs/user-guide.md</span></div>
      <div class="doc">${guide}</div>
    </div>
    <div class="win reader">
      <img src="${dataUrl(reader)}">
    </div>
    <div class="taskbar">
      <span class="tile"><svg viewBox="0 0 24 24" fill="#8a8a8a"><rect x="2" y="2" width="9" height="9"/><rect x="13" y="2" width="9" height="9"/><rect x="2" y="13" width="9" height="9"/><rect x="13" y="13" width="9" height="9"/></svg></span>
      <span class="tile"><svg viewBox="0 0 24 24"><path d="M2 6h8l2 2h10v12H2z" fill="#f2c55c"/></svg></span>
      <span class="tile on"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#3a8ee6"/><circle cx="12" cy="12" r="4" fill="#fff"/></svg></span>
      <span class="tile on"><svg viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="4" fill="#2b6fb6"/><path d="M8 8l-3 4 3 4M16 8l3 4-3 4" stroke="#fff" stroke-width="2" fill="none"/></svg></span>
      <span class="tile on"><img src="${icon}"></span>
      <div class="clock">4:52 PM<br>11/4/2026</div>
    </div>
  </div>`);
  await sheet.waitForTimeout(300);
  await sheet.locator('.desk').screenshot({ path: join(OUT, 'desktop.png') });
  await sheet.close();
  console.log('desktop');
}


// The stills are palette-quantised (about a third of their size, no visible loss) when sharp is installed: `npm i --no-save sharp`.
{
  let sharp;
  try { sharp = require('sharp'); } catch { console.log('sharp is not installed: the PNGs are left as captured'); }
  if (sharp) {
    for (const name of readdirSync(OUT).filter(file => file.endsWith('.png'))) {
      const path = join(OUT, name);
      writeFileSync(path, await sharp(readFileSync(path)).png({ compressionLevel: 9, effort: 10, palette: true, quality: 92, colours: 256, dither: 0.8 }).toBuffer());
    }
    console.log('optimised');
  }
}
await browser.close();
console.log('done');
