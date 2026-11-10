# Set up Hold My Brief with an AI agent

If you use an AI coding assistant (Claude Code, Codex, Cursor, Copilot and similar tools), it can install
Hold My Brief for you. Copy this into your assistant:

```text
Install Hold My Brief on this computer by following the instructions in
https://github.com/RVYNP/hold-my-brief/blob/main/docs/agent-setup.md
Ask me before anything that needs administrator rights, and tell me what you did when you finish.
```

Everything below is written for the agent.

---

## Instructions for the agent

You are installing **Hold My Brief** (previously developed under the name Float Reader), a small
always-on-top desktop reader for PDF, EPUB, Markdown, text
and images, from `https://github.com/RVYNP/hold-my-brief`. Work through these steps in order and
stop to ask the user whenever a step says so.

### Ground rules

- Prefer the official release download. Build from source only if no release fits this computer or the
  user asks for it.
- Always verify downloads against `SHA256SUMS.txt` from the same release. If a checksum doesn't match,
  stop and tell the user. Do not run the file.
- Do not turn off system protections (SmartScreen, Gatekeeper, antivirus) globally. Only clear a
  download's own quarantine flag, only after its checksum matches, and only with the user's permission.
- Do not change the user's default apps. The Windows installer already adds Hold My Brief to
  **Open with** without taking over any file type.
- Do not open, upload or copy the user's documents. Hold My Brief needs no account and no network
  connection. Do not turn on its optional AI assistant or enter an API key for the user.
- Ask before installing system-wide prerequisites (Node.js, Rust, Visual Studio Build Tools, Xcode
  tools) or anything that needs administrator rights.

### 1. Check the computer

Find the operating system and CPU architecture:

- Windows: `[System.Environment]::OSVersion.Version` and `$env:PROCESSOR_ARCHITECTURE` in PowerShell.
- macOS: `sw_vers -productVersion` and `uname -m`.

| Computer | Path |
| --- | --- |
| Windows 10 or 11, x64 (`AMD64`) | Step 2, Windows |
| macOS on Apple silicon (`arm64`) | Step 2, macOS |
| macOS on Intel (`x86_64`), Windows on ARM | Step 3 (build from source); no prebuilt download yet |
| Linux | Not supported yet. Tell the user and stop. |

### 2. Install the release

Read the latest release:

```sh
curl -fsSL https://api.github.com/repos/RVYNP/hold-my-brief/releases/latest
```

Use `tag_name` and the `assets[].browser_download_url` values. Asset names follow this pattern:

| File | For |
| --- | --- |
| `Hold-My-Brief-<version>-windows-x64-setup.exe` | Windows installer, current user only, no administrator rights |
| `Hold-My-Brief-<version>-windows-x64-portable.zip` | Windows without installing |
| `Hold-My-Brief-<version>-macos-arm64.dmg` | Mac with Apple silicon |
| `SHA256SUMS.txt` | Checksums for the files above |

If the request returns 404 or no matching asset exists, there is no published release for this computer
yet. Go to step 3.

Download the matching file and `SHA256SUMS.txt` into a temporary folder, then compare checksums:

- Windows: `(Get-FileHash <file> -Algorithm SHA256).Hash.ToLower()`
- macOS: `shasum -a 256 <file>`

#### Windows

1. Ask the user whether they want the installer (recommended) or the portable version.
2. **Installer:** run it. For an unattended install, run `<setup>.exe /S`; it installs for the current
   user only. If WebView2 is missing (rare on Windows 11), the installer fetches it.
3. **Portable:** unzip to a folder the user chooses (for example `%LOCALAPPDATA%\Programs\Hold My Brief`).
   It needs the Microsoft Edge WebView2 Runtime, which Windows 11 already includes. On Windows 10, check
   that `HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}`
   or the same key under `HKCU\Software\Microsoft\EdgeUpdate\Clients` exists. If neither exists,
   suggest the installer instead.
4. Find the installed app: look under
   `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\*` for `DisplayName` "Hold My Brief" and use
   its `InstallLocation`. It also appears in the Start menu.
5. If the user opens it from a browser download and sees "Windows protected your PC", tell them to
   choose **More info**, then **Run anyway**. This happens because the app isn't code-signed yet.

#### macOS

1. Mount and copy:

   ```sh
   hdiutil attach "Hold-My-Brief-<version>-macos-arm64.dmg" -nobrowse -mountpoint /tmp/hold-my-brief
   cp -R "/tmp/hold-my-brief/Hold My Brief.app" /Applications/   # or ~/Applications without admin rights
   hdiutil detach /tmp/hold-my-brief
   ```

2. The app is not notarized, so macOS says *"Apple could not verify 'Hold My Brief' is free of
   malware…"* on first open. Tell the user this is Gatekeeper's standard message for apps outside
   Apple's paid notarization service, not a detection. They can approve it once:
   - macOS 15 or later: **System Settings › Privacy & Security**, scroll down, **Open Anyway**.
   - macOS 14 or earlier: Control-click the app, choose **Open**, then **Open** again.

   With the user's permission, and only after the checksum matched, you may instead run
   `xattr -dr com.apple.quarantine "/Applications/Hold My Brief.app"`.

### 3. Build from source (fallback)

Follow [docs/development.md](development.md); in short:

1. Prerequisites. Ask before installing any of them:
   - Node.js 20.19+ or 22.12+ with npm
   - Rust 1.90+
   - Windows: Visual Studio Build Tools (C++ workload) and WebView2
   - macOS: Xcode Command Line Tools (`xcode-select --install`)
2. Get the code and dependencies:

   ```sh
   git clone https://github.com/RVYNP/hold-my-brief.git
   cd hold-my-brief
   npm ci          # also applies the required foliate sandbox patch; do not skip it
   ```

3. Build:
   - Windows installer: `npm run package`; it lands in `src-tauri/target/release/bundle/nsis/`.
   - Windows portable: `./src-tauri/build-native.ps1`, which produces `dist/Hold My Brief.exe` plus
     `WebView2Loader.dll`. Keep the two files together.
   - macOS: `npm run package:macos`, which produces `dist/Hold My Brief.app`.
   - If the GNU Windows toolchain fails with a path containing spaces, set
     `CARGO_TARGET_DIR` to a folder without spaces first.
4. Optional check: `npm test` should pass.
5. Install the result as in step 2.

#### Updating an existing installation

Quit the app before replacing its bundle or executable. Back up the old app and its entire application-data
folder (the paths are listed in step 5), including the library database and any SQLite sidecar files.
Keep the backup outside the installation directory. Replace the app, not the data folder: existing
libraries, favorites, settings and reading positions should remain.

An app reinstall is not a data reset. Never delete a user's application-data folder to test first launch.
Use a separate account or an isolated test build as described in [development](development.md#clean-install-smoke-check).

### 4. Confirm it works

Launch Hold My Brief without a file: Start menu on Windows, `open -a "Hold My Brief"` on macOS. A fresh
install shows "Hand it over." A machine that already has a library opens on Home (recent, favorite and library covers)
instead. Don't open one of the user's documents as a test, because opening
a file adds it to the app's recent list and library.

### 5. Tell the user

Report:

- The version installed and where it's installed.
- How to open it, and that **Pin** keeps it on top and **Lock** fixes its size.
- The one-time approval step for unsigned apps, if it applies.
- Where its data lives: `%LOCALAPPDATA%\xyz.rpayton.holdmybrief` on Windows,
  `~/Library/Application Support/xyz.rpayton.holdmybrief` on macOS. It holds reading positions,
  settings and the library list, never copies of documents. (Before the rename from Float Reader the
  folder was `io.github.rvynp.floatreader`; that data is not migrated. The app starts fresh, and
  the old folder can be deleted by hand.)
- How to uninstall:
  - Windows: **Settings › Apps › Installed apps › Hold My Brief › Uninstall**; for the portable
    version, delete its folder.
  - macOS: drag the app from Applications to the Trash.
  - On either system, delete the data folder above too if they want no trace left.

The [user guide](user-guide.md) covers every feature if the user has questions.
