# Duplicate-key allocation audit

`small_map::collect` and `try_collect` use `BTreeMap::insert`: the last value
wins, but the first equal key object survives. Rust 1.97's former bulk
`FromIterator` path keeps the last key object. Value equality and serialized
bytes alone cannot establish equivalence. This audit covers every production
`small_map::` invocation on the merged source, including native-only and web-only
paths, plus the separately changed ObjectFields/JSON constructors.

All owned helper keys here are `String`; the borrowed ones are `&String`.
Cloning a String (or materializing a str with `to_owned`) copies its contents
into a tight allocation on this toolchain: equal strings have equal capacity
after that operation. The identity-sensitive cases are existing borrowed String
objects, or moving owned strings with spare capacity into a constructor.

Paths below are relative to `snapback4/crates/`. No row assumes that arbitrary
hand-built schema/IR is valid: where repeated columns or names are possible,
the duplicate case is covered explicitly.

| # | Call site | Key source and duplicate case | Observable consequence / disposition |
| --- | --- | --- | --- |
| 1 | `snapback4-core/src/engine/components.rs:116`, `component_coverage` | Each plan field is cloned. Even repeated fields in hand-built metadata produce equal-capacity keys. | Last coverage value still wins. The returned map's text/capacity is unchanged; no original key identity survives cloning. Keep. |
| 2 | `snapback4-core/src/engine/maintains.rs:237` | Two distinct literal keys, `id` and `value`. | No duplicates or changed key choice; the row can enter meters safely. Keep. |
| 3 | `snapback4-core/src/engine/pages.rs:56`, `plan` | `returned_origins` returns a BTreeMap; filtering preserves its unique paths, moving each once. | Spare capacity may survive the move but no competing equal key exists. Keep. |
| 4 | `snapback4-core/src/engine/pages.rs:139`, `returned_origins` | Filtered `Program.args` BTreeMap keys, cloned without renaming. | Unique. Keep. |
| 5 | `snapback4-core/src/engine/pages.rs:211`, `expression_origin` | Object/Shape fields are a BTreeMap; keys are cloned without renaming. | Unique. Keep. |
| 6 | `snapback4-core/src/engine/pages.rs:311`, branch-origin intersection | Consumes the `yes` BTreeMap and filters using `no`. | Unique keys, each moved once. Keep. |
| 7 | `snapback4-core/src/engine/read_auth.rs:87`, `authorization_absence_covered` | `Index::columns()` clones component names; repeated columns can collide. | Equal cloned capacities; map is read by content to select prefix values, never by key identity/capacity. Keep. |
| 8 | `snapback4-core/src/engine/read_point.rs:85`, aggregate rule row | `Index::columns()` clones names; repeated columns can collide. | Row may feed authorization/metering, but equal cloned keys have equal capacities. Last value and row charge remain unchanged. Keep. |
| 9 | `snapback4-core/src/engine/read_point.rs:113`, live parent aggregate row | Same cloned `Index::columns()` names. | Row is metered later; cloned equal capacities preserve that price. Keep. |
| 10 | `snapback4-core/src/engine/read_point.rs:146`, absent aggregate zero | Same cloned `Index::columns()` names. Subsequent id/value insertions are unchanged. | Equal duplicate capacities preserve synthetic-row price; last value remains. Keep. |
| 11 | `snapback4-core/src/engine/row_views.rs:244`, `view_source_uniform` | Singleton borrowed key. | No duplicate key selection. Keep. |
| 12 | `snapback4-core/src/engine/row_views.rs:678`, `live_aggregate_inner` | Singleton borrowed source key. | No duplicate key selection. Keep. |
| 13 | `snapback4-core/src/engine/rules.rs:39`, `upsert_absence` | Borrows index component names; repeated equal columns could have distinct pointers/capacities. | **Different key object can survive**, but private temporary pins feed `prefix_visibility`, which compares `key.as_str()` and uses the last expression. It returns Visibility, never the pins/keys. No identity/capacity observer. Keep. |
| 14 | `snapback4-core/src/engine/rules.rs:49`, `prefix_decision` | Same borrowed component names with scalar prefix expressions. | **Different key object can survive**; `contains_key`, simplification and visibility use string equality and last expressions, not pointer identity/capacity. No key is returned as output. Keep. |
| 15 | `snapback4-core/src/engine/runner.rs:817`, non-SQLite `Expr::Object` | IR object fields are a BTreeMap; keys cloned without renaming. | Unique; expression evaluation order, first error and metered ObjectFields stay unchanged. Keep. |
| 16 | `snapback4-core/src/engine/through_read.rs:92`, `captured_aggregate_coverage` | Cloned `Index::columns()` names, replaced by cloned aliases when present. Different columns can alias to one name. | Equal cloned capacities and last values; only content lookup extracts group values, no key identity/capacity observation. Keep. |
| 17 | `snapback4-device/src/device.rs:498`, device open | `Program.name.clone()` for every backend program. Duplicate program names could collide. | Equal cloned capacities; private directory retrieves the last Program by name. Original Program/value identity is still the last value. Keep. |
| 18 | `snapback4-device/src/device.rs:598`, backend replacement | Same cloned program names. | Same as open; private name lookup, no key identity/capacity observer. Keep. |
| 19 | `snapback4-device/src/device/deferred.rs:126`, recording metadata | Store metadata keys have unique text; `metadata` also constructs every suffix with `to_owned`. | Even hypothetical repeated host entries produce equal-capacity keys; Recording uses textual metadata names and last values. Keep. |
| 20 | `snapback4-device/src/device/history.rs:37`, joined groups | `wire::HeldGroups` is a BTreeMap, names cloned without renaming. | Unique; fallible encoding still stops at the first error. Keep. |
| 21 | `snapback4-device/src/device/history.rs:96`, `coverage_state` | Borrowed index component names; repeated columns may reference different String objects. | **Different key object can survive**; private pins are looked up by audience column contents and only the last Value is cloned into a group. No key identity/capacity observation. Keep. |
| 22 | `snapback4-device/src/device/snapshot.rs:37`, retained held groups | Iterates an Option containing at most one `HeldGroups` BTreeMap. | Unique names, cloned once; this does not flatten multiple potentially overlapping maps. Keep. |

`ObjectFields::from_iter` is the exception: public `value::object` moves owned
String keys, so duplicates can retain different capacities. `Value::retained_heap`
charges those capacities, and `ObjectFields` dereferences to the public map.
Restored its former bulk constructor exactly. This also covers direct
`collect::<ObjectFields>()`, Rows and Maps using that constructor. Its
`From<BTreeMap>` and serde deserializer remain unchanged.

`wire::to_json` now delegates to `map_to_json`, but the source is a BTreeMap with
unique keys and every output key is cloned. No duplicate/identity case exists.
The JSON map remains ordered; this audit changes neither this path nor its bytes.

Result: only ObjectFields required a production change. The three borrowed-key
sites explicitly can select a different equal key object, but no current
consumer observes that identity or capacity. The helper is not a general drop-in
replacement for bulk collection; its module documentation now states the
restriction. Arbitrary new callers must respect it.
