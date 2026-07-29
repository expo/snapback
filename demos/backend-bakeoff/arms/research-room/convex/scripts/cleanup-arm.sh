#!/usr/bin/env bash
set -euo pipefail

export PATH=/home/ccheever/.volta/bin:/usr/local/bin:/usr/bin:/bin
arm=$(cd "$(dirname "$0")/.." && pwd)
repo=$(git -C "$arm" rev-parse --show-toplevel)
state="$repo/.arm-state"
evidence="$arm/evidence"

test "$repo" = "/home/ccheever/worktrees/llp0102-research-convex-w2"
test "$arm" = "$repo/demos/backend-bakeoff/arms/research-room/convex"
test "$(cat "$state/logs/namespace")" = "llp0102-research-convex-w2"

convex_root=$(cat "$state/r2-convex-dev.pid")
vite_root=$(cat "$state/vite.pid")
backend_pid=""

collect_tree() {
  roots="$*"
  all="$roots"
  level="$roots"
  for _depth in 1 2 3 4 5; do
    next=""
    for parent in $level; do
      children=$(pgrep -P "$parent" 2>/dev/null || true)
      test -z "$children" || next="$next $children"
    done
    test -n "$next" || break
    all="$all $next"
    level="$next"
  done
  printf '%s\n' "$all"
}

processes=$(collect_tree "$convex_root" "$vite_root")
for pid in $processes; do
  test -e "/proc/$pid/exe" || continue
  cwd=$(readlink -f "/proc/$pid/cwd")
  exe=$(readlink -f "/proc/$pid/exe")
  case "$cwd" in
    "$arm"|"$arm"/*) ;;
    *) printf 'REFUSE_PROCESS_CWD pid=%s exe=%s cwd=%s\n' "$pid" "$exe" "$cwd"; exit 81 ;;
  esac
  case "$exe" in
    */convex-local-backend) backend_pid="$pid" ;;
  esac
done
test -n "$backend_pid"

r2_secret=$(tr "\000" "\n" < "/proc/$backend_pid/cmdline" | awk 'seen { print; exit } /^--instance-secret$/ { seen=1 }')
canary=$(tr -d "\n" < "$state/cli/research-canary")
test -n "$r2_secret"
test -n "$canary"
r2_pattern=$(mktemp)
canary_pattern=$(mktemp)
chmod 600 "$r2_pattern" "$canary_pattern"
printf %s "$r2_secret" > "$r2_pattern"
printf %s "$canary" > "$canary_pattern"
unset r2_secret canary

cd "$arm"
identity='{"subject":"alice","issuer":"https://development.local.convex","name":"Alice","email":"alice@example.test"}'
./node_modules/.bin/convex run research:cleanup '{}' --identity "$identity" \
  > "$state/logs/cleanup-mutation.raw.log" 2>&1
./node_modules/.bin/convex run research:cleanupProbe '{}' --identity "$identity" \
  > "$state/logs/cleanup-probe.raw.log" 2>&1

jq -e '.deletedTables | length == 10' "$state/logs/cleanup-mutation.raw.log" >/dev/null
jq -e 'to_entries | all(.value == 0)' "$state/logs/cleanup-probe.raw.log" >/dev/null

./node_modules/.bin/convex env remove RESEARCH_CANARY \
  > "$state/logs/cleanup-env-remove.raw.log" 2>&1
set +e
./node_modules/.bin/convex env get RESEARCH_CANARY \
  > "$state/logs/cleanup-env-probe.raw.log" 2>&1
env_probe_exit=$?
set -e
grep -Fq 'Environment variable "RESEARCH_CANARY" not found' \
  "$state/logs/cleanup-env-probe.raw.log"

cleanup_mutation_sha=$(sha256sum "$state/logs/cleanup-mutation.raw.log" | cut -d" " -f1)
cleanup_probe_sha=$(sha256sum "$state/logs/cleanup-probe.raw.log" | cut -d" " -f1)
env_remove_sha=$(sha256sum "$state/logs/cleanup-env-remove.raw.log" | cut -d" " -f1)
deleted_counts=$(jq -c '.before' "$state/logs/cleanup-mutation.raw.log")
zero_counts=$(jq -c '.' "$state/logs/cleanup-probe.raw.log")

rm -f -- "$state/cli/research-canary"

for pid in $(printf '%s\n' $processes | tac); do
  kill "$pid" 2>/dev/null || true
done
for _attempt in $(seq 1 30); do
  live=0
  for pid in $processes; do
    if test -r "/proc/$pid/status" && ! grep -q '^State:.*Z' "/proc/$pid/status"; then
      live=$((live + 1))
    fi
  done
  listeners=$(ss -ltn "sport = :3345 or sport = :3346 or sport = :4345" | awk 'NR>1 {count++} END {print count+0}')
  test "$live" -eq 0 && test "$listeners" -eq 0 && break
  sleep 1
done
for pid in $processes; do
  if test -r "/proc/$pid/status" && ! grep -q '^State:.*Z' "/proc/$pid/status"; then
    kill -KILL "$pid" 2>/dev/null || true
  fi
done
sleep 1

convex_path=$(realpath -m "$arm/.convex")
env_path=$(realpath -m "$arm/.env.local")
state_path=$(realpath -m "$state")
test "$convex_path" = "$arm/.convex"
test "$env_path" = "$arm/.env.local"
test "$state_path" = "/home/ccheever/worktrees/llp0102-research-convex-w2/.arm-state"

rm -rf -- "$convex_path"
rm -f -- "$env_path"
rm -rf -- "$state_path"

listener_count=$(ss -ltn "sport = :3345 or sport = :3346 or sport = :4345" | awk 'NR>1 {count++} END {print count+0}')
process_count=0
for pid in $processes; do
  if test -r "/proc/$pid/status" && ! grep -q '^State:.*Z' "/proc/$pid/status"; then
    process_count=$((process_count + 1))
  fi
done
target_path_count=0
for target in "$arm/.convex" "$arm/.env.local" "$state"; do
  test ! -e "$target" || target_path_count=$((target_path_count + 1))
done

r2_matches_file=$(mktemp)
canary_matches_file=$(mktemp)
rg -a -l -f "$r2_pattern" "$arm" > "$r2_matches_file" 2>/dev/null || true
rg -a -l -f "$canary_pattern" "$arm" > "$canary_matches_file" 2>/dev/null || true
r2_secret_matches=$(wc -l < "$r2_matches_file")
canary_secret_matches=$(wc -l < "$canary_matches_file")
rm -f -- "$r2_pattern" "$canary_pattern" "$r2_matches_file" "$canary_matches_file"

jq -n \
  --arg cleanedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg namespace "llp0102-research-convex-w2" \
  --arg cleanupMutationSha "$cleanup_mutation_sha" \
  --arg cleanupProbeSha "$cleanup_probe_sha" \
  --arg envRemoveSha "$env_remove_sha" \
  --argjson deletedCounts "$deleted_counts" \
  --argjson zeroCounts "$zero_counts" \
  --argjson envProbeExit "$env_probe_exit" \
  --argjson listenerCount "$listener_count" \
  --argjson processCount "$process_count" \
  --argjson targetPathCount "$target_path_count" \
  --argjson r2SecretMatches "$r2_secret_matches" \
  --argjson canarySecretMatches "$canary_secret_matches" \
  '{
    schemaVersion: 1,
    cleanedAt: $cleanedAt,
    namespace: $namespace,
    freshLocalTarget: true,
    applicationCleanup: {
      deletedCounts: $deletedCounts,
      postCleanupCounts: $zeroCounts,
      mutationLogSha256: $cleanupMutationSha,
      probeLogSha256: $cleanupProbeSha
    },
    environmentCleanup: {
      variableName: "RESEARCH_CANARY",
      removeLogSha256: $envRemoveSha,
      negativeProbeExitCode: $envProbeExit,
      negativeMessageObserved: true
    },
    targetCleanup: {
      listenerCount: $listenerCount,
      recordedProcessCount: $processCount,
      targetPathCount: $targetPathCount,
      r2ControlSecretExactValueMatches: $r2SecretMatches,
      applicationCanaryExactValueMatches: $canarySecretMatches
    },
    unrelatedBaseline: "not applicable: fresh isolated local target",
    broadDeleteUsed: false,
    status: "pass"
  }' > "$evidence/cleanup-receipt.v1.json"

test "$listener_count" -eq 0
test "$process_count" -eq 0
test "$target_path_count" -eq 0
test "$r2_secret_matches" -eq 0
test "$canary_secret_matches" -eq 0

printf 'cleanup_status=pass listeners=%s processes=%s target_paths=%s r2_secret_matches=%s canary_matches=%s\n' \
  "$listener_count" "$process_count" "$target_path_count" \
  "$r2_secret_matches" "$canary_secret_matches"
