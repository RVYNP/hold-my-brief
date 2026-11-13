# Developing Hold My Brief

Build, test and packaging notes. For what the app does, see the [README](../README.md) and the
[user guide](user-guide.md).

Rust/Tauri owns local file access, window controls, document identity and saved state. The small
web interface uses PDF.js, foliate-js and markdown-it. This is an implementation candidate, **not a
release that has passed all P0 requirements**; see
[implementation and validation status](floating-reader-implementation.md).

Source, lockfiles, tests, [research](floating-reader-research-2026-10-22.md) and
[requirements](floating-reader-prd.md) are self-contained in this repository. Generated executables,
dependencies, document files and personal reading/library data are not committed.

## Requirements

- Node.js 20.19+ or 22.12+ and npm (required by Vite)
- Rust 1.90+ with a native toolchain: Visual Studio Build Tools on Windows, Xcode Command Line
  Tools on macOS
- Windows only: WebView2 (preinstalled on Windows 11)

## Run

```bash
npm ci                 # installs dependencies and applies the foliate sandbox patch
npm run desktop        # native app with hot reload
npm run dev            # browser preview at http://127.0.0.1:1420
```

`npm run dev` runs the browser preview. It supports local file selection, browser-local resume, and
a library backed by IndexedDB copies of selected files. Pinning, size lock, native recent files, and
authorized relative images require the desktop app.

The reader is a single static module entry (`index.html`). Keeping reader startup synchronous avoids a
gap where the page has loaded but keyboard shortcuts are not registered.

## Build a distributable

**macOS**

```bash
npm run package:macos            # -> dist/Hold My Brief.app (and a .dmg when available)
```

Produces an arm64 `.app` with a generated icon and an ad-hoc signature. It is not notarized, so
first launch requires right-click → **Open** (or `xattr -dr com.apple.quarantine`).

**Windows**

```powershell
./src-tauri/build-native.ps1     # -> dist/Hold My Brief.exe + WebView2Loader.dll
npm run package                  # NSIS installer (targets pinned by tauri.windows.conf.json)
```

Keep `WebView2Loader.dll` beside the `.exe`. The executable embeds the reader interface and needs
no development server.

Each platform narrows its own bundle targets, so neither inherits the other's installers:
`tauri.windows.conf.json` pins `["nsis"]` and `tauri.macos.conf.json` pins `["app", "dmg"]`. The
base `tauri.conf.json` stays neutral with `"all"`.

`npm ci` and every production build run the checked-in foliate sandbox patch and copy PDF
fonts/CMaps/WASM locally. Do not skip this step. No runtime CDN is used.

On the GNU Windows toolchain, `windres` can fail when its build output path contains spaces. Set a
task-specific target directory first:

```powershell
$env:CARGO_TARGET_DIR = Join-Path $env:TEMP 'hold-my-brief-target'
```

## Release

Tagged releases are built by `.github/workflows/release.yml`, which creates a draft GitHub Release
with the Windows installer, a portable zip, the macOS `.dmg` and checksums. See
[releasing](releasing.md).

## Test

```bash
npm test                                          # frontend unit tests
npm run test:e2e                                  # Playwright browser scenarios
cargo test --manifest-path src-tauri/Cargo.toml   # native tests (one is Unix-only)
npm run test:layout                               # text anchor layout check
npm run test:native                               # smoke test of the built app
npm run perf                                      # performance report
```

Browser tests pick a browser automatically: `CHROME_PATH`, then a branded Chrome/Edge/Chromium, then
a cached Playwright Chromium. Nothing is downloaded at test time. Tests construct their own small
documents; they do not use production files.

`test:native` differs by platform. On Windows it drives the real WebView2 over CDP and asserts the
full IPC surface. On macOS, WKWebView exposes no CDP endpoint, so it verifies launch, liveness and
clean quit, and skips the transport assertions with an explicit reason. Quit any running instance
first: `tauri-plugin-single-instance` makes a second launch hand off and exit immediately, which
cannot be distinguished from a failure. Run it from a non-elevated shell: WebView2 Runtime 150+
ignores the debugging switch for elevated processes, so the port never opens (CI, whose runners are
elevated, sets the equivalent HKLM WebView2 policy instead).

CI ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)) runs the same suite on
`windows-latest` and `macos-latest`, builds the release binary, runs the native smoke test and builds
the NSIS installer on Windows, and bundles the `.app` on macOS.

### Clean-install smoke check

For a source-build check without touching an existing library on macOS, quit other test instances and
build a separate app identity:

```bash
npx tauri build --bundles app --config '{"identifier":"xyz.rpayton.holdmybrief.installcheck"}'
codesign --force --deep --sign - "src-tauri/target/release/bundle/macos/Hold My Brief.app"
codesign --verify --deep --strict "src-tauri/target/release/bundle/macos/Hold My Brief.app"
```

Launch the resulting bundle by its explicit path, not `open -a`, which may select another installed copy.
With no saved data it must show **Hand it over.** Add only disposable documents, reopen without a file,
and verify Home (Jump back in, the shelves, recent removal) and Favorites. Close the library and check that its
rail shows the recent covers, and that **Show all** on each Home shelf opens the library at the scope you chose.
Edits there must refresh Home. Quit and remove only the disposable profile when finished.

This checks empty app data and the native bundle, not Gatekeeper approval under a new macOS account.
For an installed-app update, back up the existing app and complete data folder before replacement;
verify the real library remains intact afterward. Never use the real data folder as a clean-install fixture.

Home and the library intentionally share card classes. Browser scenarios measuring the drawer must
scope their tile selectors to `.library-documents`, rather than counting Home's tiles too.

> **Windows build status.** After the macOS port, the Windows build was rebuilt and re-tested on
> Windows 11 x64 with WebView2: `build-native.ps1` (GNU toolchain) produces the portable executable,
> `npm run package` produces the NSIS installer, and `npm run test:native` passes against the real
> WebView2 app. Measured on that build, the unlocked minimum is 360×420 outer logical pixels and a
> locked window's minimum equals its maximum equals the captured outer size.

## README media

Every image in `docs/media/` is light mode, Brief theme, and comes from a script. Start the browser
preview (`npm run dev`, port 1420), then pass a public-domain PDF and a public-domain EPUB book, and
optionally some public-domain images to fill the library drawer's grid. Pick a PDF with a text layer:
pages without one are image-only. They draw nothing over the page, but the toolbar subtitle's
tooltip says so and a select-drag on one shows a notice, which would land in shots.

```bash
node scripts/reshoot-media.mjs halftoneprocessp00verf_0.pdf "Pride and Prejudice.epub" great-wave.jpg haeckel-medusae.jpg
```

It writes every still the README uses: `hero.png`, `hand-tool.png`, `library.png`, `shelf.png`,
`intake.png`, `appearance.png`, `themes.png` and `desktop.png`. The hero and the theme sheet are composed in the
script: real window captures set in one row on white with 14 px gutters and square corners. The theme
sheet reads the public-domain opening of *Pride and Prejudice*. The shelf still (`shelf.png`) is the
library board at 1440 × 900 with a parent collection and three sub-collection shelves: the script writes
small Markdown files named after public-domain works (*Moby-Dick*, *Middlemarch*, *Leaves of Grass*,
*The Origin of Species* and others, each with its opening line) into a temporary folder, so they get
generated covers, and adds your EPUB (a real cover) and PDF (its first page) to the shelves; the
temporary folder is removed afterwards. The intake still (`intake.png`) is the sheet that opens when
the first shelf's files arrive, shot before Keep all. The desktop scene (`desktop.png`) pins the reader over a
cluttered desktop whose editor and browser windows show this repository's own `src/style.css` and
user guide. Geist, Geist Serif and JetBrains Mono are bundled, so captures use the interface's real
faces without installing anything.
On macOS the scripts use the pinned Chrome for Testing build; elsewhere they fall back to
Playwright's Chromium (`npx playwright install chromium`).

The animated library demo (`library-resize.gif`) comes from
`node scripts/record-library-demo.mjs halftoneprocessp00verf_0.pdf`. It drives the real interface
with a drawn cursor, steps every CSS animation one frame at a time so each run is identical, and
encodes with ffmpeg's two-pass palette (Homebrew's build; set `FFMPEG` to use another).

Never commit in-copyright scans; the README's Credits section names the documents in use.

## Security model

Source files remain unchanged. Document scripts and automatic external-resource requests are
blocked. EPUB frames are sandboxed without script permission. Markdown raw HTML is disabled; local
images resolve only inside the selected document's directory tree. External HTTP(S) links require a
click. Unsupported image paths receive placeholders.

## Current boundaries

See [implementation and validation status](floating-reader-implementation.md) for tested behavior
and remaining release gates, and the
[macOS and performance audit](floating-reader-macos-and-performance-audit.md) for what the port
changed and what it did not fix.

In particular, this is not yet a measured lightweight release. Whole-file binary IPC, text DOM size,
the full EPUB fidelity corpus, Narrator, monitor changes, Windows snapping, clean-account
installation and several performance budgets still need work or evidence.

Generated assets, fixtures, browser results, executable files, generated icons and Cargo output are
ignored. Dependency versions are pinned in `package-lock.json` and `src-tauri/Cargo.lock`.
