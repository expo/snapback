# Snapback 4 guide-gap: presence promises prediction but residency queues without a row

Status: Resolved (2026-09-14)
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

## Recurrence on 0.2.12 (2026-09-14, the catch-up calibration)

The 0.2.12 Astra calibration builder hit the same contradiction in M6 and
logged it as `snapback4-defect` (run-log epoch 1789411480 in
`~/clique-sb4-20260914-astra-0.2.11/lanes/astra-snapback4/`,
`evidence/m6-send-why.txt`): "published presence recipe says device treats
everyone connected, but connected read classifies send predicts never." Its
workaround again split a durable `notificationRequested` effect from a
service-only dispatcher. This is one of that lane's two Snapback-attributed
loops, so either the card or the classification should change before the
next calibration.

## Resolution — 2026-09-14, lane N1

Implemented the author's option C in LLP 3000.007 §19.1. The binder follows
presence-derived values through expressions, assignments, branches and loop
back edges. Only emitted payloads and conditions choosing emit-only arms
preserve eligibility; write, refusal, result, read-key and other control-flow
uses retain a server site naming the use and a mutation-specific rewrite.
Query and job classification and runtime presence semantics are unchanged.

The effects card and README now declare the synced audience and message
horizon their offline recipe needs; the card's membership insert rule uses
an existing membership grant. Both `send` and the language card's `sendBrief`
are eligible. `check --residency`, `why` and generated API documentation say
that the server decides notifications at commit; the residency JSON gains
`connected_effects_only` without removing existing fields. The cards also
retain unconditional emit plus a service mutation for dispatch-time presence.

The regression tests were red on base
`ce15819ad71bd24c9d1b9ec228c083330dee3a31` and green with the fix. Both SQLite
and memory devices admit the offline message and match the server's row
for zero, one and two connected recipients (six comparisons); the server
emits two, one and zero notifications respectively. Twenty-two negative
programs remain ineligible with specific reasons. The existing query-side
assertions remain. The dated N1 journal entry records commands, counts and
verbatim before/after residency output. The two builders' historical
observations and frozen instruments above remain intact.
