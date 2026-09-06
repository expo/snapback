CHANGES_REQUIRED

One material **remaining scoped defect** exists in candidate `ed5c42db76ce87577896db9dddfd6cc8f4368b2d` versus `ecb3c6ed058d17f62a85f97b06ce23718467c57b`. The ordering repair itself addresses the supplied failure.

**[P1] Newly unique indexes can admit duplicate surviving rows on rebuilt tables.** At [successor.rs:723](/Users/ccheever/clique-improvement/reviews/successor-widening-ordering-r3/astra/snapback2/crates/snapback2-core/src/successor.rs:723), uniqueness checks iterate only the successor projection. The ordinary unique-index admission check skips rebuilt tables at line 259, and survivor validation checks fields and text constraints without checking uniqueness.

An admissible three-generation trigger is:

1. Begin with ordinary `aTotals`, containing rows `{id: "legacy-a", group: "aa", value: 9}` and `{id: "legacy-b", group: "bb", value: 9}`, with unique `byGroup`. Keep `zTotals` empty and an event with group `"valid"`.
2. Install `maintain aTotals = count events by group`. Its projection adds ID `[{"String":"valid"}]`; both ordinary rows lawfully survive.
3. Retire `aTotals` into an ordinary table, widen its group to `text 2..2000`, add `unique byValue: value`, and install `maintain zTotals = count aTotals by group`.

Each generation respects the prohibition on maintained targets being sources. These declarations and the initial ordinary writes fit the supplied Quarry surface.

In table-name order, rebuilding `aTotals` removes its predecessor projection and preserves both legacy rows. Their field/text admission passes. Its successor projection is empty, so the new uniqueness loop finds nothing. Reindexing permits duplicate indexed values because SQLite’s index-entry primary key includes the row ID. The later `zTotals` rebuild produces valid, distinct groups and never checks `aTotals.byValue`. **Static conclusion:** installation succeeds with two surviving rows having unique key `9`.

Expected behavior is `E_SUCCESSOR_UNIQUE`, preserving the predecessor generation, rows, indexes and sequence—including rollback of an accompanying exact archive drop and refusal during changed-schema reopening. Validate uniqueness over **survivors plus the shared successor projection**, excluding exactly the rows being replaced. Preserve the lawful controls where replacement removes an old collision.

This hole also exists in `ecb`; it is **not introduced by this repair**. It remains within the requested survivor-admission/uniqueness scope. I have not executed this trigger against Runtime.

The other inspected interactions support the ordering repair:

- Predecessor ownership is captured before rebuilds and before exact migration drops. Each successor projection uses the transaction’s current rows, including materialized optional values.
- Admission and mutation consume the same projection and ownership union. Aggregate clearing/writing does not cascade, and later rebuilds cannot revisit that target or invalidate its replacement exemption.
- Required-source admission precedes projection; required-target exemptions cover only owned IDs. Changed text constraints and widened fields are checked while unrelated historical fields retain their compatibility treatment.
- Additive installation, exact migration and changed-schema reopening share the transactional rebuild. Typed successor refusals propagate through [registry.rs:1265](/Users/ccheever/clique-improvement/reviews/successor-widening-ordering-r3/astra/snapback2/crates/snapback2-core/src/registry.rs:1265); the scoped admission failures occur before commit.
- Both ordering controls are consistent with the documented sequential behavior: valid survivors remain, and a target built before source retirement actually replaces the exempted row.

I inspected the supplied evidence, including the certified baseline Runtime failures, baseline public violation and fixed public refusal. The fixed public observations preserve the predecessor and sequence `2`. The records contain **51 distinct passing selected Rust tests across preserved runs**, not one all-green command. The initial reopening assertion failure remains visible; its correction excludes only `Store::open`’s ownership stamp and retains generation/data/index/sequence comparisons. The original47/public evidence remains historical `ecb` evidence.

My executed analysis was read-only: all **2,082 leaf hashes**, both patch hashes, an in-memory application of `revision.patch` matching the four candidate files, **33 command-log bindings**, and **12 matching public compiled leaves** verified. I ran no product tests, builds, owners or suites.

Review command failures are retained: one here-document command failed because zsh could not create a temporary file; its Python retry emitted denied cache-write diagnostics and mistakenly treated archive provenance keys as paths. A subsequent Node audit correctly verified the file entries. Three searches returned exit `2` for guessed nonexistent source filenames; subsequent searches located the implementations. No deadlines were enlarged.

The supplied wrong-Cargo-directory failure, four public setup/API failures, reopening assertion failure and auxiliary 120-second/60-second wrapper discrepancy remain acknowledged. None is presented as my execution. This review makes no broad, production, scale, phone or publication claim.