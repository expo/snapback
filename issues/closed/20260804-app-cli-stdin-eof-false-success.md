# App CLI `run -` treats empty EOF as a successful program

**Status:** Resolved
**Impact:** 5
**Urgency:** 4
**Ease:** 5
**Confidence:** 5
**Systems:** App CLI, Agent operation, Diagnostics, Code mode
**Date:** 2026-08-04
**Resolved:** 2026-08-05
**Governing:** LLP 0024, LLP 0062

## Problem

The documented stdin code-mode command succeeded when stdin was already
closed:

```sh
snapback-app ... run - </dev/null
```

It exited `0`, printed no default-export result, and reported a zero-call
summary. The same command in a PTY succeeded when source was supplied; with
stdin held open it waited. Therefore absence of input was indistinguishable
from a successfully executed program.

This was the same silent-false-success class as the detached `snapback dev`
EOF defect, on a second agent-facing surface.

## Resolution

`run -` now requires at least one non-whitespace source byte. Empty or
whitespace-only EOF refuses before artifact loading, principal acquisition, or
network traffic with exit `2` and structured
`SNAPBACK_APP_CLI_SCRIPT_EMPTY` repair alternatives. A held-open producer
continues waiting until source/EOF arrives. A non-empty program with no default
export remains a successful no-output program; the existing strict-value
refusal of an explicit `export default undefined` is unchanged.

Focused CLI tests pin closed, whitespace, supplied-source, no-result, and
held-open stdin behavior plus the stable exit classification.

Evidence from the originating audit remains at
`/tmp/snapback-unattended-audit.7qbgiS/unattended-audit.md`.
