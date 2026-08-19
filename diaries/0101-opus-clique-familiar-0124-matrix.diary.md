# Diary 0101: opus-clique-familiar — 0.1.24 model×profile×app matrix lane

**Date:** 2026-08-17/18
**Run:** model×profile×app matrix on published Snapback 0.1.24
(`benchmarks/runs/2026-08-17-model-profile-app-matrix/`)
**Lane:** `opus-clique-familiar` — Claude Opus 5 (claude CLI headless)
**App:** Clique (Expo Router web); Snapback familiar (snapback-familiar-ts-v1) profile, published 0.1.24 from npm
**Outcome:** M1–M3 green
**Wall:** 12,367s · **Cost (approx., public list prices):** $163.6
- Output tokens: 430,232
- Cache reads 288,322,885; cache writes 867,743

This diary's build narrative and essay are the lane agent's own words, written
milestone-by-milestone during the timed build per the lane prompt; the
orchestrator added only this header. N=1 exploratory calibration evidence, not
scored or claim-eligible (LLP 0201 D5). Machine load was shared with
concurrent fleet work — per-lane loadavg samples are retained with the run
record. 

# Clique run diary — lane opus-clique-familiar

Backend: published Snapback `0.1.24` (`@expo/snapback-*`), sessions mode,
`snapback-familiar-ts-v1` authoring profile. Client: Expo Router 57 web.

---

## M1 — Accounts and profiles (green)

**What I built.** `snapback/schema.ts` with one `users` table (principal
binding, handle, the brief's exact profile fields, an `avatar` typed
`v.assetRef`, denormalised follower/following counters), a `defineAuth`
password program pinned to the brief's 8-character minimum, and one
`media.ts` upload intent. `snapback/users.ts` holds `me`, `byHandle`,
`directory`, `ensureProfile`, `updateProfile`, `setAvatar`. On the client:
an Expo Router shell with a persistent left rail (feed tabs, chat list,
account links) and route screens for feed, profile, profile edit, settings
and search, all composed from the frozen UI kit. Two harnesses came with it:
`scripts/replay.mjs`, which replays the fixture pack's `starter-m1.log`
through the app's real signup/mutation path, and `scripts/acceptance.mjs`,
the single `npm run acceptance -- --milestone m1` entrypoint that brings up
the pinned-port backend and web client, seeds, runs the checks, and writes a
coverage-validated receipt plus the choreography's suite-status file.

**What felt easy.** The authoring loop is genuinely tight: edit `schema.ts`,
run `snapback generate snapback`, get a typed `api.users.me` reference with
JSDoc naming its legal verbs, auth requirement, and freshness semantics.
Password auth was five lines of client code and no hashing decisions —
`defineAuth` with `minimumLength: 8`, then `useAuth().signUpWithPassword`.
Assets were the biggest positive surprise: one `v.assetRef` field, one
`defineAssetUpload` with `delivery: 'public-immutable'`, and
`useSnapbackAssetImage` handed a URL straight into `<Image>`; the fixture
avatar rendered real bytes on the first try. And the diagnostics are
exceptional — `snapback errors issues` / `snapback errors issue <id>` gave
me a `TypeError`, the exact spliced-helper frame, and a telemetry query to
widen with, which turned what would have been a bisect into a 90-second fix.

**What fought me.** Three things, in descending cost.

1. *A live query declared `auth: 'optional-user'` never recovers from the
   anonymous → authenticated barrier.* Subscribed while anonymous, it is
   blanked at sign-in (`paused`, `connection: 'disconnected'`) and never
   resubscribed, so it reports `status: 'ready', data: [], freshness:
   'unknown'` forever. The familiar `useQuery` projection only yields data on
   `connection === 'live' && freshness === 'current'`, so the app could not
   see its own user row after signing in, silently, with no diagnostic in
   `useSnapbackDiagnostics()`. Declaring the same query `auth:
   'authenticated'` — which uses the documented `blocked` → fresh-instance
   path — fixed it instantly. That cost about 45 minutes.
2. *A module-init cycle in the published packages breaks under Metro.*
   `@expo/snapback-expo` enters at `app-binding.mjs` →
   `@expo/snapback-client/app-client` → `…/index.mjs`, which re-exports
   `DEFAULT_AUTH_STORAGE_PARTITION` back out of `app-client.mjs`; under
   Metro's CJS interop the app dies on a TDZ error before rendering.
   Importing `@expo/snapback-client` first in the entry works around it.
3. *The port pin cost me the supervised dev loop.* `snapback dev --expo`
   allocates Metro's port with `freeLoopbackPort()` and has no override, and
   this lane may only use 42180–42199. Owning the lifecycle myself was
   straightforward (`snapback start --port`, staged startup artifacts, an
   app-constructed loopback binding) but it also cost me the running-server
   provision, so every backend change now needs a restart — sessions mode
   refuses raw `snapback load`.

**What the familiar profile saved.** Real ergonomic savings: `schema.ts` and
`users.ts` read like ordinary TypeScript modules, `query`/`mutation` with
`args`/`returns`/`auth`/`handler` is a shape I did not have to look up twice,
`api.users.me` is one static reference, and `useQuery`/`useMutation` are the
two hooks I expected. The generated `api.d.ts` gives exact row types for free.

**What stayed Snapback-specific.** Quite a lot, and mostly for good reasons.
The handler runtime is a restricted VM: top-level `const`s are not spliceable
helpers (only function declarations are), and *dynamic computed access*
(`array[i]`) is refused outright, so every handler is written with `for…of`
and array methods. Result contracts are declared, not inferred, and a
mutation may not return `v.array(v.doc(...))` — familiar lowering only admits
a single document or a plain value there. `auth` is mandatory per function.
`ctx.db.uniqueMany` keys are index-shaped objects. None of these are hard,
but none of them are Convex either.

**Missing documentation or diagnostics.** The connection-axis failure above
is the big one: the guide's React page promises "its LLP 0059 participant
blanks the predecessor synchronously and starts a fresh protected query under
the settled successor", and for `optional-user` it does not, with no error
surfaced anywhere. Second, nothing in the familiar-profile page mentions the
inline-handler syntax restrictions; I found them by hitting
`SNAPBACK_INLINE_HELPER_SYNTAX_FORBIDDEN` and following the anchor. Third,
the guide's `_generated/` retirement note and the lane brief disagree on the
directory name; the product is right, and codegen refuses the old name
loudly, which is the correct way to disagree.

---

## M2 — Posts and the follow graph (green)

**What I built.** Six new tables — `follows`, `posts` (originals and replies in
one table), `postMedia` (bounded ordered children, one row per attachment),
`likes`, `reposts`, and `feedItems`. `feedItems` is the read model: one row per
feed-visible event (an original post, or a repost of one) with a strictly
increasing `seq`, which is what makes cursor pagination exact — 20 per page,
no duplicates, no gaps. `posts.ts` owns create/setLike/setRepost as idempotent
set-state intents; `social.ts` owns follow/unfollow and the profile
relationship read model; `feed.ts` owns the four read models (Global,
Following, thread, author). The client gained a real feed with infinite
scroll, a composer with image/video attachment, a thread screen, and a working
follow toggle. The replay adapter learned `follow`, `post`, `reply`, `like`
and `repost`, and reproduces the fixture pack's starter-m2 state exactly:
8 users, 12 follow edges, 28 posts (24 top-level + 4 replies), 10 media rows,
8 likes, 4 reposts — matching the invariant manifest on the nose.

**What felt easy.** Declaring the model was genuinely pleasant. Unique
compound indexes (`by_post_user`) turn "one like per user per post" into a
storage constraint rather than handler etiquette, and `.visibility({ kind:
'public-read' })` made the public-content decision explicit and greppable.
The composed result contract — a query returning a closed record with nested
`v.array(v.string())` for attachments — meant one live subscription per feed
instead of an N+1 fan-out from the client. `ctx.db.query(...).in('postId',
ids)` and `getMany`/`uniqueMany` gave me batched reads, and codegen's
`SNAPBACK_AUTHORING_N_PLUS_ONE_BATCH_READ` advisory found the two places I had
written a loop of point reads before I ever ran them.

**What fought me.** Two things, both mine rather than the platform's. First,
the handler runtime's ban on dynamic computed access means no `array[i]`
anywhere — every projection is `for…of` plus `find`/`filter`. It reads fine
but it is a real dialect. Second, the platform has no monotonic counter I can
use: `sequences` is a `defineJsMutation` key that the familiar profile's
constructor rejects, so `feedItems.seq` is derived by reading the current
maximum and taking `max(now, last + 1)`. That is correct under OCC (the read
is in the transaction's read set) but it is a per-app reinvention of something
the explicit profile ships.

**What the familiar profile saved.** The whole M2 backend is five ordinary
TypeScript modules with no builder ceremony, and `api.feed.globalPage` /
`api.posts.setLike` came out typed end to end — the client's `FeedEntry`
interface is just a restatement of the generated row type. Adding a table and
three functions cost one `snapback generate snapback`.

**What stayed Snapback-specific.** Result contracts must be declared and are
kind-partitioned: a query may return `v.array(v.doc(t))`, a mutation may not.
`reads`/`writes` are per-function declarations, not inferred. Assets are typed
references with a declared upload intent and delivery tier, and the
`public-immutable` choice is what makes a plain `<img>`/`<video>` work at all.

**Missing documentation or diagnostics.** Nothing serious this milestone. The
one thing I wanted and did not find: a short "familiar profile handler dialect"
list (no computed access, function-declaration helpers only, no `sequences`)
in one place. Every individual refusal was excellent — code, source span,
rule name, an admitted alternative, and a build-bound guide anchor — but I
learned the dialect by collecting refusals rather than by reading it.

---

## M3 — Messaging core (green)

**What I built.** The authorization model first: `chatMembers` is a
`.membership()` declaration with an `.authorityProfile()`, and
`conversations`, `messages`, `chatJoins` and `chatReadState` all derive their
table visibility from it — a non-member's ordinary read returns nothing before
any handler runs. `conversations.dedupeKey` is a unique index that makes "at
most one DM per user pair" a storage constraint (DMs key on the sorted user
pair; groups key on their own id, so two groups with identical membership stay
distinct). `chats.ts` owns DM/group creation through
`ctx.membership.chatAccess.bootstrap`, member add through the declared insert
transition, leave, and the delivery/read watermarks; `messages.ts` owns sends
and quoted replies with `extId` idempotency. Typing is a real ephemeral
collection — TTL 4 s, connection-keyed, scoped per conversation, with
`allow.members('chatAccess')` on both publish and subscribe, driven from
`useSnapbackActivityPresence`. The client gained the chat rail, the
conversation screen (bubbles, quoted excerpts with jump-to-original, receipt
ticks, typing indicator), new chat/new group, and chat settings with the
generated roster.

**What felt easy.** Ephemeral state was the standout: a dozen lines of schema
and one hook gave me a typing indicator that shows within ~320 ms and expires
~2.8 s after the last keystroke, with membership-scoped authorization inherited
from the durable declaration. No table, no expiry job, no cleanup cron —
exactly the "purpose-built primitive" the brief's rubric asks about. Membership
`bootstrap` creating the conversation, the creator's seat and the initial
roster in one atomic command is also genuinely good; I never had to write a
"create group then add creator then add members, hope nothing fails halfway"
sequence.

**What fought me.** The private-roster posture is the sharpest edge in the
product. Roster rows are invisible to ordinary handlers, so anything the
*server* needs to know about "who is in this conversation" has to come from
somewhere else. I needed join times for the brief's "recipient set is
membership at send time" rule, and `bootstrap` has no slot for incidental
values on the creator's seat — first `SNAPBACK_FIELD_MISSING`, then
`SNAPBACK_MEMBERSHIP_INSERT_FIELD_DENIED`, then a result-contract violation on
the *generated* `chatAccess.list` when I made the column optional. I landed on
a small app-owned `chatJoins` table for the product fact and left the roster as
pure authority — defensible, but it is the one place the model duplicates
something. The authority profile also dictates vocabulary: it requires a role
literally named `owner`, protected as the last holder, so Clique's creator is
an owner rather than "an admin", and the last owner must transfer ownership
before leaving. That is a documented deviation from the brief's "anyone can
leave".

The expensive bug was mine, and the platform surfaced it honestly: I patched
the read-state row on every delivered-ack even when the watermark did not
advance, and the chat list derives its unread count from that same row — a
self-sustaining write loop that starved live delivery until cross-client
messages stopped arriving inside 10 s. The choreography receipt pointed
straight at it.

**What the familiar profile saved.** Everything above is ordinary TypeScript:
`ctx.membership.chatAccess.bootstrap(...)`, `ctx.permissions.chatAccess
.requireRole(id, 'owner', 'admin')`, `ctx.db.query('messages').withIndex(
'by_convo_seq').eq(...).order('seq','desc')`. The generated `api.chatAccess.*`
namespace put roster reads and admin transitions on the same client surface as
my own functions.

**What stayed Snapback-specific.** All of the authority machinery: the closed
transition matrix, one generated membership command per mutation, the
`principalAddressedWrites`/`authorityProfile` incompatibility, and `requireRole`
being exact-role rather than hierarchical (`requireRole(id, 'admin')` refuses an
owner). Ephemeral collections and their `allow.members(...)` binding are also
unlike anything in a fetch-shaped backend.

**Missing documentation or diagnostics.** The membership/authority-profile
pages describe each construct well but never show a worked example of the case
every chat app hits: "I need a roster for display *and* an authorization store,
and the roster is private." I would have paid real money for a paragraph saying
"keep product facts about participants in your own table; the declaration is
authority only." Second, `useSnapbackActivityPresence` exposes `peers`, while
the underlying presence state exposes `entries`; I wrote `entries` from the
lower-level docs and got a silently empty indicator with no diagnostic. Third,
nothing warns that a mutation which writes a row a live query reads can loop —
the platform is fast enough that the loop looks like "delivery got slow" rather
than "you are writing in a cycle".

---

# Lane essay (verbatim)

# Building Clique on Snapback: a closing essay

*Written after M1–M3 were green and before any numbers were tallied.*

## The shape of the thing

Snapback is a complete application backend with a strong opinion about where
authority lives, and building a social messenger on it felt less like wiring a
database and more like *declaring a system* and then writing the small amount
of glue that a product needs on top. The unit of work is a `schema.ts` plus a
handful of top-level function modules; you run `snapback generate snapback`
and get a typed `api.*` namespace whose references carry, in JSDoc, the legal
client verbs, the auth requirement, the freshness semantics, and a
build-bound link to the guide page that explains them. The first time I
regenerated after adding a table and read `api.feed.globalPage`'s generated
comment telling me which hooks were legal for that reference kind, I thought:
this is what "the platform knows what it is" looks like.

The comparison everyone will want is Convex, because the familiar TypeScript
profile is explicitly modelled on that vocabulary — `query`/`mutation`/
`action`, `defineSchema`/`defineTable`/`v`, `ctx.db.query(...).withIndex(...)`,
`useQuery`/`useMutation`. If you have written a Convex app, you can write the
first 200 lines of a Snapback backend without opening a doc. That is a real
and deliberate achievement, and it is where most of my velocity on M1 and M2
came from. But the resemblance is a dialect, not a port, and the differences
are load-bearing.

## Where Snapback is genuinely ahead

**Authorization is declarative and fail-closed.** In Convex I would write
`messages` as an ordinary table and remember, in every single handler, to
check that the caller is a member of the conversation. Snapback lets me say it
once: `chatMembers` is a `.membership()` declaration, and `conversations`,
`messages` and the read-state table declare `visibility: { kind: 'membership',
declaration: 'chatAccess', ... }`. After that, an ordinary `ctx.db.query(
'messages')` from a non-member returns nothing — not because my handler
remembered, but because the read never had authority. The roster rows are
private to app code by design, and the transition matrix (`insert by admin
target other to member`, `remove by self target self`, and so on) is a closed
grammar that codegen validates. This is the single biggest architectural
difference from every other backend I know, Convex and Firebase included:
Firebase security rules are a separate language that drifts from your code;
Convex leaves it to handler discipline; Snapback puts it in the schema and
then refuses to let you write the roster any other way
(`SNAPBACK_MEMBERSHIP_RAW_WRITE_DENIED`).

**Ephemeral state is a first-class primitive.** WhatsApp-shaped typing
indicators are the classic "and now you build a table with a TTL and a cron to
sweep it" problem. In Snapback, `ephemeral.collection({ scope, key: 'connection',
ttlMs: 4_000, publish: allow.members('chatAccess'), subscribe:
allow.members('chatAccess'), value })` plus `useSnapbackActivityPresence` gave
me an indicator that appears in ~320 ms and withdraws ~2.8 s after the last
keystroke, authorized by the same durable membership declaration as the chat.
Convex has no equivalent; you build presence out of documents and scheduled
functions, and you pay for it in write volume forever.

**Assets are typed references with declared policy.** `avatar:
v.optional(v.assetRef({ upload: 'media.avatarUpload' }))` plus a
`defineAssetUpload` with `delivery: { kind: 'public-immutable' }` and
`image: { location: 'strip' }` is the whole media pipeline for a profile
picture: upload through the generated reference, attach with
`ctx.assets.attach` inside an ordinary mutation, render with
`useSnapbackAssetImage`. The delivery tier is a *policy decision made in
source*, and the guide is blunt that a plain `<img>` cannot send a bearer, so
strict delivery will leave you with empty image boxes. Convex file storage is
simpler but dumber: you get a storage id and a URL and you invent the policy.
S3-plus-signed-URLs is more flexible and vastly more ceremony. Snapback's
version is the one I would want by default.

**The diagnostics are the best I have used.** Not "good for a young product" —
best, full stop. `snapback errors issues` gave me a `TypeError`, the exact
spliced-helper stack frame, and a telemetry query to widen the window with,
turning a would-be bisection into a ninety-second fix. Codegen refusals carry
a stable code, a source span, the rule name, an admitted alternative, and a
build-bound `/_snapback/guide/...` anchor. `SNAPBACK_AUTHORING_N_PLUS_ONE_BATCH_READ`
found two loops of point reads I had written and told me to use
`ctx.db.uniqueMany` before I ever ran them. Convex's errors are fine; Firebase's
are famously not; Postgres tells you a constraint name and wishes you luck.
The bar Snapback sets here is the thing I would miss most going back.

**Documentation is served by the running binary, and it is version-exact.**
`snapback guide <query>` and `http://<origin>/_snapback/guide/...` return the
docs compiled into *that build*. No version-skew guessing, no Stack Overflow
answer from three majors ago. That is a structural advantage over every
backend I know.

## Where it fought me

**The familiar profile is a dialect with unadvertised grammar.** Inline
handlers refuse dynamic computed access — `array[i]` is a generation error —
and only same-file *function declarations* are spliceable helpers, so a
top-level `const HANDLE_RE = /.../` is a hard refusal. Result contracts are
kind-partitioned: a query may return `v.array(v.doc('posts'))`, a mutation may
not. `auth` is mandatory per function. None of this is hard once you know it;
all of it I learned by collecting refusals, because there is no one page that
says "here is the handler dialect". Coming from Convex, where a handler is
just TypeScript, this is the sharpest adjustment.

**The private roster is right, and it costs you.** Because roster rows are
invisible to ordinary handlers, anything the *server* needs to know about
participants must live somewhere else. I needed join timestamps for the
brief's "the recipient set is membership at send time" rule; `bootstrap` has no
slot for incidental values on the creator's seat, so I hit
`SNAPBACK_FIELD_MISSING`, then `SNAPBACK_MEMBERSHIP_INSERT_FIELD_DENIED`, then
a result-contract violation on the *generated* roster query when I made the
column optional — and landed on a small app-owned `chatJoins` table. The
authority profile also dictates vocabulary: it requires a role literally named
`owner`, protected as the last holder, which pushed Clique's "creator is an
admin, anyone can leave" into "creator is an owner who must transfer ownership
before leaving". Good architecture, real product friction.

**The reactive client's strictness is a footgun without a boundary.** The
familiar `useQuery` yields data only when `connection === 'live' && freshness
=== 'current'`, and *throws* for unclassified errors. That is a defensible
contract, but it means one transient error at an authority barrier unmounts
whatever tree the hook is in. It cost me a choreography segment before I moved
every screen onto the canonical `useQueryState`. Worse, I lost the better part
of an hour to a related sharp edge: a live query declared `auth: 'optional-user'`
and subscribed while anonymous is *blanked* at sign-in and never resubscribed —
it reports `status: 'ready', data: [], connection: 'disconnected'` forever,
with nothing in `useSnapbackDiagnostics()`. The same query declared
`auth: 'authenticated'` uses the documented `blocked` → fresh-instance path and
works. Convex's `useQuery` is famously boring here; boring is a feature.

**Deployment identity is strict in a way that punishes iteration.** A
sessions-mode database pins its deployment; changing a function bundle and
restarting refuses with `SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH`, and raw
`snapback load` is refused in sessions mode. The supported path is the
supervised `snapback dev` live reload — which I could not use, because it
allocates Metro's port with `freeLoopbackPort()` and this lane may only use a
pinned range. So every backend change during M3 cost a fresh database and a
re-seed. The refusal is *correct* — it is protecting me from a deployment
mismatch — but the ergonomics assume you are inside the supervised loop, and
the escape hatch has a sharp edge.

## What I would tell a team choosing a backend

If you are building something with real authorization structure — rooms,
memberships, per-resource roles — Snapback's declarative membership and
visibility are worth more than any amount of query-language nicety, and I
would pick it over Convex for that alone. If you need presence, typing, or
cursors, the ephemeral primitive is a category difference, not an increment.
If your team's instinct is "we'll enforce that in the handler", Snapback will
make you write it down instead, and you will be glad.

Against that: this is a young surface with an experimental profile, and you
will spend time learning what the handler VM refuses and what the roster will
not show you. The published packages have at least one real bundling defect
under Metro (a module cycle that dies on a TDZ error before the app renders),
and the reactive client has a live-query lifecycle hole at the anonymous →
authenticated barrier that silently returns empty data. Neither is
unfixable — both are the kind of thing that gets fixed once someone builds a
real app on it, which is exactly what this exercise was.

The honest summary: the parts of Snapback that are *designed* are better than
the equivalents in anything I have used. The parts that are still *settling* —
the familiar profile's edges, the dev-loop lifecycle outside the supervised
path, the client's authority transitions — are where the hours went.
