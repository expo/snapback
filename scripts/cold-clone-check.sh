#!/usr/bin/env bash
#
# Cold-clone check for the All Aboard Contract surface (ENG-22480, Diary 0010).
#
# Proves a stranger can build and verify this repo's external Contract surface
# from clean clones alone — no prepared sibling Exact checkout, no floating
# HEAD. The red-team judge's remaining ship-React condition was exactly this:
# the acceptance suite skip-passes when Exact is absent, and nothing pins it
# in CI. This lane makes "Exact missing" a hard failure:
#
#   1. obtain an Exact checkout at exactly the revision pinned in
#      demos/all-aboard/surfaces/contract/exact.pin.json, then bun install;
#   2. production-build the surface with EXACT_PIN_STRICT=1 (drift, absent,
#      invalid, or unverifiable pin = build failure);
#   3. run the 14-check browser acceptance with SNAPBACK_REQUIRE_EXACT=1 and
#      independently require >= 14 checks to have actually PASSed.
#
# Usage: scripts/cold-clone-check.sh
#
# Environment:
#   EXACT_CHECKOUT_DIR    Existing Exact clone to use (CI passes the
#                         actions/checkout path). The script fetches and checks
#                         out the pinned revision IN THAT CLONE (detached HEAD)
#                         and refuses if tracked files are dirty.
#   EXACT_CLONE_WORK_DIR  Where to clone Exact when EXACT_CHECKOUT_DIR is
#                         unset. Default:
#                         ${XDG_CACHE_HOME:-$HOME/.cache}/snapback/cold-clone/exact
#   EXACT_REPO_URL        Clone URL (default https://github.com/ccheever/exact).
#   EXACT_CLONE_TOKEN     GitHub token for the clone/fetch (the repo is
#                         private). Local runs normally rely on ambient git
#                         credentials; CI can pass a PAT instead.
#   ALL_ABOARD_API_PORT   Snapback API port for the acceptance (default 4471 —
#                         deliberately NOT the demo default 4420: the suite
#                         reuses whatever answers /health on the port, and a
#                         foreign checkout's engine squatting the default is
#                         the Diary 0008 trap).
#   ALL_ABOARD_VITE_PORT  Vite port for the acceptance (default 5271, not 5178).
#   CHROME_BIN            Chrome binary (default: auto-detected).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PIN_FILE="$ROOT/demos/all-aboard/surfaces/contract/exact.pin.json"
SURFACE_DIR="$ROOT/demos/all-aboard/surfaces/contract"
ACCEPTANCE="$ROOT/demos/all-aboard/tests/acceptance/browser.mjs"
MIN_CHECKS=14

EXACT_REPO_URL="${EXACT_REPO_URL:-https://github.com/ccheever/exact}"
API_PORT="${ALL_ABOARD_API_PORT:-4471}"
VITE_PORT="${ALL_ABOARD_VITE_PORT:-5271}"

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

# git invocation against the Exact remote, with optional token auth. The
# token rides an ephemeral per-invocation header (never persisted to the
# clone's .git/config, so a cached work dir does not retain credentials).
git_exact() {
    if [ -n "${EXACT_CLONE_TOKEN:-}" ]; then
        local basic
        basic="$(printf 'x-access-token:%s' "$EXACT_CLONE_TOKEN" | base64 | tr -d '\n')"
        git -c "http.https://github.com/.extraheader=AUTHORIZATION: basic $basic" "$@"
    else
        git "$@"
    fi
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

for tool in git node bun cargo; do
    command -v "$tool" >/dev/null 2>&1 || fail "required tool missing: $tool"
done

[ -f "$PIN_FILE" ] || fail "pin file missing: $PIN_FILE"
PIN_SHA="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).revision' "$PIN_FILE")"
printf '%s' "$PIN_SHA" | grep -Eq '^[0-9a-f]{40}$' || fail "pin revision in $PIN_FILE is not a 40-char sha: '$PIN_SHA'"
log "pinned Exact revision: $PIN_SHA"

# --- Snapback side: submodules + engine toolchain --------------------------
# browser.mjs's ensureApi spawns `cargo run` from this repo root; that needs
# vendor/ibex (submodule) and its Hermes artifacts (bootstrap-ibex-runtime,
# the documented engine prep step — see AGENTS.md and verify-local-proof).

banner "Snapback engine prerequisites"
if [ ! -f "$ROOT/vendor/ibex/Cargo.toml" ]; then
    run git -C "$ROOT" submodule update --init --recursive
fi
run env SNAPBACK_BOOTSTRAP_CHECK="${SNAPBACK_BOOTSTRAP_CHECK:-0}" "$ROOT/scripts/bootstrap-ibex-runtime"

# Pre-build the engine so the acceptance's 90 s /health deadline is spent on
# startup, not on a cold compile (the Diary 0008 "PASS — 0/0" scenario).
banner "Snapback engine build (cargo build)"
step_timer_start
(cd "$ROOT" && run cargo build)
step_timer_end "engine build (cargo build)"

# --- Exact side: checkout at the pin + bun install --------------------------

banner "Exact checkout at the pinned revision"
step_timer_start
if [ -n "${EXACT_CHECKOUT_DIR:-}" ]; then
    EXACT_ROOT="$(cd "$EXACT_CHECKOUT_DIR" 2>/dev/null && pwd)" \
        || fail "EXACT_CHECKOUT_DIR=$EXACT_CHECKOUT_DIR does not exist"
    git -C "$EXACT_ROOT" rev-parse --git-dir >/dev/null 2>&1 \
        || fail "EXACT_CHECKOUT_DIR=$EXACT_ROOT is not a git clone"
    if [ -n "$(git -C "$EXACT_ROOT" status --porcelain --untracked-files=no)" ]; then
        fail "refusing to move EXACT_CHECKOUT_DIR=$EXACT_ROOT: tracked files are dirty"
    fi
    head_sha="$(git -C "$EXACT_ROOT" rev-parse HEAD 2>/dev/null || true)"
    if [ "$head_sha" = "$PIN_SHA" ]; then
        log "existing checkout already at the pin"
    else
        log "existing checkout at $head_sha; fetching + checking out the pin (detached)"
        if ! git -C "$EXACT_ROOT" cat-file -e "$PIN_SHA^{commit}" 2>/dev/null; then
            run git_exact -C "$EXACT_ROOT" fetch --depth 1 origin "$PIN_SHA" \
                || run git_exact -C "$EXACT_ROOT" fetch origin
        fi
        run git -C "$EXACT_ROOT" checkout --detach "$PIN_SHA"
    fi
else
    EXACT_ROOT="${EXACT_CLONE_WORK_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/snapback/cold-clone/exact}"
    mkdir -p "$EXACT_ROOT"
    EXACT_ROOT="$(cd "$EXACT_ROOT" && pwd)"
    if [ ! -e "$EXACT_ROOT/.git" ]; then
        # Shallow-fetch just the pinned commit (the actions/checkout pattern);
        # the repo is large and history is not needed.
        run git init -q "$EXACT_ROOT"
        run git -C "$EXACT_ROOT" remote add origin "$EXACT_REPO_URL"
    else
        remote_url="$(git -C "$EXACT_ROOT" remote get-url origin 2>/dev/null || true)"
        [ "$remote_url" = "$EXACT_REPO_URL" ] \
            || fail "work dir $EXACT_ROOT has origin '$remote_url', expected '$EXACT_REPO_URL'; delete it or set EXACT_CLONE_WORK_DIR elsewhere"
        if [ -n "$(git -C "$EXACT_ROOT" status --porcelain --untracked-files=no)" ]; then
            fail "cached work dir $EXACT_ROOT has dirty tracked files; delete it and re-run"
        fi
    fi
    if [ "$(git -C "$EXACT_ROOT" rev-parse HEAD 2>/dev/null || true)" = "$PIN_SHA" ]; then
        log "cached work-dir clone already at the pin"
    else
        if ! git -C "$EXACT_ROOT" cat-file -e "$PIN_SHA^{commit}" 2>/dev/null; then
            run git_exact -C "$EXACT_ROOT" fetch --depth 1 origin "$PIN_SHA" \
                || run git_exact -C "$EXACT_ROOT" fetch origin
        fi
        run git -C "$EXACT_ROOT" checkout --detach "$PIN_SHA"
    fi
fi
[ "$(git -C "$EXACT_ROOT" rev-parse HEAD)" = "$PIN_SHA" ] || fail "Exact checkout is not at the pin after checkout"
[ -d "$EXACT_ROOT/packages/exact-contract" ] || fail "$EXACT_ROOT does not look like an Exact checkout (no packages/exact-contract)"

# Exact's own documented post-clone step: the exact-runtime-js workspace
# package resolves @ibex/runtime-js from the vendor/ibex submodule
# (file:../../vendor/ibex/...), so `bun install` fails without it. Idempotent:
# no-op (and no network) when the recorded revision is already checked out.
run git_exact -C "$EXACT_ROOT" submodule update --init --depth 1 vendor/ibex \
    || run git_exact -C "$EXACT_ROOT" submodule update --init vendor/ibex
step_timer_end "exact checkout"
log "Exact root: $EXACT_ROOT"

banner "bun install in the Exact checkout"
step_timer_start
# Frozen lockfile: the pin names one revision, so the lockfile at that
# revision is the dependency truth; drift here should fail, not resolve.
(cd "$EXACT_ROOT" && run bun install --frozen-lockfile)
step_timer_end "bun install (exact)"

export SNAPBACK_EXACT_ROOT="$EXACT_ROOT"
export EXACT_PIN_STRICT=1
export SNAPBACK_REQUIRE_EXACT=1

# --- Step 1: pin-strict production build ------------------------------------

banner "Step 1: pin-strict production build of the Contract surface"
step_timer_start
(cd "$SURFACE_DIR" && run bun run build)
step_timer_end "surface build (pin-strict)"
log "step 1 OK: production build passed with EXACT_PIN_STRICT=1"

# --- Step 2: the 14-check browser acceptance --------------------------------

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

# The suite reuses any healthy server already on its ports — refuse to run
# against something this script did not start.
for port in "$API_PORT" "$VITE_PORT"; do
    if port_busy "$port"; then
        fail "port $port is already in use; free it or set ALL_ABOARD_API_PORT/ALL_ABOARD_VITE_PORT"
    fi
done

# BSD mktemp only substitutes trailing Xs — no suffix after the template.
ACCEPT_LOG="$(mktemp "${TMPDIR:-/tmp}/all-aboard-cold-clone.XXXXXX")"
log "acceptance log: $ACCEPT_LOG"
step_timer_start
acceptance_status=0
env ALL_ABOARD_API_PORT="$API_PORT" ALL_ABOARD_VITE_PORT="$VITE_PORT" \
    node "$ACCEPTANCE" 2>&1 | tee "$ACCEPT_LOG" || acceptance_status=$?
step_timer_end "browser acceptance"

if grep -q 'SNAPBACK_CAPABILITY_EXACT_MISSING' "$ACCEPT_LOG"; then
    fail "acceptance reported SNAPBACK_CAPABILITY_EXACT_MISSING — the cold-clone lane must never skip for a missing Exact"
fi
[ "$acceptance_status" -eq 0 ] || fail "browser acceptance exited $acceptance_status"

# Independent count gate: trust the harness summary line
# ("PASS <title> — <passed>/<total>", demos/_kit/harness.mjs), not just the
# exit code — zero checks or a truncated run must not pass. The title's
# parens are escaped for ERE.
summary_line="$(grep -E '^(PASS|FAIL) all-aboard browser \(Phase 1\)' "$ACCEPT_LOG" | tail -1 || true)"
[ -n "$summary_line" ] || fail "no harness summary line found in acceptance output"
counts="$(printf '%s\n' "$summary_line" | grep -oE '[0-9]+/[0-9]+$' || true)"
[ -n "$counts" ] || fail "harness summary carries no check counts: '$summary_line'"
passed="${counts%/*}"
total="${counts#*/}"
case "$summary_line" in
    PASS*) : ;;
    *) fail "harness summary is not a PASS: '$summary_line'" ;;
esac
[ "$passed" -eq "$total" ] || fail "only $passed/$total checks passed"
[ "$passed" -ge "$MIN_CHECKS" ] || fail "ran $passed checks; expected at least $MIN_CHECKS"
log "step 2 OK: $passed/$total checks passed"

banner "Verdict"
printf '%s' "$STEP_TIMES"
log "COLD-CLONE CHECK PASS — pin-strict build + $passed/$total acceptance checks against Exact $PIN_SHA"
