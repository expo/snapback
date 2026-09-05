# Review: LLP 1017 revision (a) — codex gpt-6-astra (xhigh), round 1

**Reviewer:** codex gpt-6-astra, reasoning xhigh, read-only sandbox, blind (no other review visible), launched 2026-09-05 ~09:45Z by Claude Fable 5.1 from `~/projects/snapback-1017-panel/launch.py`
**Reviewed:** `llp/1017-cap-and-complete-fanout.rfc.md` revision (a) overlaid on origin/main `6d3d09c6f`
**Brief:** `~/projects/snapback-1017-panel/brief-r1.md` (Q1–Q8)
**Verdict:** NOT READY (seven material concerns; §1 to land first only after its accounting repair)
**Received:** 2026-09-05 (raw output below, unedited except this header; the reviewer's file links point into the panel capsule)

---

VERDICT: NOT READY

## Material

1. **§1 can under-budget programs because the scan summary discards the cost of evaluating its own keys and bounds.**

   [certificate.rs:1110](/Users/ccheever/projects/snapback-1017-panel/repo/snapback2/crates/snapback2-core/src/certificate.rs:1110) accumulates prefix work: “`summary = summary.add(self.expr(value, calls, factors)?);`”. But [certificate.rs:1172](/Users/ccheever/projects/snapback-1017-panel/repo/snapback2/crates/snapback2-core/src/certificate.rs:1172) overwrites examined work with “`summary.examined = calls.saturating_mul(reserve);`”, and [certificate.rs:1175](/Users/ccheever/projects/snapback-1017-panel/repo/snapback2/crates/snapback2-core/src/certificate.rs:1175) overwrites steps with “`summary.steps = summary.examined.saturating_mul(5);`”.

   This matters when removing the existing step padding. A source-derived counterexample is a protected, uniform scan with `take = 1` and a prefix expression containing ten integer additions: the replacement certificate prices the returned scan at 17 steps, while its prefix alone has 21 expression nodes. Runtime evaluates those nodes: [runner.rs:994](/Users/ccheever/projects/snapback-1017-panel/repo/snapback2/crates/snapback2-core/src/engine/runner.rs:994), “`.map(|value| self.expr(value))`”; [runner.rs:403](/Users/ccheever/projects/snapback-1017-panel/repo/snapback2/crates/snapback2-core/src/engine/runner.rs:403), “`self.step(1)?;`”. Exceeding the smaller certificate actually refuses: [runner_ops.rs:1077](/Users/ccheever/projects/snapback-1017-panel/repo/snapback2/crates/snapback2-core/src/engine/runner_ops.rs:1077), “`return Err(RuntimeError::Steps(max_steps));`”.

   **Change:** compose a separate scan-local summary with the key/bound summary instead of overwriting it. Preserve all counters and range flags. Include complex-prefix and nested-read witnesses in §1’s landing; the two proposed constant-prefix fixtures do not establish safety.

2. **§1 confuses traced rows with fetched rows. The claimed physical reserve is false.**

   The fetch restriction is conditional on public visibility, not hoisting: [runner.rs:1094](/Users/ccheever/projects/snapback-1017-panel/repo/snapback2/crates/snapback2-core/src/engine/runner.rs:1094), “`let fetch_limit = if always_visible {`”; the protected branch at [runner.rs:1097](/Users/ccheever/projects/snapback-1017-panel/repo/snapback2/crates/snapback2-core/src/engine/runner.rs:1097) is simply “`candidate_limit`”. Only afterward does [runner.rs:1165](/Users/ccheever/projects/snapback-1017-panel/repo/snapback2/crates/snapback2-core/src/engine/runner.rs:1165) stop processing: “`if visible.len() >= visible_target {`”.

   This is eager fetching, not a lazy iterator: [engine/index.rs:211](/Users/ccheever/projects/snapback-1017-panel/repo/snapback2/crates/snapback2-core/src/engine/index.rs:211) puts “`LIMIT {limit}`” into SQL, and [engine/index.rs:221](/Users/ccheever/projects/snapback-1017-panel/repo/snapback2/crates/snapback2-core/src/engine/index.rs:221) ends with “`.collect()`”.

   Even after §1, two protected uniform calls with `take = 1` can have a six-row program reserve, fetch six rows on the first call and three on the second, but trace only six altogether. The preliminary true-verdict probe also rereads a candidate subsequently fetched by the main scan.

   **Change:** clamp protected uniform fetching too. Reuse the preliminary candidate, or explicitly account for its additional physical read. State whether the certificate counts distinct traced candidates or actual storage reads; stop claiming these are already identical. This requires a runtime change if §1 is to deliver its advertised cost model.

3. **§3’s restriction on page-domain loops is bypassable by an ordinary local binding.**

   Consider the proposed refusal applied to:

   ```q
   page = memberships[conversationId] first 50 by byConversationPrincipal
   for m in page:
     insert deliveries { … }
   ```

   A direct scan becomes `Page`: [compiler/src/lower/expr.ts:226](/Users/ccheever/projects/snapback-1017-panel/repo/snapback2/packages/compiler/src/lower/expr.ts:226), “`domain: { Page: lowerScan(call, env, hint ?? `${env.programName}.${reference.table}`) },`”. A bounded local instead becomes `DerivedArray`: [compiler/src/lower/expr.ts:270](/Users/ccheever/projects/snapback-1017-panel/repo/snapback2/packages/compiler/src/lower/expr.ts:270), “`domain: { DerivedArray: {`”, with [line 271](/Users/ccheever/projects/snapback-1017-panel/repo/snapback2/packages/compiler/src/lower/expr.ts:271), “`value: { Variable: identifier },`”.

   The existing completeness flow supplies no protection for a uniform truncated page: [certificate_policy.rs:300](/Users/ccheever/projects/snapback-1017-panel/repo/snapback2/crates/snapback2-core/src/certificate_policy.rs:300), “`if uniform_visibility(self.schema, scan) {`”, followed by “`return Fact::default();`” at line 301. The derived-array guard merely checks the already-truncated array’s length: [runner.rs:341](/Users/ccheever/projects/snapback-1017-panel/repo/snapback2/crates/snapback2-core/src/engine/runner.rs:341), “`if values.len() > *max as usize {`”.

   **Change:** track population completeness separately from authorization uniformity through bindings, shapes, derived arrays, and merges. Enforce the rule on page-derived populations, regardless of their final IR domain. A merge also needs a union-level proof: complete individual lanes do not prove that taking fifty from their union covers that union.

4. **A cap does not guarantee that the loop receives its complete group when another scan can consume the shared budget.**

   [runner.rs:1077](/Users/ccheever/projects/snapback-1017-panel/repo/snapback2/crates/snapback2-core/src/engine/runner.rs:1077) computes “`let remaining_examined = certificate.max_examined.saturating_sub(self.trace.examined);`”. A non-uniform scan can consume that entire budget before an otherwise admissible capped, uniform loop executes. Its result can be bound to an unused local; the current flow merely stores that fact at [certificate_policy.rs:148](/Users/ccheever/projects/snapback-1017-panel/repo/snapback2/crates/snapback2-core/src/certificate_policy.rs:148): “`self.env.insert(name.clone(), fact);`”.

   The later loop then receives zero candidates. Spending exactly the budget passes [runner_ops.rs:1110](/Users/ccheever/projects/snapback-1017-panel/repo/snapback2/crates/snapback2-core/src/engine/runner_ops.rs:1110): “`if self.trace.examined > certificate.max_examined {`”. Mutation state does not incorporate the range’s stop reason: [engine/mod.rs:708](/Users/ccheever/projects/snapback-1017-panel/repo/snapback2/crates/snapback2-core/src/engine/mod.rs:708), “`(false, ProgramKind::Mutation) => ExecutionState::Committed { seq },`”.

   **Change:** complete-by-cap admission must protect the resources needed to realize that proof, or execution must reject atomically when a supposedly complete population loop is budget-cut. Existing stop information can support a conservative guard. No extra population probe is necessary. General per-site budgeting may remain deferred; this correctness obligation cannot.

5. **Form (b) is a syntactic escape hatch, not evidence of a continuation. Remove it from this RFC.**

   An optional cursor can always be omitted: [runner.rs:1001](/Users/ccheever/projects/snapback-1017-panel/repo/snapback2/crates/snapback2-core/src/engine/runner.rs:1001), “`if after == Some(Value::Null) && scan.opaque_cursor {`”, followed by “`after = None;`”. Thus adding `c: cursor ?` and `after c` admits the original silent first-page mutation without requiring anybody to continue it.

   Moreover, mutations do not mint their execution’s continuation: [engine/mod.rs:1278](/Users/ccheever/projects/snapback-1017-panel/repo/snapback2/crates/snapback2-core/src/engine/mod.rs:1278), “`if !matches!(state, ExecutionState::Capped) {`”, followed by “`return Ok(None);`”. Their successful state is `Committed`, as quoted above. A query’s cursor is not a certificate of the rows a separate mutation subsequently processed.

   Form (b) also lacks a uniformity condition, while existing policy refuses non-uniform loop-dependent writes: [certificate_policy.rs:217](/Users/ccheever/projects/snapback-1017-panel/repo/snapback2/crates/snapback2-core/src/certificate_policy.rs:217), “`self.refuse_sink("inserted value", &fact.structural, control, loop_pages);`”. Therefore the proposed “if and only if” is not even consistent with retaining that policy unchanged.

   **Change:** refuse uncapped population mutation loops until the explicitly represented continuation exists. LLP 1016 D1 supplies the missing distinction: [1016:190](/Users/ccheever/projects/snapback-1017-panel/repo/llp/1016-administrative-plane.rfc.md:190), “**The cursor commits with the chunk.**” Its criticism at [1016:218](/Users/ccheever/projects/snapback-1017-panel/repo/llp/1016-administrative-plane.rfc.md:218)—“mechanism with the cursor smuggled through arguments and no certificate”—applies directly here.

6. **The grouping semantics omit valid optional-column values. “Engine semantics unchanged” is insufficient.**

   Omission is a valid optional value: [engine/index.rs:487](/Users/ccheever/projects/snapback-1017-panel/repo/snapback2/crates/snapback2-core/src/engine/index.rs:487), “`(ColumnType::Optional(_), None | Some(Value::Null)) => true,`”. Index grouping normalizes omission to null: [engine/index.rs:377](/Users/ccheever/projects/snapback-1017-panel/repo/snapback2/crates/snapback2-core/src/engine/index.rs:377), “`.map(|column| row.field(column).cloned().unwrap_or(Value::Null))`”.

   The cap does not: [runner_ops.rs:472](/Users/ccheever/projects/snapback-1017-panel/repo/snapback2/crates/snapback2-core/src/engine/runner_ops.rs:472), “`.map(|field| new.field(field).cloned())`”. A valid insert omitting an optional grouping column therefore encounters a field error instead of participating in the null group. The twin already normalizes insertion images: [evaluator/src/runner.ts:581](/Users/ccheever/projects/snapback-1017-panel/repo/snapback2/packages/evaluator/src/runner.ts:581), “`row = materializeOptionalFields(this.schema, table, row);`”.

   **Change:** specify one canonical grouping-key operation for enforcement, group-moving comparisons, and successor counting. Omitted optional fields and explicit null must denote the same group. Normalize the Rust images or extract validated optional keys accordingly, and cover this in parity evidence.

7. **Successor validation must run when grouping semantics change, even if the cap declaration does not.**

   A type-change migration deletes the old values: [successor.rs:487](/Users/ccheever/projects/snapback-1017-panel/repo/snapback2/crates/snapback2-core/src/successor.rs:487), “`| Drop::TypeChange {`”, reaches [successor.rs:493](/Users/ccheever/projects/snapback-1017-panel/repo/snapback2/crates/snapback2-core/src/successor.rs:493), “`drop_column_values(transaction, table, name)?;`”. Admission occurs afterward: [registry.rs:888](/Users/ccheever/projects/snapback-1017-panel/repo/snapback2/crates/snapback2-core/src/registry.rs:888), “`apply_migration_drops(&transaction, &mut reduced, migration, released_at)?;`”, then [line 889](/Users/ccheever/projects/snapback-1017-panel/repo/snapback2/crates/snapback2-core/src/registry.rs:889), “`if let Some(refusal) = additive_refusal(&transaction, &reduced, &next.schema)? {`”.

   Counterexample: two rows in different groups satisfy `cap 1 by group`. Retype `group` to an optional scalar through the existing destructive migration. Dropping its values combines both rows into the null group, although neither `by` nor `N` changed. Checking only newly added or lowered caps misses this.

   **Change:** validate affected caps against the post-transformation data whenever grouping columns or their interpretation change. Checking all successor caps is the simpler safe initial implementation. “Raising a cap is additive” must be conditional on no accompanying transformation invalidating it.

## Minor

1. **Finish the schema-validation contract.** Require nonempty, distinct, indexable grouping columns and a literal within the wire representation’s range; [schema.rs:360](/Users/ccheever/projects/snapback-1017-panel/repo/snapback2/crates/snapback2-core/src/schema.rs:360) declares “`max: u32,`”. Validate caps during schema admission even when no program writes the table. Also record the selected enforcement index in certificate index custody; the existing explicit constraint-index handling illustrates that obligation at [certificate.rs:426](/Users/ccheever/projects/snapback-1017-panel/repo/snapback2/crates/snapback2-core/src/certificate.rs:426): “`indexes_required.insert(format!("{table}.{index}"));`”.

2. **Make diagnostic rewrites executable and reason-specific.** The template has both [schema.q:35](/Users/ccheever/projects/snapback-1017-panel/repo/snapback2/packages/snapback2/templates/chat/snapback/schema.q:35), “`unique byConversationPrincipal: conversationId, principal`”, and [schema.q:36](/Users/ccheever/projects/snapback-1017-panel/repo/snapback2/packages/snapback2/templates/chat/snapback/schema.q:36), “`by byConversationPrincipalRole: conversationId, principal, role`”. The proposed cursor rewrite omits the disambiguating index. Selection explicitly refuses multiple candidates at [catalog.ts:182](/Users/ccheever/projects/snapback-1017-panel/repo/snapback2/packages/compiler/src/quarry/catalog.ts:182): “`if (candidates.length > 1) ambiguous(`”. A non-uniform-rule refusal needs the authorization-prefix repair, not merely another cap declaration.

3. **Document the new seed admission limit.** [registry.rs:1048](/Users/ccheever/projects/snapback-1017-panel/repo/snapback2/crates/snapback2-core/src/registry.rs:1048) overrides only “`write_rows: u64::MAX,`”; [line 1049](/Users/ccheever/projects/snapback-1017-panel/repo/snapback2/crates/snapback2-core/src/registry.rs:1049) retains “`..Ceilings::default()`”. With the proposed reservation, 205 upserts into a table capped at fifty reserve 10,250 examined rows, even across valid separate groups, exceeding [certificate.rs:34](/Users/ccheever/projects/snapback-1017-panel/repo/snapback2/crates/snapback2-core/src/certificate.rs:34), “`examined: 10_240,`”. Such a seed fails certification before any cap violation can produce `E_CONSTRAINT`. That is a defensible limit, but the guide should say so.

4. **Narrow “covers the group” to the selected population and distinguish explicit control flow.** A stronger prefix selects a subgroup; an explicit return can stop iteration. [runner.rs:260](/Users/ccheever/projects/snapback-1017-panel/repo/snapback2/crates/snapback2-core/src/engine/runner.rs:260) handles “`returned @ Flow::Return(..) => {`” and then breaks. Likewise, walks do not reject merely because the graph extends past their depth: [runner.rs:366](/Users/ccheever/projects/snapback-1017-panel/repo/snapback2/crates/snapback2-core/src/engine/runner.rs:366), “`if depth > recurse.depth || !visited.insert(canonical_json(&key)) {`”, followed by “`continue;`”. Leaving those explicitly bounded traversals alone is reasonable; describing them all as overflow-refusing is not.

## Facts

1. **§0’s hoisted-runtime row and §1’s “runtime never spent more than the reserve” are false as storage-work claims.** The protected branch uses the shared `candidate_limit`, not `take + 2`: [runner.rs:1097](/Users/ccheever/projects/snapback-1017-panel/repo/snapback2/crates/snapback2-core/src/engine/runner.rs:1097), “`candidate_limit`”. The later trace counts only processed candidates: [runner.rs:1199](/Users/ccheever/projects/snapback-1017-panel/repo/snapback2/crates/snapback2-core/src/engine/runner.rs:1199), “`self.trace.examined += examined_rows.len() as u64;`”. See Material 2.

2. **§1’s summary description omits overwritten key/bound work, and its “only observable effect” assertion is wrong.** See Material 1. The printed certificate is also an execution limit: [runner_ops.rs:1075](/Users/ccheever/projects/snapback-1017-panel/repo/snapback2/crates/snapback2-core/src/engine/runner_ops.rs:1075), “`&& self.trace.steps > max_steps`”, followed by the runtime refusal.

3. **The nineteen-certificate inventory is stale at `6d3d09c6f`.** Read-only inspection finds eighteen corpus files containing the exact quoted line below. Recompute the affected subset rather than promising nineteen changes.

   | Evidence: `path:line` | Quoted line |
   |---|---|
   | `snapback2/corpus/cursor-desc-before-two-pages.json:1134` | `"max_examined": 10240,` |
   | `snapback2/corpus/named-inbox-maintained.json:1139` | `"max_examined": 10240,` |
   | `snapback2/corpus/scenario-delete-first.json:1204` | `"max_examined": 10240,` |
   | `snapback2/corpus/scenario-delete-second.json:1204` | `"max_examined": 10240,` |
   | `snapback2/corpus/scenario-range-update-halo.json:1204` | `"max_examined": 10240,` |
   | `snapback2/corpus/named-send-maintained-unread.json:1277` | `"max_examined": 10240,` |
   | `snapback2/corpus/scenario-hydrate.json:1204` | `"max_examined": 10240,` |
   | `snapback2/corpus/cursor-asc-after-duplicate-tie.json:1121` | `"max_examined": 10240,` |
   | `snapback2/corpus/scenario-first-mention.json:1204` | `"max_examined": 10240,` |
   | `snapback2/corpus/scenario-local-send.json:1204` | `"max_examined": 10240,` |
   | `snapback2/corpus/cursor-asc-before-two-pages.json:1134` | `"max_examined": 10240,` |
   | `snapback2/corpus/opaque-cursor-empty-capped-next-null.json:204` | `"max_examined": 10240,` |
   | `snapback2/corpus/scenario-revocation-rehydrate.json:1204` | `"max_examined": 10240,` |
   | `snapback2/corpus/named-inbox-count-capped.json:1169` | `"max_examined": 10240,` |
   | `snapback2/corpus/cursor-desc-after-two-pages.json:1121` | `"max_examined": 10240,` |
   | `snapback2/corpus/edge-has-more-at-bound.json:1204` | `"max_examined": 10240,` |
   | `snapback2/corpus/named-thread.json:1204` | `"max_examined": 10240,` |
   | `snapback2/corpus/named-inbox-maintained-complete.json:1093` | `"max_examined": 10240,` |

## Answers

**Q1.** A uniform range’s own traced candidates are bounded by `take + 2`; physical fetching is not, and shrinking the certificate can under-budget expression work—Materials 1–2 establish both distinctions. Ordinary repeated-call accounting multiplies the body by its domain bound at [certificate.rs:925](/Users/ccheever/projects/snapback-1017-panel/repo/snapback2/crates/snapback2-core/src/certificate.rs:925), “`calls.saturating_mul(bound),`”; merge lanes remain separately scanned, as [quarry/program.ts:665](/Users/ccheever/projects/snapback-1017-panel/repo/snapback2/packages/compiler/src/quarry/program.ts:665) says “`for (const lane of expr.lanes) {`”. Cursor bounds are SQL predicates rather than offset drains ([engine/index.rs:158](/Users/ccheever/projects/snapback-1017-panel/repo/snapback2/crates/snapback2-core/src/engine/index.rs:158): “`if order == Order::Asc { ">" } else { "<" },`”); walks use geometric point-read accounting ([certificate.rs:1001](/Users/ccheever/projects/snapback-1017-panel/repo/snapback2/crates/snapback2-core/src/certificate.rs:1001): “`let nodes = geometric_sum(u64::from(recurse.fanout), recurse.depth);`”). The uniform-false single determination is safe; deleting `visibility_filtered_range` has no missed external reader in this checkout—the three synthesis readers and the field/setter/two merges identified by the RFC are its complete uses—but that does not establish the safety of the smaller budgets.

**Q2.** Keep **`cap N by columns`**: the invariant concerns grouping, and should survive an index rename. The prefix-index satisfaction relation matches enforcement exactly: [runner_ops.rs:492](/Users/ccheever/projects/snapback-1017-panel/repo/snapback2/crates/snapback2-core/src/engine/runner_ops.rs:492), “`.find(|(_, index)| index.columns.starts_with(by))`”; therefore the template’s composite unique index satisfies its conversation cap. Multiple different grouping caps are useful; any applicable cap may supply the completeness bound. For completeness inference, requiring the scan index itself to start with the cap tuple is sufficient but unnecessarily strict: pinning every grouping column also proves containment when those columns occur elsewhere within the pinned prefix.

**Q3.** Inclusive `N`, destination-group checks, and reserving `N` per potentially group-entering write are correct: [runner_ops.rs:475](/Users/ccheever/projects/snapback-1017-panel/repo/snapback2/crates/snapback2-core/src/engine/runner_ops.rs:475), “`Effect::Insert => true,`”; [line 482](/Users/ccheever/projects/snapback-1017-panel/repo/snapback2/crates/snapback2-core/src/engine/runner_ops.rs:482), “`old_prefix != prefix`”; [line 518](/Users/ccheever/projects/snapback-1017-panel/repo/snapback2/crates/snapback2-core/src/engine/runner_ops.rs:518), “`if rows.len() >= *max as usize {`”. Seeds really reach that insert check: [registry.rs:1036](/Users/ccheever/projects/snapback-1017-panel/repo/snapback2/crates/snapback2-core/src/registry.rs:1036) constructs “`Ok(Stmt::Upsert {`”; the absent branch calls “`self.insert(table, row)`” at [runner_ops.rs:84](/Users/ccheever/projects/snapback-1017-panel/repo/snapback2/crates/snapback2-core/src/engine/runner_ops.rs:84), which invokes “`self.check_constraints(table, None, &row, Effect::Insert)?;`” at [line 23](/Users/ccheever/projects/snapback-1017-panel/repo/snapback2/crates/snapback2-core/src/engine/runner_ops.rs:23). The missing pieces are Materials 4, 6–7 and the schema/index-custody and seed-limit notes; charge actual reads even on the refusing cap check. The twin’s current behavior is more precise than “predict or learn rejection”: it rejects a known full group and marks insufficient coverage partial—[evaluator/runner.ts:778](/Users/ccheever/projects/snapback-1017-panel/repo/snapback2/packages/evaluator/src/runner.ts:778), “`throw new EvalError("E_CONSTRAINT", `${tableName} cap reached`);`”, and [line 780](/Users/ccheever/projects/snapback-1017-panel/repo/snapback2/packages/evaluator/src/runner.ts:780), “`this.partial.add(`${tableName}.${entry[0]}`);`”.

**Q4.** Form (a) is a useful sufficient cardinality proof, but it needs provenance preservation and resource availability; form (b) should be removed for the reasons in Material 5. Rejecting argument maxima without a proven lower bound is reasonable, and “read-only” cannot exempt `require`: [certificate_policy.rs:212](/Users/ccheever/projects/snapback-1017-panel/repo/snapback2/crates/snapback2-core/src/certificate_policy.rs:212) explicitly calls “`self.refuse_sink("require branch", &fact.structural, control, loop_pages);`”. A mutation can receive and echo a query’s cursor, but cannot obtain a newly minted continuation for its own processed page: [engine/mod.rs:1278](/Users/ccheever/projects/snapback-1017-panel/repo/snapback2/crates/snapback2-core/src/engine/mod.rs:1278) restricts minting to “`ExecutionState::Capped`”. Until J3, an uncapped population mutation loop should refuse; accepting bounded caller-supplied row IDs remains a different, explicit finite-input contract.

**Q5.** **Use the new code.** Existing `E_STRUCTURAL_COUNT` states a privacy rule—[diagnostics.ts:154](/Users/ccheever/projects/snapback-1017-panel/repo/snapback2/packages/compiler/src/diagnostics.ts:154), “`E_STRUCTURAL_COUNT: "rules do not leak hidden population structure",`”—whereas a public population can still be silently truncated. Family `bound` and page `bound/loop` fit; change the rule text to “a mutation population loop covers its selected range,” and fix the rewrites described above. Keep authoritative admission in Rust: [certificate.rs:204](/Users/ccheever/projects/snapback-1017-panel/repo/snapback2/crates/snapback2-core/src/certificate.rs:204), “`let mut errors = self.structural_errors(program);`”; the frontend should preserve source locations and useful provenance, not become an alternate enforcement boundary.

**Q6.** Keep the three explicit uses of fifty for this slice: schema invariant, friendly application refusal, and execution bound serve different purposes. LLP 1007 is unusually explicit at [1007:325](/Users/ccheever/projects/snapback-1017-panel/repo/llp/1007-state-of-snapback2-and-the-work.plan.md:325): “**bounds are punctuation** (`first 50` cannot be omitted)”. Raising the small guide budgets is preferable to obscuring this invariant through compression; the current limits are exactly [build.mjs:185](/Users/ccheever/projects/snapback-1017-panel/repo/snapback2/packages/snapback2/build.mjs:185), “`limit: name === "grammar" ? 2304 : name === "quarry" ? 14336 : 4096,`”. Bound inference could be reconsidered separately, without making this correctness fix depend on another language change.

**Q7.** Keep `else CODE` and maintained-count optimization out: the former duplicates the existing application-level refusal, and the latter is an optimization once bounded scanning is correctly accounted for. The application code already has [groups.q:16](/Users/ccheever/projects/snapback-1017-panel/repo/snapback2/packages/snapback2/templates/chat/snapback/groups.q:16), “`require #memberCounts[conversationId] < 50 else GROUP_FULL`”. Do not add a population-disclosing one-more-row probe, but **do** include uniform fetch limiting and an atomic response to budget-cut complete loops: the runtime already computes [runner.rs:1197](/Users/ccheever/projects/snapback-1017-panel/repo/snapback2/crates/snapback2-core/src/engine/runner.rs:1197), “`StopReason::Limit`”. General per-site budgets can remain deferred only if that existing shared-budget behavior cannot silently defeat the new guarantee.

**Q8.** The bounded-cap design composes with LLP 1016; the cursor exception contradicts its stated reason for representing continuations explicitly, and §3’s policy will need an explicit job-chunk admission case when 1016 arrives. Landing correctness fixes for the existing chat recipe before the loop bar is defensible under [NOT-DOING.md:17](/Users/ccheever/projects/snapback-1017-panel/repo/rules/NOT-DOING.md:17), “Everything not required by this bar does not exist yet”; building a makeshift administrative continuation is not necessary to fix that recipe. LLP 1016 itself cannot impose an implementation gate merely by being proposed: [RULES.md:58](/Users/ccheever/projects/snapback-1017-panel/repo/rules/RULES.md:58), “**Only implemented specs bind.**” A **repaired** §1 should land independently and first; §1 as written should not.

I would tell the author: keep the cap spelling and the bounded chat fix, but withdraw the “one-line accounting correction” and “cursor means continuation” claims. Repair the actual accounting, carry completeness through ordinary bindings, and make budget exhaustion reject rather than silently skip the fan-out. Then this becomes a sound, focused change.