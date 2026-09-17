# The builder is not paying for bounds. They are paying for dead ends and warnings.

**2026-09-17, Claude session. The finding as written that day (read-only on the repo,
nothing built); committed beside its probes as the source for LLP 3000.007 §20.22. Paths
of the form `bounds-probes/<probe>` mean the sibling directories of this file; `W13-*`
names are the program's working files, whose content landed as §20.22 and LLP 3000.007.000.**
Every behavioural claim below marked *measured* was run against the **published
`snapback4-darwin-arm64@0.2.27` binary** (`npm pack`, `dev --memory`, `POST /seed`,
`POST /q/<op>` with `meter: true`). The schemas and scripts are in
[this directory](./README.md); each subdirectory is a runnable project
(`SB=<binary> node measure.mjs`). Counters are the engine's deterministic meter,
not latency claims; the few latencies quoted are loopback HTTP p50s on the shared,
loaded development host and are labelled as such. Claims marked *code-traced* were
read from source at `18c8f5daf` and not executed. Nothing here raises a ceiling.

This answers the question put after the 0.2.27 calibration: *the scorer's recurring
deductions are one family — "the builder must reason about bounds before they can
write a query" — so what engine work removes it?* The proposal on the table was
(1) have the engine plan the batched walk, (2) make completeness something the
engine computes, (3) stop adding surface for a wave.

## The claim

The three items are the right family and the wrong mechanism. Probing the engine
instead of the corpus shows:

1. **The query a builder writes first already works at the envelope far more often
   than `check` admits.** Where it does not, the cause is an engine shortcut
   (matching lanes are read eagerly; one false `complete: false`), not an inherent
   bound — and no planner is needed to remove it.
2. **The engine warns speculatively at `check` and is silent at runtime.**
   `N_WIDE_MERGE` fires on any merge past 50 static lanes whether or not it would
   ever be cut; when a read actually *is* meter-cut under `dev`, the server prints
   nothing. That is LLP 2000.000 §6 inverted ("a builder learns … by reading a
   number, not by being refused on a bound that assumed the widest row").
3. **Each wave answered a bound by paving a detour** — the two-cursor walk, the
   `held` modifier, `init --recipe search` and its helper, the hybrid feeds recipe
   (that last one with more justification than this finding first allowed: §3's
   second correction) —
   and the detour's text is exactly what the scorer reads back as "explicit
   completeness obligations" and "substantial serving structures". This is the
   §20.20 Trending lesson again: six reviews reasoned about a gap that three
   minutes of `snapback4 check` would have closed.

So the engine work is not "plan the walk". It is: **make every admitted read
total** — it completes, or it carries a continuation the SDK follows by itself —
**stop asking the author for numbers the schema already states, and move bound
reasoning from speculative `check` notes to measured `dev`/`test` facts.** Then
delete the detours.

## Evidence

### 1. "Search every chat I'm in" as one query with one cursor (measured)

```quarry
query everywhere(q: text <=100, c: cursor ?):
  return merge messages matching q after c last 20 by byRoomWords:
    [m.roomId] for m in members[viewer] first 1000 by byPrincipalRoom
```

30 messages per chat; "dense" = every chat holds 24 hits (the card's fixture);
"sparse5" = 5 chats hold hits; 200 foreign chats with newer hits the viewer cannot
read. `q = 'cof'`, first page.

| Hits | Chats | `everywhere` (one cursor) | plain merge, same lanes | card's two-cursor walk, to exhaustion |
|---|---:|---|---|---|
| sparse5 | 100 | 215 examined, **complete, next** | 340 | 9 requests / 702 examined |
| sparse5 | 500 | 615, **complete, next** | 1,540 | 25 / 1,408 |
| sparse5 | 1,000 | **1,115, complete, next**, 10 ms | 3,040 | 45 / 2,428 |
| dense | 100 | 2,400, complete, next | 340 | 122 / 79,181 |
| dense | 500 | 8,358, **cut, no next** | 1,540 complete | 610 / 396,149 |
| dense | 1,000 | 8,880, **cut, no next** | **3,040 complete, next** | 1,220 / 792,359 |

- With realistic hit sparsity the naive query is complete at 1,000 chats at 14% of
  the examined ceiling. `check` still greets it with `N_WIDE_MERGE` ("up to 21000
  rows per read") and a rewrite to the two-cursor walk.
- The dense case dies **only because matching lanes are eager**. `rules::lazy_merge`
  (`engine/rules.rs:82`) refuses any lane whose prefix holds a `WordPrefix`, so the
  outer merge takes the eager path and reads `take + 1` rows from every chat
  (24 examined per chat). The same lanes as a *plain* merge take the lazy path —
  one head per lane, advance the winners — and cost 3,040 at 1,000 lanes. The lazy
  path already threads the `word` argument (`merge_lazy(.., word)`); flattening
  scope × word lanes into that one heap is an execution strategy the engine already
  chooses for plain lanes, not a planner. Estimate for dense 1,000 chats: the
  3,040 measured for plain lanes plus the 2 index entries per lane measured for
  word discovery — **about 37% of the examined ceiling and 12% of the index-entry
  ceiling, complete, one cursor, globally newest-first** (which the two-cursor walk
  cannot give: it orders within a batch only).
- **The Clique scale fixture contains this dense case.** All 99,090 `send` actions
  contain "coffee". The hub principal `u0001` is a member of all 1,000
  conversations (900 DMs, the busy group, 99 probe groups), every one created
  *before the 10% checkpoint*; what grows to 100% is messages per chat (11 → 99 in
  a DM). For `u0001` the eager merge is cut at every checkpoint (901 lanes with
  hits × up to 21 rows); a lazy merge costs lanes × heads, independent of messages
  per chat, so its 10% → 100% ratio is ≈ 1.0×. The designated probe user `u0500`
  (500 follows, 100 conversations, 99 of them empty probe groups) is the sparse
  case: the 0.2.26 builder's unbatched `first 1000` merge asserted `complete` for it
  at 10 / 50 / 100% and passed, p95 8–11 ms (`L26/scripts/scale-verify.mjs:26,30`) —
  and was still charged for `N_WIDE_MERGE` in two categories. The unscoped server
  index is hopeless by construction (6,022 examined, never complete: other
  tenants' matches eat the meter).
- Client side: one cursor means `usePage(api.everywhere, { q })` — `items`,
  `hasMore`, `loadMore`. Two cursors cannot use `usePage` at all, which is why the
  recipe had to install its own async generator.

### 2. "Grouped by chat" — the brief's literal requirement — is one query today, mislabelled (measured; a defect)

```quarry
query grouped(q: text <=100, c: cursor ?):
  return members[viewer] after c first 20 by byPrincipalRoom
    where count(messages[.roomId] matching q last 1 by byRoomWords) > 0
    { roomId, hits: messages[.roomId] matching q last 3 by byRoomWords }
```

Compiles with no note. At 1,000 chats: sparse5 → **1 request**, 1,040 examined,
7 ms; 50 hit-chats → 3 requests; dense → 51 requests of 180 examined (9,000 total
to show every chat with its newest three hits; the walk's 792,359 enumerates all
24,000 hits — different outputs, and the grouped one is what the screen draws). It is a filtered page, so a meter cut *does* carry
`next` (§5.6: after the last rule-visible examined row).

But every answer says `complete: false`, `cut: null`, even a fully walked one with
no `next`. Isolated in `bounds-probes/grouped-defect`:

| Query | Result |
|---|---|
| v1 `… where count(messages[.roomId] matching q last 1 …) > 0` | 4 rows, **complete: false**, cut null, next null |
| v2 same with a plain inner `last 1 by byRoomTime` | 10 rows, **complete: false** |
| v3 no filter, nested matching `last 3` in the shape | complete: true |
| v4 no filter, nested plain `last 3` in the shape | complete: true |

Cause (*code-traced*): a `where` predicate is evaluated with `filter_depth += 1`
but at the outer `page_depth` (`engine/read.rs:626–631`), so the predicate's inner
top-1 read runs at depth 0, finds "more rows", and sets `page_overflow`
(`read.rs:659`, `:877`). A shape's nested page bumps `page_depth` and does not.
By the reads card this answer must be rendered "Results may be incomplete". The
natural spelling, `where exists (messages[.roomId] matching q)`, is refused:
"exists requires an indexed read t[key]".

### 3. Merge-on-read Following is complete with one cursor; whether it passes the 3× gate depends on the measurement path (measured; corrected — see the end of this section)

```quarry
query following(c: cursor ?):
  return merge posts after c last 20 by byAuthorTime:
    [viewer]
    [f.followedId] for f in follows[viewer] first 1000 by byPair
```

1,000 authors × 50 posts, production binary, loopback HTTP, 60 samples:

| Follows | examined | complete / next | p50, three runs |
|---:|---:|---|---|
| 5 | 115 | true / yes | 2.53 / 1.85 / 1.79 ms |
| 500 | 1,540 | true / yes | 5.21 / 4.08 / 4.15 ms (**2.05× / 2.20× / 2.32×**; p95 ratios 2.13×, 2.08×) |
| 1,000 | 3,040 | true / yes | 8.15 / 6.39 / 6.47 ms (3.2–3.6×) |

Clique's gate is 500-follow ≤ 3× 5-follow; the celebrity write path is trivially
flat (no fan-out) and the celebrity read path costs what any 5-lane read costs.
It passes with a moderate margin, not a wide one (host load average 12–15 during
these runs); the recipe's measured in-app ratios are lower (0.86–1.16×). The
per-lane cost — about 9 µs, a full row fetch plus a lookahead for a head that
usually loses — is what A2's keys-only heads would cut.
`check` nevertheless emits `N_WIDE_MERGE` with the rewrite "`snapback4 init
--recipe feeds`": seven tables, fifteen caps, promotion at the 51st follower,
32 pull slots, a `authors.max(200).min(917)` backfill sized from the write
ceiling minus a 107-row promotion allowance. The 0.2.27 builder's essay: "The
feed recipe was helpful because following feeds are not just a filtered global
timeline at the required scale." They believed the diagnostic. Installed, the
recipe is 253 lines — 8 tables, 15 `cap` lines, 19 indexes, 13 `fn`s, a job and a
schedule — behind a 1,174-line card; in all four lanes nothing calls its generated
`src/following.ts` or its `feedFollowing` query (each builder re-declared the
merge to join post cards); and from the moment it is installed every `check`
prints "1 mutations never predict: social.follow (reads online-only table
feedPullCounts)". The detour costs a capability too.

**Correction after a second probe (same day, `bounds-probes/following-synced`).**
This section first said the recipe's real purchase is residency. It is not even
that. With `sync public` on `posts` and `follows` — which is what all four
builders' apps already ship, recipe or not — `check --residency` reports the
six-line merge as `following: runs: device` with every site `held, no horizon`,
and both `follow` and `post` stay `predicts: eligible` (the recipe's `follow`
never predicts). So merge-on-read already answers on both hosts. What remains
true is narrower: a public table can only sync to everyone, so every device
holds the whole public corpus (48,200 posts at the Clique envelope,
`N_NO_HORIZON`). Shrinking *that* is ruling 21 (§20.7, "a public table may sync a
subset to each device") — **ruled yes on 2026-09-14 and never built** (journal,
line 17734: "public subset sync was refused; the final recipe uses the viewer's
own read audience"). It is an acquisition-cost lever, not a prerequisite for
Following, and it carries an open design point: an author is not in their own
follower audience, so their device would not hold what it just wrote.

**Second correction (same day, from the bounds bar's "before" runs — this section's headline claim was too strong).**
"It passes with a moderate margin" is true of *my* measurement path and not of the rule. Two fresh builders on 0.2.27 both
chose this merge-on-read Following, and each measured it through their own bare `fetch` client, where a 5-follow page
costs about 0.3 ms: **0.309 → 2.771 ms (8.97×)** and **0.382 → 2.797 ms (7.32×)** for 5 → 500 follows. The bar's runner,
whose requests carry `meter: true` and cost about 1.8 ms each, measured the same apps at **2.51× / 2.95× p50 and 2.67× /
3.13× p95** — one of two over the line at p95. The engine-side fact under all of these is one number: a 500-lane page costs
about **2.5 ms more** than a 5-lane page (1,540 examined against 115, 13×). A ratio rule divides that by whatever the
transport adds, so the six-line merge "passes 3×" behind 2 ms of fixed overhead and fails it behind 0.3 ms. The Clique brief
states the rule as a ratio of loads and does not fix the path. So: merge-on-read is *complete, one cursor, never cut, with a
flat celebrity write path* — all true — but it is **not established that it passes the gate**, `N_WIDE_MERGE`'s rewrite to
the recipe is defensible at 500 follows, and the recipe should not be demoted from the default rewrite until the per-lane
head cost falls (keys-only heads — wave A's measurement — would need roughly 4× to bring 500 lanes under 3× on the fast
path). What stands from this section: the recipe's price (253 lines, 8 tables, 15 caps, `follow` never predicts, nothing
calling its generated query) and the residency correction above.

### 4. Speculative at `check`, silent at runtime (measured)

A 600-chat dense `everywhere` under `dev`: the answer is `complete: false, cut:
'meter', next: null`, `meter.examined = 8462` — and the dev server prints
**nothing**. Meanwhile `N_WIDE_MERGE` is a flat `lanes > 50` test
(`bind/mod.rs:250`) on the static `first N`, and `check --cost` prints the
ingredients ("up to 1000 lanes", "first 20") and leaves the multiplication to the
reader. LLP 2000.000 §6 promised the opposite on both counts.

### 5. The author restates numbers the schema holds (measured, compile-only)

`bounds-probes/cap-restated/variants.md`. With `cap 100 by roomId` and `cap 1000 by
principal` declared: a capped group cannot be read without `first 100`
(`members[roomId] by idx` parses as a point read with the wrong key count); a
predicting mutation loop must restate it ("the literal page bound must cover the
schema cap", `admission.rs:295`); a merge lane source must restate it ("a merge
for lane requires a bounded range read"). LLP 3000.007 principle 3: "the engine
never asks for a fact it already holds."

### 6. Any `complete: false` on a device bounces to the server (code-traced)

`local.ts:852`: `if (!held && !outcome.retained && outcome.complete === false &&
link === "online" && …) return server()`. The device also reports `unknown`
(`missing_fact`), the precise "the server knows more" bit. Keying the fallback on
`complete === false` means a cursorless top-N with more rows, a meter or word
cut, and the §2 defect all cost a server round trip whose answer is identical —
the local-first latency is lost exactly where the page is busiest.

### 7. One mechanical fact forces the two-cursor protocol (code-traced)

A merge's lane source is scanned at `page_depth + 1`, so it can never own `next`;
and `merge_can_continue()` (`read.rs:796`) withholds `next` from any merge cut by
the meter or the word limit because "the existing cursor has no per-lane
positions". Hence `searchChats` exists only to mint a cursor the merge cannot
return, and the card's "do not exchange them", "change both `first 50` bounds
together", "never advance past a cut" are the author hand-executing a composite
cursor. It is error-prone in exactly the way that predicts: the 0.2.27 builder
did not install wave 11's recipe (its tables are online-only examples; they
hand-transcribed the form onto their own), documented the protocol correctly in
`API.md:35`, and then wrote a walker that never follows the result cursor
(`scripts/scale-m8-curve.mjs:204–213`) — so its "global-search" curve measures the
first page of each batch.

### 8. What the record says (N = 1 per run; suggestive, not proven)

**No bound was hit at runtime in any of the last four lanes.** Across the
0.2.24–0.2.27 packets' `evidence/` there are zero `"complete": false` answers,
zero `E_BOUND`, zero cap refusals; every measured degradation ratio passed
(0.2.27: following 500/5 0.857×, deep page 1.098×, celebrity read 0.889×). Every
bounds-related correction loop cost seconds to minutes and was self-attributed
`agent-error` (the whole 0.2.27 M8 Quarry chain: six checks in 3 min 42 s). The
cost that was scored is *anticipatory*: notes read, cards read (`guide feeds`
grew 874 → 1,174 lines across these four runs, `guide search` 231 → 320), designs
changed in advance, and limits disclosed in the final report. Three friction
reviews already reached the measurement half of this — "these two drops are
narrative, not measurement" (0.2.23), "the same design with more prominent
disclosure" (0.2.21), "queries_and_live fell 82 → 78 on one self-authored
sentence about a query the app never calls" (0.2.24) — and each wave then
answered with more guidance. The scorer's credit to a competitor in this same
category, from the September 5 cell: "The read-time following merge is easy to
author."

`queries_and_live` by run: 0.2.16 **91** · 0.2.19 **89** · 0.2.21 84 · 0.2.22 **91**
| 0.2.23 82 · 0.2.24 78 · 0.2.25 86 · 0.2.26 82 · 0.2.27 83. Mean 88.8 before,
82.2 after. The break is 0.2.23 = wave 7, whose W7d "paved" global search with
the two-cursor walk — the first release whose card told builders the simple form
is wrong at 1,000 chats. At 0.2.22 the scorer wrote "M5 reused one indexed search
family online and offline"; from 0.2.23 on it writes N_WIDE_MERGE, "bounded
search", "completeness obligations". The 0.2.27 builder's `search.q` is nine
lines; its search UI uses only the held query, renders the card's sentence
verbatim ("Results may be incomplete. Narrow your search."), and the two-cursor
`batch` query is not called by the UI at all. The Quarry was never the cost. The
narration was.

Two instrument notes while here. The "failed search midpoint predicate" the
0.2.27 scorer cites in *two* categories is a flat curve: p95 8.229 / 7.940 /
7.316 ms at 10 / 50 / 100%; the 50% point sits 0.17 ms above a line that slopes
*down*. The midpoint rule needs a tolerance band. And the scorer reads the
builder's narrative, so every obligation a card states is an obligation a
conscientious builder writes into `final-report.md`.

## What this changes in the three-item plan

| Proposed | Finding | Better |
|---|---|---|
| 1. The engine plans the batched walk when it can prove the shape | No planner is needed (and LLP 3000.009 §4.5/§13 decline one: charges are defined in interpreter order). The natural query fits the declared envelope once matching lanes are lazy. The batched walk is the *fallback* beyond that envelope | Lazy matching lanes first; then a composite continuation so a cut uniform merge is never a dead end |
| 2. Completeness is a property the engine computes | It already is — as one boolean AND-ing seven causes, one of them false (§2), with dead ends (no `next`) where the engine could continue, and an SDK that turns every `false` into a server round trip | Fix the false positive; "no dead ends" as an invariant; fallback keyed on `unknown`; the paging hook discharges the rest |
| 3. Stop adding surface for a wave | Right, and the data points at *which* surface: the guidance that teaches bounds is what the scorer reads back | Not a freeze — a deletion wave with a surface budget, enabled by 1 and 2 |

## The plan: total reads

**Invariant.** Every read the language admits either completes or returns a
continuation the SDK can follow without the author; the author never writes a
number the schema states; `check` notes only certain semantic consequences
(never complete; cannot continue), and costs are measured facts in `dev`/`test`.

### Wave A — no new surface, no rulings (engine + SDK correctness and cost)

- **A1. A predicate's inner read does not overflow the page.** Evaluate `where`
  predicates at `page_depth + 1` (or gate `page_overflow` on `filter_depth == 0`).
  Regressions: §2's v1/v2 on the server and both device stores.
- **A2. Lazy matching lanes.** Flatten (scope × discovered word) lanes into the
  existing lazy heap for the uniform class; per-scope verdict and the 32-word cut
  keep their meaning; non-uniform merges keep the eager traversal untouched.
  Then measure keys-only heads (index-covered, no row fetch until a lane wins; not
  for expiring tables) — it is access pushdown in LLP 3000.009 §4.1's sense and
  is what would have to cut a lane head about fourfold before merge-on-read Following
  passes the 3× gate on a low-overhead client (§3, second correction). Acceptance: the card's dense
  1,000-chat fixture is complete with `next` on its first page on all three hosts;
  the Clique-shaped fixture (901 lanes, every row a hit) likewise.
- **A3. The device falls back on `unknown`, not on `complete === false`.**
- **A4. `dev` prints a measured cut** (op, persona, meter, site, the numbers — dev
  is loopback and already returns `Read.meter`), and `snapback4 test` flags any
  read past half a ceiling on the fixture. `N_WIDE_MERGE` stops being a default
  note with a restructuring rewrite: its arithmetic moves into `check --cost`
  ("≤ 1,000 lanes × (1 head + 1 lookahead) + 1,000 discovery ≈ 3,0xx of 8,192; each
  extra first-term word adds one index entry and one head per lane"), and the
  Following variant stops recommending the hybrid recipe for a merge that fits.

### Wave B — small language/contract moves (each needs the author's ruling)

- **B1. The author stops restating bounds, in two halves.**
  *(a) In a query, a merge lane source and a `for` over a prefix need no number:
  the meter is the bound* (principle 2), exactly as `range(a, b)` over int
  expressions already is — `check --cost` prints "lanes ≤ meter" as it prints
  "steps ≤ meter". No schema cap is required, which matters: the 0.2.26 builder
  added `cap 1000 by principal` to `members` only to justify `first 1000`, and
  from M3 on every check reported the price — "chat.addMember … insert arms never
  predict (members cap 1000 by principal is not covered by read rule …)" — a
  prediction loss no narrative file mentions. A bound the author invents to
  satisfy the parser can cost a capability.
  *(b) Where a cap exists, it is the bound:* `members[roomId] by idx` and a
  predicting mutation's `for m in members[roomId]` read the whole capped group;
  without a cap the mutation form keeps today's refusal and rewrite. This removes
  a required word, deletes "the literal page bound must cover the schema cap", and
  shrinks `N_NO_CURSOR`'s cap clause. `first N` keeps meaning "a page of N";
  `check --fix` rewrites a cursorless `first <cap>`.
- **B2. `exists` takes a prefix or matching read** (`exists messages[.roomId]
  matching q`): a top-1 that can never overflow. Rule probes are unchanged.
- **B3. A cut uniform merge continues.** `next` encodes (lane-source position,
  window end, inner position); the engine opens lanes until a reserved share of
  the meter is spent, fixes the window in the cursor, and resumes it
  deterministically. Rows are ordered within a window; the answer stays
  `complete: false, cut: 'meter'` until the last window, so nothing is claimed
  that is not true. Uniform class only — window edges then depend only on rows the
  viewer may read; non-uniform merges keep withholding `next`. This is the
  engine-planned batched walk, as the fallback it should be. **Blind review
  before landing** (cursor contents and the cut/continuation channel).
- **B4. Ruling 21** (public subset sync), re-scoped by the second probe: not needed
  for Following on both hosts (it already is, under `sync public`); its purchase
  is smaller cold acquisition of public tables — `posts` stays `public` to read
  and syncs `to follows[.authorId] by .followerId` under a per-author horizon;
  follow acquires, unfollow tombstones, by the partition engine. Needs the
  partition-inversion blind review and an answer for an author's own rows.

### Wave C — the deletion wave (the point of A and B)

Delete `init --recipe search`, `src/search.ts`, the two-cursor section of the
search card (214 lines → one query and a paragraph), `searchChats`. Decide `held`
and `E_QUERY_HELD` on a measurement: after A2 one query serves both hosts and
the automatic fallback picks the host; `held` survives only if the wasm device
cannot afford ~3,000 examined per page. ~~Demote the feeds recipe from the default
rewrite to "past N follows, or a celebrity write path you have measured".~~ *(Withdrawn
by §3's second correction: the hybrid recipe among these detours is the one the
measurement does not yet condemn — decide it on A2's keys-only-head numbers.)* Surface
budget for the wave, enforced like the client byte budget: card lines, codes a
reference app emits, and **numeric literals a reference app's author had to
choose** (feeds recipe today: ~23; merge-on-read with B1+B4: a follow cap, a
horizon, a page size) must all go down.

### Adjacent, not solved here

- A rolling-window ranking still cannot be maintained (three builders, one
  principal-writable rank table each). It is an expressiveness question about
  maintains over expiring sources, not a bounds question; it deserves its own
  finding.
- "A mutation page cannot scan a table with expiry" sent the 0.2.27 digest to a
  non-expiring staging table (and silently cost `media.deleteMessage` its
  prediction). The restriction came from the §17 blind reviews (expired rows are
  charged before the verdict under `Cut::Abort`). Whether it can relax for a
  uniformly decided prefix is a review question, not a lane.
- Job sweeps are where builders' bound designs were genuinely uneven: 0.2.24
  nested `first 1000` memberships × `first 10000` messages in one chunk; 0.2.26
  set a page to `first 16384`, the chunk ceiling itself; 0.2.27 walks all of
  `messages` by id every period (grader d-07); only 0.2.25 wrote the form that
  scales with the period's activity (`chunk m in messages[at >= periodStart, at <
  periodEnd] first 10 by byTime`). That is a pattern to pave on the jobs card, not
  an engine change.

## What not to do

No cost-based planner. No ceiling raised. No third search recipe. No new note
that speculates. No `system update` (§20.20 stands). The 0.2.26 review set the
bar for engine work on search — "avoid a ceiling increase or new search
architecture until the same program shows a platform limitation" — and then
tried the smaller experiment it recommended, an installable recipe; the next
builder did not install it. What §1 shows is not a ceiling and not an
architecture: it is one execution path (`lazy_merge`) that excludes matching
lanes.

## Measuring it

Eleven N = 1 calibrations at ~2.5 h each cannot resolve a 2–3 point category
effect (queries_and_live has moved ±8 between adjacent runs with no query-surface
change). For this family use a **bounds bar** in the ceremony-bar mould: N ≥ 3
fresh builders, a 1,000-chat / 500-follow seeded fixture, four tasks (global
search grouped by chat, Following, Trending, the digest). Record wall time,
loops by attribution, lines of Quarry per task, numeric literals chosen, which
notes fired, whether the 3× probes pass — and the count of bound vocabulary in
the builder's own final report, because that text is the scorer's input. Run it
before wave A for a baseline.

## Rulings (the author, 2026-09-17, in session)

Wave B is ruled. Each was put with its alternatives and a compiled before/after;
the author took the recommended option on all five. Proposed numbering for LLP
3000.007 §14 is 23–27; the LLP text is **§20.22** of LLP 3000.007 (wave 12, in
flight in another session at the time, claimed §20.21).

| # | Question | Ruled |
|---|---|---|
| 23 · B1(a) | In a **query**, may a merge lane source and a `for` over a uniformly decided prefix omit `first N`, the examined meter being the bound (a cut answers `complete: false`), printed by `check --cost` as "lanes ≤ meter" / "rows ≤ meter" as `range` prints "steps ≤ meter"? | **Yes, both** — lane sources and query `for` loops. Mutations and jobs unchanged (a cut there is an abort). A *returned* page still needs `first N` or a cap. No schema cap required. |
| 24 · B1(b) | Where the pinned prefix carries a schema `cap`, may a read or a predicting mutation loop omit `first N` and mean the whole capped group (lowered to `first <cap>` in the IR)? | **Yes; `first <cap>` stays legal.** No note on existing code, no forced `--fix`; cards show the boundless form. Refused at `check` with the rewrite when there is no cap (returned or mutation position) or when a returned group's cap exceeds the examined ceiling. Deletes "the literal page bound must cover the schema cap". |
| 25 · B2 | May `exists` take a prefix read or a `matching` read in program expressions (a top-1 scan that can never overflow), rule probes unchanged? | **Admit it.** Same verdict, meter and horizon logic as a `first 1` page; `check --cost` prints it as that scan. Today's refusal for `exists messages[roomId]` rewrites to "`unique byColumn: <column>`" — wrong for this intent; it goes with the change. |
| 26 · B3 | Commission a continuation for a meter- or word-cut **uniform** merge — one opaque cursor carrying (lane-source window, position inside it)? | **Commission the design and its blind review now**; implementation lands only on READY from both families. Fixed points: (1) uniform class only — non-uniform merges keep withholding `next`; (2) one cursor, no new `Read` field; (3) past one read a merge is a sequence of *ordered windows*, not one global order, and every page of such a walk says `complete: false, cut: 'meter'` until the last; (4) `usePage` treats a followed `next` as discharging that page's cut; (5) wave C does not delete the two-cursor card section until this lands. |
| 27 · B4 | Ruling 21 (public subset sync), ruled yes 2026-09-14 and never built: when? | **Stays ruled yes; decide on measured residency.** Sequenced after wave A and B1–B3. First take per-table cold rows and bytes for the reference app on the bounds bar (the 0.2.26 review's H5 asked for this number; nobody has it). Build if acquisition is what is charged; it needs the partition-inversion blind review and an answer for an author's own rows. |

A detail the previews relied on, checked on 0.2.27: a page read already infers
its index when exactly one leads with the pinned key (`members[viewer] after c
first 50` compiles, `by` omitted), so the ruled forms need nothing beyond
dropping `first N`; an ambiguous prefix keeps today's `by index` refusal.

**Ruling 26, amended the same day** ("ok do your recs", after two review rounds —
`W13-B3-O.status.md`): **(a) Part O, the windowed continuation, is shelved.** Two
rounds did not converge and a probe showed it is not needed: the grouped
one-cursor search is a filtered page whose meter cut already carries `next` — at
9,000 memberships it is cut at 8,194 examined, returns `next`, and finishes on the
second request (`bounds-probes/grouped-search-9000`). **(b) The fifth fixed point
is re-ruled:** the two-cursor card section, `init --recipe search`,
`src/search.ts` and `searchChats` are replaced by the grouped one-cursor form in
the landing that carries the predicate-overflow fix (lane W13a) and ruling 25
(lane W13c) — lane W13e — instead of waiting for a continuation that is not
coming. **(c) Part D** (a cut while *draining* returns `next`, with the two
shipped merge defects it depends on) lands when its narrow review reads READY
from both families. Another session's LLP 3000.007 §21 has since claimed ruling
numbers 28–33, so this is recorded as an amendment to 26, not a new number.

**Ruling 26's review, finished the same day.** Four rounds, two families. Part D
read **READY WITH CHANGES from both** in round 4 (no Critical or High), every
change applied; the design of record is
[LLP 3000.007.000](../../../llp/3000.007.000-merge-position-and-drain-cut-continuation.spec.md)
— a unique merge position (the shipped P1), `next` decided when the outcome is
built (the shipped P3), and a cut while draining returning `next`. **Not
delivered:** the fourth fixed point — the hook discharging a followed cut page —
descoped at the three-round limit (each round found a new way an answer can be
missing something a continuation does not repair); a followed cut page still reads
"may be incomplete".

**Still open** for the author: (1) `N_WIDE_MERGE` — move its arithmetic into
`check --cost` and leave the default notes; (2) whether `held` / `E_QUERY_HELD` is
deletable, on the wasm device's measured cost; (3) ~~demote the feeds recipe from the default rewrite~~ — **withdrawn** by the second correction to §3: not until
keys-only heads are measured; (4) Q8 — reopen the hook's discharge as
its own design, or leave a followed cut labelled incomplete; (5) a query that
pages `after c` and returns `group(page, …)` or `sort(page, …)` can never publish
`next` and `check` says nothing (`group-drops-next/`) — carry the page through
row-preserving helpers, or note it; (6) ruling 27's residency measurement.
