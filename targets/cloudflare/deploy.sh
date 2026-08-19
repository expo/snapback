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

deploy_fail() {
  local code="$1" status="$2"
  shift 2
  echo "$code: $*" >&2
  exit "$status"
}

actions_taken=()
app="${SNAPBACK_CF_APP:-notes}"
case "$app" in
  notes)
    gateway_config="wrangler.jsonc"
    handler_config="wrangler.handler.jsonc"
    gateway_worker="snapback-notes-proof"
    handler_worker="snapback-notes-handler"
    action_handler_worker=""
    ;;
  all-aboard)
    gateway_config="wrangler.all-aboard.jsonc"
    handler_config="wrangler.all-aboard.handler.jsonc"
    gateway_worker="snapback-all-aboard-proof"
    handler_worker="snapback-all-aboard-handler"
    action_handler_worker="snapback-all-aboard-action-handler"
    ;;
  *)
    deploy_fail SNAPBACK_CF_DEPLOY_APP_UNKNOWN 2 \
      "unknown SNAPBACK_CF_APP '$app' (expected notes | all-aboard)"
    ;;
esac

if [[ "$app" == "all-aboard" && -n "${EXACT_ALL_ABOARD_SOURCE_ROOT:-}" ]]; then
  deploy_fail SNAPBACK_CF_DEPLOY_SOURCE_OVERRIDE_REFUSED 2 \
    "EXACT_ALL_ABOARD_SOURCE_ROOT is acceptance-only and must be unset for Cloudflare deploys."
fi

# @ref LLP 0049#config-and-secrets — production mutations must be performed by the exact Wrangler resolved by
# the committed root lock. Never let npx install or select a tool while a
# deployment transaction (or secret stdin) is in flight.
locked_wrangler_bin="$(node locked-wrangler.mjs --print-bin)"
wrangler() {
  node "$locked_wrangler_bin" "$@"
}
echo "==> verified repo-local locked Wrangler ($(node locked-wrangler.mjs --verify))"

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  deploy_fail SNAPBACK_CF_DEPLOY_CREDENTIAL_MISSING 2 \
    "CLOUDFLARE_API_TOKEN is not set. Export a Workers+DO-scoped token first."
fi

scripts_dir="$(cd ../.. && pwd)/scripts"
if [[ -x "$scripts_dir/cf-check-compat" ]]; then
  "$scripts_dir/cf-check-compat"
  actions_taken+=("compatibility-check")
fi

if [[ "$app" == "all-aboard" ]]; then
  # The gateway serves this build same-origin (LLP 0049 §Realtime And
  # Browser Surface), so the generated bindings address the page's own
  # origin — never a hand-written data path.
  echo "==> building the All Aboard Contract web bundle (same-origin bindings)"
  (cd ../../demos/all-aboard/surfaces/contract && bun install --frozen-lockfile >/dev/null && SNAPBACK_ALL_ABOARD_API=same-origin SNAPBACK_ALL_ABOARD_TARGET_PROFILE=cloudflare-do-sqlite-v8 bun run build)
  actions_taken+=("build:all-aboard-web")
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
bootstrap_attempted=()
existing_configs=()
existing_version_specs=()
changed_existing=()
bootstrap_temp_files=()
deploy_verified=0
EXPECTED_GATEWAY_VERSION_ID=""

array_contains() {
  local needle="$1" item
  shift
  for item in "$@"; do
    [[ "$item" == "$needle" ]] && return 0
  done
  return 1
}

prior_version_specs() {
  local config="$1" index
  for ((index = 0; index < ${#existing_configs[@]}; index++)); do
    if [[ "${existing_configs[$index]}" == "$config" ]]; then
      printf '%s' "${existing_version_specs[$index]}"
      return 0
    fi
  done
  return 1
}

active_version_specs_from_json() {
  node -e "
    const rows = JSON.parse(process.argv[1]);
    if (!Array.isArray(rows) || rows.length === 0) process.exit(2);
    const latest = rows[rows.length - 1];
    if (!latest || !Array.isArray(latest.versions) || latest.versions.length === 0) process.exit(2);
    const specs = latest.versions.map((entry) => {
      if (!entry || typeof entry.version_id !== 'string' || entry.version_id.length === 0) process.exit(2);
      const percentage = Number(entry.percentage);
      if (!Number.isFinite(percentage) || percentage <= 0 || percentage > 100) process.exit(2);
      return entry.version_id + '@' + percentage;
    }).sort();
    const total = latest.versions.reduce((sum, entry) => sum + Number(entry.percentage), 0);
    if (Math.abs(total - 100) > 0.0001) process.exit(2);
    process.stdout.write(specs.join(' '));
  " "$1"
}

active_single_version_id_from_json() {
  node -e "
    const rows = JSON.parse(process.argv[1]);
    if (!Array.isArray(rows) || rows.length === 0) process.exit(2);
    const latest = rows[rows.length - 1];
    if (!latest || !Array.isArray(latest.versions) || latest.versions.length !== 1) process.exit(2);
    const active = latest.versions[0];
    if (!active || typeof active.version_id !== 'string' || active.version_id.length === 0) process.exit(2);
    if (Math.abs(Number(active.percentage) - 100) > 0.0001) process.exit(2);
    process.stdout.write(active.version_id);
  " "$1"
}

final_active_version() {
  local config="$1" deployments version_id
  if ! deployments="$(wrangler deployments list --config "$config" --json 2>/dev/null)"; then
    deploy_fail SNAPBACK_CF_DEPLOY_VERSION_ATTESTATION_FAILED 1 \
      "could not read the final active version for $config"
  fi
  if ! version_id="$(active_single_version_id_from_json "$deployments" 2>/dev/null)"; then
    deploy_fail SNAPBACK_CF_DEPLOY_VERSION_ATTESTATION_FAILED 1 \
      "final deployment for $config is not exactly one active version at 100%"
  fi
  printf '%s' "$version_id"
}

deployed_version_id_from_log() {
  local log="$1"
  node -e "
    const fs = require('node:fs');
    const text = fs.readFileSync(process.argv[1], 'utf8').replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');
    const matches = [...text.matchAll(/(?:^|\n)\s*Current Version ID:\s*([^\s]+)\s*(?:\n|$)/g)];
    if (matches.length !== 1 || !matches[0][1]) process.exit(2);
    process.stdout.write(matches[0][1]);
  " "$log"
}

wait_for_gateway_activation() {
  local phase="$1" expected_version_id="$2" attempts delay deployments version_id
  attempts="${SNAPBACK_DEPLOY_CONTROL_ATTEMPTS:-8}"
  delay="${SNAPBACK_DEPLOY_CONTROL_DELAY_SECONDS:-5}"
  for ((i = 1; i <= attempts; i++)); do
    if deployments="$(wrangler deployments list --config "$gateway_config" --json 2>/dev/null)" &&
      version_id="$(active_single_version_id_from_json "$deployments" 2>/dev/null)" &&
      [[ "$version_id" == "$expected_version_id" ]]; then
      EXPECTED_GATEWAY_VERSION_ID="$expected_version_id"
      echo "==> $phase activated gateway version $EXPECTED_GATEWAY_VERSION_ID"
      return 0
    fi
    echo "    control-plane $i/$attempts: $phase has not exposed exact gateway version $expected_version_id at 100% yet"
    sleep "$delay"
  done
  echo "!!> could not attest exact gateway version $expected_version_id after $phase" >&2
  return 1
}

deploy_gateway_version() {
  local phase="$1" log version_id
  log="$(mktemp)"
  bootstrap_temp_files+=("$log")
  wrangler deploy --config "$gateway_config" 2>&1 | tee "$log"
  if ! version_id="$(deployed_version_id_from_log "$log" 2>/dev/null)"; then
    echo "!!> $phase did not report exactly one Current Version ID; refusing to infer activation" >&2
    return 1
  fi
  LAST_GATEWAY_DEPLOY_LOG="$log"
  wait_for_gateway_activation "$phase" "$version_id"
}

mark_existing_attempted() {
  local config="$1"
  if [[ "${#bootstrap_missing[@]}" -gt 0 ]] && array_contains "$config" "${bootstrap_missing[@]}"; then return 0; fi
  if [[ "${#changed_existing[@]}" -eq 0 ]] || ! array_contains "$config" "${changed_existing[@]}"; then
    changed_existing+=("$config")
  fi
}

restore_existing_worker() {
  local config="$1" specs current_json current_specs
  specs="$(prior_version_specs "$config")" || return 1
  local version_args=()
  read -r -a version_args <<<"$specs"
  echo "    restoring $config to $specs" >&2
  # Even a nonzero local exit can follow remote activation. The subsequent
  # deployment snapshot, not the CLI status alone, is the restoration proof.
  wrangler versions deploy "${version_args[@]}" --config "$config" --yes >/dev/null 2>&1 || true
  current_json="$(wrangler deployments list --config "$config" --json 2>/dev/null)" || return 1
  current_specs="$(active_version_specs_from_json "$current_json" 2>/dev/null)" || return 1
  [[ "$current_specs" == "$specs" ]]
}

restore_missing_worker() {
  local config="$1" status
  if worker_probe "$config"; then
    # A failed local Wrangler process may still have activated remotely.
    wrangler delete --config "$config" --force >/dev/null 2>&1 || true
    if worker_probe "$config"; then
      return 1
    else
      status=$?
      [[ "$status" -eq 1 ]]
      return
    fi
  else
    status=$?
    # Already confirmed missing is successful restoration. Auth/network/API
    # ambiguity is not permission to delete and remains a critical failure.
    [[ "$status" -eq 1 ]]
  fi
}

cleanup_deploy() {
  local status=$? config index cleanup_failed=0
  if [[ "${#bootstrap_temp_files[@]}" -gt 0 ]]; then
    for temp in "${bootstrap_temp_files[@]}"; do
      rm -f "$temp"
    done
  fi
  if [[ "$status" -ne 0 && "$deploy_verified" -ne 1 ]]; then
    if [[ "${#changed_existing[@]}" -gt 0 ]]; then
      echo "!!> deploy failed; restoring every previously-existing Worker version" >&2
      # Restore execution isolates first, then switch the gateway last as the
      # compatibility cutover. This avoids leaving the live gateway bound to
      # a handler from the failed deployment.
      local restore_order=("$handler_config")
      if [[ "$app" == "all-aboard" ]]; then restore_order+=("wrangler.all-aboard.action-handler.jsonc"); fi
      restore_order+=("$gateway_config")
      for config in "${restore_order[@]}"; do
        if ! array_contains "$config" "${changed_existing[@]}"; then continue; fi
        if restore_existing_worker "$config"; then
          echo "    restored and attested $config" >&2
        else
          echo "    CRITICAL: could not prove restoration of $config; deployment remains failed closed" >&2
          cleanup_failed=1
        fi
      done
    fi
    if [[ "${#bootstrap_attempted[@]}" -gt 0 ]]; then
      echo "!!> restoring confirmed-missing Workers in reverse dependency order" >&2
      # Dependents must disappear before the gateway they bind to. The
      # attempted list is checked because a failing Wrangler command may have
      # activated remotely before its local process returned nonzero.
      local cleanup_order=()
      if [[ "$app" == "all-aboard" ]]; then cleanup_order+=("wrangler.all-aboard.action-handler.jsonc"); fi
      cleanup_order+=("$gateway_config" "$handler_config")
      for config in "${cleanup_order[@]}"; do
        if ! array_contains "$config" "${bootstrap_attempted[@]}"; then continue; fi
        if restore_missing_worker "$config"; then
          echo "    confirmed missing state restored for $config" >&2
        else
          echo "    CRITICAL: could not prove missing-state restoration for $config; inspect it before retrying" >&2
          cleanup_failed=1
        fi
      done
    fi
    if [[ "$cleanup_failed" -ne 0 ]]; then
      echo "!!> rollback/cleanup attestation failed; do not retry until remote state is inspected" >&2
      fi
  fi
  return "$status"
}
trap cleanup_deploy EXIT

# Return 0 only for a confirmed existing Worker, 1 only for a confirmed
# not-found response, and 2 for auth/network/API ambiguity. An ambiguous
# probe must never authorize a stripped deployment over a healthy Worker.
worker_probe() {
  local config="$1" output specs
  WORKER_ACTIVE_SPECS=""
  if output="$(wrangler deployments list --config "$config" --json 2>&1)"; then
    if ! specs="$(active_version_specs_from_json "$output" 2>/dev/null)"; then
      echo "!!> $config exists, but its active deployment could not be snapshotted; refusing mutation" >&2
      return 2
    fi
    WORKER_ACTIVE_SPECS="$specs"
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
    existing_configs+=("$config")
    existing_version_specs+=("$WORKER_ACTIVE_SPECS")
    echo "==> $config: Worker exists (active versions snapshotted)"
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
    bootstrap_attempted+=("$config")
    wrangler deploy --config "$stripped"
    actions_taken+=("bootstrap:$config")
    rm -f "$stripped"
  done
else
  echo "==> all Workers exist: skipping the bootstrap pass (only needed on first deploy)"
fi

echo "==> deploying handler isolate ($handler_worker)"
mark_existing_attempted "$handler_config"
wrangler deploy --config "$handler_config"
actions_taken+=("deploy:$handler_worker")

if [[ "$app" == "all-aboard" ]]; then
  # The separate action-handler isolate (LLP 0049 Phase 2): slow action
  # fetches must not queue transactional invocations behind them.
  echo "==> deploying action handler isolate (snapback-all-aboard-action-handler)"
  mark_existing_attempted "wrangler.all-aboard.action-handler.jsonc"
  wrangler deploy --config wrangler.all-aboard.action-handler.jsonc
  actions_taken+=("deploy:$action_handler_worker")
fi

echo "==> deploying gateway + coordinator ($gateway_worker)"
mark_existing_attempted "$gateway_config"
deploy_gateway_version "gateway deploy"
actions_taken+=("deploy:$gateway_worker")
gateway_deploy_log="$LAST_GATEWAY_DEPLOY_LOG"

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
      if (!b.workerVersion || b.workerVersion.id !== process.argv[3]) process.exit(1);
    " "$body" "$([[ "$app" == "all-aboard" ]] && echo 1 || echo 0)" "$EXPECTED_GATEWAY_VERSION_ID" 2>/dev/null; then
      PROBED_HEALTH_BODY="$body"
      return 0
    fi
    echo "    probe $i/$attempts: gateway not serving expected full-bindings version $EXPECTED_GATEWAY_VERSION_ID yet"
    sleep "$delay"
  done
  return 1
}

if [[ -z "$probe_url" ]]; then
  deploy_fail SNAPBACK_CF_DEPLOY_PROBE_URL_UNAVAILABLE 1 \
    "could not determine the gateway URL (no workers.dev route in deploy output and SNAPBACK_DEPLOY_PROBE_URL unset); set SNAPBACK_DEPLOY_PROBE_URL and retry"
else
  echo "==> probing $probe_url/health for the HANDLER binding"
  probe_attempts="${SNAPBACK_DEPLOY_PROBE_ATTEMPTS:-8}"
  probe_delay="${SNAPBACK_DEPLOY_PROBE_DELAY_SECONDS:-5}"
  if probe_gateway_bindings "$probe_url" "$probe_attempts" "$probe_delay"; then
    echo "==> gateway is serving the full-bindings version"
  else
    echo "!!> live gateway is NOT serving the HANDLER binding (bootstrap/stale version"
    echo "    active) — running one corrective gateway redeploy"
    deploy_gateway_version "corrective gateway deploy"
    actions_taken+=("corrective-redeploy:$gateway_worker")
    if probe_gateway_bindings "$probe_url" "$probe_attempts" "$probe_delay"; then
      echo "==> corrective redeploy fixed it: gateway now serves the full-bindings version"
    else
      deploy_fail SNAPBACK_CF_DEPLOY_BINDING_VERIFICATION_FAILED 1 \
        "$probe_url/health still reports a required binding missing; queries will answer SNAPBACK_HANDLER_FAILED; manual remedy: node $locked_wrangler_bin deploy --config $gateway_config"
    fi
  fi
fi

if ! node -e "
  const body = JSON.parse(process.argv[1] || 'null');
  process.exit(body && body.ok === true ? 0 : 1);
" "${PROBED_HEALTH_BODY:-}"; then
  health_code="$(node -e "
    try { console.log(JSON.parse(process.argv[1]).code || 'unknown'); }
    catch (_) { console.log('invalid-health-response'); }
  " "${PROBED_HEALTH_BODY:-}")"
  # Opt-in stale-hash escape hatch (issues/closed/20260725-deploy-stale-schema-
  # hash-reset-race.md): a schema/inputs-hash change over non-empty persisted
  # state refuses on the NEW version by design, and coordinator.js
  # initializeSchema()'s two-phase startup deliberately keeps the authenticated
  # reset endpoint alive on that stale deployment so it can rebuild and stamp
  # the new hashes. Invoking it here — against the just-activated version,
  # before any failure/rollback — replaces the reset-loop-vs-rollback race that
  # was the previous working procedure. The call authenticates against the
  # admin secret a PREVIOUS deploy already configured on the Worker (this run's
  # secret handling happens later), which is exactly what the live workaround
  # proved works.
  stale_reset_recovered=0
  if [[ "${SNAPBACK_DEPLOY_RESET_ON_STALE:-0}" == "1" && "$health_code" == SNAPBACK_STALE_CLOUDFLARE_* ]]; then
    if [[ -z "${SNAPBACK_ADMIN_TOKEN:-}" ]]; then
      echo "!!> SNAPBACK_DEPLOY_RESET_ON_STALE=1 is set, but SNAPBACK_ADMIN_TOKEN is not in the" >&2
      echo "    environment; cannot authenticate /_snapback/api/app/reset — failing closed" >&2
    else
      echo "==> SNAPBACK_DEPLOY_RESET_ON_STALE=1: invoking authenticated /_snapback/api/app/reset on the new version"
      reset_attempts="${SNAPBACK_DEPLOY_RESET_ATTEMPTS:-6}"
      reset_delay="${SNAPBACK_DEPLOY_RESET_DELAY_SECONDS:-5}"
      for ((i = 1; i <= reset_attempts; i++)); do
        reset_body="$(curl -sS --max-time 15 -X POST -H "x-snapback-admin-token: ${SNAPBACK_ADMIN_TOKEN}" "$probe_url/_snapback/api/app/reset" 2>/dev/null || true)"
        if node -e "
          const body = JSON.parse(process.argv[1] || 'null');
          process.exit(body && body.reset === true ? 0 : 1);
        " "$reset_body" 2>/dev/null; then
          echo "==> reset landed on the new deployment; re-probing health"
          if probe_gateway_bindings "$probe_url" "$probe_attempts" "$probe_delay" && node -e "
            const body = JSON.parse(process.argv[1] || 'null');
            process.exit(body && body.ok === true ? 0 : 1);
          " "${PROBED_HEALTH_BODY:-}"; then
            stale_reset_recovered=1
            actions_taken+=("reset:stale-persistent-state")
            echo "==> health passes after reset; continuing the normal deploy path"
          else
            echo "!!> reset landed but health still refuses; falling through to failure/rollback" >&2
          fi
          break
        fi
        echo "    reset $i/$reset_attempts: new deployment has not confirmed \"reset\":true yet"
        sleep "$reset_delay"
      done
    fi
  fi
  if [[ "$stale_reset_recovered" -ne 1 ]]; then
    echo "    The new Worker version is live, but persistent state needs the documented" >&2
    echo "    migration/reset path before this deploy can be declared healthy." >&2
    echo "    For proof/demo targets whose persisted state is disposable, rerun with" >&2
    echo "    SNAPBACK_DEPLOY_RESET_ON_STALE=1 (and SNAPBACK_ADMIN_TOKEN exported) to reset" >&2
    echo "    and restamp on the new version instead of rolling back." >&2
    deploy_fail SNAPBACK_CF_DEPLOY_HEALTH_REFUSED 1 \
      "DEPLOYED BINDINGS VERIFIED, BUT HEALTH REFUSED: $health_code"
  fi
fi

# The destructive admin endpoints (/_snapback/api/app/reset, /_snapback/api/object/evict) are token-gated and fail
# closed when no token is configured (ENG-23587). Set the secret from the
# environment so the acceptance/measurement suites can drive them.
gateway_secret_mutated=0
if [[ -n "${SNAPBACK_ADMIN_TOKEN:-}" && "${SNAPBACK_ADMIN_TOKEN_REMOVE:-0}" == "1" ]]; then
  deploy_fail SNAPBACK_CF_DEPLOY_ADMIN_SECRET_CONFLICT 2 \
    "SNAPBACK_ADMIN_TOKEN and SNAPBACK_ADMIN_TOKEN_REMOVE=1 are mutually exclusive"
elif [[ -n "${SNAPBACK_ADMIN_TOKEN:-}" ]]; then
  echo "==> setting SNAPBACK_ADMIN_TOKEN secret on $gateway_worker"
  printf '%s' "$SNAPBACK_ADMIN_TOKEN" | wrangler secret put SNAPBACK_ADMIN_TOKEN --config "$gateway_config"
  gateway_secret_mutated=1
  current_secrets="$(wrangler secret list --format json --config "$gateway_config")"
  if node -e "
    const rows = JSON.parse(process.argv[1]);
    process.exit(rows.some((row) => row && row.name === 'SNAPBACK_ADMIN_TOKEN') ? 0 : 1);
  " "$current_secrets"; then
    actions_taken+=("admin-secret:set")
    echo "==> verified SNAPBACK_ADMIN_TOKEN present; admin endpoints are enabled"
  else
    deploy_fail SNAPBACK_CF_DEPLOY_ADMIN_SECRET_SET_UNVERIFIED 1 \
      "SNAPBACK_ADMIN_TOKEN write did not attest present"
  fi
elif [[ "${SNAPBACK_ADMIN_TOKEN_REMOVE:-0}" == "1" ]]; then
  echo "==> explicitly removing SNAPBACK_ADMIN_TOKEN from $gateway_worker"
  current_secrets="$(wrangler secret list --format json --config "$gateway_config")"
  if node -e "
    const rows = JSON.parse(process.argv[1]);
    process.exit(rows.some((row) => row && row.name === 'SNAPBACK_ADMIN_TOKEN') ? 0 : 1);
  " "$current_secrets"; then
    printf 'y\n' | wrangler secret delete SNAPBACK_ADMIN_TOKEN --config "$gateway_config"
    gateway_secret_mutated=1
  fi
  remaining_secrets="$(wrangler secret list --format json --config "$gateway_config")"
  if node -e "
    const rows = JSON.parse(process.argv[1]);
    process.exit(rows.some((row) => row && row.name === 'SNAPBACK_ADMIN_TOKEN') ? 1 : 0);
  " "$remaining_secrets"; then
    actions_taken+=("admin-secret:remove")
    echo "==> verified SNAPBACK_ADMIN_TOKEN absent; /_snapback/api/app/reset, /_snapback/api/object/evict, and /_snapback/api/config/status are disabled"
  else
    deploy_fail SNAPBACK_CF_DEPLOY_ADMIN_SECRET_REMOVE_UNVERIFIED 1 \
      "SNAPBACK_ADMIN_TOKEN removal did not attest absent"
  fi
else
  actions_taken+=("admin-secret:preserve")
  echo "==> this run did not set, rotate, or remove SNAPBACK_ADMIN_TOKEN"
  secret_list_log="$(mktemp)"
  bootstrap_temp_files+=("$secret_list_log")
  if current_secrets="$(wrangler secret list --format json --config "$gateway_config" 2>"$secret_list_log")"; then
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

# Wrangler's legacy secret commands do not report the Version ID they create.
# After a real secret mutation, make one ordinary gateway deploy: Wrangler does
# report that deploy's exact Version ID, and Worker secrets persist into it.
# This gives the final health proof a specific activation to attest instead of
# accepting any version that merely differs from an earlier snapshot.
if [[ "$gateway_secret_mutated" -eq 1 ]]; then
  echo "==> deploying an exactly identifiable final gateway version after admin-secret mutation"
  deploy_gateway_version "post-secret gateway deploy"
  actions_taken+=("post-secret-redeploy:$gateway_worker")
fi

# Repeat both the binding and full health proof after the last possible
# activation; only this point disarms rollback/cleanup.
echo "==> re-probing final gateway version after admin-secret state settled"
if ! probe_gateway_bindings "$probe_url" "$probe_attempts" "$probe_delay"; then
  deploy_fail SNAPBACK_CF_DEPLOY_FINAL_BINDING_VERIFICATION_FAILED 1 \
    "final gateway version is missing required service bindings"
fi
if ! node -e "
  const body = JSON.parse(process.argv[1] || 'null');
  process.exit(body && body.ok === true ? 0 : 1);
" "${PROBED_HEALTH_BODY:-}"; then
  health_code="$(node -e "
    try { console.log(JSON.parse(process.argv[1]).code || 'unknown'); }
    catch (_) { console.log('invalid-health-response'); }
  " "${PROBED_HEALTH_BODY:-}")"
  deploy_fail SNAPBACK_CF_DEPLOY_FINAL_HEALTH_VERIFICATION_FAILED 1 \
    "final gateway health refused with $health_code"
fi

# @ref LLP 0049#deployment-identity-freshness-gate-2026-07-25 — the receipt
# binds the script's success claim to the exact final Worker activations and
# live gateway observation, rather than to Wrangler process exit alone.
handler_version="$(final_active_version "$handler_config")"
gateway_version="$(final_active_version "$gateway_config")"
action_handler_version=""
if [[ -n "$action_handler_worker" ]]; then
  action_handler_version="$(final_active_version "wrangler.all-aboard.action-handler.jsonc")"
fi
health_code="$(node -e "
  const body = JSON.parse(process.argv[1]);
  process.stdout.write(body.code || 'SNAPBACK_CF_DEPLOY_HEALTHY');
" "${PROBED_HEALTH_BODY:-}")"

deploy_verified=1
echo "==> final gateway activation is bound and healthy"

node -e "
  const [app, gatewayName, gatewayVersion, handlerName, handlerVersion,
    actionName, actionVersion, probeUrl, healthCode, ...actionsTaken] = process.argv.slice(1);
  const worker = (name, activatedVersion) => ({ name, activatedVersion });
  console.log(JSON.stringify({
    schemaVersion: 'snapback.cloudflare-deploy-receipt.v1',
    app,
    workers: {
      gateway: worker(gatewayName, gatewayVersion),
      handler: worker(handlerName, handlerVersion),
      actionHandler: actionName ? worker(actionName, actionVersion) : null,
    },
    probeUrl,
    healthCode,
    actionsTaken,
  }));
" "$app" "$gateway_worker" "$gateway_version" "$handler_worker" "$handler_version" \
  "$action_handler_worker" "$action_handler_version" "$probe_url" "$health_code" \
  "${actions_taken[@]}"

if [[ "$app" == "all-aboard" ]]; then
  echo "==> configure app secrets (LLP 0049 Phase 1 guided config.set — one bulk"
  echo "    activation carrying entries + the SNAPBACK_CONFIG_GENERATION stamp):"
  echo "    printf '%s' '{\"caltrainFeed\":[\"<511-key>\"],\"directions\":[\"<ors-key>\"]}' | \\"
  echo "      SNAPBACK_ADMIN_TOKEN=... node config-set.mjs \\"
  echo "        --url $probe_url --entries-stdin"
fi

echo "==> deployed. Run the real-Cloudflare acceptance + measurement suite with:"
echo "    SNAPBACK_PROOF_URL=$probe_url \\"
echo "      node test/acceptance.remote.mjs"
