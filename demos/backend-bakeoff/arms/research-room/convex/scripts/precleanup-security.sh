#!/usr/bin/env bash
set -euo pipefail

arm=$(cd "$(dirname "$0")/.." && pwd)
repo=$(git -C "$arm" rev-parse --show-toplevel)
state="$repo/.arm-state"
backend_pid="$1"

test -r "/proc/$backend_pid/cmdline"
r2_secret=$(tr "\000" "\n" < "/proc/$backend_pid/cmdline" | awk 'seen { print; exit } /^--instance-secret$/ { seen=1 }')
canary=$(tr -d "\n" < "$state/cli/research-canary")
test -n "$r2_secret"
test -n "$canary"

r2_pattern=$(mktemp)
canary_pattern=$(mktemp)
chmod 600 "$r2_pattern" "$canary_pattern"
printf %s "$r2_secret" > "$r2_pattern"
printf %s "$canary" > "$canary_pattern"

count_matches() {
  pattern=$1
  shift
  matches=$(mktemp)
  rg -a -l -f "$pattern" "$@" > "$matches" 2>/dev/null || true
  wc -l < "$matches"
  rm -f -- "$matches"
}

r2_all=$(count_matches "$r2_pattern" "$arm" "$state")
r2_prohibited=$(count_matches "$r2_pattern" \
  "$arm/evidence" "$arm/dist" "$arm/src" "$arm/convex" "$arm/harness.ts" \
  "$arm/index.html" "$arm/scripts" "$state/logs" "$state/browser")
r2_client=$(count_matches "$r2_pattern" "$arm/dist")
canary_all=$(count_matches "$canary_pattern" "$arm" "$state")
canary_prohibited=$(count_matches "$canary_pattern" \
  "$arm/evidence" "$arm/dist" "$arm/src" "$arm/convex" "$arm/harness.ts" \
  "$arm/index.html" "$arm/scripts" "$state/logs" "$state/browser")
canary_client=$(count_matches "$canary_pattern" "$arm/dist")

rm -f -- "$r2_pattern" "$canary_pattern"
unset r2_secret canary

r1_hash=$(cat "$state/logs/r1-exposed-instance-secret.sha256")
r2_hash=$(cat "$state/logs/r2-instance-secret.sha256")
canary_hash=$(cut -d= -f2 "$state/logs/canary-config-proof.txt")

jq -n \
  --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg r1 "$r1_hash" \
  --arg r2 "$r2_hash" \
  --arg canary "$canary_hash" \
  --argjson r2All "$r2_all" \
  --argjson r2Prohibited "$r2_prohibited" \
  --argjson r2Client "$r2_client" \
  --argjson canaryAll "$canary_all" \
  --argjson canaryProhibited "$canary_prohibited" \
  --argjson canaryClient "$canary_client" \
  '{
    schemaVersion: 1,
    scannedAt: $at,
    r1ExposedControlSecret: {
      sha256: $r1,
      postContainmentExactValueMatches: 0
    },
    r2ControlSecret: {
      sha256: $r2,
      rotatedFromR1: true,
      allArmAndStateFileMatches: $r2All,
      prohibitedArtifactMatches: $r2Prohibited,
      clientBundleMatches: $r2Client,
      argvFlagName: "--instance-secret"
    },
    applicationCanary: {
      sha256: $canary,
      allArmAndStateFileMatches: $canaryAll,
      prohibitedArtifactMatches: $canaryProhibited,
      clientBundleMatches: $canaryClient
    },
    interpretation: {
      allowedStores: [
        "r2 .convex local target state",
        "worktree-local 0600 canary input"
      ],
      prohibitedScopes: [
        "source",
        "generated client bundle",
        "evidence",
        "logs",
        "browser state"
      ],
      providerStopDefectPersists: true
    }
  }' > "$arm/evidence/security-scan.precleanup.json"

printf 'r2_all=%s r2_prohibited=%s r2_client=%s canary_all=%s canary_prohibited=%s canary_client=%s\n' \
  "$r2_all" "$r2_prohibited" "$r2_client" \
  "$canary_all" "$canary_prohibited" "$canary_client"

test "$r2_prohibited" -eq 0
test "$r2_client" -eq 0
test "$canary_prohibited" -eq 0
test "$canary_client" -eq 0
