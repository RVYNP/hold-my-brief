You run on the Mac Studio (macOS, Apple Silicon). Some work orders were written for the Windows
workstation (`C:\Users\ruby\…`); read those paths as your worktree.

- **Ruby's installed Hold My Brief runs on this Mac.** Never `open -a "Hold My Brief"`, never run
  `npm run desktop`, `tauri dev`, `npm run test:native` or a built app with the default identifier
  `xyz.rpayton.holdmybrief`: the single-instance plugin hands the launch to Ruby's running app, and its
  data folder is real. Never quit or kill that app, and never read or write
  `~/Library/Application Support/xyz.rpayton.holdmybrief*`. Native checks are CI's job: list them under
  **Not run**.
- Setup, once per worktree: `export TMPDIR=$(realpath "$TMPDIR")`, then `npm ci` (it applies the
  required foliate sandbox patch; never skip it).
- Checks, each with its counts in the PR body:
  - `npm test` (unit), `npx tsc --noEmit` (types);
  - `npm run test:e2e` (Playwright starts its own Vite server on port 1421). Before it, make sure nothing
    listens there: `lsof -nP -iTCP:1421 -sTCP:LISTEN` prints nothing. If something does, do not kill it;
    run the other checks and list e2e under **Not run**. Run only the specs your change touches with
    `npx playwright test e2e/<file>.spec.ts`, then the full suite once at the end;
  - Rust: `export CARGO_BUILD_JOBS=4`, then `cargo test --manifest-path src-tauri/Cargo.toml --locked`
    (the target directory stays inside your worktree).
- Windows-only behaviour (WebView2 native smoke, NSIS installer) is not available to you: do the rest
  and list it under **Not run**; CI covers it.
- This repository is public. Tests build their own documents; never add, open or copy files from
  outside your worktree, and never commit in-copyright documents, screenshots of personal files,
  machine paths or keys. Never enter an API key for, or call, the AI assistant's provider.
- Docs images (`docs/media/`) only come from the scripts in `docs/development.md`; do not hand-edit them.
- Stop every server or browser you started, by PID; never `pkill` by name.
