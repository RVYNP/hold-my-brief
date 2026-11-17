You run on macOS (Apple Silicon). Some work orders name paths on another machine (Windows); read
those paths as your worktree. This repository is public: never post absolute paths from this machine.

- **The owner's installed Hold My Brief runs on this Mac.** Never `open -a "Hold My Brief"`, never run
  `npm run desktop`, `tauri dev`, `npm run test:native` or a built app with the default identifier
  `xyz.rpayton.holdmybrief`: the single-instance plugin hands the launch to the owner's running app, and
  its data folder is real. Never quit or kill that app, and never read or write
  `~/Library/Application Support/xyz.rpayton.holdmybrief*`. Native checks are CI's job: list them under
  **Not run**.
- Setup, once per worktree: `export TMPDIR=$(realpath "$TMPDIR")`, then `npm ci` (it applies the
  required foliate sandbox patch; never skip it).
- Checks, each with its counts in the PR body:
  - `npm test` (unit), `npx tsc --noEmit` (types);
  - `npm run test:e2e`: run e2e with `E2E_PORT=$((20000 + <PR number>))`; Playwright starts its own server on that
    port. Run only the specs your change touches with `npx playwright test e2e/<file>.spec.ts`, then the full suite
    once at the end;
  - Rust: `export CARGO_BUILD_JOBS=4`, then `cargo test --manifest-path src-tauri/Cargo.toml --locked`
    (the target directory stays inside your worktree).
- Windows-only behaviour (WebView2 native smoke, NSIS installer) is not available to you: do the rest
  and list it under **Not run**; CI covers it.
- This repository is public. Tests build their own documents; never add, open or copy files from
  outside your worktree, and never commit in-copyright documents, screenshots of personal files,
  machine paths or keys. Never enter an API key for, or call, the AI assistant's provider.
- Docs images (`docs/media/`) only come from the scripts in `docs/development.md`; do not hand-edit them.
- Stop every server or browser you started, by PID; never `pkill` by name.

## CI layout and e2e shards

`.github/workflows/ci.yml` runs 10 jobs (5 per OS), all starting with the workflow. For each of Windows and macOS:
`<OS> · e2e (1/3)`, `(2/3)`, `(3/3)`; `<OS> · checks` (unit tests, text layout check, Rust tests); `<OS> · build`
(`tauri build`: the frontend build and the one release compile, then Windows' native smoke and NSIS installer,
or macOS' `.app`). The loop merges when every check run on the head SHA is green, so:

- No job may `needs:` another and no matrix may be computed by an earlier job: a waiting job has no check run
  yet, and the loop would merge before it ran. No aggregator job either.
- No `paths-ignore` in `ci.yml` unless the same globs go into `ciOptionalPaths` in `.github/loop.json`.
- Shards run with `--workers=1`; more workers on one runner made `zoom.spec.ts` flaky. Changes to
  `playwright.config.ts` stay behind `process.env.CI`: local runs (workers, `fullyParallel`, retries,
  timeouts) must not change.
- Each Rust cache (`Swatinem/rust-cache`) is keyed per OS and per job; keep the keys distinct.

Shards: `node scripts/e2e-shard.mjs <index> <total>` prints that shard's spec files, one per line. It lists
`e2e/*.spec.ts`, reads the seconds per file from `e2e/timings.json`, assigns files longest first to the
least-loaded shard, and counts a file missing from the timings as the median. A new spec needs no entry
(it counts as the median until the timings are refreshed). Every shard job prints its spec list and the exact
local command before it runs; `gh run view --log-failed` shows it.

Rerun one shard locally, on your own port:

```
E2E_PORT=$((20000 + <PR number>)) npx playwright test $(node scripts/e2e-shard.mjs 2 3)
```

Refresh the timings when specs are added, removed or change a lot (not on every PR): download the three
`e2e-report-<OS>-<n>` artifacts of one green run of one OS (retained 7 days; `gh run download <run-id> -n
e2e-report-macOS-1 -D reports/1`, and likewise for 2 and 3), then
`node scripts/e2e-timings.mjs reports/1/e2e-report.json reports/2/e2e-report.json reports/3/e2e-report.json`
rewrites `e2e/timings.json`. Commit it with the change; do not commit `reports/`.

Refresh `e2e/timings.json` whenever a spec file is added or a shard runs over 8 min.

- CI's e2e runs against `vite preview` of a production build (`npm run build` first, see `playwright.config.ts`); local runs use the dev server. To reproduce CI's server locally: `npm run build && CI=1 E2E_PORT=… npx playwright test …` (`CI=1` without a fresh `npm run build` serves a stale `dist/`).
