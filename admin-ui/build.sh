#!/usr/bin/env bash
# Build the Snapback admin Contract console to a static dist/.
#
# Delegates to build.mjs (programmatic Vite build, configFile:false) run under
# bun — bun imports the Exact .ts plugin sources directly. The console is built
# with contractVitePlugin (compiles .contract) + exactVitePlugin (emits the LLP
# 0268 static platform manifest + mac native envelope for the macOS Exact shell).
#
# Output: admin-ui/dist/ — index.html + assets/* (web) and __exact/* (native
# platform manifest + envelope + startup). Serve with:
#   SNAPBACK_ADMIN_DIST=$(pwd)/admin-ui/dist cargo run -- --memory
# then open http://127.0.0.1:4287/_snapback/admin
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
exact_root="${SNAPBACK_EXACT_ROOT:-$here/../../exact}"

if [ ! -d "$exact_root/packages/exact-contract/src" ]; then
  echo "error: Exact checkout not found at $exact_root" >&2
  echo "set SNAPBACK_EXACT_ROOT or place an Exact checkout at ../../exact" >&2
  exit 1
fi

bun="${BUN:-$(command -v bun || echo "$HOME/.bun/bin/bun")}"
if [ ! -x "$bun" ]; then
  echo "error: bun not found (needed to import Exact .ts sources); set BUN or install bun" >&2
  exit 1
fi

# Run from the Exact repo so its node_modules (vite/esbuild/hermesc) resolve.
cd "$exact_root"
exec env SNAPBACK_EXACT_ROOT="$exact_root" "$bun" "$here/build.mjs"
