# LLP 0155 local sync product direction review — Codex family (GPT-5.6)

## Round 1 — 2026-08-02

**Reviewer family:** OpenAI GPT (GPT-5.6)
**Provider / runtime:** codex-cli 0.146.0 `codex exec`, model `gpt-5.6-sol`,
`model_reasoning_effort=xhigh`, read-only sandbox
**Date:** 2026-08-02
**Redacted:** no (repository-local review; bounded web spot-checks of
external Zero/Replicache references performed by the reviewer)
**Method:** fresh non-interactive session over the working tree; mutually
blind — capsule prohibited reading any `llp/reviews/` artifact concerning
LLP 0155 and all super-refine journals, and the review states it honored
this. SHA-pinned target verified by the reviewer. Design-partner framing
per author directive (explicit ENDORSE/REVISE/REPLACE direction verdict
required). The reviewer partially re-ran the cited verification suites
(read-only sandbox blocked file-backed cases).
**Target:** `llp/0155-local-sync-product-direction.rfc.md` (1014 lines,
Draft, v0.1)
**Target SHA-256:** `58974aac57502e07047fec4d6a61e0dc598fe1345ed124dca5cd531991ee951e`
**Repo revision at review start:** `main` `cbbb58ec` (target file untracked)
**Status:** completed
**Verdict:** NOT READY (moderate margin; direction verdict REVISE — keep
the thesis, recast Moves 1–2, reconcile sequencing with LLP 0129)

### Verbatim review (round 1)

# Review — LLP 0155, round 1

## 1. Overall assessment

**Direction verdict: REVISE.**

The central thesis—“copy Zero’s outcomes, not its architecture”—is supported by the bakeoff and is the right strategic center. Snapback should pursue better relational authoring, query completeness, local materialization, and shared optimistic execution while retaining its differentiated authority, custody, settlement, and disconnected-intent model.

The proposed six moves should not be accepted unchanged, however. Moves 1 and 2 settle architecture that the governing research deliberately leaves unresolved, and the proposed sequence conflicts with LLP 0129’s Accepted, IR-rung-first program authority. I recommend this revision:

1. Replace Move 1’s broad relational graph with **composition of admitted bounded plan nodes plus completeness and inspection**. Treat the eventual graph syntax as compilation sugar over that algebra. Defer aggregates—including `count`—to a separately admitted node with explicit result and noninterference semantics.
2. Make Move 2’s initial substrate **opaque query-result fragments plus membership and completeness witnesses**. Gate cross-query canonical-row sharing on a projection-aware authority model; do not presume one whole-row value per table/id.
3. Keep Move 3, but explicitly reconcile it with LLP 0129 OQ8 and IR-rung-first resourcing before claiming a new stage order or starting an end-to-end implementation.
4. Keep typed optimistic creation as a **Candidate-B experiment**, not an independent product move, until Candidate A is qualified and Candidate B’s semantic envelope and owner are frozen.
5. Preserve Move 5, but reproduce LLP 0129’s exact two-independent-attempt proof separately for A and B.
6. Preserve Move 6 substantially as written.

The sequence should become two bounded work lanes under an authority-reconciliation Stage 0:

- A read lane may advance on bounded composition, completeness, and inspection because LLP 0129 explicitly permits that independent work.
- The write lane retains IR-rung-first resourcing: resolve OQ8, qualify Candidate A, then run B and possibly C.
- Cross-query normalization, aggregates, Micro packaging, and wider carrier graduation follow only after their governing semantics are admitted.

### Verification and blindness

I independently verified the target before review:

- SHA-256: `58974aac57502e07047fec4d6a61e0dc598fe1345ed124dca5cd531991ee951e` — **matched**
- Length: 1014 lines
- Repository revision: `main` at `cbbb58ec`
- Target status: untracked Draft RFC

I honored the blindness rules. I did not read or communicate with the other review partner, did not read any LLP 0155 review under `llp/reviews/`, did not read any `*.super-refine.md` journal, and did not access the orchestrator scratchpad.

The bakeoff totals and per-application judgments are correctly transcribed. The current-implementation account is substantially accurate: the retained RQS path, ordered outbox and settlement custody, digest-bound resume behavior, conservative `live_replace` fallback, single-table `live_delta` eligibility, and stable exactly-two-source relational limit are present in the tree. The LLP 0129 candidate ladder, LLP 0133 settle-time trust posture, LLP 0053 revocation/lease obligations, query-grammar ownership, and LLP 0147 Full/Micro boundary were also checked.

The external survey is mostly accurate. Current Zero documentation confirms local-first query execution with `unknown`/`complete`, local/server mutator copies, rollback of confirmed optimistic effects, and rejection of writes after disconnection; it describes `prefix` as future work. It also lists aggregates as desired future work, not a current capability. [Zero queries](https://zero.rocicorp.dev/docs/queries), [Zero mutators](https://zero.rocicorp.dev/docs/mutators), [Zero connection status](https://zero.rocicorp.dev/docs/connection), [Zero project status](https://zero.rocicorp.dev/docs/status). Replicache’s repository was indeed archived on 2026-06-10, while its published documentation remains a valid control for optimistic mutations, rollback, and offline support. [Replicache repository](https://github.com/rocicorp/replicache), [Replicache documentation](https://doc.replicache.dev/).

Files read or substantively inspected:

- `vendor/llp/skills/llp-review/SKILL.md`
- `llp/0155-local-sync-product-direction.rfc.md`
- `llp/0008-local-first-sync-and-realtime.rfc.md`
- `llp/0051-language-neutral-data-tier.rfc.md`
- `llp/0053-authorization-invalidation.rfc.md`
- `llp/0080-portable-relational-queries-and-projections.rfc.md`
- `llp/0110-bounded-children-and-activity-patterns.spec.md`
- `llp/0120-relational-composition-and-aggregation.research.md`
- `llp/0129-local-first-program.plan.md`
- `llp/0130-program-standing-decisions.decision.md`
- `llp/0133-local-settlement.spec.md`
- `llp/0138-zero-replicache-bakeoff.plan.md`
- `llp/0144-declared-app-refusal-codes.rfc.md`
- `llp/0147-compiled-microclient.rfc.md`
- `demos/zero-bakeoff/reports/summary.md`
- `diaries/0042-triage-graph-zero-bakeoff.diary.md`
- `diaries/0043-latency-kanban-zero-bakeoff.diary.md`
- `diaries/0044-contention-calendar-zero-bakeoff.diary.md`
- `diaries/0045-private-incident-room-zero-bakeoff.diary.md`
- `diaries/0046-field-notebook-zero-bakeoff.diary.md`
- `diaries/0047-fleet-observatory-zero-bakeoff.diary.md`
- Search excerpts from the same-number sweep diaries `0042-a2` through `0047-a6`
- `src/storage.rs`
- `src/live_matcher.rs`
- `src/local.rs`
- `src/live_wire.rs`
- `src/rqs.rs`
- `packages/snapback-client/index.mjs`
- `packages/snapback-client/rqs-preload.mjs`
- `packages/snapback-client/rqs-resume-suite.mjs`
- `packages/snapback-client/outbox-store.test.mjs`
- `packages/snapback-client/reservation-retry.test.mjs`
- `packages/snapback-client/rqs-resume.test.mjs`
- `packages/snapback-client/rqs-resume-native.test.mjs`
- `packages/snapback-client/external-store.test.mjs`
- `packages/snapback-react/index.mjs`
- `packages/snapback-react/offline.test.mjs`
- `packages/snapback-contract/offline-replay.test.mjs`
- Search matches under `packages/snapback-contract/` concerning client-store authority, leases, overlays, and offline replay
- Relevant package manifests containing the focused test commands

The 20-test browser RQS resume suite and the external-store, React offline, and Contract offline suites passed in this review environment. File-carrier reruns were partially blocked by the review sandbox’s read-only filesystem: the outbox suite produced 21 passes and five `EPERM` temporary-directory failures, while the native RQS and reservation-retry runs encountered the same environmental restriction. I do not treat those as product failures, but this review did not independently reproduce every item in the RFC’s 26/20 focused-run statement.

## 2. Strengths

1. **The product thesis is evidence-led.** The distinction between product outcomes and deployment architecture is clear and defensible (`llp/0155-local-sync-product-direction.rfc.md:13–54`). The bakeoff totals, historical Fleet failure, later remediation, and per-app judgments are represented without turning coverage counts into a score (`:260–292`).

2. **The authority boundary is unusually explicit.** Move 6 preserves server authority, settle-time re-derivation, negative-delivery obligations, bounded leases, target portability, and explicit conflicts (`:719–765`). This aligns with LLP 0053 and LLP 0133 rather than treating them as implementation details.

3. **The vocabulary is useful.** The separation among materialization, completeness, freshness, settlement, and authority is a strong basis for both public APIs and inspection (`:113–141`). In particular, refusing to derive completeness from hitting a cap directly absorbs the Fleet lesson.

4. **Move 3 is the right Snapback-native answer to duplicated optimism.** A content-addressed mutation IR executed locally for prediction and authoritatively on the server offers Zero-like authoring economy without adopting “same by convention” client/server business logic (`:519–605`).

5. **The RFC respects the least-power ladder in intent.** Candidate C remains unadmitted, Candidate A comes first, and typed provisional identity is correctly described as Candidate-B-shaped (`:643–701`).

6. **The acceptance gates are concrete.** Triage, Fleet, Kanban, Calendar, Notebook, and Incident Room are used as named witnesses, with standards-real restart, authority, exactness, and convergence requirements (`:425–439`, `:506–517`, `:593–605`, `:651–663`, `:703–717`, `:826–859`).

7. **Migration and nonclaims are honest.** The RFC does not smuggle PostgreSQL logical replication, raw local SQL, full-table replication, or client-owned authorization in under a parity label (`:61–81`, `:951–968`).

## 3. Concerns

1. **BLOCKING — Move 1 chooses a broad graph before the bounded algebra it depends on has been selected.**

   The proposed grammar combines bounded root pagination, to-one and to-many relationships, nested refinements, semijoins, aggregates, shared plan identity, retention classification, and live classification in one move (`llp/0155...:361–377`). LLP 0120 distinguishes static composition of already-admitted bounded nodes from a general graph and says the honest general language is profiles plus composition “iterated, with an algebra,” sequenced after those pieces exist (`llp/0120...:457–537`). It also identifies cursor coordination, partial refusal, aggregate result semantics, protected aggregate noninterference, and maturity ownership as unresolved (`:517–537`, `:684–699`, `:744–777`).

   `count` is particularly premature. LLP 0120 identifies five distinct aggregate products, while Zero itself does not currently ship aggregates. The RFC therefore cannot justify `count` as a copied Zero outcome.

   **Resolution:** Recast Move 1 around a static bounded-node composition algebra. Each node retains its own bounds, visibility contract, refusal behavior, cursor, and work ceiling; the composite receives a summed global budget and one snapshot identity. Make the author-facing graph compile only to admitted nodes. Remove aggregates from the initial move or define a separate aggregate node after exactness, overflow, continuation, and noninterference are decided.

2. **BLOCKING — Move 2 settles canonical-row normalization while declaring the representation open, and silently reopens LLP 0008 DK-9.**

   Move 2 states that all clients expose one normalized local materialization, containing canonical rows keyed by table and id and shared across queries (`llp/0155...:445–470`). Open question 2 then says row-normalized versus result-fragment-normalized versus hybrid remains undecided (`:975–977`). Those positions cannot both stand.

   LLP 0008 DK-9 defines the store as retained query results plus outbox—“a document/result cache … not a relational replica”—and gives an explicit revisit trigger for local query capabilities (`llp/0008...:450–501`). LLP 0080 currently permits only opaque authorized snapshot retention, forbids custody of unprojected joined rows, and forbids retained local re-execution of the join (`llp/0080...:351–364`). Saying the physical carrier remains store-agnostic does not preserve DK-9’s semantic decision.

   A canonical row shared between queries also needs an authority model the RFC does not supply. Two queries may authorize disjoint projections of the same row, be at different versions, or revoke one membership while retaining the other. A single whole-row value requires field/projection provenance, merge rules, version rules, deletion/quarantine behavior, and protection against local existence or field oracles.

   **Resolution:** Make opaque result fragments plus per-query membership the admitted baseline. Either gate cross-query canonical-row sharing behind a successor Spec, or define projection-aware cell/fragment ownership, authority partitions, version reconciliation, and revocation semantics now. Explicitly identify this as a DK-9 amendment rather than saying DK-9 remains unchanged.

3. **BLOCKING — The proposed stage order is not reconciled with LLP 0129’s Accepted authority.**

   LLP 0155 says the first three moves may start and places the read foundation before shared local execution (`llp/0155...:49–65`, `:780–797`). LLP 0129’s controlling decision instead confirms IR-rung-first resourcing (`llp/0129...:334–370`, `:588–603`). Phase 1 is under an active scope-change escalation because its D5 gate omits settlement/id mapping, partial-read admission, identity fencing, receipt projection, browser store/outbox, and React presentation (`:604–629`). OQ8 must be answered before the decision lab is scheduled (`:1067–1089`). OQ10 additionally says Candidate B has no closed semantic boundary or adjudicating owner and that a sound Outcome 3 cannot be reached until those exist (`:1695–1707`).

   LLP 0129 does permit relational planning, completeness, and custody inspection to proceed independently (`:1091–1096`). That supports parallel read design work, but not a replacement global sequence with the read store as Stage 1 and the IR as Stage 2.

   **Resolution:** Add a Stage 0 authority reconciliation that records the exact relationship to LLP 0129, resolves or explicitly waits on OQ8, and names owners/timeboxes. Describe the read work as an independent permitted lane, retain IR-first resourcing for the write lane, and add Candidate B’s semantic boundary/owner as a prerequisite to Move 4 or any A→B→C run. Do not leave “whether sequencing questions need amendment” as a post-acceptance exercise.

4. **MATERIAL — Graph-level completeness lacks a compositional witness.**

   `complete` is defined as a full admitted result at a named version (`llp/0155...:384–399`), but the proposed graph contains nested relationships, pages, refinements, and potentially aggregates. It is not specified whether all nodes share one authoritative snapshot, whether independently hydrated nodes can be combined, what dependency closure the witness covers, or when changing one nested page returns the graph to `unknown`. A normalized store can otherwise assemble apparently complete output from individually authoritative but version-skewed fragments.

   **Resolution:** Bind completeness to at least plan hash, canonical args, authority partition, query generation, snapshot version, and the complete dependency/node set. Require one common snapshot for a `complete` composite, or define a weaker state. Specify invalidation and nested-pagination transitions before completeness is an acceptance claim.

5. **MATERIAL — Move 5 compresses LLP 0129’s inexpressibility proof enough to become ambiguous.**

   LLP 0155 mentions one valid A implementation, retained proof, and two independent failures (`:683–701`), but LLP 0129’s rule is more exact: both independent A attempts must fail the same fact in separate source trees with sealed per-attempt evidence; the missing primitive must be named and owner-validated; one valid implementation defeats the claim; and Candidate B independently receives the same two-attempt standard before Outcome 3 (`llp/0129...:1506–1553`). Missing shared substrate, implementation defects, harness defects, environmental failures, and unresolved attribution lead to Outcome 0, not trigger detection (`:1433–1455`, `:1520–1534`).

   **Resolution:** Reproduce or normatively incorporate those exact rules, separately for A and B, including Outcome 0 and the misattribution classes.

6. **MATERIAL — Stage 5 overstates LLP 0147 Micro’s relationship to local sync.**

   LLP 0155 proposes measuring whether the Micro client can select the query/store/mutation features an application uses (`llp/0155...:815–824`). LLP 0147 Micro v1 explicitly excludes RQS, retained reads, durable outbox, offline replay, optimistic settlement, local execution, and storage engines; applications needing them must select Full until a separate Micro module is proposed and graduated (`llp/0147...:486–524`, `:769–787`).

   **Resolution:** Say Stage 5 first measures Full’s feature and bundle attribution. Treat any local-sync Micro module as a separate LLP 0147 amendment or successor design, with its own evidence and graduation. Do not imply the current Micro profile is the packaging vehicle.

7. **DETAIL — The “client-minted mutation identity” implementation statement needs arm-specific qualification.**

   The React optimistic path mints an id and supplies it to `client.mutate` (`packages/snapback-react/index.mjs:864–912`). The lower-level JS `SnapbackClient.mutate` accepts an optional caller-supplied `clientMutationId`; without it, no durable outbox record is created (`packages/snapback-client/index.mjs:5612–5697`).

   **Resolution:** Change `llp/0155...:160–162` to say that the React optimistic path mints identity, while the raw JS client preserves and queues caller-supplied identity.

8. **DETAIL — The focused verification claim is insufficiently reproducible.**

   The exact counts at `llp/0155...:185–191` have no command list, environment identity, or retained artifact. My partial rerun supported the substance but could not reproduce file-backed cases in a read-only sandbox.

   **Resolution:** Record the exact commands and target identity, link a retained receipt, or phrase the paragraph as an author-reported local run rather than durable evidence.

## 4. Suggestions

- Add a compact authority/dependency table for each move: owning LLP, current authorization, prerequisites, shipping claim, and explicit nonclaim.
- Define a minimum coherent first slice: bounded node composition, completeness/inspection, and opaque query-result materialization—without aggregates or cross-query row normalization.
- Add an adversarial projection test: two queries authorize disjoint fields of the same canonical id, then one authority is revoked while the other remains.
- Add a stop rule for relational language growth, such as a maximum admitted node vocabulary and cumulative work budget before the program must reconsider the graph thesis.
- Keep “query-result materialization” as the product term until row versus fragment normalization is decided.
- Add a factual provenance appendix mapping the current-implementation bullets and test counts to source files, commands, receipts, and the reviewed commit.
- Separate product-outcome measurements from mechanism measurements. “Authors write one query” can be tested independently from whether the client stores normalized rows.

## 5. Open questions

1. Is the intended strategic product goal Zero-like query syntax, or Zero-like authoring outcomes implemented over Snapback’s bounded-node algebra?
2. Does authorization apply to a whole canonical row, individual projected fields, or a query result fragment? Can two queries authorize disjoint projections of the same id?
3. Must every node in a complete graph share one authoritative snapshot version? How do independently advancing nested cursors affect that claim?
4. Why is `count` in the first move when it was not a bakeoff-proven Zero capability and LLP 0120 leaves its result and noninterference semantics open?
5. Does the author intend acceptance of LLP 0155 to amend LLP 0008 DK-9 and LLP 0129’s stage order, or merely commission proposed amendments?
6. What does “all first-party clients” include for protected Contract-arm custody, and must every arm expose identical local-store semantics?
7. Who owns and freezes Candidate B’s typed inputs, outputs, effects, and composition rules before Move 4 is prototyped?
8. Is the local-sync packaging target Full indefinitely, or does the author intend a separate LLP 0147 Micro-module proposal?
9. What is the exact aggregate and graph-level noninterference promise exposed to ordinary inspection?
10. Which current representation is the conservative migration baseline if canonical-row normalization is rejected by its authority tests?

## 6. Recommended next step

Revise to v0.2 before acceptance:

1. Replace Move 1 with bounded-node composition and move aggregates behind a separate decision.
2. Make result-fragment materialization the baseline or fully specify projection-aware canonical-row authority.
3. Add a Stage 0 reconciliation with LLP 0129 OQ8/OQ10 and LLP 0008 DK-9.
4. Restore the exact A/B inexpressibility protocol.
5. Correct the LLP 0147 and raw-JS implementation characterizations.

Then run a focused review of those five changes. No implementation experiment is needed to resolve these blockers; they are corpus, authority, and semantic-design questions squarely within the RFC’s pre-code READY bar.

**Verdict: NOT READY — moderate margin**
## Round 2 — 2026-08-02

**Reviewer family:** OpenAI GPT (GPT-5.6)
**Provider / runtime:** codex-cli 0.146.0 `codex exec`, model `gpt-5.6-sol`,
`model_reasoning_effort=xhigh`, read-only sandbox
**Date:** 2026-08-02
**Redacted:** no (repository-local review; six external source re-checks)
**Method:** fresh non-interactive session over the working tree;
family-conditioned blindness — own round-1 artifact permitted, other
family's artifact and all journals prohibited; the review states it honored
this. SHA-pinned target verified at start and end of review; ref-check run
by the reviewer. Focused re-review of the v0.2 round-1 repairs per capsule
`capsule-0155-r2.md`.
**Target:** `llp/0155-local-sync-product-direction.rfc.md` (1302 lines,
Draft, v0.2)
**Target SHA-256:** `cfae8a5c2376490a950c799e4c4a4f7d1f39e4f4c25233a5c86794ca87de4948`
**Status:** completed
**Verdict:** NOT READY (narrow-to-moderate margin; direction verdict REVISE
— architecture recast endorsed, "should not be replaced"; 1 BLOCKING + 6
MATERIAL + 1 DETAIL, all pre-code corrections)

### Verbatim review (round 2)

# Review — LLP 0155, round 2

## 1. Overall assessment

**Direction verdict: REVISE.**

v0.2 resolves the principal round-1 architecture defects correctly. Move 1 now follows LLP 0120 option 3a’s bounded-node composition model; Move 2 adopts fragments and projection-aware authority; the common-snapshot completeness witness is strong; the LLP 0147 Full/Micro boundary is correct; and the central Option-C proof rules are substantially restored.

The product direction remains sound and should not be replaced. It is not READY, however, because the revised write lane still departs from LLP 0129 at a load-bearing point: several sites allow Candidate-B-shaped Move 4 prototyping after Candidate A is merely qualified, whereas LLP 0129 permits B implementation only after A has a retained inexpressibility result. The Stage 0 manifest freeze and Phase 1 start/advance wording also conflate mechanics LLP 0129 deliberately keeps separate. Finally, the claim that DK-9’s revisit trigger has fired is contradicted by the trigger’s exact wording and LLP 0051’s later adjudication.

These are pre-code authority and semantic corrections. They do not require an experiment or a new direction.

### Verification and blindness

- SHA-256 matched at both the beginning and end of review: `cfae8a5c2376490a950c799e4c4a4f7d1f39e4f4c25233a5c86794ca87de4948`.
- Length matched: 1302 lines.
- `./ref-check --verbose` passed: 156 LLP documents, 3,864 refs, zero errors.
- I honored the family-conditioned blindness rules. I read only the permitted Codex-family round-1 artifact. I did not read the Fable artifact, any `*.super-refine.md`, or the orchestrator scratchpad.
- The external claims remain accurate: Zero reports GA as of March 2026 and aggregates as future work; its query API currently exposes `unknown`/`complete` with `prefix` planned; it rejects writes after disconnection. Replicache’s repository reports archival on 2026-06-10, and its documentation describes durable pending mutations and atomic rebase. [Zero status](https://zero.rocicorp.dev/docs/status), [Zero queries](https://zero.rocicorp.dev/docs/queries), [Zero mutators](https://zero.rocicorp.dev/docs/mutators), [Zero connection](https://zero.rocicorp.dev/docs/connection), [Replicache repository](https://github.com/rocicorp/replicache), [Replicache model](https://doc.replicache.dev/concepts/how-it-works).

Files read or substantively inspected:

- `vendor/llp/skills/llp-review/SKILL.md`
- `llp/0155-local-sync-product-direction.rfc.md`
- `llp/reviews/0155-local-sync-product-direction.codex.md`
- LLPs 0008, 0017, 0034, 0051, 0073, 0080, 0093, 0094, 0095, 0100, 0110, 0120, 0129, 0130, 0133, 0138, 0145, and 0147
- `demos/zero-bakeoff/reports/summary.md`
- `issues/closed/20260801-live-delta-frames-bypass-result-contract-validation.md`
- `src/local.rs`
- `tests/live_delta_v0.rs`
- `packages/snapback-client/index.mjs`
- `packages/snapback-react/index.mjs`
- The six official external sources linked above

## 2. Strengths

1. **The Move 1 recast is faithful to LLP 0120.** Static invocation of admitted nodes, per-node bounds and visibility, a summed work ceiling, one snapshot, tuple result contracts, and refusal of data-dependent invocation match option 3a’s actual boundary ([0155:433](/Users/ccheever/projects/snapback/llp/0155-local-sync-product-direction.rfc.md:433), [0120:486](/Users/ccheever/projects/snapback/llp/0120-relational-composition-and-aggregation.research.md:486)). Cursor coordination, partial refusal, shared-parent deduplication, result identity, and maturity are correctly preserved as owning-Spec obligations.

2. **The completeness witness is now strong enough to carry the public claim.** It binds plan, arguments, authority partition, generation, snapshot, and node set and refuses to synthesize completeness from version-skewed fragments ([0155:490](/Users/ccheever/projects/snapback/llp/0155-local-sync-product-direction.rfc.md:490)).

3. **The fragment-first baseline correctly absorbs the projection-authority objection.** Cross-query normalization is now gated on field/projection provenance, version reconciliation, membership-sensitive deletion, and no existence/field oracle, with a concrete adversarial case ([0155:583](/Users/ccheever/projects/snapback/llp/0155-local-sync-product-direction.rfc.md:583), [0155:675](/Users/ccheever/projects/snapback/llp/0155-local-sync-product-direction.rfc.md:675)).

4. **The RFC is materially more honest about authority.** The commissions-not-amends rule, per-move authority table, conflict rule favoring LLP 0129, and explicit non-admission of Option C are good governance ([0155:116](/Users/ccheever/projects/snapback/llp/0155-local-sync-product-direction.rfc.md:116), [0155:152](/Users/ccheever/projects/snapback/llp/0155-local-sync-product-direction.rfc.md:152), [0155:980](/Users/ccheever/projects/snapback/llp/0155-local-sync-product-direction.rfc.md:980)).

5. **The core inexpressibility rules are present.** One valid implementation defeats the claim; both attempts must fail the same fact in separate trees with sealed evidence; the missing primitive is owner-validated; and B receives the same standard ([0155:876](/Users/ccheever/projects/snapback/llp/0155-local-sync-product-direction.rfc.md:876)).

6. **The implementation and packaging corrections are accurate.** Mutation identity is correctly qualified by arm, the test run is labeled author-reported, and Full—not current Micro—is the local-sync packaging vehicle ([0155:216](/Users/ccheever/projects/snapback/llp/0155-local-sync-product-direction.rfc.md:216), [0155:247](/Users/ccheever/projects/snapback/llp/0155-local-sync-product-direction.rfc.md:247), [0155:1057](/Users/ccheever/projects/snapback/llp/0155-local-sync-product-direction.rfc.md:1057)).

## 3. Concerns

1. **BLOCKING — Move 4 is still allowed to start before LLP 0129 permits Candidate B.**

   The authority table requires only “Candidate A qualified + OQ10 boundary/owner frozen”; Move 4 says freezing OQ10’s boundary is the prerequisite to prototyping; write rung 2 likewise starts after A is qualified ([0155:155](/Users/ccheever/projects/snapback/llp/0155-local-sync-product-direction.rfc.md:155), [0155:825](/Users/ccheever/projects/snapback/llp/0155-local-sync-product-direction.rfc.md:825), [0155:1045](/Users/ccheever/projects/snapback/llp/0155-local-sync-product-direction.rfc.md:1045)).

   LLP 0129 is stricter: Candidate B may be implemented only after A has a **retained inexpressibility result** ([0129:1138](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:1138)). That result requires trigger attribution and the exact two-attempt proof, not merely a conformant or “qualified” A ([0129:1422](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:1422), [0129:1536](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:1536)). LLP 0155 itself states the correct rule later at lines 871–874, creating an internal contradiction.

   **Resolution:** Propagate the same gate everywhere: Move 4/B prototyping begins only after A has a retained, owner-validated inexpressibility result under the exact A protocol, and after OQ10’s boundary and owner are frozen. If some typed identity mechanism is already mandatory LLP 0133 shared substrate, classify that narrow mechanism as Candidate A substrate; do not call a B extension prototype.

2. **MATERIAL — The RFC conflates Phase 1 start, evidence-gate passage, phase advancement, and lab scheduling.**

   The decision request and authority table call sizing, D5, owner/timebox, and OQ8 “preconditions” to starting Move 3 ([0155:87](/Users/ccheever/projects/snapback/llp/0155-local-sync-product-direction.rfc.md:87), [0155:159](/Users/ccheever/projects/snapback/llp/0155-local-sync-product-direction.rfc.md:159)). LLP 0129 instead distinguishes:

   - owner/timebox before a phase starts ([0129:1648](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:1648));
   - sizing plus D5 as Phase 1’s evidence gate ([0129:588](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:588));
   - OQ8’s scope-change escalation as blocking automatic advancement, not all Phase 1 work ([0129:604](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:604));
   - OQ8’s answer as mandatory before the decision lab is scheduled and A failure is attributable ([0129:1067](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:1067)).

   The read-lane sentence is also one level too strong. LLP 0129 explicitly names relational planning, custody inspection, and completeness; it does not “name exactly” the whole Move 2 local-materialization and retained local-evaluation commitment ([0155:81](/Users/ccheever/projects/snapback/llp/0155-local-sync-product-direction.rfc.md:81), [0129:1091](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:1091)).

   **Resolution:** Add a four-state gate table: may design/start, may implement, may advance/claim, may schedule the lab. Attribute explicit standing permission only to planning, inspection, and completeness. Move 2 design may be commissioned by LLP 0155, but implementation and shipment remain conditional on its store/retention owners.

3. **MATERIAL — Stage 0 freezes write-lane manifests through an ambiguous second path.**

   Stage 0 says to freeze all six application manifests immediately ([0155:1007](/Users/ccheever/projects/snapback/llp/0155-local-sync-product-direction.rfc.md:1007)), while OQ13 leaves open whether those are reused or re-frozen per stage ([0155:1271](/Users/ccheever/projects/snapback/llp/0155-local-sync-product-direction.rfc.md:1271)).

   LLP 0129’s decision lab owns fresh manifests and check namespaces, requires an owner/timebox before its manifests freeze, and permits baseline changes only through its dated refreeze/rerun rule ([0129:1063](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:1063), [0129:1076](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:1076), [0129:1119](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:1119)). The current text either bypasses that protocol or creates a second set whose relationship to the lab is undefined.

   **Resolution:** Freeze Triage/Fleet read-lane manifests in Stage 0. Leave Kanban/Calendar/Notebook and the Incident safety control to LLP 0129’s lab freeze after its prerequisites. If separate product-outcome manifests are desired, name them as separate artifacts that cannot substitute for lab manifests.

4. **MATERIAL — The DK-9 amendment is now named honestly, but its claimed revisit-trigger basis is false.**

   LLP 0155 says local query-capability pressure “exactly” supplies DK-9’s revisit evidence ([0155:618](/Users/ccheever/projects/snapback/llp/0155-local-sync-product-direction.rfc.md:618), [0155:1001](/Users/ccheever/projects/snapback/llp/0155-local-sync-product-direction.rfc.md:1001)). DK-9’s trigger is narrower: parity-class replay must require query capabilities the interface cannot express **without SQL** ([0008:499](/Users/ccheever/projects/snapback/llp/0008-local-first-sync-and-realtime.rfc.md:499)).

   LLP 0051 subsequently adjudicates this exact point in the opposite direction: IR replay and filters/order over cached rows need no SQL semantics, so DK-9 is honored and its trigger answered without reopening the store mandate ([0051:785](/Users/ccheever/projects/snapback/llp/0051-language-neutral-data-tier.rfc.md:785)). LLP 0155 likewise insists the new physical interface remains store-agnostic.

   **Resolution:** Treat any DK-9 semantic amendment as a deliberate new author decision, not as the old trigger firing. Separate opaque-fragment storage, local evaluation over cached fragments already contemplated by LLP 0051, and any future relational-replica/normalization semantics. Also replace “This move amends” with “This move commissions/requires an amendment,” consistent with the RFC’s authority rule.

5. **MATERIAL — Aggregate deferral conflicts with the Calendar gate and overlooks LLP 0130 SD-2.**

   Move 1 and OQ3 exclude every aggregate, including `count` ([0155:468](/Users/ccheever/projects/snapback/llp/0155-local-sync-product-direction.rfc.md:468), [0155:1238](/Users/ccheever/projects/snapback/llp/0155-local-sync-product-direction.rfc.md:1238)), but Move 4 requires provisional entities to participate in “counts” and “availability counts” ([0155:789](/Users/ccheever/projects/snapback/llp/0155-local-sync-product-direction.rfc.md:789), [0155:841](/Users/ccheever/projects/snapback/llp/0155-local-sync-product-direction.rfc.md:841)).

   LLP 0130 SD-2 also already constrains the eventual aggregate decision: after option-3a usage evidence, an inexpressible demonstrated shape gets a contracted aggregate profile with exact-or-refuse as the default; maintained exact requires contention evidence ([0130:39](/Users/ccheever/projects/snapback/llp/0130-program-standing-decisions.decision.md:39)). OQ3 currently reopens the result-semantics choice too broadly.

   **Resolution:** Define Calendar’s count as either a speculative client-derived cardinality over an already complete bounded result—which is not an admitted aggregate node and must be labeled accordingly—or place it behind the SD-2 branch. Update OQ3 to acknowledge SD-2’s standing default.

6. **MATERIAL — “All first-party clients” is settled in Move 2 while OQ16 leaves the Contract-arm contract open.**

   Move 2 states that all first-party clients expose one query-result materialization ([0155:573](/Users/ccheever/projects/snapback/llp/0155-local-sync-product-direction.rfc.md:573)). OQ16 then asks whether every client must expose identical semantics or whether the Contract arm may retain a stricter, narrower profile ([0155:1282](/Users/ccheever/projects/snapback/llp/0155-local-sync-product-direction.rfc.md:1282)). That is an unresolved product boundary presented as an accepted outcome.

   **Resolution:** Either resolve OQ16 or change the outcome to a common materialization vocabulary with arm-specific admitted authority/retention profiles. Do not promise identical first-party semantics until the stricter Contract path is reconciled.

7. **MATERIAL — The “exact protocol” clause is followed by an incomplete competing restatement.**

   The normative incorporation-by-reference is good, but the bullet list presented as exact omits several controlling parts of LLP 0129: the minimum role assignment and diary blindness ([0129:1411](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:1411)); B’s preregistered coherence ceilings ([0129:1491](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:1491)); ordering-bias handling ([0129:1554](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:1554)); and the complete misattribution set, including ambiguous frozen fact and unresolved attribution ([0129:1440](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:1440)). LLP 0155’s shorter Outcome-0 list could be mistaken for exhaustive ([0155:898](/Users/ccheever/projects/snapback/llp/0155-local-sync-product-direction.rfc.md:898)).

   **Resolution:** Either reproduce the complete controlling checklist or make the local bullets explicitly illustrative and enumerate the omitted load-bearing rules. Preserve LLP 0129 as the sole normative protocol text.

8. **DETAIL — The delta-egress prerequisite is stale against the current tree.**

   LLP 0155 calls the ticket open and links its former open path ([0155:664](/Users/ccheever/projects/snapback/llp/0155-local-sync-product-direction.rfc.md:664)). During this review the target hash remained unchanged, but the ticket moved to `issues/closed/` and now records a resolved candidate-3 implementation with verification ([closed ticket:1](/Users/ccheever/projects/snapback/issues/closed/20260801-live-delta-frames-bypass-result-contract-validation.md:1), [closed ticket:122](/Users/ccheever/projects/snapback/issues/closed/20260801-live-delta-frames-bypass-result-contract-validation.md:122)).

   **Resolution:** Update the path and say that this prerequisite is discharged at the recorded implementation/evidence reach. Preserve it as a regression guardrail rather than an open blocker.

## 4. Suggestions

- Make every move’s authority row distinguish design work, implementation, experimental evidence, public shipping, and capability promotion.
- Use distinct names for “read-lane successor manifests” and “LLP 0129 lab manifests.”
- Replace duplicated proof prose with a short normative import plus a complete delta checklist.
- Split wire ownership precisely: LLP 0094 owns envelope shapes, LLP 0095 owns client behavior/conformance, and LLP 0034 owns the Contract provider seam—not general wire evolution.
- Keep the current fragment-first and one-snapshot completeness language substantially unchanged.

## 5. Open questions

1. Is any pre-trigger Move 4 work intended beyond LLP 0133’s already-mandated shared substrate? If so, what authority permits it before A inexpressibility is established?
2. Are Stage 0’s Kanban/Calendar/Notebook manifests intended to be LLP 0129 lab manifests or separate product-direction evidence?
3. Does “availability count” mean cardinality of a complete bounded local result, a speculative projection, or an admitted aggregate?
4. Is the DK-9 amendment desired as a policy change even though its SQL-dependent revisit trigger has not fired?
5. Is one common materialization vocabulary sufficient, or is identical storage behavior across JS/React and Contract arms actually required?

## 6. Recommended next step

Revise to v0.3 before acceptance:

1. Require retained A inexpressibility before all Candidate-B/Move-4 prototypes.
2. Separate Phase 1 start, evidence, advancement, and lab-scheduling gates.
3. Split read-lane manifest freezing from LLP 0129’s write-lab freeze.
4. Reframe DK-9 as a deliberate commissioned amendment, not a fired revisit trigger.
5. Reconcile Calendar counts with aggregate deferral and LLP 0130 SD-2.
6. Resolve or weaken the all-first-party-client claim.
7. Make the exact-protocol restatement complete or explicitly non-exhaustive.
8. Refresh the closed delta-egress ticket reference.

Then run one focused re-review of those eight edits. No implementation experiment is needed before that review.

**Verdict: NOT READY — narrow-to-moderate margin**
## Round 3 — 2026-08-02

**Reviewer family:** OpenAI GPT (GPT-5.6)
**Provider / runtime:** codex-cli 0.146.0 `codex exec`, model `gpt-5.6-sol`,
`model_reasoning_effort=xhigh`, read-only sandbox
**Date:** 2026-08-02
**Redacted:** no (repository-local review; external Zero/Replicache pages
re-checked)
**Method:** fresh non-interactive session over the working tree;
family-conditioned blindness — own rounds 1–2 artifacts permitted, other
family's artifact and all journals prohibited; the review states it honored
this. SHA-pinned target verified at both review boundaries; ref-check run
by the reviewer. Focused delta review of the v0.3 round-2 repairs per
capsule `capsule-0155-r3.md` (the reviewer's own round-2 condition).
**Target:** `llp/0155-local-sync-product-direction.rfc.md` (1398 lines,
Draft, v0.3)
**Target SHA-256:** `602497f35ba140dabd7804b0acecd0db6b73546aad652d51ac747a7afb01eb2e`
**Status:** completed
**Verdict:** READY (moderate margin; direction verdict ENDORSE; no
BLOCKING or MATERIAL concerns; 2 DETAIL)

### Verbatim review (round 3)

# Review — LLP 0155, round 3

## Overall assessment

**Direction verdict: ENDORSE.**

v0.3 resolves every blocking and material round-2 concern. The six-move direction is coherent with the governing LLPs, preserves LLP 0129’s admission authority, and correctly leaves implementation-dependent questions to bounded Specs and empirical gates.

The RFC now meets the standing READY bar: the direction has been reasoned as far as it usefully can without implementing the successor store, evaluator, and decision lab.

Verification:

- SHA-256 matched at both review boundaries: `602497f35ba140dabd7804b0acecd0db6b73546aad652d51ac747a7afb01eb2e`.
- Length matched: 1,398 lines.
- `./ref-check --verbose` passed: 157 LLP documents, 4,054 references, zero errors.
- The file is a Draft. Git currently reports it as a tracked modification (`M`), not untracked as stated in the capsule; the exact hash matched, so this repository-state discrepancy did not affect the review.

## Focused delta findings

All ten change classes are substantively correct:

1. Candidate-B work now consistently requires retained, owner-validated Candidate-A inexpressibility plus OQ10’s frozen B boundary and owner. The Candidate-A/LLP-0133 substrate alternative is preserved in the controlling text ([0155:113](/Users/ccheever/projects/snapback/llp/0155-local-sync-product-direction.rfc.md:113), [0155:882](/Users/ccheever/projects/snapback/llp/0155-local-sync-product-direction.rfc.md:882), [0155:1127](/Users/ccheever/projects/snapback/llp/0155-local-sync-product-direction.rfc.md:1127); [0129:1138](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:1138), [0129:1536](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:1536), [0129:1695](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:1695)).

2. Phase start, evidence-gate passage, advancement, and lab scheduling are correctly separated ([0155:104](/Users/ccheever/projects/snapback/llp/0155-local-sync-product-direction.rfc.md:104), [0155:183](/Users/ccheever/projects/snapback/llp/0155-local-sync-product-direction.rfc.md:183); [0129:588](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:588), [0129:604](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:604), [0129:1067](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:1067), [0129:1648](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:1648)).

3. Read-lane authority is precisely attributed: planning, inspection, and completeness are enumerated permissions; fragment materialization rests on the broader no-browser-write-expressiveness criterion and remains owner-amendment-gated ([0155:94](/Users/ccheever/projects/snapback/llp/0155-local-sync-product-direction.rfc.md:94); [0129:1091](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:1091)).

4. Stage 0 now distinguishes Triage/Fleet successor manifests from LLP 0129’s lab freeze, preserves separate artifact identity, and correctly imports the dated refreeze/rerun rule ([0155:1079](/Users/ccheever/projects/snapback/llp/0155-local-sync-product-direction.rfc.md:1079); [0129:1032](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:1032), [0129:1119](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:1119)).

5. DK-9 is accurately framed as a deliberate new policy decision. Its SQL-specific trigger did not fire, and LLP 0051 already answered it without requiring SQL ([0155:651](/Users/ccheever/projects/snapback/llp/0155-local-sync-product-direction.rfc.md:651); [0008:450](/Users/ccheever/projects/snapback/llp/0008-local-first-sync-and-realtime.rfc.md:450), [0051:785](/Users/ccheever/projects/snapback/llp/0051-language-neutral-data-tier.rfc.md:785), [0080:351](/Users/ccheever/projects/snapback/llp/0080-portable-relational-queries-and-projections.rfc.md:351)).

6. Calendar counts are now presentation-layer cardinalities over a complete bounded base, not admitted aggregate nodes. Genuine aggregate demand correctly routes through SD-2’s exact-or-refuse default and measured-contention branch ([0155:843](/Users/ccheever/projects/snapback/llp/0155-local-sync-product-direction.rfc.md:843), [0155:1323](/Users/ccheever/projects/snapback/llp/0155-local-sync-product-direction.rfc.md:1323); [0120:255](/Users/ccheever/projects/snapback/llp/0120-relational-composition-and-aggregation.research.md:255), [0130:39](/Users/ccheever/projects/snapback/llp/0130-program-standing-decisions.decision.md:39)).

7. Move 2 now promises a common vocabulary, not identical authority or retention behavior across client arms ([0155:603](/Users/ccheever/projects/snapback/llp/0155-local-sync-product-direction.rfc.md:603)).

8. The proof digest is unmistakably illustrative, names LLP 0129 as sole normative authority, and preserves every previously omitted load-bearing rule and all eight misattribution classes ([0155:938](/Users/ccheever/projects/snapback/llp/0155-local-sync-product-direction.rfc.md:938); [0129:1411](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:1411), [0129:1440](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:1440), [0129:1491](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:1491)).

9. The delta-egress closure is accurately represented. The tree admits only schema-exact `documents(table)` contracts to the delta lane and contains negative regressions for narrowed `records` and nominal-but-narrowed `documents` contracts ([0155:703](/Users/ccheever/projects/snapback/llp/0155-local-sync-product-direction.rfc.md:703), [closed ticket:122](/Users/ccheever/projects/snapback/issues/closed/20260801-live-delta-frames-bypass-result-contract-validation.md:122), [local.rs:2974](/Users/ccheever/projects/snapback/src/local.rs:2974), [live_delta_v0.rs:88](/Users/ccheever/projects/snapback/tests/live_delta_v0.rs:88)).

10. The remaining details are correct: Full remains the local-sync packaging vehicle; wire ownership is accurately split; OQ14 preserves LLP 0129’s baseline-change rule; and current official Zero documentation confirms that aggregates are non-committed future work and `prefix` remains planned ([0155:1142](/Users/ccheever/projects/snapback/llp/0155-local-sync-product-direction.rfc.md:1142), [0147:510](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:510), [Zero status](https://zero.rocicorp.dev/docs/status), [Zero queries](https://zero.rocicorp.dev/docs/queries)).

## Concerns

No BLOCKING or MATERIAL concerns remain.

1. **DETAIL — The executive summary and authority-table row compress the Candidate-A alternative.**

   Lines 71–72 and row 4 describe Move 4 chiefly as Candidate-B-shaped, while the controlling admission and sequencing text correctly allows it to arrive as Candidate-A substrate through LLP 0133’s logical-mint mapping ([0155:71](/Users/ccheever/projects/snapback/llp/0155-local-sync-product-direction.rfc.md:71), [0155:184](/Users/ccheever/projects/snapback/llp/0155-local-sync-product-direction.rfc.md:184), [0155:893](/Users/ccheever/projects/snapback/llp/0155-local-sync-product-direction.rfc.md:893)).

   **Resolution:** No readiness change is required because the normative boundary is unambiguous. Optionally add “unless Candidate A plus LLP 0133 already expresses it” to the summary/table.

2. **DETAIL — Incident Room’s artifact ownership should become explicit during Stage 0.**

   LLP 0129 currently freezes three named workloads—Kanban, Calendar, and Notebook—and separately defines generic safety gates; it does not name Incident Room. LLP 0155 calls Incident Room the lab safety control ([0155:1083](/Users/ccheever/projects/snapback/llp/0155-local-sync-product-direction.rfc.md:1083), [0155:1135](/Users/ccheever/projects/snapback/llp/0155-local-sync-product-direction.rfc.md:1135); [0129:1032](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:1032), [0129:1209](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:1209)).

   **Resolution:** In the commissioned LLP 0129 cross-reference, explicitly register Incident Room as a named safety-control artifact, or describe it as an additional product-direction control rather than one of LLP 0129’s existing workload manifests. This is a documentation-ownership cleanup, not an evidence or authority defect.

## Suggestions

- Keep the fragment-first baseline, common-snapshot completeness witness, and sole-normative-protocol language unchanged.
- When Stage 0 lands, make its cross-reference enumerate the Candidate-A alternative and Incident Room artifact identity explicitly.
- Preserve the delta-ingestion case as a standing successor-Spec regression even if per-operation validation later widens candidacy.

## Blindness and files read

I honored the family-conditioned blindness rules. I read the permitted Codex-family prior artifact. I did not read the Fable artifact, any `*.super-refine.md`, or the orchestrator scratchpad, and I did not communicate with the other reviewer.

Files read or substantively inspected:

- `vendor/llp/skills/llp-review/SKILL.md`
- `llp/0155-local-sync-product-direction.rfc.md`
- `llp/reviews/0155-local-sync-product-direction.codex.md`
- LLPs 0008, 0034, 0051, 0080, 0094, 0095, 0120, 0129, 0130, and 0147
- `issues/closed/20260801-live-delta-frames-bypass-result-contract-validation.md`
- `src/local.rs`
- `src/result_contract.rs`
- `tests/live_delta_v0.rs`
- Official Zero status, queries, mutators, and connection documentation
- The Replicache repository page and “How Replicache Works” documentation

**Verdict: READY — moderate margin**