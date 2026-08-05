#!/usr/bin/env bash

# Named, dependency-aware gate execution for repository proofs.
# @ref LLP 0175#d1--make-keep-going-dependency-aware — preserve independent
# feedback while replacing failed-producer timeout cascades with BLOCKED.
#
# The caller remains responsible for `set -e` and calls:
#   proof_runner_init <proof-id> <jsonl-output> <keep-going:0|1>
#   proof_gate <gate-id> [--requires <comma-separated-gate-ids>] -- <command...>
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

proof_runner_init() {
    if [ "$#" -ne 3 ]; then
        printf '[snapback-proof] proof_runner_init expects proof id, result path, and keep-going flag\n' >&2
        return 2
    fi
    PROOF_ID="$1"
    PROOF_RESULTS_PATH="$2"
    PROOF_KEEP_GOING="$3"
    case "$PROOF_KEEP_GOING" in
        0|1) ;;
        *)
            printf '[snapback-proof] keep-going must be 0 or 1, got %s\n' "$PROOF_KEEP_GOING" >&2
            return 2
            ;;
    esac
    mkdir -p "$(dirname "$PROOF_RESULTS_PATH")"
    : > "$PROOF_RESULTS_PATH"
    export PROOF_ID PROOF_RESULTS_PATH PROOF_KEEP_GOING
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
    local prerequisites="$6" blocked_by="$7" command="$8"
    PROOF_GATE_IDS+=("$gate_id")
    PROOF_GATE_STATES+=("$state")
    PROOF_GATE_COMMANDS+=("$command")
    PROOF_GATE_PREREQUISITES+=("$prerequisites")
    PROOF_GATE_BLOCKED_BY+=("$blocked_by")
    PROOF_GATE_EXIT_CODES+=("$exit_code")
    local exit_json="null"
    [ -z "$exit_code" ] || exit_json="$exit_code"
    printf '{"schemaVersion":"snapback.proof-gate-result.v1","proofId":%s,"gateId":%s,"state":%s,"startedAtMs":%s,"endedAtMs":%s,"durationMs":%s,"exitCode":%s,"prerequisites":%s,"blockedBy":%s,"command":%s}\n' \
        "$(proof_json_quote "$PROOF_ID")" \
        "$(proof_json_quote "$gate_id")" \
        "$(proof_json_quote "$state")" \
        "$started" "$ended" "$((ended - started))" "$exit_json" \
        "$(proof_json_csv_array "$prerequisites")" \
        "$(proof_json_csv_array "$blocked_by")" \
        "$(proof_json_quote "$command")" >> "$PROOF_RESULTS_PATH"
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
    shift
    if [ "${1:-}" = "--requires" ]; then
        prerequisites="${2:-}"
        shift 2
    fi
    if [ "${1:-}" != "--" ]; then
        printf '[snapback-proof] gate %s is missing the -- command separator\n' "$gate_id" >&2
        return 2
    fi
    shift
    if [ "$#" -eq 0 ]; then
        printf '[snapback-proof] gate %s has no command\n' "$gate_id" >&2
        return 2
    fi
    proof_validate_gate_id "$gate_id" || return $?
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
        printf '\n[snapback-verify] BLOCKED %s (prerequisite: %s)\n' "$gate_id" "$blocked_by"
        proof_record "$gate_id" BLOCKED "$started" "$ended" "" \
            "$prerequisites" "$blocked_by" "$command"
        if [ "$PROOF_KEEP_GOING" = "1" ]; then
            return 0
        fi
        return 1
    fi

    printf '\n[snapback-verify] GATE %s\n[snapback-verify] $' "$gate_id"
    printf ' %q' "$@"
    printf '\n'
    if "$@"; then
        ended="$(proof_now_ms)"
        proof_record "$gate_id" PASS "$started" "$ended" 0 \
            "$prerequisites" "" "$command"
        printf '[snapback-verify] PASS %s (%d ms)\n' "$gate_id" "$((ended - started))"
        return 0
    else
        gate_status=$?
        ended="$(proof_now_ms)"
        proof_record "$gate_id" FAIL "$started" "$ended" "$gate_status" \
            "$prerequisites" "" "$command"
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
