# Snapback 4 guide-gap: presence promises prediction but residency queues without a row

Status: Open
Priority: P3
Date: 2026-09-14
Systems: presence guide, residency classification, predictable message sends
Observed version: published `snapback4@0.2.10`
Evidence status: builder observation and separate orchestrator CLI reproduction

## Problem

The presence card says that mutation prediction reads everybody as connected,
producing the least speculative rows before the server decides. The published
binder instead classifies every `connected[...]` expression as server-only,
so a mutation containing one is never eligible to predict. A builder following
the card loses the pending message row it expected to show offline.

The 0.2.10 Astra Clique builder logged this at epoch 1789388189 in M6,
attributing it to `snapback4-defect`, sub-attribution `docs-gap`. Both
`chat.send` and `media.send` acquired `N_NOT_PREDICTABLE` notes. Its workaround
emits a durable push candidate in the predictable send and evaluates presence
in a service-only dispatch mutation reached by a worker. This changes the
eligibility observation from the original commit to worker dispatch time.

## Reproduction and evidence

A separate orchestrator probe ran the same published binary, outside the
frozen builder lane, against:

```quarry
mutation ordinary():
  return 1

mutation withPresence():
  return connected[viewer]
```

`snapback4 check --residency` exited 0 and printed:

```text
ordinary: predicts: eligible
withPresence: predicts: never; queued without a row
  Server: connected[principal] is known only by the server (site connected)
    rewrite: remove connected from this query; observe presence separately online
```

Local evidence (retained for the final cell record):

- `~/projects/snapback-lanebriefs/presence-probe-20260914/`: schema,
  `check.txt`, command and exit in `probe.json`.
- `~/clique-sb4-20260913-relaxed-3models/lanes/astra-snapback4/run-log.md`:
  epoch 1789388189; `evidence/guide-presence-m6.txt`,
  `check-m6-retry.txt` and `check-m6-dispatch.txt`.
- Main at `7329ad0dc`: `snapback4/crates/snapback4-lang/src/guide.rs`,
  presence card; `src/bind/residency.rs` in the same crate, `expr()` marks
  `Builtin::Connected` as `SiteClass::Server` and `execution()` rolls that
  into `predicts: never`.

The probe establishes the documented/classified mismatch. It does not
independently re-run the builder's full offline UI or provider seam.
Search of current `issues/`, LLP 3000/3000.007 and recent origin/main found
no ticket for this mismatch; CU1–CU5 (§18) cover different findings.

## Fix direction

Align the presence/effects cards with the actual prediction contract and
show how to keep a send predictable while dispatching a notification. Make
the diagnostic's rewrite appropriate for a mutation (it currently says
"this query"). If the intended contract is instead to permit a conservative
prediction of presence, that behavior needs explicit implementation and
acceptance rather than leaving the promise in the guide.

Verify a synced send's emitted execution metadata and offline card against
the documented example. Preserve truthful server-only presence queries,
server-side notification admission, and the frozen cell's pin/instrument.
This ticket does not commission a new language form or decide LLP 3000.007
§9.1's SQL-read question.
