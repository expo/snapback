#!/usr/bin/env bash
# Honor both the commissioned selector run and its explicit lane scope limits.
# Blocked steps return 95; the selector receipt must not be reported as green.
set -euo pipefail
export PATH="/home/ccheever/.bun-1.4.2/bin:$PATH"
repo=$(git rev-parse --show-toplevel)
secp_guard_dir=$(mktemp -d /tmp/secp-affected-scope.XXXXXX)
trap 'rm -rf "$secp_guard_dir"' EXIT
export SECP_REAL_CARGO=$(command -v cargo)
export SECP_REAL_NODE=$(command -v node)
cat > "$secp_guard_dir/cargo" <<'GUARD'
#!/usr/bin/env bash
set -euo pipefail
if [[ ${1:-} == test ]]; then
  secp_package=''
  secp_previous=''
  for secp_arg in "$@"; do
    if [[ $secp_previous == -p || $secp_previous == --package ]]; then secp_package=$secp_arg; fi
    secp_previous=$secp_arg
  done
  case "$secp_package" in snapback4|snapback4-lang) ;; *)
    echo "SECP_SCOPE_BLOCK: $secp_package whole-crate tests belong to integration; lane explicitly forbids the full crate suite." >&2
    exit 95;; esac
fi
if [[ ${1:-} == run && " $* " == *' snapback4-difftest '* ]]; then
  echo 'SECP_SCOPE_BLOCK: no language/planner/store semantics changed; broad differential qualification belongs to integration.' >&2
  exit 95
fi
exec "$SECP_REAL_CARGO" "$@"
GUARD
cat > "$secp_guard_dir/node" <<'GUARD'
#!/usr/bin/env bash
set -euo pipefail
if [[ ${1:-} == *run-client-tests.mjs && ( $# -gt 12 || ${3:-} == models ) ]]; then
  echo 'SECP_SCOPE_BLOCK: full client pool/model battery is prohibited by the lane brief; no client implementation changed.' >&2
  exit 95
fi
exec "$SECP_REAL_NODE" "$@"
GUARD
cat > "$secp_guard_dir/lake" <<'GUARD'
#!/usr/bin/env bash
echo 'SECP_SCOPE_BLOCK: no Lean/language/planner/store semantics changed; broad oracle build belongs to integration.' >&2
exit 95
GUARD
chmod +x "$secp_guard_dir/cargo" "$secp_guard_dir/node" "$secp_guard_dir/lake"
cd "$repo"
PATH="$secp_guard_dir:$PATH" CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 \
  timeout 10800s node snapback4/scripts/affected.mjs --base origin/main --run
