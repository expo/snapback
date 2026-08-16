# LLP 0081 — Reviewed storage evolution and migrations

**Type:** RFC
**Status:** Implemented
**Systems:** Schema evolution, Migrations, Storage portability, Deployment, Backup and restore, Code generation, CLI, Diagnostics, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-20
**Revised:** 2026-08-15 (same-name JSON→structured conversion amendment:
the closed `ConvertJsonToStructured` intent requires a `Json` predecessor and
`Structured` successor, expands to a shadow successor generation, transforms
only the named field while carrying other same-name successor fields unchanged,
validates and canonicalizes the structured destination, proves row count/content
digest, and publishes or refuses atomically; preview derives shadow strategy
from the step graph).
**Revised:** 2026-08-10 (mutation-wire artifact identity amendment: the
successor-only floor now gates read-set-free writes by their codegen-time
schema generation after finite-carrier version negotiation; see the dated
amendment below). 2026-08-07 (ownership acceptance — LLP 0129 owner-landing
ledger row 3, schema-at-capture versus schema-at-settle skew
("schema/identity fencing"), assigned to this RFC by the 2026-08-07
author gate packet ruling, item 7
(`issues/closed/20260807-local-first-author-gate-packet.md`). This RFC
accepts ownership of the capture policy — a mutation executed locally
against schema S1 and settled after migration to S2, the case the
execution-identity tuple's element 5 exists for — as the natural
extension of its shipped quarantine/resync-before-replay seam; LLP
0127's "proposed home" is settled. The policy lands here as a dated
section when built; until then LLP 0129's ledger row 3 continues to bar
any `Parity`-by-construction claim.)
2026-08-06 (client tombstone-and-re-entry implementation: the JS
client outbox now recognizes the sidecar's upgrade-required refusal family,
atomically quarantines every pending intent under the first-cut
compatibility-unclassified posture, exposes only stable redacted v1
tombstones, keeps exact-leaf dependents held rather than failed, and provides
explicit all-quarantine re-entry after successor admission. Per-intent
compatibility classification/transformation from generated facts remains the
named follow-on.) 2026-08-05 (post-implementation fail-closed correction: the local
v1 in-place `BackfillField`/`CopyField` proof domain is new destinations only,
matching the implemented rollback and content-digest oracle; `AddField` must
name both a manifest-new and physically fresh column on fresh admission,
requiredness follows the sealed Add/write/validate/make order with no later
write, and only the exact staged or optional-to-required target receives the
typed NonNull validation path; existing nullable destinations require fresh
successor storage or a future value-preserving profile.) 2026-08-05 (desktop-sidecar boundary note: LLP 0129 Phase 2b's
updater swap now exposes `onUpgradeRequired` with the application-owned
outbox snapshot after quiescence. This is the attachment point for this RFC's
incompatible-client disposition, not an implementation of quarantine,
redacted tombstones, migration execution, or action re-entry.) 2026-08-03, later (LLP 0109 acceptance: dated versioned-seed
transitions amendment — `migration-plan-v1` unchanged, the specified
`migration-plan-v2` `seedTransition` binding recorded, and the accepted
first landing's removal of v2/restore-rebase/rollback-republish from v1
recorded; no implementation claimed.) 2026-08-03 (dated amendment — author ruling, Charlie Cheever,
via LLP 0160 OQ6: the settlement path for an incompatible client's
quarantined offline mutations is **explicit tombstone-and-re-entry** — each
quarantined mutation is recorded as a stable, redacted tombstone the client
can observe, never silently replayed or dropped, and the action is
re-entered against the successor schema. This blesses the shipped behavior
as normative and supersedes the former resync-before-replay settlement
wording at its three sites; §4's underlying "rather than silently replayed
or dropped" principle is unchanged. Source:
`issues/20260802-author-decision-packet.md` 2026-08-03 follow-ons; LLP 0160
G4′b's ruling gate clears to a conformance audit.) 2026-07-26 (open question 7 answered — author decision, delegated:
`single-instance-container-vm.v1` carries the first separately admitted
migration-executor conformance profile, aligning with LLP 0072's recorded
first-adapter selection; the Durable Object profile is the explicit second
target under the author directive that both hosted lines must reach
production quality; DO-specific acceptance items stay parked with LLP 0014;
conformance claiming remains gated on the container-VM adapter earning remote
drill evidence under LLP 0072); 2026-07-26 (post-Implemented spec reconciliation, ticket
20260726-0081-spec-amendment-frictions: §2's CLI list gains the implemented
`rehearse` verb (thin wrapper over the §7 rehearsal machinery, receipt
consumed by `apply --rehearsal-receipt`) and records the decision that
`released` is `apply`'s journaled tail on the local profile — no `release`
verb, because the single-writer profile has no operator hold point; hosted
hold-then-open flows define their own release operation; §2 gains the
admission-timing profile note — timing is profile-defined, the
`MigrationAdmissionV1` record, its under-fence ordering, and
one-consumed-approval are normative; `cancel_requested` verified consistent
across prose, executor serde, and the committed journal-machine schema, its
snake_case spelling among kebab-case states recorded as frozen by the closed
vocabulary rather than renamed); 2026-07-26 (Implemented on the local SQLite admission profile, this RFC's own
Step 5 admission scope: the durable executor/journal/fence corpus,
quarantined-mutation settlement, restore-derived rehearsal, and
dual-compatible/predeploy ordering fixtures are green, and the Step 5
application witness reviewed and executed a real v0→v1 schema change on the
admitted fixture through preview→approve→apply with gate reruns
(acceptance/results/schema-evolution.v1.json) — the witness also found and
fixed the migrate-CLI async-guard panic and the dual-slot schema-manifest
publication defect; hosted/DO items stay deferred to separately versioned
conformance profiles per the closing paragraph; `migration_keyset_scan_v1`
promoted to stable as the same act); 2026-07-24 (Accepted by the author after the dual-family
LLP 0005 loop — Fable and Codex both READY on this text; acceptance is
semantic per §Acceptance and lands with the same-landing LLP 0007
journal-grammar and LLP 0072 `generationRepublish` amendments; the
`RELATIONAL_MIGRATION_COUPLED_SUITE_V1` implementation suite still gates
`Implemented` and the Step 5 executable witnesses); 2026-07-24 (loop
close-out, rounds 2–4: authority-bearing-table
steps refused pending a `hostOps:migrate` writer class; the fence closes a
capability-derived lane registry including egress lanes; idempotence keyed
by `operationId` plus audience; cancellation pre-publication-only with a
journaled `published-held` state and schema-enumerated transition relation;
`storageGeneration` named apart from LLP 0072's `activationGeneration`;
republish fires LLP 0053 activation obligations with an enforced downtime
ceiling; the plan-digest preimage defined once with pinned planner
tie-breaks; `ContentDigestV1` frames bound fail-closed to the LLP 0051
JSON-transport bytes; deterministic UUIDv7 IDs with the 48-bit range check
and the LLP 0080 projection-identity carve-out; both families ended READY —
Fable re-review, Codex round 4); 2026-07-24 (GPT round-1 reconciliation:
semantic acceptance
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
**Related:** LLP 0004, LLP 0007, LLP 0008, LLP 0010, LLP 0012, LLP 0014, LLP 0018, LLP 0036, LLP 0037, LLP 0041, LLP 0043, LLP 0046, LLP 0051, LLP 0053, LLP 0055, LLP 0056, LLP 0062, LLP 0063, LLP 0070, LLP 0072, LLP 0080, LLP 0129

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
  and predecessor storage generation (schema/data-generation identity);
- ordered typed steps with stable step IDs;
- per-step preconditions, read/write sets, resource bounds, reversibility, and
  verification queries;
- compatibility posture for old and new application artifacts;
- backup/checkpoint requirements;
- expected output schema and maintained-projection generation hashes; and
- cleanup and rollback boundaries.

The serialized authority is `MigrationPlanArtifactV1 { body, planDigest,
planId }`. The `body` serializes under the corpus's existing RFC 8785 (JCS)
rule from LLP 0062; `planDigest` is SHA-256 over exactly the ASCII prefix
`snapback:migration-plan:v1`, one `\n`, and those JCS body bytes — the
domain-separated preimage is the only digest input; `planId`
is `migration-v1:<planDigest>`; and neither outer field appears inside
`body`, so validation recomputes the body digest with no self-reference. The
committed schema ships golden vectors so independent implementations prove
byte agreement. Plan generation is itself deterministic: the planner emits
steps in a pinned normative order — schema-manifest declaration order, then
declared-intent order with each intent's own dependency chain kept in its
required sequence (validate before tighten, copy before retire), ties broken
lexicographically by qualified target
name and then by step type — and each step ID is the
canonical string `s<ordinal>:<stepType>:<qualified target>`, so two clean
checkouts derive identical step sequences and IDs from identical inputs. The execution strategy (single-transaction versus shadow
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
`environmentId`, `deploymentId`, `releaseId`, `databaseId`,
`streamIncarnation`, `activationGeneration`, and `targetProfileId` where the
deployment class
defines them, with the local profile binding the resolved local target
identity — the approver principal, issue and expiration timestamps, and a
single fresh `operationId` distinct from `planId`: one plan may be executed
as different operations only through separate approvals, and target identity
is never conflated with target profile. Admission, journal lookup, replay,
cancellation, and receipt recovery are all keyed by `operationId` plus its
audience — never by bare plan digest. At barrier
time, admission emits a `MigrationAdmissionV1` binding the actual predecessor
head, the enforced resource bounds, and the approval it consumes; the receipt
carries both records. Admission timing is profile-defined: the local SQLite
profile admits at the publication barrier under its single serialized
writer, while a hosted profile fixes its own admission point (for example a
control-plane enqueue ahead of the barrier) in its separately versioned
conformance profile. What is normative across every profile is the record
and its ordering, not the clock: admission emits `MigrationAdmissionV1`
under the closed fence before any physical step, binds the actual
predecessor state it admitted against, and consumes exactly one unexpired
approval. Editing source schemas, declarations, constants,
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
snapback migrate rehearse migration.json --rehearsal-plan rehearsal.json \
    --out rehearsal-receipt.json
snapback migrate apply migration.json [--rehearsal-receipt rehearsal-receipt.json]
snapback migrate cancel migration.json
snapback migrate verify migration.json
snapback migrate rollback migration-receipt.json
```

Each command emits the shared structured result envelope and supports a
machine-readable dry run. `apply` requires the approved file by path; it never
regenerates a possibly different plan implicitly. `cancel` requests
cancellation at the next admitted boundary and never leaves the state machine
outside a named state. `rehearse` executes the approved production plan as
§7's rehearsal against the one restore-derived database its sealed rehearsal
plan binds — never production — and writes the rehearsal-marked receipt that
`apply --rehearsal-receipt` later consumes. There is deliberately no
`release` verb on the local profile: `released` is the journaled tail of
`apply` (and of its crash-resume re-invocation from `published-held`), so a
distinct verb would imply an operator hold point the local single-writer
profile does not have; a hosted profile that admits a genuine hold-then-open
flow defines its own release operation in its conformance profile.

### 3. Typed migration steps

V1 admits only closed steps whose portable semantics Snapback owns:

- `CreateTable` and `CreateIndex`;
- `AddField` with a portable literal or closed backfill expression;
- `BackfillField` into a new destination;
- `ValidateRequired` followed by `MakeRequired`;
- `ValidateUnique` followed by `CreateUniqueIndex`;
- `CopyField` and `CopyTable` into successor storage;
- `StageTableGeneration`;
- `RebuildMaintainedProjection` under LLP 0080; and
- `RetireField`, `RetireTable`, or `RetireGeneration` as logical retirement,
  with physical cleanup separately fenced after the rollback window.

The intent vocabulary includes one named same-field conversion:
`ConvertJsonToStructured { table, field, generation }`. It is not an in-place
retype. The planner requires a `Json` predecessor field and a `Structured`
successor field, stages the named positive generation, derives one identity
transform for the named field, carries other same-name successor fields from
the active predecessor without placing them in the transform map, and marks the
copy for full row count and content-digest verification. The ordinary structured writer validates
and rewrites the formerly-JSON value as `canonical-json-text.v1`; one invalid
row fails the reviewed migration without publishing the successor. Because the
step graph contains generation staging/copy, preview seals
`shadow-generation` as the execution strategy rather than relying on a caller
default.

**Local v1 destination-lifecycle correction (2026-08-05):** “new” is a
closed proof, not manifest shorthand. `AddField` must name a field absent from
the predecessor manifest, declared with the same type in the successor, and
absent from the physical table at fresh admission; logical retirement's
retained column therefore cannot be silently re-adopted. The same operation's
resume may observe the column created by its already-committed `AddField` step.
An in-place `BackfillField` or `CopyField` may write only that prior staged
destination and must precede `ValidateRequired`. A field that is required in
the successor follows `ValidateRequired` then `MakeRequired`, with no later
write; `ValidateRequired` may name only that staged field or an existing
optional predecessor field whose successor declaration becomes required.
Existing nullable destinations otherwise require a staged successor
generation or a future profile that preserves their predecessor values and
defines rollback/proof semantics. This narrows the earlier “new or nullable”
phrase to the local executor's implemented content-digest and fast-rollback
proof domain; it does not broaden a capability claim.

Backfill expressions use the closed LLP 0051 value vocabulary over the source
row plus the plan's explicit migration constants. They cannot call application
handlers, read ambient time/randomness, perform network I/O, access secrets, or
read an undeclared table. The executor replays constants as data and derives IDs
only through the plan's pinned deterministic namespace rule: a synthesized ID
is a UUIDv7-compatible value: the 48 time bits carry the plan's approved
`publicationTimestamp` — plan validation refuses a timestamp outside the
48-bit millisecond range with `SNAPBACK_MIGRATION_PLAN_INVALID`, even though
LLP 0007's timestamp domain is wider — the version and variant fields hold
their fixed
UUIDv7 values, and exactly the 74 `rand_a`/`rand_b` bits derive from a
domain-separated
SHA-256 over plan digest, step ID, source table and row key, destination
table and generation, and output ordinal — collision-scoped per destination,
satisfying LLP 0007's UUIDv7 contract, and shipped with conformance vectors.
Maintained-projection output rows are exempt: their `_id` follows LLP 0080
§5's rule — the revision-stable stored projection identity plus the output
key — so maintenance and rebuild agree on row identity.

V1 refuses plans whose steps write authority-bearing tables — membership,
permission-backing, or authority-creating declarations under LLP 0055/0056 —
with `SNAPBACK_MIGRATION_PLAN_INVALID`: LLP 0056's central membership writer
owns transition provenance, `lastHolder`, and final-state validation, and a
generic copy/backfill/retire cannot satisfy that contract. A dedicated
`hostOps:migrate` writer class carrying the full subsystem validation is
future work; until it exists, evolving an authority-bearing table is an
application-level operation, not a migration step.

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
executor is a complete durable state machine over a closed state set —
`admitted`, `barriered`, `executing(step, batch)`, `verifying`,
`published-held`, `released`, `rolling-back`, `rolled-back`,
`cancel_requested`, `aborting`, `cancelled`, `abandoned`, and one
`cleanup-pending` tail state reachable only from `released` and
`rolled-back` that ends in the same terminal state it extends. The complete
transition relation is enumerated in the committed journal schema, and a
transition absent from that enumeration is refused as corruption — the set
is closed by schema, not by prose. Every
transition is journaled and carries the operation's fencing token (the lease
epoch), which the durability owner validates before applying; a stale token
is refused, so a superseded executor instance cannot advance the machine.
Cancellation is admitted only pre-publication: from `published-held` the
only exits are the journaled release transition and §6's audited rollback.
Fault injection in acceptance exercises the interior
of every durable transition, not only batch boundaries.

The barrier itself is durable: admission writes a persisted migration fence
consulted before opening by every lane in the target's capability-derived
lane registry — queries, mutations, subscriptions, jobs, workers, actions,
cron wakeups, and every external-effect egress lane (webhooks, payments,
notifications). The registry is closed and enumerated in the target's
migration capability, so a lane the fence does not name cannot be admitted
at all, and acceptance crash-tests every registered lane. A crash between reopen and resume therefore cannot
readmit application writes: the fence outlives the process and clears only
when the journal reaches a terminal state. Publication enters a journaled
`published-held` state in which the fence still closes traffic and workers;
a distinct journaled release transition opens them, and §6's fast rollback is
available exactly while the journal shows `published-held`. Terminal states
are released, rolled back, cancelled,
or abandoned by an authorized operator action recorded in the journal. A
crash while `published-held` reopens only the successor, still fenced, and
resume either releases or rolls back explicitly. Each
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
an implicit dialect. The amendment's normative content is fixed here: the
two event types join the closed operation vocabulary carrying (operation id,
predecessor and successor schema hashes, generation identities, retention
floor), each counts toward the journal high-water exactly like a data
operation, and the head/journal-cut equality holds across them unchanged. The same publication transaction fires LLP 0053's
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
quarantined and settled by explicit tombstone-and-re-entry rather than
silently replayed or dropped (2026-08-03 amendment: each quarantined
mutation becomes a stable, redacted tombstone the client can observe, and
the action is re-entered against the successor schema); no
pre-publication cursor can replay through the raised
floor. Before reopening, the successor proves LLP 0007's exact
head/change-journal high-water cut. A future stream-incarnation bump may replace
this profile, but v1 does not leave the mechanism implicit.

A crash before publication reopens the predecessor and resumes or discards the
unpublished shadow generation according to the journal. A crash after
release reopens only the successor and resumes cleanup (a crash while
`published-held` follows that state's rule above: reopen still fenced,
explicit release or rollback); it never rolls back
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

Only one migration may own an app at a time. Replaying the same completed
operation (`operationId`) returns its prior receipt; the same plan under a
new approval is a new operation and is rejected as stale against a completed
predecessor identity, as is any different plan.

The approved maximum barrier downtime is enforced, not merely measured: the
journal records barrier start, every wake, batch commit, and the publication
attempt check elapsed time against the plan's ceiling, and exceeding it
before publication takes the safe abort path — discard or park the shadow
per the journal, reopen the predecessor, and fail with
`SNAPBACK_MIGRATION_BARRIER_FAILED`. Once `published-held` is reached the
ceiling no longer applies; release proceeds. Slow-executor and
crash-past-deadline fixtures witness both sides.

### 5. Verification and data proof

Every step defines executable verification. The final proof includes:

- exact predecessor and successor schema hashes;
- predecessor and successor commit/generation identities;
- affected row counts and reject counts (every successful v1 conversion has
  exactly zero rejected rows);
- expected `ContentDigestV1` values computed independently from predecessor
  rows plus the closed plan, compared with actual successor digests.
  `ContentDigestV1` is a normative, resumable streaming SHA-256. Its
  preimage is a header frame (`snapback:content-digest:v1`, algorithm
  version, plan digest, schema hash, qualified table, generation, barrier
  head, publication version, `publicationTimestamp`) followed by one frame
  per logical row in stable key order — each frame the length-prefixed
  RFC 8785 re-canonicalization of the row's LLP 0051 canonical
  JSON-transport bytes, the same representation query results already pin,
  which distinguishes absent from null; a table whose declared schema
  contains a type that transport cannot represent losslessly is refused at
  plan validation as outside v1's proof domain, fail-closed, rather than
  digested approximately — and a trailer
  frame binding the row count; system fields stream as a second digest with
  its own domain prefix under §4's rules. The accumulator checkpoint stores
  the SHA-256 chaining state plus byte and row counters with the batch
  cursor, resume-equality is a golden-vector case, and the vectors ship with
  the committed schema. System fields are proven under §4's deterministic rules;
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

#### Desktop-sidecar updater attachment boundary (2026-08-05)

LLP 0129 Phase 2b's first sidecar rung composes this section only at the
incompatible-client refusal boundary. Before replacing a runtime child, the
embedding app's adapter quiesces submissions and leaves every incomplete
intent in the app's durable outbox. If candidate attachment returns an
upgrade-required diagnostic, `@expo/snapback-sidecar` invokes
`onUpgradeRequired` with that refusal and an app-owned outbox snapshot, then
recovers an old-or-new runtime attachment. The supervisor neither reads nor
rewrites queued mutation payloads itself.

That hook is deliberately not this RFC's tombstone-and-re-entry
implementation. At the time the hook landed, the client/storage-evolution
owner still had to classify compatibility against generated facts, create the
stable redacted tombstone, prevent silent replay under an incompatible schema,
and drive explicit action re-entry after successor admission. The dated
implementation note below records the client-owned first cut; the sidecar
contract remains unchanged and still neither reads nor rewrites queued payloads.

#### Client tombstone-and-re-entry implementation note (2026-08-06)

The `@expo/snapback-client` outbox now recognizes
`SNAPBACK_UPGRADE_REQUIRED`, `SNAPBACK_CLIENT_UPGRADE_REQUIRED`,
`SNAPBACK_MIGRATION_UPGRADE_REQUIRED`, and the closed
`*_UPGRADE_REQUIRED` suffix family before ordinary replay failure handling.
One such refusal atomically moves **every pending intent** to `quarantined`.
This is the deliberately conservative first cut: exact-leaf/transitive
dependents are labeled `dependent`, while every other pending record is
`compatibility-unclassified`; none is marked `failed`, dropped, or selected by
replay. Quarantined records continue to hold the full-resync/submission fence
and count toward the unchanged 1,024-record outbox bound.

The durable store privately retains the original intent and replay identity.
Its observable projection is instead
`snapback.outbox-quarantine-tombstone.v1`: `{status, clientMutationId,
function, sequence, quarantinedAt, refusalCode, quarantineDisposition,
causeClientMutationId, provenance:{source, payload:'redacted'}}`. It carries no
arguments, authority context, read set, generated artifact facts, settlement
claims, or optimistic payload. `client.quarantinedMutations()` returns those
tombstones and `client.outboxStatus()` reports their count.

After the application has successfully loaded/reconnected with successor
artifacts, `client.reenterQuarantinedMutations()` explicitly returns the whole
quarantine to `pending` in its original sequence and identity; the next normal
drain supplies exactly-once replay. It does not automatically re-enter on
connectivity, rewrite a payload, or infer compatibility. Per-intent
classification and any transformation against successor generated
function/schema facts remain a named codegen/Contract/client follow-on. Until
that lands, applications must treat the explicit method call as their
successor-admission assertion and use the conservative quarantine-all posture.

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
tombstone-and-re-entry quarantine per the 2026-08-03 amendment). Work admitted before the barrier remains
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
LLP 0072's rollback postures by a same-landing LLP 0072 amendment adding the
named `generationRepublish` row to that RFC's posture set; it does
not silently rewind data, because nothing outside the fence observed the
successor. It journal-republishes the retained predecessor generation
in one transaction that allocates exactly one new application version `R`,
appends
a distinct rollback-resync event, raises the retention floor to the new
version, advances the predecessor **storage generation** — the
schema/data-generation identity this RFC owns, deliberately distinct from
LLP 0072's traffic-facing `activationGeneration` — and atomically fires
LLP 0053's schema/function activation obligations for the reactivated
predecessor artifacts exactly as forward publication does for the
successor's. Forward
admission reserves commit-version budget for this allocation, so a forward
publication cannot occupy a version from which `R` is unallocatable. Row
versions follow a rollback expected-value evaluator, not raw checkpoint
bytes: a row whose visible content changes from successor back to predecessor
receives `_version = R` and the plan's explicit rollback timestamp — which
admission requires to be at least `publicationTimestamp` and the maximum
`_updatedAt` among restamped rows, the same monotonicity rule as forward
publication — while
rows unchanged between the two generations preserve their system fields;
LLP 0007's rule that `_version` names the commit that last changed the row
holds through rollback. The rollback command itself is an authorized,
audited operator action under the original operation's approval — which
acknowledged the rollback boundary — recorded in the journal like every
other transition; on hosted targets it is an LLP 0072 control-plane
operation. It emits a
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
  admission on every lane in the capability-derived registry, including
  action, cron, and egress lanes; cancellation from every
  pre-publication non-terminal state reaches `cancelled` with a terminal
  receipt, and from `published-held` only release and the audited rollback
  are admitted; slow-executor and crash-past-deadline fixtures prove the
  downtime ceiling aborts safely before publication and does not apply
  after it; and an authority-bearing-table step is refused at plan
  validation;
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
  by explicit tombstone-and-re-entry (2026-08-03 amendment); the reopened
  store passes LLP 0007's
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
   **Answered 2026-07-26 (author decision, Charlie Cheever, delegated):**
   `single-instance-container-vm.v1` — the adapter LLP 0072's first-adapter
   decision (2026-07-22) already selected — carries the first
   migration-executor conformance profile. The Durable Object profile is
   the explicit second target, not a discard: the author directive is that
   both the container-VM and DO lines must reach production quality; the
   DO-specific items (eviction and alarm contention through LLP 0014's
   shared dispatcher) stay parked with LLP 0014 and travel with the
   Cloudflare line whenever it qualifies under LLP 0072. Sequencing is
   unchanged: the profile is buildable as a spec now, but its conformance
   corpus can only be claimed after the container-VM adapter passes the
   LLP 0072 drill corpus with remote evidence.

## Dated amendment: versioned seed transitions (2026-08-03, LLP 0109 acceptance)

Accepted LLP 0109 (author acceptance 2026-08-03, decision sitting #2
extension, `issues/20260803-author-decision-sitting-2.md`) fixes the
seed/migration boundary against this RFC. Seed never substitutes for
migration: a versioned `install` may accompany only a fresh or LLP
0007-safe additive schema provision and refuses
`SNAPBACK_SEED_MIGRATION_REQUIRED` before any schema, function, row, or
identity effect when a reviewed migration is required.

Seed-aware evolution is specified as `migration-plan-v2` — this RFC's
`migration-plan-v1` stays closed and unchanged, and a v1 executor rejects a
v2 plan before effects — whose only added canonical member is
`seedTransition`: either `unchanged` (binding the exact current
identity/absence on both sides) or `evolve` (binding one valid installed
predecessor identity, one successor identity for the same app and data
stream, and both artifact and tables digests, with typed migration steps —
never the seed installer — expressing every intended data change). The
transition participates in this RFC's length-framed `planDigest`, approval,
preview, journal, checkpoint, publication, and rollback evidence; the
successor seed identity is written only in the migration's atomic
publication transaction; and generation republish, reverse migration, and
restore each carry a truthful successor-identity receipt. There is no
adopt/infer/force or metadata-only advance over untracked data.

The accepted first landing (LLP 0109 §15.2) **removes migration-plan-v2,
restore-rebase, and rollback-republish from v1**: no identity-advance step
ships; an installed instance presented with another identity refuses, and
the operator's remedy is an authorized whole-instance reset-install.
Restore already rotates the data-version stream, so a restored target has
absent active seed identity and requires an explicit reset-install before a
versioned declaration becomes active again. A future migration/restore
identity extension requires its own reviewed LLP. This amendment records
the specified v2 binding and the v1 removal; it claims no
`migration-plan-v2` implementation.

## Dated amendment: mutation-wire artifact identity (2026-08-10)

The successor-only migration floor now covers the read-set-free case that the
row-baseline gate cannot observe. After an exact `snapback.v1` offer on the
finite mutation carrier, a fresh blind write MUST carry the build-time
`expectedGeneration` and its `schemaHash` MUST name the active schema side of
the latest successor-only transition. A forward `schema-resync` admits the
successor hash; a `rollback-resync` admits the predecessor hash. Missing or
non-active identity refuses `SNAPBACK_MIGRATION_UPGRADE_REQUIRED` before
function selection, ACK consumption, dry-run/execution, or any write.

The compatibility bridge is explicit. Offerless legacy mutations that carry
no identity retain their old admission behavior; a legacy request that does
present a non-active generation can be refused from that evidence. Requests
with read dependencies continue through the existing row-aware floor, where
an unchanged baseline remains safe and a changed pre-floor baseline requires
resync. This amendment therefore closes the blind predecessor-write hole
without replacing the stronger conflict evidence available to baseline-bearing
work.

The gate applies only to fresh work. Exact-settlement lookup remains earlier
than the identity floor, so a retry of an already committed mutation returns
the durable original result even after publication. The identity source is
codegen/build configuration, never the active deployment identity learned
from the server; otherwise a predecessor client could echo the successor and
defeat the fence.
