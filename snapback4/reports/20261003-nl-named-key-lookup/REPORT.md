# NL — named unique-key lookups, 2026-10-03

Exact named equalities now use the same point plan as the positional unique
key, including optional columns and reordered equalities. The fix is confined
to Quarry planning and verified diagnostic repair; server/device execution
and wasm runtime code are unchanged.
Base: `9e41df69f36138fdd2570fbfd918b2b9d33294ad`, branch
`sb4-intent/nl-named-key-lookup`, eb1000 (`expose-builder-pixel`).

## Established semantics

| Case | Existing server and device behavior, retained by the fix |
| --- | --- |
| Unique key contains any null | Multiple rows are legal. [`check_constraints`](../../crates/snapback4-core/src/engine/write.rs#L436) skips collision checks for null-bearing keys; device prediction uses the same interpreter. |
| Fully non-null key | Duplicate writes fail; a point reads the matching row, subject to visibility and coverage. |
| Point argument null for an optional column | Null matches null. The point selects the first live candidate in id order, then applies its read rule; it does not return the population or search past a hidden candidate. |
| Point argument null for a required column | No row: [`get_prepared`](../../crates/snapback4-core/src/engine/read_point.rs#L133) returns null. |
| `.col = arg`, with null `arg` | Equality is total: null equals null ([`BinaryOp::Eq`](../../crates/snapback4-core/src/engine/runner.rs#L1230)). A bounded `where` read can therefore return multiple null matches. |

Physical keys encode null and append the row id ([`key::encode`](../../crates/snapback4-core/src/key.rs#L34),
[`index_key`](../../crates/snapback4-core/src/rows.rs#L146)). SQLite
[`Tx::lookup`](../../crates/snapback4-core/src/store.rs#L510) and memory
[`MemoryTx::lookup`](../../crates/snapback4-device/src/memory.rs#L588) read one
ascending candidate. The device's [`Predicting::lookup`](../../crates/snapback4-device/src/device.rs#L288)
delegates to its store. [`live_lookup`](../../crates/snapback4-core/src/engine/witness.rs#L227)
skips expired candidates, and [`authorized_point`](../../crates/snapback4-core/src/engine/authorized_point.rs#L182)
owns authorization. Ordinary device coverage requirements still apply.

The planner had reused `total_unique`, which correctly excludes nullable
columns for cursor ordering and extra named predicates, to classify exact
named keys. [`Requests::read`](../../crates/snapback4-lang/src/bind/intent.rs#L79)
now also recognizes exact plain unique keys. Both spellings lower to `Get`
with identical table, index, ordered key expressions and provenance. No new
null rule, scan bound, cap suggestion or runtime special case is needed.
The existing aggregate diagnostic repair now adds `by .id` when a nullable
key must remain a population, preserving every tied null row.

## Verification

- Reproduced calibration #29 from its actual `schema.q`, `windows.q` and
  `workers/push.mjs` in a temporary app. Before the fix: `E_QUARRY_BOUND` at
  `schema.q:206:10`, suggesting `cap N by high, low`. After: `check: ok`,
  29 tables, 53 operations, no problems (24 existing notes).
- **203 affected tests pass.** New [lookup tests](../../crates/snapback4-device/tests/named_key_lookup.rs)
  cover server, memory and SQLite;
  persistence/reopen; every named-key permutation for arities 2 and 3;
  every required/optional column combination; every null-argument combination;
  missing keys; `exists`; identical point plans; null-bearing duplicate writes
  and non-null collisions; population equality; partial-key bound refusals;
  and the calibration schema with both named orders. Existing guide, nullable
  predicates, planner and device variants tests also pass. The first full run
  exposed one repair regression: its nullable-key aggregate rewrite depended
  on the old page meaning. The correction passes all 25 compiler unit tests
  and 11 verified-repair regressions, including execution over tied null rows.
- Full command: `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT bash snapback4/scripts/test.sh`.
  First run: one failed category in 1,494 seconds (the repair regression
  above); all other categories passed, including 6,034 client tests with 11
  existing skips and all 79 serial model tests. **Final run: zero failures in
  1,391 seconds**; every category passes, including the same 6,034 client
  tests, 11 existing skips and 79 serial model tests.
- Both locked suite wasm builds: **2,048,676 bytes raw / 617,398 bytes gzip**,
  with identical hashes. Unchanged budget **618,040**, headroom **642 bytes**. The planner is absent
  from the wasm dependency graph; this change modifies no wasm compilation inputs.
  SHA-256: `09dd6a9e2619d50b2059e78d8abedfce99239b9ea27dfe6c088d856c5ef8ce3f`.
- `ref-check --verbose`: 527 LLPs, 10,285 refs, zero errors or unchecked refs.
  Logs are retained locally under `/tmp/sb4-nl-verification/`.

## Governing context and disposition

The `llp-orient` scope was lookup planning, null semantics and both stores:
[LLP 3000 §4](../../../llp/3000-snapback4.explainer.md#4-fence-numbering-routing)
sets the Snapback 4 fence; [LLP 3000.013 §§2.1–2.2](../../../llp/3000.013-quarry-states-intent.rfc.md#2-reads-state-intent)
governs point meaning and cursor totality; LLP 3000.007 §10 governs extra
named predicates. These are in the current corpus, not foundation. The
null question is resolved by code and execution; no further skill hand-off.
The indexes guide and LLP 3000.013 §2.2 record the rule. Ticket closure and
the append-only journal accompany the fix. No push or publication; no remote
machine or unrelated process was touched.
