# LLP 4000: Snapback 5 — the bridge is invisible

**Type:** RFC
**Status:** Draft
**Role:** Root of a proposed Snapback 5 corpus (LLPs 4000 and up), if commissioned
**Systems:** A Snapback 5 authoring surface over the Snapback 4 engine; derived residency; the device acquisition policy; the client contract; `check`; the calibration protocol
**Author:** Claude Fable 5.1, at Charlie Cheever's request
**Date:** 2026-09-24
**Revised:** 2026-09-24 (revision 3, after the round-2 delta reviews, all NOT READY — [Astra](./reviews/4000-snapback5.astra.md), [Grok](./reviews/4000-snapback5.grok.md), [Opus](./reviews/4000-snapback5.opus.md): the unit of subscription is a partition span and the device computes entries and exits itself; sharing and closure rules fixed; Snapback 4's `complete` restored unchanged; the proof rules rewritten with the audience condition, the minted-id exemption and the view-input rule; `per viewer` withdrawn in favour of field-level write authority and engine-derived delivery; the depth step bounded and printed by `check`; the cascade given mechanics; §8's hooks stated as cargo features with byte-identical control builds; §9 given a decision rule, a written variance-transfer rule, both arms classified, and every movable choice fixed; §12 extended with round-2 dispositions; §11's consensus claim corrected); 2026-09-24 (revision 2, after three blind design reviews, all NOT READY); 2026-09-24 (initial)
**Related:** [LLP 3000](./3000-snapback4.explainer.md) (Snapback 4, the engine this proposal keeps and the control it is judged against), [LLP 3000.007](./3000.007-relaxed-quarry-and-explicit-residency.rfc.md) (explicit residency, whose spelling this proposal removes and whose mechanism it keeps), [LLP 3000.012](./3000.012-application-still-owns-derived-data.research.md) (the plateau and the charge ledger), [LLP 3000.013](./3000.013-quarry-states-intent.rfc.md) (the planner and `view`, kept), [LLP 3000.014](./3000.014-a-child-reads-through-its-parent.rfc.md) (inherited audiences; its revision 2, not yet written, is the design of record for `through`), [LLP 2000.000](./2000.000-keep-the-core-flip-two-substrates.rfc.md) (the brief Snapback 4 built; §2 and §7 are engaged in §1.1 and §4), [calibration #19](../benchmarks/runs/2026-09-24-snapback4-clique-astra-0.4.0/README.md), [`benchmarks/protocol.md`](../benchmarks/protocol.md), the [September 5 three-backend run](../benchmarks/runs/2026-09-05-clique-full-3x3/README.md)

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
in nothing else. Two rounds of blind review, six reviews in all, have cut
the bet down to that. Revision 1 removed mechanisms with the spelling.
Revision 2 kept the mechanisms but described a second delivery channel
beside the partition log. Revision 3 has one channel, one watermark, and a
device that decides for itself what its pages contain.

Concretely, Snapback 5 is:

1. **Snapback 4's engine, with named hooks behind cargo features** (§8).
   Rules with hoisting, the runtime meter, the partition log, at-most-once
   writes, the planner of LLP 3000.013, the device interpreter, the
   simulator. The control's published builds are byte-identical with the
   features off.
2. **Derived residency: the partition log with a derived horizon.** No
   `sync` line, no authored horizon. The unit of subscription is a
   **partition span**; a device subscribes to the spans its pages' rows lie
   in, stays subscribed while it holds any row of a span, and catches up
   from one watermark. The device computes its pages' entries, exits and
   reorders from the rows it holds; the server's only page state is an
   index for refills, served inside the stream (§4.2–4.3).
3. **Nothing about `complete` changes.** Snapback 4's definition stays word
   for word, with one added reason for `false`: the page's closure is not
   held or not current. The read and write result types stay; an outbox
   view is added (§5). The completeness class is one line of the default
   `check`. What leaves the author's path is the residency vocabulary and
   the notes that describe only residency and cost (§6).
4. **Prediction by proof against versioned coverage** (§4.5), with Snapback
   4's audience condition, its minted-id exemption and its optimistic plain
   inserts kept, and the rate pre-registered per operation.
5. **A concept budget with a frozen counting rule**, reported until the
   first calibration (§7).
6. **Two additions, both landed in Snapback 4 first** so the control
   carries them: `through .ref` as LLP 3000.014 revision 2, and
   field-level write authority (`written by .principal`) with
   engine-derived delivery, which together express Clique's receipts and
   unread counts without a receipt table. `per viewer` is withdrawn (§3.3).
7. **A decision rule that can tell the bet from its control** (§9): one
   primary clock, a written variance-transfer rule, non-compensating
   correctness gates, floors relative to the control in the same
   comparison, both arms' notes classified blind, and every previously
   movable choice fixed in §9.5.

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
| All 16 charged `data_modeling` runs carry LC, the cost of learning Quarry and its execution model; RM (application-maintained read models) is in 12, CP (author-chosen bounds) in 12, QC (completeness or prediction reasoning) in 6. The ledger says LC overlaps the others and declines a single-cause reading | LLP 3000.012 §2.2 | Learning cost is recurring and overlapping, not a demonstrated single cause |
| What the LC phrases name, counted across the 16 abridged notes: bounds or bounded execution 11; the language itself or its expressiveness 8; completeness 5; residency 2 (3 counting "audiences"); prediction 1. #19's own diary places its remaining cost in "learning completeness notes", "the interpreter's proof of locally safe prediction", keys that carry the membership scope, and "the compiler's distinctions" | LLP 3000.012 §2.2, counted by the Opus review; #19 lane diary | The largest single name is *bounds*, then *the language*. Residency spelling is a small share of the named charge. §9.1 registers, before any run, which named items this bet expects to remove and which it expects to stay |
| Same builder family: Supabase 94, Convex 88, Snapback 2 68 in `data_modeling`; Supabase credited with familiarity and composability | LLP 3000.012 §2.1, the 2026-09-05 record | 94 is reachable in this category with this grader |
| 0.3.0 moved three derived forms into the engine: `data_modeling` 87. 0.4.0 removed index names, author-chosen caps, merge lanes and `size` (a subtractive wave): `data_modeling` 90, inside one run's noise. The LC charge stayed; what it named changed | LLP 3000.013 Summary; calibration #19 | Removing *how-the-engine-works* vocabulary has not yet removed the charge; it has moved what the charge names |
| W14b, a named removal with a pre-registered prediction, was confirmed on `setup_and_docs` | LLP 3000.007 §20.24.3 | A removal works when it targets the category it names |
| #19 already charges *runtime* completeness in three categories, and its platform finding 4 is an incomplete read published as `data: null` | #19 FINAL and README | The charge is already moving from compile time to run time. This is why §5 changes nothing about `complete` |
| The 0.2.x advice repairs zeroed every targeted diagnostic shape and `setup_and_docs` sat at 0.14 sd; a retired note's sentence reappeared in builders' reports in the note's place | LLP 3000.007 §20.22.7, §20.24 | Deleting a word does not delete the behavior the scorer reads |
| `snapback4-lang` today: 16 `N_*` note codes, 161 `E_*` codes. The committed 0.4.0 Clique target still authors `sync public`, `sync to members[.conversationId]`, `retain delivered-history`; its `cap 50 by conversationId` is the brief's product rule | `snapback4/crates/snapback4-sim/tests/fixtures/intent-clique.q` | The residency spelling after two subtractive waves is still authored |
| Builder wall clock, Astra medium, whole brief: 0.2.29 122 min (89), 0.2.30 118 min (90), 0.2.31 77 min (91), 0.2.32 79 min (88), 0.2.33 82 min (92), 0.3.0 90 min (92), 0.4.0 115 min (88; M8 first green at 54 min, then 61 min of post-green scale work). Standard deviation of the last five: about 15 min | the run READMEs | The clock after first green is where a residency mechanism's cost would land; a first-green clock alone cannot see it. Three runs per arm can distinguish a difference of about 25 min and no less (§9.4) |
| The incumbents were clocked on this brief text (unchanged since 2026-09-03) on 2026-09-05, Astra medium, older instrument, beside Snapback 2: Supabase M8 first green at 110.5 min cumulative (M1–M6 and M8 green, M7 not run; 13/13 M6 assertions); Convex about 94 min (6/13 on M6); Snapback 2 19 min on M7 alone. Independent grade: Supabase 92/0/9 of 101, Convex 84/8/9, Snapback 2 81/11/9 | `~/clique-full-20260905/lanes/*/milestone-clocks.json`, `scores/record-tables.md`, LLP 3000.007 §2.1 | Snapback 4 at 54 min is already about twice as fast as both incumbents to first green. A clock against the incumbents cannot tell Snapback 5 from its control; §9 judges against Snapback 4. Both incumbents attempt the offline milestones |
| The reference lanes of 2026-09-24 (`~/clique-ref-20260924`): Convex 1.46.0, Supabase-js 2.117.1 and Snapback 4 0.4.0 on #19's instrument and host, Astra medium and Opus 5.5 high, three lanes per wave in parallel (a recorded deviation from protocol rule 5) | the packet README | The same-host, current-pin product reference §9.3 uses; not a claim-eligible magnitude |

What the evidence does not show: that the client story of Snapback 4 is
wrong (`offline_sync` median 93; #19's `client_integration` 80 was one
missing `createApp` option), or that the learning cost is specifically the
residency spelling. The corrected record points partly away from the bet,
which is why §9.1 pre-registers the named items expected to disappear and
the ones expected to stay, and why the bet is small.

### 1.1 What LLP 2000.000 §2 said about result caches

LLP 2000.000 §2 attributes most of Snapback 2's remaining costs to "result
cache, not replica." Each of those rows, and Snapback 5's answer:

| LLP 2000.000 §2 cost of a result cache | Snapback 5 |
| --- | --- |
| Receipts and evidence identity per cached answer | Comes back smaller: a page has a key (§4.3) and a coverage watermark, which are evidence identity and coverage. There is no per-answer receipt and no per-answer certificate; the log's watermark is the only sequence |
| Fetching page by page instead of one bulk stream | Does not recur for the warm set and the depth step, which are acquired as spans in one catch-up; recurs by design beyond the depth step |
| Composite answers going partial when one component was never fetched (`withHistory`) | Recurs as `complete: false` (the closure is not held), never as a wrong answer (§5) |
| Searching across all of a user's conversations answered only over what was shown | Recurs by design: local search covers held rows; the server answers the rest. The brief's M5 scope is "already-synced messages" |
| Follower inboxes rebuilt per cache | Does not recur: Following stays server-materialized per reader (§4.4) |

## 2. The bet on one page

**Snapback 4's position** (LLP 3000.007): the author states what lives on
the device and how much, the compiler proves the statement, and notes tell
the author when a query cannot be complete or a write cannot be predicted.

**Snapback 5's position:** the author states the model and the product's
reads and writes. The engine derives the horizon from the declared queries,
keeps the partition log as the only channel, decides prediction by proof,
and reports the same typed runtime facts Snapback 4 reports. The vocabulary
that leaves is the residency spelling. The mechanisms stay.

The two differ in **what decides the horizon** and in **what the device
first acquires**. In Snapback 4 the author writes `sync last 500 by …` and
the device acquires that span of each group on join. In Snapback 5 the
device acquires the spans its warm pages and one depth step read (§4.1),
subscribes to those spans, and extends them as the app asks for more. Public
data reaches every device in both, because the warm set holds the public
pages, as #19's did. Delivery is the same stream. What is saved is the
authored spelling and the difference between an authored horizon and what
the product has shown plus one step.

That is a smaller bet than revision 1 made. It is the one the record and
six reviews leave standing.

## 3. The author's surface

### 3.1 What a program is

The declaration forms that stay, listed so that §7's count has a fixed
population. Everything the committed 0.4.0 Clique target and #19's program
use is here.

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

table members:
  conversationId: conversations
  principal: principal
  role: enum('member', 'admin')
  joinedAt: time default now
  readUpTo: int default 0 written by .principal     -- field-level write authority; §3.3
  unique conversationId, principal else ALREADY_MEMBER 'Already a member.'
  at most 50 by conversationId                       -- the brief's product rule
  keep history                                       -- the leave policy; §3.2
  immutable conversationId, principal, joinedAt
  read <- exists members[.conversationId, viewer]
  insert <- created conversations[.conversationId]
         or exists members[conversationId = .conversationId, principal = viewer, role = 'admin']

table messages:
  conversationId: conversations
  senderId: principal
  ordinal: int
  body: text <=2000
  at: time default now
  expiresAt: time ?
  search body
  expire at .expiresAt
  keep history
  read <- through .conversationId                    -- LLP 3000.014 revision 2; §3.3
  insert <- .senderId = viewer and through .conversationId
  update (old, next) <- old.senderId = viewer and now - old.at <= editWindow()

view following: activity where .actor = viewer or exists follows[viewer, .actor]

shape postCard = { *, author: profiles[principal = .authorId], liked: exists likes[.id, viewer] }

fn editWindow(): duration = 15m

query home(c: cursor ?):
  return following last 20 by .at after c activityCard
query insights():
  days = []
  for d in range(day(now) - 6, day(now) + 1):
    days = days + [{ day: d, posts: dailyPosts[viewer, d] }]
  return { days }

mutation createPost(postId: id, body: text <=500, parentId: posts ?):
  require body != '' else EMPTY_BODY
  return insert posts { id: postId, authorId: viewer, parentId, body } if absent

job daily(periodStart: time, periodEnd: time): …
schedule dailyDigest every 1d at 08:00: daily
```

- **Program:** `use identity …`, `effect`.
- **Tables:** columns and their types (including `enum`, media types and
  `once`), `default`, `unique … else CODE 'message'`, `immutable`, `at most
  N by`, `expire at`, `search`, `format`, the leave policy (`keep history`;
  the default is until revoked), `online only`, `written by`.
- **Rules:** `public`, `read`, `insert`, `update` (with `(old, next)`),
  `delete`; terms `exists`, `created`, comparisons with `viewer`, `through
  .ref` (top-level conjunct only; §3.3).
- **Reads:** `view` (including `merge`), `shape`, `fn`, `query`; forms
  `where`, `first`/`last N by`, `after c`, `matching`, a shape, `group`,
  `connected`; control flow (`if`, `for`, assignment) and the builtins
  (`range`, `day`, `hour`, `count`, `sum`, `min`).
- **Writes:** `mutation`; `insert`, `update`, `upsert`, `delete`, `if
  absent`, `require … else`.
- **Work:** `job`, `schedule`, `emit … once`.

That is the language card, and §7 counts it under the rule in §7.

### 3.2 What leaves, and what stays

| Removed | Why it existed | Who carries it now |
| --- | --- | --- |
| `sync`, `sync to`, `sync public`, `sync last N by`, authored horizons | To state the device's partition and depth | The declared queries, the warm set and the depth step (§4.1). The audience is still the inverted read rule; the log still delivers it |
| `cap N by` **as a residency bound**, `first 10001`, `size`, `cap 60000` | To bound device and server work | The meter and the planner (most already removed by LLP 3000.013). `at most N by` stays as the product constraint |
| Eligibility keywords on operations (`server`, `device`) as authored forms | To state where an operation runs | Generated facts `runs` and `predicts` on each operation (§5); the compiler decides |
| The residency notes in the default compile: `N_NO_HORIZON`, `N_HORIZON_GUARD`, `N_NOW_SERVER`, `N_MAINTAIN_SYNCED`, `N_NOT_PREDICTABLE` | To make an authored residency honest | There is no authored residency; the generated `predicts` fact carries what `N_NOT_PREDICTABLE` carried |
| Cost and scale notes (`N_WIDE_MERGE`, `N_SEEK`, `N_SPARSE_FILTER`, `N_TIMELINE_PROFILE_CAP`, `N_MAINTAINED_COLUMN_STREAM`, `N_TIMELINE_COMPAT`) | To advise on cost at compile time | `check --scale` (§6), with one line in the default `check` pointing there whenever an operation's cost grows with data |
| `createClient` versus `createApp` as an author's residency choice | To choose a tier | One `createApp` for apps; `createClient` stays for headless and third-party clients (the M6 custom client, the replay adapter) and is not a residency choice |

**Kept.** The leave policy (M3.6: removed members keep their history; a
Workroom member removed from an organization must not); one word per table,
counted in the budget. `online only`: rows never enter a partition or a
device, always answered by the server, `complete: false` offline. Product
bounds. The completeness class and the disclosure notes (`N_NEVER_COMPLETE`,
`N_NO_CURSOR`, `N_MAINTAINED_COLUMN_DISCLOSURE`, `N_MAINTAIN_DELTA`,
`N_PUBLIC_AGGREGATE_COPY`) in the default `check` (§6). Index names and
`maintain` strategies were removed by LLP 3000.013 and are not credited
here.

**A default that flips, printed.** In Snapback 4 a table with no `sync` line
is online-only. In Snapback 5 a table is held on devices whenever some
declared query reads it and its read rule is invertible. An audit table
with a query over it is held unless the author writes `online only`. The
default `check` prints, per table, "held on devices" or "server only" and
why, so the flip is never silent. §10 names it as a risk.

### 3.3 The two additions

Both land in **Snapback 4 first**, each under its own review, so that the
control carries them and any movement in `data_modeling` cannot be credited
to residency by mistake (§9.2). Snapback 5 takes the engine that has them.

**`through .ref`** is LLP 3000.014 revision 2. That document does not exist
yet; LLP 3000.014's text is still the NOT READY revision 1, and its §5
still says an orphan stays readable. Until revision 2 lands, the lifetime
rule below is **provisional** and `through` is not in any first slice. What
this RFC fixes, for revision 2 to adopt or refuse:

- **Lifetime: captured audience, incarnation stamps, and liveness at read
  time.** The copy is the parent's substituted rule inputs under the schema
  interpretation at insert, stamped after client-supplied hidden fields are
  rejected and before the rule is evaluated. The parent's incarnation
  (intrinsic id plus a generation bumped on delete and expiry) is stamped
  with it. **A child is live exactly when its parent incarnation is live,
  checked at read time**, so a parent's logical expiry takes effect on its
  children instantly. The physical cascade (deleting the children) is
  background work under a stated meter, never inside the deleting
  transaction, so a Workroom project with ten thousand descendants does not
  hit the 1,024-row write limit. Write-only children (a report filed
  against a post) do not cascade. A reused id does not inherit old
  children because their stamped incarnation differs.
- **Admitted positions.** `through` appears only as a top-level conjunct of
  a rule. `not through` and `through` under `or` are refused, so the term
  is never an existence oracle.
- **Refusals do not reveal the parent.** Missing, expired and unreadable
  parents refuse identically, with the parent read budgeted in advance.
- **Write-only use persists nothing.** `through` in an insert rule alone is
  an authorized lookup with no stored copy.
- **Copied inputs never ride** query rows, `*` shapes, cursors or write
  results. They ride the sync image only when every recipient may read
  them.
- **Changes after the copy.** A change to a parent's read rule, its
  defaults, or which columns its rule reads is refused while the parent
  table has `through` descendants, or refilled inside one activation
  barrier, parents before children, rolling back if any parent incarnation
  is missing.
- **Aggregates** over `through` children derive a rule only when the stored
  inputs are a function of the group key inside one incarnation.
- **Audience admission and closure** as §4.2 and §4.3: the substituted rule
  must be invertible, and the device holds the membership row it consults.

**Field-level write authority and engine-derived delivery** replace
revision 2's `per viewer`, which three reviews showed was the wrong tool on
`members` (a matrix of which only the diagonal is used), had no form for
reading another principal's mark, and priced unread as a scan the meter
cuts. What Clique's receipts and unread badge need is smaller:

- **`written by .principal`** on a column: the value may be written only by
  the principal named in that column of the same row, whatever the row's
  `update` rule says, and by nobody else (an admin's update right does not
  cover another member's mark). The value is a **monotonic message
  ordinal**, clamped to the conversation's latest, not a wall-clock time,
  so a mark cannot run ahead of the messages that exist and does not
  disclose when the member opened the chat. #19 already had `readAt` and
  the committed target has `readOrdinal`; what was missing was the
  authority rule and a recipe.
- **`delivered` is an engine fact.** The engine already knows which rows it
  has delivered to which device: a device's acquired spans of a partition,
  with their start sequences and its acknowledged watermark, are the
  server's page index (§4.3). A message is delivered to a principal when
  any device of that principal has acquired the span containing it and
  acknowledged past its sequence. This is per message and exact for
  tail-fetched pages, because a span has a start. It is exposed as a
  maintained per-message aggregate, `delivered by recipients` and `read by
  recipients` (counts against the recipient set), readable under the
  message's own rule.
- **The recipient set** is the members other than the sender whose
  `joinedAt` is at or before the message's `at` and who are still members;
  a member who leaves drops out; a member who rejoins has a new row and a
  new `joinedAt`, so is not a recipient of older messages. Ties on
  `joinedAt` are broken by the message's `ordinal` against the member's
  join ordinal, both server-assigned.
- **The tick** is `delivered by recipients = recipients` and `read by
  recipients = recipients`, monotonic by construction.
- **Unread** is an engine-maintained count per membership: messages in the
  conversation with ordinal greater than the member's `readUpTo`, excluding
  the member's own sends and messages before `joinedAt`. It is listed in §8
  as an engine addition with a cost, because a read-time scan is cut by the
  8,192-row examined ceiling on the probe user's inbox.
- **What is disclosed:** the aggregate counts, to readers of the message.
  Individual marks are readable only by their owner unless the program
  declares the column readable by the row's audience, which is the product
  decision Clique's readable receipts table already made. The RFC states it
  as one.

If the engine-derived delivery aggregate is refused in review, the receipt
table stays in the application and this RFC drops the claim that receipts
leave the program. The `written by` rule stands on its own.

What leaves Clique's program under these two additions: the receipt table,
its insert loop in `send`, the `fetched` mutation, the receipt helper rules,
the hand-copied `chat` columns and their integrity probes. §7 counts what
they add.

## 4. The bridge, derived

### 4.1 Residency from queries

Every read an application can make is a declared `query` with typed
arguments, so the compiler knows the complete set of pages a device may ever
hold. Residency follows:

- **A page is held when the app has asked for it.** `useQuery(app.home)`
  subscribes the device to the spans its closure (§4.3) lies in. Rows are
  stored once, tagged with the pages that read them.
- **The warm set is derived:** the first page of every query whose only
  arguments are a cursor, fetched at sign-in as one catch-up, in
  declaration order, under a stated device budget (§4.1.1). `online only`
  queries are excluded. Aggregates (`insights`, `trending`) are admitted
  last and dropped first.
- **One step of depth is derived.** For each row of a warm page, the first
  page of every declared query whose only non-cursor argument is a
  **reference to a table** that row holds (`history(chat)` for each
  conversation on the inbox page; `thread(post)` for each post on `home`).
  Arguments typed `principal` do not qualify. The step is one level deep,
  capped per warm page at the page's own size, and maintained while
  connected. It does not ask for pages the server denies.
- **`check` prints the derived residency** so it is never silent: `offline:
  inbox last 50 by joinedAt → history last 50 each; home last 20 → thread
  first 20 each; warm: global, trending, insights`. A builder who needs the
  probe user's 100 conversations offline sees that the inbox page holds 50
  and changes the page size or the ordering. That is a product decision
  the program states, not a horizon.
- **Eviction** applies only to rows no maintained page, pending write or
  `keep history` policy protects, by time since the row was last read,
  under the budget. It is suspended while offline. `keep history` rows are
  pinned, so the store grows with retained history; that is the policy's
  meaning, as it is in Snapback 4.
- **Released pages** (the app no longer subscribes) keep their rows for
  reads, stay subscribed to their spans while any row is held (§4.2), and
  never report `complete: true` (§5).
- **A denied page with retained rows** (Carol's `history(c)` after removal
  under `keep history`) returns the retained rows with `complete: false`
  and `fresh: false`, as Snapback 4's left-group answer does.

#### 4.1.1 The budget

The device budget is a generated fact: 50,000 rows or 64 MiB, whichever is
first, split as warm set (at most half), depth step (at most half), and
on-demand pages (the remainder, evictable). Priority within each part is
declaration order; a warm page that does not fit is not held and `check`
says so. The numbers are the initial registration for §9's cold-start
measurement against #19's successful full-replica acquisition (12.6 s for
the probe user), not a product constant.

### 4.2 One channel: the partition log, with spans as the unit of subscription

The partition log of LLP 2000.000 §7.1–7.2 stays exactly as it is: every
committed row image goes to zero or one audience partition, decided by the
inverted read rule; membership inserts bootstrap a group; membership deletes
emit one scope tombstone; deletes, expiry and view-once consumption are
tombstones; an update is a new image, re-read at serve time and served as a
delete if the row is gone; logical expiry is applied at catch-up before the
sweep records it; the log is never compacted; a device catches up from one
watermark. Delivered rows remain authoritative on the device, under a trust
rule restated without `sync`: a delivered image is trusted while the leave
policy keeps it and no audience expiry the log has not recorded applies.

What changes is only **which spans a device subscribes to**:

- A **span** is a contiguous range of one partition's log. In Snapback 4 a
  device acquires a group's span from the authored horizon. In Snapback 5 a
  device acquires the spans its pages read (§4.1), each with a **start
  sequence**, inside the stream, at a sequence position, with images read
  at serve time, exactly as group joins are acquired today.
- A device **stays subscribed to a span while it holds any row of it**, so
  every later update and tombstone for a held row arrives in the one
  stream, whether the page that brought the row is maintained, released,
  or gone. Delete-for-everyone in #19 is an update (`tombstone: true`);
  it reaches a released search page's row because the span is still
  subscribed.
- A **refill** (a row older than a span's start, needed when a page shrinks)
  is served as a new `put` of the current image inside the stream, before
  the entry that tags it, never outside the stream and never for a dead id.
  Entries never carry images of their own.
- **Revocation after membership loss under `keep history`:** the device
  keeps the rows and stays subscribed to **tombstones only** (deletes,
  expiry, view-once) for the spans it retains, so Alice's later
  delete-for-everyone reaches Bob's retained copy. This is a change to the
  stream's membership-interval rule and is listed in §8. Under the default
  policy the scope tombstone purges the group, as today.
- **Public data reaches every device**, as in #19, because the warm set
  holds the public pages. Snapback 5 does not claim to deliver less than
  Snapback 4; it claims to author less.
- **Audience admission is unchanged.** A table can be held on a device only
  when its read rule is one of the three invertible forms, including the
  substituted rule of a `through` table. `check` prints, per table, "held
  on devices" or "server only".
- **Simulator invariant 2** applies unchanged, because the channel is
  unchanged.

### 4.3 Pages are computed on the device; the server keeps only an index

A page is **everything it read**: the point reads and index ranges the plan
touched, the rows its shapes, helper functions and rule checks consulted,
and the next instant at which a time-based filter changes.

- **The device computes its pages.** Given the rows it holds and the spans
  it is subscribed to, the device evaluates each maintained page's plan
  locally, exactly as Snapback 4's device evaluates a query over its
  partition. Entries, exits and reorders are consequences of rows arriving,
  changing and dying in the stream. An exit drops a page tag and nothing
  else; a row leaves the store only by tombstone or eviction.
- **The server's page state is an index for refills and for delivery**
  facts: per device, the spans acquired with their start sequences and the
  acknowledged watermark. That index is what §3.3's `delivered` reads. It
  is not a second delivery channel, and it does not match writes against
  pages; the stream delivers by partition as today, and the only new
  server work per commit is none. A **time-boundary index** (the next
  instant a held page's time filter changes) lets the server tell the
  device to re-evaluate at that instant.
- **Key** (for the device's page table and for the refill index):
  (schema generation, canonical plan hash, viewer and auth context,
  arguments, cursor). A page's **rows** may be shared across viewers when
  its rule is public; its **shape values** may be shared only when no part
  of the plan (filter, shape, helper `fn`, rule check) reads `viewer` or the
  auth context. `global`'s rows are shared; its `liked` values are per
  viewer.
- **The closure a device holds is limited to rows the viewer may read.** A
  rule probe or shape field into a table the viewer may not read (a
  `blocks` table only the blocker reads) is carried as a **result** (a
  boolean or a count) with its own disclosure status, or the page is not
  device-evaluable and reads `complete: false` offline, which is Snapback
  4's unknown-probe rule today. The device never holds a raw row its viewer
  may not read (invariant 2).
- **Schema adoption.** A page survives a schema change only if its plan
  hash is unchanged and no rule, default or helper anything in its closure
  depends on changed. Every other page drops to `complete: false` and is
  re-evaluated after the device adopts the generation, which withdraws or
  reauthorizes retained images as Snapback 4's adoption does. A request
  from an old generation is refused with `E_GENERATION`. Fills for
  `through` happen inside the activation barrier. A populated view is
  rebuilt behind the barrier and published with the generation, not in the
  background under readers.

### 4.4 Following

Following stays the server-materialized, per-reader inbox of LLP 3000.013
§4, with three restatements:

- **Admission without `sync`:** a feed may be materialized when its sources
  are readable by everyone, their write rules are owner-only, and their
  mapped columns cannot change. `check` prints the admission verdict.
- **The device holds the witnesses it needs.** A `home` page's closure
  includes the viewer's follow edges for the authors shown, with their edge
  epochs, and the removal tombstones the inbox filter reads. The Following
  guide's list of required witnesses is the closure; ordinary edges alone
  are not enough.
- **`complete` is false while a backfill or cleanup for that reader is
  pending**, and the celebrity write must not hold the engine lock through
  delivery chunks: Lane L's fair lock and time-sliced background work are a
  prerequisite.

### 4.5 Prediction by proof against versioned coverage

**Versioned coverage:** a page's coverage is valid as of the watermark the
device has applied, online or offline. Proofs are discharged against that
watermark; offline, the last applied watermark is the version.

A mutation is applied locally, before the server answers, when every read
its rule and its body perform is proven:

1. A **point read** is proven by a row on a maintained page, current as of
   the version. A retained, expired or released row is not a witness; a
   `through` parent must be live and covered.
2. A **range read, absence check or branch-deciding constraint** (`if
   absent`, `upsert`, `require not exists`, a `for` over a range, a
   `count`) is proven only by a complete, uncut maintained page whose
   filter covers the range **and whose key pins readability** (the key
   alone determines who may read the rows) or whose table is public. This
   is Snapback 4's audience condition; without it a range holding hidden
   rows would count as proven empty.
3. **Exemptions, as Snapback 4 has them:** a freshly minted id needs no
   primary-key proof; a range keyed by a row created earlier in the same
   body is empty apart from what the body inserts; a row created earlier in
   the body is visible to later reads in it.
4. **Plain-insert constraints stay optimistic:** `unique` and `at most N
   by` on a plain insert are checked against held rows and the server may
   refuse, as today. Proof is required only where a wrong guess changes
   which branch the mutation takes.
5. A condition that depends on `now` is never proven on the device.
6. A write to an input of a `view` the device cannot recompute is not
   predicted (the rule revision 2 dropped; it is why `follow` and
   `unfollow` queue when the inbox is materialized).

There is no occupancy witness; revision 2's reference to one described an
unlanded lane. Otherwise the write queues with no local image and settles
on the server. `predicts: eligible | never` is a generated fact per
operation; `why send` names the read that failed and the page that would
satisfy it. A refusal removes the local image.

**Pre-registered rate**, applying these rules to #19's program, to be
checked against the measured queueing-without-image rate in §9.3:

| Operation | Cold (warm set only) | Warm (conversation or post page held) | Released | Offline (last version) |
| --- | --- | --- | --- | --- |
| `send` | queues (members range and `connected` not held) | queues unless the members page and presence are in the closure; **expected: queues** | queues | queues |
| `react` | queues | predicts if the message has no `expiresAt`; queues in disappearing chats (rule 5) | queues | as warm, at the last version |
| `markRead` (the `readUpTo` write) | predicts (own row, point read) | predicts | predicts | predicts |
| `setLike` | queues | predicts from a post page whose closure holds the viewer's like row or its covered absence | queues | as warm |
| `setFollow` | queues | predicts from a profile page whose closure holds the edge (rule 1); the inbox copy is engine work (rule 6 does not block the edge write) | queues | as warm |
| `addMember` | queues | predicts from a roster page (no row limit; key pins readability) | queues | as warm |
| `createDm` | queues | queues (needs all of the viewer's pairs) | queues | queues |
| `edit`, `deleteMessage` | queues (rule 5) | queues | queues | queues |
| `createPost` | predicts (minted id; rule 3) | predicts | predicts | predicts |

The expectation that matters for M6.2 is that `send` **queues** under these
rules, and shows as pending in the outbox and on no row. Snapback 4 predicts
`send` today only through the presence exception #19's `why chat.send`
found. If a first slice wants `send` predicted, it needs the members page
and presence in the closure, and the rate table is corrected then, before
the run.

## 5. The client contract

```ts
const app = createApp({ url, schema });            // the device is chosen by platform
const r = useQuery(app.home);                      // Read<T>: data, complete, cut, fresh, since, next | loading | denied
const w = await app.createPost({ postId: mintId(), body });   // pending | sent | failed { reason }
const outbox = useOutbox(app);                     // writes with no row yet, by operation and arguments
const auth = useAuth(app);                         // signed-out | restoring | signed-in
```

**`complete` means what it means in Snapback 4**, word for word: false when
the meter or a word limit cut the read, the rule's verdict is not uniform,
the page overflowed or lost its position, a timeline is pending, the read
went past what the device holds, or presence is unknown. Snapback 5 adds
one reason: the page's closure is not held or not current as of the
version. Nothing else. A pending write does not make a page incomplete; it
shows as `pending` on its rows and in `Write`. Staleness is `fresh` and
`since`. A retained row does not spoil the coverage of a query that reads
it, as Snapback 4 deliberately arranges. Revision 2's two extra conditions
("no pending write in the closure", "local equals server") are withdrawn:
they made every optimistic write turn its page incomplete and had no
protocol, and they would have changed the treatment arm's client in a way
the control did not share.

The rest is kept because each fact carries a distinction the brief tests:
`cut` (withheld where disclosing it would leak), `next`, `loading`,
`denied`; `pending`, `sent`, `failed` with a typed reason; the outbox for
writes with no row (M6.2 and M8.8); `runs` and `predicts` as generated
facts; `restoring` in the auth state.

The outbox view and the default `check` output are part of the treatment
(§9.2) and are named as such.

## 6. `check`, and what is scale evidence

The default `check` prints errors, the completeness class of every query
(`home: complete by cursor`; `searchAll: never complete — the rule reads a
column the scan does not pin`), the disclosure notes, each table's device
admission ("held on devices" or "server only", and why), the derived
residency of §4.1, and one pointer line to `--scale` for any operation whose
cost grows with data. `check --scale` prints Lane H's certificates, cost
spans, edge windows and the cost notes. The README's scale card names
`check --scale` in its first line. The brief does not change.

## 7. The concept budget

Two tested numbers, with a **counting rule frozen at commission**:

- **The concept count:** one point per entry in §3.1's bulleted lists (each
  form, modifier, term and builtin named there is one entry; grouping is
  fixed by that list), plus one per runtime state the generated client
  exposes (each `Read` and `Write` variant, each auth state, `E_GENERATION`
  and each refusal code a generated client can receive, enumerated in the
  generated `api.ts`). Diagnostic codes an author *can draw* are not
  counted. Runtime states count so that moving a concept from compile time
  to run time cannot lower the number without lowering what the builder
  learns.
- **The first account:** the README's orientation length before the first
  reference card, already budgeted at 300 lines under W14b.

The count is reported for Snapback 4's surface and for §3.1 before any
implementation, and reported at the first calibration. It becomes a
ratchet only after that calibration shows the number tracks builder
effort. `through` and `written by` enter the count.

## 8. Relationship to Snapback 4

- **Engine reuse, with named hooks, each a cargo feature.** `snapback5/`
  depends on `snapback4-core`, `snapback4-device` and the planner as
  crates. The control's published server and device builds are
  byte-identical with every feature off, which is tested. The hooks:
  - **span-start acquisition and in-stream refill** in `partition::stream`
    (feature `spans`; Snapback 4 code path unchanged when off);
  - **tombstone-only subscription after membership loss under `keep
    history`** (feature `spans`; a change to the membership-interval rule);
  - **the per-device span index** with start sequences and acknowledged
    watermarks (feature `spans`; server-side; the source of `delivered`);
  - **device page tags** in `snapback4-device` (feature `pages`; Snapback
    5 only; the device must fit the inherited 410,000-byte wasm budget
    with it, measured);
  - **`through` stamping, liveness-at-read and background cascade** (lands
    in Snapback 4 as LLP 3000.014 revision 2, reviewed there);
  - **`written by` field authority; the `delivered by recipients` and
    `read by recipients` maintained aggregates; the maintained unread count
    per membership** (land in Snapback 4 as the second addition, reviewed
    there, with their write amplification measured: one aggregate update
    per recipient device acknowledgement and per mark write);
  - **Lane L's fair engine lock and time-sliced background work, and the
    populated-view rebuild behind the activation barrier** (Snapback 4,
    already in flight).
  There is no change feed and no matcher; revision 2's were artifacts of
  the second channel this revision removes.
- **Sibling, not successor.** Snapback 4 continues as the control, carrying
  the two additions. Snapback 5 is a number that never ships if the bet
  fails (LLP 3000 §1, decision 2, applied again). For the comparison,
  Snapback 5 publishes pre-release packages under its own name
  (`snapback5@0.0.x-rc`), because protocol rule 6 makes lanes run from a
  source checkout diagnostic-only.
- **Fence and numbering.** `snapback5/` behind its own `AGENTS.md`; LLPs 4000
  and up; the wasm budget inherited at Snapback 4's current value.
- **The simulator's invariants** (LLP 3000 §6) apply unchanged. The page
  invariant is added: a page reports `complete: true` only under §5's
  conditions, and a released page never does.

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
  or below the control's, run for run.
- **(B) The language.** Otherwise: the charge persists at the control's
  level or names pages, `complete`, `through`, or Quarry.

A model from a third family (neither the builder's nor the grader's)
classifies **both arms'** notes blind to which arm wrote them, with a rubric
committed by hash before any lane runs, following LLP 3000.012 §2.2's
procedure (by reading). Intended consequences named in §10 (more writes
pending, one-step offline depth) are not automatic failures: the rubric
counts them as learning-cost items only when the note calls them something
to learn. The author does not classify. If the clock moves and (B) holds,
that is a failed prediction, not an untested one.

### 9.2 The comparison is Snapback 5 against its control

The incumbents are already about half Snapback 4's speed to first green on
this brief (§1), so a clock against them cannot separate the bet from the
control. The bet is judged against **Snapback 4 carrying the same two
additions**. The treatment is: derived residency (§4.1–4.3), the outbox
view, and the default `check` output (§6). Nothing else differs; `complete`
is unchanged (§5). Both arms run:

- interleaved and **serial** on one host (protocol rule 5), alternating
  arms, with the load gate of §9.5 recorded per run;
- N = 3 per arm with the Astra-medium builder and the claude-opus-5 grader
  of the calibration series, under the variance-transfer rule of §9.4; one
  additional pair with the Opus 5.5 high builder, reported and not
  decisive;
- from published pre-release packages, on the frozen instrument of
  calibration #19.

The incumbents remain the **product reference** across all milestones,
from the 2026-09-24 reference lanes (§1).

### 9.3 Instruments

| Instrument | Statistic | Threshold, relative to the control in the same comparison | Verdict it produces |
| --- | --- | --- | --- |
| **Primary clock** | Protocol clock to the last passing acceptance evidence, including the scale replay and the delivery load, median over the three runs | Treatment median ≤ control median − 25 min, and every treatment run below the control's slowest | clock: **win** / **not distinguished** / **loss** (treatment median ≥ control median) |
| Secondary clock | Protocol per-milestone `firstGreenAt`, whole list, median | Reported | none |
| **Correctness gate** | The 119-assertion list of the reference packet (101 + 18 M8), native artifacts required for every lane; pass rate over all 119, not-run counted as not passed; blockers by the grader's severities; the committed holdout probe set | **Non-compensating:** zero blockers in every run; every holdout probe passes in every run; treatment pass rate ≥ control pass rate − 2 assertions, median | correctness: **pass** / **fail** |
| **Delivery load** | During the replay's last segment: every user connected holding the warm set and depth step; the probe user with 100 conversations open; 50 members watching the busy group; 900 followers on `home`. Measured in one unit for both arms: server CPU-ms per commit, bytes delivered per device per minute, delivery p95, reconnect catch-up, cold-start of the warm set, store size per device, and queueing-without-image per operation | Treatment ≤ 1.5× control on CPU per commit and delivery p95; ≤ 2× on bytes per device; cold start ≤ 1.5 × 12.6 s; queueing rate within ±10 points of §4.5's table per operation | delivery: **pass** / **fail** |
| **Score floors** | Each category's mean over the three runs | ≥ control's mean − 3 (one scorer sd) in every category; holistic ≥ 89. Historical sanity floors, fixed now from 0.2.31–0.4.0 medians: queries 89, offline 95, client integration 90, writes 95, setup 93 | floors: **pass** / **fail** |
| **Mechanism** | §9.1's classification of both arms | Reading (A) or (B) | interpretation, not a gate |
| `data_modeling` | Reported, both arms | 94 is the hope, not the bar | none |

**Combination rule.** The bet **passes** only if the clock is a win and
correctness, delivery and floors all pass. It **fails** if the clock is a
loss, or correctness, delivery or floors fail in a way the treatment
caused (the control passing and the treatment not). Any other outcome is
**not distinguished**, and the next step is N = 8 or a stop; not
distinguished never ships. The mechanism reading is recorded either way.

The author's ruling (2026-09-24): a score near 89–90 is acceptable if the
clock beats the incumbents and the results are very correct. Under §9.2
the clock that decides is against the control; the incumbents' clock is the
product reference the ruling asked for, and the floors keep the score from
being bought with a worse product.

### 9.4 The variance-transfer rule, written out

Protocol: an ordering claim needs N ≥ 8 unless a pre-registered
variance-transfer rule states the decision. This is that rule:

- **Variance source:** the last five Snapback 4 Astra-medium whole-brief
  clocks (77, 79, 82, 90, 115 min; sd ≈ 15 min), taken as the per-run
  standard deviation of both arms. This is a transfer from cross-version
  runs to repeated runs of one configuration and is registered as such.
- **Statistic:** the difference of medians over N = 3 per arm.
- **Threshold:** 25 min, about 1.7 sd of a single run, the smallest
  difference three runs per arm can distinguish. A smaller difference is
  **not distinguished**.
- **Stopping rule:** three runs per arm, then the verdict; no run is added
  or dropped after seeing results. A run that fails the load gate is
  discarded before its result is read and rerun.

### 9.5 Choices fixed now

Every item the round-2 reviews named as movable, fixed:

| Choice | Fixed value |
| --- | --- |
| Which clock decides | The primary clock of §9.3 (last passing evidence, delivery load included) |
| Assertion list | The reference packet's 119 (101 + 18 M8) |
| Native artifacts | Required for every lane |
| Not-run | Counted as not passed |
| Correctness threshold | Zero blockers; every holdout probe; pass rate within 2 assertions of the control |
| Holdout probes | Written by a session that has not seen any Snapback 5 code, committed by hash before the first slice begins. Must include: delete-for-everyone reaching a released search page; a denied page with retained rows under `keep history`; completeness over a range full of hidden rows (`complete` stays false and `cut` stays withheld); a removed member's history under both leave policies; server-side denials surviving the offline cache |
| Grader | claude-opus-5, calibrated on the committed probe set before the runs (`calibrationPassed` must be true) |
| Load gate | A run is discarded and rerun if the median 1-minute load average over the run exceeds 18 (the core count) or any single sample exceeds 36 |
| Floors | Relative to the control (mean − 3), computed after both arms' runs; historical floors listed above as a sanity check only |
| Delivery ratios and unit | As §9.3, CPU-ms per commit and bytes per device, both arms instrumented identically |
| Cold-start baseline | 12.6 s (the successful acquisition), threshold 1.5× |
| Queueing rate | §4.5's table, ±10 points per operation |
| Reading (A) | §9.1, both arms, third-family classifier, rubric by hash |
| Second builder family | One Opus 5.5 high pair, reported, not decisive |
| Publication path | `snapback5@0.0.x-rc` pre-releases |
| §11 question 5 | Answered below: the first slice is measured on the delivery load and the simulator before any calibration, and the §9.2 comparison is run only if the author commissions it after that measurement |

### 9.6 Order of work

1. Blind design reviews of this revision from the same three families.
2. The concept count of the committed 0.4.0 target under §7's rule, and of
   §3.1, recorded here.
3. The two additions in Snapback 4, each reviewed (`written by` and
   engine-derived delivery first; LLP 3000.014 revision 2 for `through`),
   and Lane L landed.
4. The reference lanes' record.
5. The holdout probe set, committed by hash.
6. The first slice: the messaging half on derived residency (warm set,
   depth step, spans, device-computed pages, proof-based prediction), with
   the simulator's invariants, the page invariant, and the delivery load
   measured against the control. **Stop here for the author's decision.**
7. The §9.2 comparison, if commissioned.

## 10. Risks, and what falsifies the bet

- **The saving is authoring, not delivery.** Under one channel, Snapback 5
  delivers what Snapback 4 delivers to a device that holds the same public
  pages. What it removes is the spelling and the authored horizon. If that
  is not where the charge lives (reading B), the bet is over and the
  record says so.
- **Derived depth is a product limit.** One step beyond the warm set is
  less than an authored 10,000-message horizon, and page size and order
  decide offline coverage. `check` prints it; a product that needs more
  offline depth changes its pages. Falsified by `offline_sync` below the
  floor.
- **Fewer predictions than a full partition.** `follow`, `createDm` and
  `send` queue under §4.5 where Snapback 4 predicted some of them through
  held partitions. The outbox and the `predicts` fact carry this; the rate
  is gated.
- **The flipped default (§3.2).** A table with an invertible rule and a
  query over it is held on devices unless the author writes `online only`.
  `check` prints it per table; the holdout set includes an audit-shaped
  table.
- **Stream changes in the control's crate.** The span features change
  `partition::stream`. The byte-identity test on the control's builds is
  what keeps the control a control.
- **The grader and the sample.** Standard deviation near three; N = 3 with
  a written transfer rule and a 25-minute threshold; not distinguished
  never ships.
- **Self-attribution.** A third family classifies both arms; the author
  reads the reviews before the lead's summary of them; every wave in this
  corpus has reported itself a success and the series fit is the defense.

## 11. Questions for the author

Revision 1 asked five; two were answered on 2026-09-24 (commission a
sibling under a fence: yes; run the incumbents' reference lanes: yes,
running). The round-1 reviews did **not** answer the other three
identically, as revision 2 wrongly said: Astra accepted "what was shown
plus first screens" for the experiment, Grok and Opus required a derived
depth policy; Astra and Grok put `per viewer` first, Opus put neither
addition in Snapback 5. The answers below are this revision's choices
among those recommendations, pending the author's ruling:

2. **The additions:** neither in Snapback 5's first slice. Both land in
   Snapback 4 first, `written by` with engine-derived delivery before
   `through` (LLP 3000.014 revision 2), so the control carries them.
3. **Offline depth:** one engine-derived step beyond the warm set (§4.1),
   printed by `check`, with the budget of §4.1.1 and its cold-start cost
   pre-registered.
4. **The concept budget:** a reported number under §7's frozen rule until
   the first calibration, then a ratchet.
5. **The budget for the comparison:** the first slice stops at step 6 of
   §9.6, measured on the delivery load and the simulator against the
   control, before any calibration. The six-run comparison of §9.2 is a
   separate commission after that measurement.

## 12. Review record

### Round 1 (revision 1, `3106ff03d9`)

Three blind design reviews, all **NOT READY**: Astra max (15 findings, 4
blockers), Grok 4.7 xhigh (5 sections, 4 blockers), Opus 5.5 max (24
findings, 3 blockers). Dispositions were recorded in revision 2 and are
re-assessed by round 2 below.

### Round 2 (revision 2, `dbb10169b6`)

Three blind delta reviews, all **NOT READY**, each with a row-by-row
assessment of revision 2's dispositions (real / partial / asserted). They
agreed that the log as authority, the viewer-keyed page, the completeness
class, the typed results, the note split, audience-first matching, and
judging against the control were now sound, and converged on the residue:

| Round-2 finding | Disposition in revision 3 |
| --- | --- |
| A page entry is not an image; a matcher off the commit path can resurrect a tombstoned row; "images from the log" and "entries from pages" are two channels; the twenty-first message after a delete predates the watermark (all three; Opus B1 "reading 2") | §4.2–4.3: the unit of subscription is a partition span with a start sequence, acquired in the stream as joins are; a device stays subscribed while it holds any row of a span; refills are in-stream `put`s of the current image before the entry; the device computes entries, exits and reorders; the server keeps only a refill and delivery index; there is no matcher and no change feed |
| Delete-for-everyone is an update, and released pages are not maintained, so revoked content survives on them (Opus B1; Grok) | §4.2: spans stay subscribed while any row is held, so updates and tombstones reach released rows |
| Later deletions do not reach a former member retaining history (Astra 2) | §4.2: tombstone-only subscription for retained spans after membership loss; listed in §8 |
| Sharing by "public rule" leaks viewer-dependent shape values (Opus H1) | §4.3: rows shareable when the rule is public; shape values only when no part of the plan reads `viewer` |
| "Everything it read" would put unreadable rows on the device (Astra 3, Opus H2) | §4.3: the closure held is limited to readable rows; probes into other tables are carried as results with disclosure status or make the page not device-evaluable |
| `complete` redefined: every optimistic write makes pages incomplete; "local equals server" has no protocol; retained rows spoil coverage; the control does not share the change (Opus H3) | §5: Snapback 4's definition restored word for word, plus one reason; the two conditions withdrawn |
| The proof rules lack the audience condition, the minted-id exemption, ranges under created rows, body range reads, the view-input rule, offline coverage; the occupancy witness is unlanded; the rate contradicts the rules (all three) | §4.5 rewritten with all of these, versioned coverage defined, no occupancy witness, and the rate as a pre-registered per-operation table |
| `per viewer` on `members` is a matrix; no form reads another principal's mark; unread as a scan is cut by the meter; the sender's default mark blocks the tick; a high-water mark cannot represent a tail fetch; nothing writes `deliveredUpTo` (all three) | §3.3: `per viewer` withdrawn; `written by .principal` field authority with a monotonic ordinal; `delivered` derived by the engine from the per-device span index; recipient set defined with `joinedAt` and ordinals; unread as a maintained count listed in §8; the fallback (keep the receipt table) stated |
| The depth step has no number, no priority, covers `principal` arguments (hundreds of pages), and conflicts with eviction and `keep history`; the probe user's 100 conversations exceed a 50-row inbox page; eviction "by age" undefined; denied pages with retained rows undefined (all three) | §4.1 and §4.1.1: table-reference arguments only, one level, capped per warm page, declaration-order priority, a numeric budget, eviction defined and suspended offline, `keep history` rows pinned, denied-with-retained answered as Snapback 4 does, and `check` prints the derived residency |
| The cascade has no mechanics: write limit, the window between logical expiry and the sweep, write-only children, interpretation changes; `not through` / `or` still legal; LLP 3000.014 revision 2 does not exist (all three) | §3.3: liveness checked at read time, background cascade under a meter, write-only children exempt, interpretation changes refused or refilled in activation, admitted positions restricted, aggregate rule stated, the lifetime rule marked provisional until revision 2 exists |
| The change feed carries the wrong data, is on the commit path, and "dormant" has no test; page tags live in shared crates; wasm budget (all three) | §8: no feed; hooks as cargo features with byte-identical control builds tested; the device page tags behind a feature with the wasm budget measured |
| §9 has instruments but no decision rule: which clock, what delta, the transfer rule, the correctness threshold, combination, aggregation, the load gate, the confound (Opus H6, Grok, Astra 11) | §9.3–9.5: one primary clock, a 25-minute threshold from a written transfer rule, non-compensating correctness gates, a combination rule with a "not distinguished" outcome, floors relative to the control, a load gate, and the treatment named |
| Reading (A) is absolute and judged on one arm; the control already draws the charge; intended consequences would confirm (B) (Opus H7, Grok) | §9.1: both arms classified by a third family; expected-to-disappear and expected-to-stay items pre-registered; (A) stated as a margin; intended consequences not automatic failures |
| Delivery falsifiers not measurable: no common unit, no ratio; matching for public writes loops over devices (Opus M5) | §9.3: one unit for both arms, ratios fixed; no matcher exists under §4.3 |
| Floors from older runs, not the control (Opus M6) | §9.3: relative to the control; historical floors as a sanity check |
| "Every milestone green" for Supabase is false (M7 not run) (Grok); §3.1 omits `merge`, `use identity`, `enum`, `default`, `unique … else`, control flow, builtins; `members` cannot admit its first member; "viewer-only" arguments; §1.1 row 1 and the §4.6 reference (Grok, Opus L1) | §1, §3.1, §1.1 corrected |
| The default flips: tables are held unless `online only` is written (Opus L1) | §3.2 states it, `check` prints it, §10 names it |
| §11 misstates the round-1 consensus (Astra) | §11 corrected |
| Reference packet README still says the incumbents cannot do offline (Opus) | Corrected in the packet |

Revision 3 goes back to the same three families before any status change.
Two rounds of NOT READY is the bounded stop of the refine loop; after round
3 the document goes to the author with the verdicts whatever they are.

## Non-claims

This RFC does not claim the surface of §3 is sufficient for every
application; it claims it is sufficient for the calibration brief and the
Workroom shape (LLP 3000.009 §10.1) and that anything further must enter
the count. It does not claim that Snapback 5 delivers less than Snapback 4;
§4.2 says it delivers the same stream to a device that holds the same
public pages, and what it removes is authored. It does not propose changing
the grader, the brief or the protocol; it registers one variance-transfer
rule under the protocol's own exception. It does not claim a score: 94 in
`data_modeling` is the hope named in §9.3, and the bar is the clock against
the control, then correctness, then the floors.
