#!/usr/bin/env bash
# Run from snapback4/, after the same builds that precede clients in test.sh.
# These are the suite's three client invocations, with its selection and pool.
# No reduced seeds, name filters, skips, or guard overrides.
set -u
mode=${1:?usage: bash client-phases.sh plain-or-shim output-directory}
out=${2:?output-directory}
mkdir -p "$out"
out=$(cd "$out" && pwd)
shim_dir=
if [ "$mode" = shim ]; then
  shim_dir=$(mktemp -d "${TMPDIR:-/tmp}/sb4-qf-r8-ps.XXXXXX")
  cp packages/snapback4/test/fixtures/process-tables/ps-nobody.sh "$shim_dir/ps"
  chmod +x "$shim_dir/ps"
  export PATH="$shim_dir:$PATH"
  # This script is our live fixture process. Also exercise uid -2 when 889
  # does not exist; the exact distnoted row is appended in either case.
  export SB4_PS_NOBODY_PID=$$
elif [ "$mode" != plain ]; then
  echo "unknown mode: $mode" >&2; exit 2
fi
trap '[ -z "$shim_dir" ] || rm -rf "$shim_dir"' EXIT
failures=0
phase() {
  local name=$1 status=0
  shift
  date -u +%FT%TZ >"$out/$name.started"
  "$@" >"$out/$name.log" 2>&1 || status=$?
  echo "$status" >"$out/$name.status"
  date -u +%FT%TZ >"$out/$name.finished"
  echo "$name: exit $status"
  if [ "$status" != 0 ]; then failures=$((failures + 1)); fi
}
phase fixture-tests node scripts/run-client-tests.mjs 1 files fixtures/
client_test_cpus=$(node -p 'require("node:os").availableParallelism()')
client_test_concurrency=1
if [ "${SNAPBACK4_TEST_SERIAL_CLIENT_FILES:-0}" != 1 ]; then
  client_test_concurrency=$((client_test_cpus / 3))
  if [ "$client_test_concurrency" -lt 1 ]; then client_test_concurrency=1; fi
  if [ "$client_test_concurrency" -gt 24 ]; then client_test_concurrency=24; fi
fi
client_files=()
for path in packages/snapback4/test/*.test.mjs; do
  case "$(basename "$path")" in
    app-session-model.test.mjs|online-client-model.test.mjs) ;;
    *) client_files+=("$path") ;;
  esac
done
printf '%s\n' "CPUs=$client_test_cpus concurrency=$client_test_concurrency files=${#client_files[@]}" >"$out/pool.txt"
phase client-tests node scripts/run-client-tests.mjs "$client_test_concurrency" files "${client_files[@]}"
phase client-models node scripts/run-client-tests.mjs 1 models \
  packages/snapback4/test/app-session-model.test.mjs \
  packages/snapback4/test/online-client-model.test.mjs
printf '== %s client phase failure(s) (%s)\n' "$failures" "$mode"
[ "$failures" = 0 ]
