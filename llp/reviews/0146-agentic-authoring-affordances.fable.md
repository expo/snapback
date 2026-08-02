# LLP 0146 agentic authoring affordances review — Fable family


## Round 1 — 2026-08-01

**Reviewer family:** Claude Fable
**Provider / runtime:** Anthropic Claude Code, `claude-fable-5`, fresh
non-author subagent
**Effort:** session-inherited
**Date:** 2026-08-01
**Method:** fresh non-author subagent context, read-only review of the working
tree; mutually blind — no `llp/reviews/` artifact concerning LLP 0146 read,
blind to this RFC's codex artifact. SHA-pinned target and instruction capsule.
**Instruction capsule SHA-256:** `0b009ed73a1f87f1fd0512a66435e1be1f57bf1ef21f74761a913cfe331333ce`
**Target:** `llp/0146-agentic-authoring-affordances.rfc.md` (605 lines, Draft)
**Target SHA-256:** `eeecc46c923d4f4248c2eb2cae26a4c81b9bf2ca0e80ee2c9a477fd53e7d36ca`
**Repo revision at review start:** origin/main `7c509eb6`
**Tool uses:** 48 (reported), 51 (harness)
**Status:** completed
**Verdict:** NOT READY

## Verbatim review

## Overall assessment
**Verdict: NOT READY**

The document's load-bearing spine holds: I independently verified the correction in §"A verified correction" — live subscriptions and invalidation key off runtime-captured `CapturedReadDependency` values, mutation commit validates against the runtime-captured `executed.reads`, nothing in the tree compares declared and captured sets, and the sole out-of-file consumer of `captured_reads` is the secret-scope union in `src/admin.rs`. Every claim the capsule flagged as checkable (acceptance.run pinned-but-unbuilt, CV-14 open and unclaimed, the 0127-decision-6 record) checked out exactly. But the "What already ships" baseline — which the document itself declares load-bearing ("Establishing the baseline matters") — contains two false "Shipped"/"implemented" claims (query explain is not implemented; checkpoint is neither a host op nor the cited code), D1's v0 verdict vocabulary has a scope error (per-invocation `overDeclared` is meaningless for conditional reads), D1's refusal codes are assigned to the wrong registry (LLP 0144 scopes itself to app-declared codes, not platform codes), and D5 never engages the LLP 0110/0134/0135 relation family that deliberately declined the exact `onTargetDelete` ground D5 builds on. All four are cheaply fixable and none inverts a decision, so this is a one-revision NOT READY, not a structural one.

## Strengths

What I verified, versus inferred, to establish the following:

- **The correction is true, and for the right reason.** `LiveSubscription.read_dependencies` is typed `Vec<CapturedReadDependency>` (`src/local.rs:3298`), registered from the executed query at `src/local.rs:13688`, with the invalidation/epoch path consuming it at `:13399`, `:14618`, and `:19177`. Mutation commit builds `BufferedCommitPayload { read_dependencies: executed.reads, … }` at exactly the three cited lines (`src/local.rs:11111`, `:11568`, `:11797`), and `executed.reads` is `Vec<CapturedReadDependency>` by construction (`src/runtime.rs:277`). The type system makes declared-name flow into invalidation structurally impossible; I found no declared-reads consumer in any invalidation path (Cloudflare arm included — no independent `read_dependencies` handling exists under `cloudflare/`), only the two secret-scope wideners (`src/admin.rs:1774`, `src/host_ops.rs:1444`). The critique's premise is false as the doc says, and D1's relocation from runtime-correctness to artifact-trustworthiness is the right consequence.
- **The three checkable pins are exact.** `guide/operating/host-ops.md:72` says precisely "pinned but unbuilt" for `acceptance.run` (mirrored in `src/host_ops.rs:55`); `llp/0115-convex-parity-course-corrections.plan.md:435` says precisely "Open (claimed by no move; rides its custody trigger)"; `src/admin.rs:1781` is the only `captured_reads` field access outside `local.rs` (the `capturedReads` string at `src/storage.rs:11067` is a conflict-detail key on a local parameter, not a consumer of the field).
- **The FunctionRunResult anchor is exact**, including the Valet "counts stuck at zero" doc comment (`src/local.rs:1440-1447`) and both set pairs on the struct.
- **The 0127-decision-6 posture is correct.** The decision record (`llp/0115:922-930`) says declared reads/writes REMAIN evidence and "ceiling enforcement is sequenced as its own later decision, decoupled" — D1 strict mode is exactly that decision, taken as opt-in, with the new-app default honestly reopened as OQ1. The `inline-helper-sharing.test.mjs:7` quote is verbatim.
- **The declines are argued, not asserted.** Verified supporting facts: LLP 0097 does state exhaustive egress mediation as a prerequisite (`0097:42,62`); LLP 0062 does list `--transcript` under future work (`0062:664`) and binds replay to settlement identity (`:434-444`); LLP 0054 does recommend the seeded simulator with safety/liveness phases; the comparator profile does carry actor/observer identities (`packages/snapback-cli/comparator-profile.mjs:348-357`); no existing suggestion machinery collides with D7. The C13 decline (bytes not tokens) and the auto-aliasing decline are the strongest reasoning in the document.
- **Scope discipline is good.** No proposed decision is secretly two (D1's three surfaces are explicitly staged across waves; D7's merge is named); open items are named as open (seven OQs, including the CV-14 custody question the 0115 trigger requires).

## Findings

**MATERIAL-1 — "Query explain — Shipped" and "checkpoint … implemented in `src/host_ops.rs`" are false**
§Summary and §"What already ships". The Summary asserts "Mutation dry-run, query explain, and checkpoint are implemented in `src/host_ops.rs`," and the table lists "Query explain | Shipped." In fact `function.explain` serves *only* `mutationDryRun`; `queryPlan` and the permission/capability kinds refuse with "pinned by LLP 0024 but not built yet (mutationDryRun is served)" (`src/host_ops.rs:1686-1725`; the guide says the same at `guide/operating/host-ops.md:66`). No query explain exists anywhere else. Checkpoint is not in `src/host_ops.rs` at all; the shipped affordance is `snapback auth backup`/`auth restore` (`src/cli.rs:900-907`), and the table's own witness "`checkpoint` in `src/local.rs`, `src/auth/backup.rs`" resolves to crash-injection checkpoint helpers (`src/auth/backup.rs:1533-1599`) and migration `checkpoint_label` fields — not an agent-facing checkpoint verb. This also overstates "LLP 0019's recommended sequence is substantially executed": step 4's explain-denial half (`llp/0019:333`) is unbuilt. Fix: row "Query explain" becomes "Partial (mutationDryRun only)" or moves to the pinned-but-unbuilt class; the checkpoint row's witness becomes the backup/restore surface; the Summary sentence is corrected.

**MATERIAL-2 — D1's per-invocation `overDeclared` verdict is semantically wrong as specified**
§D1 surface 1. Report mode says *every invocation* emits `conformant`/`underDeclared`/`overDeclared`, with `overDeclared` = "declared entries never witnessed." A handler that reads table B only on one branch will be `overDeclared` on every invocation that doesn't take that branch — per-invocation absence is not over-declaration, it is conditionality. Over-declaration is only decidable at aggregate scope, which the document itself already places in D2's coverage surface ("declared dependencies never witnessed by *any* acceptance path"). As written, report mode's third verdict is noise-by-construction and would teach agents to distrust the very conformance signal D1 exists to create. Fix: report mode emits `conformant`/`underDeclared` plus the raw unwitnessed-this-invocation set as data; `overDeclared` becomes a coverage-scope verdict only, and the acceptance line is rescoped accordingly.

**MATERIAL-3 — D1's refusal codes are assigned to LLP 0144's registry, which scopes itself to app codes**
§D1 cost line ("two refusal codes (LLP 0144's registry)"). `SNAPBACK_HANDLER_UNDECLARED_READ`/`_WRITE` are platform-minted host refusals. LLP 0144 is the registry for *application-declared* codes carried under `SNAPBACK_APP_REFUSAL` with `appCode`; it explicitly distinguishes platform-code registry gaps as a different thing ("that ticket's recorded gaps are *platform*-code registry gaps," `llp/0144:135-137`), and platform codes are governed by the LLP 0010 diagnostic-code discipline. OQ6 correctly leaves D7's remediation-registry home open, but D1 asserts the wrong home as settled. Fix: cite the platform diagnostic-code discipline (LLP 0010 family) for the two new codes, or open the registry question explicitly.

**MATERIAL-4 — D5 never engages the LLP 0110/0134/0135 relation family, which declined the ground `existsRelation` builds on**
§D5. The claim that the four v1 classes are "the classes not already covered by uniqueness constraints, transaction read sets, and the membership-transition invariants" omits the closest shipped neighbor: the bounded parent/child relation profile, whose manifest already carries framework-owned relation declarations (`RelationIncarnation { foreign_key_field, parent_table }`, `src/manifest.rs:836-840`), whose *only* parent-deletion policy is `hide-orphans.v1`, and which explicitly excludes "referential constraints, cascade deletion, or orphan cleanup" (`llp/0110:169, :329-333, :917`). `existsRelation` with `onTargetDelete: 'restrict'` is precisely a referential constraint on that family's territory, and the interaction is real: a restrict invariant layered on a relation whose read profile *hides* orphans produces two coexisting deletion semantics on the same shape. Maybe the resolution is easy (D5 targets un-promoted ad-hoc relations; promoted relations keep hide-orphans), but the document must say so, and LLP 0110/0134/0135 belong in Related. This is the one place where "does anything it proposes already exist, in part?" gets a partial yes that the document doesn't surface.

**DETAIL-1 — LLP 0144 is in Review, not Draft**
§"What already ships" table row "Declared app refusal codes | Draft." `llp/0144:4` says `**Status:** Review`.

**DETAIL-2 — The recent-invocation ring is implemented, not merely "Specified"**
§"What already ships" row and D1 surface 1. The ring ships: `RECENT_INVOCATIONS_CAPACITY = 128`, surfaced as `data.recentInvocations`, bounded-ring tests (`src/host_ops.rs:57-105, :1893`). This strengthens D1's plumbing claim, but note the ring records *host operations* only ("One recorded host operation," `src/host_ops.rs:63-64`) — D1's "every function invocation … without instrumenting anything" needs the app-data plane wired into it or a scoping caveat.

**DETAIL-3 — "Five candidates are explicitly declined or deferred" vs six adjudicated**
§Summary vs §Declined and deferred. C8–C13 is six candidates; the count of five works only if C8 is bookkept as "partially absorbed," which the Summary doesn't say. Also "Declined 2" is titled Declined but disposes as "deferred, opt-in."

**DETAIL-4 — D3's `--changed-since <digestHash>` mechanism is unexamined**
§D3. Serving a delta against a prior digest *hash* requires the server to reconstruct what that digest contained (persisting digest-hash → generation/state identity, or having the client present the prior digest). Since this flag is "where most of the token saving actually lives," the mechanism question belongs in OQ3 or the D3 body.

TOOL_USES: 48

## Round 2 — 2026-08-01 (delta-scoped)

**Reviewer family:** Claude Fable
**Provider / runtime:** Anthropic Claude Code, `claude-fable-5`, fresh
non-author subagent
**Effort:** session-inherited
**Date:** 2026-08-01
**Method:** fresh non-author subagent context, read-only delta review of the
working tree; permitted to read only this family's round-1 artifact above,
blind to the codex artifact and the super-refine journal. SHA-pinned target
and instruction capsule.
**Instruction capsule SHA-256:** `430e8c16522abd3ad5d8b96ed22166e6756ae503d9f3d0d30336e1761149f103`
**Target:** `llp/0146-agentic-authoring-affordances.rfc.md` (v0.2, 901 lines, Draft)
**Target SHA-256:** `111b7b364b219e516d1667f9dd0a7efbec46346291cb4eaa58cc7fff3bcd9e29`
**Repo revision at review start:** working tree at v0.2 (pushed as `c28264cf`)
**Tool uses:** 14
**Status:** completed
**Verdict:** READY

## Verbatim review

## Overall assessment
**Verdict: READY**

Every finding I raised in round 1 — four MATERIAL, four DETAIL — is genuinely fixed in v0.2, not merely acknowledged, and I verified each fix against the code or corpus rather than taking the Revised block's word. The rebuilt correction, which is the document's load-bearing spine, is true and precisely cited on both targets: I confirmed the local matcher's declared-summary fallback fires exactly when no `Query` dependency was captured (`src/live_matcher.rs:230-234`, with the quoted comment verbatim) and that the `IbexModule` arm then filters on declared `read_set_summary.tables` (`:147-155`), and I confirmed the Cloudflare `fanOut` selects subscriptions solely by declared `fn.tables` (`cloudflare/src/coordinator.js:5165`, `functionTables` at `:5539-5542`) with the header's own "captured read sets are recorded but not yet validated" admission at `:22`. The declared-table live-delivery defect on Cloudflare is real, reachable, and correctly elevated to the reason D1 goes first. The three withdrawals are honest — I verified the shipped last-holder guard (`src/storage.rs:13192-13203`, `:13220-13221`) and the pinned-unbuilt `acceptance.run` framing that D2 no longer claims to close — and the new text (independent-delta conformance evidence, hash custody, reproduction classes, four-axis remediations, promoted-incarnation refusal) is internally consistent and scoped to what the evidence supports. Remaining issues are detail-level.

## Round-1 finding dispositions

- **MATERIAL-1 (query explain / checkpoint falsely "Shipped") — FIXED.** Baseline rows now read "Pinned, unbuilt" for query explain and explain-denial (llp/0146:116-117) with the correct witness — I re-verified `explain_function` serves only `mutationDryRun` and emits `SNAPBACK_EXPLAIN_KIND_UNIMPLEMENTED` at `src/host_ops.rs:1717-1721`, and `guide/operating/host-ops.md:66` matches. The checkpoint row is replaced by "Quiesced backup and restore | Shipped (operator, not agent-facing)" with the correct `src/cli.rs:900-907` witness (verified: `Backup`/`Restore` variants). The Summary sentence is corrected to "partly executed" with the explain-denial half named unbuilt (llp/0146:40-44).
- **MATERIAL-2 (per-invocation `overDeclared` semantically wrong) — FIXED.** D1 now emits two independent deltas plus a provenance state, with `extra` explicitly "data, not a verdict" (llp/0146:263-267); over-declaration is judged only at D2's aggregate coverage scope (llp/0146:284-288); the acceptance line encodes the conditional-read case exactly as my finding required (llp/0146:311-312). The provenance grounding is real: I verified `action_run_result` constructs empty captured sets (`src/local.rs:1711-1726`, within the cited 1705-1740).
- **MATERIAL-3 (refusal codes assigned to LLP 0144's app-code registry) — FIXED.** The cost line now names them **platform** codes under the LLP 0010 discipline and cites 0144's own platform/app distinction (llp/0146:317-321); I re-verified `llp/0144:4` (Status: Review) and `:135-137`. The relocated ceiling-sequencing attribution to LLP 0108 is also correct — "Ceiling enforcement is sequenced as its own later decision, decoupled from this slice" appears verbatim at llp/0108:~882-883, so the citation is no longer resting only on 0115's decision record.
- **MATERIAL-4 (D5 never engaged the LLP 0110/0134/0135 relation family) — FIXED.** A full disposition section exists (llp/0146:514-526) with exactly the facts I demanded, all re-verified: `RelationIncarnation { foreign_key_field, parent_table }` at `src/manifest.rs:836-841`, `hide-orphans.v1` as the only parent-deletion policy (`llp/0110:169, :329-333`), the referential-constraints exclusion (`llp/0110:917`). The resolution is the one I sketched — D5 applies only to ad-hoc relations, codegen refuses promoted incarnations, convergence is OQ13 — and 0110/0134/0135 are now in Related (llp/0146:31-32).
- **DETAIL-1 (0144 status) — FIXED.** Row says "Review" (llp/0146:123); `llp/0144:4` confirms.
- **DETAIL-2 (ring shipped, host-ops-only) — FIXED.** Row says "Shipped — host operations only" (llp/0146:124), and D1 surface 1 carries the wiring caveat (llp/0146:283-287); verified `src/host_ops.rs:57-105`, "One recorded host operation" at `:63-64`.
- **DETAIL-3 (five-vs-six count) — FIXED.** Summary says "Six candidates" (llp/0146:63); C8's row says "Partially absorbed into D7" (llp/0146:143); Declined 2's title self-labels "(deferred, opt-in)".
- **DETAIL-4 (`--changed-since` mechanism unexamined) — FIXED.** The hash-custody paragraph names the three shapes and the unknown-hash degradation requirement (llp/0146:382-390), carried by OQ10. The reconciliation with LLP 0062 is genuine: `introspect --changed-since <envelopeHash>` exists verbatim at `llp/0062:1520-1521`.

## Strengths

Verified, not inferred: the full local-fallback chain (`live_subscription_may_be_affected` at `src/live_matcher.rs:129`, helper at `:195`, the `None`-on-no-Query-dependency return with quoted comment at `:230-234`, the declared-tables arm at `:147-155`); the Cloudflare fan-out filter and `functionTables`; commit validation on `executed.reads` (`src/local.rs:11111/:11568/:11797` all exact, reaching `validate_captured_read_set` at `src/storage.rs:4457`); the `FunctionRunResult` doc comment and both set pairs (`src/local.rs:1440-1458`); the sole external `captured_reads` consumer (`src/admin.rs:1781`); the migration-derivation reuse claim in D4 (`derive_intents` doc and `SNAPBACK_MIGRATION_PLAN_INVALID`, `src/migration.rs:896-923`; preview at `src/cli.rs:779-813`); the last-holder guard both directions (`src/storage.rs:13192-13203`, `:13221`); LLP 0054's unratified status (`0054:414-419`); CV-14 still Open (`0115:435`); the LLP 0080 §4 table-granularity @ref sitting directly on the relational arm (`src/live_matcher.rs:170-173`) — so the "other arms" disposition (plan-derived tables, agent cannot under-declare) is right. Inferred-plausible, not independently verified: D5's "membership existence is likewise covered by the existing resource-existence checks" and the exact v0.1-example provenance claims in D7. The new OQ8/OQ12/OQ14 set honestly names every seam the correction opened, and the Status section's insistence that the Cloudflare defect be ticketed independently of the RFC's fate is exactly the right separation of product defect from proposal.

## Findings

**DETAIL-1 — "an empty or wrong `read_set_summary.tables`" lumps the safe case with the hazardous one, locally**
§The correction, local target (llp/0146:190-191). In the fallback arm, `tables.is_empty()` passes *every* change through the filter (`src/live_matcher.rs:151`), so an empty declared set is the conservative direction locally — it can only add wake-ups. Only a **non-empty wrong** set can suppress delivery. The sentence "an empty or wrong `read_set_summary.tables` decides delivery on its own" is literally true but implies the empty case shares the hazard. One clause fixes it. (Adjacent strengthening the document could also claim: the fallback is reachable not just for handlers that "never ran, or captured nothing" but for any handler whose capture has only `Row`/`MissingRow` facts and no `Query` dependency — `src/live_matcher.rs:226-234` — so a point-read-only handler that ran successfully still lands on the declared arm.)

**DETAIL-2 — On Cloudflare, the *undeclared* case is silently narrowed, not conservative — unmentioned**
§Cloudflare arm / OQ8. `functionTables` falls back to `[schema.tables[0].name]` when `fn.tables` is empty (`cloudflare/src/coordinator.js:5539-5542`): a live query with no declared tables fans out only on the first schema table. That is a second, arguably worse, reachable miss on the same arm — the document's stated defect (declares A, reads B) is verified true, but the no-declaration case deserves a sentence, since it sharpens OQ8's "unwitnessed function" widening option and is exactly the state a code-first agent leaves a handler in.

**DETAIL-3 — "The last two rows are the leverage" is mild residue of D2's withdrawn claim**
§What already ships (llp/0146:128-129). v0.1 could call `acceptance.run` "the leverage" because D2 claimed to close it; v0.2's D2 explicitly does not (llp/0146:328-336), leaving the hole's relevance hanging on OQ9's maybe. The framing sentence should either be scoped to the captured/declared row alone or say the hole's leverage is conditional on OQ9. This is the only withdrawal residue I found; the D5 and D6 withdrawals are clean.

**DETAIL-4 — OQ8's third option is in tension with Wave 3 sequencing**
§Sequencing (llp/0146:817-821) says the OQ8 disposition "should land with Wave 1 … whichever of the three shapes is chosen," but the third shape is required strict mode on that target, and strict mode is Wave 3 machinery (llp/0146:813-815). If option 3 wins, either it jumps the waves too or the "lands with Wave 1" commitment fails. One sentence resolving the conditional (e.g., "if the strict-mode shape is chosen, its target-scoped subset jumps with it") closes the gap.

None of these blocks. The document now decides exactly as much as it has evidence for, names its fourteen open items as open, and every factual claim I checked about the codebase and corpus is true.

TOOL_USES: 14

## Round 3 — 2026-08-01 (delta-scoped)

**Reviewer family:** Claude Fable
**Provider / runtime:** Anthropic Claude Code, `claude-fable-5`, fresh
non-author subagent
**Effort:** session-inherited
**Date:** 2026-08-01
**Method:** fresh non-author subagent context, read-only delta review;
permitted to read only this family's artifact above, blind to the codex
artifact and the super-refine journal. SHA-pinned target and capsule.
**Instruction capsule SHA-256:** `c8a064f831bc222d507473f1ba5c319c45327954ac2b4e385c94455738736af0`
**Target:** `llp/0146-agentic-authoring-affordances.rfc.md` (v0.3, 1043 lines, Draft)
**Target SHA-256:** `9d3658ad85ed9c9402d5373e069c3469ed1acfe377b81accd678c168f00393c4`
**Repo revision at review start:** working tree at v0.3 (pushed as `f946e69a`)
**Tool uses:** 21
**Status:** completed
**Verdict:** READY (with 1 MATERIAL and 5 DETAIL to apply before promotion)

## Verbatim review

## Overall assessment
**Verdict: READY**

All four of my round-2 findings are genuinely fixed, and every new factual claim v0.3 makes about the codebase and the corpus that I checked — the retention/opaque-JS disposition, the four-collection structure behind D1's class split, the `envelopeHash` immutability claim, the source-side location of `RelationIncarnation`, the one-shot execution kind of search, and the LLP 0094 carrier-ownership reassignment — verified true against the code or the cited document, at the cited lines. The changes responding to findings I never raised are correct on their merits: the read/write-swap cancellation example motivating D1's class split is arithmetically right; the `digestCursor` split correctly follows from LLP 0062's "content-addressed and immutable" envelope; the moved D5 overlap test now names the side the incarnation actually lives on; D6's transitivity argument is exactly what LLP 0054's stricter injected-interface route (verified at `llp/0054:243-257`) implies D6 cannot borrow. I found one MATERIAL defect, and it is precisely the capsule's predicted failure mode recurring: the v0.3 body edits did not fully propagate into the normative acceptance lines — D5's acceptance clause still encodes the *withdrawn* target-side overlap test that the body two paragraphs earlier declares names the wrong side. Because the body states the correct resolution unambiguously and the fix is a one-clause rewrite with no remaining design thinking, this is a transcription lag rather than an un-thought-through issue, and the document has reached the bar. The MATERIAL and the details below must still be applied before any status promotion.

## Round-2 finding dispositions

- **DETAIL-1 (empty-vs-wrong lumped, locally) — FIXED.** `llp/0146:216-225` now carries both qualifications: "An empty declared set is the safe direction" (re-verified: `tables.is_empty()` passes every change through the filter, `src/live_matcher.rs:151`) and the adjacent strengthening I sketched — the fallback is reachable on success for point-read-only handlers, grounded in the `saw_query_dependency` test (re-verified at `src/live_matcher.rs:230-234`).
- **DETAIL-2 (Cloudflare `functionTables` first-schema-table fallback unmentioned) — FIXED.** `llp/0146:238-247` records the fallback with the correct citation (re-verified: `return [schema.tables[0].name]`, `cloudflare/src/coordinator.js:5539-5542`), calls it "a second and arguably worse miss," ties it to the code-first authoring state, and OQ8's widening option now covers "unwitnessed" functions (`llp/0146:999-1000`).
- **DETAIL-3 (leverage residue of D2's withdrawn claim) — FIXED.** `llp/0146:148` scopes "the leverage" to the captured/declared row alone, and `:153-155` makes `acceptance.run`'s leverage explicitly conditional on OQ9 — exactly the rescoping I asked for.
- **DETAIL-4 (OQ8 shape 3 vs Wave 3 sequencing) — FIXED.** `llp/0146:954-960` resolves the conditional in the form I sketched: shapes 1–2 are Wave 1 outright; if shape 3 wins, its target-scoped subset jumps to Wave 1 and the rest of strict mode stays in Wave 3; and the schedule cost is named as an input to OQ8.

## Strengths

What I verified in v0.3's new text, versus inferred:

- **The retention/opaque-JS disposition's conclusion is true.** `validate_retainable_query` refuses any non-HostPlan runtime with `undeclarable_retention(function, "opaqueJavaScript")` (`src/manifest.rs:2980-2982`), and the derived RQS predicate `rqs_eligible_digest_kind` (`src/manifest.rs:2314-2353`) requires `HostPlan(HandlerPlan::Query)` with a complete plan-consistent single-table summary; the Cloudflare mirror applies the same conjunction with its own comment "opaque-JS handlers can never be eligible, exactly as on the local arm" (`cloudflare/src/rqs-host.mjs:194-223`). In every admitted shape the summary is checked against the plan, so drift indeed has no silent retention effect today, and narrowing OQ12 to the eligibility-expansion conditional is right. (One conflation in the supporting sentence — DETAIL-2 below.)
- **D1's class split is grounded and its motivating example is correct.** `FunctionRunResult` carries exactly four collections — declared `reads`/`writes` and `captured_reads`/`captured_writes` (`src/local.rs:1449-1458`) — and the read-A/write-B swap does produce identical untagged unions on both sides while being two violations. Actions construct empty captured sets (`src/local.rs:1707-1726`), so per-class provenance is necessary, not decorative.
- **D3's split follows from a true premise.** LLP 0062's envelope is "content-addressed and immutable" (`llp/0062:246-260` verbatim) and `introspect --changed-since <envelopeHash>` exists at `llp/0062:1520-1521`; an immutable content address genuinely cannot key dynamic observation state, so the static/dynamic split with a `digestCursor` is the correct repair rather than an invented rival.
- **D5's moved overlap test names the right side.** `RelationIncarnation { foreign_key_field, parent_table }` is a field-kind variant on the child/source row, and "The paired required foreign-key field is the complete relationship declaration" is verbatim at `src/manifest.rs:829-841`. The reverse-index requirement is also correct as engineering: `targetIndex` bounds forward existence checks only, and `onTargetDelete: 'restrict'` needs the source-side lookup. The concurrency citation is apt — `llp/0056:564-588` does spell out the capture-and-linearize-at-commit race contract ("an insert racing that resource's deletion fails commit-time read-set validation … linearizes at commit, exactly like `lastHolder`").
- **The search reclassification is true and admission-enforced.** `SearchQuery` is admitted only under `FunctionKind::Query` (`src/manifest.rs:1163-1165`); any other pairing hits `SNAPBACK_FUNCTION_KIND_RUNTIME_MISMATCH` (`:1189-1199`), so search cannot be live. The search executor captures a `Query` dependency with `predicate: None` (search arm at `src/local.rs:22591`, dependency construction inside it), and the matcher returns a conservative `Some(true)` for a predicate-less `Query` dependency before any plan-table arm (`src/live_matcher.rs:244-246`) — every clause of the paragraph checks out.
- **The D7 carrier reassignment is what LLP 0144 actually says.** "This is a wire-shape change owned by LLP 0094 (the wire-envelope contract), not this document" is verbatim in 0144's Axis C2 (`llp/0144:323-326`), with C1 keeping the app refusal inside diagnostic details; OQ6's rewrite matches. The three example remediations now all carry preconditions, and the `useDifferentPrincipal` approval flip is consistent with the decision's own safety rule.
- **D6's transitivity paragraph does not overclaim.** LLP 0054's stricter route — "All nondeterministic inputs that affect observable behavior pass through injected interfaces" — is verbatim at `llp/0054:243-257`, and 0054 remains "Draft research only" (`:414-419`), so refusing to borrow its guarantee is right.
- **The correction section's anchors all still resolve:** `live_subscription_may_be_affected` at `src/live_matcher.rs:129`, the declared-tables arm at `:147-155`, the plan-table arms including `parent_table`/`child_table` at `:170-179`, `fanOut`'s filter at `cloudflare/src/coordinator.js:5163-5167`, and the coordinator header's "captured read sets are recorded but not yet validated" at `:21-23`.

Inferred, not independently verified: the Revised block's account of the other family's round-2 verdict and finding counts (I am blind to that artifact by instruction), and D7's claims about which example fields v0.1/v0.2 carried.

## Findings

**MATERIAL-1 — D5's acceptance line still encodes the withdrawn target-side overlap test**
§D5 acceptance (`llp/0146:643-644`): "an `existsRelation` targeting a promoted relation incarnation fails codegen with a named reason." The body two paragraphs earlier (`llp/0146:611-619`) withdraws exactly that formulation — "v0.2 said codegen must refuse an `existsRelation` whose *target* is a promoted incarnation. That names the wrong side" — and replaces it with the source-side coincidence test, correctly, since a `RelationIncarnation` is a field on the child/source row (`src/manifest.rs:829-841`) and cannot coherently be a `target`. Acceptance criteria are the document's contract with implementation; as written this clause tests the withdrawn condition and leaves the corrected test unencoded in acceptance. This is the cross-fix propagation failure mode the capsule flags, recurring. Fix: reword the clause to "an `existsRelation` whose source table and `sourceFields` coincide with a declared incarnation's `foreign_key_field`/`parent_table` pair fails codegen with a named reason."

**DETAIL-1 — D1's surface-1 and acceptance lines keep the pre-split untagged vocabulary**
The v0.3 schema block defines only class-tagged fields — `missingReads`/`missingWrites`, `extraReads`/`extraWrites`, `readProvenance`/`writeProvenance` (`llp/0146:328-332`) — but surface 1 still says every invocation "emits `missing`, `extra`, and `provenance`" (`:345-346`) and the acceptance line still tests "non-empty `missing` with `provenance: complete`" and "an action reports `provenance: unsupported`" (`:374-376`). Readable as collective shorthand, but after a paragraph arguing that collapsing the classes lets violations cancel, the backticked collapsed names in normative text invite exactly the union the split forbids. Same propagation class as MATERIAL-1, milder because no wrong side is named.

**DETAIL-2 — The retention sentence conflates two distinct gates and omits the relational retainable arm**
§Other arms (`llp/0146:269-274`). "Retention eligibility requires a `HostPlan(Query)` with a complete, plan-consistent single-table summary; an opaque JavaScript handler is refused outright with `undeclarable_retention` (`src/manifest.rs:2981`, eligibility at `:2299-2353`)" merges two mechanisms: `validate_retainable_query` (the erroring gate that owns the `:2981` refusal) *also admits* `HostPlan(RelationalQuery)` with a two-table relational summary (`src/manifest.rs:2911-2971`, the `opaque-authorized-snapshot-v1` class), so "requires a HostPlan(Query)" is false of it; and `rqs_eligible_digest_kind` (`:2299-2353`, which does require single-table `HostPlan(Query)`) never "refuses outright" — its own doc comment says "never a load error" (`:2304-2307`). The conclusion survives both corrections (the relational arm checks its summary against the plan too), but the sentence should split the gates: the declared-`retainable` class refuses opaque JS erroringly; RQS eligibility excludes it non-erroringly; both foreclose drift.

**DETAIL-3 — D3's command example and OQ10's title were not updated for the `digestCursor` split**
The example still reads `introspect --changed-since <envelopeHash>` (`llp/0146:444-445`) immediately before the text declaring that key insufficient for the dynamic section (`:448-455`), and the document never says what the flag accepts after the split — hash, cursor, or both. OQ10 is still titled "Digest hash custody" and asks about "a prior digest *hash*" (`:1008-1012`) while the body's concept is the cursor (`:462-471`). One sentence fixing the surface syntax and renaming OQ10's subject closes the seam.

**DETAIL-4 — D6's conservative classification fallback collapses `deterministic` to nearly empty**
The transitivity paragraph offers two routes: follow effect provenance through the step, or "conservatively mark any run that touched an uncontrolled subsystem as `observed`" (`llp/0146:712-714`). But SQLite is named among the uncontrolled escapes (`:664-666`) and every durable step touches SQLite, so under the conservative route the `deterministic` class is essentially unpopulated and the acceptance clause "a seeded property violation over controlled seams only shrinks to a minimal scenario classed `deterministic`" (`:719-720`) becomes unsatisfiable. The two routes are presented as alternatives but only provenance-following can populate `deterministic`; a sentence saying the fallback is a degraded mode, not a design choice of equal standing, keeps the acceptance line honest.

**DETAIL-5 — The Status section still narrates the v0.2 state**
`llp/0146:1038-1040` mentions only round 1 and "v0.2 applies every finding"; nothing there is false, but after a round-2 cycle recorded in the Revised header, the Status paragraph should acknowledge v0.3 so a reader landing on Status alone is not one revision behind.

TOOL_USES: 21
