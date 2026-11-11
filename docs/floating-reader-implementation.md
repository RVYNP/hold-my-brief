# Hold My Brief implementation and validation

October 22, 2026; updated for macOS, performance, Home and clean-profile installation checks. Governing
specification: [floating-reader-prd.md](floating-reader-prd.md).

This standalone repository contains the Rust/Tauri [Hold My Brief implementation candidate](../README.md).
It is independently authored and uses the proposed rendering libraries. **M0 has not exited and this
is not a P0-complete release.** The released Readest/SumatraPDF comparison has not been performed.
The engine decision remains provisional.

The app now builds and runs on both Windows and macOS. Performance has been measured on macOS (see
[floating-reader-performance.md](floating-reader-performance.md)); the PRD resource budgets are still
not claimed as achieved, because idle CPU, cold launch and stress corpora remain unmeasured.

## Implemented candidate

- Compact document-first interface, accessible named controls, visible focus, menu and shortcut reference; 420 × 620 and 760 × 900 outer-window presets.
- Native Open dialog, authorized native drops/CLI/second-instance requests, up to 20 recents, per-user local saved state, fingerprint identity and revision warnings. Source documents are read-only.
- Native pin and size-lock commands with client/outer-size conversion, constraints, maximize disabling, OS resize correction and work-area recovery. Lock and pin are independent.
- PDF.js single-page rendering with selectable text, page geometry, page labels, internal links, zoom, fit modes, rotation, password callback, bounded active surfaces and stale-result rejection. The page paints as soon as it has pixels, with the text layer and links layered on afterwards; a bounded page-bitmap cache with idle neighbour prefetch makes repeat page turns a blit rather than a re-render.
- foliate-js EPUB spine rendering, reflow/fixed-layout modes, TOC, internal links/Back, CFI anchors and content-weighted approximate position. Script execution is removed from the renderer's frame sandbox before bundling. Content is sanitized before frame load and receives its own restrictive resource policy.
- Markdown tables, task display, strikeout, fenced code and outline. Raw HTML is disabled. Relative images are authorized by the native backend; network/out-of-scope images become placeholders.
- Strict UTF-8 and BOM-marked UTF-16 decoding, text wrapping, source-line jumps, typography and semantic text anchors.
- Format-specific position footer, bounded Back stack, save debounce/continuous-save interval, atomic native state replacement, unreadable-state backup and explicit save failure UI.
- Floating view controls for PDF, image and fixed-layout EPUB (zoom −/level/+, fit-page/fit-width toggle, Hand tool, Single page / Two pages) sharing state with the zoom/fit/spread shortcuts. Hand tool (H, aria-pressed) and middle-button drag work at every zoom: when the content is larger than the panel they pan the scroll container 1:1, and when the page or spread fits (Fit, or below 100%) they slide the page itself 1:1 around the panel, keeping at least 64 px of it inside on each axis. The slide is a CSS `translate` that `Panner` (`src/pan.ts`) sets through `--pan-x`/`--pan-y` on the reader host; it moves pixels at paint time, so the host never changes size, nothing refits or re-renders, and the host stops scrolling (`page-moved`) while the page is slid. The offset survives page turns and is cleared by zoom/fit commands, a single↔two-page change, content that really grows past the panel, and a new document; a window resize re-clamps it. Link clicks are preserved, including inside sandboxed fixed-layout EPUB frames; zoomed fixed-layout pages no longer lose their left/top edge to unreachable flex overflow.
- Two-page spread for PDF and fixed-layout EPUB (Ctrl+3, menu, pill; persisted per document, single page by default): edge-to-edge pages with an inner gutter shade, cover-alone pairing by default with a "Cover page alone" opt-out, publisher page sides and right-to-left progression for EPUB, a common height for mixed page sizes, and fit page/width applied to the whole spread. Turns, Go to, Back, labels ("Pages 2–3 of 27") and the scrubber move by spread; the saved place is the first visible page. PDF spreads keep the bitmap cache and prefetch whole neighbouring spreads. Reflowable EPUB uses Foliate's two-column paginator. Panels narrower than 600 px (or portrait, for reflowable EPUB) show single pages, announce that two-page view is waiting, and switch back automatically.
- Resizable, dockable library sidebar: pointer-captured divider drag with rAF-coalesced layout and reader hosts held at their width until release (one refit per drag), keyboard separator semantics, double-click reset, left/right docking mirrored in the toolbar icon, and persisted width/side re-clamped to the window.
- Home reuses the library's responsive masonry, generated covers and stacked titles. Recently opened, Favorites and Library sections omit empty groups, use EPUB metadata titles, and support file-type filtering. View all targets the docked or detached library; removing a recent retains its library entry.
- The library can undock into a separate window. Narrow detached windows keep their controls within their own width, and library edits refresh Home.

## October 23 PDF resize-loop correction

- Report: a screen recording showed page 4 of a long (200+ page) PDF repeatedly refitting while the scrollbar and loading notice alternated.
- Cause: the sticky loading notice participated in document flow. On the real PDF, adding it increased scroll height from 656 to 691 CSS pixels, creating overflow and feeding the resize observer.
- Fix: loading and retry notices are positioned outside page flow, anchored inside the current visible scroll region. PDF rendering, page navigation and resize handling remain enabled.
- Verification: the same PDF's loading geometry now stays at 656 pixels and its canvas remains unchanged while idle. Both PDF browser regressions pass, including fit-page and scrolled fit-width geometry, visible loading notices, idle stability, mixed-page navigation and internal-link history.


## Validation evidence

Automated tests are intentionally narrower than the PRD acceptance corpus. Passing them does not establish all supported-publication fidelity or a performance claim.

| Check | Evidence |
| --- | --- |
| Frontend type check and bundled production build | Pass; local PDF auxiliary resources copied during build |
| Markdown/TXT unit tests | 41 passing: strict decoding, path/link filtering, raw HTML, tables/tasks, outline, jumps, history and disposal |
| EPUB security unit tests | 12 passing: resource filtering, active-content removal, fixed viewport preservation and unsupported-media placeholders |
| Library model unit tests | 5 passing: collection/document mutation rules; 3 more cover sidebar width clamping (520 px, 55% of the window, 320 px reading panel) and saved-width fallback |
| Native Rust checks | Compilation and 23 tests pass: unreadable-state backup, last-good atomic write, recents retention, file bounds, image confinement, catalog migration/rollback, folder indexing, and the macOS outer/client window-size conversion |
| Browser shell tests | Text source-line jump/resume after reload, invalid replacement preservation, invalid Go to, safe Markdown, outline and minimum-size controls pass |
| Real-browser anchor checks (`npm run test:layout`) | 9 passing: TXT source line 333 stays anchored through font/margin changes, resize, a scroll event delivered after a resize (deterministic form of the old drift) and reopen; Markdown heading anchor survives typography and minimum-size resize |
| PDF/EPUB browser fixture checks (`npm run test:e2e`) | 7 passing: mixed-page PDF, PDF bitmap cache across 0°/180° rotation, reflowable EPUB and fixed EPUB, including script/network probes and EPUB font/resize/reopen. Synthetic fixture SHA-256 manifests are attached to test results. |
| Standalone Windows build | Optimized custom-protocol executable plus WebView2Loader.dll built successfully. Real WebView2 smoke test passes: embedded UI, command-line file opening, native IPC, pin/lock toggles, source-line jump, save and clean close. Unsigned. |
| Windows path after the macOS port | **Rebuilt and re-tested on Windows 11 x64 / WebView2.** `build-native.ps1` builds the GNU portable executable and `npm run package` the NSIS installer; `npm run test:native` passes against the real app (embedded UI, CLI open, IPC, pin, lock, source-line jump, save, raw-byte transport, clean close). The port had changed two Windows behaviours, both restored to the PRD: the unlocked minimum had grown by the window frame (now measured at 360×420 outer via `WM_GETMINMAXINFO`), and locked windows were no longer shrunk to a smaller work area (WIN-07). CI now runs the native smoke test and builds the NSIS installer on `windows-latest`. |
| Standalone macOS build | arm64 `.app` (~9.5 MB) built via `npm run package:macos` with a generated `.icns` and an ad-hoc signature; `plutil -lint` and `codesign --verify --strict` pass. Launches with a file argument, stays alive, logs no panic and no crash report, exits cleanly on SIGTERM. Unsigned and not notarized. |
| macOS clean-profile workflow | Ad-hoc-signed release bundle launched with an isolated app identity and no existing data: first-launch screen, native file-picker intake, generated covers, document opening, relaunch to Home with stacked titles, and a 280 px detached library checked visually. Disposable Markdown files retained their format. This is not a clean-OS-account or Gatekeeper approval test. |
| Native OS behavior and assistive technology | Basic native commands smoke-tested; actual stacking above other apps, every snap/resize route, multi-monitor and Narrator acceptance remain unverified |

The browser rules that make the suite platform-neutral (browser discovery, native binary paths, the
CDP/automation capability split) live in `tests/browser/platform.mjs`. Windows CDP assertions run
only on Windows; macOS smoke tests verify launch, liveness and clean quit and state the skip reason.

Tests create small synthetic fixtures from checked-in source. There is no proprietary/user document corpus in Git. The standard and stress fixture manifest below must be populated and checksum-frozen before benchmarks.

## Release gates and known gaps

1. **M0 comparison and measurements:** hands-on released Readest/SumatraPDF comparison; standard/stress fixtures; launch/open/navigation/CPU/process-tree memory/GPU/package measurements. No performance target has been waived or claimed achieved.
2. **Large documents:** the native candidate reads and hashes the whole file; document bytes now travel as raw octet-stream IPC (no JSON number array), but a full copy still crosses the WebView2 boundary per open and the read occupies a background task without chunked transport. TXT currently creates a DOM block per line; EPUB position indexing traverses the spine. Replace/measure these before accepting PERF-02/05/06 on stress files. Native reads are bounded at 300 MiB, image reads at 20 MiB, EPUB resources at 64 MiB and declared total archive content at 512 MiB. Those are candidate guardrails, not PRD release limits.
3. **Cancellation:** the UI cancels/discards a replacement and preserves the active document, but a native file read/hash already underway continues in its background task. Add cancellable/ranged transport before claiming the full slow-read contract.
4. **Windows:** measure lock tolerance for every drag/snap/maximize/restore route, pin without focus theft, monitor removal, work-area shrinking and logical dimensions at 100/150/200% scaling. Native code implements these paths; runtime acceptance remains open.
5. **Format corpus:** verify encrypted/scanned/large PDF, embedded fonts/images, EPUB 2/3, RTL, footnotes, fixed-layout books and malformed archives against expected visible content. PDF form/XFA interactions and multimedia are not supported by this candidate. EPUB fixed-layout 90° rotation is not implemented. EPUB font obfuscation/encryption cases need corpus validation. Markdown source-line mapping inside complex blocks is approximate.
6. **Progress/data:** repeat 20 anchors per reflowable format across all prescribed changes, forced termination and denied storage. Per-document typography exists; global typography defaults for new documents remain to be added. Browser preview storage is a test convenience, not the desktop durability implementation.
7. **Accessibility:** keyboard smoke checks pass; Narrator reading order and control states, high-DPI contrast/fit and text-layer semantics require Windows testing.
8. **Opening/history:** missing recents explain how to use Open and support Remove; a dedicated Locate action is still needed. Test simultaneous/rapid open routes and failed replacements with production fixtures.
9. **Packaging:** test the Windows installer on a clean account and verify the WebView2 prerequisite flow, offline reopening, signing/distribution policy and complete transitive license notices. Open With registration no longer takes defaults: Tauri's NSIS association made Hold My Brief the per-user default for `.pdf/.epub/.md/.markdown/.txt` wherever Explorer had no explicit user choice, so `src-tauri/windows/installer-hooks.nsh` puts the previous default back after install and offers the app through `OpenWithProgids`. A silent current-user install → native smoke test → uninstall round-trip on Windows 11 left the defaults unchanged, passed the smoke test against the installed binary (which ships `WebView2Loader.dll`), and restored the association registry. The GNU linker emits a duplicate-resource-manifest warning: the executable carries two `RT_MANIFEST` id 1 entries, Tauri's Common-Controls v6 manifest first and the MinGW default (`asInvoker`, `longPathAware`) second. It launches and passes the native smoke test, but manifest/DPI behavior needs review before distribution. Keep WebView2Loader.dll beside the unsigned portable executable.
10. **macOS:** native window contents, Home and empty-data intake have been checked using an isolated app identity. Full DPI behavior, pin/always-on-top stacking, menu-bar integration, VoiceOver reading order and the `.dmg` remain unverified. Local builds are ad-hoc signed, not notarized; Gatekeeper approval under a fresh macOS account remains untested. See the [macOS and performance audit](floating-reader-macos-and-performance-audit.md) for the earlier assessment.
11. **Image-only PDF pages:** pages without a text layer (scans without OCR) render as images only. Their text can't be selected or found, and this build has no OCR. No text is ever drawn over a page. While a page on screen has no text layer, `Position.imageOnly` is true (reported again once the page's text has been read) and the `#filekind` tooltip adds "Image-only page: text can't be selected or searched". The first primary-button select-drag past the pan slop on such a page, hand tool off, shows a dismissible notice once per opened document; clicks, hand-tool and middle-button drags, and text pages never do. Find answers "No text layer in this document" on its own. Fixed in [#16](https://github.com/RVYNP/hold-my-brief/issues/16).
12. **Resolved — Windows regression check after the macOS port:** see the evidence row above.
13. **Resolved — reading anchor on resize:** every restore writes `scrollTop`, so its scroll event can arrive after the host has resized but before the `ResizeObserver` callback. The scroll handler then re-captured the anchor from the reflowed layout (source line 333 → 665), and the observer restored that wrong anchor. The handler now compares the host size the anchor was captured at and re-anchors instead of capturing when it changed. Measured on Windows: `npm run test:layout` went from 1 of 15 passing runs to 20 of 20.

## Reproducible acceptance work

Run the commands in the [development guide](development.md). Record observations without interpreting unmeasured values as passes. The next engineering work should address chunked/ranged byte transport and large-text rendering while building the corpus, followed by native window/accessibility acceptance. P1 features are deliberately not added to expand the scope.

| Fixture ID | Required class | State |
| --- | --- | --- |
| standard-pdf | ~100 pages, ≤10 MiB, text PDF | Awaiting redistributable/user-owned corpus selection |
| standard-epub | ≤5 MiB DRM-free reflow EPUB | Awaiting corpus selection |
| standard-md | ≤1 MiB tables/code/images | Awaiting corpus selection |
| standard-txt | ≤5 MiB Unicode text | Awaiting corpus selection |
| stress-scan | ~250 MiB scanned PDF | Awaiting corpus selection |
| stress-magazine | Image-heavy magazine PDF | Awaiting corpus selection |
| stress-pages | 1,000-page text PDF | Awaiting corpus selection |
| stress-txt | 50 MiB TXT | Awaiting corpus selection |
| stress-epub | Large illustrated EPUB | Awaiting corpus selection |

For every frozen fixture, record SHA-256, byte size, physical page/spine counts, expected visible features, license/source and expected anchor locations. For every run, record CPU/RAM/OS/WebView2/renderer versions, display/scaling, power mode, window size and hydration state. The PRD's full acceptance matrix remains authoritative.
