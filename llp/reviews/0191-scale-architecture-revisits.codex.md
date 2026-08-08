# Reviews of LLP 0191 — Codex family

Target: `llp/0191-scale-architecture-revisits.research.md`

## Round 1 — 2026-08-08

**Provenance.** Reviewer: Codex CLI 0.146.1, model `gpt-5.6-sol`, reasoning
effort xhigh, read-only sandbox, run non-interactively (`codex exec`,
stdin closed). Orchestrator/reviser: Claude Fable 5 session (did not author
this review). Lens: design-partner (declared). Target revision: commit
`dcd12ba5d8e62f4d91a99ddf5590f0fdd0b64121`, target blob
`4114404c61d75a9efe99dff8bc656b5fcaa90e7d`. Capsule: detached worktree at
that commit, structural exclusion of `llp/reviews/0191*` verified (none
existed). Instructions: `brief-r1.md` sha256[0:16] `4c7d4a06c9862059`,
identical brief to both families. Mutual blindness: structural (capsule
pinned pre-artifact). Received and recorded verbatim 2026-08-08.

**Verdict: NOT READY** (MATERIAL concerns in §§1–6 assessments and the
missing-revisit scan; see verbatim body).

### Verbatim review

# 1. Per-section design assessment

## §1. The live-query evaluation model

The architectural problem is real: the hot control demonstrates that Snapback’s mutation and live-query paths do not scale together when expensive opaque handlers serve several observers.

**MATERIAL — the evidence is misreported.** The “676 frames before, 12 after” claim is not supported by the cited artifacts. The closed ticket supports 676 pre-fix update/boundary frames and zero post-fix authorization conflicts. The v10 receipt records 521 deliveries across 18 observer instances—23–33 each—not 12. Therefore the conclusion that almost all delivery work disappeared after the invalidation repair is false as written.

The latency evidence also needs sharper interpretation:

- The 1.341-second list-ready result is one sample for an 817,069-byte response, not a distribution.
- The 48 mutation calls have an overall median of 74.289 seconds, but the 111–156 ms samples are three typed `issue.create` refusals.
- The 45 applied mutations range from 11.922 to 147.703 seconds, median 75.792 seconds.
- These timings measure the `client.mutate()` promise, while LLP 0183 explicitly calls for authoritative mutation result and observer convergence to be measured separately.

**MATERIAL — the ladder is missing a rung and overstates another.** I would use:

1. Latest-version coalescing, cancellation, and fair scheduling.
2. Dependency/range-aware invalidation: prove that a change can affect this plan, window, or authority partition before evaluating it.
3. Same-authority-partition memoization or shared materialization.
4. Declared-plan IVM with indexed maintained state.
5. Delta-fed local replicas for admitted shapes.

Snapback already has captured-dependency matching and conservative fallbacks; D2 should extend that machinery for relational graph nodes rather than start from table-level invalidation as a blank slate.

Coalescing is separable if it preserves the newest store version, authorization obligations, and a bounded fairness rule. Same-partition memoization is also separable. Cross-principal “shared evaluation,” however, is not separable from query shape and authorization decomposition. The six observers did not have semantically identical inputs: principal and policy are ambient query inputs, and their resulting memberships differ. An opaque handler that partitions before counting cannot safely be evaluated under a super-principal and projected afterward. Cross-principal sharing becomes credible only after D2 declares an authority-independent base plus separately evaluated protected/private overlays.

**MATERIAL — “single-digit seconds” is a hypothesis, not yet a supported estimate.** Six serialized evaluations at 1.341 seconds already consume about 8.0 seconds before mutation work, protocol obligations, roughly 4.9 MB of result delivery, and contention. Coalescing could plausibly yield an order-of-magnitude improvement, but the receipt cannot establish single digits. The immediate spike should measure zero/one/six observers, evaluation queue time, execution time, cancellation, frame kinds and bytes, mutation commit acknowledgement, and observer convergence independently.

**Recommendation:** commission a short scheduling spike immediately, then put the revised ladder into coordinated D2/D4 design work. D4 should own lifecycle, fairness, cancellation, and backpressure. D2 should own declared dependencies, plan identity, affected-query matching, and deltas. D3 should own retained/local consumption. Do not commission cross-principal sharing in the identity-only form proposed.

**Confidence: high.**

## §2. Local facts as a read path

The document correctly recognizes that retention is not merely an offline feature. It can provide restart continuity and honest degraded rendering when live continuity is lost.

**MATERIAL — exact retention and read-path scaling are conflated.** LLP 0190 Candidate D—retaining an exact opaque result—does not remove server evaluation for current reads and does not make the 74-second mutation path interactive. It supplies a stale-but-truthful fallback. Current local reads require a maintained fact set, an ordered delta protocol, and a local evaluator; that is a materially larger design.

“Retained fact + delta stream = replica” is directionally right but incomplete. A usable replica also needs an initial consistent cut, cursor/version identity, gap detection and resnapshot, tombstones, backpressure, authorization-partition transitions, lease handling, and predecessor retirement.

**Recommendation:** split D3’s branch decision into two explicit outcomes:

- A tactical resilience carrier: exact-result retention, only if it reuses the eventual identity/authority envelope and is genuinely cheap.
- The strategic scaling path: Candidate A—declared projections or D2 graph facts, server-maintained deltas, and local evaluation.

Candidate B’s static extraction of JavaScript is a compiler/security project with poor leverage unless it produces the exact D2 IR. Candidate C is worthwhile only if the UI demonstrably needs atomic multi-query screen coherence that Candidate D cannot provide.

Use the hot result as motivation for the strategic path, not as evidence that exact retention fixes scaling.

**Confidence: high.**

## §3. App identity as a first-class schema concept

The evidence cluster is important, but the proposed single owner-Spec groups together mechanisms that share the word “identity” more than they share invariants.

**MATERIAL — one implementation owner would conflate three trust domains.**

1. Schema identity: unique public/source keys, generated defaults, and human-facing numeric identifiers.
2. Authentication identity: mapping a provider principal to an application user.
3. Protocol identity: mutation settlement and downstream-effect idempotency.

I would commission one short identity architecture decision defining namespaces, provenance, uniqueness, mutability, and conversion rules, followed by separate owner amendments:

- Schema/generated IR: declared unique alternate keys, indexed lookup, defaults, and numeric display identity.
- Auth/D7: provider-bound identity using immutable `(issuer, subject)` or a privileged provisioning channel. Verified email alone should not silently become the durable application identity.
- D5/effects: a read-only server-bound settlement identity scoped to app, instance, authority partition, and operation. A raw client-chosen mutation ID must not become an unnamespaced global effect key.

For local-first writes, globally unique client-generable primary IDs remain the safer canonical identity. A monotonic sequence should normally be a secondary permalink/display number, not the relationship key on which offline creation depends.

**Recommendation:** one coordinating identity decision, three owner amendments, one Zerobugs acceptance matrix. Do not commission one monolithic owner-Spec.

**Confidence: high.**

## §4. The durable-store envelope

The control did expose a real operational trap: an ad hoc copy of a SQLite filename is not a supported state capture. But LLP 0191 misreads both the general abstraction and LLP 0158.

**MATERIAL — “copy all envelope members” would regress the fork trust model.** LLP 0158 already materializes live and cold parents through SQLite’s backup API and makes credential scrub-and-mint load-bearing. Parent sessions, agent credentials, resume/search authority, admin tokens, and authority keyrings must not cross into a fork. It explicitly mints fresh sidecars and classifies system tables and sidecar families with copy/scrub/rotate/share/refuse dispositions.

Including the auth keyring is appropriate for some same-instance backup/restore operations. It is forbidden for a derived fork. A benchmark clone may need a third, explicitly privileged policy. These are not the same verb.

**MATERIAL — the correct abstraction is an operation-specific custody manifest, not merely an enumerable path set.** Define at least:

- `snapshot/backup`: consistent data cut plus the exact authority material needed to restore the same instance.
- `restore`: verified input, target identity policy, activation barrier, and predecessor fencing.
- `clone-for-test`: explicit authority inheritance or scrub policy, never inferred from copied filenames.
- `fork`: LLP 0158 scrub/rotate/mint semantics.
- `export`: normally data without operational secrets.

The SQLite WAL is part of a valid database state, but a supported snapshot should use the SQLite backup API or an equivalent consistent-cut primitive. It should not depend on every graceful shutdown producing a single-file checkpoint. The shutdown ticket remains worth fixing and diagnosing, but it is not the foundation of correct backup or fork semantics.

**Recommendation:** create a standalone state-capture/restore Spec owned by storage, auth custody, and operations. Reuse LLP 0158’s custody-manifest model; make LLP 0158 a consumer and conformance witness, not the place where all copy semantics are folded.

**Confidence: very high.**

## §5. Relational-surface completeness

The 22-relation query corpus and approximately 1,400 lines of manual assembly are compelling evidence for D2. The section’s carving is nevertheless too broad.

**MATERIAL — schema fidelity and relational query composition should not share one D2 commission.** Stored enums and numeric defaults are schema constraints. Structured route arguments are an input-type/lowering issue. A bounded multi-relation graph with authorization, completeness, cursors, and live dependencies is the actual D2 architectural work.

The document also over-attributes the manual merge to `ROUTES_ARGS_INVALID`. The control plan says the current relational capability is bounded to two-source forms while the application needs up to 22 relations. Fixing nested arguments would remove a real compiler blockage, but it would not by itself produce the required graph surface or retire `W-MANUALSET`.

**Recommendation:**

- Land stored literal unions/check domains and alternate-key/default support through the schema owner as early, independently testable improvements.
- Fix structured route-argument lowering as a compiler-surface prerequisite.
- Keep D2 focused on the finite graph IR, authorization at every node, affected-query dependencies, result/completeness vocabulary, and server/local evaluator agreement.

**Confidence: high.**

## §6. Bulk data flows

This is a well-earned revisit. Three bespoke loaders and a 6,176-batch, 66-minute run are sufficient evidence that the system needs an operator-grade bulk protocol.

**MATERIAL — D8 is the qualification consumer, not the natural protocol owner.** Hosted qualification cannot own the portable transaction, staging, schema, authentication, and recovery semantics. Those belong to storage/import-export and migration owners; D8 should prove a target implements them.

The reference loader contains the right ingredients, but “exactly once” should be framed as an externally observable outcome, not necessarily one unique internal transaction. A robust form is:

- authenticated import session bound to app, schema, source manifest, and limits;
- staged chunks with ordinal, digest, and idempotency identity;
- small acknowledgements rather than echoed rows;
- bounded validation and resumable progress;
- whole-manifest verification and an atomic completion/activation sentinel;
- abandoned-session cleanup;
- optional initial-snapshot plus change-watermark/catch-up semantics for online migration.

**minor — the evidence directly earns import; export is a sensible companion but should receive its own consistency and secret-redaction justification.**

**Recommendation:** commission a standalone bulk-transfer Spec, using the control loader as a reference and D8/LLP 0160 as acceptance consumers.

**Confidence: high.**

# 2. Missing-revisit scan

**MATERIAL — mutation settlement and subscription work isolation are missing.** The hot receipt times `client.mutate()` itself, not merely observer convergence. The architectural question is therefore not only “how do we evaluate subscriptions faster?” but also “why does subscriber work hold up mutation settlement?” Stage 1 needs an explicit contract for commit acknowledgement, settlement, live invalidation enqueueing, observer convergence, queue isolation, and backpressure. A slow or disconnected subscriber must not consume unbounded write-path latency or memory.

**MATERIAL — affected-query matching should be an explicit ladder rung.** Comparable systems first avoid waking unaffected work, then share or incrementally maintain the remaining work. Snapback already has captured dependencies and conservative matcher fallbacks; the D2 graph should extend that vocabulary to joins, ranges, windows, search membership, and authority partitions.

**minor — first-class pipeline telemetry is required design content.** The current evidence cannot separate queue wait, handler execution, result serialization, authorization frames, network delivery, and client adoption. The §1 spike and owner-Spec should require these counters, but this need not become a seventh standalone program.

The six-way carving should change as follows:

- Merge §1’s strategic IVM destination with §2’s synchronized-fact/local-replica destination into one declared reactive-view architecture. Keep exact-result retention as a smaller, independent resilience feature.
- Keep scheduling/coalescing separately implementable, but put it under the same integration contract as mutation settlement and live convergence.
- Split §3 into schema identity, auth binding, and settlement identity beneath one vocabulary decision.
- Split §5 into schema fidelity and D2 relational graph work.
- Replace §4’s one envelope with operation-specific custody profiles.
- Keep §6 standalone, with D8 as a consumer.

D4’s window controller, D5’s generated optimistic programs, and D6’s maintained search remain important, but they are already explicitly commissioned by LLP 0183; the control did not earn a reason to replace those workstreams wholesale.

# 3. Prior art, per revisit

## §1. Reactive evaluation

Convex demonstrates the useful middle ground between table invalidation and full IVM: deterministic server queries, captured read dependencies, a transaction journal, cached results, and reruns only when relevant reads may have changed. It still reruns queries, but selective invalidation and reuse delay the need for a differential engine.

Firestore listeners use indexed query targets and deliver document-level changes after an initial result. They do not rerun arbitrary application functions per listener. Figma’s LiveGraph similarly points toward explicit dependency graphs and shared computation rather than subscriber-local opaque execution.

Zero/ZQL and Materialize occupy the declared-plan end. Zero can synchronize admitted query shapes into a local store and maintain client results from row changes. Materialize and differential dataflow go further: arrangements/indexes and timestamped diffs make shared maintained subplans the normal unit. Their lesson is that useful IVM is designed around declared algebra and maintained indexes, not bolted onto opaque functions.

**MATERIAL implication:** cross-principal result sharing before authority decomposition contradicts established cache-isolation practice. Share only within an exact authority partition until a declared plan proves which base facts are authority-independent.

## §2. Local facts and replicas

Replicache/Reflect make a local database the primary read surface: pulls apply patches, local subscriptions rerun cheaply, and writes enter a replayable mutation log. Linear’s sync architecture similarly derives UI state over a normalized local model rather than maintaining one server subscription per screen query.

ElectricSQL and PowerSync use server-selected replication shapes or buckets, logical-log changes, and local SQLite queries. Zero combines query-driven synchronization with local IVM. The common architecture is initial cut plus ordered changes plus local evaluation—not merely persistence of the last query array.

Firestore’s offline cache illustrates the usefulness and limitation of exact retained answers: the UI can render cached data with a cache/freshness label, but cached presence is not fresh authorization or proof that a negative result is complete. LLP 0190’s lease, quarantine, and predecessor-blanking discipline is appropriately stricter.

The admitted-shape posture is therefore right. What should change is the ladder: exact-result retention is graceful degradation; maintained facts plus deltas are the scaling strategy.

## §3. Identity

Relational databases distinguish primary keys, alternate unique keys, generated defaults, and sequences. Sync systems usually add a stronger constraint: canonical row IDs must be stable and generable without a round trip. Firestore, Replicache-style systems, CRDT stores, Figma, and many offline clients therefore favor UUID-like identifiers. Human-facing sequential numbers remain secondary.

OIDC’s hard-won identity form is provider issuer plus subject. Email is an attribute that may be verified, changed, reassigned, or supplied by providers with different guarantees. App-user binding should consume claim provenance or a privileged provisioning operation.

Idempotent APIs similarly bind a request key to a namespace and request semantics. Reusing one key with a different payload should refuse. Snapback’s settlement surface should expose a server-bound identity, not teach effect code to trust an arbitrary client string globally.

The proposed identity charter is valuable, but the known best form is one namespace/provenance model implemented by separate schema, auth, and settlement owners.

## §4. Durable state and copying

SQLite’s backup API is the standard way to capture a consistent live database. Copying the main filename alone is not. SQLite’s session extension produces changesets/patchsets; it is useful for diffs and transfer, not a replacement for a base snapshot.

Litestream treats snapshots and ordered WAL generations as the backup unit. LiteFS coordinates SQLite replication with primary/lease state. PostgreSQL similarly uses a base backup plus WAL position and recovery metadata. These systems show that the durable unit is a protocol-defined consistent cut, not “whatever siblings happen to be present.”

They also distinguish data from authority and operational configuration. LLP 0158’s custody manifest is already the strongest local prior art in this repository: every system table and sidecar receives a disposition, and a fork is unbootable until scrub-and-mint completes.

**MATERIAL contradiction:** copying auth keyrings into a derived fork is the opposite of this lesson and of LLP 0158’s accepted threat model.

## §5. Relational completeness

PostgreSQL and SQLite separate schema invariants from query syntax: enums/check constraints, unique keys, defaults, and identity generators are not query-plan nodes. Snapback should preserve that separation even if one application exposed both gaps simultaneously.

ZQL demonstrates the value of a bounded declarative graph/query AST consumed by sync, client evaluation, and typing. Firestore shows the benefit of a deliberately limited query language with explicit index requirements and honest refusals. Convex shows the other tradeoff: an expressive function surface is pleasant, but joins and complex authorization commonly push applications toward denormalization and maintained read models. Materialize shows what broad relational algebra costs when made incrementally maintainable.

Snapback’s finite admitted-shape direction is sound. The known best form is a closed IR, explicit indexes/bounds, shared server/local semantics, and stable refusal—not a general JavaScript or SQL escape hatch. Structured route arguments are necessary plumbing, not the graph architecture itself.

## §6. Bulk transfer

PostgreSQL `COPY`, dump/restore, and base-backup protocols keep bulk movement outside ordinary per-row application RPCs. Managed databases use staged imports, manifests, resumable parts, and finalization. For online movement, the standard pattern is a consistent snapshot paired with a logical-log watermark so changes after the cut can be replayed without a gap.

Firestore and Convex expose managed import/export surfaces rather than asking applications to build thousands of interactive mutations. SQLite’s session changesets can transfer bounded changes but still need a base-state and conflict policy.

The known best form here is a staged, authenticated, manifest-bound transfer session with chunk hashes, idempotent acknowledgement, whole-import verification, bounded cleanup, and atomic activation. The Zerobugs ledger is a good prototype of that protocol; echoing committed rows is not.

# 4. Answers to the five open questions

1. **Commission D2/D4 with the ladder?** Not as written. Commission the immediate coalescing/telemetry spike and require a revised ladder: coalescing/cancellation → affected-query matching → same-authority sharing → declared-plan IVM → delta-fed local replica. Cross-principal sharing waits for D2 authority decomposition. The question is biased by treating “same query and args” as semantic identity while omitting principal/policy inputs.

2. **One identity owner-Spec or distribute it?** Use one short identity architecture decision, then distribute implementation authority across schema, auth/D7, and D5/effects. Keep one Zerobugs acceptance corpus. The current binary choice is biased: coordination does not require one owner to control unrelated trust domains.

3. **Fold the store envelope into LLP 0158 or make it standalone?** Standalone. Generalize LLP 0158’s custody-manifest idea into operation-specific backup, restore, test-clone, fork, and export profiles. LLP 0158 remains the fork profile and must preserve scrub-and-mint. Folding a “copy every member” contract into 0158 would be a trust regression.

4. **Spike coalescing immediately?** Yes. Run it before the Spec, behind an experimental gate if needed. First add per-evaluation queue/start/finish/cancel counters, frame-kind/byte accounting, and separate mutation-commit, mutation-result, and observer-convergence timing. Test burst and sustained writes with zero, one, and six observers and with same/different authority partitions. Treat single-digit latency as the hypothesis being tested.

5. **Priority order?** `§2 → §1 spike → §3 → §5 → §1/§2 strategic convergence → §4 → §6`. D3 remains first by ruling. The immediate §1 spike should run alongside it; the full IVM portion waits for §5’s declared graph and converges with D3 rather than proceeding as an independent final architecture.

# 5. Sequencing

| Order | Work | Effort | Leverage and rationale |
| --- | --- | --- | --- |
| 1 | §2 D3 discrimination and first honest retention admission | Large | Already ruled first; freezes the identity/authority envelope needed by later local facts. Prefer Candidate A strategically, with Candidate D only as a cheap tactical result. |
| 2 | §1 instrumented coalescing/cancellation spike | Days | Highest immediate leverage and cheaply falsifies or confirms the single-digit hypothesis. Also determines whether mutation settlement must be decoupled from subscription work. |
| 3 | §3 identity architecture plus owner amendments | Medium | Blocks protected D3 classes, generated source-key access, and trustworthy effect idempotency. Run schema, auth, and settlement lanes in parallel after the vocabulary decision. |
| 4 | §5 schema quick wins and D2 graph Spec | Small for enums/arguments; large for graph | Removes repeated security guards quickly, then supplies the declared plan, dependency, and authorization structure needed by IVM and local evaluation. |
| 5 | Strategic §1 + §2 convergence: maintained deltas and local replica | Very large | Highest eventual leverage, but only credible after D2 plan identity and D3 authority/custody rules exist. |
| 6 | §4 operation-specific state capture | Medium | High trust and operational value; needed before broader backup/fork claims, but not on the shortest path to the complete online Stage 1 application. |
| 7 | §6 bulk-transfer protocol | Medium–large | Strong repeated qualification and migration leverage, but the existing acceptance-only loader is an adequate temporary bridge once its boundaries remain explicit. |

This ordering deliberately lands quick scheduler and schema evidence early while preventing the expensive IVM program from designing around opaque handlers, an unsound cross-principal cache, or an undefined local authority envelope.

VERDICT: NOT READY
## Round 2 (delta round) — 2026-08-08

**Provenance.** Reviewer: Codex CLI 0.146.1, model `gpt-5.6-sol`, xhigh,
read-only sandbox, `codex exec` non-interactive. Orchestrator/reviser:
Claude Fable 5 session (did not author this review). Lens: design-partner,
delta round — IN-DELTA vs PRE-EXISTING classification required. Target
revision: commit `a340e02ebac3d0bdb811b9109bf117f8fe49ddf7`, target blob
`6b54db12bcedf11652e7cb028f84b3f28b8e4bf5`. Capsule: detached worktree at
that commit with `llp/reviews/0191*` removed post-checkout (structural
exclusion verified) and the full delta embedded as `DELTA-0191.diff`
(458 lines, `dcd12ba5d..a340e02eb`). Instructions: `brief-r2.md`
sha256[0:16] `360674bbfed7f3ba`, identical to both families. Received and
recorded verbatim 2026-08-08.

**Verdict: NOT READY** (C1 IN-DELTA MATERIAL — reviser-introduced
workload mischaracterization; C2 PRE-EXISTING MATERIAL — current
architecture misdescribed as table-only invalidation).

### Verbatim review

## 1. Delta faithfulness

The central evidence defect is not repaired faithfully.

The immutable v10 receipt classifies its workload as open-loop: sixteen mutations per cycle at fixed 25 ms offsets over 375 ms, with “no prior response … awaited.” The revised §1 instead calls it paced, says it awaits each settle, and concludes that pacing leaves supersession nothing to collapse. Both the acceptance gate and diagnosis harness dispatch bursts; their meaningful differences include fresh server/observer state versus persistent observers and their settlement/observation procedures—not burst versus paced. Therefore the explanation for **521 deliveries versus 12 update frames** remains unproved. **[C1 — IN-DELTA, MATERIAL]**

The revision also converts delivery counts into an evaluation claim: “each mutation still costs a full evaluation per subscriber.” The receipt records callbacks/deliveries, not evaluation queue/start/finish/cancel events. OQ4 correctly asks the spike to add those counters, confirming that the present evidence cannot yet establish this causal claim. The same applies to settlement isolation: separating commit acknowledgement, settlement, and convergence is an excellent design requirement, but subscriber work holding settlement should remain the hypothesis being tested.

The five-rung ladder is otherwise a strong design decomposition:

1. Coalescing is correctly recognized as latest-value semantics, not merely optimization.
2. Precision is the right independent lever.
3. Same-authority sharing first, with cross-principal sharing gated on an authority-independent base, preserves the trust model.
4. IVM is appropriately limited to admitted shapes.
5. Delta-fed replicas correctly identify the convergence point with D3.

The settlement-isolation addition is sound, provided its causal language is weakened pending the spike.

The revised §§2–6 decisions are also sound:

- The tactical exact-result-retention versus strategic maintained-fact portfolio is honest.
- Identity coordination no longer incorrectly collapses three trust domains into one implementation owner.
- Operation-specific custody profiles repair the envelope proposal without regressing LLP 0158’s scrub-and-mint boundary.
- Schema/compiler improvements are correctly separated from D2’s architectural graph work.
- Bulk import is properly owned as a logical protocol rather than a D8 target-specific workaround.

One commissioning inconsistency remains: §1 assigns D2/D4 rungs 1–4 and D3 local consumption, while OQ1 asks D2/D4 owner-Specs to carry the entire five-rung ladder. Rung 5 needs an explicit D2–D3 interface owner or should be described as referenced D3 scope rather than D2/D4 required content. **[C3 — IN-DELTA, minor]**

## 2. Pre-existing text

The carried-over description of current live-query architecture is materially inaccurate. It says every subscription whose declared tables intersect a commit is re-evaluated, but `src/live_matcher.rs` already uses captured row/query dependencies and predicate/window-boundary matching to skip provably disjoint changes, falling back conservatively where proof is unavailable. The new rung 2 acknowledges that machinery, creating an internal contradiction.

This matters to the decision: the commissioned work should extend and measure the existing matcher’s coverage and fallbacks, not proceed from an assumed table-only invalidation model. The spike must record which subscriptions matched, skipped, or fell back before attributing the hot result to 96 full evaluations. **[C2 — PRE-EXISTING, MATERIAL]**

Two provenance descriptions also remain inaccurate: “all” cited artifacts cannot be rewritten contradicts the explicit statement that the local traces are not immutable, and “one receipt and one trace” actually introduces two receipts and two traces. The per-number labels now largely protect the reasoning, so this is non-blocking cleanup. **[C4 — PRE-EXISTING, minor]**

## 3. Open questions

The identity-ownership fault line is fair. I would sign the convergence on one coordinating architecture document, shared vocabulary, and one Zerobugs acceptance corpus. My design preference is distributed implementation authority across schema, auth/D7, and D5/effects, because their admission and failure boundaries differ.

The envelope-placement fault line is also real, though lower-stakes than its structural decisions. I would sign the agreed operation-specific profiles and LLP 0158’s retained ownership of fork semantics; companion versus standalone placement can be ruled either way without changing the trust contract.

I would sign OQ4’s immediate measurement spike emphatically, but not its current “burst versus paced” wording. It should name the workloads actually present—fresh-cycle open-loop bursts and persistent repeated open-loop bursts—and add a genuinely paced/sustained workload as a new experimental arm.

I would sign OQ5’s sequencing head. I would not sign OQ1 exactly as written until C1 and C2 repair the ladder’s evidence basis and C3 clarifies rung-5 ownership.

## Concern register

| ID | Classification | Concern | Required resolution |
| --- | --- | --- | --- |
| C1 | IN-DELTA · MATERIAL | v10 is falsely described as paced/awaiting each settle; the 521-versus-12 causal explanation and per-mutation evaluation claim do not follow. | Describe the frozen workloads exactly, separate delivery from evaluation metrics, and leave causality to the instrumented spike. |
| C2 | PRE-EXISTING · MATERIAL | The current architecture is misdescribed as table-only despite existing captured-dependency matching and conservative fallbacks. | Document the actual fast path/fallback model and measure matcher decisions for the hot workload. |
| C3 | IN-DELTA · minor | OQ1 assigns all five rungs to D2/D4 while §1 assigns retained/local consumption to D3. | Name rung 5’s D2–D3 interface ownership or scope it as referenced D3 content. |
| C4 | PRE-EXISTING · minor | Evidence provenance/counting says immutable “one receipt and one trace” despite local mutable traces and multiple artifacts. | Correct the evidence-base framing. |

VERDICT: NOT READY
## Round 3 (closing delta round) — 2026-08-08

**Provenance.** Reviewer: Codex CLI 0.146.1, `gpt-5.6-sol`, xhigh,
read-only sandbox, `codex exec` non-interactive. Orchestrator/reviser:
Claude Fable 5 session (did not author this review). Lens: design-partner,
closing delta round. Target revision: commit
`9f30acdb1280a0757dc91c8c04dcce9f4ac891d1`, target blob
`106cf5f1417cb76012a812e509e937eb2c1435aa`. Capsule: detached worktree at
that commit, `llp/reviews/0191*` removed post-checkout,
`DELTA-0191.diff` (296 lines, `a340e02eb..9f30acdb1`) embedded.
Instructions: `brief-r3.md` sha256[0:16] `0a339cef9c703e04`, identical to
both families. Received and recorded verbatim 2026-08-08.

**Verdict: NOT READY** (both round-2 MATERIALs confirmed repaired; one
new PRE-EXISTING MATERIAL — "all 16 hot mutations touch the list" is
contradicted by the receipt's own
`eight-trigger-eight-nontrigger-inventory-partition` PASS check, verified
by the orchestrator on receipt).

### Verbatim review

## Assessment

The delta honestly repairs both round-2 MATERIAL findings:

- Delivery evidence now preserves the shared open-loop discipline, states the 676/12/521 measurements without reconciling them, and correctly makes reconciliation OQ4’s job.
- The architecture now accurately identifies captured row/predicate/window-boundary matching with conservative fallback. Rung 2 is correctly framed as extension and measurement.
- No IN-DELTA MATERIAL defect or newly defective decision found.

## Concern

- **PRE-EXISTING — MATERIAL:** §1 incorrectly says all 16 hot mutations genuinely touch `issueListV2`, concluding the hot profile cannot demonstrate affected-read precision. The declarations disprove this: `issueListV2` does not read `issueNotifications`, `emoji`, or `userPref`, while `notification.update`, `emoji.remove`, and `userPref.set` write only those respective tables. `viewState.set` is also principal-local rather than relevant to every observer. Thus the workload already mixes relevant, disjoint, and authority-partitioned changes. This makes the claimed plausibility of 96 re-evaluations and the stated measurement role of the hot profile unsound.

  Resolve by describing 96 as an unmeasured theoretical ceiling, predeclaring expected relevance per mutation × observer authority, and using OQ4’s matcher counters to compare those expectations with actual match/skip/fallback behavior. Also distinguish existing single-table range/top-N-boundary matching from the relational and authority-partition extensions rung 2 commissions.

## Minor, non-blocking

- **IN-DELTA — minor:** For symmetry, record that `diag-run2` also contains 12 `authorization_boundary` records. The existing “12 update frames” statement is true and appropriately typed, but the omission could invite a total-frame misreading.
- **IN-DELTA — minor:** Scope “no incremental maintenance” explicitly to the opaque-JavaScript path exercised by Zerobugs; analyzable HostPlan single-table queries already have a `live_delta` fast path.
- **PRE-EXISTING — minor:** “Zero-class answer” sits awkwardly beside the categorical claim that no Zero comparison is implied. “Incremental-view-maintenance answer” would preserve the non-comparative posture.

Sections 2–6 are sound commissioning bases: retention separates resilience from scaling, identity preserves its three trust domains, custody is operation-specific, relational work is correctly split by kind, and bulk import has bounded session and activation semantics. The five open questions are well shaped, especially OQ4; correcting §1’s workload classification should not require changing their recommended rulings.

VERDICT: NOT READY