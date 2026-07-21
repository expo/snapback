**Reviewer family:** Claude (Fable)
**Provider / runtime:** Claude Fable 5 (`claude-fable-5`) — fresh subagent context spawned via the Claude Code Agent tool from the orchestrating /llp-super-refine session (Fable 5 Max); the orchestrating session authored the document and does not count as this review
**Date:** 2026-07-20
**Redacted:** no — repo-local review; no secrets in the reviewed material; reviewer instructed not to read credential files or llp/reviews/
**Method:** subagent-runner (fresh context per round; no access to the concurrent Codex-family round or to this artifact)

# LLP 0066 reviews — Claude (Fable) family

## Round 1 — 2026-07-20

**Revision under review:** `llp/0066-effect-lessons.research.md`, sha256 `523ed1341898e33717ed5d0981300d04ed199f5d277f57bea294ccfcc55cf101` (untracked file at repo HEAD `a75ddd5`)
**Runtime detail:** fresh Fable subagent, 21 tool uses, ~380 s; verified the pinned hash itself (MATCH) before reviewing. After the review snapshot was taken, a concurrent fleet edit added a `**Revised:**` header line to the working-tree file; the review below is of the pinned pre-edit revision.
**Verdict:** NOT READY

### Review body (verbatim)

# Review: LLP 0066 — Effect: lessons for Snapback

**Revision check: MATCH** — `llp/0066-effect-lessons.research.md` hashes to `523ed1341898e33717ed5d0981300d04ed199f5d277f57bea294ccfcc55cf101`; repo HEAD is `a75ddd514ecc7f8e0ae00f91384deef699587383`, file untracked, as stated in the brief.

## 1. Overall assessment

This is a well-shaped, honestly-tagged research document with a sound central judgment: Effect's guarantees are mostly things Snapback already delivers structurally (typed diagnostics, single-source schema, declared UI states), the durable-workflow and retry-as-data areas are the two genuinely instructive gaps, and Effect's viral monadic programming model should not be imported into an agent-first authoring surface. The provenance discipline follows LLP 0001's `[observed]`/`[inferred]` convention faithfully, and the "what not to adopt" finding (F6) is aligned with the corpus's core bet. The Effect-side descriptions (the `Effect<Success, Error, Requirements>` type, `Schedule`, Layers/Tag DI, Effect Cluster and `@effect/workflow`'s idempotency-key + persisted-activity-replay model) are consistent with Effect's public documentation as I know it, and the document says plainly that they are unverified against source — the tagging is honest and internally consistent.

However, the document is not ready as it stands, for reasons that are cheap to fix. Its central recommendation has been overtaken inside the same working tree: `llp/0070-durable-background-work.rfc.md` (Draft, dated 2026-07-21, referenced by tracked-and-modified LLP 0063 at line 988) is precisely the RFC that Recommendation 1 says should be opened "when durable workflows are scheduled" — and it neither cites LLP 0066 nor Effect, while 0066 neither cites 0070 nor knows it exists. Additionally, three repo-facing citations are wrong or unsupported (the LLP 0052 cite, receipts attributed to LLP 0004, and "LLP 0000 acknowledges this"). For a Research document whose product is citation-grade synthesis, these are material correctness issues.

## 2. Strengths (with section citations)

- **Honest provenance architecture.** The "How to read this" section (lines 37–43) declares source, read date, verification status, and tags all synthesis `[inferred]` — matching LLP 0001's convention, and correctly staying Draft (the corpus's `ref-check` forbids `[inferred]` claims in Active documents, per LLP 0001's Revised header). `./ref-check` passes with the document in the corpus (0 errors).
- **F1 verifies cleanly.** The diagnostic-shape claims (`code`/`severity`/`details`, assert-on-codes-not-prose) match `guide/operating/diagnostics.md:18–44` exactly, and the declared `empty` vs `error` locked-state branching is real (`guide/clients/contract-adapter.md:231`). The judgment that declared UI states beat a threaded error channel for an agent-authored UI surface is well-argued.
- **F2 is precise.** "Rust types as single source, committed generated schemas, CI drift gates" is a faithful summary of LLP 0037 (lines 15–19: generated schemas committed in-repo, snapshot test regenerates and diffs, drift fails CI).
- **F4's repo-facing premise holds.** Retry/backoff behavior is indeed hard-coded in the client arm (`packages/snapback-client/index.mjs` — bounded-backoff re-subscribe at line 4242, exponential socket backoff at 4671, no per-mutation policy surface), and the reconcile-don't-retry convention for `SNAPBACK_MUTATION_CONFLICT` is real but only conventional (`guide/backend/mutations.md:143`). The observation that Contract's verifier could *prove* retry semantics if policy were manifest data is a genuinely good idea in the machine-checkable-claims spirit.
- **F5's absence claim is correct.** No OpenTelemetry/span-model code exists; the only "span" hits in `src/` are source-location spans (e.g. `src/cron.rs:1214`), not tracing. The "not urgent" scoping is appropriate.
- **F6 is the document's best judgment.** The virality/learning-curve critique of Effect is accurate, and declining to adopt the model is squarely consistent with LLP 0000's agent-first, locally-reasonable-surface posture and with the corpus's precedent of learn-don't-adopt research (LLP 0054's TigerBeetle treatment).
- **Correctly identifies the real overlap map.** Summary claims about durability-today ("outbox replay per LLP 0043 plus the cron run-ledger") check out: LLP 0043's durable monotonic outbox (line 9) and the run ledger in LLP 0028 / `guide/backend/cron.md` both exist.

## 3. Concerns

**C1 (major) — Overtaken by LLP 0070; Recommendation 1 and the Confidence section are stale against the current tree.**
Evidence: `llp/0066-effect-lessons.research.md:131–134` ("When durable workflows are scheduled, open an RFC citing this document…"), lines 125–127 ("no user demand signal yet for durable workflows beyond the explainer's own gap acknowledgment"). But `llp/0070-durable-background-work.rfc.md` (untracked Draft, Author "Charlie Cheever / Codex", dated 2026-07-21) already proposes exactly this subsystem — fenced leases, at-least-once delivery, stable idempotency keys at every external boundary — and cites LLP 0028/0044/0045/0069 but not LLP 0066 or Effect; grep for "0066|Effect" in 0070 yields only an unrelated `ambiguousExternalEffect` outcome name (0070:123). Meanwhile the *tracked* LLP 0063 (modified in the worktree) names durable work a platform prerequisite and points at Draft LLP 0070 (`llp/0063-partitime-platform-roadmap.plan.md:988`), which also falsifies "no demand signal." A reader following Recommendation 1 today would duplicate 0070; a reader of 0070 would never find this document's `@effect/workflow` analysis. This is likely a concurrent-fleet timing artifact (see the fleet-concurrency reality of this repo), but the review is of the file as found.
Resolution: add LLP 0070 (and LLP 0063) to Related; reframe F3 and Recommendation 1 as input to LLP 0070's review — specifically, evaluate 0070's job/lease model against `@effect/workflow`'s persisted-activity-replay (0070 appears to be a job-queue design, not a multi-step replayable-workflow design, so 0066's distinct contribution survives and should say so explicitly); correct the Confidence section's demand-signal claim.

**C2 (major) — LLP 0052 is miscited for "the outbox's idempotency and ambiguity handling."**
Evidence: `llp/0066-effect-lessons.research.md:81–82` cites "(LLP 0043, LLP 0052)"; LLP 0052 is "Contract update economy and reactive host state" — Contract effect-flush economy, host/deadline/temporal primitives — with zero occurrences of "outbox", "idempotent", "ambiguous", or retry semantics (grep over all 910 lines; the only "receipt" hits are "Implementation receipt" section headings, a different sense). The receipt-less-ambiguity and idempotent-settlement machinery lives in LLP 0043 (lines 192–214); the other outbox document is LLP 0045 (notifications-outbox), which is probably what was meant. LLP 0052 also appears in the Related header (line 8) on the same mistaken basis.
Resolution: replace the 0052 citation (with 0045, or drop it) in both the F3 body and the Related header, or demonstrate what in 0052 the claim actually rests on.

**C3 (minor) — "LLP 0000 acknowledges this" is unsupported.**
Evidence: `llp/0066-effect-lessons.research.md:25–26` claims the explainer acknowledges the durable-workflow gap; LLP 0000 never mentions workflows, sagas, or multi-step orchestration (grep: zero hits). Its explicit capability-gap list (`llp/0000-snapback.explainer.md:814–819`) names offline replay, cron, notifications, hosted execution, etc. — not durable multi-step workflows. The gap itself is real (no such subsystem exists in code), but the cited acknowledgment does not. This compounds C1 because the Confidence section (line 127) leans on "the explainer's own gap acknowledgment" as the sole demand evidence.
Resolution: cite what actually exists — LLP 0000's general explicit-gaps posture, `guide/capabilities.md`'s GAP discipline, or (best, post-C1) LLP 0063 §platform-prerequisites and LLP 0070 — or soften the sentence to state the gap directly without attributing an acknowledgment.

**C4 (minor) — Receipts attributed to LLP 0004.**
Evidence: `llp/0066-effect-lessons.research.md:80–81` says "commit versions and receipts (LLP 0004)". Commit versions are indeed LLP 0004's (line 490–491, and LLP 0007's graduation section), but "receipt" appears nowhere in LLP 0004 (zero hits); mutation receipts are LLP 0043's vocabulary (8 occurrences, e.g. line 192's receipt-less-ambiguity rule) and surface in `guide/operating/diagnostics.md:42`.
Resolution: split the citation — commit versions (LLP 0004/0007), receipts (LLP 0043).

**C5 (minor) — Missing `Revised:` header field.**
Evidence: lines 3–8 carry Type/Status/Systems/Author/Date/Related but no `Revised`, which CLAUDE.md lists as part of the standard metadata header (and which sibling documents 0001, 0067, 0070 all carry). `ref-check` did not flag it, but corpus convention does.
Resolution: add a `Revised:` line (initial-draft note is fine).

**C6 (minor) — The Contract "async blocks / loading-error-empty-ready" foursome is not verifiable in this repo.**
Evidence: `llp/0066-effect-lessons.research.md:53–55`. The repo's guide evidences declared `empty` vs `error` state branches (`guide/clients/contract-adapter.md:231`) but neither "async blocks" nor the exact four-state list appears in this corpus (LLP 0005 has no hits); Contract's authoring surface is defined in the Exact repo. The claim is plausible, but F1's other claims are cited to in-repo authority while this one silently isn't.
Resolution: cite the adapter guide for what this repo does evidence, or tag the four-state description with its Exact-side provenance.

## 4. Suggestions (non-blocking)

- **Sharpen the F3/0070 differentiation once C1 is fixed.** LLP 0070 is a durable *job queue* (one action per job, fenced lease, at-least-once); `@effect/workflow` is a durable *multi-step workflow* (per-step persisted results, replay skipping completed activities). Naming that distinction crisply would make 0066 the reference the eventual workflow layer needs, rather than appearing to be a duplicate of 0070.
- **Note the retry-scope nuance in F4.** The verified client-arm retry code is largely live-subscribe/socket reconnect backoff plus outbox drain; saying which retry loops exist (reconnect vs. mutation replay vs. cron catch-up vs. 0070's future job retries) would make the "policy as manifest data" proposal concrete about which knob it is proposing to expose first. LLP 0070 already defines outcome classes (`retryable`, `terminal`, `ambiguousExternalEffect`) that a `Schedule`-shaped policy surface could attach to — a natural landing site.
- **F5 could mention the existing correlation primitives** (commit versions and outbox entry ids already flow client→server→fan-out) as the natural trace-id substrate, so the future observability note is anchored rather than free-floating.
- **Consider citing LLP 0022** (Electric/PowerSync/Turso research) or LLP 0054 in Related as the corpus's precedent for this learn-don't-adopt genre; it situates the document's method.
- LLP 0047 sits in Related but is never used in the body; either connect it (hosted execution limits will bound durable-work retention/lease budgets) or drop it.

## 5. Open questions

- Should this document's durable-workflow analysis be merged into LLP 0070's review loop as a formal input (the corpus's pattern for research-feeds-RFC), or remain standalone with cross-references? Given both are Draft and untracked, the cheapest coherent move is cross-referencing plus a 0070 Revised-note; someone with fleet visibility should decide.
- Is the eventual workflow layer a second consumer of 0070's queue (workflows-as-jobs-with-step-ledger) or a separate subsystem? 0066's F3 sketch (idempotency-keyed run row + per-step recorded results at commit time) reads like the former; stating a position would sharpen Recommendation 1.
- The document's own open question about LLP 0007 portability of the run/step ledger is the right one — 0070 answers it for jobs (durable rows under the storage authority); does the same answer hold for step results that may embed action outputs subject to retention rules (LLP 0043's generation/GC discipline)?
- Does the `Schedule`-as-manifest-data idea interact with LLP 0065 (generated-data pattern soundness) or the Contract verifier roadmap anywhere concrete, or is it purely aspirational today? A one-line honesty note either way would help.

## 6. Readiness verdict

The document's judgments are good and its Effect-side tagging is honest, but material repo-facing correctness issues remain: a central recommendation and confidence claim contradicted by the current tree (C1), one flatly wrong LLP citation (C2), and one unsupported attribution (C3). All are small, mechanical fixes.

NOT READY

### Orchestrator verification (round 1)

Spot-checked the decisive claims without altering the verbatim body. Confirmed: `llp/0070-durable-background-work.rfc.md` exists in the working tree (fleet-authored Draft; its header reads Date/Revised 2026-07-20, not 2026-07-21 as the review states — immaterial to the concern) and contains no reference to LLP 0066 or Effect beyond the unrelated `ambiguousExternalEffect` token at line 123; LLP 0052 has zero occurrences of outbox/idempot/ambigu (C2 confirmed); LLP 0004 has zero occurrences of "receipt" (C4 confirmed); LLP 0000's only "workflow" matches are about the LLP authoring workflow, not durable workflows (C3 confirmed). LLP 0068 and 0069 also appeared concurrently, so the corpus moved under this document mid-round — consistent with the fleet-concurrency pattern this repo documents. Disposition: address C1–C6 in the round-2 revision, including re-grounding F3/Recommendation 1 as input to LLP 0070 and differentiating job-queue vs replayable-workflow designs.

## Round 2 — 2026-07-20

**Revision under review:** `llp/0066-effect-lessons.research.md`, sha256 `6e2d8c0d149c54bb34b8c3d8d4d05a8534b770ad5753a592cd85ba6cf13888f5` (at repo HEAD `0e05b7b`; round-2 revision after the round-1 dual-model feedback)
**Runtime detail:** fresh Fable subagent (no access to round-1 artifacts or the concurrent Codex round), 26 tool uses, ~369 s; verified the pinned hash itself (MATCH) and corroborated external claims against effect.website and the npm registry entry for `@effect/workflow`
**Verdict:** READY

### Review body (verbatim)

# Review: LLP 0066 — Effect lessons for Snapback (round 2)

**Revision check:** `shasum -a 256 llp/0066-effect-lessons.research.md` = `6e2d8c0d149c54bb34b8c3d8d4d05a8534b770ad5753a592cd85ba6cf13888f5` — **MATCH** with the pinned revision. (One process note: the brief describes the file as untracked; on this checkout it is tracked-with-local-modifications. The hash matches, so the reviewed content is the intended revision.)

## 1. Overall assessment

This is a strong, honest, well-calibrated research document, and its round-2 shape is the right one. The central judgment — learn from Effect's durable-workflow and retry-policy ideas, feed them into LLP 0070's review as reference input, and refuse the Effect programming model itself — is well-argued and consistent with the corpus's agent-first bet (LLP 0000) and its established learn-don't-adopt precedent (LLP 0054). I verified the repo-facing claims in F1–F5 against code and LLPs, and they hold, including the ones that carry the document's weight: LLP 0028's transactional per-sequence replay ledger (`llp/0028-cron-scheduled-execution.rfc.md` §Scheduler state and run ledger; implemented in `cloudflare/src/coordinator.js` with `@ref` annotations, covered by `cloudflare/test/acceptance.cron-recovery.mjs`), the cron `retryPolicy` with fail-closed rejection of unimplemented modes (`src/cron.rs:1104-1113`, `SNAPBACK_CRON_RETRY_MODE_UNIMPLEMENTED`; `packages/snapback-codegen/index.mjs:2344`), evidence-class-driven mutation replay (`packages/snapback-contract/index.mjs:2090-2113`), the open-string diagnostic code (`src/diagnostic.rs:24`, `schemas/diagnostic.schema.json`), and LLP 0070's actual contents (fenced leases, at-least-once, `ambiguousExternalEffect`, and — as 0066 states — no reference to Effect). External claims are provenance-tagged as docs-derived and that tagging is honest; my own spot-checks (effect.website docs; the npm registry entry for `@effect/workflow` — "Durable workflows for Effect", pre-1.0 at 0.19.0, with Activity/Workflow/DurableClock/DurableDeferred modules) corroborate them at exactly the level the document claims. `./ref-check --verbose` passes corpus-wide with 0066 in place. Remaining issues are minor citation and precision polish; nothing material.

## 2. Strengths

- **The disposition matrix (§Disposition matrix)** is the document's best structural feature: it classifies every Effect proposition rather than cherry-picking, distinguishes "Partial" from "Aligned" from "Gap" from "Unassessed," and by doing so makes the document falsifiable. The explicit "Unassessed; likely non-goal" rows (Layers, fibers, streams) are more honest than silently omitting them.
- **F1's "partial correspondence, not equivalence" framing** is exactly right and verified: diagnostics assert on stable codes not prose (`guide/operating/diagnostics.md`, "Assert on codes, not prose"), the code field is genuinely open (`src/diagnostic.rs:24`), and LLP 0004 indeed types args/results but no per-operation failure sets. The document also hedges its Contract-arms claim correctly — the in-repo evidence is the `empty` vs `error` branching in `guide/clients/contract-adapter.md:228-231`, with the fuller arm set attributed to the Exact side.
- **F3 is the core contribution and it is careful.** It correctly identifies LLP 0028's ledger as real prior art (verified: same-transaction result rows, replay-returns-prior-result, at-least-once recovery with repeatable egress), correctly characterizes what `@effect/workflow` adds beyond LLP 0070's one-action-per-job shape (per-step persisted replay), and — most importantly — states what no design can promise: the three-way step split (ledgered mutation / external / pure) and the no-exactly-once-external-effects boundary, grounded in LLP 0047's actions-are-not-transactions rule.
- **F4's self-correction** ("The round-1 draft... claimed Snapback retry behavior is 'uniform and hard-coded'; that is wrong") is a model of research-document honesty, and the corrected picture is accurate: cron declares `retryPolicy` fail-closed (`src/cron.rs:1104-1113` and test `backoff_retry_mode_is_rejected_fail_closed`), mutation replay is evidence-class-driven, and `SNAPBACK_MUTATION_CONFLICT` really does carry `retryPolicy: "reject"` (`src/storage.rs:6967`) with reconcile-don't-retry documented in `guide/backend/mutations.md:102,143-144`. The two inherited constraints named (FIFO head-of-line blocking; eligibility ≠ scheduling) are the right ones.
- **Scoping discipline throughout:** F2 declines to recommend anything (correctly — LLP 0037's scope fence matches the "framework-owned wire artifacts" characterization); F5 defers tracing behind demand; Recommendation 1's per-application-authority default correctly invokes LLP 0007's anti-intra-app-sharding note (`llp/0007-storage-portability.spec.md:252-266`); the Confidence section's "low confidence on priority" honestly gates the whole workflow thread on an unnamed first use case.

## 3. Concerns

All minor; no major concerns.

- **C1 (minor) — "connectionless receipts" is used without a citation and the term appears nowhere else in the corpus prose.** Evidence: `llp/0066-effect-lessons.research.md:156-157`; the concept exists only in code comments (`src/local.rs:150` "global ring for connectionless facts (mutation receipts, ...)", `src/live_wire.rs:271` "A retention-ring receipt (LLP 0034 §3.2)"), and LLP 0034 is not in 0066's Related list. The claim itself ("prove settlement, not activity results") is correct, but a reader cannot chase it. *Resolution:* cite LLP 0034 (§3.2) at the F3 parenthetical and add LLP 0034 to Related, or rephrase in vocabulary the corpus documents.
- **C2 (minor) — F5's parenthetical "(no tracing code in `src/`)" is literally false as a grep claim while true in substance.** Evidence: `llp/0066-effect-lessons.research.md:204-205`; `src/` contains `HOST_CALL_TRACE` (`src/runtime.rs:1789-1790`) and `SourceSpan` (`src/manifest.rs:2010-2011`) — unrelated to distributed tracing, but a future reader validating the parenthetical by grep will trip. There is genuinely no OTel/span-model/instrumentation code and no tracing crate in `Cargo.toml`. *Resolution:* reword to "no distributed-tracing/span instrumentation in `src/`" or similar.
- **C3 (minor) — F5's "outbox entry ids flow end to end" names an identifier that doesn't exist under that name.** Evidence: `llp/0066-effect-lessons.research.md:206`; the actual propagating identifiers are `clientMutationId`/`sequence` (`packages/snapback-contract/index.mjs:2095, 2204-2218`) echoed on receipts (`src/server.rs:4638`) plus the commit version (`src/server.rs:4651-4653`). The substrate claim is right; the name is loose. *Resolution:* name the real identifiers.
- **C4 (minor) — Related-list entries LLP 0008 and LLP 0063 are never engaged in the body.** Evidence: `llp/0066-effect-lessons.research.md:9` vs. the full text (0008 is at best implicit behind the streams/fan-out mentions; 0063 appears nowhere). Related lists in this corpus are load-bearing navigation; unexplained entries cost readers time. *Resolution:* either cite each in the body where it bears (0008 for the streams row and F5's fan-out; 0063 for whatever motivates it — plausibly the first-use-case question) or drop them.
- **C5 (minor) — provenance tagging deviates from the corpus's research convention.** Evidence: LLP 0001 §How to read this defines per-claim `[observed]`/`[inferred]`/`[confirmed]` tags with per-section Confidence, and LLP 0054 follows it; 0066 instead uses a blanket provenance section (lines 57-69) plus `[inferred]` on findings/recommendations. 0066's scheme is internally consistent and honest — and its in-repo citations are effectively `[confirmed]`-with-evidence — but two conventions in one corpus is drift. *Resolution:* either adopt the LLP 0001 vocabulary (cheap: the blanket Effect-side section becomes a scoped `[observed]` declaration, which is nearly what it already says) or note explicitly that the document deliberately uses a coarser scheme and why.

## 4. Suggestions (non-blocking)

- **Give F1's generated-diagnostic-registry idea an explicit disposition.** It is the one concrete idea in the findings (lines 94-98) that never reaches the Recommendations section — a reader can't tell whether it is proposed-later, deferred, or abandoned. A one-line "not recommended now; revisit when X" or a filed ticket would close the loop.
- **File the durable-background-work gap as a guide capability-index GAP row.** `guide/capabilities.md` has no workflow/durable-background row (cron is a shipped row at line 43; "retry" appears only as a keyword on the mutation-outcomes row at line 61), yet the corpus now has two documents (0066, 0070) agreeing the gap exists. That is exactly what LLP 0061's GAP rows are for — arguably 0070's job, but 0066's Recommendation 1 is a natural place to note it.
- **Land the 0070 backlink promptly.** Verified: 0070's Related list omits 0066 while 0066 cites 0070; Recommendation 1 already calls for cross-referencing, and since both are Draft in the same tree the edit is trivial — doing it early prevents 0070's review round from missing this input.
- **Consider naming a candidate first use case even speculatively.** The document's own gate ("the first concrete use case... has not been named") would be sharper if it listed the candidates already visible in-corpus — LLP 0044's asset derivations, LLP 0045's notification fan-out, and 0070's own payment-command/webhook-reconciliation motivation (0070 Summary) — and said why each is or isn't yet a *multi-step workflow* demand rather than a job demand. That converts the open question from abstract to checkable.
- **A novel angle worth one sentence:** since agents author most Snapback application code, a future workflow surface's step-identity problem (F3's hardest sub-item) could lean on the manifest/codegen pipeline — step identities as generated, manifest-declared artifacts with drift detection, the same move LLP 0037 made for schemas — rather than Effect's convention of deriving identity from code position. The document already gestures at manifest-declared retry policy; extending the "declared, verifiable data" stance to step identity would be a distinctively Snapback answer.

## 5. Open questions

The document's own open-questions list is good and I largely endorse it. Remaining questions from this review:

- Should the retry-policy table (Recommendation 2) also govern the *local* cron target, where today no retry logic executes at all (`src/cron.rs` fail-closes even `Backoff` because "No retry logic exists for any mode yet")? The local/hosted parity question F3 names for workflows applies to F4 too.
- Is the Exact-side arm set ("loading/error/empty/ready", Exact LLP 0216) worth pinning with a verifiable cross-repo citation convention, given this corpus can't check it? (A general corpus question this document merely surfaces.)
- Who owns acting on F1's registry idea if it isn't a recommendation here — does it need a ticket so it doesn't evaporate?

## 6. Readiness verdict

All five concerns are citation/precision/convention polish, explicitly non-blocking for a Research document: the findings are honestly tagged, every load-bearing repo-facing claim verified against code and LLPs (including the round-1 error F4 corrects), the external claims are corroborated at the confidence level claimed, and the recommendations are well-scoped with priority honestly gated.

READY

### Orchestrator verification (round 2)

Spot-checked the decisive claims without altering the verbatim body: `src/cron.rs:1104-1113` confirms the fail-closed `SNAPBACK_CRON_RETRY_MODE_UNIMPLEMENTED` rejection of `Backoff` (with an `@ref LLP 0028#failure-and-retry` annotation), and `src/storage.rs:6968` confirms the conflict diagnostic's `retryPolicy: "reject"` detail — the review's F4-corroborating evidence is accurate. The process note about the file being tracked-with-modifications rather than untracked reflects a concurrent fleet `git add` of the working tree; the hash matched the pinned revision, so the reviewed content is the intended one. All five concerns are explicitly non-blocking. Disposition: hold the revision unchanged pending the concurrent Codex-family round-2 verdict on the same pinned revision; if it is also READY, the loop converges with the polish items recorded as non-blocking residue. (Superseded: the Codex round-2 verdict was NOT READY, so a round-3 revision followed.)

## Round 3 — 2026-07-20

**Revision under review:** `llp/0066-effect-lessons.research.md`, sha256 `654f5831bc09a11996f144092ecf87490306768a33ff98d3a8e533736c749083` (at repo HEAD `0c2ed65`; round-3 revision after the round-2 dual-model feedback)
**Runtime detail:** fresh Fable subagent (no access to earlier-round artifacts or the concurrent Codex round), 15 tool uses, ~341 s; verified the pinned hash itself (MATCH) and corroborated external claims against effect.website docs and the npm registry (`@effect/workflow` 0.19.0)
**Verdict:** READY

### Review body (verbatim)

# Review: LLP 0066 — Effect — lessons for Snapback (round 3)

**Hash check: MATCH** — `shasum -a 256 llp/0066-effect-lessons.research.md` = `654f5831bc09a11996f144092ecf87490306768a33ff98d3a8e533736c749083`, repo HEAD `0c2ed650bcc947652ea5d3e5481eab17e827a711`, as specified in the brief.

## 1. Overall assessment

This is a strong, honest research document — a model of the "learn, don't adopt" genre the corpus established with LLP 0054. Its central intellectual moves are sound: the disposition matrix refuses false equivalences (three rows are frankly "Unassessed" with reasons); the two prioritized opportunities (durable workflows, declarative retry policy) are narrowed against what actually exists in-repo rather than pitched against a green field; and the most important technical statement in the document — that step-result-at-commit yields exactly-once semantics only for database mutations sharing a transaction with the ledger, never for external effects (F3, "What no design can promise") — is correct, matches LLP 0028's own at-least-once/egress-may-repeat contract, and is exactly the framing LLP 0070's review needs.

I verified the load-bearing repo-facing claims against code and LLPs (details below): essentially all check out, including the fine-grained ones (fail-closed `SNAPBACK_CRON_RETRY_MODE_UNIMPLEMENTED` in `src/cron.rs:1107-1117`; `retryPolicy: "reject"` detail on `SNAPBACK_MUTATION_CONFLICT` in `src/storage.rs:6964-6968`; `Receipt::Mutation` in `src/live_wire.rs:292-316` having no signature field; "provider-core receipt" appearing verbatim in LLP 0043:191,202; LLP 0070 containing no reference to the Effect library). I also verified the Effect-side claims that are checkable: `@effect/workflow` latest on npm is 0.19.0 (matches "0.19.x at read time"), and Effect's own docs confirm both the expected-error/defect split and the document's carefully hedged point that exhaustive handling is an available discipline, not an execution requirement (`Effect.runPromise`/`runSync` accept a non-`never` error channel and surface failures as rejections/thrown `FiberFailure`). The provenance tagging is honest and internally consistent: the coarse scheme is *declared* as a deviation from LLP 0001's per-claim vocabulary with its rationale, `[inferred]` marks every synthesis and recommendation, Draft status is consistent with the corpus rule that Active documents carry no `[inferred]` claims, and `./ref-check` passes with 0 errors.

One citation-pointer error was found (LLP 0034 §3.2 — see Concerns); it is a wrong section number over a correct substantive claim, minor for a Research document.

## 2. Strengths

- **The exactly-once boundary statement (F3)** is the document's best contribution: database-mutation / external-activity / pure-computation step typing, with the explicit statement that no design can promise exactly-once external effects. It is verified consistent with LLP 0028:301-320 ("A retry may repeat egress"), LLP 0047:106-110 (actions are not transactions), and `cloudflare/src/coordinator.js:356-359` (result row in the same transaction as the mutation).
- **F4's self-correction** is exemplary research hygiene: it names the round-1 error ("uniform and hard-coded"), replaces it with the verified three-way picture (cron manifest `retryPolicy`, evidence-class mutation replay, marked non-retryable classes), and shows the correction *sharpened* the opportunity rather than dissolving it. Every element checked out, including the subtle FIFO/head-of-line-blocking constraint against LLP 0043's ordering guarantee.
- **The disposition matrix's "Unassessed" rows** (Layers/DI, fibers, streams) resist the survey-document temptation to force a verdict on everything; each gives a one-line reason grounded in a real Snapback fact (verified: LLP 0009's run-to-completion conformance contract; LLP 0008's live-query model).
- **F6's posture is scoped and falsifiable**: limited to the public authoring surface and serialized contracts, explicitly not forbidding internal/tooling use, tagged `[inferred]`, with a concrete revisit trigger (a comparative agent-authoring experiment) — and it honestly notes that human learning-curve reports do not establish agent ergonomics.
- **F1's corrected Effect description** is accurate (verified against effect.website's error-management and running-effects docs), and the "federated diagnostic catalog" idea is correctly deferred with a stated revisit condition rather than smuggled in as a recommendation; its multi-owner framing matches the verified reality (`SNAPBACK_*` codes in `src/diagnostic.rs`, app-authored `elseError`/`guard` codes in `packages/snapback-codegen/define.mjs:714-723` emitted verbatim by `src/storage.rs:2654-2690`, no generated per-operation error union anywhere).
- **The Confidence section is genuinely calibrated**, including the self-undermining but honest observation that the visible in-corpus candidates read as *job* demands, not workflow demands — which correctly gates the document's own headline opportunity.

## 3. Concerns

**C1 (minor). Wrong section pointer for the LLP 0034 receipts claim.**
Evidence: `llp/0066-effect-lessons.research.md:184-187` cites "connectionless retention-ring receipts — LLP 0034 §3.2 — prove mutation settlement." In `llp/0034-contract-source-seam-provider-side.rfc.md`, §3.2 (lines 215-230) is "Provider-populated vs adapter-stitched (the ownership split)"; the connectionless global-ring receipts and settlement-proof substance live in §3.1 and the as-built section (lines 620-628, "mutation receipts live in a global ring"). The substantive claim — receipts prove mutation settlement, not arbitrary activity results — is correct; only the pointer is wrong.
Resolution criteria: change the citation to the correct section(s) of LLP 0034. Non-blocking for a Research document since the claim itself is verified true, but it should be fixed before any status advance because downstream readers (LLP 0070's review loop, per Recommendation 1) will follow this pointer.

No other concerns rise to concern level. Specifically, I checked and dismissed: the coarse tagging scheme (declared deviation, internally consistent, ref-check-clean); the Exact LLP 0216 citation (out-of-repo and unverifiable here, but the document attributes it to the Exact side and claims only the in-repo `empty` vs `error` evidence, which is confirmed at `guide/clients/contract-adapter.md:228-231`); LLP 0052's absence from the citations (verified: 0052 is client render-economy territory with no receipt trust model or server retry semantics — nothing there this document was obligated to engage); and the "LLP 0070 does not reference Effect" claim (verified — the only "Effect" match in 0070 is the `ambiguousExternalEffect` identifier).

## 4. Suggestions (non-blocking)

- **Cross-reference LLP 0069** (`llp/0069-payment-provider-boundary.rfc.md`) from F3's external-effects discussion: payments are the document's own canonical example of an ambiguous external effect, and a payment-provider-boundary RFC exists in-corpus; the settlement-capability declaration idea in Recommendation 1 (transactional / provider-idempotent / provider-queryable / compensatable / inherently ambiguous) looks like it belongs partly to that boundary.
- **Mention LLP 0067 in the body or trim it from Related.** 0067 (Fate lessons) explicitly positions itself against this document ("Fate is more directly relevant to Snapback than Effect (LLP 0066)"), so the Related entry is justified — but a one-line body note ("sibling research doc 0067 covers the client-data-layer end of the same survey sweep") would make the link legible without opening 0067.
- **Make the F6 revisit trigger self-executing**: the comparative authoring experiment is well-specified enough (identical tasks, plain-async vs Effect-style, measuring generated-code correctness, repair cycles, diagnostic quality) that it could be filed as a Linear issue or recorded as an explicit experiment stub now, so the trigger has an owner rather than living only in prose.
- **Novel angle worth one sentence in F4**: since the proposed retry-policy table is closed data in the manifest, the acceptance-test harness could verify runtime conformance to it with an injected clock (the same fail-closed discipline `backoff_retry_mode_is_rejected_fail_closed` in `src/cron.rs:1992` already pins for the unimplemented mode) — this makes "verifiable by Contract" concrete rather than aspirational.
- The phrase "F4's provider-core receipts" in the fourth open question reads slightly off since receipts are introduced in F4 as evidence for *replay settlement*; consider "the provider-core receipts described in F4" to avoid implying F4 proposes them.

## 5. Open questions

The document's own open-questions list is unusually good (step identity across code edits, ordering domains, local/hosted retry parity). Beyond it:

- Process: who carries Recommendation 1 into LLP 0070's review loop, and does 0070 gain a Related back-reference to 0066 in the same change? Without an owner, the cross-pollination this document exists for may not happen.
- Should the deferred F1 federated-diagnostic-catalog and F5 tracing gaps get guide capability-index GAP rows now (LLP 0061 discipline), or only when accepted as real work? The document invokes the GAP-row discipline for F3 but is silent on whether the two deferred gaps deserve the same recording.
- When `@effect/workflow`/Cluster stabilize (they are alpha, 0.19.x), does this document get a dated re-read revision, or is drift tolerated indefinitely for a Research doc whose external subject moves?

## 6. Readiness verdict

Findings are honestly tagged, every checked repo-facing claim is correct (one wrong section pointer, C1, over a true claim), the Effect-side descriptions verified accurate where externally checkable, and the recommendations are well-scoped with explicit owners-in-waiting (LLP 0070's review loop) and revisit triggers. C1 and all suggestions are non-blocking polish.

READY

### Orchestrator verification (round 3)

Spot-checked the one concern without altering the verbatim body: LLP 0034's section map confirms §3 is "D2 — receipts" and §3.2 is the ownership split, so C1's pointer correction is accurate; the substantive settlement claim stands. Disposition: hold the revision pending the concurrent Codex-family round-3 verdict on the same pinned revision; if READY, the loop converges and the §3.2→§3 pointer fix plus the other polish items are recorded as non-blocking residue (per C1's own note, the pointer should be corrected before any status advance beyond Review); if NOT READY, fold C1 into the next revision. (Superseded: the Codex round-3 verdict was NOT READY, so a round-4 revision followed.)

## Round 4 — 2026-07-20

**Revision under review:** `llp/0066-effect-lessons.research.md`, sha256 `d80d4b13fd5a91d73fd75ccf7f3bd34dba3a02772bd4525d8fd46c7a1d6ff376` (at repo HEAD `4a1024a`; round-4 revision after the round-3 dual-model feedback)
**Runtime detail:** fresh Fable subagent (no access to earlier-round artifacts or the concurrent Codex round), 20 tool uses, ~415 s; verified the pinned hash itself (MATCH; noted the file is now tracked-and-modified rather than untracked — a concurrent fleet `git add`) and spot-checked Effect-side claims externally (`@effect/workflow` 0.19.0)
**Verdict:** READY

### Review body (verbatim)

# Review — LLP 0066: Effect — lessons for Snapback (round 4)

**Hash check: MATCH.** `shasum -a 256 llp/0066-effect-lessons.research.md` = `d80d4b13fd5a91d73fd75ccf7f3bd34dba3a02772bd4525d8fd46c7a1d6ff376` at repo HEAD `4a1024a7`. One metadata note: the brief describes the file as untracked; it is in fact tracked-and-modified (`git status` shows ` M`). Since the hash matches the brief exactly, the revision reviewed is the intended one.

## 1. Overall assessment

This is a strong, honest, and unusually well-calibrated research document. Its central method — a disposition matrix that classifies each Effect proposition as partial/aligned/gap/unassessed rather than claiming equivalence, backed by verified in-repo evidence — is exactly what a Research LLP should do. I independently verified its repo-facing claims across F1–F5 (three parallel evidence sweeps over the diagnostics guide, `src/diagnostic.rs`, `packages/snapback-codegen/define.mjs`, LLP 0004, LLP 0037/`src/schema_export.rs`, LLP 0028/`cloudflare/src/coordinator.js`/the cron-recovery acceptance test, LLPs 0043/0044/0045/0047/0034, `src/cron.rs`, `src/live_wire.rs`, `src/storage.rs`, `packages/snapback-contract/index.mjs`, `render-first.mjs`, `src/runtime.rs`, and LLPs 0000/0007/0008/0009/0054/0061/0063/0070): every one checked out, including the fine-grained ones (the `readSet` conflict path sharing `SNAPBACK_MUTATION_CONFLICT` but lacking the `retryPolicy` detail; the unsigned `Receipt::Mutation` with a committed generated schema; local cron's fail-closed `NextTick`-only behavior; egress-may-repeat under cron recovery). I also spot-checked the Effect-side claims externally: `@effect/workflow` latest is 0.19.0 (published 2026-07-13), matching "0.19.x at read time"; the expected-error/defect channel description and the activities-execute-once-unless-`Activity.retry` model match the public docs and the package README. The provenance tagging is honest and internally consistent — it explicitly declares a coarser scheme than LLP 0001's `[observed]/[inferred]/[confirmed]` vocabulary and applies `[inferred]` where synthesis occurs. The recommendations are well-scoped (feed F3 into 0070's review; treat `Schedule` as a reference shape; hold the F6 posture with a revisit trigger). Two minor textual defects remain, neither material to any finding or recommendation.

## 2. Strengths (with section citations)

- **The disposition matrix (Summary)** refuses false equivalence and, notably, includes three explicit **Unassessed** rows (Layers, fibers, streams) with one-line reasons — a rare and valuable honesty move that keeps the doc from overclaiming coverage.
- **F1** gets both sides right: Effect's error channel is described with its two honest limits (defects outside the channel; exhaustive handling is discipline, not requirement — consistent with the public docs), and Snapback's side is precise about the multi-owner, open-string code space (`src/diagnostic.rs` uses `String` codes; app codes via `elseError`/`guard` in `define.mjs` are emitted verbatim, confirmed by conformance cases). The federated-diagnostic-catalog idea is explicitly deferred with a concrete revisit condition.
- **F3** is the document's best contribution: the step-type split (ledgered mutations / external activities / pure computation) and the "what no design can promise" paragraph correctly bound exactly-once to same-transaction database mutations (the verified LLP 0028 property, `cloudflare/src/coordinator.js` replay table) and correctly say external outcomes can only be governed by re-attempt policy. This is directly consistent with LLP 0070's own "Generic queue machinery cannot turn ambiguity into success or failure" (llp/0070:128-130), which F3 could not have copied since it predates the cross-reference — good independent convergence.
- **F4** exemplifies the review loop working: it names and corrects its own round-1 error ("uniform and hard-coded"), separates the lifecycle retry planes from durable-operation retries, and states a settlement invariant (exhausted retries cannot terminally settle ambiguous outcomes) that matches LLP 0043's ambiguity discipline and LLP 0070's semantics. Every mechanism it cites was verified, including the asymmetry between `captured_conflict()` (has `retryPolicy: "reject"` detail, src/storage.rs:6958-6968) and `validate_read_set()` (same code, no detail field).
- **Provenance block ("How to read this")** declares sources, read date, alpha status, and its deliberate deviation from LLP 0001's per-claim vocabulary — the deviation is argued, not hidden.
- **Confidence section** does real decision-quality work: it gates priority on a named first use case and honestly assesses the in-corpus candidates as job demands, not workflow demands. The Summary's redefinition of "prioritized" against this gate resolves what was presumably an earlier overselling concern.
- **F6** scopes the non-adoption posture to the public authoring surface and serialized contracts, leaves internal/tooling use open, states a falsifiable revisit trigger (a comparative agent-authoring exercise), and cites the corpus precedent (LLP 0054's learn-don't-adopt posture, verified).

## 3. Concerns

**C1 (minor) — Wrong Exact LLP citation for the Contract async arms.** F1 says the `loading/error/empty/ready` arms are "defined on the Exact side, Exact LLP 0216" (llp/0066-effect-lessons.research.md:109-111). Exact LLP 0216 is "Contract, Explained" — a philosophy explainer that mentions resource loading/error semantics only in passing. The async-state view grammar is defined and owned by Exact **LLP 0194** ("Contract Declarative Async and Resilience"; /Users/ccheever/projects/exact/llp/0194-contract-declarative-async-and-resilience.rfc.md:24,118 defines the `loading`/`error`/`empty`/`ready` slots and its Related header claims ownership of the "async-state view grammar"). The substantive claim (arms are Exact-defined presentation states; this repo evidences only the empty-vs-error branching in `guide/clients/contract-adapter.md:229-231`) is correct; only the pointer is wrong. *Resolution criteria:* change "Exact LLP 0216" to "Exact LLP 0194". Non-material to any finding — the correction changes no conclusion — but it should be fixed on the next edit; a research doc's currency is verifiable citation.

**C2 (minor) — Truncated sentence in F6.** "once one function returns an Effect, its callers tend to `[inferred]`" (llp/0066-effect-lessons.research.md:277-278) is missing its predicate — the clause the tag was meant to annotate (presumably "tend to become Effect-returning too") was lost in revision. The meaning is recoverable from context and the tag is honest, so this is non-material. *Resolution criteria:* complete the sentence.

No major concerns. I looked specifically for the failure modes this document risks — overstated equivalence, understated gaps, stale repo claims, dishonest provenance — and found none.

## 4. Suggestions (non-blocking)

- **F4 could acknowledge that LLP 0070 already declares per-job retry timing policy** (capped exponential backoff with deterministic jitter, declared max attempts / max elapsed / backoff bounds; llp/0070:124-126). F4's "gap" framing is accurate for the system as built (nothing shipped declares timing beyond cron's fail-closed `NextTick`), and Rec 2 does attach to 0070's classes — but one clause recasting the residual gap as *cross-site uniformity (cron, outbox, jobs) plus verifier visibility*, rather than absence of any declarative job policy, would prevent a misreading once 0070 lands.
- **Make the 0070 reconciliation explicit in Rec 1:** 0070's `claimed → dead` after exhausted attempts (llp/0070:73) should be checked in 0070's review against F4's settlement invariant — `dead` is operator-replayable with history preserved, so it plausibly *is* the "pause automation / escalate" outcome the invariant permits, but an `ambiguousExternalEffect` job going `dead` must stay marked ambiguous rather than being recast as terminal failure. Carrying that one sentence into Rec 1 would close the loop the invariant opens.
- **F5–F4 tie-in:** if retry policy becomes declarative data, surfacing the effective policy and attempt history through `/inspect` would give the observability substrate a concrete first consumer — a cheaper first step than a span model.
- **Make the F6 revisit trigger cheap to fire:** the comparative authoring exercise could reuse the guide's CI-verified acceptance harness (identical tasks, two authoring surfaces, measure repair cycles) — worth one sentence so the trigger isn't practically dead.
- **Related header completeness:** LLPs 0008, 0009, 0054, and 0061 are cited in the body but absent from the Related header; add them if the corpus convention is exhaustive Related lists.
- When Rec 1's capability-index GAP row is filed, note it would currently be the first literal GAP row in `guide/capabilities.md` (all present rows are `shipped`/`partial`), so follow LLP 0061 §gap-row formatting deliberately.

## 5. Open questions

The document's own open-questions list is strong (step identity, retention/portability interaction, receipt validation/trust root, ordering domains, local/hosted parity). Beyond those:

- Does 0070's `dead` state satisfy or violate F4's settlement invariant for `ambiguousExternalEffect` outcomes with exhausted attempts (see Suggestions)? This is the sharpest concrete question F3/F4 hand to 0070's review.
- If a uniform retry-policy surface is built, does it live inside LLP 0070's manifest declarations or as a separate cross-cutting LLP that cron, the outbox, and jobs all cite? (Rec 2 implies the former; worth deciding explicitly.)
- Who owns running the F6 comparative exercise, and what threshold of evidence would actually re-open the posture — is the trigger operational or aspirational?
- Should the Exact-side arm grammar (LLP 0194) be formally cross-referenced from this corpus, given F1 leans on it for the "declared states beat error unions" ergonomics judgment?

## 6. Readiness verdict

Findings are honestly tagged, all Snapback-repo-facing claims verified correct against code and LLPs, external claims are consistent with the declared sources, and the recommendations are well-scoped for a Research document. The two remaining defects (C1 wrong Exact LLP number, C2 truncated sentence) are one-line fixes that alter no finding, disposition, or recommendation — clearly labeled non-blocking above.

READY

### Orchestrator verification (round 4)

The two concerns are self-evident from the quoted text (the C2 truncation was introduced by the round-4 `[inferred]` tag insertion; C1's 0216→0194 pointer correction cites the Exact corpus file directly). The reviewer's independent-convergence observation — F3's ambiguity boundary matching LLP 0070's "Generic queue machinery cannot turn ambiguity into success or failure" — strengthens the cross-reference case Recommendation 1 makes. Disposition: hold the revision pending the concurrent Codex-family round-4 verdict on the same pinned revision; if READY, converge with C1/C2 and the suggestions recorded as non-blocking residue for a post-loop maintenance edit; if NOT READY, fold them into the next revision.

Spot-checked the decisive claims without altering the verbatim body. Confirmed: `llp/0070-durable-background-work.rfc.md` exists in the working tree (fleet-authored Draft; its header reads Date/Revised 2026-07-20, not 2026-07-21 as the review states — immaterial to the concern) and contains no reference to LLP 0066 or Effect beyond the unrelated `ambiguousExternalEffect` token at line 123; LLP 0052 has zero occurrences of outbox/idempot/ambigu (C2 confirmed); LLP 0004 has zero occurrences of "receipt" (C4 confirmed); LLP 0000's only "workflow" matches are about the LLP authoring workflow, not durable workflows (C3 confirmed). LLP 0068 and 0069 also appeared concurrently, so the corpus moved under this document mid-round — consistent with the fleet-concurrency pattern this repo documents. Disposition: address C1–C6 in the round-2 revision, including re-grounding F3/Recommendation 1 as input to LLP 0070 and differentiating job-queue vs replayable-workflow designs.
