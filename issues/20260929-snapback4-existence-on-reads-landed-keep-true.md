# Snapback 4: `existence` on every read landed (LLP 3000.031); what later client lanes must keep true

**Opened:** 2026-09-29, with the landing of LLP 3000.031
**Severity:** Low: coordination; no defect
**Area:** `snapback4/packages/snapback4/src/contract.ts` (`Ready<T>`, `existence(read)`), the read publication paths in `local-query.ts`, `local-reads.ts`, `local.ts`, `client.ts`, `react-pages.ts`; the social starter's composer; the client and offline-interactions cards; `crates/snapback4-core/src/engine/authorized_point.rs` (`no-candidate`)
**Status:** Open until the next calibration on a release that carries it has been read; owner is whoever opens a client-read lane next

## What landed

Every ready read now carries `existence: "present" | "absent" | "partial"`,
computed by the SDK from the published value's top level, `complete`, `cut`,
`next` and the device's pending predicate (predictions and in-flight
admissions, shared by the observed and one-shot paths). A nullable point
result narrows `data` under `existence === "present"`; an array-or-null
result types `absent` as `null | []`; `isReady` keeps `data: T`, and
`Read<T>` stays assignable to `Read<U>` when `T` is assignable to `U`. The
client card's "Honest read boundaries" is a table of the five meanings of a
missing row with one rule per UI decision; the social starter branches on
the discriminant. The dev trace records `no-candidate` at the real storage
probe miss, folded into lane DX's `--trace-empty` records; rule-filtered
empties are still never logged. The name is `existence` because `guide
presence` is the connected-users card.

## Reconciled with today's landings

- **DX**: `--trace-empty` and its defaults kept; this branch adds the cause.
- **RL** and **LL**: replacement and live-cut semantics kept; `existence` is
  recomputed on every published, replaced or resumed answer, never copied
  from the previous one (regressions cover a resumed live read and a
  fallback answer).
- **SR**: the composer rule SR landed is kept and expressed through the
  discriminant: Send is disabled on `denied`, or on a fresh, non-revalidating
  `absent` membership; a stale absent row offline still queues and the server
  refuses at sync; `loading` and `partial` never disable. LLP 3000.031 §1.3
  was revised to say this rather than "absent disables outright".

## What later lanes must keep true

1. Any new path that publishes or replaces a read answer computes
   `existence` through the one classifier; copying it from a prior answer is
   a defect the existing regressions will catch only if the path is exercised.
2. The pending predicate is one function used by both `query()` and
   `observe()`; do not add a third gate.
3. A hidden row and a missing row stay byte-identical to the caller and
   equal in `existence`; the dev trace is the only place that may say
   `no-candidate`, and only under `--trace-empty`.
4. `guide presence` stays the connected card; read-state questions route to
   the client card ("what does a missing row mean", "loading or absent") and
   `guide offline-interactions` ("unknown membership offline").

## Follow-ups from the blind reviews

- Grok (round 3): the 1,080-case publication table forces `unknown: false`
  in the device reply, so it never drives the engine's `unknown: true` →
  `complete: false` → empty `partial` mapping; the code does it and §1.1
  requires it (a window miss is not absence), but no test pins it. Add the
  cell.
- Deferred with its own ticket: `loading.reason`
  (`issues/20260928-presence-loading-reasons.md`).

## Review record

Plan: Astra (max) and Grok 4.7 (xhigh), both DIRECTIONALLY CORRECT WITH
CHANGES, folded into LLP 3000.031 revision 2. Code: Astra round 1 BLOCKED
(three reproduced defects), round 2 READY TO LAND with revert-controlled
tests for each; Grok's first two code attempts ended without a verdict
(one context compaction, one immediate exit), its third READY TO LAND WITH
TICKETS. Reviews are in the sb5 program directory under `reviews/presence/`.
