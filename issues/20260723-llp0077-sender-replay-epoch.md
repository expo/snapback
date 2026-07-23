# Distinct durable sender_replay_epoch with an atomic reset transaction

**Status:** Open
**Severity:** P1
**Systems:** Auth, Storage, Control plane, Testing
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-23
**Related:** LLP 0077 §Nonce protocol (epoch lifecycle) + defect 10, LLP 0060 (serving admission epoch), LLP 0059 (authorization-stream incarnation), src/auth/sender_proof.rs (tables key on admission_epoch), src/storage/auth.rs (reset), issues/20260723-llp0077-rollback-ratchet.md, issues/20260723-llp0077-senderauth-program.md
**Marker:** llp-0077, sender-auth, replay-epoch, security

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
