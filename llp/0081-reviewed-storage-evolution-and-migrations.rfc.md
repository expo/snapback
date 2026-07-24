# LLP 0081 — Reviewed storage evolution and migrations

**Type:** RFC
**Status:** Draft
**Systems:** Schema evolution, Migrations, Storage portability, Deployment, Backup and restore, Code generation, CLI, Diagnostics, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-20
**Revised:** 2026-07-24 (GPT round-1 reconciliation: semantic acceptance
decoupled from the implementation corpus; `MigrationPlanArtifactV1` pinned to
the corpus's RFC 8785/JCS + SHA-256 canonical encoding with domain separation
and golden vectors; authenticated `MigrationApprovalV1` and barrier-time
`MigrationAdmissionV1` records bind LLP 0072's complete target audience and
split plan identity from operation identity; `ContentDigestV1` is a normative
resumable streaming digest with sampling demoted to a named audit class; the
projection oracle adopts LLP 0080's split logical/system-field proof; typed
schema-transition journal events amend LLP 0007's grammar and publication
fires LLP 0053 activation obligations atomically; the durable admission fence,
atomic batch commits, and cancellation states complete the crash model; the
controller/executor protocol subordinates the migration lease to LLP 0072's
operation with staged function identities distinct from traffic activation;
fast predecessor republish is restricted to the pre-traffic maintenance
window with a rollback expected-value evaluator and restamped row versions;
retained-work postures narrow to `empty` and proven `dual-compatible`;
resource ceilings and `publicationTimestamp` monotonicity join the canonical
plan; deterministic IDs pin a UUIDv7-compatible construction; the local
SQLite profile is the Step 5 admission profile with hosted targets as
separately versioned conformance profiles; Durable Object wakeups register
with LLP 0014's shared alarm dispatcher); 2026-07-20 (post-review
reconciliation: deterministic inputs, independent data proof, retained-client
publication semantics, control-plane approval/backup custody, and resumable
hosted execution are pinned)
**Related:** LLP 0004, LLP 0007, LLP 0008, LLP 0010, LLP 0012, LLP 0014, LLP 0018, LLP 0036, LLP 0037, LLP 0041, LLP 0043, LLP 0046, LLP 0051, LLP 0053, LLP 0062, LLP 0063, LLP 0070, LLP 0072, LLP 0080

## Summary

Snapback schema evolution becomes an explicit preview, approval, execution,
verification, and rollback workflow whenever a change is not proven safe by
LLP 0007's additive startup applier. Codegen produces a canonical migration
plan from exact source and target schema identities. An operator or agent
reviews and approves that plan's digest; the runtime executes only that digest
against the exact resolved app/target and predecessor state it names.

The first profile is an exclusive, single-writer migration for trusted local or
trusted single-tenant deployments. It supports deterministic backfills,
constraint/index changes, field replacement, table replacement, and maintained-
projection rebuilds with transactional or shadow-generation publication. It
does not claim zero-downtime online migration, arbitrary JavaScript/SQL steps,
cross-tenant orchestration, or automatic SQLite-to-Postgres cutover.

This RFC is LLP 0063 Workstream 6's storage-evolution entry prerequisite and
the migration contract consumed by the trusted control plane in LLP 0072. A
Draft document, a preview without execution, or an executed plan without its
proof receipt satisfies neither gate.

## Motivation

LLP 0007 correctly keeps the first applier conservative: create tables, add
safe fields and indexes, preserve removed storage, and refuse rewrites whose
meaning is not already proven. That floor prevents data loss but leaves normal
product evolution—renames, backfills, required-field changes, new uniqueness,
projection rebuilds, and type replacement—without a paved workflow.

The missing workflow is more than DDL generation. A migration can be valid for
one schema pair and destructive against another app, one deployment, or one
unexpected data population. An agent-first system needs a reviewable artifact,
stable refusal codes, exact target fencing, deterministic data proofs, crash
recovery, and a receipt strong enough to support deploy/rollback and
backup/restore claims.

## Design

### 1. Authority and profile

The portable authority is a versioned `MigrationPlanV1` generated from:

- app identity and target profile;
- current installed schema manifest and canonical hash;
- proposed schema manifest and canonical hash;
- generated-function and maintained-projection identities affected by the
  change;
- declared migration intents supplied by the author; and
- the target's machine-readable migration capabilities.

The first executable profile is `exclusive-single-writer.v1`. Before execution,
the target refuses new application invocations, subscriptions, jobs, and writes;
drains admitted work; checkpoints the exact predecessor commit version; and
keeps reads unavailable or explicitly maintenance-mode. A target that cannot
establish this barrier reports `SNAPBACK_MIGRATION_PROFILE_UNSUPPORTED`.

The canonical local SQLite target carries this profile and is the LLP 0063
Step 5 admission profile: the local migration contract is what Step 5
consumes, and hosted evidence does not block it. Each hosted target — the
author-ratified trusted single-tenant minimum first — is a separately
versioned LLP 0072 conformance profile admitted later by its own corpus run;
LLP 0072 records that profile as unsupported until a first adapter is
selected and witnessed. Multi-tenant, horizontally
replicated, or untrusted application execution needs a later online protocol.

The executor runs inside the target's durability owner, not as an operator CLI
process holding a long request open. For the existing Cloudflare Durable Object
shape, control-plane admission durably enqueues the exact plan in the app's
write-owning object; an alarm- or request-resumed state machine performs one
capability-bounded batch at a time, commits each journal cursor in object-local
SQLite, and treats eviction between any two batches as ordinary. Migration
wakeups register with LLP 0014's shared one-alarm dispatcher rather than
claiming the object's alarm, and scheduler contention with application alarms
is a named fault-injection case. The CLI
submits, observes, or cancels only at an admitted boundary. Every hosted target
must name its resident executor, batch/request limits, durable wake mechanism,
and fault-injection hooks in its migration capability. A process-local lease,
cursor, or barrier cannot satisfy this profile.

### 2. Canonical plan and approval

Every plan has:

- deterministic `planId`, schema version, and canonical SHA-256 digest;
- exact app, instance, target-profile, predecessor-schema, successor-schema,
  and predecessor schema/activation generation;
- ordered typed steps with stable step IDs;
- per-step preconditions, read/write sets, resource bounds, reversibility, and
  verification queries;
- compatibility posture for old and new application artifacts;
- backup/checkpoint requirements;
- expected output schema and maintained-projection generation hashes; and
- cleanup and rollback boundaries.

The serialized authority is `MigrationPlanArtifactV1 { body, planDigest,
planId }`: `planDigest` is SHA-256 over the canonical `body` bytes, `planId`
is `migration-v1:<planDigest>`, and neither outer field appears inside
`body`, so validation recomputes the body digest with no self-reference.
Canonical bytes use the corpus's existing RFC 8785 (JCS) rule from LLP 0062
with a `snapback:migration-plan:v1` domain-separation prefix, and the
committed schema ships golden vectors so independent implementations prove
byte agreement. The execution strategy (single-transaction versus shadow
generation), the declared proof method and bound, and the approval-relevant
resource ceilings — maximum affected rows, bytes, writes, and barrier
downtime — are canonical `body` fields; nothing approval-relevant lives
outside the digest. The ceilings are barrier-time admission preconditions:
a predecessor that has grown past what the approver reviewed refuses with
`SNAPBACK_MIGRATION_PRECONDITION_FAILED` and requires a new preview and
approval, so semantic-precondition drift cannot smuggle in a much larger
operation than was approved. Target
observations that do not authorize execution—including the preview-observed
commit version—live in a separately digested `MigrationPreviewObservationV1`
attached to preview output, not in the canonical plan. The observation is
itself canonical under the same encoding and pinned to its snapshot; only
plan bytes are required to be byte-identical across repeated previews. The
observation records
target head, time, bounded precondition summaries, and capability health —
dynamic health facts, distinct from the static capability digest the plan
binds. Approval and the final receipt retain its digest for review context,
but apply
does not mistake a changing observation for plan authority.

Serialization is canonical and byte-identical across clean checkouts **for the
same explicit inputs**. Migration constants are inputs, not ambient values:
timestamps are supplied explicitly to preview and deterministic ID namespaces
derive from `planId` plus source-row identity. The complete constants object is
inside the canonical plan and its approval digest; apply creates none. Preview
is read-only against application state: it may inspect schema metadata, run
bounded aggregate preconditions, and write its own preview/checkpoint records,
but it cannot issue application DDL/DML, acquire the execution barrier, write
the migration journal, or mutate the installed manifest.

Approval is a typed, authenticated `MigrationApprovalV1`: it binds the exact
plan digest, the observation digest it reviewed, the approval-policy digest,
the complete target audience — LLP 0072's exact `projectId`, `targetId`,
`environmentId`, `deploymentId`, `databaseId`, `streamIncarnation`,
`activationGeneration`, and `targetProfileId` where the deployment class
defines them, with the local profile binding the resolved local target
identity — the approver principal, issue and expiration timestamps, and a
single fresh `operationId` distinct from `planId`: one plan may be executed
as different operations only through separate approvals, and target identity
is never conflated with target profile. At barrier
time, admission emits a `MigrationAdmissionV1` binding the actual predecessor
head, the enforced resource bounds, and the approval it consumes; the receipt
carries both records. Editing source schemas, declarations, constants,
target identity, or capabilities invalidates approval and requires a new
preview. The observed commit version is informational rather than an equality
precondition: under the execution barrier, apply re-proves every data-dependent
precondition against the actual predecessor and records the drift plus barrier
duration. Schema/manifest/capability drift remains strictly stale. There is no
"approve latest" or wildcard target mode.

Local-development approval may be a local authenticated operator record. A
hosted or production approval is an LLP 0072 control-plane operation with an
audited operator principal; a file written by the plan-generating agent is not
authority. The receipt records whether generator and approver are distinct. A
target policy may permit the same human authority for the first trusted
single-tenant profile, but that exception is explicit, never inferred.

The CLI surface is:

```text
snapback migrate preview --app <id> --target <target-id> \
    --profile <profile-id> --out migration.json
snapback migrate approve migration.json
snapback migrate apply migration.json
snapback migrate cancel migration.json
snapback migrate verify migration.json
snapback migrate rollback migration-receipt.json
```

Each command emits the shared structured result envelope and supports a
machine-readable dry run. `apply` requires the approved file by path; it never
regenerates a possibly different plan implicitly. `cancel` requests
cancellation at the next admitted boundary and never leaves the state machine
outside a named state.

### 3. Typed migration steps

V1 admits only closed steps whose portable semantics Snapback owns:

- `CreateTable` and `CreateIndex`;
- `AddField` with a portable literal or closed backfill expression;
- `BackfillField` into a new or nullable destination;
- `ValidateRequired` followed by `MakeRequired`;
- `ValidateUnique` followed by `CreateUniqueIndex`;
- `CopyField` and `CopyTable` into successor storage;
- `StageTableGeneration`;
- `RebuildMaintainedProjection` under LLP 0080; and
- `RetireField`, `RetireTable`, or `RetireGeneration` as logical retirement,
  with physical cleanup separately fenced after the rollback window.

Backfill expressions use the closed LLP 0051 value vocabulary over the source
row plus the plan's explicit migration constants. They cannot call application
handlers, read ambient time/randomness, perform network I/O, access secrets, or
read an undeclared table. The executor replays constants as data and derives IDs
only through the plan's pinned deterministic namespace rule: a synthesized ID
is a UUIDv7-compatible value whose time bits carry the plan's approved
`publicationTimestamp` and whose remaining bits derive from a domain-separated
SHA-256 over plan digest, step ID, source table and row key, destination
table and generation, and output ordinal — collision-scoped per destination,
satisfying LLP 0007's UUIDv7 contract, and shipped with conformance vectors.

V1 represents a rename or type change as add/copy/validate/publish/retire. It
does not issue an in-place semantic rename or cast that one target happens to
support. A narrowing conversion must declare a total conversion and a bounded
preflight proving every source value is convertible. Unconvertible rows fail
before publication and remain in the predecessor generation.

Raw SQL, JavaScript callbacks, shell commands, and target-specific migration
blocks are portability opt-outs. They may exist behind a separately named
target profile, but cannot satisfy LLP 0063's portable migration claim.

Full-table preconditions and proofs use a privileged
`MigrationKeysetScanV1`, not the app query surface and not raw SQL. It reads one
declared table/index in stable key order, enforces target-specific batch/byte/
time ceilings, emits only the closed validator/digest facts the plan requests,
and checkpoints its cursor. Targets expose it as a migration capability. It
does not relax LLP 0007's 1,024-row application-query or 500-binding limits.

### 4. Execution, journaling, and crash recovery

The executor acquires the exact app migration lease, establishes the exclusive
barrier, rechecks every identity and precondition, creates the required backup
or checkpoint, and then appends a journal entry before each physical step. The
journal contains plan/step identity, input generation, attempt, state, progress
cursor, output generation, verification result, and durable error code. The
executor is a complete durable state machine — including
`cancel_requested`, `aborting`, `cancelled`, and cleanup states — and every
transition is journaled; fault injection in acceptance exercises the interior
of every durable transition, not only batch boundaries.

The barrier itself is durable: admission writes a persisted migration fence
that every application lane — query, mutation, subscription, job, worker —
consults before opening. A crash between reopen and resume therefore cannot
readmit application writes: the fence outlives the process and clears only
when the journal reaches a terminal state (published, rolled back, cancelled,
or abandoned by an authorized operator action recorded in the journal). Each
batch commits its shadow writes, progress cursor, digest-accumulator state,
and journal transition in one target transaction — or defines idempotent
replay from the last committed batch — so no component of progress can lead
or lag the others.

The journal lives in the target's durability domain. Its final publication
record commits atomically with schema/generation publication; normal crash
recovery therefore cannot produce an ambiguous answer. The
`SNAPBACK_MIGRATION_PUBLICATION_AMBIGUOUS` code is reserved for corruption or a
target violating that atomicity contract. Resume re-acquires the lease and
barrier before touching shadow state. Approval expiration prevents admission of
a new operation but does not strand an already journal-admitted migration; its
original approval remains bound in the journal.

Small SQLite changes execute in one transaction. A bounded backfill or table/
projection rebuild may use deterministic keyset batches into a shadow
generation. Batch progress advances only after its writes commit, so retry
replays the next uncommitted key range. The predecessor remains authoritative
until every step and verification passes and one final transaction publishes
the successor schema, table/projection generations, function identities, and
commit-version boundary together.

Shadow writes are migration-private: they do not advance the application
commit-version stream, emit application changesets, or become retained-client
history. Final publication allocates exactly one successor application version,
appends one schema-resync journal event, and raises the retention floor to that
version in the same transaction. The `schema-resync` and `rollback-resync`
events are typed schema-transition entries added to LLP 0007's journal
grammar by a same-landing normative amendment — LLP 0007 treats unknown
operations as corruption, so the grammar extension and the head/high-water
invariant's coverage of these events land with this RFC's acceptance, not as
an implicit dialect. The same publication transaction fires LLP 0053's
activation obligations for auth-scoped state — durable dispositions, fences,
and acknowledgement semantics — rather than treating a generic resync as
their substitute. What publishes with the storage is the **staged**
generated-function and schema identity set — the artifacts the successor
database admits; control-plane traffic activation of a release remains
LLP 0072's separate step, which consumes this receipt.

Successor rows retain their logical system
identities. Rows inherited from the predecessor preserve `_id` and `_createdAt`;
an inherited row whose user-visible content changes receives `_version` equal
to the publication version and `_updatedAt` equal to the plan's explicit
`publicationTimestamp` constant, and admission requires `publicationTimestamp`
to be at least the maximum `_updatedAt` among rows the plan changes, so a
row's visible timestamp never moves backward. Unchanged rows preserve all
four system
fields. Newly synthesized rows use the plan's deterministic ID namespace,
`publicationTimestamp` for both timestamps, and the publication version.
Index-only or metadata-only steps do not rewrite rows. The expected-value
evaluator and canonical content digest cover user and system fields under these
same rules. Client behavior across publication is posture-aware: a client
whose artifacts the compatibility declaration admits takes the existing
handshake/resync path; an incompatible client receives a stable
upgrade-required refusal, with its client-custodied offline mutations
quarantined for the resync-before-replay path rather than silently replayed
or dropped; no pre-publication cursor can replay through the raised
floor. Before reopening, the successor proves LLP 0007's exact
head/change-journal high-water cut. A future stream-incarnation bump may replace
this profile, but v1 does not leave the mechanism implicit.

A crash before publication reopens the predecessor and resumes or discards the
unpublished shadow generation according to the journal. A crash after
publication reopens only the successor and resumes cleanup; it never rolls back
implicitly or exposes a mixture. An ambiguous publication record fails closed
and requires inspection—guessing from physical tables is forbidden.

For hosted targets, the controller/executor protocol runs under LLP 0072's
`operationId` with one lock order: the control plane holds the deployment
lease first, pins the exact activation/database/stream-incarnation fence,
then grants the subordinate app-local migration lease; the barrier-consistent
backup token and verified manifest are acquired under that fence; execution
is resident per §1; and the control plane consumes the migration receipt
before any traffic activation. Crash recovery on either side finds the other
side's durable state through the shared `operationId` — neither authority
guesses. LLP 0072's backup/restore machinery remains the owner of backup
creation; this RFC's executor requests and binds it, never reimplements it.

Only one migration may own an app at a time. Replaying the same completed plan
returns its prior receipt. A different plan against an active or completed
predecessor identity is rejected.

### 5. Verification and data proof

Every step defines executable verification. The final proof includes:

- exact predecessor and successor schema hashes;
- predecessor and successor commit/generation identities;
- affected row counts and reject counts (every successful v1 conversion has
  exactly zero rejected rows);
- expected `ContentDigestV1` values computed independently from predecessor
  rows plus the closed plan, compared with actual successor digests.
  `ContentDigestV1` is a normative, resumable streaming SHA-256 over
  canonically ordered logical rows (RFC 8785 row bytes, stable key order,
  absent and null distinguished), domain-separated and binding the algorithm
  version, plan digest, schema hash, table, generation, row count, barrier
  head, publication version, and `publicationTimestamp`; its accumulator
  state checkpoints with the batch cursor, and golden vectors ship with the
  committed schema. System fields are proven under §4's deterministic rules;
  for a maintained projection the proof is LLP 0080 §5's split oracle —
  logical rows against `materializeAll`, system fields against the
  deterministic rule — so neither RFC claims an unparameterized byte
  equality;
- constraint, uniqueness, foreign-ID, validator, and projection checks;
- no unexpected table/field/index changes;
- current generated functions executing against the successor; and
- the published schema-resync event, retention floor, and generated
  compatibility decision that real clients consume.

This is per-migration receipt proof and succeeds even when no client is
connected. Real retained/live-client refusal and authorized-resnapshot behavior
is corpus-level conformance evidence, exercised by Acceptance below; an
executor never fabricates a client observation or waits indefinitely for one.

A successful v1 production migration requires the full-table proof; sampling
is a separately named lower-assurance class (`sampled-audit`) admissible only
for rehearsal and audit runs, never substituted for proof, and a
`sampled-audit` receipt says so on its face. A plan declares its
proof method and bound before execution as canonical fields, and the receipt
records them. A target
without the required proof capability cannot claim successful migration.
The expected-value evaluator shares only the canonical plan/value contract with
the executor, not its mutation implementation. A digest with no independent
predecessor-derived expected value is inventory, not proof.

### 6. Compatibility and deployment ordering

Each plan declares one of:

- `successor-only`: maintenance mode remains until the new application artifact
  is deployed;
- `dual-compatible`: old and new artifacts are both admitted for a named window
  proven by generated compatibility checks; or
- `predeploy-compatible`: the schema may land first because the old artifact's
  reads and writes remain valid.

The default is `successor-only`. Compatibility is proven from generated
function/schema facts, never inferred because a field appears optional. Deploy
and rollback tooling consumes the declaration and refuses an ordering it does
not admit.

The plan also declares a `retainedWorkPosture` for **server-resident** work —
scheduled jobs, queued outbox/webhook/payment work, and retained mutation
payloads held in the target's durability domain. V1 admits `empty`, proven
under the barrier, and `dual-compatible`, binding the predecessor and
successor worker/payload validators. A `transformed` posture — closed
migration steps with expected/actual digests over queued rows — is deferred
until each owning subsystem defines its versioned adapter; LLP 0070's
immutable-argument jobs, for example, migrate by creating a linked successor
job and terminally disposing the predecessor, which is that subsystem's
contract to own, not a generic row rewrite. Client-custodied offline
mutation queues are outside this posture entirely: disconnected outboxes
cannot be proven empty, so they are governed by §4's posture-aware client
path (compatible resnapshot, or upgrade-required refusal with
resync-before-replay quarantine). Work admitted before the barrier remains
fenced until publication
or rollback. A target with retained work that proves neither admitted posture
refuses with `SNAPBACK_MIGRATION_RETAINED_WORK_INCOMPATIBLE`; draining currently
runnable work does not erase scheduled-future payloads from this check.

These ordering facts compose with LLP 0072's rollback posture rather than
renaming it: a proven `dual-compatible` or `predeploy-compatible` plan may admit
`codeOnly`; `successor-only` normally selects `forwardFix` or
`restoreRequired`; and any plan with neither a safe forward path nor a proven
restore is `blocked`. The control-plane release receipt records both fields and
refuses an inconsistent pair.

Rollback before publication discards unpublished work and reopens the
predecessor. The named post-publication fast rollback is available only
inside the maintenance window: the migration fence has not yet released
application traffic or workers, and the application commit version still
equals the publication boundary. "Zero successor commits" alone is not the
guard — jobs, webhooks, payments, and actions can issue external effects
without advancing the head, so fast republish is admitted only while the
fence has kept every such lane closed; after traffic or worker release,
rollback requires a separately approved reverse plan or restore. This
generation-republish posture is recorded in the release receipt alongside
LLP 0072's rollback postures by a same-landing LLP 0072 amendment; it does
not silently rewind data, because nothing outside the fence observed the
successor. It journal-republishes the retained predecessor generation
in one transaction that allocates exactly one new application version `R`,
appends
a distinct rollback-resync event, raises the retention floor to the new
version, and advances the predecessor schema/activation generation. Forward
admission reserves commit-version budget for this allocation, so a forward
publication cannot occupy a version from which `R` is unallocatable. Row
versions follow a rollback expected-value evaluator, not raw checkpoint
bytes: a row whose visible content changes from successor back to predecessor
receives `_version = R` and the plan's explicit rollback timestamp, while
rows unchanged between the two generations preserve their system fields —
LLP 0007's rule that `_version` names the commit that last changed the row
holds through rollback. It emits a
digest-sealed `MigrationRollbackReceiptV1`. The original forward receipt remains
immutable; replaying the completed forward operation returns it, replaying the
completed rollback returns the rollback receipt, and migrating the republished
predecessor again requires a fresh preview/approval bound to its new generation.
The same atomic republish reactivates the retained predecessor work generation
and releases only payloads valid under its bound validators; successor shadow or
transformed work remains retired. The rollback receipt proves the republished
data and retained-work digests against the rollback expected-value
evaluation derived from the pre-migration checkpoint.
Otherwise rollback requires either a separately previewed and approved reverse
`MigrationPlanV1`, or restore from the exact
pre-migration backup into an isolated replacement target. V1 never claims a
generic down migration. If none is available, the plan is explicitly
irreversible after publication and approval must acknowledge that boundary.

### 7. Target safety, backup, and secrets

Every destructive or replacement operation preflights an exact resolved target
identifier, target profile, app identity, non-production/production
classification, and fixture/content sentinel. Broad directory paths, globs,
unresolved environment substitutions, and implicit "current" deployments are
refused.

Production apply requires the target's configured backup policy and an executed
recoverability preflight whose maximum age is declared by the target profile
(seven days by default). The trusted hosted profile consumes LLP 0072's
control-plane backup manifest: it binds the backup artifact digest, secret
names/generations but never values, a control-plane encryption-key reference
held outside the protected deployment, and the restore-drill identity. It does
not route backup keys through the LLP 0036 application secret API. A local
byte-level checkpoint may include `config.json`; its receipt declares that live
secret material is present, enforces private filesystem custody, and never
copies values into logs or generated artifacts. Migration logs redact row
values and secret material while retaining stable row/step IDs and reason
codes.

For production, the recommended preflight restores the latest backup into an
isolated target and derives a `MigrationRehearsalPlanV1`. The rehearsal plan is
not the production plan with its target silently changed: its digest binds the
unchanged production plan digest plus a control-plane-authorized rehearsal
binding containing the source backup identity, isolated target/deployment,
restore epoch, and matching target-profile/capability hashes. It may execute
only against that restore-derived target, its journal and receipt are marked
`rehearsal`, and it can never satisfy or be replayed as production apply. The
production admission consumes the rehearsal receipt, verifies the complete
expected/actual proof and freshness policy, and then still executes the
original approved production plan against its exact production target. This
rehearsal is required when the target profile names it.

### 8. Stable diagnostics and receipt

Required stable codes include:

- `SNAPBACK_MIGRATION_PLAN_INVALID`;
- `SNAPBACK_MIGRATION_PLAN_STALE`;
- `SNAPBACK_MIGRATION_APPROVAL_REQUIRED`;
- `SNAPBACK_MIGRATION_TARGET_MISMATCH`;
- `SNAPBACK_MIGRATION_PROFILE_UNSUPPORTED`;
- `SNAPBACK_MIGRATION_EXECUTOR_UNAVAILABLE`;
- `SNAPBACK_MIGRATION_RETAINED_WORK_INCOMPATIBLE`;
- `SNAPBACK_MIGRATION_REHEARSAL_REQUIRED`;
- `SNAPBACK_MIGRATION_PRECONDITION_FAILED`;
- `SNAPBACK_MIGRATION_BARRIER_FAILED`;
- `SNAPBACK_MIGRATION_STEP_FAILED`;
- `SNAPBACK_MIGRATION_PUBLICATION_AMBIGUOUS`;
- `SNAPBACK_MIGRATION_VERIFICATION_FAILED`;
- `SNAPBACK_MIGRATION_ROLLBACK_UNAVAILABLE`; and
- `SNAPBACK_MIGRATION_BACKUP_REQUIRED`.

The final `MigrationReceiptV1` is a digest-sealed projection of the durable
journal, not a parallel account assembled from process memory. It binds source
revision, package/runtime identities, plan bytes and digest, approval, resolved
target, backup/checkpoint, every journaled step, verification proof, publication
boundary, measured barrier duration, cleanup state, and both compatibility and
rollback postures. A receipt with skips, an unverified step, or ambiguous
publication is not successful.

## Acceptance

Acceptance is semantic. This RFC may move to Accepted when its rules are
internally consistent, reconciled with the governing corpus — including the
same-landing LLP 0007 journal-grammar and LLP 0072 republish-posture
amendments — and reviewed under LLP 0005; acceptance authorizes
implementation and satisfies the "accepted semantics" half of LLP 0063's
Step 5 entry conjunction, but claims no executable result.

A separate implementation-conformance suite — the LLP 0081 half of
`RELATIONAL_MIGRATION_COUPLED_SUITE_V1` — gates `Implemented` status and the
"executable witnesses" half of LLP 0063's Step 5 gate:

- plan bytes with identical explicit constants are byte-identical against the
  committed golden vectors, and preview is read-only against application
  state; schema/declaration/constant/target/capability drift invalidates it,
  while commit drift is re-proven safely under the barrier and a
  resource-ceiling breach at admission refuses and requires re-approval;
- the CLI refuses missing or unauthenticated approval, stale schema, wrong
  app/target, a target-audience field mismatch against LLP 0072's identities,
  broad target resolution, expired approval at admission, and
  unsupported profiles; hosted approval is an audited control-plane operation;
- synthesized IDs match the deterministic UUIDv7 conformance vectors;
- add/backfill/required/unique/copy/retire plans pass a shared portable corpus
  through the pure expected-value evaluator and SQLite. Each hosted target is a
  separately gated profile requiring the same corpus and fault-injection hooks;
  no hosted or Step 6 claim inherits the SQLite result;
- injected failures at every step, every batch boundary, and inside every
  durable state-machine transition leave the
  predecessor authoritative and support deterministic resume; a crash between
  predecessor reopen and resume proves the persisted fence still refuses
  application admission on every lane; and cancellation from every
  non-terminal state reaches `cancelled` with a terminal receipt;
- injected crashes immediately before and after final publication reopen one
  complete generation with an unambiguous target-local journal, an admitted
  resume re-establishes its lease/barrier, and the receipt byte-equals the
  journal projection; on the Durable Object target, eviction and alarm
  contention with application schedules are exercised through the shared
  dispatcher;
- uniqueness and conversion preflight failures perform no DDL, DML, manifest,
  or generation publication;
- expected values independently evaluated from the predecessor match successor
  content digests, every successful conversion has zero rejected rows, and both
  full proof and a preregistered sample fail on a one-row corruption injected
  inside their covered set; a corruption outside the sample is demonstrated
  not to be detected and the sampled receipt remains explicitly narrower;
- a successor-only deployment and one genuinely dual-compatible deployment
  prove the admitted ordering and reject the opposite ordering, and a
  predeploy-compatible fixture proves schema-first ordering while refusing an
  actually incompatible predecessor artifact;
- rollback-before-publication and backup-to-isolated-replacement restore both
  pass with exact content-digest oracles; maintenance-window predecessor
  republish passes against the rollback expected-value evaluation with
  changed rows restamped to `_version = R`, traffic or worker release
  disables it even at zero successor commits, the first successor
  commit disables it, timestamp-regression and resource-drift fixtures
  refuse, and irreversible post-publication refusal is tested
  separately;
- a compatible retained/offline client held across publication cannot replay
  its old
  cursor, observes the raised retention floor, and takes one authorized
  successor resnapshot; an incompatible client receives the stable
  upgrade-required refusal and its quarantined offline mutation settles
  through resync-before-replay; the reopened store passes LLP 0007's
  head/journal cut and the publication transaction's LLP 0053 activation
  obligations are witnessed under a dropped-acknowledgement fault;
- empty, dual-compatible, and incompatible retained-work fixtures
  prove scheduled-future payloads cannot escape compatibility review, and a
  declared-but-unproven `transformed` posture is refused as unsupported;
- a required rehearsal executes only through its restore-derived binding,
  cannot target production, and its receipt is consumed without substituting
  for the production apply receipt;
- a maintained projection change runs LLP 0080's shadow rebuild and publishes
  its schema and generation atomically;
- generated artifacts, admin inspection, CLI, and Agent surfaces show the same
  plan/step/result identities and stable diagnostics;
- representative rename, type-conversion, conditional-default, and projection
  changes prove the closed LLP 0051 expression vocabulary is sufficient or
  remain explicit unsupported diagnostics rather than raw-SQL fallbacks; and
- the Step 5 application witness reviews and executes a real schema change,
  then reruns no-Exact-core, authorization, packaged-loop, browser, native, and
  cumulative manifest checks.

Semantic acceptance carries the same-landing LLP 0007 amendments (deferred/
status pointers plus the schema-transition journal grammar) and the LLP 0072
republish-posture amendment. Hosted targets record their first passing corpus
in their own conformance profiles later; nothing here promotes LLP 0072's
control-plane or LLP 0063's Step 5/6 claims without their own receipts.

## Non-goals

- zero-downtime or rolling online migration;
- concurrent multi-writer or multi-region migration;
- automatic SQLite-to-Postgres engine graduation;
- arbitrary user code or SQL in portable plans;
- automatic down migrations;
- destructive physical cleanup during the rollback window; and
- treating a backup's existence as proof that restore works.

## Open questions

1. What table-size/resource threshold should force a shadow generation instead
   of one SQLite transaction?
2. Should `ContentDigestV1` gain a partitioned Merkle variant for drift
   localization on large tables, or does the flat streaming digest suffice
   until a measured need appears?
3. What is the precise `MigrationApprovalV1` carrier — a single-use signed
   token or an opaque one-operation control-plane record — and what are its
   replay and revocation semantics for the first trusted single-tenant
   profile?
4. Which migration class is the smallest safe first online/dual-write profile,
   and what application justifies accepting its added state machine?
5. Should v1 have conservatively bumped `streamIncarnation` per
   representation-changing migration instead of typed schema-transition
   events, and should that remain the escape hatch if the journal-grammar
   amendment proves harder than specified?
6. Which retained-work classes belong to Step 5, and which wait for the
   Step 6 job, payment, notification, or webhook authorities and their
   `transformed` adapters?
7. Which hosted adapter, if any, should be the first separately admitted
   migration-executor conformance profile?
