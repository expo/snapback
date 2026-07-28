# LLP 0073 review — Fable family

## Round 1 — 2026-07-27

**Reviewer family:** Claude Fable  
**Provider / runtime:** Anthropic Claude Code 2.1.220,
`claude-fable-5`  
**Effort:** max  
**Date:** 2026-07-27  
**Redacted:** no (target bytes unredacted; context capsule contains public
tracked repository files only)  
**Method:** fresh CLI runner, read-only tools, mutually blind structurally
isolated capsule  
**Target SHA-256:** `91ea2b86e29b16a5cb7ee31a834b56a3027dd3234d2d11dd083a40984083c8f8`  
**Capsule SHA-256:** `b0300273bf962d8cf1d1c450467e7c96f583866d47cc4e19a4cce21b1819e14c`  
**Instruction SHA-256:** `829a93ec8bc4352d9e0d6ebc25ee2bce54ff76f4cc436ab7d335164e7741820e`  
**Status:** completed — NOT READY  
**Session ID:** `b07c7590-e2e0-485d-9234-fe002899c122`  
**Duration:** 873,664 ms  
**Review body:** preserved verbatim below.

I've completed the verification pass. Here is the review.

---

# Review: LLP 0073 — Portable full-text search (super-refine round 1)

*Process notes: this capsule provides no shell, so I could not recompute the target SHA-256; I reviewed the single revision of `llp/0073-portable-full-text-search.rfc.md` present in the capsule (Revised 2026-07-27). Per instructions I did not seek any other review artifact. I verified claims against LLP 0004, 0007, 0018, 0046, 0051, 0053, 0063, 0068, 0070, 0071, 0080, 0090, 0098, `guide/capabilities.md`, `ref-check`, and `src/`.*

## 1. Overall assessment

This is a strong, unusually security-literate RFC whose central architectural decision — a generated portable term/position index as the match-set authority, with native FTS demoted to an optional candidate-superset accelerator — is the right one and is well defended (§Summary, §Canonical text and analyzer, §Adapter contract and capabilities). The tokenization, versioning, maintenance-identity, rebuild-activation, privacy-custody, and leakage-surface treatments are close to acceptance quality.

It is not ready, for one decisive reason and several reinforcing ones. The authorization/cursor model is built on an "authorization-dependency epoch" that is claimed to advance on "any relevant permission, membership, block, moderation, session, authority-instance, or policy transition" — a semantics that **no accepted mechanism provides and that Accepted LLP 0053 explicitly retired**. LLP 0053's central reframe is that the epoch must *not* be asked to witness matcher-visible authorization writes (membership changes), v1 has exactly one epoch (the global one; subject-scoped epochs are shadow-only), and any auth-scoped resume from a non-live state must re-evaluate under current authority. Accepted LLP 0090 litigated this exact tension across six review rounds and resolved it by excluding auth-scoped resume-from-token from v1. LLP 0073 proposes precisely the excluded pattern, and its own security acceptance bullet is unimplementable against the epoch it cites. The section also contradicts itself internally (current-visibility evaluation in ¶2 versus pinned-snapshot evaluation in ¶3). Several product decisions pinned by the 2026-07-27 gate (ascending row-id tie-break, refuse-not-evict cursor capacity, PostgreSQL-paired acceptance evidence) also look wrong or under-argued for the flagship chat workload that motivates the RFC.

## 2. Strengths

- **Portable matcher as authority (§Summary, §Canonical text and analyzer, §Adapter contract and capabilities).** Storing the same logical term/position index on both backends and refusing to let FTS5/`tsquery` semantics or ranking numbers become the contract is exactly the correct portability posture, and the reasoning ("a finite conformance corpus alone cannot make [native analyzers] authoritative for arbitrary Unicode input") is epistemically sound.
- **Pinned, versioned analyzer (§Canonical text and analyzer).** Unicode 17.0.0 by content digest, `toNFKC_Casefold`, explicit apostrophe/hyphen rules, scalar-offset span maps, grapheme-safe highlight expansion, and "`latest` never appears in an artifact identity" — this is the right shape, and the strict-UTF-8/unpaired-surrogate posture matches the corpus's existing boundary discipline (`src/rqs.rs:274` — lone surrogates are structurally impossible server-side, refused at the JS arm).
- **Deterministic integer scorer (§Ranking, order, and cursors).** Avoiding floating point *and* corpus statistics eliminates both cross-backend divergence and a statistics side channel; saturation-as-normative and score-then-id total order are precisely specified. The tie-break convention is consistent with Accepted LLP 0080's binary-collation, trailing-`_id` discipline.
- **Leakage-aware result release (§Authorization and result release).** No counts, facets, autocomplete, or suggestions in the base profile; `hasMore` as existence-of-continuation only; bucketed candidate batches; `workLimited` genericity; partition keys narrow but never prove release. This closes the classic hidden-vocabulary and rejected-count side channels most search designs miss.
- **Synchronous v1 with no stale-success state (§Index maintenance).** Idempotent `(indexVersion, sourceId, sourceVersion)` CAS identity, tombstone retention through the full horizon, and the bounded-fan-out admission rule for projections are grounded in LLP 0018's per-app commit-version stream (llp/0018, lines 109–125).
- **Activation fence protocol (§Rebuilds and migrations).** The seven-step gap-free activation with re-read-under-fence, plus versioned admission epochs binding query/maintainer artifact digests, is unusually complete for RFC altitude and correctly rejects point-in-time compatibility inspection.
- **Privacy custody and deletion (§Highlights and private data).** Treating term dictionaries and frequency metrics as private when any source is private, excluding sensitive fields from v1 outright, and chasing deletion through generations, caches, build artifacts, and restore reconciliation are all correct and rarely seen.
- **Honest claim boundary (§Non-goals and claim boundary).** The statement that database-specific FTS calls cannot satisfy LLP 0063's prerequisite while this RFC is unaccepted matches LLP 0063's own gap table (line 1703).

## 3. Concerns

**C1. The authorization-epoch cursor model conflicts with Accepted LLP 0053 and with itself. — Severity: High. MATERIAL (correctness, coherence, safety).**
Evidence: §Authorization and result release ¶3 claims "Any relevant permission, membership, block, moderation, session, authority-instance, or policy transition advances that epoch," and later pages serve from "the pinned page transaction" whenever the epoch matches; §Acceptance requires that "every relevant authorization epoch change restarts an existing cursor." But Accepted LLP 0053 states: the superseded clauses of LLP 0008/0011 "are only the claims that every permission-affecting write advances an epoch" (lines 125–126); "v1 has exactly one epoch: the global one. Subject-scoped epochs are computed in shadow mode only" (line 799); "the authorization epoch deliberately does not move for a matcher-path removal" (line 1036); and a client "resuming from any non-live state must … always resnapshot; the epoch cannot witness a matcher-mediated visibility change, so it must not be asked to" (lines 85–86). Accepted LLP 0090 resolved this identical tension by restricting resume-from-token to authority-independent queries and deferring auth-scoped resume entirely (0090 §Authorization scope, revision v0.4). Under LLP 0053's actual epoch, a membership revocation does not advance anything the cursor binds, so pinned-snapshot pages serve revoked-forbidden titles/snippets for up to 120 seconds — failing this RFC's own acceptance bullet. The plausible alternative — a new per-dependency-set epoch that advances on every auth-table write — is a mechanism LLP 0053 v1 explicitly excludes, and would restart every cursor on any membership write anywhere (LLP 0053 §Motivation attempt one's failure mode), destroying pagination under chat-scale churn. Separately, ¶2 ("evaluates current row/resource visibility") and ¶3 ("rechecks candidate visibility inside the pinned page transaction") prescribe different evaluation snapshots.
Resolution criteria: pick one coherent model and reconcile it with LLP 0053 explicitly. The LLP 0053-conformant shape is: the pinned snapshot governs the *match set and order only*; every page evaluates candidate visibility under *current* authority; membership/moderation staleness in the index rides the already-specified index-invalidation obligations with fail-closed candidate recheck; cursors are invalidated only by mechanisms that exist (LLP 0039 incarnation, LLP 0053 global epoch for enumerated events, stream/restore epoch, generation retirement, MAC/key events); and the "no duplicate/omitted rows within the … authorization snapshot fixed by page one" guarantee (§Ranking ¶4) is reworded so authorization filtering at page time may remove rows. Alternatively, define the new dependency-epoch mechanism in a dated LLP 0053 amendment with granularity, storage, and a churn analysis for the chat workload. Either way, ¶2/¶3 and the acceptance bullet must describe the same machine.

**C2. The accelerator no-false-negative "proof" applies an evidentiary standard the RFC itself rejects. — Severity: Medium. MATERIAL (correctness, coherence).**
Evidence: §Summary/§Canonical text argue that "a finite conformance corpus alone cannot make [backend-native analyzer] behavior authoritative for arbitrary Unicode input," yet §Adapter contract admits accelerators when "the adapter proves no false negative against the portable matcher" with "a failed equivalence check disables the accelerator," and §Acceptance demands "native FTS accelerators have no false negatives against the portable oracle." An accelerator false negative silently drops a matching row — the exact matcher can only reduce candidates, never restore them — so this is a results-correctness property, and a finite equivalence corpus cannot establish it for a native tokenizer fed raw source text (the same argument the RFC makes two sections earlier).
Resolution criteria: require superset-ness *by construction* — a v1 accelerator must index the canonical portable token stream under a declared trivial tokenizer, or carry a pinned argument that the native tokenizer's equivalence classes are a strict coarsening of the portable ones — with the equivalence corpus demoted to regression evidence. Raw-source-text native tokenization must be inadmissible as a v1 accelerator input, not merely disabled when a corpus check happens to fail.

**C3. The fixed tie-break returns oldest-first for the flagship chat workload. — Severity: Medium. MATERIAL (decision quality).**
Evidence: §Ranking fixes ordering as "descending portable score and then ascending canonical row-id bytes," with no declared direction, no order-by, and no recency component. The scorer's frequency caps (`min(tf, 8)`, uniform authored weights) make score ties the common case for short chat messages, and LLP 0004 pins `_id` as UUIDv7 (llp/0004, line 452), which is time-ordered — so tied results return *oldest messages first*. LLP 0063's priority-1 slice (line 2051) is exactly Slack/Discord-style chat with search; every mainstream chat search is recency-biased. Because scorer/ordering changes create a new index version and new cursor semantics (§Ranking ¶3), discovering this at pressure-test time forces version churn the 2026-07-27 decision gate existed to avoid.
Resolution criteria: the declaration gains a deterministic, versioned ordering choice — at minimum a declared tie-break direction over canonical row-id bytes, or a bounded integer recency contribution from a declared timestamp field — pinned by golden vectors, with the chat pressure test asserting the expected order.

**C4. The acceptance evidence hard-pairs PostgreSQL, which is neither the local nor the hosted target. — Severity: Medium. MATERIAL (feasibility/sequencing), likely resolvable editorially.**
Evidence: §Acceptance requires "byte-identical analyzer/AST/match/score/order output on SQLite and PostgreSQL." There is no Postgres implementation in `src/` (the only match is a comment in `src/storage.rs:7325`), LLP 0046 (the Postgres graduation path) is **Draft**, and the actual hosted target (LLP 0098's `loopback-terminated-single-instance.v1`) runs the same SQLite-backed origin. LLP 0063's prerequisite asks for "SQLite/hosted implementation and authorization witnesses" (line 1703). As written, the v1 implementation gate couples chat search — roadmap priority 1 — to standing up a Postgres data tier, while §Non-goals simultaneously speaks of "executable target-specific evidence," suggesting per-target staging.
Resolution criteria: state the evidence matrix explicitly — per-target conformance against the committed portable oracle/golden corpus, with SQLite plus the hosted profile first and cross-backend byte-equivalence becoming mandatory at LLP 0046 graduation — or justify why Postgres bring-up must precede v1. Name which adapter serves the hosted witness.

**C5. Cursor capacity refuse-not-evict, with no release operation, structurally starves type-ahead search. — Severity: Medium. MATERIAL (decision quality).**
Evidence: §Ranking pins 16 live cursors per authority across all indexes, 120-second TTL, and "Issuing a cursor that would exceed either bound refuses … it never evicts another live cursor silently." The profile supports a final-input prefix atom and a convenience string parser (§Query language) — i.e., search-as-you-type. Each keystroke is a distinct canonical query hash; any page-1 with `hasMore` issues a live cursor; no cursor close/release operation exists anywhere in the RFC. Roughly sixteen incremental queries inside two minutes — one partially typed phrase, twice — exhausts the cap and search starts refusing, in the interactive path the profile is aimed at. The safe-retirement machinery already exists: capacity revocation "retire[s] a generation early only by returning the same coded restart outcome," so retiring a *cursor* with that coded outcome would not be silent.
Resolution criteria: any one of — an explicit cursor release operation that generated clients invoke when superseding a query; a declared policy that a new page-1 query from the same authority may retire that authority's oldest cursor with the coded restart outcome; or exclusion of never-continued cursors from the cap with a defined snapshot-cost story. The fail-closed coded semantics must be preserved and the choice pinned in capabilities.

**C6. Reject-on-overflow can wedge an over-cap source row into uneditability. — Severity: Medium. MATERIAL (correctness/product), cheap to resolve.**
Evidence: §Index maintenance mandates "Exceeding a bound … rolls back the complete source mutation," while §Rebuilds says a profile "may choose to reject a source mutation … but that policy must be declared" — a mild internal inconsistency about whether this is mandatory or declarable. More important is the trap: nothing requires the declared per-source byte/token caps to dominate the schema-enforced bounds of the indexed fields, so a document that grows past the index cap (documents being the priority-2 workload, §Acceptance's "bounded documents") has *every* subsequent edit rolled back — including shrinking edits that don't get below the cap in one step — turning search capacity into a write-availability constraint with an unrecoverable-feeling failure mode.
Resolution criteria: require declarations to prove index caps ≥ the schema-enforced maxima of every indexed field (making overflow structurally unreachable, with rollback reserved for work-ceiling/maintenance failure), or add a declared overflow policy with a non-write-blocking option (exclude-row-with-deterministic-tombstone), and align the §Maintenance/§Rebuilds wording.

**C7. Load-bearing citation errors: portable scalar semantics live in Accepted LLP 0080, not LLP 0004. — Severity: Low. DETAIL.**
Evidence: §Query language says "Filters use LLP 0004's portable scalar/null semantics." LLP 0004 contains no such contract — it lists "sorting, null behavior, and type comparisons need documented behavior" as an open item (llp/0004, line 390) and its own revision note defers query semantics to Accepted LLP 0080, which actually pins the portable byte-equality comparator, binary collation, and `_id` ordering (llp/0080, lines 37, 76, 131, 150). LLP 0080 is absent from Related; so is LLP 0044, which the body cites twice. `ref-check` does not gate Related completeness, but the filter contract should cite its real authority.
Resolution: point filters at LLP 0080; add LLP 0080 and LLP 0044 to Related.

**C8. Normative-surface underspecifications that goldens cannot substitute for. — Severity: Low. DETAIL (bundle).**
(a) "an exact whole-field match adds `fieldWeight * 400` once" — undefined which atom kinds trigger it and against what (full normalized token sequence?); (b) tokens above 64 scalars — dropped, truncated, or split, which changes phrase positions; (c) prefix `termFrequency` — count of distinct matching tokens or total occurrences; (d) the filter operator vocabulary — "exact filter(field, op, value)" never enumerates ops (equality only? ranges? date-bounded chat search needs ranges or an explicit statement that it's out of v1); (e) the RFC lists Live Queries in Systems but never states that v1 search is a one-shot snapshot query, not a live subscription. Each needs one to two sentences; none identifies a defective decision.

## 4. Suggestions

- When resolving C1 toward current-authority page evaluation, reconsider whether snapshot-stable pagination should remain a *profile requirement* rather than a reported capability inside the profile. With the match set pinned per generation and authorization evaluated fresh, a keyset cursor re-executed against the current generation gives no-duplicates with bounded drift — likely acceptable for chat — and removes the 16×120-second pinned-read-transaction (or versioned-row) machinery from the critical path. If snapshot stability stays required, say which physical mechanism the SQLite and hosted adapters use, since the 16/120s caps are evidently sized for it.
- Prefer fresh-authorized-read highlights whenever the source row changed after the cursor pinned, so an edit that removed text can't resurface via pinned stored display fields within the TTL.
- Document that `toNFKC_Casefold` removes default-ignorables (ZWJ among them), so emoji ZWJ sequences index component-wise in v1; the highlight goldens already cover emoji, but the search-behavior consequence deserves a sentence.
- On acceptance, add `search.*` rows to `guide/capabilities.md` (it currently has none, not even a GAP row) and plan the guide page per LLP 0061.
- Consider recording in §Non-goals that result *grouping/collapsing* (for example many block hits collapsing to one document) is out of v1, since the document test will surface it (see Open question 3).

## 5. Open questions

1. Which concrete mechanism provides the cursor's authorization invalidation, who owns it (dated LLP 0053 amendment versus this RFC), and what does its advancement granularity do to cursor survival under chat-scale membership churn? (C1 — must be answered before implementation.)
2. Is v1 implementation evidence staged per target, and does LLP 0063's chat pressure test unblock on SQLite-plus-hosted witnesses alone? (C4.)
3. For the document pressure test, is the search row a block or a document? If blocks, how do applications present multi-block hits across cursor pages; if documents, how do large documents fit synchronous per-source caps?
4. What is the physical snapshot-retention mechanism per adapter (held read transactions versus versioned index rows), and what does it cost on the hosted single-instance profile?
5. What happens, exactly, when a source row exceeds declared index caps — and must declarations prove cap-dominance over schema field bounds? (C6.)
6. Is there a client-visible cursor release/supersede lifecycle, and do generated clients retire predecessors during incremental typing? (C5.)
7. Does search admission depend on LLP 0071 (Draft) semantics tightly enough that acceptance ordering between 0071 and 0073 needs to be stated?

## 6. Readiness verdict

The core portable-index architecture, analyzer versioning, maintenance identity, rebuild protocol, and privacy posture are acceptance-grade. But C1 is an unresolved MATERIAL defect: the cursor-authorization design contradicts Accepted LLP 0053's epoch doctrine and the Accepted LLP 0090 precedent, contradicts itself between ¶2 and ¶3 of §Authorization and result release, and renders its own security acceptance bullet unimplementable with any mechanism the corpus provides. C2, C3, C5, and C6 are additional MATERIAL defects in pinned decisions (each with a cheap, well-defined resolution), and C4 needs an explicit staging statement. A revision that resolves C1–C6 — mostly a few paragraphs each — would plausibly be READY in the next round.

VERDICT: NOT READY

## Round 2 — 2026-07-27

**Reviewer family:** Claude Fable  
**Provider / runtime:** Anthropic Claude Code 2.1.220,
`claude-fable-5`  
**Effort:** max  
**Date:** 2026-07-27  
**Redacted:** no  
**Method:** fresh CLI runner, read-only tools, mutually blind structurally
isolated capsule; delta-round instructions  
**Target SHA-256:** `47533c1bf2270d414032993f8deaf39a4545214af08b66276dac272e8165fb2b`  
**Capsule SHA-256:** `1b1c1f120e040b2c80034839df874473fa9de8ffcdaede8b530543d5aae5b5f5`  
**Instruction SHA-256:** `1e06817ebcc75dd3f91e12c9c5a1254cf8e7031fb86871a5058dcbdae30a9728`  
**Status:** unavailable — one completed stdout record was truncated by the
orchestration transport and could not be preserved verbatim; a fresh attempt
then stopped with provider HTTP 429 before a review was delivered. Neither
attempt counts toward convergence. The only preserved visible concern was the
MATERIAL default-ignorable analyzer contradiction recorded in the journal.

## Round 3 — 2026-07-27

**Reviewer family:** Claude Fable  
**Provider / runtime:** Anthropic Claude Code 2.1.220,
`claude-fable-5` on the approved M4 Mac mini fleet lane  
**Effort:** max  
**Date:** 2026-07-27  
**Redacted:** no  
**Method:** fresh remote CLI runner, read-only tools, mutually blind
structurally isolated capsule; final delta-round instructions  
**Target SHA-256:** `3930bc079cc8d17a69c8b486db1dbefcda54398641c3addf00484756babf3c81`  
**Capsule SHA-256:** `4c561755852a7a3ead7632fcebb1df0cdad9761b10c8475eba46fa2afe704155`  
**Instruction SHA-256:** `26d7ae20655758a859993f7fe52298bab4bf51a0b3a2d0d692dc7a4c9419295e`  
**Status:** completed  
**Session ID:** `d73cff2e-2d17-422c-82c-8ce039ebb3b4`  
**Duration:** 754,662 ms  
**Cost:** $6.726434

# Review: LLP 0073 — Portable full-text search (Round 3)

I reviewed the full RFC against the governing corpus (LLPs 0007, 0037, 0046, 0053, 0063, 0065, 0071, 0080, 0081, 0090, 0098/0099), the guide (`guide/capabilities.md`, backend/client pages), and the current implementation (`src/manifest.rs`, `src/diagnostic.rs`, generated capability/function manifests, `Cargo.toml`, `ref-check`).

## 1. Overall assessment

This revision delivers what it claims. All eight advertised resolutions are present and, with one exception, sound and reconciled: the pre-normalization Cc/Default_Ignorable→separator mapping resolves the analyzer contradiction coherently (including the subtle NFKC space-plus-combining-mark case, which rule 4's mark-only-run handling anticipates); exact ranking fails closed at a deterministic logical ceiling with no partial page or resumable frontier; field observability is fail-closed and correctly tied to LLP 0065 `owner.v1`; the noninterference claim is honestly scoped (termination-insensitive, coupled physical interruptions excluded from the semantic transcript, work counted only in the caller's partition); the stateless XChaCha20-Poly1305 cursor is a complete wire/plaintext/key/rotation design with correct query-core/limit binding; carriers, dispatch, diagnostics, and client nonclaims match the real repository; and the hosted target names `single-instance-container-vm.v1`, the corpus's recorded first adapter. The design is finite and implementable in this repository.

One reconciliation defect remains, newly visible in this round's migration rework: the rebuild machinery is presented as "an LLP 0081 semantic migration" while specifying a concurrent catch-up executor and a rollback guard that LLP 0081's admitted v1 profile does not allow — and in the rollback case explicitly rejects. The underlying design is sound for derived index data, but the corpus's own acceptance bar (reconciled with the governing corpus; closed vocabularies extended only by explicit same-landing amendments) makes this a blocking fix. It is a bounded textual/governance fix, not a redesign.

## 2. Strengths

- **The fixed-point, corpus-statistics-free scorer makes the keyset claim actually true.** Because scores derive only from indexed text, weights, and version-bound constants, `(score, rowId)` keys are stable for untouched rows — the "no duplicate/no omission for unchanged rows" guarantee holds without a retained snapshot. The u32 bound is verifiable and correct: 16 atoms × 16 fields × (64·4·250 + 64·400) = 22,937,600.
- **Fail-closed exactness under finite work.** Exhaust-all-viable-candidates-or-refuse, with the ceiling counted in logical units inside the caller's partition only, resolves ranking exactness, termination, and noninterference in one move. No partial page, no candidate-scan frontier, no leak through the work-limit code.
- **The analyzer is genuinely closed.** Committed Unicode 17.0.0 tables with a content digest as the authority (goldens validate, not substitute), strict UTF-8/surrogate rejection matching LLP 0080's precedent, category-scan tokenization without UAX #29, position-consuming dropped runs so phrases never bridge, and a provenance transducer as part of the versioned artifact. Unicode 17.0.0 is correctly the current stable on the amendment date.
- **Repository alignment is real, not aspirational.** `TableManifest` exists (`src/manifest.rs:396`); `FunctionRuntime::HostPlan(HandlerPlan::RelationalQuery(...))` is the exact precedent for `HandlerPlan::SearchQuery`; the `Diagnostic` envelope exists (`src/diagnostic.rs:23`); `full_text_search_v1` matches the `relational_query_v1`/`migration_keyset_scan_v1` registry convention; the `/query/{name}` route, `useSnapbackQuery`, RQS register-mode bundles, and the react-expo arm are all named correctly in the nonclaims; LLP 0046 and 0071 are correctly tracked as Draft.
- **Authorization posture is consistent with the corpus.** Partition-keyed postings plus current-authority release recheck, the owner-transfer claim correctly not asking LLP 0053's `AuthorizationVersion` to witness ordinary row changes, existence-secrecy and no-counts/facets/suggestions defaults, and the paired-database observation boundary with randomized nonce bytes explicitly carved out.
- **Honest claim boundaries throughout:** no snapshot pagination, no accelerator in v1, PostgreSQL as an explicit GAP behind LLP 0046's store seam, sensitive fields excluded everywhere, and the LLP 0063 prerequisite language matching the roadmap's own gap table (llp/0063 line 1703).

## 3. Concerns

**C1. Rebuild executor and rollback guard are not reconciled with LLP 0081's admitted profile.** — Severity: High. **MATERIAL.**
Evidence: §Rebuilds states an analyzer/schema/classification/weight/tie-break/visibility change "is an LLP 0081 semantic migration," then specifies a build that "catches up through the gap-free application change journal" under a renewable journal-floor lease with only "a bounded index-generation switch fence," and Acceptance requires "concurrent rebuild and source writes activate a verified generation." LLP 0081's only executable profile is `exclusive-single-writer.v1` ("refuses new application invocations, subscriptions, jobs, and writes; drains admitted work"), its §3 step vocabulary is closed ("V1 admits only closed steps") and contains no search-index step, and LLP 0080 §6 explicitly defers "dual-apply and catch-up rebuilds" as future profiles. On rollback, LLP 0073's guard is "before any successor-only source commit," while LLP 0081 §6 rejects that exact guard ("'Zero successor commits' alone is not the guard — jobs, webhooks, payments, and actions can issue external effects without advancing the head") and admits fast rollback only while the fence has kept every lane closed. The commit-count guard *is* sound for a fully derived index generation — switching index generations rewinds no application data or external effect — but the RFC neither states that justification nor names the divergence; a reviewer applying the cited authority strictly must refuse the plan. The corpus's established mechanism for exactly this situation is a same-landing amendment (LLP 0080's `RebuildMaintainedProjection` step lives *in* LLP 0081's list; 0080/0081 carried same-landing LLP 0004/0007/0072 amendments).
Resolution criteria: either (a) name a same-landing LLP 0081 amendment adding the search-index rebuild step and a named concurrent catch-up executor profile for derived generations, including its derived-data rollback rule; or (b) explicitly scope the rebuild executor as search-owned machinery that consumes LLP 0081's plan/approval/journal/receipt authority while declaring its divergences from `exclusive-single-writer.v1` (no exclusive barrier; index-only switch fence; first-successor-commit rollback guard) and why each is sound for fully derived data.

**C2. Operation-carrier vocabulary: `kind: "query"` with `live: false` does not exist.** — Severity: Low. **DETAIL.**
Evidence: `FunctionKind` is `{Query, Mutation, LiveQuery, Action}` (`src/manifest.rs:2396`); generated manifests carry `"kind": "Query"`/`"LiveQuery"` with no `live` boolean; the guide pins `defineQuery` as callable-not-subscribable with `SNAPBACK_FUNCTION_NOT_LIVE` on subscribe (guide/backend/queries.md:95–99). In a section claiming exact carrier facts, this is drift.
Resolution criteria: state the actual manifest facts — ordinary `FunctionKind::Query`, not `LiveQuery`; subscription attempts refuse with the existing code.

**C3. Owner-field type vocabulary diverges from LLP 0065.** — Severity: Medium. **DETAIL.**
Evidence: 0073 requires "one required principal/reference field under LLP 0065's `owner.v1`"; LLP 0065 §2 pins "a required string or principal field" with exact string equality against the canonical subject. Reference (`v.id(table)`) is not admitted by `owner.v1`; string is omitted by 0073.
Resolution criteria: adopt LLP 0065's exact admitted types, or explicitly declare the extension and carry the LLP 0065 reconciliation.

**C4. Null-equality filter semantics contradict the cited authority.** — Severity: Medium. **DETAIL.**
Evidence: 0073 says equality filters "use LLP 0080's portable exact scalar/null semantics" and then "null is a value only when the declared field admits null." LLP 0080's equality comparator pins "a null in any position never matches," and LLP 0007's portable filter vocabulary expresses null tests as explicit `isNull`/`isNotNull` (llp/0007 line 315), not `eq null`.
Resolution criteria: either exclude null as an `eq` filter value (aligning with the cited authorities) or own the divergence explicitly without attributing it to LLP 0080, with golden vectors either way.

**C5. Highlight `field` called "a declared public result-field name" collides with the classification vocabulary.** — Severity: Low. **DETAIL.**
Evidence: `public` is a reserved classification in this document, and owner-only indexes may admit `private` stored/highlight fields ("`owner.v1` indexes may admit `public` or `private` fields"; "Private fields may enter owner-only v1 indexes only when … stored display text … have a storage and encryption class…"). Read strictly, §Highlights would forbid private-field highlights that §Search declarations admits.
Resolution criteria: reword to a classification-neutral phrase ("a declared highlight field name") or, if classification-public-only is actually intended, reconcile the declarations section.

**C6. Highlight byte determinism is claimed but not fully pinned, and highlights are missing from the byte-identical acceptance oracle.** — Severity: Medium. **DETAIL.**
Evidence: the builder "expands left/right by at most 48 source scalars," "expands to grapheme boundaries, then trims only at grapheme boundaries to the byte limit" — the exact expansion amount, the snap direction at grapheme boundaries, and which side trims first to reach 256 bytes are all unspecified, so two conforming implementations can emit different fragment bytes. The acceptance bullet requires byte-identical "analyzer/AST/match/u32-score/order output" — highlights are not in that list, so divergent highlight bytes would pass acceptance as written.
Resolution criteria: pin the three free choices (or explicitly make the versioned reference implementation plus committed golden vectors the normative byte oracle), and add highlight bytes to the byte-identical acceptance item.

**C7. Ambiguous ceiling for the per-source "framework maintenance effect."** — Severity: Medium. **DETAIL.**
Evidence: "Replacing one source's per-index search document counts as one framework maintenance effect for admission" does not say whether that unit counts against the existing 1,024 application/projection-row bound (as LLP 0080 projection output writes do) or only against the new 4,096/8,192/256 KiB search ceilings. The answer determines whether a 1,024-row mutation on an indexed table is admissible at all.
Resolution criteria: name the ceiling explicitly and add one worked acceptance case (e.g., a maximal-row mutation on a table with one search index: admitted or refused, and under which bound).

**C8. Related header omits LLP 0065; the hosted-profile authorities (LLP 0072/0099) are also absent.** — Severity: Low. **DETAIL.**
Evidence: `owner.v1` under LLP 0065 is load-bearing throughout (visibility floor, principal admission, cursor subject binding) yet LLP 0065 is not in **Related**; `single-instance-container-vm.v1` is carried by LLP 0072's first-adapter decision and LLP 0099's executor profile, neither listed (0098 alone does not define it). `ref-check` validates @ref targets and headers, not Related completeness, so this will not be machine-caught.
Resolution criteria: add LLP 0065 (and 0072/0099 as appropriate) to **Related**.

**C9. Cursor associated data is ambiguous concatenation.** — Severity: Low. **DETAIL.**
Evidence: AD is `UTF8("snapback:search-cursor:v1\n") || appId || targetProfileId` with no length prefixes or delimiter, so distinct `(appId, targetProfileId)` pairs can collide on AD bytes. The plaintext independently binds full identity, so this is defense-in-depth only — but the corpus norm (RFC 8785 plaintext, domain-separated digests with framed preimages in LLP 0081) is unambiguous encoding, and AD is doing identity-binding work here.
Resolution criteria: length-prefix or delimit the AD components, or state explicitly that AD is redundant to the authoritative plaintext binding.

## 4. Suggestions

- Fold U+2019 into U+0027 in the analyzer (a one-entry deterministic scalar map). NFKC_Casefold leaves both distinct, and rule 3 treats both as token scalars without unifying them, so "don't" typed with an iOS smart quote will not match ASCII-apostrophe content. If the no-transliteration posture is deliberately kept, add a golden vector documenting the non-equivalence as intended.
- Note the crypto dependency: `ring` (the current `Cargo.toml` AEAD provider) has no XChaCha20-Poly1305; plan on the RustCrypto `chacha20poly1305` crate. The construction choice itself is right — random 24-byte nonces are exactly the reason to prefer XChaCha20 over ChaCha20.
- Fix the doubled "; and" at the end of the Acceptance list (two consecutive bullets end "; and" before the final item).
- In Canonicalization, "generation rejects the query" describes request-time validation, not codegen; "validation rejects" avoids overloading a defined term.
- When this RFC's status advances, update LLP 0063's capability table row (line 1703 still says "Draft LLP 0073") in the same landing, and land the promised `guide/capabilities.md` GAP row (currently no search row exists) with the first implementation commit per LLP 0061's dated-GAP convention.

## 5. Open questions

1. Is initial index creation over an already-populated table executed through the same generation-build machinery (snapshot, journal catch-up, switch fence) as semantic rebuilds? "Activation preflights every existing row" implies yes, but builds are only defined under §Rebuilds.
2. The cursor binds the requested page limit and "wrong … limit … fails closed," so changing page size mid-pagination forces a restart. Intended, or incidental to the binding?
3. Is the per-declaration logical work ceiling itself part of the public capability report, so an application can predict which corpora will deterministically refuse — and what is the authored recourse when an owner partition organically outgrows its ceiling (those queries refuse permanently under v1's no-frontier rule)?

## 6. Readiness verdict

The design is finite, internally coherent, safety-sound, and implementable in this repository; the cursor, ranking, analyzer, observability, and carrier work claimed for this round is genuinely resolved and verified against the corpus and code. What blocks readiness is one bounded reconciliation defect: the rebuild executor and rollback guard contradict LLP 0081's admitted profile while citing it as the governing authority, without the same-landing amendment or declared-divergence framing this corpus requires (C1). That fix plus the mechanical DETAIL items (C2–C9) is text work, not redesign; with C1 landed I would expect the next pass to be READY.

VERDICT: NOT READY
