# Third-party components

Versions below are the installed direct frontend dependencies for this candidate. Full resolved versions are in package-lock.json; Rust resolution is in src-tauri/Cargo.lock. This is a component inventory, not a replacement for distributing each component's required license and notices.

| Component | Version | Declared license | Use |
| --- | --- | --- | --- |
| @tauri-apps/api | 2.12.4 | Apache-2.0 OR MIT | Desktop bridge |
| PDF.js / pdfjs-dist | 6.4.299 | Apache-2.0 | PDF rendering, text layer, fonts/CMaps/WASM |
| foliate-js | 1.0.1 | MIT | EPUB layout and CFI navigation |
| @zip.js/zip.js | 2.24.0 | BSD-3-Clause | Bounded archive resource reads |
| markdown-it | 15.0.3 | MIT | Markdown parsing with raw HTML disabled |
| Geist, Geist Serif (vercel/geist-font) | 1.9.0 | OFL-1.1 | Bundled interface and reading typefaces (`src/fonts/`, licence in `src/fonts/OFL-Geist.txt`) |

The foliate source is patched reproducibly by scripts/secure-foliate.mjs to remove allow-scripts from publication frames. That script fails if the expected sandbox code changes. Renderer upgrades require repeating the security and fidelity tests. Readest application source is not reused.

Before external distribution, collect the complete transitive Rust/JavaScript notices, including PDF auxiliary font/CMap/WASM notices, into the installer and verify them against the locked build. Installer distribution is a pending release gate.
