# Panel: LLP 1010 — Quarry language amendments (codex gpt-5.6-sol)

**Reviewed:** `llp/1010-quarry-language-amendments.rfc.md` revision (a), overlaid on a
read-only worktree at `18b69426b`, with the Quarry front end
(`snapback2/packages/compiler/src/quarry/`), the reference and templates, the Quarry
fixtures, `lib.d.ts`, LLP 1001/1004/1007, LLP 0329.014.004/.010, and the rules.
**Family:** codex gpt-5.6-sol
**Provider/runtime:** OpenAI Codex CLI 0.153.0 (`codex exec -s read-only`), model gpt-5.6-sol, reasoning effort **ultra**
**Date:** 2026-09-03
**Redacted:** No — the panelist read the in-repo documents and sources directly in a
read-only worktree; no content left the local machine beyond the model serving this CLI.
**Method:** Two rounds. Round 1 mutually blind on an identical brief
(`~/projects/snapback-1010-panel/brief-r1.md`, preserved in the round-1 brief record
below the reviews). Round 2 cross-read: each panelist received the other's round-1
review verbatim, the author's verified list of what was settled, and eight enumerated
disagreements. The orchestrating Claude session authored the RFC and is not an
independent reviewer; it synthesized and revised.
**Recorded by:** Claude Fable 5.1 (orchestrator), verbatim from the CLI's final message.

## Round 1 (blind)

**Family:** OpenAI GPT-5 Codex · **Date:** 2026-09-03 · **Method:** blind round 1, read-only checkout at 18b69426b

## 1. Overall assessment

The RFC correctly identifies the write-sigil and post-filter starvation problems, but two central readings are materially wrong: table-rule equality is already total, unlike program equality, and `where` does not erase wire-level `capped` state. The right amendment set is therefore A1, corrected A2, scoped A3, the cursor-refusal half of A5(a), and a substantially completed A5(c); A4 and A5(b) should be rejected. The merge design must include pagination, self membership, total ordering, deduplication, and truthful final-slice state before it can claim the loop bar.

## 2. Per amendment

### A1 — **ACCEPT WITH CHANGES**

The defect is real, though my preference for words is partly taste: the AST and lowerer already use semantic operation names, while only the parser exposes sigils (`snapback2/packages/compiler/src/quarry/ast.ts:42`, `parser.ts:548,706-713`). Words delete the sigil vocabulary and `+~` lexer token without changing write semantics or yields (`program.ts:102-119,717-772`). The census is wrong: the named fixture groups plus two templates contain 43 inserts, 3 upserts, 21 updates, and 13 deletes, still totaling 80. Also, `upsert` is not a table-rule name—rules admit only read, insert, update, and delete (`ast.ts:58`, `parser.ts:122`)—and the RFC must define whether the new words are contextual keywords or forbidden bindings. Accept once those claims are corrected and the retained legacy recognizer is described honestly: pasteable sigil refusals mean the old syntax is recognized, not wholly deleted.

### A2 — **ACCEPT WITH CHANGES**

The program-language defect is real: nullable `=`, `!=`, and ordered comparisons are guarded false, apart from a right-hand `null` special case (`program.ts:317-358`). But rules already lower to `rule.eq/ne` and the runtime compares values totally (`schema.ts:138-154`; `snapback2-core/src/engine/runner_ops.rs:681-685`), so the historical authorization NULL trap is not currently reproducible in table rules; the stronger case is eliminating program/rule inconsistency. Total program equality also requires a migration: Clique deliberately uses `not (post.parent = post.parent)` as an absence test, which would become always false (`fixtures/quarry-clique/snapback/social.q:53-57`). I accept refusing ordered comparison on optional values: explicit `!` or `??` is preferable to silent false, although the RFC must migrate the optional receipt comparisons at `quarry-clique/snapback/chat.q:83,91,94` and state that Quarry has no flow-sensitive narrowing. Make null handling symmetric, retain nominal-type refusals, and treat removal of the chat membership matrix as independent cleanup because those compared fields are already nonoptional and immutable (`templates/chat/snapback/schema.q:31-38,48-54`).

### A3 — **ACCEPT WITH CHANGES**

The split is real: table rules require a binder, final-exists requires another, maintains have their own path and implicit-`r` exception, while shapes and `where` use focal dot (`parser.ts:141-149,174-216,228-249,568-571`). This verdict is partly taste, but the corpus evidence supports subtraction: the scoped one-row rules uniformly call the otherwise-arbitrary binder `r`; only `(old, next)` conveys useful multiplicity. The cost is understated because schema lowering only recognizes named rule binders (`schema.ts:120-123,165-177`), and the change must cover table rules, maintain `read`/`readable`, and `after insert`, not just parser/printer fixtures. Accept once the RFC explicitly distinguishes `.` as candidate image in a one-row update rule from `.` as old stored row in an update patch, and names the AST, lowering, diagnostic, and guide work. It then genuinely deletes binder syntax and the readable special case.

### A4 — **REJECT**

The parser first creates a generic bracket read and then adds its range suffix (`parser.ts:621-627,642-686`), but the supposed defect is mostly imagined: canonical Quarry already puts `first`/`last` immediately after the bracket or cursor. Moving the bound does not remove point/range/probe overload or index inference (`catalog.ts:129-175`); it creates another prefix-expression grammar and rewrites every range without deleting a concept. The benefit is aesthetic, the cost is real, and current authoring evidence does not show confusion. Only replicated correction-loop evidence showing agents systematically misread range cardinality would change this verdict.

### A5 — **ACCEPT WITH CHANGES**

#### A5(a) — **ACCEPT WITH CHANGES**

Cursor-plus-`where` is genuinely admitted despite the guide saying cursors do not survive filtering (`parser.ts:660-686`; `guide/quarry.md:108-112`), so refuse that combination and delete the misleadingly accepted surface. The wire-state diagnosis is false: Quarry executes the underlying `db.scan` before filtering (`program.ts:594-619`), and query state becomes `capped` whenever its trace records `Limit` (`snapback2-core/src/engine/mod.rs:978-993`). If the underlying scan exhausts, the filtered result is truthfully complete; blanket-capping every `where` would degrade exact results. Strike that half and retain the cursor refusal.

#### A5(b) — **REJECT**

The shipped following feed really can starve (`templates/chat/snapback/feeds.q:8-16`), but “predicate mentions `viewer`” is neither necessary nor sufficient. Bindings resolve before the viewer intrinsic (`program.ts:307-314`), so `me = viewer` evades a textual check, caller-supplied principals have the same behavior, and harmless redundant viewer predicates would be rejected. Existing `capped` already reports incompleteness honestly; this proposal deletes valid expressions while leaving aliases of the bad form. A sound provenance-based criterion with demonstrated authoring benefit could change my verdict, but that is substantially more machinery than the RFC prices.

#### A5(c) — **ACCEPT WITH CHANGES**

Bounded fan-in is the right primitive and deletes both the explicit `merge` refusal (`parser.ts:555`) and client-side lane merging. The RFC nevertheless underspecifies correctness: if all lanes exhaust but their union exceeds N, the final slice still truncates, so “complete iff every lane is complete” would falsely report complete unless merge truncation enters the authoritative trace. Its cost formula also omits the engine’s `take + 2` scan reserve and the outer lane scan (`snapback2-core/src/certificate.rs:932-960`): the stated 50×50 example begins at 2,652 examined entries, not 2,500. A new IR primitive may not be necessary because bounded loops plus `Concat`, multi-key `Sort`, and `Slice` already exist, and the TypeScript lowerer already composes those for `mergeByTime` (`compiler/src/compiler.ts:969-998`; `snapback2-core/src/ir.rs:212-239`). Acceptance requires a shared total suffix order, ordinary shared-tuple pagination, defined duplicate-prefix behavior, an explicit self lane, final-slice state, and honest handling of a capped followed-account list. Cursorless v1 does not meet the brief’s required infinite-scroll acceptance test (`benchmarks/briefs/social-messenger.md:446-452,479-480`), and persisted self-follow contradicts its explicit semantics (`:91-95`).

## 3. Open questions

1. **Kill A4.** Placement is therefore moot; if revived, `after`/`before` should remain after the bracket because its tuple is interpreted against that read’s chosen index suffix.

2. **Refuse ordered comparisons on optional operands.** Require `!` or `??`, migrate the existing optional-watermark comparisons, and document the absence of flow-sensitive narrowing.

3. **Cursorless merge is insufficient.** Because all lanes share one total order, the last merged row’s ordinary suffix tuple can be applied to every lane; a frontier vector need not be imported unless that simpler cursor is shown inadequate.

4. **A3 is worth the churn now**, provided it covers all three rule-parsing paths and precisely states focal semantics. This is a simplicity ruling, not a response to demonstrated author failure.

5. **Yes:** optional cursor syntax and non-disclosing get-or-create rank above A4 and A5(b). A4, blanket `where` capping, and viewer-name starvation detection should be struck.

## 4. What the RFC missed

1. **Optional cursor clauses, including merged reads.** Current examples duplicate whole query bodies around nullable cursors (`compiler/src/quarry-checks.ts:285-300`), while Clique duplicates `laneFeed`/`laneFeedBefore` and `chatThread`/`chatThreadBefore` (`quarry-clique/snapback/social.q:103-125`; `chat.q:124-136`). A first-class optional cursor deletes those paired operations, branches, and client routing while making A5 satisfy pagination.

2. **Non-disclosing `insertIfAbsent`.** `db.upsert` returns void (`compiler/lib.d.ts:71-74`), so `createMyProfile` and `setFollow` perform point-read/branch/insert sequences (`templates/chat/snapback/profiles.q:7-12`; `follows.q:1-10`). The prior exercise and design already call for `insertIfAbsent` returning an outcome without revealing the conflicting row (`llp/0329.014.010…:197-210`; `0329.014.004…:282-287`). It deletes race-prone get-or-create boilerplate.

3. **Canonical range modifiers and duplicate-`by` refusal.** `parseRange` accepts arbitrary modifier permutations and silently overwrites a prior index when another `by` appears (`parser.ts:623-627,668-683`). Require the already-printed canonical order and refuse a second modifier; this deletes grammar permutations and last-one-wins behavior instead of moving every bound as A4 does.

## 5. What the RFC should strike

- A4 in full.
- A5(a)’s unconditional `capped` rule, retaining only cursor-plus-`where` refusal.
- A5(b)’s viewer-syntax diagnostic.
- A5(c)’s claim that a dedicated IR/evaluator primitive is necessarily required, its 2,500 cost figure, its current completeness formula, and the suggestion of persisted self-follow.
- A2’s claim that current table-rule equality reproduces the historical NULL trap, plus the claim that the chat matrix becomes correct specifically because of A2.
- A1’s claim that all four write words already name table rules.

## 6. Verdict on the document

**NOT READY.** To become ready: correct the A2 and A5(a) semantic accounts; remove A4 and A5(b); repair the census and rule-name claims; and specify A5(c) through pagination, ordering, self inclusion, deduplication, certificate cost, and authoritative truncation state.

## Round 2 (cross-read)

**Family:** OpenAI Codex gpt-5.6-sol · **Date:** 2026-09-03 · **Method:** cross-read round 2, read-only checkout at 18b69426b

## Disagreements

### D-A — CHANGE: delete `where`

The cross-read changed my position: the checkout has five physical `.q` occurrences but only three semantic uses, all better modeled as merge, an indexed prefix, or an invariant. The claimed post/profile invariant is not currently universal: `seed.ts:24–27` inserts Charlie’s post without a Charlie profile, while the table rule permits any viewer-authored post. Add `after insert <- exists profiles[.author]`, repair that seed row, and then delete `createPost`’s redundant profile check; deleting `where` thereby removes its grammar, filter loop, page-to-sequence retype, cursor fence, viewer analysis, and proposed starvation diagnostic.

### D-B — NEW: moot after D-A; refuse if retained

If `where` survives, `count(where-result)` is only the length of the returned filtered slice, never a population count. Because `program.ts:619` launders the page into `sequence` and `count` accepts sequences at `:495–497`, preserve page provenance and refuse this use as `E_STRUCTURAL_COUNT`, rewriting to an indexed prefix or maintained aggregate. The wire-level `Capped` state remains truthful; the defect is the structural interpretation, not missing state.

### D-C — HOLD, mechanism NEW: choose (iii)

Use a certificate-declared merge site that groups its generated lane range sites and N; `query_state` can inspect existing `TraceRange.stop` and distinct `returned_ids`. Report `complete` only when every member range stopped `Exhausted` and the deduplicated union contains at most N rows; otherwise report `capped`. This preserves complete small feeds without a new collection opcode or a generic trace rule for ordinary `Slice`.

### D-D — HOLD WITH CHANGES

Dedupe by intrinsic row `id` before the final slice; static-equality refusal misses duplicate prefixes produced at runtime, while leaving duplicates violates M2 pagination. Make one-table ownership syntactic—prefer `merge posts before … last 20 by byAuthorTime:` followed by `[viewer]` and `[f.followed] for …`—and require every lane to consume the same prefix width/types, leaving the same total suffix tuple. The capped list is acceptable for the reduced loop bar only: the recipe must literally explain that `first 50` omits the 51st followee and yields `capped`, and that it does not meet the later 500-follow capability probe. With the self lane, the candidate’s base scan bound is `52 + 51×22 = 1,174` for N=20; the earlier N=50 example becomes 2,704, before shaped point reads.

### D-E — HOLD: include (i), explicitly

Allow an all-or-none optional cursor group on ordinary and merged reads: all arguments absent/null omits the cursor, all present applies it, and mixed presence raises `E_INPUT` before scanning. This intentionally narrows today’s per-component universal-`Null` contract, so limit the sugar to optional operation arguments over nonoptional suffix columns and preserve explicit literal/data-null cursors elsewhere. It deletes not merely a three-line branch but paired `globalFeed*`, `laneFeed*`, and `chatThread*` operations, duplicated shapes/API entries, and client first-page routing.

### D-F — CHANGE: defer to a filesystem ticket

`insertIfAbsent` should not widen LLP 1010. Today’s idiom is race-safe because the current store is exclusive-single-writer and each mutation executes transactionally; a proper non-disclosing primitive cannot merely lower through visible `db.get`, because an unreadable conflicting row requires engine, evaluator, certificate, and outcome semantics. It would eventually delete read/branch/insert and unique-conflict handling, but the current public/self-readable loop-bar cases do not justify importing that platform design here.

### D-G — HOLD

Use the existing printer and corpus order: `table[prefix] [after|before cursor] first|last N [by index]`; merge uses the identical cursor → bound → `by` order and requires its one header `by`. Refuse repetitions and permutations as `E_QUARRY_SYNTAX` with the complete canonical rewrite. Cover both `parseRange` and the postfix `by` arm at `parser.ts:623–625`, which also permits repeated or pre-range `by` to overwrite silently.

### D-H — HOLD: no narrowing yet

Use an outer presence branch and then `m.lastDeliveredAt! >= upTo`; three migration sites do not earn a flow-analysis subsystem. Do not write `x != null and x! >= y`: Quarry emits the assertion prelude before the final `&&`, so the assertion may execute before short-circuiting. Revisit general narrowing only after authored-code evidence shows the nested explicit form is materially noisy.

## Final recommended amendment set, ranked

1. Ship one-table block `merge` with shared total cursor, explicit self lane, ID dedupe, bounded lanes, and truthful final-cut state; delete the merge refusal, client fan-in, and starving Following template.
2. Delete `where`, replacing uses with merge, an indexed prefix, or a table invariant; delete its production, sequence retype, A5 fences, count ambiguity, and starvation-code proposal.
3. Add all-or-none optional cursor groups to ordinary and merged reads; delete paired operations, duplicated query bodies/API entries, and client routing.
4. Make program equality total and refuse ordered optional operands; delete guarded equality, the null exception, and the Clique absence hack.
5. Replace write sigils with reserved words; delete four sigil productions and the `+~` token.
6. Use `.` for every one-row rule path; delete binder words and the implicit-`r` exception.
7. Enforce cursor → bound → `by` ordering and single-use modifiers across postfix, ranges, and merge; delete grammar permutations and last-`by`-wins behavior.
8. Document named-column keys and two-name `sorted`; delete the served-guide gaps.
9. Strike A4 completely; delete its proposed grammar and corpus churn.
10. Keep flow narrowing and `insertIfAbsent` outside LLP 1010, filing only the latter as a scoped follow-up; delete both implementation obligations from this RFC.

## What I would steal

I would steal Grok’s subtractive framing of `where`: once the corpus is enumerated, deleting the combinator is cleaner than surrounding it with cursor, viewer, and count fences. I would also steal its page-to-sequence/count observation and its insistence on documenting named-column keys and two-name `sorted`. I would not retain its operation-level profile-invariant claim; the orphan Charlie seed proves that migration must establish a table invariant.

## Verdict after the changes

Ready for the author to rule on and implement; no design blocker remains once D-C/D-D semantics, the post/profile invariant migration, optional-cursor null narrowing, and both duplicate-`by` paths are normative. Revision (a) itself is not ready.

The checkout is read-only, so I could not append this round to `llp/reviews/`; this markdown is the provenance-bearing payload to record.
