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


---

# Round 2 — cross-read of revision (b) (grok, same model and effort, launched 2026-09-05 ~10:05Z from `launch.py grok 2 brief-r2.md`; both round-1 reviews visible; capsule at origin/main `6d3d09c6f` with revision (b) overlaid)

**Verdict:** NOT READY on revision (b); every point folded into revision (c) (RFC §8). Raw output below, unedited.

I'll read revision (b), both round-1 reviews, and the cited code, then judge whether every material point was folded.Revision (b) and both reviews are in. Next I’ll re-check the cited engine, certificate, and compiler sites against those claims.VERDICT: NOT READY

Revision (b) folds the panel’s accounting, provenance, seed, successor, and form-(b)-as-named-form findings. It does not fold form (b) out of the language: §3.2’s iff still admits `after c`. That is the same silent first page the panel refused. One conjunct, then this is the design to implement.

## Folded

1. **Form (b) is the silent fifty** — folded wrongly. The named admission and the `c: cursor ?` rewrite are gone, and the prose now says a cursor form is a wire change for LLP 1016. The replacement iff does not require the origin scan to have `after`/`before`/`range` all `None`, so `for m in memberships[conversationId] after c first 50` still satisfies every listed conjunct (cap over pinned columns, uniform rule, literal bound ≥ N, no other non-uniform range). That is form (b) without the name. See Remaining 1.
2. **Seed metering vs `Ceilings::default` examined 10,240** — folded correctly. §2.4 waives `examined` / `index_entries` / `steps` the same way `write_rows: u64::MAX` already does; §2.3 names `Engine::seed` as the test-only raw writer.
3. **C3 keyed on `LoopDomain::Page` is bypassed by one `let`** — folded correctly. The rule follows provenance through `const`/`let`/assignment; an unresolvable origin and a merge origin refuse.

## The other family's points

1. **Scan summary overwrites prefix work** (`certificate.rs:1110` walks prefix/after/before/range, then `certificate.rs:1172`–`1175` assigns `examined` / `index_entries` / `rule_probes` / `steps`) — agree. Folded as saturating additions plus the two witnesses. Implement the additions on the scan-local figures, not by re-deriving `index_entries`/`steps` from the post-add `examined` total (see (a)).
2. **Fetch clamp is public-only, not hoist** (`runner.rs:1094`–`1098`: `if always_visible { candidate_limit.min(take.saturating_add(2)) } else { candidate_limit }`) — agree. Folded: clamp uniform scans too, and say the certificate counts traced candidates (the extra true-verdict probe row is physical, not traced). That is enough for the cost model this RFC claims.
3. **`let page = scan…; for m in page` is `DerivedArray`** (`lower/expr.ts:226` vs `:270`) — agree. Folded via provenance.
4. **A non-uniform scan can spend `remaining_examined` and starve the loop** (`runner.rs:1077`; mutation still `Committed` at `engine/mod.rs:708`) — agree. Folded as “no non-uniform range site anywhere” plus a complete-site assertion. Sufficient; slightly stricter than order-sensitive protection; not too strict for this repo (see (b)).
5. **Form (b) is a syntactic escape** (`runner.rs:1001`–`1003`; `result-page.ts:78`–`80`; `engine/mod.rs:1278`–`1282`) — agree. Withdrawing the named form is right; the iff still admits the syntax (Remaining 1). That does not change my view of (5); it is an incomplete application of it.
6. **Optional grouping columns: `new.field` vs `unwrap_or(Null)`** (`runner_ops.rs:472` vs `index.rs:377`) — agree. Folded as one canonical grouping key.
7. **Type-change drops collapse groups under an unchanged cap** (`successor.rs:487`–`493`, then `registry.rs:888`–`889`) — agree. Folded as validate-every-cap.

No Codex material point was wrong. None of them, including (5), is fully discharged until Remaining 1 is in the iff.

## Remaining

1. **§3.2’s iff still admits a cursor cut.** `Scan` carries `after: Option<Box<Expr>>`, `before`, and `range` (`ir.rs:295`–`298`). Null optional cursor is the start of the range:

```1001:1003:snapback2/crates/snapback2-core/src/engine/runner.rs
        if after == Some(Value::Null) && scan.opaque_cursor {
            after = None;
        }
```

Mutations cannot mint `next` (`result-page.ts:78`–`80`; `engine/mod.rs:1278`–`1282`) and succeed as `Committed` (`engine/mod.rs:708`). A complete-marked site whose fetch is not budget-cut below `take + 2` will not save this: with ample `remaining_examined`, `memberships[conversationId] after c first 50` under `cap 50 by conversationId` fetches the suffix, stops `Exhausted` if that suffix is short, and commits a partial fan-out. **Change:** add to the iff that the origin scan has `after`, `before`, and `range` all `None`. Follow only identity bindings and row-shapes to that scan; do not treat `Slice`/`Concat`/`Sort` as the same page (CompletenessFlow already passes `Builtin::Slice` through, `certificate_policy.rs:268`–`271`). Give that reason its own rewrite: drop `after c` or wait for LLP 1016.

2. **`complete: true` vs “no wire field.”** §3.2 says the certificate marks the loop’s read site `complete: true`. `ReadSite` has no such field today (`certificate.rs:115`–`125`). §5 says the certificate value model is unchanged and no wire field is added, while calling out `SuccessorRefusal.cap_conflicts` as the one additive field. **Change:** either add `complete` with `#[serde(default)]` and list it in §5 next to `cap_conflicts`, or say the runtime re-derives the same complete-by-cap predicate and the certificate shape does not change. Do not leave both sentences as written.

## Minor

- Saturating-add the scan-local row count; do not turn today’s `index_entries = summary.examined` / `steps = summary.examined * 5` into `saturating_add` of those *totals* after `examined` has already grown. The ten-node-prefix witness fails if `steps` is still `examined * 5`.
- `nonuniform_range = !hoist` (`certificate.rs:1179`) is the same assign-after-accumulate pattern for flags. Use `|=`. A nested *range* in a prefix is not a Quarry-typable index key, so this is not a template bug.
- `fn read` never walks `read.key` (`certificate.rs:1072`–`1097`). That is omission, not the scan overwrite; point-read programs already live without ceiling slack. Not in this RFC unless a Get key is itself a scan.
- Unique constraint scans still go only to `constraint_inputs` (`runner_ops.rs:650`–`665`). Leave them there; do not start charging them without a reserve.
- “One indexed scan per capped table” vs two caps on one table: one table fetch, group twice in memory. Fine.
- Over-reserving N on a non-group-moving update is conservative. Insert/upsert plus updates whose `by` tuple might change would be tighter; not required.
- Merge rewrite “fan in at read (LLP 1010 A5)” is a query form. For a mutation `for` over merge, the honest rewrite is “loop one scan” / “wait for enqueue job.”
- `indexes_required` today records read indexes and `FinalExistsOnInsert`, not unique constraint indexes (`certificate.rs:423`–`428`). Recording the cap enforcement index is still the right obligation; “like every other constraint index” is slightly too strong.
- Seed exemption must still *compute* N per write so `max_examined` matches charged rows. Mutations do call `assert_bounds` (`engine/mod.rs:599`–`604`). Waiving the 10,240 comparison without reserving yields `max_examined = 0` and a seed `TraceSubset`. Same shape as `write_rows: u64::MAX` keeping real write counts.

## Specific checks

**(a) Four additions and the uniform fetch clamp.** Correct, and sufficient for the two bugs in those lines, if implemented as scan-local saturating adds:

- `scan_rows = calls.saturating_mul(reserve)`
- `examined` / `index_entries` `saturating_add(scan_rows)`
- `rule_probes` `saturating_add(rule_probes)`
- `steps` `saturating_add(scan_rows.saturating_mul(5))`

That keeps a nested point read in a prefix (`certificate.rs:1106`–`1107` @ref) and a ten-node prefix at `take 1` (runtime charges those nodes at `runner.rs:994` + `runner.rs:403`). Re-deriving `steps` from the new `examined` total still under-budgets the ten-node case.

Clamp: today’s public-only clamp (`runner.rs:1094`–`1098`) becomes `uniform` (public already implies uniform: `uniform_visibility` with empty used-fields, `certificate_policy.rs:66`–`81`). Non-uniform keeps `candidate_limit` because hidden rows consume budget. Uniform-false still probes one row then skips the main fetch (`runner.rs:1106`–`1141`). The extra true-verdict probe SQL is one physical reread; the certificate traces candidates (`runner.rs:1199`). Stating that is enough.

No third *site* of the same accumulate-then-assign: merge lanes each call `scan()` (`certificate.rs:1063`–`1065`); walks use `read()` / geometric gets (`certificate.rs:1000`–`1019`); point reads never set `nonuniform_range` (`certificate.rs:1072`–`1097`, `hoist: false` and no flag). Get-key expressions are unvisited; that hole already exists for public programs and is not what ceiling slack was hiding. Same-function flag assign is Minor, not a third site.

**(b) Budget condition + complete assertion.** Sufficient to protect the reserve. `remaining_examined` is shared (`runner.rs:1077`). Rule `exists` probes charge `rule_probes`, not `examined` (`runner_ops.rs:785`–`793`). Cap checks today charge only `constraint_inputs` (`runner_ops.rs:511`–`517`); after metering they spend ≤ N of a reserved N. Point reads spend ≤ their 1. Uniform/public scans spend ≤ `take + 2` once clamped. So if every range is hoisted or public, the complete loop still has its reserve when it runs. The assertion should be `fetch_limit < take + 2` on a complete site (what the RFC wrote), not only `StopReason::Limit` (`runner.rs:1191`–`1198`): a cut fetch that happens to exhaust a smaller group is `Exhausted` and would otherwise commit. With correct accounting the assertion never fires; it is the loud backstop.

Too strict on order (a *later* non-uniform scan cannot starve an *earlier* loop) and on unused locals. Not too strict for anything in this repo: the seven census loops are the only mutation page-`for`s; each is `memberships[…] first 50` with `read <- exists memberships[.conversationId, viewer]`, which hoists. `send`’s other reads are exists/gets (`messages.q:14`–`21`). `groupCreate`’s `for principal in members` is an argument list (`groups.q:8`, `<=49`). `followingFeed`’s `for f in follows[viewer] first 50` is a query merge lane (`feeds.q:10`–`13`). Clique `members[conv = c] first 50` is a query.

**(c) Order-free prefix.** Sound. If every `by` column is among the first `prefix.len()` index columns, every selected row shares one `by` tuple, so the slice is ⊆ one cap group and has size ≤ N. A longer prefix is a subgroup. Cap-by `(a,b)` with index `(a,c,b)` and prefix length 2 does *not* pin `b`; refusing is right (`(a,c)` can meet many `b`s). Enforcement stays `index.columns.starts_with(by)` (`runner_ops.rs:492`); that is a different relation and should stay.

**(d) One grouping key and validate-every-cap.** Sound. Index grouping is `unwrap_or(Value::Null)` (`index.rs:377`); optional omission is valid (`index.rs:487`). The engine cap arm must use that function for insert, group-moving update, and successor counts. The twin already materializes optionals before the cap (`evaluator/src/runner.ts:581`, `:756`–`:778`). Checking every successor cap, not only new/lowered ones, is the safe rule for the type-change collapse. Cost is on the order of the existing unique-index scan (`successor.rs:245`–`276`); acceptable. Raising N still runs the scan.

**(e) Seed exception.** Right. `seed_program` already sets only `write_rows: u64::MAX` (`registry.rs:1047`–`1050`); default `examined` is 10,240 (`certificate.rs:34`). Product seeds are ordinary upserts (`registry.rs:1036`–`1040`) through `insert` → `check_constraints` (`runner_ops.rs:23`); `seed_write` skips rules, not constraints (`runner_ops.rs:687`–`688`). A constant-cost “does an Nth row exist” probe is a later optimization (with the maintained-count ticket), not a substitute for the exception. Do not make the cap check constant-cost *instead* of waiving the seed ceiling.

**(f) Rewrite table.** Not every row is executable as pasted.

| reason | executable? |
| --- | --- |
| no cap over conversationId → `cap 50 by conversationId` | Yes, using the loop’s literal bound as N. A missing leading index is a follow-on `E_SCHEMA_CONSTRAINT`. |
| bound 50 below cap 100 → `first 100` | Yes. |
| bound is an argument → “a literal bound of at least the cap” | No. Paste `first {N}`. |
| rule not uniform → `E_STRUCTURAL_COUNT` denormalize-into-prefix | Yes (`certificate_policy.rs:332`–`335`). |
| `members` is not a single page scan | Directional, not a snippet. When the binding is known, paste the scan in the loop head. |
| merge has no union proof → “fan in at read (LLP 1010 A5)” | No for this defect. A5 is a query merge (`llp/1010` A5). Paste “loop one scan, not a merge”; `enqueue job` only after J3. |
| non-uniform scan at `<site>` can spend this loop’s budget → prefix repair on that site | Yes. |

Paste the disambiguating `by <index>` when `catalog.ts:182` would call `ambiguous` (chat has both `byConversationPrincipal` and `byConversationPrincipalRole`). Add a reason for Remaining 1 (`after` present).

`E_STRUCTURAL_FANOUT` still needs an explicit `protocol.rs::certification_family_guide` arm: it matches neither `E_STRUCTURAL_COUNT` nor `E_BOUND*` and falls through to `opaque/subset` (`protocol.rs:8`–`26`).

---

The cap spelling, provenance rule, seed ceiling waiver, every-cap succession, one grouping key, uniform fetch clamp, and the four scan-summary additions are the design. Put `after`/`before`/`range` all `None` in the §3.2 iff — otherwise the cursor program the panel killed still certifies — and say how `complete` is represented. Then implement it.
