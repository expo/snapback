# Diary 0100: opus-clique-explicit — 0.1.24 model×profile×app matrix lane

**Date:** 2026-08-17/18
**Run:** model×profile×app matrix on published Snapback 0.1.24
(`benchmarks/runs/2026-08-17-model-profile-app-matrix/`)
**Lane:** `opus-clique-explicit` — Claude Opus 5 (claude CLI headless)
**App:** Clique (Expo Router web); Snapback explicit profile, published 0.1.24 from npm
**Outcome:** M1–M3 green
**Wall:** 27,282s · **Cost (approx., public list prices):** $135.19
- Output tokens: 387,583
- Cache reads 224,887,288; cache writes 1,304,956

This diary's build narrative and essay are the lane agent's own words, written
milestone-by-milestone during the timed build per the lane prompt; the
orchestrator added only this header. N=1 exploratory calibration evidence, not
scored or claim-eligible (LLP 0201 D5). Machine load was shared with
concurrent fleet work — per-lane loadavg samples are retained with the run
record. Three harness segments: one transient Anthropic API 500 interruption, resumed in the same session; wall is the sum of process segments.

# Clique run diary — lane opus-clique-explicit

## M1 — accounts and profiles (green)

**What I built.** An Expo Router web app on a Snapback backend authored in the
default explicit profile: `snapback/schema.mjs` declares one `users` table with
three structural constraints (unique `principal`, unique `handle`, public-read
visibility, public asset sharing) plus a `defineAuth` program pinning
email+password with an 8-character minimum; `snapback/functions.mjs` declares
five live queries, three JS mutations, and one asset-upload intent for avatars.
The client is an app shell (`app/_layout.tsx` + `src/app-frame.tsx`) that mounts
`SnapbackProvider` with a lane-constructed local AppBinding, gates on the
current principal, and renders a persistent header (the kit's `FeedTabs`) and a
conversation rail around a routed `<Slot/>`. Screens: auth (kit `AuthForm` plus
two lane-owned signup fields), profile view, profile edit (kit `ProfileForm`
verbatim), settings. The seed is `scripts/replay.mjs`: the fixture pack's
`starter-m1.log` replayed through the real signup path, real profile mutations,
and real avatar uploads — one ordinary password session per persona, no admin
token, no impersonation, no seeded principal ids. `npm run acceptance --
--milestone m1` installs the segment, runs six scripted tests through a real
browser and the app's own write path, validates the coverage map against the
instrument's `assertions.json`, and writes a JSON receipt that feeds the
choreography harness's `--suite-status`.

**What felt easy.** Three things, more than I expected. First, the declarative
constraint surface: "one profile per principal, one handle per profile" is two
`.index(..., { unique: true })` lines, and the refusal that comes back
(`SNAPBACK_UNIQUE_CONSTRAINT_VIOLATION`, or my own declared `HANDLE_TAKEN`
through `ctx.refuse`) is a typed code the UI branches on without parsing a
message. Second, `ctx.auth.userId` as the *only* identity selector: `myProfile`
and `updateProfile` take no user argument at all, so there is no forgeable
identity input to review. Third, live queries: I wrote `defineJsLiveQuery` and
the profile edit propagated to a second browser context with no subscription
code of my own — the M1 two-client choreography check passed on the first
attempt.

**What fought me.** The scaffolded template's auth custody. `expo-chat` ships
`custody: 'volatile-explicit'`, which resolves to *memory* auth custody; a full
page load lands back on the sign-in screen. That silently contradicts the
brief's "sessions persist across app restart" and cost a debugging cycle before
I read `app-client.mjs` and found `resolveCustody`. The fix is one word
(`durable-required`), but nothing in the template or the start packet said the
disposable posture would break reload restoration — the start packet mentions
custody as a native-durability claim, not as a web-persistence switch.

The second fight was port pinning. This lane may only bind 42160–42179, and
`snapback dev` (the paved loop) has no port flag: it scans 4287–4387 for the
backend and allocates an ephemeral port for its supervised Expo bootstrap
exchange. Owning the lifecycle myself (`snapback start --port`) meant learning
the cold startup-artifact carrier that sessions mode needs, and constructing the
AppBinding the supervisor would otherwise have minted. That is ~60 lines and it
works, but it is the one place where the product's happy path assumes it owns
the ports.

**What the explicit profile saved or cost.** Saved: the whole authorization
surface is greppable. `visibility({ kind: 'public-read' })` is a line I had to
write and can therefore be reviewed; `auth: 'authenticated'` is per-function and
codegen refuses to infer it. It also caught real mistakes at generation time
rather than runtime — a missing `writes:` declaration, a result contract that
did not match. Cost: verbosity. `createProfile` is 40 lines to express "insert
one row with five validated fields", and the inline-handler subset (no imports,
no captured top-level constants) meant re-inlining the handle regex in two
handlers. The generated `api.d.ts` gave me full argument and row types in the
client, which paid the verbosity back the moment I turned typechecking on and it
found a real bug I had already shipped to the browser.

**What documentation or diagnostic was missing.**
1. Custody-vs-reload, above: no page connects `volatile-explicit` to "web reload
   signs the user out".
2. The `SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH` refusal is otherwise excellent
   — it printed the pinned and observed deployments and two exact repairs — but
   its "move or delete the database file" repair under-specifies: the auth-mode
   pin survived deleting `dev.sqlite3*`, and only removing the whole `.snapback`
   store (keyrings included) reset it. The backup-and-copy page says a store is
   not one file; the refusal text should say so too.
3. There is no served endpoint that reports the *offered* capability set of a
   running target, so a hand-built AppBinding has to derive `capabilities.offered`
   from generated artifacts. I derive it from the descriptor's required set plus
   the client-lifecycle manifest's `targetCapability` entries, which is honest
   but is reverse-engineering a fact the server already knows.
4. One kit/harness tension worth recording against the *instrument*, not
   Snapback: the frozen choreography reads a post author's display name as the
   first non-empty line of `sm-profile`, while the frozen UI kit's `ProfileForm`
   view mode emits the avatar initials and the "Edit profile" button label before
   the name. I compose the profile header in the lane (kit `Avatar` + tokens) so
   both frozen artifacts can be satisfied at once; the kit's edit mode is used
   verbatim.

## M2 — posts and the follow graph (green)

**What I built.** Six new tables (`posts`, `postMedia`, `follows`, `likes`,
`reposts`, `timeline`) and ten new operations. The interesting one is
`timeline`: a feed read-model with one row per feed *entry*, so an original post
and a repost of it are two rows and both feeds are one ordered read over the
same table rather than a client-side merge of two sources. Following is
`timeline WHERE actorId IN (self ∪ followees)` — which is also where the brief's
"implicit self-follow" ruling lands naturally: `self` is in the projection
without a persisted edge, so no follower count moves. Feed hydration
(`hydrateEntries`) resolves a bounded page in four batch reads — `getMany` for
posts, `getMany` for users, one indexed `in()` for media, and `uniqueMany`
against the `by_post_user` unique indexes for the viewer's own like/repost
state — rather than a lookup per row. Client-side: the kit's `FeedCard` wired to
live queries, an inline `Composer` with browser file inputs for 1–4 images or
one video, a thread screen, and the profile follow toggle as an idempotent
set-state intent.

**What felt easy.** Ordering. `_version` is the commit version of the mutation
that inserted a row, monotonic across the whole database, so "server arrival
order" is literally `.order('_version', 'desc')` — no sequence table, no
timestamp-collision tiebreak, and it makes the replay contract's "log timestamps
are documentary" trivially true. The bounded batch reads were the other pleasant
surprise: `uniqueMany('likes', 'by_post_user', keys)` expresses "did the viewer
like each of these twenty posts" as one host call against a declared unique
index, and codegen even warns (`SNAPBACK_AUTHORING_N_PLUS_ONE_BATCH_READ`) if
you write the loop version instead.

**What fought me.** Two things, both client-side. `useSnapbackAssetUrl` throws
on an empty asset id, so a component that renders "the video if there is one"
cannot call it unconditionally; the fix is to split the video arm into its own
component so the hook is only ever mounted with a real id, which is correct
React but took a page-crash to discover — the thrown message is clear
(`issuedUrlStore requires a non-empty asset id`) but the hook's type signature
(`assetId: string`) is the only warning and it is easy to satisfy with `?? ''`.
The sibling hook `useSnapbackAssetImage` accepts `string | null`, so the two
have different nullability conventions.

The second was flake, not a defect: the M2 choreography's
`repost-following-feed-surface` check exhausted its three attempts on 10-second
locator timeouts, while the same navigation measured ~310 ms in isolation. An
unchanged re-run passed 7/7. Dev-mode Metro plus three concurrent browser
contexts is simply slower than the harness's fixed ordinary-observation timeout
under load. I recorded it as an environment retry rather than papering over it.

**What the explicit profile saved or cost.** Saved, decisively: the feed
read-model is a *declared* table with a unique `(postId, actorId)` index, so
"one repost entry per user per post" is a storage constraint rather than a
handler invariant I have to keep believing in. `refusals: [...]` plus
`ctx.refuse` gave the compose surface real error copy for `MEDIA_INVALID` and
`TEXT_TOO_LONG` without inventing an `{ok:false}` result shape. Cost: the inline
handler subset has no imports and no top-level constants, so shared logic has to
be same-file `function` declarations that codegen splices in. That works well
(my `hydrateEntries` is shared by four queries) but it is a rule you have to
know; a `const` arrow at module scope silently fails generation instead.
`v.union([v.literal(...)])` stored enums also paid for themselves — `kind` is a
literal union in the generated TypeScript, so the client's `entryKind ===
'repost'` branch is checked.

**What documentation or diagnostic was missing.** The asset-hook nullability
asymmetry above. Also: `defineAssetUpload` refuses at generation unless you
declare `image.location` *and* `video.location` when the accept list spans both
— which is a good, exact refusal
(`SNAPBACK_ASSET_INTENT_LOCATION_POLICY_REQUIRED` names both fields) — but the
assets page's examples only ever show one of the two, so the requirement is
discovered by refusal rather than by reading. Nothing about the feed model was
missing: the relational-queries page told me where its shipped join shapes stop
(no aggregation, no self-joins), which is exactly why I hand-built the read-model
instead of trying to force it.

## M3 — messaging core (green)

**What I built.** Conversations as membership-backed resources. The roster
(`conversationMembers`) is a `.membership(...)` declaration whose transition
matrix *is* the product rule set: the creator bootstraps as admin, an admin may
seat another principal as a member, an admin may promote a member, anyone may
leave, and only an admin may remove someone (a **total** other-removal
transition, `from` omitted, so a refusal can never read back a hidden role).
`conversations`, `messages`, `readState`, and the roster projection all bind
their table visibility to that declaration, so a non-member's ordinary read
returns nothing and `ctx.permissions.conversationMembers.requireRole(...)` turns
that into an explicit denial where a denial is the honest answer. DMs are one
channel per pair, enforced by a unique index on a canonical `pairKey`; two
groups with identical membership stay distinct because a group's key is its own
id. Messages carry an optional pointer to a quoted message in the same
conversation (validated server-side — an id from another row is not authority to
reach across the boundary). Receipts are per-member cursors (`deliveredThrough`
/ `readThrough` holding commit versions), and a message's aggregate state is
computed over the recipient set: current members who joined at or before the
send, minus the sender — so leavers drop out and later joiners never gate.
Typing is an ephemeral collection driven by `useSnapbackActivityPresence`, one
activity tick per keystroke with an idle deadline.

**What felt easy.** The membership declaration paid for itself within an hour.
"A non-admin cannot remove members" is not a handler check I wrote and could
forget; it is a transition the host evaluates, and the refusal
(`SNAPBACK_MEMBERSHIP_TRANSITION_DENIED`) arrives before the target is even
looked up. `bootstrap(resourceValues, initialMembers)` creating the
conversation, the creator's admin seat and the initial roster in one commit is
exactly the shape "create a group with these people" wants. And the receipt
model fell out of `_version`: a per-member cursor plus a comparison is the whole
implementation, with no row per message per member.

**What fought me.** The private-roster posture, twice. First, `bootstrap` seats
the creator itself and cannot set application columns, so a roster row cannot
carry required app fields — my first design had `userId` and `joinedAt` on the
seat and failed with `SNAPBACK_MEMBERSHIP_INSERT_FIELD_DENIED`, then
`SNAPBACK_FIELD_MISSING`. Both diagnostics were exact; the constraint just is
not stated anywhere I read before I hit it. Second, and more consequential: a
membership table cannot be the primary table of *any* ordinary query, including
an elevated one (`SNAPBACK_MEMBERSHIP_READ_PRIVATE`). So a handler cannot
enumerate the roster to compute an aggregate receipt or a member list. The
sanctioned answer is a maintained projection — an ordinary table written in the
same mutation as the membership command it mirrors — which the scoped-roles page
does describe, and which I now use. It is correct and I would keep it, but it
means the authority relation and its presentation copy must be kept in step by
hand, and the one place that is genuinely delicate is `removePrincipal`, whose
companion writes must be correct on *both* the present and absent branch.

Dropping the two unused required columns then hit
`SNAPBACK_SCHEMA_REQUIRED_FIELD_BACKFILL_REQUIRED` — correct behavior (that is
reviewed-migration territory) but a full dev reset in a milestone whose schema
was minutes old.

**What the explicit profile saved or cost.** This is where it earned the most.
The transition matrix, the visibility bindings, and the `principalAddressedWrites`
opt-in are all declarations a reviewer can read in one screen and a grader can
check without running anything; the equivalent hand-rolled checks would be
spread across eight mutations. The cost is that the declaration's own rules
(pendingRoles must be non-empty or absent, `fields` must enumerate incidental
columns, the bootstrap seat cannot carry app columns) are learned by refusal.

**What documentation or diagnostic was missing.** Three things.
`allow.members(declarationId)` — membership-scoped ephemeral rooms — is
implemented *after* the 0.1.24 closure this lane is pinned to, and the
room-permission alternative cannot be asserted through the ordinary provider
hook, so a typing room on this version is `allow.all()`. The guide says this
plainly, which is the honest outcome, but it does mean the one realtime surface
in M3 is not membership-scoped and I had to say so in the schema.
Second: `SNAPBACK_OUTBOX_AUTHORIZATION_SUSPENDED` (a write refused while the
durable outbox waits for authorization proof) is not visible through
`useSnapbackOutbox()`'s `blockedReason`, so an app cannot gate its send controls
on it — it can only catch the refusal after forming the intent. That asymmetry
cost me real time.
Third, and not Snapback's fault but worth recording: the host this ran on went
to a load average near 700 from other tenants during the final verification
pass, and at that point every 10-second UI budget in the frozen harness is a
coin flip. The three app fixes that came out of chasing it before I checked
`uptime` were real (memoized rows, debounced receipts, readiness-gated writes),
but the last stretch of flakes was the machine.

---

# Lane essay (verbatim)

# Building Clique on Snapback: a closing essay

*Written after M3 went green and before any numbers were tallied.*

## What this backend actually is

Snapback is not the shape I expected from the name. It is a local-first-adjacent
backend whose center of gravity is a **declared application contract** — schema,
functions, visibility, membership, asset intents, ephemeral rooms — that a code
generator turns into exact, hash-bound artifacts on both sides of the wire. You
do not write endpoints. You do not write a client SDK call and hope it matches.
You declare `defineJsLiveQuery({ args, auth, reads, result, handler })`, run
`snapback generate`, and the client gets a typed reference whose argument shape,
result shape, auth requirement, and *build identity* are all checked. If the
bundle is stale relative to the server, the call fails closed with
`SNAPBACK_ARTIFACT_IDENTITY_MISMATCH` rather than sending a plausible-looking
request into a schema that moved.

That is the single biggest difference from everything else I know, and it is
felt most in the boring middle of a build. In a Supabase or hand-rolled
Postgres+Express app, the gap between "the database changed" and "the client
knows" is a human discipline problem, patched with codegen you have to remember
to re-run and types you have to remember to trust. Here it is a refusal.

## Against Convex

Convex is the closest relative, and the comparison is the most interesting one.

Convex's `useQuery(api.messages.list, { channel })` is a reactive read that
"just works": the query function is TypeScript, it runs on the server, and
reactivity is derived from what it touched. Snapback splits that into two
explicit halves — a live query *declared* on the backend (`defineLiveQuery` or
`defineJsLiveQuery` with an explicit `reads:` list) and a subscribing hook on the
client. The result is the same live UI. The difference is where the honesty sits.
In Convex I have never once had to think about what a query reads; in Snapback I
had to write `reads: ['users', 'conversations', 'conversationSeats', 'messages',
'readState']` for my message list, and when I forgot a table, generation told me.
That felt like ceremony on day one and like documentation by the time the feed
read-model existed. When I later needed to know *why* the chats list re-ran on
every message anywhere, the answer was in the declaration, not in a profiler.

Convex wins on the middle of the authorization story. Convex functions are just
code: you read the session, you check membership, you return rows, and if you
want the roster you read the roster. Snapback's membership declaration is
strictly stronger where it applies — a non-admin removal is refused by a
transition matrix the host evaluates, and `conversations`/`messages` visibility
composes into *every* read plan including ordinary `ctx.db` — but it is also
walled: a membership table cannot be the primary table of any ordinary query,
even an elevated one. That is a deliberate privacy posture (a roster read is an
existence oracle) and I agree with it in principle, but it means an aggregate
receipt over "the members who were here when this was sent" needs a maintained
projection table that mirrors the authority relation. Convex would have let me
write the four-line join and move on; Snapback made me build the read model and,
in exchange, made the authority relation unreadable by accident. On a messaging
app I think Snapback's trade is right. On a weekend project I would resent it.

Convex also wins on the day-one loop: `npx convex dev` and you are writing
functions. Snapback's `snapback dev` is comparable *if* you let it own the
ports; the moment I had to pin ports myself, I had to learn the cold
startup-artifact carrier that sessions mode requires and hand-build the
AppBinding the supervisor would otherwise have minted. That is about sixty lines
and an hour, and it is the sharpest edge I hit in setup.

## Against Supabase

Supabase's answer to everything I built here is SQL plus RLS. The follow graph,
the feed, the conversation membership — all of it is expressible, and the feed
would be one view with an index. What Supabase does not give me, and what I
leaned on constantly, is a *typed contract between the write and the read*.
Snapback's `results.records(v.object({...}))` is validated pre-egress; a handler
that returns the wrong shape fails the mutation atomically rather than shipping a
malformed row to a client that will crash three screens later. In Supabase that
check is a Zod schema someone wrote and someone else forgot to update.

RLS versus `.visibility({ kind: 'membership', ... })` is close to a wash on
expressiveness for this app and not close on legibility. An RLS policy is SQL in
a migration; the Snapback declaration sits on the table next to the fields it
governs and the compiler carries it into every generated plan. But RLS has ten
years of answers for the hard cases, and Snapback has explicit "this is
foreclosed in v1" walls — multi-hop authorization is undeclarable, and you are
told to denormalize or repeat the check in every named function. I hit that wall
in exactly the place the docs predicted.

Realtime is the reverse comparison. Supabase Realtime is a change feed you
subscribe to and then reconcile by hand; Presence and Broadcast are separate
primitives with separate semantics. Snapback gives one mechanism —
a declared live query for durable state, a declared ephemeral collection for
presence — and the typing indicator was genuinely fifteen minutes:
`useSnapbackActivityPresence(app.api.ephemeral.typing, { scope, value, idleMs })`
with a `touch()` per keystroke, and expiry falls out of the lease. Nothing about
"remember to unsubscribe", nothing about a `typing_state` table with a cleanup
job. That is the single most pleasant thing in the whole run.

## Against Firebase

Firebase would have given me the feed and the chats list faster than anything
else here, and would have made every other requirement worse. Security rules are
the closest thing to Snapback's visibility declarations, and they are a
famously bad place to express "an admin may remove a member unless they are the
last admin". Snapback's `lastHolder: { protect: 'admin' }` is a line. Firestore's
answer to the aggregate receipt is a fan-out write per recipient per message and
a Cloud Function to keep it honest; Snapback's is a per-member cursor and a
comparison, because commit versions are a real, ordered, server-owned thing I
can store. And the offline story is the inverse of what the marketing suggests:
Firebase's offline cache is easy and its guarantees are vague, while Snapback
publishes exactly which store retains what, refuses to retain a protected query
without a lease, and — this bit me — refuses a write while the durable outbox is
still proving authority, with a typed code instead of a silent stall.

## Against hand-rolled Postgres + Express

This is the honest baseline, and the one I would reach for if the requirements
list said "and it must run in five years". Everything in Clique is expressible in
about the same volume of code: tables, indexes, a feed query, a membership check
middleware, a WebSocket fan-out. The differences are all about what you get for
free versus what you must remember.

Snapback gave me, without asking: exact server-derived identity in every handler
(`ctx.auth.userId`, with no code path that accepts a user id as an argument),
argon2id password auth at published parameters, structural uniqueness as a
declaration, bounded batch reads that turn twenty point-lookups into one host
call, a live query that re-runs on the tables it declared, an asset pipeline
where "upload an avatar" is an intent plus one `ctx.assets.attach` line, and a
diagnostic vocabulary that names the rule and the fix. Hand-rolled Postgres gives
you none of those and every one of them is a decision you will get slightly
wrong at least once.

What hand-rolled Postgres gives you is the absence of walls. No "this is
foreclosed in v1". No "that capability lands after the closure you are pinned
to". No inline-handler subset where a top-level `const` arrow silently fails
generation while a same-file `function` declaration is spliced in. Three times in
this run I designed something reasonable, hit a wall, read the wall's own error,
and redesigned — the roster's app columns, the roster read, the schema change
that needed a reviewed migration. Each redesign made the app better. Each also
cost twenty to forty minutes I would not have spent with a `CREATE TABLE`.

## The thing I did not expect

The error messages are a feature, and I do not say that lightly. When I restarted
the server on a changed carrier, the refusal printed the pinned deployment, the
observed deployment, *and* two exact repairs — one that keeps data and one that
discards it — plus a line telling me not to hand-edit hashes to make the pin
match. When I declared an asset intent accepting both images and video, the
refusal named both `image.location` and `video.location` as the fields I had
omitted. When my query tried to read the roster, the refusal explained the
posture rather than just denying. I have used backends where the error is
`23505` and backends where it is `FirebaseError: Missing or insufficient
permissions`. This is a different category, and it is why three of my four hard
redesigns took under half an hour.

The counterweight: the good errors are at the boundary, and the boundary is
enormous. Where Snapback is silent, it is very silent — the template's
`custody: 'volatile-explicit'` quietly means "web reload signs the user out",
and nothing said so until I read the client source. For an agent-first product
whose documentation is explicitly budgeted, the gap between "this page tells you
everything" and "this fact lives only in `app-client.mjs`" is the thing I would
most want closed.

## Would I build the next one here

For this app — a messaging product with real authorization, live reads, presence,
media, and a scale envelope someone will eventually measure — yes, and not
narrowly. The declarations I wrote are the specification: someone can read
`schema.mjs` and know who can read a message, who can remove a member, and what
a handle is, without running the app. That is worth the walls.

For a prototype I want live in a weekend, I would still use Convex, because the
distance from "idea" to "reactive UI" is shorter and nothing is foreclosed while
I am still deciding what the product is. Snapback is the backend I would want the
second time I built something, when I already know the rules and want them
enforced rather than remembered.
