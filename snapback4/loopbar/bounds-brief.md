# The bounds bar: four reads at hub scale

You are a senior product engineer building a headless application alone, timed,
from scratch. Work autonomously, only in this directory. Use ONLY the installed
published `snapback4@{VERSION}` pin. Read `node_modules/snapback4/README.md` first;
then the installed `npx snapback4 guide`, `guide <card>`, `why <CODE>`, and your
own generated types. Those, this brief and `bounds-seed.mjs` are your packet.
Do not read repository source, other implementations, package implementation
files, or previous runs; do not patch the package or call another agent.

Build Quarry under `snapback/` and a Node transport/seed/acceptance client. Every
application answer (grouping, ordering, aggregation and ranking) is computed by
the server. The client may concatenate already grouped continuation fragments;
it may not fetch raw tables to compute an answer. No native Rust, application
SQL, external backend, raised ceiling or special-cased seed/persona answer logic.
Choose your own schema and serving architecture. No UI or device proof is needed.

The clock is 60 minutes including installation. Finish at any time inside it.
Seed time counts and must be measured separately. Save an honest partial result
if blocked. The runner records every attempted run, including one with no green.

## Fixed seed

Import `generateSeed()` from the supplied `bounds-seed.mjs`. It returns logical
rows in arrays named chats, members, messages, authors, follows, posts and likes.
Map these rows into your own tables through YOUR mutations in `npm run seed:hub`.
Use `SNAPBACK_URL` (an already-running empty `dev` server); do not launch another
server in the seed, use `/seed`, write a database directly, or omit input rows.
Batch inputs through mutations if useful. Derived/index/work rows are yours to
choose. The generator is deterministic and is the seed's authoritative content;
do not edit it. Logical string keys need not be engine IDs. Node only generates
inputs, never the application's derived answers.

The fixed clock A is `1789668000000`; D is `86400000` milliseconds.

- Hub `dev:hub` belongs to 1,000 chats: 90 hold 100 messages and 910 hold 99,
  **99,090 messages**, every body `coffee`. Two hundred other chats have one
  newer `coffee` message each and belong only to `dev:outsider`.
- `dev:sparse` belongs to 100 separate chats, each with one message, five
  containing `coffee`, the other 95 `tea`. Hub chat `h000000` has 49 additional
  members, making a 50-person roster. Messages have ordinal 1…N. Each principal's
  `readOrdinal` is in the seed; unread is the number with ordinal greater than
  that value, across their memberships. Hub unread initially totals **50,000**.
- There are 1,000 authors with 50 posts each (**50,000 posts**) spread over 30
  hours ending at A. `small` follows five authors; `wide` follows 500;
  `celebrity` follows five including `a000000`. Extra fan edges make exactly 900
  followers of `a000000` and exactly five of `a000001`. Total follows: **1,411**.
- The first twelve posts have 12…1 likes, the last (old) post has 20; **98 likes**.
  All others have zero. The old popular post must not enter Trending.

Logical input totals: **1,300 chats; 1,349 memberships; 99,390 messages; 1,000
  authors; 1,411 follows; 50,000 posts; 98 likes**. The generator commits no data
output. You need not create separate tables for chat/author identities with no
other facts, but all messages, memberships, follows, posts and likes must exist.
Declare `hub`, `sparse`, `outsider`, `small`, `wide`, `celebrity` and any seed
persona. Dev accepts additional named personas used by the runner's mutations.

## Four tasks and wire contract

Query output descriptions below refer to the wire envelope's `data`. Extra
fields are fine. Collections can be arrays or native pages (`rows` and metadata).
Return logical keys so the runner can compare independent expectations.

1. **Search every chat I am in**, grouped by chat, newest first inside each chat.
   Probe term `coffee`. Return ALL matching messages, by following continuations
   as necessary, not just a few previews. Both hub and sparse must have complete
   server answers; outsider matches must never appear. Each result fragment is
   `{roomId, messages:[{key, at}, ...]}`. Empty groups are allowed. Groups may
   recur across result pages; their message fragments must already be newest
   first and concatenate without duplication. Group ordering is unspecified.
   The product search and membership page size is **20**; a nested whole-chat
   collection need not have that size. Design your continuation, then write:

   `search-protocol={"kind":"one-cursor","operations":["search"],"cursorArgs":["c"]}`

   Or, for the membership-batch/result protocol:

   `search-protocol={"kind":"two-cursor","operations":["chats","searchBatch"],"cursorArgs":["batch","c"]}`

   One cursor: the runner calls `/q/search` with `{q:"coffee",c:null}` then
   feeds `Read.next` into `c` until absent. Two cursors: it calls `chats` with
   `{batch:null}` to obtain the next membership-batch cursor, drains `searchBatch`
   with `{q:"coffee",batch:null,c:null}` and all its result continuations, then
   advances `batch` to the earlier `chats.next` and resets `c`. Repeat until the
   membership cursor is absent. The two operations must use the same membership
   batch boundaries. You choose operation and argument names in the JSON line;
   `q` and the result shape are fixed. A custom wrapper can implement these
   protocols in Quarry. `held-only` and `other` are valid descriptions of an
   unfinished/unsupported answer, but cannot pass the server acceptance.
2. **Following**: `/q/following {c:null}` returns `{key,at}` rows newest first,
   **20** per page, all posts by followed authors. Follow `next` as `c`. The
   runner checks whole-walk coverage for `small`, `wide`, `celebrity`, then
   measures each first page over **60 requests after three warm-ups**. Expose
   `/m/post {key,body,at}` authored by the viewer, which acknowledges only when
   the post is accepted. The runner alternates 60 measured posts plus three
   warm-ups for a 900-follower author and a five-follower author. Ratios are
   reported, never performance gates. Record
   `following-shape={"kind":"merge-on-read"}` (`recipe` or `other` also valid).
3. **Roster and unread**: `/q/roster {roomId:"h000000",c:null}` pages 20 members
   as `{principal}` rows and `/q/unread {}` returns `{total}` for the viewer.
   Both are exact; hub's total covers all 1,000 memberships.
4. **Trending**: `/q/trending {at:A,c:null}` returns exactly the top **10** posts
   created in `(at−D, at]`, ordered likes descending, then post time descending,
   then key ascending. Rows are `{key,likes,at}`. Zero-like posts fill the list
   when needed. The first top-ten page must be exact and complete, even if it
   has a continuation. `/m/like {postKey,liked}` adds/removes the viewer's like
   idempotently. The runner adds 20 distinct likes to `p000011`, queries again,
   removes one and checks again; no rebuild or client ranking is permitted.

All query walks use `/q/` on a fresh server. A next cursor is followed even on
an empty page. A meter-cut page with a working next can be discharged by its
continuation. A final `complete:false` cannot pass just because its rows look
right. Don't suppress/forge complete or cut; the runner retains native metadata.

## Evidence and acceptance

Provide `npm run acceptance`, which starts and cleans up its own fresh dev server,
seeds it through your mutations and asserts all four tasks, including hidden
matches, pagination and like changes. It must work when no previous server/store
exists. The runner separately repeats `check`, your acceptance, and its own
probes in three fresh copies. Only stop processes you started and recorded.

Save **every** check invocation's complete stdout/stderr in numbered
`evidence/checks/NNN.log`, including failures, notes, `--cost` and `--residency`.
Preserve the command and exit status in the run log; do not overwrite earlier
outputs. `check` piped through tee must retain the actual exit status.

Maintain `run-log.md` as you go, with Unix seconds and these literal formats:

```
start=1789668000
milestone=first-check at=1789668060
milestone=seed at=1789668100
milestone=search at=1789668200
milestone=following at=1789668300
milestone=roster-unread at=1789668400
milestone=trending at=1789668500
loop=1 attribution=agent-error command="..." failure="..." resolution="..."
knowledge-lookup card=search lines=320
seed-seconds=123.456
```

Loop attributions: `snapback4-defect`, `docs`, `agent-error`, `environment`,
`ambiguous`; aliases `docs-gap` and `loop=N retracted` are supported. Count a
correct-and-rerun cycle, not every command. Log cards and actual lines read on
each knowledge lookup, not merely the card's size. Save `final-report.md` with
what worked, what failed, bounds encountered, limits anticipated, and timings.
Write `green=<Unix seconds>` only after your full acceptance passes; omit it
otherwise. A missing green is an unsuccessful trial, never a skipped trial.

Write exactly one of each machine-readable JSON line into `run-log.md`:

- `search-protocol=...` and `following-shape=...` as above.
- `schema-shape={"workTables":[],"perPrincipalCounterTables":[],"auxiliaryOperations":[]}`
  with actual schema/operation names (module-qualified operations where needed).
- `derived-columns=[{"table":"someTable","column":"someDerivedColumn"}]`:
  every stored or maintained derived fact, including hand-kept rank/unread
  columns. Use `[]` when none; the runner also infers all maintains and records
  permissive read AND write rules on these tables, with source line provenance.
- `task-lines={"search":[{"file":"snapback/search.q","start":1,"end":20}],"following":[...],"rosterUnread":[...],"trending":[...]}`
  with valid inclusive ranges in YOUR final `.q` files. Include schema, helpers,
  maintains and jobs that each task needs; shared lines can count for each task.
  No ellipses in the actual JSON. Every task needs at least one range.

The runner lists every chosen integer literal with file, line and exact token,
excluding comments, strings and these product constants ONLY: **10, 20, 24,
86400000**. Seed cardinalities, caps, lane counts, horizons, type limits and
implementation page sizes are choices even if they happen to match seed counts.
It counts diagnostic-code occurrences in saved check output, and the fixed
bounds vocabulary in your two narratives. Measurements are not a reason to
avoid honest reporting. Do not rewrite an earlier failed check or narrative to
improve a metric.
