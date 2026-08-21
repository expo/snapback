#!/usr/bin/env bash

# Named, dependency-aware gate execution for repository proofs.
# @ref LLP 0175#d1--make-keep-going-dependency-aware — preserve independent
# feedback while replacing failed-producer timeout cascades with BLOCKED.
#
# The caller remains responsible for `set -e` and calls:
#   proof_runner_init <proof-id> <jsonl-output> <keep-going:0|1> <selected-count>
#   proof_gate <gate-id> [--requires <comma-separated-gate-ids>]
#       [--timeout-seconds <positive-integer>] -- <command...>
#   proof_not_selected <gate-id> <reason>
#   proof_runner_finish
#
# Bash 3.2 compatibility is deliberate: macOS agents use the system Bash.

PROOF_RUNNER_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROOF_GATE_IDS=()
PROOF_GATE_STATES=()
PROOF_GATE_COMMANDS=()
PROOF_GATE_PREREQUISITES=()
PROOF_GATE_BLOCKED_BY=()
PROOF_GATE_EXIT_CODES=()

proof_now_ms() {
    if command -v perl >/dev/null 2>&1; then
        perl -MTime::HiRes=time -e 'printf "%.0f", time * 1000'
    else
        python3 -c 'import time; print(time.time_ns() // 1_000_000)'
    fi
}

proof_resolve_gate_timeout_seconds() {
    local gate_id="$1" gate_override="$2"
    local timeout_seconds="${SNAPBACK_PROOF_GATE_TIMEOUT_SECONDS:-$gate_override}"
    timeout_seconds="${timeout_seconds:-3600}"
    case "$timeout_seconds" in
        ''|*[!0-9]*|0)
            printf '[snapback-proof] gate %s timeout must be a positive integer, got %s\n' \
                "$gate_id" "$timeout_seconds" >&2
            return 2
            ;;
    esac
    printf '%s\n' "$timeout_seconds"
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
# which is available in the stock macOS Bash 3.2. A deadline signals the whole
# group so cargo's test binaries cannot survive their cargo parent.
proof_run_gate_with_timeout() {
    local gate_id="$1" timeout_seconds="$2" command_pid="" command_status=0
    local poll_count=0 timeout_polls=$((timeout_seconds * 4)) timed_out=0
    local term_grace_seconds="${SNAPBACK_PROOF_GATE_TERM_GRACE_SECONDS:-5}"
    local term_grace_polls=0 monitor_was_enabled=0
    shift 2

    case "$term_grace_seconds" in
        ''|*[!0-9]*)
            printf '[snapback-proof] gate %s TERM grace must be a non-negative integer, got %s\n' \
                "$gate_id" "$term_grace_seconds" >&2
            return 2
            ;;
    esac
    term_grace_polls=$((term_grace_seconds * 4))

    case "$-" in *m*) monitor_was_enabled=1 ;; esac
    if [ "$monitor_was_enabled" -eq 0 ]; then set -m; fi
    "$@" &
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

    wait "$command_pid" 2>/dev/null || true
    poll_count=0
    while proof_gate_process_group_alive "$command_pid" && [ "$poll_count" -lt 20 ]; do
        sleep 0.25
        poll_count=$((poll_count + 1))
    done
    if proof_gate_process_group_alive "$command_pid"; then
        printf 'SNAPBACK_PROOF_GATE_TIMEOUT_CLEANUP_FAILED: gate=%s process_group=%s\n' \
            "$gate_id" "$command_pid" >&2
    fi
    return 124
}

proof_runner_init() {
    if [ "$#" -ne 4 ]; then
        printf '[snapback-proof] proof_runner_init expects proof id, result path, keep-going flag, and selected count\n' >&2
        return 2
    fi
    PROOF_ID="$1"
    PROOF_RESULTS_PATH="$2"
    PROOF_KEEP_GOING="$3"
    PROOF_SELECTED_COUNT="$4"
    PROOF_SELECTED_INDEX=0
    case "$PROOF_KEEP_GOING" in
        0|1) ;;
        *)
            printf '[snapback-proof] keep-going must be 0 or 1, got %s\n' "$PROOF_KEEP_GOING" >&2
            return 2
            ;;
    esac
    case "$PROOF_SELECTED_COUNT" in
        ''|*[!0-9]*)
            printf '[snapback-proof] selected count must be a non-negative integer, got %s\n' "$PROOF_SELECTED_COUNT" >&2
            return 2
            ;;
    esac
    mkdir -p "$(dirname "$PROOF_RESULTS_PATH")"
    : > "$PROOF_RESULTS_PATH"
    export PROOF_ID PROOF_RESULTS_PATH PROOF_KEEP_GOING PROOF_SELECTED_COUNT PROOF_SELECTED_INDEX
    printf '[snapback-proof] structured gate results: %s\n' "$PROOF_RESULTS_PATH"
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
    PROOF_GATE_IDS+=("$gate_id")
    PROOF_GATE_STATES+=("$state")
    PROOF_GATE_COMMANDS+=("$command")
    PROOF_GATE_PREREQUISITES+=("$prerequisites")
    PROOF_GATE_BLOCKED_BY+=("$blocked_by")
    PROOF_GATE_EXIT_CODES+=("$exit_code")
    local exit_json="null"
    local signature_json="null"
    [ -z "$exit_code" ] || exit_json="$exit_code"
    [ -z "$failure_signature" ] || signature_json="$(proof_json_quote "$failure_signature")"
    printf '{"schemaVersion":"snapback.proof-gate-result.v2","proofId":%s,"gateId":%s,"state":%s,"startedAtMs":%s,"endedAtMs":%s,"durationMs":%s,"exitCode":%s,"prerequisites":%s,"blockedBy":%s,"command":%s,"failureSignature":%s}\n' \
        "$(proof_json_quote "$PROOF_ID")" \
        "$(proof_json_quote "$gate_id")" \
        "$(proof_json_quote "$state")" \
        "$started" "$ended" "$((ended - started))" "$exit_json" \
        "$(proof_json_csv_array "$prerequisites")" \
        "$(proof_json_csv_array "$blocked_by")" \
        "$(proof_json_quote "$command")" "$signature_json" >> "$PROOF_RESULTS_PATH"
}

# @ref LLP 0189#decision — D-1 ticket identity comes from retained,
# normalized root-failure output; complete runs must keep output live too.
proof_execute_gate() {
    local gate_id="$1" timeout_seconds="$2" capture_dir="" stdout_fifo="" stderr_fifo=""
    local stdout_file="" stderr_file="" stdout_tee_pid="" stderr_tee_pid=""
    local command_status=0 signature_status=0 stdout_tee_status=0 stderr_tee_status=0
    shift 2
    PROOF_GATE_LAST_FAILURE_SIGNATURE=""
    if [ "${SNAPBACK_PROOF_CAPTURE_FAILURE_SIGNATURES:-0}" != "1" ]; then
        proof_run_gate_with_timeout "$gate_id" "$timeout_seconds" "$@"
        return $?
    fi

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
    if proof_run_gate_with_timeout "$gate_id" "$timeout_seconds" "$@" \
        > "$stdout_fifo" 2> "$stderr_fifo"; then
        command_status=0
    else
        command_status=$?
    fi
    wait "$stdout_tee_pid" || stdout_tee_status=$?
    wait "$stderr_tee_pid" || stderr_tee_status=$?
    if [ "$command_status" -ne 0 ]; then
        PROOF_GATE_LAST_FAILURE_SIGNATURE="$(node \
            "$PROOF_RUNNER_ROOT/scripts/drift-prone-gates.mjs" failure-signature \
            --gate "$gate_id" \
            --exit-code "$command_status" \
            --stdout "$stdout_file" \
            --stderr "$stderr_file" \
            --normalization-root "$PROOF_RUNNER_ROOT")" || signature_status=$?
    fi
    rm -rf -- "$capture_dir"
    if [ "$stdout_tee_status" -ne 0 ] || [ "$stderr_tee_status" -ne 0 ] \
        || [ "$signature_status" -ne 0 ] || {
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
                if [ "$#" -lt 2 ] || [ -n "$timeout_override" ]; then
                    printf '[snapback-proof] gate %s has an invalid --timeout-seconds option\n' \
                        "$gate_id" >&2
                    return 2
                fi
                timeout_override="$2"
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
    timeout_seconds="$(proof_resolve_gate_timeout_seconds "$gate_id" "$timeout_override")" || \
        return $?
    proof_validate_gate_id "$gate_id" || return $?
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
    if proof_execute_gate "$gate_id" "$timeout_seconds" "$@"; then
        ended="$(proof_now_ms)"
        proof_record "$gate_id" PASS "$started" "$ended" 0 \
            "$prerequisites" "" "$command"
        printf '[snapback-verify] PASS %s (%d ms)\n' "$gate_id" "$((ended - started))"
        return 0
    else
        gate_status=$?
        failure_signature="$PROOF_GATE_LAST_FAILURE_SIGNATURE"
        ended="$(proof_now_ms)"
        proof_record "$gate_id" FAIL "$started" "$ended" "$gate_status" \
            "$prerequisites" "" "$command" "$failure_signature"
        printf '\n[snapback-verify] FAIL %s (exit %d, %d ms): %s\n' \
            "$gate_id" "$gate_status" "$((ended - started))" "$command"
        if [ "$PROOF_KEEP_GOING" = "1" ]; then
            return 0
        fi
        return "$gate_status"
    fi
}

proof_not_selected() {
    if [ "$#" -ne 2 ]; then
        printf '[snapback-proof] proof_not_selected expects a gate id and reason\n' >&2
        return 2
    fi
    local gate_id="$1" reason="$2" now=""
    proof_validate_gate_id "$gate_id" || return $?
    now="$(proof_now_ms)"
    proof_record "$gate_id" NOT_SELECTED "$now" "$now" "" "" "" "$reason"
    printf '\n[snapback-verify] NOT_SELECTED %s: %s\n' "$gate_id" "$reason"
}

proof_runner_finish() {
    local index=0 failures=0 blocked=0 not_selected=0
    while [ "$index" -lt "${#PROOF_GATE_IDS[@]}" ]; do
        case "${PROOF_GATE_STATES[$index]}" in
            FAIL) failures=$((failures + 1)) ;;
            BLOCKED) blocked=$((blocked + 1)) ;;
            NOT_SELECTED) not_selected=$((not_selected + 1)) ;;
        esac
        index=$((index + 1))
    done

    if [ "$failures" -gt 0 ] || [ "$blocked" -gt 0 ]; then
        printf '\n[snapback-verify] PROOF SUMMARY: %d root failure(s), %d blocked gate(s), %d not selected\n' \
            "$failures" "$blocked" "$not_selected"
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
    printf '\n[snapback-verify] PROOF SUMMARY: all selected gates passed (%d not selected)\n' \
        "$not_selected"
}
