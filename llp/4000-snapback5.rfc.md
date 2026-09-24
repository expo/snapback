# LLP 4000: Snapback 5 — the bridge is invisible

**Type:** RFC
**Status:** Draft
**Role:** Root of a proposed Snapback 5 corpus (LLPs 4000 and up), if commissioned
**Systems:** A Snapback 5 authoring surface over the Snapback 4 engine; derived residency; the device acquisition policy; the client contract; `check`; the calibration protocol
**Author:** Claude Fable 5.1, at Charlie Cheever's request
**Date:** 2026-09-24
**Revised:** 2026-09-24 (revision 4, after the round-3 delta reviews — [Astra](./reviews/4000-snapback5.astra.md) NOT READY, [Grok](./reviews/4000-snapback5.grok.md) NOT READY "the next edit is local", [Opus](./reviews/4000-snapback5.opus.md) NOT READY "READY WITH CHANGES for the first slice with seven changes": joins defined; the tombstone-only subscription withdrawn and retained history frozen at removal; the receipt table kept in both arms and engine-derived delivery moved to its own future LLP; engine-assigned ordinals; Snapback 4's predictor restored verbatim with the rate computed from a pinned program; coverage as key ranges with floors and an acquisition record; carried results withdrawn; the depth cap and pinning made exact; the control defined by build graph and behavioral equivalence; a loss margin, non-inferiority floors with a stated correction, the mechanism as a gate stated once, the load gate scoped to external processes, and every round-3 movable choice fixed; a differential page invariant; §12 extended; **this is the bounded stop: the document goes to the author with these verdicts**); 2026-09-24 (revision 3); 2026-09-24 (revision 2); 2026-09-24 (initial)
**Related:** [LLP 3000](./3000-snapback4.explainer.md) (Snapback 4, the engine this proposal keeps and the control it is judged against), [LLP 3000.007](./3000.007-relaxed-quarry-and-explicit-residency.rfc.md) (explicit residency, whose spelling this proposal removes and whose mechanism it keeps), [LLP 3000.012](./3000.012-application-still-owns-derived-data.research.md) (the plateau and the charge ledger), [LLP 3000.013](./3000.013-quarry-states-intent.rfc.md) (the planner and `view`, kept), [LLP 3000.014](./3000.014-a-child-reads-through-its-parent.rfc.md) (inherited audiences; its revision 2, not yet written, is the design of record for `through`), [LLP 2000.000](./2000.000-keep-the-core-flip-two-substrates.rfc.md) (the brief Snapback 4 built), [calibration #19](../benchmarks/runs/2026-09-24-snapback4-clique-astra-0.4.0/README.md), [`benchmarks/protocol.md`](../benchmarks/protocol.md), the [September 5 three-backend run](../benchmarks/runs/2026-09-05-clique-full-3x3/README.md)

## Summary

Quarry exists to carry one declaration across the client–server bridge: the
same tables, rules and queries run on the server and on the device, so a
write can be predicted locally and a read can be answered offline under the
server's authority. The calibration record says the bridge itself scores
well. What the record charges, in every one of the sixteen ledgered
`data_modeling` notes and in calibration #19's, is a learning cost that names
whatever the current release still asks the author to write: index prefixes,
then bounds, then residency, then "prediction/completeness". Nineteen Clique
calibrations sit on a holistic plateau of 85–92 (median 89) with
`data_modeling`, `queries_and_live` and `scale_and_limits` at the bottom of
every window (LLP 3000.012 §2.1). The same builder family gave Supabase 94 in
the same category for "SQL familiarity and composability."

Snapback 5 is a bet, stated as a hypothesis with a registered alternative
(§9.1): that part of the residual charge after 0.4.0 is the **spelling of
residency** (`sync`, horizons, caps-as-bounds, eligibility keywords, the
residency notes) and not the language or its runtime facts. Remove the
spelling, keep every mechanism, derive what the spelling used to state from
the program's declared queries, and measure against a control that differs
in nothing else. Three rounds of blind review, nine reviews in all, have cut
the bet down to that and have left the direction settled: one channel, pages
computed on the device, refills inside the stream, Snapback 4's `complete`,
Snapback 4's predictor, and a decision rule. What revision 4 adds is the
last set of contracts the reviews named, and it is where this document
stops for the author.

Concretely, Snapback 5 is:

1. **Snapback 4's engine, with named hooks in feature-gated modules** (§8).
   The control is built from a graph that excludes `snapback5`, with its
   resolved feature set asserted and its behavior proven equivalent on the
   invariant suite and a recorded replay.
2. **Derived residency: the partition log with a derived horizon.** No
   `sync` line, no authored horizon. A device acquires the key ranges its
   warm pages and one depth step read, as acquisition records with floors
   (§4.2), stays subscribed to a partition while it holds any row of it, and
   catches up from one watermark. A join delivers the membership row and
   the parent row, and the depth step acquires the group (§4.2). The device
   computes its pages' entries, exits and reorders; the server keeps no page
   results.
3. **Nothing about `complete` changes** (§5); the read and write result types
   stay; an outbox view is added. The completeness class is one line of the
   default `check`. What leaves the author's path is the residency
   vocabulary and the notes that describe only residency and cost (§6).
4. **Snapback 4's predictor, verbatim** (§4.5), including the
   timeline-edge rule and the effects-only presence exception; the rate is
   computed mechanically from a pinned program, not written by hand.
5. **A concept budget with a frozen counting rule** that counts what
   `check` prints (§7).
6. **Additions that land in Snapback 4 first**, so the control carries
   them: `through .ref` (LLP 3000.014 revision 2, provisional), field-level
   write authority (`written by`), engine-assigned ordinals (`sequence by`),
   and a declarable maintained unread view. The receipt table **stays in
   both arms' programs**; engine-derived delivery is its own future LLP
   (§3.3).
7. **A decision rule with a loss margin, non-inferiority floors, the
   mechanism as a gate, and a scoped load gate** (§9), every choice fixed in
   §9.5.

This is a proposal for the author's decision. Nothing here is built.

## 1. Evidence

The claim this RFC rests on: *the learning-cost charge names whatever bridge
vocabulary remains, and removing the spelling while keeping the mechanisms
is a testable way to find out whether part of the charge is the spelling.*
The record:

| Observation | Source | What it supports |
| --- | --- | --- |
| Bottom three categories are `queries_and_live` 83.5, `scale_and_limits` 84.5, `data_modeling` 85.0 medians over 16 runs; the eight-to-thirteen-point gap to the top four survives every window and every leave-one-out population | LLP 3000.012 §2.1 | The gap is structural, not a run |
| The four categories at 94–97 rest on declarations on a table: `image <=N once`; **read rules with `sync to` and `retain delivered-history`**; client-minted ids; `expire at`. #19's authorization note (96) credits "retained-history policies" directly, and the builder's diary calls that policy "the standout" | LLP 3000.012 §2.1; #19 FINAL and lane diary | Part of what revision 1 deleted is credited with the top scores. The leave policy stays (§3.2) |
| All 16 charged `data_modeling` runs carry LC; RM in 12, CP in 12, QC in 6. The ledger says LC overlaps the others and declines a single-cause reading | LLP 3000.012 §2.2 | Learning cost is recurring and overlapping, not a demonstrated single cause |
| What the LC phrases name across the 16 notes: bounds 11; the language itself 8; completeness 5; residency 2–3; prediction 1. #19's diary places its remaining cost in completeness notes, the prediction proof, keys that carry the membership scope, and "the compiler's distinctions" | LLP 3000.012 §2.2, counted by the Opus review; #19 lane diary | Residency spelling is a small share of the named charge. §9.1 registers which named items this bet expects to remove and which it expects to stay |
| Same builder family: Supabase 94, Convex 88, Snapback 2 68 in `data_modeling` | LLP 3000.012 §2.1 | 94 is reachable in this category with this grader |
| 0.3.0: `data_modeling` 87. 0.4.0 (a subtractive wave): 90, inside noise. The LC charge stayed; what it named changed | LLP 3000.013 Summary; calibration #19 | Removing *how-the-engine-works* vocabulary has not yet removed the charge |
| W14b, a named removal with a pre-registered prediction, was confirmed on `setup_and_docs` | LLP 3000.007 §20.24.3 | A removal works when it targets the category it names |
| #19 already charges *runtime* completeness in three categories; its platform finding 4 is an incomplete read published as `data: null` | #19 FINAL and README | The charge is already moving to run time. This is why §5 changes nothing about `complete` |
| The 0.2.x advice repairs zeroed every targeted diagnostic shape and `setup_and_docs` sat at 0.14 sd | LLP 3000.007 §20.22.7, §20.24 | Deleting a word does not delete the behavior the scorer reads |
| `snapback4-lang` today: 16 `N_*` note codes, 161 `E_*` codes; the committed 0.4.0 Clique target still authors `sync public`, `sync to members[.conversationId]`, `retain delivered-history`; its `cap 50 by conversationId` is the brief's product rule; the inherited wasm budget is 486,000 gzip bytes | `snapback4/crates/snapback4-sim/tests/fixtures/intent-clique.q`; `snapback4/metrics/wasm-budget.json` | The residency spelling after two subtractive waves is still authored |
| Builder wall clock, Astra medium, whole brief: 0.2.29 122 min (89), 0.2.30 118 (90), 0.2.31 77 (91), 0.2.32 79 (88), 0.2.33 82 (92), 0.3.0 90 (92), 0.4.0 115 (88; M8 first green at 54 min). Sample sd of the last five: 15.6 min. #19's host-load samples: 4 of 155 above 36, peak 70.8 | the run READMEs; #19 `host-load.jsonl` | The clock after first green is where a residency mechanism's cost would land. Three runs per arm distinguish about 25 min (§9.4). A whole-host load gate at 36 would have discarded #19 (§9.5) |
| Category run-to-run spread over 0.2.31–0.4.0 (sd): holistic 2.0, `queries_and_live` 1.6, `offline_sync` 2.4, `client_integration` 4.7, `writes_and_transactions` 1.3, `setup_and_docs` 3.4 | the five FINAL files | The floor margins in §9.3 |
| The incumbents were clocked on this brief text (unchanged since 2026-09-03) on 2026-09-05: Supabase M8 first green at 110.5 min cumulative (M1–M6 and M8 green, M7 not run; 13/13 M6); Convex about 94 min (6/13 on M6). Independent grade: Supabase 92/0/9 of 101, Convex 84/8/9, Snapback 2 81/11/9 | `~/clique-full-20260905/lanes/*/milestone-clocks.json`, `scores/record-tables.md`, LLP 3000.007 §2.1 | Snapback 4 at 54 min is about twice as fast as both incumbents to first green; §9 judges against Snapback 4. Both incumbents attempt the offline milestones |
| The reference lanes of 2026-09-24 (`~/clique-ref-20260924`): Convex 1.46.0, Supabase-js 2.117.1 and Snapback 4 0.4.0 on #19's instrument and host, Astra medium and Opus 5.5 high, three lanes per wave in parallel (a recorded deviation from protocol rule 5) | the packet README | The same-host, current-pin product reference; not a claim-eligible magnitude |

What the evidence does not show: that the client story of Snapback 4 is
wrong (`offline_sync` median 93), or that the learning cost is specifically
the residency spelling. The corrected record points partly away from the
bet, which is why §9.1 pre-registers the named items and why the bet is
small.

### 1.1 What LLP 2000.000 §2 said about result caches

| LLP 2000.000 §2 cost of a result cache | Snapback 5 |
| --- | --- |
| Receipts and evidence identity per cached answer | Comes back smaller: a page has a key and an acquisition record with a coverage floor (§4.2), which are evidence identity and coverage. There is no per-answer receipt or certificate |
| Fetching page by page instead of one bulk stream | Does not recur for the warm set and the depth step, acquired in one catch-up; recurs by design beyond the depth step |
| Composite answers going partial when one component was never fetched | Recurs as `complete: false` (the closure is not held), never as a wrong answer (§5) |
| Searching across all of a user's conversations answered only over what was shown | Recurs by design: local search covers held rows; the server answers the rest. The brief's M5 scope is "already-synced messages" |
| Follower inboxes rebuilt per cache | Does not recur: Following stays server-materialized per reader (§4.4) |

## 2. The bet on one page

**Snapback 4's position** (LLP 3000.007): the author states what lives on
the device and how much, the compiler proves the statement, and notes tell
the author when a query cannot be complete or a write cannot be predicted.

**Snapback 5's position:** the author states the model and the product's
reads and writes. The engine derives the horizon from the declared queries,
keeps the partition log as the only channel, predicts as Snapback 4
predicts, and reports the same typed runtime facts. The vocabulary that
leaves is the residency spelling. The mechanisms stay.

The two differ in **what decides the horizon** and in **what the device
first acquires**. In Snapback 4 the author writes `sync last 500 by …` and
the device acquires that span of each group on join and the whole public
corpus on cold start. In Snapback 5 the device acquires the key ranges its
warm pages and one depth step read, and extends them as the app asks for
more; a join delivers the membership row and the parent row, and the depth
step acquires the group. Public data reaches every device in both, because
the warm set holds the public pages. Delivery is the same stream. What is
saved is the authored spelling and the difference between an authored
horizon and what the product has shown plus one step.

## 3. The author's surface

### 3.1 What a program is

Everything the committed 0.4.0 Clique target and #19's program use is
here, so that §7's count has a fixed population.

```quarry
use identity password
effect push

table posts:
  authorId: principal
  parentId: posts ?
  body: text <=500
  photo: image <=10000000 ?
  at: time default now
  removed: bool default false
  likeCount: count likes
  immutable authorId, parentId, at
  public 'Public posts'
  insert <- .authorId = viewer
  update <- .authorId = viewer

table conversations:
  kind: enum('dm', 'group')
  latest: max messages.ordinal by conversationId          -- a declared maximum; §3.3
  read <- exists members[.id, viewer]
  insert <- true

table members:
  conversationId: conversations
  principal: principal
  role: enum('member', 'admin')
  joinedAt: sequence by conversationId                     -- engine-assigned at commit; §3.3
  readUpTo: int default 0 written by .principal            -- field-level write authority; §3.3
  unique conversationId, principal else ALREADY_MEMBER 'Already a member.'
  at most 50 by conversationId
  keep history
  immutable conversationId, principal, joinedAt
  read <- exists members[.conversationId, viewer]
  insert <- created conversations[.conversationId]
         or exists members[conversationId = .conversationId, principal = viewer, role = 'admin']
  update (old, next) <- exists members[conversationId = old.conversationId, principal = viewer, role = 'admin']
                     and next.readUpTo = old.readUpTo    -- the mark is not an admin's to write

table messages:
  conversationId: conversations
  senderId: principal
  ordinal: sequence by conversationId
  body: text <=2000
  at: time default now
  tombstone: bool default false
  expiresAt: time ?
  search body
  expire at .expiresAt
  keep history
  read <- through .conversationId
  insert <- .senderId = viewer and through .conversationId
  update (old, next) <- old.senderId = viewer and now - old.at <= editWindow()

table receipts:                                            -- stays in the program; §3.3
  message: messages
  principal: principal
  state: enum('delivered', 'read')
  unique message, principal
  read <- through .message
  insert <- .principal = viewer and through .message

view unread: count messages by members m
  where .conversationId = m.conversationId and .ordinal > m.readUpTo
    and .senderId != m.principal and not .tombstone       -- maintained; keyed by another table's row; §3.3

view following: activity where .actor = viewer or exists follows[viewer, .actor]

shape postCard = { *, author: profiles[principal = .authorId], liked: exists likes[.id, viewer] }

fn editWindow(): duration = 15m

query home(c: cursor ?):
  return following last 20 by .at after c activityCard

mutation markRead(conversationId: conversations):
  update members[conversationId, viewer] { readUpTo: conversations[conversationId].latest }

job daily(periodStart: time, periodEnd: time): …
schedule dailyDigest every 1d at 08:00: daily
```

- **Program:** `use identity …`, `effect`.
- **Tables:** columns and their types (including `enum`, media types and
  `once`), `default`, `sequence by`, `max … by` and `count … by` maintained
  columns, `unique … else CODE 'message'`, `immutable`, `at most N by`,
  `expire at`, `search`, `format`, the leave policy (`keep history`; the
  default is until revoked), `online only`, `written by`, `readable by
  audience` on a `written by` column.
- **Rules:** `public`, `read`, `insert`, `update` (with `(old, next)`),
  `delete`; terms `exists`, `created`, comparisons with `viewer`, `through
  .ref` (top-level conjunct only).
- **Reads:** `view` (including `merge`, and `count … by <table> <row>
  where …`, a maintained view keyed by another table's row), `shape`, `fn`,
  `query`; forms `where`, `first`/`last N by`, `after c`, `matching`, a
  shape, `group`, `connected`; control flow and the builtins.
- **Writes:** `mutation`; `insert`, `update`, `upsert`, `delete`, `if
  absent`, `require … else`.
- **Work:** `job`, `schedule`, `emit … once`.

### 3.2 What leaves, and what stays

| Removed | Why it existed | Who carries it now |
| --- | --- | --- |
| `sync`, `sync to`, `sync public`, `sync last N by`, authored horizons | To state the device's partition and depth | The declared queries, the warm set and the depth step (§4.1); the audience is still the inverted read rule |
| `cap N by` **as a residency bound**, `first 10001`, `size`, `cap 60000` | To bound device and server work | The meter and the planner. `at most N by` stays as the product constraint |
| Eligibility keywords on operations (`server`, `device`) as authored forms | To state where an operation runs | Generated facts `runs` and `predicts` on each operation (§5) |
| The residency notes in the default compile: `N_NO_HORIZON`, `N_HORIZON_GUARD`, `N_NOW_SERVER`, `N_MAINTAIN_SYNCED`, `N_NOT_PREDICTABLE` | To make an authored residency honest | There is no authored residency; the generated `predicts` fact carries what `N_NOT_PREDICTABLE` carried |
| Cost and scale notes (`N_WIDE_MERGE`, `N_SEEK`, `N_SPARSE_FILTER`, `N_TIMELINE_PROFILE_CAP`, `N_MAINTAINED_COLUMN_STREAM`, `N_TIMELINE_COMPAT`) | To advise on cost at compile time | `check --scale` (§6) |
| `createClient` versus `createApp` as an author's residency choice | To choose a tier | One `createApp` for apps; `createClient` stays for headless and third-party clients |

**Kept.** The leave policy, one word per table. `online only`. Product
bounds. The completeness class and the disclosure notes (`N_NEVER_COMPLETE`,
`N_NO_CURSOR`, `N_MAINTAINED_COLUMN_DISCLOSURE`, `N_MAINTAIN_DELTA`,
`N_PUBLIC_AGGREGATE_COPY`) in the default `check`. Index names and
`maintain` strategies were removed by LLP 3000.013 and are not credited
here.

**Retained history is frozen at removal.** Under `keep history`, a removed
member keeps the rows held at removal and receives nothing further for that
group: no updates, no tombstones. This is Snapback 4's behavior and the
brief's ("after the client has synced the revocation"). Revision 3's
tombstone-only subscription after membership loss is withdrawn: it could
not carry #19's delete-for-everyone (an update), it leaked later departures,
and it cost a permanent span per pair. A declared revoking column
(`revoke when .tombstone`) is a possible later addition, counted in §7 if
proposed.

**A default that flips, printed.** In Snapback 4 a table with no `sync` line
is online-only. In Snapback 5 a table is held on devices whenever some
declared query reads it and its read rule is invertible, unless the author
writes `online only`. The default `check` prints, per table, "held on
devices" or "server only" and why.

### 3.3 The additions

All land in **Snapback 4 first**, each under its own review, in the shared
baseline both arms are built from (§8), so that the control carries them.

**`through .ref`** is LLP 3000.014 revision 2, which does not yet exist.
Until it lands, the lifetime rule is **provisional** and `through` is not
in any first slice. What this RFC fixes for revision 2 to adopt or refuse
is unchanged from revision 3: captured audience with incarnation stamps;
liveness at read time; a background cascade under a stated meter (initially
256 rows per slice, the delivery chunk size); write-only children exempt;
`through` only as a top-level conjunct; uniform refusals; no persisted copy
for write-only use; copies never in query rows, shapes, cursors or write
results; changes to a parent's interpretation refused while it has
descendants or refilled inside activation; aggregates derive a rule only
when their inputs are a function of the group key. Device-side parent
liveness (learning a parent incarnation's death when the parent is not
resident) is for revision 2 to specify; until it does, a `through` page
whose parent is not held is not device-evaluable.

**`written by .principal`** on a column: the value may be written only by
the principal named in that column of the same row. The contract:

- **Initialization.** An insert sets the column to its declared default
  only; a supplied value is refused unless the inserter is that principal.
- **Patches.** A patch that touches a `written by` column is authorized
  for that column by the column's principal, and for every other field by
  the row's `update` rule. The owner may patch that column alone with no
  row `update` rule.
- **Projection.** A `written by` column is omitted from other principals'
  log images unless declared `readable by audience`, in which case every
  reader of the row sees it. Clique's read marks are declared readable,
  which is the product decision its readable receipts table already made.
- **Monotonic marks** are a rule the program writes:
  `update (old, next) <- next.readUpTo >= old.readUpTo and next.readUpTo <=
  conversations[old.conversationId].latest`, over a declared `max … by`
  column. The engine does not invent a clamp.

**Engine-assigned ordinals.** `ordinal: sequence by conversationId` is
assigned by the engine at commit, dense per parent; a predicted row carries
a provisional value that the settled write replaces. A member's join
position is the same sequence's value when the membership commits
(`joinedAt: sequence by conversationId`). Recipient sets, unread counts and
marks are defined on these two values only, never on wall-clock time or on
a client-supplied integer. Under the target's `ordinal: int`, a member could
insert `9007199254740991` and pin the history forever.

**A maintained view keyed by another table's row.** `view unread: count
messages by members m where …` is a maintained aggregate with one value per
`members` row, updated by the engine on message insert, tombstone, expiry
and on the member's own mark write. It excludes the member's own sends,
tombstoned and expired messages, and messages before `joinedAt`. It is a
new `view` form, counted in §7, with the cost of one aggregate update per
recipient membership per message (the fan-out the receipt table already
paid) and one per mark write.

**Receipts stay in the program.** Revision 3's engine-derived `delivered`
is withdrawn from this RFC. Three reviews showed it was not exact from
sequence numbers (a tail acquisition's rows predate the span; an older
message edited later counts as delivered), that per-message aggregates
over 10,000 messages exceed the 1,024-row write ceiling on a mark advance,
and that its source lived behind a treatment-only feature the control
could not carry. The receipt table (or #19's `fetched`) stays in both
arms. Engine-derived delivery, with key-floor acquisition records,
per-principal delivered intervals and an insert-sequence rule, is a future
LLP if the author wants it.

What leaves Clique's program under these additions: the read-mark
mutation's clamp logic, the unread count's maintenance, the hand-copied
`chat` columns and their integrity probes (with `through`), and
client-supplied ordinals. The receipt table stays.

## 4. The bridge, derived

### 4.1 Residency from queries

- **A page is held when the app has asked for it.** `useQuery(app.home)`
  acquires the key ranges its closure (§4.3) reads. Rows are stored once,
  tagged with the pages that read them.
- **The warm set is derived:** the first page of every query whose only
  arguments are a cursor, acquired at sign-in as one catch-up, in
  declaration order, under the budget of §4.1.1. `online only` queries are
  excluded. Aggregates are admitted last and dropped first.
- **One step of depth is derived: at most one first page per qualifying
  query per row of a warm page.** A query qualifies when its only
  non-cursor argument is a **reference to a table** (`history(chat:
  conversations)`); arguments typed `id` or `principal` do not qualify, and
  `check` warns when an `id` argument's values are always another table's
  ids. The drop order is rows in page order, then queries in declaration
  order within a row. The step is one level deep and is maintained while
  connected. It does not ask for pages the server denies.
- **`check` prints the derived residency:** `offline: inbox last 50 by
  joinedAt → history last 50 each, roster each; home last 20 → thread first
  20 each; warm: global, trending, insights`. A builder who needs the probe
  user's 100 conversations offline sees that the inbox page holds 50 and
  changes the page size or the ordering.
- **Eviction** applies only to rows no maintained page, pending write or
  retention protects, by time since the row was last read, under the
  budget, and is suspended while offline.
- **Retention.** Only rows retained after membership loss under `keep
  history` are pinned, counted **outside** the budget; retained history is
  what was held at removal. Rows of a `keep history` table whose membership
  is current are ordinary rows.
- **Released pages** keep their rows for reads, stay subscribed to their
  partitions while any row is held, and never report `complete: true`. **A
  released page is re-acquired when it is reopened**, so it is never
  evaluated over holes left by eviction.
- **A denied page with retained rows** returns the retained rows with
  `complete: false` and `fresh: false`, as Snapback 4's left-group answer
  does.

#### 4.1.1 The budget

The device budget is a generated fact: 50,000 rows or 64 MiB, whichever is
first, split as warm set (at most half), depth step (at most half), and
on-demand pages (the remainder, evictable). Retained rows are outside it.
Priority within each part is declaration order; a warm page that does not
fit is not held and `check` says so. When a maintained page grows past what
its part allows, its newest acquisition is refused and the page reads
`complete: false` until the app releases something; the budget is a
statement of what the device maintains, not a hard store bound, and the
first slice measures the store. These numbers are the initial registration
for §9's cold-start measurement, not a product constant.

### 4.2 One channel: the partition log, with acquisitions as key ranges

The partition log of LLP 2000.000 §7.1–7.2 stays: every committed row image
goes to zero or one audience partition, decided by the inverted read rule;
membership deletes emit one scope tombstone; deletes and expiry are
tombstones; an update is a new image, re-read at serve time and served as a
delete if the row is gone; logical expiry of a membership is applied at
catch-up; the log is never compacted; a device catches up from one
watermark. Delivered rows remain authoritative on the device while the
leave policy keeps them and no audience expiry the log has not recorded
applies. View-once consumption is recorded per principal in the asset
store, not in the log, as today.

What changes:

- **Acquisition records replace the authored horizon.** Snapback 4's
  device knows what it holds by one key floor per table, index and group
  (`Acquisition.floor`), and drops puts below it. Snapback 5 keeps exactly
  that record, per acquisition: (table, index, prefix, key range, schema
  generation, image-fence sequence, page key). An acquisition is served
  inside the stream at a sequence position, images read at serve time, as
  group joins are served today; the record is durable in the principal's
  partition so it survives reconnect; the exchange is idempotent, and an
  acquisition at an unchanged watermark is answered. Refills extend a
  record's key range; eviction shrinks it. Coverage is these key ranges,
  never a sequence interval: fifty-one messages in one commit share a
  sequence, and only a key floor says which one a `last 50` omitted.
- **A join delivers two rows.** At the join's position the stream delivers
  the principal's own membership row and the group's parent row, and
  nothing else. A page keyed by the viewer's memberships (the inbox) treats
  a joined group it has not acquired as "closure not held" (`complete:
  false`) until the depth step acquires that group's first pages; a scope
  event removes the group from the set. The cold-start snapshot of every
  group and the public corpus is replaced by acquiring the warm set and the
  depth step. "Membership inserts bootstrap a group" is no longer in the
  list of what stays unchanged; a join bootstraps nothing beyond those two
  rows.
- **A device stays subscribed to a partition while it holds any row of
  it**, so every later update and tombstone for a held row arrives in the
  one stream, whether the page that brought the row is maintained, released,
  or gone. Delete-for-everyone in #19 is an update; it reaches a released
  search page's row of a current member.
- **A requested acquisition is intersected with the principal's
  authorization intervals when served**; a request for a group the
  principal does not hold is refused like a denied page. Invariant 2 holds
  because the server, not the device, decides what a request may return.
- **Refills** are one durable event in the principal's partition, expanded
  at serve time to current images, iterated until the page is full or the
  partition is exhausted, none emitted for a dead id. The device asks for a
  refill when a maintained page shrinks below its size or scrolls past its
  floor.
- **Public data reaches every device**, as in #19. Snapback 5 does not
  claim to deliver less than Snapback 4; it claims to author less.
- **Audience admission is unchanged**, and `check` prints it per table.

### 4.3 Pages are computed on the device; the server keeps no page results

A page is **everything it read**: the point reads and index ranges the plan
touched, the rows its shapes, helper functions and rule checks consulted,
and the next instant at which a time-based filter changes.

- **The device computes its pages** from the rows it holds and the
  acquisition records it has. Entries, exits and reorders are consequences
  of rows arriving, changing and dying in the stream. An exit drops a page
  tag and nothing else. The device computes its own time boundaries and
  re-evaluates at them; there is no server-side time index.
- **The server keeps no page results.** Its per-device state is the
  acquisition records and the watermark. There is no matcher, no change
  feed, no cross-viewer sharing rule to govern.
- **Key** of the device's page table: (schema generation, canonical plan
  hash, viewer and auth context, arguments, cursor).
- **The closure a device holds is limited to rows the viewer may read.** A
  rule probe or shape field into a table the viewer may not read makes the
  page **not device-evaluable**: it reads `complete: false` offline and gets
  its value from the server online. Revision 3's "carried result" option is
  withdrawn, because nothing in a one-channel design keeps such a value
  current.
- **Schema adoption.** A page survives a schema change only if its plan
  hash is unchanged and nothing in its closure (rules, defaults, helpers)
  changed. Every other page drops to `complete: false` and is re-acquired
  after the device adopts the generation, which withdraws or reauthorizes
  retained images as Snapback 4's adoption does. A request from an old
  generation is refused with `E_GENERATION`. Fills for `through` happen
  inside the activation barrier. A populated view is rebuilt behind the
  barrier and published with the generation.

### 4.4 Following

Unchanged from revision 3: server-materialized per reader; admission
restated without `sync` (sources readable by everyone, owner-only write
rules, immutable mapped columns); the `home` page's closure holds the
viewer's follow edges with their epochs and the removal tombstones the
inbox filter reads; `complete` false while a backfill or cleanup is
pending; Lane L's fair lock and time-sliced background work a
prerequisite.

### 4.5 Prediction: Snapback 4's predictor, verbatim

Snapback 5 predicts exactly as Snapback 4 predicts, wherever residency does
not force a difference. The rules are Snapback 4's, restated so that the
treatment is named and nothing is silently dropped:

1. **Point reads** are proven by a row on a maintained page, current as of
   the applied watermark (versioned coverage: the device's last applied
   watermark, online or offline). A retained, expired or released row is
   not a witness; a `through` parent must be live and covered.
2. **Absence checks and branch-deciding constraints** (`if absent`,
   `upsert`, `require not exists`) are proven only by a complete, uncut
   acquisition whose key range covers the exact population tested, **whose
   key pins readability and whose pinned rule evaluates positively for the
   viewer** (`upsert_absence_proven`), or whose table is public. A cursor
   page with a `next` is not a population.
3. **Body range reads** (`for … where`, `count`) are proven under rule 2;
   otherwise the mutation queues.
4. **Exemptions, as Snapback 4 has them:** a freshly minted id needs no
   primary-key proof; a range keyed by a row created earlier in the same
   body is treated as empty apart from the body's inserts **only when the
   created row's identity is fresh** (a minted id, not a supplied one); a
   row created earlier in the body is visible to later reads in it, and
   its read rule is still evaluated (provisional read authority).
5. **Plain-insert constraints stay optimistic:** `unique` and `at most N
   by` on a plain insert are checked against held rows and the server may
   refuse. Prior outbox rows are part of the held set, so two offline
   inserts cannot both take the last seat.
6. A condition that depends on `now` is never proven on the device.
7. **The timeline-edge rule:** a follow, unfollow or refollow on a
   materialized Following feed queues (online-only slot accounting). A
   write to an input of an `online only` view predicts; only reads of that
   view are server-only.
8. **The effects-only presence exception:** a mutation whose only unproven
   read is `connected[p]`, and where presence decides only whether an effect
   is emitted, stays eligible; the server decides the effects at commit.
   This is why #19's `send` predicts, and it is kept.

There is no occupancy witness. Otherwise the write queues with no local
image and settles on the server. `predicts: eligible | never` is a
generated fact per operation; `why send` names the read that failed and
the page that would satisfy it. A refusal removes the local image.

**Where residency forces a difference**, named as part of the treatment
(§9.2): a range that Snapback 4 proved from a whole held partition (a
public `likes` table under `sync public`) is proven in Snapback 5 only when
an acquisition covers it. So `setLike` predicts only from a post page whose
closure holds the viewer's like row or a covered absence; `setFollow` under
#19's application-owned feed predicts from a profile page whose closure
holds the edge; under the target's materialized feed both queue by rule 7.

**The rate is computed, not written.** The pre-registered queueing rate is
produced by running `snapback5 why` over a **pinned program** (the
committed target plus §3.3's additions, committed by hash) for every
mutation under a scripted device workload with a fixed mix of cold, warm,
released and offline states, and committed with the program before any
run. §9.3 gates against that artifact, not against a hand table. Revision
3's table is withdrawn.

## 5. The client contract

```ts
const app = createApp({ url, schema });            // the device is chosen by platform
const r = useQuery(app.home);                      // Read<T>: data, complete, cut, fresh, since, next | loading | denied
const w = await app.createPost({ postId: mintId(), body });   // pending | sent | failed { reason }
const outbox = useOutbox(app);                     // writes with no row yet, by operation and arguments
const auth = useAuth(app);                         // signed-out | restoring | signed-in
```

**`complete` means what it means in Snapback 4**, word for word, plus one
reason for `false`: the page's closure is not held or not current as of the
applied watermark, which includes a released page and a page whose acquired
group has not yet been acquired by the depth step. A pending write does not
make a page incomplete. Staleness is `fresh` and `since`. A retained row
does not spoil coverage. The outbox view is the one client addition and is
named as part of the treatment (§9.2); Snapback 4's `usePendingWrite`
remains.

## 6. `check`, and what is scale evidence

The default `check` prints errors, the completeness class of every query,
the disclosure notes, each table's device admission, the derived residency
of §4.1, the `id`-argument warning, and one pointer line to `--scale` for
any operation whose cost grows with data. `check --scale` prints Lane H's
certificates, cost spans, edge windows and the cost notes. The brief does
not change.

## 7. The concept budget

Two tested numbers, with a **counting rule frozen at commission**:

- **The concept count:** one point per entry in §3.1's bulleted lists; one
  per runtime state the generated client exposes (each `Read` and `Write`
  variant, each auth state, `E_GENERATION` and each refusal code the
  generated `api.ts` enumerates); and **one per concept the default `check`
  prints that the builder can change** (the warm set, the depth step and
  its trigger, eviction and retention, per-table device admission, the
  outbox). Derived residency's replacements for the authored spelling are
  counted, so the count cannot fall by moving a concept from a declaration
  to a printout. Diagnostic codes an author *can draw* are not counted.
- **The first account:** the README's orientation length before the first
  reference card, budgeted at 300 lines under W14b.

The count is reported for Snapback 4's surface and for §3.1 before any
implementation, and reported at the first calibration. It becomes a
ratchet only after that calibration shows the number tracks builder
effort.

## 8. Relationship to Snapback 4

- **A shared baseline, then two arms.** The additions of §3.3 (`through`
  when revision 2 exists, `written by`, `sequence by`, the row-keyed
  maintained view, `readable by audience`) land in Snapback 4 and are the
  **shared baseline**, pinned by artifact hash. Both arms are built from
  it.
- **The treatment's hooks live in feature-gated modules** (`spans`:
  acquisition records, in-stream acquisition and refill, the join's two-row
  delivery, the per-device acquisition index; `pages`: device page tags),
  with call sites that add no lines to shared files, so the control's
  panic-location metadata does not shift. The control is built from a build
  graph that **excludes `snapback5`**, with its resolved feature set
  asserted, so feature unification cannot switch the hooks on.
- **The gate is behavioral equivalence, not byte identity:** the simulator's
  invariant suite and a recorded replay produce identical stream bytes and
  identical store hashes on the shared baseline with and without the hook
  modules compiled out. Byte identity is reported as best effort.
- **The device must fit the inherited wasm budget**, 486,000 gzip bytes,
  with `pages` on; measured.
- **Lane L** (fair engine lock, time-sliced background work, the
  populated-view rebuild behind the activation barrier) lands in Snapback 4
  first.
- **Sibling, not successor.** Snapback 4 continues as the control. Snapback
  5 is a number that never ships if the bet fails. For the comparison,
  Snapback 5 publishes pre-release packages (`snapback5@0.0.x-rc`), because
  protocol rule 6 makes lanes run from a source checkout diagnostic-only.
- **Fence and numbering.** `snapback5/` behind its own `AGENTS.md`; LLPs
  4000 and up.
- **The simulator's invariants** (LLP 3000 §6) apply, with two changes:
  invariant 7 is restated as **convergence of pages** (after faults stop,
  every maintained page on every device equals the server's evaluation of
  the same key at the device's applied watermark), and a **differential
  page invariant** is added: at quiescence and at random points, every
  maintained page reporting `complete: true` equals the server's evaluation
  of the same (generation, plan, viewer, arguments, cursor) at the device's
  applied watermark. This is the check that would have caught the join gap
  in revision 3, and it is the first slice's primary test.

## 9. Evaluation, pre-registered

### 9.1 Two readings, registered before any lane runs

- **(A) The spelling.** In the learning-cost phrases of the treatment arm's
  notes, across every category, the named items **expected to disappear**
  are: `sync`, horizons, residency, audiences-as-declarations, eligibility
  keywords, `N_NO_HORIZON`/`N_HORIZON_GUARD`/`N_NOW_SERVER`. The named items
  **expected to stay**, in both arms: completeness classes, prediction
  proofs, bounds, "the compiler's distinctions", Quarry itself. Reading (A)
  holds when the treatment arm's count of expected-to-disappear items is
  zero in every run **and** its total count of learning-cost items is at
  or below the control's in the paired run (run i of the treatment against
  run i of the control, in interleaved order).
- **(B) The language.** Otherwise.

A model from a third family (neither the builder's nor the grader's; the
holistic scorer, `gpt-6-astra` xhigh, is the builder's family and is not
the classifier) classifies **both arms'** notes blind to which arm wrote
them, with a rubric committed by hash before any lane runs, following LLP
3000.012 §2.2's procedure. The rubric names "span", "page", "closure",
"warm set" and "depth step" as learning-cost items when a note calls them
something to learn. Intended consequences (more writes pending, one-step
depth) count only under that same test. The author does not classify.

**Reading (B) ends the named bet**, stated here and nowhere else: a clock
win under reading (B) is recorded as "the treatment bundle saved time; the
residency hypothesis was not supported", Snapback 5 does not ship, and the
bundle's items are candidates for Snapback 4 on their own evidence. Zero
expected-to-disappear items in **both** arms is not evidence for removal;
it is recorded as "no residency charge in either arm" and the named bet is
not supported.

### 9.2 The comparison is Snapback 5 against its control

The bet is judged against **Snapback 4 on the shared baseline**. The
treatment is: derived residency (§4.1–4.3), the prediction differences
named in §4.5, the outbox view, and the default `check` output (§6).
Nothing else differs. Both arms run interleaved and serial on one host
(protocol rule 5), alternating arms, N = 3 per arm with the Astra-medium
builder and the claude-opus-5 grader, scored by gpt-6-astra xhigh, from
published pre-release packages on the frozen instrument of calibration
#19, plus one Opus 5.5 high pair, reported and not decisive. The
incumbents remain the product reference from the 2026-09-24 reference
lanes.

### 9.3 Instruments

| Instrument | Statistic | Threshold, relative to the control in the same comparison | Verdict |
| --- | --- | --- | --- |
| **Primary clock** | The protocol's clock to the last passing acceptance evidence of the **builder's** campaign (M1–M6 and M8, native artifacts included), median over three runs. The delivery load is a separate harness run and is **not** inside this clock. A capped or aborted run enters as the campaign's cap (four hours per milestone, summed over milestones reached) | **Win:** treatment median ≤ control median − 25 min and every treatment run below the control's slowest. **Loss:** treatment median ≥ control median + 25 min. Otherwise **not distinguished** | win / loss / not distinguished |
| Secondary clock | Per-milestone `firstGreenAt`, median | Reported | none |
| **Correctness gate** | The 101 frozen assertions plus the 18 M8 assertions listed by id in the reference packet's manifest (hash recorded there), **minus the 9 M7 assertions**, which neither arm runs: 110. Pass rate over 110, not-run as not passed, native artifacts required for every lane; blockers by the grader's severities; the committed holdout probe set inside the published categories | **Non-compensating:** zero blockers in every run; every holdout probe passes in every run; treatment pass rate ≥ control's − 2 assertions, in every paired run | pass / fail |
| **Delivery load** | A separate harness run on a **pinned reference program** (the target plus §3.3's additions, by hash), not the builder's program: every user connected holding the warm set and depth step; the probe user with 100 conversations open (inbox page sized to 100); 50 members watching the busy group; 900 followers on `home`; a fixed churn and disconnect script. Measured per run, both arms instrumented identically: total server CPU per minute across all paths, CPU-ms per logical action of the fixed workload, bytes delivered per device per minute, delivery latency from commit to device apply, server acquisition-index bytes per connected device, reconnect catch-up, cold start (time to warm set plus depth step for the probe user), device store size, and the queueing-without-image rate per operation | Every run: treatment ≤ 1.5× control on CPU per minute, CPU per action and delivery p95; ≤ 2× on bytes per device and index bytes per device; cold start ≤ 1.2× the control's cold start for the same probe; queueing rate within ±10 points of the pinned artifact of §4.5 per operation | pass / fail |
| **Score floors** | Non-inferiority on the holistic score and a named subset: `queries_and_live`, `offline_sync`, `client_integration`, `writes_and_transactions`. Margin per category = 2 × its run-to-run sd over 0.2.31–0.4.0 (§1): holistic 4, queries 3, offline 5, client integration 9, writes 3. With five tests at once, a single trip on noise is expected about one run in ten; a floor therefore fails only when the treatment mean is below the control mean minus the margin **in the median run and in the mean of three** | pass / fail |
| **Mechanism** | §9.1's classification of both arms | Reading (A) is required for the named bet to pass | gate |
| Other categories and `data_modeling` | Reported, both arms | 94 in `data_modeling` is the hope, not the bar | none |

**Combination rule.** The named bet **passes** only if the clock is a win,
correctness, delivery and floors pass, and reading (A) holds. It **fails**
if the clock is a loss, or correctness, delivery or floors fail in the
treatment where the control passes. A clock win with reading (B) is
recorded as in §9.1 and does not ship. Any other outcome is **not
distinguished**; the author then decides between a pre-registered eight-run
series (the first three runs count toward it only if that series is
registered before it starts) and a stop. Not distinguished never ships.

### 9.4 The variance-transfer rule

- **Variance source:** the last five Snapback 4 Astra-medium whole-brief
  clocks (77, 79, 82, 90, 115 min; sample sd 15.6 min), transferred to
  both arms as the per-run sd. Cross-version to repeated-run transfer,
  registered as such.
- **Statistic:** the difference of medians over N = 3 per arm.
- **Thresholds:** 25 minutes each way. This is an **operational decision
  threshold**, about 1.6 sd of a single run, not a claim of statistical
  power; a difference inside ±25 is not distinguished. With no true effect,
  a loss or a win by noise each occur in roughly one comparison in twenty
  under a normal model, which is the registered false-verdict rate.
- **Stopping rule:** three runs per arm, then the verdict. A run discarded
  by the load gate is discarded before its results are read and rerun.

### 9.5 Choices fixed now

| Choice | Fixed value |
| --- | --- |
| Which clock decides | The primary clock of §9.3, builder's campaign only |
| Delivery load | Separate harness run on the pinned reference program; not in the clock |
| Capped or aborted runs | Enter the median at the campaign's cap |
| Assertion list | 110 (101 + 18 M8 − 9 M7), by id and hash in the reference packet |
| M7 | Not run in either arm; its assertions excluded from both |
| Native artifacts | Required for every lane; a Hermes bundle export per milestone plus the M6/M8 simulator artifacts, all graded |
| Not-run | Counted as not passed |
| Correctness threshold | Zero blockers; every holdout probe; pass rate within 2 assertions of the control, every paired run |
| Holdout probes | Inside the published categories, written by a session that has not seen any Snapback 5 code, committed by hash before the first slice begins; the checks a Clique app cannot exercise (a removed member's history under the default policy, an audit-shaped table, completeness over a hidden-row range) move to the first slice's simulator suite against a fixed program |
| Grader | claude-opus-5, calibrated on the committed probe set (`calibrationPassed` true) |
| Scorer | gpt-6-astra xhigh, from the lane's narrative files |
| Classifier | A third family, named in the rubric commit; not the builder's or grader's family |
| Load gate | Load from **outside the lane's own process tree** (host load minus the lane's process-tree CPU, sampled every 30 s); a run is discarded and rerun if that external load's median exceeds 18 or any sample exceeds 36; the lane's own replays and builds never trigger it |
| Floors | §9.3's non-inferiority margins, median run and mean of three |
| Delivery ratios and unit | As §9.3; every run |
| Cold-start baseline | The control's own cold start for the probe user in the same run; threshold 1.2× |
| Queueing rate | The pinned `why` artifact of §4.5, ±10 points per operation, on the scripted workload |
| Reading (A) | §9.1, both arms, paired run for run |
| Second builder family | One Opus 5.5 high pair, reported, not decisive |
| Publication path | `snapback5@0.0.x-rc` pre-releases |
| Mechanism | A gate; reading (B) ends the named bet (§9.1) |
| §11 question 5 | The first slice stops at step 6 of §9.6 |

### 9.6 Order of work

1. This revision to the author, with the three round-3 verdicts (§12).
2. The concept count of the committed 0.4.0 target under §7's rule, and of
   §3.1, recorded here.
3. The additions in Snapback 4, each reviewed, as the shared baseline; Lane
   L landed.
4. The reference lanes' record.
5. The holdout probe set, the classifier rubric, and the pinned reference
   program with its `why` artifact, all committed by hash.
6. The first slice: the messaging half on derived residency (warm set,
   depth step, acquisition records, the join, device-computed pages), with
   the simulator's invariants, the differential page invariant, and the
   delivery load measured against the control. **Stop here for the author's
   decision.**
7. The §9.2 comparison, if commissioned.

## 10. Risks, and what falsifies the bet

- **The saving is authoring, not delivery.** Under one channel, Snapback 5
  delivers what Snapback 4 delivers to a device that holds the same public
  pages. If the residency spelling is not where the charge lives (reading
  B), the named bet is over and the record says so.
- **Derived depth is a product limit.** One step beyond the warm set is
  less than an authored horizon, and page size and order decide offline
  coverage. `check` prints it. Falsified by `offline_sync` below its floor.
- **Fewer predictions where a whole partition was the witness.** Named in
  §4.5; the rate is gated against the pinned artifact.
- **The flipped default (§3.2).** `check` prints it per table; the first
  slice's simulator suite includes an audit-shaped table.
- **Feature-gated hooks in the control's crates.** The build-graph
  exclusion and the behavioral-equivalence gate are what keep the control a
  control.
- **The grader and the sample.** Standard deviation near three; N = 3 with
  a written transfer rule and a symmetric 25-minute threshold; not
  distinguished never ships.
- **Self-attribution.** A third family classifies both arms; the author
  reads the reviews before the lead's summary of them.

## 11. Questions for the author

Two of revision 1's five questions were answered on 2026-09-24 (a fenced
sibling: yes; the reference lanes: yes, running). The round-1 reviews did
not answer the others identically; the answers below are this document's
choices among their recommendations, pending the author's ruling:

2. **The additions:** none in Snapback 5's first slice. All land in
   Snapback 4 first as the shared baseline: `written by`, `sequence by`,
   the row-keyed maintained view and `readable by audience` first;
   `through` when LLP 3000.014 revision 2 exists. The receipt table stays
   in both arms.
3. **Offline depth:** one engine-derived step beyond the warm set (§4.1),
   printed by `check`, with §4.1.1's budget.
4. **The concept budget:** a reported number under §7's frozen rule until
   the first calibration, then a ratchet.
5. **The budget for the comparison:** the first slice stops at step 6 of
   §9.6. The six-run comparison of §9.2 is a separate commission.
6. **Whether to continue at all.** Three rounds of blind review have left
   the direction settled and every review NOT READY on remaining
   contracts. Revision 4 supplies the contracts the round-3 reviews named.
   The lead's recommendation: do not run a fourth round on this document;
   if the author wants Snapback 5, commission steps 2–6 of §9.6, whose
   first slice is small (the messaging half, the simulator, the delivery
   load) and produces the evidence the reviews could not: whether a page
   computed on the device over acquisition records agrees with the server.
   If the author does not, the additions of §3.3 stand on their own as
   Snapback 4 work, and this document is marked Shelved with its reviews.

## 12. Review record

### Round 1 (revision 1, `3106ff03d9`)

Three blind design reviews, all **NOT READY** (Astra 15 findings, Grok 5
sections, Opus 24 findings). Dispositions recorded in revision 2.

### Round 2 (revision 2, `dbb10169b6`)

Three blind delta reviews, all **NOT READY**, each with a row-by-row
assessment of revision 2's dispositions. Dispositions recorded in revision
3 and re-assessed by round 3 below.

### Round 3 (revision 3, `4619cf3fc2`)

Three blind delta reviews. **Astra** NOT READY (13 findings: the
acquisition-coverage certificate, post-removal revocation, the receipt
state machine and its cost, the `written by` contract, proof soundness in
named cases, the shared baseline, the decision rule's interpretation and
measurement gaps). **Grok** NOT READY, "the next edit is local" (post-leave
revocation, delivered as acked ids, the rate table, reading (B), the refill
as a durable event, the depth cap unit). **Opus** NOT READY, "READY WITH
CHANGES for the first slice" with seven changes (joins, retained history,
receipts, ordinals, the predictor, the decision rule, the simulator). All
three agreed the direction is settled: one channel, device-computed pages,
in-stream refills, Snapback 4's `complete`, sound proof rules, a real
decision rule.

| Round-3 finding | Disposition in revision 4 |
| --- | --- |
| A join has no defined behavior; a new conversation never reaches the inbox (Opus B1) | §4.2: a join delivers the membership row and the parent row; the inbox treats an unacquired group as closure not held; the depth step acquires it; "bootstrap" removed from the unchanged list |
| A span start is not coverage; fifty-one messages share a sequence; released pages reopened over holes; requested spans need authorization (Astra 1, Opus M2, Grok) | §4.2: acquisition records as key ranges with floors, per table/index/prefix, with generation, image fence and page key, durable in the principal's partition, idempotent; refills extend and eviction shrinks; a released page is re-acquired when reopened; requests intersected with authorization intervals |
| Tombstone-only subscription cannot carry delete-for-everyone, leaks departures, costs forever (all three) | §3.2: withdrawn; retained history is frozen at removal, as in Snapback 4 and the brief; a declared revoking column noted as a possible later addition |
| `delivered` is not exact from sequences, exceeds the write ceiling on a mark advance, and lives behind a treatment-only feature (all three) | §3.3: withdrawn; the receipt table stays in both arms; engine-derived delivery is a future LLP |
| Ordinals are client-supplied and unconstrained (Opus H3) | §3.3: `sequence by` assigned by the engine at commit; join position on the same sequence; marks clamped by a program rule over a declared maximum |
| `written by` has no field contract (Astra 5) | §3.3: initialization, patches, projection (`readable by audience`), monotonic rule |
| Unread cannot be declared and counts tombstones; the clamp needs a maximum (Opus M5, Astra 3) | §3.1 and §3.3: a maintained view keyed by another table's row, with the exclusions, and `max … by` |
| The rate table contradicts the rules; rule 6 too broad; the presence exception dropped (all three) | §4.5: Snapback 4's predictor verbatim, the timeline-edge rule and the effects-only exception restored, residency differences named as treatment, the rate computed from a pinned program and committed by hash |
| Rule 2 lacks positive readability; a cursor page is not a population; the created-parent exemption; provisional read authority (Astra 6) | §4.5 rules 2 and 4 |
| Carried results cannot be kept current (Opus M3, Astra 13) | §4.3: withdrawn; such pages are not device-evaluable |
| The depth cap's unit; `id` arguments; pinning every `keep history` row (Opus M4, Grok, Astra 8) | §4.1: one first page per qualifying query per warm-page row, drop order stated, `check` warns on `id` arguments, only post-removal rows pinned and outside the budget; §4.1.1 states overflow behavior |
| Byte identity vacuous or unachievable; feature unification; the shared additions depend on `spans`; wasm 486,000 (Opus M1, Astra 9) | §8: a shared baseline by hash; hooks in feature-gated modules; the control built from a graph excluding `snapback5`; behavioral equivalence as the gate; the budget corrected |
| "Loss" has no margin; thirteen uncorrected floors; the load gate would have discarded #19 and counts the lane's own work; reading (B) answered three ways (Opus H5, Astra 10–12, Grok) | §9.3–9.5: symmetric 25-minute thresholds; non-inferiority on five categories with margins from the run-to-run sd and a stated trip rate; the load gate scoped to external processes; reading (B) stated once as a gate |
| Nothing checks that a device page is right (Opus H6) | §8: the differential page invariant; invariant 7 restated as convergence of pages |
| The new server state and per-request work unmeasured; CPU per commit games the denominator (Opus M6, Astra 12) | §9.3: CPU per minute across all paths, CPU per logical action of a fixed workload, index bytes per device, every run |
| Holdout probes a Clique app cannot exercise (Opus L1) | §9.5: those checks move to the first slice's simulator suite |
| The concept count omits what derived residency adds (Opus L2) | §7: one point per concept `check` prints |
| Vestigial text: the time-boundary index, "before the entry", the sharing rule, "sync image", view-once as a log event; `members` has no `update` rule (Opus L3, Grok) | §4.2–4.3 and §3.1 corrected |
| Delivery load inside the clock; capped runs; M7; the 18 M8 ids; pairing; "N = 8 or a stop"; the scorer unnamed (Opus §3) | §9.3 and §9.5 |
| Cold start compares unlike workloads (Grok, Astra) | §9.3: the control's own cold start for the same probe, 1.2× |

This is the bounded stop of the refine loop. The document goes to the
author with these verdicts; a fourth review round is the author's call,
and §11 item 6 records the lead's recommendation against one.

## Non-claims

This RFC does not claim the surface of §3 is sufficient for every
application; it claims it is sufficient for the calibration brief and the
Workroom shape and that anything further must enter the count. It does not
claim that Snapback 5 delivers less than Snapback 4; it claims to author
less. It does not propose changing the grader, the brief or the protocol;
it registers one variance-transfer rule under the protocol's own exception.
It does not claim a score: 94 in `data_modeling` is the hope named in §9.3,
and the named bet passes only on the clock against the control, correctness,
delivery, the floors, and reading (A).
