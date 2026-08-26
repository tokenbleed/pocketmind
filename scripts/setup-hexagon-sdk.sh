#!/bin/bash
# Provision the Hexagon SDK for local release builds that include the NPU
# (QDSP6) backend. Mirrors the digest-pinned setup the upstream CI used
# (b798d233, .github/actions/setup-hexagon-sdk/action.yml).
#
# The redistributor (snapdragon-toolchain/hexagon-sdk) is a third party, not
# Qualcomm, and its release assets are mutable under a fixed tag: never bump
# the version without re-establishing both digests.
#
# Only headers (incs/, rpcmem/inc) and the prebuilt libcdsprpc.so are consumed
# by the Android build; the Hexagon tools themselves are never executed on the
# host. The linux-amd64 tarball is the only packaging that ships everything.
set -euo pipefail

SDK_VERSION="6.4.0.2"
TOOLS_VERSION="19.0.04"
TARBALL_SHA256="b4a57a774795cf12da19a777a5d306e970905bf9758a4c4765e5e4593428ae0b"
CONSUMED_SHA256="f56685ec2513933ab6465c44e40e8ce0263bc40751961aa2468da9cbcdfe7409"
TARBALL_URL="https://github.com/snapdragon-toolchain/hexagon-sdk/releases/download/v${SDK_VERSION}/hexagon-sdk-v${SDK_VERSION}-amd64-lnx.tar.xz"

SDK_ROOT="$HOME/.hexagon-sdk/$SDK_VERSION"
TOOLS_ROOT="$SDK_ROOT/tools/HEXAGON_Tools/$TOOLS_VERSION"
CONSUMED_PATHS="incs ipc/fastrpc/rpcmem/inc ipc/fastrpc/remote/ship/android_aarch64/libcdsprpc.so"

consumed_digest() {
  (
    cd "$SDK_ROOT"
    # LC_ALL=C for byte-order sort; ! -type d so a symlink planted under
    # incs/ lands inside the digest instead of shadowing an NDK header.
    LC_ALL=C find $CONSUMED_PATHS ! -type d | LC_ALL=C sort \
      | xargs shasum -a 256 | shasum -a 256 | cut -d' ' -f1
  )
}

if [ -d "$SDK_ROOT" ]; then
  echo "Hexagon SDK already present at $SDK_ROOT"
else
  STAGE=$(mktemp -d)
  trap 'rm -rf "$STAGE"' EXIT
  CACHE="$HOME/.hexagon-dl/hexagon-sdk.tar.xz"
  if [ -f "$CACHE" ] && [ "$(shasum -a 256 "$CACHE" | cut -d' ' -f1)" = "$TARBALL_SHA256" ]; then
    echo "Using cached tarball at $CACHE"
    cp "$CACHE" "$STAGE/sdk.tar.xz"
  else
    mkdir -p "$HOME/.hexagon-dl"
    echo "Downloading $TARBALL_URL (resumable cache at $CACHE)"
    for attempt in 1 2 3 4 5; do
      curl -fL -C - --connect-timeout 15 --speed-time 60 --speed-limit 10000 \
        -o "$CACHE" "$TARBALL_URL" && break
      [ "$attempt" = "5" ] && { echo "ERROR: download kept failing." >&2; exit 1; }
    done
    cp "$CACHE" "$STAGE/sdk.tar.xz"
  fi
  ACTUAL=$(shasum -a 256 "$STAGE/sdk.tar.xz" | cut -d' ' -f1)
  if [ "$ACTUAL" != "$TARBALL_SHA256" ]; then
    echo "ERROR: tarball digest mismatch. Expected $TARBALL_SHA256, got $ACTUAL." >&2
    exit 1
  fi
  mkdir -p "$STAGE/unpacked"
  tar -xf "$STAGE/sdk.tar.xz" -C "$STAGE/unpacked"
  rm -f "$STAGE/sdk.tar.xz"
  mkdir -p "$HOME/.hexagon-sdk"
  if [ -d "$STAGE/unpacked/incs" ]; then
    mv "$STAGE/unpacked" "$SDK_ROOT"
  else
    INNER=$(find "$STAGE/unpacked" -maxdepth 1 -mindepth 1 -type d)
    if [ ! -d "$INNER/incs" ]; then
      echo "ERROR: unexpected archive layout." >&2
      exit 1
    fi
    mv "$INNER" "$SDK_ROOT"
  fi
  echo "Installed to $SDK_ROOT"
fi

MISSING=""
for consumed in $CONSUMED_PATHS; do
  [ -e "$SDK_ROOT/$consumed" ] || MISSING="$MISSING $consumed"
done
if [ -n "$MISSING" ]; then
  echo "ERROR: SDK is incomplete, missing:$MISSING" >&2
  exit 1
fi
if [ ! -d "$TOOLS_ROOT" ]; then
  echo "ERROR: $TOOLS_ROOT is missing; the build gates on its presence." >&2
  exit 1
fi

CONSUMED=$(consumed_digest)
if [ "$CONSUMED" != "$CONSUMED_SHA256" ]; then
  echo "ERROR: consumed-subset digest mismatch. Expected $CONSUMED_SHA256, got $CONSUMED." >&2
  exit 1
fi

echo "OK: Hexagon SDK verified at $SDK_ROOT"
echo "The build auto-detects it at \$HOME/.hexagon-sdk/$SDK_VERSION; no exports needed."
