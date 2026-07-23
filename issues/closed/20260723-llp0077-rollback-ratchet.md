# DECISION: non-rollbackable ratchet source for raw-backup-rollback non-resurrection

**Status:** Resolved (2026-07-23 — composition ratchet selected with its monotonicity argument; recorded in LLP 0077 §Author decisions — 2026-07-23 item 1)
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

## Resolution (2026-07-23)

Decided by Charlie Cheever (interactive session 1681e9d6): the composition —
`sender_replay_epoch` rotates only on the LLP 0059 incarnation change, and a
dedicated control-plane monotone counter stored outside the rolled-back
durable set provides the anti-rollback floor; effective epoch =
max(incarnation-derived, floor). Monotonicity argument recorded in the Spec: a
raw rollback reverts the durable tables but cannot lower the external floor,
so no accepted proof's epoch can recur. LLP 0060's admission epoch stays a
distinct namespace (used by neither the namespace nor the floor). The
guarantee graduates to a proven property when
20260723-llp0077-sender-replay-epoch.md lands the implementation with the
restore/rollback straddle test — that ticket is now unblocked.
