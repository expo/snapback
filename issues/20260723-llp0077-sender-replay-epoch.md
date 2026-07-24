# Distinct durable sender_replay_epoch with an atomic reset transaction

**Status:** In Progress (2026-07-24 — durable epoch + atomic reset landed; floor, straddle tests, grant member pending)
**Severity:** P1
**Systems:** Auth, Storage, Control plane, Testing
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-23
**Related:** LLP 0077 §Nonce protocol (epoch lifecycle) + defect 10, LLP 0060 (serving admission epoch), LLP 0059 (authorization-stream incarnation), src/auth/sender_proof.rs (tables key on admission_epoch), src/storage/auth.rs (reset), issues/20260723-llp0077-rollback-ratchet.md, issues/20260723-llp0077-senderauth-program.md
**Marker:** llp-0077, sender-auth, replay-epoch, security

**Progress (2026-07-24, re-landed on main):** the distinct durable
`sender_replay_epoch` exists (`_snapback_sender_replay_epoch` singleton,
preserved across restart/rollout — the per-rollout resync storm is gone),
and the LLP 0059 stream-reset transaction atomically advances it and clears
the replay/nonce tables inside the same destructive cut that revokes the
auth catalog (`reset_and_seed_transaction` →
`rotate_sender_authority_for_stream_reset`). Remaining: the decision-1
control-plane monotone floor outside the rolled-back durable set (effective
epoch = max(incarnation-derived, floor)), rollout/restart/reset/declared-
restore straddle tests, and switching the connection-grant binding member
from the serving admission epoch to the issuance `sender_replay_epoch`
(decision 6; coordinates with the grant-binding ticket).

Closes LLP 0077 ledger **defect 10**. Replay and nonce tables key on LLP 0060's
serving `admission_epoch` rather than a distinct durable `sender_replay_epoch`,
and reset neither advances a sender epoch nor clears the tables. Because live
nonces key on the serving epoch, every rollout that rotates it strands all
installed nonces and forces a simultaneous one-shot resync across all clients
(a per-rollout resync storm). The observable contract is fixed: a distinct
namespace, rotating only on the LLP 0059 incarnation change, non-rollbackable.
The concrete non-rollbackable ratchet source is decided in
`20260723-llp0077-rollback-ratchet.md` and gates the restore case here.

**Done when:**

- Replay and nonce tables key on a distinct durable `sender_replay_epoch`,
  preserved across ordinary restart/rollout.
- The single reset (LLP 0059 incarnation change) transaction atomically advances
  the epoch, revokes every sender-bound family, and clears the replay/nonce
  tables; a reset-atomicity test lands.
- Rollout/restart/reset/declared-restore straddle tests prove no in-window proof
  survives an epoch rotation (nonce epoch-keying closes the seam).
- The verification-order and nonce sections' `sender_replay_epoch` terminology
  matches the implementation; LLP 0077's defect 10 row moves to closed.
