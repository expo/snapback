# RUN-DIARY — Clique on Quarry (paper exercise, diagnostic brief M1–M3)

Lane: cold design lane, no compiler, inputs = quarry-spec-v0.2.md + brief-diagnostic.md only.
Exercise constraint in force: NO `maintain` declarations, NO `#aggregate[...]` reads.
Timestamps are UTC and bracket the authoring of each milestone file; the bulk of the design
thinking for all three milestones happened in one continuous sitting before/while writing M1,
so M2/M3 wall-clock reads short — the schema was designed as one evolving whole, as briefed.

## M1 — Accounts and profiles

- Start: 2026-08-31T21:52:38Z
- End:   2026-08-31T21:53:04Z
- Output: M1.md — 1 table + `use identity`, 2 mutations, 3 queries.

Felt good: `use identity` swallowed more than half the milestone — acceptance items 1, 3, 4
and duplicate-email are entirely the kind's contract, and the data plane's whole job reduced
to one table with three rules. `id: viewer` on the insert ("id minted unless given") ties the
profile row to the principal with no foreign-key ceremony. `unique handle` + commit-time
refusal is exactly the right shape for the duplicate-handle acceptance item — no
check-then-insert race to reason about.

Fought me: validation floors. `text <=N` gives every ceiling for free, but a 3-char minimum
and a `[a-z0-9_]` charset have no expression — there is no `len`, no regex, no charset
predicate. WORKAROUND: one INVENTED `matches(handle, '^[a-z0-9_]{3,20}$')` at each of the two
use sites, plus client-side mirroring declared at the boundary. Nonempty (min 1) I could get
honestly via `!= ''`.

Other workarounds: (a) updateProfile's all-optional args patch via `arg ?? .col` — the cost
is that a cleared field becomes '' and can never return to absent; (b) the language never says
what `~` evaluates to, so updateProfile ends with an explicit re-read and an assumption that a
transaction reads its own writes.

## M2 — Posts and the follow graph

- Start: 2026-08-31T21:53:04Z
- End:   2026-08-31T21:54:02Z
- Output: M2.md — 6 new tables, 5 new mutations + 2 changed, 8 new queries + 3 changed.

Felt good: the ordering/prefix/range grammar. Declaring `by parent, at` and reading
`posts[parent = p] first 50` made the thread screen one expression; `unique(actor, post,
kind)` made the repost toggle a match-then-insert/delete with the engine holding the
invariant. Shapes with auto-deref (`.post { *, author: .author { … } }`) meant every feed
query is a single projection with no join language at all. And "predicates over absent are
false" turned out to compose beautifully: `not exists posts[post.parent]` is a correct
"is an original" test with zero null-handling.

Fought me — this is where the exercise constraint bit hardest:

1. NO MAINTAINED AGGREGATES → follower/following/like/reply counts became hand-kept side
   tables (userStats, postStats). Side tables, not columns, because column-granular update
   rules are inexpressible: a follow must bump the OTHER user's row, so whatever table holds
   the counter needs a permissive update rule, and I refused to put that rule on `users`.
   Every social mutation now pays 1–2 extra bump writes, and every feed row pays an extra
   nested point read for its counts.
2. NO `maintain rows` EITHER → the Following feed had to be query-time fan-in. `merge` is
   the right tool but the reference only shows enumerated prefixes; I needed it over the
   viewer's follow page. That is the run's one true INVENTION: `merge(feedEntries[f.followee]
   for f in sources, feedEntries[viewer]) last 20`. And for fan-in to be COMPLETE (no silent
   feed gaps) I had to cap following at 200 — a visible product limit forced purely by
   boundedness. Recorded as a product call, enforced via the hand-kept counter.
3. Whole-table reads don't exist (an ordering with an empty prefix has no bracket form), so
   the Global feed is `merge` over the two `kind` prefixes — in-spec, but I only found it
   after trying and rejecting a constant discriminator column. A worked example of a
   "table-wide feed" in the reference would have saved 15 minutes of design.
4. Optional-argument branching: `match` is point-reads only, and `before (cursor ?? now)` is
   a TYPE ERROR because `now` is time!intent — the intent-clock wall did its job, but the
   language offers no presence test for an optional scalar arg, so every paged surface split
   into two programs (first page + Before/After). 4 extra programs. An honest cost, but a
   `match arg:` over optionals would halve it.
5. Single-column cursors: ties on `at` can straddle pages; composite (at, id) cursors are
   inexpressible. Noted as a known limit; the seed staggers timestamps.

Design decision worth recording: feedEntries (actor, post, kind, at) as the ONE materialized
row per feed occurrence — it is simultaneously the repost store, the repost toggle key, the
profile post list, both feeds' fan-in surface, and (by omission of reply rows) the proof that
replies never reach feeds. When the language forces you to materialize, materialize the thing
every screen shares.

## M3 — Messaging core

- Start: 2026-08-31T21:54:02Z
- End:   2026-08-31T21:55:14Z
- Output: M3.md — 4 new tables + 1 channel, 9 new mutations, 4 new queries.

Felt good: `sorted(viewer, u)` + `unique lo, hi` — the one-DM-per-pair requirement, which is
a locking discussion on most platforms, was three race-free lines; the builtin plainly exists
for exactly this. The `typing` channel declaration is the brief's typing requirement almost
verbatim (ttl 5s = "expires within 5 s"), with zero rows. And the entire app finished with
ZERO schedules: every timing requirement (typing expiry, session expiry) landed in a kind,
never in a clock-comparing rule — the language's clock discipline actively steered the design
away from time bugs.

Fought me:

1. RECEIPTS UNDER THE NO-AGGREGATES CONSTRAINT — the hardest design of the run. Per-message
   counters (deliveredCount/readCount/recipientCount) died on the spec's "members who leave
   drop out of the aggregate": honoring a leave means adjusting counters on every historical
   unread message, an unbounded write. WORKAROUND: per-member WATERMARKS (deliveredUpTo,
   readUpTo on the member row), monotonic via max(); a message's aggregate state = min over
   the ≤50 current members' watermarks. Leavers drop out because their row is deleted;
   "membership at send time" falls out of initializing joiner watermarks to joinedAt. The
   residue: the language cannot fold min over a page (`| count`/`| sum` only, and bindings
   can't accumulate across `for`), so the final ≤50-element min() is a declared client-side
   fold. This is the place I most wanted `page | min .col`.
2. members.update is a 13-line rule of enumerated unchanged-column arms (own watermarks vs
   co-member activity bump vs admin promotion). No column-granular rule granularity = every
   arm restates every column it does NOT touch, with `?? ''` sentinels wherever two optionals
   are compared (equality over two absents is false). Verbose, but it did force me to
   enumerate exactly who may change what — arguably a feature wearing a cost's clothing.
3. Order-of-writes as authorization: leave/remove must patch memberCount BEFORE deleting the
   member row, or conversations' members-only update rule refuses. Correct, subtle, invisible
   — no compiler would flag getting it backwards; only the refusal at runtime would.
4. Chat-list ordering: a sort key must live on the ordered table, so send fans activityAt out
   to ≤50 member rows. The 50-member product cap is what makes this legal at all — bounded
   fan-out on write is fine exactly because the schema bounds the audience.
5. createGroup cannot count its own capped-list argument (reductions are page-only), so
   min-size-2 is a re-read of the hand-kept memberCount after the insert loop.

Interpretation flagged (would ask a compiler/spec owner): rules that read tables
(`exists members[r.conv, viewer]`) must evaluate with the engine's eye, as channel rules do —
otherwise members.read is self-referential.

## Where I most wanted a compiler

1. The M2 merge invention and every bracket-inference site (`follows[viewer]`,
   `feedEntries[actor = u]`, `postStats[.]`): I am pattern-matching the reference's inference
   rules by hand; one typecheck would confirm or kill the whole feed design in seconds.
2. The M3 members.update rule: 13 lines of column enumeration across three arms, plus the
   absent-equality trap — precisely the code shape where a silent thinko survives a paper
   review.
3. The time!intent / time!commit wall: I *believe* `before (cursor ?? now)` is a type error
   and that stored `now` re-reads as plain time — the design leans on that reading, and only
   a compiler can certify it.

## Workaround ledger (complete)

- W1 (M1): INVENTED `matches()` for handle floor/charset — no length/regex in the language.
- W2 (M1): clear-to-'' instead of clear-to-absent in updateProfile (`??` patch idiom).
- W3 (M1): explicit re-read as mutation result — patch's value unspecified.
- W4 (M2, constraint): userStats/postStats hand-kept counter side tables + bump writes.
- W5 (M2, constraint): Following = merge fan-in; INVENTED dynamic-prefix merge; 200-follow cap.
- W6 (M2): Global feed = merge over the two enum prefixes (no whole-table range read).
- W7 (M2): first-page/next-page program pairs (no optional-arg branching; intent-clock wall).
- W8 (M2): single-column cursor tie risk accepted; seed staggers timestamps.
- W9 (M3, constraint): watermark receipts instead of per-message aggregates; client-side min fold over ≤50 roster rows.
- W10 (M3): memberCount hand-kept; patch-before-delete write ordering to satisfy rules.
- W11 (M3): activityAt fan-out (≤50) on send for the chat-list ordering.
- W12 (M3): group min-size via post-insert re-read (can't count a capped-list argument).

## Totals

- 11 tables, 1 channel, 1 identity kind, 0 schedules, 0 effects.
- 16 mutations + 15 queries = 31 programs across the three milestones.
- 2 INVENTED constructs (matches(); dynamic-prefix merge), both marked at use sites.
- Run: 2026-08-31T21:52:38Z → 2026-08-31T21:55:14Z file-authoring window, one sitting,
  single evolving schema, no restarts.
