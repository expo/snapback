# App CLI `run -` treats empty EOF as a successful program

**Status:** Open
**Impact:** 5
**Urgency:** 4
**Ease:** 5
**Confidence:** 5
**Systems:** App CLI, Agent operation, Diagnostics, Code mode
**Date:** 2026-08-04
**Governing:** LLP 0024, LLP 0062

## Problem

The documented stdin code-mode command succeeds when stdin is already closed:

```sh
snapback-app ... run - </dev/null
```

It exits `0`, prints no default-export result, and reports a zero-call summary.
The same command in a PTY succeeds when source is supplied; with stdin held
open it waits. Therefore absence of input is indistinguishable from a
successfully executed program.

This is the same silent-false-success class as the detached `snapback dev`
EOF defect, on a second agent-facing surface.

## Proposed fix

Require at least one non-whitespace source byte before compiling stdin mode.
Empty EOF should exit non-zero with a structured
`SNAPBACK_APP_CLI_SCRIPT_EMPTY` diagnostic and a repair hint to pass a file or
pipe source. Preserve successful execution of an explicitly non-empty program
whose default export is `undefined`; input presence and result value are
different facts.

## Acceptance

Pin all three input modes:

- PTY plus source → exit 0 and the awaited default-export result.
- closed stdin → non-zero plus `SNAPBACK_APP_CLI_SCRIPT_EMPTY`.
- held-open stdin → remains waiting until source/EOF arrives.

Evidence is recorded in
`/tmp/snapback-unattended-audit.7qbgiS/unattended-audit.md` for the originating
audit run.
