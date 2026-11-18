#!/usr/bin/env bash
# Builds Hold My Brief for macOS and assembles dist/Hold My Brief.app (and a .dmg
# when the bundler can produce one). The Windows counterpart of this script is
# build-native.ps1.
#
# Everything works offline: the Cargo registry cache lives in the workspace and
# node_modules is already installed.
set -euo pipefail

# This machine's ~/.cargo is root-owned, so keep every cache workspace-local.
WORKSPACE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export CARGO_HOME="${CARGO_HOME:-$(cd "$WORKSPACE/.." && pwd)/.cargo-home}"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$(cd "$WORKSPACE/.." && pwd)/.cargo-target}"
# Never reach for the network; the dependency cache is complete.
export CARGO_NET_OFFLINE="${CARGO_NET_OFFLINE:-true}"
export npm_config_offline="${npm_config_offline:-true}"
export npm_config_update_notifier=false

cd "$WORKSPACE"

echo "==> Frontend"
npm run build

echo "==> Native build ($(rustc --version))"
cd src-tauri
cargo build --release --locked --offline --features custom-protocol
cd ..

APP="$WORKSPACE/dist/Hold My Brief.app"
BUNDLE_DIR="$CARGO_TARGET_DIR/release/bundle"

echo "==> Bundle"
# The bundler re-runs the Rust build it already has cached and writes the .app.
# A .dmg needs hdiutil mounts that some sandboxes refuse, so it is best effort.
log=$(mktemp -t hold-my-brief-bundle)
if npx tauri build --bundles app,dmg --no-sign 2>&1 | tee "$log"; then
    :
elif grep -qi "bundle_dmg\|hdiutil\|dmg" "$log"; then
    echo "==> .dmg bundling is unavailable here; retrying with the .app only" >&2
    npx tauri build --bundles app --no-sign
else
    echo "==> Bundling failed; see $log" >&2
    exit 1
fi

BUILT="$BUNDLE_DIR/macos/Hold My Brief.app"
if [[ ! -d "$BUILT" ]]; then
    echo "error: the bundler did not produce $BUILT" >&2
    exit 1
fi

# dist/ is the delivery directory shared with the Windows script.
echo "==> Copying bundle to dist/"
rm -rf "$APP"
mkdir -p "$WORKSPACE/dist"
cp -R "$BUILT" "$APP"

# --no-sign leaves only the linker's ad-hoc signature, which does not seal the
# Info.plist. Ad-hoc signing the whole bundle keeps Gatekeeper and LaunchServices
# happy for a local build without a Developer ID.
echo "==> Ad-hoc signing"
codesign --force --deep --sign - "$APP"

echo "==> App bundle: $APP"
for dmg in "$BUNDLE_DIR"/dmg/*.dmg; do
    [[ -f "$dmg" ]] || continue
    cp -f "$dmg" "$WORKSPACE/dist/"
    echo "==> Disk image: $WORKSPACE/dist/$(basename "$dmg")"
done
