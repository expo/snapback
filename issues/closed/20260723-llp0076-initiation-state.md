# Write-ahead initiationState and host-derived effect certainty

**Status:** Resolved (2026-07-24 — landed on the local arm; substrate and hot-path cost stated, residue reassigned; see Resolution)
**Severity:** P1
**Systems:** Actions, Runtime, Outbound fetch, Durable mutations, Testing
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-23
**Related:** LLP 0076 §Settlement and retry (initiationState) + Evidence-status gaps, LLP 0059 (Initiated permit contrast), LLP 0070 (uncertainty resolution), src/server.rs (open-path classification), issues/20260723-llp0076-attempt-control-plane.md, issues/20260723-llp0076-streaming-program.md
**Marker:** llp-0076, streaming, settlement

Implements the crash-safe effect-certainty axis. The durable row must carry a
`terminalCause` (the five frozen kinds, unchanged) plus an orthogonal
`initiationState` (`definitely_not_initiated` / `initiation_possible` /
`response_observed`), durably **pre-marked** `initiation_possible` before the
request bytes are handed to the outbound stack, narrowed to
`definitely_not_initiated` only on a provable pre-send failure, and advanced to
`response_observed` on metadata. It is host-derived (not LLP 0059's `Initiated`
permit, which cannot distinguish a synchronous refusal from a request that
reached the wire), transport-agnostic, and fail-safe (a host that cannot prove a
pre-send failure leaves `initiation_possible`).

**Done when:**

- The host durably records `initiation_possible` before send, narrows/advances
  per the rule, and persists it on the `StreamAttemptV1` record.
- Any terminal settlement whose `initiationState` is not
  `definitely_not_initiated` records the effect-may-have-executed fact; keyed
  non-GET classification is gated on a trusted provider declaration (not mere
  key presence) — see the semantics decision ticket.
- Acceptance witnesses: cancelled-after-initiation and timed-out-after-initiation
  carry the effect fact; a pre-initiation `failed` does not.
- The durability substrate and hot-path cost of the pre-mark are stated (where
  it lands, that it is on the send path); or that specific point is folded into
  the semantics-decisions open question.
- The two-axis gap row in the ledger moves to closed.

## Resolution (2026-07-24)

Landed on the local arm:

- **Substrate (stated per Done-when):** the `_snapback_stream_attempts`
  table in the instance SQLite. An attempt-bound cursor is durably
  pre-marked `initiation_possible` under a short instance-lock upsert BEFORE
  any request byte reaches the outbound stack — the open refuses to proceed
  when the pre-mark cannot commit. It narrows to `definitely_not_initiated`
  only on a provable pre-send failure (`ureq` DNS / connection-refused /
  invalid-URL / unknown-scheme kinds) and advances to the absorbing
  `response_observed` on response metadata.
- **Hot-path cost (stated per Done-when):** at most two short instance-lock
  upserts per upstream open (pre-mark + observe), zero per read; settle and
  attempt-start each add one; terminalizer/close paths flush best-effort with
  a bounded 250 ms try-lock so the watchdog never waits — a skipped write
  leaves the conservative on-disk reading for the next flush or the startup
  reconciler.
- **Crash safety:** a startup reconciler in `LocalSnapback::from_database`
  settles any orphaned non-terminal row `failed` with
  `effectMayHaveExecuted` folded from the persisted cursor pre-marks
  (`initiation_possible` reads as effect-possible). Witnessed by a
  two-process-life recovery test that also proves the durable winner is
  returned verbatim to the next runner. This surfaced and fixed a real
  namespace bug: registry namespaces are now monotonic per-instance nonces,
  never pointers, so allocator reuse cannot resurrect a dead instance's
  live registry entries.
- **Decision 5 (declaration-or-downgrade):** a bare authored idempotency key
  no longer confers idempotency — keyed non-GET transport loss that cannot
  be proven pre-send settles `ambiguous` (witnessed by a mid-handshake
  socket-destroy fixture); provable pre-send failures settle `failed` on any
  method with no effect uncertainty (witnessed). The frozen fixture is
  behaviorally unaffected (GET leg idempotent by method; POST leg asserts
  false); the LLP 0075 local-streaming instrument stays PASS 6/6.
- **Acceptance witnesses:** cancelled-after-initiation and
  timed-out-after-initiation carry the effect fact; pre-initiation `failed`
  does not (`cancelled_and_timed_out_after_initiation_carry_the_effect_fact`,
  `keyed_non_get_transport_loss_settles_ambiguous_and_pre_send_failures_stay_failed`).

Residue, reassigned: the deployment-pinned provider idempotency declaration
(the downgrade's re-earning half) remains staged under LLP 0076's
classification prose; attempt-less streams carry no durable settlement row by
design (authored-pattern adoption rides the prospective LLP 0075 amendment);
the Workerd arm has no substrate. `cargo test --lib`: 1132 passed.
