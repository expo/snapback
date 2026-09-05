# Code review: LLP 1017 §2–§4 implementation, candidate `96ca9189c` on base `f40559f37` — codex gpt-6-astra (xhigh), round 1

**Reviewer:** codex gpt-6-astra, reasoning xhigh, read-only sandbox, blind (no other review visible), launched 2026-09-05 ~12:15Z by Claude Fable 5.1 from `~/projects/snapback-1017-panel/launch-review.py f40559f37 96ca9189c 1` (capsule: a detached worktree at the candidate with `REVIEW-TARGET.md`)
**Brief:** `~/projects/snapback-1017-panel/brief-code-review.md`
**Verdict:** NOT READY — cap enforcement, grouping key, migration order, seed path, template, and guide confirmed; four P1 soundness holes in the completeness check (ArgList bypass, control-flow/binding-lifetime mismatch, self-resetting collector, a non-uniform scan spending the cap probe's reserve), three P2 defects, coverage gaps. Fixed in lane CAP3; RFC revision (d) records the two rules the P1s forced.
**Received:** 2026-09-05 (raw output below, unedited except this header; file links point into the review capsule)

---

VERDICT: NOT READY

The cap enforcement is mostly sound. The population-loop proof is not: I reproduced four checker admissions that invalidate its provenance claim, plus an admitted program whose cap probe can exceed its certificate.

Read-only throughout. Supplemental checks used existing binaries from the implementation lane; its core and compiler source trees match the candidate. The nine cap tests, refusing-probe test, and 182-case certification replay pass. I did not perform a fresh build.

## Defects

1. **P1 — `ArgList` bypasses page provenance entirely.**

   `snapback2/crates/snapback2-core/src/certificate_policy/fanout.rs:158`:
   > `_ => Origin::Other,`

   Only `Page` and `DerivedArray` domains are resolved. Runtime `ArgList` reads the mutable environment, however: `snapback2/crates/snapback2-core/src/engine/runner.rs:329`:
   > `.get(name)`

   **Failing input:** Take `fanout-refused-binding-uncapped`, retain `Let page = Scan(...)`, and replace its loop domain with:
   ```json
   {"ArgList":{"name":"page","max":50}}
   ```
   The checker admits it with `complete: false`. With 51 memberships, the scan supplies 50 and the mutation processes those 50. Calling the domain `ArgList` does not make its contents an argument.

   **Fix:** Resolve `ArgList.name` through the same environment. Exempt actual argument-list origins, not the IR tag.

2. **P1 — Provenance transfer disagrees with runtime control flow and binding lifetime.**

   `snapback2/crates/snapback2-core/src/certificate_policy/fanout.rs:218`:
   > `_ => {}`

   This ignores `Break`/`Continue`/`Return` and continues processing later assignments. Runtime stops processing that statement sequence at `snapback2/crates/snapback2-core/src/engine/runner.rs:308`:
   > `if !matches!(flow, Flow::Next) {`

   **Failing input, expressed using IR statement names:**
   ```text
   Let page = []
   For i in LiteralRange(0, 1):
       Assign page = uncapped_scan_take_50
       Break
       Assign page = []
   For m in DerivedArray(page, max=50):
       Insert delivery(m)
   ```
   The checker admits this with `complete: false`. Runtime retains the scanned page; the unreachable reset erased its origin only in the checker.

   A second mismatch is `snapback2/crates/snapback2-core/src/certificate_policy/fanout.rs:213`:
   > `self.env.insert(binding.clone(), old.clone());`

   The checker restores the previous loop binding. Runtime assigns loop bindings at `snapback2/crates/snapback2-core/src/engine/runner.rs:254`:
   > `self.env.insert(binding.clone(), tracked.value);`

   Runtime has no corresponding restoration. Change the outer loop above to bind `page`, assign the scan to `page` inside it, and omit the break/reset. That also certifies with `complete: false`, while runtime retains the page.

   **Fix:** Model normal, break, continue, and return exits separately, and make post-loop bindings agree with the interpreter. Join the zero-iteration path with actual exits.

3. **P1 — A collector that resets itself is certified as a complete row shape.**

   `snapback2/crates/snapback2-core/src/certificate_policy/fanout.rs:401`:
   > `Stmt::Const { .. } | Stmt::Let { .. } => {}`

   `shape_target` permits arbitrary declarations, including redeclaring the destination. The resulting origin is then overwritten at line 210:
   > `self.env.insert(target.to_owned(), origin.clone());`

   **Failing input:** Starting from `fanout-complete-shape`, prepend this to its shaping loop body:
   ```json
   {"Let":{"name":"shaped","value":{"Array":[]}}}
   ```
   The checker still admits it with `complete: true`. Runtime `Let` replaces the environment value—`snapback2/crates/snapback2-core/src/engine/runner.rs:182`:
   > `self.env.insert(name.clone(), tracked.value);`

   With three memberships, the collector retains only the last row, so the final delivery loop processes one row. This is a population transformation, not a one-to-one shape.

   **Fix:** Prove that the destination is initialized once and receives exactly one unconditional push per iteration, with no redeclaration or other mutation.

4. **P1 — A preceding non-uniform scan can spend the cap probe’s reserve.**

   The new reserve is added at `snapback2/crates/snapback2-core/src/certificate.rs:1308`:
   > `summary.examined = summary.examined.saturating_add(cap_rows);`

   But the non-uniform substitution at line 299 returns:
   > `self.ceilings.examined`

   Runtime gives the scan all remaining examined capacity at `snapback2/crates/snapback2-core/src/engine/runner.rs:1077`:
   > `let remaining_examined = certificate.max_examined.saturating_sub(self.trace.examined);`

   **Failing scenario:** A mutation binds an unused, non-uniform scan of `other`, then inserts into a `cap 50` membership group containing 49 rows. Give `other` at least 10,240 hidden candidates, with an unpinned `.principal = viewer` rule. This program certifies with `max_examined = 10240`; it has no population loop, so the fanout policy does not refuse it.

   The scan spends 10,240. The cap probe then adds 49 at `snapback2/crates/snapback2-core/src/engine/runner_ops.rs:502`:
   > `self.trace.examined += rows.len() as u64;`

   The otherwise valid insert fails the assertion at line 1103:
   > `if self.trace.examined > certificate.max_examined {`

   Result: `E_TRACE_SUBSET`, with 10,289 examined against 10,240. I reproduced certification; the runtime consequence follows these accounting paths.

   **Fix:** Keep mandatory cap-probe capacity unavailable to preceding non-uniform scans, and enforce the combined ceiling during certification.

5. **P2 — Quarry refuses caps containing the implicit `id` column.**

   `snapback2/packages/compiler/src/quarry/catalog.ts:31`:
   > `const column = columns.get(name);`

   That map contains authored columns only. The same file explicitly recognizes implicit `id` for indexes at line 23:
   > `if (column !== "id" && !columns.has(column)) refuse(index.site, ...`

   **Failing input:**
   ```q
   table things:
     label: text <=20
     public
     cap 1 by id
   ```
   Actual result: `E_QUARRY_UNKNOWN`, “things cap names unknown column id; did you mean label?” A tuple containing `id` fails too.

   This contradicts the documented schema surface: `snapback2/packages/snapback2/guide/quarry.md:64`:
   > `Tables get `id` and `byId` implicitly.`

   **Fix:** Recognize implicit `id` as an indexable cap column, consistently with index validation and Rust schema admission.

6. **P2 — Non-uniform repairs fabricate unbound variables.**

   `snapback2/crates/snapback2-core/src/certificate_policy/fanout_repair.rs:44`:
   > `.push(pinned_value(&table.rules.read, &field).unwrap_or(Expr::Variable(field)));`

   `pinned_value` handles equality to viewer/literals, not general rules.

   **Failing scenario:** Change the fixture’s membership rule to `.principal != viewer`, retaining a mutation whose only argument is `conversationId`. The repair emits:
   ```q
   by byConversationPrincipalScoped: conversationId, principal, id
   for m in memberships[conversationId, principal] first 50 by byConversationPrincipalScoped:
   ```
   Pasting it produces `E_QUARRY_UNKNOWN: unknown name principal`. I reproduced that frontend refusal. Rules using `exists` with unpinned row fields have the same unsupported fallback.

   **Fix:** Never invent an in-scope expression from a column name. Supply all required binding/schema/rule changes when a concrete repair exists; otherwise give an honest scope-denormalization direction instead of a purported executable scan. Test inequality and existence rules.

7. **P2 — The shipped diagnostic’s “Right” example does not parse as Quarry.**

   `snapback2/packages/snapback2/guide/families.source.json:468`:
   > `"right": "cap 50 by conversationId  // on memberships; the loop now covers the group"`

   Quarry comments use `--`; `snapback2/packages/compiler/src/quarry/lexer.ts:53`:
   > `if (char === "-" && raw[offset + 1] === "-") break;`

   The guide also renders this Quarry line as TypeScript because `snapback2/crates/snapback2/src/guide.rs:252` says:
   > `let language = if family == "quarry" { "q" } else { "ts" };`

   **Failing scenario:** Paste the displayed “Right” line into the fixture’s membership table. The `//` suffix is not a Quarry comment.

   **Fix:** Use a Quarry fence and `--`, or remove the commentary from the pasted line. Compile the actual generated guide example.

## Spec drift

- **Five versus seven loops:** `llp/1017-cap-and-complete-fanout.rfc.md:471` says:
  > `- The five loops keep `first 50`.`

  The implementation correctly preserves the seven-loop census described at spec line 438:
  > `Seven loops on origin/main, all `for m in memberships[…] first 50 by`

  Amend §4’s count.

- **A cap refusal supplies repair advice, not an actionable migration plan.** The guide says at `snapback2/packages/snapback2/guide/quarry.md:70`:
  > `that would leave a group over N refuses with a plan.`

  Actual cap refusals use `snapback2/crates/snapback2-core/src/successor/caps.rs:74`:
  > `plan: MigrationPlan::default(),`

  The useful repair is line 72:
  > `"raise the cap to at least {largest}, or remove rows from the group, then retry"`

  That is appropriate: resolving excess population requires a cap or data decision, not an invented destructive schema-drop plan. Amend the “with a plan” wording.

## Coverage

- **The twin’s fanout-refusal checks are vacuous.** `snapback2/packages/evaluator/src/evaluator.ts:58` reads the expected answer:
  > `const serverFanoutRefusal = testCase.category === "fanout" && testCase.expected.errorCode === "E_STRUCTURAL_FANOUT";`

  Line 59 then returns that code. These cases provide no independent evaluator admission evidence. Rust does rerun certification, but `snapback2/crates/snapback2-core/tests/spike.rs:1337` accepts any matching code:
  > `.any(|(_, error)| Some(error.code.as_str()) == expected) => {}`

- **The known-binding pasted-repair test applies a no-op to a different program.** `snapback2/packages/compiler/src/quarry-fanout-checks.ts:118` asserts:
  > `assert(cut?.code === "E_STRUCTURAL_FANOUT" && cut.rewrite === head, ...`

  Line 119 tests:
  > `source: direct.replace(head, cut.rewrite)`

  Given the preceding assertion, this is the already-valid `direct` source. It does not prove that editing the original transformed-binding fixture repairs it.

- **No boundary-sized complete-fanout witness.** The four admitted corpus variants seed only three rows: `snapback2/crates/snapback2-core/src/bin/export_corpus/cap_cases.rs:120`:
  > `for n in 0..3 {`

  Their assertion at line 130 is:
  > `assert_eq!(engine.rows("deliveries").unwrap().len(), 3);`

  Add an actual 50-row group and prove all 50 effects.

- **Missing targeted cases:** reordered pinned columns, `before`, key ranges, multiple simultaneous caps, destination-full group moves, cap-free deletes, same-group seed re-upserts, and capped effect `then` writes. The update test explicitly covers only omission-to-null without a group move: `snapback2/crates/snapback2-core/tests/cap.rs:138`:
  > `fn omitted_optional_cap_key_is_null_and_same_group_updates_do_not_probe() {`

  The corpus cursor case sets only `after`, at `snapback2/crates/snapback2-core/src/bin/export_corpus/cap_cases.rs:200`:
  > `scan.after = Some(Box::new(var("c")));`

- **The merge corpus case is only a tagged scan.** `snapback2/crates/snapback2-core/src/bin/export_corpus/cap_cases.rs:204`:
  > `scan.merge_site = Some("union".into());`

  The actual Quarry merge fixture does test lowering/refusal, but not a pasted repair: `snapback2/packages/compiler/src/quarry-fanout-checks.ts:131` checks:
  > `e.rewrite.includes("not yet available")`

- **No frozen Quarry-lowered cap case.** The new cap corpus builds its schema in Rust: `snapback2/crates/snapback2-core/src/bin/export_corpus/cap_cases.rs:301`:
  > `fn schema(max: u32) -> Schema {`

  Quarry lowering is tested separately, which is useful, but does not supply the frozen lowered-from-Quarry case enumerated in spec §5.

## Minor

- Two touched files have only 15 lines of headroom: `snapback2/crates/snapback2-core/src/engine/mod.rs:1485` ends with:
  > `use runner::{Flow, Runner};`

  `snapback2/crates/snapback2-core/src/registry.rs:1485` ends with:
  > `}`

- Fanout analysis runs twice on successful certification. `snapback2/crates/snapback2-core/src/certificate_policy.rs:117` calls:
  > `errors.extend(fanout::check(self.schema, program).0);`

  `snapback2/crates/snapback2-core/src/certificate.rs:209` calls it again:
  > `let (_, complete) = crate::certificate_policy::fanout::check(self.schema, program);`

  Reuse the result, especially because it includes loop fixed-point analysis.

- Source mapping depends on parsing diagnostic prose. `snapback2/crates/snapback2/src/project.rs:240`:
  > `.split(" at ")`

  Carry the structured loop site instead of making wording part of the source-map protocol.

## Checks

**(a) Seed path: yes.**

- `snapback2/crates/snapback2-core/src/registry.rs:805`:
  > `let (program, certificate) = seed_program(&self.generation.schema, rows)?;`
- Its statements are upserts, line 1037:
  > `Ok(Stmt::Upsert {`
- Missing rows reach insert at `snapback2/crates/snapback2-core/src/engine/runner_ops.rs:84`:
  > `self.insert(table, row)`
- Insert checks constraints at line 23:
  > `self.check_constraints(table, None, &row, Effect::Insert)?;`
- Seed bypass is confined to `check_rule`, line 679:
  > `if self.context.seed_write {`

The additional exemptions are exactly `examined`, `index_entries`, and `steps`: `registry.rs:1051–1053` contains `examined: u64::MAX,`, `index_entries: u64::MAX,`, and `steps: u64::MAX,`. Existing `write_rows` remains exempt; line 1054 retains `..Ceilings::default()`.

The product witness is `snapback2/crates/snapback2/tests/owner_cases/cap.rs:29`:
> `fn chat_seed_205_memberships_applies_and_reset_51_in_one_group_refuses_atomically() {`

The explicitly excluded raw writer remains `engine/mod.rs:278`:
> `"INSERT OR REPLACE INTO rows(table_name, row_id, data) VALUES (?1, ?2, ?3)",`

**(b) One grouping key: yes, for the three Rust paths.**

`snapback2/crates/snapback2-core/src/cap.rs:11`:
> `.map(|field| row.field(field).cloned().unwrap_or(Value::Null))`

Enforcement uses it at `engine/runner_ops.rs:470`:
> `let prefix = crate::cap::group_key(new, by);`

Group moves use it at line 475:
> `let old_prefix = crate::cap::group_key(old, by);`

Successor counting uses it at `successor/caps.rs:38`:
> `let key = crate::cap::group_key(row, by);`

Index grouping agrees: `engine/index.rs:377`:
> `.map(|column| row.field(column).cloned().unwrap_or(Value::Null))`

**(c) Migration order: yes.**

`snapback2/crates/snapback2-core/src/registry.rs:889`:
> `apply_migration_drops(&transaction, &mut reduced, migration, released_at)?;`

Line 890:
> `if let Some(refusal) = additive_refusal(&transaction, &reduced, &next.schema)? {`

`successor.rs:244` performs:
> `if let Some(refusal) = caps::validate_caps(connection, next)? {`

Then `registry.rs:893` starts:
> `let report = apply_additive(`

`successor/caps.rs:21` iterates every successor table—`for (name, table) in &schema.tables {`—and line 34 reads base rows: `let rows = fetch_rows(connection, name)?;`. It does not filter to added/lowered caps. The unchanged-cap/type-drop test passed.

Ordinary additive succession checks before opening its transaction: `registry.rs:836` calls `successor_refusal(...)`, while transaction creation begins at line 843. Thus the spec’s “in the successor transaction” wording is literally satisfied by migration admission, not by that additive preflight.

**(d) Structural admission: ordinary cases are present; provenance is unsound.**

| Condition and concrete scenario | Implementation and proving case |
|---|---|
| Identity binding: `page = scan; for m in page` | `fanout.rs:165–168` handles `Const`, `Let`, and `Assign` with `self.env.insert(name.clone(), self.expr(value));`. `cap_cases.rs:92` constructs `Stmt::Let`; `fanout-complete-binding` covers that path. Defects 1–2 defeat the broader claim. |
| Shape: collect one shaped row per membership | `fanout.rs:207`: `if let Some(target) = shape_target(body)`. `cap_cases.rs:104` constructs `Stmt::Push`; `fanout-complete-shape` covers the simple collector. Defect 3 defeats the general proof. |
| Merge origin | `fanout.rs:263`: `Origin::Merge(_) => (`. Actual Quarry merge is exercised at `quarry-fanout-checks.ts:127`: `const merge = "mutation send...`. |
| Unresolvable origin: conditional assignment from a second scan | `fanout.rs:280`: `(format!("`{name}` is not a single page scan"), rewrite)`. `cap_cases.rs:214` gives the alternate scan `second.site = "members.other".into();`; case `fanout-refused-binding-unknown`. |
| Argument bound | `fanout.rs:343`: `Bound::Arg { .. } => {`. `cap_cases.rs:178`: `scan.take = Bound::Arg {`; case `fanout-refused-argument-bound`. |
| Literal below cap: take 50, cap 100 | `fanout.rs:349`: `Bound::Literal(n) if n < cap => {`. `cap_cases.rs:174`: `max: 100,`; case `fanout-refused-below-cap`. |
| Non-uniform rule: principal not pinned | `fanout.rs:336`: `if !uniform_visibility(self.schema, scan) {`. `cap_cases.rs:185`: `RuleExpr::Eq(RuleTerm::Field("principal".into()), RuleTerm::Viewer);`; case `fanout-refused-nonuniform-rule`. |
| Order-free grouping containment | `fanout.rs:313`: `Constraint::Cap { by, max } if by.iter().all(|column| pinned.contains(column)) => {`. Longer-prefix coverage exists at `cap_cases.rs:87`: `scan.prefix.push(Expr::Literal(text("member")));`. A permuted-prefix case is missing. |
| Cursor/key cuts | `fanout.rs:357`: `if scan.after.is_some() || scan.before.is_some() || scan.range.is_some() {`. `fanout-refused-cursor` proves `after`; no added `before`/range witness. |
| Non-uniform range elsewhere, even unused | `fanout.rs:68`: `.find(|scan| !uniform_visibility(schema, scan));`. `cap_cases.rs:195` binds `name: "unused".into(),`; case `fanout-refused-nonuniform-elsewhere`. |

**(e) Complete flag and atomic assertion: mechanically yes; admission is not trustworthy.**

`snapback2/crates/snapback2-core/src/certificate.rs:208` requires:
> `Ok(mut certificate) if errors.is_empty() => {`

Line 211 sets:
> `site.complete = complete.contains(&site.site);`

Runtime `engine/runner.rs:1100` checks:
> `if read_site.complete && fetch_limit < take.saturating_add(2) {`

It returns `RuntimeError::TraceSubset`. Mutation errors return before the successful execution path at `engine/mod.rs:698`:
> `Err(error) => return Err(error),`

The examined-budget and rule-probe-starvation tests pass. Defects 1–2 leave unsafe loops unmarked; defect 3 marks a false shape proof complete.

**(f) Metering: reserves and refusing-path charges exist; the global guarantee fails.**

`snapback2/crates/snapback2-core/src/cap.rs:28` selects:
> `WriteKind::Insert | WriteKind::Update | WriteKind::Upsert`

Line 35 sums every cap:
> `sum.saturating_add(u64::from(*max))`

`certificate.rs:1307` multiplies by calls:
> `let cap_rows = crate::cap::write_reserve(self.schema, table, kind).saturating_mul(calls);`

`engine/runner_ops.rs:502` charges before line 510’s refusal:
> `if rows.len() >= *max as usize {`

The refusing-path test verifies `runner.trace.examined == 50` at `engine/cap_tests.rs:77`. Nevertheless, defect 4 demonstrates a certified program that can trip runtime `E_TRACE_SUBSET`.

**(g) Diagnostics: metadata is wired; the executable-repair promise is incomplete.**

- Union: `snapback2/packages/compiler/src/ir.ts:138`: `| "E_STRUCTURAL_FANOUT"`.
- Family: `compiler/src/diagnostics.ts:119` includes `"E_STRUCTURAL_FANOUT"` in the bound-code list.
- Guide: line 134 returns `"bound/loop"` for it.
- Rule: line 154: `E_STRUCTURAL_FANOUT: "a mutation population loop covers its selected range",`.
- Protocol: `snapback2/crates/snapback2/src/protocol.rs:11`: `"E_UNBOUND_LOOP" | "E_STRUCTURAL_FANOUT" => ("bound", "bound/loop"),`.
- Registry row: `snapback2/packages/snapback2/guide/families.source.json:466`: `"code": "E_STRUCTURAL_FANOUT",`.
- Loop site: `compiler/src/lower/loop-mutations.ts:195` records the `program/for/binding/ordinal` source entry; `owner/src/project.rs:245` resolves it with `.and_then(|site| sources.get(site))`.

Repair assessment: adding a cap, raising/replacing `first`, dropping a direct cursor, and the equality-to-viewer prefix repairs have concrete fixture coverage (`quarry-fanout-checks.ts:49–54`). General prefix repairs fail as in defect 6. Known transformed-binding coverage is vacuous as described above. Unknown origins give directions. Merge origins also give prose—`fanout_repair.rs:5` says `"loop one scan, not a merge; ..."`—not a pasted loop.

The actual CLI page is `guide E_STRUCTURAL_FANOUT`, which works. `guide bound/loop` returns `E_GUIDE_UNKNOWN`: `guide.rs:47` routes `page.starts_with("E_")` to refusal pages; other names go to `symbol_page` at line 50. The advertised guide key is not an invocable page.

**(h) Template and guide: yes, apart from diagnostic examples above.**

Both schema files contain `cap 50 by conversationId` at line 38:

- `snapback2/packages/snapback2/templates/chat/snapback/schema.q:38`
- `snapback2/packages/compiler/fixtures/quarry-chat/snapback/schema.q:38`

All seven loop-containing files/sections are byte-identical to base. The three conversation-argument loops say:
> `for m in memberships[conversationId] first 50 by byConversationPrincipal:`

at template `messages.q:19`, template `deliveries.q:13`, and fixture `quarry-chat/snapback/messages.q:19`.

The four message-derived loops say:
> `for m in memberships[msg.conversationId] first 50 by byConversationPrincipal:`

at template `deliveries.q:21`, `deliveries.q:31`, `snapback2/scripts/witness-expo/expiry.q:5`, and `snapback2/crates/snapback2/tests/owner_cases/offline_replay.rs:411`.

The guide snippets remain byte-identical to their template excerpts. Both adjacent sentences say:
> `The loop covers the group because memberships is capped at 50 per conversation.`

at `snapback2/packages/snapback2/guide/quarry.md:272` and `offline.md:71`.

Budgets are raised with the requested comment at `snapback2/packages/snapback2/build.mjs:184`:
> `// LLP 1017 adds cap invariants and complete mutation loops to the reference.`

Line 185 sets 2,560 / 15,360 / 4,352. Actual files are 2,385 / 14,944 / 4,175 bytes.

**(i) Outside the implementation’s central scope.**

The `E_STRUCTURAL_COUNT` rewrite also changes authoring syntax at `snapback2/crates/snapback2-core/src/certificate_policy.rs:339`, including:
> `or declare maintain totals = count {} by <scope> and read the maintained aggregate`

That is adjacent diagnostic cleanup. The appended measurement at `snapback2/metrics/loop.jsonl:181` identifies `"sha":"d1cce1e48"`, not this candidate, so it is not candidate qualification evidence. The shared spike cap is justified by the census: `snapback2/crates/snapback2-core/src/programs.rs:47` contains `max: 256,`.

For the author: keep the enforcement, migration, and template work, but do not land this as the complete-fanout proof. Make provenance follow the interpreter’s actual domains, exits, and bindings; reject destructive collectors; protect cap-probe capacity from non-uniform scans; and turn the reproduced counterexamples into refusal/runtime witnesses. Passing the present suite does not establish the advertised guarantee.