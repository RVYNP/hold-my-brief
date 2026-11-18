Hold My Brief ${VERSION}. A reader that holds.

> **Renamed:** Hold My Brief is the new name of the app previously called **Float Reader**. This build installs alongside any Float Reader install (it does not upgrade it in place) and uses a new application-data folder (`xyz.rpayton.holdmybrief`); reading positions and the library saved by Float Reader under `io.github.rvynp.floatreader` are not migrated. Re-open your documents to start fresh.

## Download

| Your computer | File |
| --- | --- |
| Windows 10 or 11 (installer) | `Hold-My-Brief-${VERSION}-windows-x64-setup.exe` |
| Windows 10 or 11 (no install) | `Hold-My-Brief-${VERSION}-windows-x64-portable.zip` |
| Mac with Apple silicon (M1 or later) | `Hold-My-Brief-${VERSION}-macos-arm64.dmg` |

There is no build for Intel Macs yet.

## Checking your download

Check a download before you open it, in this order.

1. **Which workflow built it.** With the [GitHub CLI](https://cli.github.com), run `gh attestation verify <file> --repo RVYNP/hold-my-brief`, for example on `Hold-My-Brief-${VERSION}-macos-arm64.dmg`. It should report that verification succeeded, with this repository's release workflow as the builder. v0.1.0 was published before attestations existed and has none.
2. **That it is complete.** `SHA256SUMS.txt` lists a SHA-256 checksum for each file. To check one:
   - Windows (PowerShell): `Get-FileHash .\Hold-My-Brief-${VERSION}-windows-x64-setup.exe`
   - Mac (Terminal): `shasum -a 256 Hold-My-Brief-${VERSION}-macos-arm64.dmg`

   The result should match the line for that file.

The checksum only proves the download is complete; the attestation proves which workflow built it. Do both before the steps below.

## Opening it the first time

These builds aren't signed with a paid Apple or Microsoft developer certificate yet, so your computer will ask you to confirm once. Check the download first (above), then:

**Windows.** Windows may show a blue "Windows protected your PC" screen because the app isn't signed yet. Choose **More info**, then **Run anyway**. The installer sets Hold My Brief up for your account only and doesn't need admin rights. It uses Microsoft Edge WebView2, which Windows 10 and 11 already include; if it's missing, the installer downloads it. The portable zip needs WebView2 already installed.

**Mac.** Open the `.dmg` and drag Hold My Brief to Applications. The first time you open it, macOS says *"Apple could not verify 'Hold My Brief' is free of malware that may harm your Mac or compromise your privacy."* That's the standard message for any app that hasn't been through Apple's paid notarization service. It doesn't mean anything was found.

- On macOS 15 (Sequoia) or later: click **Done**, open **System Settings > Privacy & Security**, scroll down, click **Open Anyway**, then confirm with your password or Touch ID.
- On macOS 14 or earlier: Control-click (right-click) the app, choose **Open**, then **Open** again.
- Prefer Terminal? Once the attestation and the checksum check out (above), run `xattr -dr com.apple.quarantine "/Applications/Hold My Brief.app"` once.

After that it opens normally.

---

Built from `${COMMIT}` by the [release workflow](${RUN_URL}).
