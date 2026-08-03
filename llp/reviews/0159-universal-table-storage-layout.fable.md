# LLP 0159 universal table storage layout review — Fable family

## Round 1 — 2026-08-03 (target v0.1, SHA-256 cd69332a25d05d40aa64dabc3f270fb3fce48a112f73d5edc017ec3196960587)

**Reviewer family:** Claude (Fable 5)
**Provider / runtime:** Claude Code subagent (general-purpose), fresh non-author context
**Date:** 2026-08-03
**Redacted:** no
**Method:** fresh subagent over the working tree at 50ff432a; instruction capsule pinned the target SHA, named LLP 0007/0011/0046/0081/0087/0057/0074/0102 and spot-check targets in src/, and barred reading llp/reviews/. Orchestrated by the Fable session that authored the draft, which therefore does not count as a reviewer; the review is recorded verbatim below.

---

## 1. Overall assessment

LLP 0159 is a genuinely useful Research document: it frames the universal-table question precisely, separates the layout choice from the deployment-atomicity choice (F4 is the sharpest finding and fully corpus-backed), and its recommendation — keep the per-table mapping, record reopen triggers — does follow from the findings even after my corrections. Spot-checks confirm most of the load-bearing corpus facts: `StageTableGeneration` is a real LLP 0081 step implemented in `src/migration.rs` and `src/storage/migration_executor.rs`; LLP 0081's first profile really is a maintenance-window design with online migration a named non-goal and OQ4; LLP 0007 really installs `NOT NULL` atomically and creates true `UNIQUE` indexes; the diary 0029 quotes are verbatim; the LLP 0102/0074 deployment-coupling reading is careful and accurate. However, the document's self-declared "single deepest coupling" (authorization pushdown) mischaracterizes what LLP 0011 actually requires — the requirement is deliberately engine-agnostic, and half the evaluation strategy already runs in Snapback's own matcher — under a `[confirmed]` tag; the Confidence section misstates document statuses (0007/0011/0046 are Draft, and 0046 says portability is an untested promise); and two benefit-side tradeoffs (cheaper Postgres graduation implementation, versioned-log forking/time-travel relevant to LLP 0158) are missing from an analysis whose recommendation depends on the benefit list being complete.

## 2. Verdict — NOT READY

The fixes are small and none of them flips the recommendation, but a Research doc's bar is that findings are true and provenance-tagged, and right now a `[confirmed — LLP 0011, LLP 0007]` tag covers a characterization the corpus does not make, and the Confidence paragraph contains a checkable status error. One correction round should converge.

## 3. Strengths

- **F4 (deployment-global coupling)** is exactly right and resists a tempting overclaim: LLP 0102's provider-limit note (llp/0102:132-146) itself says "Deployment-as-unit is a coherent Convex design… a method constraint, not a product defect claim," and LLP 0074 §Priority 5 (llp/0074:640-657) demands the same narrowness. 0159 correctly says universal tables "make that design natural but do not force it."
- **F1's "we bought migration-time indirection" framing** is verified: `StageTableGeneration` is a real typed step (llp/0081:297; `src/migration.rs:129,169`; `src/storage/migration_executor.rs:2197`), the first profile is `exclusive-single-writer.v1` with an explicit barrier (llp/0081:131-135), zero-downtime migration is a named non-goal (llp/0081:789-791), and OQ4 is the dual-write question (llp/0081:810-812). The "remaining delta is genuinely-online execution" analysis is exactly what the corpus supports.
- **Honest provenance discipline overall**: F5 is tagged `[inferred]`, F1's tag says `[inferred — architecture reading; consistent with…]` rather than claiming confirmation, F3's test-inventory claim is verified (LLP 0160 G8, llp/0160:207: "no migration test exceeds single-digit rows"), and trigger 3 admits the evidence to evaluate it does not exist.
- **Diary citations are verbatim**: "easy to write a secure but expensive view without a query planner explaining the cost" (diaries/0029:594-596); the Supabase inspectability bar (diaries/0029:375-376); "make index/query-plan inspection and before/after migration invariants one command" (diaries/0029:427-428).
- **The recommendation's shape** — a "No" with named reopen triggers plus the F5 carve-out for a separately named facet profile rather than a relayout — is the right decision-brief form for a Research doc, and OQ1 (per-migration overlay as middle path) is a genuinely good idea.

## 4. Concerns

**C1 — MAJOR — F2's authorization bullet misstates LLP 0011 and overclaims the coupling.**
Claim: "LLP 0011's visibility model is *pushdown-compilable to SQL* — row filters compile into the WHERE clause the real planner executes… In a universal store there is no SQL to push into; the whole authorization-evaluation strategy would need a new home in our own executor. This is the single deepest coupling. `[confirmed — LLP 0011, LLP 0007]`"
Evidence: LLP 0011's requirement (llp/0011-auth-and-permissions.rfc.md:432-445) is deliberately engine-agnostic: rules "must remain compilable into the query plan — a predicate over `(document, resolved auth context)` that the storage **and matcher** layers can evaluate in-plan, at snapshot **and live-delta** time." The word SQL does not appear in the requirement, and 0011 itself notes "the LLP 0008 matcher and card-game hidden-hand reads operate on exactly such analyzable filters" (llp/0011:449-452) — i.e., the live-delta half of the strategy *already lives in Snapback's own executor* (`src/live_matcher.rs`). The snapshot path does rent SQL (visibility filters merge into the `QueryPlan`, `src/storage.rs:7733,7810`; membership predicates lower to correlated `EXISTS`, `src/storage.rs:11403-11423`, `build_membership_exists_sql` at :11470), so the coupling is real — but it is "rebuild the snapshot-path evaluator," a subset of F2's query-planning cost, not a distinct deepest coupling, and a Convex-style engine that evaluates analyzable predicates in-plan against its own index scans would *satisfy* 0011's requirement as written.
Resolution: restate the bullet as "0011 requires in-plan evaluability; today the snapshot path discharges it via the SQL planner while the live path already self-executes; a universal store forces the snapshot half into our executor too," drop or defend "single deepest coupling," and narrow the `[confirmed]` tag to what the corpus confirms (the requirement's existence and the `.assetSharing` freeze citation, llp/0007:750-752, which is accurate).

**C2 — MATERIAL — Confidence section misstates corpus statuses, and premise (b) of the recommendation overstates.**
Claim: "LLP 0007, 0011, 0046, 0057 are shipped or Accepted" and "(b) engine portability, which we already have at the cost LLP 0007 already paid."
Evidence: 0007, 0011, and 0046 all carry `**Status:** Draft` (only 0057 is Accepted; 0081 is Implemented). LLP 0046's own text says Postgres "is a design promise," "portability is currently an untested promise," and "There is no storage abstraction in the code today" (llp/0046-postgres-graduation-path.rfc.md, Motivation and Prerequisite sections) — so "we already have" engine portability is not what the cited corpus says; we have a designed contract with substantial shipped SQLite behavior, no second engine, and an unextracted seam.
Resolution: correct the status list (e.g., "shipped-in-code or Accepted, though 0007/0011/0046 remain Draft documents") and restate (b) as portability *designed and partially paid for but unproven* — the recommendation survives, since it doesn't hinge on (b) alone.

**C3 — MATERIAL — F2 mis-attributes the brownfield rescue to LLP 0057.**
Claim: "LLP 0057's foreign-database rescue path — Snapback opening a database it does not own — has no meaning if…"
Evidence: LLP 0057 is the auth catalog/provider Spec; its rescue is the narrow `_auth_*` dormant/stored-manifest **collision** rescue (llp/0057:1158-1166, :90, :139), not a general foreign-database path. The general brownfield lane lives in LLP 0007: "A brownfield database with no such evidence may take the fresh adoption lane; in particular, a foreign `_auth_*` collision alone must stay reachable to LLP 0057's dormant-collision rescue" (llp/0007:221-223). The substance of the bullet survives, but the citation says something different from what's claimed.
Resolution: cite LLP 0007's brownfield/fresh-adoption lane as the owner, with 0057's collision rescue as the sub-case.

**C4 — MATERIAL — the Postgres-graduation tradeoff is analyzed one-sided.**
Claim: "Under a universal layout, Postgres degenerates into a KV shelf, and the graduation promise… becomes marketing rather than architecture."
Evidence: true as an identity cost, but the doc omits the benefit on the same axis: a universal layout reduces engine graduation to a persistence shim — the doc's own Convex facts (SQLite/Postgres/MySQL behind one persistence abstraction) demonstrate it — whereas LLP 0046's per-table path requires the seam extraction it calls "the largest single engineering cost in this document." A Research doc briefing a decision should name the saving and then rebut it (identity/inspectability outweigh implementation cost), not omit it.
Resolution: add the counter-benefit to F2 or a new finding, with the rebuttal.

**C5 — MATERIAL — the exact Convex physical-table names are load-bearing, unpinned, and possibly imprecise.**
Claim: "The persistence layer holds only four physical tables — `documents`, `indices`, `persistence`, `globals`" (used again in F1: "background jobs over the `indices` table").
Evidence: unverifiable from this environment, and the doc's own Confidence section says "not verified against source" — yet convex-backend is open source, so backtick-quoted physical identifiers are checkable in principle and should be pinned (repo path + commit) before being quoted as exact names. My background knowledge of that repo suggests the actual spellings may be `indexes` and `persistence_globals` rather than `indices`/`persistence`/`globals`; at minimum the names as printed cannot all be verbatim.
Resolution: either pin to a specific convex-backend file/commit and correct the spellings, or soften to "a fixed handful of engine-owned tables (documents, indexes, globals-style metadata)" and drop the backticks.

**C6 — MATERIAL — a real benefit-side tradeoff is missing: versioned-log forking/time-travel, despite LLP 0158 sitting in Related.**
Claim (by omission): the benefits "divide into (a) online schema change… and (b) engine portability."
Evidence: an immutable MVCC document log also buys point-in-time reads, cheap incremental export, and near-copy-free instance forking — directly relevant to LLP 0158 (whose current design is file clone/rename with a six-state publication protocol precisely because SQLite files are mutable-in-place) and to LLP 0126's local-sync direction. 0158 and 0126 are both listed in Related but never engaged in the body. The recommendation's honesty depends on the benefit list being complete; this is the strongest unanalyzed benefit.
Resolution: add a finding (or extend F5) naming fork/time-travel/export as universal-layout benefits, and either rebut them (Snapback's change journal + 0158's file protocol cover the need at acceptable cost) or add them to the reopen triggers.

**C7 — MINOR — "our stated differentiator is 'index/query-plan inspection and before/after migration invariants one command'"** upgrades a diary recommendation (diaries/0029:427-428, "make… one command" — an aspiration addressed to Snapback) into a "stated differentiator." Cite it as diary 0029's recommendation, or cite wherever it has since been adopted as a product claim (LLP 0160 is the natural home).

**C8 — MINOR — "LLP 0007 §unique-indexes"** names a section that does not exist; the material lives under `## Index Contract` (llp/0007:397-437). Also "got correct compound uniqueness essentially for free" underplays real work 0007 records (non-optional key requirement to defeat SQL NULL-duplicate semantics, stable cross-target diagnostics, brownfield activation checks) — the *race-freedom* was free; the portability of the invariant was not.

**C9 — MINOR — F5's supporting citations are loose.** "LLP 0007 already reserves the portability-opt-out vocabulary for this" — 0007's Portability Opt-Outs (llp/0007:643-657) enumerate engine-specific behaviors (raw SQL, pragmas, collations), not alternative storage layouts; the "separately named target profile" vocabulary is closer to LLP 0081 §3's opt-out language. Additionally, LLP 0087's own current topology (app rows in the coordinator DO's SQLite; per-facet isolated SQLite as scratch — llp/0087:44-52) is corpus evidence leaning toward 0159's OQ2 "many small ordinary SQLite files" answer and should be cited there. The apps-as-data/runtime-loaded characterization of 0087 itself is accurate (llp/0087:14-20).

## 5. Suggestions

- In F1, note that Convex's online schema change is not scan-free: schema validation on push implies engine-managed full-table validation work — the universal layout relocates migration cost (into background validation/index backfill) more than it eliminates it. This strengthens, not weakens, the recommendation.
- F3 could note the partial cost-symmetry that Snapback *already* runs engine-external machinery alongside SQLite — the change journal, version stream, and live matcher (`_snapback_changes`, `src/storage.rs:5600`; `src/live_matcher.rs`) — so the honest comparison is "how much more engine we'd own," not "engine vs. no engine."
- Trigger 3 and OQ3 overlap (hosted per-table DDL pain); consider merging or cross-referencing so a future reader sees one reopen condition, not two half-conditions.
- Cross-reference LLP 0161 (same-day sibling research) in the body, not just Related — if the agent-optimized-engine question ever reopens, these two documents constrain each other.
- The pull-quote-able sentence "The universal layout buys always-on indirection; we bought migration-time indirection" is the document's thesis; consider promoting it into the Summary.

## 6. Open questions for the author

1. Is "single deepest coupling" a claim you want to defend after C1, given that F2's query-planning bullet arguably subsumes it — or was the intent that authorization is the coupling with the least *portable* escape hatch?
2. For C5: did the 2026-08-03 check actually read the convex-backend schema files (in which case, pin file + commit and fix spellings), or only the prose docs/blog post (in which case the table names should be de-backticked)?
3. Does the 0158 forking program change your benefit accounting (C6), or do you judge file-level clone-and-rename sufficient that log-structured forking never becomes a trigger?
4. Should trigger 1 name who measures "proves unbuildable" for the OQ4 dual-write profile — i.e., what artifact (a failed spike LLP? a 0160-gap closure) would count as the trigger firing?

## 7. Recommended next step

One revision round: fix C1-C3 (restate the authorization coupling against 0011's actual requirement text, correct the Confidence statuses and premise (b), re-home the brownfield citation to 0007), pin or soften the Convex table names (C5), and add the missing benefit-side analysis (C4, C6) with explicit rebuttals or new triggers. None of this threatens the recommendation, so after that round this should be READY to leave Draft as an Active/recorded Research document — with the C5 pin ideally done by actually opening the convex-backend schema files so the doc's one unverifiable load-bearing fact becomes verified.


---

## Round 2 — 2026-08-03 (target v0.2, SHA-256 78a5c754a153d5a432f76a8c0f93d5cb190c58c23a74ae80a97581c850ed3496)

**Reviewer family:** Claude (Fable 5)
**Provider / runtime:** Claude Code subagent (general-purpose), fresh non-author context, blind to prior rounds and to llp/reviews/
**Date:** 2026-08-03
**Redacted:** no
**Method:** same capsule shape as round 1, retargeted at the v0.2 bytes. Recorded verbatim below.

---

## 1. Overall assessment (one paragraph)

LLP 0159 v0.2 is a disciplined, well-provenance-tagged Research document whose corpus citations check out with unusually high fidelity: I verified the LLP 0011 pushdown-compilability requirement (it exists, is quoted nearly verbatim, and is genuinely engine-agnostic — "compilable into the query plan… evaluate in-plan," not SQL-specific), the in-tree evidence for both halves of authorization evaluation (`src/live_matcher.rs` exists; `build_membership_exists_sql` at `src/storage.rs:11469` lowers membership semi-joins to correlated `EXISTS`), LLP 0007's real `UNIQUE` indexes and same-transaction `NOT NULL` install, `StageTableGeneration` as a real LLP 0081 §3 step name, 0081's online non-goal and OQ4, LLP 0046's "no storage abstraction in the code today" and seam-extraction-as-largest-cost quotes (still true — the only storage trait in `src/` is `AssetStore`), the diary 0029 SpacetimeDB quote (exact), the 0102 provider-limit quote (accurate with fair ellipsis), and the 0158/0160/0161 support for F6 and F3. The tradeoff analysis argues both directions in the places that matter (F2's graduation both-sides paragraph, F6's added benefit), the Confidence section applies honest status tiering, and the recommendation — keep the per-table mapping, record four concrete triggers — actually follows from the findings. The residual defects are localized: one corpus-status misstatement ("LLP 0087's shipped direction" for a Draft plan whose Gate 0 has not advanced), one conflation of two distinct Convex coupling incidents in F4, one over-attribution gloss on LLP 0007's Index Contract, and one genuinely missing universal-layout cost (MVCC log retention/compaction/storage amplification, the flip side of F6's benefit).

## 2. Verdict — READY

READY. The document is fit to leave Draft once the author addresses the MATERIAL concerns below — all are sentence-level corrections, none disturbs a finding's substance or the recommendation. The Convex-side facts are handled the way an unverifiable-source Research doc should handle them: labeled prose-source provenance, scope explicitly marked unknown, Confidence capped at Medium, and OQ4 barring competitive use of the "four tables" figure until pinned.

## 3. Strengths (cite sections)

- **Citation fidelity under spot-check.** F2's authorization bullet is the standout: it states LLP 0011's requirement in the requirement's own engine-agnostic terms, credits the live-delta half to the in-tree matcher, correctly reclassifies the snapshot-half cost as a subset of the query-planning cost rather than an independent coupling, and its `[confirmed]` tag survives verification against both LLP 0011 §Requirement: pushdown-compilability and LLP 0007's `.assetSharing` freeze (which does cite the requirement by name, as claimed).
- **The thesis line and F1.** "Always-on logical/physical indirection vs. migration-time indirection" is a genuinely clarifying frame, and F1's two qualifications (layout not sufficient for online execution; maintenance-window is 0081's declared v1 scope, not a ceiling) are exactly the honesty a comparative doc usually lacks. The `StageTableGeneration` paragraph correctly identifies what 0081 already owns.
- **Both-directions completeness where it was previously weakest.** F2's Postgres-graduation bullet argues the counter-benefit (persistence-adapter swap vs. seam extraction, with 0046's own cost language quoted accurately) before judging it, and F6 adds the fork/time-travel benefit with a corpus-grounded rebuttal (0158's proven O(1) `clonefile` spike, 0161's layer-over-SQLite conclusion) and wires it into Trigger 4 rather than burying it.
- **F3's self-directed evidence.** Citing LLP 0160 G8 (verified: "no migration test exceeds single-digit rows") to argue Snapback lacks the fault-injection infrastructure to validate a bespoke constraint layer is the right kind of both-ways honesty.
- **Provenance discipline on the unverifiable.** §The two layouts marks the physical-table names and scope as "not pinned here," and OQ4 demands file + commit before competitive use. The Confidence section's three-tier portability statement (specified / shipped / untested promise) matches 0046 exactly.
- **Trigger quality.** Trigger 1's "a failed spike recorded as an LLP — that artifact, not sentiment, is the trigger" makes the reopen condition falsifiable rather than vibes-based.

## 4. Concerns

**C1 — MATERIAL — F5 misstates LLP 0087's status as "shipped."**
Claim: "LLP 0087's shipped direction makes app *code artifacts* data loaded at runtime" (§F5).
Evidence: `llp/0087-facets-hosted-adoption.plan.md:4` — **Status: Draft**; its Status section says the plan is "structured so each phase gate can reshape or kill the plan while the primitive is beta," and the Phase 0 progress note reports a spike with first results, Gate 0 not advanced (Revised header, 2026-07-25: "without advancing Gate 0"). Nothing in that direction is shipped. This is jarring precisely because the doc's own Confidence section carefully corrects 0007/0011/0046 to "Draft documents over shipped SQLite behavior" — the same care is not applied to 0087, and the v0.2 revision note says F5 was already recast once.
Resolution: replace "shipped direction" with "Draft-plan direction (Phase 0 spike in progress, gates undischarged)" or similar. The rest of F5's 0087 characterization (app rows stay in the coordinator's SQLite; facet SQLite is scratch; moving app-data ownership into facets "is not a candidate here") is accurate against 0087 lines 39–44.

**C2 — MATERIAL — F2/F6 omit the universal layout's MVCC-log retention cost.**
Claim at issue: F2's ownership list ("Query planning… Constraints… snapshot half… Inspectability… Brownfield… Postgres graduation") presents itself as "the additional ownership," and F6 credits the immutable log's benefits ("point-in-time reads, cheap incremental export, and near-copy-free forking") without naming the cost that is inseparable from them.
Evidence: absence — no finding mentions version garbage collection, log compaction/vacuuming, storage amplification of retaining every document version, or backup-size growth. These are engine-owned background machinery a universal-store adopter must build and operate (the same class of relocated cost F1 correctly names for schema changes), and they belong on F2's list for the tradeoff analysis to be "complete enough to brief a decision."
Resolution: add a retention/compaction bullet to F2 (or a cost sentence inside F6). Note this strengthens, not weakens, the recommendation — which is why its omission is completeness damage rather than direction damage.

**C3 — MATERIAL — F4 presents two distinct incidents as one.**
Claim: "The bakeoff incident where one Convex arm's deploy deleted another arm's index (LLP 0102 provider-limit note; diaries 0016/0017/0048)…" (§F4).
Evidence: LLP 0102's provider-limit note (lines 133–146) records the 2026-08-01 LLP 0139 upload-bakeoff incident (`ub_a_profiles.by_handle`, diary 0048's era). LLP 0074 §Priority 5 (lines 642–657) records an earlier, separate demo-matrix incident ("deploying one demo's older schema briefly removed another demo's indexes," diary 0016's follow-up — diaries 0016/0017 are the partiful/chat matrices). Same failure class, two dated events; the singular framing blurs which sources bound which inference (0074's rerun-with-separate-identities requirement attaches to the first incident).
Resolution: pluralize — "the two coupling incidents (LLP 0074 §Priority 5, diaries 0016/0017; LLP 0102 provider-limit note, diary 0048)" — the analytic point (deployment-unit atomicity, not storage layout; inference bounded by both docs) is correct and survives unchanged.

**C4 — MINOR — over-attribution to LLP 0007's Index Contract.**
Claim: "LLP 0007's Index Contract records that the *race-freedom* came free from the engine while the cross-target portability of the invariant … was real specification work" (§Snapback: per-table physical mapping).
Evidence: `llp/0007-storage-portability.spec.md:427-437` — the Index Contract says inserts "race at the serialized commit, so exactly one duplicate key wins," and does the NULL-semantics/diagnostic work, but it nowhere frames race-freedom as having "come free from the engine." That framing is 0159's (reasonable) inference, presented as something 0007 "records."
Resolution: reword to own the gloss — "LLP 0007's Index Contract shows the split: the engine's unique index resolves the race at the serialized commit, while the portability of the invariant… was specification work."

**C5 — MINOR — load-bearing but unverifiable Convex specifics beyond the four-tables figure.**
Claim: "managed MySQL (Aurora RDS, since migrated to PlanetScale Postgres)" and F2's "Convex's SQLite/Postgres/MySQL abstraction demonstrates this [persistence-adapter swap]" (§The two layouts, §F2).
Evidence: both sit inside the honestly-labeled `[observed — prose sources…]` block, but OQ4's pin-before-use rule covers only the table-set figure. The hosting-migration parenthetical does no analytic work and cannot be checked here; the persistence-abstraction claim *does* do work (it carries F2's graduation counter-benefit).
Resolution: either extend OQ4's pinning ask to the persistence-abstraction claim (it is checkable against the same repo docs) or add a clause noting the F2 counter-benefit inherits the Medium confidence of the Convex facts. Drop or hedge the PlanetScale parenthetical.

**C6 — MINOR — Related-header drift.**
Claim: header lists "LLP 0075, LLP 0126" among Related; body cites neither. Conversely, F4 leans on LLP 0102 and LLP 0072, F5 on LLP 0018, and none of the three appears in Related.
Evidence: header line 19 vs. body text of F4/F5.
Resolution: reconcile the Related list with the documents actually cited.

## 5. Suggestions (non-blocking)

- F5/OQ3 gesture at "per-app DDL churn pain" abstractly; the concrete per-table failure mode the hypothesis would hit first is SQLite schema-catalog scale (thousands of tables → `sqlite_master` bloat, prepared-statement churn, per-table page overhead at low row counts). Naming it would make Trigger 2 measurable.
- F2's inspectability bullet could note that LLP 0046 is also careful to keep the *Postgres* side application-shaped (its §Schema translation maps to native DDL through 0007's single-sourced table) — one more corpus anchor for "native-relational outcome is an identity property, not an accident."
- LLP 0046 line 40 describes `src/storage.rs` as "~2,300-line"; it is now ~27,000 lines. Not 0159's error, but since 0159 quotes 0046's seam-extraction cost claim, a parenthetical "(the file has since grown ~10×, sharpening 0046's every-month-costs-more point)" would both update the fact and strengthen F2. Alternatively, file the staleness against 0046.
- A hosted-multi-tenancy sentence would round out F5: universal tables also buy tenant *density* (many apps in few physical tables), which Snapback's per-app instance boundary (LLP 0018) deliberately forgoes — worth one line so a future reader knows the omission was considered, not missed.

## 6. Open questions for the author

1. Is "shipped" in F5 a deliberate claim about the facets *spike* having landed results, or a drafting slip? (C1 assumes slip; if deliberate, the claim needs its own evidence and a much narrower verb.)
2. F1 says each system's migration story is "downstream of its physical layout," while F4 says deployment-global coupling is "separable" from layout. Is engine-owned reactivity (named in the Summary's enabler list) downstream-of-layout in the F1 sense, or separable in the F4 sense? Convex's read-set subscriptions come from OCC read sets, which do not obviously require a universal store; the Summary currently groups it with the layout's structural yields.
3. Should Trigger 3 name who owns generating the hosted DDL-vs-row-copy evidence (LLP 0160 G8's stress fixture is named as prerequisite, but no owner or lane), so the trigger is actionable rather than aspirational?
4. The header note says a hardened recommendation "graduates to a Decision with LLP 0037-style ratification." Given the recommendation is "do nothing unless triggered," what artifact *records* the standing posture if this stays Research — is Active status for this doc itself the intended terminal state?

## 7. Recommended next step

Apply the C1–C4 sentence-level fixes (plus the C5/C6 tidying) in a v0.3, then promote out of Draft — for a Research document of this kind, Active is the natural terminal status, with graduation to a Decision explicitly deferred to the recorded triggers. No further review round is needed unless the author contests C2's scope; the fixes are mechanical and none reopens the analysis. Independently, OQ4's pinning task (verbatim table names + commit from convex-backend) is a ten-minute follow-up worth doing before any competitive reuse of the "four tables" figure, and C5 suggests folding the persistence-abstraction claim into that same pinning pass.
