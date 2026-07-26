# LLP 0099 — Container-VM migration-executor conformance profile

**Type:** Spec
**Status:** Draft
**Systems:** Migrations, Deployment, Storage, Backup and restore, CLI, Testing
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-26
**Revised:** —
**Related:** LLP 0072, LLP 0081, LLP 0007, LLP 0014, LLP 0063, LLP 0075, LLP 0076, LLP 0098

## Summary

This Spec is the first separately admitted hosted migration-executor
conformance profile that LLP 0081 §1 requires of every hosted target
("each hosted target … is a separately versioned LLP 0072 conformance
profile admitted later by its own corpus run"). Per the answered LLP 0081
open question 7 (author decision, 2026-07-26), it rides
`single-instance-container-vm.v1` — the adapter LLP 0072's first-adapter
decision (2026-07-22) selected. The profile id is
`container-vm-migration-executor.v1`.

The Durable Object executor is the explicit second profile, not a discard:
the author directive is that both hosted lines must reach production
quality. Every DO-specific mechanism — shared-dispatcher wakeups under LLP
0014's one-alarm rule, eviction between batches as an ordinary event, alarm
contention with application schedules — is out of scope here and travels
with the Cloudflare line whenever it qualifies under LLP 0072.

This document is buildable as a spec today and claims nothing today. Its
conformance corpus can be claimed only after the container-VM adapter
passes LLP 0072's own drill corpus with remote evidence (§Gates). LLP 0072
currently records `activationEligible: false`, `remoteEvidence: false`, and
"no control-plane adapter operations" for the one provisioned drill target.

## Authority and scope

LLP 0081 owns migration semantics — the canonical plan, approval and
admission records, the closed 13-state journal machine, the persisted lane
fence, verification, rollback, rehearsal, and the stable diagnostics. LLP
0072 owns hosted identities, the control plane, the deployment state
machine, backup manifests, and the adapter contract. This profile binds the
two for one adapter and adds no new semantics: where this document and
either RFC disagree, the RFC wins and the disagreement is a defect here.

Everything LLP 0081 §4 already specifies about execution — batch atomicity,
`published-held`, the downtime ceiling, cancellation, crash recovery — is
normative on this profile unchanged and is not restated below except where
the adapter supplies the mechanism.

## Identity binding

`MigrationApprovalV1` and `MigrationAdmissionV1` bind LLP 0081 §2's
"complete target audience … where the deployment class defines them". On
this profile the deployment class defines all of them, so all nine
`MigrationAudienceV1` fields are **required**, not optional as on the local
profile:

- `projectId`, `targetId`, `environmentId`, `deploymentId` — LLP 0072's
  registered identities for the one deployment; `targetId` is the
  never-reused operator-registered target, resolved and displayed before
  the mutating operation (LLP 0072 §Identities), never an alias;
- `releaseId` — the content-addressed release whose successor schema the
  plan proposes; a plan whose successor schema hash is not the named
  release's schema digest refuses `SNAPBACK_MIGRATION_TARGET_MISMATCH`;
- `databaseId` and `streamIncarnation` — the data/reset authority the
  barrier closes over;
- `activationGeneration` — the traffic authority at approval time; a
  generation switch between approval and admission is audience drift and
  refuses stale, exactly like every other audience mismatch; and
- `targetProfileId` — the exact adapter profile,
  `single-instance-container-vm.v1`, never conflated with target identity.

Hosted approval is an LLP 0072 control-plane operation with an audited
operator principal, per LLP 0081 §2's hosted rule ("a file written by the
plan-generating agent is not authority"). The control-plane operation that
records the approval is the audited carrier: it appends to LLP 0072's
hash-chained receipt/audit chain, stores the `MigrationApprovalV1` record
owner-only outside the protected deployment, and is consumed single-use at
admission keyed by the approval's own fresh `operationId` plus audience.
The receipt records whether generator and approver are distinct; the
first-profile same-human exception remains explicit policy, never inferred.

## Executor placement and resume

LLP 0081 §1: the executor runs inside the target's durability owner, not as
an operator CLI process holding a long request open. On this adapter the
durability owner is the one Snapback runtime/server process co-resident
with the encrypted attached SQLite volume (LLP 0072 §Adapter contract).
Concretely:

- **Enqueue.** Control-plane admission durably enqueues the exact approved
  plan artifact in the deployment's own database — the same journaled ops
  row the local profile writes — before any physical step, under the closed
  fence. The CLI submits, observes, or cancels only at admitted boundaries
  over the control-plane channel; it never drives batches remotely.
- **Wake/resume mechanism.** The adapter's required process supervision
  (provider container supervision or `systemd` with restart and
  interruption evidence — LLP 0072 §Adapter contract) is the resume
  mechanism. On process start, a non-terminal journal state re-acquires the
  migration lease and barrier and resumes per LLP 0081 §4 before admitting
  anything else. There is no alarm registration, no shared dispatcher, and
  no eviction-between-batches posture: those are the DO profile's
  mechanisms, parked with LLP 0014.
- **Fencing token.** The lease epoch remains the fencing token. Because the
  adapter guarantees exactly one runtime process per deployment, a
  superseded executor instance can arise only across supervisor restarts or
  instance replacement; the journaled epoch check refuses the stale
  instance either way, and that refusal is a conformance witness, not an
  assumption.

**Interruption-class mapping.** LLP 0081's injected-fault classes map to
this adapter's real interruption classes:

| 0081 fault class | container-VM interruption class |
| --- | --- |
| crash inside/between durable transitions | (a) process kill → supervisor restart |
| crash at batch boundaries | (a), and (b) instance stop/start with volume intact |
| crash between predecessor reopen and resume | (b) — fence must refuse every registered lane on reopen |
| crash immediately before/after final publication | (a) and (b) |
| slow executor / crash past deadline | downtime-ceiling fixtures re-run under (a) |
| executor supersession | (c) instance replacement with volume reattach — stale lease epoch refused |

Classes (a) and (b) must be witnessed remotely for each fault class above;
class (c) at least once over the full corpus. The exhaustive
transition-interior fault matrix stays local (it is already witnessed on
the shared engine); the remote runs sample at least one interior fault per
durable transition class rather than re-running the exhaustive interior
remotely, and the receipt says exactly which faults ran where.

## Approval and rehearsal custody

This section closes the 0072-lane custody residuals recorded in
`issues/20260724-step5-impl-0081-hosted-do-executor.md` (relocated from the
frictions ticket) — the two things the local profile's structural custody
cannot express:

1. **Rehearsal receipts are control-plane records.** On this profile the
   rehearsal-marked receipt of LLP 0081 §7 is retained by the control plane
   keyed by production `planDigest` plus rehearsal `operationId`, appended
   to the same hash-chained audit chain as approvals, and consumed
   single-use at production admission. An operator file presented to
   `migrate apply --rehearsal-receipt` is accepted only if it byte-matches
   the control-plane record; the control-plane copy is the authority.
   Freshness is the target-profile-declared maximum age (LLP 0081 §7,
   default seven days), evaluated against the control-plane record's
   creation operation, not the file's mtime.
2. **The rehearsal binding names a verified backup manifest.** The
   `MigrationRehearsalPlanV1` binding's source backup identity must
   reference an LLP 0072 backup manifest whose per-component hashes passed
   read-back verification — never an operator-asserted string. The
   restore-derived rehearsal target is produced by LLP 0072's restore
   discipline (isolated destination, restore epoch, verification before any
   activation) and carries a non-production classification; rehearsal
   execution against any production-classified target refuses
   `SNAPBACK_MIGRATION_REHEARSAL_INVALID` exactly as implemented locally.

Pre-apply backup for production follows LLP 0081 §7's hosted rule
unchanged: the profile consumes LLP 0072's control-plane backup manifest —
artifact digest, secret names/generations but never values, an encryption
key reference held outside the protected deployment — and never routes
backup keys through the application secret API.

## Conformance corpus

The profile is admitted by its own corpus run per LLP 0081's closing
paragraph, and the first passing corpus is recorded in this document by a
dated amendment. `remoteEvidence: true` means what LLP 0072's harness
means: raw provider facts plus normalized results from the real
deployment, receipts binding target/deployment/database/stream identities,
public origin and certificate fingerprint, and every GAP named — not a
local run with a remote-shaped label.

**Re-run remotely on the real deployment:**

- the admission matrix: tampered approval, expired approval, audience
  mismatch on each required field, stale plan, wrong `targetProfileId`,
  and the same-plan/different-operation separation;
- the interruption-class matrix above, including the
  fence-refuses-every-registered-lane witness after a crash between
  predecessor reopen and resume;
- the downtime ceiling: slow-executor and crash-past-deadline fixtures
  abort safely before publication and never apply after it;
- the §5 data proof (full method) over a seeded dataset, and §6 fast
  rollback from `published-held` with the rollback expected-value
  evaluation;
- retained-client behavior across a real publication: a compatible client
  takes the raised floor and one authorized resnapshot; an incompatible
  client receives the stable upgrade-required refusal and settles its
  quarantined offline mutation through resync-before-replay; and
- the rehearsal loop end to end: verified backup → isolated restore →
  `migrate rehearse` against the restore-derived binding → control-plane
  receipt → production `apply` consuming it, with the receipt refused when
  stale, cross-plan, or already consumed.

**Stays local-only:** golden plan/approval/admission vectors, planner
determinism, the pure expected-value evaluator equivalence, and the
exhaustive transition-interior fault matrix — these are properties of the
shared engine, already witnessed by the 0081 corpus, and re-proving them
remotely would add cost without adding evidence. The profile receipt lists
this split explicitly.

## Gates

Ordered, each gating the next; none is claimed today:

1. **G1 — adapter qualification.** The container-VM adapter passes LLP
   0072's own acceptance drill corpus with remote evidence. Today only the
   LLP 0075/0076 drill target exists (Fly.io `snapback-drill`, region
   `sjc`, with the LLP 0098 loopback-terminated hosted-auth admission as a
   partial pass); no control-plane adapter operations exist for it, and the
   drill posture (rootfs SQLite, `SNAPBACK_PROFILE=test`) is explicitly not
   this profile's substrate.
2. **G2 — executor arm.** The enqueue/resume arm on the single-instance
   lifecycle (Slice 2 of the recorded plan), driving the existing journal
   machine and fence with local witnesses for the supervisor-restart resume
   path and the stale-lease-epoch refusal.
3. **G3 — corpus run.** The remote conformance corpus above on a real
   deployment, recorded here by dated amendment.

Until G3, `container-vm-migration-executor.v1` appears nowhere in any
capability manifest and no artifact may require it.

## Non-goals

- everything LLP 0081 excludes (no rolling/zero-downtime migration, no
  multi-writer, no automatic down migrations);
- everything the adapter's cost boundary excludes (no HA, autoscaling, or
  multi-region — LLP 0072 §Adapter contract); and
- every DO-specific mechanism: shared-dispatcher wakeups, eviction-between-
  batches, alarm contention. Those define the second profile
  (`durable-object-migration-executor.v1`, unwritten), which must meet this
  document's evidence bar on its own substrate — the author directive is
  both lines at production quality, sequenced, not one line instead of the
  other.

## Open questions

1. Where does the control plane persist approval and rehearsal-receipt
   records before LLP 0072's control-plane store exists? (Adjacent to LLP
   0072 open question 4 — the paved operator credential/store experience.)
2. Admission timing: LLP 0081 §2 lets each hosted profile fix its own
   admission point. Control-plane enqueue ahead of the barrier (admission
   record written at enqueue, re-proved at barrier) is the working
   assumption; at-barrier admission like the local profile is simpler but
   makes `cancel` a race. Decide with the G2 executor arm.
3. Should the profile's declared downtime ceiling be recalibrated from
   remote measurements (provider restart latency is part of the barrier
   window on this adapter), and does LLP 0072 open question 3's measured
   ceiling subsume it?
4. Is the pre-apply checkpoint a provider volume snapshot or the existing
   streaming SQLite backup to the separately permissioned object store —
   and if both are offered, which one satisfies
   `SNAPBACK_MIGRATION_BACKUP_REQUIRED`?
