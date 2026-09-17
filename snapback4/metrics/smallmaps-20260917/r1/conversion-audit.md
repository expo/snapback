# D2-R1 conversion audit

Base `109efbf4b3c37b4e4a2e853d009240a0bdd506d2`. The bound is authored schema/program text or a small fixed constant, never elapsed time, traffic, principal count, or rows. This table covers every production conversion in D2; imports and test constructors adapting to those types do not introduce separate collections.

| Converted site | Bound / decision |
| --- | --- |
| `value::ObjectFields` (`Value::Row`) | Declared table columns or authored object/shape fields; keep small and Arc/COW. |
| `Value::Map`, including JSON args, JSON columns, route envelopes, assets and nested objects | Keys come from data; restored to Arc/COW `BTreeMap` as `MapFields`. Fixed-shape assets use the same representation. |
| `ir::Program.args` | Declared argument names. |
| `ir::Expr::Object` | Authored object field names. |
| `ir::Expr::Shape.fields` | Authored shape field names; optional `pending` is one extra fixed field. |
| `schema::Schema.tables` | Authored tables, including compiler-generated tables. |
| `Schema.operations` | Authored operations. |
| `Schema.unique_refusals` (both levels) | Authored tables and their declared unique constraints. |
| `Schema.action_specs` | Authored actions. |
| `Schema.effect_specs` | Authored effects. |
| `Schema.routes` | Authored routes. |
| `schema::Table.defaults` | Declared column names. |
| `Table.columns` | Declared column names. |
| `Table.indexes` | Declared/generated index names. |
| `schema::Maintain.computed` | Authored computed column names. |
| `schema::work::ActionSpec.returns` | Declared result field names. |
| `engine::Context.args`, job `Head.args` and job/native/device argument maps | Declared program arguments; validators reject extras; native/device wire conversion visits declared names. |
| `engine::Engine.programs` | Backend program names. Reverse 1,000-program construction measured separately, below a few milliseconds; keep small. |
| `engine::postgres::PostgresEngine.programs` | Same backend program-name bound. |
| `Runner.env` | Program arguments, locals, compiler temporaries and merge lane bindings. `$filter` now lives in one dedicated slot. |
| `Runner.consts` | Authored constant bindings. |
| `Runner.read_tables` | Schema table names, not read rows. |
| `Runner.written_tables` | Schema table names, not written rows. |
| `Runner.pages` | Authored scan/merge sites; each execution replaces the same site, including word lanes. No cursor/page identity key. |
| `Runner.prediction_guards` | Authored conditional sites in the execution fact. |
| `presence::Dependencies` (reads, guard, variable dependency values, emissions) | Distinct principals are data; restored to `BTreeMap<String, Option<i64>>`. |
| `EffectPresence.variables` | Program variable names; the dependency values themselves are B-trees. |
| `EffectPresence.guards` | Authored conditional sites. |
| `presence::Proofs` | Program variable names in static analysis. |
| `rules` pinned-column maps | Index components declared in the schema. |
| `read` probe row fields | Declared index columns. |
| `write_target`, `maintains`, native `update`, `wire::row_from_json` field maps | Validated schema columns; generated maintain rows have fixed declared columns. |
| `pages::Origin::Record` | Authored returned record fields. |
| `pages::Bindings`, write counts, nested/changed/return origins | Static program bindings and statement sites, not executed iterations. |
| `pages::Plan.returns` | Authored return sites. |
| `pages::Plan.collectors` | Authored collector-loop sites. |
| `page_collectors::Names` | Authored binding plus field path. |
| `page_collectors::Paths` | Authored statement paths; no row/cursor keys. |
| `prefetch::Plan.sites` | Authored loop sites. |
| `prefetch::Env.keys` | Static variable names associated with key expressions, not evaluated row keys. |
| `prefetch` mutation/write-count maps | Authored variable names. |
| `prefetch::probes` pinned maps | Declared index columns. Actual PostgreSQL prefetch request/result caches remain B-trees. |
| `admission::Flow.env` and `bindings` | Authored locals/parameters, analyzed once; origins contain static scans. |
| `device::Device.programs` | Server-provided backend program text. |
| Device install/adopt metadata, `invalidate_native`, store install signatures | Fixed engine metadata keys; no growing metadata store converted. |
| Device dispatcher `adopt.expected` and `adopt_captured.expected` | Two request fields plus fixed engine capture keys (four distinct keys total). |
| `history::Groups` outer map | Schema table names. |
| `history::Groups` inner map | Held/left groups accumulate over time; restored to B-tree. Test builds wrap the same String ordering solely to count comparisons. |
| `history::retained_group` pinned map | Declared index components. |
| `snapshot::held` outer map | Schema table names; each table's group set stays a `BTreeSet`. |
| `wire::HeldGroups`, server/device `StreamPage.joined` | Schema table names; group lists remain vectors, not small maps. |
| `partition::holdings` outer map | Schema table names; row/group sets stay B-trees. |

Also checked (never converted): `Runner.created` and `created_rows` are B-trees keyed by row/key facts; `inserted` and event/outbox vectors remain vectors; dynamic grouping positions and merge deduplication stay B-trees; PostgreSQL prefetch requests/results, partition interval/group maps, and device memory rows/index entries/staged/outbox/base/meta/dirty state remain B-trees. No row id, group id, principal, cursor, or request-id collection remains small.

For transient bindings, the ordinary 8,192-iteration loop shifts **8 / 768 entries total** at widths 8 / 768: one insertion followed by replacements. Merge lane bindings and their setup locals have the same first-insert/replace behavior, bounded by authored names. Page collectors hold static names/sites and push row values into the existing metered vector. Counterfactual untaken arms restore missing bindings, so one such name moves at most **2 × width entries per iteration**: at width 768, **1,536 × 56 = 86,016 bytes** per iteration, or **704,643,072 bytes over 8,192 iterations**. The scale test measures that path and asserts the exact shift count; this remaining program-width × rows trade is explicit, as the disposition permits.
