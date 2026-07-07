#!/usr/bin/env bash
# One-command deploy for the LLP 0040 Cloudflare narrow proof (§Acceptance: a
# checked-in deploy config deploys the demo with a single command). It deploys
# both Workers — the handler isolate and the gateway (which owns the
# coordinator Durable Object) — in the order their service bindings require.
#
# Credentials: pass a Cloudflare API token with Workers + Durable Objects edit
# scope via CLOUDFLARE_API_TOKEN (and CLOUDFLARE_ACCOUNT_ID). Do NOT commit the
# token. As of 2026-07-07 the token in the repo owner's key file is expired, so
# the decisive real-Cloudflare evidence (idle billing, real eviction, cold
# start, placement) is still pending a fresh token.
set -euo pipefail
cd "$(dirname "$0")"

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo "CLOUDFLARE_API_TOKEN is not set. Export a Workers+DO-scoped token first." >&2
  exit 2
fi

scripts_dir="$(cd .. && pwd)/scripts"
if [[ -x "$scripts_dir/cf-check-compat" ]]; then
  "$scripts_dir/cf-check-compat"
fi

echo "==> deploying handler isolate (snapback-notes-handler)"
npx wrangler deploy --config wrangler.handler.jsonc

echo "==> deploying gateway + coordinator (snapback-notes-proof)"
npx wrangler deploy --config wrangler.jsonc

# The destructive admin endpoints (/reset, /evict) are token-gated and fail
# closed when no token is configured (ENG-23587). Set the secret from the
# environment so the acceptance/measurement suites can drive them.
if [[ -n "${SNAPBACK_ADMIN_TOKEN:-}" ]]; then
  echo "==> setting SNAPBACK_ADMIN_TOKEN secret on snapback-notes-proof"
  printf '%s' "$SNAPBACK_ADMIN_TOKEN" | npx wrangler secret put SNAPBACK_ADMIN_TOKEN --config wrangler.jsonc
else
  echo "==> SNAPBACK_ADMIN_TOKEN not set: /reset and /evict stay disabled on this deploy."
  echo "    Export SNAPBACK_ADMIN_TOKEN and re-run, or: npx wrangler secret put SNAPBACK_ADMIN_TOKEN --config wrangler.jsonc"
fi

echo "==> deployed. Run the real-Cloudflare acceptance + measurement suite with:"
echo "    SNAPBACK_PROOF_URL=https://snapback-notes-proof.<subdomain>.workers.dev \\"
echo "      node test/acceptance.remote.mjs"
