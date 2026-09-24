# LLP 4000: Snapback 5 — the bridge is invisible

**Type:** RFC
**Status:** Draft
**Role:** Root of a proposed Snapback 5 corpus (LLPs 4000 and up), if commissioned
**Systems:** A Snapback 5 authoring surface over the Snapback 4 engine; derived residency; the device replication policy; the client contract; `check`; the calibration protocol
**Author:** Claude Fable 5.1, at Charlie Cheever's request
**Date:** 2026-09-24
**Revised:** 2026-09-24 (revision 2, after three blind design reviews, all NOT READY — [Astra max](./reviews/4000-snapback5.astra.md), [Grok 4.7 xhigh](./reviews/4000-snapback5.grok.md), [Opus 5.5 max](./reviews/4000-snapback5.opus.md): the partition log is kept as the authority and the revocation channel and pages become an index over it; the leave policy, `online only`, product bounds and the completeness class stay; the read and write result types stay; prediction is proof against versioned coverage; both additions land in Snapback 4 first; the bet is judged against a Snapback 4 that carries them; §1's wrong rows corrected; §12 records dispositions); 2026-09-24 (initial)
**Related:** [LLP 3000](./3000-snapback4.explainer.md) (Snapback 4, the engine this proposal keeps and the control it is judged against), [LLP 3000.007](./3000.007-relaxed-quarry-and-explicit-residency.rfc.md) (explicit residency, whose spelling this proposal removes and whose mechanism it keeps), [LLP 3000.012](./3000.012-application-still-owns-derived-data.research.md) (the plateau and the charge ledger), [LLP 3000.013](./3000.013-quarry-states-intent.rfc.md) (the planner and `view`, kept), [LLP 3000.014](./3000.014-a-child-reads-through-its-parent.rfc.md) (inherited audiences; its revision 2 is the design of record for `through`), [LLP 2000.000](./2000.000-keep-the-core-flip-two-substrates.rfc.md) (the brief Snapback 4 built; §2 and §7 are engaged in §2.1 and §4 here), [calibration #19](../benchmarks/runs/2026-09-24-snapback4-clique-astra-0.4.0/README.md), [`benchmarks/protocol.md`](../benchmarks/protocol.md), the [September 5 three-backend run](../benchmarks/runs/2026-09-05-clique-full-3x3/README.md)

## Summary

Quarry exists to carry one declaration across the client–server bridge: the
same tables, rules and queries run on the server and on the device, so a
write can be predicted locally and a read can be answered offline under the
server's authority. The calibration record says the bridge itself scores
well. What the record charges, in every one of the sixteen ledgered
`data_modeling` notes and in calibration #19's, is a learning cost that names
whatever vocabulary the current release still asks the author to write:
index prefixes, then bounds, then residency, then "prediction/completeness".
Nineteen Clique calibrations sit on a holistic plateau of 85–92 (median 89)
with `data_modeling`, `queries_and_live` and `scale_and_limits` at the bottom
of every window (LLP 3000.012 §2.1). The same builder family gave Supabase 94
in the same category for "SQL familiarity and composability."

Snapback 5 is a bet, stated as a hypothesis with a registered alternative
(§9.1): that the residual charge after 0.4.0 is the **spelling of the
bridge** (`sync`, horizons, caps-as-bounds, eligibility keywords, the
residency notes) and not the language or its runtime facts. Remove the
spelling, keep every mechanism, derive what the spelling used to state from
the program's declared queries, and see whether the charge disappears or
merely moves. Revision 1 of this RFC tried to remove mechanisms along with
the spelling; three blind reviews showed, on the engine's own code, that
those mechanisms are what correctness and privacy rest on. This revision
keeps them.

Concretely, Snapback 5 is:

1. **Snapback 4's engine, kept, with named hooks.** Rules with hoisting, the
   runtime meter, the partition log, at-most-once writes, the planner of LLP
   3000.013, the device interpreter, the simulator. The engine changes it
   needs are listed in §8 and land in Snapback 4 first, dormant where they
   must not change the control.
2. **Derived residency: the partition log with a derived horizon.** No
   `sync` line, no authored horizon. What a device holds is decided by the
   program's declared queries: the pages the app has asked for, a warm set,
   and one engine-derived step of depth (§4.1). The log remains the
   authority and the revocation channel for every row a device holds,
   maintained page or not (§4.2). Pages are an index over log spans, keyed
   by generation, plan, viewer, arguments and cursor (§4.3).
3. **Completeness stays a class; the runtime facts stay typed.** A query's
   completeness class is one line of the default `check`. The read result
   keeps `complete`, `cut`, `fresh`, `since`, `next`, `loading` and
   `denied`; a write keeps `pending`, `sent` and `failed` with a reason, and
   an outbox view lists writes that have no row (§5). What leaves the
   author's path is the residency vocabulary and the notes that only
   describe residency and cost (§6).
4. **Prediction by proof against versioned coverage** (§4.5): a point read
   of a current row on a maintained page, or a complete uncut held set for a
   key range. Possession is not proof. `now` is never proven on the device.
5. **A concept budget with a frozen counting rule**, reported until the
   first calibration, counting runtime states and refusals as well as
   declaration forms (§7).
6. **Two additions, both landed in Snapback 4 first** so the control carries
   them: `through .ref` as LLP 3000.014 revision 2, and a per-viewer mark on
   the parent row that expresses receipts and unread counts without a
   per-message row (§3.3).
7. **A bar that can tell the bet from its control** (§9): Snapback 5 against
   a Snapback 4 that carries the same additions, interleaved on one host,
   under a registered decision rule; time to last green including scale
   work; correctness on a frozen assertion set with committed holdout
   probes for the trust boundaries; a delivery load the replay never
   exercised; the incumbents as a product reference. The author's ruling of
   2026-09-24 sets the order: clock, then correctness, then the score as a
   floor.

This is a proposal for the author's decision. Nothing here is built.

## 1. Evidence

The claim this RFC rests on is narrower than revision 1's: *the learning-cost
charge names whatever bridge vocabulary remains, and removing the spelling
while keeping the mechanisms is a testable way to find out whether the charge
is the spelling or the language.* The record:

| Observation | Source | What it supports |
| --- | --- | --- |
| Bottom three categories are `queries_and_live` 83.5, `scale_and_limits` 84.5, `data_modeling` 85.0 medians over 16 runs; the eight-to-thirteen-point gap to the top four survives every window and every leave-one-out population | LLP 3000.012 §2.1 | The gap is structural, not a run |
| The four categories at 94–97 rest on declarations on a table: `image <=N once`; **read rules with `sync to` and `retain delivered-history`**; client-minted ids; `expire at`. #19's authorization note (96) credits "retained-history policies" directly, and the builder's diary calls that policy "the standout" | LLP 3000.012 §2.1; #19 FINAL and lane diary | Part of what revision 1 deleted is credited with the top scores. The leave policy stays (§3.2) |
| All 16 charged `data_modeling` runs carry LC, the cost of learning Quarry and its execution model; RM (application-maintained read models) is in 12, CP (author-chosen bounds) in 12, QC (completeness or prediction reasoning) in 6. The ledger says LC overlaps the others and declines a single-cause reading | LLP 3000.012 §2.2 | Learning cost is recurring and overlapping, not a demonstrated single cause |
| What the LC phrases name, counted across the 16 abridged notes: bounds or bounded execution 11; the language itself or its expressiveness 8; completeness 5; residency 2 (3 counting "audiences"); prediction 1 | LLP 3000.012 §2.2, counted by the Opus review | The charge follows whichever vocabulary remains; the largest single name is *bounds*, then *the language* |
| Same builder family: Supabase 94, Convex 88, Snapback 2 68 in `data_modeling`; Supabase credited with familiarity and composability | LLP 3000.012 §2.1, the 2026-09-05 record | 94 is reachable in this category with this grader |
| 0.3.0 moved three derived forms into the engine: `data_modeling` 87. 0.4.0 removed index names, author-chosen caps, merge lanes and `size` (a subtractive wave): `data_modeling` 90, inside one run's noise. The LC charge stayed; what it named changed from index prefixes to bounds to "prediction/completeness" | LLP 3000.013 Summary; calibration #19 | Removing *how-the-engine-works* vocabulary has not yet removed the charge; it has moved what the charge names |
| W14b, a named removal with a pre-registered prediction (the README's reference sections to tested cards), was confirmed on `setup_and_docs` | LLP 3000.007 §20.24.3 | A removal works when it targets the category it names |
| #19 already charges *runtime* completeness in three categories: `setup_and_docs` ("insufficient examples of incomplete paginated observations"), `queries_and_live` ("completeness required explicit client handling") and `data_modeling`; platform finding 4 is an incomplete read published as `data: null` | #19 FINAL and README | The charge is already moving from compile time to run time. Making more pages incomplete moves it further unless the runtime facts are excellent (§5) |
| The 0.2.x advice repairs zeroed every targeted diagnostic shape and `setup_and_docs` sat at 0.14 sd; the bounds bar after 0.2.29 recorded a retired note's sentence reappearing in builders' reports in the note's place | LLP 3000.007 §20.22.7, §20.24 | Deleting a word does not delete the behavior the scorer reads |
| `snapback4-lang` today: 16 `N_*` note codes, 161 `E_*` codes. The committed 0.4.0 Clique target still authors `sync public`, `sync to members[.conversationId]`, `retain delivered-history`, `shape`, `view`, `search`, `immutable`, `public '…'`, `emit … once`, `schedule`; its `cap 50 by conversationId` is the brief's product rule, not residency | `snapback4/crates/snapback4-sim/tests/fixtures/intent-clique.q` | The residency spelling after two subtractive waves is still authored |
| Builder wall clock, Astra medium, whole brief: 0.2.29 122 min (89), 0.2.30 118 min (90), 0.2.31 77 min (91), 0.2.32 79 min, 0.2.33 82 min, 0.3.0 90 min, 0.4.0 115 min (88; M8 first green at 54 min, the remaining 61 min post-green scale work: the Following switch, unread-count remodelling, a second replay) | the run READMEs | The clock after first green is where a residency mechanism's cost would land; a first-green clock alone cannot see it |
| The incumbents were clocked on this brief text (unchanged since 2026-09-03) on 2026-09-05, Astra medium, older instrument, beside Snapback 2: Supabase M8 first green at 110.5 min cumulative (every milestone green, 13/13 M6 assertions); Convex about 94 min (its M6 grade 6/13); Snapback 2 19 min on M7 alone. Independent grade totals: Supabase 92/0/9 of 101, Convex 84/8/9, Snapback 2 81/11/9 | `~/clique-full-20260905/lanes/*/milestone-clocks.json`, `scores/record-tables.md`, LLP 3000.007 §2.1 | Snapback 4 at 54 min is already about twice as fast as both incumbents to first green. A clock against the incumbents cannot tell Snapback 5 from its control; §9 judges against Snapback 4. Supabase *did* pass the offline milestones; revision 1's fairness rule rested on a false premise |
| The reference lanes of 2026-09-24 (`~/clique-ref-20260924`): Convex 1.46.0, Supabase-js 2.117.1 and Snapback 4 0.4.0 on #19's instrument and host, Astra medium and Opus 5.5 high, three lanes per wave in parallel (a recorded deviation from protocol rule 5) | the packet README | The same-host, current-pin product reference §9.4 uses; not a claim-eligible magnitude |

What the evidence does not show: that the client story of Snapback 4 is
wrong (`offline_sync` median 93; #19's `client_integration` 80 was one
missing `createApp` option), or that the learning cost is specifically the
bridge rather than Quarry itself. §9.1 registers both readings.

### 1.1 What LLP 2000.000 §2 said about result caches

Revision 1 reversed LLP 2000.000's second flip (replicate the partition, not
cached results) without engaging the record that motivated it. LLP 2000.000
§2 attributes most of Snapback 2's remaining costs to "result cache, not
replica." Each of those rows, and Snapback 5's answer:

| LLP 2000.000 §2 cost of a result cache | Snapback 5 |
| --- | --- |
| Receipts and evidence identity per cached answer | Does not recur: rows are stored once with page tags, and the log's watermark is the only identity |
| Fetching page by page instead of one bulk stream | Recurs in part. The warm set and the depth step (§4.1) are fetched as log spans in one catch-up, not page by page; only pages beyond the depth step are fetched on demand |
| Composite answers going partial when one component was never fetched (`withHistory`) | Recurs unless the page's read-set closure (§4.3) is held. A page is complete only when everything it read is held and current, so a partial composite reads `complete: false`, never a wrong answer |
| Searching across all of a user's conversations answered only over what was shown | Recurs by design: local search covers held rows, and the server answers the rest (`fresh: false` locally, server answer when online). The brief's M5 scope is "already-synced messages" |
| Follower inboxes rebuilt per cache | Does not recur: Following stays server-materialized per reader (§4.6) |

## 2. The bet on one page

**Snapback 4's position** (LLP 3000.007, "relaxed Quarry and explicit
residency"): the author states what lives on the device and how much, the
compiler proves the statement, and notes tell the author when a query cannot
be complete or a write cannot be predicted. Honesty at compile time, in
exchange for vocabulary.

**Snapback 5's position:** the author states the model and the product's
reads and writes. The engine derives the horizon from the declared queries,
keeps the partition log as the authority, decides prediction by proof, and
reports the same typed runtime facts Snapback 4 reports. The vocabulary that
leaves is the residency spelling. The mechanisms stay.

The two differ in **what decides the horizon**. In Snapback 4 the author
writes `sync last 500 by …` and the compiler proves the page it implies. In
Snapback 5 the horizon is the union of the pages the app's declared queries
have asked for, a warm set, and one derived step of depth, all subscribed as
spans of the same log. A partition's audience is still the read rule,
inverted as LLP 2000.000 §7.1 inverts it. What changes is that the author
never spells the horizon, and the device holds what the product has shown
plus one step beyond it instead of everything under an authored bound.

The risk the bet takes on is named in §10: pages are an incremental
view-maintenance problem, not a filter match, and the device's offline depth
is derived rather than declared. Both are measured in §9 under a load the
calibration replay has never exercised.

## 3. The author's surface

### 3.1 What a program is

The declaration forms that stay, listed so that §7's count has a fixed
population. Everything the 0.4.0 Clique target uses is here.

```quarry
table posts:
  authorId: principal
  parentId: posts ?
  body: text <=500
  photo: image <=10000000 ?
  at: time default now
  likeCount: count likes
  immutable authorId, parentId, at
  public 'Public posts'
  insert <- .authorId = viewer
  update <- .authorId = viewer

table members:
  conversationId: conversations
  principal: principal
  role: enum('member', 'admin')
  readUpTo: time per viewer default 0            -- one value per (row, viewer); §3.3
  unique conversationId, principal
  at most 50 by conversationId                    -- the brief's product rule
  keep history                                    -- the leave policy; §3.2
  read <- exists members[.conversationId, viewer]
  insert <- exists members[conversationId = .conversationId, principal = viewer, role = 'admin']

table messages:
  conversationId: conversations
  senderId: principal
  body: text <=2000
  at: time default now
  expiresAt: time ?
  search body
  expire at .expiresAt
  keep history
  read <- through .conversationId                 -- LLP 3000.014 revision 2; §3.3
  insert <- .senderId = viewer and through .conversationId

view following: activity where .actor = viewer or exists follows[viewer, .actor]

shape postCard = { *, author: profiles[principal = .authorId], liked: exists likes[.id, viewer] }

fn editWindow(): duration = 15m

query home(c: cursor ?):
  return following last 20 by .at after c activityCard

mutation createPost(postId: id, body: text <=500, parentId: posts ?):
  return insert posts { id: postId, authorId: viewer, parentId, body } if absent

job daily(periodStart: time, periodEnd: time): …
schedule dailyDigest every 1d at 08:00: daily
effect push
```

- **Tables:** columns and their types (including media types and `once`),
  `unique`, `immutable`, `at most N by`, `expire at`, `search`, `format`,
  the leave policy (`keep history`; the default is until revoked), `online
  only`, `per viewer`.
- **Rules:** `public`, `read`, `insert`, `update`, `delete`; terms `exists`,
  comparisons with `viewer`, `through .ref`.
- **Reads:** `view`, `shape`, `fn`, `query`; forms `where`, `first`/`last N
  by`, `after c`, `matching`, a shape, `connected`.
- **Writes:** `mutation`; `insert`, `update`, `upsert`, `delete`, `if
  absent`, `require … else`, `created`.
- **Work:** `job`, `schedule`, `effect`, `emit … once`.

That is the language card, and §7 counts it.

### 3.2 What leaves, and what revision 1 wrongly listed

| Removed | Why it existed | Who carries it now |
| --- | --- | --- |
| `sync`, `sync to`, `sync public`, `sync last N by`, authored horizons | To state the device's partition and depth | The declared queries, the warm set and the depth step (§4.1). The audience is still the inverted read rule; the log still delivers it |
| `cap N by` **as a residency bound**, `first 10001`, `size`, `cap 60000` | To bound device and server work | The meter and the planner (most already removed by LLP 3000.013). `at most N by` stays as the product constraint |
| Eligibility keywords on operations (`server`, `device`) as authored forms | To state where an operation runs | Generated facts `runs` and `predicts` on each operation (§5); the compiler decides |
| The residency notes in the default compile: `N_NO_HORIZON`, `N_HORIZON_GUARD`, `N_NOW_SERVER`, `N_MAINTAIN_SYNCED`, `N_NOT_PREDICTABLE` | To make an authored residency honest | There is no authored residency to be honest about; the generated `predicts` fact carries what `N_NOT_PREDICTABLE` carried |
| Cost and scale notes (`N_WIDE_MERGE`, `N_SEEK`, `N_SPARSE_FILTER`, `N_TIMELINE_PROFILE_CAP`, `N_MAINTAINED_COLUMN_STREAM`, `N_TIMELINE_COMPAT`) | To advise on cost at compile time | `check --scale` (§6), with one line in the default `check` pointing there whenever an operation's cost grows with data |
| `createClient` versus `createApp` as an author's residency choice | To choose a tier | One `createApp` for apps; `createClient` stays for headless and third-party clients (the M6 custom client, the replay adapter) and is not a residency choice |

**Kept, contrary to revision 1.** The leave policy is a product decision the
brief tests (M3.6: removed members keep their history; a Workroom member
removed from an organization must not). One word per table, counted in the
budget. `online only` is a policy about data at rest, kept. Product bounds
are kept. The completeness class and the disclosure notes
(`N_NEVER_COMPLETE`, `N_NO_CURSOR`, `N_MAINTAINED_COLUMN_DISCLOSURE`,
`N_MAINTAIN_DELTA`, `N_PUBLIC_AGGREGATE_COPY`) stay in the default `check`
(§6). Index names and `maintain` strategies were removed by LLP 3000.013 and
are not credited here.

### 3.3 The two additions

Both land in **Snapback 4 first**, each under its own review, so that the
control carries them and any movement in `data_modeling` cannot be credited
to residency by mistake (§9.2). Snapback 5 takes the engine that has them.

**`through .ref`** is LLP 3000.014 revision 2, not a paraphrase of it. The
design of record is that document once it exists; this RFC fixes only the
decision both 3000.014 reviews said was open:

- **Lifetime: captured audience with incarnation stamps, and an engine-owned
  cascade.** The copy is the parent's substituted rule inputs under the
  schema interpretation at insert, stamped after client-supplied hidden
  fields are rejected and before the rule is evaluated. The parent's
  incarnation (intrinsic id plus a generation bumped on delete and expiry)
  is stamped with it. When a parent is deleted or expires, its children are
  deleted by the engine in the same sweep, so no orphan outlives its
  parent and no reused id inherits old children. In Clique, reactions and
  receipts die with the message.
- **Refusals do not reveal the parent.** Missing, expired and unreadable
  parents refuse identically, with the parent read budgeted in advance.
- **Write-only use persists nothing.** `through` in an insert rule is an
  authorized lookup with no stored copy unless the read rule also uses it.
- **Copied inputs never ride** query rows, `*` shapes, cursors or write
  results. They ride the sync image only when every recipient may read them.
- **Adoption fills inside activation**, parents before children, and rolls
  back if any parent incarnation is missing.
- **The audience of a `through` table is admitted the way any audience is**
  (§4.2): the substituted rule must be one of the three invertible forms, or
  `check` says the table cannot be held on a device. The device also needs
  the rows the substituted rule consults (the membership row), which §4.3's
  read-set closure supplies.

**`per viewer`** is a per-viewer **mark on the parent row**, not a
per-message row. Revision 1's `seen: bool per viewer` on `messages` stored
one hidden row per (message, viewer), the shape LLP 3000.007 §6.9 records
the 0.1.0 lane paying for and replacing with a high-water mark. The
redesign:

- `readUpTo: time per viewer default 0` on `members` (or on
  `conversations`). Each viewer reads and writes their own value. A
  mutation may set only the viewer's own value, under a field-write
  authority separate from the row's `update` rule.
- The mark is declared **private to the viewer** (the default) or
  **visible to the row's audience**. Clique's receipts need the latter,
  because the sender's tick reads other members' marks; a private unread
  badge needs the former. The declaration is the product decision, in the
  program.
- **Receipts derive from marks and membership.** A message is `read` by
  every recipient when every member whose `joinedAt` is at or before the
  message has `readUpTo` at or after it; `delivered` is the same over
  `deliveredUpTo`. The recipient set is the membership at send time, which
  the brief requires and `joinedAt` supplies. The sender's indicator is a
  range condition over the members page, which the device already holds.
- **Unread is a range count** (`count messages where .conversationId = m.conversationId and .at > m.readUpTo`), a view like any other.
- Defaults are not stored. Marks expire with their parent. Other viewers'
  private marks are never in a page, a cursor or a `*` shape.
- Marking a thousand messages read is one write to one mark, inside the
  1,024-row write limit that a per-message design would exceed.

Both additions are subtractive for Clique: the receipt table, its insert
loop in `send`, its helper rules, the hand-copied `chat` columns and their
integrity probes leave the program. §7 counts what they add.

## 4. The bridge, derived

### 4.1 Residency from queries

Every read an application can make is a declared `query` with typed
arguments, so the compiler knows the complete set of pages a device may ever
hold. Residency follows:

- **A page is held when the app has asked for it.** `useQuery(app.home)`
  subscribes the device to the log spans that page reads (§4.3). Rows are
  stored once, tagged with the pages that read them.
- **The warm set is derived, not declared:** the first page of every query
  whose arguments are absent or viewer-only, fetched at sign-in as one
  catch-up, under a stated size budget. `online only` queries are excluded.
  Heavy aggregates (`insights`, `trending`) are included only while they fit
  the budget, and `check --scale` names the ones that do not. Its cold-start
  cost is pre-registered against #19's 12.6–15.0 s.
- **One step of depth is derived.** For each row in a warm page, the first
  page of every declared query whose only non-cursor argument is a reference
  that row holds: `history(chat)` for each conversation in the inbox,
  `thread(post)` for each post on `home`. These pages are maintained while
  connected, under the device budget. This is the smallest policy that
  answers the brief's offline states (`delivered` means fetched by the
  recipient's device; M6 shows "all previously synced chats, messages"),
  and it is one step, not a horizon. Anything deeper is on demand.
- **Eviction** is by age under the device budget, and never drops a row
  that a pending write or a maintained page depends on. The budget and the
  order are stated numbers in the program's generated facts, not prose.
- **Released pages** (the app no longer subscribes) stay readable for the
  rows they hold, are not maintained for entries and exits, and remain
  subject to the revocation channel (§4.2). A released page never reports
  `complete: true` (§5).

There is no partition to declare and no horizon to choose. The device holds
what the product has shown, its first screens, and one step beyond them.

### 4.2 The log is the authority and the revocation channel

The partition log of LLP 2000.000 §7.1–7.2 stays exactly as it is: every
committed row image goes to zero or one audience partition, decided by the
inverted read rule; membership inserts bootstrap a group; membership deletes
emit one scope tombstone; deletes, expiry and view-once consumption are
tombstones; the log is never compacted and a device catches up from one
watermark. Delivered rows remain authoritative on the device
(`trust_synced_read`), which is sound only because this channel reaches
**every row the device holds**, whether or not the page that brought it is
still maintained.

- **Revocation is an event of its own.** A membership delete under the
  default leave policy purges the group on the device, including rows held
  by released pages and rows held by search pages. Under `keep history`,
  the same event stops new delivery and leaves held rows in place. Deleting
  a row, expiry and a viewed view-once photo always purge.
- **Local evaluation admits only rows current on this channel.** A row
  whose tombstone has arrived is gone from every page that tagged it.
- **Audience admission is unchanged.** A table can be held on a device only
  when its read rule is one of the three invertible forms (public; `.col =
  viewer`; one `exists t[.cols, viewer]`), including the substituted rule of
  a `through` table. `check` says, per table, whether its rows can ever be
  held on a device; there is no `E_SYNC` because there is no `sync` line to
  mismatch, but the fact is printed.
- **Simulator invariant 2** (no device holds a row its viewer may not read
  after the revocation has synced) applies unchanged, because the channel is
  unchanged.

This is the correction the three reviews agreed on. Revision 1 had pages
replace the log and lost revocation for released pages; pages are now an
index over the log, and the log is the authority.

### 4.3 Pages as an index over log spans

A page is **everything it read**: every point read and index range the plan
touched, the rows its shapes, helper functions and rule checks consulted,
and the next instant at which a time-based filter changes. That closure is
what the device must hold to evaluate the page locally and what the server
must watch to keep it current. It is incremental view maintenance, not a
filter match.

- **Key.** (schema generation, canonical plan hash, viewer and auth context,
  arguments, cursor). Only a page whose rule is public may be shared across
  viewers. `home()`, `inbox()` and `insights()` are per viewer.
- **Matching starts from the audience.** A committed write goes to its
  partition as today. From the partition, the server finds the devices
  subscribed to spans of it, and from those devices the pages whose closure
  the write touches. Matching never runs over other viewers' pages first, so
  a private write does work only in proportion to its own audience. It runs
  **off the commit path**, outside the engine lock, and is not charged to the
  writer's meter, as Snapback 4's lazy serve-time expansion is not. Delivery
  work is bounded per page and measured (§9.3).
- **Entries, exits and reorders** are what a page subscription adds to the
  log: the twenty-first message after a delete, a reorder when `likeCount`
  changes, an exit when a filter no longer holds. Tombstones and images
  still come from the log.
- **Time-based filters** (`trending`'s `.at > now - 24h`) register their
  next boundary; the server re-evaluates at that instant.
- **Schema adoption.** A page survives a schema change only if its plan hash
  is unchanged and no rule over anything in its closure narrowed. Every
  other page drops to `complete: false` and is re-fetched. A request from an
  old generation is refused with `E_GENERATION`. Fills for `through` and
  `per viewer` happen inside the existing activation barrier, parents before
  children. Redefining a populated view rebuilds it in the background; the
  `E_TIMELINE_REDEFINE` limit that cost #19 its `operations` score is Lane L's
  fix and lands in Snapback 4 first.

### 4.4 Following

Following stays exactly the server-materialized, per-reader inbox of LLP
3000.013 §4, with three restatements:

- **Admission without `sync`:** a feed may be materialized when its sources
  are readable by everyone, their write rules are owner-only, and their
  mapped columns cannot change. `check` prints the admission verdict.
- **The device holds the edges it needs.** A `home` page's closure includes
  the viewer's follow edges for the authors shown, so "still followed?" is
  evaluable locally; it does not hold the public graph.
- **`complete` is false while a backfill or cleanup for that reader is
  pending**, and the celebrity write must not hold the engine lock through
  delivery chunks. Lane L's fair lock and time-sliced background work are a
  prerequisite, and inbox matching runs outside the lock.

### 4.5 Prediction by proof against versioned coverage

A mutation is applied locally, before the server answers, only when every
read its rule **and its body** perform is proven on the device:

1. A **point read** is proven by a row that is on a maintained page and
   current on the revocation channel. A retained, expired or released row
   is not a witness; a parent must be live and covered.
2. An **absence check or a constraint** (`unique`, `at most N by`, `if
   absent`) is proven only by a complete, uncut held set for the key range:
   a maintained page whose filter covers that range, or a maintained
   occupancy witness the engine delivers for that key. Twenty held members
   do not prove a fifty-member cap.
3. A condition that depends on `now` is never proven on the device.
4. A mutation that reads a row it created earlier in the same body
   (`created messages[.message]`) sees it.

Otherwise the write queues with no local image and settles on the server.
The compiler emits the proof obligations; the runtime discharges them
against the versioned coverage it has. `predicts: eligible | never` is a
generated fact per operation; `why send` names the read that failed and the
page that would satisfy it. A refusal removes the local image, as the
partition stream does today. The promise is sound speculation over covered
local state with possible server rejection, not proof of future acceptance.

**Expected rate, stated in advance.** Applied to #19's program under §4.1
with the depth step: `send`, `react`, `markRead` and `setLike` on a held
post predict once the conversation or post page is held (the depth step
holds every inbox conversation's first page); `createDm`, `addMember`,
`follow`/`unfollow` and the `now`-dependent `edit`/`deleteMessage` queue
without an image, as `follow`/`unfollow` and the two `server` mutations do
today. §9.3 measures queueing-without-image separately from `pending`.

## 5. The client contract

```ts
const app = createApp({ url, schema });            // the device is chosen by platform
const r = useQuery(app.home);                      // Read<T>: data, complete, cut, fresh, since, next | loading | denied
const w = await app.createPost({ postId: mintId(), body });   // pending | sent | failed { reason }
const outbox = useOutbox(app);                     // writes with no row yet, by operation and arguments
const auth = useAuth(app);                         // signed-out | restoring | signed-in
```

The runtime facts Snapback 4 grew are kept, because each one carries a
product distinction the brief tests:

- **Reads:** `complete` (the server could prove the page is the whole
  visible result **and** the device holds its closure current with no
  pending write touching it and its local result equals the server's), `cut`
  (withheld where disclosing it would leak), `fresh`/`since` (staleness,
  which `complete` never means), `next` (the continuation), `loading`,
  `denied`. `complete` is false for a released page, for a page whose class
  is never-complete, and for a page with a pending write in its closure.
- **Writes:** `pending`, `sent`, `failed` with a typed reason (an edit
  replayed after its window closes is refused, and the app can say so). A
  write with no row is visible in the outbox, so M6.2's "both show pending"
  holds for unpredicted writes.
- **Generated facts:** `runs: device | server` and `predicts: eligible |
  never` per operation, so the app knows at build time when it must draw
  its own placeholder.

What leaves the client is the residency tier, the `sync` status, and the
eligibility keywords as things the author writes. Two booleans were revision
1's client story; three reviews showed on the brief's own acceptance steps
that they lose information the app needs.

## 6. `check`, and what is scale evidence

The default `check` prints errors, the completeness class of every query
(one line: `home: complete by cursor`; `searchAll: never complete — the rule
reads a column the scan does not pin`), the disclosure notes, each table's
device admission, and one pointer line to `--scale` for any operation whose
cost grows with data. `check --scale` prints Lane H's certificates, cost
spans, edge windows and the cost notes. The README's scale card names
`check --scale` in its first line, because #19's certificate went unused for
lack of that sentence. The brief does not change.

## 7. The concept budget

Two tested numbers, with a **frozen counting rule** published at commission:

- **The concept count:** every entry in §3.1's lists (declaration forms,
  column modifiers, constraint forms, rule terms, read and write forms, work
  forms), plus the runtime states and refusals an app must handle (the read
  states, the write states, the `why` outcomes, `E_GENERATION` and the
  refusal codes a generated client can receive). Runtime states count so
  that moving a concept from compile time to run time cannot lower the
  number without lowering what the builder learns. Diagnostic codes an
  author *can draw* are not counted, because that would reward hiding a
  better error.
- **The first account:** the README's orientation length before the first
  reference card, already budgeted at 300 lines under W14b.

The count is **reported** for Snapback 4 and for this surface before any
implementation (§9 step 2), and reported at the first calibration. It
becomes a ratchet only after that calibration shows the number tracks
builder effort. `through` and `per viewer` enter the count; what they remove
from Clique is application machinery, which the count does not measure and
the clock does.

## 8. Relationship to Snapback 4

- **Engine reuse, with named hooks.** `snapback5/` depends on
  `snapback4-core`, `snapback4-device` and the planner as crates. Revision
  1's "nothing in the engine is rewritten" was wrong; the engine needs:
  - a post-commit change feed that carries the ranges and point reads each
    write touched (lands **dormant** in Snapback 4; nothing reads it there);
  - page tags in the device store and page-keyed catch-up (Snapback 5 only);
  - `through` stamping and cascade, and per-viewer marks (land in Snapback 4
    as the two additions, reviewed there);
  - Lane L's fair engine lock and background-work slicing, and the
    populated-view rebuild (Snapback 4, already in flight).
  Each hook says which side of the fence it lives on, so the control is not
  changed by the registry.
- **Sibling, not successor.** Snapback 4 continues as the control, carrying
  the two additions. Snapback 5 is a number that never ships if the bet
  fails (LLP 3000 §1, decision 2, applied again).
- **Fence and numbering.** `snapback5/` behind its own `AGENTS.md`; LLPs 4000
  and up; the wasm budget inherited at Snapback 4's current value because
  it ships the same device.
- **What it cannot borrow.** Nothing in the log. The simulator's invariants
  (LLP 3000 §6) apply unchanged; the page invariant is written down in
  addition: a page reports `complete` only under §5's conditions, and a
  released page never does.

## 9. Evaluation, pre-registered

### 9.1 Two readings, registered before any lane runs

- **(A) The bridge.** With the residency spelling gone and the mechanisms
  kept, the learning-cost charge disappears from `data_modeling`, and no
  category's note charges runtime completeness, pending writes or gaps in
  offline data.
- **(B) The language.** The charge persists and names pages, `complete`,
  `through`, or Quarry itself.

A model from another family classifies every category's note blind, with a
frozen rubric that covers the learning-cost charge and any charge about
runtime completeness, pending writes or offline gaps, using LLP 3000.012
§2.2's procedure (by reading, not by keyword). The author does not classify.
If the clock moves and the notes still carry the charge, reading (B) is
confirmed: a failed prediction, not an untested one.

### 9.2 The comparison is Snapback 5 against its control

The incumbents are already about half Snapback 4's speed to first green on
this brief (§1), so a clock against them cannot separate the bet from the
control. The bet is judged against **Snapback 4 carrying the same two
additions**, so that the only difference is derived residency and its
runtime facts:

- both run interleaved on one host, serially per protocol rule 5, with the
  load gate recorded;
- N ≥ 3 each under a variance-transfer rule registered here (the series'
  observed scorer standard deviation of about 3 and the wall-clock spread
  of the last five Snapback 4 runs), or N ≥ 8 each for an ordering claim;
- the same builder (Astra medium) and grader (claude-opus-5) as the
  calibration series, with a second builder family (Opus 5.5 high) on at
  least one pair.

The incumbents remain the **product reference** across all milestones,
from the 2026-09-24 reference lanes (§1) and any later rerun.

### 9.3 Instruments, in the author's order

| Criterion | Definition | Reference |
| --- | --- | --- |
| Clock | Protocol `firstGreenAt` on a frozen assertion-level intersection every lane attempts, **and** time to the last green including scale work; tokens beside both | Snapback 4 0.4.0: 54 min to M8 first green, 115 min total; incumbents 94–110 min to first green (different week) |
| Correctness | Pass **rate** over the frozen assertion list with a registered rule for not-run (a not-run on a shared check counts as not passed); native artifacts required for every lane or excluded for every lane; blockers as the grader's existing severities; a committed holdout probe set, by hash, covering revocation reaching a released page, a removed member's history under both leave policies, server-side denials surviving the offline cache, and completeness over a range full of rows the viewer cannot read | #19: 85/0/16 of 101, uncalibrated grader, no holdout set |
| Delivery load | A pre-registered load during the replay's last segment: every user connected and holding the warm set and depth step; the probe user with 100 conversations open; 50 members watching the busy group; 900 followers on `home`. Measured: matching work per commit, delivery p95, registry memory, reconnect catch-up, cold-start of the warm set, and queueing-without-image rate per operation. Each bounded against Snapback 4 with the same devices connected | Not measured by any calibration to date; the replay settles each action with no devices holding pages |
| Score floors | Holistic ≥ 89; `queries_and_live`, `offline_sync`, `client_integration`, `writes_and_transactions` and `setup_and_docs` at or above the median of Snapback 4's last five runs (the categories a relocated charge would land in); every other category at or above the series median | LLP 3000.012 §2.1; `benchmarks/TREND.md` regenerated over all nineteen runs first |
| `data_modeling` | Reported, with the §9.1 classification. 94 is the hope, not the bar | 90 (#19); series median 85 |

The author's ruling (2026-09-24): a score near 89–90 is acceptable if the
clock beats the incumbents and the results are very correct. Under §9.2 the
clock that decides is against the control, and the incumbents' clock is the
product reference the ruling asked for.

### 9.4 Order of work

1. Blind design reviews of this revision from the same three families;
   revision until READY.
2. The concept count of the 0.4.0 Clique target under §7's rule, and of the
   §3.1 surface, recorded here.
3. The two additions in Snapback 4, each reviewed (`per viewer` first; LLP
   3000.014 revision 2 for `through`), and Lane L landed.
4. The reference lanes' record (`benchmarks/runs/2026-09-24-clique-reference-lanes/`).
5. The first slice: the messaging half on derived residency (warm set,
   depth step, log as authority, pages as index, proof-based prediction),
   with the simulator's invariants and the page invariant green, then the
   social half.
6. The §9.2 comparison.

## 10. Risks, and what falsifies the bet

- **Pages are view maintenance (§4.3).** The closure of a 50-message page in
  the busy group is on the order of the members, their marks, reactions and
  profiles. If maintaining that per device costs more than the log's
  partition append plus lazy expansion, the delivery load in §9.3 shows it.
  Falsified by delivery p95 or matching work above Snapback 4's with the
  same devices. The answer is to fix delivery or stop, never to add the
  residency spelling back.
- **Derived depth is a product limit.** One step beyond the warm set is
  less than an authored 10,000-message horizon. The brief's offline states
  are answerable at one step; a product that needs more offline depth needs
  a second derived step, not a `sync` line. Falsified by `offline_sync`
  below its floor.
- **Fewer predictions than a full partition.** Under a partition, `likes`
  and `follows` were held whole; under pages, `follow`/`unfollow` queue. The
  outbox and the `predicts` fact carry this; the queueing-without-image
  rate is measured. Falsified by `writes_and_transactions` below its floor.
- **The charge moves instead of disappearing.** Reading (B). Detected by
  the blind classification across every category's note.
- **The grader.** Standard deviation near three; N=3 means are a registered
  decision rule, not a magnitude; N=8 for any ordering claim.
- **Self-attribution.** Another family classifies the notes; the author
  reads the reviews before the lead's summary of them; every wave in this
  corpus has reported itself a success and the series fit is the defense.

## 11. Questions for the author

Revision 1 asked five. Two were answered on 2026-09-24 (commission a
sibling under a fence: yes; run the incumbents' reference lanes now: yes,
running). The three reviews answered the other three the same way, and this
revision adopts their answers as its text, pending the author's ruling:

2. **`through` and `per viewer`:** neither in Snapback 5's first slice. Both
   land in Snapback 4 first, `per viewer` (redesigned as a mark on the
   parent) before `through` (LLP 3000.014 revision 2), so the control
   carries them and residency gets no undeserved credit.
3. **Offline depth:** one engine-derived step beyond the warm set in the
   first slice (§4.1), with its cold-start cost pre-registered. Not "what
   was shown", and not an authored horizon.
4. **The concept budget:** a reported number under a frozen rule until the
   first calibration, then a ratchet.

One new question:

5. **The comparison in §9.2 is against Snapback 4 with the additions, at
   N ≥ 3 interleaved on one host.** That is roughly six full-brief runs
   beyond the reference lanes before the bet is decided. Is that the budget
   the author wants, or should the first slice be measured on the delivery
   load and the simulator alone before any calibration?

## 12. Review record

Three blind design reviews of revision 1 (2026-09-24), all **NOT READY**:
[Astra max](./reviews/4000-snapback5.astra.md) (15 findings, 4 blockers),
[Grok 4.7 xhigh](./reviews/4000-snapback5.grok.md) (5 sections, 4
blockers), [Opus 5.5 max](./reviews/4000-snapback5.opus.md) (24 findings, 3
blockers). They converged independently on the same defects and the same
narrower design. Dispositions:

| Finding (all three unless noted) | Disposition in revision 2 |
| --- | --- |
| The diagnosis over-reads the ledger; rows 2, 9, 10 wrong; the charge names whatever vocabulary remains | §1 corrected and recounted; §9.1 registers readings (A) and (B); the claim is a hypothesis |
| A page registry keyed by (query, arguments) is a cross-viewer result cache and drops revocation for released pages; the partition log and "the outer check" are the same mechanism | §4.2 keeps the log as authority and revocation channel; §4.3 keys pages by generation, plan, viewer, arguments, cursor; matching starts from the audience, off the commit path |
| `retain delivered-history` is a product policy the brief tests (Opus, Grok) | §3.2 keeps one leave-policy word per table |
| `N_NEVER_COMPLETE` is a server fact; making it a runtime fact leaks hidden rows | §5 and §6 keep the completeness class, on the server, the device and in the default `check` |
| Two booleans lose `cut`, `fresh`/`since`, `next`, `loading`, `denied`, `pending | sent | failed`, `runs`/`predicts`, `restoring` | §5 keeps the typed read and write results, adds the outbox view, keeps the generated facts |
| Possession is not proof; the mutation body counts; `now` cannot be proven; the "Lane P occupancy" citation is not in the checkout | §4.5 rewritten as proof against versioned coverage; the citation removed (it referred to an unlanded lane) |
| `through` restates a design both 3000.014 reviews rejected; lifetime undecided | §3.3 adopts revision 2 as the design of record and decides lifetime: captured audience, incarnation stamps, engine cascade |
| `per viewer` cannot express the sender's tick and stores one row per (message, viewer) | §3.3 redesigned as a mark on the parent row with declared visibility; receipts and unread derive from it |
| Some notes are disclosure facts, not scale advice | §3.2 and §6 split the notes: residency and cost notes leave the default compile; disclosure notes and the class stay |
| The bar can pass without being true: incumbents already slower, first green excludes the risky work, pass counts not comparable, no holdout probes, floors too low, author classifies LC, replay never loads the registry, no same-week rule exists | §9 rewritten: control comparison, last green included, frozen assertion set with not-run rule, holdout probes by hash, delivery load, floors at the last-five median, blind classification by another family, serial rule 5 |
| Incumbents can do the offline milestones; Supabase 13/13 on M6 (Opus) | §1 corrected |
| "Nothing in the engine is rewritten" contradicts the registry (Opus, Grok) | §8 lists the hooks and which side of the fence each lives on |
| The warm set fetches too much and holds too little (Opus) | §4.1 adds a budget, excludes online-only, adds the depth step |
| §3.1's six kinds cannot compile Clique (all three) | §3.1 lists every form the target uses |
| Schema adoption unspecified | §4.3 specifies generation keys, narrowing, `E_GENERATION`, activation fills |
| Following "unchanged" is not possible without `sync` | §4.4 restates admission and the device's edge closure; Lane L a prerequisite |
| Concept budget measures the wrong thing (all three) | §7 counts runtime states, freezes the rule, reports until the first calibration |
| Error-code count 163 should be 161; cite the committed fixture (Opus) | §1 corrected |

Revision 2 goes back to the same three families before any status change.

## Non-claims

This RFC does not claim the surface of §3 is sufficient for every
application; it claims it is sufficient for the calibration brief and the
Workroom shape (LLP 3000.009 §10.1) and that anything further must enter
the count. It does not claim that derived residency is cheaper than a
declared partition; §4.3 says pages are view maintenance and §9.3 measures
it. It does not propose changing the grader, the brief or the protocol. It
does not claim a score: 94 in `data_modeling` is the hope named in §9.3,
and the bar is the clock against the control, then correctness, then the
floors.
