# LLP 0166: The local persistent store

**Type:** Spec
**Status:** Implemented
**Systems:** Client SDK, Client integration, Local sync, Offline sync, Storage,
Live queries, Relational queries, Optimistic updates, Auth, Testing
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-08-03
**Revised:** 2026-08-06 (LLP 0043 sessions-custody reconciliation: authority
transitions preserve the resolved store's outbox only for the ratified
per-record strand/privacy-delete matrix; the client-wide file-carrier cut
still sweeps sibling identity blobs); 2026-08-06 (author ruling: public-package advertisement
amendment — `single_table_v1` may be advertised by clean-release
public-package builds under LLP 0110's dated conjunction including the
packaged-closure qualification receipt; see dated section.) 2026-08-06,
Move-1 closure (the qualified Fleet 8/8 successor
witness is retained, the refreshed carrier exit is 17 PASS / 0 GAP / 0
skipped, and the local publication predicate now consumes that closed row;
Experimental maturity and all remote/hosted nonclaims remain
unchanged; the public-package nonclaim is superseded by the dated
advertisement amendment above); 2026-08-06 (Fleet blocker update: the reviewed
`snapshot-batch.v2` registration landed as LLP 0157 v0.11; the carrier row
remains GAP pending implementation, frozen cross-language vectors, and a
fresh Fleet witness — LLP 0157 §D1's gate list is canonical.)
2026-08-05 (Fleet blocker reconciliation: LLP 0135 OQ5's product
direction is ruled in favor of narrow `snapshot-batch.v2`; the carrier row
remains GAP pending reviewed profile registration, implementation, and a fresh
Fleet witness.) 2026-08-05 (D1/DK-9 diagnostic-spelling reconciliation: the
successor RQS store's authoritative emitted code remains
`SNAPBACK_RQS_STORE_LOCK_UNAVAILABLE`; LLP 0008's generic CLIENT spelling is
the owner-level semantic alias and remains emitted only by the predecessor
localStorage adapter; no runtime rename or dual-emission.) 2026-08-04 (Move 2 Lane F publication reconciliation: the local
contributor-source target now advertises `single_table_v1@1`, bound by
`crates/snapback/src/local-persistent-store-publication.v1.json` to the dated 2026-08-04
carrier-exit receipt at 16 PASS / 1 Fleet GAP / 0 skipped and the dated
Triage Move-1 receipt at 8/8. The publication source carrier now pins the
three runtime modules that own the split behavior. The superseding 2026-08-04
bundle-attribution and frozen result-transform supplemental baseline are also
recorded below. Remote-service and Cloudflare targets continue to expose the
class only as a capability gap.) 2026-08-04 (Move 2 Lane D reconciliation: the implementation
program landed on 2026-08-03 and the §D7 gate fired on 2026-08-04; D1 now
records the shipped IndexedDB/file v3 formats, D9 names the current
bundle-attribution and result-transform metrology, OQ1 is implemented and
activation-gated on fresh retained evidence, and OQ7 is resolved by LLP 0051's
D5 extension. Its then-pending evidence state is superseded by the Lane F
publication note above; DK-9's diagnostic spelling reconciliation remains
owed.) 2026-08-04 (Move 2 Lane C implementation record: the §D7 gate
is fired for `snapback-result-transform` corpus format 1 at the pinned Rust
and JavaScript evaluator identities on browser IndexedDB and Node/file, with
memory and Expo refusing at the floor and the client-overlay legs green;
owner-issued `result-transform-snapshot-v1` authoring and invocation now
rotate plan identity and consume proof-verified result bytes. The
`single_table_v1@1` shipped adoption path was implemented while the first
controlled rerun was blocked by the execution sandbox's loopback-bind denial.
That historical boundary is superseded by the dated Lane F receipts above.) 2026-08-04 (Move 2 Lane B implementation record: OQ8's
programmatic-registration half is resolved by the public `registerQuery` /
`releaseQueryRegistration` client API and exact `RegisterOutcomeV1`; the
transform-authoring half remains open.) 2026-08-03 (v1.1 semantic amendment: Charlie accepted 2026-08-04 (D4 implementation/metrology note: a connectivity
failure with no authoritative retained answer now surfaces the typed
`SNAPBACK_QUERY_OFFLINE_UNAVAILABLE` refusal carrying D4's `unknown` answer
class and retention disposition. This deliberately evolves the shipped
Full/root bundle workload through an LLP 0063 prospective rollover of only
the affected profiles; prior receipts and unaffected ceilings remain
immutable.) 2026-08-04 (local contributor-source publication amendment;
LLP 0110 owns the exact carrier authority). 2026-08-03 (v1.1 semantic
amendment: Charlie accepted
`single_table_v1@1` and Arm A,
`rqs-authority-independent-snapshot-v1`; the QMK predicate, no-lease answer,
durable+`pinned` Channel-B mapping, connected prove-or-fresh atomic adoption,
and OQ1 resolution land here. No implementation or capability claim; adoption
remains a commissioned follow-on.) 2026-08-03 (v1.0, **Accepted** by Charlie Cheever's explicit
"flip to accept" direction after the dual-family loop converged
dual-READY at round 8. The §D7 amendment set is landed dated in the same
change: LLP 0008 DK-9, LLP 0080, LLP 0157 (both retention unions + the
payload-compaction event), and LLP 0155 §Move 2; dated boundary notes
landed in LLP 0043, LLP 0053, and LLP 0090. Acceptance is semantic only:
implementation and capability gates remain, and the implementation
program is a separate wave-3 commissioning.) 2026-08-03 (v0.9, loop conclusion: the dual-family
super-refine loop converged **dual-READY at round 8** — Codex READY at
0.97 confidence with one editorial NIT; Fable READY at 0.90, its second
consecutive READY, with one editorial NIT — over the unchanged v0.8
tree. Both NITs and both reviewers' editorial suggestions are applied:
the client's re-announce-on-hello obligation is now a normative rule (on
observing `WriterHelloV1`, a context re-announces each of its pairs'
full sets within the heartbeat interval), with the clause that a
reconciliation-reaped *pair* — unlike a reaped context — simply
re-announces and re-appears under the same `contextId`; "live pair" is
respelled "unreconciled pair" at the drift-prone sentence; and S1's
tombstone boundary is re-worded ordinally (the target plus 1,023 newer
tombstones still refuses; the 1,024th newer — 1,025th total — evicts
the target and exposes the documented residue). The document enters
**Review**; acceptance remains Charlie's under LLP 0130 SD-4's standing
rule and the commission's explicit reservation.) 2026-08-03 (v0.8, round-7 fixes: Fable round 7 returned
**READY** (0.87, two editorial NITs); Codex round 7 returned NOT READY
(2 MATERIAL, 1 NIT), catching a real pair-liveness hole the READY missed.
Applied all: handoff reconciliation gains **pair-level deadlines** — each
roster pair must re-announce within the 45-second expiry of
`WriterHelloV1` or is affirmatively reaped *as a pair*, even while its
context stays live through another pair's traffic (full-set announce
semantics make a pair's non-re-announcement an affirmative absence
signal), so suppression is genuinely bounded and one partition can never
hold the store's lifecycle hostage; ordinary (non-handoff) liveness
remains context-scoped, and the split is stated; the phantom "30-second
handoff window" is deleted from OQ4 with a parenthetical noting the
suppression bound is the heartbeat expiry, not an independent constant;
the overflow simile is restructured ("unlike the reaped-context window,
not self-healing"); the "same validation for both" sentence names the
release-of-unknown partition-only exception up front; S1 names the
release-before-first-forward and previously-consumed-forward schedules
separately, updates the partial-handoff leg to the pair-deadline reap
(pair A heartbeating while pair B stays silent), and adds the
129th-live-pair ceiling leg.) 2026-08-03 (v0.7, round-6 fixes: Codex round 6 returned
NOT READY (4 MATERIAL); the Fable round-6 run was interrupted before
producing a review and none is recorded. Applied all four: the overflow
analysis is corrected — the release-before-first-forward residue depends
only on the released-registration tombstone window (the two-memory
condition applies only to replay of a previously consumed forward), with
S1's phrasing fixed and exact 1,024/1,025 boundary legs added;
tombstones are keyed `(partition, registrationId)`, created only
atomically with a successful `released` outcome (refused releases leave
none), and release-of-unknown validates the caller's partition only —
cross-partition forwards are unaffected, so no partition can preempt
another's ids; the unsafe 30-second handoff exit is removed —
suppression ends only when every roster pair re-announces or is
affirmatively liveness-reaped, bounding suppression by the 45-second
heartbeat expiry, with the S1 timeout branch added; and pair accounting
closes (128 live-pair ceiling; `livePairCount`/`livePairCeiling`,
`identifierByteCeiling`, and `messageByteCeiling` surface in
inspection).) 2026-08-03 (v0.6, round-5 fixes: Codex round 5 returned
NOT READY (1 BLOCKING, 3 MATERIAL, 1 NIT); Fable round 5 returned
NOT READY (3 MATERIAL, 2 NIT); the findings converged almost exactly.
Applied all: the durable forward/release ordering is closed — every
release outcome (including release-of-unknown) records a bounded
**released-registration tombstone** (1,024, provisional) that refuses
any later forward naming the id, `requestId` uniqueness is scoped per
`contextId` with the consumed-request memory keyed on the pair,
`RegisterOutcomeV1` is context-bound, forwards and releases carry and
match the current `writerGeneration` (stale durable mutations refuse and
re-sync), and the two-memory overflow analysis is stated with the same
honesty as the reaped-context window (the residual requires both
memories overflowed, is inspection-visible, and is recoverable by
release); the persisted roster is keyed by `(contextId, partition)`
pairs so handoff reconciliation is partition-complete and decidable; the
`in` container is named as the sole permitted array operand with
per-element scalar validation; broker byte accounting is total
(64-byte identifier ceilings, a 256 KiB message ceiling) and the
inspection record gains the missing broker memory counts/ceilings, the
per-registration byte ceiling, and a `constants` object carrying the
cadence values, making the constants-surface claim true; the stale
"refuses the entry" clause is corrected to whole-message refusal; the
retaining-reason precedence is pinned (registrations > release-grace >
safety-blocker > instance-bookkeeping, with the `"none"`-pinned
transient reporting an elapsed-deadline grace); S1 gains the
release-before-first-forward, memory-boundary, requestId-scope,
partial-multi-partition-handoff, and malformed-announce legs and S6 the
`in`-element leg.) 2026-08-03 (v0.5, round-4 fixes: Codex round 4 returned
NOT READY (3 BLOCKING, 4 MATERIAL); Fable round 4 returned NOT READY
(2 MATERIAL, 4 NIT) and judged the document at the READY bar once the
spot repairs land. Applied all: the broker's durable lifecycle is closed
— `RegisterReleaseV1` gains partition binding, registration commits are
validated against the address's authority state (barrier-blocked
partitions refuse; the materialization-fence language is corrected to
what registration commits actually touch), a bounded reaped-context
memory (256) and consumed-request-outcome memory (1,024) persist across
writer restart so delayed announces and forwards cannot resurrect
reaped contexts or released registrations, `registrationId`s are
never-reused with fresh-forward refusal, refusal granularity is
message-level everywhere, a 64-live-context ceiling lands, and announced
subscription demands must carry the envelope's own `contextId`; the
transform's comparison families are bound explicitly (canonical-value
equality for `eq`/`ne`/`in`; the step-4 total comparator for range
filters and ordering; non-scalar values refuse execution; absent fields
read as null) and S6's "mixed-type refuse" parenthetical is corrected to
the type-rank rule; §D6 gains the pending-intent precondition —
convergence step 1 begins only when no pending outbox intent depends on
the predecessor (LLP 0053's retirement makes dependent queue custody
discard-only, so convergence waits for settlement or explicit discard —
with an S5 leg) and is initiated only under a connected attempt; the
retaining-reason law is unified — §D5's closed `retainingReason` union
(now including `safety-blocker` and the new `instance-bookkeeping` stub
reason) is the single source of truth cited by §D2, §Vocabulary, and
Guardrail 1, and S1's equality carves out blocker-held records;
blocker-custody precedence is explicit (it resists discretionary
compaction/GC only; LLP 0053 delete/retirement destroy regardless);
discharge-time reclamation is pinned to the next maintenance pass in
§D3/S3; the pressure order excludes `pinned`-graced records from step 1;
the carried LLP 0157 amendment additionally registers the
payload-compaction event in §D3's closed vocabulary (heldProofs/manifest
clearing is now owner-authorized); the 16 KiB registration ceiling gets
its JCS byte formula and the broker memories get ceilings surfaced in
inspection; the policy record renames `materializationKey` to the
family-neutral `addressKey` and adds `effectiveRetentionRequest`;
`writerGeneration` is preserved at `wipe` with the other monotone
counters.) 2026-08-03 (v0.4, round-3 fixes: Codex round 3 returned
NOT READY (5 BLOCKING, 3 MATERIAL); Fable round 3 returned NOT READY
(4 MATERIAL, 5 NIT) and independently audited every Codex round-2 finding
as resolved. Applied all: the amendment set gains a **fourth carried
text — a dated LLP 0155 §Move 2 note** — so the result-transform
narrowing of the commissioned local-query-execution outcome is an
explicit owner revision (deferring source-row plan evaluation behind
LLP 0155 OQ2's gate), with the LLP 0157 amendment aligned to read its
§D7 gate on the revised profile, and the retention class renamed
`result-transform-snapshot-v1` so it no longer implies source-plan
evaluation; `TransformPlanV1` is now total (closed `basic-v1` filter
grammar, per-field order direction, a total scalar comparator with type
ranking, integer limit domain, row-sequence-only inputs) and **overlay
application is excluded from the dual-runtime parity oracle** — shipped
optimistic layers are arbitrary client callbacks, so the corpus covers
pure transforms and overlay composition is verified by client-only
oracles; the broker gains never-reused CSPRNG context identities,
`(contextId, partition)`-scoped full-set announces (multi-grant
contexts expressible), an explicit `RegisterReleaseV1`/outcome pair,
partition-bound forwards, an announce source restriction, heartbeat
closure edges, a persisted context roster making handoff reconciliation
decidable, and closed-set refusals on every message; release grace now
pins **both** policy axes (the merge immediately before the final
release — S3's pin case corrected to `default` accordingly, with a
final-set-`pinned` case added) so §D3's condition 3 reads
grace-pinned-durable and grace is never vacuous; blocker-held custody
is modeled explicitly (a `safety-blocker` retaining reason, discharge
transition, inspection row); §D6's convergence step 1 is re-expressed
as beginning the predecessor's LLP 0053 terminal retirement — an
existing owner transition, replacing the unownable `migration-closed`
disposition; §D1's `wipe` names its exact `storeMeta` projection
(registrations/policy/roster cleared; allocator and barrier high-waters
preserved); §D3's persistence conditions are scoped to `qmk1` payload
with the legacy LLP 0090 predicate stated separately; durable
registrations gain a 16 KiB per-record byte ceiling; the truncated
Fable round-2 artifact body was restored verbatim with a dated
provenance-correction note (landed separately at 46127881); compacted
stubs clear `heldProofs` with their payload; grace clocks anchored at
suppression end; `TransformHashV1` consumers named; S1/S3/S5/S6 gain
the corresponding legs.) 2026-08-03 (v0.3, round-2 fixes: Codex round 2 returned
NOT READY (6 BLOCKING, 4 MATERIAL — the new machinery's exactness and two
publication-order security defects); Fable round 2 returned NOT READY
(3 MATERIAL, 6 NIT) with a full round-1 resolution audit. Every finding
applied: §D7 now defines the closed `TransformPlanV1` record with a fixed
pipeline (base assembly → overlay → filter → order → limit), projected-
field-only ordering, and a dual-runtime reference implementation of the
transform itself as the parity target (never the plan's source-row
pipeline), plus the overlay-gating boundary and its reclassification cost;
an effective `retentionRequest: "durable"` is now a necessary persistence
condition with a defined downgrade transition; the demand broker gained a
closed message protocol (full-set announces, monotonic revisions,
heartbeat liveness, authority binding, writer obligations, full handoff
suppression) and per-carrier qualification with the file carrier's
no-cross-process-channel degradation stated; eviction is redefined as
payload compaction — the identity, `QueryAuthorizationState`, and
registration bookkeeping survive per LLP 0053's compaction-survival rule,
and a compacted stub rehydrates at the same instance; the budgets are
partitioned per section (the legacy envelope keeps the shipped constants,
comparator, and no cross-section competition — nothing about Channel B
changes), with total accounting (proofs counted once, exclusions bounded,
a durable-registration cap, and the 256 KiB outbox record cap recorded);
lease-family convergence now closes the predecessor fence durably before
the successor publishes, with crash cuts; `wipe` is scoped to the resident
sections with the lease artifact as an LLP 0059 barrier participant, and
unparseable-store reset is defined as store-identity rotation; the answer
vocabulary gains `lease-authorized-retained` (row 14) and rows 11/15
derive `unknown`; the sync-set rule, Guardrail 1, and S1 are scoped to
governed families with grandfathered legacy entries carrying a nameable
retaining reason; the grace lattice pins its evaluation set and `pinned`'s
post-release meaning; `StorePolicyInspectionV1` is defined (additive
beside LLP 0157 §D6, partition-bound, redacted); source × ownerContext
pairing is validity-checked; the LLP 0157 amendment gains the
manifest-emission clause; operation terms are disambiguated in
§Vocabulary.) 2026-08-03 (v0.2, round-1 fixes: the dual-family round 1
returned NOT READY twice (Codex: 9 BLOCKING, 3 MATERIAL; Fable:
7 MATERIAL, 4 NIT — artifacts under `llp/reviews/`). Applied: the carried
LLP 0157 classification amendment; the `result-transform.v1` direction;
`QueryRegistrationV1` closed; the multi-tab demand broker; §D5 demand/
owner axes; the §D4 answer table; legacy grandfathering; fresh-sync lease
convergence; canonical budget formulas; scoped `wipe`; P8 split; P9
partial; outbox caps re-cited; 0157 §Migration reconciled; OQ1's
anonymous-retention precondition.) 2026-08-03 (v0.1, initial draft — the
Move-2 owning Spec commissioned by Accepted LLP 0155 and the wave-3
Track A program (`issues/20260803-0155-move2-spec-commission.md`, ruled
spec-first). Consumes Accepted LLP 0157's identity stack, completeness
witness, and §D7 store interface; carries the LLP 0008 DK-9 and LLP 0080
amendment texts; answers LLP 0155 OQ5 and LLP 0161 OQ5.)
**Related:** LLP 0000, LLP 0004, LLP 0007, LLP 0008, LLP 0012, LLP 0034,
LLP 0039, LLP 0043, LLP 0048, LLP 0051, LLP 0053, LLP 0055, LLP 0059,
LLP 0080, LLP 0081, LLP 0088, LLP 0090, LLP 0091, LLP 0093, LLP 0094,
LLP 0095, LLP 0097, LLP 0107, LLP 0110, LLP 0112, LLP 0114, LLP 0126,
LLP 0129, LLP 0130, LLP 0131, LLP 0133, LLP 0134, LLP 0135, LLP 0145,
LLP 0147, LLP 0155, LLP 0157, LLP 0158, LLP 0161, LLP 0162, LLP 0163,
LLP 0164, LLP 0165

## Summary

LLP 0155 Move 2 commissions one owning Spec for first-class query-scoped
local materialization. Accepted LLP 0157 supplied the semantic substrate:
plan identity (`PlanHashV1`, `QueryMaterializationKeyV1`), the completeness
witness (`CompletenessStatusV1`/`CompletenessProofV1`), and the §D7 store
interface (materialization records, fenced atomic operations, observation,
storage profiles). This Spec adds no second identity, witness, or interface;
it owns the **store as a product** — everything that turns those records into
the ordinary client read substrate:

1. **One store domain** (§D1) — the physical composition answering LLP 0155
   OQ5: the shipped client store family evolves in place; materializations,
   page sets, memberships, legacy resume entries, and the LLP 0043 outbox
   share one versioned, single-writer, atomic transaction domain.
2. **The sync specification** (§D2) — registered and preloaded queries *are*
   the replica definition. There is no separate replica schema, table list,
   or sync manifest; the store hydrates, syncs, and retains exactly the
   registration set, through a closed registration record and a closed
   multi-context demand protocol.
3. **Retention keyed by plan identity** (§D3) — what persists, under which
   owner-issued retention authority, with explicit address families,
   partitioned budget envelopes, and total accounting.
4. **Completeness-honest local answers** (§D4) — a query answers locally
   with authority only when its witness and capability class prove it;
   everything else is honestly `unknown` or `refused`, per family, per the
   closed answer table.
5. **Query lifecycle, TTL, and eviction** (§D5) — demand states orthogonal
   to owner state, release grace, payload compaction that preserves every
   LLP 0053 survival obligation, and the store-policy inspection record.
6. **The resume/delta relationship to shipped RQS** (§D6) — the LLP 0090
   machinery is consumed unchanged as the sync engine; this store is the
   declared successor of its Channel-B persistence, with a
   close-predecessor-first convergence protocol for the lease family.
7. **The gated evaluation profile** (§D7) — the closed `TransformPlanV1`
   contract, plus the exact LLP 0008 DK-9, LLP 0080, LLP 0157, and
   LLP 0155 amendment texts this Spec carries; evaluation stays refused
   until the amendments land and the conformance corpus passes.
8. **The agent-safe seam** (§D8) — the LLP 0161 OQ5 answer: which of the
   agent-ideal properties P1–P9 the client store needs natively, which it
   consumes as server-issued artifacts, and which it never takes; no
   LLP 0162-family sequencing is pulled forward.

## Scope and authority

This Spec owns the eight items above. It does **not** own:

- **Identity, witness, and interface semantics.** `NodePlanHashV1` →
  `PlanHashV1` → `QueryMaterializationKeyV1` → contextual addresses, the
  completeness status/proof, the §D3 product state, and the §D7 operation
  contract are LLP 0157's. This Spec consumes them byte-for-byte — with
  exactly one carried, dated widening of its two closed retention unions
  (§D7), landing in LLP 0157 itself — and mints no parallel identity or
  state. `StorePolicyInspectionV1` (§D5) is additive store-policy
  inspection beside LLP 0157 §D6's projections, never a change to them.
- **Carrier custody, leases, and the outbox.** LLP 0043 owns retained-entry
  custody rules, the `AuthorizedLease` machinery, the durable
  pending-mutation outbox, settlement publication, and acknowledgement GC.
  This Spec composes those records into one transaction domain; it changes
  none of their lifecycles.
- **Authorization invalidation.** LLP 0053 owns witnesses, dispositions,
  fences, tombstones, obligations, terminal retirement, and the LLP 0059
  barrier. Every destructive transition in this store is an LLP 0053
  operation, never a parallel mechanism.
- **Resume admission and token identity.** LLP 0090 owns the replay
  admission ladder, token/digest identity, arbitration, and the Channel
  model — including the legacy population's exact lifecycle and budget
  envelope, which this Spec grandfathers untouched (§D3/§D5). LLP 0091
  owns the digest/token byte formats.
- **The client-store carrier decision.** LLP 0008 DK-9 owns the
  store-agnostic interface mandate and its durable-state rules. This Spec
  stays inside DK-9's envelope except where the carried amendment (§D7)
  explicitly widens the *semantic* contract.
- **Retention classes.** LLP 0080 owns `opaque-authorized-snapshot-v1` and
  the closed retention set; §D7 carries its commissioned extension.
- **Settlement semantics and optimistic layers.** LLP 0133 and the
  LLP 0107/0114 seam own payload semantics; this store owns their durable
  composition only, exactly as LLP 0157 §D7 already records.
- **Wire shapes.** Any new frame or envelope is a dated LLP 0093/0094
  amendment; conformance is LLP 0012/0095's.
- **Agent-safe host primitives.** Commit envelopes, forks/promotion, and
  proof domains/checkpoints are LLP 0163/0164/0165's; §D8 classifies the
  seam and duplicates none of their contracts.

Acceptance path: commissioned by an Accepted RFC; LLP 0130 SD-4's standing
rule applies if the dual-family loop converges READY within this
commission's scope; the author decides otherwise. Acceptance additionally
lands the four dated amendments §D7 carries in their owning documents
(LLP 0008 DK-9, LLP 0080, LLP 0157, LLP 0155) and dated boundary notes in
LLP 0043, LLP 0053, and LLP 0090 for the successor-store, address-family,
and convergence-order seams. Acceptance is semantic only: no implementation or
capability fact is promoted by this document's status.

## Vocabulary

- **Materialization.** LLP 0157's unit: one `MaterializationRecordV1` at one
  `ClientMaterializationAddressV1` and current `query_instance_id`.
- **Registration.** A client-side declaration, with its own identity and
  owner context, that one generated query reference plus canonical args
  belongs to the sync set (§D2). The registration, not the row, is the unit
  of intent.
- **Demand state.** The registration-derived axis of a materialization:
  `demanded-active`, `demanded-idle`, or `undemanded` (§D5). Orthogonal to
  — and always subordinate to — the owner state.
- **Owner state.** LLP 0157 §D3's product state (lifecycle, disposition,
  freshness, attempt, held proofs) plus the LLP 0053 authorization state it
  projects.
- **Sync set.** The union of current registrations over the governed
  families. The store hydrates, syncs, and retains exactly this set — the
  sync set *is* the replica definition. Custody outside it exists only
  under §D5's closed `retainingReason` union: released records inside
  their grace, blocker-held payload (`safety-blocker`), compacted stubs
  held for owner bookkeeping (`instance-bookkeeping`), and grandfathered
  legacy entries under LLP 0090's own lifecycle.
- **Governed families.** The address families this Spec's demand/grace/
  eviction model governs: `qmk1` materializations and — for demand and
  hydration only, never for retention lifecycle — legacy resume
  registrations. Grandfathered legacy *entries* and the legacy lease
  family are not governed (§D3/§D5).
- **Hydration.** Establishing a registered materialization's requested scope
  from the server (LLP 0157 §D7 `beginEstablishment`/`commitPage`).
- **Answer classes.** The closed set §D4's table assigns:
  `authoritative` (an LLP 0157-witnessed complete answer via
  `readRenderable`), `lease-authorized-retained` (an LLP 0043 M1 retained
  read under its own witness/lease basis, with no LLP 0157 completeness
  claim), `labeled-retained` (legacy digest-verified retained *data*,
  honestly labeled, no witness), `unknown`, and `refused`.
- **Operation terms, disambiguated.** *Payload compaction (eviction)* —
  §D5's custody reclamation, preserving identity/authority/registration
  state. *Registration release* — a registration leaving the sync set
  (§D2). *Authorization deletion / quarantine* — LLP 0053 dispositions.
  *Terminal retirement* — LLP 0053's instance end. *Store reset (`wipe`)*
  — §D1's identity-barrier tool. None of these is a synonym for another.
- **Address family.** One of the three coexisting keying regimes for
  retained client state (§D3): `qmk1` materializations (LLP 0157-admitted),
  legacy resume entries (`rqsEntryKey`), and legacy lease records
  (`retainedQueryKey`, the Contract arm's separate artifact).
- **Release grace.** The bounded custody window an `undemanded`
  materialization survives background GC (§D5). Grace never protects
  against budget-pressure compaction and never extends authority.
- **Channel B store.** The shipped RQS persisted resume store
  (`snapback-rqs-store.v1` and its file/memory/Expo carriers) this Spec
  succeeds (§D6).

## D1 — One store domain

### The physical answer (LLP 0155 OQ5)

LLP 0155 OQ5 asked which physical browser store owns atomic fragments,
memberships, optimistic layers, outbox, and settlements: the existing RQS
IndexedDB schema, a new shared store version, or SQLite/WASM. The answer is
the middle option, executed as an in-place evolution of the shipped store
family:

- **Browser:** the existing IndexedDB database `snapback-rqs-store.v1` now
  ships `DATABASE_VERSION = 3`, migrated in place from the v2 predecessor
  rather than creating a parallel database. The v3
  object stores: `materializations`, `pageSets`, `memberships`, and
  `storeMeta`, beside the existing `entries` (legacy resume) and `outbox`
  stores. IndexedDB transactions span object stores within one database, so
  the fenced atomic operations LLP 0157 §D7 requires — and their
  composition with outbox writes — commit in one transaction.
- **File (Node, and Expo/native via the registered files adapter):** the
  shipped blob format is `snapback-rqs-store-file.v3`, migrated from its v2
  predecessor with the same added sections; the whole-blob atomic replace
  already provides the single transaction domain.
- **Memory:** the volatile carrier mirrors the same sections with
  `durable: false`, unchanged honesty rules.
- **SQLite** remains permitted behind LLP 0008 DK-9's store-agnostic seam
  (the file carrier's own comment records that SQLite could swap in behind
  the same adapter without observable change) and required nowhere.
  Semantics precede engine choice; this Spec's contract must hold
  identically on every carrier.

A parallel second database is rejected because the load-bearing atomicity
obligations — settlement publication before result exposure (LLP 0043),
wipe clearing retained state and outbox in one transaction, fenced
compare-and-commit across fragments and product state (LLP 0157 §D7) —
cannot span IndexedDB databases, and because the shipped budget, lock, and
GC machinery already operate on this domain.

### Domain composition

One store domain exists per `clientStoreId` (LLP 0053's store/namespace
axis). It contains:

| Section | Contents | Payload owner |
| --- | --- | --- |
| `materializations` | `MaterializationRecordV1` per address (fragments, proofs, product state, subscription state, references) | LLP 0157 §D7 |
| `pageSets` | ordered page-set manifests | LLP 0157 §D3 |
| `memberships` | row-occurrence membership records | LLP 0157 §D7 |
| `entries` (legacy) | Channel B resume entries `{rows, meta, token, …}` | LLP 0090 |
| `outbox` | durable pending-mutation queue, settlement + acknowledgement ledger, React binding receipt | LLP 0043 |
| `storeMeta` | `query_instance_id` allocator high-water, generation counters, the LLP 0157 §D6 handle key, durable (`programmatic`) registrations, budget/eviction facts, store format version | this Spec / LLP 0053 (allocator) |

The LLP 0043 Contract-arm lease store (`retainedQueryKey`-keyed retained
records plus `AuthorizedLease` custody) is **deliberately not absorbed in
v1**: LLP 0090's step-5 amendment requires it to remain a separate,
untouched artifact, and its records converge on `qmk1` addresses only
under §D6's close-predecessor-first convergence protocol. This Spec
declares the one-domain target and stages that merge behind those rules
and LLP 0155 OQ16.

### Writer discipline and format versioning

- **Single writer, consumed unchanged:** the browser carrier's long-held Web
  Locks exclusive lock (non-holders read and adopt, never write); the file
  carrier's exclusively created lock file with liveness-verdict staleness.
  Independently constructed same-origin clients serialize per LLP 0008
  DK-9's rule, failing closed with the lock-unavailable diagnostic.
  **Reconciled 2026-08-05:** the successor store's authoritative emitted code
  remains `SNAPBACK_RQS_STORE_LOCK_UNAVAILABLE`; DK-9's generic
  `SNAPBACK_CLIENT_STORE_LOCK_UNAVAILABLE` envelope text is the owner-level
  semantic alias and remains emitted only by the predecessor localStorage
  adapter. This is documentation reconciliation, not a runtime rename or
  dual-emission. Non-writer *demand* is brokered through the writer (§D2);
  non-writer contexts never write store bytes.
- **Format versioning:** every store format change is a numbered, one-way,
  crash-safe migration. A migration preserves pending intent, unresolved
  acknowledgements, durable registrations, and in-grace release clocks or
  refuses to run (LLP 0155's migration guardrail; LLP 0043's custody
  rules). Corrupt, future, or legacy bytes are typed invalid-state
  diagnostics preserved in place — never an empty-success parse fallback
  (DK-9); only an explicit `wipe` or the unparseable-reset path below
  replaces them.
- **Version-skew fail-closed:** an older client opening a newer store fails
  closed (the shipped v1-code-on-v2-database VersionError posture),
  reporting a stable diagnostic rather than downgrading the store.

### `wipe` — exact scope

`wipe` is the identity barrier's tool and the caller-authorized reset tool;
it is not compaction and not a general cleanup:

- **When:** a full-store `wipe` runs only for (a) a caller-authorized
  explicit reset, or (b) an owner-required **client-wide** transition —
  LLP 0039 session transitions under LLP 0053's client-wide `delete`.
  Grant-scoped transitions (LLP 0055 multi-grant agent clients) and
  query-scoped dispositions never full-wipe: they run LLP 0053's scoped
  quarantine/delete over exactly the affected authority-partition
  addresses, registrations, and — per LLP 0053's suspension/strand rules —
  the affected outbox scopes (stranded queued work stays visible,
  explicitly discardable, never replayable; unrelated grants' custody and
  acknowledgements are untouched).
- **What it clears, atomically:** the **resident** sections —
  `materializations`, `pageSets`, `memberships`, `entries`, and the
  `outbox` (for a caller-authorized explicit reset; see the authority-transition
  exception below) — plus, within `storeMeta`, exactly the durable
  (`programmatic`) registrations, the policy/budget facts, and the broker
  context roster, in one transaction. **Reconciled 2026-08-06:** at an
  authority transition, the resolved store's outbox bytes are now governed by
  LLP 0043 §Auth posture, “JS-arm sessions-custody queue,” and its ratified
  per-record custody matrix: a same-principal instance change strands
  rerecordable work, while a principal change privacy-deletes predecessor
  records before successor observation. This consumes unchanged the same
  subsection's LLP 0166 interaction boundary (“the store Spec consumes this
  RFC's custody, outbox, and settlement contracts unchanged”); a client-wide
  file-carrier transition still sweeps sibling identity blobs. Another identity
  must never replay this one's queued mutations or re-hydrate its
  registrations. The legacy
  lease artifact is **outside** this transaction domain: it is cleared by its own owner as a registered
  participant in the same LLP 0059 `AuthCoordinator` barrier (LLP 0053's
  store-wide barrier already names the LLP 0039/0053 stores as
  participants); the barrier's publication gate, not a cross-artifact
  transaction, is what makes the identity transition safe.
- **What survives:** the `query_instance_id` allocator high-water (LLP 0053
  requires never-reuse across recreation), the fence/tombstone/barrier
  high-waters LLP 0053's delete rules preserve, the monotone
  `writerGeneration` counter, and the store format version.
- **What rotates:** the LLP 0157 §D6 local-row-handle HMAC key is destroyed
  and re-minted — a predecessor identity's handles must not remain
  comparable across the barrier.
- **Unparseable-store reset:** the survivals above assume the store's
  `storeMeta` is readable. When the whole store is corrupt/unparseable
  (the file carrier's preserved-bytes posture), the high-waters cannot be
  recovered from it; the destructive reset therefore **rotates the store
  identity** — a fresh `clientStoreId`, a fresh allocator, a fresh handle
  key — and destroys the old bytes with the old namespace. LLP 0053's
  never-reuse holds by namespace rotation (its allocator scope is
  per-`client_store_id`); no state from the unreadable predecessor is ever
  interpreted, and the rotation rides the same LLP 0059 barrier as a
  client-wide transition.

## D2 — The sync specification: registered queries

### The rule

**The sync set is the registration set.** There is no separate replica
definition — no table list, no collection manifest, no sync schema. A
governed-family materialization is hydrated, kept current, or retained
because at least one registration names it (or because §D5's release grace
has not yet elapsed since the last registration released it); the
store-policy inspection names the reason for every retained byte from
§D5's closed `retainingReason` union — registrations, a running grace,
blocker-held payload, stub bookkeeping, or the grandfathered-legacy
reason. A query nothing registers is never hydrated; nothing unregistered
in a governed family is retained beyond grace except blocker-held payload
and stub bookkeeping, both named by inspection and both ending with their
causes.

This is LLP 0155 Move 2's copied-Zero outcome with Snapback's authority
model kept: the *client* declares interest; the *server* still admits the
plan, authorizes every result, and issues every witness. A registration
never widens a server-approved query, never mints retention the owner's
classification refuses, and never converts interest into authority.

The v1 registration set covers the `qmk1` and legacy-resume address
families only. The legacy lease family (the Contract arm's separate
artifact) keeps LLP 0043's own demand model until it converges (§D6).

### The registration record

```ts
type QueryRegistrationV1 = Readonly<{
  format: "snapback.query-registration.v1"
  registrationId: string         // store-scoped, client-minted, unique, never reused
  source: "active" | "preload" | "programmatic"
  ownerContext:
    | { kind: "subscription", contextId: string }  // a live client context (tab/process)
    | { kind: "route", routeId: string }           // a routes-manifest entry
    | { kind: "api", label: string | null }        // explicit registration API
  functionReference: object      // the generated reference, byte-preserved
  canonicalArgs: unknown         // LLP 0114 CanonicalClientValueV1
  requestedScope: RequestedCompletenessScopeV1     // LLP 0157 §D3
  retentionRequest: "none" | "durable"
  idleTtlClass: "none" | "default" | "pinned"
}>
```

- The registration resolves to an address: a
  `ClientMaterializationAddressV1` where the reference names an
  LLP 0157-admitted plan, otherwise the legacy alias key its arm already
  uses (§D3's address families; a legacy-family registration's
  `requestedScope` is the whole-result semantics its arm already implies —
  the field constrains only `qmk1` establishment). Unknown fields refuse;
  values outside the closed sets refuse; and `source` × `ownerContext`
  must pair exactly (`active`↔`subscription`, `preload`↔`route`,
  `programmatic`↔`api`) — any other pairing refuses.
- **Priority is derived, not declared:** hydration priority is
  `active` > `preload` > `programmatic` by `source`. There is no separate
  priority field to disagree with the lifecycle axis.
- **Per-source durability is exact:**
  - `active` registrations are **volatile**: they exist exactly while their
    owning subscription lives in a live context, are never persisted, and
    are reaped by the broker's liveness rule below. Restart reconstructs
    them from whatever subscriptions the application re-creates.
  - `preload` registrations are **manifest-derived**: re-derived at each
    boot from the routes manifest in force; not persisted per-registration.
    A route leaving the manifest releases its registrations at the next
    boot.
  - `programmatic` registrations are **durable**: persisted in `storeMeta`
    (bounded by §D3's registration cap), survive restart, and release only
    by explicit API call, by their materialization's LLP 0053 destruction,
    or by store reset.
- **Multi-registration merge is a closed per-axis lattice.** Registrations
  at one address compose; the effective policy at any moment is the
  per-axis maximum over the currently live registrations:
  `retentionRequest` `durable > none`; `idleTtlClass`
  `pinned > default > none`; demand state is `demanded-active` iff any
  `active`-source registration is live. Releasing one registration
  re-evaluates the merge over the remainder. **Release grace pins both
  policy axes:** when the last live registration releases, the ensuing
  grace carries the per-axis maxima over the registration set as it stood
  immediately before that final release — the *last-snapshot* rule. (A
  registration that released earlier contributes nothing: in an address
  holding A=`pinned` and B=`default`, A releasing first and B last yields
  a `default` grace; B releasing first and A last yields `pinned`.) The
  pinned pair — `idleTtlClass` and `retentionRequest` — governs the
  grace's GC exposure (§D5) and its §D3 condition 3 standing.
- **`retentionRequest` is load-bearing:** an effective `"durable"` — from
  live registrations, or pinned by a running release grace — is a
  necessary §D3 persistence condition. When the effective value drops to
  `"none"` (by release or re-registration) while the materialization is
  still demanded, its durable payload custody ends: the payload is
  reclaimed at the next writer maintenance pass through §D5's compaction
  path (honoring every blocker), and the materialization continues
  volatile (in-memory, `volatile-online-v1` honesty) while demanded. A
  grace pinned at `"none"` retains no payload; a grace pinned at
  `"durable"` retains it for the grace's duration — release never
  silently drops a durable-requested payload.
- **Scope serialization.** LLP 0157 §D3 gives one requested scope per
  address at a time, and a changed-scope request makes predecessor proofs
  historical. The effective scope at an address is therefore: the page-set
  scope if any live registration demands it (a page-set subsumes single
  pages); otherwise the most recently demanded page. A superseded page
  demand answers `unknown` until it is re-demanded and re-established.
  Richer concurrent-scope union semantics are deliberately out of v1
  (OQ10).
- **Registration custody.** A registration record carries the same
  authority-partition custody as its address: `canonicalArgs` never appears
  in ordinary inspection (LLP 0157 §D6's boundary — inspection shows
  `argsDigest` and counts; §D5's policy record shows registration
  identities and kinds only); LLP 0053 transitions apply to registrations
  with their materialization — `delete` destroys them, quarantine hides
  them, and a durable registration under a destroyed partition is
  destroyed with it, never resurrected to re-hydrate revoked state.
- `retentionRequest: "durable"` is a *request*: it is honored only when the
  owner-issued capability classification and retention authority admit it
  (§D3). The mismatch is reported honestly through the shipped
  retention-classification surface (retainable / not-retainable with a
  stable code), never silently dropped.

### Registration sources, mapped to shipped machinery

| Source | v1 producer | Notes |
| --- | --- | --- |
| `active` | a live `liveQuery`/provider subscription (the mounted-UI path) | the shipped `persistResume` option maps: `true` (default) → `retentionRequest: "durable"`, `false` → `"none"` |
| `preload` | the routes manifest (`defineRoutes` → `routes.manifest.json`) and its Channel A/C boot bundles and register groups | boot-scoped hydration; LLP 0090 owns bundle admission; the designed per-manifest-entry `persist: false` opt-out (LLP 0090 D3) and its shipped `persistResume` client-option stand-in map to `retentionRequest: "none"` |
| `programmatic` | an explicit client registration API (successor of the `persistResume` stand-in) | the authoring shape is OQ8 |

**Dated generated-mapping amendment (2026-08-03):** for a generated
Channel-B registration that resolves to `single_table_v1@1`,
`persistResume: true` fixes both `retentionRequest: "durable"` and
`idleTtlClass: "pinned"`; `persistResume: false` keeps
`retentionRequest: "none"` and grants no durable custody. This class-specific
mapping preserves Channel B's indefinite retained offline display while
remaining subject to the materialization budget, owner transitions, and store
reset. It does not change the mapping for any other class.

### The multi-context demand broker

Registrations are store state, and the store has one writer. The two
compose through a closed broker protocol, which is part of carrier
qualification (the two-contending-tabs carrier-exit leg). The protocol
records:

```ts
type DemandAnnounceV1 = Readonly<{
  format: "snapback.demand-announce.v1"
  contextId: string              // CSPRNG-minted per context lifetime; never reused
  revision: number               // per (contextId, partition), strictly increasing
  authorityPartitionDigest: `sha256:${string}`
  demands: readonly QueryRegistrationV1[]   // the pair's COMPLETE current set;
                                            // source: "active" entries only
}>
type RegisterForwardV1 = Readonly<{
  format: "snapback.register-forward.v1"
  contextId: string
  requestId: string              // unique per contextId; client-minted, never reused
  writerGeneration: number       // must match the current writer's generation
  authorityPartitionDigest: `sha256:${string}`
  registration: QueryRegistrationV1          // source: "programmatic" only
}>
type RegisterReleaseV1 = Readonly<{
  format: "snapback.register-release.v1"
  contextId: string
  requestId: string
  writerGeneration: number
  authorityPartitionDigest: `sha256:${string}`
  registrationId: string                     // a durable registration
}>
type RegisterOutcomeV1 = Readonly<{
  format: "snapback.register-outcome.v1"
  contextId: string              // the requesting context
  requestId: string
  outcome: { kind: "committed" } | { kind: "released" } | { kind: "refused", code: string }
}>
type WriterHelloV1 = Readonly<{
  format: "snapback.writer-hello.v1"
  writerGeneration: number       // monotone per store
}>
```

Every message is a closed record, and **refusal granularity is
message-level everywhere**: unknown fields, out-of-set values, a
`demands` entry whose `source` is not `"active"`, a subscription
`ownerContext.contextId` differing from the envelope's `contextId`, or a
cross-partition demand each refuse the whole message — its revision is
not consumed, and no partial set applies (`preload` derives at the
writer's own boot; `programmatic` rides only the forward/release pair).

Rules, normative:

- **Context identity is never reused.** `contextId` is CSPRNG-minted for
  one context lifetime. After the writer reaps a `contextId`, further
  messages bearing it are ignored; a surviving context that was wrongly
  reaped (e.g. after a network partition of the channel) must mint a
  fresh id and re-announce its full sets. Revision counters therefore
  never collide across lifetimes. The writer persists a bounded
  **reaped-context memory** (the last 256 reaped `contextId`s,
  provisional under OQ4) beside the live roster, so the ignore rule
  survives writer restart; an id outside both roster and memory is
  treated as a new context (CSPRNG minting makes collision negligible,
  and a stale announce that slips past an overflowed memory lapses at
  its own heartbeat expiry — a bounded, self-healing window).
- **Full-set announces, per partition.** Announces are scoped by the
  `(contextId, authorityPartitionDigest)` pair: a `DemandAnnounceV1`
  replaces that pair's entire volatile demand set at the writer. A
  multi-partition context (an LLP 0055 multi-grant client) announces each
  partition's set separately. The writer applies the highest `revision`
  per pair and ignores lower or duplicate revisions (idempotent,
  order-tolerant). A context releases a partition's demands by announcing
  that pair's empty set, and releases everything by dying. Every demand
  in an announce must name an address inside the announced partition;
  a cross-partition demand refuses the whole message (the
  message-level rule above).
- **Liveness.** A context is live while its heartbeat holds: it must send
  a well-formed message at intervals of at most 15 seconds — a keep-alive
  for a context with standing demands is a same-set re-announce (an empty
  set at a higher revision is a release, not a keep-alive), and **any**
  well-formed message from the context refreshes its heartbeat even when
  its revision is ignored as duplicate or lower. The writer reaps all of
  a context's volatile demands after 45 seconds without one (values
  provisional, dated-amendable under OQ4). A carrier disconnect signal
  (channel close, presence-lock release) reaps immediately. The writer
  treats an unreachable context as live until the liveness rule expires
  it — never silently live past expiry, never reaped early.
- **Forwarding and release.** `programmatic` registration from a
  non-writer context rides `RegisterForwardV1`, and release rides
  `RegisterReleaseV1` (or the writer-local API when the caller is the
  writer); both carry the caller's partition digest, and the writer
  validates the same way for both — with one stated exception, a release
  naming an unknown id, whose validation is necessarily partition-only
  (detailed below): the named registration's address must
  belong to that partition, and the partition's authority state must
  admit the commit — a partition mismatch, or a partition with a pending
  store-wide barrier or blocking disposition, refuses with a stable code
  and the context retries against fresh state. (Registration commits
  touch `storeMeta`, not materialization payload; no LLP 0157
  materialization fence is implicated, and none is claimed.) Both carry
  the current `writerGeneration`; a stale generation refuses, forcing the
  context to re-sync with the current writer before durable mutations —
  a delayed cross-handoff message can therefore never mutate durable
  state. Both resolve only on the context-bound `RegisterOutcomeV1`.
  Idempotency and replay safety are durable, from three rules:
  the writer persists a bounded **consumed-request memory** (the last
  1,024 `(contextId, requestId)` outcomes; `requestId` is unique per
  context; provisional under OQ4), so a retry — including across a
  writer crash between commit and outcome, and across writer restart —
  answers from the recorded outcome; the writer persists a bounded
  **released-registration memory** recording a tombstone keyed
  `(authorityPartitionDigest, registrationId)`, created **only
  atomically with a successful `released` outcome** — a refused release
  leaves no tombstone — and covering release-of-unknown, whose
  validation is necessarily partition-only (an unknown id has no stored
  address; the caller's partition must merely be admitted). The memory
  holds the last 1,024 tombstones (provisional under OQ4); a later
  forward whose registration address falls in the tombstone's partition
  and names its id refuses — the release-before-delayed-forward
  reordering cannot resurrect a registration — while a forward in a
  *different* partition is a different key and is unaffected, so no
  partition can preempt another's ids. Releasing an already-released or
  unknown id returns `released` (release is idempotent), and
  `registrationId`s are client-minted and never reused, so a fresh
  forward never legitimately names a released id. Overflow honesty,
  exact: the release-before-first-forward residue depends **only on the
  tombstone window** — once a tombstone evicts, a still-unseen delayed
  forward can recreate the registration even while the release's
  consumed outcome survives; replay of a *previously consumed* forward
  additionally requires its consumed-request entry to have evicted. The
  residue in either shape is a re-created durable registration that is
  inspection-visible and recoverable by an ordinary release — bounded
  and recoverable like the reaped-context window, though, unlike that
  window, not self-healing. All broker identifiers (`contextId`, `requestId`,
  `registrationId`) are at most 64 UTF-8 bytes, refusal codes are
  registered stable codes, and any broker message over 256 KiB refuses —
  broker state and traffic are byte-bounded, not only count-bounded.
- **Reads protect renderable custody through demand, not through reads.**
  A non-writer tab rendering an adopted materialization keeps it
  `demanded-active` by announcing the demand — the store does not infer
  demand from reads it cannot observe.
- **Writer handoff.** On acquiring the lock, the new writer emits
  `WriterHelloV1`, loads durable registrations, the persisted demand
  roster — keyed by `(contextId, authorityPartitionDigest)` **pair**, so
  a multi-partition context's separate partition sets are individually
  accounted (the writer keeps the live pairs durably in `storeMeta`,
  updated as pairs appear and reap, capped at 64 live contexts and 128
  live pairs — a context or pair beyond its ceiling refuses with a
  stable diagnostic and runs volatile-online;
  provisional under OQ4) — plus the reaped-context memory, the
  consumed-request memory, and the released-registration memory, and
  rebuilds the volatile ledger from re-announcements. Until
  reconciliation completes — **every roster pair** re-announces or is
  **affirmatively reaped** — **every
  demand-derived transition is suppressed**: no
  release-grace starts, no grace GC, no budget-pressure compaction of
  any step; a commit that would exceed budget during suppression refuses
  instead. Reconciliation reaping is **pair-scoped**, deliberately
  unlike ordinary liveness: each roster pair carries its own deadline —
  the heartbeat expiry (45 seconds) from `WriterHelloV1` — and a pair
  that has not re-announced by its deadline is reaped *as a pair*, its
  volatile demands released, even while its context remains live through
  another pair's traffic. This is sound because announces are full-set
  per pair: a live context re-announces every pair it still demands, so
  a pair left silent through the whole window is an affirmative absence
  signal, not an unknown. That obligation is normative on the client
  side too: **on observing `WriterHelloV1`, a context re-announces each
  of its pairs' full sets within the heartbeat interval** — a multi-pair
  context may not heartbeat through one pair alone across a handoff.
  A reconciliation-reaped *pair* is not a reaped context: it simply
  re-announces and re-appears under the same `contextId` (only reaped
  `contextId`s enter the ignore memory), so a wrongful pair reap is
  self-correcting custody, never authority. There is no independent
  timeout exit and no
  context-wide hostage state: suppression is bounded by the 45-second
  expiry from `WriterHelloV1` and can never end while an unreconciled
  pair's demands are absent from the rebuilt ledger. (Outside handoff,
  liveness stays context-scoped as defined above — pair-scoped deadlines
  exist only for reconciliation, where the new writer cannot otherwise
  distinguish a still-demanded pair from a departed one.) A release
  whose grace would
  begin during suppression anchors its grace clock at suppression end.
- **Per-carrier qualification and honest degradation.** The browser
  carrier qualifies the protocol over its cross-tab channel plus Web
  Locks presence. The shipped file carrier has **no cross-process
  channel**: same-process contexts share the writer in-process;
  cross-process non-writer contexts run volatile-online for their own
  demands (in-memory rows, no durable-custody claims, no assumption that
  retained state is protected on their behalf) until a channel is
  qualified for that carrier (OQ12). A context that cannot reach a writer
  degrades the same way, and must not assume grace or protection exists
  for what it renders.

### Sync obligations per capability class

The owner-issued classification (LLP 0157 §D2/D4) is the *only* input; the
store infers nothing from plan shape:

- **Live-admitted plans** (`live.kind: "admitted"`): while at least one
  `active` registration exists and the client is connected, the store holds
  the live subscription and ingests `live_replace`/`live_delta` per the
  owners' rules (LLP 0157 §D7 ingestion; LLP 0034's lane). Establishment
  runs at registration; re-establishment on reconnect enters through the
  shipped state machine (§D6).
- **Non-live plans** (`live.kind: "none"`, including `Query`-kind exports):
  establishment at registration and on explicit refresh; no subscription is
  invented for them.
- **`demanded-idle` registrations** (`preload`/`programmatic` with no
  active use): hydrated at registration and re-validated when they next
  become active or at boot preload; v1 deliberately holds **no** standing
  live subscription for idle registrations (the fan-out cost of a warm
  class is OQ3).
- **Retention-ineligible plans** (owner retention `"none"`, e.g. v1
  `snapshot-batch.v1` composites): registration governs presence and
  priority only; their materializations live in the `volatile-online-v1`
  profile and restart `unknown`.

### Hydration scheduling

Hydration is bounded and inspectable, never an unbounded fan-out:

- priority order `active` > `preload` > `programmatic`; within a class,
  least-recently-established first;
- a per-store establishment concurrency bound (v1 default: 4 concurrent
  establishment attempts; dated-amendable, superseded by OQ4's measured
  freeze), with remaining registrations queued and their attempt state
  honestly `pending`/`idle` per LLP 0157 §D3;
- a registration that cannot hydrate (offline, refused, over budget)
  reports `unknown` plus its attempt/refusal state — registration never
  fabricates rows;
- hydration work (rows, bytes, attempts) is an inspection fact per
  materialization (LLP 0157 §D6) and per store (§D5's policy record).

## D3 — Retention keyed by plan identity

### The retention unit

The unit of durable retention is the materialization record's **payload**
at its address — fragments with their proofs, page-set manifests, and
memberships — committed atomically and reclaimed atomically by §D5's
compaction. V1 has no partial-fragment custody: a record's payload is
present whole or absent whole, while its identity, authority state, and
registration bookkeeping survive compaction per §D5 (their interior page
lifecycle belongs to LLP 0157 §D3's transitions).

**The `qmk1` persistence predicate.** Discretionary persistence of a
`qmk1` materialization's payload requires **all** of:

1. the store's `durable-fragments-v1` profile (LLP 0157 §D7) on a carrier
   whose durability facts are qualified (§D9);
2. an owner-issued retention authority for the plan — the store never
   widens a classification:
   - `opaque-authorized-snapshot-v1` (LLP 0080) with the complete LLP 0043
     lease/witness custody for auth-scoped plans;
   - `result-transform-snapshot-v1` (LLP 0080 as amended at this Spec's
     acceptance, §D7) with the identical lease/witness custody — this class
     is **representable only after the carried LLP 0157 classification
     amendment lands** and grants evaluation admission only through §D7's
     full ship gate; until then no plan can carry it;
   - `rqs-authority-independent-snapshot-v1` only for
     `single_table_v1@1`, with `authorizedLeaseHash: null` and no
     `AuthorizedLease`, but with the exact current completeness proof, result
     bytes, authorization witness, instance fence, class binding, and trusted
     activation/proof-key artifact required before install and every render;
   - `retention: "none"` never persists;
3. an effective `retentionRequest` of `"durable"` — from live
   registrations (§D2's lattice), or pinned by a running release grace
   (§D2's last-snapshot rule) — registration interest is necessary, not
   only owner permission;
4. a registration or unexpired release grace (§D2/§D5); and
5. the LLP 0053 state admitting it (disposition `retain`, no blocking
   fence).

When the predicate fails but a §D5 compaction blocker holds (pending
intent, an obligation needing the payload, a settlement dependency), the
payload enters **blocker-held custody**: an explicit, inspectable safety
state (`retainingReason: safety-blocker`, §D5's policy record) that is
never discretionary retention — it ends when the blockers discharge, and
the payload is then reclaimed at the next writer maintenance pass.
Rendering under blocker-held custody follows §D4's ordinary rules
unchanged. Precedence is exact: blocker-held custody resists only
**discretionary** compaction and grace GC; an LLP 0053 `delete` or
terminal retirement executes its owner's destructive rules regardless
(the owner's own queue-custody rules govern any dependent intent), and
quarantine hides payload under the owner's custody as ever.

**The legacy predicate is LLP 0090's, separately.** Legacy `entries`
persist under that owner's own rules — a token-verified `rqsEligible`
entry within the legacy envelope — with no `retentionRequest`,
registration, or grace condition; this Spec's predicate above does not
apply to them (§D5's grandfathering).

### Address families and their staged convergence

Three keying regimes coexist, deliberately and visibly:

| Family | Key | Population | Witness | Status under this Spec |
| --- | --- | --- | --- | --- |
| `qmk1` materializations | `ClientMaterializationAddressV1` | LLP 0157-admitted plans (`relational_query_v1`, `bounded_children_v1`, and `single_table_v1` singles; composites volatile-only in v1) | `CompletenessProofV1` | the target family; new establishment lands here |
| legacy resume | `rqsEntryKey(name, args)` | the shipped `rqsEligible` set — public, authority-independent, single-table, plan-based LiveQueries (LLP 0004/0007 plans; server-derived predicate, never authored) | server-MACed resume token + content digest (corruption detection, not client-side authenticity — LLP 0090's threat model; no completeness proof) | continues under LLP 0090's exact rules and its own budget envelope in the same store domain (grandfathered, §D5); eligible for the connected prove-or-fresh adoption path after `single_table_v1@1` registration |
| legacy lease | `retainedQueryKey(name, args)` | auth-scoped retained records (Contract arm) | `CompositeWitness` + `AuthorizedLease` | separate LLP 0043 artifact, unchanged; converges by §D6's close-predecessor-first protocol only |

The middle row records a fact that registration does not rewrite: a legacy
entry by itself has no `PlanHashV1` or completeness proof. It keeps its shipped
verification (digest + token identity, fail-closed) and lifecycle inside the
same store domain under its untouched budget envelope. The 2026-08-03 owner
ruling registers `single_table_v1@1` and selects Arm A: Channel-B authority
travels as `rqs-authority-independent-snapshot-v1`, with no anonymous-lease
commissioning. Current served owner artifacts can therefore derive plan
identity, proofs, and QMK addresses for the exact population during §D6's
connected adoption path, without claiming that legacy bytes already contain
those facts. This resolved OQ1 at the semantic registration layer; the
2026-08-03/04 implementation program subsequently shipped the adoption path.
It still never relabels legacy bytes. The separate retained-evidence
publication act is complete for the local contributor-source target as
recorded in §D6/§Status.

### Identity rotation and predecessors

Args, plan, function, activation, or authority-partition change derives a
different address (LLP 0157 §D2's rotation table, consumed). The store
initializes the new address and never mutates identity in place. Predecessor
state is handled exclusively by LLP 0053 machinery — the store-wide
authority barrier for authority rotation, artifact-change delete-before-read
for activation change, quarantine/delete dispositions otherwise.
**Compaction is never a substitute for a barrier:** budget pressure may
reclaim payload custody (§D5), but a rotated identity's predecessors are
destroyed or quarantined through their owner's operations before any
successor renders, regardless of budget state.

### Custody budgets

Budgets are **partitioned per section** — the two retention populations
never compete, so nothing about the shipped Channel-B retention exposure
changes:

- **The legacy envelope, untouched:** the legacy `entries` section keeps
  the shipped constants and behavior byte-exact — 32 MiB / 256 entries
  (`RQS_STORE_MAX_BYTES` / `RQS_STORE_MAX_ENTRIES`), the shipped byte
  formula (UTF-8 length of the serialized `{rows, meta, token}`,
  `rqsEntryRecordBytes`), and the shipped comparator (ascending
  `resumedAt`, never-resumed first, then `savedAt`) with **no** added
  tie-break. A legacy commit evicts within the legacy section only, and on
  exhaustion refuses exactly as shipped. Materialization commits never
  touch legacy entries; legacy commits never touch materializations. No
  LLP 0090 amendment is carried, because no LLP 0090-governed behavior
  changes.
- **The materialization envelope** (v1 provisional values, dated-amendable
  under OQ4): 32 MiB logical payload bytes, 256 materialization records,
  1,024 stored fragments. Logical bytes are the **payload-only
  projection**, identical on every carrier: the sum of stored fragment
  byte lengths, plus the UTF-8 JCS lengths of stored proofs (each proof
  counted exactly once, at the fragment record that stores it —
  `productState.heldProofs` are references and never re-counted),
  page-set manifests, and membership records. Excluded from the byte
  budget and bounded separately: record identity/product/authority/
  subscription metadata (bounded by the 256-record cap), durable
  `programmatic` registrations (own caps: 512 per store and 16 KiB each —
  the UTF-8 length of the registration record's RFC 8785 JCS bytes —
  refuse-at-cap with a stable diagnostic, both provisional under OQ4),
  `storeMeta` bookkeeping (bounded by the record and registration caps
  plus the §D2 broker ceilings: 64 live contexts, 128 live roster pairs,
  256 reaped-context memory entries, 1,024 consumed-request outcomes,
  1,024 released-registration tombstones, 64-byte identifiers), and the
  outbox — which has its own owner-governed caps (the shipped
  implementation constants: 1,024 records, 256 KiB per record, 4,096
  pending acknowledgements, `packages/snapback-client/outbox-shared.mjs`,
  under LLP 0043's refuse-at-capacity posture; the values are
  implementation constants, not LLP 0043 text) and **refuses at capacity
  rather than evicts** — pending intent and unacknowledged settlement
  recovery state are never budget-reclaimed, and their caps are not
  fungible with the retention budget.
- **Enforcement** runs inside the committing transaction (consumed shipped
  rule): an over-budget materialization commit compacts per §D5's order or
  refuses; a single record exceeding the envelope refuses with its stale
  predecessor removed, never half-written. Every materialization-envelope
  comparator ends in a deterministic final tie-break: ascending
  lexicographic comparison of the record's address key as unsigned UTF-8
  bytes.

## D4 — Completeness-honest local answers

### The rule

**A plan answers locally with authority only when its witness and
capability class permit.** Concretely, an `authoritative` local answer
exists at an address exactly when `readRenderable` (LLP 0157 §D7) succeeds
under the exact fence triple and the derived `CompletenessStatusV1` for the
requested scope is `complete` — meaning: lifecycle `active`, disposition
`retain`, valid held proof(s) exactly satisfying the requested scope at the
requested version, witness bindings revalidated against current LLP 0053
state, and (auth-scoped) an unexpired lease. Freshness labels the answer
`current` or `retained`; a retained answer is complete *as of* its proof
version and is never presented as current. The legacy lease family has its
own owner-backed basis — `lease-authorized-retained`, LLP 0043 M1's exact
conditions under the composite witness and MACed lease — which is
authorized retained service without any LLP 0157 completeness claim.
For `single_table_v1@1` under
`rqs-authority-independent-snapshot-v1`, `authorizedLeaseHash` is exactly
`null`; the proof, result, witness, current instance fence, class binding, and
trusted activation/proof-key artifact are the complete no-lease basis and are
revalidated before every render.

Everything else derives `unknown` or — exactly where LLP 0157 §D3's
transition table produces it (a current refused attempt with no valid
matching proof) — `refused` with its closed reason and safe fallback. The
store adds no sixth class and no local upgrade path:

- no completeness from row counts, cap coincidence, or replayed deltas
  (consumed);
- no absence inference: rows not held are unhydrated, not proven absent;
- partial hydration of a page set answers `unknown` for the set scope even
  while individual pages are complete as-of their own versions (consumed);
- a `refused` establishment surfaces its closed reason and safe fallback;
  it never silently degrades to stale rows presented as fresh.

### The answer table

The per-family answer classes are the closed §Vocabulary set. S2 executes
this table.

| # | Family | State | Answer / freshness | Store mutation / action |
| --- | --- | --- | --- | --- |
| 1 | `qmk1` | valid proof for requested scope+version; disposition `retain`; witness revalidates; lease valid (auth-scoped) | **authoritative** — `complete`, `current` if live-confirmed else `retained` | none |
| 2 | `qmk1` | proof absent, signature/binding fails, or result bytes fail the contract | `unknown`; render nothing | discard the corrupt fragment/proof (LLP 0157 retained-boot row 1); fresh sync when connected |
| 3 | `qmk1` | stored activation ≠ trusted current artifact | `unknown`; render nothing | LLP 0053 artifact-change `delete` before read |
| 4 | `qmk1` | lease missing/malformed/expired/rollback-tainted (auth-scoped) | `unknown`; render nothing | LLP 0053 `delete` before read (equality is expiry) |
| 5 | `qmk1` | witness same incarnation/stream, newer epoch expected | `unknown`; render nothing | LLP 0053 `quarantine` before read; satisfying resnapshot may release |
| 6 | `qmk1` | witness missing / wrong incarnation/stream/instance | `unknown`; render nothing | LLP 0053 `delete` before read |
| 7 | `qmk1` | current attempt refused; no valid matching proof | `refused` (closed reason + fallback) | store the refusal (LLP 0157 §D3) |
| 8 | `qmk1` | requested scope/version changed at the address | `unknown` until re-established | predecessor proofs become historical (LLP 0157 §D3) |
| 9 | legacy resume | entry verifies (shape, token, meta, rows, identity, digest); outbox empty | **labeled-retained** rows; token enters the §D6 ladder; first authoritative answer → `current` | none |
| 10 | legacy resume | entry verifies; outbox pending | **labeled-retained** + `pendingIntentsAtSeed`; `resumeFromToken` withheld | LLP 0043 path (full resync, then replay) |
| 11 | legacy resume | any verification failure (incl. `inProgress` marker) | `unknown`; render nothing; fresh subscribe | delete the entry |
| 12 | legacy resume | token expired (server-admission staleness) | offline: **labeled-retained** display continues (indefinite, LLP 0090's rule); connected: resume falls to rung 3 fresh subscribe | token replaced on next authoritative answer |
| 13 | legacy resume | `AuthorizationInvalidation` / `resync_required` with `clear_retained` | `unknown` | purge the persisted copy |
| 14 | legacy lease | every LLP 0043 M1 condition holds (exact witness match, complete MACed lease custody, strictly before deadline, valid cursor/target facts, no blocking fence) | **lease-authorized-retained** — `retained` (as-of the accepted snapshot), marked stale per LLP 0043 | none; reconnect requires full revalidation + fresh snapshot before stale clears |
| 15 | legacy lease | expiry-equality, clock rollback, custody defect, identity/witness mismatch | `unknown`; render nothing | commit the instance's delete tombstone before read (LLP 0043/0053) |
| 16 | `qmk1` / `single_table_v1@1` | `retention: "rqs-authority-independent-snapshot-v1"`; `authorizedLeaseHash: null`; valid proof/result, witness, current instance fence, class binding, and trusted activation/proof-key artifact | **authoritative** — `complete`, `current` if live-confirmed else `retained`; no lease is required or implied | none; every proof/fence/barrier/destructive check still applies, and any failure follows the corresponding qmk1 row above |

### Offline posture

- Authority-independent retained state displays indefinitely while
  disconnected, always labeled non-current (LLP 0043's never-current rule).
- Auth-scoped retained answers are lease-bounded: at most the LLP 0053
  24-hour ceiling, equality-is-expiry, clock-rollback and custody defects
  delete before read, and no ambient renewal — heartbeat, delta, reconnect,
  and mutation success never extend authority (consumed).
- Reconnect always re-enters the owners' state machine (fresh
  authorization revalidation and snapshot, or the §D6 resume ladder)
  before retained labels clear.
- A `volatile-online-v1` store restarts `unknown` with a structured
  durable-profile GAP (LLP 0157 §D7); it never emulates durability.

### 2026-08-04 typed offline refusal and bundle workload

When connectivity fails and no authoritative retained answer passes this
section's checks, the Full client surfaces
`SNAPBACK_QUERY_OFFLINE_UNAVAILABLE` with the query's retention disposition
and D4's `unknown` local answer instead of leaking a raw transport error. This
is a client-side refusal, not a new answer class or an authority upgrade.

Adding that public diagnostic intentionally changes the Full/root bundle
workload. Under LLP 0063 and LLP 0145, its first attributed run is a
prospective workload-version rollover for exactly the profiles whose closure
contains the public client entry. The generated-mutation-IR receipt remains
the immutable predecessor, and every unaffected profile keeps its prior
ceiling.

## D5 — Query lifecycle, TTL, and eviction

### Two axes, one precedence rule

A materialization's behavior is the product of two orthogonal axes:

- **Demand** (this Spec's axis, derived from live registrations):
  `demanded-active` (≥ 1 live `active`-source registration),
  `demanded-idle` (registered by `preload`/`programmatic` only), or
  `undemanded` (zero registrations; release grace running).
- **Owner state** (LLP 0157 §D3's product: lifecycle `active`/`retiring`,
  disposition, freshness, attempt, held proofs — projecting LLP 0053).

**Owner state always wins.** Demand affects only hydration priority and
compaction exposure of payload custody. A demanded record under
`quarantine`, `delete`, or `retiring` follows the owner transition exactly
(hidden, destroyed, or rejected per LLP 0053); demand never resurrects,
delays, or downgrades an owner transition, and a destroyed
materialization's registrations are destroyed or released with it (§D2
custody). `retiring`/retired are owner states, not demand states: a
retired instance has no record and no status (LLP 0157), whatever demand
exists; re-demand after retirement initializes a fresh instance.

| Demand state | Sync behavior | Compaction exposure |
| --- | --- | --- |
| `demanded-active` | live subscription per class; ingestion | never budget-compacted; over-budget establishment refuses commit |
| `demanded-idle` | hydrated at registration/boot; no standing subscription (v1) | compactable under pressure, after `undemanded` |
| `undemanded` | none | first under pressure; GC'd at grace expiry |

### Release grace (TTL)

- Grace is **release-anchored**: the clock starts when the last
  registration releases the address (or at suppression end, when the
  release lands during broker-handoff suppression — §D2). Default
  duration 14 days (1,209,600,000 ms; a provisional v1 value,
  dated-amendable under OQ4). The governing policy is pinned at release
  by §D2's last-snapshot rule — both axes, `idleTtlClass` and
  `retentionRequest`, from the registration set immediately before the
  final release. `"none"` — no grace, GC-eligible on release; `"default"`
  — the 14-day window; `"pinned"` — **exempt from grace GC entirely**: a
  record whose pinned class is `"pinned"` is never background-collected
  and is reclaimed only by budget pressure (step 3 below), an owner
  transition, or store reset.
- **Grace protects against background GC only, never against
  budget-pressure compaction** and never against an owner transition. It
  is custody policy, not authority: it cannot extend a lease, a proof's
  validity, or a retained label; auth-scoped custody ends at lease expiry
  through LLP 0053's `delete` regardless of grace, and an owner
  disposition executes on its own schedule.
- Grace GC runs as a writer maintenance pass. Clock rollback delays GC and
  never accelerates it (custody-only; no authority consequence). Grace
  clocks are durable and survive format migration (§D1).
- The legacy directory GC (30-day dead-origin blob sweep on the Node
  default path) is unchanged and out of scope: it reclaims abandoned
  *stores*, not entries within a live one.

### Compaction (eviction) — payload custody only

Budget-pressure reclamation and grace GC both act by **payload
compaction**, never record destruction:

- **What compaction removes:** the record's payload — fragments, stored
  proofs, page-set manifests, memberships — atomically (a page-set
  manifest never outlives its fragments; no partial-fragment state
  exists).
- **What compaction preserves:** the materialization's identity, its
  `QueryAuthorizationState` (the exact current-instance fence, tombstones,
  and the frontiers LLP 0053's §GC requires to survive payload
  compaction), the product-state skeleton — with `heldProofs` cleared,
  since the stored proofs are payload; the stub holds no dangling proof
  references — and all registration bookkeeping. Durable `programmatic`
  registrations are never removed by compaction (§D2 owns their release).
  The compacted stub derives `unknown`, renders nothing, and
  **re-establishment rehydrates the same `query_instance_id`** —
  compaction is not retirement.
- A fully `undemanded` stub whose grace has expired and which carries no
  surviving LLP 0053 obligations may finally be removed through LLP 0053's
  ordinary terminal retirement, preserving allocator/frontier high-waters
  (the owner's protocol, not a shortcut).

Under budget pressure, within the committing transaction, over the
materialization envelope only (§D3 — the legacy envelope is separate and
untouched):

1. `undemanded` records whose pinned class is not `"pinned"`, oldest
   release first;
2. then `demanded-idle` records with `idleTtlClass` `"none"`/`"default"`,
   least-recently-established first;
3. then the `"pinned"` records — `demanded-idle` and `undemanded` alike —
   least-recently-established first;
4. `demanded-active` records are never compacted; if steps 1–3 cannot fit
   the commit, the commit refuses with a stable over-budget diagnostic.

Every comparator ends in the §D3 address-byte tie-break, so identical
workloads compact identically on every carrier. During broker handoff
suppression (§D2), all of steps 1–3 and grace GC are suspended and
over-budget commits refuse.

Compaction blockers — a record is skipped (and the order proceeds past it)
while any of these hold:

- pending outbox intent references the materialization (LLP 0157 §D7's
  independent-reasons rule; pending intent is never reclaimed with it);
- unresolved LLP 0053 obligations require the payload itself (e.g. a
  pending resolution proof over held bytes) — destructive cleanup runs
  through `applyAuthorizationTransition`, preserving tombstones and
  frontiers; compaction never substitutes for a disposition;
- retained settlement or unconfirmed acknowledgement records depend on it
  (LLP 0043's refuse-at-capacity posture governs those, not this budget).

Compaction is inspectable: counts and last-compaction facts live in the
policy record below, and every still-present record's retaining reason
remains answerable.

`wipe` is not compaction: §D1 defines its exact scope, survivals, and
rotations.

### `StorePolicyInspectionV1`

The demand/grace/budget facts this Spec adds are inspectable through a
versioned, read-only, store-adjacent record — **additive beside LLP 0157
§D6's projections, which are unchanged** (per-row membership and
completeness facts stay there; this record explains policy):

```ts
type StorePolicyInspectionV1 = Readonly<{
  format: "snapback.store-policy-inspection.v1"
  clientStoreId: string
  authorityPartitionDigest: `sha256:${string}`   // requesting partition; only its addresses appear
  budgets: readonly {
    section: "materializations" | "legacy-entries"
    logicalBytes: number, byteCeiling: number
    recordCount: number, recordCeiling: number
    fragmentCount: number | null, fragmentCeiling: number | null
    compactionCount: number, lastCompactionAt: number | null
  }[]
  registrations: {
    durableCount: number, durableCeiling: number
    perRecordByteCeiling: number
  }
  broker: {
    writerGeneration: number
    liveContextCount: number
    liveContextCeiling: number
    livePairCount: number
    livePairCeiling: number
    reapedContextCount: number
    reapedContextCeiling: number
    consumedRequestCount: number
    consumedRequestCeiling: number
    releasedRegistrationCount: number
    releasedRegistrationCeiling: number
    suppressionActive: boolean
  }
  constants: {
    graceDefaultMs: number
    heartbeatIntervalMs: number
    heartbeatExpiryMs: number     // also the handoff-suppression bound
    establishmentConcurrency: number
    identifierByteCeiling: number
    messageByteCeiling: number
  }
  addresses: readonly {
    addressKey: string             // qmk1 materialization key, or the
                                   // legacy family's alias key
    demandState: "demanded-active" | "demanded-idle" | "undemanded"
    effectiveRetentionRequest: "durable" | "none" | null   // null = not governed
    retainingReason:
      | { kind: "registrations", entries: readonly {
            registrationId: string
            source: "active" | "preload" | "programmatic"
            ownerContextKind: "subscription" | "route" | "api"
          }[] }
      | { kind: "release-grace", graceDeadline: number | null }  // null = pinned
      | { kind: "safety-blocker", blockers: readonly
            ("pending-intent" | "obligation" | "settlement-dependency")[] }
      | { kind: "instance-bookkeeping" }   // a compacted stub held only for
                                           // fences/frontiers
      | { kind: "grandfathered-legacy-entry" }
    effectiveTtlClass: "none" | "default" | "pinned" | null
    lastEstablishmentAt: number | null
    compacted: boolean
  }[]
}>
```

This `retainingReason` union is the **single source of truth** for the
document's retaining-reason vocabulary: §Vocabulary, §D2's rule, and
Guardrail 1 cite it rather than re-enumerating it. Exactly one reason
reports per address, selected by fixed precedence:
`registrations > release-grace > safety-blocker > instance-bookkeeping`
(a compacted stub still named by a live registration therefore reports
`registrations`; a `"none"`-pinned release awaiting its
next-maintenance-pass reclamation reports `release-grace` with an
already-elapsed deadline).

Redaction rules: the record is bound to one authority partition exactly
like LLP 0157's client projection; `canonicalArgs` and raw authority facts
never appear (args live as digests in LLP 0157's projection);
`ownerContext` labels are excluded (kinds only). Legacy entries appear
with `retainingReason: { kind: "grandfathered-legacy-entry" }`,
`effectiveTtlClass: null`, and no registration entries — the total
every-retained-byte-has-a-nameable-reason obligation holds across both
resident families. The provisional §D2/§D3/§D5 constants surface as this
record's ceiling fields, so their measured revision (OQ4) is observable,
not prose.

## D6 — Resume, delta, and the shipped RQS machinery

### What is consumed unchanged

The LLP 0090 machinery is this store's sync engine, not a competitor:

- the replay admission ladder — `CurrentAsOf` unchanged-proof, delta replay
  with the membership witness, fresh `LiveReplace` fallback;
- token/digest identity (`mset1`/`seq1`, opaque server-MACed tokens),
  A-versus-B arbitration (matching identity, higher version; any identity
  mismatch discards both), and token adoption by non-writer tabs;
- **the pending-outbox protocol rule:** a client with non-empty outbox
  never sends `resumeFromToken`; it takes the LLP 0043 path (full resync,
  then replay), while still rendering verified retained rows labeled
  `retained` with `pendingIntentsAtSeed`;
- the persistence cadence (bounded debounce, flush on
  pagehide/visibility-hidden, explicit flush hook), the `inProgress`
  crash marker refusing partially applied delta sequences, and
  `markResumed` recency;
- purge on `AuthorizationInvalidation` and `resync_required` with
  `clear_retained` — the persisted copy, not just memory;
- fail-closed handling of corrupt, truncated, or digest-mismatched
  persisted state (untrusted input; fresh subscribe).

### The three sync lanes, honestly

V1 has three re-entry lanes, one per address family; this Spec unifies
their *custody domain and lifecycle*, not their admission protocols:

1. **Legacy token resume** (`rqsEligible` entries): the full LLP 0090
   ladder, unchanged.
2. **Lease revalidation** (auth-scoped lease records): no persisted resume
   token exists for this population (LLP 0090 pins that v1 persists no
   auth-scoped RQS resume state); reconnect is full authorization
   revalidation plus fresh snapshot or admitted delta under LLP 0043/0053.
3. **Fresh establishment** (`qmk1` materializations): re-establishment
   through LLP 0157 §D7 with proofs; live delivery per the plan's
   classification (v1 composites: cursor-free first-page `live_replace`
   re-execution; no composite resume credential exists). A proof-backed
   resume credential that lets a `qmk1` materialization enter the ladder's
   rung 1/2 — binding token identity to the materialization key and held
   proof — is a successor amendment with LLP 0090/0093/0094 (OQ2), not a
   v1 claim.

### Successor and migration rules

This store is the declared successor of the Channel B store. Convergence is
staged and fail-closed:

- **Legacy resume → `single_table_v1@1` QMK, connected prove-or-fresh
  adoption (dated 2026-08-03):** registration resolves OQ1 without granting
  legacy bytes plan identity. Adoption is a connected attempt only and follows
  this exact sequence:

  1. **Preconditions.** The current served function passes the derived class
     predicate; the target advertises the class/proof/store capabilities; the
     current generated and trusted activation artifacts exact-match; and no
     pending outbox intent depends on the predecessor. Pending intent waits for
     settlement or explicit owner-governed discard and is never dropped.
  2. **Derive, do not relabel.** Recompute `SingleTablePlanV1`, node
     capability, `NodePlanHashV1`, `PlanHashV1`, QMK, and contextual address
     from current owner artifacts. Validate the legacy key, args hash,
     generation, function artifact, version stream, digest kind/content
     digest, rows, and token under LLP 0090's rules. Mismatch or corruption is
     not proof.
  3. **Prove arm.** Present the legacy token through LLP 0090's unchanged
     ladder. Rung-1 unchanged proof or admitted rung-2 replay may establish the
     current exact whole-result bytes; the server then issues an ordinary
     `CompletenessProofV1` over the derived QMK/node/plan and those bytes. The
     token or content digest alone never substitutes for that proof.
  4. **Fresh-sync arm.** If identity cannot be proved, the token is stale, the
     ladder falls through, the class-only examined-entry guard refuses proof,
     or any current binding differs, run fresh `single-node.v1`
     establishment and install only a newly issued proof. If it cannot
     succeed, keep a still-valid legacy record under its legacy label and
     rules; never publish a QMK record. Discard a corrupt legacy record first,
     leaving `unknown` until fresh establishment succeeds.
  5. **One atomic same-domain switch.** Once a valid QMK fragment/proof is
     ready, one store transaction installs the QMK materialization and removes
     or terminally retires the legacy entry. Before commit only legacy is
     renderable; after commit only QMK is renderable. A crash exposes neither
     dual identity nor a gap, except the explicit corruption case that required
     delete-before-fresh.
  6. **After adoption.** The legacy token is not a QMK resume credential.
     Re-entry is fresh LLP 0157 establishment until OQ2's separately owned
     proof-backed resume amendment lands.

  **Dated implementation and publication note (2026-08-04):** the shipped client now executes
  this exact adoption sequence for the derived `single_table_v1@1` class,
  including both ladder arms, mismatch-to-fresh, examined-entry refusal,
  pending-intent blocking, atomic legacy/QMK visibility cuts, and the rule
  that a legacy token is never a QMK credential. The separate evidence act is
  now complete (refreshed 2026-08-06 at the Move-1 closure):
  `carrier-exit.2026-08-06.v1.json` records 17 PASS / 0 GAP / 0 skipped,
  the 2026-08-06 `move1-exit` receipts record Triage 8/8 and Fleet 8/8, and
  `crates/snapback/src/local-persistent-store-publication.v1.json` binds those receipts and
  their source pins into the local manifest projection. Remote-service and
  Cloudflare targets remain nonclaims.
- **Legacy lease records: close-predecessor-first convergence only.** The
  lease store and this domain are separate artifacts on the shipped
  carriers, and no transaction spans them, so no cross-artifact atomic
  move exists and none is claimed. The v1 convergence protocol is
  monotone, uses **only existing owner transitions** (no new disposition
  is invented), and has a defined state at every crash cut. It carries a
  **pending-intent precondition**: LLP 0053's retirement makes dependent
  queue custody discard-only, so step 1 may begin only when no pending
  outbox intent depends on the predecessor instance — a convergence
  attempt against a predecessor with dependent queued intent refuses and
  waits for settlement or the user's explicit discard (the owner's strand
  rules); pending intent is never silently dropped by convergence. The
  protocol is also initiated only under a connected convergence attempt,
  so the acknowledged data-gap window is a connected re-establishment
  wait, not an arbitrary offline period. The steps:
  1. the lease owner durably **begins the predecessor instance's LLP 0053
     terminal retirement** (`active → retiring` — an existing transition
     that rejects render, write, and proof inputs and is committed in the
     lease artifact) *before* any successor establishment is published to
     renderers;
  2. fresh sync establishes the `qmk1` address through LLP 0157 §D7;
  3. the predecessor's retirement **finalizes** under its own owner's
     rules (destructive transition, frontiers preserved).
  Crash after (1): the legacy record is `retiring` — non-renderable — and
  the successor not yet established: a data gap, never a dual render;
  re-running the protocol resumes at (2). Crash after (2): successor
  renderable, predecessor `retiring`, finalization pending. At **no** cut
  are both renderable. This maps onto the owners' wording — the
  non-adoptable record "coexists non-renderably until fresh sync creates
  the new address, then retires" (LLP 0043's boundary note; LLP 0157
  §Migration) — with retirement *beginning* first (the non-renderability)
  and *finalizing* last; the dated LLP 0043 boundary note at acceptance
  pins this reading explicitly. Direct adoption (atomically moving
  payload, lease, fences, obligations, and pending-intent references)
  becomes available only if the lease store first moves into this shared
  transaction domain — a future dated LLP 0043 step (OQ5).
- **No dual identity:** one logical retained result is never simultaneously
  renderable under two families; the protocol above leaves exactly one
  renderable copy at every cut.
- **Pending intent is sacred:** no migration, format change, or family
  convergence drops, reorders, or double-replays outbox records; a
  migration that cannot preserve them refuses (§D1).

## D7 — The gated evaluation profile and the carried amendments

### Current law, restated

Before the 2026-08-04 ship-gate firing, LLP 0008 DK-9's text and LLP 0080's
opaque-snapshot-only retention governed unchanged. That pre-gate status is now
historical for owner-reclassified `result-transform-snapshot-v1` plans on the
qualified browser IndexedDB and Node/file carriers: the closed transform below
is a shipped public surface there. The same floor remains current law for every
unreclassified plan and for nonclaiming memory and Expo carriers. No dependency
closure is locally re-authorized and no unprojected joined rows are retained for
local recomputation; a disallowed attempt refuses with
`SNAPBACK_LOCAL_EVALUATION_UNADMITTED`.

### The evaluation model: `result-transform.v1`

The commissioned phrase "local plan evaluation over retained fragments"
needs one exact model, and this Spec pins the narrow one. A fragment is an
opaque, contract-validated whole-page **result** (LLP 0157 §Vocabulary) —
the plan's post-projection output, not its source tables. Re-running a
relational plan's own pipeline (LLP 0080's normative
`filter → cursor → order → take → join → projection` consumes source rows
and indexes) over its projected output is incoherent, and holding source
rows to make it coherent is exactly the custody LLP 0080 forbids. What
local evaluation admissibly means, and all it means in this Spec, is a
**separate, closed, versioned transform over the established result**,
with its own dual-runtime reference implementation as the parity target —
deliberately *not* the plan's server pipeline.

The transform is a record, not prose:

```ts
type TransformPlanV1 = Readonly<{
  format: "snapback.result-transform.v1"
  materializationKey: string      // the single input address
  overlay: "apply" | "none"       // adjacent optimistic layers, or base only
  filterGrammar: "basic-v1"
  filter: readonly {              // conjunction; [] = no filtering
    field: string                 // present in the projected result contract
    op: "eq" | "ne" | "lt" | "lte" | "gt" | "gte" | "in"
    value: unknown                // canonical client scalar; op "in" takes a
                                  // nonempty array of scalars
  }[]
  order: readonly {               // may be empty; duplicate fields refuse
    field: string                 // present in the projected result contract
    direction: "asc" | "desc"
  }[]
  limit: number | null            // nonnegative safe integer, or null = none
}>
```

`TransformHashV1` is SHA-256 over `snapback:result-transform:v1:` plus the
record's RFC 8785 JCS bytes; it is the conformance corpus's fixture
identity and appears beside transform facts in inspection — no admission
trusts it. Every record is closed: unknown fields, an out-of-set value, a
field absent from the projected result contract, a duplicate order field,
a negative or non-integer limit, an operator outside this record, or a
`materializationKey` differing from the executing address each refuse.

**The pipeline is fixed and total.** Execution order, normative:

1. **Base assembly:** the address's established result — the requested
   page's rows in their established order, or the complete page-set
   chain's pages concatenated first-to-terminal, each page's rows in
   their established order, all at one version (a broken or
   mixed-version chain refuses; the transform never assembles across
   versions). V1 admits only results whose contract is a row sequence;
   any other result shape refuses.
2. **Overlay application** (iff `overlay: "apply"`): the address's
   adjacent optimistic layers, in their owners' layer order
   (LLP 0107/0114/0133 semantics, consumed — the transform invokes, never
   redefines, layer application). **This step is client-only** — see the
   parity split below.
3. **Filter** over the (possibly overlaid) rows: the conjunction of the
   `basic-v1` comparisons, evaluated per row over projected fields. The
   comparison families are exactly three, shared with step 4: `eq`/`ne`
   (and `in`, the disjunction of `eq` over its array) use canonical
   client-value equality; `lt`/`lte`/`gt`/`gte` use step 4's total
   scalar comparator (so a cross-type comparison is well-defined by type
   rank, never a runtime error); and a **non-scalar** value — in a
   filter field, an order field, or a filter operand — refuses the
   transform's execution with the registered code, where the `in`
   container is the **sole permitted array operand**: the array shape is
   admitted by the record and the non-scalar rule applies to each of its
   elements, which must individually be scalars. An absent projected
   field reads as `null`.
4. **Order** by the `order` entries, in sequence, each ascending or
   descending under one total scalar comparator: values order first by
   type rank `null < boolean < number < string` (booleans `false < true`;
   numbers by numeric order after LLP 0051's canonical numeric
   normalization; strings by unsigned UTF-8 byte order) — mixed scalar
   types therefore *order*, they do not refuse — and a non-scalar value
   in an order field refuses. Ties preserve base order (stable sort).
   These v1 comparator rules are frozen by the conformance corpus's
   golden vectors.
5. **Limit** over the ordered sequence (`0` yields the empty result).

Output rows use the same canonical client-value encoding as the
established result. The transform's output is presentation-only: it
carries the base's completeness/freshness facts, never upgrades
`unknown`, never proves absence from unhydrated rows, and never mints,
extends, or re-scopes a proof; transform output enters no witness and no
digest that any admission trusts.

Contract:

- **Admission is per-plan and owner-issued** — a plan participates only by
  carrying the `result-transform-snapshot-v1` retention class (below);
  the store never infers evaluability.
- **Parity target, split at the overlay:** the dual-runtime oracle covers
  the **pure transform** — a reference implementation of `TransformPlanV1`
  with `overlay: "none"`, implemented on both the client runtime and the
  server, run over the same established result bytes at the same version;
  the conformance corpus (proposed as an LLP 0051 D5 extension, LLP 0157
  OQ9; that owner decides; if declined, a standalone corpus with the same
  pinned-identity discipline) freezes fixed inputs and expected outputs at
  pinned evaluator identities. **Overlay application cannot be
  server-verified** — shipped optimistic layers are arbitrary client
  callbacks (the LLP 0107/0114 external-store surface), so
  `overlay: "apply"` is the client-side composition of that shipped layer
  machinery with the pure transform, verified by client-only oracles (the
  existing external-store suites plus S6's composition leg), never by the
  dual-runtime corpus. The plan's own source-row pipeline is **not** the
  reference and is never invoked locally.
- **The overlay boundary and its cost, explicit:** overlay application
  over *live/current in-memory* results remains the LLP 0107/0114 owners'
  existing, ungated surface — nothing here re-gates it. What this profile
  gates is overlay recomputation **over a retained base** (and any
  filter/order/limit over retained fragments). Adopting that for a plan
  requires per-plan reclassification to `result-transform-snapshot-v1`,
  which by the crosswalk below rotates the plan's identity and address
  and forces fresh establishment — a deliberate, visible adoption cost,
  not an ambient upgrade. (The shipped restart behavior — retained rows
  render pre-intent, LLP 0090 D3 — is exactly the ungated baseline this
  profile exists to improve on, plan by plan.)
- **Consumers:** the intended invokers are the LLP 0051 widget-refresh
  seam and the LLP 0107/0114 hook layer; the authoring surface for
  transforms rides OQ8 with the registration API.
- **Refusals are closed:** cross-address input, unprojected fields,
  changed canonical args (a different args value is a different
  `QueryMaterializationKeyV1` — the transform never impersonates a
  different registered query), mixed-version bases, and unadmitted plans
  each refuse with a stable reason (placeholder rule above).

Full plan evaluation over authorized *source-row* fragments — the model
that would answer arbitrary registered queries locally — is explicitly out
of this Spec: it requires the cross-query normalization and
projection-aware authority design LLP 0157 §D7 gates (LLP 0155 OQ2), and
nothing here advances that gate.

### The carried amendments

Per the owners' dated 2026-08-02 commissioning notes ("the amendment lands
here, dated, alongside the Move 1/2 owning Spec"), this Spec carries the
LLP 0008/0080 texts, plus the two consequential amendments the round-2/3
review loop surfaced — the LLP 0157 classification widening and the
LLP 0155 §Move 2 revision that makes this Spec's deliberate
result-transform narrowing an explicit owner decision rather than a
silent substitution. All four land in the owning documents, dated, at
this Spec's acceptance.

**Proposed LLP 0008 DK-9 amendment:**

> **Dated amendment (with LLP 0166's acceptance):** the client-store
> semantic contract is widened by deliberate new author policy (LLP 0155's
> commission; not the SQL revisit trigger, which LLP 0051 answered without
> SQL): in addition to the document/result cache plus outbox, the store may
> hold LLP 0157 materialization records — opaque authorized query-result
> fragments with completeness proofs — and, for plans carrying the
> LLP 0080 `result-transform-snapshot-v1` class, a conformance-proved
> evaluator may apply LLP 0166 §D7's closed `result-transform.v1` profile
> over a single materialization address's fragments. The contract remains
> the observable-state list, not SQL; nothing in the wire contract may
> require SQL semantics client-side; cross-query canonical-row
> normalization remains unadmitted (LLP 0157 §D7's gate).

**Proposed LLP 0080 retention-class amendment:**

> **Dated amendment (with LLP 0166's acceptance):** the closed retention
> set gains `result-transform-snapshot-v1`: an admitted plan whose result
> is retained as opaque authorized fragments with completeness witnesses
> under LLP 0157 may additionally be served through LLP 0166 §D7's closed
> `result-transform.v1` profile **over its own retained fragments only**,
> for the local materialization LLP 0155 Move 2 describes, under that
> Spec's conformance gate. Admission is per-plan and owner-issued. The
> class inherits every `opaque-authorized-snapshot-v1` custody rule
> (lease, authenticated principal, reconnect); it still never retains
> unprojected joined rows, never re-authorizes a dependency closure
> locally, never re-executes this RFC's plan pipeline locally, and never
> permits cross-query evaluation. Plans without this class keep
> opaque-snapshot-only semantics unchanged.

**Proposed LLP 0157 classification amendment:**

> **Dated amendment (with LLP 0166's acceptance):** the closed retention
> unions in §D2's `NodeCapabilityBindingV1` and
> `PlanCapabilityClassificationV1` gain the value
> `result-transform-snapshot-v1` (LLP 0080's amended class). The value
> is owner-issued like its peers and enters the same hash preimages:
> reclassifying a plan therefore rotates its `NodePlanHashV1`,
> `PlanHashV1`, and `QueryMaterializationKeyV1`. Adoption is per-plan
> opt-in — an unreclassified plan's identity, addresses, and retained
> state are byte-unchanged, and the served function/capability manifests
> (§D2's producers) emit the new value only for owner-reclassified plans —
> and a reclassified plan derives a fresh materialization address whose
> predecessor retires through ordinary lifecycle (fresh establishment at
> the new address; the predecessor is never relabeled in place). §D2's
> golden and near-miss vectors gain the new value; §D4 continues to treat
> classification as a restated owner fact; §D7's storage profiles treat
> the class as `durable-fragments-v1`-eligible under
> `opaque-authorized-snapshot-v1`'s custody rules; §D7's "local plan
> evaluation over fragments" gate sentence reads on the revised Move-2
> profile (LLP 0155's dated §Move 2 note, below) — the gate itself is
> unchanged; and §D3's closed event vocabulary gains one store-policy
> event, **payload compaction** (LLP 0166 §D5): discard the record's held
> fragments, proofs, page-set manifests, and memberships without lowering
> or releasing any LLP 0053 disposition; derived status `unknown`; the
> instance identity, fences, and frontiers are preserved and a later
> establishment loads the same instance. No other semantics change.

**Proposed LLP 0155 amendment (dated note in §Move 2 — Query execution):**

> **Dated note (with LLP 0166's acceptance):** the Move-2 owning Spec
> revises this section's commissioned outcome as a deliberate scope
> ruling. V1 local evaluation is LLP 0166 §D7's closed
> `result-transform.v1` profile: the plan's own established result,
> transformed (filter/order/limit over projected fields under a frozen
> total comparator, with optimistic-overlay composition as a client-side
> step), with a dual-runtime reference implementation of the pure
> transform as the parity target. This section's "generated query plans
> should run over the local store … the same plan evaluator, or two
> evaluators under a conformance corpus" is deliberately deferred, not
> implemented: a retained fragment is post-projection output, and
> evaluating plans over source rows locally requires the cross-query
> normalization and projection-aware authority design this RFC's OQ2
> gates. That fuller outcome remains reachable through OQ2's gate as a
> successor amendment; the "same canonical result ordering and
> projection" obligation applies to the transform's reference
> implementation in the meantime. Nothing else in Move 2 changes.

**Amendment crosswalk** — what moves, and which identities rotate:

| Closed set | Owner | Change | Identity consequence |
| --- | --- | --- | --- |
| DK-9 semantic contract | LLP 0008 | + materialization records; + `result-transform.v1` for admitted plans | none (semantic envelope) |
| Retention classes | LLP 0080 | + `result-transform-snapshot-v1` | none until a plan opts in |
| `NodeCapabilityBindingV1.retention` / `PlanCapabilityClassificationV1.retention` | LLP 0157 §D2 | + the same value; manifests emit it only for reclassified plans; §D7 gate reads on the revised profile; §D3 event vocabulary + the payload-compaction event | per opted-in plan: `NodePlanHashV1` → `PlanHashV1` → `QueryMaterializationKeyV1` rotate; fresh address; predecessor retires normally |
| Move-2 local query execution outcome | LLP 0155 §Move 2 | commissioned same-plan-evaluation revised to the `result-transform.v1` profile; source-row evaluation deferred behind OQ2 | none (scope ruling) |

### Ship gate

Evaluation ships only when **all** hold: the four amendments landed (at
acceptance); the pure-transform conformance corpus passing at pinned
evaluator identities on both runtimes and every claiming carrier; the
client-only overlay-composition oracles green; and the §Acceptance
evaluation oracles (S6) green. Document acceptance alone ships nothing; a
plan ships nothing until its owner reclassifies it.

**Dated ship-gate firing (2026-08-04):** all four amendments were already
landed at acceptance. The retained
`tests/conformance/result-transform-ship-gate-v1.receipt.json` records the
56-case corpus at format/profile v1, pinned evaluator identities
`snapback.result-transform.rust.v1` and
`snapback.result-transform.javascript.v1`, exact Rust/JavaScript outcome-byte
agreement 56/56, and the same 56/56 outcomes through both claiming carrier
contexts (`browser-indexeddb` and `file-node`). The nonclaiming memory and
current Expo contexts each refuse 56/56 with
`SNAPBACK_LOCAL_EVALUATION_UNADMITTED`; both client-overlay composition legs
are green. Shipping remains per-plan: only the server retention owner can emit
`result-transform-snapshot-v1`, which rotates `PlanHashV1` and the QMK; every
unreclassified plan still refuses at the floor before transform inspection.

## D8 — The agent-safe seam (LLP 0161 OQ5)

LLP 0161 OQ5 asks which agent-ideal properties the LLP 0155 local-sync
direction needs natively on the *client* store, and whether that pulls any
sequencing forward. LLP 0162's Non-goals keep the client store outside the
host-side profile (owned by LLP 0043/0053/0090 and LLP 0155's client arm).
The answer, per property:

| | Property (LLP 0161) | Client store disposition | How |
| --- | --- | --- | --- |
| P1 | fork | **never native** | Client speculation is the optimistic-layer stack (LLP 0107/0114/0133): presentation-only layers, rebase not promotion, no storage fork, no merge. Host forks reach the client as different activations/streams — an LLP 0158 derived deployment has its own identity, so its materializations derive different `QueryMaterializationKeyV1` addresses and its outbox is fenced by the LLP 0053/0059 barriers; fork isolation falls out of addressing, not new machinery. |
| P2 | maintained digests | **consumed** | The store verifies server-issued digests and signatures (`ResultDigestV1`, proof signatures, `mset1`/`seq1` content digests) at commit, boot, and render; it maintains no Merkle structure and derives no digest authority. |
| P3 | provenance | **consumed via identity binding** | Every record binds its authority partition, activation, and (outbox/layers) producing mutation identity — LLP 0157/0043/0053 obligations already. No per-commit principal journal exists client-side, and none is needed: the client is not an audit substrate. |
| P4 | history | **never native** | The only temporal fact is `retained` freshness at a proof/version — as-of labeling, not as-of reads. Bounded record history is host-side (LLP 0088, LLP 0162 §6); the client never synthesizes historical states. |
| P5 | read/write sets | **never in v1; narrow at the evaluation seam** | Local-read admission classes belong to Move 3's owners (LLP 0129/0051/0133). The store stores references; post-amendment, the evaluator's input is statically the single address (§D7) — a declaration, not captured-set machinery. |
| P6 | replay | **split: ingestion consumed, intent replay native and shipped** | Journal-delta ingestion is the consumed LLP 0090/0034 lane (the sync engine already replays the server journal — the prior art OQ5 itself cites). Durable *intent* replay is the outbox: native, shipped, exactly-once (LLP 0043). Boot-time IR replay over this store arrives with Move 3, reading the store, not implemented by it. |
| P7 | evolution | **native, narrow** | Versioned store formats with fail-closed compatibility refusal and pending-intent-preserving migration (§D1) — LLP 0126's Triplit-style compatibility-refusal prior art. Opaque fragments are the schemaless-view move from the same survey: application schema changes rotate identity (activation → new address → fresh sync) instead of migrating client rows; the store needs no client-side schema migrator for application data. |
| P8 | settlement | **split: base native and shipped; LLP 0163-family contracts accepted but unimplemented** | *Shipped half:* the durable ordered outbox, exactly-once settlement, acknowledgement ledger, and refuse-at-capacity custody (LLP 0043) — this store's obligations today. *Contract half:* the identity-range/epoch client contracts — client-minted `operationId` reuse across retries, atomic persistence of server-preallocated identity ranges before use, uncovered-queueing on exhaustion, honest `result-expired` / `identity-horizon-passed` handling (outcome-unknown, never terminal `failed`) — are landed 2026-08-03 *semantic amendments* in LLP 0043/0012/0095 whose schemas belong to Draft LLP 0163 and which no shipped code implements. Move 2 does **not** depend on them; when implemented they extend the outbox section without changing this Spec's profile or claims. |
| P9 | admission | **partial: enforcement native, policy consumed, per-principal quotas open** | Fenced compare-and-commit on every operation, the store-wide authority barrier, single-writer locks, and delete/quarantine-before-read enforce LLP 0053/0055/0059 policy the store never sets. The §D3/§D5 custody budgets are per-*store* resource bounds; **per-principal / per-authority-partition quotas do not exist** — in a multi-grant agent client one grant can monopolize the retention budget and establishment queue. That containment gap is real and recorded (OQ11), not claimed away. |

**Sequencing answer:** nothing is pulled forward. The client store consumes
only landed contracts (LLP 0157's records; the 2026-08-03 dated
amendments in LLP 0043 §LLP 0162-amendment and LLP 0012/0095 — semantic
contracts, per the P8 split) and requires no LLP 0163/0164/0165
implementation, no commit envelope, no fork substrate, and no proof-domain
machinery to ship. The Track B specs owe this store nothing new, and this
store claims none of their surface — coordination is complete when both
sides keep citing the same landed amendment set.

## D9 — Carriers, storage profiles, arms, and the bundle

### Carrier matrix

| Carrier | Profile ceiling | Notes |
| --- | --- | --- |
| Browser IndexedDB + Web Locks | `durable-fragments-v1` | the §D1 successor schema; multi-tab per shipped lock discipline + §D2 broker |
| File (Node) | `durable-fragments-v1` | v3 blob format; lock-file liveness discipline; no cross-process demand channel in v1 (§D2 degradation; OQ12) |
| Expo/native registered files | `durable-fragments-v1` once LLP 0043's durability qualification holds (the shipped adapter is `durable: false` for settlement custody today) | rides the same file format |
| Memory | `volatile-online-v1` | honest degradation; restart `unknown`; durable requests refuse with the structured GAP |
| SQLite (any target) | `durable-fragments-v1` | permitted behind the DK-9 seam, required nowhere |

Every carrier implements the same semantic operations; capability reports
name the implementation, durability, profile, and reason (the shipped
`rqsStoreInfo` surface generalized to the store domain). A target that
cannot honor a requested profile refuses at registration, never silently
degrades.

### Arms

- **JS/React (Full client):** the primary consumer; hooks project
  freshness/completeness/retention facts per LLP 0107/0114.
- **Contract arm:** keeps its stricter lease/barrier custody path and its
  separate LLP 0043 store in v1, honestly advertising its narrower profile
  (LLP 0157 §D7 permits exactly this); whether it converges on an identical
  materialization contract or a deliberately narrower one is LLP 0155
  OQ16, staged behind §D6's convergence protocol (OQ5).
- **Micro (LLP 0147):** excluded — Micro v1 explicitly omits RQS, retained
  reads, the durable outbox, and local execution; this store is a
  Full-profile capability (LLP 0145's packaging classes), and any
  local-sync Micro module is a separate LLP 0147-family proposal.

### Bundle accounting

Per LLP 0155's commission, the first shipping slice records its measured
Full-client attribution (module-own bytes for the store sections, against
LLP 0145's F2 module rows for the shipped store family — RQS core and
stores 16.5 kB, RQS file store 7.8 kB, shared canonical-value/outbox code
6.7 kB, minified module-own) as a measured artifact, not a prose claim;
rollout stays additive under LLP 0145's rule (new capability surface,
never a narrowing of a published entry point).

The Full store family is nevertheless **not** part of the client root's
initial static closure. `index.mjs` retains the client methods, but crosses a
literal dynamic-import boundary at the first qmk1 materialization,
programmatic registration, preload registration, or broker construction.
The joined promise initializes the ledger before constructing the policy and
broker, so the asynchronous module boundary does not reorder registration,
writer, or maintenance-scheduler semantics. Materialization establishment and
finite-completeness verification use the same construction-seam rule; the
React failure/retry and development-replay helpers are likewise optional to
the ordinary React entry closure.

The historical `./rqs-preload` entry remains the lightweight Channel A/D4
registry surface. Registration-record derivation is ledger-owned and loads
with the Full store runtime; mixed-route v2 artifact validation is an explicit
`./rqs-registered` opt-in entry. The bundle instrument externalizes only these
literal dynamic imports while measuring an initial static entry, asserts that
none of the optional runtime modules appears in any frozen static profile,
and leaves the ordinary browser-closure proof responsible for resolving and
bundling the optional chunks. The new `./rqs-registered` public profile joins
prospectively in the LLP 0166 finish-out supplemental ledger; no historical
ceiling is raised.

### 2026-08-04 measured implementation reconciliation

The earlier `baseline.local-persistent-store.v1.json` figures remain an
immutable historical receipt, but they no longer describe the implemented
program. The current carrier-exit attribution is the superseding
`tests/acceptance/fixtures/local-persistent-store/bundle-attribution.2026-08-04.v1.json`:
622,876 / 172,347 / 140,392 minified / gzip / Brotli bytes for the measured
full-client closure, 112,005 module-own minified bytes across the nine store
modules, and a passing 73,221-byte browser closure. The 2026-08-03 fixture is
an immutable predecessor, not the current attribution.

The additive LLP 0166 finish-out metrology is owned by
`SUPPLEMENTAL_LEDGER_SPECS` in `scripts/client-bundle-metrology.mjs`;
`tests/fixtures/client-bundle-metrology/result-transform-profiles.v1.json`
deliberately carries an empty `profiles` array rather than the profile IDs.
Against the current tree, `public-subpath-result-transform` measures 14,803 /
5,243 / 4,674 minified / gzip / Brotli bytes; its module-own minified
attribution is 10,939 for `result-transform.mjs`, 3,105 for canonical client
values, and 483 for the evaluation floor. The new opt-in
`public-subpath-rqs-registered` profile measures 32,045 / 10,647 / 9,380. The
same first-run ledger also closes the previously uncovered namespace rows for
the IR evaluator, local-read admission, and optimistic rebase; it does not
rewrite any historical ceiling. The listener-capable run created the immutable
`tests/fixtures/client-bundle-metrology/baseline.result-transform.v1.json`,
which freezes those five additive profiles and their behavior-train evidence.

**Dated integrated-review metrology amendment (2026-08-04):** review finding
3 added context-bound pending-outcome replay to the opt-in registered entry
after its supplemental ledger was first frozen in this same uncommitted diff,
so that ledger is corrected in place from 31,913 / 10,621 / 9,341 to 32,045 /
10,647 / 9,380 minified / gzip / Brotli bytes with an explicit amendment
record. Review findings 6 and 9 add the legacy no-op guard and typed optional-
runtime load failure to the already-frozen `public-subpath-rqs-preload`
workload. Its 5,505 / 2,555 / 2,147 predecessor remains byte-identical;
`baseline.local-persistent-store-review-fixes.v1.json` SHA-binds that complete
predecessor and freezes only the successor profile at 5,549 / 2,593 / 2,177.
No other ceiling changes owner or value.

The dated 2026-08-06 carrier exit is 17 PASS / 0 GAP / 0 skipped. It consumes
the dated Triage Move-1 8/8 receipt and qualified Fleet Move-1 8/8 receipt;
the Fleet receipt also retains the frozen custody and hydration measurements.
Those receipts satisfy the local publication predicate and are bound through
`crates/snapback/src/local-persistent-store-publication.v1.json`. This closes the Fleet row
and Move 1 only: Experimental maturity is unchanged, and remote-service,
Cloudflare, public-package, and hosted targets remain nonclaims.

## Guardrails

- The sync set is the registration set for the governed families: no
  unregistered query is hydrated; nothing unregistered in a governed
  family is retained beyond its release grace except blocker-held payload
  and stub bookkeeping, each ending with its cause; every retained byte
  in the domain has a nameable retaining reason from §D5's closed
  `retainingReason` union.
- The store never widens an owner classification — not retention, not
  liveness, not authorization; a registration is interest, never authority.
- No local answer claims authority without a valid witness for its exact
  scope, version, and authority partition — LLP 0157's proof for
  `authoritative`, LLP 0043's witness+lease for
  `lease-authorized-retained`; `unknown` is the honest default; nothing
  local mints, extends, or upgrades a proof.
- Owner state always wins: demand never resurrects, delays, or downgrades
  an LLP 0053 transition.
- Compaction reclaims payload only: it never removes fences, tombstones,
  allocator state, or durable registrations; never reclaims pending
  intent or unacknowledged settlement state; never touches a
  `demanded-active` record; and is never a substitute for an identity
  barrier or a disposition.
- Migrations preserve pending intent, acknowledgement custody, durable
  registrations, and grace clocks or refuse; corrupt/future bytes are
  typed diagnostics preserved in place; only `wipe` (per §D1's exact
  scope) or the unparseable-reset store-identity rotation replaces them.
- One logical result is never renderable under two address families; the
  §D6 convergence protocol closes the predecessor before the successor
  publishes; legacy records are never relabeled in place; no
  cross-artifact atomic migration is claimed while the artifacts do not
  share one transaction domain.
- No SQL semantics in the client contract; no cross-query normalization;
  no cross-address evaluation; no local execution of the plan's
  source-row pipeline; no client-side authority over completeness.
- Single writer per store; non-writers announce demand through the broker
  and adopt — they never write.

## Executable acceptance

LLP 0157's oracles A5–A9 and its transcribed Move-2 carrier exit (browser
terminate/relaunch over real IndexedDB, two contending tabs, file/native
relaunch, retained render while unreachable, the authority-transition
matrix, bounded custody under churn, footprint/hydration measurements)
gate the shared substrate and are consumed, not duplicated. This Spec adds
store-policy oracles:

1. **S1 — sync-set fidelity.** Register/unregister across all three
   sources; for the `qmk1` family the hydrated-and-retained set equals
   the registration set plus in-grace releases plus blocker-held and
   stub records named by inspection, at every step; for the
   legacy-resume family only hydration is governed — a released legacy
   registration's entry legitimately persists under LLP 0090's lifecycle
   as a grandfathered entry outside the equality; an unregistered query
   never hydrates; the policy record names each record's retaining
   reason; release starts grace; grace expiry GCs. Grandfathered variant:
   a store pre-populated with legacy entries — they are excluded from the
   equality, appear with the grandfathered-legacy reason, and are
   untouched by registration churn. Restart legs: `programmatic`
   registrations survive, `active` are reaped, `preload` re-derive from
   the manifest in force. Cap legs: the 513th durable registration and a
   16 KiB-exceeding registration each refuse with their stable
   diagnostics. Grace-retention leg: a durable-requested record's payload
   survives release into a `durable`-pinned grace; a `"none"`-pinned
   release retains nothing. Broker legs: a non-writer tab's announced
   demand keeps its record `demanded-active` (non-compactable);
   heartbeat expiry reaps it; a stale-revision or reaped-`contextId`
   announce is ignored (the context re-mints and re-announces); a
   multi-partition context announces two partitions' sets independently
   and both stay demanded; writer handoff suppresses every
   demand-derived transition until roster reconciliation and rebuilds
   the ledger; a forwarded `programmatic` registration commits durably
   with `RegisterOutcomeV1` — including the writer-crash-before-outcome
   case, where the retry answers from the durable consumed-request
   memory across writer restart — and `RegisterReleaseV1` from a
   non-writer releases it idempotently, with a cross-partition release
   refused; a delayed duplicate forward after release replays its
   recorded outcome and a fresh forward naming the released
   `registrationId` refuses; a release naming a never-committed
   `registrationId` returns `released` and tombstones it in the caller's
   partition, so the later-arriving original forward refuses
   (release-before-first-forward reordering) while a forward for the
   same id in a *different* partition is unaffected; a refused release
   leaves no tombstone; the two overflow schedules are exercised by
   name at the exact 1,024/1,025 boundaries —
   *release-before-first-forward* (the tombstone alone governs: with
   the target plus 1,023 newer tombstones the delayed forward still
   refuses; inserting the 1,024th newer tombstone — the 1,025th total —
   evicts the target, and the corpus verifies the documented
   recreate-and-recover residue) and *previously-consumed-forward
   replay* (requires the consumed-outcome entry evicted too); a
   stale-`writerGeneration` forward refuses; requestId
   uniqueness is per-context (two contexts reusing the same requestId do
   not collide); a partial multi-partition handoff — pair A re-announcing
   and heartbeating while pair B stays silent — keeps suppression active
   until pair B re-announces or its own pair deadline (the 45-second
   expiry from `WriterHelloV1`) reaps it as a pair, with the context
   remaining live and pair A's demands intact; the 129th live pair
   refuses and runs volatile-online; a malformed announce (one bad entry)
   applies nothing and consumes no revision; a delayed announce from a
   reaped `contextId` in memory is ignored after writer restart;
   `retentionRequest` downgrade to effective `"none"` compacts the
   payload at the next maintenance pass while the demanded
   materialization continues volatile.
2. **S2 — the answer table, executed.** For every row of §D4's answer
   table (all three families, every listed state, × {connected, offline}):
   the answer class, freshness label, store mutation, and resume action
   match the table exactly; no cell fabricates authority; row 4/15 defects
   delete before read; row 10 withholds `resumeFromToken` while rendering
   `retained` + `pendingIntentsAtSeed`; row 12 verifies indefinite
   labeled-retained offline display with rung-3 fallback when connected;
   row 14 reports `lease-authorized-retained`, never `authoritative`; row 16
   proves no lease is present while proof/witness/fence/trusted-activation
   validation remains mandatory and the offline label remains `retained`.
3. **S3 — grace, compaction, and partitioned budgets.** Fill the
   materialization envelope past budget with mixed demand states,
   `idleTtlClass` values, pending intent on some records, unresolved
   obligations on others, while the legacy section holds entries:
   compaction follows §D5's order with the address-byte tie-break
   (identical on every carrier), skips every blocker, refuses rather than
   touching `demanded-active`, and **never reclaims a legacy entry**;
   legacy commits evict per the shipped comparator within their own
   envelope and never touch materializations; compacted stubs retain
   fences, tombstones, and durable registrations, derive `unknown`, and
   rehydrate at the same `query_instance_id`; grace-lattice pin cases
   (last-snapshot rule): A (`pinned`) releases at t0, B (`default`) at
   t1 → the grace class is `default` (the merge immediately before the
   final release is {B}); B releases at t0, A at t1 → `pinned`; grace GC
   fires only release-anchored and never under a rolled-back clock;
   `pinned`-graced records are exempt from GC, excluded from pressure
   step 1, and fall only in pressure step 3. Blocker-held trace: a
   record whose predicate fails while pending intent holds it reports
   `safety-blocker` with the blocker kinds, renders per §D4's ordinary
   rules, and compacts at the first maintenance pass after blocker
   discharge; a compacted stub held only for fences reports
   `instance-bookkeeping`.
4. **S4 — successor-store parity and grandfathering.** The shipped
   store-parameterized resume suite (`rqs-resume-suite.mjs`) passes
   unmodified against the successor store format on every carrier; the D3
   outbox rule, arbitration, multi-tab adoption, `inProgress` refusal, and
   purge-on-invalidation behaviors are byte-compatible for the legacy
   section; legacy eviction uses the shipped comparator inside the
   untouched legacy envelope, and legacy entries never acquire grace,
   TTL, demand semantics, or cross-section pressure.
5. **S5 — migration and convergence.** A store with legacy resume entries,
   durable registrations, in-grace releases, and pending outbox intent
   migrates formats: intent preserved exactly (order, identity,
   acknowledgements), registrations and grace clocks intact; crash at
   every migration write boundary leaves the prior or successor state,
   never a hybrid. The `single_table_v1@1` leg runs both §D6 adoption arms:
   a rung-1/rung-2 proved current result receives a QMK proof and switches in
   one transaction; an identity mismatch or ladder fallthrough takes fresh
   establishment; the examined-entry refusal leaves a still-valid legacy
   entry labeled legacy; corruption deletes before fresh; every switch crash
   cut exposes only legacy or QMK; pending intent blocks the attempt; and the
   legacy token is never accepted as a QMK credential. Lease-family
   convergence runs §D6's protocol with a
   crash injected at each cut: after (1) the legacy record is `retiring`
   — non-renderable — and no successor exists (gap, not dual render);
   after (2) exactly the successor renders; at no point are both
   renderable; the retirement-begun state is durable in the lease
   artifact before any successor publication. Pending-intent leg: a
   convergence attempt against a predecessor with dependent queued
   intent refuses without touching the intent; after settlement (or
   explicit discard) the protocol proceeds. Corrupt-mid-migration leg:
   a store found unparseable during a format migration takes §D1's
   identity-rotation reset, never a partial migrate.
6. **S6 — evaluation gate.** Before the amendments/corpus: any
   `TransformPlanV1` attempt refuses with the registered closed reason
   and opaque-snapshot semantics hold. After: the pure-transform
   (`overlay: "none"`) dual-runtime corpus passes at pinned evaluator
   identities on every claiming carrier — output over frozen fragment
   fixtures byte-matches the reference on both runtimes, exercising the
   type-rank comparator (null/boolean/number/string ordering across mixed
   scalar types, non-scalar refusal), cross-type range filters, absent
   fields reading as null,
   `desc` direction, stable ties preserving base order, `in` filters
   (including a non-scalar element refusing while the array container is
   admitted), `limit: 0`, and page-chain assembly; the composition leg
   verifies
   `overlay: "apply"` client-side (shipped layer machinery over the
   retained base, then the same pure transform) against the client-only
   oracles; an unprojected order or filter field, a duplicate order
   field, a cross-address key, changed canonical args, a mixed-version
   base, a non-row-sequence contract, and an unreclassified plan each
   refuse; reclassification rotates the plan's address per §D7's
   crosswalk and the predecessor retires normally.
7. **S7 — rotation versus compaction.** Rotate authority (user switch,
   client-wide) and activation (deploy) with the store at budget pressure:
   predecessors are destroyed/quarantined via the barriers before any
   successor renders, regardless of compaction state; compaction alone
   never stands in for a barrier (probe: a barrier-pending record is not
   compactable-to-skip the barrier). Grant-scoped leg: a multi-grant
   client revokes one grant — only that grant's addresses, registrations,
   and outbox scopes are affected per §D1's scoping; the surviving
   grant's custody and acknowledgements are byte-untouched; the handle
   key rotates only on the client-wide barrier. Unparseable-reset leg: a
   corrupt store resets by store-identity rotation — fresh
   `clientStoreId`, fresh allocator, fresh handle key, old bytes
   destroyed, and the rotation rides the LLP 0059 barrier.
8. **S8 — capability honesty.** Each carrier reports implementation/
   durability/profile truthfully; a durable request on a volatile carrier
   refuses with the structured GAP; version-skewed store opening fails
   closed with its stable diagnostic; the policy record's ceilings match
   the enforced constants, its addresses carry exactly one retaining
   reason each, and it exposes no canonical args, no owner-context
   labels, and no other partition's addresses.

## Migration and compatibility

- Existing `liveQuery`, generated references, hooks, and the Contract arm
  are unchanged; registration is additive (active use already registers;
  routes manifests already preload; `persistResume` maps per §D2).
- The Channel B store's contents migrate by format version under §D1's
  rules; its public behaviors (S4) are preserved for the legacy section,
  grandfathered under LLP 0090's exact lifecycle and budget envelope.
- `single_table_v1@1` registration changes no legacy key or record. Its §D6
  connected prove-or-fresh adoption is an explicit per-entry operation that
  switches only after a valid proof-backed QMK record is ready. The shipped
  implementation performs that switch; every legacy entry not yet adopted
  remains under its byte-exact owner lifecycle and budget.
- The LLP 0043 lease store remains a separate artifact; convergence is
  §D6's close-predecessor-first protocol only, until a future dated
  LLP 0043 step moves it into the shared domain; nothing here amends its
  custody semantics.
- Wire compatibility: this Spec adds no frame; the broker protocol is
  client-local (cross-context, not client-server); the proof-backed
  resume credential (OQ2) and any registration wire surface are dated
  LLP 0093/0094 amendments when proposed.
- Capability manifests distinguish implementation presence, carrier
  evidence, and product maturity (LLP 0155 P6); no capability advances on
  this document's acceptance.

## Non-goals

No whole-table or whole-database replication; no client-owned
authorization; no offline authority over shared data; no cross-query
canonical-row normalization (LLP 0157 §D7's gate, untouched); no local
execution of the plan's source-row pipeline (§D7's model is a closed
result transform only); no aggregate nodes (LLP 0130 SD-2); no second
sync engine beside LLP 0090's — and no LLP 0090 amendment (the legacy
population is grandfathered under its own untouched envelope, not
re-governed); no client mutation execution semantics (Move 3,
LLP 0129/0133); no host-side agent-safe primitives (LLP 0163/0164/0165);
no encryption-at-rest claim (LLP 0090 Q4's baseline stands); no
Micro-profile packaging; no change to outbox/settlement custody semantics
(LLP 0043's, composed not amended).

## Open questions

1. **RESOLVED, implemented, and published on the local contributor-source
   target (2026-08-04): `single_table_v1@1`.** Charlie
   accepted the LLP 0004/0007 closed normalization and class-only examined-
   entry guard, LLP 0157 registered class 4 of 6 through `single-node.v1`,
   and Arm A carries Channel-B authority as
   `rqs-authority-independent-snapshot-v1` with no anonymous-lease
   commissioning. §D3 records the QMK population/persistence predicate and
   §D6 the connected prove-or-fresh same-domain adoption contract. The
   implementation program landed on 2026-08-03; the shipped client now
   implements and activates the adoption sequence. The 2026-08-06 retained
   carrier receipt satisfies 17 PASS / 0 GAP / 0 skipped, while the Triage
   and Fleet receipts each satisfy 8/8. The publication carrier binds that
   closed local evidence into the capability projection. Other targets remain
   fail-closed.
2. **A proof-backed resume credential** for `qmk1` materializations —
   binding resume-token identity to the materialization key and held proof
   so fresh establishment can use ladder rungs 1–2; dated
   LLP 0090/0093/0094 amendments.
3. **A `warm` sync class for idle registrations** — standing subscriptions
   for preloaded-but-unmounted queries; needs fan-out cost evidence before
   any obligation is created.
4. **Budget, TTL, cap, and cadence values** — the v1 provisional
   constants (32 MiB / 256 records / 1,024 fragments materialization
   envelope; 512 durable registrations at 16 KiB each; 14-day grace;
   15/45-second heartbeat/expiry; 4 concurrent
   establishments; 64 live contexts / 128 live pairs / 256
   reaped-context memory / 1,024 consumed-request outcomes / 1,024
   released-registration tombstones / 64-byte identifiers / 256 KiB
   broker messages) await the corrected, reason-based Triage custody freeze and
   Fleet's footprint after the registered (2026-08-06, LLP 0157 v0.11)
   `snapshot-batch.v2` profile's implementation before their first measured
   revision. The immutable
   2026-08-03 Triage predecessor captured pre-
   maintenance payloads and is superseded for this purpose; the fresh dated
   fixture must retain one registered payload and compact the 20 released
   `none` records to inspected stubs. The constants surface in the policy
   record so revision is observable. (The handoff-suppression
   bound is deliberately not an independent constant: it is the
   heartbeat expiry, applied per roster pair during reconciliation —
   §D2.)
5. **Contract-arm convergence** (LLP 0155 OQ16) — identical materialization
   contract or deliberately narrower profile; and the prerequisite
   question of whether/when the lease store moves into the shared
   transaction domain (the dated LLP 0043 step §D6 names), which is what
   would make direct adoption exercisable at all.
6. **Encryption at rest** (LLP 0090 Q4) — unchanged baseline (OS-level
   protection); any change is that owner's.
7. **RESOLVED (2026-08-03): conformance-corpus ownership.** LLP 0051's owner
   accepted the result-transform corpus as a D5 extension in `aeba33a8c`; §D7
   binds its 56-case Rust/JavaScript and per-carrier gate to that corpus home.
8. **IMPLEMENTATION-RECORDED resolution (2026-08-04): programmatic
   registration and result-transform authoring.** The public client API is
   `registerQuery(generatedReference, { registrationId, args?, userId?,
   label?, requestedScope?, retentionRequest?, idleTtlClass? })` and
   `releaseQueryRegistration(registrationId, { userId? })`; both return the
   exact `RegisterOutcomeV1` envelope. The caller owns the stable,
   store-scoped `registrationId`; the client derives the generated qmk1
   address and owner-issued authority-partition digest, commits
   `source: "programmatic"`, and forwards through the qualified demand broker
   from non-writer contexts. Release is idempotent. This is the durable
   successor to `persistResume`, which remains the mounted `active`-source
   retention stand-in. Relational query owners may now explicitly author
   `retention: "result-transform-snapshot-v1"`; codegen carries the class into
   the server manifest and the composition identity, rotating `PlanHashV1`
   rather than relabeling an existing record. The public
   `evaluateLocalResultTransform` invocation and `./result-transform` subpath
   consume only proof-verified bytes at that fresh address; all other plans
   retain the floor refusal.
9. **Mixed-route register groups** — the LLP 0090 mixed-route successor's
   versioned profile; when it lands, its per-child liveness facts flow into
   §D2's obligations without new inference here.
10. **Concurrent-scope union semantics** — v1 serializes page demands and
    lets page-set demands subsume (§D2); whether simultaneous distinct
    page demands at one address deserve real union tracking is deferred
    until an application demonstrates the need.
11. **Per-principal / per-authority-partition custody quotas** (§D8 P9) —
    the store's budgets are per-store; a multi-grant agent client can
    monopolize them. Whether quotas partition by authority partition, and
    who owns the refusal semantics (this Spec with LLP 0055/0146's
    consumers), is open.
12. **A qualified cross-process demand channel for file carriers** — the
    shipped file carrier has none (§D2's degradation applies); whether
    one is worth qualifying (and its transport) is open with the carrier
    owners.

## Status

**Implemented as of 2026-08-04; accepted v1.0, amended v1.1.** Charlie Cheever
accepted the Spec on 2026-08-03
("flip to accept") after the LLP 0005 dual-family super-refine loop
converged **dual-READY at round 8** (Codex 0.97 with one editorial NIT;
Fable 0.90, its second consecutive READY, with one editorial NIT; both
applied in v0.9). The loop ran eight rounds the same day, fifteen
reviews received; every earlier verdict was NOT READY and every finding
was applied. All actual responses — including one interrupted Fable run
recorded honestly as no-review and a restored round-2 body with its
dated provenance-correction note — are preserved verbatim in
`llp/reviews/0166-local-persistent-store.{fable,codex}.md`; no prior
verdict is rewritten or counted as READY.

The acceptance landing carried the §D7 amendment set, dated, in the
owning documents — LLP 0008 DK-9, LLP 0080
(`result-transform-snapshot-v1`), LLP 0157 (both retention unions plus
the payload-compaction event), LLP 0155 §Move 2 — and the dated
boundary notes in LLP 0043 (v1 convergence order and preconditions),
LLP 0053 (store-policy composition, wipe/reset scoping), and LLP 0090
(successor declaration; legacy grandfathering). At that landing, acceptance
was semantic only. The implementation program then landed on 2026-08-03, and
the §D7 gate fired on 2026-08-04 at 56/56 exact outcomes for both evaluator
families and both claiming carriers; memory and Expo remain honest refusal
arms. `single_table_v1@1` implementation and activation are present. The
dated 2026-08-06 carrier receipt, qualified Triage receipt, and qualified
Fleet receipt now satisfy the separate local publication predicate at 17
PASS / 0 GAP / 0 skipped plus both workload exits at 8/8. This is not a
maturity promotion or a hosted/remote claim.

The v1.1 dated amendment recorded Charlie's semantic acceptance of
`single_table_v1@1`, Arm A, and the connected prove-or-fresh adoption
contract. That amendment's no-implementation statement is superseded by the
2026-08-03/04 program record above: the local target implements the class,
retention authority, no-lease proof path, generated mapping, and atomic switch,
but advertises it only after the receipt-bound publication predicate passes.
OQ2 remains a separate future resume-credential lane. DK-9's lock-diagnostic
spelling mismatch remains an owner-doc reconciliation item; this program does
not silently rename either shipped diagnostic.

## Local publication carrier amendment — 2026-08-04

LLP 0110's dated local-publication-authority amendment admits the exact
contributor-source `LocalCapabilityPublicationV1` carrier for
`single_table_v1`. That carrier binds this Spec's carrier-exit evidence, the
qualified Triage successor receipts, and the exact implementation sources;
the refreshed carrier exit in turn digest-binds the qualified Fleet successor
and budget receipts in its source provenance. The Fleet footprint/hydration
leg is now PASS from the retained 2026-08-06 witness, closing Move 1. The
carrier still does not generalize to public packages, remote services,
Cloudflare, or hosted targets, and its maturity remains Experimental.

The source-owned `local-persistent-store-publication.anchor.v1.json` is the
only carrier selector: its closed `published` record names `single_table_v1`
and SHA-binds the raw carrier bytes. Evidence refresh rotates the carrier's
three receipt digests and then the anchor digest; unchanged code validates the
anchor → carrier → receipts → source chain. Neither `crates/snapback/src/manifest.rs` nor the
conformance test changes during that publication operation.

When that carrier verifies, the local target may advertise the id at code-owned
`experimental` maturity. This publication does not weaken §D5/§D6: legacy
entries remain grandfathered under LLP 0090, while entry into the QMK
population is connected-only, prove-or-fresh, and one atomic same-domain
transaction. It also does not commission an `AuthorizedLease`; Arm A retains
`authorizedLeaseHash: null` and
`rqs-authority-independent-snapshot-v1`. Finite/page-set proof issuance landed with the
2026-08-04 LLP 0094 finite-carrier amendment
(`issues/closed/20260803-p1-server-proof-issuance.md`).

## Public-package advertisement amendment — 2026-08-06

**Author ruling (Charlie Cheever, 2026-08-06), executing
`issues/20260806-published-closure-gates-offline-retention.md` ("Route 2").**
The preceding amendment's sentence "it does not generalize to Fleet, public
packages, remote services, or hosted targets" is narrowed for public
packages only; remote services and hosted targets keep their GAPs, and the
Fleet leg is governed by its own same-day Move-1 closure record above.

A `public-package` build of the local target may advertise `single_table_v1`
at unchanged code-owned `experimental` maturity when three things hold
together, per LLP 0110's dated single-table public-package advertisement
amendment (which owns the normative wording): the clean-release
public-package build identity, the byte-identical embedded contributor
carrier chain of the preceding amendment, and a
`snapback.packaged-store-qualification.v1` receipt binding this Spec's
acceptance corpus run against the staged packaged closure — closure digest,
minting binary identity, and embedded carrier digest all revalidated at
startup. Absent or mismatched, the id stays a structured GAP exactly as
before. The bootstrap circularity is resolved by a loudly-marked, env-gated
qualification mode that admits the id solely for the acceptance run and is
not itself production authority.

This ruling trades a reviewed fail-closed trust root for reach, by author
signature, on three grounds: the store's behavioral acceptance is real and
embedded (§D7 56/56, the refreshed carrier exit at 17 PASS / 0 GAP / 0
skipped after the same-day Move-1 Fleet closure, Triage successor
receipts); the release cadence is still LLP 0041's sole-consumer
posture; and the surface stays bounded to apps that explicitly list
`single_table_v1` in `acknowledgedExperimentalCapabilities`. The signed
`PackageCapabilityAttestationV1` remains the end state (owner Charlie,
review 2026-09-30) and supersedes this conjunction when it lands. Every
0.1.x release re-mints the receipt against its own staged closure; the
0.1.11 staging lane is the first required mint.

**Shipped 2026-08-06.** The mechanism landed the same day: the
distribution-split predicate and receipt verification in `crates/snapback/src/manifest.rs`,
the `snapback packaged-store-qualification-receipt` mint subcommand, the
qualification-mode manifest marker, the co-installed-receipt loader seam in
`@expo/snapback-cli`, and the end-to-end harness
`scripts/packaged-store-qualification.mjs`. The mechanism was proven once
end to end on linux-x64 against a dry-run-staged nine-tarball
`0.1.11-qual.0` closure served by a clean public-package release binary:
qualification-mode witness 3/3 (advertisement with honesty marker, packaged
artifact admission plus live insert, retained cold render with the runtime
stopped), receipt minted and revalidated by a receipt-backed restart, and
the no-receipt negative refused. Proof receipt:
`tests/acceptance/receipts/packaged-store-qualification.proof.2026-08-06.v1.json`.
That proof receipt binds the qualification closure, not a published one; the
0.1.11 release staging lane must re-run
`scripts/packaged-store-qualification.mjs` against the real staged 0.1.11
closure and release binaries (per platform) and ship each minted receipt as
`packaged-store-qualification.receipt.json` inside the runtime package,
adjacent to the binary, where the CLI loader forwards it.

**Qualified-staging closure — 2026-08-07.** The first execution of the
qualified-staging lane (EAS run `019fdeb1-6d46-72a2-ace6-c52d06a9825b`)
caught that its assembled public runtimes lacked those receipts and therefore
honestly withheld `single_table_v1`. The workflow now owns the required
per-platform mint and restage as a two-pass assembly: pass one supplies the
platform-installable qualification closures, each platform mints against its
own runtime, and pass two packages both receipts. Its qualified-ledger check
fails closed unless every runtime tarball contains a correctly typed receipt;
only the explicitly marked pass-one closure may omit them.
