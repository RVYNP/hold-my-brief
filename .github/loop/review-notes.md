- This repository is **public** (MIT, downloads published). Anything committed is published: no
  in-copyright documents or scans (tests build their own small documents; README media come from
  public-domain works via `scripts/reshoot-media.mjs`), no machine paths, keys or personal data.
  A new dependency needs its licence in `THIRD_PARTY.md`.
- CI's browser tests run in Chromium (Edge on Windows, Chrome or Playwright Chromium on macOS), **not**
  in WKWebView. The macOS app runs in WKWebView, and on macOS `test:native` only checks launch, liveness
  and clean quit. Read for anything WebKit treats differently: CSS (`backdrop-filter`, `:has`, scroll
  snapping, `overflow: clip`), pointer, wheel and gesture events, `ResizeObserver` timing, clipboard,
  drag and drop of files.
- Windows native smoke drives the real WebView2 over CDP; macOS has no equivalent, so native IPC changes
  are proven on Windows only. Windows path handling (case, either slash, `\\?\`, drive roots) and CRLF
  checkouts (no `.gitattributes`): a test that matches source text must normalise `\r\n`.
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
