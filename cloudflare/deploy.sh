#!/usr/bin/env bash
# One-command deploy for the Cloudflare proof (§Acceptance: a checked-in
# deploy config deploys the demo with a single command). It deploys both
# Workers — the handler isolate and the gateway (which owns the coordinator
# Durable Object) — in the order their service bindings require.
#
# LLP 0049 Phase 0 app selector: SNAPBACK_CF_APP selects the compiled-in app
# bundle. 'notes' (default) deploys LLP 0040's pinned regression fixture;
# 'all-aboard' builds the Contract web bundle (same-origin generated
# bindings) and deploys the All Aboard profile with gateway-served static
# assets.
#
# Credentials: pass a Cloudflare API token with Workers + Durable Objects edit
# scope via CLOUDFLARE_API_TOKEN (and CLOUDFLARE_ACCOUNT_ID). Do NOT commit
# the token.
set -euo pipefail
cd "$(dirname "$0")"

app="${SNAPBACK_CF_APP:-notes}"
case "$app" in
  notes)
    gateway_config="wrangler.jsonc"
    handler_config="wrangler.handler.jsonc"
    gateway_worker="snapback-notes-proof"
    handler_worker="snapback-notes-handler"
    ;;
  all-aboard)
    gateway_config="wrangler.all-aboard.jsonc"
    handler_config="wrangler.all-aboard.handler.jsonc"
    gateway_worker="snapback-all-aboard-proof"
    handler_worker="snapback-all-aboard-handler"
    ;;
  *)
    echo "unknown SNAPBACK_CF_APP '$app' (expected notes | all-aboard)" >&2
    exit 2
    ;;
esac

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo "CLOUDFLARE_API_TOKEN is not set. Export a Workers+DO-scoped token first." >&2
  exit 2
fi

scripts_dir="$(cd .. && pwd)/scripts"
if [[ -x "$scripts_dir/cf-check-compat" ]]; then
  "$scripts_dir/cf-check-compat"
fi

if [[ "$app" == "all-aboard" ]]; then
  # The gateway serves this build same-origin (LLP 0049 §Realtime And
  # Browser Surface), so the generated bindings address the page's own
  # origin — never a hand-written data path.
  echo "==> building the All Aboard Contract web bundle (same-origin bindings)"
  (cd ../demos/all-aboard/surfaces/contract && bun install --frozen-lockfile >/dev/null && SNAPBACK_ALL_ABOARD_API=same-origin bun run build)
fi

# Service bindings are circular (gateway <-> handler), so a FIRST deploy to a
# fresh account fails validation (code 10143) whichever order runs. Bootstrap
# pass: deploy every Worker once with its "services" stripped, then run the
# real deploys. The bootstrap pass runs ONLY when one of the Workers does not
# exist yet (ENG-23732): a routine redeploy must never put a stripped-services
# version in flight — one ended up as the live gateway version once, and every
# query answered SNAPBACK_HANDLER_FAILED because env.HANDLER was undefined.
bootstrap_configs=("$handler_config" "$gateway_config")
if [[ "$app" == "all-aboard" ]]; then
  bootstrap_configs+=("wrangler.all-aboard.action-handler.jsonc")
fi

worker_exists() {
  npx wrangler deployments list --config "$1" >/dev/null 2>&1
}

needs_bootstrap=0
for config in "${bootstrap_configs[@]}"; do
  if ! worker_exists "$config"; then
    needs_bootstrap=1
    echo "==> $config: Worker not found on the account (first deploy)"
  fi
done

if [[ "${SNAPBACK_FORCE_BOOTSTRAP:-0}" == "1" ]]; then
  needs_bootstrap=1
  echo "==> SNAPBACK_FORCE_BOOTSTRAP=1: running the bootstrap pass regardless"
fi

if [[ "$needs_bootstrap" == "1" ]]; then
  echo "==> bootstrap pass (service bindings stripped; breaks the first-deploy cycle)"
  for config in "${bootstrap_configs[@]}"; do
    stripped=".bootstrap.$config"
    node -e "
      const fs = require('fs');
      const raw = fs.readFileSync('$config', 'utf8').replace(/^\s*\/\/.*$/gm, '');
      const cfg = JSON.parse(raw);
      delete cfg.services;
      fs.writeFileSync('$stripped', JSON.stringify(cfg, null, 2));
    "
    npx wrangler deploy --config "$stripped"
    rm -f "$stripped"
  done
else
  echo "==> all Workers exist: skipping the bootstrap pass (only needed on first deploy)"
fi

echo "==> deploying handler isolate ($handler_worker)"
npx wrangler deploy --config "$handler_config"

if [[ "$app" == "all-aboard" ]]; then
  # The separate action-handler isolate (LLP 0049 Phase 2): slow action
  # fetches must not queue transactional invocations behind them.
  echo "==> deploying action handler isolate (snapback-all-aboard-action-handler)"
  npx wrangler deploy --config wrangler.all-aboard.action-handler.jsonc
fi

echo "==> deploying gateway + coordinator ($gateway_worker)"
gateway_deploy_log="$(mktemp)"
npx wrangler deploy --config "$gateway_config" | tee "$gateway_deploy_log"

# Post-deploy probe (ENG-23732): assert the LIVE gateway version carries the
# HANDLER service binding. /health reports `bindings` since this change; the
# stripped bootstrap version (or a stale activation) reports handler:false or
# no bindings field at all. Retries cover activation lag; on failure we run
# one corrective gateway redeploy (the remedy that recovered the incident)
# before failing loudly.
probe_url="${SNAPBACK_DEPLOY_PROBE_URL:-}"
if [[ -z "$probe_url" ]]; then
  probe_url="$(grep -oE "https://$gateway_worker\.[a-z0-9-]+\.workers\.dev" "$gateway_deploy_log" | head -1 || true)"
fi
rm -f "$gateway_deploy_log"

probe_gateway_bindings() {
  local url="$1" attempts="$2" delay="$3" body
  for ((i = 1; i <= attempts; i++)); do
    body="$(curl -sS --max-time 15 "$url/health" 2>/dev/null || true)"
    if node -e "
      const b = JSON.parse(process.argv[1] || 'null');
      const needAction = process.argv[2] === '1';
      if (!b || b.ok !== true || !b.bindings) process.exit(1);
      if (b.bindings.handler !== true) process.exit(1);
      if (needAction && b.bindings.actionHandler !== true) process.exit(1);
    " "$body" "$([[ "$app" == "all-aboard" ]] && echo 1 || echo 0)" 2>/dev/null; then
      return 0
    fi
    echo "    probe $i/$attempts: gateway not serving the full-bindings version yet"
    sleep "$delay"
  done
  return 1
}

if [[ -z "$probe_url" ]]; then
  echo "!!> could not determine the gateway URL (no workers.dev route in the deploy"
  echo "    output and SNAPBACK_DEPLOY_PROBE_URL unset) — SKIPPING the post-deploy"
  echo "    binding probe. Verify manually that /health reports bindings.handler=true:"
  echo "    curl https://$gateway_worker.<subdomain>.workers.dev/health"
else
  echo "==> probing $probe_url/health for the HANDLER binding"
  if probe_gateway_bindings "$probe_url" 8 5; then
    echo "==> gateway is serving the full-bindings version"
  else
    echo "!!> live gateway is NOT serving the HANDLER binding (bootstrap/stale version"
    echo "    active) — running one corrective gateway redeploy"
    npx wrangler deploy --config "$gateway_config"
    if probe_gateway_bindings "$probe_url" 8 5; then
      echo "==> corrective redeploy fixed it: gateway now serves the full-bindings version"
    else
      echo "!!> DEPLOY FAILED VERIFICATION: $probe_url/health still reports the HANDLER"
      echo "    binding missing. Every query against this deployment will answer"
      echo "    SNAPBACK_HANDLER_FAILED. Manual remedy:"
      echo "    npx wrangler deploy --config $gateway_config"
      exit 1
    fi
  fi
fi

# The destructive admin endpoints (/reset, /evict) are token-gated and fail
# closed when no token is configured (ENG-23587). Set the secret from the
# environment so the acceptance/measurement suites can drive them.
if [[ -n "${SNAPBACK_ADMIN_TOKEN:-}" ]]; then
  echo "==> setting SNAPBACK_ADMIN_TOKEN secret on $gateway_worker"
  printf '%s' "$SNAPBACK_ADMIN_TOKEN" | npx wrangler secret put SNAPBACK_ADMIN_TOKEN --config "$gateway_config"
else
  echo "==> SNAPBACK_ADMIN_TOKEN not set: /reset and /evict stay disabled on this deploy."
  echo "    Export SNAPBACK_ADMIN_TOKEN and re-run, or: npx wrangler secret put SNAPBACK_ADMIN_TOKEN --config $gateway_config"
fi

if [[ "$app" == "all-aboard" ]]; then
  echo "==> configure app secrets (LLP 0049 Phase 1 guided config.set — one bulk"
  echo "    activation carrying entries + the SNAPBACK_CONFIG_GENERATION stamp):"
  echo "    node config-set.mjs --url https://$gateway_worker.<subdomain>.workers.dev \\"
  echo "      --entry caltrainFeed='[\"<511-key>\"]' --entry directions='[\"<ors-key>\"]'"
fi

echo "==> deployed. Run the real-Cloudflare acceptance + measurement suite with:"
echo "    SNAPBACK_PROOF_URL=https://$gateway_worker.<subdomain>.workers.dev \\"
echo "      node test/acceptance.remote.mjs"
