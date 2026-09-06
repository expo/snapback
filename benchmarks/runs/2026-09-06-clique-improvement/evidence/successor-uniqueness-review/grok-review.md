READY

No material introduced or remaining scoped defect was found in candidate `ed5c42db76ce87577896db9dddfd6cc8f4368b2d` versus predecessor `ecb3c6ed058d17f62a85f97b06ce23718467c57b`. Survivor admission now uses the same projection and ownership union as mutation at each sequential rebuild step. The four changed leaves are `snapback2/crates/snapback2-core/src/successor.rs`, `snapback2/crates/snapback2-core/src/registry.rs`, `snapback2/crates/snapback2-core/tests/successor_maintains.rs`, and `llp/1001-query-engine.spec.md`.

This is a source review of the supplied packet. It does not claim production, scale, phone, or publication qualification. Supplied tests and receipts are not this reviewer's executions.

## Material findings

None.

## Inspected interactions

### The ordering failure

Predecessor generation: `events → aTotals`. Successor generation: `aTotals → zTotals`, with `group` widened and `min=2` on both total tables. Seeded `zTotals` carries `id = canonical(["valid"])` and `group = "x"`. That ID is also the identity of the `aTotals` count of `group="valid"`. Intra-generation “maintained target may not be a source” still holds in `schema.rs` (`maintain_issues`, target/source disjointness). Cross-generation retirement of `aTotals` into an ordinary source of `zTotals` is lawful.

Rebuilds walk `BTreeSet` table-name order (`maintained_targets_requiring_rebuild` → `apply_additive`). `aTotals` rebuilds first and removes predecessor-owned IDs. `zTotals` then projects from the transaction as it actually sits. After `aTotals` is cleared, that projection is empty, so the `zTotals` row is a survivor and must face the new text minimum.

On unchanged `ecb`, `additive_refusal` built every successor projection and the replaced-ID union **before** any rebuild. That union still saw `aTotals.group="valid"`, so `zTotals` treated `canonical(["valid"])` as owned and skipped the invalid survivor. Sequential mutation then cleared `aTotals` and left `group="x"` installed. That is the scoped bug.

### Shared admission/mutation path

Candidate `additive_refusal` (`successor.rs` 229–300) now admits only non-rebuilt tables, plus caps and newly unique indexes on those tables. Rebuilt-target admission, projected uniqueness, and mutation live in one function:

```677:761:snapback2/crates/snapback2-core/src/successor.rs
fn rebuild_target(...) {
    // source admission with replacement=None, including a retired target used as source
    // projected_target_rows at this step
    // owned_ids = captured predecessor IDs ∪ this projection's IDs
    // survivor admission with Some((target, &owned_ids))
    // uniqueness over that same `rows` map
    // rebuild_owned_aggregate_target(..., &owned_ids, rows)
}
```

Admission and mutation consume the same `rows` and `owned_ids`. Neither is recomputed between those steps. `rebuild_owned_aggregate_target` clears exactly `owned_ids` then inserts the same projected values (`engine/mod.rs` 964–988; `clear_aggregate_ids` / `write_aggregate_row`). Later rebuilds write only their own target. A maintained target still cannot be a source in the **same** generation, so a later step cannot rewrite an earlier target or enlarge/shrink that earlier owned set. If uniqueness or mutation fails, the open SQLite transaction is dropped and rolls back; the exemption never becomes durable. No later operation in this path invalidates an exemption that was committed.

Predecessor IDs are captured once, before drops and before the rebuild loop (`apply_migration` 1022–1023; `apply_additive` 491–502; `projected_predecessor_ids` 661–675). Successor IDs are the projection at that step, after drops and earlier rebuilds.

### Surfaces that must refuse the same way

- Additive `apply_successor_at` (962–1003): `successor_refusal` then `apply_additive`. Rebuilt-target `RuntimeError::Successor` is unwrapped by `store_refusal` (1265–1270) so the caller sees `E_SUCCESSOR_ROW_INVALID` / `E_SUCCESSOR_UNIQUE`, not `E_SUCCESSOR_STORE`.
- Exact migration (1005–1043): capture predecessor IDs, drop, `additive_refusal` on the reduced schema, then `apply_additive` with the captured IDs. `?` preserves `RuntimeError::Successor`. Mixed drops stay in the same transaction.
- Changed-schema `Runtime::open` (569–599): same `successor_refusal` + `apply_additive` + `store_refusal` pairing. Persist of the new generation is after `apply_additive`.

Required-source admission still precedes ID derivation: ordinary sources in `additive_refusal`; retired sources at the consuming target’s rebuild step, with no replacement exemption. Required-target and new/changed-column / new text-constraint admission still run on unreplaced survivors only (`validate_stored_rows` 302–407). Projection-owned IDs are exempted because they are replaced or removed, not because the whole table is skipped. Unrelated historical fields stay outside that selection. Value-preserving text widening and LLP 1016 D4 narrowing are unchanged (`text_maximum_widens`, `narrowing_refusal` before the rebuilt-target skip). Projected uniqueness is checked on the step’s `rows` before mutation; `maintained_backfill_unique_conflict_refuses_successor_atomically` still expects `E_SUCCESSOR_UNIQUE`.

Lawful reverse table-name order (`zTotals` retired, `aTotals` the new target) still projects from the not-yet-cleared source and actually replaces `canonical(["valid"])`. Valid `group="survivor"` is kept when it is a true survivor. Both order controls are in `retirement_source_ordering_allows_valid_survival_and_actual_replacement`.

Authoring matches the engine: Quarry `maintain` is a closed count/sum (`guide/quarry.md`); a refused application keeps the previous generation (`guide/operator.md`, LLP 1002 §5).

## Evidence (supplied; not executed here)

Packet receipts, not this review’s runs.

**Baseline reproduction on unchanged `ecb`.** `evidence/current/commands/baseline-runtime-red.json` is the wrong Cargo cwd (exit 101, `ibex-runtime` / missing `vendor/ibex/Cargo.toml`). The actual Runtime red is `baseline-runtime-correct-cwd.json` (cwd `…/snapback2`, exit 101, 64.4s). After `Generation::certify`, both additive and exact-archive-drop cases installed the successor and left `zTotals` `group="x"` at `canonical(["valid"])`. Certified hashes in that log: predecessor `6bd8d278…`, additive successor `1736f7a4…`, migration successor `e20b1725…`. Public witness attempt 5 (`baseline-public-attempt5.json`, exit 0, expected `violation`) installed generation `fbae36b1…`, status `ready`, `seq=2`, emptied `aTotals`, retained `zTotals.group="x"`. Attempts 1–4 remain: missing `typescript`, Quarry/TS `events` name clash, `api` import from `index.mjs`, `E_OP_UNKNOWN` empty op.

**Candidate.** First integration (`fixed-successor-integration.json`, exit 101): 19 `successor` tests pass; 14 `successor_maintains` pass including the three new additive/migration/valid-order cases; `retirement_source_ordering_refuses_changed_schema_reopening` failed only because `_meta.owner` appeared. The left/right dump in that log is otherwise identical (generation `6bd8d278…`, rows, indexes). `reopen-test-repair.json` records that as a test mistake: `Store::open` writes the lock owner before `Runtime` admission. Corrected command `fixed-reopening-regression.json` exit 0. Then `fixed-successor-narrowing` 10/10, `fixed-successor-unit` 4/4, `fixed-text-writers` 3/3, all exit 0. Distinct selected tests: 19+15+10+4+3 = 51 (original 47 plus 4 ordering cases). There is no single all-51-green command. `prior47/` is historical first-repair evidence on `ecb`, not repeated here.

**Fixed public.** `fixed-public.json` exit 0, expected `refusal`. Status `refused` with `E_SUCCESSOR_ROW_INVALID` at `zTotals.[{"String":"valid"}]`, served generation still `51367480…`, `seq=2`, `after` equal to `before` (3 rows). Closed-store observations keep `aTotals` `group="valid"`, `zTotals` `group="x"`, and both index sets. Compiled generation-1/2 leaves match baseline (`public-comparison.json`). Same ordinary Quarry + `createClient` writes; no raw injection.

**Auxiliary.** Writer caps/ref-check used 120s wrappers and finished in ~2.4s / ~10.5s, exit 0. Supervisor repeated those two on committed `ed5` with 60s wrappers, both exit 0, neither timed out. Build 114.693s within 300s. Commit `ed5c42db…` parent `ecb3c6ed…`.

## Static conclusions versus analysis executed

**Static (this review).** Read root/snapback2 `AGENTS.md`, `rules/RULES.md`, `rules/NOT-DOING.md`, LLP 1000, LLP 1001 §4 successor/admission/maintain/field text, LLP 1016 D4, LLP 1002 owner apply/refuse behavior, current `guide/operator.md` and `guide/quarry.md`. Compared candidate vs `baseline/` vs `revision.patch` on the four leaves. Walked `rebuild_target`, `additive_refusal`, `apply_additive`, `apply_migration`, `Runtime::open`, `store_refusal`, `rebuild_owned_aggregate_target`, and `maintain_issues`. Read the new retirement fixtures and the preserved required-source / required-target / widening / mixed-drop tests.

**Executed here.** Read-only `wc -l`, `shasum -a 256` (matches `source-manifest.json` for the four leaves), and `diff | wc -l`. All succeeded under 60s. No Cargo, Bun, owner, or suite was run. No command failed; none had its deadline enlarged.

**Not executed here.** Any cargo test, public witness, caps, ref-check, or build. Those exist only as packet receipts.

## Inherited concerns (not new reproductions)

These predate this delta or sit outside the sequential owned-set repair. They are not claimed as candidate-introduced failures.

- `caps::validate_caps` and `narrowing_refusal` still inspect **current** stored rows, including rebuilt targets, without the per-step replacement exemption. D4 non-null narrowing and cap counts are therefore still pre-rebuild.
- In-memory uniqueness in `rebuild_target` is the projected map only, matching LLP 1001’s “complete projected target.” A unique collision with a **preserved survivor** is still left to insert-time `check_constraints`. On `apply_successor` that can still surface as `E_SUCCESSOR_STORE` rather than `E_SUCCESSOR_UNIQUE` if SQLite/constraint errors are not `RuntimeError::Successor`.
- Survivor exemption keys SQL `row_id`; `clear_aggregate_ids` keys `data.id`. Engine/seed writes keep them equal. That split is older than this repair.
- `apply_additive` still reindexes every table, including soon-to-be-rebuilt targets, before `rebuild_target`. `reindex_row` writes `index_entries` and does not itself enforce uniqueness.

## Limitations

Packet-only, read-only, no subagents, no network, no worktrees outside this directory, no v1 gates. Historical paths in receipts are provenance, not inspected. No live store or binary is in the packet. No claim is made beyond this scoped successor-admission repair.
