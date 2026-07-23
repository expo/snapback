# Write-ahead initiationState and host-derived effect certainty

**Status:** Open
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
