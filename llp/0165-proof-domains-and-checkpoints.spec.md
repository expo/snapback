# LLP 0165: Proof domains and checkpoints

**Type:** Spec
**Status:** Accepted
**Systems:** Storage, Migrations, Diagnostics, Testing
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-03
**Revised:** 2026-08-06 (accepted by Charlie Cheever after three mutually blind dual-family review rounds converged `READY`; acceptance approves this Spec's proof/checkpoint contract without claiming storage-wide writer completeness, promotion proof, checkpoint publication, the broader agent-safe-storage aggregate, hosted targets, or any positive target-manifest fact); 2026-08-06 (round-2 derived-fork continuity closure — coverage
activation now creates a monotonic per-stream continuity carrier; arbitrary
registered-connection DML cannot change the manifest, continuity, journal, or
version carriers; and every primary or secondary registered writer
reconstructs the exact fork receipt/stream/manifest/continuity cut before it
can issue a token. A missing or contradictory active boundary records an
irreversible database continuity break plus a fork-local gap sidecar, so
restoring exact manifest bytes cannot re-earn the whole-window class. Armed
renewal checkpoints through its lifecycle token before changing lineage,
journal pruning has a dedicated system token, and net scans charge borrowed
SQLite value lengths plus conservative decode/serialization expansion before
owned row construction. The same-user raw-file/factory-bypass writer remains
outside the named class.); 2026-08-06 (derived-fork writer-completeness integration — the
complete cold-start carrier admits the generated pair, then the generated
transaction seam, verified SQLite defensive mode, and deny-by-default
authorizer arm on every process-owned registered writable connection before
listener bind. The digest-bound fork-point receipt upgrades only the app-row
lanes to `registered-connection-defensive-app-rows-v1`, and only while the independent
journal cross-check is verified; a partial post-bind dev-manifest layout stays
unarmed and `journal-enumerated-v1`. This is not the storage-wide row-4 claim,
and the Spec remains Draft.); 2026-08-05 (LLP 0185 Phase 0 ownership reconciliation — clarified
that this Spec, not LLP 0163 or LLP 0164, owns the global generated-writer plus
SQLite-authorizer journal-completeness choke point; the neighboring Specs own
their manifest and diff-surface inputs. No acceptance row changed state.);
2026-08-04 (protected-erasure acceptance-tail audit — production
transactions and focused corpus now cover simultaneous exact and divergent
command retries in addition to the already integrated admission/publication
race, producer cancellation, crash/reopen, reachable/unreachable copies,
active and expired leases, credential revocation, and authorization-stream
reset. This closes LLP 0162 Acceptance row 11's protected-erasure tail. The
Spec stays Draft and every capability stays `Missing` pending independent
review, author acceptance, and the separately owned gates); 2026-08-04 (protected-erasure implementation increment — the
registered AdminWrite product command derives an internal authority from the
current prepared route authority plus the concrete revalidated admin
credential. Its first immediate transaction binds operation identity,
authority, and target; deletes the canonical row and retained detail; emits a
payload-free delete tombstone; invalidates the complete checkpoint inventory;
and advances a durable generation fence. Admitted checkpoint producers own a
durable cancellation acknowledgement, so physical absence cannot close an
obligation while a producer can still create bytes. Exact retry resumes
reachable obligations; authority/credential/target divergence, revocation,
and predecessor authorization-stream publication refuse. Crash, concurrent
producer, stale replay, and reopen corpus is green. Row 11 remains Partial
pending the residual acceptance tail and independent review; the Spec stays
Draft and every capability stays `Missing`); 2026-08-04 (proof-tail increment — full migration verification
now maps predecessor rows through a separately implemented closed-expression
oracle; explicit-value/equivalence, injected executor-drift, and staged-byte
corruption negatives gate its `independentBoundaryProof` receipt. A durable
protected-record checkpoint-copy sweep invalidates every registered
materialized copy before deletion, enumerates destroyed versus unreachable
copies, and resumes crash/open obligations after reopen; because this low-level
sweep is not yet atomic with canonical protected-record deletion, the new-copy
race remains open and row 11 stays Partial. Status stays Draft and capabilities
stay `Missing`); 2026-08-04 (history/checkpoint/migration acceptance-tail increment
— schema publication atomically projects finite per-record history into a
distinct durable v2 policy without reinterpreting legacy v1 table-wide
`maxRows`; removal erases retained detail, and auth/pagination/horizon/pruning
plus compatibility corpus is green. Receipt-only inventory now refuses
privileged upcast on inspection. Migration receipts expose separate
expected/actual digests and their migration domain but disclose that both paths
share `eval_expr`, so migration independent proof remains open. Status stays
Draft and capabilities stay `Missing`); 2026-08-03 (implementation checkpoint — Rust-owned promotion and
checkpoint digest headers, normalized approved promotion writes, independent
expected-state derivation, generated schemas and golden vectors, finite
history policy/storage, budgeted materialized and receipt-only checkpoints,
the imported publication crash matrix, and registry-authoritative erasure are
implemented; LLP 0163 operation-provenance joins and the LLP 0164 promotion
caller are integrated, while the global write-authority seam and remaining
Acceptance/performance corpus still gate any capability claim); 2026-08-03
(OQ13 executed — the reproducible SQLite spike proves
one held source read transaction can feed both backup and independent scan
while writers progress, but retained WAL grows with concurrent write volume;
the contract is narrowed to budgeted pin or stable refusal); 2026-08-03
(initial Draft — extracted from Accepted LLP 0162
§§4, 6 under its OQ14 decision; this is the "focused promotion-proof Spec"
LLP 0162 §4 names as a prerequisite for the core tier's boundary-proof
component)
**Related:** LLP 0035, LLP 0037, LLP 0053, LLP 0081, LLP 0088, LLP 0158,
LLP 0162, LLP 0163, LLP 0164

**Implementation evidence:** 2026-08-06 (round-2 continuity and bounded-work
corpus: the exact delete-manifest → registered-writer open → matching
app/version/journal forgery → exact manifest restore sequence refuses the
registered writer, durably records the gap, and cannot regain
`registered-connection-defensive-app-rows-v1`; armed renewal and crash recovery
complete without a carrier wedge; an armed maintenance sweep prunes the
journal; and individual text/blob/vector values are preflight-refused before
owned expansion.); 2026-08-06 (the local derived-fork complete-pair
lane admits its worktree schema/functions through the owner-only cold-start
carrier and activates the exact two-lane/four-writer journal-authority
manifest on the primary registered connection before listener bind; every
additional process-owned writable connection joins the same authority seam. Its
fork-specific lane names do not
project LLP 0163 operation-envelope coverage. Matching database and filesystem
receipts bind activation to the fork point, and the active manifest is
re-verified before a net diff may advertise
`registered-connection-defensive-app-rows-v1`. Direct SQL on registered
process connections is denied by the SQLite authorizer; uncoordinated external
bypass, direct page corruption, raw WAL-header/checksum corruption, base
tampering, and coverage-receipt tampering refuse; unarmed, late-armed, and
retention-gap spans remain
`journal-enumerated-v1`. This closes only the narrowed fork app-row slice.);
2026-08-04 (the protected-erasure acceptance-tail
audit verified the product transaction and generation fence against LLP 0162
row 11 and added simultaneous exact/divergent retry corpus. Row 11's
protected-erasure tail is closed; independent review, author acceptance, and
separately owned gates still keep this Spec Draft and every capability
`Missing`); 2026-08-04 (the registered protected-record
erasure route, concrete-credential-bound internal authority, atomic canonical
delete/history purge/payload-free tombstone/inventory fence, producer-owned
cancellation acknowledgement, resumable physical-copy obligations, and
authority/reset/concurrency/crash/reopen corpus are integrated. This closes
the audited missing product-operation and intervening-new-checkpoint race, but
row 11 remains Partial pending the residual acceptance tail and independent
review; status stays Draft and capabilities stay `Missing`); 2026-08-04 (the independent migration oracle and
adversarial drift/corruption corpus are integrated; the registered-copy erasure
sweep and receipt are integrated with explicit crash/unreachable obligations,
but canonical protected-record deletion composition remains open); 2026-08-04 (schema-declared history projection,
v1 compatibility, visible-only auth pagination/horizon, receipt-only no-upcast,
and migration full-table-verification disclosure are integrated. Protected-copy
erasure and a genuinely independent migration oracle remain open, so the Spec
stays Draft and every capability stays `Missing`); 2026-08-03 (LLP 0164 promotion now consumes the
domain-separated expected/actual proof and rolls back on mismatch, while
issuance-bearing ordinary history rows join LLP 0163 operation identity in the
same transaction; schema-declared history, the full write-authority choke
point, remaining boundary integrations, and performance corpus still gate any
claim, so the Spec stays Draft and every capability stays `Missing`)

## Purpose

This Spec owns the digest domains, checkpoint substrate contracts, and
publication/erasure machinery of the agent-safe storage profile. LLP 0162
(Accepted) is the umbrella and holds the acceptance corpus. Its acceptance
is a named
prerequisite for `AgentSafeV1-core`'s boundary-proof component. §4 is
shared with LLP 0164 under an explicit split: this Spec owns journal
completeness, digest domains, and checkpoints; LLP 0164 owns the diff
surfaces; on a §4 divergence the owning Spec per this split is the defect.
Where this
Spec and LLP 0162 §§4/6 diverge, this Spec is the defect until a dated
revision reconciles them.

## Contract summary (normative; details per LLP 0162 §§4, 6)

- **Proof discipline.** LLP 0081's rule governs: a digest without a
  predecessor-derived expected value is inventory. Proof classes are
  three-valued — inventory, `verifiedCopyFidelity`, independent boundary
  proof — so copy fidelity can never be projected upward.
- **Promotion digest domain (to define here).** Canonical header,
  domain-separated preimage, expected-state derivation from base plus the
  approved facts of LLP 0164's `PromotionRequestV1`, actual-state scan,
  coverage binding, and golden vectors committed before any caller wires
  in. The shipped `ContentDigestHeaderV1` is migration-instant-bound and is
  not reused across domains.
- **Journal completeness.** Covered-lane physical writes on process-owned,
  registry-created connections transit a write
  authority choke point — a generated transaction API (LLP 0037 pattern)
  with an unforgeable lane-writer token, backed by verified SQLite defensive
  mode and a deny-by-default authorizer denying out-of-seam writes, schema
  aliasing, attach/detach, temp schema objects, and journal/version forgery —
  with compile-level and runtime negative fixtures. A receipt advertises completeness only when an
  exact manifest was active for its entire observation window and the
  independent journal cross-check passes; otherwise it advertises the
  enumerated-fixture inventory class or refuses.
- **Checkpoints.** Two substrate classes: materialized (physical copy;
  alone can base a non-promotable fork) and receipt-only (boundary receipt;
  no retained state; inventory unless dual-path-verified at creation, and
  outside every aggregate when unverified). Materialized-checkpoint
  verification is dual-path over one pinned source snapshot and claims
  `verifiedCopyFidelity` only. The dated OQ13 spike proves that the backup API
  and independent scan can share one held source read transaction while
  concurrent writers progress. It also proves there is no intrinsic
  database-size WAL-growth bound: admission must preflight a finite retained-
  WAL budget, monitor it during copying, and abort with a stable refusal before
  that budget is exceeded. A digest over drifted bytes is never a fallback.
- **Publication and erasure.** Checkpoint publication imports LLP 0158's
  publication state machine completely (staging sentinel, fsync order,
  atomic rename, directory fsync, orphan recovery, receipt linearization)
  with the intra-state crash-cut matrix; one declared deviation — validity
  after erasure is registry-authoritative, because erasure obligations need
  an authority that outvotes a self-evident copy. Custody registry, key
  shredding, destroyed-versus-unreachable receipts, and "an unreachable
  copy is an honest open erasure obligation" per LLP 0162 §6. History and
  checkpoint pins are finite renewable leases; only materialized copies may
  outlive the history window.

## Owned artifacts

The per-domain digest headers and preimages with golden vectors, the
checkpoint receipts and custody-registry records, the publication state
machine's checkpoint-specific instantiation, and their wire projections —
generated per LLP 0037.

### Concrete v1 digest preimages and derivations — 2026-08-03

The Rust source of truth is
[`crates/snapback/src/proof_checkpoint.rs`](crates/snapback/src/proof_checkpoint.rs). Generated schemas are
committed for `PromotionDigestHeaderV1`, `PromotionApprovedWriteV1`,
`CheckpointDigestHeaderV1`, `BoundaryDigestV1`, and `BoundaryProofV1`; the
executable, drift-gated vectors are
[`schemas/boundary-digest.golden-v1.json`](../schemas/boundary-digest.golden-v1.json).
Schema and vector presence is not a capability claim.

The promotion header binds, in order, `algorithmVersion`, the stable aggregate
`promotionIdentity`, parent and child stream identities, base and reviewed-head
versions, schema hash, coverage-manifest digest, operation-log digest, and the
full approved-facts digest. The expected side is derived by applying one
canonical, unique `(qualifiedTable, rowId)`-ordered final write set to the
immutable base. Inserts require absence, updates and deletes require presence,
inserts and updates require post-images, and deletes forbid one. The staged
re-execution scan is the actual side and does not call the expected-state
deriver. A `BoundaryProofV1` cannot be constructed without a non-empty named
independent derivation; equality of two inventory digests therefore cannot be
relabelled as proof.

The checkpoint header binds `algorithmVersion`, checkpoint identity, source
stream and version, schema hash, and coverage-manifest digest. Both domains
frame the distinct domain tag, RFC 8785 header, canonical logical application
rows ordered by `(qualifiedTable, rowId)`, and a row-count trailer. The result
is a `cdv1:` `ContentDigestV1`; the migration-shaped
`ContentDigestHeaderV1` is not reused. The committed vectors prove domain
separation, promotion expected/actual equality, and checkpoint source/copy
equality over the same logical state.

### Named-checkpoint and history substrate — 2026-08-03

Named checkpoints use the durable `_snapback_checkpoint_registry_v1` authority.
A materialized operation requires finite copy-byte, retained-WAL, and lease
budgets. It records registry intent before creating bytes, fsyncs a staging
sentinel, pins one source read transaction, independently scans that snapshot,
runs SQLite backup from the same transaction while monitoring retained WAL,
scans the copied image, and requires digest equality. It then fsyncs the
receipt/database/directory, atomically renames, fsyncs the parent, finalizes
the registry, removes the sentinel, and fsyncs the published directory.
Ordinary refusal reconciles its intent immediately; the test-only crash cuts
retain evidence for recovery. The eight intra-state cuts recover to either an
`aborted` absent checkpoint or a complete registry-authorized published one.
Post-rename recovery requires byte-identical registry and on-disk private
intents bound to operation/owner/location/source/schema/coverage/lease/budgets,
reopens and independently rescans the exact regular copied database, and fsyncs
the destination parent before marking the registry `published`. Empty schema
identity and missing/forged/symlinked recovery evidence refuse stably.
Receipt-only checkpoints retain no path and remain inventory in this
implementation. Materialized equality is labelled only
`verifiedCopyFidelity`.

Erasure commits registry invalidity before attempting physical destruction.
Successful deletion records `destroyed`; an inaccessible copy records
`invalidUnreachable` plus an open obligation, and registry invalidity outvotes
otherwise complete local evidence. A later successful erasure closes the
obligation. The protected-record copy sweep snapshots the complete registered
materialized inventory, invalidates every live entry in one transaction, and
persists a per-copy receipt before attempting deletion. It resumes missing
bytes as destroyed after a crash/reopen and retains inaccessible paths as open
obligations until a later retry closes them. That low-level checkpoint-copy
operation remains available only as evidence; the registered product command
described below now composes canonical protected-row deletion with the
complete inventory fence and closes the intervening-new-checkpoint race. The
2026-08-04 acceptance-tail audit closes row 11's protected-erasure component;
independent review and author acceptance remain publication gates. The focused
corpus also forces a canonical writer to commit while
the checkpoint source transaction is pinned, then proves the copy stayed at
the earlier stream-qualified version; the finite-WAL negative proves the
stable `SNAPBACK_CHECKPOINT_WAL_BUDGET_EXCEEDED` refusal and automatic intent
reconciliation.

Bounded row history is written only from storage's existing `record_change`
seam into `_snapback_record_history_v1` and pruned on a clock independent of
the sync-resume floor. The read applies the current-record gate and then a
per-post-image gate before visible pagination; cursor offsets and horizon facts
are derived only from visible versions. A table's optional manifest
`history { retainMs, maxVersionsPerRecord }` declaration is projected into
`_snapback_history_policies_v2` in the same transaction as every active-schema
publication path; removing it disables history and erases retained detail in
that commit. Pruning applies the count independently per `(table,rowId)`.
Legacy `HistoryRetentionPolicyV1.maxRows` remains decodable, encodable, and
table-wide through `_snapback_history_policies_v1`; an explicit v2 declaration
atomically upgrades that table, and the v1 configuration surface refuses to
replace an active v2 declaration. The corpus covers reopen, current-record and
per-version authorization, hidden-version pagination/horizon stability,
per-record caps across two records, schema removal, and sync-floor independence.
The atomic protected-record command does not itself publish a history
capability; independent review, author acceptance, performance gates, and the
other separately owned acceptance rows still prevent that claim.

#### Protected-deletion authority audit — 2026-08-04

Implementation closure is recorded in the same dated audit section.

The audit found that `BufferedWrite::Delete` and generated mutation delete
steps are ordinary application-row writes: they carry neither a
protected-erasure classification nor authority to fence checkpoint
publication. Specialized asset and authorization deletion paths own only their
respective products. Those paths remain unchanged, and the low-level
checkpoint-copy sweep is not silently attached to generic deletion.

The registered `POST /_snapback/api/storage/protected-erasure` AdminWrite
operation now owns the deliberate product boundary. Its public request carries
only operation identity and the exact row target. After acquiring the app
instance, the handler revalidates the concrete console or master-admin
credential, derives a non-deserializable internal authority from the prepared
`ProtectedRecordErasure` invocation, and runs the storage mutation inside that
authority's mode and authorization-stream publication fences. The authority
instance binds mode, profile, transition generation, credential class and
SHA-256 digest, and authorization-stream incarnation; a different or revoked
credential cannot replay the original operation identity.

One immediate transaction deletes the canonical row, deactivates its relation
incarnation, removes retained history and prior row journal payloads, advances
the canonical version, and emits one payload-free delete tombstone. The same
transaction invalidates every registered checkpoint, advances the protected
erasure generation, and persists the authority/target-bound receipt before
physical destruction. Checkpoint intent admission and final publication each
compare that generation under an immediate transaction. An in-flight producer
remains `producerActive` until it removes its exact staging/destination paths
and durably acknowledges cancellation; the external erasure worker cannot
infer closure from transient path absence. Recovery performs the same
producer-owned cleanup after reopen. Exact retries resume open reachable
obligations, inaccessible copies remain `invalidUnreachable`, and any divergent
authority or target refuses. The focused corpus covers crash cuts around the
atomic commit and physical deletion, intent/copy/rename producer crashes,
concurrent admission/publication, pinned snapshots, expired checkpoint leases,
payload-free stale replay, reachable/unreachable copies, current credential
revocation, and predecessor authorization-stream reset.

This closes the audited missing product-operation and new-checkpoint race. The
2026-08-04 acceptance-tail audit additionally verifies simultaneous exact and
divergent retries and closes row 11's protected-erasure component. It does not
publish a capability: performance and other separately owned acceptance gates,
independent review, and author acceptance remain required. This Spec therefore
stays Draft and the related capabilities stay `Missing`.

### Migration verification boundary — 2026-08-04

Full migration verification receipts record the migration boundary domain,
separate expected/actual logical and system digests, equality, and the named
predecessor-plus-plan derivation. Expected rows use a separately implemented
evaluator over every admitted pure migration expression form; this path calls
neither storage `eval_expr` nor `value_expr::eval_value_expr`. The receipt is
therefore `independentBoundaryProof` with
`expectedEvaluatorIndependence: separateImplementation`. A broad corpus binds
both implementations to explicit values, an injected execution-only semantic
drift refuses publication, and independently corrupted staged bytes still
refuse. Sampled audits remain inventory and say so on their face.

### Promotion and operation-provenance integration — 2026-08-03

Strict promotion now constructs the LLP 0165 promotion header from the sealed
request, independently derives expected rows from the immutable base plus the
canonical approved final-write set, and scans the staged transaction for the
actual rows. Publication requires an `independentBoundaryProof` match; the
negative fixture perturbs the staged state and proves that proof mismatch rolls
back before canonical publication. `PromotionReceiptV1` carries the proof, and
the aggregate LLP 0163 envelope plus per-source write-fact joins commit in that
same transaction. The product-owned ordinary-mutation writer records and then
verifies the exact canonical change/history journal; trigger side paths and
unsupported physical table shapes refuse before replay. The envelope still
declares `promotionCoverageManifest` uncovered until the global active
write-path manifest/authorizer seam is integrated, so the boundary proof cannot
be mistaken for whole-target coverage.

For issuance-bearing ordinary mutations with an active finite history policy,
the HostPlan/Buffered transaction fills retained history rows with the owning
operation identity before commit. This supplies the operation-provenance join
for covered history rows without changing uncovered writes into covered ones.
Neither integration establishes global journal completeness. The generated
write facade and SQLite-authorizer enforcement now exist, but ordinary parent
startup does not arm them by default and excluded writer families have not
completed the storage-wide migration.

### Derived-fork authorizer-backed net diff — 2026-08-06

The local derived-fork lane is the first deliberately narrow whole-window use
of the journal-completeness choke point. On the complete-pair path, `fork
create` launches the child with the owner-only cold-start carrier; on the
primary process-owned registered connection, startup admits (and where needed applies) the
worktree schema/function pair, verifies that the application head still equals
`forkPointVersion`, activates the exact fork-local journal-authority manifest,
and only then binds the listener. The manifest's covered lanes are
`derivedForkOrdinaryAppRowJournal` and
`derivedForkHostChildAppRowJournal`, mapped to the four generated ordinary and
host-child physical writer adapters. These distinct names intentionally do not
activate or advertise LLP 0163's `ordinaryMutation` and `hostChildMutation`
operation-envelope lanes. Activation writes identical
`snapback.fork-app-row-coverage.v1` evidence to
`_snapback_meta.instance_fork_app_row_coverage_v1` and the sibling
`fork-app-row-coverage-receipt.json`. Its self-digest binds the fork identity,
fork point, data-version stream, activation head/time, exact manifest version
and digest, covered lanes, uncovered/refused app-effective lanes, and writer
choke points.

The completeness spelling is
**`registered-connection-defensive-app-rows-v1`**. It means only this: from
the derived fork point through the receipt's observed head, physical writes to
application tables made by process-owned writable connections constructed by
Snapback's connection registry were admitted only under the generated writer
token for the
`derivedForkOrdinaryAppRowJournal` or
`derivedForkHostChildAppRowJournal` lane; the active manifest names the four
corresponding writer choke points; the per-stream continuity carrier remained
`continuous` and exactly matched that manifest for the whole window; no
registered-writer reconstruction observed an absent or contradictory active
boundary; and the retained-base/head oracle agrees that every net-changed app
row is explained by the journal. Every such writable
connection verifies `SQLITE_DBCONFIG_DEFENSIVE` and installs the same
deny-by-default policy in a connection-local authorizer. The policy refuses writable-schema mutation,
schema aliases, attach/detach, temporary schema objects, unsupported actions,
application DML under system-only tokens, direct journal/version forgery, and
arbitrary DML against the active-manifest and continuity carriers. Exact
coverage activation is the only manifest/continuity transition admitted under
the operation-ledger token. A registered factory must reconstruct and compare
the fork's database and file coverage receipts, active stream, active manifest,
and continuity row before it issues any writer token. An observed gap changes
the database continuity row monotonically to `broken` and, for a managed fork,
creates `fork-app-row-coverage-gap.v1.json`; neither transition has a re-arm
path. Therefore deleting the manifest, using or attempting to use another
registered writer, and restoring identical bytes cannot re-earn this class.
For this armed class, the latest journal post-image for every touched row must
also equal the independently scanned head, so an uncoordinated bypass cannot
borrow an earlier legitimate journal entry for the same row. The receipt
names the manifest digest and covered/uncovered lane sets separately from
`journalConsistency`; the uncovered set names the app-effective writer
families that are refused while this profile is armed. Its `domains` map
continues to mark schema, auth,
operational, configuration, assets, egress attempts, telemetry, and sidecars
omitted. Operation attribution is also explicitly `absent-v1`; the fork
journal-authority profile supplies no operation identity or envelope claim.

This spelling is an **in-process registered-connection class**, not OS or file
containment. Snapback does not prevent another same-user process—or deliberately
evasive in-process native code that bypasses the Rust connection factory—from
opening or rewriting the SQLite database/WAL. The base digest, defensive
connection, bounded raw-WAL header/frame checksum validation, head scan, and
journal oracle make ordinary direct WAL/page corruption, unjournaled writes,
and stale-post-image borrowing tamper-evident and refuse them. They do not
authenticate SQLite pages: an out-of-class writer that
coordinately changes the app B-tree, `_snapback_version`, and a matching
`_snapback_changes` post-image can forge the corroborating evidence. Such a
threat requires an OS/container/filesystem authority boundary and is outside
this class; no receipt may be described as tamper-proof against it.

The spelling is unavailable when either coverage receipt is missing, malformed,
or disagrees; when the manifest/stream/continuity cut no longer matches; when
the durable gap sidecar exists; or when activation did not bind the fork point.
Static receipt/fork-point validation failures refuse with
`SNAPBACK_FORK_WRITER_COVERAGE_INVALID`; a registered-writer continuity gap
refuses with `SNAPBACK_FORK_WRITER_COVERAGE_GAP` and requires fork recreation.
A net change absent from the journal,
or a covered journal whose final post-image disagrees with the head oracle,
refuses with `SNAPBACK_FORK_DIFF_ORACLE_MISMATCH`. A partial generated layout
using the historical post-bind loader, any other unarmed fork, a manifest
armed after the first child commit, or a retention gap remains
`journal-enumerated-v1`; none receives a free upgrade. This record neither
changes ordinary parent default-arming semantics nor claims the storage-wide
LLP 0162 row-4 program: default arming, excluded-writer migration, and any
broader lane/domain coverage remain open.

## Acceptance

LLP 0162 Acceptance row 12, row 11's checkpoint half, row 4's
journal-completeness leg (the choke point this Spec owns), and row 13's
applicable submetrics gate these components. The dated 2026-08-04 audit closes
row 11's protected-erasure tail without changing the remaining rows or making
a capability claim. This Spec's golden vectors are committed before any caller
wires in, independently of sequencing step 0 (the performance baseline). No
parallel corpus here.

## Open items

1. *(Executed 2026-08-03.)* The snapshot-pinning spike narrows the dual-path
   contract to **budgeted pin or stable refusal**. It does not permit an
   unbudgeted database-sized copy and does not establish an intrinsic WAL
   bound.
2. *(Executed 2026-08-03.)* Concrete per-domain preimage field lists and
   golden vectors are recorded above and generated from the Rust implementation.
3. This Spec owns the global write-authority choke point. Both decided controls
   landed in [`crates/snapback/src/storage/write_authority.rs`](crates/snapback/src/storage/write_authority.rs):
   the generated transaction API holds the unforgeable lane-writer token, and
   registered writable connections verify defensive mode and install the
   deny-by-default SQLite authorizer. LLP 0163
   supplies the writer inventory, envelope-hook routing, and active coverage
   manifest. The 2026-08-06 record above closes only the local derived-fork
   app-row window. Open here are ordinary default arming, migration or explicit
   exclusion of every remaining writer family/direct-SQL site, and the
   storage-wide LLP 0162 row-4 acceptance program.
4. *(Executed 2026-08-04.)* The full migration receipt binds a separately
   implemented expected-value oracle and adversarial drift corpus. The
   registered protected-record product command supplies the previously missing
   authority and atomically composes canonical deletion, retained-detail purge,
   checkpoint-inventory invalidation, generation fencing, and its retry-bound
   receipt. Admission/final-publication races, producer cancellation and
   recovery, active/expired leases, reachable/unreachable copies, exact and
   divergent concurrency, credential revocation, and authorization-stream
   reset are covered. Generic row deletion remains deliberately unchanged.

## Dated OQ13 spike record — 2026-08-03

The reproducible runner is
[`crates/snapback/examples/snapshot_pinning_spike.rs`](../crates/snapback/examples/snapshot_pinning_spike.rs);
the raw dated record is
[`tests/acceptance/fixtures/agent-safe-storage/oq13-snapshot-pinning.2026-08-03.v1.json`](../tests/acceptance/fixtures/agent-safe-storage/oq13-snapshot-pinning.2026-08-03.v1.json).
The fixed fixture uses SQLite 3.45.0 in WAL mode, 4,096 rows with 512-byte
payloads, a held deferred read transaction, a one-page-at-a-time backup, and
128 concurrent writer commits.

The copied digest and version equal the pinned pre-writer snapshot and differ
from the live post-writer head; all 128 writer commits complete. The pin retains
3,390,792 WAL bytes (1.4007× the checkpointed 2,420,736-byte source file) until
release, after which a truncate checkpoint returns the WAL to zero. That ratio
is a fixture observation, not a bound: retained WAL is a function of concurrent
write volume and pin duration. The implementation contract therefore requires
a declared admission budget, progress accounting, cancellation before budget
exhaustion, and a stable refusal disposition. This record satisfies the OQ13
sequencing gate; LLP 0165 implementation and Acceptance rows remain unpassed.

## Status

**Accepted 2026-08-06 (Charlie Cheever).** Three mutually blind rounds of
Codex- and Fable-family review converged `READY` for this Spec. Acceptance is
of the proof-domain and checkpoint contract. It does not upgrade the narrow
local derived fork's registered-connection app-row completeness into
storage-wide completeness, OS/file containment, promotion proof, or checkpoint
publication. The broader agent-safe-storage aggregate, hosted targets, and
every target-manifest predicate remain `Missing` or explicit nonclaims.
