# Multiple-unhandled error grouping needs a fingerprint authority

**Status:** Open — RULED 2026-08-03, now implementable (was author-gated)
**Opened:** 2026-08-03
**Systems:** Error tracking, Runtime, Observability
**Related:** LLP 0156 (E0/E1 local implementation record),
`issues/closed/20260802-obs-05-error-groups-and-issue-machine.md`,
`issues/20260802-author-decision-packet.md`

## Problem

One handler terminal can carry multiple ordered unhandled failures. LLP 0156's
group schema has one fingerprint/disposition tuple per admitted observation,
but no accepted authority selects a first, last, aggregate, or split-group
interpretation for that vector.

The local E0/E1 implementation therefore fails safe: it preserves the truthful
raw terminal and its eligible classification, emits no guessed fingerprint,
increments `malformed_error_stamp_count` once, and creates no issue group. A
focused fixture pins that behavior. This avoids silent misgrouping but leaves
those failures absent from grouped issue views.

## Resolution needed

Choose and document one deterministic semantic rule, including its interaction
with the singular observation/group schema, metering identity, occurrence
counts, exemplars, and fingerprint-version rollout. If the answer permits more
than one group from one observation, amend LLP 0156 before implementation; that
is a data-model change, not a local tie-breaker.

## Ruling (2026-08-03)

Ruled by Charlie at author decision sitting #2
(`issues/20260803-author-decision-sitting-2.md`); the dated LLP 0156
amendment is landed (§Amendment (2026-08-03): multi-rejection fingerprint
authority). The fingerprint authority for a multi-rejection handler
terminal is the **first ordered rejection**. The full ordered rejection
carrier is retained as facts on the failure record — no separate groups
per rejection, no aggregate grammar; the singular observation/group
schema stands. This ticket is no longer author-gated: it is an
implementable ticket. The raw-only fail-safe behavior (no guessed
fingerprint, `malformed_error_stamp_count`) lifts once the ruling is
implemented and the fixtures pin it.

## Exit

- ~~An accepted LLP 0156 amendment or successor authority chooses the
  behavior.~~ Done 2026-08-03 (see Ruling).
- Rust and JavaScript carrier/fingerprint fixtures pin the same outcome.
- The raw-only fallback remains until the authority and implementation land.
- The error-tracking guide and capability row are updated if support changes.
