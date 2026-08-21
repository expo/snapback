#!/usr/bin/env bash

# Named, dependency-aware gate execution for repository proofs.
# @ref LLP 0175#d1--make-keep-going-dependency-aware — preserve independent
# feedback while replacing failed-producer timeout cascades with BLOCKED.
#
# The caller remains responsible for `set -e` and calls:
#   proof_runner_init <proof-id> <jsonl-output> <keep-going:0|1> \
#     <selected-gates-file> <expected-count> <expected-sha256>
#   proof_runner_declare_inapplicable <gate-id> <predicate-id>
#   proof_gate <gate-id> [--requires <comma-separated-gate-ids>]
#       [--timeout-seconds <positive-integer>] -- <command...>
#   proof_not_selected <gate-id> <reason>
#   proof_inapplicable <gate-id> <predicate-id> <evidence-json>
#   proof_runner_finish
# The public entrypoint additionally calls:
#   proof_runner_supervise <proof-name> <results> <selected-snapshot> \
#     <expected-count> <expected-digest> -- <proof-body-command...>
#
# Bash 3.2 compatibility is deliberate: macOS agents use the system Bash.
# Gate commands run in a subshell and must communicate durable effects through
# files/processes, not mutations to the proof shell. The canonical shell's one
# function-valued gate (`build_current_binary`) already follows that contract.

PROOF_RUNNER_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROOF_GATE_IDS=()
PROOF_GATE_STATES=()
PROOF_GATE_COMMANDS=()
PROOF_GATE_PREREQUISITES=()
PROOF_GATE_BLOCKED_BY=()
PROOF_GATE_EXIT_CODES=()
PROOF_SELECTED_GATE_IDS=()
PROOF_INAPPLICABLE_GATE_IDS=()
PROOF_INAPPLICABLE_PREDICATES=()

proof_now_ms() {
    if command -v perl >/dev/null 2>&1; then
        perl -MTime::HiRes=time -e 'printf "%.0f", time * 1000'
    else
        python3 -c 'import time; print(time.time_ns() // 1_000_000)'
    fi
}

proof_resolve_gate_timeout_seconds() {
    local gate_id="$1" gate_override="$2" gate_override_set="$3"
    local timeout_seconds=""
    if [ "${SNAPBACK_PROOF_GATE_TIMEOUT_SECONDS+x}" = "x" ]; then
        timeout_seconds="$SNAPBACK_PROOF_GATE_TIMEOUT_SECONDS"
    elif [ "$gate_override_set" = "1" ]; then
        timeout_seconds="$gate_override"
    else
        timeout_seconds=3600
    fi
    node "$PROOF_RUNNER_ROOT/scripts/lib/proof-timeout.mjs" \
        --label "gate $gate_id timeout" "$timeout_seconds"
}

proof_resolve_nonnegative_duration_seconds() {
    local label="$1" value="$2"
    node "$PROOF_RUNNER_ROOT/scripts/lib/proof-timeout.mjs" \
        --allow-zero --label "$label" "$value"
}

proof_gate_process_group_alive() {
    kill -0 -- "-$1" 2>/dev/null
}

proof_signal_gate_process_group() {
    local signal="$1" process_group="$2"
    kill "-$signal" -- "-$process_group" 2>/dev/null || \
        kill "-$signal" "$process_group" 2>/dev/null || true
}

# Put the asynchronous command in its own process group using Bash job control,
# which is available in the stock macOS Bash 3.2. A deadline signals that group.
# A descendant may deliberately escape with setsid(); signal-aware acceptance
# cleanups own known detached resources, and the capture path below fails loudly
# when an unknown escaped writer keeps a result pipe open.
proof_run_gate_with_timeout() {
    local gate_id="$1" timeout_seconds="$2" command_pid="" command_status=0
    local poll_count=0 timeout_polls=$((timeout_seconds * 4)) timed_out=0
    local term_grace_seconds=5
    local term_grace_polls=0 monitor_was_enabled=0
    shift 2

    PROOF_GATE_LAST_TIMED_OUT=0
    PROOF_GATE_LAST_TIMEOUT_CLEANUP_FAILED=0
    if [ "${SNAPBACK_PROOF_GATE_TERM_GRACE_SECONDS+x}" = "x" ]; then
        term_grace_seconds="$SNAPBACK_PROOF_GATE_TERM_GRACE_SECONDS"
    fi
    term_grace_seconds="$(proof_resolve_nonnegative_duration_seconds \
        "gate $gate_id TERM grace" "$term_grace_seconds")" || return $?
    term_grace_polls=$((term_grace_seconds * 4))

    case "$-" in *m*) monitor_was_enabled=1 ;; esac
    if [ "$monitor_was_enabled" -eq 0 ]; then set -m; fi
    (PROOF_RUNNER_GATE_SUBSHELL=1; set -euo pipefail; proof_gate_subshell_prepare; "$@") &
    command_pid=$!
    if [ "$monitor_was_enabled" -eq 0 ]; then set +m; fi

    while kill -0 "$command_pid" 2>/dev/null; do
        if [ "$poll_count" -ge "$timeout_polls" ]; then
            timed_out=1
            break
        fi
        sleep 0.25
        poll_count=$((poll_count + 1))
    done

    if [ "$timed_out" -eq 0 ]; then
        if wait "$command_pid"; then
            return 0
        else
            command_status=$?
            return "$command_status"
        fi
    fi

    PROOF_GATE_LAST_TIMED_OUT=1
    printf 'SNAPBACK_PROOF_GATE_TIMEOUT: gate=%s timeout_seconds=%s signal=TERM\n' \
        "$gate_id" "$timeout_seconds" >&2
    proof_signal_gate_process_group TERM "$command_pid"

    poll_count=0
    while proof_gate_process_group_alive "$command_pid" && \
        [ "$poll_count" -lt "$term_grace_polls" ]; do
        sleep 0.25
        poll_count=$((poll_count + 1))
    done
    if proof_gate_process_group_alive "$command_pid"; then
        printf 'SNAPBACK_PROOF_GATE_TIMEOUT: gate=%s timeout_seconds=%s signal=KILL\n' \
            "$gate_id" "$timeout_seconds" >&2
        proof_signal_gate_process_group KILL "$command_pid"
    fi

    poll_count=0
    while proof_gate_process_group_alive "$command_pid" && [ "$poll_count" -lt 20 ]; do
        sleep 0.25
        poll_count=$((poll_count + 1))
    done
    if proof_gate_process_group_alive "$command_pid"; then
        PROOF_GATE_LAST_TIMEOUT_CLEANUP_FAILED=1
        printf 'SNAPBACK_PROOF_GATE_TIMEOUT_CLEANUP_FAILED: gate=%s process_group=%s\n' \
            "$gate_id" "$command_pid" >&2
    elif ! kill -0 "$command_pid" 2>/dev/null; then
        # The child is already gone, so this wait only reaps its cached status.
        wait "$command_pid" 2>/dev/null || true
    fi
    return 124
}

proof_file_sha256() {
    node -e '
const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");
process.stdout.write(`sha256:${createHash("sha256").update(readFileSync(process.argv[1])).digest("hex")}`);
' "$1"
}

proof_fd_sha256() {
    node -e '
const { createHash } = require("node:crypto");
const { fstatSync, readSync } = require("node:fs");
const fd = Number(process.argv[1]);
const size = Number(fstatSync(fd).size);
const bytes = Buffer.alloc(size);
let offset = 0;
while (offset < size) offset += readSync(fd, bytes, offset, size - offset, offset);
process.stdout.write(`sha256:${createHash("sha256").update(bytes).digest("hex")}`);
' "$1"
}

proof_canonical_path() {
    node -e '
const { lstatSync, readlinkSync, realpathSync } = require("node:fs");
const { dirname, isAbsolute, join, resolve } = require("node:path");

function canonical(path, seen = new Set()) {
  const absolute = resolve(path);
  try {
    return realpathSync(absolute);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  let stat;
  try {
    stat = lstatSync(absolute);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return join(realpathSync(dirname(absolute)), absolute.slice(dirname(absolute).length + 1));
  }
  if (!stat.isSymbolicLink()) return absolute;
  if (seen.has(absolute)) throw new Error(`symlink cycle at ${absolute}`);
  seen.add(absolute);
  const target = readlinkSync(absolute);
  return canonical(isAbsolute(target) ? target : resolve(dirname(absolute), target), seen);
}

process.stdout.write(`${canonical(process.argv[1])}\n`);
' "$1"
}

proof_path_is_descriptor_pseudo() {
    case "$1" in
        /dev/stdin|/dev/fd/*|/proc/*/fd/*) return 0 ;;
    esac
    return 1
}

proof_selected_snapshot_path() {
    printf '%s.selected-gates\n' "$1"
}

proof_runner_invalidate_retained_evidence() {
    if [ "$#" -ne 2 ]; then
        printf '[snapback-proof] retained evidence invalidation expects completion and results paths\n' >&2
        return 2
    fi
    local retained_completion="$1" results_path="$2" invalidation_failed=0
    if [ -n "$retained_completion" ] && ! rm -f -- "$retained_completion"; then
        printf '[snapback-proof] could not invalidate retained completion receipt: %s\n' \
            "$retained_completion" >&2
        invalidation_failed=1
    fi
    if ! rm -f -- "$results_path"; then
        printf '[snapback-proof] could not invalidate retained proof results: %s\n' \
            "$results_path" >&2
        invalidation_failed=1
    fi
    [ "$invalidation_failed" -eq 0 ] || return 2
}

proof_swift_available() {
    command -v swift >/dev/null 2>&1 && swift --version >/dev/null 2>&1
}

proof_runner_set_phase() {
    PROOF_RUNNER_PHASE="$1"
    if [ -n "${PROOF_RUNNER_PHASE_PATH:-}" ]; then
        local phase_tmp="${PROOF_RUNNER_PHASE_PATH}.tmp.$$"
        printf '%s\n' "$PROOF_RUNNER_PHASE" > "$phase_tmp" || return $?
        mv -f -- "$phase_tmp" "$PROOF_RUNNER_PHASE_PATH" || return $?
    fi
}

# The supervisor is deliberately outside the proof body. The child token proves
# only that finish reached its write-only descriptor. The parent independently
# derives completion from the selector-bound snapshot and JSONL ledger.
proof_runner_supervise() {
    if [ "$#" -lt 7 ] || [ "$6" != "--" ]; then
        printf '[snapback-proof] proof_runner_supervise expects proof name, results path, selected snapshot path, expected count/digest, --, and a body command\n' >&2
        return 2
    fi
    local proof_name="$1" supervision_root="" supervision_dir=""
    local results_path="$2" selected_snapshot_path="$3"
    local expected_selected_count="$4" expected_selected_digest="$5"
    local completion_path="" derived_completion_path="" phase_path="" run_id=""
    local child_status=0 token_status=0 last_phase="entry" had_errexit=0
    local retained_completion="${SNAPBACK_PROOF_COMPLETION_RECEIPT:-}"
    local private_completion_fd=19
    shift 6

    proof_runner_invalidate_retained_evidence "$retained_completion" "$results_path" \
        || return $?

    case "$expected_selected_count" in
        ''|*[!0-9]*)
            printf '[snapback-proof] supervisor expected selected count must be a non-negative integer\n' >&2
            return 2
            ;;
    esac
    case "$expected_selected_digest" in sha256:*) ;;
        *)
            printf '[snapback-proof] supervisor expected selected digest must be sha256 hex\n' >&2
            return 2
            ;;
    esac
    local expected_selected_hex="${expected_selected_digest#sha256:}"
    case "$expected_selected_hex" in ''|*[!0-9a-f]*)
        printf '[snapback-proof] supervisor expected selected digest must be sha256 hex\n' >&2
        return 2
        ;;
    esac
    if [ "${#expected_selected_hex}" -ne 64 ]; then
        printf '[snapback-proof] supervisor expected selected digest must contain exactly 64 hex digits\n' >&2
        return 2
    fi

    supervision_root="${SNAPBACK_PROOF_SUPERVISION_ROOT:-$PROOF_RUNNER_ROOT/target/proof}"
    mkdir -p "$supervision_root" || return $?
    supervision_dir="$(mktemp -d "$supervision_root/.${proof_name}-supervision.XXXXXX")" \
        || return $?
    completion_path="$supervision_dir/completion.json"
    derived_completion_path="$supervision_dir/parent-derived-completion.json"
    phase_path="$supervision_dir/phase"
    run_id="$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')" || {
        rm -rf -- "$supervision_dir"
        return 2
    }
    printf '%s\n' "$last_phase" > "$phase_path" || {
        rm -rf -- "$supervision_dir"
        return 2
    }
    if [ -n "$retained_completion" ]; then
        mkdir -p "$(dirname "$retained_completion")" || {
            rm -rf -- "$supervision_dir"
            return 2
        }
    fi

    case "$-" in *e*) had_errexit=1; set +e ;; esac
    env -u SNAPBACK_PROOF_COMPLETION_RECEIPT \
        PROOF_RUNNER_SUPERVISED=1 \
        PROOF_RUNNER_COMPLETION_FD="$private_completion_fd" \
        PROOF_RUNNER_PHASE_PATH="$phase_path" \
        PROOF_RUNNER_RUN_ID="$run_id" \
        "$@" 19> "$completion_path"
    child_status=$?
    node -e '
const { createHash } = require("node:crypto");
const { readFileSync, writeFileSync } = require("node:fs");
const [
  tokenPath,
  resultsPath,
  selectedPath,
  expectedRunId,
  expectedProofName,
  expectedCountText,
  expectedDigest,
  derivedPath,
] = process.argv.slice(1);
const token = JSON.parse(readFileSync(tokenPath, "utf8"));
if (!token || typeof token !== "object" || Array.isArray(token)
  || JSON.stringify(Object.keys(token).sort()) !== JSON.stringify(["runId", "schemaVersion"])
  || token.schemaVersion !== "snapback.proof-child-completion.v1"
  || token.runId !== expectedRunId) process.exit(2);

const selectedSource = readFileSync(selectedPath);
const selectedDigest = `sha256:${createHash("sha256").update(selectedSource).digest("hex")}`;
const selectedText = selectedSource.toString("utf8");
if (selectedText.length > 0 && !selectedText.endsWith("\n")) process.exit(2);
const selectedGateIds = selectedText.split("\n").filter((value) => value !== "");
const expectedCount = Number(expectedCountText);
if (!Number.isSafeInteger(expectedCount) || expectedCount < 0
  || selectedGateIds.length !== expectedCount
  || selectedDigest !== expectedDigest
  || selectedGateIds.some((value) => !/^[a-z0-9-]+$/u.test(value))
  || new Set(selectedGateIds).size !== selectedGateIds.length) process.exit(2);

const resultsSource = readFileSync(resultsPath);
const resultsDigest = `sha256:${createHash("sha256").update(resultsSource).digest("hex")}`;
const records = resultsSource.toString("utf8").split(/\r?\n/u).filter((line) => line !== "")
  .map((line) => JSON.parse(line));
const byId = new Map();
for (const record of records) {
  if (!record || typeof record !== "object" || Array.isArray(record)
    || record.schemaVersion !== "snapback.proof-gate-result.v3"
    || record.proofId !== expectedProofName
    || typeof record.gateId !== "string"
    || !/^[a-z0-9-]+$/u.test(record.gateId)
    || byId.has(record.gateId)) process.exit(2);
  byId.set(record.gateId, record);
}
for (const gateId of selectedGateIds) {
  const record = byId.get(gateId);
  if (!record || !["PASS", "FAIL", "BLOCKED", "INAPPLICABLE"].includes(record.state)) {
    process.exit(2);
  }
}
writeFileSync(derivedPath, `${JSON.stringify({
  schemaVersion: "snapback.proof-completion.v1",
  runId: expectedRunId,
  proofId: expectedProofName,
  selectedGateCount: selectedGateIds.length,
  selectedGateDigest: selectedDigest,
  resultsDigest,
})}\n`);
' "$completion_path" "$results_path" "$selected_snapshot_path" \
        "$run_id" "$proof_name" "$expected_selected_count" \
        "$expected_selected_digest" "$derived_completion_path" >/dev/null 2>&1
    token_status=$?
    [ "$had_errexit" -eq 0 ] || set -e

    if [ -r "$phase_path" ]; then
        IFS= read -r last_phase < "$phase_path" || true
    fi
    if [ "$token_status" -ne 0 ]; then
        if [ -n "$retained_completion" ]; then
            rm -f -- "$retained_completion"
        fi
        rm -rf -- "$supervision_dir"
        printf '[snapback-proof] supervised proof body did not produce parent-derived completion evidence (phase: %s, child exit: %d)\n' \
            "${last_phase:-unknown}" "$child_status" >&2
        case "${last_phase:-}" in
            gate:*)
                if [ "$child_status" -ne 0 ]; then
                    return "$child_status"
                fi
                ;;
        esac
        return 2
    fi
    if [ -n "$retained_completion" ]; then
        local retained_tmp="${retained_completion}.tmp.$$"
        if ! cp -p "$derived_completion_path" "$retained_tmp" \
            || ! mv -f -- "$retained_tmp" "$retained_completion"; then
            rm -f -- "$retained_tmp"
            rm -f -- "$retained_completion"
            rm -rf -- "$supervision_dir"
            printf '[snapback-proof] could not retain parent-derived completion receipt: %s\n' \
                "$retained_completion" >&2
            return 2
        fi
    fi
    rm -rf -- "$supervision_dir"
    return "$child_status"
}

proof_selected_gate_index() {
    local wanted="$1" index=0
    while [ "$index" -lt "${#PROOF_SELECTED_GATE_IDS[@]}" ]; do
        if [ "${PROOF_SELECTED_GATE_IDS[$index]}" = "$wanted" ]; then
            printf '%s\n' "$index"
            return 0
        fi
        index=$((index + 1))
    done
    return 1
}

proof_runner_exit_guard() {
    local shell_status=$? guarded_status=0
    trap - EXIT
    if [ "${PROOF_RUNNER_GATE_SUBSHELL:-0}" = "1" ]; then
        exit "$shell_status"
    fi
    if [ "${PROOF_RUNNER_RECONCILED:-0}" != "1" ]; then
        printf '[snapback-proof] proof runner terminated before successful reconciliation (phase: %s)\n' \
            "${PROOF_RUNNER_PHASE:-unknown}" >&2
        guarded_status="$shell_status"
        [ "$guarded_status" -ne 0 ] || guarded_status=2
        exit "$guarded_status"
    fi
    exit "$shell_status"
}

proof_runner_init() {
    if [ "$#" -ne 6 ]; then
        printf '[snapback-proof] proof_runner_init expects proof id, result path, keep-going flag, selected-gates file, expected count, and expected sha256\n' >&2
        return 2
    fi
    if [ "${PROOF_RUNNER_INITIALIZED:-0}" = "1" ] && [ "${PROOF_RUNNER_RECONCILED:-0}" != "1" ]; then
        printf '[snapback-proof] proof runner is already initialized and unreconciled\n' >&2
        return 2
    fi
    PROOF_ID="$1"
    PROOF_RESULTS_PATH="$2"
    PROOF_KEEP_GOING="$3"
    PROOF_SELECTED_GATES_PATH="$4"
    PROOF_SELECTED_SNAPSHOT_PATH="$(proof_selected_snapshot_path "$PROOF_RESULTS_PATH")" \
        || return $?
    PROOF_SELECTED_EXPECTED_COUNT="$5"
    PROOF_SELECTED_EXPECTED_DIGEST="$6"
    PROOF_SELECTED_INDEX=0
    PROOF_GATE_IDS=()
    PROOF_GATE_STATES=()
    PROOF_GATE_COMMANDS=()
    PROOF_GATE_PREREQUISITES=()
    PROOF_GATE_BLOCKED_BY=()
    PROOF_GATE_EXIT_CODES=()
    PROOF_SELECTED_GATE_IDS=()
    PROOF_INAPPLICABLE_GATE_IDS=()
    PROOF_INAPPLICABLE_PREDICATES=()
    case "$PROOF_KEEP_GOING" in
        0|1) ;;
        *)
            printf '[snapback-proof] keep-going must be 0 or 1, got %s\n' "$PROOF_KEEP_GOING" >&2
            return 2
            ;;
    esac
    case "$PROOF_SELECTED_EXPECTED_COUNT" in
        ''|*[!0-9]*)
            printf '[snapback-proof] expected selected gate count must be a non-negative integer, got %s\n' \
                "$PROOF_SELECTED_EXPECTED_COUNT" >&2
            return 2
            ;;
    esac
    case "$PROOF_SELECTED_EXPECTED_DIGEST" in
        sha256:*) ;;
        *)
            printf '[snapback-proof] expected selected gate digest must be sha256 hex, got %s\n' \
                "$PROOF_SELECTED_EXPECTED_DIGEST" >&2
            return 2
            ;;
    esac
    local selected_expected_hex="${PROOF_SELECTED_EXPECTED_DIGEST#sha256:}"
    case "$selected_expected_hex" in
        ''|*[!0-9a-f]*)
            printf '[snapback-proof] expected selected gate digest must be sha256 hex, got %s\n' \
                "$PROOF_SELECTED_EXPECTED_DIGEST" >&2
            return 2
            ;;
    esac
    if [ "${#selected_expected_hex}" -ne 64 ]; then
        printf '[snapback-proof] expected selected gate digest must contain exactly 64 hex digits\n' >&2
        return 2
    fi
    if [ ! -r "$PROOF_SELECTED_GATES_PATH" ]; then
        printf '[snapback-proof] selected-gates file is missing or unreadable: %s\n' \
            "$PROOF_SELECTED_GATES_PATH" >&2
        return 2
    fi
    if proof_path_is_descriptor_pseudo "$PROOF_SELECTED_GATES_PATH" \
        || proof_path_is_descriptor_pseudo "$PROOF_RESULTS_PATH" \
        || proof_path_is_descriptor_pseudo "$PROOF_SELECTED_SNAPSHOT_PATH"; then
        printf '[snapback-proof] descriptor pseudo-paths are forbidden for selected-gates, results, and the persisted snapshot: %s / %s / %s\n' \
            "$PROOF_SELECTED_GATES_PATH" "$PROOF_RESULTS_PATH" \
            "$PROOF_SELECTED_SNAPSHOT_PATH" >&2
        return 2
    fi
    mkdir -p "$(dirname "$PROOF_RESULTS_PATH")"
    local selected_canonical="" results_canonical="" snapshot_canonical="" identities=""
    local selected_identity="" results_identity="" snapshot_identity=""
    selected_canonical="$(proof_canonical_path "$PROOF_SELECTED_GATES_PATH")" || return $?
    results_canonical="$(proof_canonical_path "$PROOF_RESULTS_PATH")" || return $?
    snapshot_canonical="$(proof_canonical_path "$PROOF_SELECTED_SNAPSHOT_PATH")" || return $?
    if proof_path_is_descriptor_pseudo "$selected_canonical" \
        || proof_path_is_descriptor_pseudo "$results_canonical" \
        || proof_path_is_descriptor_pseudo "$snapshot_canonical"; then
        printf '[snapback-proof] descriptor pseudo-paths are forbidden for selected-gates, results, and the persisted snapshot: %s / %s / %s\n' \
            "$PROOF_SELECTED_GATES_PATH" "$PROOF_RESULTS_PATH" \
            "$PROOF_SELECTED_SNAPSHOT_PATH" >&2
        return 2
    fi
    if [ "$selected_canonical" = "$results_canonical" ] \
        || [ "$selected_canonical" = "$snapshot_canonical" ] \
        || [ "$results_canonical" = "$snapshot_canonical" ]; then
        printf '[snapback-proof] selected-gates, results, and persisted snapshot paths must not alias: %s / %s / %s\n' \
            "$PROOF_SELECTED_GATES_PATH" "$PROOF_RESULTS_PATH" \
            "$PROOF_SELECTED_SNAPSHOT_PATH" >&2
        return 2
    fi
    exec 8< "$PROOF_SELECTED_GATES_PATH" || return $?
    if ! exec 9<> "$PROOF_RESULTS_PATH"; then
        exec 8<&-
        return 2
    fi
    if ! exec 10<> "$PROOF_SELECTED_SNAPSHOT_PATH"; then
        exec 8<&-
        exec 9>&-
        return 2
    fi
    identities="$(node -e '
const { fstatSync } = require("node:fs");
for (const fd of [8, 9, 10]) {
  const value = fstatSync(fd, { bigint: true });
  process.stdout.write(`${value.dev}:${value.ino}\n`);
}
')" || {
        exec 8<&-
        exec 9>&-
        exec 10>&-
        return 2
    }
    selected_identity="${identities%%$'\n'*}"
    identities="${identities#*$'\n'}"
    results_identity="${identities%%$'\n'*}"
    snapshot_identity="${identities#*$'\n'}"
    if [ "$selected_identity" = "$results_identity" ] \
        || [ "$selected_identity" = "$snapshot_identity" ] \
        || [ "$results_identity" = "$snapshot_identity" ]; then
        exec 8<&-
        exec 9>&-
        exec 10>&-
        printf '[snapback-proof] selected-gates, results, and persisted snapshot paths must not alias: %s / %s / %s\n' \
            "$PROOF_SELECTED_GATES_PATH" "$PROOF_RESULTS_PATH" \
            "$PROOF_SELECTED_SNAPSHOT_PATH" >&2
        return 2
    fi
    local gate_id="" selected_index=0
    while IFS= read -r gate_id || [ -n "$gate_id" ]; do
        [ -n "$gate_id" ] || continue
        case "$gate_id" in
            ''|*[!a-z0-9-]*)
                printf '[snapback-proof] invalid selected gate id %q in %s\n' \
                    "$gate_id" "$PROOF_SELECTED_GATES_PATH" >&2
                exec 8<&-
                exec 9>&-
                exec 10>&-
                return 2
                ;;
        esac
        selected_index=0
        while [ "$selected_index" -lt "${#PROOF_SELECTED_GATE_IDS[@]}" ]; do
            if [ "${PROOF_SELECTED_GATE_IDS[$selected_index]}" = "$gate_id" ]; then
                printf '[snapback-proof] duplicate selected gate id %s in %s\n' \
                    "$gate_id" "$PROOF_SELECTED_GATES_PATH" >&2
                exec 8<&-
                exec 9>&-
                exec 10>&-
                return 2
            fi
            selected_index=$((selected_index + 1))
        done
        PROOF_SELECTED_GATE_IDS+=("$gate_id")
    done <&8
    PROOF_SELECTED_COUNT="${#PROOF_SELECTED_GATE_IDS[@]}"
    if [ "$PROOF_SELECTED_COUNT" -ne "$PROOF_SELECTED_EXPECTED_COUNT" ]; then
        printf '[snapback-proof] selected gate count mismatch: parsed %d, receipt expects %d\n' \
            "$PROOF_SELECTED_COUNT" "$PROOF_SELECTED_EXPECTED_COUNT" >&2
        exec 8<&-
        exec 9>&-
        exec 10>&-
        return 2
    fi
    local selected_digest=""
    node -e 'require("node:fs").ftruncateSync(10, 0)' || {
        exec 8<&-
        exec 9>&-
        exec 10>&-
        return 2
    }
    selected_index=0
    while [ "$selected_index" -lt "${#PROOF_SELECTED_GATE_IDS[@]}" ]; do
        printf '%s\n' "${PROOF_SELECTED_GATE_IDS[$selected_index]}" >&10 || {
            exec 8<&-
            exec 9>&-
            exec 10>&-
            return 2
        }
        selected_index=$((selected_index + 1))
    done
    selected_digest="$(proof_fd_sha256 10)" || {
        exec 8<&-
        exec 9>&-
        exec 10>&-
        return 2
    }
    if [ "$selected_digest" != "$PROOF_SELECTED_EXPECTED_DIGEST" ]; then
        printf '[snapback-proof] selected gate digest mismatch: parsed %s, receipt expects %s\n' \
            "$selected_digest" "$PROOF_SELECTED_EXPECTED_DIGEST" >&2
        exec 8<&-
        exec 9>&-
        exec 10>&-
        return 2
    fi
    node -e 'require("node:fs").ftruncateSync(9, 0)' || {
        exec 8<&-
        exec 9>&-
        exec 10>&-
        return 2
    }
    exec 8<&-
    exec 9>&-
    exec 10>&-
    PROOF_SELECTED_GATE_DIGEST="$selected_digest"
    PROOF_RUNNER_INITIALIZED=1
    PROOF_RUNNER_RECONCILED=0
    proof_runner_set_phase "declarations" || return $?
    trap proof_runner_exit_guard EXIT
    printf '[snapback-proof] structured gate results: %s\n' "$PROOF_RESULTS_PATH"
}

proof_runner_declare_inapplicable() {
    if [ "$#" -ne 2 ]; then
        printf '[snapback-proof] proof_runner_declare_inapplicable expects a gate id and predicate id\n' >&2
        return 2
    fi
    local gate_id="$1" predicate="$2" index=0
    case "$gate_id" in
        ''|*[!a-z0-9-]*)
            printf '[snapback-proof] invalid inapplicable gate id %q\n' "$gate_id" >&2
            return 2
            ;;
    esac
    case "$predicate" in
        ''|*[!a-z0-9-]*)
            printf '[snapback-proof] invalid inapplicability predicate id %q\n' "$predicate" >&2
            return 2
            ;;
    esac
    while [ "$index" -lt "${#PROOF_INAPPLICABLE_GATE_IDS[@]}" ]; do
        if [ "${PROOF_INAPPLICABLE_GATE_IDS[$index]}" = "$gate_id" ] \
            && [ "${PROOF_INAPPLICABLE_PREDICATES[$index]}" = "$predicate" ]; then
            printf '[snapback-proof] duplicate inapplicability declaration: %s/%s\n' \
                "$gate_id" "$predicate" >&2
            return 2
        fi
        index=$((index + 1))
    done
    PROOF_INAPPLICABLE_GATE_IDS+=("$gate_id")
    PROOF_INAPPLICABLE_PREDICATES+=("$predicate")
}

proof_inapplicability_declared() {
    local gate_id="$1" predicate="$2" index=0
    while [ "$index" -lt "${#PROOF_INAPPLICABLE_GATE_IDS[@]}" ]; do
        if [ "${PROOF_INAPPLICABLE_GATE_IDS[$index]}" = "$gate_id" ] \
            && [ "${PROOF_INAPPLICABLE_PREDICATES[$index]}" = "$predicate" ]; then
            return 0
        fi
        index=$((index + 1))
    done
    return 1
}

proof_gate_index() {
    local wanted="$1" index=0
    while [ "$index" -lt "${#PROOF_GATE_IDS[@]}" ]; do
        if [ "${PROOF_GATE_IDS[$index]}" = "$wanted" ]; then
            printf '%s\n' "$index"
            return 0
        fi
        index=$((index + 1))
    done
    return 1
}

proof_command_string() {
    local rendered=""
    while [ "$#" -gt 0 ]; do
        rendered="$rendered$(printf '%q' "$1") "
        shift
    done
    printf '%s' "${rendered% }"
}

proof_json_quote() {
    local value="$1"
    value="${value//\\/\\\\}"
    value="${value//\"/\\\"}"
    value="${value//$'\n'/\\n}"
    value="${value//$'\r'/\\r}"
    value="${value//$'\t'/\\t}"
    printf '"%s"' "$value"
}

proof_json_csv_array() {
    local values="$1" value="" rendered="[" old_ifs="$IFS"
    IFS=','
    for value in $values; do
        [ -n "$value" ] || continue
        if [ "$rendered" != "[" ]; then rendered="$rendered,"; fi
        rendered="$rendered$(proof_json_quote "$value")"
    done
    IFS="$old_ifs"
    printf '%s]' "$rendered"
}

proof_record() {
    local gate_id="$1" state="$2" started="$3" ended="$4" exit_code="$5"
    local prerequisites="$6" blocked_by="$7" command="$8" failure_signature="${9:-}"
    local termination_reason="${10:-}"
    local selection_reason="${11:-}" applicability_predicate="${12:-}"
    local applicability_evidence="${13:-}"
    PROOF_GATE_IDS+=("$gate_id")
    PROOF_GATE_STATES+=("$state")
    PROOF_GATE_COMMANDS+=("$command")
    PROOF_GATE_PREREQUISITES+=("$prerequisites")
    PROOF_GATE_BLOCKED_BY+=("$blocked_by")
    PROOF_GATE_EXIT_CODES+=("$exit_code")
    local exit_json="null"
    local signature_json="null"
    local termination_json="null"
    local selection_reason_json="null" applicability_predicate_json="null"
    local applicability_evidence_json="null"
    [ -z "$exit_code" ] || exit_json="$exit_code"
    [ -z "$failure_signature" ] || signature_json="$(proof_json_quote "$failure_signature")"
    [ -z "$termination_reason" ] || termination_json="$(proof_json_quote "$termination_reason")"
    [ -z "$selection_reason" ] || selection_reason_json="$(proof_json_quote "$selection_reason")"
    [ -z "$applicability_predicate" ] || applicability_predicate_json="$(proof_json_quote "$applicability_predicate")"
    [ -z "$applicability_evidence" ] || applicability_evidence_json="$applicability_evidence"
    printf '{"schemaVersion":"snapback.proof-gate-result.v3","proofId":%s,"gateId":%s,"state":%s,"startedAtMs":%s,"endedAtMs":%s,"durationMs":%s,"exitCode":%s,"prerequisites":%s,"blockedBy":%s,"command":%s,"failureSignature":%s,"terminationReason":%s,"selectionReason":%s,"applicabilityPredicate":%s,"applicabilityEvidence":%s}\n' \
        "$(proof_json_quote "$PROOF_ID")" \
        "$(proof_json_quote "$gate_id")" \
        "$(proof_json_quote "$state")" \
        "$started" "$ended" "$((ended - started))" "$exit_json" \
        "$(proof_json_csv_array "$prerequisites")" \
        "$(proof_json_csv_array "$blocked_by")" \
        "$(proof_json_quote "$command")" "$signature_json" "$termination_json" \
        "$selection_reason_json" "$applicability_predicate_json" \
        "$applicability_evidence_json" >> "$PROOF_RESULTS_PATH"
}

proof_update_last_termination_reason() {
    PROOF_GATE_LAST_TERMINATION_REASON=exit
    if [ "${PROOF_GATE_LAST_TIMED_OUT:-0}" = "1" ]; then
        PROOF_GATE_LAST_TERMINATION_REASON=timeout
        if [ "${PROOF_GATE_LAST_TIMEOUT_CLEANUP_FAILED:-0}" = "1" ]; then
            PROOF_GATE_LAST_TERMINATION_REASON=timeout-cleanup-failed
        fi
    fi
}

proof_background_job_running() {
    local wanted="$1" running=""
    for running in $(jobs -pr); do
        if [ "$running" = "$wanted" ]; then return 0; fi
    done
    return 1
}

# A FIFO reader must never become an unbounded second wait after the gate's own
# deadline. When it remains live after the drain budget, terminate the reader;
# on a timed-out gate this is positive evidence that an escaped writer may still
# exist, so retain a cleanup-failed termination reason instead of hiding it.
proof_finish_capture_reader() {
    local gate_id="$1" stream="$2" reader_pid="$3" drain_seconds="$4"
    local poll_count=0 drain_polls=$((drain_seconds * 4)) reader_status=0
    PROOF_CAPTURE_READER_FORCED=0
    PROOF_CAPTURE_READER_UNCLEAN=0
    PROOF_CAPTURE_READER_STATUS=0

    while proof_background_job_running "$reader_pid" && \
        [ "$poll_count" -lt "$drain_polls" ]; do
        sleep 0.25
        poll_count=$((poll_count + 1))
    done
    if proof_background_job_running "$reader_pid"; then
        PROOF_CAPTURE_READER_FORCED=1
        if [ "${PROOF_GATE_LAST_TIMED_OUT:-0}" = "1" ]; then
            PROOF_GATE_LAST_TIMEOUT_CLEANUP_FAILED=1
            printf 'SNAPBACK_PROOF_GATE_TIMEOUT_CLEANUP_FAILED: gate=%s capture_stream=%s reader_pid=%s\n' \
                "$gate_id" "$stream" "$reader_pid" >&2
        else
            printf '[snapback-proof] gate %s capture stream %s did not reach EOF\n' \
                "$gate_id" "$stream" >&2
        fi
        kill -TERM "$reader_pid" 2>/dev/null || true
        poll_count=0
        while proof_background_job_running "$reader_pid" && [ "$poll_count" -lt 4 ]; do
            sleep 0.25
            poll_count=$((poll_count + 1))
        done
        if proof_background_job_running "$reader_pid"; then
            kill -KILL "$reader_pid" 2>/dev/null || true
            poll_count=0
            while proof_background_job_running "$reader_pid" && [ "$poll_count" -lt 4 ]; do
                sleep 0.25
                poll_count=$((poll_count + 1))
            done
        fi
    fi
    if proof_background_job_running "$reader_pid"; then
        PROOF_CAPTURE_READER_UNCLEAN=1
        return 0
    fi
    wait "$reader_pid" 2>/dev/null || reader_status=$?
    PROOF_CAPTURE_READER_STATUS="$reader_status"
}

# @ref LLP 0189#decision — D-1 ticket identity comes from retained,
# normalized root-failure output; complete runs must keep output live too.
proof_gate_subshell_prepare() {
    local completion_fd="${PROOF_RUNNER_COMPLETION_FD:-}"
    if [ -n "$completion_fd" ]; then
        case "$completion_fd" in
            ''|*[!0-9]*)
                printf '[snapback-proof] invalid private completion descriptor\n' >&2
                return 2
                ;;
        esac
        eval "exec ${completion_fd}>&-"
    fi
    unset PROOF_RUNNER_COMPLETION_FD PROOF_RUNNER_RUN_ID PROOF_RUNNER_PHASE_PATH
    unset PROOF_RESULTS_PATH PROOF_SELECTED_GATES_PATH PROOF_SELECTED_SNAPSHOT_PATH
    unset PROOF_SELECTED_EXPECTED_COUNT PROOF_SELECTED_EXPECTED_DIGEST
    unset PROOF_SELECTED_GATE_DIGEST PROOF_SELECTED_COUNT PROOF_SELECTED_INDEX
    unset PROOF_SELECTED_GATE_IDS SNAPBACK_PROOF_COMPLETION_RECEIPT
}

proof_execute_gate() {
    local gate_id="$1" timeout_seconds="$2" capture_dir="" stdout_fifo="" stderr_fifo=""
    local stdout_file="" stderr_file="" stdout_tee_pid="" stderr_tee_pid=""
    local command_status=0 signature_status=0 stdout_tee_status=0 stderr_tee_status=0
    local capture_drain_seconds=5
    local stdout_forced=0 stderr_forced=0 stdout_unclean=0 stderr_unclean=0
    shift 2
    PROOF_GATE_LAST_FAILURE_SIGNATURE=""
    PROOF_GATE_LAST_TERMINATION_REASON=exit
    if [ "${SNAPBACK_PROOF_CAPTURE_DRAIN_SECONDS+x}" = "x" ]; then
        capture_drain_seconds="$SNAPBACK_PROOF_CAPTURE_DRAIN_SECONDS"
    fi
    if [ "${SNAPBACK_PROOF_CAPTURE_FAILURE_SIGNATURES:-0}" != "1" ]; then
        # Invoke outside conditional context. Bash disables errexit throughout a
        # function called from `if`; that would also neuter the strict gate
        # subshell created by proof_run_gate_with_timeout.
        proof_run_gate_with_timeout "$gate_id" "$timeout_seconds" "$@"
        command_status=$?
        proof_update_last_termination_reason
        return "$command_status"
    fi

    capture_drain_seconds="$(proof_resolve_nonnegative_duration_seconds \
        "gate $gate_id capture drain" "$capture_drain_seconds")" || return $?

    capture_dir="$(mktemp -d "${TMPDIR:-/tmp}/snapback-proof-gate.XXXXXX")" || {
        printf '[snapback-proof] could not create failure-capture directory for gate %s\n' \
            "$gate_id" >&2
        return 2
    }
    stdout_fifo="$capture_dir/stdout.fifo"
    stderr_fifo="$capture_dir/stderr.fifo"
    stdout_file="$capture_dir/stdout.log"
    stderr_file="$capture_dir/stderr.log"
    if ! mkfifo "$stdout_fifo" "$stderr_fifo"; then
        rm -rf -- "$capture_dir"
        printf '[snapback-proof] could not create failure-capture pipes for gate %s\n' \
            "$gate_id" >&2
        return 2
    fi
    tee "$stdout_file" < "$stdout_fifo" &
    stdout_tee_pid=$!
    tee "$stderr_file" < "$stderr_fifo" >&2 &
    stderr_tee_pid=$!
    proof_run_gate_with_timeout "$gate_id" "$timeout_seconds" "$@" \
        > "$stdout_fifo" 2> "$stderr_fifo"
    command_status=$?
    proof_finish_capture_reader "$gate_id" stdout "$stdout_tee_pid" "$capture_drain_seconds"
    stdout_tee_status="${PROOF_CAPTURE_READER_STATUS:-0}"
    stdout_forced="$PROOF_CAPTURE_READER_FORCED"
    stdout_unclean="$PROOF_CAPTURE_READER_UNCLEAN"
    proof_finish_capture_reader "$gate_id" stderr "$stderr_tee_pid" "$capture_drain_seconds"
    stderr_tee_status="${PROOF_CAPTURE_READER_STATUS:-0}"
    stderr_forced="$PROOF_CAPTURE_READER_FORCED"
    stderr_unclean="$PROOF_CAPTURE_READER_UNCLEAN"
    proof_update_last_termination_reason
    if [ "$command_status" -ne 0 ]; then
        PROOF_GATE_LAST_FAILURE_SIGNATURE="$(node \
            "$PROOF_RUNNER_ROOT/scripts/drift-prone-gates.mjs" failure-signature \
            --gate "$gate_id" \
            --exit-code "$command_status" \
            --termination-reason "$PROOF_GATE_LAST_TERMINATION_REASON" \
            --stdout "$stdout_file" \
            --stderr "$stderr_file" \
            --normalization-root "$PROOF_RUNNER_ROOT")" || signature_status=$?
    fi
    rm -rf -- "$capture_dir"
    if { [ "${PROOF_GATE_LAST_TIMED_OUT:-0}" != "1" ] && {
        { [ "$stdout_tee_status" -ne 0 ] && [ "$stdout_forced" -ne 1 ]; } \
            || { [ "$stderr_tee_status" -ne 0 ] && [ "$stderr_forced" -ne 1 ]; } \
            || [ "$stdout_forced" -ne 0 ] || [ "$stderr_forced" -ne 0 ] \
            || [ "$stdout_unclean" -ne 0 ] || [ "$stderr_unclean" -ne 0 ];
    }; } || [ "$signature_status" -ne 0 ] || {
        [ "$command_status" -ne 0 ] && [ -z "$PROOF_GATE_LAST_FAILURE_SIGNATURE" ];
    }; then
        printf '[snapback-proof] could not normalize root-failure output for gate %s\n' \
            "$gate_id" >&2
        return 2
    fi
    return "$command_status"
}

proof_validate_gate_id() {
    local gate_id="$1"
    case "$gate_id" in
        ''|*[!a-z0-9-]*)
            printf '[snapback-proof] invalid gate id %q; use lowercase letters, digits, and hyphens\n' "$gate_id" >&2
            return 2
            ;;
    esac
    if proof_gate_index "$gate_id" >/dev/null 2>&1; then
        printf '[snapback-proof] duplicate gate id: %s\n' "$gate_id" >&2
        return 2
    fi
}

proof_gate() {
    if [ "$#" -lt 3 ]; then
        printf '[snapback-proof] proof_gate expects an id, --, and a command\n' >&2
        return 2
    fi
    local gate_id="$1" prerequisites="" prerequisite="" prerequisite_index=""
    local blocked_by="" state="" command="" started="" ended="" gate_status=0
    local failure_signature="" timeout_override="" timeout_seconds="" saw_separator=0
    local timeout_override_set=0 termination_reason="" had_errexit=0
    shift
    while [ "$#" -gt 0 ]; do
        case "$1" in
            --requires)
                if [ "$#" -lt 2 ] || [ -n "$prerequisites" ]; then
                    printf '[snapback-proof] gate %s has an invalid --requires option\n' \
                        "$gate_id" >&2
                    return 2
                fi
                prerequisites="$2"
                shift 2
                ;;
            --timeout-seconds)
                if [ "$#" -lt 2 ] || [ "$timeout_override_set" -eq 1 ]; then
                    printf '[snapback-proof] gate %s has an invalid --timeout-seconds option\n' \
                        "$gate_id" >&2
                    return 2
                fi
                timeout_override="$2"
                timeout_override_set=1
                shift 2
                ;;
            --)
                saw_separator=1
                shift
                break
                ;;
            *)
                break
                ;;
        esac
    done
    if [ "$saw_separator" -ne 1 ]; then
        printf '[snapback-proof] gate %s is missing the -- command separator\n' "$gate_id" >&2
        return 2
    fi
    if [ "$#" -eq 0 ]; then
        printf '[snapback-proof] gate %s has no command\n' "$gate_id" >&2
        return 2
    fi
    timeout_seconds="$(proof_resolve_gate_timeout_seconds \
        "$gate_id" "$timeout_override" "$timeout_override_set")" || \
        return $?
    proof_validate_gate_id "$gate_id" || return $?
    if ! proof_selected_gate_index "$gate_id" >/dev/null 2>&1; then
        printf '[snapback-proof] proof_gate cannot execute unselected gate %s\n' "$gate_id" >&2
        return 2
    fi
    PROOF_SELECTED_INDEX=$((PROOF_SELECTED_INDEX + 1))
    if [ "$PROOF_SELECTED_INDEX" -gt "$PROOF_SELECTED_COUNT" ]; then
        printf '[snapback-proof] selected gate count exceeded: saw %d, expected %d\n' \
            "$PROOF_SELECTED_INDEX" "$PROOF_SELECTED_COUNT" >&2
        return 2
    fi
    command="$(proof_command_string "$@")"

    local old_ifs="$IFS"
    IFS=','
    for prerequisite in $prerequisites; do
        [ -n "$prerequisite" ] || continue
        if ! prerequisite_index="$(proof_gate_index "$prerequisite")"; then
            IFS="$old_ifs"
            printf '[snapback-proof] gate %s names unknown or not-yet-run prerequisite %s\n' \
                "$gate_id" "$prerequisite" >&2
            return 2
        fi
        state="${PROOF_GATE_STATES[$prerequisite_index]}"
        if [ "$state" != "PASS" ]; then
            if [ -n "$blocked_by" ]; then
                blocked_by="$blocked_by,$prerequisite"
            else
                blocked_by="$prerequisite"
            fi
        fi
    done
    IFS="$old_ifs"

    started="$(proof_now_ms)"
    if [ -n "$blocked_by" ]; then
        ended="$(proof_now_ms)"
        printf '\n[snapback-verify] BLOCKED %d/%d %s (prerequisite: %s)\n' \
            "$PROOF_SELECTED_INDEX" "$PROOF_SELECTED_COUNT" "$gate_id" "$blocked_by"
        proof_record "$gate_id" BLOCKED "$started" "$ended" "" \
            "$prerequisites" "$blocked_by" "$command"
        if [ "$PROOF_KEEP_GOING" = "1" ]; then
            return 0
        fi
        return 1
    fi

    printf '\n[snapback-verify] GATE %d/%d %s\n[snapback-verify] $' \
        "$PROOF_SELECTED_INDEX" "$PROOF_SELECTED_COUNT" "$gate_id"
    printf ' %q' "$@"
    printf '\n'
    proof_runner_set_phase "gate:$gate_id" || return $?
    # A function called from an `if` condition inherits Bash's errexit-disabled
    # context. Capture status with errexit disabled only in this parent frame;
    # proof_execute_gate creates a fresh `set -euo pipefail` subshell for the command.
    case "$-" in *e*) had_errexit=1; set +e ;; esac
    proof_execute_gate "$gate_id" "$timeout_seconds" "$@"
    gate_status=$?
    [ "$had_errexit" -eq 0 ] || set -e
    if [ "$gate_status" -eq 0 ]; then
        ended="$(proof_now_ms)"
        proof_record "$gate_id" PASS "$started" "$ended" 0 \
            "$prerequisites" "" "$command" "" exit
        printf '[snapback-verify] PASS %s (%d ms)\n' "$gate_id" "$((ended - started))"
        proof_runner_set_phase "declarations" || return $?
        return 0
    else
        failure_signature="$PROOF_GATE_LAST_FAILURE_SIGNATURE"
        termination_reason="$PROOF_GATE_LAST_TERMINATION_REASON"
        ended="$(proof_now_ms)"
        proof_record "$gate_id" FAIL "$started" "$ended" "$gate_status" \
            "$prerequisites" "" "$command" "$failure_signature" "$termination_reason"
        printf '\n[snapback-verify] FAIL %s (exit %d, %d ms): %s\n' \
            "$gate_id" "$gate_status" "$((ended - started))" "$command"
        if [ "$PROOF_KEEP_GOING" = "1" ]; then
            proof_runner_set_phase "declarations" || return $?
            return 0
        fi
        return "$gate_status"
    fi
}

proof_runner_write_completion_token() {
    if [ -z "${PROOF_RUNNER_COMPLETION_FD:-}" ] \
        && [ -z "${PROOF_RUNNER_RUN_ID:-}" ]; then
        return 0
    fi
    if [ -z "${PROOF_RUNNER_COMPLETION_FD:-}" ] \
        || [ -z "${PROOF_RUNNER_RUN_ID:-}" ]; then
        printf '[snapback-proof] incomplete completion-token supervision environment\n' >&2
        return 2
    fi
    case "$PROOF_RUNNER_COMPLETION_FD" in
        ''|*[!0-9]*)
            printf '[snapback-proof] invalid private completion descriptor\n' >&2
            return 2
            ;;
    esac
    printf '{"schemaVersion":"snapback.proof-child-completion.v1","runId":%s}\n' \
        "$(proof_json_quote "$PROOF_RUNNER_RUN_ID")" \
        >&"$PROOF_RUNNER_COMPLETION_FD" || return $?
}

proof_not_selected() {
    if [ "$#" -ne 2 ]; then
        printf '[snapback-proof] proof_not_selected expects a gate id and reason\n' >&2
        return 2
    fi
    local gate_id="$1" reason="$2" now=""
    proof_validate_gate_id "$gate_id" || return $?
    if proof_selected_gate_index "$gate_id" >/dev/null 2>&1; then
        printf '[snapback-proof] policy NOT_SELECTED cannot reconcile selected gate %s\n' \
            "$gate_id" >&2
        return 2
    fi
    if [ -z "$reason" ]; then
        printf '[snapback-proof] policy NOT_SELECTED requires a non-empty cadence reason for %s\n' \
            "$gate_id" >&2
        return 2
    fi
    now="$(proof_now_ms)"
    proof_record "$gate_id" NOT_SELECTED "$now" "$now" "" "" "" "" "" "" "$reason"
    printf '\n[snapback-verify] NOT_SELECTED %s: %s\n' "$gate_id" "$reason"
}

proof_ci_fact() {
    case "${CI:-}" in
        true|TRUE|True|1|yes|YES|on|ON) printf 'true\n' ;;
        *) printf 'false\n' ;;
    esac
}

proof_observed_inapplicability_evidence() {
    local predicate="$1" ci_fact="" host_os="" swift_available="false"
    local verify_exact="" exact_available_fact="null"
    case "$predicate" in
        ci-only)
            ci_fact="$(proof_ci_fact)" || return $?
            printf '{"ci":%s}\n' "$ci_fact"
            ;;
        cargo-clean-required)
            ci_fact="$(proof_ci_fact)" || return $?
            printf '{"ci":%s,"cleanupDecision":%s}\n' \
                "$ci_fact" "$(proof_json_quote "${PROOF_CARGO_CLEANUP_DECISION:-unknown}")"
            ;;
        linux-host)
            host_os="$(/usr/bin/uname -s | tr '[:upper:]' '[:lower:]')" || return $?
            printf '{"hostOs":%s}\n' "$(proof_json_quote "$host_os")"
            ;;
        swift-toolchain)
            if proof_swift_available; then swift_available="true"; fi
            printf '{"swiftAvailable":%s}\n' "$swift_available"
            ;;
        exact-surface-enabled|exact-dependencies-sentinel-needed)
            verify_exact="${VERIFY_EXACT:-${SNAPBACK_VERIFY_EXACT:-auto}}"
            if [ "$verify_exact" != "0" ]; then
                if ! command -V exact_available >/dev/null 2>&1; then
                    printf '[snapback-proof] exact applicability requires the runner-observed exact_available function\n' >&2
                    return 2
                fi
                if exact_available; then
                    exact_available_fact="true"
                else
                    exact_available_fact="false"
                fi
            fi
            printf '{"verifyExact":%s,"exactAvailable":%s}\n' \
                "$(proof_json_quote "$verify_exact")" "$exact_available_fact"
            ;;
        *)
            printf '[snapback-proof] unknown inapplicability predicate %s\n' "$predicate" >&2
            return 2
            ;;
    esac
}

proof_inapplicable() {
    if [ "$#" -ne 3 ]; then
        printf '[snapback-proof] proof_inapplicable expects a gate id, predicate id, and evidence JSON\n' >&2
        return 2
    fi
    local gate_id="$1" predicate="$2" evidence="$3" canonical_evidence=""
    local observed_evidence="" now=""
    proof_validate_gate_id "$gate_id" || return $?
    if ! proof_selected_gate_index "$gate_id" >/dev/null 2>&1; then
        printf '[snapback-proof] INAPPLICABLE cannot reconcile unselected gate %s\n' "$gate_id" >&2
        return 2
    fi
    if ! proof_inapplicability_declared "$gate_id" "$predicate"; then
        printf '[snapback-proof] undeclared inapplicability pair: %s/%s\n' \
            "$gate_id" "$predicate" >&2
        return 2
    fi
    observed_evidence="$(proof_observed_inapplicability_evidence "$predicate")" || return $?
    canonical_evidence="$(node --input-type=module -e '
import { pathToFileURL } from "node:url";
const [helperPath, predicate, callerSource, observedSource] = process.argv.slice(2);
try {
  const { validateInapplicabilityEvidence } = await import(pathToFileURL(helperPath).href);
  const caller = validateInapplicabilityEvidence(predicate, JSON.parse(callerSource));
  const observed = validateInapplicabilityEvidence(predicate, JSON.parse(observedSource));
  const canonicalize = (value) => JSON.stringify(Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
  ));
  const callerCanonical = canonicalize(caller);
  const observedCanonical = canonicalize(observed);
  if (callerCanonical !== observedCanonical) {
    throw new Error(`${predicate} evidence does not match runner-observed facts: ${observedCanonical}`);
  }
  process.stdout.write(observedCanonical);
} catch (error) {
  console.error(error?.message ?? String(error));
  process.exit(2);
}
' proof-inapplicability-validation \
        "$PROOF_RUNNER_ROOT/scripts/check-local-proof-gates.mjs" "$predicate" \
        "$evidence" "$observed_evidence")" || {
        printf '[snapback-proof] unauthorized inapplicability evidence for %s/%s\n' \
            "$gate_id" "$predicate" >&2
        return 2
    }
    PROOF_SELECTED_INDEX=$((PROOF_SELECTED_INDEX + 1))
    if [ "$PROOF_SELECTED_INDEX" -gt "$PROOF_SELECTED_COUNT" ]; then
        printf '[snapback-proof] selected gate count exceeded: saw %d, expected %d\n' \
            "$PROOF_SELECTED_INDEX" "$PROOF_SELECTED_COUNT" >&2
        return 2
    fi
    now="$(proof_now_ms)"
    proof_record "$gate_id" INAPPLICABLE "$now" "$now" "" "" "" "" "" "" "" \
        "$predicate" "$canonical_evidence"
    printf '\n[snapback-verify] INAPPLICABLE %d/%d %s (%s): %s\n' \
        "$PROOF_SELECTED_INDEX" "$PROOF_SELECTED_COUNT" "$gate_id" "$predicate" \
        "$canonical_evidence"
}

proof_runner_finish() {
    local index=0 failures=0 blocked=0 not_selected=0 inapplicable=0
    local missing_count=0 missing_gate_ids="" selected_gate_id="" recorded_index=""
    local live_snapshot="" live_digest="" persisted_digest=""
    proof_runner_set_phase "reconciliation" || return $?

    live_snapshot="$(mktemp "$(dirname "$PROOF_RESULTS_PATH")/.proof-selected-live.XXXXXX")" \
        || return $?
    : > "$live_snapshot"
    index=0
    while [ "$index" -lt "${#PROOF_SELECTED_GATE_IDS[@]}" ]; do
        printf '%s\n' "${PROOF_SELECTED_GATE_IDS[$index]}" >> "$live_snapshot" || {
            rm -f -- "$live_snapshot"
            return 2
        }
        index=$((index + 1))
    done
    live_digest="$(proof_file_sha256 "$live_snapshot")" || {
        rm -f -- "$live_snapshot"
        return 2
    }
    rm -f -- "$live_snapshot"
    persisted_digest="$(proof_file_sha256 "$PROOF_SELECTED_SNAPSHOT_PATH")" || {
        printf '[snapback-proof] persisted selected snapshot is missing or unreadable: %s\n' \
            "$PROOF_SELECTED_SNAPSHOT_PATH" >&2
        return 2
    }
    if [ "$live_digest" != "$persisted_digest" ] \
        || [ "$persisted_digest" != "$PROOF_SELECTED_EXPECTED_DIGEST" ]; then
        printf '[snapback-proof] selected snapshot mutation detected: live %s, persisted %s, selector %s\n' \
            "$live_digest" "$persisted_digest" "$PROOF_SELECTED_EXPECTED_DIGEST" >&2
        return 2
    fi

    index=0
    while [ "$index" -lt "${#PROOF_GATE_IDS[@]}" ]; do
        case "${PROOF_GATE_STATES[$index]}" in
            FAIL) failures=$((failures + 1)) ;;
            BLOCKED) blocked=$((blocked + 1)) ;;
            NOT_SELECTED) not_selected=$((not_selected + 1)) ;;
            INAPPLICABLE) inapplicable=$((inapplicable + 1)) ;;
        esac
        index=$((index + 1))
    done

    # @ref LLP 0175#d2--assign-every-test-to-an-explicit-cadence — the
    # selected inventory must close over the runtime ledger; a syntactically
    # inventoried gate cannot silently disappear behind shell control flow.
    index=0
    while [ "$index" -lt "${#PROOF_SELECTED_GATE_IDS[@]}" ]; do
        selected_gate_id="${PROOF_SELECTED_GATE_IDS[$index]}"
        if ! recorded_index="$(proof_gate_index "$selected_gate_id")"; then
            missing_count=$((missing_count + 1))
            if [ -n "$missing_gate_ids" ]; then
                missing_gate_ids="$missing_gate_ids, $selected_gate_id"
            else
                missing_gate_ids="$selected_gate_id"
            fi
        else
            case "${PROOF_GATE_STATES[$recorded_index]}" in
                PASS|FAIL|BLOCKED|INAPPLICABLE) ;;
                *)
                    printf '[snapback-proof] selected gate %s has unauthorized terminal state %s\n' \
                        "$selected_gate_id" "${PROOF_GATE_STATES[$recorded_index]}" >&2
                    return 2
                    ;;
            esac
        fi
        index=$((index + 1))
    done

    if [ "$missing_count" -gt 0 ]; then
        printf '\n[snapback-verify] PROOF SUMMARY: selected gate reconciliation failed; %d selected gate(s) were never recorded or invoked\n' \
            "$missing_count"
        printf '[snapback-proof] missing selected gate id(s): %s\n' "$missing_gate_ids" >&2
        return 2
    fi
    if [ "$PROOF_SELECTED_INDEX" -ne "${#PROOF_SELECTED_GATE_IDS[@]}" ]; then
        printf '[snapback-proof] selected traversal index mismatch: traversed %d, snapshot contains %d\n' \
            "$PROOF_SELECTED_INDEX" "${#PROOF_SELECTED_GATE_IDS[@]}" >&2
        return 2
    fi

    proof_runner_set_phase "completion-token" || return $?
    proof_runner_write_completion_token || return $?
    PROOF_RUNNER_RECONCILED=1
    proof_runner_set_phase "reconciled" || return $?

    if [ "$failures" -gt 0 ] || [ "$blocked" -gt 0 ]; then
        printf '\n[snapback-verify] PROOF SUMMARY: %d root failure(s), %d blocked gate(s), %d not selected, %d inapplicable\n' \
            "$failures" "$blocked" "$not_selected" "$inapplicable"
        index=0
        while [ "$index" -lt "${#PROOF_GATE_IDS[@]}" ]; do
            case "${PROOF_GATE_STATES[$index]}" in
                FAIL)
                    printf '  FAIL     %-36s exit=%s  %s\n' \
                        "${PROOF_GATE_IDS[$index]}" "${PROOF_GATE_EXIT_CODES[$index]}" \
                        "${PROOF_GATE_COMMANDS[$index]}"
                    ;;
                BLOCKED)
                    printf '  BLOCKED  %-36s by=%s\n' \
                        "${PROOF_GATE_IDS[$index]}" "${PROOF_GATE_BLOCKED_BY[$index]}"
                    ;;
            esac
            index=$((index + 1))
        done
        return 1
    fi
    printf '\n[snapback-verify] PROOF SUMMARY: all applicable selected gates passed (%d not selected, %d inapplicable)\n' \
        "$not_selected" "$inapplicable"
}
