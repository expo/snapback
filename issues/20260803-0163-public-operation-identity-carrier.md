# LLP 0163 public operation-identity carrier and coverage activation

**Status:** Open — carrier landed; publication/activation/row-13 remain
**Opened:** 2026-08-03 (LLP 0163 durable storage slice)
**Updated:** 2026-08-06 (landed a0852be row-13 paired failure preserved; range-read p95 crossed the unchanged faster-side equivalence edge, absolute did not run, per-call range preparation is restored for a fix-forward successor, and Draft/Missing remain unchanged); 2026-08-05 (C32 stopped before qualifying dual review completed or performance; two newer mainline cuts were merged normally and C33 is prospective; Draft/Missing unchanged); 2026-08-05 (exact C30 stopped before performance; C31 repairs global Host-lease, pending-capacity, and client-suppression projection coherence; Draft/Missing unchanged); 2026-08-05 (exact C29 stopped before performance; C30 repairs terminal-supplement projection coherence, automatic sessions ACK custody, the public explanation oracle, and the Host rollback matrix; Draft/Missing unchanged); 2026-08-05 (merged C28 stopped before performance; C29 repairs automatic sessions range custody, Host tombstone schema nullability, retention-time coherence, and pending rollback proof; Draft/Missing unchanged); 2026-08-05 (C27 pre-result abandonment and C28 identity-lifecycle correction; Draft/Missing unchanged); 2026-08-04 (fork-boundary correction — managed branches pin
canonical schema/function-bundle identities and preserve exact retry across
parent drift, but CaptureOnly is truthfully non-promotable. Product provider
custody, ordered settlement, and public effect-bearing strict promotion are
outside this Track B publication scope; they cannot count toward writer-lane
coverage or capability activation. Draft/Missing states are unchanged);
2026-08-04 (authenticated explicit local activation transport,
closed 23-family writer inventory, executable armed exclusions, and exact
four-adapter publication; activation remains operator-invoked and capabilities
remain Missing pending performance, review, and author acceptance);
2026-08-04 (durable result-gone client custody plus recreated-client and real
host-writer retry/capacity/purge/rotation lifecycle corpus; coverage remains
dormant pending the remaining branch, cross-lane, performance, review, and
author-acceptance gates)
**Reconciled:** 2026-08-05 (LLP 0185 Phase 0 — this focused ticket owns LLP
0163's public carrier, writer inventory, activation, explanation transport,
host identities, and row-13 measurement; LLP 0165 retains the global journal-
completeness choke point and LLP 0162 retains row-completion authority)
**Systems:** Sync, Client integration, Storage, Jobs, Migrations, Testing
**Related:** LLP 0043, LLP 0133, LLP 0162, LLP 0163


## Triage (2026-08-26 leftover sweep)

Still open for publication/activation/row-13, not for “no carrier.” LLP 0163 is **Accepted** (2026-08-06). The carrier is in tree (`schemas/operation.identity-range-*.json`, `POST /client-mutations/identity-range`, `operationIssuance`). Capability rows remain Missing (`operating.agent-safe-storage`). Point remainder proofs at `issues/20260803-agent-safe-storage-acceptance-tail.md`.

## Author ruling — landing discipline for dual-READY cuts (2026-08-06)

Ruled by Charlie to break the C27–C33 HEAD-chasing loop (every cut kept
being invalidated by "the mandatory post-review fetch found newer main
before performance"):

- A cut that has received **mutually blind dual READY verdicts** (both
  model families) **may land on main immediately**. A newer main found
  after review requires a normal conflict-resolving merge, but it does
  **not** invalidate the reviews or force a fresh cut.
- The **performance leg runs immediately after landing**, against the
  landed commit (row 13's genuinely paired, baseline-digest-bound protocol
  with the public covered lane active).
- **Nothing is claimed at landing.** The production activation command,
  any coverage manifest above `Missing`, and every capability
  advertisement remain gated on the post-landing performance result plus
  the other named closure gates, exactly as before. Landing is
  integration, not qualification.
- If the post-landing performance leg fails its thresholds, record the
  failure here and fix forward (or revert); a landed-but-unqualified cut
  never activates.

This ruling changes only the *ordering* of landing versus the performance
leg; every honesty gate is unchanged.

The public client range carrier, ordinary-mutation choke points, protected
explanation custody, job/cron action children, and migration transaction
carriers are implemented. Production targets do not activate a coverage
manifest by default; an exact authenticated AdminWrite command can activate
the narrow local four-adapter profile only after its gates pass. The public
explanation lane has closed positive evaluators only for exact generated owner
create/update facts, and migration remains explicitly uncovered. The aggregate
publication/terminal split has a truthful Pending→supplement lifecycle, but
H1/H2/C remain carrier-only and review/publication gates are still open.

## Scope fence after LLP 0185 Phase 0

This ticket owns LLP 0163's public carrier, target writer inventory,
envelope-hook routing, coverage-manifest activation, explanation transport,
host identity callers, and its row-13 measurements — the LLP 0162 row
1–4/13/14 legs enumerated below. It does **not** own LLP 0165's global
generated lane-writer facade plus SQLite-authorizer completeness choke point,
even though both efforts meet in row 4. The consolidated row ledger remains
`issues/20260803-agent-safe-storage-acceptance-tail.md`; neither ticket may
mark a row complete independently of LLP 0162.

**Qualification update — 2026-08-05:** C31 and C32 were abandoned before a
qualifying dual review and performance completed after mandatory fetch/tip
checks found newer main. The two later cuts were merged normally; C33 is the
prospective exact clean successor. The Spec remains `Draft` and the capability
remains `Missing`.

**Qualification update — 2026-08-06:** Exact C33 received fresh mutually
blind Codex-family and Fable-family `READY` verdicts. Under the author ruling
above, later mainline cuts merge normally into that reviewed work; they do not
invalidate the reviews or create C34/C35 qualification cuts. Merge commit
`d56721ca5a` and its successors preserve the carrier/custody work while adding
the upstream fork and client/demo changes. The merged tree lands after
proportional verification, then row 13 runs against the landed commit. The
Spec remains `Draft` and the capability remains `Missing` until performance
and all other named gates pass.

**Post-landing performance result — 2026-08-06:** Landed commit
`a0852be190d7a908e2419ccaac43f30eee977ee2` produced one valid paired record,
preserved outside the repository with SHA-256
`8e1f6a4cbbe786eb4eba71c8dc435457331d87446dd26a39a80314a4c6272ab0`.
Eight of nine read/write comparisons and all idle gates passed. Current-range
p95 alone failed the unchanged two-sided five-percent equivalence gate on the
faster side: paired median -4.1812%, bootstrap 90% interval -5.9841% to
-1.4621%. Per the author ruling, the absolute process did not run, the
production activation command remains uninvoked, the Spec stays `Draft`, and
the capability stays `Missing`.

The fix-forward successor restores `scan_table` to the pinned pre-profile
per-call statement-preparation boundary instead of retaining its later
statement-cache entry. The benchmark, baseline, threshold, estimator,
protocol, active carrier, and exception posture are unchanged. Only a new
landed commit that passes both original performance legs may continue to the
remaining review, acceptance, and publication gates.

The remaining closure gates are:

- invoke the closed production activation command only after independent review,
  author acceptance, the fixed-Air result, and every applicable crash and
  asymmetric-retention gate; the complete local writer inventory and its
  fail-closed exclusion policy are now implemented;
- independently review and accept the implemented pending→terminal migration
  amendment and complete the remaining asymmetric/performance gates before
  adding that specialized lane to coverage;
- complete the remaining real current-policy evaluators for the public
  explanation lane; exact generated owner create/update are closed, generated
  delete is a normative current-row-absent refusal, and the public/admin
  transport and protected custody are already wired;
- keep strict promotion outside every active coverage manifest: no-effect
  promotion remains an explicitly excluded physical writer, CaptureOnly
  captured effects refuse before canonical mutation, and test-only settlement
  helpers cannot stand in for product provider custody or ordered settlement;
  and
- rerun LLP 0162 Acceptance row 13's comparable candidate protocol with the
  public issuance-bearing covered lane active under a genuinely paired,
  baseline-digest-bound protocol; the clean 2026-08-03 binary observations
  were within threshold but used ordinal-zipped historical samples and did not
  activate that lane.

Until all relevant corpus rows pass for a named target, capability manifests
must remain `Missing` and must not advertise envelope coverage.

## C28 review stop and C29 carrier repair — 2026-08-05

Fresh mutually blind review of exact merged C28 commit
`e60473b41159d639bb35ac926564ae49b64f9f51` returned two `NOT READY`
verdicts before performance. No paired or absolute process ran. C29 now makes
the sessions client obtain and durably bind the current authority descriptor
and principal before range assignment, while the transport independently
injects the descriptor on the range route. It also makes Host tombstone
`counter` required-nullable in the generated schema, validates the suppression
terminal/acknowledgement projections before Host retention decisions, and
proves the pending writer rolls back staged application and journal writes on
a retained-identity refusal.

The focused carrier proof is green, but this record does not activate the
manifest or advertise coverage. Fresh exact review, one-shot fixed-Air
performance, named-author acceptance, and publication binding remain open.

## C29 review stop and C30 carrier repair — 2026-08-05

Exact clean C29 commit `3f5c587fbe58533a6d471b0e13f238e6baabf774`
received independent Codex and Fable `NOT READY` verdicts before performance.
C30 closes their carrier findings: Host closure globally validates ordinary
suppression, pending lifecycle, and terminal-supplement SQL/JSON projections;
automatic sessions resolve descriptor/principal custody before ACK selection;
public foreign and absent keys share one metadata-free
`authorization-unprovable` disposition; and direct Host terminal plus pending
writer negatives distinguish staged caller writes from forbidden lifecycle
writes and prove rollback clears app/journal state without losing the retained
tombstone. The required-nullable counter is also required by Rust decoding,
not only the generated schema.

The capability remains `Missing`. Fresh exact review, fixed-Air performance,
named-author acceptance, and publication binding remain open.

## C30 review stop and C31 carrier repair — 2026-08-05

Exact merged C30 commit `365a3f21117cbaecdf80b8e5bff7debea47fc2d0`
received Fable `READY` and Codex `NOT READY` before performance. C31 closes the
blocking projection gaps by globally validating Host leases and pending
lifecycles before closure or capacity decisions, and it proactively applies
the same global suppression comparison to client closure. Moved
lease/pending/suppression projections have direct fail-closed fixtures.

The Spec remains `Draft` and the capability remains `Missing`. Fresh exact
review, fixed-Air performance, named-author acceptance, and publication
binding remain open.

## C31/C32 pre-result abandonment and C33 merge — 2026-08-05

Exact clean C31 commit `58ec598c38b3f8077682266727dbe3e0dc574b1d`
was abandoned before either fresh review returned after the mandatory fetch
found newer `origin/main` at `2bb84423b59e81e4afa865339765142ad2769bc2`.
No C31 review or performance artifact was accepted. Merge commit
`1eaa30b7f4e810476c556c3c4206b3deb6597849` preserves the global lease,
pending-lifecycle, and suppression checks and regenerates the combined
AppDescriptor/artifact closure. C32 was then abandoned before a qualifying
dual review completed and before performance when the required remote-tip
check found newer main. Normal merge commits
`cc5d6bce64550210d7b55b929841a8f9af8f2f68` and
`211f85714cdac7abdf4022b77cb08bce4419a35c` preserve those repairs and
regenerate the combined fork/AppBinding guide closure. C33 is the next
prospective exact candidate.

The Spec remains `Draft` and the capability remains `Missing`. Fresh exact
review, fixed-Air performance, named-author acceptance, and publication
binding remain open.

## C33 dual-READY landing chain — 2026-08-06

Exact clean C33 commit `60637db377a681ff1f22cbe19f7b49b96b20ab9f`
and implementation digest
`sha256:40789d24edf34b3a9cb9544e94e47337d5beb35ef065d290e19bcc67e610010d`
received independent fresh Codex-family and Fable-family `READY` verdicts.
The mandatory post-review fetch then found newer `origin/main` at
`d4ac75595d85e532d9938ea56b8cee03f929eaf4`. Per the author ruling above,
normal merge commit `d56721ca5a` and its successors retain C33's reviewed
carrier, custody, writer, and fail-closed projection work while adding the
fork asset-recovery, LLP 0158 acceptance/lifecycle evidence, and
anonymous-public client/demo changes. The interim C34/C35 labels are rescinded
and do not name qualification cuts. The merged tree lands after proportional
verification; fixed-Air row 13 then runs against the landed commit. The Spec
remains `Draft` and the capability remains `Missing` until that result and
every other named gate pass.

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
- the target/app-effective inventory names 23 physical writer families with
  no grouped specialized row. Exactly four ordinary/host adapters are
  envelope-mapped; every other row carries a stable executable exclusion
  reason.

The production storage activation cut is implemented but uninvoked. It checks
the closed inventory and publishes exactly the four authenticated adapters;
after arming, schema, migration, reset/seed, standalone membership,
projection-rebuild, and strict-promotion writers refuse generated authority
instead of silently escaping the manifest. Non-envelope-mapped app-effective
lanes remain publication blockers; capabilities stay `Missing`.

Still required before this ticket closes:

- independent review and author acceptance of the pending→terminal migration
  lifecycle amendment, plus its remaining asymmetric-retention and
  active-lane performance gates, before any migration coverage claim;
- the remainder of per-fact current-policy evaluation for public explanation:
  aggregate/non-row, hand-written/opaque, predicate, membership,
  effect-bearing, and other unsupported shapes stay fail-closed; exact
  generated owner create/update are the only current positive profiles, while
  generated delete remains a normative current-row-absent refusal;
- finish the remaining migration and cross-lane asymmetric-retention corpus,
  then invoke the already-closed local target activation cut only through the
  accepted publication step (the four ordinary/host adapters' crash/reopen,
  SQLite bypass, exact retry, and asymmetric identity corpus is green); and
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
  never terminalizes an outcome-unknown horizon response. Result-expired first
  becomes a durable fourth `result-gone` state across memory, IndexedDB, and
  file stores, retaining outcome and receipt digest; equal retry is idempotent
  and divergent terminal custody refuses. It leaves the transport-pending
  set, stops ordered replay, blocks successors until explicit discard, and is
  projected separately by `outboxStatus` and the React outbox binding. A
  recreated file-backed client restores it without redelivery. Focused full
  outbox corpus is green.
- A server-issued Host child passes through the production HostPlan writer:
  exact retry survives full one-entry custody, a novel child refuses before
  writing, client operator purge preserves the Host suppression result, and
  exact settled retry survives authority rotation while delayed first delivery
  under the retired epoch refuses before dispatch.

This is additional Partial evidence only. Production coverage remains dormant;
the complete migration/cross-lane asymmetric-retention proof, recreated-branch
end-to-end lifecycle corpus, fixed-Air active/idle/retention performance
artifact, independent review, and author acceptance remain required. LLP 0163
remains Draft and all related capabilities remain `Missing`.

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

## Writer-inventory and activation-tail evidence — 2026-08-04

- `LocalWriterLaneV1::ALL` is a closed 23-row manifest. Assets, auth, admin,
  jobs/cron, push, search, vector, operation-ledger, checkpoint/history,
  branch-registry, projection, migration, seed/reset, membership, and strict
  promotion are individually named; there is no grouped specialized row.
- Every row is exactly envelope-mapped or has a stable exclusion reason.
  Target support and app-effectiveness remain independent fields, and
  `allAppEffectiveWritersCovered` remains false while any app-effective
  exclusion exists.
- The four ordinary/host adapters are the only envelope-mapped rows. The
  production storage publication cut refuses a non-closed inventory and an
  inexact lane/writer set before commit, then arms the same SQLite authorizer
  used by reopen.
- Once armed, schema activation, migration, reset/seed, standalone seed,
  standalone membership, projection rebuild, and strict promotion cannot
  acquire generated write authority. Raw, cached, trigger-mediated,
  system-field, and DDL fallbacks remain denied. System-only writers do not
  originate application-table DML; derived projection maintenance stays in
  its parent transaction.
- Focused corpus covers exact four-writer publication, every app-writer
  exclusion, target-vs-app-effective projection, ordinary/host lane
  asymmetry, both physical adapters' crash/reopen cuts, exact retries,
  retention-full rollback, compact result expiry, epoch-floor refusal, and
  operator-purge partitioning.

This closes the grouped-inventory defect and makes activation production
callable, but does not invoke publication. Migration/cross-lane retention,
fixed-Air performance, independent review, and author acceptance remain open;
LLP 0163 stays Draft and every related capability stays `Missing`.

## C28 identity-lifecycle correction — 2026-08-05

The public carrier remains implemented, but exact C27 was stopped before any
performance result after independent review found four defects beneath it.
C28 retains separate domain-separated full-identity and authorization-facts
digests in payload-free tombstones; validates suppression/tombstone SQL/JSON
coherence; advances floors only over the contiguous closed epoch prefix; and
caps a client epoch at four 256-counter ranges / 1,024 identities, aligned with
the client outbox and per-auth settlement limits. Exact response-loss
re-service remains available; the fifth range refuses atomically and requires a
fresh authenticated epoch. Capacity-stranded identity-null intent adopts that
fresh authority/range only after durable same-principal comparison; missing or
different principal custody leaves it pending and never cross-authority
submits it.

Both `record_operation_in` and `record_pending_operation_in` now run the shared
retained suppression/compact/tombstone/floor classifier inside their
publication transaction, before authentication, capacity, or insertion. This
prevents direct callers from republishing a reclaimed identity and makes any
refusal roll back staged app and journal writes. Focused C28 corpus covers the
diagnostic split, corruption, direct-writer rollback, out-of-order epoch
closure, bounded successor issuance, counter corruption, pending-writer
tombstone refusal, lost-response recovery, and same-principal fresh-authority
continuation. The C27
review does not qualify C28; fixed-Air performance and fresh independent review
remain mandatory, so this issue stays Open, LLP 0163 stays Draft, and every
related capability stays `Missing`.

## Explicit activation-transport evidence — 2026-08-04

- `POST /_snapback/api/storage/operation-coverage/activate` is registered as
  `SystemApi` / `AdminWrite` / admin-credential / operator metadata and has a
  dedicated authority-only invocation source behind managed admission.
- Rust-owned request and response schemas close the request to schema version
  1, target `local-dev-sqlite-ibex`, and profile
  `local-envelope-mapped-writers.v1`. The response returns the exact persisted
  coverage manifest rather than inferring coverage from target naming.
- Handler-time admin reauthorization plus fenced publication ensures an
  unauthenticated, stale/revoked, wrong-target, wrong-profile, wrong-version,
  or unknown-field request cannot arm coverage. The storage chokepoint still
  rechecks the complete inventory and exact two-lane/four-writer cut.
- Production-profile HTTP corpus proves refusal leaves coverage inactive,
  exact activation returns the closed manifest, and an identical retry is
  idempotent. The existing armed-exclusion corpus remains green.

The command is never called by open, range issuance, or capability inspection,
and this ticket does not request that an operator invoke it. Complete-target
coverage, fixed-Air active-path performance, remaining applicable corpus,
independent review, and named-author acceptance remain publication gates. LLP
0163 stays Draft and every related capability stays `Missing`.
