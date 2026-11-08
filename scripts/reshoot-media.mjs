// Reshoot the README media in docs/media against the current UI: Brief theme, light mode.
// Documents are public-domain scans and books; nothing personal is committed.
// Usage: node scripts/reshoot-media.mjs <page-document.pdf> <book.epub>
//        (dev server must be running on :1420)
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(join(process.cwd(), 'package.json'));
const { chromium } = require('playwright');
const MarkdownIt = require('markdown-it');

// Pinned Chrome for Testing on macOS; elsewhere Playwright's own Chromium (`npx playwright install chromium`).
const CHROME = join(process.env.HOME ?? '',
  'Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'docs', 'media');
const URL = 'http://127.0.0.1:1420/';

// Committed media uses only redistributable documents:
//  - a public-domain scan with a text layer (e.g. Internet Archive "The Half-Tone Process") for PDF
//    shots; pages without one show an "Image-only page" note in every shot,
//  - a public-domain book (e.g. Pride and Prejudice) for EPUB shots.
// In-copyright magazine scans are intentionally NOT committed.
// Pass the two documents as arguments; the README documents the sources used.
const [PDF = '', BOOK = ''] = process.argv.slice(2);
if (!PDF || !BOOK) {
  console.error('usage: node scripts/reshoot-media.mjs <page-document.pdf> <book.epub>');
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });

const COMPACT = { width: 420, height: 620 };
const READING = { width: 1080, height: 680 };
// Composite sheets (hero, themes) follow the portfolio grid: white ground, square corners, a
// hairline instead of a shadow. They are laid out in README units (shown at 880 px), so the 14 px
// gutter reads the same in every sheet, then rendered at a scale that keeps captures at full resolution.
const README_WIDTH = 880;
const GUTTER = 14;
const SHEET_CSS = `body { margin: 0; background: #fff; }
  img { display: block; outline: 1px solid rgba(0,0,0,.08); outline-offset: -1px; }
  .label { font: 400 11px/15px 'JetBrains Mono', 'Cascadia Mono', Consolas, ui-monospace, monospace;
           letter-spacing: 1.5px; text-transform: uppercase; color: #6e695e; }`;

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

async function setLibrary(page, open) {
  await page.evaluate(want => {
    const toggle = document.querySelector('#library-toggle');
    if (toggle && (toggle.getAttribute('aria-expanded') === 'true') !== want) toggle.click();
  }, open);
}

const dataUrl = png => `data:image/png;base64,${png.toString('base64')}`;

const browser = await chromium.launch(existsSync(CHROME) ? { executablePath: CHROME } : {});

// Hero: the print manual as a two-page spread beside the book in the default compact window,
// one row at equal height.
{
  const wide = { width: 820, height: COMPACT.height };
  let spread, compact;
  {
    const { ctx, page } = await open(browser, { viewport: wide });
    await loadFile(page, PDF, 9000);
    await jumpTo(page, 48);
    await setLibrary(page, false);
    await page.click('#view-spread');
    await page.waitForTimeout(1500);
    spread = await shot(page);
    await ctx.close();
  }
  {
    const { ctx, page } = await open(browser);
    await loadFile(page, BOOK, 6000);
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

// hand tool on a zoomed page
{
  const { ctx, page } = await open(browser);
  await loadFile(page, PDF, 9000);
  await jumpTo(page, 48);
  await page.click('#zoom-in');
  await page.click('#zoom-in');
  await page.click('#hand-tool');
  await page.waitForTimeout(1000);
  await shot(page, 'hand-tool.png');
  await ctx.close();
  console.log('hand-tool');
}

// library drawer over the page (the animated resize demo is scripts/record-library-demo.mjs).
{
  const { ctx, page } = await open(browser, { viewport: READING });
  await loadFile(page, PDF, 9000);
  await jumpTo(page, 48);
  await setLibrary(page, true);
  await page.waitForTimeout(900);
  await shot(page, 'library.png');
  await ctx.close();
  console.log('library');
}

// Appearance panel
{
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

// Theme sheet: every family reading the public-domain opening of Pride and Prejudice,
// composed into one row.
{
  const opening = [
    '# Chapter I',
    'It is a truth universally acknowledged, that a single man in possession of a good fortune must be in want of a wife.',
    'However little known the feelings or views of such a man may be on his first entering a neighbourhood, this truth is so well fixed in the minds of the surrounding families, that he is considered as the rightful property of some one or other of their daughters.',
    '“My dear Mr. Bennet,” said his lady to him one day, “have you heard that Netherfield Park is let at last?”',
  ].join('\n\n');
  const families = ['brief', 'lilac', 'birch', 'graphite', 'arctic'];
  const cells = [];
  for (const palette of families) {
    const { ctx, page } = await open(browser, { palette });
    await page.setInputFiles('#file-input', { name: 'Pride and Prejudice.md', mimeType: 'text/markdown', buffer: Buffer.from(opening) });
    await page.waitForTimeout(1200);
    cells.push(await shot(page));
    await ctx.close();
  }
  // Mono labels 8 px above each card, 7 px corners with a 20% muted hairline, and the gutter
  // repeated as padding around the set.
  const sheet = await browser.newPage({ viewport: { width: README_WIDTH, height: 400 }, deviceScaleFactor: 3 });
  await sheet.setContent(`<style>${SHEET_CSS}
    .grid { box-sizing: border-box; display: grid; grid-template-columns: repeat(5, 1fr); column-gap: ${GUTTER}px; row-gap: 8px;
            width: ${README_WIDTH}px; padding: ${GUTTER}px; }
    img { width: 100%; border-radius: 7px; outline: none; box-shadow: 0 0 0 1px rgba(110,105,94,.2); }
  </style><div class="grid">${families.map(f => `<div class="label">${f}</div>`).join('')}${cells.map(c => `<img src="${dataUrl(c)}">`).join('')}</div>`);
  await sheet.locator('.grid').screenshot({ path: join(OUT, 'themes.png') });
  await sheet.close();
  console.log('themes');
}

// Desktop: the reader pinned over a cluttered Windows desktop. The other windows show this
// repository's own stylesheet and user guide, so nothing third-party or personal is pictured.
{
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

await browser.close();
console.log('done');
