# Code review: LLP 1017 §2–§4 implementation, candidate `96ca9189c` on base `f40559f37` — grok-4.6 (xhigh), round 1

**Reviewer:** grok-4.6, reasoning xhigh, read-only, blind (no other review visible), launched 2026-09-05 ~12:15Z by Claude Fable 5.1 from `~/projects/snapback-1017-panel/launch-review.py f40559f37 96ca9189c 1` (capsule: a detached worktree at the candidate with `REVIEW-TARGET.md`)
**Brief:** `~/projects/snapback-1017-panel/brief-code-review.md`
**Verdict:** READY — every §2–§4 claim confirmed line by line; two defects (a checker panic and a fail-open polarity on a missing table or index in raw IR), five spec-drift items where the code is right, and coverage gaps (reordered prefix, `before`/`range`, the twin stub). All folded into lane CAP3 and RFC revision (d) together with the codex review's findings.
**Received:** 2026-09-05 (raw output below, unedited except this header)

---

I'll review the LLP 1017 landing candidate read-only: spec first, then `REVIEW-TARGET.md`, then the named diff and the code that is supposed to implement each claim.The spec and review target are in hand. Next I’ll pull the named diff and walk the implementation against each §2–§5 claim.I'll skip the other reviewer's notes and go through the implementation files against the spec claims.The core cap and fan-out diffs are in. I'll read the remaining implementation files and tests next.I'll inspect compiler lowering, tests, successor order, and the seed path next.**VERDICT: READY**

The §2–§4 landing matches the spec on the product paths that matter: grouping key, every writer including product seeds, successor admission after drops, complete-by-cap with provenance, metering, the fetch-limit assertion, diagnostics, and the template/guide edits. What follows is the residue, not a reason to withhold the landing.

## Defects

1. **Checker panic on a non-uniform scan whose table or index is missing, when the same mutation also has an otherwise-complete loop.**  
   `snapback2/crates/snapback2-core/src/certificate_policy.rs:111-117` runs fan-out **before** `validate_read`:

```111:117:snapback2/crates/snapback2-core/src/certificate_policy.rs
    pub(crate) fn structural_errors(&self, program: &Program) -> Vec<CheckError> {
        let mut errors: Vec<_> = crate::cap::schema_errors(self.schema)
            .into_iter()
            .map(|(_, e)| e)
            .collect();
        errors.extend(fanout::check(self.schema, program).0);
```

   `fanout.rs:66-68` treats any non-uniform scan as the starvation witness:

```66:68:snapback2/crates/snapback2-core/src/certificate_policy/fanout.rs
    let nonuniform = scans
        .into_iter()
        .find(|scan| !uniform_visibility(schema, scan));
```

   `uniform_visibility` is false when the table or index is missing (`certificate_policy.rs:69-73`). For a well-formed loop, `page_problem` then hits `fanout.rs:374-381` and calls `repair::prefix` on that other scan. `fanout_repair.rs:31-32` indexes the maps directly:

```31:32:snapback2/crates/snapback2-core/src/certificate_policy/fanout_repair.rs
    let table = &schema.tables[&scan.table];
    let index = &table.indexes[&scan.index];
```

   **Failing input:** a mutation whose body is `unused = ghost[] first 2 by byId` (or an existing table with a bogus index) plus `for m in memberships[conversationId] first 50 by byConversationPrincipal:` on the fan-out fixture schema. Quarry will not emit this; `snapback2 check --ir` / raw corpus IR will panic instead of `E_UNBOUND_SCAN`.  
   **Fix:** `schema.table` / `table.index` with a fallback rewrite string; do not use `[]`.

2. **`page_problem` fail-open on a missing table/index (masked today by defect 1 or by `validate_read`).**  
   `fanout.rs:301-302`:

```301:302:snapback2/crates/snapback2-core/src/certificate_policy/fanout.rs
        let table = self.schema.table(&scan.table)?;
        let index = table.index(&scan.index)?;
```

   `None` is treated as admission (`fanout.rs:283-285` inserts `complete` and returns). That cannot publish a certificate while `validate_read` still fires (`certificate_policy.rs:1255-1258`), but it is the wrong polarity: a missing relation is not a covered page. **Fix:** return a problem, not `None`.

Neither defect is a silent fifty on the chat template. Fix them in the same landing if cheap; they are not a reason to reopen §2–§4.

## Spec drift

The code is right; amend the spec.

1. **`policy.ts` is not on the `E_STRUCTURAL_FANOUT` path.** Spec §3.3 lists `ir.ts`, `diagnostics.ts`, `policy.ts`. `policy.ts:134-160` still emits only `E_STRUCTURAL_COUNT` for TypeScript reductions. The fan-out rule is correctly Rust-only (`certificate_policy.rs:117`, `fanout.rs:60-63`). A second TS implementation would drift. Strike `policy.ts` from the plumbing list.

2. **Census missed `copyPage`.** Spec §3.4 says no other fixture fans out inside a mutation. `quarry-program-checks.ts:766-767` had to add `cap 3 by name` and pin `nodes[name]` so `for node in nodes[…] first 3` still certifies. That is the §3 rule working. Name that fixture in §3.4.

3. **`E_STRUCTURAL_COUNT` rewrite is now Quarry.** `certificate_policy.rs:339`: `"declare maintain totals = count {} by <scope> and read the maintained aggregate"`. Spec did not ask for this; the old TypeScript `maintain.count(...)` spelling is gone. Keep the Quarry form.

4. **Pasted scans always name the index.** Spec §3.3 says to name it when the table has more than one candidate. `fanout_repair.rs:23-27` always emits `by {index}`. Keep the code.

5. **Null-group sentence in the guide is extra.** Spec §4’s quarry sentence does not mention omission. `quarry.md:68-70` adds `(an omitted optional column is the null group)`. Keep it; it is §2.2.

## Coverage

**Unproven spec claims**

- **Order-free pinned prefix.** `fanout.rs:313` (`by.iter().all(|column| pinned.contains(column))`) is order-free. The only longer-prefix witness is `fanout-complete-longer-prefix` / `quarry-fanout` `ops.q:11`, where `byConversationRole` still *leads* with `conversationId`. No case where the grouping column is pinned but not the leading index column (e.g. index `(role, conversationId)`, prefix length 2, `cap 50 by conversationId`).
- **`before` and `range`.** `fanout.rs:357` checks all three cuts. Corpus/fixture only has `after` (`fanout-refused-cursor`, quarry-fanout-checks `"cursor"`).
- **`groupCreate` meters `50 × 50`.** Spec §2.4 states it. No certificate assertion. `memberAdd` is implied by `cap_reserves_every_writer` (`tests/cap.rs:80-108`) at one write, not fifty.
- **Const as a distinct spelling.** `fanout.rs:165-169` handles `Const`/`Let`/`Assign` in one arm. Tests look for `Let ?? Const` (`quarry-fanout-checks.ts:109-110`) but never assign a page with `Assign` except to *cut* it.

**Vacuous / weak witnesses**

- Frozen `fanout-refused-*` cases only pin `errorCode: "E_STRUCTURAL_FANOUT"` (`cap_cases.rs:418-421`). A refusal for the wrong reason still freezes. Reasons *are* pinned in `quarry-fanout-checks.ts:48-86` and the raw-IR block at `105-132`, not in the corpus JSON.
- Twin path for those cases is a stub, not a check. `evaluator.ts:56-58`:

```56:58:snapback2/packages/evaluator/src/evaluator.ts
    const serverFanoutRefusal = testCase.category === "fanout" && testCase.expected.errorCode === "E_STRUCTURAL_FANOUT";
    const errorCode = schemaCertificationError(testCase.schema) ?? (serverFanoutRefusal ? "E_STRUCTURAL_FANOUT" : "E_CORPUS");
```

  Any `category: "fanout"` refusal with a null certificate reports `E_STRUCTURAL_FANOUT` even if the Rust checker had a different first error. The real gate is `spike.rs` re-certify, not the twin.
- `completeness.rs:640-641` now expects *two* errors (`E_STRUCTURAL_FANOUT` then `E_STRUCTURAL_COUNT`) when inserting a collected non-uniform page. The fan-out hit is `docs has no cap over group` (same shape as `compiler/src/test.ts:427-429`). That is a real refuse, but it is not a proof that map/filter provenance became `Unknown`; it is a `Page` with no cap.

## Minor

- `lower/loop-mutations.ts:190-198` (`recordLoopSite`) is indented one extra level.
- `certificate_policy.rs:112-115` drops the schema-error site path (`map(|(_, e)| e)`). Product compile still maps `schema.tables.*.constraints[N]` via `cap-sites.ts:13` and `Generation::certify`. `snapback2 check --ir` reports `<project>:schema` (`check.rs:119`).
- `metrics/loop.jsonl` appends a consumer-smoke row for `d1cce1e48`, not the candidate. Noise in the landing.
- Dual `E_STRUCTURAL_FANOUT` + `E_STRUCTURAL_COUNT` on one insert is loud; keep fan-out first.
- `fanout.rs:406` / `fanout_repair.rs:142` / `cap.rs:103` / `successor/caps.rs:78` are well under the 1,500-line budget. `certificate_policy.rs` was the reason to split; that split is done.
- Argument-bound rewrite is always `first {cap}` (`fanout.rs:346`) even for `Order::Desc` (`fanout_repair.rs:12-16` would have said `last`). Spec table also says `first`.
- Slice-of-merge stays `Origin::Merge` (`fanout.rs:52-56` only transforms `Page`), so the reason is “no union proof” rather than “not a single page scan”. Still a refuse.

## Checks

**(a) Seed reaches the cap check with `Effect::Insert` for new rows; ceiling exemption is examined / index_entries / steps.** Yes.

`registry.rs:1037-1046` builds `Stmt::Upsert` per seed row. `runner_ops.rs:81-85`:

```81:85:snapback2/crates/snapback2-core/src/engine/runner_ops.rs
        if self.fetch_id(table, key.as_str()?)?.is_some() {
            self.replace(table, key, row)
        } else {
            self.insert(table, row)
        }
```

`insert` at `runner_ops.rs:23`: `self.check_constraints(table, None, &row, Effect::Insert)?`.  
`seed_write` skips **rules**, not constraints (`runner_ops.rs:679-681`: `if self.context.seed_write { return Ok(true); }` inside `check_rule` only).  
`execute_seed` sets `context.seed_write = true` (`engine/mod.rs:464`).  
Ceilings (`registry.rs:1048-1054`):

```1048:1054:snapback2/crates/snapback2-core/src/registry.rs
    let ceilings = Ceilings {
        write_rows: u64::MAX,
        // @ref LLP 1017#24-metering — seeds reserve cap work but waive these ceilings.
        examined: u64::MAX,
        index_entries: u64::MAX,
        steps: u64::MAX,
        ..Ceilings::default()
    };
```

`Engine::seed` remains the raw bypass the spec named. Product proof: `tests/cap.rs:180-198` and `owner_cases/cap.rs:28-95` (205 memberships apply; reset of 51 in one group is `E_CONSTRAINT` and does not move stored rows).

**(b) One grouping key; omitted optional is `null` in all three.** Yes.

`cap.rs:9-13`:

```9:13:snapback2/crates/snapback2-core/src/cap.rs
pub(crate) fn group_key(row: &Value, by: &[String]) -> Vec<Value> {
    by.iter()
        .map(|field| row.field(field).cloned().unwrap_or(Value::Null))
        .collect()
}
```

Used for insert prefix and update compare (`runner_ops.rs:470-477`) and successor counts (`successor/caps.rs:38`). Index grouping is the same function (`engine/index.rs:373-378` `index_values`).  
Proofs: `tests/cap.rs:138-177` (omit vs explicit `Null` share a `cap 1` group; same-group update charges `examined == 0`); `tests/cap.rs:236-263` (type-drop collapse to `[Null]` with count 2); corpus `cap-optional-omission-is-null` (`errorCode: "E_CONSTRAINT"`).

**(c) Successor validates every cap after drops, before additive install.** Yes.

Additive, no drops: `successor.rs:202-206` → `additive_refusal` → `successor.rs:244-246` `caps::validate_caps(connection, next)` → unique scan → caller `apply_additive` (`registry.rs:849`).  
Destructive: `registry.rs:889-900`:

```889:900:snapback2/crates/snapback2-core/src/registry.rs
        apply_migration_drops(&transaction, &mut reduced, migration, released_at)?;
        if let Some(refusal) = additive_refusal(&transaction, &reduced, &next.schema)? {
            return Err(RuntimeError::Successor(Box::new(refusal)));
        }
        let report = apply_additive(
```

Drops delete index entries and column values first (`successor.rs:503-505`). `validate_caps` reads **base rows** (`caps.rs:34-38`), every `Constraint::Cap` on the successor schema, not only new ones (`caps.rs:22-29`). Proofs: `tests/cap.rs:202-233` (added/lowered/raised/removed) and `236-263` (unchanged cap after type-change; rollback).

**(d) `E_STRUCTURAL_FANOUT` conditions.** Mutations only (`fanout.rs:61-63`). Queries: `fanout-query-uncapped` / quarry-fanout `query page`.

| Condition | Scenario | Proof |
| --- | --- | --- |
| `let`/`const`/`assign` | `page = scan; for m in page` | `fanout-complete-binding`; quarry-fanout-checks `bound`; `Const`/`Let`/`Assign` at `fanout.rs:165-169` |
| shapes | empty array + one `Push` restores origin (`fanout.rs:207-211`, `396-405`) | `fanout-complete-shape`; quarry-fanout-checks `{ principal }` |
| merge refused | `merge_site` or `DedupeById` → `Origin::Merge` (`fanout.rs:122-134`, `263-266`) | `fanout-refused-merge`; quarry-fanout-checks merge (`ops` with `merge memberships`) |
| unresolvable refused | unbound / join of two pages / slice-concat-sort → `Unknown` (`fanout.rs:52-56`, `267-280`) | `fanout-refused-binding-unknown`, `-slice`, `-concat`, `-sort`; quarry-fanout-checks `unknownPage` |
| literal bound ≥ cap | `Bound::Arg` and `Literal(n) if n < cap` (`fanout.rs:342-354`) | `fanout-refused-argument-bound`, `-below-cap`; quarry-fanout-checks `"below cap"` / raw-IR argument |
| uniformity | `uniform_visibility` (`fanout.rs:336-340`) | `fanout-refused-nonuniform-rule`; quarry-fanout-checks `"nonuniform rule"` |
| order-free pinned prefix | `by` ⊆ first `prefix.len()` index columns (`fanout.rs:303-318`) | longer prefix: `fanout-complete-longer-prefix` / `ops.q:11`. **Reordered prefix is untested** (see Coverage) |
| no cut | `after`/`before`/`range` (`fanout.rs:357-372`) | `after`: `fanout-refused-cursor` + quarry `"cursor"`. **`before`/`range` untested** |
| no non-uniform range anywhere | whole-body `all_scans` then last conjunct (`fanout.rs:86-105`, `374-381`) | `fanout-refused-nonuniform-elsewhere`; quarry-fanout-checks `"nonuniform elsewhere"` |

Slice/concat/sort of a *known* page paste the scan head (`fanout.rs:275-276`); unknown origin does not fabricate one (`fanout.rs:277-278`). Quarry-fanout-checks execute those pasted rewrites and re-certify.

**(e) `complete` only for admitted loops; runtime rejects a budget cut and does not commit.** Yes.

Set only when `page_problem` returns `None` (`fanout.rs:283-285`). Queries never set it (`fanout.rs:61-63`). `check_all` copies the set onto `ReadSite` only if structural errors are empty (`certificate.rs:208-213`). Analyzer seeds `complete: false` (`certificate.rs:1170-1173`).  
Assertion (`runner.rs:1099-1104`):

```1099:1104:snapback2/crates/snapback2-core/src/engine/runner.rs
        if read_site.complete && fetch_limit < take.saturating_add(2) {
            return Err(RuntimeError::TraceSubset(format!(
                "complete loop at {} was budget-cut",
                scan.site
            )));
```

That is capacity (`fetch_limit`), including probe starvation (`runner.rs:1081-1088`), not `StopReason`. Proofs: `tests/cap.rs:318-357` (cut `max_examined` → `E_TRACE_SUBSET`, row still present; honest cert then deletes it) and `366-401` (`max_rule_probes = 0`).

**(f) Metering; can a certified program now trip `E_BOUND` / trace-subset?** Reserve yes; honest runtime trip no; the assertion is the intended loud path.

`cap.rs:25-40` reserves `max` per `Insert`/`Update`/`Upsert` per cap, not `Delete`. `certificate.rs:1306-1310` adds that × `calls` to examined, index entries, and `× 5` steps. Runtime charges the cap scan, including the refusing probe (`runner_ops.rs:502` `self.trace.examined += rows.len() as u64`) **before** `return Err` at `510-513`. Production mutations call `assert_bounds` only on the success path (`engine/mod.rs:602-606`); the refusing-path hold is the unit test `engine/cap_tests.rs:73-89` (`examined == 50` then `assert_bounds().unwrap()`).  
A certified program cannot exceed the new examined reserve on the cap scan (`scan_indexed` limit is `*max`, `runner_ops.rs:500`). It **can** `E_BOUND` at `check` when `writes × N > 10240` — spec §2.4. It **can** `E_TRACE_SUBSET` at runtime only if the certificate is lying (`tests/cap.rs:342-350` tampers `max_examined = 1`). Seeds waive the three ceilings, so they will not `E_BOUND` from the new reserve.

**(g) Diagnostics plumbing.** Present, and the pasted rewrites lower.

- Family `bound`, page `bound/loop`: `protocol.rs:11`, `diagnostics.ts:119` / `:134`.
- Rule text: `diagnostics.ts:154`, `check.rs:71-72`, `project.rs:261-263`.
- `protocol.rs` arm: explicit `| "E_STRUCTURAL_FANOUT"` (does not fall through to `opaque/subset`).
- `families.source.json:464-469`: family `bound`, wrong loop without cap, right `cap 50 by conversationId`.
- `.q` site map: `recordLoopSite` (`loop-mutations.ts:190-197`) keys `{program}/for/{binding}/{ordinal}`; `project.rs:238-246` parses that out of `` `for` over {label} at {site} may end before ``. Cap lines: `cap-sites.ts:11-13` → `schema.tables.{table}.constraints[{i}]`.
- Rewrites mentally lowered against `quarry-fanout` (and the test **re-certifies** them at `quarry-fanout-checks.ts:80-84`):
  - no cap → `cap 50 by conversationId` in front of `public`
  - below cap → `first 100`
  - argument → `first 50`
  - cursor → drop `after c`, keep `for m in memberships[conversationId] first 50 by byConversationPrincipal:`
  - non-uniform rule → `by byConversationPrincipalScoped: conversationId, principal` plus `memberships[conversationId, viewer] first 50 by …`
  - non-uniform elsewhere → same prefix repair on `other`
  - merge / unknown → not a certifying paste (`NO_UNION` / `bind exactly one page`); tests assert they do not promise a scan they cannot name

**(h) Template and guide.** Done.

- Cap line in both schemas: `templates/chat/snapback/schema.q:38` and `compiler/fixtures/quarry-chat/snapback/schema.q:38` (`cap 50 by conversationId`). `s1` gets `cap 256` (`fixtures/s1/snapback/schema.ts:29`, `programs.rs:45-48`).
- Seven census loops still `first 50` (messages/deliveries/quarry-chat send, expo `expiry.q:5`, `offline_replay.rs:411`). Not in the diff except via the schema cap.
- Guide sentences sit beside the fences (`quarry.md:272`, `offline.md:71`). Fenced `send` / `edit` text is a byte-identical slice of `messages.q` / `deliveries.q`.
- Budgets: `build.mjs:185` grammar 2560, quarry 15360, offline 4352, with the LLP 1017 comment. `guide.rs:103-106` matches 4352. Current sizes 2379 / 14915 / 4175.

**(i) Outside spec scope.**

- `metrics/loop.jsonl` extra smoke row.
- `E_STRUCTURAL_COUNT` rewrite retargeted to Quarry (`certificate_policy.rs:339`; `spike.rs` assertion updated).
- Twin stub in `evaluator.ts:56-58`.
- `estimate_row_width.rs:778-780` skips `certification-refused`.
- `protocol.rs` test-only whitespace.
- `quarry-program-checks.ts` `copyPage` repair (needed for §3, not listed in §3.4).

The §2–§4 implementation is the spec: one `group_key`, product seeds hit `Effect::Insert`, successor reads base rows after drops, provenance follows identity/shape and refuses merge/cut/transform, metering and the fetch-limit assertion match §2.4/§3.2, and the template/guide/diagnostics wiring is in place. Land it; in the follow-up, stop `prefix()` from indexing missing maps, and add a reordered-prefix case plus `before`/`range` so those conjuncts are not only visually true.
