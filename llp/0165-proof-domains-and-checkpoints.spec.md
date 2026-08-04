# LLP 0165: Proof domains and checkpoints

**Type:** Spec
**Status:** Draft
**Systems:** Storage, Migrations, Diagnostics, Testing
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-03
**Revised:** 2026-08-03 (implementation checkpoint — Rust-owned promotion and
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

**Implementation evidence:** 2026-08-03 (LLP 0164 promotion now consumes the
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
- **Journal completeness.** Covered-lane physical writes transit a write
  authority choke point — a generated transaction API (LLP 0037 pattern)
  with an unforgeable lane-writer token, backed by a SQLite authorizer
  denying out-of-seam writes to covered tables — with compile-level and
  runtime negative fixtures. Until the seam lands, coverage and diff
  advertise the enumerated-fixture inventory class, not completeness.
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
[`src/proof_checkpoint.rs`](../src/proof_checkpoint.rs). Generated schemas are
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
obligation. The focused corpus also forces a canonical writer to commit while
the checkpoint source transaction is pinned, then proves the copy stayed at
the earlier stream-qualified version; the finite-WAL negative proves the
stable `SNAPBACK_CHECKPOINT_WAL_BUDGET_EXCEEDED` refusal and automatic intent
reconciliation.

Bounded row history is written only from storage's existing `record_change`
seam into `_snapback_record_history_v1` and pruned on a clock independent of
the sync-resume floor. The read applies the current-record gate and then a
per-post-image gate before visible pagination; cursor offsets and horizon facts
are derived only from visible versions. Durable finite policy currently lands
through `_snapback_history_policies_v1`; projecting that policy from a
per-table schema declaration remains part of the row-11 integration gap and
prevents a history capability claim at this checkpoint.

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
Neither integration establishes the still-missing global generated write
facade plus SQLite-authorizer completeness seam.

## Acceptance

LLP 0162 Acceptance row 12, row 11's checkpoint half, row 4's
journal-completeness leg (the choke point this Spec owns), and row 13's
applicable submetrics gate these components. This Spec's golden vectors
are committed before any caller wires in, independently of sequencing
step 0 (the performance baseline). No parallel corpus here.

## Open items

1. *(Executed 2026-08-03.)* The snapshot-pinning spike narrows the dual-path
   contract to **budgeted pin or stable refusal**. It does not permit an
   unbudgeted database-sized copy and does not establish an intrinsic WAL
   bound.
2. *(Executed 2026-08-03.)* Concrete per-domain preimage field lists and
   golden vectors are recorded above and generated from the Rust implementation.
3. LLP 0163 composition details of the write-authority choke point — both
   controls (the generated transaction API with lane-writer token AND the
   SQLite authorizer) are decided by LLP 0162 §4. Promotion proof and ordinary
   history-operation joins are integrated; open here are the generated-facade
   surface, authorizer enforcement, and migration path for existing direct-SQL
   write sites.

## Dated OQ13 spike record — 2026-08-03

The reproducible runner is
[`examples/snapshot_pinning_spike.rs`](../examples/snapshot_pinning_spike.rs);
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
