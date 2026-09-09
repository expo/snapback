<!-- Provenance: blind read-only review received from codex gpt-6-astra (reasoning max) on 2026-09-09 against origin/main 635999335; launched by the orchestrator (Claude Fable 5.1) from ~/projects/snapback-el-20260908/reviews/rfc/1020.prompt.md; content verbatim. -->

Reviewer: gpt-6-astra, reasoning max · Date: 2026-09-09 · Method: blind read-only review of llp/1020-day-two-evolution-and-legible-ceilings.rfc.md at 635999335

Source inspection only; no tests executed, agents used, or repository files changed.

## Part 1 — the open questions

### 1. Should removing an unused enum case be additive?

**My answer:** Yes—as checked narrowing at installation, subject to the remaining successor checks. It is not widening. Nonzero usage should produce a preservation-oriented refusal, not automatically erase the column.

**Why:** This extends the implemented optional-to-required rule: admission depends on the stored values at application, while `check` remains static. The existing narrowing walker counts null/absent rows and samples at most ten IDs. (`llp/1016-administrative-plane.rfc.md:346`; `snapback2/crates/snapback2-core/src/successor_narrowing.rs:36`.)

The destructive alternative is disproportionate: `Drop::TypeChange` removes the entire column’s values, including still-valid variants. M7 explicitly requires existing messages, media, receipts, and reactions to survive. (`snapback2/crates/snapback2-core/src/successor.rs:558`; `benchmarks/briefs/social-messenger.md:694`; `benchmarks/briefs/social-messenger.md:711`.)

Zero usage does not authorize bypassing other checks. Enum grouping can affect maintained addresses and typed references. Existing queued intents must retain their original bytes and receive the established conflict/reset behavior; narrowing does not promise that old clients can write removed values. This needs no new migration language or multigeneration facility. (`llp/1001-query-engine.spec.md:625`; `llp/1018-structural-moves-to-surpass-convex.research.md:325`; `rules/NOT-DOING.md:39`.)

**Confidence:** 96/100.

**Exact replacement text:** Replace the enum-removal row at `llp/1020-day-two-evolution-and-legible-ceilings.rfc.md:120` with:

> | `enum(a, b, c)` | `enum(a, b)` | checked narrowing at application: additive when no affected stored row contains a removed variant and all other successor admission checks pass; otherwise `E_SUCCESSOR_NARROWING` |

Add immediately after the table:

> Enum removal is not `widens`. During installation, check affected enum values, including occurrences inside Optional/List wrappers, against the candidate stored image in the successor transaction. Record the compared generations, removed variants, and affected-row count, including zero. A nonzero count refuses with family `successor`, the declaration site, at most ten sampled row IDs, and a rewrite to an explicit job that maps or deletes the affected rows under the predecessor schema; the page is `successor`. Neither this refusal nor `fill` silently substitutes a value for a removed non-null variant. Existing address validation, constraints, and generation fencing remain in force.

Record under question 1:

> **Resolution:** Unused enum removal is checked additive narrowing at installation, with a logged zero count and all existing successor checks preserved.

### 2. Should the backfill literal use `fill` or `= literal`?

**My answer:** Use `fill`, explicitly meaning a successor repair. It must not imply an insertion default.

**Why:** Quarry already uses `=` for bindings, equality, and named keys. Another use is syntactically possible; my objection is semantic ambiguity, not parser feasibility. `fill` identifies the operation being performed. (`snapback2/packages/compiler/src/quarry/parser.ts:689`; `snapback2/packages/compiler/src/quarry/parser.ts:887`; `snapback2/packages/snapback2/guide/grammar.md:64`.)

The existing job vocabulary already says “fill,” and distinguishes repairing stored rows from changing seeds. A default-looking declaration would encourage omitting required values from seeds or later inserts, which this proposal does not implement. (`snapback2/packages/snapback2/guide/job.md:1`; `snapback2/packages/snapback2/guide/operator.md:22`.)

The word requires the inventory/WHY amendment already specified by LLP 1011. This spelling ruling does not establish demand for the feature: the day-two brief requests a nullable timestamp, pins, and a refactor, none of which requires literal backfill. (`llp/1011-quarry-ergonomics.rfc.md:595`; `rules/NOT-DOING.md:118`; `benchmarks/briefs/messaging-day2-evolution.md:43`.)

**Confidence:** 92/100.

**Exact replacement text:** Replace §3’s semantics through the “default for the next narrowing” claim, beginning at `llp/1020-day-two-evolution-and-legible-ceilings.rfc.md:154`, with:

> `fill <literal>` is a successor repair, never an insertion default. When installing a new required column or removing an outer optional wrapper, it replaces that column’s stored null or absent values inside the successor transaction before final admission. The literal must satisfy the destination field’s type and applicable write constraints. Existing non-null values are preserved. A retained `fill` annotation is otherwise inert; seeds and subsequent inserts must still provide required fields. Computed repairs and mappings of removed non-null enum variants use the existing job path.

Record under question 2:

> **Resolution:** Use `fill`; it denotes an idempotent successor repair and supplies no default to future inserts.

## Part 2 — the review

### 1. Verdict

**NOT READY.** The proposal contains false current-baseline claims, an impossible regrouping guarantee, and incomplete soundness rules for fill admission and cap completeness.

### 2. Blocking defects

**B1. Several proposed fixes target behavior already changed at the pinned commit.**

- A uniform range returning exactly `take` rows reports exhaustion when its lookahead proves exhaustion; query state then becomes `Complete`. Thus “`first N` over a cap-N group is `capped`” is not a valid general claim about this baseline. The cap is unnecessary for this runtime determination. (`llp/1020-day-two-evolution-and-legible-ceilings.rfc.md:71`; `snapback2/crates/snapback2-core/src/engine/scan.rs:349`; `snapback2/crates/snapback2-core/src/engine/execution_record.rs:9`.)
- Maintained point reads lower to `Get`, a null test, and a typed-zero result—not `Builtin::Count`. The stated cause of the nested-maintain refusal is false for current lowering. (`llp/1020-day-two-evolution-and-legible-ceilings.rfc.md:75`; `snapback2/packages/compiler/src/quarry/direct.ts:741`.)
- `E_STEPS` already uses the same sourced-product construction as `E_BOUND`, including the dominant-term rewrite. (`llp/1020-day-two-evolution-and-legible-ceilings.rfc.md:211`; `snapback2/crates/snapback2-core/src/certificate/diagnostic.rs:278`; `snapback2/crates/snapback2-core/src/certificate/diagnostic.rs:319`.)
- Ordinary IDs already enforce 144 canonical tagged bytes; typed maintained references use validated schema-derived bounds. The ID ticket’s original admission hole is therefore stale. Replacing this with an unspecified input-length scheme would disturb an implemented contract. (`llp/1020-day-two-evolution-and-legible-ceilings.rfc.md:216`; `snapback2/crates/snapback2-core/src/value.rs:329`; `snapback2/crates/snapback2-core/src/cap.rs:419`; `snapback2/crates/snapback2-core/src/retention.rs:977`; `llp/1001-query-engine.spec.md:618`.)

Replace these premises with current reproducers or mark the corresponding work already satisfied. Historical observations remain useful, but acceptance cannot require them all to reproduce at this base.

**B2. “Old grouping readers fail at check” cannot be guaranteed, and table-wide exemption exceeds projection ownership.**

Regroup `counts` from `sender: principal` to `recipient: principal`: `counts[viewer]` can still resolve by positional key type and arity. Its meaning changes without `E_QUARRY_UNKNOWN`. The compiler does not compare the reader’s old intent with the predecessor grouping. Therefore `check` cannot be “the only signal.” Report old/new groupings during succession and promise static refusal only for actual name/type/index incompatibilities. (`llp/1020-day-two-evolution-and-legible-ceilings.rfc.md:133`; `snapback2/packages/compiler/src/quarry/catalog.ts:241`; `snapback2/packages/compiler/src/quarry/catalog.ts:357`.)

Moreover, ownership covers the exact union of predecessor/successor projected IDs; other target rows survive. Exempt projection replacement, not every destructive change to a table that happens to be maintained. Specify retained targets, retired targets, ordinary survivors, and whole-table removal separately. (`llp/1001-query-engine.spec.md:515`; `llp/1001-query-engine.spec.md:527`; `snapback2/crates/snapback2-core/src/successor.rs:754`.)

**B3. The proposed fill budget is not a sound write bound.**

A per-table source-row count omits multiple affected tables, maintained applications, and timer writes. Two fills affecting 1,500 rows each can exceed 2,048 writes while both tables pass the stated test. A source update can also generate old/new maintained applications and timer work. Existing certification sums physical amplification. (`llp/1020-day-two-evolution-and-legible-ceilings.rfc.md:160`; `snapback2/crates/snapback2-core/src/certificate.rs:355`; `snapback2/crates/snapback2-core/src/certificate.rs:365`; `snapback2/crates/snapback2-core/src/certificate.rs:416`.)

The supporting claim that index population is priced this way today is false: succession iterates batches through the table without that ceiling. Define an installation-wide repair budget, what counts as an actual repair, and how derived work is charged. (`snapback2/crates/snapback2-core/src/successor.rs:488`; `snapback2/crates/snapback2-core/src/successor.rs:621`.)

The oversized-new-column fallback must first install the optional column before its job can write it. Also resolve whether a fully repaired large table bypasses the row-count refusal. The existing recipe supplies the missing expansion step. (`snapback2/packages/snapback2/guide/job.md:3`; `llp/1020-day-two-evolution-and-legible-ceilings.rfc.md:162`.)

**B4. Cap-derived completeness lacks essential preconditions.**

`Completeness` is certificate-wide; a read site has a separate `complete` boolean. The RFC proposes marking a site with the former without defining the representation or composition rule. (`llp/1020-day-two-evolution-and-legible-ceilings.rfc.md:173`; `snapback2/crates/snapback2-core/src/certificate.rs:175`; `snapback2/crates/snapback2-core/src/certificate.rs:220`.)

A maximum argument bound exceeding the cap does not prove the evaluated take does; another nonuniform scan can consume the shared budget. Existing complete-fanout admission rejects argument bounds, cursors/ranges, and competing nonuniform scans, and runtime guards the full reserve. Preserve these distinctions. A complete selected suffix also does not prove possession of an entire cap group. (`snapback2/crates/snapback2-core/src/engine/scan.rs:140`; `snapback2/crates/snapback2-core/src/certificate_policy/fanout.rs:382`; `snapback2/crates/snapback2-core/src/engine/scan.rs:249`.)

A cap must never manufacture exhaustion, receipt coverage, or a globally complete result. Those states require the existing trace and visibility conditions. (`llp/1001-query-engine.spec.md:181`.)

**B5. The custody sibling cannot inherit this rebuild exemption.**

LLP 1019 defines delivery membership at send time, including tombstones for departed recipients, but also promises rebuilding delivery targets and cites this RFC for nondestructive removal. Current membership cannot reconstruct historical recipient custody: rebuilding can invent recipients and erase recipients still needing tombstones. (`llp/1019-derived-delivery-custody.rfc.md:152`; `llp/1019-derived-delivery-custody.rfc.md:162`; `llp/1019-derived-delivery-custody.rfc.md:174`.)

Restrict §2 to reconstructible count/sum projections. Require LLP 1019 to define its own preservation/migration semantics before sharing this mechanism.

### 3. Material changes

**Specify the installation algorithm.** Fill changes the image against which narrowing, caps, uniqueness, maintained ownership, and schedules must be judged. Current ordinary admission precedes the transaction; explicit migration captures predecessor projected IDs before transforming sources. Define ordering across watcher installation, explicit migration, and reopening, including rollback and same-clock timer reconciliation. (`snapback2/crates/snapback2-core/src/registry.rs:969`; `snapback2/crates/snapback2-core/src/registry.rs:1021`; `snapback2/crates/snapback2-core/src/registry.rs:1163`.)

**Make compatibility precise.** Apply it in both destructive classification and required-column admission. Specify recursive Optional/List composition and preserve image `once` custody semantics. Text minimum/format lives in constraints, whereas maximum lives in the column type; a type-only relation cannot describe both. (`snapback2/crates/snapback2-core/src/successor.rs:185`; `snapback2/crates/snapback2-core/src/successor.rs:243`; `snapback2/crates/snapback2-core/src/successor.rs:963`; `snapback2/packages/compiler/src/quarry/bound-schema.ts:240`.)

**Define a real cost-report contract.** Include index entries, rule probes, and physical writes, omitted from the example. Share analysis terms between successful and refused programs; failed generation certification currently exposes no partial certificates. Define how per-site terms reconcile with program totals and branch maxima. (`llp/1020-day-two-evolution-and-legible-ceilings.rfc.md:199`; `snapback2/crates/snapback2/src/check.rs:313`; `llp/1001-query-engine.spec.md:296`.)

The example’s `50 lanes × (20 + 2)` conflicts with lazy uniform merging, which charges discovery plus heads plus one shared page reserve. Replace it with generated output from a named fixture. (`llp/1020-day-two-evolution-and-legible-ceilings.rfc.md:202`; `snapback2/crates/snapback2-core/src/certificate/merge.rs:70`; `llp/1010-quarry-language-amendments.rfc.md:352`.)

“Actual” also needs definition: the trace records examined, probes, steps, derived scratch, and writes, but no general heap-peak or closure-byte measurement. Label derived estimates and unavailable measurements honestly; preserve `why`’s active certificate/source matching. (`snapback2/crates/snapback2-core/src/engine/receipt.rs:113`; `snapback2/crates/snapback2/src/why.rs:71`.)

**Repair recurrence soundness, not fixture equality.** The scalar/object gap remains visible: output and retention growth handling is restricted to collection prices. Cover multiple self-occurrences, nested loops, aliases, branches, and retained intermediates; a static bound must dominate every admitted execution, not equal one observed result. **I could not verify** the exact 68→1,020 execution: the named ticket contains no runnable program or trace. (`snapback2/crates/snapback2-core/src/certificate/output.rs:118`; `snapback2/crates/snapback2-core/src/retention.rs:429`; `issues/20260903-snapback2-loop-carried-rebind-underpriced.md:6`.)

**Preserve authority through maintained reads.** A point lookup does not grant permission to erase structural provenance in its key or surrounding control flow. An unreadable maintained row can yield server zero while receipt-only replay remains partial; “total” must not become fabricated absence authority. (`snapback2/crates/snapback2-core/src/certificate_policy.rs:327`; `llp/1011-quarry-ergonomics.rfc.md:607`.)

**Finish diagnostics and scope accounting.** Name the enum-conflict payload, family, declaration site, executable repair, and page; include the missing `E_STEPS` guide treatment. Explain diagnostic truncation without dropping the aggregate count. Adding a word needs the inventory amendment, and moving deferred scope needs a named offset—not merely promising a Moves line. (`rules/NOT-DOING.md:102`; `rules/NOT-DOING.md:118`; `llp/1011-quarry-ergonomics.rfc.md:595`; `llp/1020-day-two-evolution-and-legible-ceilings.rfc.md:232`.)

### 4. Minor

- Replace “silently nulls” with “the approved destructive retype clears values.” The current contract exposes the drop plan and rolls it back on refusal. (`llp/1020-day-two-evolution-and-legible-ceilings.rfc.md:15`; `llp/1001-query-engine.spec.md:462`.)
- The cited nested-maintain workaround concerns poll tallies, not merged search. (`llp/1020-day-two-evolution-and-legible-ceilings.rfc.md:190`; `issues/20260907-snapback2-quarry-gaps-from-the-m7-migration-legs.md:10`.)
- Cite the closed feed-ceiling ticket for 11,684/5,860,100 and its resolution; the August row-max ticket supports different figures. (`issues/closed/20260906-snapback2-following-feed-merge-ceiling-under-brief-envelope.md:7`; `issues/closed/20260906-snapback2-following-feed-merge-ceiling-under-brief-envelope.md:18`.)
- Add LLP 1012 and both siblings to `Related:`. Correct Systems paths to include `snapback2/`. The inventory pin is already implemented, so S3’s waiting condition is stale. (`llp/1020-day-two-evolution-and-legible-ceilings.rfc.md:5`; `llp/1020-day-two-evolution-and-legible-ceilings.rfc.md:278`; `llp/1011-quarry-ergonomics.rfc.md:595`.)
- One successor card plus an alias fits the recipe direction; consolidate duplicated operator/job prose and retain existing byte and loop budgets. (`rules/NOT-DOING.md:76`; `rules/NOT-DOING.md:81`; `rules/RULES.md:43`.)

### 5. What acceptance does not prove

**Successor correctness and atomicity.** The shared corpus has no successor category, and administrative succession does not execute on the twin. Replace “engine and twin agreeing on successor admission” with Rust installation/migration/reopening tests, followed by client delivery tests. Include zero/nonzero enum removal, nested types, mixed widening+narrowing, multiple fills, derived-write overflow, survivor collisions, and an injected failure proving rows, indexes, generation, and timers all roll back. (`llp/1020-day-two-evolution-and-legible-ceilings.rfc.md:252`; `llp/1017-cap-and-complete-fanout.rfc.md:569`; `llp/1016-administrative-plane.rfc.md:19`.)

**Client continuity and visibility.** Add two clients, a cold reopen, queued old-generation writes, a removed operation with a retained terminal, an absent maintained group, and a hidden group. Verify preserved intent bytes, explicit conflict/reset states, fresh coverage, and no false zero or complete receipt. This directly exercises the promised day-two continuity and “no silent states.” (`llp/1018-structural-moves-to-surpass-convex.research.md:336`; `llp/1012-local-first-v1.spec.md:1177`; `llp/0329.016-agentic-dev-loop-from-scratch.rfc.md:794`.)

**The promised product journey.** “Six items” enumerates five and differs from the ticket’s six-item list. Run actual M7 with populated media, reactions, receipts, tombstones, and offline votes, checking preservation during the transition as well as afterward. Existing snapshots explicitly lacked several of those populations. Freeze the day-two starting artifact first; its three fixed requests do not exercise enum evolution or literal fill. (`llp/1020-day-two-evolution-and-legible-ceilings.rfc.md:254`; `issues/20260907-snapback2-quarry-gaps-from-the-m7-migration-legs.md:47`; `benchmarks/briefs/social-messenger.md:705`; `benchmarks/briefs/messaging-day2-evolution.md:29`.)

**Certificate truth and useful explanation.** Add admitted/refused pairs around each meter, mixed uniform/nonuniform reads, argument takes below the cap, and loop-growth families with maximum-width escaped values. Assert bound ≥ measured execution and agreement between analysis/refusal explanations. A default-template pass cannot prove that every remaining refusal is erroneous; the M7 ticket expressly says the `E_STEPS` receipts do not establish their cause. (`llp/1020-day-two-evolution-and-legible-ceilings.rfc.md:258`; `issues/20260907-snapback2-quarry-gaps-from-the-m7-migration-legs.md:63`.)

### 6. Alternatives

The strongest alternative is a smaller evolution increment: value-preserving compatibility and checked narrowing, exact projection ownership, executable recipes using existing jobs/rehearsal, and cost presentation extracted from the current analyzer. Keep existing runtime completeness and maintained-point lowering. This is the better next increment: the documented staged route has already completed a populated M7 retry, while this RFC has not established the additional benefit of transactional literal fill. `fill` can win later on measured edit cost once its installation budget and lifecycle semantics are complete. (`snapback2/packages/snapback2/guide/job.md:12`; `snapback2/packages/snapback2/guide/job.md:37`; `issues/20260907-snapback2-quarry-gaps-from-the-m7-migration-legs.md:66`; `llp/1018-structural-moves-to-surpass-convex.research.md:320`.)

### 7. Sequencing

After the five-lane program, prioritize the remaining certificate soundness repair, enum-preserving succession, and accurate successor diagnostics. Run the published loop bar and Clique cold rerun, including M7, before commissioning the whole fill tranche; the loop bar remains the stated product priority. LLP 1021’s bounded logging/test-control work can accompany that evidence gathering. LLP 1019 should wait until historical delivery custody has explicit successor semantics; it must not inherit aggregate rebuilding by analogy. Keep these proposals as proposals until commissioned and implemented. (`rules/NOT-DOING.md:13`; `llp/1018-structural-moves-to-surpass-convex.research.md:320`; `llp/1021-effects-in-the-loop.rfc.md:281`; `llp/1019-derived-delivery-custody.rfc.md:174`; `rules/RULES.md:58`.)

---

Delivery note: The session’s read-only filesystem policy prevented saving `/Users/ccheever/projects/snapback-el-20260908/reviews/rfc/1020-astra-max.md`. The complete review is printed above.