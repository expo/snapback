# Review: LLP 1017 revision (a) — grok-4.6 (xhigh), round 1

**Reviewer:** grok-4.6, reasoning xhigh, read-only, blind (no other review visible), launched 2026-09-05 ~09:45Z by Claude Fable 5.1 from `~/projects/snapback-1017-panel/launch.py`
**Reviewed:** `llp/1017-cap-and-complete-fanout.rfc.md` revision (a) overlaid on origin/main `6d3d09c6f`
**Brief:** `~/projects/snapback-1017-panel/brief-r1.md` (Q1–Q8)
**Verdict:** NOT READY (three material concerns; §1 endorsed to land alone and first)
**Received:** 2026-09-05 (raw output below, unedited except this header)

---

I'll review LLP 1017 as written, starting with the RFC in full, then the cited specs and code. No file changes.RFC is in. Next I’ll read the governing docs and the cited code so every claim can be checked against `path:line`.Governing docs are in. Next I’ll walk the cited engine and compiler code against the RFC’s claims.VERDICT: NOT READY

## Material

1. **Form (b) re-admits the silent-fifty that §3.1 claims to refuse.** A mutation `for` over `memberships[conversationId] after c first 50` with `c: cursor ?` is the first page when `c` is null, commits, and says nothing was cut. That is today's `send` plus a dummy argument. Optional null is the start of the range:

```1001:1003:snapback2/crates/snapback2-core/src/engine/runner.rs
        if after == Some(Value::Null) && scan.opaque_cursor {
            after = None;
        }
```

Mutations cannot mint `next`. Result-page provenance is query-only:

```78:80:snapback2/packages/compiler/src/result-page.ts
export function attachResultPageSite(program: Program): Program {
  const site = program.kind === "Query" ? resultPageSite(program) : undefined;
  return site ? { ...program, result_page_site: site } : program;
```

```1281:1282:snapback2/crates/snapback2-core/src/engine/mod.rs
    let Some(page) = &certificate.result_page_site else {
        return Ok(None);
```

A successful mutation is `Committed`, never a page with a cut:

```708:708:snapback2/crates/snapback2-core/src/engine/mod.rs
            (false, ProgramKind::Mutation) => ExecutionState::Committed { seq },
```

§3.1's own test is "the set of rows written is a function of where the page was cut, and nothing in the outcome says so." Form (b) fails that test. It is also the pattern LLP 1016 D1 rejected for jobs: "a schedule continuation that enqueues itself — is the same mechanism with the cursor smuggled through arguments and no certificate row saying it loops." The diagnostic rewrite that offers `c: cursor ?` as a fix for `send` is the loophole. **Drop (b) from this RFC.** Until 1016 J3's `enqueue`, the only admitted mutation page loop is (a). Put caller-driven drains on 1016, where they already live. If you insist on a page-chunk mutation before J3, the cursor argument must be required, the mutation must return `next`, and the outcome must show the cut — that is a wire change this RFC says it is not making, so it is not in scope here.

2. **§2.4's metering will refuse legal seeds, and `seed_program` already tells you why.** Each capped insert reserves `N` examined rows per call. The seed program is one mutation of upserts with the default examined ceiling:

```1047:1050:snapback2/crates/snapback2-core/src/registry.rs
    let ceilings = Ceilings {
        write_rows: u64::MAX,
        ..Ceilings::default()
    };
```

```34:34:snapback2/crates/snapback2-core/src/certificate.rs
            examined: 10_240,
```

Write sites currently reserve no examined rows for constraint scans:

```1312:1318:snapback2/crates/snapback2-core/src/certificate.rs
fn write_summary(table: &str, kind: WriteKind, calls: u64, factors: &[(String, u64)]) -> Summary {
    let mut summary = Summary::default();
    summary.writes.push(WriteSite {
        table: table.to_owned(),
        kind,
        max_rows: calls,
    });
    summary.steps = calls.saturating_mul(5);
```

The runtime cap check reads up to `N` rows:

```498:509:snapback2/crates/snapback2-core/src/engine/runner_ops.rs
                    let rows = scan_indexed(
                        self.tx,
                        table_name,
                        index_name,
                        &table,
                        index,
                        &prefix,
                        None,
                        None,
                        None,
                        Order::Asc,
                        *max as usize,
                    )?;
```

If those rows are then charged to `trace.examined`, `assert_bounds` will trip unless the certificate reserved them:

```1110:1113:snapback2/crates/snapback2-core/src/engine/runner_ops.rs
        if self.trace.examined > certificate.max_examined {
            return Err(RuntimeError::TraceSubset(format!(
                "examined {} > certificate {}",
                self.trace.examined, certificate.max_examined
```

Chat's four membership seed rows are fine (`4 × 50 < 10240`). Two hundred and five memberships across many conversations, every group under the cap, is `205 × 50 = 10250` and the seed refuses at `check` with a bound error, not `E_CONSTRAINT`. `write_rows: u64::MAX` already admits that seeds are not an ordinary program. **State the seed exception in §2.3/§2.4:** either `examined`/`index_entries` get the same seed exemption as `write_rows`, or the cap check becomes a constant-cost "does an `N`th row exist" probe (one examined row per write). Do not leave this to the lane. Do not wait for the maintained-count ticket; that ticket does not land in this RFC, and metering without the seed rule makes "every writer, seeds included" a lie for any seed larger than `floor(10240/N)`.

3. **C3 as specified is an IR-shape check, not a page-coverage check.** Quarry `for` takes any expression. A bound page is a legal domain:

```515:522:snapback2/packages/compiler/src/quarry/parser.ts
  private parseFor(): Stmt {
    const site = this.take("for");
    const name = this.generatedBinding("loop");
    this.take("in");
    const domain = this.expression(0, new Set([":"]));
    this.take(":");
    this.newline();
    return { kind: "for", name, domain, body: this.parseBlock(), site };
  }
```

Direct `for m in memberships[...] first 50` lowers to `LoopDomain::Page`. A let-bound page does not:

```223:228:snapback2/packages/compiler/src/lower/expr.ts
  if (call && callName(call).endsWith(".scan")) {
    const reference = tableReference(call.arguments[0]!, env);
    return {
      domain: { Page: lowerScan(call, env, hint ?? `${env.programName}.${reference.table}`) },
      bindingInfo: { provenance: "Shape", objectFields: rowFields(call.arguments[0], env), rowBinding: true, rowTable: reference.table },
    };
```

```269:274:snapback2/packages/compiler/src/lower/expr.ts
      return {
        domain: { DerivedArray: {
          value: { Variable: identifier },
          max: info.max,
          bound_source: info.boundSource ?? `${identifier} declared max`,
        } },
```

`members = memberships[conversationId] first 50 by byConversationPrincipal` then `for m in members:` is the query style already in `deliveries.q` (`page = deliveries[viewer] after c first 50`). On a mutation it is `DerivedArray`, C3 does not fire, and `send` is silent-fifty again. CompletenessFlow will not save you: a uniform scan is `Fact::default()`:

```299:302:snapback2/crates/snapback2-core/src/certificate_policy.rs
    fn scan_fact(&self, scan: &Scan) -> Fact {
        if uniform_visibility(self.schema, scan) {
            return Fact::default();
        }
```

**Write the rule over page provenance, not `LoopDomain::Page`.** A mutation `for` whose domain is a page scan, or a derived array whose origin is a page scan (including through `const`/`let`), is admitted only under (a) — and not (b), per (1). Merge-as-domain is the same test: if the origin is a page, it is a page.

## Minor

1. Spelling `50` three times (cap, `require #memberCounts[...] < 50`, `first 50`) is the right coupling. LLP 1007 §8 is "bounds are punctuation (`first 50` cannot be omitted)." Do not infer the loop bound from the cap. Raising the guide byte budgets is the right move; `grammar.md` is 2304/2304, `quarry.md` 14308/14336, `offline.md` 4087/4096, matching `build.mjs:185`.

2. `E_STRUCTURAL_FANOUT` is the right new code. `E_STRUCTURAL_COUNT` is "rules do not leak hidden population structure" (`diagnostics.ts:154`) and fires on capped-only sites (`certificate_policy.rs:327`). A uniform page truncated by `first 50` is not that defect; `scan_fact` returns empty for uniform scans, which is why `send` compiles today. Family `bound`, page `bound/loop`, check in Rust `certificate_policy` (new module: the file is 1357/1500). `bound/loop` is already `E_UNBOUND_LOOP`'s page; that is acceptable if the page text covers both. Plumb `certification_family_guide`: `E_STRUCTURAL_FANOUT` does not match `E_STRUCTURAL_COUNT` or `starts_with("E_BOUND")` and would otherwise fall through to `opaque/subset` (`protocol.rs:8–26`).

3. `cap N by columns` is the right spelling; satisfaction is "an index that begins with the `by` columns in order." The template's `unique byConversationPrincipal: conversationId, principal` (`schema.q:35`) satisfies `cap 50 by conversationId`. Naming an index would couple the invariant to a name. Several caps over different tuples are fine; two over the same tuple should refuse. When several indexes match, runtime takes the first BTreeMap hit (`runner_ops.rs:489–492`); say "any index," not "the index."

4. `E_SUCCESSOR_CAP` is justified (different rewrite from `E_SUCCESSOR_UNIQUE`). `SuccessorRefusal.conflicts` is `Vec<UniqueConflict>` with `{ table, index, key }` and no `count` or `by` (`successor.rs:47–62`). Do not reuse that struct by stuffing `by` into `index`. Message-list the ten groups, or add a parallel payload. That is not a certificate value-model change; say so in §5.

5. C3 should not police `break`/`return` inside the body. That is an authored early exit, not a page cut. `Stmt::Break` is already a no-op in CompletenessFlow (`certificate_policy.rs:239`).

6. No `else CODE` on `cap`. `unique` and `immutable` carry none; `memberAdd`'s `require #memberCounts[conversationId] < 50 else GROUP_FULL` (`groups.q:16`) stays the friendly refusal. Seeds have no place to put an application code.

7. `cap` becomes a table-block word like `immutable`. A column named `cap` will not parse, same as `immutable` today (`parser.ts:128` before `parseColumn`). No fixture uses that column name. Mention it in the grammar page.

8. Inclusive `N`, insert and group-moving update only, never delete: the code already does this (`runner_ops.rs:474–488`, `518–521`). Moving the missing-index miss from `RuntimeError::Schema` at write (`runner_ops.rs:493–496`) to `E_SCHEMA_CONSTRAINT` at `check` is right; `validate_schema` currently ignores `Cap` entirely (`engine/mod.rs:1389–1440`). Refusing a cap on a maintained target is right (`write_aggregate_row` already runs `check_constraints`, `runner_ops.rs:297`).

## Facts

1. **§0 / §3.4 census is short.** Five loops are not "all on origin/main." Same mutation page appears in `snapback2/scripts/witness-expo/expiry.q:5` (`for m in memberships[msg.conversationId] first 50 by byConversationPrincipal`) and in the embedded `edit` in `snapback2/crates/snapback2/tests/owner_cases/offline_replay.rs:411`. A cap on `memberships` admits them under (a) if C3 follows provenance; the census should still name them. Clique `members[conv = c] first 50` is a query (`quarry-clique/snapback/chat.q:122`); that part is right.

2. **"Nineteen existing corpus certificates currently pin 10240" is off.** Eighteen corpus *case files* have `max_examined: 10240`. `corpus/manifest.json` repeats those certificates. Not all nineteen/eighteen move: only programs whose *range* scans hoist. Point reads always set `hoist: false` and do not set `nonuniform_range` (`certificate.rs:1089`, `1072–1097`). `named-thread` is the critic's case: completeness `Page`, messages scan `hoist True`, `max_examined` 10240 — it moves. `opaque-cursor-empty-capped-next-null` is `hoist: [False]` and stays at the ceiling. The RFC's "each whose scan is hoisted" is the right subset; the count is not.

3. **§1 "changes no … runtime path" is false.** `remaining_examined` is the fetch budget for a non-`always_visible` scan:

```1094:1098:snapback2/crates/snapback2-core/src/engine/runner.rs
        let fetch_limit = if always_visible {
            candidate_limit.min(take.saturating_add(2))
        } else {
            candidate_limit
        };
```

Keying `max_examined` on `nonuniform_range` drops `remaining_examined` from 10240 to the reserve for a hoisted membership list, so SQLite fetch size changes. Examined-row semantics do not. Say that.

4. **§2.3 "every writer" does not include `Engine::seed`.** Product seed is `Registry::seed` → `seed_program` → upsert. Corpus and tests use:

```268:278:snapback2/crates/snapback2-core/src/engine/mod.rs
    pub fn seed(&mut self, table: &str, row: Value) -> Result<(), RuntimeError> {
        validate_row(self.schema.table(table), table, &row)?;
        if self.rule_authority == RuleAuthority::StoreAuthoritative {
            crate::assets::refuse_seed_assets(&self.schema, table, &row)?;
        }
        let id = row.field("id")?.as_str()?.to_owned();
        self.store.conn.execute(
            "INSERT OR REPLACE INTO rows(table_name, row_id, data) VALUES (?1, ?2, ?3)",
            params![table, id, canonical_json(&row)],
        )?;
        reindex_row(&self.store.conn, &self.schema, table, &row)?;
```

No `check_constraints`. The critic's fixture is `seed.ts` through `Registry::seed`; that path is real. This one is the corpus hole. Name it or leave it as a test-only writer.

5. **LLP 1001 §9 does not document `Constraint::Cap`.** The enum exists (`schema.rs:358–361`) and the landing plan says it will amend §9. The Related line that treats §9 as already covering `Constraint::*` including Cap is aspirational.

6. **§0's code citations that I checked are true** at `6d3d09c6f`: `certificate.rs:289–317` (substitution on `visibility_filtered_range` vs `nonuniform_range` for probes), `Ceilings::default` 10240, `messages.q:19`, `groups.q:16`, `parser.ts:169` (`after insert` requires `exists`), `schema.ts:165` (rules refuse `<`), `runner_ops.rs` Cap, corpus `scenario-incomplete-cap`. `visibility_filtered_range` has no reader outside `certificate.rs`. Twin already implements Cap (`packages/evaluator/src/runner.ts:756–781`); "unchanged" is accurate.

## Answers

**Q1 (§1).** No examined-row path on a hoisted site goes past `take + 2` per call. A uniform scan stops at `take + 2` visible rows (`runner.rs:1160–1167`); a uniformly false range halts after one probe (`runner.rs:1099–1134`); `always_visible` already caps fetch at `take + 2`. Point reads are 1 (`runner.rs:943`). Walks are `LoopDomain::Recurse` of gets, not ranges (`certificate.rs:1000–1019`). Merge is per-lane `scan()`; each lane budgets `take + 2`. `after` only changes the start key (`runner.rs:996–1003`). A `for` evaluates the page domain once (`runner.rs:251`) and the certificate multiplies nested work by the bound (`certificate.rs:918–927`). `max_steps` currently adds `(max_examined - summary.examined) * 5` when `visibility_filtered_range` (`certificate.rs:308–317`); keying that on `nonuniform_range` drops unused slack on hoisted programs, it does not under-budget them. A program with any non-uniform *range* still certifies the ceilings; that matches the 2026-08-30 ruling. Deleting `visibility_filtered_range` is safe: the only readers are the field, the two merges, the setter, and the three substitutions, all in `certificate.rs`. The one caveat is fetch size, not examined rows: non-public uniform scans fetch `remaining_examined` from SQLite, not `take + 2`. After §1 that number becomes the reserve. That is a runtime change and a win. §1 is sound and should land first.

**Q2 (§2.1).** `cap N by columns` is the right spelling. It matches `maintain memberCounts = count memberships by conversationId` (`schema.q:135`). The invariant is the group, not an index name. Satisfaction is `index.columns.starts_with(by)` (`runner_ops.rs:489–492`); `unique byConversationPrincipal: conversationId, principal` satisfies `cap 50 by conversationId`. Requiring an exact index name would make `send`'s `by byConversationPrincipal` a second declaration of the same fact. Multiple caps over different tuples: yes. Two over the same tuple: refuse. Nested caps (`by conversationId` and `by conversationId, role`) are different tuples and should both bind.

**Q3 (§2.2–2.6).** Semantics of the engine's Cap are complete and already implemented: inclusive `N` (`rows.len() >= *max`), insert and group-moving update only, never delete, `E_CONSTRAINT` `"memberships cap {max} reached"`. Index requirement at write is `RuntimeError::Schema`; moving it to `check` as `E_SCHEMA_CONSTRAINT` is the missing piece, along with Quarry emission (`emitConstraints` today emits unique/immutable/text/finalExists only, `schema.ts:69–96`) and successor admission. Metering is the hole (Material 2). Successor admission mirroring `newly_unique` (`successor.rs:247–276`) is the right shape. Twin Cap already exists; leave it. Seeds *do* reach the cap check with `Effect::Insert` on new rows: `seed_program` builds `Stmt::Upsert` (`registry.rs:1036–1040`); `upsert` calls `insert` when missing (`runner_ops.rs:81–85`); `insert` calls `check_constraints(..., Effect::Insert)` (`runner_ops.rs:23`); `Cap` treats `Effect::Insert` as `increases_group` (`runner_ops.rs:475`). `seed_write` skips *rules*, not constraints (`runner_ops.rs:685–688`). Re-upsert of an existing row with the same `by` tuple is `Effect::Update` and skips the cap. A seed of fifty-one new membership ids in one conversation hits the cap. `Engine::seed` does not (Facts 4).

**Q4 (§3.2).** Form (a) is the right completeness rule: cap over the scanned prefix, uniform rule, literal bound `≥ N`, no exemption for read-only bodies (a `require` skipped for row 51 is the same miss as a skipped insert), queries untouched, argument/derived/walk loops already `E_FANOUT` (`runner.rs:334, 342, 386`; `engine/mod.rs:124`). Prefix relation is right: index begins with `b₁…bₖ` and the scan pins at least `k` columns. Too strict on argument bounds: yes, an arg can be below `N` at runtime (`runner.rs:1063–1071`). Too loose on form (b): yes — drop it (Material 1). A mutation cannot obtain a cursor today. `next` is minted only from `certificate.result_page_site` (`engine/mod.rs:1273–1324`); mutations never get that site (`result-page.ts:79`) and return `Committed` with `next: None`. The caller would have to mint from a query envelope and pass it in. That is 1016 D1's smuggled cursor. Do not admit it here.

**Q5 (§3.3).** New code `E_STRUCTURAL_FANOUT` is justified. Reusing `E_STRUCTURAL_COUNT` would paste the denormalize-or-maintain rewrite (`certificate_policy.rs:332–335`) at a uniform, prefix-keyed, bounded loop that has no hidden population. Family `bound`, page `bound/loop`, rule "a mutation loop covers its whole page," message naming table/index/site/reason, rewrite leading with the cap (not `after c`). Check in Rust `certificate_policy::structural_errors`, not the TypeScript front end: corpus, raw IR, `snapback2 check`, and the twin certificate all go through `Checker`. The TS maps (`ir.ts` `DiagnosticCode`, `diagnostics.ts` family/guide/rule, `policy.ts`, `families.source.json`) are plumbing. Split the file; 1357/1500 is real.

**Q6 (§4).** Acceptable. Bounds stay punctuation. The coupling that raising the cap without raising `first 50` refuses the loops is the point of C3. Omitting the loop bound when the prefix is capped would be a new inference and would contradict LLP 1007 §8. Raise the guide budgets; do not compress the grammar screen to fit one word. Keep fenced `q` snippets byte-identical to the template; put the covering sentence *beside* them, as written.

**Q7 (§6).** None of the four non-claims should move into this RFC. `else CODE` on `cap` would make seeds and successor admission invent an application code they do not have. A maintained-count-backed check is the right follow-up (the template already has `memberCounts` over the same `by`) but it is not required to land `cap`; what *is* required is the seed-budget rule in Material 2. A runtime one-more-row probe on a non-uniform range is the cardinality oracle 1001 §3 refuses; under (a) it is redundant. Per-site budgets for mixed hoisted/non-uniform programs are the 2026-08-30 ruling; `named-thread` after §1 still has a point-read `hoist: false` and a hoisted range, and the range (not the point) is what matters. Leave mixed programs on the ceiling.

**Q8 (composition).** No contradiction with 1016 on the bounded vs unbounded split: C3 is the refusal today, D8/`enqueue` is the third admitted form after the loop bar, J3 may rewrite `send` later, and the cap remains the invariant under `memberAdd`. The contradiction is form (b) vs 1016 D1 (Material 1). Landing 1017 before the loop bar is consistent with `rules/NOT-DOING.md`: this is a correctness fix to an existing surface (the chat template's `send`), not the administrative plane, not a new kind, not a new verb. 1016 stays sequenced after the bar. §1 is right to land alone and first: it aligns the certificate to LLP 1001 §3 as already ruled, changes no grammar, and its only intended observable is that `max_examined` becomes the number a hoisted scan actually spends. Do not wait for the panel to land §1. Do not implement §2–§4 from revision (a).

§1 is the certificate saying the number the engine already spends — land it. §2's Cap spelling is the right word on the right columns, and the engine already enforces it on `insert`/`upsert` including product seeds. What I would not ship from (a) is C3 with an `after c` escape that mutations cannot even continue, metering that collides with `seed_program`'s 10240 examined ceiling, or a `LoopDomain::Page` check an agent bypasses with one `let`. Cap the group, refuse every mutation `for` that iterates that page unless the cap proves it covers, and put the rest on 1016.
