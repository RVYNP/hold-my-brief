import { defineConfig } from '@playwright/test';
import { platform } from 'node:os';
// Shared with tests/browser/*.mjs so the browser rule is defined exactly once.
// @ts-expect-error -- plain ESM helper module, no type declarations needed.
import { resolveChromiumExecutable } from './tests/browser/platform.mjs';

// Browser selection is platform-aware on purpose.
//
// History: this file used to hardcode `channel: 'msedge'`. That is correct only
// on Windows, where Microsoft Edge IS the WebView2 runtime and is therefore
// always installed. macOS and Linux have no Edge, so every test died in
// browserType.launch with "Chromium distribution 'msedge' is not found" before a
// single assertion ran -- green on Windows, dead on arrival elsewhere.
//
// Rule (deterministic; first match wins, see resolveChromiumExecutable):
//   1. CHROME_PATH, when set -- an explicit operator override always wins.
//   2. A branded Chromium-family browser actually found on this OS (Chrome,
//      then Edge, Chromium; Brave on macOS).
//   3. A complete build already unpacked in the Playwright cache, newest
//      revision first. Revision-agnostic on purpose: Playwright 1.64.1
//      nominates chromium-1248, but a machine holding only chromium-1243 still
//      launches and runs the whole suite. Insisting on the exact revision turns
//      a usable install into "Executable doesn't exist", i.e. a download many
//      CI/offline machines either cannot make or should not need.
//   4. Otherwise no explicit executable: Playwright's own bundled Chromium,
//      which needs `npx playwright install chromium` once.
//
// `channel` is passed ONLY when a branded browser was actually detected;
// defaulting to a channel is precisely the bug this replaced.

const browser = resolveChromiumExecutable() as { executablePath?: string; channel?: string; origin: string; note?: string };

// Printed once so a failing launch names the exact binary that was tried.
console.log(`[playwright] ${platform()}/${process.arch} browser: ${browser.origin}${browser.note ? ` -- ${browser.note}` : ''}`);

// One port per worker (E2E_PORT), so several checkouts can run e2e at once. 1421 stays the default.
const port = Number(process.env.E2E_PORT ?? 1421);

export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    ...(browser.channel ? { channel: browser.channel } : {}),
    ...(browser.executablePath ? { launchOptions: { executablePath: browser.executablePath } } : {}),
    viewport: { width: 420, height: 620 },
  },
  // Never reuse a server: it could belong to another checkout. A busy port fails fast (strictPort).
  //
  // Locally: the Vite dev server, exactly as `npm run dev`.
  // CI: `vite preview` of the production build the workflow made with `npm run build` just before.
  // The dev server optimises a dependency the first time a page imports it (pdf.js, foliate, the
  // lazily imported readers), then reloads every open page; a test that lost its page mid-setup
  // waited for an element that never came ("app never mounted"). A built app has no optimiser and
  // no HMR, and is closer to what ships. Server output goes to the job log.
  webServer: {
    command: process.env.CI
      ? `npx vite preview --host 127.0.0.1 --port ${port} --strictPort`
      : `npm run dev -- --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    ...(process.env.CI ? { stdout: 'pipe' as const, stderr: 'pipe' as const } : {}),
  },
  timeout: 30000,
  // The first document open on a cold dev server transforms pdfjs-dist/foliate on demand;
  // on a CI runner that alone took longer than the 5 s default and failed the first PDF test.
  expect: { timeout: 15000 },
});
