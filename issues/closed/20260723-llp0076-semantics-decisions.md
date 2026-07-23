# DECISION: streaming semantics and profile forks

**Status:** Resolved (2026-07-23 — all eight forks decided by the author; recorded in LLP 0076 §Author decisions — 2026-07-23; OQ 1, 2, 3, 4, 5, 8, 9, 10 annotated resolved)
**Severity:** P2
**Systems:** Actions, Runtime, Diagnostics, Deployment
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-23
**Related:** LLP 0076 open questions 1-10, LLP 0075 (frozen fixture / selected hosted adapter), LLP 0070 (provider idempotency), issues/20260723-llp0076-initiation-state.md, issues/20260723-llp0076-diagnostic-envelope.md, issues/20260723-llp0076-streaming-program.md
**Marker:** llp-0076, streaming, decision

The open forks LLP 0076 lists — decisions to resolve, not code to write. Several
change normative behavior and gate the implementation tickets.

**Resolved when** each is pinned in LLP 0076 (and, where it changes an
outcome-affecting requirement, in a prospective LLP 0075 / protocol.v0.json
amendment):

- What `ambiguous` uniquely denotes as a settlement kind once effect certainty is
  orthogonal (phase-unprovable non-idempotent transport failure), and whether it
  is a compatibility-only kind.
- Which layer persists the effect-certainty column — the host-owned attempt
  record or the authored progress row (host *derives* it; only persistence is
  open).
- What trusted, machine-checkable declaration proves a provider recognizes an
  idempotency key (vs today's author assertion), and how it binds the effective
  key and a canonical request digest to an attempt.
- Whether `SNAPBACK_REPLY_PROGRESS_RATE_EXCEEDED` is renamed to a profile-neutral
  host code before it becomes load-bearing in receipts.
- Which supported monotonic elapsed-time source or host progress helper lets an
  action obey the 100 ms spacing without a wall clock (the reference pattern's
  chunk-count heuristic is fixture-cadence-fragile).
- Which hosted adapter produces the gate-2 receipt now that Cloudflare is a
  narrow proof and LLP 0075 selected `single-instance-container-vm.v1`.
- Whether one durable attempt covers all four concurrent cursors or each upstream
  request gets a child record (a single scalar `initiationState`/certainty cannot
  represent four cursors in different phases).
- Whether the full Web `ReadableStream` surface is adopted in a later profile,
  and whether durable jobs persist resumable upstream cursor metadata.

## Resolution (2026-07-23)

Decided by Charlie Cheever (interactive session 1681e9d6): `ambiguous` kept
and precisely defined (unrefinable non-idempotent initiation_possible);
certainty column persists on the host-owned attempt record; parent attempt +
per-cursor child records; `SNAPBACK_ACTION_PROGRESS_RATE_EXCEEDED` rename now
(nothing on main is load-bearing); non-GET retry idempotency =
deployment-pinned provider declaration or downgrade-to-non-idempotent (bare
assertions stop conferring retry semantics; fixture behaviorally unaffected);
monotonic `elapsedMs` on every stream read result; gate-2 receipt from
`single-instance-container-vm.v1`; ReadableStream (OQ1) and resumable cursors
(OQ3) deferred with named reopen triggers. Prospective LLP 0075 /
protocol.v0.json notes for the two outcome-affecting items (rename,
idempotency) ride their implementation tickets
(20260723-llp0076-attempt-control-plane.md and the diagnostic/boundedness
tickets). The implementation tickets this gated are now unblocked.
