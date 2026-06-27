#!/usr/bin/env bash
# Serve the Snapback admin Contract console with a browser-only Vite dev loop.
#
# A normal Snapback server remains the source of truth for /_snapback/api/*.
# Pin it to 4287 or set SNAPBACK_ADMIN_DEV_API to the printed server URL.
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

# Run from the Exact repo so its node_modules (vite/esbuild) resolve.
cd "$exact_root"
exec env SNAPBACK_EXACT_ROOT="$exact_root" "$bun" "$here/dev.mjs"
