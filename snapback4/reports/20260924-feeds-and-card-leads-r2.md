# Lane F round 2: feeds review and feature-first cards

Date: 2026-09-24. Branch: `sb4-intent/f-guide`.
Base: `a034a3670`. Fetch succeeded; merging `origin/main` reported
“Already up to date.” Main's integrated 0.4.0 and Lane H notes were already
present. No push, publication, deployment or version bump.

## Result

Closed the feeds review findings and audited all 29 canonical guide cards,
including the supplemental search text. Aliases resolve to these same cards.
Each card now starts with its title, a two-sentence feature introduction and
an example. Following the requested feeds structure, that card introduces
its Global section before the first example. The witness keeps its existing
TSX example because it describes an application harness, not a Quarry form.

Operations, replay controls, development-host policy and dedicated refusal
material follow the authoring examples and rules. Existing feature subsections
remain useful reference groups. Removed repeated job module naming and shape
completeness prose. Corrected relative “below” references after moving examples,
and repaired the assets title's misplaced “upload, place, serve” suffix.
No engine, authorization, disclosure, durability, meter or admission change.
Only guide prose, examples, diagnostic explanation strings and tests changed.

Implementation commits:

- `f3588f913`: feeds review corrections and executable witnesses.
- `971939d34`: introductions, card organization, duplicate cuts and opening guard.

## Feeds review disposition

| Finding | Change and evidence |
|---|---|
| Older 82-examination / 41-probe measurement appeared to describe current Following | Moved it to the final compatibility section, restored its setup (40 events, newest 20 removed), and explicitly labeled it as the older recipe's measurement. The text test now enforces that scope. No new measurement is claimed. |
| Reply exclusion had no runtime witness | The published Following test creates a reply and checks that neither the author's nor the follower's page contains it after delivery. Removing the predicate clause makes the test fail. |
| Current program cannot emit FEED_ORIGINAL_REQUIRED or FEED_NOT_AUTHOR | Both codes now appear only in compatibility prose. The current table names E_RULE for non-owner removal; the test executes that refusal. |
| `why` prescribed older timeline forms | E_RECIPE_RETIRED, E_TIMELINE_FILTER and E_TIMELINE_READ now prescribe the activity union and Following view. Positive and negative wording pins cover those repairs. Adjacent E_TIMELINE_SHAPE, E_TIMELINE_FOLLOWS and E_TIMELINE_OWNED explanations also use the current three-source view, unnamed unique pair and application tables, removing stale four-table/profile advice. |
| “Profile” was not in the published program | The contract now says older posts remain in `posts` and are not copied. |
| Global was only compiled | A test runs the actual first block with a live original, removed original and independent repost. It checks source filtering, post/actor projections, card lookup and equal source ids from different branches. |
| Following did not prove mappings, ties or the history bound | The test creates 1,005 originals, ties the last two timestamps, checks every original's `post`, `actor`, id and repost flag, compares the immediate 50 with the newest rows, and requires exactly the newest 1,000 after delivery. All 1,006 source posts/replies remain stored. |

## Tests and verification

- `feeds::followups::published_global_filters_originals_and_preserves_independent_reposts`
  is new and executes the published Global block.
- `feeds::published_following_matches_the_builder_contract` now covers replies,
  tied event times, mapped fields, the 1,000-event window, retained older source
  rows and non-owner E_RULE, in addition to own visibility, asynchronous delivery,
  pending-backfill completeness, removal and unfollow.
- `every_card_introduces_the_feature_before_examples_and_reference_details`
  guards the title, short introduction, early example and absence of leading
  flags/refusals across all 29 cards.
- Updated the existing legacy-measurement and view-rewrite text expectations.
  Historical runtime fixtures and their assertions remain unchanged.
- Explicitly copied the existing language-context census entries for the two
  new read-only, schema-free card examples (personas and refusals). The census
  compiles them with the language schema, so its 22 entries appear under each
  new card label. No rule or outcome assertion was relaxed.

Three temporary mutation checks each failed at the intended runtime assertion:

1. Replace Global's `posts where not .removed` with `posts where .removed`:
   the original's id is `removed` instead of `shared`.
2. Remove `.parentId = null and` from Following's source predicate:
   the author gets 1,006 rows instead of 1,005 originals.
3. Change HISTORY_WINDOW from 1,000 to 10,000:
   the follower gets 1,005 historical originals instead of 1,000.

Every mutated file was restored byte-for-byte in a `finally` block. No mutation
is committed. The first mutation-check wrapper expected the wrong assertion
message despite the test correctly failing; its expectation was corrected.
The new opening guard caught an introduced, subsequently fixed failure: missing spaces in two inline titles and an
extra heading marker in the assets title; all were corrected before qualification.
A paragraph audit caught and corrected a heading inserted inside the sync text.

Focused results: guide 61 passed; CLI check/why 68 passed; read authorization
81 passed. The CLI target covers every registered code's dedicated section,
inline repeated diagnostics, repaired examples and bounded explanations.
The frozen Bun install and whitespace checks passed. Every changed Rust source
is below 1,500 lines. README and its budget remain unchanged at 292/300 lines.

Ran `scripts/test.sh` once after the focused checks. Exact result:
`== 0 failure(s) in 433 s`. Client tests: 1,088 passed, 10 skipped. No
introduced, baseline or environmental suite failure. The older baseline cargo
failure did not recur. WASM remains 1,744,842 B raw / 484,967 B gzip against
the unchanged 486,000 B budget. The largest changed Rust file is 1,187 lines.
The feeds card is 302 lines, including the newly scoped compatibility prose.

Evidence: `~/sb4-intent/lane-f-r2-{bun,feeds,guide,check,readauth,mutations,suite}.log`
and `~/sb4-intent/lane-f-r2-mutant-{global-filter,reply-filter,history-window}.log`.

## Boundaries and inherited exception

All previous Quarry examples remain byte-for-byte unchanged. Added compiled
examples for `use personas alice, bob` / `use identity password` / `whoAmI`,
a schema with a literal default and optional column, and `require name != ''
else NAME_REQUIRED`. No new language form was needed.

The pre-existing search full-history example still deliberately emits its
asserted N_NO_HORIZON note. Its source, exact note exception and warning prose
are unchanged. Making that example silent by adding a horizon or cap would
change the full-history contract; suppressing the note would hide acquisition
cost. This round does not claim every historical block is note-free. All four
feeds blocks and all three newly added blocks are silent, and no exception was
added. Reproduce it by copying the second Quarry block from `snapback4 guide
search` into a fresh `snapback/schema.q` and running `snapback4 check --verbose`:
N_NO_HORIZON names `messages` at line 9 of that block. There is no new open
implementation problem.

## File map

Each card's source file is linked in the paragraph record below. Three cards
(residency, expire, assets) remain inline in `src/guide.rs`; evolution remains
in `src/guide/discovery.rs`. Those changes affect only their text constants.
Additional changed files, relative to `snapback4/`:

- `crates/snapback4-lang/src/guide/codes.rs`: current-form Following explanations.
- `crates/snapback4-lang/tests/guide.rs`: opening guard, scoped measurement pin,
  view repair pins and existing compile/why checks.
- `crates/snapback4-lang/tests/guide/feeds.rs`: expanded current Following execution.
- `crates/snapback4-lang/tests/guide/feeds_followups.rs`: current Global execution.
- `crates/snapback4-device/tests/readauth/census.txt`: the two new compilation contexts.
- `JOURNAL.md`: one dated append for this round.
- `reports/20260924-feeds-and-card-leads-r2.md`: this report and paragraph record.

## Old and new first paragraphs

These are the exact first prose paragraphs, with original line breaks. Where
an old card opened with code or a subsection, that is noted; “old” then records
its first prose paragraph after that opening. The new paragraph always precedes
the first example. Subsequent rules and refusal paragraphs were retained;
172 diagnostic-bearing paragraphs outside the requested feeds correction
remain byte-for-byte present after moving.

### language — [language.rs](../crates/snapback4-lang/src/guide/language.rs)

Old:

> One file, `snapback/schema.q`, holds tables, views, shapes, helpers,
> programs and schedules, in any order; more `.q` files beside it are modules
> (their operations are `<module>.<name>`) sharing one namespace. Schedules use that
> qualified job name too: `schedule repair every 1m: timeline.repair`; an unambiguous
> bare module job gets this rewrite from `check --fix`. Comments
> start with `--`. Blocks indent with two spaces. Everything the compiler
> accepts is below; the suite compiles every block and runs the core program.

New:

> Quarry defines your tables, access rules and backend operations.
> Queries and eligible mutations can run on devices that hold their inputs.

### app — [app.rs](../crates/snapback4-lang/src/guide/app.rs)

Old:

> Comments start with `--`. Blocks indent with two spaces. A file holds
> directives, tables, views, shapes, helpers, queries, mutations, jobs
> and schedules, in any order. `snapback4 guide` prints the card index;
> `guide language` prints the core program, followed by a "With `use server`"
> section, and the idiom for each thing the language leaves out on purpose.

New:

> This chat backend gives conversation members live messages and offline writes.
> Tables, membership rules and operations share one Quarry file.

### types — [types.rs](../crates/snapback4-lang/src/guide/types.rs)

Old:

> E_QUARRY_TYPE means the expression's type does not fit its position.
> The diagnostic names the expected and actual types and the source location.
> A table reference is that table's typed id, not its row: read `table[id]`
> before selecting fields. Narrow an optional value with `if x != null:`,
> `x ! else CODE` or `x ?? default` before using it where a present value is
> required. Use the declared enum type when its variants cannot all widen
> to the helper's text bound; changing a type never converts stored values.

New:

> Types describe the values a column or argument accepts.
> They also set limits on text, lists and uploaded assets.

### indexes — [indexes.rs](../crates/snapback4-lang/src/guide/indexes.rs)

Old:

> State the predicate and order. `check` chooses an existing index or creates
> one. Rules, sync, caps and expiry also obtain their access indexes. A table
> needs no `by` declaration for these reads:

New:

> Indexes let reads seek the rows that match a predicate in the requested order.
> The compiler chooses or creates them from your reads and declarations.

### maintains — [maintains.md](../crates/snapback4-lang/src/guide/maintains.md)

Old:

> A `view` names derived data. A filter or projection is planned when read.
> Branches form a union without a copied application table. An aggregate is
> maintained in the source write's transaction. Public Following is materialized
> per reader when its source and edge rules admit that disclosure (`guide feeds`).

New:

> A `view` names derived data.
> It can plan a read, maintain an aggregate or materialize a feed for each reader.

### rules — [rules.md](../crates/snapback4-lang/src/guide/rules.md)

Previously opened with code before prose.

Old:

> Each of `read`, `insert`, `update` and `delete` takes one rule over the row
> (`.col`), `viewer` and literals. A table without a rule for an effect denies
> it. `public 'why'` on its own line is the read rule. The compiler supplies indexes for `exists` probes; named
> equalities may cover a total unique key and check extra columns on that one row,
> for both `exists` and `created`, without an extra index. Every focal field used
> by the key or extra tests must be pinned for one verdict to serve a whole page. `created t[..]` is valid in insert rules only. Rules
> compare with `=` and `!=` alone: a rule that varies with time is not an
> audience a partition can hold (use `expire`). A read rule that is exactly
> `exists t[.a, .b, viewer]`, `.col = viewer` or `public` can be synced (guide
> sync). The system principal consults no rules, so `system` is never a rule word.
> An audience read rule may add `or viewer = 'service:pusher'` (or several
> service grants); sync infers its audience without them, and ordinary extra disjuncts still refuse.

New:

> Rules decide who may read or write each row.
> They apply on the server and when a device reads or predicts local rows.

### sync — [sync.rs](../crates/snapback4-lang/src/guide/sync.rs)

Previously opened with code before prose.

Old:

> `sync [last N by .at]` infers its audience from the read rule. Explicit
> `sync public` and `sync to ...` remain valid and must agree with that rule.
> The read rule must be exactly the audience — `public`, `.col = viewer`, or
> `exists t[.a, .b, viewer]` — so a device never holds a row it may not read
> and never misses one it may; a non-service second disjunct or an extra conjunct is
> refused with the rewrite. Declare `unique a, b, principal` on the target; the compiler supplies
> the recipient lookup index; when it
> has several principal columns, `by .col` names the recipient. Every insert
> rule branch must also prove the caller already has that audience grant, for
> example `exists participants[.threadId, viewer]`, or that this mutation
> created the group. `.personId = viewer` alone is refused because it would
> let anyone join. Audience keys are immutable or guarded on update. These
> target audiences require every content prefix and corresponding target
> group column to be non-optional: `null` cannot name a device partition, so
> `sync to participants[.threadId]` requires both copies of `threadId`.
> Checks also cover insert-if-absent and upsert.
> Read rules may add `or viewer = 'service:pusher'` (or several service grants);
> sync infers its audience without them, so device snapshots and streams stay the same. The horizon
> `last N by .at` bounds what a device acquires per group. The server sends
> an acquisition boundary: a suffix starting at the Nth delivered readable key,
> or `whole` when fewer than N readable rows exist, including an empty group.
> A descending page on that index is complete while it stays at or above that
> boundary by key; crossing it returns only the known suffix with `complete: false`
> and unknown coverage, so the online client asks the server. Without a boundary
> the group is unknown. Ascending reads and other indexes keep their ordinary
> horizon rule. An unheld put below the boundary is dropped; a held row whose key
> moves below it remains available to point reads but is excluded from the suffix.
> A put moving above the boundary joins the suffix. Continuous renewal keeps the
> boundary. A join reacquiring retained history leaves the horizon unknown until
> a full replacement snapshot acquires the group again. Boundaries persist with
> acquisition and publish with staged snapshot rows only after catch-up. The additive sync field
> `acquisitions` contains `{ at, table, index, group, floor? }` markers before
> `events[at]` (or at the end): missing `floor` begins acquisition; completion
> carries `whole` or the hex-encoded index key. A completion without a matching
> begin is ignored and reported in device metadata (`device:acquisition-report`).
> An acquiring join selects the group's current readable rows when the stream
> serves it, newest first on the horizon index. The floor is the full key of the
> Nth delivered row, including its id tie-breaker; `whole` means the walk reached
> the group's end with fewer than N readable rows, including none. Expired and
> unreadable rows do not consume horizon slots. A cold snapshot uses the same
> readable-row selection; at a stable state and clock its floor matches the join's.
> Without a horizon an acquiring join delivers every current readable row.
> A continuous renewal expands no rows and preserves the original grant's acquisition
> if it has not yet been delivered. Contiguous renewals committed before the preceding
> grant expires keep that membership open; a revocation or expiry gap breaks the chain.
> Within one commit, a grant followed by continuous renewals acquires once at the
> grant; a revoked grant acquires nothing, and a rejoin starts a new chain.
> A join whose membership is already closed when served acquires nothing, even for
> publicly readable retained history.
> A row written after the join may arrive in the acquisition and again as a later
> put; applying it twice replaces the same row by id. A later deletion still deletes.
> Snapshot replies echo `after`; the device checks every
> continuation and requires the terminal page before catch-up publishes coverage.
> Empty groups consume page room too, so even a page with no rows can continue.

New:

> Sync delivers each viewer's authorized rows to their device for live and offline reads.
> A table's sync declaration chooses its audience and acquisition horizon.

### residency — [guide.rs](../crates/snapback4-lang/src/guide.rs)

Previously opened with code before prose.

Old:

> `check --residency --verbose` prints two tables of facts: each table's audience and
> horizon (inferred audiences say "from the read rule"; aggregate views name their
> source), then operations and their read sites: held, horizon, or server.
> Sites name the read, write or rule's file:line:column, including expanded
> helper writes and after-insert rules; a source-less fact names its rule or
> write path instead of an internal compiler site.
> Queries run on the device unless a site is server-only. Mutations predict
> when eligible; every mutation can queue. An eligible mutation's horizon
> sites say "may queue without a row past the horizon"; E_PREDICT names the
> site, table, index and key the device could not establish. Native reads
> need the app's module on the device.
> Queries reading `connected` run on the server; mutations stay eligible when presence decides only effects.
> Presence-derived values use only total comparisons, boolean logic and fixed-size field values; fallible work keeps `never`.

New:

> Residency describes which data a device holds and which operations need the server.
> Coverage on each call determines whether the answer is complete.

### prediction — [prediction.rs](../crates/snapback4-lang/src/guide/prediction.rs)

Old:

> `pending` means the write has not settled; `sent` means the server committed it.
> A predicted row carries `pending: true`; a pending write may have no predicted row.
> Writes that do not predict show pending with `usePendingWrite(op)` from
> `snapback4/react`; pass a saved mutation id as its second argument to observe
> that write after reload. See `guide writes` for terminal receipts and acquisition.
> `client.acquired` and `useAcquired()` say whether snapshot and catch-up finished;
> unacquired writes without a row report `queued without a row: not acquired yet`.

New:

> Prediction applies an eligible write to local rows while the server decides it.
> A write can still queue when the device cannot justify a prediction.

### evolution — [discovery.rs](../crates/snapback4-lang/src/guide/discovery.rs)

Old:

> New optional columns, required columns with literal defaults, non-unique
> indexes, tables and operations adopt without ceremony. Literal defaults
> fill older row images on the server and device, including in new indexes,
> without rewriting stored rows or logging partition events.

New:

> Schema adoption applies a new backend definition to existing data.
> The stored rows must fit the new types, keys and constraints.

### expire — [guide.rs](../crates/snapback4-lang/src/guide.rs)

Previously opened with code before prose.

Old:

> A typing indicator or presence row with a short deadline needs this local
> filter: hide it at its deadline, even while the next answer is still pending.
> `guide reads` carries a compilable typing table and its 4,500 ms deadline.
> This is an application table, separate from the server's `connected[p]`.
> That server-decided connection signal has no `expiresAt`.
> A row already returned stays in that answer until the next answer; a live
> reader that must hide it at its deadline drops it locally by `expiresAt`.
> The server will not return the row again after expiry, but does not push a
> removal at the instant of expiry. Select the deadline in the query, as above.
> The local client reschedules its watch at `Read.nextExpiry`; keep the render
> filter so the row hides at its deadline rather than at the refetch.
> Given `rows` from a ready answer and your `render` function, render now and
> schedule another render at each non-null deadline (epoch milliseconds):

New:

> Expiry makes a row invisible when its declared deadline passes.
> The server then deletes it and syncs the deletion to devices holding it.

### assets — [guide.rs](../crates/snapback4-lang/src/guide.rs)

Old:

> The local client keeps server upload facts for prediction: `{ id }` works
> offline after upload, including reads of duration and dimensions. Without
> those facts the write queues unpredicted and the server judges it.
> With `createLocalClient({ assets: { keep: "viewed", maxBytes: 67108864 }, ... })`,
> ordinary viewed images and videos survive offline reopen in device storage.
> `keep: "none"` (the default) retains no media. The byte bound evicts least
> recently used assets. Home-row deletion, clearing, expiry and partition leave
> purge the bytes; `once` is never stored. Online reads always revalidate.: upload, place, serve

New:

> Assets are uploaded images and videos attached to a row.
> That row's read rule controls who can fetch the bytes.

### reads — [reads.rs](../crates/snapback4-lang/src/guide/reads.rs)

Old:

> State the rows, then the order and page. `messages where .roomId = roomId
> last 20 by .at after c` means the newest matching messages. The compiler
> chooses the index. `messages[messageId]` always reads one id. A full declared
> unique key also reads one row, using named columns when its arity is ambiguous.
> The rules run before any projection, count or order reaches the caller.

New:

> Reads select authorized rows by id, predicate or search text.
> Add an order, page size and cursor to browse a population.

### shapes — [shapes.rs](../crates/snapback4-lang/src/guide/shapes.rs)

Previously opened with code before prose.

Old:

> The table and shape names are the language card's. A shape over a page is
> a bounded loop; its fields are the row's columns by bare name, `*` for all
> of them, `...shape` for a named shape's fields, and `name: expr` with `.`
> as the row. A shape is the only projection: there is no `select`.
> A table-typed helper accepts that table's row or reference. A reference has no
> fields: read `messages[m] ! else NOT_FOUND` first, or select through the shape's
> implicit row parameter, `messages[m] { body: .body }`. Shapes are projections,
> not declared helper-argument types.
> A helper's early `return` inside a page's shape ends only that call; the page
> keeps its `next` cursor and completeness.
> A collector building a returned value makes the query incomplete if it exits
> with rows still unconsumed, even on a short final page.
> Each page needs its own returned owner when it has
> more rows: one field's cursor cannot cover a lost sibling or auxiliary page.
> A fully consumed, exhausted scan needs no cursor owner, even when its row count
> equals the bound and the query returns a scalar such as `count(rows)`.
> An auxiliary traversal of an intact returned page does not affect completeness,
> even if it breaks. Repeating a page read cannot clear earlier loss: only the
> final execution of an owned page site supplies `next`, and an earlier lost
> continuation still makes the query incomplete.
> A row-based shape keeps `pending?: boolean` from its base, including `*`, named
> spreads and subsequent shapes. It is this device's unconfirmed change, absent
> after confirmation; it is not a schema column or metadata on a containing record.

New:

> Shapes choose the fields returned from a row or page.
> Name a shape to reuse the same result layout across reads.

### writes — [writes.rs](../crates/snapback4-lang/src/guide/writes.rs)

Previously opened with code before prose.

Old:

> If `messageId` in `writeForms` addresses retained history from a room the
> writer has left, the call still predicts. Reads hide the updated message
> because current membership is absent, while readable inserts remain visible.
> Unknown reaction authority also hides that provisional reaction.
> See `guide prediction` for authorization on each device read.

New:

> Mutations insert, update and delete rows in one transaction.
> Rules and constraints apply before that transaction commits.

### programs — [programs.rs](../crates/snapback4-lang/src/guide/programs.rs)

Old:

> E_QUARRY_PLACEMENT means a statement is valid only in another context.
> For example, `query add():` cannot contain `insert notes { body: 'hello' }`;
> make that operation `mutation add():` so the write runs in its transaction.
> Queries cannot insert, update, delete or mint ids, even through a helper.
> Keep read-only work in a query, put writes in a mutation or job, and put
> `break` or `continue` inside the loop they control. The rewrite names the
> misplaced statement and where it belongs.

New:

> Queries read data; mutations change it in one transaction.
> Jobs run background work, and helpers share logic between programs.

### jobs — [jobs.rs](../crates/snapback4-lang/src/guide/jobs.rs)

Old:

> For a replay mode that must not emit notifications, run `snapback4 dev --replay`.
> New emits are counted as `suppressed` by `doctor`, with no queued payload:
> they are never delivered, including after restarting with or without `--replay`.
> Mutations and explicitly run jobs keep their writes, results and meters.
> Replay holds schedule admission; restart without it resumes at the next
> boundary, skipping held periods. Already queued jobs still run, with their
> new emits suppressed. Effects queued before replay keep their ordinary lifecycle.

New:

> Jobs do background work on the server, with progress committed as they go.
> Schedules start them at boundaries of the server's clock.

### native — [native.rs](../crates/snapback4-lang/src/guide/native.rs)

Previously opened with code before prose.

Old:

> A job whose body is not Quarry but the app's own Rust (LLP 3000.005), for
> the scoring half of a feed and anything else that wants floats, vectors,
> real loops and a typed schema without putting them into Quarry.
> `snapback/native/` is a Cargo package the app owns — `crate-type =
> ["cdylib"]`, its own `[workspace]`, a dependency on `snapback4-native` —
> and `snapback4 check` writes `snapback/generated/native.rs` (a constant
> per table, index and aggregate view; a `serde` struct per table), builds the
> package for `wasm32-unknown-unknown` into `snapback/generated/native.wasm`
> (cold about ten seconds, then a cargo no-op), and refuses if a declared
> job is not one the module implements. `dev` rebuilds on every save under
> `snapback/`; `deploy` ships the module with the release; `run <job>` runs
> it here; `doctor` says whether the module and the toolchain are in place.

New:

> Native jobs and queries run the application's Rust as metered WebAssembly.
> Use them for computations that need floats, vectors or Rust libraries.

### feeds — [feeds.md](../crates/snapback4-lang/src/guide/feeds.md)

Previously opened with a subsection before introductory prose.

Old:

> Each original and repost is one event. The union reads each source's rules
> before projection. It stores no extra rows. Equal source ids from different
> branches remain distinct; include the branch's `repost` flag in a list key.

New:

> Feeds present public originals and reposts as Global, Following or Trending.
> Views define the event stream; a predicate read selects the trending posts.

### search — [search.rs](../crates/snapback4-lang/src/guide/search.rs)

Previously opened with code before prose.

Old:

> `matching ''` matches nothing, including when the needle contains only whitespace or punctuation.
> Use `allPeople` while the search box is empty and `people` once the user types.
> This directory uses two queries and a client branch: `allPeople` pages the
> whole directory by id; `people` returns matches in that same order. Neither
> query sorts alphabetically by display name.
> Continue each query with its own `next`; do not sort only the first page
> and treat it as the whole directory. Reset the cursor when switching queries or changing the search text.
> Normalize whitespace-only input to `''` in the client if it should browse too.

New:

> Search finds rows whose words begin with the terms a user types.
> The same word-prefix rules apply on the server and on the device.

### effects — [effects.rs](../crates/snapback4-lang/src/guide/effects.rs)

Old:

> Effects are global declarations shared by every file; jobs are module-qualified
> operations. The worker dispatches by the declared effect name, while schedules
> and `run` address an operation. If `digest.q` declares `effect notify` and
> `job daily()`, write `emit notify { ... }`, register `effects: { notify: ... }`
> in the worker, and schedule `digest.daily` (`schedule dailyDigest every 1d: digest.daily`).

New:

> Effects record work for a worker to perform outside the database, such as sending a notification.
> The payload commits with the mutation or job that emits it.

### actions — [actions.rs](../crates/snapback4-lang/src/guide/actions.rs)

Old:

> One `use server` in any module (`schema.q` is usual) enables the whole
> project; repeating it is harmless. Actions, routes and schedules naming an
> action require it. Effects (including secrets, retry, backoff, deadline and
> cancellation), jobs, schedules naming a job and service seats need no directive.
> E_SERVER_REQUIRED refuses each gated declaration; its rewrite is `use server`.

New:

> Actions expose typed operations implemented by the application's TypeScript server handlers.
> Use them for work that calls external systems and reads or writes through Quarry operations.

### routes — [routes.rs](../crates/snapback4-lang/src/guide/routes.rs)

Old:

> One `use server` in any module (`schema.q` is usual) enables the whole
> project; repeating it is harmless. Actions, routes and schedules naming an
> action require it. Effects (including secrets, retry, backoff, deadline and
> cancellation), jobs, schedules naming a job and service seats need no directive.
> E_SERVER_REQUIRED refuses each gated declaration; its rewrite is `use server`.

New:

> Routes expose declared POST paths for requests and provider webhooks.
> TypeScript handlers run under the authenticated caller or a verified service seat.

### services — [services.rs](../crates/snapback4-lang/src/guide/services.rs)

Previously opened with code before prose.

Old:

> `snapback4 token --service ranker [--days 365] [--release <dir>]` prints,
> once, a bearer session for the principal `service:ranker`.
> The token and one newline are the whole of stdout (even with `--json`), with prose on stderr, so capture it with `TOKEN=$(npx snapback4 token --service ranker)`.
> The owning store is printed on stderr: the project's `.snapback4/store.sqlite`,
> or `<dir>/store.sqlite` with `--release <dir>`. A token belongs only to that
> store; mint one for each isolated audit or proof store after starting its dev
> server. `--fresh` (also `--memory`) has no disk store for this CLI to mint into.
> Readiness for dev and serve is the first stdout line: the listening URL,
> emitted after store and native-module setup. Wait for that line before sending
> requests; lifecycle logs and the store banner use stderr.
> With an application worker, dev also prints its one-time `service:worker`
> token on stdout after the URL, labelled "printed once"; it stays out of stderr logs.
> Rules name it
> like any principal, so the ranker is admitted and nobody else is; with
> its token a worker claims effects (guide effects) and runs any operation
> a rule admits it to.
> An audience read rule may add `or viewer = 'service:ranker'`; sync ignores
> service grants, and `check --residency --verbose` lists them without changing any device's partition.

New:

> A service seat gives a worker its own principal for rule-checked operations.
> A service can also mint sessions for accounts the application authenticates.

### presence — [presence.rs](../crates/snapback4-lang/src/guide/presence.rs)

Previously opened with code before prose.

Old:

> `connected[p]` is how many connections a principal holds open on the
> server now: a device following the stream keeps a long poll open
> (`GET /changes?wait=25&heartbeat=1`), and a poll that answered a moment ago still
> counts for 35 seconds, the gap before the next. Heartbeats are JSON whitespace
> every 2 seconds before the final object. On a running host, 4 seconds of
> silence marks the link offline within 5 seconds; native fetch without streams
> uses at most 2-second polls. Browser connectivity events give immediate hints;
> authenticated `/probe` confirms recovery. Suspended hosts notify on resume.
> It is not a table: nothing
> syncs, nothing is written. A mutation uses it to defer an absence-guarded
> notification while a connected-looking client is unconfirmed (guide effects); a query reads it for an online mark.
> On a device the word is unknown: a query that reads it is `complete: false`, and the server answers it online.
> A mutation stays eligible to predict when presence decides only effects: connection state never changes its rows or result on a successful commit, but can change which effect arms run and therefore its charges, as live versus absent presence already could. The server commits the effects and defers unconfirmed absence decisions until their deadline. The paved `if not exists connected[p]: emit …` form charges the same whether the recipient is held, graced or absent.
> Shared boolean payloads and separate positive-presence emits can cost more for
> held than graced recipients; a held recipient may get both a deferred absence
> effect and an immediate positive-presence effect.
> For a proven necessary absence guard in those effects-only mutations, a held poll is unconfirmed: the push is recorded and deferred five seconds from the commit, and only a new poll arriving within that window cancels it. Grace alone keeps its deadline, up to 35 seconds. Cancellation records the `satisfied` outcome `presence_reconnected` (guide effects). The guard decision does not change the value of `connected[p]` in a payload. Only a proven necessary absence guard authorizes cancellation; payload-only reads and alternative guards retain their ordinary decisions and remain immediate. Grace deadlines and recorded reconnects survive restart; `clock advance` makes a waiting effect due along with its grace.
> Presence-derived values may use comparisons, `exists`, boolean logic and field values. Arithmetic, fallible builtins, reads, `new` or refusals controlled by presence keep `predicts: never`, as do conditional values without a fixed-size proof. Prediction charges both safe presence arms, so it may reach a bound even when the server would fit. If an untaken arm needs a combined guard's value refinement, the device queues without a row; put the data guard outside presence.
> In tests: `snapback4 clock advance 36s` or `POST /dev/clock/advance` with `{ "duration": "36s" }` closes the up-to-35-second deferral after a poll ends; open polls stay connected, and online client queries read the server's updated answer (guide clock). `snapback4 clock advance 6s` expires a held-poll effect deadline.
> `snapback4 run` reads nobody as connected.

New:

> Presence reports which principals have an active or recently active connection.
> Use it for online indicators and absence-guarded notifications.

### bounds — [bounds.rs](../crates/snapback4-lang/src/guide/bounds.rs)

Old:

> Write product limits: a page size, a text length, an asset size or a real
> per-group cap. Do not choose an index, a merge width or a job transaction
> size. Predicate reads and views choose their plans; top-level job `for`
> loops choose their chunks. Removing a written number never removes the meter.

New:

> The meter limits the work each read, mutation and job transaction can do.
> Declare product limits; the engine chooses execution bounds within those ceilings.

### refusals — [refusals.rs](../crates/snapback4-lang/src/guide/refusals.rs)

Old:

> Every refusal is `{ code, family, message, detail?, site?, rewrite?, guide?, rule?,
> retryable? }`: `code` and `family` are stable, `rewrite` compiles, `guide`
> names a card, `rule` is the program's own code on a `require` or named unique refusal, and
> `retryable` says the same request may succeed later. The engine's families:
> input, schema, auth, rule (your `require` codes), constraint, bound, op,
> asset, action, route, prediction, generation, store; the client adds link (the server is
> unreachable) and client (the client itself refused, as after `close()`).
> `snapback4 why <CODE>` prints its explanation and the card paragraph naming
> the code, followed by the full-card command. Every registered code has a
> dedicated paragraph on its default card. A diagnostic may choose another
> card for its context; if that card lacks a section, explicit `why` labels
> its fallback to the card's opening. Output is at most 4,096 UTF-8
> bytes including the pointer and final newline; a shortened excerpt says so.
> When the same code and card occur twice in text `check` or a `dev` save refusal,
> a dedicated section prints once under the first occurrence; cards without
> one add no inline excerpt. Every site keeps its `guide:` pointer.
> At most three excerpts print in diagnostic order: 12,291 extra bytes including
> separating blank lines. A single occurrence stays compact; `check --json`
> keeps its structured diagnostics. `why` remains available on demand.
> Reads never raise a rule refusal: a
> hidden row is null, and a page omits it.

New:

> A refusal explains why an operation could not complete and how to correct it.
> Application checks can supply their own codes for the client to handle.

### personas — [personas.rs](../crates/snapback4-lang/src/guide/personas.rs)

Old:

> For a replay mode that must not emit notifications, run `snapback4 dev --replay`.
> Startup prints `replay on — new effects suppressed; schedules held`.
> `doctor` reports the persisted dev replay and schedule policy, even after the host stops.
> New emits are counted as `suppressed` by `doctor`, with no queued payload:
> they are never delivered, including after restarting with or without `--replay`.
> Mutations and explicitly run jobs keep their writes, results and meters.
> Replay holds schedule admission; restart without it resumes at the next
> boundary, skipping held periods. Already queued jobs still run, with their
> new emits suppressed. Effects queued before replay keep their ordinary lifecycle.

New:

> Personas let you act as named development users while testing rules and application flows.
> Deployed apps use authenticated sessions instead.

### witness — [witness.md](../crates/snapback4-lang/src/guide/witness.md)

Old:

> `snapback4 witness ios` drives an installed Release app on macOS. It builds
> nothing. Add `snapback4-expo/witness` to the app and rebuild its native module.
> The helper is null on ordinary launches. Mount this runner beside the chat
> screen, using the same local client and a conversation already seeded online:

New:

> The iOS witness runs an installed app through offline scenarios and records its assertions.
> It captures receipts and screen recordings from a simulator on macOS.
