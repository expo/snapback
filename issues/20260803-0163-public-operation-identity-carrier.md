# LLP 0163 public operation-identity carrier and coverage activation

**Status:** Open
**Opened:** 2026-08-03 (LLP 0163 durable storage slice)
**Systems:** Sync, Client integration, Storage, Jobs, Migrations, Testing
**Related:** LLP 0043, LLP 0133, LLP 0162, LLP 0163

The public client range carrier, ordinary-mutation choke points, protected
explanation custody, job/cron action children, and migration transaction
carriers are implemented. Production targets still do not activate a coverage
manifest, the public explanation lane has closed positive evaluators only for
exact generated owner create/update facts, and migration remains explicitly
uncovered. The aggregate publication/terminal split now has a truthful
Pending→supplement lifecycle, but H1/H2/C remain carrier-only and
review/publication gates are still open.

The remaining closure gates are:

- inventory every durable writer per target, route each covered writer through
  the envelope hook, activate a versioned manifest only after bypass and
  asymmetric-retention corpus pass, and keep undeclared lanes explicit;
- independently review and accept the implemented pending→terminal migration
  amendment and complete the remaining asymmetric/performance gates before
  adding that specialized lane to coverage;
- complete the remaining real current-policy evaluators for the public
  explanation lane; exact generated owner create/update are closed, generated
  delete is a normative current-row-absent refusal, and the public/admin
  transport and protected custody are already wired; and
- rerun LLP 0162 Acceptance row 13's comparable candidate protocol with the
  public issuance-bearing covered lane active under a genuinely paired,
  baseline-digest-bound protocol; the clean 2026-08-03 binary observations
  were within threshold but used ordinal-zipped historical samples and did not
  activate that lane.

Until all relevant corpus rows pass for a named target, capability manifests
must remain `Missing` and must not advertise envelope coverage.

## Progress — 2026-08-04

Landed in the public client carrier slice:

- Rust-owned issue/refresh request and response schemas and the authenticated
  `/client-mutations/identity-range` route;
- server-selected finite ranges with latest-range continuity and safe recovery
  of a committed-but-undelivered first response, with issuance kept separate
  from the still-unpublished ordinary coverage activation cut;
- `operationIssuance` on the existing mutation retry identity, selected-artifact
  binding, and transport refusal of client-minted host identities;
- one dormant server-controlled coverage seam declaring the HostPlan and Ibex
  buffered writer inventory, with identity-less refusal proven only after an
  explicit corpus activation; and
- atomic range/counter/intent custody on memory parity, IndexedDB, and file
  stores, including crash/reopen, exhaustion, refresh-before-admission, and
  client wire corpus. The client carrier remains explicit opt-in while LLP
  0163 is Draft and capabilities are `Missing`.

Landed in the explanation/protected-custody slice:

- Rust-owned exact-operation request/response schemas plus authenticated
  `/operations/explain` and AdminRead
  `/_snapback/api/operations/explain` routes, with the latter strengthened to
  the existing secret-read lease gate in sessions mode;
- current AdminRead policy evaluation and a public lane that resolves the live
  principal/incarnation, derives the current client audience, re-runs live
  function/grant/profile policy, and projects only exact generated
  `owned-crud.v1` / `owner.v1` create/update envelopes whose active
  artifact, current and retained historical owners, and closed
  read/write/context/effect/receipt facts all revalidate (Partial, never an
  authorization claim inferred from identity equality or protected custody);
- owner-only sidecar keys and XChaCha20-Poly1305 custody for read, write,
  context-answer, and receipt detail, with one fail-closed projection covering
  those four protected classes plus inline-redacted effects; and
- LLP 0158 fork custody extended so protected-detail ciphertext is scrubbed,
  the key sidecar rotates, absent minted custody refuses boot evidence, and
  neither parent key nor ciphertext crosses into a derived fork. Managed
  in-app branch publication applies the same executable-head scrub/private-key
  boundary, and exact drop/reap removes its sidecar; swapped valid sidecars
  refuse at boot rather than deferring failure until explanation.

Landed as row-13 evidence scaffolding, without changing capability state:

- a release-only recorder that binds the accepted baseline artifact bytes,
  exact pre-profile revision plus three-blob instrumentation provenance,
  a separately digest-bound external wrapper source/path dependency and lock
  derived from the exact baseline root resolution (all shared package tuples
  must match and only the wrapper package may be added),
  baseline-wrapper and candidate executable digests, exact clean candidate
  revision, fixed Air hardware/OS, and the accepted toolchain; the wrapper is
  not a fourth accepted product instrumentation path;
- 11 experimentally time-local comparisons in alternating AB/BA order whose
  candidate worker activates the actual `ordinaryMutation` coverage manifest,
  obtains a server-issued client range, and commits issuance-bearing mutations
  through the production envelope seam;
- paired active allocation/retention observations for one file-backed covered
  mutation after setup, retained without inventing a numeric byte threshold;
  and
- paired five-second idle observations with the active coverage/range state
  held open, enforcing the registered CPU, RSS-equivalence, output-block, and
  database-family-byte rules. The fixed-Air dated result and the other row-13
  gates remain open, so the recorder still forces non-qualification.

Landed in the host action-child carrier slice:

- job, cron, recovery, and manual action runs derive one attempt-invariant
  parent from durable job/slot/idempotency facts and stable child ordinals;
- server-recorded range-less host epochs authenticate child issuance to the
  current data stream and authorization-instance incarnation;
- production managed and detached actions carry host identities through both
  HostPlan and Ibex nested mutations, with an explicit two-writer host lane
  inventory and buffered exact replay before write application; and
- ordinary-only, host-only, both-lane, wrong-issuance, and identityless-
  asymmetric fixtures are green, including a transaction-level manifest-lane
  refusal and a production retry that retains one row and one Host envelope.

The host lane remains dormant outside explicit corpus activation. This slice
does not publish or advertise a capability.

Landed in the migration transaction-carrier slice:

- one authenticated Host `OperationIdentityV1` per physical migration-journal
  transaction, parented by the approval operation id and shared by every row
  that transaction appends;
- a deterministic child ordinal equal to the operation's durable
  pre-transaction journal-row count, excluding attempt-local time, executor,
  and fencing-lease facts;
- durable Host-authority provisioning before apply, rollback, release, and
  cleanup cuts, including reopen support for legacy in-progress migrations;
- focused rollback/retry proof across fencing-lease supersession, multi-entry
  transaction proof, and production apply/release, rollback, and cleanup-
  reopen coverage of every new journal row; and
- generated journal artifacts that declare the Host carrier while explicitly
  declaring migration envelope coverage absent.

## Migration pending → terminal lifecycle implementation map — 2026-08-04

This dated map is now implemented as an amendment to Draft LLP 0163. It is
implementation/corpus evidence, not independent review, author acceptance, or
capability publication. The aggregate boundary and `migrationTransition` lane
stay out of every coverage manifest.

### Current durable cuts

| Cut | Current atomic transaction | Identity / coverage posture |
| --- | --- | --- |
| H0 — authority | Ensure the current data-version stream and range-less migration Host incarnation. | Server authority only; not an application operation and no envelope. It commits before H1 so later rollback cannot change retry issuance. |
| H1 — admission | Migration operation row, lease/fence, checkpoint setup, and `admitted` + `barriered` journal rows. | One authenticated approval-derived Host child for the transaction; carrier-only and uncovered. |
| H2 — private work | Each staged/backfill/verification transaction and its migration journal row(s). | One Host child per transaction; private/staged work remains carrier-only and uncovered. |
| P — publication | Successor schema/generation, application version P, retention floor, one schema-resync `_snapback_changes` row, `published-held`, aggregate Pending envelope, and pending lifecycle. | One atomic application-visible cut under the approval-derived aggregate Host identity; the receipt truthfully says outcome pending. |
| T-release — terminal success | `released`, fence deletion, terminal forward receipt, and digest-linked `Committed` supplement. | Separate from P and writes no application version; it appends the terminal truth without rewriting P. |
| T-rollback — terminal rollback | `rolling-back`, predecessor republish at version R, one rollback-resync change row, `rolled-back`, fence deletion, forward + rollback receipts, and digest-linked `RolledBack` supplement. | One atomic rollback/finalization transaction linked to the exact identity, P, and pending digest. |
| C — cleanup | `cleanup-pending`, physical garbage drops, and the repeated terminal journal state across two resumable cuts. | Post-terminal maintenance children; never substitutes for P or T settlement and remains uncovered. |

The ordinary terminal-only `record_operation_in` seam still rejects
`OperationReceiptStateV1::Pending`. The additive migration aggregate seam owns
Pending lifecycle and terminal supplement tables instead; it does not widen or
rewrite the existing v1 suppression/tombstone vocabulary.

### Implemented amendment shape (unpublished)

1. Define one aggregate migration operation identity whose stable source is
   the approved migration `operationId`. Per-transaction Host children remain
   provenance joins; executor leases and attempts are never aggregate identity
   facts.
2. At P, atomically write the schema/data publication, schema-resync journal
   row, aggregate envelope in `Pending`, and a pending suppression/lifecycle
   record. The envelope's produced snapshot is P and its write-fact count must
   exactly cover the publication transaction's application journal rows.
3. Exact lookup of the aggregate identity while pending returns a typed
   `published-held`/outcome-pending result and never re-executes P. Divergent
   bound facts retain the existing fail-closed reused-identity disposition.
4. T-release or T-rollback atomically finalizes that exact pending record to
   `Committed` or the amendment's explicitly named rollback outcome. The
   finalizer compares the aggregate identity, P, and the pending receipt
   digest/chain; a second equal finalizer is replay, while a different one is
   corruption/refusal. Finalization appends a new digest-linked supplement and
   never mutates the pending envelope.
5. Pending records are non-reclaimable, non-acknowledgeable, and hold their
   Host epoch open. Terminal retention, tombstones, purge, and epoch closure
   begin only at the finalization time and follow the declared Host window.
6. Coverage names the exact boundary it proves. If only P/T aggregate
   settlement is covered, H1/H2/C stay explicitly carrier-only; a manifest may
   not imply that every private migration transaction has its own envelope.

### Required crash and replay corpus

| Crash / retry cut | Required observation before migration coverage may activate |
| --- | --- |
| Before P commits | No P, pending record, envelope, or schema-resync row; retry may execute P once under the same aggregate identity. |
| Inside P | All-or-none across live schema/data, version P, schema-resync row, pending envelope, and pending suppression. |
| After P, before T | Retry returns the retained pending/`published-held` posture and never republishes or emits a second schema-resync row. |
| Inside T-release | All-or-none across `released`, fence deletion, terminal receipt, and pending→terminal transition. |
| After T-release response loss | Exact retry returns the retained terminal receipt; P and T each remain singletons. |
| Inside T-rollback | All-or-none across predecessor republish R, rollback-resync row, `rolled-back`, receipts, fence deletion, and pending→terminal transition. |
| After T-rollback response loss | Exact retry returns the retained rollback outcome and never republishes R. |
| Cleanup crash/reopen | Terminal aggregate result is unchanged; cleanup resumes only its carrier-only physical tail. |
| Divergent replay at pending and terminal states | Refuse before any migration or application write. |
| Retention/capacity pressure while pending | Refuse new admission according to the declared bound; never evict, acknowledge, tombstone, or close the epoch for the pending operation. |

The activation gate additionally requires an enumerated writer manifest for
this exact migration boundary, asymmetric envelope/change retention in both
directions, journal-count equality at P and rollback R, the paired active-lane
performance record, independent review, and author acceptance. Until then the
migration lane and every aggregate capability remain `Missing`.

### Dated implementation and corpus evidence — 2026-08-04

- P retains exactly one application version, schema-resync row, Pending
  envelope, and pending lifecycle in the publication transaction. The
  envelope write count is checked against the transaction's exact journal
  count.
- Lookup re-decodes and validates the retained envelope and recomputes its JCS
  receipt digest. Identity, P, Pending state, digest, timestamp, and payload
  must all equal the lifecycle; a swapped payload refuses.
- T-release and T-rollback read their retained receipt JSON back from the
  owning operation row before digesting it, append a payload-free terminal
  supplement atomically, and re-verify those retained bytes on public lookup.
  Rollback R must contain exactly one rollback-resync row.
- Focused fixtures cover the ten mapped crash/replay categories, exact and
  divergent pending/terminal retry, one-entry capacity refusal, inert pending
  ACK, response loss on both exits, cleanup resume, and host-window
  compaction. The existing v1 suppression/tombstone schemas are unchanged.
- The generated migration journal artifact names aggregate P/T as implemented
  but uncovered and keeps H1/H2/C carrier-only. Capabilities remain `Missing`.

Landed in the local SQLite write-authority slice:

- a module-private generated writer token classifies the two ordinary and two
  host-child physical adapters, and an armed connection-local SQLite
  authorizer denies application-table DML and schema changes outside it;
- prepared-statement caching is disabled on that writer connection, with a
  token-drop reauthorization negative; trigger-mediated application DML is
  denied even inside the token until a generated trigger journal adapter
  exists;
- positive issuance-bearing HostPlan and Ibex-buffered commits retain their
  exact envelopes/journals, including exact system-field postimages; and
- the target/app-effective inventory keeps migration, seed/reset,
  membership-admin, projection-rebuild, and specialized-system lanes visible.
  The specialized row is deliberately grouped and non-enumerated, so it can
  never upcast the local target to complete coverage.

This is enforcement substrate, not production activation. The incomplete
specialized inventory and every non-envelope-mapped app-effective lane remain
publication blockers; capabilities stay `Missing`.

Still required before this ticket closes:

- independent review and author acceptance of the pending→terminal migration
  lifecycle amendment, plus its remaining asymmetric-retention and
  active-lane performance gates, before any migration coverage claim;
- the remainder of per-fact current-policy evaluation for public explanation:
  aggregate/non-row, hand-written/opaque, predicate, membership,
  effect-bearing, and other unsupported shapes stay fail-closed; exact
  generated owner create/update are the only current positive profiles, while
  generated delete remains a normative current-row-absent refusal;
- enumerate and envelope-map or explicitly exclude every migration,
  seed/reset, admin, projection, and specialized physical writer; then finish
  the complete target writer/asymmetric-retention corpus (the four
  ordinary/host adapters' SQLite bypass corpus is now green); and
- the dated fixed-Air execution of the paired active-lane recorder and p99
  recorder, plus the required independent review/author acceptance and every
  applicable row-13 correctness gate.

## Lifecycle-tail evidence — 2026-08-04

- Both ordinary writer choke points pass file-backed crash/reopen cuts before
  settlement, between settlement and envelope, and between envelope and COMMIT;
  the reopened database contains none or the complete application/journal/
  settlement/envelope/suppression/protected-detail set. Exact post-reopen retry
  returns the original output with no changes.
- An issuance-bearing retry whose predecessor replay row is absent now follows
  suppression → tombstone/compact envelope → epoch floor. Protected exact
  replay opens the digest-bound encrypted receipt while suppression JSON is
  plaintext-free; ACK/purge returns `result-expired`; a closed-floor committed
  retry and delayed first delivery both return outcome unknown before dispatch.
- Retention-full preserves the unacknowledged replay result and rolls back the
  next write. Operator purge is transactionally audited and scoped to the
  active client stream/originator partition; same-text retired-stream client
  and current-stream host identities with divergent principals survive.
- The JS outbox never mark-fails a committed result whose payload expired and
  never terminalizes an outcome-unknown horizon response. It retains the head,
  stops ordered replay, blocks successors, and projects the known/unknown
  operation outcome on the thrown error. Focused full outbox corpus is green.

This is additional Partial evidence only. Production coverage remains dormant;
the complete migration writer/asymmetric-retention proof, recreated-branch end-to-end lifecycle corpus,
complete target writer/bypass inventory, distinct durable result-gone outbox
state, fixed-Air active/idle/retention performance artifact, independent
review, and author acceptance remain required. LLP 0163 remains Draft and all
related capabilities remain `Missing`.

## Public current-policy tail evidence — 2026-08-04

- Exact generated owner create now requires current and retained-insert owner
  agreement, one inserted write/result, one matching ctx id, and one private
  mint observation bound to the active artifact's exact
  `plan/steps/0/insert/row-id` site and occurrence zero. The private
  site/occurrence ledger is validated but stripped from public explanation and
  never treated as authority.
- Exact generated owner delete is recognized but returns the same metadata-free
  `authorization-unprovable` refusal: after deletion there is no current row
  against which LLP 0088's current owner policy can be evaluated, and retained
  ownership/identity/custody cannot replace it.
- Focused negatives cover changed current/historical owners, missing-row,
  predicate/query, aggregate result-membership, membership permission, widened
  ctx, effects and effect-class flags, opaque/unsupported policy, divergent
  receipt, wrong/extra/reordered mint observations, truncation, expiry, and
  changed audience/principal/incarnation/artifact. Every constituent failure
  withholds stored metadata, counts, digests, and detail.

This is additional row-3 Partial evidence. General aggregate/non-row,
predicate, membership, effect-bearing, hand-written/opaque, and other
generated policy profiles still have no positive evaluator; LLP 0163 stays
Draft and all related capabilities stay `Missing`.
