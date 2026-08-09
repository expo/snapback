#!/bin/zsh

set -euo pipefail
unsetopt BG_NICE

script_dir=${0:A:h}
control_root=${script_dir:h}
worktree=${script_dir:h:h:h:h}
fixture_root=$worktree/demos/zerobugs/fixtures-local
pristine=$fixture_root/oq4-clone
destination=$fixture_root/oq4-clone-authority
runtime_binary=${SNAPBACK_RUNTIME_BINARY:-$worktree/target/debug/snapback}
prepare_dir=
server_pid=
stop_failed=0

if [[ ! -x $runtime_binary ]]; then
  print -u2 "authority fixture: runtime binary is not executable: $runtime_binary"
  exit 1
fi
for required in diag.sqlite3 diag.sqlite3.auth-keyring.json startup-artifacts.json; do
  if [[ ! -f $pristine/$required ]]; then
    print -u2 "authority fixture: pristine oq4 clone is missing $required"
    exit 1
  fi
done
if [[ -e $destination ]]; then
  print -u2 "authority fixture: destination already exists: $destination"
  exit 1
fi

mkdir -p $fixture_root
prepare_dir=$(mktemp -d $fixture_root/.oq4-clone-authority.prepare.XXXXXX)
database=$prepare_dir/diag.sqlite3
ready_file=$prepare_dir/ready.json
baseline_carrier=$prepare_dir/baseline-startup-artifacts.json
startup_artifacts=$prepare_dir/startup-artifacts.json
deploy_log=$prepare_dir/deploy.log
server_log=$prepare_dir/server.log
spike_trace=$prepare_dir/spike-trace.jsonl

cleanup() {
  local rc=$?
  trap - EXIT INT TERM
  if [[ -n ${server_pid:-} ]] && kill -0 $server_pid 2>/dev/null; then
    kill -TERM $server_pid 2>/dev/null || true
    for attempt in {1..1200}; do
      kill -0 $server_pid 2>/dev/null || break
      sleep 0.5
    done
    if kill -0 $server_pid 2>/dev/null; then
      kill -KILL $server_pid 2>/dev/null || true
    fi
    wait $server_pid 2>/dev/null || true
  fi
  if [[ -n ${prepare_dir:-} && -d $prepare_dir ]]; then
    if (( rc != 0 )); then
      print -u2 "authority fixture: preparation failed with status $rc"
      for failure_log in $deploy_log $server_log; do
        if [[ -s $failure_log ]]; then
          print -u2 "authority fixture: tail of ${failure_log:t}"
          tail -80 $failure_log >&2
        fi
      done
    fi
    rm -rf -- $prepare_dir
  fi
  return $rc
}
trap cleanup EXIT INT TERM

# Keep the large baseline byte-for-byte cheap: all three persistent inputs are
# APFS clonefiles, and only the cloned store is ever opened for deployment.
cp -c $pristine/diag.sqlite3 $database
cp -c $pristine/diag.sqlite3.auth-keyring.json $database.auth-keyring.json
cp -c $pristine/startup-artifacts.json $baseline_carrier

start_server() {
  local carrier=$1
  local trace=$2
  rm -f $ready_file $ready_file.admin-token $ready_file.impersonation-capability
  rm -f $server_log $trace
  env \
    SNAPBACK_OUTBOUND_ACTIONS=1 \
    ZERBUGS_TEST_DEFAULTS=1 \
    SNAPBACK_SPIKE_TRACE=$trace \
    $runtime_binary start \
      --port 0 \
      --db $database \
      --ready-file $ready_file \
      --startup-artifacts $carrier \
      >$server_log 2>&1 &
  server_pid=$!
  local ready=0
  for attempt in {1..240}; do
    if [[ -s $ready_file ]]; then
      ready=1
      break
    fi
    if ! kill -0 $server_pid 2>/dev/null; then
      print -u2 'authority fixture: server exited before readiness'
      sed -n '1,160p' $server_log >&2
      return 1
    fi
    sleep 0.5
  done
  if (( ! ready )); then
    print -u2 'authority fixture: readiness timed out'
    return 1
  fi
}

stop_server() {
  stop_failed=0
  if [[ -n ${server_pid:-} ]] && kill -0 $server_pid 2>/dev/null; then
    kill -TERM $server_pid 2>/dev/null || true
    for attempt in {1..1200}; do
      kill -0 $server_pid 2>/dev/null || break
      sleep 0.5
    done
    if kill -0 $server_pid 2>/dev/null; then
      print -u2 'authority fixture: server exceeded the 600 s WAL-checkpoint grace'
      stop_failed=1
      kill -KILL $server_pid 2>/dev/null || true
    fi
    wait $server_pid 2>/dev/null || true
  fi
  server_pid=
  if [[ -e $database-wal || -e $database-shm ]]; then
    print -u2 'authority fixture: SQLite sidecar remained after clean shutdown'
    ls -l $database-wal $database-shm 2>/dev/null >&2 || true
    stop_failed=1
  fi
  (( stop_failed == 0 ))
}

# A sessions-mode store cannot cold-start directly into a different generated
# pair. Start the old carrier, then let the ordinary authoring loop attach and
# provision the complete new schema/functions generation through ensureApp.
start_server $baseline_carrier $prepare_dir/deploy-spike-trace.jsonl
(
  cd $control_root
  SNAPBACK_RUNTIME_BINARY=$runtime_binary \
  SNAPBACK_OUTBOUND_ACTIONS=1 \
  ZERBUGS_TEST_DEFAULTS=1 \
  snapback dev snapback \
    --attach \
    --no-watch \
    --ready-file $ready_file \
    --db $database \
    >$deploy_log 2>&1
)
(
  cd $control_root
  bun -e '
    import {readFileSync, writeFileSync} from "node:fs";
    import {join} from "node:path";
    const [, root, output] = process.argv;
    const schema = JSON.parse(readFileSync(join(root, "snapback/generated/schema.manifest.json"), "utf8"));
    const functions = JSON.parse(readFileSync(join(root, "snapback/generated/functions.manifest.json"), "utf8"));
    writeFileSync(output, `${JSON.stringify({formatVersion: 1, schema, functions})}\n`, {mode: 0o600});
  ' $control_root $startup_artifacts
)
chmod 600 $startup_artifacts
stop_server

# The checked-out generated carrier must now be a valid cold-start pin for the
# deployed generation. The smoke below exercises that exact pairing.
start_server $startup_artifacts $spike_trace
(
  cd $control_root
  SNAPBACK_AUTHORITY_READY_FILE=$ready_file bun - <<'BUN'
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';

import {createExternalSessionClient} from '@expo/snapback-client';
import api from './snapback/generated/api.mjs';
import {mintDevSession} from './scripts/load-fixture.mts';

const readyFile = process.env.SNAPBACK_AUTHORITY_READY_FILE;
assert(readyFile, 'smoke ready file is present');
const minted = await mintDevSession(readyFile, 'zerobugs-authority-fixture@acceptance.invalid');
const client = createExternalSessionClient(minted.baseUrl, {
  bearerToken: minted.token,
  clientStoreId: 'zerobugs-authority-fixture',
  rqsStore: null,
});

async function eventually(label, check, timeoutMs = 180_000) {
  const deadline = performance.now() + timeoutMs;
  let last = null;
  while (performance.now() < deadline) {
    last = await check();
    if (last) return last;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`${label} timed out; last=${JSON.stringify(last)}`);
}

let handle = null;
try {
  console.log('AUTHORITY_PROBE_SMOKE step=open-live-query');
  let markLive;
  const becameLive = new Promise(resolve => { markLive = resolve; });
  handle = await client.liveQuery(api.allProjects, {
    connectionId: 'authority-fixture-smoke',
    args: {limit: 1, start: null},
    transport: 'stream',
    fallbackToPoll: false,
    onUpdate() {},
    onConnectionChange(connection) {
      if (connection === 'live') markLive();
    },
  });
  if (handle.connection !== 'live') {
    await Promise.race([
      becameLive,
      new Promise((_, reject) => setTimeout(
        () => reject(new Error('authority fixture live query did not become live')),
        120_000,
      )),
    ]);
  }

  const before = (await client.inspect()).liveAuthority;

  console.log('AUTHORITY_PROBE_SMOKE step=grant');
  const grant = await client.mutate(api.authorityProbeGrant, {
    args: {}, clientMutationId: 'authority-fixture-grant', queue: false,
  });
  const afterGrant = await eventually('grant fence/restoration', async () => {
    const stats = (await client.inspect()).liveAuthority;
    return stats.fencesApplied >= before.fencesApplied + 1
      && stats.restorationsCompleted >= before.restorationsCompleted + 1
      ? stats : null;
  });
  console.log('AUTHORITY_PROBE_SMOKE step=grant-retry');
  const grantRetry = await client.mutate(api.authorityProbeGrant, {
    args: {}, clientMutationId: 'authority-fixture-grant-retry', queue: false,
  });

  console.log('AUTHORITY_PROBE_SMOKE step=revoke');
  const revoke = await client.mutate(api.authorityProbeRevoke, {
    args: {}, clientMutationId: 'authority-fixture-revoke', queue: false,
  });
  const afterRevoke = await eventually('revoke fence/restoration', async () => {
    const stats = (await client.inspect()).liveAuthority;
    return stats.fencesApplied >= afterGrant.fencesApplied + 1
      && stats.restorationsCompleted >= afterGrant.restorationsCompleted + 1
      ? stats : null;
  });
  console.log('AUTHORITY_PROBE_SMOKE step=revoke-retry');
  const revokeRetry = await client.mutate(api.authorityProbeRevoke, {
    args: {}, clientMutationId: 'authority-fixture-revoke-retry', queue: false,
  });

  assert.equal(typeof grant.version, 'number');
  assert.equal(typeof revoke.version, 'number');
  assert(revoke.version > grant.version, 'revoke commits after grant');
  console.log(`AUTHORITY_PROBE_WRITE action=grant committedVersion=${grant.version}`);
  console.log(`AUTHORITY_PROBE_FENCE action=grant fencesApplied=${afterGrant.fencesApplied} restorationsCompleted=${afterGrant.restorationsCompleted}`);
  console.log(`AUTHORITY_PROBE_TOLERANCE action=grant-retry committedVersion=${grantRetry.version}`);
  console.log(`AUTHORITY_PROBE_WRITE action=revoke committedVersion=${revoke.version}`);
  console.log(`AUTHORITY_PROBE_FENCE action=revoke fencesApplied=${afterRevoke.fencesApplied} restorationsCompleted=${afterRevoke.restorationsCompleted}`);
  console.log(`AUTHORITY_PROBE_TOLERANCE action=revoke-retry committedVersion=${revokeRetry.version}`);
} finally {
  if (handle) {
    await handle.dispose();
    if (typeof handle.settled === 'function') await handle.settled();
  }
  await client.closeAuth();
}
BUN
)
stop_server

applied_count=$(jq -s '[.[] | select(.event == "fence" and .action == "applied")] | length' $spike_trace)
restored_count=$(jq -s '[.[] | select(.event == "fence" and .action == "restored")] | length' $spike_trace)
if (( applied_count < 2 || restored_count < 2 )); then
  print -u2 "authority fixture: expected at least two fence pairs; applied=$applied_count restored=$restored_count"
  exit 1
fi
print "AUTHORITY_PROBE_TRACE applied=$applied_count restored=$restored_count"
jq -c 'select(.event == "fence" and (.action == "applied" or .action == "restored"))' $spike_trace \
  | sed 's/^/AUTHORITY_PROBE_FENCE_EVENT /'

rm -f $baseline_carrier $deploy_log $server_log $spike_trace
rm -f $ready_file $ready_file.admin-token $ready_file.impersonation-capability
if [[ -e $database-wal || -e $database-shm ]]; then
  print -u2 'authority fixture: refusing to publish a fixture with SQLite sidecars'
  exit 1
fi
mv $prepare_dir $destination
prepare_dir=
trap - EXIT INT TERM
print "AUTHORITY_FIXTURE_READY path=$destination startupArtifacts=$destination/startup-artifacts.json sidecars=absent"
