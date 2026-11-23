- **Fixes only (since 2026-11-17, until the owner lifts it here).** The app is being redesigned. Fixes
  pass: a bug in behaviour already on `main`, security and dependency fixes, CI, tests, tooling, and docs
  that describe `main`. Verdict `blocked` for a PR that adds or extends a feature, control, setting, menu
  item, shortcut, theme, view or document type, restyles the UI, adds a capability through a dependency,
  or removes a feature, unless the PR body has a line starting `Owner approved during freeze:` that names
  that work. On a fix PR, anything beyond the fix (extra options, polish, refactors it does not need) is a
  required change: take it out.
  **Agent control is exempt (owner, 2026-11-23).** Features pass without that line when all of the PR's
  work is agent control: the `hmb` CLI and `hmb mcp`, the control socket and its protocol, events,
  briefs and their visual blocks (`chart`, `flow`, `svg`, callouts), the Agent control setting and the
  commands that hand things to an agent, `skills/hold-my-brief/` and `docs/agent-control.md`. A PR that
  also restyles or reorganises the rest of the UI is still under the freeze for that part.
- This repository is **public** (MIT, downloads published). Anything committed is published: no
  in-copyright documents or scans (tests build their own small documents; README media come from
  public-domain works via `scripts/reshoot-media.mjs`), no machine paths, keys or personal data.
  A new dependency needs its licence in `THIRD_PARTY.md`.
- CI's browser tests run in Chromium (Edge on Windows, Chrome or Playwright Chromium on macOS), **not**
  in WKWebView, which is what the macOS app runs in. Read for anything WebKit treats differently: CSS
  (`backdrop-filter`, `:has`, scroll snapping, `overflow: clip`), pointer, wheel and gesture events,
  `ResizeObserver` timing, clipboard, drag and drop of files.
- CI never launches the macOS app: it only builds the `.app` bundle (`test:native` runs on Windows only,
  where it drives the real WebView2 over CDP). A change to native startup, plugins, capabilities or the
  macOS file-open path is unproven on macOS. Windows path handling (case, either slash, `\\?\`, drive
  roots) and CRLF checkouts (no `.gitattributes`): a test that matches source text must normalise `\r\n`.
- The security model in `docs/development.md` is a product requirement: document scripts and automatic
  external requests stay blocked, EPUB frames stay sandboxed without scripts, Markdown raw HTML stays
  off, local images resolve only inside the document's own directory tree, external links need a click,
  no runtime CDN. `scripts/secure-foliate.mjs` must keep patching foliate on `npm ci` and every build.
  Treat any change near these as security-relevant.
- User data lives in the app-data folder for `xyz.rpayton.holdmybrief` (library database with SQLite
  sidecars, reading positions, settings). A change to stored formats must keep existing libraries,
  favourites and positions readable; dropping or resetting them is data loss.
- The optional AI assistant (`src/assistant*.ts`, `src-tauri/src/assistant.rs`) holds the user's API key
  and calls a paid provider. Keys must never be logged, sent anywhere but the provider, or committed;
  tests must not call the provider.
- `e2e/` shares Home and library card classes; selectors measuring the drawer must scope to
  `.library-documents`. Timing in e2e must wait on state (a rendered page, a settled zoom), not sleeps or
  larger timeouts: CI flakiness here stalls every merge.
- CI layout (`.github/workflows/ci.yml`): the loop merges when every check run on the head SHA is
  completed and green, so reject any `needs:` between jobs, any matrix computed by an earlier job, any
  aggregator job, and any `paths-ignore` that is not mirrored in `ciOptionalPaths` (`.github/loop.json`):
  a job that has no check run yet, or never runs, lets the loop merge early or wait forever. Jobs per OS:
  three `e2e (i/3)` shards, `checks`, `build`. Shards come from `scripts/e2e-shard.mjs` and the recorded
  seconds in `e2e/timings.json` (refreshed with `scripts/e2e-timings.mjs` from the shards' JSON report
  artifacts); each shard prints its spec list and the local command to reproduce it. E2E in CI stays at
  one worker per machine, and `playwright.config.ts` changes must be gated on `process.env.CI` so local
  runs (up to 3 loop workers per Mac, separate ports) keep their defaults. Rust caches are keyed per OS and
  per job. `release.yml` is a separate workflow.
