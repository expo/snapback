# Clique on Snapback 2 — run diary

Cold benchmark lane, diagnostic brief (M1–M3, media-free, React web only).
Owner port 20510, vite port 20520 (both ≥ 20000 per brief).

## Setup (2026-08-31T21:26Z → 21:28Z)

- Installed both tarballs, ran `npx snapback2 init`. Scaffold is tiny and
  honest: a todos schema, a working React provider, an AGENTS.md block with
  the loop (`check` → `dev` → `test`).
- Docs surface is small but dense: package README + 6 guide pages +
  `snapback2 guide <symbol|E_CODE>`. The `families.json` wrong/right pairs
  and `guide E_*` pages are genuinely useful. `snapback2 guide app` (the
  certified project manifest with per-op bounds) is a great "what do I
  actually have" view.
- The binary refuses `--help` on subcommands ("unknown option --help") but
  prints usage when you pass a bad flag — minor papercut; I got the full
  flag surface from error messages (`dev [--port N] [--foreground] [--stop]
  [--status] [--serve] ...`).

## M1 — accounts and profiles

- Start 2026-08-31T21:28:03Z, end 2026-08-31T21:42:30Z (~14.5 min wall).
- `auth: { password: true }` gives signup/login/logout/me + expiring
  bearer tokens out of the box. The server enforces password ≥ 8
  (`E_AUTH_PASSWORD_WEAK`), duplicate email (`E_AUTH_EMAIL_TAKEN`), and
  logout revokes server-side (`E_AUTH_SESSION` on the old token). Exactly
  what the brief wanted; zero code on my side.
- First real platform friction: the certified handler subset has **no
  per-character string ops**. `"...".split("")` → `E_OPAQUE` ("helper ... is
  not defined in this module or the pure builtin set"), and looping over
  `args.handle.split("")` → `E_UNBOUND_LOOP` (loop domain has no static
  cardinality) even though the arg has a declared max of 20. So the handle
  charset rule `[a-z0-9_]` is enforced client-side only; the server enforces
  length ≥ 3 and uniqueness (pre-check + unique index constraint). The
  refusal messages were clear and the `rewrite` field even echoed my whole
  module back — verbose but useful.
- Handle uniqueness = one `db.get(profiles.byHandle, [handle])` + `db.require`
  + a `constraints: [{ unique: "byHandle" }]` backstop. Nice.
- Session persistence: the React arm has no built-in token persistence.
  `createClient` supports `persist`, but `SnapbackProvider` doesn't expose
  it, so the app stores the token in localStorage itself (src/lib/session.ts)
  and passes it as the provider `token` prop on boot. Fine, but the provider
  could pave this.
- Live profile edit propagation worked on the first try via
  `client.subscribe(api.profiles.byId, ...)` — no invalidation wiring at all.
- Acceptance M1: 6/6 green (items 1–5; item 2 split into 2a/2b).
  Two-client/reload items covered by scripted API clients per the brief:
  item 3 ("reload") = new client constructed from the persisted token; item 5
  = a second user's live subscription seeing the edit without refresh.

Product calls made (no human available):
- Onboarding: after signup, a user without a profile row is routed to a
  "Set up your profile" screen; display name + handle required there.
- Profile fields bio/location/link stored as "" when empty (no optional
  columns needed).

## M2 — posts and the follow graph

- Start 2026-08-31T21:42:30Z, end 2026-08-31T22:02:45Z (~20 min wall).
- Acceptance M2: 7/7 green (all two-client live items via concurrent
  `snapback2/client` API clients, as the brief allows).
- This milestone was a guided tour of the certifier. Every refusal was
  precise and actionable, but the paved lane is narrow. The full sequence
  of walls I hit, verbatim codes:
  1. `E_UNBOUND_LOOP` — a scan bound in a ternary loses static cardinality
     (`rows = cond ? scan(...) : scan(...)` refuses; one unconditional scan
     per branch, or one uniform scan, is required).
  2. `E_OPAQUE: helper must be a single pure return expression` — module
     helpers cannot contain db reads or statements, so per-item hydration
     logic must be inlined into each query (I have ~40 lines duplicated
     between feeds.global-style hydration and feeds.hydrate).
  3. `E_PROVENANCE_AMBIGUOUS: read key provenance is ambiguous` — you may
     not db.get with a key taken from a merged+sorted intermediate array.
     This forced the two-stage feed design: feeds return raw entry pages;
     a separate `hydrate` query (keys from a declared-max args list) joins
     bodies/names/counts. The UI runs page+hydrate as two chained live
     queries. Honestly a reasonable pattern once you accept it.
  4. `E_OPAQUE: expression ElementAccessExpression is outside the S1 IR` —
     no `arr[i]`. Last-element extraction becomes a for-loop.
  5. `E_OPAQUE: sort requires an inline field comparator` — only
     `(a, b) => b.x - a.x` shapes; no tie-breakers. Pushed me to unique
     sort keys (a global seq counter) rather than (at, id) pairs.
  6. `E_BOUND: output bytes 3012943 exceeds ceiling 1048576` — the killer.
     The following-feed merge (50 followees x take 20) exceeds the 1 MiB
     certified output ceiling because the estimate uses the table's
     declared row max (~600 bytes per id-typed column!), not the projected
     fields. **The Following feed merges the viewer + their 12 most recent
     follows** — a real product cap I had to accept to certify the merge.
  7. Id values are a distinct scalar kind: writing an id into a t.text
     column is `E_INPUT ... violates Text` / `E_TYPE: expected matching
     strings or arrays, got id`, and `""` is not a valid Id
     (`E_INPUT: posts.parentId violates Id`). Original posts are therefore
     **self-parented** (parentId = own id) and readers subtract the self
     row from the maintained reply tally.
  8. Cross-viewer counters: `E_RULE: Update denied on profiles` — bob's
     follow can't bump alice's followerCount column under viewerIs rules.
     The paved answer is engine-maintained count tables (`maintains`),
     which are excellent: five maintained tallies (replies, likes,
     reposts, followers, following) with deny-all rules, updated
     transactionally by the engine, live-invalidating.
- Runtime vs certifier gaps (certifies green, refuses at runtime):
  - `range: { lt: [at, id] }` — composite range bounds refuse with
    `E_SCHEMA: array is not an indexable scalar`; map form refuses with
    `row is not an indexable scalar`. Only scalar bounds work. That killed
    (at, id) cursors and motivated the seq counter design.
  - `Page.hasMore` is in the TS lib and certifies, but touching it at
    runtime refuses the whole query with `E_TYPE: expected row or map,
    got array`. Workaround everywhere: `rows.length === take`.
  - `after:` in a desc scan is ascending-relative (returns nothing with a
    top sentinel); `before:` is the desc-pagination bound that works.
- Migrations were smooth where additive and honest where destructive:
  `E_SUCCESSOR_DESTRUCTIVE` emits `.snapback/migration-<gen>.json` and
  `dev --apply-migration` applies exactly it. When I flip-flopped a column
  type over populated maintained rows I got E_SUCCESSOR_COLUMN_REQUIRED
  and used `snapback2 reset` (dev data is disposable; seed rebuilds).
- Live queries themselves: flawless. Zero invalidation wiring; every
  acceptance live-update raced through in <100 ms. Subscription receipt
  states matter though: a full page delivers `capped`, not `complete` —
  my acceptance initially waited for `complete` and timed out. The README
  does document the seven states; I just hadn't internalized that capped
  is the *normal* state for a full feed page.
- The two-stage feed pattern (entries + hydrate) costs an extra round
  trip per page but composes cleanly with live subscriptions; both stages
  invalidate independently and the UI just re-renders.

Product calls made:
- Feed pages are seq-cursor windows; page 1 is live-subscribed, older
  pages are one-shot loads ("Load more").
- Following-feed merge covers viewer + 12 most recent follows (certified
  ceiling, documented in snapback/feeds.ts).
- Replies to replies are allowed (thread shows direct children).
- No dedupe between a post and its reposts in one feed page (attributed
  separately, matches the brief's repost attribution requirement).

## M3 — messaging core

- Start 2026-08-31T22:03:00Z, end 2026-08-31T22:18:05Z (~15 min wall).
- Acceptance M3: 7/7 green. Full suite: 20/20.
- Design that made this milestone small: **receipts are per-member
  watermarks**, not per-message rows. Each roster row carries
  deliveredSeq/readSeq (the highest global message seq that member's client
  has fetched / viewed). A message's ticks are derived client-side by
  comparing its seq against the watermarks of its send-time recipient set
  (reconstructed from joinedAt/removedAt vs the message timestamp), and the
  group aggregate "waits for the slowest member" by construction. Monotonic
  server-side via max(). Zero receipt tables, zero output-ceiling drama.
- The one real fight: **the two certifier rules collide on membership.**
  chat.list must scan "my conversations" by viewer prefix, and a capped
  scan refuses unless its read rule is uniform over the scanned prefix
  (`E_STRUCTURAL_COUNT: returned result depends on capped-only site ...;
  its read rule is not uniform over the scanned prefix`). That forces
  read: viewerIs(userId) on the scanned table. But admins must read and
  update *other* members' rows, which viewerIs forbids — my first
  single-table design failed at runtime with NOT_MEMBER because an admin's
  db.get of the target's row was rule-filtered to null (reads inside
  mutations obey read rules; easy to forget and totally silent). Second
  design (mirror table written in lockstep) worked but was ugly. Final:
  `members` = personal inbox pointer (convoId+userId, never deleted),
  `roster` = single source of truth for role/active/watermarks, readable
  via a prefix-constant membership probe. This is the shape the certifier
  wants; I wish the guide had said so upfront.
- An or() rule with a prefix-uniform disjunct (viewerIs) is NOT accepted as
  uniform — disjunct-level uniformity analysis doesn't happen.
- DM uniqueness without string keys: ids can't be concatenated into a text
  dmKey (Id is a distinct scalar kind), so `dmPairs` stores the pair as two
  ref columns with a unique index and openDm checks both orders before
  inserting — safe because the owner serializes commits.
- Adding a required int column (convos.lastSeq) to a populated table is
  refused (`E_SUCCESSOR_COLUMN_REQUIRED ... wrap in t.optional or add to an
  empty table`) and no migration plan can backfill it. Dev recipe that
  works: `snapback2 reset`, `touch snapback/schema.ts` (so the watcher
  applies the successor on the empty store), then reseed. If you seed
  before the successor applies you recreate the rows and wedge it again —
  order matters.
- Channels (typing) were effortless: declared in schema with membership
  publish/subscribe rules and ttlMs, `client.channel(api.typing,
  {convoId}).publish/subscribe` on the wire. Acceptance measured delivery
  in well under 2 s. Expiry is client-side (UI clears 3 s after the last
  event; server ttlMs 4000 bounds retention).
- `E_OPAQUE: expression ConditionalExpression is outside the S1 IR` — a
  ternary is fine in a const initializer or object property but NOT as the
  right-hand side of an assignment to an existing variable. if/else it is.
- Two-client items covered with scripted API clients (per the brief):
  M3 1 (live DM), 3 (typing), 4 (receipt ticks live), 6 (removal
  semantics). The UI implements the same flows (ConversationScreen
  tickState mirrors the acceptance's aggregate function; the Chats screen
  marks fetched conversations delivered; opening a conversation marks
  read).

Product calls made:
- "Delivered" in the web UI = the recipient's client fetched the
  conversation list (marks newest message delivered); "read" = opened the
  conversation. Matches the brief's "fetched by the recipient's client" /
  "viewed the conversation".
- Removed members keep the conversation in their list (flagged "you
  left"), can read history up to removal server-side, cannot send.
- Rejoining a group resets joinedAt, so messages from a prior membership
  period no longer count the rejoiner in their receipt aggregates (edge
  case; send-time snapshot is otherwise exact).
- Conversation list bounded at 40 conversations; thread pages at 25
  messages (certified output ceilings; documented in snapback/chat.ts).

## Closing summary

- Total wall clock (setup + M1 + M2 + M3): ~52 minutes.
- Final acceptance: 20/20 items green across three milestones
  (`npm run acceptance`, output in acceptance-output.txt).
- Ports: owner http://127.0.0.1:20510, vite dev server
  http://localhost:20520 (both ≥ 20000 per brief; 8087/3000/5173 avoided).
- What the platform is genuinely great at: auth in one schema line with
  correct server-side semantics; live queries with zero invalidation
  wiring (every live acceptance item passed in <100 ms); maintained count
  tables; honest migrations; error envelopes with codes + rewrites that
  teach the model of the system; `guide app` / `why` / `trace` as
  first-class introspection.
- What costs real design effort: the certifier's provenance and
  output-ceiling rules reshape your schema (two-stage feed hydration, seq
  counter instead of timestamp cursors, inbox/roster split, id-vs-text
  scalar kinds, self-parent sentinels). Every wall was announced with a
  precise code, but several correct-looking designs had to be rebuilt to
  fit the paved lane, and two features (Page.hasMore, composite range
  bounds) certify but fail at runtime.

## Post-pass — the platform's own proof battery (22:18Z → 22:31Z)

After the brief's suite was green I ran `snapback2 test --derived-only`
(fresh isolated owner, six derived check families) and chased its verdicts:

- With an empty static seed almost everything is "blocked". Filling
  `snapback/seed.ts` with a consistent static fixture (17 tables' worth,
  literal ids) unblocked `rules` (pass).
- `bounds` was blocked with "cannot choose a seed id for <op>.<arg>" until
  I typed op arguments as `t.ref(table)` instead of bare `t.id()`. Lesson:
  **argument types should be refs**; the checker (and presumably tooling
  generally) can then pick real rows to probe with. After the sweep:
  certify, rules, and bounds all pass.
- `replay` still reports "no committing probe" for the four admin chat
  ops (the checker's chosen argument combinations trip my requires) — a
  fixture-shape limitation I accept.
- `invalidation` reports failures (e.g. `chat.openDm -> chat.list`
  delivery null) **in the isolated test owner only**. I verified the same
  flows against the real dev owner: subscribing to chat.list and running
  openDm / send delivers live updates immediately (see the probe in this
  session; and the acceptance suite's 10 live items all pass). Recorded as
  a test-harness discrepancy, not an app staleness bug.
- Overall `snapback2 test` verdict is therefore "blocked" — the receipt
  machinery is honest about what it could not prove, which I appreciate,
  but a first-party way to feed it committing probes (or to mark
  admin-op requires as expected rejections) would make it reachable.

Final state: `npm run acceptance` 20/20 green (M1 6/6, M2 7/7, M3 7/7),
typecheck clean, owner on :20510 and vite on :20520 left running.
