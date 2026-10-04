#!/usr/bin/env bash
# Run from snapback4/. eb1000 only; no remote execution or reduced test counts.
set -u
export LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT
out=$(pwd)/reports/20261002-qf-qualification-flakes/round9
phase() {
  local name=$1 status=0
  shift
  date -u +%FT%TZ >"$out/$name.started"
  "$@" >"$out/$name.log" 2>&1 || status=$?
  printf '%s\n' "$status" >"$out/$name.status"
  date -u +%FT%TZ >"$out/$name.finished"
  printf '%s: exit %s\n' "$name" "$status"
  return "$status"
}
focused() {
  node scripts/run-client-tests.mjs 1 files \
    packages/snapback4/test/test-processes.test.mjs \
    packages/snapback4/test/test-file-runner.test.mjs \
    packages/snapback4/test/replacement-fixture.test.mjs
}
focused_shim() (
  shim_dir=$(mktemp -d "${TMPDIR:-/tmp}/sb4-qf-r9-ps.XXXXXX")
  trap 'rm -rf "$shim_dir"' EXIT
  cp packages/snapback4/test/fixtures/process-tables/ps-nobody.sh "$shim_dir/ps"
  cat >>"$shim_dir/ps" <<'SHIM'
/bin/ps -p "$SB4_PS_NOBODY_PID" -o pid=,ppid=,pgid=,uid=,lstart=,stat=,comm= |
  awk '{$4 = "unreadable"; print}'
SHIM
  chmod +x "$shim_dir/ps"
  export PATH="$shim_dir:$PATH" SB4_PS_NOBODY_PID=$$
  export SB4_PS_SHIM_HITS="$out/focused-shim.hits"
  : >"$SB4_PS_SHIM_HITS"
  focused || exit $?
  test -s "$SB4_PS_SHIM_HITS"
)
phase focused-plain focused || exit $?
phase focused-shim focused_shim || exit $?
# The suite includes the three unshimmed client phases. Retain both broad
# verdicts even if one fails; each phase helper also reports every failure.
full_status=0
phase full-suite bash scripts/test.sh || full_status=$?
shim_status=0
export SB4_PS_SHIM_HITS="$out/uid-shim.hits"
: >"$SB4_PS_SHIM_HITS"
phase uid-shim bash reports/20261002-qf-qualification-flakes/round8/client-phases.sh \
  shim "$out/eb1000-shim" || shim_status=$?
test -s "$SB4_PS_SHIM_HITS" || shim_status=1
printf 'full-suite=%s uid-shim=%s\n' "$full_status" "$shim_status"
test "$full_status" = 0 && test "$shim_status" = 0
