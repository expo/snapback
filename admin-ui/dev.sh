#!/usr/bin/env bash
# Serve the Snapback admin Contract console with a browser-only Vite dev loop.
#
# A normal Snapback server remains the source of truth for /_snapback/api/*.
# Pin it to 4287 or set SNAPBACK_ADMIN_DEV_API to the printed server URL.
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
exec "$bun" "$here/dev.mjs"
