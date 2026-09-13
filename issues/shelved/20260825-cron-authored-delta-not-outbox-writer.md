# Cron-authored delta never reaches the browser: SNAPBACK_OUTBOX_NOT_WRITER

- Status: open
- Created: 2026-08-25
- Area: client store single-writer ownership / outbox
- Found by: the first execution of `scripts/cold-clone-check.sh` (LLP 0283 F-3, item 2)

## Summary

The all-aboard browser acceptance check **"cron-authored delta reaches the browser through the
bindings (no pump)"** fails:

```
SNAPBACK_OUTBOX_NOT_WRITER: this context does not hold single-writer ownership of the
client store; the mutation was not queued
```

A cron-authored mutation is not queued to the outbox because the cron execution context does not
hold single-writer ownership of the client store. The delta therefore never reaches the browser
through the live bindings — which is precisely the property that check exists to prove.

This is a genuine product defect, not a host-setup problem: the failure is a `SNAPBACK_*` diagnostic
raised by the product in a real acceptance check, on a machine where the other 33 checks pass.

## Scope of the run that found it

`scripts/cold-clone-check.sh` had **never been executed** against the carved workspace. It is one of
the two F-3 items (with the npm closure pack) that were never exercised, as opposed to the four that
are already gates inside the complete canonical proof inventory.

**Step 1 passed.** The cold clone built the workspace and the runtime readiness receipt was
authoritative — link and handler-VM qualification both fine. That was the outcome most at risk, given
how much the workspace has been carved since the check last ran, and it is good news.

**Step 2 failed 1 of 34.** All 33 other browser checks pass, including live push binding, the
paved-path provisioning, second-window boot isolation, and the offline schedule fallback. The single
failure is the cron delta above.

One earlier failure in the same run was **not** a repository defect and should not be counted as one:
`[cold-clone] FAIL: required tool missing: bun` was a host `PATH` problem — `bun` was installed at
`~/.bun/bin/bun` but not on the invoking shell's `PATH`. Worth noting that the check's prerequisites
are not obvious from its output.

## Why it matters

The check's name says "no pump" — it is asserting that a cron-authored write propagates through the
ordinary binding path without an explicit pump step. If cron contexts categorically lack
single-writer ownership, then either:

1. cron-authored writes cannot reach live bindings at all, and the check encodes an intended
   behaviour that was never implemented or has regressed; or
2. cron should acquire single-writer ownership for the duration of its mutation, and the acquisition
   is missing on this path.

Deciding which is the first task. Do not "fix" this by relaxing the check.

## Reproduce

```
scripts/bootstrap-ibex-runtime          # node must be on PATH
bash scripts/cold-clone-check.sh        # bun must also be on PATH
```

The machine-readable acceptance report names the failing check and carries the diagnostic verbatim.

## Next

1. Determine which of the two readings above is intended; the check's author is the pointer.
2. If cron should hold ownership, find where the ordinary route acquires it and why the cron route
   does not.
3. Re-run the cold clone to confirm 34/34, and record F-3 item 2 as exercised.
