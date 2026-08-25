#!/usr/bin/env bash
#
# Cold-clone check for the All Aboard Contract surface (ENG-22480, Diary 0010).
#
# Proves a stranger can build and verify this repo's external Contract surface
# from a clean clone alone — no sibling Exact checkout, no pin file, no
# floating HEAD. The red-team judge's remaining ship-React condition was
# exactly this: the acceptance suite skip-passes when Exact is absent, and
# nothing pins it in CI. Since ENG-22480 phase 2, Exact is consumed from the
# npm registry (`@exact/*` -> published `@ccheever/exact-*` via npm alias
# deps) and the surface's committed `bun.lock` IS the pin, so the lane is:
#
#   1. `bun install --frozen-lockfile` at the root for the Snapback workspace
#      source edges consumed by demos/_kit;
#   2. `bun install --frozen-lockfile` in the surface for Exact registry
#      packages (a lockfile that drifts from package.json fails, not resolves);
#   3. production-build the surface through the installed
#      `@exact/devtools/contract-web` preset;
#   4. run the 34-check browser acceptance with SNAPBACK_REQUIRE_EXACT=1 and
#      independently require >= 34 checks to have actually PASSed.
#
# Usage: scripts/cold-clone-check.sh
#
# Environment:
#   ALL_ABOARD_VITE_PORT  Vite port for the acceptance (default 5271, not 5178).
#   CHROME_BIN            Chrome binary (default: auto-detected).

set -euo pipefail

usage() {
    cat <<'EOF'
Usage: scripts/cold-clone-check.sh [--help]

Build and verify the All Aboard Contract surface from clean registry installs.

Environment:
  ALL_ABOARD_VITE_PORT  Vite port for acceptance (default: 5271).
  CHROME_BIN            Chrome/Chromium binary (default: auto-detected).
EOF
}

case "${1:-}" in
    --help|-h) [ "$#" -eq 1 ] || { usage >&2; exit 2; }; usage; exit 0 ;;
    '') ;;
    *) printf '[cold-clone] error: unknown argument: %s\n' "$1" >&2; usage >&2; exit 2 ;;
esac

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SURFACE_DIR="$ROOT/demos/all-aboard/surfaces/contract"
ACCEPTANCE="$ROOT/demos/all-aboard/tests/acceptance/browser.mjs"
MIN_CHECKS=34

VITE_PORT="${ALL_ABOARD_VITE_PORT:-5271}"

# This lane always owns a fresh isolated API and its helper-minted capability.
# Drop any caller credential before registry scripts, production build plugins,
# browser tooling, or other non-API children can inherit it.
unset SNAPBACK_ADMIN_TOKEN

log() {
    printf '[cold-clone] %s\n' "$*"
}

fail() {
    printf '[cold-clone] FAIL: %s\n' "$*" >&2
    exit 1
}

banner() {
    printf '\n[cold-clone] == %s ==\n' "$*"
}

run() {
    printf '[cold-clone] $'
    printf ' %q' "$@"
    printf '\n'
    "$@"
}

# Report wall-clock time of the big steps in the final summary.
STEP_TIMES=""
step_timer_start() {
    STEP_T0=$SECONDS
}
step_timer_end() {
    STEP_TIMES="${STEP_TIMES}[cold-clone]   $1: $((SECONDS - STEP_T0))s"$'\n'
}

# Bash /dev/tcp connect probe; the fd closes with the subshell.
port_busy() {
    (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null
}

detect_chrome() {
    if [ -n "${CHROME_BIN:-}" ]; then
        [ -x "$CHROME_BIN" ] || fail "CHROME_BIN=$CHROME_BIN is not executable"
        return 0
    fi
    case "$(uname -s | tr '[:upper:]' '[:lower:]')" in
        darwin)
            CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
            [ -x "$CHROME_BIN" ] || fail "Google Chrome not found at $CHROME_BIN; set CHROME_BIN"
            ;;
        *)
            local candidate
            for candidate in google-chrome google-chrome-stable chromium-browser chromium; do
                if command -v "$candidate" >/dev/null 2>&1; then
                    CHROME_BIN="$(command -v "$candidate")"
                    break
                fi
            done
            [ -n "${CHROME_BIN:-}" ] || fail "no Chrome/Chromium on PATH; set CHROME_BIN"
            ;;
    esac
    export CHROME_BIN
    log "using Chrome: $CHROME_BIN"
}

print_acceptance_report() {
    local report_path="$1"
    local report
    report="$(sed -n '/^--- machine-readable report ---$/,$p' "$report_path")"
    if [ -n "$report" ]; then
        printf '[cold-clone] machine-readable acceptance report:\n' >&2
        printf '%s\n' "$report" >&2
    else
        printf '[cold-clone] machine-readable acceptance report unavailable (marker missing)\n' >&2
    fi
}

fail_acceptance() {
    local report_path="$1"
    shift
    print_acceptance_report "$report_path"
    fail "$@"
}

# A fail-only probe for the reporting branch. It deliberately cannot produce a
# passing cold-clone verdict and lets the report contract be tested without the
# expensive clone/build/runtime setup.
if [ -n "${SNAPBACK_COLD_CLONE_REPORT_PROBE_LOG:-}" ]; then
    [ -r "$SNAPBACK_COLD_CLONE_REPORT_PROBE_LOG" ] \
        || fail "report probe log is not readable: $SNAPBACK_COLD_CLONE_REPORT_PROBE_LOG"
    fail_acceptance "$SNAPBACK_COLD_CLONE_REPORT_PROBE_LOG" \
        "injected browser acceptance failure (report probe)"
fi

for tool in git node bun cargo; do
    command -v "$tool" >/dev/null 2>&1 || fail "required tool missing: $tool"
done

# --- Snapback side: submodules + engine toolchain --------------------------
# browser.mjs's shared server lifecycle spawns `cargo run` from this repo root;
# that needs vendor/ibex (submodule) and its Hermes artifacts
# (bootstrap-ibex-runtime, the documented engine prep step — see AGENTS.md and
# verify-local-proof).

banner "Snapback engine prerequisites"
if [ ! -f "$ROOT/vendor/ibex/Cargo.toml" ]; then
    run git -C "$ROOT" submodule update --init --recursive
fi
# The cold-clone acceptance serves this exact checkout binary. Let the coded
# bootstrap perform its default link, loader-closure staging, launch, handler-VM
# qualification, and digest-bound readiness issuance before the harness trusts
# that binary. Disabling the check leaves Linux target/lib/libhermesvm.so
# unstaged even though the binary deliberately carries an $ORIGIN/../lib
# RUNPATH.
run "$ROOT/scripts/bootstrap-ibex-runtime"

# Pre-build the engine so the acceptance's 90 s /health deadline is spent on
# startup, not on a cold compile (the Diary 0008 "PASS — 0/0" scenario).
banner "Snapback engine build (cargo build)"
step_timer_start
(cd "$ROOT" && run cargo build)
step_timer_end "engine build (cargo build)"

# The surface imports Snapback through demos/_kit, which deliberately reaches
# the repository's package source. Prepare those workspace:* edges exactly as
# a clean contributor checkout does; publication staging separately rewrites
# them to exact versions inside released tarballs.
banner "bun install in the Snapback workspace (frozen lockfile)"
step_timer_start
(cd "$ROOT" && run bun install --frozen-lockfile)
step_timer_end "bun install (Snapback workspace)"

# --- Exact side: registry install pinned by the committed lockfile ----------
# ENG-22480 phase 2 retired the pinned-checkout mechanism: no Exact clone, no
# exact.pin.json, no SNAPBACK_EXACT_ROOT. `bun install --frozen-lockfile`
# resolves the npm alias deps (@exact/* -> @ccheever/exact-*@<version>) from
# the public registry at exactly the versions the committed bun.lock records.

banner "bun install in the Contract surface (registry, frozen lockfile)"
step_timer_start
(cd "$SURFACE_DIR" && run bun install --frozen-lockfile)
step_timer_end "bun install (surface)"
[ -f "$SURFACE_DIR/node_modules/@exact/contract/package.json" ] \
    || fail "@exact/contract missing from the surface node_modules after install"

# The acceptance must never skip-pass for missing Exact packages in this lane.
export SNAPBACK_REQUIRE_EXACT=1

# --- Snapback side: link the workspace so its data tier resolves -------------
# The surface imports the Snapback data tier from WORKSPACE source
# (packages/snapback-*), not the registry — only Exact is registry-pinned. Those
# workspace packages resolve their own workspace: deps (e.g. @expo/snapback-client ->
# @expo/snapback-contract) through the root install's node_modules linking, so a cold
# clone must link the workspace once before the surface build. Without it, the
# bare '@expo/snapback-contract/*' specifiers inside packages/snapback-client fail to
# resolve. This is a workspace link, not an Exact-registry dependency, so it does
# not weaken the registry isolation the surface's frozen install attests above.
banner "bun install at repo root (workspace link for the Snapback data tier)"
step_timer_start
(cd "$ROOT" && run bun install --frozen-lockfile)
step_timer_end "bun install (workspace)"

# --- Snapback side: materialize the codegen graph the surface build verifies -
# The digest-keyed codegen cache under demos/all-aboard/.snapback is ignored
# (since 6e080ca2 only the artifacts.json review manifest stays tracked), and
# the surface's Vite plugin verifies the graph fail-closed. A clean clone must
# regenerate it, and the regeneration must reproduce the committed review
# manifest byte for byte — drift fails the lane instead of resolving silently.
banner "Materialize the All Aboard codegen graph"
step_timer_start
(cd "$ROOT" && run env SNAPBACK_OUTBOUND_ACTIONS=1 \
    node packages/snapback-codegen/index.mjs demos/all-aboard/snapback)
(cd "$ROOT" && run git diff --exit-code -- \
    demos/all-aboard/snapback/generated/artifacts.json) \
    || fail "regenerating the All Aboard codegen graph drifted the committed review manifest"
step_timer_end "codegen graph"

# --- Step 1: production build ------------------------------------------------

banner "Step 1: production build of the Contract surface"
step_timer_start
(cd "$SURFACE_DIR" && run bun run build)
step_timer_end "surface build"
log "step 1 OK: production build passed from registry packages"

# --- Step 2: the 34-check browser acceptance --------------------------------

banner "Step 2: browser acceptance (${MIN_CHECKS} checks, Exact required)"

# Same platform library exports verify-local-proof uses for engine-spawning
# suites (browser.mjs only sets the darwin one itself).
case "$(uname -s | tr '[:upper:]' '[:lower:]')" in
    darwin)
        export DYLD_FRAMEWORK_PATH="$ROOT/vendor/ibex/ios/Frameworks:$ROOT/vendor/ibex/ios/Frameworks/macosx${DYLD_FRAMEWORK_PATH:+:$DYLD_FRAMEWORK_PATH}"
        ;;
    linux)
        export LD_LIBRARY_PATH="$ROOT/vendor/ibex/linux/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
        ;;
esac

detect_chrome

# The API is always a fresh port-zero child in this lane. Refuse only a Vite
# listener that the script did not start.
if port_busy "$VITE_PORT"; then
    fail "port $VITE_PORT is already in use; free it or set ALL_ABOARD_VITE_PORT"
fi

# BSD mktemp only substitutes trailing Xs — no suffix after the template.
ACCEPT_LOG="$(mktemp "${TMPDIR:-/tmp}/all-aboard-cold-clone.XXXXXX")"
log "acceptance log: $ACCEPT_LOG"
step_timer_start
# Capture the acceptance directly instead of streaming it through `tee`.
# Some nonblocking PTYs reject writes with EAGAIN while no reader is attached,
# which can make a passing suite look like a failed logging pipeline. The full
# report stays at ACCEPT_LOG; the independently validated summary is printed
# below. CI failures also receive a bounded human-readable tail.
set +e
env ALL_ABOARD_VITE_PORT="$VITE_PORT" \
    node "$ACCEPTANCE" >"$ACCEPT_LOG" 2>&1
acceptance_status=$?
set -e
step_timer_end "browser acceptance"

if grep -q 'SNAPBACK_CAPABILITY_EXACT_MISSING' "$ACCEPT_LOG"; then
    fail_acceptance "$ACCEPT_LOG" \
        "acceptance reported SNAPBACK_CAPABILITY_EXACT_MISSING — the cold-clone lane must never skip for missing Exact packages"
fi
if [ "$acceptance_status" -ne 0 ]; then
    if [ "${CI:-}" = "true" ]; then
        printf '[cold-clone] bounded acceptance output tail:\n' >&2
        sed '/^--- machine-readable report ---$/,$d' "$ACCEPT_LOG" \
            | tail -n 40 \
            | cut -c 1-500 >&2 \
            || true
    fi
    fail_acceptance "$ACCEPT_LOG" \
        "browser acceptance exited $acceptance_status; full output: $ACCEPT_LOG"
fi

# Independent count gate: trust the harness summary line
# ("PASS <title> — <passed>/<total>", demos/_kit/harness.mjs), not just the
# exit code — zero checks or a truncated run must not pass. The title's
# parens are escaped for ERE.
summary_line="$(grep -E '^(PASS|FAIL) all-aboard browser \(Phase 1\)' "$ACCEPT_LOG" | tail -1 || true)"
[ -n "$summary_line" ] \
    || fail_acceptance "$ACCEPT_LOG" "no harness summary line found in acceptance output"
counts="$(printf '%s\n' "$summary_line" | grep -oE '[0-9]+/[0-9]+$' || true)"
[ -n "$counts" ] \
    || fail_acceptance "$ACCEPT_LOG" "harness summary carries no check counts: '$summary_line'"
passed="${counts%/*}"
total="${counts#*/}"
case "$summary_line" in
    PASS*) : ;;
    *) fail_acceptance "$ACCEPT_LOG" "harness summary is not a PASS: '$summary_line'" ;;
esac
[ "$passed" -eq "$total" ] \
    || fail_acceptance "$ACCEPT_LOG" "only $passed/$total checks passed"
[ "$passed" -ge "$MIN_CHECKS" ] \
    || fail_acceptance "$ACCEPT_LOG" "ran $passed checks; expected at least $MIN_CHECKS"
log "step 2 OK: $passed/$total checks passed"

banner "Verdict"
printf '%s' "$STEP_TIMES"
log "COLD-CLONE CHECK PASS — registry install + production build + $passed/$total acceptance checks (bun.lock is the pin)"
