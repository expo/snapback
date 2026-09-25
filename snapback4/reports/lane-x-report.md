# Lane X — Quarry at SQL’s learning cost

Date: 2026-09-25. Branch: `sb4-intent/x-familiar`. Baseline: `f5efae87f`. Implements the assigned LLP 3000.013 lane; no design or authorization changes. Commits remain local.

## Result and measurement

`guide from-sql` (aliases `sql`, `convex`, `rosetta`) maps SQL/RLS and Convex idioms onto compiled Quarry examples. Repeated `where` combines with `and`; `m.helper(...)` resolves the helper declared in `m.q`; a filtered row compared with itself is refused with a named-key repair. Foreign count/limit spellings stay refusals.

Counts are whitespace-delimited words in rendered cards, including headings, examples and comments. Opening means everything before the new `## Limits`. The old cards lacked a common Limits marker, so the checked baseline ends at the first reference boundary recorded in `guide-before.json`: language at `With use server`, programs at `Operations`, reads at `Nullable predicates`, types at `Tables`, and the full shapes/writes cards. Prose-only opening reductions also exceed two thirds.

| Card | All words before → after | Reduction | Opening before → after | Reduction |
| --- | ---: | ---: | ---: | ---: |
| language | 5,686 → 4,798 | 15.6% | 4,059 → 128 | 96.8% |
| programs | 1,266 → 478 | 62.2% | 627 → 135 | 78.5% |
| reads | 3,933 → 1,843 | 53.1% | 1,715 → 168 | 90.2% |
| shapes | 1,415 → 532 | 62.4% | 1,415 → 93 | 93.4% |
| writes | 3,987 → 2,037 | 48.9% | 3,987 → 211 | 94.7% |
| types | 2,013 → 729 | 63.8% | 737 → 125 | 83.0% |
| **Total** | **18,300 → 10,417** | **43.1%** | | |

All 17 original compiled Quarry blocks are byte-for-byte preserved and checked by SHA-256. The 133 original prose fact fragments have exact, whitespace-normalized rendered homes: 79 in `why`, 54 in Details. The six cards’ prose alone falls from 13,009 to 4,939 words (62.0%). All 207 registered `why` pages fit 4,096 UTF-8 bytes including the final newline; the largest default authored page is `E_STRUCTURAL_FANOUT` at 4,039 bytes; the overall maximum remains the existing `E_STORE_RESTORE` page at 4,095 bytes.

## Forms that compile and run

| Form | Example | Meaning verified |
| --- | --- | --- |
| Repeated predicate | `members where .conversation = chat where .active first 20 by .principal after c` | Same rows and server meters as a conjunction; short-circuiting and OR grouping preserved. |
| Qualified helper | `m.twice(x)` for `fn twice(x: int): x + x` in `m.q` | Same result as `twice(x)`; nested calls resolve; wrong module names the owner; write/recursion admission unchanged. |
| Nested roster | `members where .principal = viewer first 20 by .conversation after c { conversation, roster: members[conversation = .conversation] }` | The inner key uses the outer conversation; each roster contains only its own members. |
| Required helper argument | `label(members[id] ! else NOT_FOUND)` | A present row reaches the helper; a missing/hidden row refuses. |
| Canonical count/page | `count(x)`; `count(members)`; `members where .principal = viewer first 20 after c` | Existing spellings remain the only accepted forms. |

Native engine tests execute the first three forms and compare exact metering. A CLI-backed production SDK witness seeds two conversations and private notes, then executes compiled queries fully offline on wasm/memory and native/SQLite; it compares the server result, verifies inner binding, excludes the other owner’s note, explicitly passes a foreign owner through a qualified read helper and requires null before projection, tests short-circuiting, qualified/bare helpers, counting and nullable lookup repairs. Compilation refusals run on the native CLI; wasm consumes its admitted IR rather than a Quarry compiler.

## Guess replay

Full inputs and reconstruction provenance: [guesses.json](../crates/snapback4/tests/familiar/guesses.json). Exact native `check --json` results, sites, rewrites, exit statuses and binary digests: [lane-x-guess-replay.json](lane-x-guess-replay.json). The before binary was built from an archive of the exact starting revision `f5efae87f`, not another lane. The after binary is this lane.

| Guess | Before | After / single repair |
| --- | --- | --- |
| `len` | E_QUARRY_UNSUPPORTED, E_QUARRY_SYNTAX | Still refused; `count(x)`; mechanical `check --fix` retained. |
| `qualified-helper` | E_QUARRY_SYNTAX | Compiles with declaration-file ownership. |
| `aggregate` | E_QUARRY_SYNTAX | `E_QUARRY_UNSUPPORTED`; `view totals: count members by .conversation`. |
| `repeated-where` | E_QUARRY_SYNTAX | Compiles as `and`, preserving written order. |
| `nested-roster` | Compiles (inner predicate binds itself) | `E_QUARRY_SELF_EQUALITY`; `members[conversation = .conversation]`. |
| `two-sync-lines` | E_QUARRY_SYNTAX | Still refused; keep one audience matching the read rule. |
| `nullable-helper` | E_QUARRY_TYPE | Still typed as optional; assert the argument once with `! else NOT_FOUND`. |
| `length-property` | E_QUARRY_TYPE | `E_QUARRY_UNSUPPORTED`; `count(x)`. |
| `count-star` | E_QUARRY_SYNTAX | `E_QUARRY_UNSUPPORTED`; `count(members)` (name the intended read). |
| `limit` | E_QUARRY_SYNTAX | `E_QUARRY_UNSUPPORTED`; `first 20` or `last 20`. |
| `wrong-module` | E_QUARRY_SYNTAX | `E_QUARRY_UNKNOWN`; `m.helper(x)` names the actual owner. |

Every repaired fixture compiles. The JSON retains parser cascades, rather than hiding them from the evidence. Calibration #20’s original failed checks were overwritten by successful checks; its `len`, qualified-helper and aggregate guesses are labelled reconstructions. Comparative M5/M8 retain diagnostic text and final source; M3’s nested roster and duplicate sync forms are reconstructed from the diary and final helper.

Reproduce from `snapback4/`: `node scripts/replay-familiar.mjs target/lane-x-before-build/debug/snapback4 target/debug/snapback4 reports/lane-x-guess-replay.json`. The baseline source was obtained with `git archive f5efae87f snapback4` under ignored `target/lane-x-before/` and built into the separate `target/lane-x-before-build/`. Neither evidence lane was modified.

## Tests added and changed

| Test / file | What it proves |
| --- | --- |
| `snapback4-lang/tests/familiar_guesses.rs`: nested roster | Two groups stay separate; repeated predicates and conjunctions have identical data/meters; OR precedence and nested helper results. |
| Same: self-equalities | Direct, boolean-nested and object-nested tautologies, plus view branches, receive the located rewrite; ordinary argument equality remains legal. |
| Same: repeated predicates | Division guard short-circuits; other duplicate read modifiers remain refused. |
| Same: qualification | Correct file ownership, wrong-module repair, unchanged write placement and recursion limits. |
| Same: foreign spellings | `len`, `.length`, `count(*)`, `limit`, aggregate guess refused; repaired forms compile; real object fields named `length` still compile. |
| Same: nullable helper / sync | Assertions fix required arguments; duplicate sync gives an audience-preserving repair. |
| `snapback4/tests/familiar.rs` | Eleven real CLI guesses and repaired files; code/site/rewrite checks, reachable bounded `why`, and unchanged mechanical len repair. |
| `packages/snapback4/test/familiar-forms.test.mjs` | Server/native/wasm behavior and per-source disclosure, including fully offline device reads. |
| `snapback4-lang/tests/guide/familiar.rs` | Exact rendered fact homes, byte bounds, 17 original example hashes, opening/total word targets, aliases and requested Rosetta coverage. |
| Existing guide tests | Original runtime and repair facts now checked at their new homes; examples located by content when the first example changes. |
| `packages/snapback4/test/readme-examples.test.mjs` | Preserve the planner fact by checking rendered `why N_SPARSE_FILTER`; all six tests pass. |
| Existing CLI check tests | New card list; independent-error counts remain unchanged. |
| Existing ergonomics test | New one-step nullable assertion wording and its compiling repair; old guarded form still checked. |
| Authorization census | Reconcile added/reordered examples: 521 → 580 entries; after ignoring block numbers, no old fact disappears and 15 rows are added. All existing lifecycle/outcome tests remain intact. |

## Moved-fact mapping

Each ID identifies the exact original text in [guide-fact-homes.json](../crates/snapback4-lang/tests/fixtures/guide-fact-homes.json); the test searches the actual rendered `why` page under every possible guide context, or the card after `## Details`, not an unused source constant. Splits preserve complete sentences or bullet items.

| Original fact ID | Opening words | Rendered home |
| --- | --- | --- |
| language-00 | Quarry defines your tables, access rules and backend operations. Queries… | `guide language` → Details |
| language-01 | One file, snapback/schema.q, holds tables, views, shapes, helpers, programs and… | `guide language` → Details |
| language-02 | Time arithmetic uses durations: now + 1m is one minute… | `guide language` → Details |
| language-03 | createRoom above predicts: its room is readable through the membership… | `guide language` → Details |
| language-04 | Helpers expand at each call: a table-typed parameter keeps a… | `why E_QUARRY_TYPE` |
| language-05 | Reads: t[id] reads one row; t[a, b] needs one declared… | `guide language` → Details |
| language-06 | Values: viewer (a principal), now (a time; in a mutation… | `why E_TYPE` |
| language-07 | xs = [] then xs = xs + [value] appends… | `guide language` → Details |
| language-08 | sha256 is for high-entropy capability tokens and content checksums. It… | `guide language` → Details |
| language-09 | unique principal, day(at) enforces calendar uniqueness. search body declares word-prefix… | `guide language` → Details |
| language-10 | One use server in any module (schema.q is usual) enables… | `why E_SERVER_REQUIRED` |
| language-11 | E_INIT_CONFLICT means init found files or package entries it would… | `why E_INIT_CONFLICT` |
| language-12 | For a present row, { ...p, extra } and p… | `why E_QUARRY_DUPLICATE_FIELD` |
| language-13 | E_QUARRY_SYNTAX means the parser could not read the form at… | `why E_QUARRY_SYNTAX` |
| language-14 | E_QUARRY_UNKNOWN means a name cannot be resolved in this scope:… | `why E_QUARRY_UNKNOWN` |
| language-15 | - while and recursion → for over a page, list,… | `why E_QUARRY_UNSUPPORTED` |
| language-16 | Ordinary field access propagates null: row.body is null when row… | `why E_QUARRY_UNSUPPORTED` |
| language-17 | - Guessed spellings are refused with a canonical rewrite; snapback4… | `why E_QUARRY_UNSUPPORTED` |
| language-18 | Maintained columns put an aggregate on the row it describes.… | `why E_MAINTAINED_COLUMN` |
| language-19 | Cards: snapback4 guide <keyword> — app, types, indexes, maintains, rules,… | `guide language` → Details |
| language-20 | E_QUARRY_UNSUPPORTED means the guessed construct is not a Quarry form.… | `why E_QUARRY_UNSUPPORTED` |
| language-21 | E_ID_REUSED means the request ID already belongs to another operation… | `why E_ID_REUSED` |
| language-22 | For a public Following feed, see guide feeds. Materialization requires… | `guide language` → Details |
| language-23 | A predicate states which rows belong in a read. by… | `guide language` → Details |
| language-24 | The public activity union supplies a private delivered feed for… | `guide language` → Details |
| language-25 | Existing explicit indexes, merges, fixed chunks, aggregates and timelines keep… | `guide language` → Details |
| language-26 | An unread count can use the same expiring receipts as… | `guide language` → Details |
| programs-00 | Queries read data; mutations change it in one transaction. Jobs… | `guide programs` → Details |
| programs-01 | A mutation with predicts: "never" (a server site or :… | `why E_STRUCTURAL_FANOUT` |
| programs-02 | The table names are the language card's; a job is… | `why E_QUARRY_PLACEMENT` |
| programs-03 | The backend is one file (more .q files beside it… | `guide programs` → Details |
| programs-04 | **Two ways to run.** snapback4 init starts local-first: declare sync… | `guide programs` → Details |
| programs-05 | E_INTERNAL means the interpreter reached an undefined compiler temporary. It… | `why E_INTERNAL` |
| programs-06 | E_OP means the requested operation or route does not exist,… | `why E_OP` |
| programs-07 | E_OP_RESERVED means an application's refusal code starts with the platform's… | `why E_OP_RESERVED` |
| programs-08 | E_QUARRY_PLACEMENT means a statement is valid only in another context.… | `why E_QUARRY_PLACEMENT` |
| programs-09 | E_EMIT_IN_QUERY means a query tried to enqueue an external effect.… | `why E_EMIT_IN_QUERY` |
| reads-00 | Reads select authorized rows by id, predicate or search text.… | `guide reads` → Details |
| reads-01 | State the rows, then the order and page. messages where… | `guide reads` → Details |
| reads-02 | For a table, order keys after id are redundant and… | `why E_CURSOR_INDEX` |
| reads-03 | Unpaged aggregates infer a range seek only when its endpoint… | `why N_SEEK` |
| reads-04 | Finite ranked windows enumerate inclusive UTC buckets: bucket(lower) ..= bucket(upper).… | `why N_SPARSE_FILTER` |
| reads-05 | A full positional unique key can be followed by named… | `why E_QUARRY_KEY_ORDER` |
| reads-06 | Every ready Read carries cut: 'meter' \| 'words' \| null… | `guide reads` → Details |
| reads-07 | A read denied by a table's rule answers as an… | `why E_RULE` |
| reads-08 | Named equalities covering a total unique key read one row… | `why E_QUARRY_AMBIGUOUS` |
| reads-09 | References keep their table identity: replies[id = r] with r:… | `why E_QUARRY_POSITIONAL_SCAN` |
| reads-10 | For an expiring table, return the deadline with each row:… | `guide reads` → Details |
| reads-11 | A typing indicator or presence row with a short deadline… | `guide reads` → Details |
| reads-12 | Clear these timers with timers.forEach(clearTimeout) before replacing the answer or… | `guide reads` → Details |
| reads-13 | For example, this typing indicator lasts 4,500 ms after the… | `guide reads` → Details |
| reads-14 | The first read examples use the language card's tables. A… | `why N_NEVER_COMPLETE` |
| reads-15 | Inside where, an ordering comparison (<, <=, >, >=) with… | `why N_SEEK` |
| reads-16 | For a required enum with at most eight variants, .status… | `guide reads` → Details |
| reads-17 | Optional filters (status = null or .status = status) (also… | `why N_OPTIONAL_FILTER_LIMIT` |
| reads-18 | check --cost displays the residual that still tests each visible… | `guide reads` → Details |
| reads-19 | A page a query returns without a cursor cannot be… | `why N_NO_CURSOR` |
| reads-20 | A boundless domain read uses the schema cap in ascending… | `why E_QUARRY_BOUND` |
| reads-21 | count(messages where .roomId = roomId) and sum(orders where .owner =… | `guide reads` → Details |
| reads-22 | exists messages where .roomId = roomId stops at a visible… | `guide reads` → Details |
| reads-23 | Finite ranked windows use inclusive UTC buckets from the lower… | `why N_SPARSE_FILTER` |
| reads-24 | A resumable read-meter cut after every required head is known… | `guide reads` → Details |
| reads-25 | A direct table or maintained-view cursor binds the evaluated prefix… | `why E_CURSOR_INDEX` |
| reads-26 | A top-level returned shape carries its page's next. A shaped… | `why E_SHAPE_EXCEEDS_METER` |
| reads-27 | A mutation classified predicts: "never", from a server site or… | `why E_UNBOUND_LOOP` |
| reads-28 | A job may put a read-only prelude before its first… | `guide reads` → Details |
| reads-29 | Arguments use column types; c: cursor ? is an opaque… | `guide reads` → Details |
| reads-30 | Web queries and predictions trust the backend compiler's structural admission;… | `why E_UNBOUND_SCAN` |
| reads-31 | A bounded list loop that only reads, computes and emits… | `why E_UNBOUND_LOOP` |
| reads-32 | To inspect a real account's server work under loopback dev,… | `guide reads` → Details |
| reads-33 | Declare query name(..) held: for a device-only answer. check prints… | `why E_QUERY_HELD` |
| reads-34 | E_QUARRY_POSITIONAL_SCAN means a positional key would scan a population. Use… | `why E_QUARRY_POSITIONAL_SCAN` |
| reads-35 | E_QUARRY_MODIFIER_SCOPE means a nested read's modifiers are ambiguous. Parenthesize the… | `why E_QUARRY_MODIFIER_SCOPE` |
| reads-36 | N_SEEK is advice for an older explicit-index read whose residual… | `why N_SEEK` |
| shapes-00 | Shapes choose the fields returned from a row or page.… | `guide shapes` → Details |
| shapes-01 | { ...p, extra: true } copies a present row or… | `why E_QUARRY_SPREAD` |
| shapes-02 | An object spread's wildcard follows field order; when shaping an… | `why E_QUARRY_SHAPE_JOIN` |
| shapes-03 | Only simple conditionals or two-value reassignments of row locals or… | `why E_QUARRY_SHAPE_JOIN` |
| shapes-04 | Here listing is the expanded object, or null for a… | `guide shapes` → Details |
| shapes-05 | In the first example, table and shape names are the… | `guide shapes` → Details |
| shapes-06 | guide reads owns paging and continuation; guide programs owns helpers.… | `guide shapes` → Details |
| shapes-07-1 | shape card = { id, name, owner: .ownerId } names… | `why E_QUARRY_PLACEMENT` |
| shapes-07-2 | The rule applies only to a query's top-level returned shape… | `why E_SHAPE_EXCEEDS_METER` |
| shapes-08 | A program's prefix exists is a top-1 scan below the… | `why E_STRUCTURAL_FANOUT` |
| writes-00 | Mutations insert, update and delete rows in one transaction. Rules… | `guide writes` → Details |
| writes-01 | If messageId in writeForms addresses retained history from a room… | `guide writes` → Details |
| writes-02 | For replay adapters and retry-safe intents, pass a mintId() you… | `why E_WRITE_ID` |
| writes-03 | Reusing an id with different operation names or JSON arguments… | `why E_WRITE_ID_REUSE` |
| writes-04 | Writes that do not predict show pending with usePendingWrite(op) from… | `guide writes` → Details |
| writes-05 | client.acquired and useAcquired() report completed snapshot and catch-up for the… | `guide writes` → Details |
| writes-06 | upsert set-state writes (likes, reactions and votes) predict updates of… | `why E_PREDICT` |
| writes-07 | NOT_FOUND means a point write has no target, or a… | `why NOT_FOUND` |
| writes-08 | An alternate-key delete of a missing row refuses NOT_FOUND locally… | `why NOT_FOUND` |
| writes-09 | For after insert <- exists t[key], a local hit satisfies… | `why E_CONSTRAINT` |
| writes-10 | Defaults fill missing insert columns on the writing host, including… | `why E_INPUT` |
| writes-11 | For update/upsert, "readable" means the read rule admits the old… | `why NOT_FOUND` |
| writes-12 | E_INPUT means an argument or row value does not fit… | `why E_INPUT` |
| writes-13 | E_CONFLICT means a conditional update found that the row changed.… | `why E_CONFLICT` |
| writes-14 | E_QUARRY_WRITE_TESTS means a write target includes tests beyond its unique… | `why E_QUARRY_WRITE_TESTS` |
| writes-15 | \| Target before the write \| Refusal details \| \|… | `why NOT_FOUND` |
| writes-16 | A hidden collision on ordinary insert or insert ... if… | `why NOT_FOUND` |
| writes-17-1 | The table names are the language card's. A final write… | `why E_INPUT` |
| writes-17-2 | The recorded body is the replay body, with value-free diagnostic… | `why E_ID_REUSED` |
| writes-17-3 | On the web, admission waits for the IndexedDB commit; pagehide… | `guide writes` → Details |
| writes-17-4 | A reference column checks the id's shape, not that its… | `why E_INPUT` |
| writes-18 | An exists or count check sees only rows its viewer… | `guide writes` → Details |
| writes-19 | firstDay and lastDay are calendar-day numbers in the app's chosen… | `guide writes` → Details |
| writes-20 | The availability table is deliberately public: a named unique refusal… | `guide writes` → Details |
| writes-21 | at has millisecond ties; client-minted ids order creation, not arrival… | `guide writes` → Details |
| writes-22 | Pass the returned next as c to page newest first… | `guide writes` → Details |
| writes-23-1 | old in a rule and the conditional update's if are… | `why E_CONFLICT` |
| writes-23-2 | A missing upsert predicts its insert when the synced group… | `why E_NOT_PREDICTABLE` |
| writes-23-3 | The at-most-once record stores the replay body, with value-free diagnostic… | `why E_ID_REUSED` |
| types-00 | Types describe the values a column or argument accepts. They… | `guide types` → Details |
| types-01 | text defaults to text <=10000 characters in columns, arguments and… | `guide types` → Details |
| types-02-1 | ? after a type makes it optional: null when absent,… | `why E_QUARRY_TYPE` |
| types-02-2 | A column may end with default <literal \| now \|… | `why E_ADOPT` |
| types-02-3 | Pages, lists and shaped collections share the list operations: sort,… | `why E_TYPE` |
| types-03 | For complete index, rule and expiry recipes, open guide indexes,… | `guide types` → Details |
| types-04-1 | - Every table has an implicit unique id.… | `guide types` → Details |
| types-04-10 | A maintained view over an expiring table subtracts its unswept… | `why E_QUARRY_MAINTAIN_EXPIRE` |
| types-04-2 | - **Types:** principal, id, <table> (a reference to that table's… | `why E_INPUT` |
| types-04-3 | - **References** are typed ids, with no implicit existence check… | `why E_INPUT` |
| types-04-4 | - **Keys and search:** unique handle or unique postId, principal… | `guide types` → Details |
| types-04-5 | - **Constraints:** cap N by cols (at most N rows… | `guide types` → Details |
| types-04-6 | - **Rules:** read, insert, update, delete, each <- one expression… | `why E_QUARRY_LIVE_MAINTAIN_PROBE` |
| types-04-7 | - **Sync** (guide sync) and **retain**: retain until-revoked (the default:… | `guide types` → Details |
| types-04-8 | - **Expire:** expire at .expiresAt (a time ? column; its… | `why E_CONSTRAINT` |
| types-04-9 | An already returned answer keeps the row until the next… | `guide types` → Details |
| types-05 | E_TYPE means a runtime value has the wrong kind for… | `why E_TYPE` |
| types-06 | E_OVERFLOW means integer arithmetic left the value model's range of… | `why E_OVERFLOW` |
| types-07 | E_FIELD means a runtime field selection has no such field.… | `why E_FIELD` |
| types-08 | E_QUARRY_TYPE means the expression's type does not fit its position.… | `why E_QUARRY_TYPE` |

## Files built or changed

Paths below are relative to `snapback4/`. Each `why/*.md` file owns the bounded diagnostic detail named by its filename.

| File | Change |
| --- | --- |
| [crates/snapback4-device/tests/readauth/census.txt](../crates/snapback4-device/tests/readauth/census.txt) | Reviewed added/reordered compiled-guide mutation inventory. |
| [crates/snapback4-lang/src/bind/helper_names.rs](../crates/snapback4-lang/src/bind/helper_names.rs) | Resolve file-qualified helpers before all downstream planning and authorization analysis. |
| [crates/snapback4-lang/src/bind/mod.rs](../crates/snapback4-lang/src/bind/mod.rs) | Invoke helper normalization before the existing binder passes. |
| [crates/snapback4-lang/src/bind/program/control.rs](../crates/snapback4-lang/src/bind/program/control.rs) | Print a one-evaluation assertion for nullable required helper arguments. |
| [crates/snapback4-lang/src/bind/program/expr.rs](../crates/snapback4-lang/src/bind/program/expr.rs) | Refuse collection/text .length without disturbing real fields. |
| [crates/snapback4-lang/src/diag.rs](../crates/snapback4-lang/src/diag.rs) | Route the new refusal to shapes. |
| [crates/snapback4-lang/src/guide.rs](../crates/snapback4-lang/src/guide.rs) | Register the Rosetta aliases and dedicated why pages; locate the preserved core example. |
| [crates/snapback4-lang/src/guide/codes.rs](../crates/snapback4-lang/src/guide/codes.rs) | Register E_QUARRY_SELF_EQUALITY and render full authored why details within the tested byte bound. |
| [crates/snapback4-lang/src/guide/from_sql.md](../crates/snapback4-lang/src/guide/from_sql.md) | Complete compiled SQL/RLS and Convex Rosetta card. |
| [crates/snapback4-lang/src/guide/language.rs](../crates/snapback4-lang/src/guide/language.rs) | Small paved entry, new forms and preserved complete reference examples. |
| [crates/snapback4-lang/src/guide/programs.rs](../crates/snapback4-lang/src/guide/programs.rs) | Program example first; retain app layout details and move admission proofs. |
| [crates/snapback4-lang/src/guide/reads.rs](../crates/snapback4-lang/src/guide/reads.rs) | Predicate/page example first; preserve continuation/client details and move planner/proof explanations. |
| [crates/snapback4-lang/src/guide/refusals.rs](../crates/snapback4-lang/src/guide/refusals.rs) | Explain the dedicated why-page source and existing output bounds. |
| [crates/snapback4-lang/src/guide/shapes.rs](../crates/snapback4-lang/src/guide/shapes.rs) | Named-key nested roster first; move join/repair eligibility detail. |
| [crates/snapback4-lang/src/guide/types.rs](../crates/snapback4-lang/src/guide/types.rs) | Required/optional/default example first; preserve complete type example and move validation details. |
| [crates/snapback4-lang/src/guide/why.rs](../crates/snapback4-lang/src/guide/why.rs) | Static registry of the 51 authored diagnostic pages. |
| [crates/snapback4-lang/src/guide/why/E_ADOPT.md](../crates/snapback4-lang/src/guide/why/E_ADOPT.md) | Dedicated explanation: types-02-2. |
| [crates/snapback4-lang/src/guide/why/E_CONFLICT.md](../crates/snapback4-lang/src/guide/why/E_CONFLICT.md) | Dedicated explanation: writes-13, writes-23-1. |
| [crates/snapback4-lang/src/guide/why/E_CONSTRAINT.md](../crates/snapback4-lang/src/guide/why/E_CONSTRAINT.md) | Dedicated explanation: writes-09, types-04-8. |
| [crates/snapback4-lang/src/guide/why/E_CURSOR_INDEX.md](../crates/snapback4-lang/src/guide/why/E_CURSOR_INDEX.md) | Dedicated explanation: reads-02, reads-25. |
| [crates/snapback4-lang/src/guide/why/E_DIV_ZERO.md](../crates/snapback4-lang/src/guide/why/E_DIV_ZERO.md) | Dedicated explanation; preserve the existing defining/action paragraph or introduce the new refusal. |
| [crates/snapback4-lang/src/guide/why/E_EMIT_IN_QUERY.md](../crates/snapback4-lang/src/guide/why/E_EMIT_IN_QUERY.md) | Dedicated explanation: programs-09. |
| [crates/snapback4-lang/src/guide/why/E_FIELD.md](../crates/snapback4-lang/src/guide/why/E_FIELD.md) | Dedicated explanation: types-07. |
| [crates/snapback4-lang/src/guide/why/E_ID_REUSED.md](../crates/snapback4-lang/src/guide/why/E_ID_REUSED.md) | Dedicated explanation: writes-17-2, writes-23-3, language-21. |
| [crates/snapback4-lang/src/guide/why/E_INIT_CONFLICT.md](../crates/snapback4-lang/src/guide/why/E_INIT_CONFLICT.md) | Dedicated explanation: language-11. |
| [crates/snapback4-lang/src/guide/why/E_INPUT.md](../crates/snapback4-lang/src/guide/why/E_INPUT.md) | Dedicated explanation: writes-10, writes-12, writes-17-1, writes-17-4, types-04-2, types-04-3. |
| [crates/snapback4-lang/src/guide/why/E_INTERNAL.md](../crates/snapback4-lang/src/guide/why/E_INTERNAL.md) | Dedicated explanation: programs-05. |
| [crates/snapback4-lang/src/guide/why/E_MAINTAINED_COLUMN.md](../crates/snapback4-lang/src/guide/why/E_MAINTAINED_COLUMN.md) | Dedicated explanation: language-18. |
| [crates/snapback4-lang/src/guide/why/E_NOT_PREDICTABLE.md](../crates/snapback4-lang/src/guide/why/E_NOT_PREDICTABLE.md) | Dedicated explanation: writes-23-2. |
| [crates/snapback4-lang/src/guide/why/E_OP.md](../crates/snapback4-lang/src/guide/why/E_OP.md) | Dedicated explanation: programs-06. |
| [crates/snapback4-lang/src/guide/why/E_OP_RESERVED.md](../crates/snapback4-lang/src/guide/why/E_OP_RESERVED.md) | Dedicated explanation: programs-07. |
| [crates/snapback4-lang/src/guide/why/E_OVERFLOW.md](../crates/snapback4-lang/src/guide/why/E_OVERFLOW.md) | Dedicated explanation: types-06. |
| [crates/snapback4-lang/src/guide/why/E_PREDICT.md](../crates/snapback4-lang/src/guide/why/E_PREDICT.md) | Dedicated explanation: writes-06. |
| [crates/snapback4-lang/src/guide/why/E_QUARRY_AMBIGUOUS.md](../crates/snapback4-lang/src/guide/why/E_QUARRY_AMBIGUOUS.md) | Dedicated explanation: reads-08. |
| [crates/snapback4-lang/src/guide/why/E_QUARRY_BOUND.md](../crates/snapback4-lang/src/guide/why/E_QUARRY_BOUND.md) | Dedicated explanation: reads-20. |
| [crates/snapback4-lang/src/guide/why/E_QUARRY_DUPLICATE_FIELD.md](../crates/snapback4-lang/src/guide/why/E_QUARRY_DUPLICATE_FIELD.md) | Dedicated explanation: language-12. |
| [crates/snapback4-lang/src/guide/why/E_QUARRY_KEY_ORDER.md](../crates/snapback4-lang/src/guide/why/E_QUARRY_KEY_ORDER.md) | Dedicated explanation: reads-05. |
| [crates/snapback4-lang/src/guide/why/E_QUARRY_LIVE_MAINTAIN_PROBE.md](../crates/snapback4-lang/src/guide/why/E_QUARRY_LIVE_MAINTAIN_PROBE.md) | Dedicated explanation: types-04-6. |
| [crates/snapback4-lang/src/guide/why/E_QUARRY_MAINTAIN_EXPIRE.md](../crates/snapback4-lang/src/guide/why/E_QUARRY_MAINTAIN_EXPIRE.md) | Dedicated explanation: types-04-10. |
| [crates/snapback4-lang/src/guide/why/E_QUARRY_MODIFIER_SCOPE.md](../crates/snapback4-lang/src/guide/why/E_QUARRY_MODIFIER_SCOPE.md) | Dedicated explanation: reads-35. |
| [crates/snapback4-lang/src/guide/why/E_QUARRY_PLACEMENT.md](../crates/snapback4-lang/src/guide/why/E_QUARRY_PLACEMENT.md) | Dedicated explanation: programs-02, programs-08, shapes-07-1. |
| [crates/snapback4-lang/src/guide/why/E_QUARRY_POSITIONAL_SCAN.md](../crates/snapback4-lang/src/guide/why/E_QUARRY_POSITIONAL_SCAN.md) | Dedicated explanation: reads-09, reads-34. |
| [crates/snapback4-lang/src/guide/why/E_QUARRY_SELF_EQUALITY.md](../crates/snapback4-lang/src/guide/why/E_QUARRY_SELF_EQUALITY.md) | Dedicated explanation; preserve the existing defining/action paragraph or introduce the new refusal. |
| [crates/snapback4-lang/src/guide/why/E_QUARRY_SHAPE_JOIN.md](../crates/snapback4-lang/src/guide/why/E_QUARRY_SHAPE_JOIN.md) | Dedicated explanation: shapes-02, shapes-03. |
| [crates/snapback4-lang/src/guide/why/E_QUARRY_SPREAD.md](../crates/snapback4-lang/src/guide/why/E_QUARRY_SPREAD.md) | Dedicated explanation: shapes-01. |
| [crates/snapback4-lang/src/guide/why/E_QUARRY_SYNTAX.md](../crates/snapback4-lang/src/guide/why/E_QUARRY_SYNTAX.md) | Dedicated explanation: language-13. |
| [crates/snapback4-lang/src/guide/why/E_QUARRY_TYPE.md](../crates/snapback4-lang/src/guide/why/E_QUARRY_TYPE.md) | Dedicated explanation: language-04, types-02-1, types-08. |
| [crates/snapback4-lang/src/guide/why/E_QUARRY_UNKNOWN.md](../crates/snapback4-lang/src/guide/why/E_QUARRY_UNKNOWN.md) | Dedicated explanation: language-14. |
| [crates/snapback4-lang/src/guide/why/E_QUARRY_UNSUPPORTED.md](../crates/snapback4-lang/src/guide/why/E_QUARRY_UNSUPPORTED.md) | Dedicated explanation: language-15, language-16, language-17, language-20. |
| [crates/snapback4-lang/src/guide/why/E_QUARRY_WRITE_TESTS.md](../crates/snapback4-lang/src/guide/why/E_QUARRY_WRITE_TESTS.md) | Dedicated explanation: writes-14. |
| [crates/snapback4-lang/src/guide/why/E_QUERY_HELD.md](../crates/snapback4-lang/src/guide/why/E_QUERY_HELD.md) | Dedicated explanation: reads-33. |
| [crates/snapback4-lang/src/guide/why/E_RULE.md](../crates/snapback4-lang/src/guide/why/E_RULE.md) | Dedicated explanation: reads-07. |
| [crates/snapback4-lang/src/guide/why/E_SERVER_REQUIRED.md](../crates/snapback4-lang/src/guide/why/E_SERVER_REQUIRED.md) | Dedicated explanation: language-10. |
| [crates/snapback4-lang/src/guide/why/E_SHAPE_EXCEEDS_METER.md](../crates/snapback4-lang/src/guide/why/E_SHAPE_EXCEEDS_METER.md) | Dedicated explanation: reads-26, shapes-07-2. |
| [crates/snapback4-lang/src/guide/why/E_STRUCTURAL_FANOUT.md](../crates/snapback4-lang/src/guide/why/E_STRUCTURAL_FANOUT.md) | Dedicated explanation: programs-01, shapes-08. |
| [crates/snapback4-lang/src/guide/why/E_TYPE.md](../crates/snapback4-lang/src/guide/why/E_TYPE.md) | Dedicated explanation: language-06, types-02-3, types-05. |
| [crates/snapback4-lang/src/guide/why/E_UNBOUND_LOOP.md](../crates/snapback4-lang/src/guide/why/E_UNBOUND_LOOP.md) | Dedicated explanation: reads-27, reads-31. |
| [crates/snapback4-lang/src/guide/why/E_UNBOUND_SCAN.md](../crates/snapback4-lang/src/guide/why/E_UNBOUND_SCAN.md) | Dedicated explanation: reads-30. |
| [crates/snapback4-lang/src/guide/why/E_WRITE_ID.md](../crates/snapback4-lang/src/guide/why/E_WRITE_ID.md) | Dedicated explanation: writes-02. |
| [crates/snapback4-lang/src/guide/why/E_WRITE_ID_REUSE.md](../crates/snapback4-lang/src/guide/why/E_WRITE_ID_REUSE.md) | Dedicated explanation: writes-03. |
| [crates/snapback4-lang/src/guide/why/E_WRITE_RECEIPT_EXPIRED.md](../crates/snapback4-lang/src/guide/why/E_WRITE_RECEIPT_EXPIRED.md) | Dedicated explanation; preserve the existing defining/action paragraph or introduce the new refusal. |
| [crates/snapback4-lang/src/guide/why/NOT_FOUND.md](../crates/snapback4-lang/src/guide/why/NOT_FOUND.md) | Dedicated explanation: writes-07, writes-08, writes-11, writes-15, writes-16. |
| [crates/snapback4-lang/src/guide/why/N_NEVER_COMPLETE.md](../crates/snapback4-lang/src/guide/why/N_NEVER_COMPLETE.md) | Dedicated explanation: reads-14. |
| [crates/snapback4-lang/src/guide/why/N_NO_CURSOR.md](../crates/snapback4-lang/src/guide/why/N_NO_CURSOR.md) | Dedicated explanation: reads-19. |
| [crates/snapback4-lang/src/guide/why/N_OPTIONAL_FILTER_LIMIT.md](../crates/snapback4-lang/src/guide/why/N_OPTIONAL_FILTER_LIMIT.md) | Dedicated explanation: reads-17. |
| [crates/snapback4-lang/src/guide/why/N_SEEK.md](../crates/snapback4-lang/src/guide/why/N_SEEK.md) | Dedicated explanation: reads-03, reads-15, reads-36. |
| [crates/snapback4-lang/src/guide/why/N_SPARSE_FILTER.md](../crates/snapback4-lang/src/guide/why/N_SPARSE_FILTER.md) | Dedicated explanation: reads-04, reads-23. |
| [crates/snapback4-lang/src/guide/writes.rs](../crates/snapback4-lang/src/guide/writes.rs) | Mutation example first; keep lifecycle/client details and move refusals/proofs. |
| [crates/snapback4-lang/src/parser.rs](../crates/snapback4-lang/src/parser.rs) | Concrete aggregate and duplicate-sync repairs. |
| [crates/snapback4-lang/src/parser/expr.rs](../crates/snapback4-lang/src/parser/expr.rs) | Repeated where conjunction, self-equality refusal, qualified calls, count-star and limit repairs. |
| [crates/snapback4-lang/src/parser/views.rs](../crates/snapback4-lang/src/parser/views.rs) | Apply the same predicate-scope self-equality refusal to view branches. |
| [crates/snapback4-lang/tests/ergonomics.rs](../crates/snapback4-lang/tests/ergonomics.rs) | Regression or fixture described in the test table above. |
| [crates/snapback4-lang/tests/familiar_guesses.rs](../crates/snapback4-lang/tests/familiar_guesses.rs) | Regression or fixture described in the test table above. |
| [crates/snapback4-lang/tests/fixtures/guide-before.json](../crates/snapback4-lang/tests/fixtures/guide-before.json) | Frozen baseline words, opening boundaries and original example hashes. |
| [crates/snapback4-lang/tests/fixtures/guide-fact-homes.json](../crates/snapback4-lang/tests/fixtures/guide-fact-homes.json) | All 133 original prose fragments and required rendered destinations. |
| [crates/snapback4-lang/tests/guide.rs](../crates/snapback4-lang/tests/guide.rs) | Regression or fixture described in the test table above. |
| [crates/snapback4-lang/tests/guide/definitions.rs](../crates/snapback4-lang/tests/guide/definitions.rs) | Regression or fixture described in the test table above. |
| [crates/snapback4-lang/tests/guide/familiar.rs](../crates/snapback4-lang/tests/guide/familiar.rs) | Regression or fixture described in the test table above. |
| [crates/snapback4-lang/tests/guide/intent.rs](../crates/snapback4-lang/tests/guide/intent.rs) | Regression or fixture described in the test table above. |
| [crates/snapback4-lang/tests/guide/refusal_actions.rs](../crates/snapback4-lang/tests/guide/refusal_actions.rs) | Regression or fixture described in the test table above. |
| [crates/snapback4/tests/check.rs](../crates/snapback4/tests/check.rs) | Regression or fixture described in the test table above. |
| [crates/snapback4/tests/familiar.rs](../crates/snapback4/tests/familiar.rs) | Regression or fixture described in the test table above. |
| [crates/snapback4/tests/familiar/guesses.json](../crates/snapback4/tests/familiar/guesses.json) | Regression or fixture described in the test table above. |
| [packages/snapback4/README.md](../packages/snapback4/README.md) | First-screen Rosetta command and aliases. |
| [packages/snapback4/test/familiar-forms.test.mjs](../packages/snapback4/test/familiar-forms.test.mjs) | Regression or fixture described in the test table above. |
| [packages/snapback4/test/readme-examples.test.mjs](../packages/snapback4/test/readme-examples.test.mjs) | Follow the relocated planning fact through actual CLI output. |
| [scripts/replay-familiar.mjs](../scripts/replay-familiar.mjs) | Replay the same guesses against two immutable binaries in a temporary project. |
| [reports/lane-x-guess-replay.json](../reports/lane-x-guess-replay.json) | Exact before/after CLI results and binary identities. |
| [reports/lane-x-validation.json](lane-x-validation.json) | Exact suite summaries, phase failures and classifications, log digests and retained model counts. |
| [reports/lane-x-report.md](../reports/lane-x-report.md) | This measurement, mapping, implementation and validation report. |
| [JOURNAL.md](../JOURNAL.md) | One appended dated entry with results and unperformed scope. |

## Engineering decisions, deviations and open problems

No design counterexample or unresolved lane defect was found. The pre-existing corpus has intentional macOS/published-binary skips, retained unchanged by this lane. Helper qualification aliases the existing globally unique declaration; it does not add another namespace or change the IR. Wrong qualification is blocking. The self-equality refusal also covers nested boolean/object expressions, merges and planned/feed-view predicates; nested reads and shapes establish separate focal scopes. Repeated `where` is a left-to-right conjunction of complete predicates.

The original examples stay intact in Details when a smaller first example is needed. Facts with no useful enforcing code remain in their original card’s Details. Dedicated `why` prose is not silently truncated: tests reject overflow. Project-specific diagnostic context cannot hide a moved fact: the code keeps its canonical reference title and full detail while the full-card pointer retains the chosen context. Other existing diagnostic excerpts keep their previous bounded fallback behavior. The `sql` guide alias intentionally moves from personas to from-sql; the developer SQL command and the `inspect` alias are unchanged.

The optional-argument repair uses the existing assertion spelling and conventional NOT_FOUND application refusal; it does not make the helper optional or infer new authorization. Aggregates, duplicate sync audiences and the four foreign count/limit spellings gain no aliases. Only len retains its existing mechanical fix. `count(*)` supplies no domain to infer, so its repair requires naming the intended read; it does not guess a source table. No version bump, package publication, push, client-source change, Following rewrite, meter increase or runtime/schema redesign was performed.

The exact external target `~/sb4-intent/target-clique.q` checks successfully with zero problems and the same six notes as the starting revision: N_SPARSE_FILTER, two N_NO_HORIZON, N_NO_CURSOR, N_MAINTAIN_SYNCED and N_MAINTAINED_COLUMN_STREAM. Those notes are not new lane defects. Existing target execution tests are part of the full suite.

## Validation

Final **`scripts/test.sh`**, default concurrency, exit 0: **`== 0 failure(s) in 443 s`**. Every blocking phase passed; no failure was waived. Regular clients: 1,509 passed, zero failed, 10 existing skips. Models: all 78 tests passed; the 5,000 / 5,000 / 3,000 sequence counts are unchanged. The suite remains above the documented 60-second wall-time budget on this host; the supplied baseline was already 276 seconds. This lane did not undertake suite-speed work.

First full run, serial client files, exit 1: **`== 2 failure(s) in 1442 s`** (`cargo test`, `client tests`). All nine failing tests listed below were introduced by this lane and corrected. There were no remaining baseline or environmental suite failures.

Affected checks after the corrections: 70 CLI checks, two CLI guess tests, six language guess tests, 81 authorization tests, 22 ergonomics tests, 83 guide tests, six README client tests and the wasm/native witness passed. The final strengthened hyphenated-guide-pointer check passed separately (one test). Ref-check: 509 LLP documents, 9,282 references, zero errors or unchecked references. Wasm: 1,775,799 bytes raw / 495,258 bytes gzip against the unchanged 496,000-byte budget. [Validation receipt](lane-x-validation.json) records the commands, log digests, failure classifications and exact summaries.

Initial build environment: four `cc-1.4.5/src/target` Rust source files were missing from the Cargo registry extraction. Restoring those exact files from its cached crate archive allowed compilation; no dependency version or repository code was changed for that repair. Node 24.13 was used as authorized. A premature package-build attempt before wasm generation failed its missing generated import; the ordered suite build has the artifacts.

The first full run had eight introduced Rust test failures across three targets: the enum repair-wording pin, the guide authorization census, two CLI card-list pins, and four independent-diagnostic count tests. The count issue was the new why heading repeating ` — E_`; the rendered heading now uses the card title alone. All eight were corrected and their complete affected targets passed. One client documentation test, `Queries teach predicate reads and engine-chosen scope lanes`, also pinned the moved planning sentence to reads.rs; it now follows rendered why output, and all six tests in that file pass. Thus the first full run had nine introduced failing tests in total; none was classified as baseline or environmental. The old baseline log’s four failures were reviewed; this lane does not classify its new census delta as an inherited failure.

First-run failures: `ergonomics::s10_enum_widens_totally_to_bounded_text`; `readauth::census::authoring_census`; `check::guide_lists_aliases_and_resolves_them_on_stdout`; `check::guide_unknown_word_suggests_cards_on_stdout`; `check::w10c_check_keeps_independent_errors_and_other_operations`; `check::w10r1_empty_job_keeps_its_independent_repair`; `check::w10r1_multiple_job_prelude_statements_keep_the_independent_repair`; `check::w10r1_nested_job_prelude_keeps_its_independent_repair`. Reproduce the corrected scope with `cargo test -p snapback4-lang -p snapback4 -p snapback4-device --test guide --test ergonomics --test check --test readauth --test familiar`.
