#!/usr/bin/env bash
# Build the Snapback admin Contract console to a static dist/.
#
# Delegates to build.mjs run under bun — the published Exact packages ship TS
# sources. build.mjs regenerates generated Contract bindings, then
# calls the shared Snapback Contract build preset, which owns the plugin
# ordering, preflights, static platform manifest, and mac native envelope for
# the macOS Exact shell.
#
# Output: admin-ui/dist/ — index.html + assets/* (web) and __exact/* (native
# platform manifest + envelope + startup). Serve with:
#   SNAPBACK_ADMIN_DIST=$(pwd)/admin-ui/dist cargo run -- start --memory
# then open the printed admin console URL
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"

bun="${BUN:-$(command -v bun || echo "$HOME/.bun/bin/bun")}"
if [ ! -x "$bun" ]; then
  echo "error: bun not found (needed to import the published Exact TS packages); set BUN or install bun" >&2
  exit 1
fi

if [ ! -f "$here/node_modules/@exact/contract/package.json" ]; then
  echo "error: admin-ui Exact packages are not installed" >&2
  echo "run: bun install --frozen-lockfile --cwd $here" >&2
  exit 1
fi

cd "$here"
exec "$bun" "$here/build.mjs"
