# Snapback 2: offline replay disagrees with recorded inbox after chat unsend

**Status:** Open
**Date:** 2026-09-07
**Systems:** chat template journey, offline derived verification, held delivery inbox
**Source:** integration `a68088c29`, based on `ba63c884e`; parallel-papercuts full check

## Observed failure

`scripts/test.sh` failed `init::quarry_chat_init_check_and_test_end_to_end`
after 133.608 seconds. Its receipt reports the journey
`offline drain removes an unsent body and survives a cold restart` failed
with `offline replay changed bytes` (journey 2,456 ms).
The failure is the derived comparison in
`snapback2/packages/snapback2/src/test.ts:215`, after the journey body.

The fixture drains Alice's inbox, takes her offline, unsends `message-1`
through an online owner, resumes until the removal arrives, then restarts
Alice offline and verifies the held inbox no longer contains `Welcome`.
The subsequent comparison's **left side is the recorded expectation; right
side is the replayed result**, not two independently recorded server reads:

| Field | Recorded expectation (left) | Offline replay (right) |
|---|---|---|
| `data.length` | 4 | 5 |
| `delivery-1-alice.message` | Message `message-1`, body `Welcome`, author `dev:alice`, `at: 1` | `null` |
| Additional delivery | Absent | `kind: "removed"`, `messageId: "message-1"`, `recipient: "dev:alice"`, `message: null`, `at: 1788766730754`, id `s2id-7ce8b7af50c47051f219d911068b1d6e-0000000000014c01` |
| `watermark` | `null` | Non-null cursor for the removal row (decoded below) |

Both sides retain `state: "complete"`, `connection: "offline"`, `live: false`,
`caughtUp: true`, `seq: 16`, `next: null`, and
`stale: { "since": 1788766729917 }`. The other three delivery rows agree.
The replay watermark decodes to:

```json
[1,"deliveries","byRecipientAt","Asc",[{"name":"at","kind":"Time"},{"name":"id","kind":"Id"}],[{"Int":1788766730754},{"Id":"s2id-7ce8b7af50c47051f219d911068b1d6e-0000000000014c01"}]]
```

## Evidence and limits

Retained full output:
`/Users/ccheever/projects/snapback/.llp/ship-runs/20260907-parallel-papercuts/full-test-repaired.log`,
lines 3081–3098 (the receipt repeats at line 3433).
This is one observed failure, not a successful baseline reproduction or a
root-cause finding. In particular, the output does not establish that the
replayed removal is incorrect or that the recorded expectation is current.
The same full run contains several independent timeouts; their presence does
not explain this value mismatch.

A source comparison (`git diff --name-only ba63c884e a68088c29 --` the paths
below) is empty for the package `src/`, chat `templates/chat/`,
`crates/snapback2/tests/init.rs`, evaluator `src/`, and core `src/` under
`snapback2/`. The relevant harness, fixture, and runtime source were unchanged
by this integration. That comparison alone does not prove an inherited failure.
No targeted replay or runtime repair was performed when filing this ticket.

## Follow-up

Reproduce the named journey with its existing deadlines and record the
expectation's custody across resume, tombstone application, and restart.
Determine whether the verifier retains an obsolete expectation or the client
violates its query contract; repair the responsible path while preserving the
unsent-body eviction and meaningful offline equivalence assertion. Qualify the
named init test and the affected offline tests without weakening assertions.

Related but distinct:
[offline projection/cold movement](20260906-snapback2-offline-entrypoint-isolation-and-projection.md)
tracks other specific reproductions;
[cold custom-cursor drain](closed/20260905-snapback2-cold-offline-drain-forgets-cursor-name.md)
was closed for repeated page one;
[full-suite timing failures](20260901-snapback2-scripts-test-sh-flakes-under.md)
tracks load-sensitive failures. No identical unsend/replay mismatch was found
in the existing ticket corpus.
