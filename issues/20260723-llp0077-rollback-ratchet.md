# DECISION: non-rollbackable ratchet source for raw-backup-rollback non-resurrection

**Status:** Open (author decision)
**Severity:** P1
**Systems:** Auth, Control plane, Storage
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-23
**Related:** LLP 0077 §Nonce protocol (epoch lifecycle bullets) + open questions, LLP 0060 (attestation-driven admissionEpoch), LLP 0059 (authorization-stream incarnation), issues/20260723-llp0077-sender-replay-epoch.md, issues/20260723-llp0077-senderauth-program.md
**Marker:** llp-0077, sender-auth, decision, security

This is a **decision to resolve**, not code to write — and it is the one open
item load-bearing for a security MUST. LLP 0077 states that a raw backup
rollback (reverting the durable tables wholesale) must not resurrect an accepted
proof, but currently pins no monotone anti-rollback root: the guarantee is a
stated requirement, not a proven property, because the Spec deliberately stopped
asserting an unidentified counter exists. Declared restore is already covered by
the LLP 0059 incarnation advance; the raw-rollback case is the gap.

Options to weigh (pick one and state its monotonicity argument):

- Derive `sender_replay_epoch` non-rollbackability from the LLP 0060 attestation
  ratchet (monotone, control-plane, survives a DB rollback) — but 0060's serving
  admission epoch is short-lived and was rejected as the *namespace*; this would
  use it only as the monotone *floor*, not the namespace.
- A dedicated control-plane monotone counter stored outside the rolled-back
  durable set.
- A composition (0059 incarnation for restore + a control-plane floor for raw
  rollback).

**Resolved when:**

- One ratchet source is selected, its monotonicity/non-rollbackability argument
  is stated, and the raw-rollback non-resurrection guarantee is upgraded from a
  stated requirement to a proven property in LLP 0077 (moved out of the open
  questions).
- `20260723-llp0077-sender-replay-epoch.md` can then implement it with a
  restore/rollback straddle test.
