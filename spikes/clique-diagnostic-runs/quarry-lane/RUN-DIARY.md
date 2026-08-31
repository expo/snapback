# Clique (Quarry lane) — RUN DIARY

Cold benchmark lane. Backend authored in Quarry (`.q`), compiled with the
packaged `quarryc`, served by packaged `snapback2`. No human. Diagnostic brief
variant (M1–M3, media-free, web-only).

## M0 — Setup and platform orientation

- Start: 2026-08-31T22:41:00Z (workspace creation)
- Installed all three tarballs at workspace root; read `snapback2` README,
  `snapback2-quarry` README, `dist/guide/*` (grammar, auth, live-query,
  testing, personas, effects), and both quarry fixtures
  (`todos-quarry`, `full-surface`).
- `npx snapback2 init clique` scaffolded a vite+react app with a TS backend
  (todos) in ~1s. Felt good: instant, printed next steps.
- Key constraints discovered up front from the quarry README (before writing
  any code — this README is genuinely load-bearing):
  - `maintain`/`#` refused → every count (followers, likes, reposts, replies)
    must be an int column my mutations keep correct.
  - `merge` refused AND `maintain rows` refused → neither of the spec's two
    blessed home-feed strategies exists. Feed fan-in has to happen client-side
    over bounded per-lane queries.
  - Rules limited to public/allow/deny + eq/ne/and/or/not/exists/viewerIs;
    no old/next comparison; point-read field chains in rules refuse;
    per-field update grants are a named v0.3 gap.
  - Composite/alternate-key writes refuse → get-row-then-id rewrite.
  - Top-level `index`/`unique` not accepted; must live in the table block.

Plan of record (product calls, recorded here since no human is available):
- Counts denormalized as int columns; count-bearing tables get permissive
  `update r <- allow` rules because per-field grants don't exist; the only
  write paths are my mutations, which guard. Noted as a security-shape cost.
- Handle charset `[a-z0-9_]`/min-length: not expressible server-side in the
  Quarry subset (no regex/length builtins). Enforced client-side; uniqueness
  and max length enforced server-side. Recorded as a language gap.
- Feeds: `feedItems` table (kind post|repost, actor, post ref, at) written by
  mutations; replies never get feedItems. Global feed = server-cursor query.
  Following feed = client-side k-way merge over bounded per-lane queries
  (viewer + followees), since merge/maintain are refused.
- Profile post list = that user's feedItems (originals + reposts, no
  replies) — matches "replies never appear in feeds" and avoids the
  impossible "filter replies out of posts[author]" (range reads have no
  predicate).
- Receipts: WhatsApp-style per-member watermarks (lastDeliveredAt/lastReadAt
  on the members row), monotonic by guard; aggregate tick derived in the
  client as min over current members with joinedAt <= msg.at (bounded ≤50
  members). Leavers drop out naturally because their members row is gone.
- Removed members "keep local copy": server correctly refuses post-removal
  reads; the client retains the last good frame. Noted in acceptance.

### Probe round (scratch app, before real code) — every refusal verbatim

1. Quarry-compiler refusal: `schema.q:35:1 — table reference/rule cycle
   involving conversations, members cannot be expressed by the current
   TypeScript surface; restructure the schema`. My conversations read rule
   referenced members while members.conv referenced conversations. Fix:
   `members.conv: id` (plain id column) — losing auto-deref from members to
   conversations. The refusal was sited and honest, but "restructure the
   schema" gave no hint WHICH edge to break.
2. Platform refusal (check): `E_BOUND output bytes 5815852 exceeds ceiling
   1048576; product: db.scan(follows.byFollower, ...) static bound 50 ×
   followingFeed take 20 = 1000` — my one-query nested Following feed
   (follows page with a nested per-followee posts page in the shape) is
   expressible in Quarry and compiles, but the platform's static bound
   calculus priced it at 5.8MB and refused. GOOD refusal (sited, showed the
   arithmetic, suggested a rewrite). Pivoted to per-lane queries + client
   merge.
3. Platform refusal (check): `E_STRUCTURAL_COUNT returned result depends on
   capped-only site msg.myConversations.0; its read rule is not uniform over
   the scanned prefix`. Scanning members by user=viewer under a
   self-exists-by-conv read rule is refused; scanning the SAME table by
   conv-prefix under the same rule is accepted (rule uniform over prefix).
   Disjunctive rule `r.user = viewer or exists members[...]` is ALSO refused
   for both scans — uniformity reasoning doesn't split disjunctions. Fix:
   denormalized a private `inbox` table (read `r.user = viewer`) alongside
   the roster `members` table, exactly as the rewrite hint suggested.
4. Platform bug-or-sharp-edge (runtime): `E_TRACE_SUBSET: writes to members
   2 > 1` — two sequential `+members` inserts inside a match/if arm commit-
   fail at RUNTIME (check passes!). The same two inserts straight-line at
   the top level commit fine, and a `for` loop over a literal list
   (`for u in [viewer, other]: +members {...}`) also commits fine. The
   certified write-trace undercounts repeated same-table writes inside a
   branch arm. Workaround: loop over a literal list inside the branch. This
   was the nastiest probe finding — a check-green/runtime-red split.
5. Runtime: `E_TYPE: expected bool, got null` — `if existingRow:` truthiness
   on an absent row is refused at runtime (though `if cursor:` on an
   optional scalar arg compiles and is the fixture-blessed pattern). Used
   `if exists dms[lo, hi]:` + a `!`-asserted re-read instead.
6. `seed({ personas: [...] })` without `rows` fails `E_SEED_INVALID` whose
   rewrite text is byte-identical to the refused source (it omits the
   required `rows: {}`). Misleading error.
7. `snapback2 dev` ignores SNAPBACK_PORT env; `--port N` works (found via
   usage string in the binary, since `--help` isn't a flag).

Nice findings: unique conflicts surface as
`E_CONSTRAINT: sealed unique conflict on users.byHandle` (perfect for the
duplicate-handle acceptance); password ≥8 is platform-enforced
(`E_AUTH_PASSWORD_WEAK`); duplicate email is `E_AUTH_EMAIL_TAKEN`;
`snapback2 run <op> --as persona` + `snapback2 data` make CLI smoke tests
delightful; `+users { id: viewer, ... }` (profile row keyed by principal)
works; empty-prefix ranges (`feedItems[] last 20 by byAt`) work; nested
point reads and nested bounded range reads inside shapes work.

- M0 end: ~2026-08-31T22:59:00Z (~8 min setup+docs, ~10 min probing — the
  probe round paid for itself several times over)

## M1 — Accounts and profiles

- Start: ~2026-08-31T22:59:00Z
- Backend + scripted acceptance green (5/5): ~2026-08-31T23:05:00Z (~6 min)
- UI screens (auth, profile setup, edit) verified in a real headless
  browser during the shared UI pass below.

What happened:
- Wrote the full Clique schema and social/chat programs in one pass — the
  probe round meant almost everything compiled first try. New refusals hit
  during this pass, verbatim:
  - `social.q:11:3 — the packaged db.update surface accepts only a scalar
    id key; get the row by byHandle and write using its id` — for
    `~users[me.id] {...}` where `me` came from a `!`-asserted point read.
    The row's own `.id` is apparently not typed as a scalar key once the
    patch mentions a uniquely-indexed column. Workaround: `~users[viewer]`
    (the row IS the viewer's). Confusing refusal — the site was right but
    the message pointed at byHandle, which appears nowhere in the source.
  - `social.q:54:9 — no unique index on feedItems matches [?, ?, ?]; name
    the columns/index or add one` — positional composite key with an enum
    literal (`feedItems[viewer, p, 'repost']`) doesn't match; named columns
    (`feedItems[actor = viewer, post = p, kind = 'repost']`) work. Fine
    refusal, easy fix.
  - `schema.q:9:1 — refusing to overwrite hand-written snapback/schema.ts;
    rename the Quarry module or remove the collision` — GOOD custody
    behavior: quarryc refused to clobber the scaffold's hand-written
    backend; deleting the scaffold files was the right move and the
    refusal said so.
- Auth is the platform's `use identity` and it is excellent: password ≥8
  enforced server-side (`E_AUTH_PASSWORD_WEAK`), duplicate email
  `E_AUTH_EMAIL_TAKEN`, logout revokes server-side (`E_AUTH_SESSION` on
  the old token), and the duplicate handle surfaces as
  `E_CONSTRAINT: sealed unique conflict on users.byHandle` from the
  declared `unique handle` — zero application code for any of it.
- Quarry vs TypeScript here: `use identity` + `unique handle` + the
  `insert r <- r.id = viewer` rule is ~6 lines for what would be a page of
  TS. The language pulled its weight in M1. The handle charset/min-length
  rules were the one thing I could not express (no regex/length in the
  subset) — enforced client-side only, recorded as a gap.

## M2 — Posts and the follow graph

- Start: ~2026-08-31T23:05:00Z
- Backend + scripted acceptance green (7/7): ~2026-08-31T23:12:00Z (~7 min
  of wall clock, but it contained the two worst bugs of the run)

This was the milestone where the run nearly wedged, twice, on
check-green/runtime-red splits:

1. **The insert-result id lie.** `p = +posts {...}` then `p.id` silently
   yields an id DIFFERENT from the stored row's id (the platform's
   `db.insert` returns a row object whose `.id` is re-minted when the
   input id came from `ctx.newId()`; the store keeps the input id). Every
   feedItems row pointed at a nonexistent post; every nested feed shape
   rendered `item: null`; thread lookups of fresh posts said
   POST_NOT_FOUND. Nothing refused — it was pure silent corruption, found
   only by dumping `snapback2 data posts` next to `data feedItems` and
   noticing the ids were off by one mint. THE worst failure mode of the
   run, and it sits squarely between quarryc ("insert evaluates to the
   inserted row" per spec) and the platform insert contract. Workaround
   everywhere: pre-mint `pid = new`, pass `id: pid`, never touch the
   returned row's `.id`, and re-read `posts[pid]! else IMPOSSIBLE` when
   the mutation must return real data (read-your-write inside the
   transaction works, thankfully).
2. **Descending cursor pagination is broken end to end.** The engine's
   `after` bound means "greater than" in BOTH scan directions, and quarryc
   pins `before cursor last N` to `order: desc, after: cursor` — so page 2
   of a newest-first feed returns the newest items again (nearly full
   overlap, verified at the wire). Nothing refuses; you just get duplicate
   pages. Workaround: an `ord: int` column storing the NEGATED timestamp,
   so every newest-first read is an ASCENDING scan (`after cursor first
   20 by byOrd`) whose exclusive-greater cursor is correct. Cost: `ord`
   must be client-supplied (Quarry has no arithmetic on `now`, so the
   server cannot compute `-at`) — an ordering key in the same trust class
   as the intent clock, plus an extra arg on createPost/toggleRepost/send,
   plus schema migration. The migration then hit
   `E_SUCCESSOR_DESTRUCTIVE` (dropping the now-unused indexes needs an
   explicit plan) and `dev --apply-migration` only attaches to a running
   owner while `dev` refuses to start under a destructive successor — a
   chicken-and-egg I escaped by deleting the dev store (acceptable in dev;
   would be a real wedge in production).
3. `if cursor:` on an optional arg — the fixture-blessed pattern — dies at
   RUNTIME with `E_TYPE: expected bool, got null` when the arg is absent;
   `if cursor > 0:` then dies in the platform's own TS gate
   (`E_OPAQUE: '__q_left_122_13' is possibly 'undefined'`). Truthiness
   tests on absent values are a tarpit in the current lowering; I split
   every cursored query into two ops (`globalFeed` + `globalFeedBefore`,
   etc.) — honestly a cleaner API anyway.

The good parts of M2:
- The static bound calculus is legitimately impressive: it priced my
  nested one-query Following feed at 5.8MB (50 lanes × 20 posts) and
  refused with the exact arithmetic and a rewrite. That refusal redirected
  the design to per-lane subscriptions + client merge in minutes.
- Live queries just work. Every "without manual refresh" item passed first
  try once the data was right: Global feed subscription, follower-count
  bumps, like counts, reply counts — all frame-accurate via
  `sub.until(...)` with no polling anywhere.
- The uniformity checker (`E_STRUCTURAL_COUNT`) is strict but its rewrite
  text ("denormalize the authorization scope onto <table> and include it
  in the prefix") named the exact fix.

## M3 — Messaging core

- Start: ~2026-08-31T23:12:00Z
- Backend + scripted acceptance green (7/7): ~2026-08-31T23:14:00Z; full
  19/19 suite through `npm run acceptance` at ~23:15:30Z

- The `members`/`inbox`/`dms` trio (roster with self-exists rule, per-user
  edge table, sorted-pair DM uniqueness) designed in the probe round
  worked nearly unchanged. `(lo, hi) = sorted(viewer, other)` plus
  `unique lo, hi` is a genuinely lovely way to say "at most one DM per
  pair" — the race falls out of commit-time unique refusal, and the second
  `startDm` returned the same conv id from both sides first try.
- One real fix: admin remove-member initially failed `NO_INBOX` because
  the viewer-scoped inbox read rule hides the target user's row FROM THE
  MUTATION — rules bind data programs too (correct per spec, still easy
  to forget), and with composite-key writes refused there is no
  delete-by-key escape. Made inbox `public` (ids-only metadata) — the
  least-leak fix available without per-field grants.
- Receipt watermarks (lastDeliveredAt/lastReadAt on the members row,
  monotonic via absence-compares-false guards) passed the whole
  sent → delivered → read + group-waits-for-slowest item on the first run.
  The absence idiom (`if m.lastReadAt >= upTo: false else: ~...`) reads
  strangely but is exactly right once internalized.
- Typing channel: declared in 5 lines of schema, delivered in 2–3ms
  client-to-client, membership-ruled. No server code at all. Compare the
  TS/Convex equivalent (presence tables + TTL sweeps): this is the
  clearest Quarry win of the run alongside `use identity`.
- Removed members: the server correctly empties (not denies) their thread
  scan — rule-filtered scans return empty-complete. The "local copy"
  requirement is client-side retention (kept last non-empty frame +
  banner); acceptance verified no post-removal delivery to Carol's live
  subscription.

## UI pass (shared across milestones)

- Start: ~2026-08-31T23:15:30Z; browser smoke 8/8 green:
  ~2026-08-31T23:28:00Z (~13 min)
- React app: auth, profile setup, feed tabs, thread, profile view/edit,
  chats list, conversation (bubbles, quoted replies, ticks, typing,
  roster admin, removed-member banner). Typechecked strict, vite build
  clean, verified headless with playwright-core + system Chrome
  (no download, no focus steal): signup → profile → post → Global tab →
  profile screen → DM send → reload persistence → logout, 8/8.
- Three browser-only platform traps, none visible from Node:
  1. The packaged client invokes its `fetch` unbound → every request in a
     real browser throws `Failed to execute 'fetch' on 'Window': Illegal
     invocation`. Fix: pass `fetch: (...a) => globalThis.fetch(...a)` to
     BOTH `createClient` and `SnapbackProvider`.
  2. A live query opened without a valid session gets a JSON refusal the
     SSE path treats as a connection failure → `hydrating` forever (the
     documented "initial connection failure remains hydrating" behavior
     eats the auth refusal). Fix: imperative `auth.me()` probe before
     mounting any live query.
  3. Chrome's ~6-connections-per-origin cap: every subscription is its own
     EventSource, so me + likes + marks + following + conversations +
     listUsers deadlocks the app silently. Had to budget streams per
     screen: toggle-state reads became one-shot queries refreshed after
     mutations; listUsers/conversation metadata one-shot. A multiplexed
     transport would erase this entire failure class.
- The app's tsconfig had to stop typechecking the GENERATED backend: the
  scaffold includes `snapback/`, but quarryc's self-referential table
  rules (`rule.exists(members, ...)` inside `members`' own initializer)
  violate strict TS (TS7022/TS2448) even though `snapback2 check`'s own
  gate accepts them. Generated code that fails the app's default strict
  config is a compiler bug by the package's own conventions.

## Quarry notation: where it helped, where it hurt (vs writing the TS directly)

Helped:
- **Schema density.** The whole 10-table data model + rules + typing
  channel is ~130 readable lines. The generated TS is ~3x that before any
  handler bodies. Rules-as-predicates on the table (`read r <- exists
  members[r.conv, viewer]`) are dramatically clearer than the packaged
  combinator calls they compile to.
- **`use identity` / `channel ... ttl 5s`** — entire subsystems as
  declarations. Auth and typing indicators together cost 9 lines.
- **Point reads with refusal codes** (`members[c, viewer]! else
  NOT_MEMBER`) collapse the fetch + null-check + error-shape boilerplate
  that dominates TS handlers; stable codes flow to the client envelope
  untouched, which made acceptance assertions exact.
- **`sorted(viewer, other)` + `unique lo, hi`** for DM dedup; **match
  some/none** for toggles — each toggle mutation is 8 lines and the race
  safety comes from commit-time unique refusal, not code.
- Shapes with auto-deref (`author: .author { displayName, handle }`) are
  the join syntax I wish every backend had.

Hurt:
- **The refused constructs are the app's center of gravity.** A social
  feed IS `merge`/`maintain`; counts ARE aggregates. With all of them
  refused, the design work migrated into tables-as-materialized-views
  (feedItems) and hand-kept counters — exactly the bookkeeping the spec's
  abstractions exist to eliminate, now spread across every mutation, plus
  a client-side merge layer.
- **No arithmetic on time and no length/regex over text** forced the
  client-supplied `ord` key and client-only handle validation — both are
  server-authority holes I'd never have in TS.
- **Branch-sensitive lowering bugs** (write-trace undercount in arms,
  truthiness-on-absent, insert-result id) mean the notation's semantics
  and the running program's semantics disagree in places only runtime
  probing reveals. In TS these classes of bug are visible in the code you
  wrote; here they hide behind codegen.
- **One-mutation-per-fix loop**: each refusal costs a quarryc + check +
  owner-reload cycle (~5–10s); fine, but the owner reload race (run
  against a stale manifest right after check) bit twice.
- The `.q.ts`/`.ts` dual-emission bridge doubles every certificate/site
  message in check output — every refusal prints twice; noisy.

## Platform test verb (side quest, bounded and abandoned)

- `snapback2 test` (not a brief deliverable — the brief's acceptance is
  `npm run acceptance`) first reported the rules family
  `blocked: no seed rows for conversations/dms/members/messages` — the
  derived rule prober wants declarative seed rows per restricted table.
  Verdict `blocked` with receipts under `.snapback/receipts/`, and my
  authored journey ran against a fresh isolated owner.
- After adding a minimal static rowset so the prober had rows, the verb
  WEDGED: the isolated test owner pinned a core at ~98% CPU for 9+
  minutes (3m22s+ CPU) with no receipt, no progress output, and no
  timeout of its own. Killed it at the 10-minute mark per the ~30-minute
  wedge rule and moved on — recording it here as a platform
  capability-failure observation: `snapback2 test` with seed rows for
  rule-restricted tables (self-exists rules on members, 67 ops) appears
  to send the derived battery into a combinatorial or non-terminating
  probe. The dev owner on 20600 was unaffected throughout.

## Close-out

- All three milestones green through the single documented command
  (`npm run acceptance`): 19/19 items, plus an 8/8 real-browser UI smoke
  (`npm run ui-smoke`). Final artifacts: `acceptance-output.txt` and
  `run-summary.json` at the workspace root; app in `clique/`.
- End: ~2026-08-31T23:42:00Z. Total wall ≈ 61 minutes against a 4-hour
  budget.
- Coverage note (per brief ground rules): every two-client live item was
  exercised by two concurrent API clients (tagged `[two-client]` in the
  acceptance output): M1-5; M2-1, 2, 4, 5, 6; M3-1, 3, 4, 6. The browser
  smoke covered single-client UI journeys (signup, profile setup, posting,
  feed tabs, profile, DM send, reload persistence, logout).

### Three worst frictions

1. **[platform] The insert-result id lie** — `db.insert`'s returned row
   carries a re-minted id while the store keeps the written one. Silent
   referential corruption across three tables; no refusal anywhere;
   diagnosed only by eyeballing `snapback2 data` dumps. Cost the single
   biggest debugging block of the run and forced a pre-mint-and-re-read
   idiom into every creating mutation.
2. **[platform, with a quarryc accomplice] Descending cursor pagination
   returns the wrong half of the index** — engine `after` = exclusive
   greater-than in both scan directions, quarryc pins `before…last` onto
   it, page 2 of every newest-first feed duplicates page 1. No refusal;
   caught by an acceptance item. Forced a client-supplied negated-time
   `ord` column through schema, mutations, scripts, and UI — and the
   resulting index drops hit the `E_SUCCESSOR_DESTRUCTIVE` /
   `--apply-migration`-needs-a-running-owner chicken-and-egg, escaped
   only by deleting the dev store.
3. **[Quarry-language] The refused constructs are the app's center of
   gravity** — no `maintain`, no `#`, no `merge` means feeds and every
   count are hand-kept materializations spread across mutations plus a
   client-side merge layer; no time arithmetic and no text predicates
   push ordering keys and handle validation to the client. The notation
   is at its weakest exactly where a social app lives. (Runner-up,
   [Quarry-compiler]: the branch-arm write-trace undercount
   `E_TRACE_SUBSET: writes to members 2 > 1` — check-green, runtime-red.)

### Three best moments

1. **The bound calculus refusing my 5.8MB feed at check time** with the
   full arithmetic (`static bound 50 × take 20 = 1000` rows) and a
   rewrite hint — it turned a would-be production incident into a
   30-second design pivot. The uniformity checker's
   "denormalize the authorization scope" hint was similarly precise.
2. **`use identity` + `unique` + channels doing whole subsystems for
   free**: password auth with server-side revocation, duplicate-handle
   refusal at commit, and 2–3ms membership-ruled typing indicators cost
   ~15 lines of schema total and zero handler code, and every acceptance
   item over them passed first try.
3. **Live queries + `sub.until` made the acceptance suite almost write
   itself** — every "updates live without refresh" requirement became a
   one-line predicate over subscription frames, and all 10 two-client
   live items passed without a single poll loop or sleep-and-hope.


