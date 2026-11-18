# Releasing Hold My Brief

Releases are built by [`.github/workflows/release.yml`](../.github/workflows/release.yml). It reuses the build steps that `ci.yml` checks on every push, builds without restoring caches, and uses no secrets beyond `GITHUB_TOKEN`. The builds are not code-signed. Every action in both workflows is pinned to a commit SHA and both use the same fixed Rust version; Dependabot proposes action updates monthly (`.github/dependabot.yml`), and the Rust version is changed by hand in `ci.yml` and `release.yml` together.

## What a release contains

| File | What it is |
| --- | --- |
| `Hold-My-Brief-<version>-windows-x64-setup.exe` | NSIS installer, current user only (no admin). Keeps existing file-type defaults via `src-tauri/windows/installer-hooks.nsh`. |
| `Hold-My-Brief-<version>-windows-x64-portable.zip` | `Hold My Brief/Hold My Brief.exe` plus `LICENSE`. The MSVC build links the WebView2 loader statically; WebView2 must already be installed. |
| `Hold-My-Brief-<version>-macos-arm64.dmg` | Apple silicon only (built on `macos-latest`). The `.app` is ad-hoc signed and not notarized. |
| `SHA256SUMS.txt` | `sha256sum` output for the three files above. It only proves a download is complete; the build attestation proves which workflow built it. |

Release notes come from [`.github/release-notes.md`](../.github/release-notes.md), which includes the first-launch steps for unsigned builds (Windows SmartScreen "More info, Run anyway"; macOS "Open Anyway" in Privacy & Security on macOS 15+, Control-click Open on earlier versions). `${VERSION}`, `${TAG}`, `${COMMIT}` and `${RUN_URL}` are filled in by `envsubst`.

The three files also get a build provenance attestation, written by the `package` job when a release is created (not on a dry run). Check a download with `gh attestation verify <file> --repo RVYNP/hold-my-brief` before the checksum and before any OS prompt. v0.1.0 predates attestations and has none; the release notes say so.

## Cutting a release

1. Set the same version in `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`, then run `cargo update -p hold-my-brief --manifest-path src-tauri/Cargo.toml` so `Cargo.lock` agrees (the build uses `--locked`).
2. Merge to `main` and wait for CI to pass. The release workflow does not rerun the tests.
3. Tag that commit and push the tag:

   ```sh
   git tag v0.1.0
   git push origin v0.1.0
   ```

4. The workflow checks that the tag is exactly `v<version>`, that all three files agree and that the tagged commit is on `main` (`git merge-base --is-ancestor`); otherwise it stops with an error naming the problem. It then builds on Windows and macOS, attests the three files and creates a **draft** release with the files and notes.
5. Review the draft on the Releases page, try both downloads, and publish it by hand.

Re-running the workflow for the same tag replaces the files on the draft. It refuses to touch a release that is already published.

## Dry run

Run the workflow from the Actions tab, or:

```sh
gh workflow run release.yml --ref <branch> -f dry_run=true
```

A dry run builds everything and keeps it as the `Hold-My-Brief-<version>-release` workflow artifact (files, `SHA256SUMS.txt`, `RELEASE_NOTES.md`) for 14 days. It creates no release and no attestation, and it skips the on-`main` check, so a branch can be dry-run. `dry_run=false` is only accepted when the ref is a `v*` tag, and that run must be on a commit that is on `main`.

GitHub only offers `workflow_dispatch` once the workflow is on the default branch. Until then, and whenever a pull request changes `release.yml` or `release-notes.md`, the pull request runs the same dry run automatically.
