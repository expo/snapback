#!/bin/zsh

set -euo pipefail
setopt EXTENDED_GLOB
unsetopt BG_NICE

if (( $# < 5 )); then
  print -u2 'usage: run-oq4-arm.sh <arm-name> <coalesce:on|off> <arrival-mode> <observer-count> <observer-partition> [extra harness flags]'
  exit 64
fi

arm_name=$1
coalesce=$2
arrival_mode=$3
observer_count=$4
observer_partition=$5
shift 5

if [[ $arm_name != [A-Za-z0-9._-]## ]]; then
  print -u2 'arm-name must contain only letters, digits, dot, underscore, or dash'
  exit 64
fi
if [[ $coalesce != on && $coalesce != off ]]; then
  print -u2 'coalesce must be on or off'
  exit 64
fi
if [[ $arrival_mode != fixed && $arrival_mode != settle-gated && $arrival_mode != sustained ]]; then
  print -u2 'arrival-mode must be fixed, settle-gated, or sustained'
  exit 64
fi
if [[ $observer_count != 0 && $observer_count != 1 && $observer_count != 6 ]]; then
  print -u2 'observer-count must be 0, 1, or 6'
  exit 64
fi
if [[ $observer_partition != mixed && $observer_partition != same ]]; then
  print -u2 'observer-partition must be mixed or same'
  exit 64
fi

script_dir=${0:A:h}
worktree=${script_dir:h:h:h:h}
control_root=${script_dir:h}
fixture_root=$worktree/demos/zerobugs/fixtures-local
fixture_variant=${OQ4_FIXTURE:-baseline}
authority_transitions=${OQ4_AUTHORITY_TRANSITIONS:-0}
observer_session=${OQ4_OBSERVER_SESSION:-distinct}
if [[ $fixture_variant == baseline ]]; then
  pristine=$fixture_root/oq4-clone
elif [[ $fixture_variant == authority ]]; then
  pristine=$fixture_root/oq4-clone-authority
else
  print -u2 'OQ4_FIXTURE must be baseline or authority'
  exit 64
fi
if [[ $authority_transitions != <-> ]]; then
  print -u2 'OQ4_AUTHORITY_TRANSITIONS must be a non-negative integer'
  exit 64
fi
if [[ $observer_session != shared && $observer_session != distinct ]]; then
  print -u2 'OQ4_OBSERVER_SESSION must be shared or distinct'
  exit 64
fi
if [[ $observer_session == shared && $observer_partition != same ]]; then
  print -u2 'OQ4_OBSERVER_SESSION=shared requires observer-partition same'
  exit 64
fi
runtime_binary=${SNAPBACK_RUNTIME_BINARY:-$worktree/target/debug/snapback}
arm_dir=$fixture_root/oq4-arms/$arm_name
work_dir=$arm_dir/work
database=$work_dir/diag.sqlite3
ready_file=$arm_dir/ready.json
server_trace=$arm_dir/server-trace.jsonl
client_trace=$arm_dir/client-trace.jsonl
server_log=$arm_dir/server.log
startup_artifacts=$work_dir/startup-artifacts.json
overlay=${OQ4_LARGE_OVERLAY:-$control_root/.snapback/large-fixture/large-overlay-v1.json}
server_pid=

mkdir -p $work_dir
rm -f $database $database-wal $database-shm $database.auth-keyring.json
rm -f $startup_artifacts $ready_file $server_trace $client_trace $server_log

# APFS clonefiles make the 8.5 GiB pristine fixture cheap while preserving an
# exact per-arm starting image.
cp -c $pristine/diag.sqlite3 $database
cp -c $pristine/diag.sqlite3.auth-keyring.json $database.auth-keyring.json
cp -c $pristine/startup-artifacts.json $startup_artifacts

cleanup() {
  local rc=$?
  trap - EXIT INT TERM
  if [[ -n ${server_pid:-} ]] && kill -0 $server_pid 2>/dev/null; then
    kill -TERM $server_pid 2>/dev/null || true
    wait $server_pid 2>/dev/null || true
  fi
  rm -f $database $database-wal $database-shm $database.auth-keyring.json
  rm -f $startup_artifacts $ready_file
  return $rc
}
trap cleanup EXIT INT TERM

typeset -a server_env
server_env=(
  SNAPBACK_OUTBOUND_ACTIONS=1
  ZERBUGS_TEST_DEFAULTS=1
  SNAPBACK_SPIKE_TRACE=$server_trace
)
if [[ $coalesce == off ]]; then
  server_env+=(SNAPBACK_LIVE_COALESCE_DISABLED=1)
fi
if [[ -n ${SNAPBACK_LIVE_SCHEDULER_DISABLED:-} ]]; then
  server_env+=(SNAPBACK_LIVE_SCHEDULER_DISABLED=$SNAPBACK_LIVE_SCHEDULER_DISABLED)
fi

env $server_env \
  $runtime_binary start \
  --port 0 \
  --db $database \
  --ready-file $ready_file \
  --startup-artifacts $startup_artifacts \
  >$server_log 2>&1 &
server_pid=$!

ready=0
for attempt in {1..240}; do
  if [[ -s $ready_file ]]; then
    ready=1
    break
  fi
  if ! kill -0 $server_pid 2>/dev/null; then
    print -u2 "arm $arm_name: server exited before readiness; see $server_log"
    exit 1
  fi
  sleep 0.5
done
if (( ! ready )); then
  print -u2 "arm $arm_name: readiness timed out; see $server_log"
  exit 1
fi

typeset -a cycle_flags
cycle_flags=()
if [[ $arrival_mode != sustained ]]; then
  cycle_flags=(--cycles 3)
fi
typeset -a authority_flags
authority_flags=()
if (( authority_transitions > 0 )); then
  authority_flags=(--authority-transitions $authority_transitions)
fi

if (
  cd $control_root
  ZBUGS_LARGE_OVERLAY_PATH=$overlay \
  OQ4_STARTUP_ARTIFACTS=$startup_artifacts \
  SNAPBACK_RUNTIME_BINARY=$runtime_binary \
  bun scripts/diag-hot-stream.mts \
    --ready-file $ready_file \
    --out $client_trace \
    --arrival-mode $arrival_mode \
    --observer-count $observer_count \
    --observer-partition $observer_partition \
    --observer-session $observer_session \
    --coalescing $coalesce \
    --cycle-offset 10 \
    $cycle_flags \
    $authority_flags \
    "$@"
); then
  harness_status=0
else
  harness_status=$?
fi

kill -TERM $server_pid 2>/dev/null || true
wait $server_pid 2>/dev/null || true
server_pid=

print "oq4 arm=$arm_name coalesce=$coalesce arrival=$arrival_mode observers=$observer_count partition=$observer_partition status=$harness_status output=$arm_dir"
exit $harness_status
