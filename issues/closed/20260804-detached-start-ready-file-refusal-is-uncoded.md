# Detached server start without a ready file fails with prose and no stable code

**Status:** Closed
**Impact:** 4
**Urgency:** 3
**Ease:** 5
**Confidence:** 5
**Systems:** Server lifecycle, CLI, Diagnostics, Agent operation
**Date:** 2026-08-04
**Governing:** LLP 0010, LLP 0024, LLP 0030

## Problem

The native server correctly refuses a detached start that has no
`--ready-file`: it cannot safely publish its process-bound impersonation
capability. The failure is operationally sound but diagnostically outside
Snapback's own contract:

- exit code is 1;
- stderr is prose explaining that `--ready-file` is required;
- no JSON result or `SNAPBACK_*` code is emitted.

PTY start stays alive; both closed-stdin and held-stdin detached starts fail
the same way. This is S2: the right fail-closed decision without a stable
machine recovery contract.

## Proposed fix

Emit `SNAPBACK_READY_DESCRIPTOR_REQUIRED` in a one-line machine-readable
diagnostic with a repair record equivalent to:

```json
{"code":"SNAPBACK_READY_DESCRIPTOR_REQUIRED","next":[{"command":"snapback start --ready-file <owner-only-path> ..."}]}
```

The TTY path may keep human prose, but it must project the same core diagnostic.

## Acceptance

The generalized A/B/C lifecycle suite pins:

- PTY without a ready file may use terminal capability handoff and stay live;
- detached without a ready file exits non-zero with the stable code and repair;
- detached with a ready file reaches ready and stays live.

## Resolution (2026-08-05)

Native startup now checks for a controlling terminal before any database path
is resolved or created. Without a terminal and without `--ready-file`, it exits
non-zero with a one-line structured diagnostic carrying
`SNAPBACK_READY_DESCRIPTOR_REQUIRED` and the requested `details.next` repair.
The terminal fallback and owner-only ready-file handoff remain unchanged, and
a second fail-closed mapping covers loss of a terminal between preflight and
capability emission.
