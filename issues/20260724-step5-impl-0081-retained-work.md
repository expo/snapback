# 0081: retained-work postures (empty / dual-compatible)

**Status:** Deferred (phase C)
**Severity:** P3
**Systems:** Migrations, Background work
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-24
**Related:** Accepted LLP 0081 §6, LLP 0070
**Marker:** step5-impl

Prove `empty` under the barrier (server-resident work incl. scheduled-future
payloads); bind predecessor+successor validators for `dual-compatible`;
refuse incompatible retained work and declared-but-unproven `transformed`;
client-custodied queues stay on the §4 handshake path. M-sized.

**Progress (2026-07-25):** barrier-time proof landed
(`prove_retained_work_posture` in `src/storage.rs`, called in the
executor's admission sequence before the fence): the local profile proves
exactly the `empty` posture by counting the durable server-resident work
stores (retained client-mutation records, auth-invalidation retry
episodes); a non-empty store fails closed with
`SNAPBACK_MIGRATION_RETAINED_WORK_INCOMPATIBLE` under either admitted
posture because no owning subsystem models dual-compatible payload
validators yet; `transformed` was already refused at plan validation.
Witness: `retained_work_posture_is_proven_not_assumed`. Client-custodied
offline queues are governed by the posture-aware client path (see the
journal-events ticket); retained resume state across publication is fenced
by the RQS generation digest and the clear-retained subscription
retirement.

**Residuals:** per-subsystem dual-compatible payload validators (each
owning subsystem's versioned adapter); authorized-lease posture witnesses
across publication; scheduled-cron payload accounting once cron carries
durable queued payloads on this profile.
