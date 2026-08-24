# diary.md — lane opus-clique-explicit (Clique on Snapback 0.1.25, explicit profile)

## M1 — accounts and profiles

### What I built

- A Snapback backend in the **default explicit profile**: `snapback/schema.mjs`
  with a `defineAuth` program (password credentials on the built-in provider,
  `minimumLength: 8`, no guest arm, no email-code arm) and eleven tables;
  `snapback/functions.mjs` with `defineJsLiveQuery` / `defineJsMutation` /
  `defineAssetUpload` declarations and generated exact function references
  under `snapback/generated/`.
- An Expo Router web client on top of the frozen UI kit (vendored verbatim into
  `src/social-ui/`), with a persistent nav rail (feed tabs + chats list) and a
  routed main column, so the contract's `sm-feed-tab-*` and `sm-chats-item`
  IDs stay reachable from every route the choreography visits.
- A **fixture replay adapter** (`tools/replay.mjs`) that installs
  `starter-m1.log` through the app's real signup and mutation paths — ~1,000
  password hashes is the M6 shape; here it is 8 — plus a `seedRefs` ledger
  table so a second run of the same segment is a no-op.
- A one-command acceptance suite (`npm run acceptance -- --milestone m1`)
  that seeds, runs the milestone's suite-required assertions against the real
  web client, validates a coverage manifest against the instrument's
  `assertions.json`, and writes the suite receipt, the choreography
  suite-status linkage, and the typed D0.6 observation sidecar.

### What felt easy

- **Codegen diagnostics are unusually good.** Every refusal named its rule, a
  source span, an admitted alternative, and a build-bound guide anchor. When
  the inline handler profile rejected `obj[key]`, the message told me the exact
  rule (`inline.syntax.forbidden`), the exact line, and the page to read. I
  never had to guess.
- **The served Guide is a real product.** `snapback guide <query>` plus
  `GET /_snapback/guide/<page>.md` off the running binary meant documentation
  was build-bound to the binary I was actually running, and section flats let
  me pull "backend" and "clients" once instead of grepping a wiki.
- **Password auth is genuinely built in.** `defineAuth` + `signUpWithPassword`
  / `signInWithPassword` / `signOut` gave me M1's whole auth surface — server
  hashing, one-time recovery codes, server-side logout revocation — without me
  writing a KDF or a session table. That is the single biggest hour saved.
- **Live queries are the default shape.** `profileByHandle` is thirty lines of
  declaration and the other client saw a profile edit in ~300 ms with no
  subscription plumbing on my side.

### What fought me

- **Random ports in the paved dev loop.** `snapback dev --expo` picks free
  loopback ports for Metro's front proxy and the supervisor bootstrap origin,
  which collides with this lane's fixed 42160–42179 constraint. I ended up
  running the backend with `--external-client-origin` and hand-building the
  `supervised-dev` AppBindingV1 in `src/backend.tsx`. That took reading
  `app-client.mjs` to learn that the binding's `capabilities.offered` must
  include `auth.passwords`, which no page states.
- **`custody: 'volatile-explicit'`.** The expo-chat template ships it, AGENTS.md
  tells you not to move off it, and it silently selects *memory* auth custody —
  so the session does not survive a reload, which is M1 acceptance item 3. The
  guide text says Expo web "has the same durable reload restoration as React
  web", which is true only under `durable-required`. I had to read
  `app-client.mjs` to find the selector.
- **Inline handler admission.** Computed member access and top-level `const`
  capture are both refused. My first `functions.mjs` used plain objects as maps
  everywhere; converting to `Map`/`Set` was mechanical but unexpected, and the
  rule is a page I had not been routed to by the start packet.
- **A two-step signup.** Snapback owns the principal; my app owns the profile
  row with the unique handle. That makes "duplicate handle is rejected with a
  visible error" a two-server-step story: a public pre-check query, then the
  unique index as the real authority. It works and it is honest, but it is more
  ceremony than a single `createUser({handle})`.

### What the explicit profile saved or cost

- **Saved:** every function is a value I can read. `results.records(v.object({…}))`
  made the wire contract of each screen explicit, and the generated
  `api.d.ts` typed the client without me writing a single interface twice. The
  `refusals: [...]` + `ctx.refuse(code)` channel is the thing I miss most in
  other backends: `HANDLE_TAKEN` arrives at the browser as a stable code, not a
  message I have to regex.
- **Cost:** the declaration is verbose and the handler dialect is a subset of
  JavaScript. `Object.keys(map).map(k => map[k])` is not admissible; neither is
  a shared `const MAX_ROWS`. I paid maybe 25 minutes to that dialect. The
  `authScopeField` declaration also refused my computed-record field name
  (`FUNCTION_UNKNOWN_FIELD` — it must name a *table* field), so principal-scoped
  handler queries currently carry no scope declaration at all.

### What documentation or diagnostic was missing

1. **No page tells you which capabilities a hand-built AppBinding must offer.**
   `auth.passwords` is only discoverable by reading
   `@expo/snapback-client/app-client.mjs`. A "run Expo against a fixed-port
   backend" recipe would have saved the whole detour.
2. **`custody` is documented as a posture, not as a mechanism.** Nothing says
   "volatile-explicit means memory custody, so reload loses the session."
3. **`authScopeField` on handler-backed live queries.** The guide describes it
   as declaring "which result field represents the principal", but codegen
   validates it against the primary table's fields. Either the prose or the
   validator is wrong; with a computed record contract there is no way to
   declare it at all.
4. **The instrument's choreography cannot install its own dependencies** when
   the instrument tree is read-only; a lane-side resolver shim was needed. That
   is an instrument-packaging gap, not a Snapback one.

### M1 result

Suite 7/7 suite-required assertions, coverage 7/7. Choreography segment `m1`
3/3 required assertions passed, `green: true`, `nonGreenCause: null`.

## M2 — posts and the follow graph

### What I built

- Posts (text / 1–4 images / one video) as one `posts` table plus a bounded
  ordered `postMedia` child table — the guide's explicit ruling against a
  column splay — with three `defineAssetUpload` intents at `public-immutable`
  delivery so a plain `<img>`/`<video>` renders without a bearer header.
- A `feedEntries` projection: one row per visible feed entry (the author's
  original, and one attributed entry per reposter), ordered by an app-owned
  strictly increasing `sortAt`. Global is a keyset page over that index;
  Following filters it by `[viewer] + followees`, which is where the brief's
  implicit self-follow lives — computed, never a persisted edge.
- `setLike` / `setRepost` / `setFollow` as idempotent set-state mutations
  (`set`/`clear`, never flip) with unique indexes as the structural guard, and
  a client-side *intent override* so a rapid second tap carries the state the
  viewer intends next rather than the last state the server projected back.
- Feed paging as six fixed keyset page slots with `skip` for unused ones, an
  inclusive cursor and `entryId` de-duplication, and both tab head pages kept
  subscribed app-wide so a route change never re-primes an empty feed.
- 22 suite-required assertions, including a "no gaps" check that compares the
  rendered entry-id prefix against the authoritative server ordering.

### What felt easy

- **The feed projection wrote itself.** `defineJsLiveQuery` with a declared
  `reads` set gave me a joined, viewer-scoped, paged feed record in one
  function, and both clients saw a new post ~270 ms after commit with no
  subscription code in the app.
- **`results.records(v.object({…}))`** meant the feed row shape was a single
  declaration that typed the server, the wire, and the React component.
- **Unique indexes as the toggle guard.** `by_post_actor` unique made the
  set-state intents structurally safe; I never wrote a read-modify-write race.
- **Asset delivery.** `useSnapbackAssetImage` + `public-immutable` gave me two
  rendered fixture images and a playing MP4 with no URL construction, no signed
  URL refresh loop, and no 404 flicker (the hook holds the placeholder until
  the rendition publishes — I only learned that because the suite waited on
  `naturalWidth > 0` and it eventually went green on its own).

### What fought me

- **A memoization mistake I would not have made against a REST API.** I keyed
  the merged feed rows on entry ids, so *field-only* live updates (a like
  count, a reply count) were memoized away while insert/delete updates worked.
  It cost me an hour, and the debugging was only tractable because the headless
  client let me prove the *server* delivered the update in <1 s while the
  browser did not. That asymmetry — same query, two arms — was the single most
  useful diagnostic I had.
- **Toggle races.** With a live-projected `viewerLiked`, a fast second tap
  re-sent the same intent and became a no-op. That is the correct set-state
  semantics doing exactly what the brief asks for; the fix is a client intent
  override, and nothing in the guide's optimistic-mutation section points at
  the toggle case (the recipe it links is exactly this, but I found it after).
- **The instrument's `repost-following-feed-surface` check** samples the other
  client's Following feed immediately after the composing client's own feed
  settles. Measured, that is a ~50/50 race against ~270 ms live propagation
  (3/6 in my probe). It is green under best-of-three and I recorded the
  measurement rather than pretending it is deterministic.
- **Removing a denormalized column needs a migration.** I had denormalized
  follower/following counts, then wanted them derived; dropping the required
  columns refused with `SNAPBACK_SCHEMA_REQUIRED_FIELD_BACKFILL_REQUIRED` and I
  took a dev-fresh reset plus a reseed. Fair, but it is the first place the
  explicit profile's "schema is a contract" posture cost real time.

### What the explicit profile saved or cost

- **Saved:** the whole feed is one declared function with a declared read set,
  so "what invalidates this view?" is a line of source rather than a cache-key
  convention. And `refusals: ['SELF_FOLLOW', …]` let the suite assert the exact
  refusal code for "users cannot follow themselves" instead of a message match.
- **Cost:** the handler dialect again. Batching the viewer's like/repost state
  into two set reads (instead of two point reads per rendered post) is the kind
  of optimization I would normally write with `Object.fromEntries`; here it is
  `Map`/`Set` only. And every read I wanted batched had to be re-expressed,
  because `getMany` is bounded at 256 and the N+1 advisory fires on the
  loop form.

### What documentation or diagnostic was missing

1. **No diagnostic for a client-side staleness bug.** When the browser held a
   stale row, everything reported healthy: `status: ready`, `freshness:
   current`, `connection: live`. There is no "last delivered frame at" or
   per-query delivery counter a lane can render. I had to build my own
   `sm-feed-diagnostics` line.
2. **The optimistic-toggle recipe is not linked from the mutations page** where
   set-state intents are introduced, and `useSnapbackMutation`'s default
   (queued) versus `{queue:false}` difference is described in terms of
   settlement, not in terms of what a user-initiated toggle should choose.
3. **`getMany` bounds versus the N+1 advisory.** The advisory tells you to
   batch; the batch API caps at 256 ids and returns `null` for hidden *and*
   absent rows. For a 20-row page that is fine, but the advisory does not say
   when *not* to take its advice.

### M2 result

Suite 22/22 suite-required assertions, coverage 22/22. Choreography segment
`m2` 7/7 required assertions passed (2 optional media checks skipped by the
frozen contract), `green: true`, `nonGreenCause: null`.

## M3 — messaging core

### What I built

- DMs deduplicated by a `pairKey` on a **unique index over an optional field** —
  present only for DMs, so the constraint applies to pairs and never to groups,
  and "starting the same DM again" resolves to the existing channel inside the
  mutation instead of racing at the client.
- Groups as first-class entities (name, description, admin/member roles,
  add/remove/promote), with two identical-membership groups deliberately
  coexisting because nothing dedupes them.
- Quoted replies as a pointer (`messages.quoteId`), rendered through the kit's
  `QuotedReply`, with a lane-owned `sm-convo-bubble` wrapper so the contract's
  per-message actions resolve *inside* the bubble the harness selected.
- Receipts as **per-membership watermarks** (`deliveredSeq` / `readSeq`) rather
  than per-message rows: the aggregate is `min` over the recipient set at send
  time, and a member who leaves has no row and so drops out of the requirement.
  That is one row per member per chat instead of one per message per member.
- Typing as the template's ephemeral collection, retuned to a 3 s lease so the
  brief's "expires within 5 s of the last keystroke" holds even if a publisher
  stalls.

### What felt easy

- **Ephemeral presence is a genuinely small surface.** `ephemeral.collection`
  plus `useSnapbackPresence` with a `skip` sentinel for observers was maybe
  twenty lines for a correct typing indicator with server-owned expiry. I have
  hand-rolled this three times in other stacks and it was never twenty lines.
- **Unique indexes over optional fields.** `pairKey` optional + `{unique:true}`
  expresses "at most one DM per pair, unlimited groups" as one declaration.
  Codegen derived `whereApplicable` and I did not have to think about it again.
- **Declared refusals paid off again.** `m3-a14` ("a non-admin cannot remove
  members") asserts the exact `NOT_ADMIN` app code at the API *and* the visible
  error in the UI, and both come from one `ctx.refuse('NOT_ADMIN')`.

### What fought me

- **`useSnapbackMutation` returns a union.** `String(await createGroup(...))`
  produced `"[object Object]"` and the new group's route was unreachable. My
  mistake, but the failure mode is silent: navigation to a nonsense id renders
  "this conversation is unavailable" rather than anything that points at the
  dispatch shape.
- **`SNAPBACK_OUTBOX_AUTHORIZATION_SUSPENDED`.** Both non-queued dispatch forms
  refuse with "foreground mutation waits for authorization proof" while the
  client is re-establishing authority after a route change. It says *waits*; it
  *refuses*, and the caller has to wait. It is effect-free (raised before
  transport dispatch), so a bounded retry over the closed authority-fence code
  set is safe — but I only convinced myself of that by reading the published
  client source.
- **The 2 s typing ceiling caught a rendering bug, not a backend one.** Every
  keystroke re-rendered the whole message list, so typing a 45-character string
  cost ~60 ms per character and the indicator appeared 2.77 s after the first
  keystroke. Isolating the draft into a memoized composer took it to ~1.4 s
  (single-keystroke latency ~72 ms). The backend was never the problem — but
  the instrument's ceiling is what exposed it.

### What the explicit profile saved or cost

- **Saved:** the receipt model. Because `chatMessages` is one declared handler
  with a declared read set, "when does a receipt tick change?" is a function of
  `memberships` — one line in `reads`, and the aggregate is computed in the same
  place it is defined. In a fetch-shaped backend this is where I would have
  started inventing cache invalidation.
- **Cost:** the same handler dialect tax, plus one structural cost I did not
  expect: `authScopeField` cannot name a computed record field, so none of my
  principal-dependent live queries carry a scope declaration. The gate is real
  (`ctx.auth` inside the handler), but the platform's own invalidation and
  retention bookkeeping does not know these queries are per-principal.

### What documentation or diagnostic was missing

1. **The dispatch-shape choice is not presented as a decision.** `useSnapbackMutation`
   (union), `{queue:false}` (strict, refuses on unsettled authority),
   `useSnapbackSettledMutation` (settled convenience, same refusal) — there is
   no table saying which one an ordinary online screen should use, and the two
   that "resolve the result" both have the same sharp edge.
2. **`SNAPBACK_OUTBOX_AUTHORIZATION_SUSPENDED` has no guide entry** describing
   caller obligation. `snapback guide <CODE>` returned the registry stub
   (subsystem + HTTP status) and nothing about what to do.
3. **`authScopeField` and handler-backed live queries** (repeated from M1): the
   documented meaning ("which *result* field represents the principal") and the
   validator (a *table* field) disagree.

### M3 result

Suite 7/7 suite-required assertions, coverage 7/7. Choreography segment `m3`:
both required checks passed plus the optional quoted-reply excerpt-and-jump
check, four assertions skipped by the frozen contract (no sender-avatar ID, no
semantic receipt token, no group-member lifecycle controls), `green: true`,
`nonGreenCause: null`.

### Cross-milestone regression

After M3 I re-ran all three suites and all three choreography segments on the
final build: M1 7/7, M2 22/22, M3 7/7, and `m1`/`m2`/`m3` choreography all
`green: true` (`receipts/regression-*`). `tsc --noEmit` is clean.
