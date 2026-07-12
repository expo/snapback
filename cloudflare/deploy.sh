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
# pass: deploy each CONFIRMED-MISSING Worker once with its "services"
# stripped, then run the real deploys. A routine or mixed-state redeploy must
# never put a stripped-services version of a healthy Worker in flight — one
# ended up as the live gateway version once, and every query answered
# SNAPBACK_HANDLER_FAILED because env.HANDLER was undefined.
bootstrap_configs=("$handler_config" "$gateway_config")
if [[ "$app" == "all-aboard" ]]; then
  bootstrap_configs+=("wrangler.all-aboard.action-handler.jsonc")
fi

bootstrap_missing=()
bootstrap_created=()
bootstrap_temp_files=()
deploy_verified=0

cleanup_deploy() {
  local status=$?
  for temp in "${bootstrap_temp_files[@]}"; do
    rm -f "$temp"
  done
  if [[ "$status" -ne 0 && "$deploy_verified" -ne 1 && "${#bootstrap_created[@]}" -gt 0 ]]; then
    echo "!!> deploy failed after creating bootstrap-only Workers; restoring the confirmed-missing state" >&2
    for config in "${bootstrap_created[@]}"; do
      if npx wrangler delete --config "$config" --force >/dev/null 2>&1; then
        echo "    removed bootstrap Worker from $config" >&2
      else
        echo "    WARNING: could not remove bootstrap Worker from $config; inspect it before retrying" >&2
      fi
    done
  fi
  return "$status"
}
trap cleanup_deploy EXIT

# Return 0 only for a confirmed existing Worker, 1 only for a confirmed
# not-found response, and 2 for auth/network/API ambiguity. An ambiguous
# probe must never authorize a stripped deployment over a healthy Worker.
worker_probe() {
  local config="$1" output
  if output="$(npx wrangler deployments list --config "$config" --json 2>&1)"; then
    return 0
  fi
  if grep -Eqi 'worker[^[:alnum:]]+(not found|does not exist)|requested resource was not found|workers\.api\.error\.worker_not_found|code[^0-9]*(10090|10092)' <<<"$output"; then
    return 1
  fi
  echo "!!> could not determine whether the Worker for $config exists; refusing bootstrap" >&2
  echo "$output" >&2
  return 2
}

for config in "${bootstrap_configs[@]}"; do
  if worker_probe "$config"; then
    echo "==> $config: Worker exists"
  else
    probe_status=$?
    if [[ "$probe_status" -eq 1 ]]; then
      bootstrap_missing+=("$config")
      echo "==> $config: Worker confirmed missing (first deploy)"
    else
      exit "$probe_status"
    fi
  fi
done

if [[ "${SNAPBACK_FORCE_BOOTSTRAP:-0}" == "1" ]]; then
  echo "==> SNAPBACK_FORCE_BOOTSTRAP=1 does not replace existing Workers; only confirmed-missing Workers are eligible"
fi

if [[ "${#bootstrap_missing[@]}" -gt 0 ]]; then
  echo "==> bootstrap pass for confirmed-missing Workers only (service bindings stripped)"
  for config in "${bootstrap_missing[@]}"; do
    stripped=".bootstrap.$$.${config}"
    bootstrap_temp_files+=("$stripped")
    node -e "
      const fs = require('fs');
      const raw = fs.readFileSync('$config', 'utf8').replace(/^\s*\/\/.*$/gm, '');
      const cfg = JSON.parse(raw);
      delete cfg.services;
      fs.writeFileSync('$stripped', JSON.stringify(cfg, null, 2));
    "
    npx wrangler deploy --config "$stripped"
    rm -f "$stripped"
    bootstrap_created+=("$config")
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
bootstrap_temp_files+=("$gateway_deploy_log")
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
      if (!b || !b.bindings) process.exit(1);
      if (b.bindings.handler !== true) process.exit(1);
      if (needAction && b.bindings.actionHandler !== true) process.exit(1);
    " "$body" "$([[ "$app" == "all-aboard" ]] && echo 1 || echo 0)" 2>/dev/null; then
      PROBED_HEALTH_BODY="$body"
      return 0
    fi
    echo "    probe $i/$attempts: gateway not serving the full-bindings version yet"
    sleep "$delay"
  done
  return 1
}

if [[ -z "$probe_url" ]]; then
  echo "!!> DEPLOY FAILED VERIFICATION: could not determine the gateway URL (no workers.dev" >&2
  echo "    route in deploy output and SNAPBACK_DEPLOY_PROBE_URL unset). A final live" >&2
  echo "    binding proof is required; set SNAPBACK_DEPLOY_PROBE_URL and retry." >&2
  exit 1
else
  echo "==> probing $probe_url/health for the HANDLER binding"
  probe_attempts="${SNAPBACK_DEPLOY_PROBE_ATTEMPTS:-8}"
  probe_delay="${SNAPBACK_DEPLOY_PROBE_DELAY_SECONDS:-5}"
  if probe_gateway_bindings "$probe_url" "$probe_attempts" "$probe_delay"; then
    echo "==> gateway is serving the full-bindings version"
  else
    echo "!!> live gateway is NOT serving the HANDLER binding (bootstrap/stale version"
    echo "    active) — running one corrective gateway redeploy"
    npx wrangler deploy --config "$gateway_config"
    if probe_gateway_bindings "$probe_url" "$probe_attempts" "$probe_delay"; then
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

# From here onward a partial-bootstrap cleanup must not delete a deployment
# whose live gateway has proven its service bindings. The stronger health
# check below can still refuse success (for example stale persisted state),
# but that is an operator migration/reset condition, not a stripped bootstrap
# that should be deleted automatically.
deploy_verified=1
if ! node -e "
  const body = JSON.parse(process.argv[1] || 'null');
  process.exit(body && body.ok === true ? 0 : 1);
" "${PROBED_HEALTH_BODY:-}"; then
  health_code="$(node -e "
    try { console.log(JSON.parse(process.argv[1]).code || 'unknown'); }
    catch (_) { console.log('invalid-health-response'); }
  " "${PROBED_HEALTH_BODY:-}")"
  echo "!!> DEPLOYED BINDINGS VERIFIED, BUT HEALTH REFUSED: $health_code" >&2
  echo "    The new Worker version is live, but persistent state needs the documented" >&2
  echo "    migration/reset path before this deploy can be declared healthy." >&2
  exit 1
fi

# The destructive admin endpoints (/reset, /evict) are token-gated and fail
# closed when no token is configured (ENG-23587). Set the secret from the
# environment so the acceptance/measurement suites can drive them.
if [[ -n "${SNAPBACK_ADMIN_TOKEN:-}" && "${SNAPBACK_ADMIN_TOKEN_REMOVE:-0}" == "1" ]]; then
  echo "SNAPBACK_ADMIN_TOKEN and SNAPBACK_ADMIN_TOKEN_REMOVE=1 are mutually exclusive" >&2
  exit 2
elif [[ -n "${SNAPBACK_ADMIN_TOKEN:-}" ]]; then
  echo "==> setting SNAPBACK_ADMIN_TOKEN secret on $gateway_worker"
  printf '%s' "$SNAPBACK_ADMIN_TOKEN" | npx wrangler secret put SNAPBACK_ADMIN_TOKEN --config "$gateway_config"
elif [[ "${SNAPBACK_ADMIN_TOKEN_REMOVE:-0}" == "1" ]]; then
  echo "==> explicitly removing SNAPBACK_ADMIN_TOKEN from $gateway_worker"
  current_secrets="$(npx wrangler secret list --format json --config "$gateway_config")"
  if node -e "
    const rows = JSON.parse(process.argv[1]);
    process.exit(rows.some((row) => row && row.name === 'SNAPBACK_ADMIN_TOKEN') ? 0 : 1);
  " "$current_secrets"; then
    printf 'y\n' | npx wrangler secret delete SNAPBACK_ADMIN_TOKEN --config "$gateway_config"
  fi
  remaining_secrets="$(npx wrangler secret list --format json --config "$gateway_config")"
  if node -e "
    const rows = JSON.parse(process.argv[1]);
    process.exit(rows.some((row) => row && row.name === 'SNAPBACK_ADMIN_TOKEN') ? 1 : 0);
  " "$remaining_secrets"; then
    echo "==> verified SNAPBACK_ADMIN_TOKEN absent; /reset, /evict, and /config/status are disabled"
  else
    echo "!!> SNAPBACK_ADMIN_TOKEN removal did not attest absent" >&2
    exit 1
  fi
else
  echo "==> this run did not set, rotate, or remove SNAPBACK_ADMIN_TOKEN"
  secret_list_log="$(mktemp)"
  bootstrap_temp_files+=("$secret_list_log")
  if current_secrets="$(npx wrangler secret list --format json --config "$gateway_config" 2>"$secret_list_log")"; then
    if node -e "
      const rows = JSON.parse(process.argv[1]);
      process.exit(rows.some((row) => row && row.name === 'SNAPBACK_ADMIN_TOKEN') ? 0 : 1);
    " "$current_secrets"; then
      echo "    remote state: PRESENT and preserved; admin endpoints remain enabled with the existing token"
    else
      echo "    remote state: verified ABSENT; admin endpoints are disabled"
    fi
  else
    echo "    remote state: UNKNOWN (secret-list attestation failed); any existing token is preserved" >&2
    sed 's/^/    /' "$secret_list_log" >&2
  fi
  rm -f "$secret_list_log"
fi

if [[ "$app" == "all-aboard" ]]; then
  echo "==> configure app secrets (LLP 0049 Phase 1 guided config.set — one bulk"
  echo "    activation carrying entries + the SNAPBACK_CONFIG_GENERATION stamp):"
  echo "    printf '%s' '{\"caltrainFeed\":[\"<511-key>\"],\"directions\":[\"<ors-key>\"]}' | \\"
  echo "      SNAPBACK_ADMIN_TOKEN=... node config-set.mjs \\"
  echo "        --url https://$gateway_worker.<subdomain>.workers.dev --entries-stdin"
fi

echo "==> deployed. Run the real-Cloudflare acceptance + measurement suite with:"
echo "    SNAPBACK_PROOF_URL=https://$gateway_worker.<subdomain>.workers.dev \\"
echo "      node test/acceptance.remote.mjs"
