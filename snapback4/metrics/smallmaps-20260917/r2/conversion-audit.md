# D2-R2 conversion classification

Checkpoint: `1fd3617702a184817f7b6b9194137aa544170a8b`. Performance and byte baseline: `70a663c22285dc3a5278ca9ac13db01bbe05446b`.

The rule in `smallmap.rs` now excludes all interpreter execution state. The brief also explicitly says to **keep** outer history/held maps and fixed-key dispatcher maps. Those contain runtime values, so they are recorded below as explicit exceptions, not relabelled as compiled structures. Inner row, group and principal collections stay B-trees. This follows the brief's specific keep-list; the universal sentence and that keep-list are not literally consistent.

The bytes column identifies a **shared sequential family contribution**, not independently additive per-site measurements. Generic methods are shared and gzip is nonlinear: assigning each site a separate byte count would invent precision. Measured family savings are g2 7,090 B, g3 10,006 B, g4 879 B and g8 1,922 B gzip. g1 is entirely removed. `families.py` rebuilds each cumulative family with all runtime reversions already in place and restores the candidate in `finally`; source variants and logs are under `target/d2/r2/`.

| Site | Classification | Disposition | Gzip bytes |
| --- | --- | --- | ---: |
| `value::ObjectFields`, `Value::Row`, `Value::Map` | Runtime values | Reverted; shared Arc/COW BTreeMap, exact `70a663c22` value.rs | 0 retained (g1 removed) |
| `Context.args`; job `Head.args` / enqueue / run; native read/chunk arguments; device `typed_args` / media inputs | Runtime argument values | Reverted | 0 retained |
| `Runner.env`, `Runner.consts` | Runtime execution bindings | Reverted; removed dedicated `$filter` slot and all slot dispatch | 0 retained |
| `Runner.read_tables`, `written_tables`, `pages`, `prediction_guards` | Runtime observations / per-execution page positions | Reverted | 0 retained |
| Presence dependencies, variables, guards and proof environment | Runtime preparation/execution state attached to Runner; meter charged per run | Reverted, including proofs | 0 retained |
| Read probe row fields | Runtime allocation per read | Reverted | 0 retained |
| `rules::{scan_visibility,prefix_visibility,rule_true,simplify_prefix}` pinned maps | Allocated in runtime read analysis as well as static analysis | Reverted everywhere | 0 retained |
| `history::retained_group` pinned columns | Runtime per-read values | Reverted | 0 retained |
| Write / write-target / maintain / native-update / wire row-field builders; assets | Runtime row/map values | Reverted | 0 retained |
| `Schema.tables/operations/unique_refusals/action_specs/effect_specs/routes` (both levels of unique refusals) | Compiled schema | Kept | g2 shared 7,090 |
| `Table.columns/defaults/indexes` | Compiled schema | Kept | g2 shared |
| `Maintain.computed`, `ActionSpec.returns` | Compiled declaration | Kept | g2 shared |
| `Program.args` | Declared argument **types** | Kept | g2 shared |
| `Expr::Object`, `Expr::Shape.fields` | Compiled expressions | Kept | g2 shared |
| `pages::Plan.returns/collectors`; `Origin::Record`, bindings, origins, write counts | Static syntax analysis, constructed before execution | Kept | g3 shared 10,006 |
| `page_collectors::Names/Paths` and `Flow` visited/result sets | Backward syntax analysis of collector sites, not a running collector's rows | Kept | g3 shared |
| `admission::Flow.env/bindings` | Static admission analysis | Kept | g3 shared |
| `prefetch::Plan.sites` | Static site plan | Kept | g3 shared |
| `prefetch::Env.keys`, mutation/write counts, `probes` pinned columns | Static expression origins / statement counts / rule-template analysis used only by `plan` and `admit` | Kept | g3 shared |
| Prefetch execution `fill`, request/result caches and row keys | Runtime values | No converted maps here; existing B-trees/vectors retained | 0 converted |
| Running page collectors | Runtime arrays in `Runner.env` plus `Runner.pages` | B-tree environment/pages restored; metered arrays unchanged | 0 retained |
| `Engine.programs`, `PostgresEngine.programs`, `Device.programs` and replay's program reference | Installed compiled programs | Kept, with one shared non-generic `ir::program_map` sort before collection | g4 shared 879 |
| Device install metadata / native invalidation / adoption expected captures / dispatcher `adopt` / install signatures | Runtime values under fixed engine keys; explicit keep-list exception | Kept | g4 shared |
| `history::Groups` outer table map | Runtime history under schema table keys; explicit keep-list exception | Kept; inner groups remain BTreeMap | g8 shared 1,922 |
| `snapshot::held` outer table map | Runtime snapshot holdings under schema table keys; explicit keep-list exception | Kept; inner groups remain BTreeSet | g8 shared |
| `wire::HeldGroups`, server/device stream `joined`, `partition::holdings` outer table maps | Runtime holdings under schema table keys; explicit keep-list exception | Kept; group vectors/sets unchanged | g8 shared |

Never converted: memory rows/indexes/staging/outbox/base/meta/dirty state, created rows and keys, dynamic grouping, merge deduplication, partition intervals, and PostgreSQL request/result caches. No row, map value, argument value, runner environment or execution observation remains a SmallMap/SmallSet.

## Construction and identity

Unsorted program vectors are possible at server/device activation. All six construction sites now call `ir::program_map`: Engine new/new_release/adopt, Postgres activation, device open/adopt. It performs the existing standard stable sort by String name in **one non-generic Program-vector instantiation**, then appends sorted entries. Stable sorting preserves last-wins duplicate names. It does not introduce a generic sort in SmallMap or a shared permutation helper.

Schema has no server-provided table vector to convert: it is a map in the backend image. The server's schema serializer emits sorted entries, as the ordered identity pins verify; persisted backend/schema images have the same property. Compiler table construction walks `Catalog.tables`, already a BTreeMap; other binder maps convert from ordered B-trees. Direct callers may still deserialize arbitrary out-of-order map JSON (covered by the differential tests); this is not the server-provided vector path and no input is silently rejected or reformatted. Serde plumbing is unchanged.

`git diff 70a663c22 -- snapback4/crates/snapback4-core/src/value.rs` is empty. The same is true for engine read/runner/prediction/write/write_target/maintains/native/job/validate/rules/presence and assets. `wire.rs` differs only in the explicitly retained HeldGroups alias. All `.to_row()` and dual-field-wrapper changes have gone.
