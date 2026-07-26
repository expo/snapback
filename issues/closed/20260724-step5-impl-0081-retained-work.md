# 0081: retained-work postures (empty / dual-compatible)

**Status:** Resolved (2026-07-26)
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

**Phase D note (2026-07-25):** the auth-scoped retained lane at
publication is now a durable `Delete` disposition + authenticated scope
retirement (see the journal-events ticket closure); unscoped retained
state keeps the clear-retained resync. The `transformed` posture remains
spec-deferred to its owning subsystems.

**Flip-closure fixtures (2026-07-25, rehearsal slice):** the §7
restore-derived rehearsal landed on the local profile:
`MigrationRehearsalPlanV1` (digest binds the UNCHANGED production plan
digest plus the binding — source backup identity, isolated database id,
restore epoch, target profile — under
`snapback:migration-rehearsal:v1`), `rehearsalRequired` as a canonical
reviewed body field (skip-if-false; frozen plan vectors unchanged),
rehearsal execution admitted ONLY against the bound restore-derived
database (production refused `SNAPBACK_MIGRATION_REHEARSAL_INVALID`),
journal/receipt marked rehearsal with a freshness anchor, and the
production gate (`SNAPBACK_MIGRATION_REHEARSAL_REQUIRED` without a
consumed fresh receipt; cross-plan/stale/unmarked receipts refuse;
production apply still executes the original plan and its receipt never
substitutes). CLI: `migrate apply --rehearsal-receipt`. Witness:
`restore_derived_rehearsal_gates_production_apply`. Recorded honestly:
receipt custody is structural on the local profile (operator file);
control-plane receipt authentication, the LLP 0072 backup manifest
binding, and a dedicated `migrate rehearse` CLI verb (the §2 list has no
rehearse verb — same friction class as `release`) are 0072-lane work.

## Resolution (2026-07-26)

Retained-work postures landed in Phase C (empty and proven
dual-compatible admitted; declared-but-unproven `transformed` refused as
unsupported — the spec-deferred posture stays a refusal, witnessed) and
the rehearsal machinery above landed 2026-07-25. The 0072-lane custody
residuals (control-plane receipt authentication, backup-manifest binding)
and the missing `rehearse` verb are recorded in
`20260726-0081-spec-amendment-frictions.md`. LLP 0081 is Implemented on
the local profile.
