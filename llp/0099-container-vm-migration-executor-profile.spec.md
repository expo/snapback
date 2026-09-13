# LLP 0099 — Container-VM migration-executor conformance profile

**Type:** Spec
**Status:** Accepted
**Systems:** Migrations, Deployment, Storage, Backup and restore, CLI, Testing
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-26
**Revised:** 2026-08-06 (dated amendment drafted at the author's
direction and ratified by the author the same day: LLP 0188 §3 checkpoint
proof as a second qualifying pre-apply form, §"Downtime ceiling and
checkpoint"; the proof form remains gated on LLP 0188 G3). 2026-08-03 (Accepted 2026-08-03 by the author — decision
sitting #2, "accept all that verify",
`issues/20260803-author-decision-sitting-2.md`; acceptance covers the Spec
text only: the §Gates ladder G1–G3 stands unchanged and
`container-vm-migration-executor.v1` still appears in no capability manifest
until G3 passes; all historical open questions were already resolved
2026-07-28; status Review → Accepted).
2026-07-28 (unreviewed post-round correction: LLP 0081-compatible
pre-publication ceiling semantics, a closed signed deadline envelope,
interruption handling, and a separate LLP 0113 provisional-publication
observation gate). 2026-07-28 (LLP 0113 corrective reconciliation: trusted
absolute deadline, reboot-safe budget exhaustion, admission expiry, and exact
forward/recovery cutoffs). 2026-07-28 (round-2 reconciliation: admission binds a backup
policy then an exact supplemental checkpoint; cancellation uses LLP 0081's
states and a signed generation; the 180-second ceiling reserves bounded
abort/reopen time). 2026-07-28 (first hosted executor decisions: enqueue
admission with barrier re-proof, checkpointed cancellation, a 180-second
initial downtime ceiling, streaming-backup qualification, and closed receipt
identities)
**Related:** LLP 0072, LLP 0081, LLP 0007, LLP 0014, LLP 0063, LLP 0075, LLP 0076, LLP 0098, LLP 0111, LLP 0113

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
`issues/shelved/20260724-step5-impl-0081-hosted-do-executor.md` (relocated from the
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

## First hosted executor decisions — 2026-07-28

This section resolves the normative choices that gate G2/G3.

### Admission and cancellation

The standing supervisor admits at enqueue. It persists a signed
`MigrationAdmissionV1` before the executor job becomes runnable, binding the
approval, plan/input digest, target binding/control head, active generation,
source schema, backup policy, migration audience, supervisor enqueue-lease
epoch, replay floor, and `admissionExpiresAt`. It does not yet name a backup
artifact or barrier lease that does not exist. Creating the qualifying backup
is the first admitted physical effect.

The closed order is:

1. persist `MigrationAdmissionV1` with the backup policy and expected source
   head/schema/version;
2. create and read back the streaming backup, restore it into isolation, and
   open it at the captured source version;
3. append a signed `MigrationCheckpointV1` to the same admission, binding the
   exact backup/restore evidence and a newly acquired barrier-lease epoch;
4. acquire the application barrier, then require the current source
   head/schema/version to equal the checkpoint. Drift releases the barrier,
   marks the checkpoint stale, and requires a new admission/checkpoint; and
5. begin migration batches only after that exact re-proof.

No source fence is claimed while the online backup runs. Safety comes from the
exact equality check under the later barrier, not from assuming the source was
quiet. Crashes and cancellation before, during, or after backup replay from the
operation journal; a complete artifact can be adopted only through the exact
checkpoint append, and an incomplete artifact is cleanup-only.

Cancellation is a monotone, supervisor-signed `MigrationCancellationV1`
generation stored in the external head and copied into the target journal.
The target must freshly prove that generation at every durable batch boundary
and immediately before `published-held`; partition or stale proof aborts before
publication. Before the barrier, `admitted → cancel_requested → aborting →
cancelled` occurs with no application write. During
`executing(step,batch)`, the same existing LLP 0081 states reach the next
durable checkpoint and then `aborting → cancelled`. These are mappings onto
LLP 0081's closed vocabulary, not new journal states. After
`published-held`, cancel cannot unpublish and is translated into a separately
approved compatible rollback. Lost responses are reconciled from journal and
external head rather than CLI timeout.

### Downtime ceiling and checkpoint

LLP 0081's implemented ceiling semantics remain controlling. The plan's
approved maximum barrier downtime applies through the publication attempt and
expires when the journal durably enters `published-held`; once
`published-held` exists, that migration ceiling no longer applies. This
profile accepts an approved ceiling from `45000 ms` through `180000 ms`. It
is measured conservatively from the signed pre-barrier authorization
timestamp defined below, which is no later than actual write withdrawal,
through the checked attempt that either enters `published-held` or takes the
safe pre-publication abort path.

For any admitted ceiling, the final `45000 ms` is reserved for abort and
predecessor reopen. No batch starts at or after `migrationCeilingAt - 45000
ms`. The one batch already running at that cutoff has at most `5000 ms` to
reach an interrupted transaction boundary; abort must begin by
`migrationCeilingAt - 40000 ms`. Qualification must prove a worst observed
abort-plus-reopen bound plus 50% margin no greater than `40000 ms`; otherwise
this profile remains unsupported. At the profile maximum those instants are
`barrierStartedAt + 135000 ms`, `+140000 ms`, and `+180000 ms`. The five
seconds is part of the 45-second recovery reserve, not extra deadline
tolerance or a reason to extend the plan ceiling.

Rehearsal p95 is admission evidence only, measured against the same
pre-publication ceiling; it cannot relax a cutoff. Exceeding the approved
ceiling before `published-held` is the LLP 0081 conformance failure and safe
abort; predecessor health must be restored by `migrationCeilingAt` or the
receipt records a conformance failure, with no provider SLA inferred.
Successor observation, release, and rollback after `published-held` follow
LLP 0081's fenced state machine and the separate LLP 0113 provisional-
publication gate below; they are not included in or constrained by the
migration ceiling.

At every checkpoint and final publication the target freshly verifies the
signed cancellation generation and supervisor/control head. Network partition,
stale cancellation state, uncertain reopen, or uncertain publication refuses
forward progress and enters journaled reconciliation. An operation that begins
abort cannot later publish. Raising the ceiling or either reserved bound
requires a dated amendment and a new remote corpus.

The qualifying pre-apply checkpoint is the existing streaming SQLite backup to
the separately permissioned Tigris object-store prefix. It must be complete,
content-addressed, integrity-checked, restored into an isolated volume, and
opened at the exact source schema/durable version/replay floor before the
supplemental `MigrationCheckpointV1` and barrier re-proof.
A provider volume snapshot may be retained as supplemental evidence but never
satisfies `SNAPBACK_MIGRATION_BACKUP_REQUIRED`.

#### Dated amendment — 2026-08-06 (ratified by the author 2026-08-06): LTX checkpoint proof as a second qualifying pre-apply form

Required by LLP 0188 §7 (Accepted 2026-08-06), which builds the continuous
LTX replication lane this profile's resolved decision predates.
This amendment admits an **LLP 0188 §3 checkpoint proof** as a
second qualifying form of the pre-apply checkpoint, alongside — not
replacing — the existing streaming SQLite backup. Admissibility conditions,
all mandatory: the proof satisfies every requirement of the paragraph above
unchanged (complete, content-addressed, integrity-checked, restored into an
isolated volume, opened at the exact source schema/durable version/replay
floor, before the supplemental `MigrationCheckpointV1` and barrier
re-proof); it additionally binds LLP 0188's identities (replication
incarnation and generation lineage resolved through the head, and —
distinctly — this profile's LLP 0072 data/reset identity) and the governing
keyring snapshot, making it full-instance-restorable; and its named
boundary and governing snapshot are pinned per LLP 0188 §3 for the lifetime
of every referencing artifact, not merely the consuming admission. Which
form an admission uses is named in the admission record; either satisfies
`SNAPBACK_MIGRATION_BACKUP_REQUIRED` once LLP 0188's G3 has passed for the
proof form. Provider volume snapshots remain supplemental-only. Until G3
passes, the existing streaming backup remains the only qualifying
artifact.

### Closed remote receipt

The G3 receipt binds the approval, admission, rehearsal, resident executor job
and operation id, every durable checkpoint, qualifying backup/isolated restore,
barrier and downtime samples, terminal executor receipt, rollback expected
value, target binding/control head, source and target images, and the exact
nine-package publication ledger identities from LLP 0041. Every audience named
by the migration plan is enumerated and proven; no summarized "package set"
field substitutes for the nine exact package name/version/digest triples.

The standing supervisor's external database is the authority for approval,
admission, cancellation, and consumed-rehearsal records, with its monotone
Tigris mirror and incarnation/head recovery rules from LLP 0111. The target
process holds only the resident executor journal and cannot mint or renew
control-plane approval.

These decisions close open questions 1–4 for this profile. The questions remain
historical context for other hosted profiles and future ceiling changes.

### Unreviewed post-round correction: deadline and admission closure

The target does not reconstruct absolute time by summing process-local
intervals. Before write withdrawal, the supervisor samples its trusted
control-plane clock, creates one `MigrationDeadlineV1`, writes it to the
external operation head, and requires the target to persist the identical
bytes before acquiring the barrier:

```text
{
  schemaVersion: 1,
  issuer,
  keyId,
  admissionId,
  operationId,
  approvalSha256,
  admissionSha256,
  audienceSha256,
  barrierLeaseEpoch,
  issuedAt,
  admissionExpiresAt,
  barrierStartedAt,
  approvedBarrierCeilingMs,
  migrationCeilingAt,
  noNewBatchAt,
  abortMustBeginBy,
  provisionalObservationDecisionAt,
  provisionalPublicationExpiresAt,
  signature
}
```

The object has exactly those members and is canonicalized with RFC 8785 JCS.
`approvalSha256` and `admissionSha256` hash the JCS bytes of the exact
`MigrationApprovalV1` and `MigrationAdmissionV1`; `audienceSha256` hashes the
JCS object containing all nine required `MigrationAudienceV1` fields.
`barrierLeaseEpoch` is the exact subordinate migration-lease fencing epoch.
All digests are lowercase 64-character hexadecimal SHA-256. All timestamps
are canonical UTC RFC 3339 strings with exactly millisecond precision and a
literal `Z`; parsing and reserialization must produce identical bytes, and
unknown members or invalid ordering relations are refused. `schemaVersion` is
the JSON integer `1`; `approvedBarrierCeilingMs` is the exact approved-plan
JSON integer in the inclusive range `45000..180000`. IDs, issuer, key id, and
lease epoch use their existing closed generated scalar grammars.

The signature is a 64-byte Ed25519 signature encoded as unpadded base64url
over:

```text
"snapback-migration-deadline-v1\0" ||
JCS(MigrationDeadlineV1 without signature)
```

`keyId` resolves only under the supervisor service-intermediate purpose
`migration-deadline`; a release, operator, target, or general
control-plane key cannot sign this envelope. Verification binds the current
supervisor installation, issuer, operation, admission, approval, complete
audience, and barrier lease before consulting a timestamp. A replay across any
of those values is invalid even if its signature and time window are
otherwise valid.

`issuedAt` is the trusted sample taken immediately before the one-shot barrier
authorization, and `barrierStartedAt` equals that sample. Actual write
withdrawal may occur slightly later, so this value starts the budget early and
is conservative. Failure or uncertainty while acquiring the named barrier
abandons the admission; no replacement envelope or later
`barrierStartedAt` may be issued for that admission. The target additionally
records its local monotonic barrier-acquisition tick and uses it only to fail
earlier.

`MigrationAdmissionV1` has a fixed, nonextendable maximum TTL:
`admissionExpiresAt` must be no later than 30 minutes after the admission's
canonical `issuedAt`. The admission and checkpoint must both remain unexpired
when the deadline is issued and when the barrier is acquired. There is no
renew operation and an expiry cannot be moved; expiry before the barrier
records `admitted -> abandoned`, makes incomplete backup artifacts cleanup
only, and requires a new approval, admission, checkpoint, and deadline.
Expiry during backup aborts and cleans the partial backup. Source durable-head,
schema, stream-incarnation, or version drift at the barrier likewise
invalidates both admission and checkpoint. Neither reboot nor operator retry
revives an abandoned or stale admission.

Validation requires
`admission.issuedAt <= issuedAt == barrierStartedAt < admissionExpiresAt`;
the exact cutoff arithmetic below establishes the remaining timestamp order.
`migrationCeilingAt = barrierStartedAt + approvedBarrierCeilingMs`,
`noNewBatchAt = migrationCeilingAt - 45000 ms`, and
`abortMustBeginBy = migrationCeilingAt - 40000 ms`. The target checks trusted
absolute time before and after every batch and immediately before the
publication transition. At `noNewBatchAt` it starts no new batch. The SQLite
progress interrupt gives the one in-flight batch at most five seconds to
commit or roll back its transaction; by `abortMustBeginBy` the journal must
be on the abort path. The remaining 40 seconds are the qualified
abort-and-predecessor-reopen reserve. These arithmetic relations are part of
signature validation, not advisory fields.

After a crash, stop/start, or instance replacement, the target asks the
supervisor for a fresh signed time-and-head observation bound to the original
operation, admission, audience digest, lease epoch, and external operation
head. The target supplies a fresh 16-byte random nonce; the proof signs that
nonce, the bound fields, head digest, and `observedAt` under the same dedicated
key purpose. The target accepts it only when its monotonic request round trip
is at most five seconds and `observedAt` was sampled after the supervisor
received that nonce. If that proof agrees with the original deadline, the
target compares its absolute `observedAt` with the unchanged cutoffs and may
resume only in the state LLP 0081 permits; it never issues a new deadline or
resets elapsed time. Unavailable or stale supervisor time, a mismatched head,
clock uncertainty, or inability to prove the original barrier epoch takes the
safe abort/reconciliation path before publication. From `published-held`, the
same uncertainty remains fenced and permits only LLP 0081's explicit release
or audited rollback; it never guesses that the predecessor is active.

The last two timestamps are not migration-ceiling fields.
`provisionalObservationDecisionAt = barrierStartedAt + 140000 ms` and
`provisionalPublicationExpiresAt = barrierStartedAt + 180000 ms` implement
LLP 0113's target-enforced provisional-publication observation window after
`published-held`. If successor health is absent at the decision point, the
supervisor may invoke only the separately authorized, generation-bound
rollback that LLP 0081 permits. At expiry the provisional migration claim
family becomes unusable at the target even if supervisor withdrawal fails.
Expiry records a publication-observation failure; it does not extend the
migration ceiling, invent a journal transition, implicitly restore the
predecessor, or accept a late health result. A later claim requires a new
LLP 0113 qualification generation and publication epoch.

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

## Historical open questions — resolved for this profile on 2026-07-28

The following questions are retained as provenance. The controlling answers are
the dated decisions above; they are not open implementation choices for this
profile.

1. Where does the control plane persist approval and rehearsal-receipt
   records before LLP 0072's control-plane store exists? (Adjacent to LLP
   0072 open question 4.) **Resolved:** the standing supervisor's external
   database plus monotone mirror.
2. Admission timing: LLP 0081 §2 lets each hosted profile fix its own
   admission point. Control-plane enqueue ahead of the barrier (admission
   record written at enqueue, re-proved at barrier) is the working
   assumption; at-barrier admission like the local profile is simpler but
   makes `cancel` a race. **Resolved:** enqueue admission with barrier re-proof
   and a signed monotone cancellation generation.
3. Should the profile's declared downtime ceiling be recalibrated from
   remote measurements (provider restart latency is part of the barrier
   window on this adapter), and does LLP 0072 open question 3's measured
   ceiling subsume it? **Resolved:** a 180-second maximum approved
   pre-publication ceiling with explicit forward/recovery budgets;
   measurements admit or refuse but never recalibrate. Post-`published-held`
   `+140`/`+180` observations are the separate LLP 0113 provisional-
   publication gate, not migration-ceiling time.
4. Is the pre-apply checkpoint a provider volume snapshot or the existing
   streaming SQLite backup to the separately permissioned object store —
   and if both are offered, which one satisfies
   `SNAPBACK_MIGRATION_BACKUP_REQUIRED`? **Resolved:** verified streaming
   SQLite backup; provider snapshots are supplemental only.
