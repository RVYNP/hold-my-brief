// Record the README's library demo: the drawer opens over the page, is dragged wider, reset with a
// double-click and closed, while the page never moves. Writes docs/media/library-resize.gif (light mode).
// Usage: node scripts/record-library-demo.mjs <page-document.pdf>
//        (dev server must be running on :1420; needs ffmpeg with palettegen: Homebrew's, or set FFMPEG)
// Frames are captured deterministically: every CSS animation is paused and stepped by one frame
// before each screenshot, so hover fades and tooltips land on the same frames every run.
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(join(process.cwd(), 'package.json'));
const { chromium } = require('playwright');

// Pinned Chrome for Testing on macOS; elsewhere Playwright's own Chromium (`npx playwright install chromium`).
const CHROME = join(process.env.HOME ?? '',
  'Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const FFMPEG = process.env.FFMPEG || '/opt/homebrew/bin/ffmpeg';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'media');
const URL = 'http://127.0.0.1:1420/';
const FPS = 15;
const VIEWPORT = { width: 1080, height: 680 };
const GIF_WIDTH = 1080;

const [PDF = ''] = process.argv.slice(2);
if (!PDF) {
  console.error('usage: node scripts/record-library-demo.mjs <page-document.pdf>');
  process.exit(1);
}

// Ink arrow with a paper outline, drawn into the page so it shows in screenshots.
const CURSOR = `
  <svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 2v16l4.2-4 2.9 6.4 2.8-1.3-2.9-6.2H16z"
    fill="#1A1815" stroke="#FBF9F4" stroke-width="1.4" stroke-linejoin="round"/></svg>`;

async function record(browser) {
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, colorScheme: 'light' });
  await ctx.addInitScript(() => localStorage.setItem('hold-my-brief:appearance',
    JSON.stringify({ mode: 'system', palette: 'brief', accent: null, page: 'theme' })));
  const page = await ctx.newPage();
  await page.goto(URL);
  await page.setInputFiles('#file-input', PDF);
  await page.locator('#position').filter({ hasText: 'Page 1 of' }).waitFor({ timeout: 20000 });
  await page.keyboard.press('Control+g');
  await page.fill('#target', '48');
  await page.keyboard.press('Enter');
  await page.locator('#position').filter({ hasText: 'Page 48' }).waitFor();
  const libraryOpen = () => page.evaluate(() => document.querySelector('#library-toggle')?.getAttribute('aria-expanded') === 'true');
  if (await libraryOpen()) await page.click('#library-toggle');
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await page.evaluate(svg => {
    const cursor = document.createElement('div');
    cursor.id = 'demo-cursor';
    cursor.innerHTML = svg;
    cursor.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;';
    const ring = document.createElement('div');
    ring.id = 'demo-press';
    ring.style.cssText = 'position:fixed;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;' +
      'background:#1A181522;z-index:2147483646;pointer-events:none;opacity:0;';
    document.body.append(ring, cursor);
  }, CURSOR);
  await page.waitForTimeout(1500);

  const frames = mkdtempSync(join(tmpdir(), 'hmb-demo-'));
  let index = 0;
  let at = { x: 760, y: 430 };
  const place = (p, pressed) => page.evaluate(({ x, y, pressed }) => {
    document.getElementById('demo-cursor').style.transform = `translate(${x - 3}px, ${y - 2}px)`;
    const ring = document.getElementById('demo-press');
    ring.style.left = `${x}px`; ring.style.top = `${y}px`; ring.style.opacity = pressed ? '1' : '0';
  }, { ...p, pressed });
  const frame = async () => {
    // No focus ring in the recording: opening the drawer focuses its search field, which is not what the demo shows.
    await page.evaluate(step => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      for (const animation of document.getAnimations()) {
        if (animation.effect?.target?.closest?.('#demo-cursor, #demo-press')) continue;
        animation.pause();
        animation.currentTime = (animation.currentTime ?? 0) + step;
      }
    }, 1000 / FPS);
    await page.screenshot({ path: join(frames, `f${String(index++).padStart(4, '0')}.png`) });
  };
  const hold = async (seconds, pressed = false) => { for (let i = 0; i < Math.round(seconds * FPS); i++) { await place(at, pressed); await frame(); } };
  // Press ease from the brand motion rules, approximated as an ease-in-out cubic.
  const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
  const moveTo = async (to, seconds, pressed = false) => {
    const from = at, steps = Math.max(1, Math.round(seconds * FPS));
    for (let i = 1; i <= steps; i++) {
      const k = ease(i / steps);
      at = { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k };
      await page.mouse.move(at.x, at.y);
      await place(at, pressed);
      await frame();
    }
  };
  const center = async selector => {
    const box = await page.locator(selector).first().boundingBox();
    if (!box) throw new Error(`${selector} is not visible`);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  const click = async () => { await page.mouse.down(); await hold(0.13, true); await page.mouse.up(); };

  await page.mouse.move(at.x, at.y);
  await hold(0.8);
  await moveTo(await center('#library-toggle'), 0.7);
  await click();
  await hold(1.0);
  const handle = await center('[role="separator"]');
  await moveTo(handle, 0.8);
  await hold(0.7);
  await page.mouse.down();
  await hold(0.13, true);
  await moveTo({ x: handle.x + 230, y: handle.y }, 1.3, true);
  await page.mouse.up();
  await hold(1.0);
  await page.mouse.dblclick(at.x, at.y);
  await place(at, true); await frame();
  await hold(0.9);
  await moveTo(await center('#library-toggle'), 0.8);
  await click();
  await moveTo({ x: 760, y: 430 }, 0.7);
  await hold(0.4);
  if (await libraryOpen()) throw new Error('library should be closed at the end of the loop');
  await ctx.close();

  const pattern = join(frames, 'f%04d.png'), palette = join(frames, 'palette.png');
  const scale = `fps=${FPS},scale=${GIF_WIDTH}:-1:flags=lanczos`;
  execFileSync(FFMPEG, ['-y', '-v', 'error', '-framerate', String(FPS), '-i', pattern, '-vf', `${scale},palettegen=stats_mode=diff`, palette]);
  execFileSync(FFMPEG, ['-y', '-v', 'error', '-framerate', String(FPS), '-i', pattern, '-i', palette, '-lavfi',
    `${scale}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`, '-loop', '0',
    join(OUT, 'library-resize.gif')]);
  rmSync(frames, { recursive: true, force: true });
  console.log(`library-resize.gif (${index} frames)`);
}

const browser = await chromium.launch(existsSync(CHROME) ? { executablePath: CHROME } : {});
await record(browser);
await browser.close();
