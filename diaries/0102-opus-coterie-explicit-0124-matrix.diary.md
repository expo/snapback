# Diary 0102: opus-coterie-explicit — 0.1.24 model×profile×app matrix lane

**Date:** 2026-08-17/18
**Run:** model×profile×app matrix on published Snapback 0.1.24
(`benchmarks/runs/2026-08-17-model-profile-app-matrix/`)
**Lane:** `opus-coterie-explicit` — Claude Opus 5 (claude CLI headless)
**App:** Coterie (Exact/Contract web); Snapback explicit profile, published 0.1.24 from npm
**Outcome:** M1–M3 green
**Wall:** 13,504s · **Cost (approx., public list prices):** $115.56
- Output tokens: 365,823
- Cache reads 196,448,163; cache writes 819,118

This diary's build narrative and essay are the lane agent's own words, written
milestone-by-milestone during the timed build per the lane prompt; the
orchestrator added only this header. N=1 exploratory calibration evidence, not
scored or claim-eligible (LLP 0201 D5). Machine load was shared with
concurrent fleet work — per-lane loadavg samples are retained with the run
record. 

# Coterie build diary — lane opus-coterie-explicit

Exact/Contract client, Snapback 0.1.24 explicit-profile backend.

## M1 — accounts and profiles

### What I built

- A Snapback backend in the explicit authoring profile: `snapback/schema.mjs`
  (sessions mode, `defineAuth` password mechanism with `minimumLength: 8`),
  `snapback/functions.mjs` (declared-refusal JS live query, callable query,
  and mutations plus two `defineAssetUpload` intents), `snapback/seed.json`,
  and a `codegen.policy.json` with no `authoringProfile` key.
- One `ProviderNativeDeclaration` (`src/data/coterie.declaration.ts`) with two
  queries (`session`, `profiles`) and five mutations (`signUp`, `signIn`,
  `signOut`, `saveProfile`, `setAvatar`), generated into the manifest, binding
  module, contract-meta sidecar, row types, conformance fixtures, and docs by
  Exact's own `provider-generate` devtools script.
- `CoterieSnapbackProvider`, a hand-written `ContractDataProvider` over the
  Snapback headless client: refcounted live sources, a session cell projected
  from the auth facade plus the profile feed, asset upload behind
  `setAvatar`, and a translation table that maps Snapback platform codes and
  declared `appCode` refusals onto the declaration's own error names.
- Four Contract routes (`/`, `/settings`, `/profile/[handle]`,
  `/profile/edit`) and two shared components, carrying the frozen `sm-*`
  identifiers.
- A starter-log replay tool that drives the app's own provider mutations, a
  backend/web lifecycle pair that records every PID it starts, and the
  `npm run acceptance -- --milestone mN` entrypoint with a coverage manifest
  validated against the instrument's `assertions.json`.

### What felt easy

**Exact / Contract.** The scaffold is reproducible from its own source: with
no `exact` binary in the checkout, `packages/exact-cli/src/scaffold.rs` reads
as a complete, honest inventory of what a project needs, and hand-porting it
took minutes. The provider seam is genuinely the paved path — one declaration
file, one generator invocation, and `configureFromProvider` fails closed on a
digest mismatch, which is exactly the check you want at that boundary. The
indent grammar is fast to write once you accept that `view` takes one root,
and `testId` being a first-class attr on every tag meant the frozen contract
IDs dropped straight in. The compiler's LLP 0278 warning ("this action mutates
a table no query in the file reads, so its UI effect cannot be observed") is
the single best diagnostic I hit all milestone: it is a design review in a
compiler message.

**Snapback.** `snapback new --template todo-contract` plus the served Guide is
a strong bring-up path: I had a working schema/functions/codegen loop in one
pass, and `snapback generate` fails closed with file/line diagnostics rather
than at runtime. Declared refusals (`refusals: [...]` + `ctx.refuse`) gave me
a stable application error vocabulary that survives the seam translation
without ever leaking a `SNAPBACK_*` code upward. Password auth is real
argon2id with a declared lockout — nothing to hand-roll, which is exactly what
the brief's M1 grader item wants.

### What fought me

**Exact / Contract.** Two things. First, a real generator defect: a mutation
parameter declared as a field-bearing object makes `generate.ts` emit a
multi-line inline TS type *inside a single-quoted string* in the
`.contract-meta.ts` sidecar — invalid TypeScript. Mutation params use
`tsTypeFor` where every other emitter site in the same function uses the
flattening `contractMetaTypeSpelling`. Declaring the picked-file param as an
empty object dodges it. Second, my own error, but the runtime made it easy to
make: I hydrated a form's state from a query inside a `task ... when [dep]`,
which raced the harness typing into the same fields. The fix — derive an
untouched field straight from the live cell and only keep a `draft` override —
is obvious in hindsight and is what `derive` is for; a guide note on
"initialize a form from a live query" would have saved the round trip.

**Snapback.** The one hard blocker: `@expo/snapback-vite@0.1.24`'s
`/__snapback` relay allowlist has no `/auth/password/*` or `/auth/recovery/*`
entries, so *no* browser app can sign up or sign in with the 0.1.21+ password
credential class through the paved Vite relay — including the CLI's own
`snapback new --template react` starter, whose documented journey is exactly
`auth.signUpWithPassword` / `auth.signInWithPassword`. The browser gets a 403
`SNAPBACK_DEV_PROXY_ROUTE_REFUSED`. I worked around it with a lane-owned Vite
middleware that forwards exactly those five routes under the same explicit
method+path posture, marked `enforce: 'pre'` so it is installed ahead of
`snapbackDev`'s own middleware. Secondary friction: in Node the client's
default retained-query store is a *file* store keyed by origin under
`$HOME/.snapback/rqs`, so two personas in one process fight over its
single-writer lock and the second one fails with
`SNAPBACK_OUTBOX_AUTHORITY_TRANSITION_STALE` — a confusing symptom for a
storage-isolation cause.

### What documentation or diagnostic was missing

- Snapback: nothing in the Guide's Contract-adapter or browser-auth pages
  warns that the relay allowlist trails the auth feature set. The refusal
  names the relay but not the missing route, and there is no supported way to
  extend the allowlist through `snapbackDev` options.
- Snapback: the multi-client-in-one-process store collision deserves a line in
  `clients/headless.md` next to `clientStoreId`; `clientStoreId` reads like it
  isolates everything, and it does not isolate the default RQS resolution.
- Exact: `data/bring-your-own-backend.md` teaches `subscribe`/`mutate` but not
  the shape a real adapter converges on — refcounted sources shared by several
  bindings, and what to do with in-flight subscriptions when the principal
  changes. I had to derive the fence-and-re-establish rule from the Snapback
  page instead.
- Exact: no guide page covers "bind a form to a live query"; the resources
  page's `state`-plus-`task` idiom is the one that races.

## M2 — posts and the follow graph

### What I built

- Six more Snapback tables (`follows`, `posts`, `postMedia`, `likes`,
  `reposts`, plus denormalized follower/following counters on `profiles`),
  a `listFeed` live query that serves both tabs and the profile timeline from
  one bounded, indexed read, a `listThread` live query, and idempotent
  set-state mutations for follow/like/repost plus a replay-keyed `createPost`.
- Three more declaration queries (`feed`, `thread`, `following`) and four more
  mutations, all generated into the same binding module.
- The feed surfaces: compose with a media picker, the two tabs promoted into
  the app shell, a `FeedItem` component carrying the frozen post-action IDs
  with their counts in the control text, link segmentation without unfurling,
  image/video rendering, and a thread route.
- Nine acceptance cases covering all 22 suite-required M2 assertions, and the
  M2 replay verbs (`follow`, `post`, `reply`, `like`, `repost`) so the starter
  segment installs through the app's own write path.

### What felt easy

**Exact / Contract.** Composition paid off immediately: one `FeedItem`
component with four props serves the home feed, the profile timeline, and the
thread, and the `sm-*` identifiers live in exactly one place. `each ... key=`
plus a pure `decorateFeed` helper in TypeScript is a genuinely good split —
the join between feed rows and the live profile list is ordinary testable
code, and the `.contract-meta.ts` sidecar makes the compiler check member
reads against the declared shape. Adding a route stayed a one-file operation.
The declaration → generate → implement loop absorbed four new mutations
without a single hand-edit to generated code.

**Snapback.** The query builder is the strongest part of the backend. `.in()`
over a bounded author set is exactly the right primitive for a following feed:
the probe user's 500 follows fit inside its documented 500-operand ceiling, so
the same code path that serves eight seeded personas is the one that would
serve the scale fixture. `.take()` bounds every read, `refusals` +
`ctx.refuse` gave each validation rule a stable client-facing name, and
`ctx.runtime.now()` removed the last reason for a client to send a timestamp.
Declaring `reads`/`writes` per function meant live invalidation was automatic:
I never wrote a single "refetch after mutate" line.

### What fought me

**Exact / Contract.** Two layout facts cost real time. `height=` on a
`scroll` did not bound the ScrollView — the container grew to its content, so
it never scrolled and `scrollend` never fired, which silently broke
scroll-driven pagination; `maxHeight=` bounds it correctly. And
`link href="/?tab=global"` navigated *without* the query string, so the tab
selection arrived empty; `navigate({ to, search })` carries it. Neither is
documented, and both fail quietly rather than at compile time — the compiler
happily accepted the attrs.

**Snapback.** The expensive one: my provider minted a fresh `connectionId` per
live subscription, so every tab switch opened a new authenticated connection
and the app eventually rendered `SNAPBACK_AUTH_THROTTLED: authentication
request rate limit exceeded`. That is correct server behavior and my bug — but
the failure surfaced three layers away, as a two-client harness timing out on
a button, and there is no client-side warning when an app opens its Nth
connection in a minute. The headless-client page says the manager multiplexes
consumers sharing a connection id; it does not say what happens if you do not
share one. Secondary friction: `inline_handler_v1` refuses *all* dynamic
computed member access, so every `arr[i]` loop and every object-as-map has to
be rewritten as `find`/`map`/`filter`/`for..of`. The diagnostic is precise and
the rewrite is usually better code, but the rule is not visible until codegen
rejects the file.

### What documentation or diagnostic was missing

- The frozen instrument treats `sm-feed-tab-*` as app-shell navigation — it
  clicks a feed tab while the browser sits on `/profile/{handle}`. Nothing in
  `CONTRACT.md` says the tabs must be reachable from every screen; I inferred
  it from a failure trace. Worth stating in the contract.
- Snapback: a connection-budget diagnostic (or a dev-mode warning at the Nth
  connection open) would have turned a three-hour hunt into a one-line fix.
- Exact: `styling/layout-and-style.md` needs a line on bounding a `scroll`
  (`height` vs `maxHeight`) and on which navigation spellings carry search
  params.
- Exact: nothing warns that an unbounded `scrollend` handler is a feedback
  loop; I added the "stop growing when the page came back short" guard myself.

## M3 — messaging core

### What I built

- Conversations, members, messages, and typing beacons in Snapback: a
  canonical sorted-pair `dmKey` as the uniqueness carrier for "at most one DM
  per pair", per-member monotonic receipt watermarks (O(members), not
  O(messages × members)), server-side admin authority for add/remove/promote,
  and a server-authored typing horizon so a client can start a beacon but
  never choose how long it lasts.
- Four more declaration queries and six more mutations.
- The messaging UI: a chat list on the home shell with unread indicators, a
  conversation route with quoted replies (a pressable excerpt that jumps to
  its original), the typing indicator, and per-message aggregate receipts, plus
  a chat-settings route for the roster.
- Five acceptance cases covering the seven suite-required M3 assertions,
  including a seed-idempotency case that replays every installed starter
  segment a second time through the app's own write path and compares six
  observable invariants before and after.

### What felt easy

**Exact / Contract.** The messaging screen is where `derive` earned its keep:
`bubbles(history, profiles, members, viewerId)` is one pure function that
computes sender names, quote excerpts, and the aggregate receipt state, and
the view is a flat `each` over its result. `task clock mount` plus
`every(400, tick)` and `now()` gave me a reactive clock for typing expiry with
no timer bookkeeping. And the M3 choreography segment passed on the very first
run — typing within 2 s, expiry within 5 s, live DM, and the optional
quoted-excerpt jump — which says the primitives are well matched to the
problem.

**Snapback.** Modelling receipts as per-member watermarks instead of
per-message rows worked cleanly because live queries invalidate on the tables
they declare: patching one `members` row re-delivers every reader's aggregate.
Declared refusals again gave the UI a stable vocabulary — the non-admin
removal test asserts on the app's own visible refusal, not on a status code.

### What fought me

**Exact / Contract.** Mostly my own live-query discipline: several suite cases
read a list immediately after the route mounted and got the pre-delivery empty
state. That is correct behavior (the first frame is `loading`), but it is easy
to write a test that races it, and the `async` region's `loading` arm is not
visible to a DOM query that only looks for row nodes. A "wait for first
delivery" affordance — even a documented `data-*` attribute on the async
region — would make live UIs much easier to drive.

**Snapback.** Two load-shaped failures, both mine, both diagnosed only from
the app's rendered error text. `SNAPBACK_CLIENT_AUTHORITY_STALE` on signup:
my provider opened a live subscription while the client was still anonymous,
racing the entry transition that was about to replace the authority. Gating
every source on an authenticated principal fixed it — but nothing in the seam
documentation says "do not subscribe before the authority settles," and the
error surfaces on the *signup call*, not on the subscription that caused it.
`SNAPBACK_OUTBOX_AUTHORIZATION_SUSPENDED` on a foreground mutation is the same
class: the diagnostic is precise about the state and silent about which
retry policy is safe. I settled on a bounded retry for the three refusals that
commit nothing, which is right, but I had to reason it out from first
principles rather than read it.

### What documentation or diagnostic was missing

- Snapback: a short "provider lifecycle" note — when it is safe to open
  subscriptions relative to the auth barrier, and which refusal codes are
  safe to retry — would have prevented both M3 flakes. The diagnostics name
  the invariant; they do not name the remedy.
- Snapback: `clients/headless.md` should say what a client that opens many
  short-lived connections will experience (throttling) and what the intended
  connection budget is.
- Exact: the `async` region has no observable "has delivered at least once"
  marker for external drivers. Every live-UI test in this lane had to
  synthesize one (I used an app-authored debug node).
- Instrument: `sm-chats-item` must live on the app root for
  `openConversationFromAnySurface` to work, and `sm-feed-tab-*` must be
  reachable from every screen. Both are load-bearing and neither is in
  `CONTRACT.md`.

---

# Lane essay (verbatim)

# Building Coterie on Exact/Contract and Snapback

*Written after M3, before any numbers were tallied.*

## The shape of the thing I built

Coterie is a social messenger: accounts, profiles, a follow graph with two
feed projections, likes, reposts, replies, DMs, groups, quoted replies, typing
indicators, and receipts. On a React-family stack I would have reached for
Next.js or Expo Router with React Query over a REST or tRPC backend, or
Convex with `useQuery`. Here the client is Contract — an indent-grammar UI
language with no JSX, no hooks, no components-as-functions — and the backend
is Snapback, a server-authoritative store with declarative live queries and
JavaScript handlers that run in a restricted VM. Between them sits a seam I
had to author myself: one `ProviderNativeDeclaration` describing every query
and mutation the UI may perform, from which Exact generates the binding module
the `.contract` files import, and one `ContractDataProvider` implementation
that makes those bindings talk to Snapback.

That seam is the most interesting thing about this stack, so let me start
there.

## The provider seam is the best idea here

In every React app I have built, the boundary between "UI" and "data" is a
convention. It lives in a `hooks/` directory, or in the discipline of only
importing `api` from one place, and it erodes the first time someone needs a
number in a hurry. Exact makes that boundary a build artifact. I wrote one
declaration file; a generator produced a typed binding module, a metadata
sidecar, row types, conformance fixtures, and documentation; and
`configureFromProvider` refuses at boot if the provider's manifest digest does
not match the generated surface. My `.contract` routes cannot reach Snapback
even if I want them to — there is no import path that gets there.

The payoff showed up when Snapback's realtime layer started throttling me. The
symptom was a two-client harness timing out on a button; the cause was my
provider minting a fresh connection id per subscription. Because *every*
backend interaction in the app funnels through one class, the fix was four
lines in one file, and I could be certain nothing else in the app opened a
connection. On a React codebase of the same size I would have had to grep for
every `useQuery`, every ad-hoc `fetch`, every effect that "just needed one more
thing," and I would not have been certain afterwards.

The comparison that keeps coming to mind is Convex. Convex's `useQuery` is
lovely and reactive and about ten times faster to get started with — you write
a server function and call it from a component and it is live. What Convex
does not give you is a place where somebody has written down what the UI is
allowed to do. Exact's declaration is exactly that document, and it is
machine-checked. The cost is real: to add "post has a video" I edited a
declaration, ran a generator, extended a provider switch, and *then* wrote the
view. Four steps where Convex has one. For a weekend project that ratio is
absurd. For an application with a compliance story, several clients, or a
backend that might be replaced, it is the ratio you want, and I would rather
pay it than reconstruct the same boundary from convention later.

## Contract versus React

I expected to resent Contract and mostly did not. The parts that work:

**Derives are better than `useMemo`.** `derive cards = decorateFeed(entries,
everyone)` is a dependency-tracked computed with no dependency array to get
wrong. Half the bugs I have shipped in React are stale closures and missing
deps; that entire category does not exist here. The related rule — state may
only be written inside an `action`, and an action must declare what it writes —
is the kind of constraint that feels bureaucratic for ten minutes and then
starts catching things. The compiler diagnostic I liked most all week is LLP
0278's: *"this action mutates a table that no query in this file reads, so the
mutation's UI effect cannot be observed."* That is a design review, delivered
by a compiler, about a mistake React cannot even represent.

**One route is one file, and the registry is generated.** No `<Route>` tree, no
router config drifting from the filesystem. Adding the thread screen was
creating one file and listing it in a profile array.

**Pure TypeScript helpers with a declared sidecar** are a genuinely good split.
The join between feed rows and the live profile list — the thing that makes an
author's rename appear instantly in every feed item — is an ordinary function I
could unit-test, and the `.contract-meta.ts` sidecar lets the compiler check
member reads against its declared shape. In React that logic would have been
inline JSX and untestable.

The parts that fought me were almost all *silence*. `height=` on a scroll
container did not bound it, so the container never scrolled and my
scroll-driven pagination never fired — no error, just a feature that quietly
did not exist until I measured `clientHeight` in a probe. `link href="/?tab=global"`
navigated without the query string; `navigate({ to, search })` carried it. Both
compiled. In React these would also be runtime behaviors, but React has a
decade of Stack Overflow between me and them; Contract has a guide that does
not yet cover them. The compiler is strict about the things it models
(`writes` lists, `each` keys, expression purity) and mute about layout and
navigation semantics, which is where I actually lost time.

The other real gap: there is no way to observe "this live binding has
delivered at least once" from outside the app. The `async` region renders a
`loading` arm, but a test driving the DOM sees "no rows yet" and "no rows,
final" as the same thing. I ended up rendering a debug node with the tab,
window size, and row count into the page, and half of my acceptance-suite
fixes were "wait for that node to say what you expect before you read the
list." A framework whose whole premise is live data should ship a first-class
marker for this.

## Snapback versus the backends I know

Snapback sits somewhere between Convex and a hand-rolled Postgres service, and
its distinguishing move is that it refuses more than it accommodates.

The refusals I came to like: `inline_handler_v1` rejects all dynamic computed
member access, so `arr[i]` loops and objects-as-maps are simply not
expressible in a handler. My first draft of the feed query was full of them;
the rewrite into `find`/`filter`/`map` is better code, and the diagnostics
carried file, line, and column. Asset intents refuse to generate until you
declare a location-metadata policy — you cannot accidentally ship an image
pipeline that keeps GPS coordinates. Declared refusals (`refusals: [...]` plus
`ctx.refuse`) give the client a stable vocabulary that survives translation
across the provider seam, so my UI branches on `DuplicateHandleError`, not on
a parsed message. And `ctx.runtime.now()` removes the last excuse for a client
to send a timestamp, which is exactly the property the brief's window-enforcement
rules need.

The query builder is the strongest piece. `.withIndex().in(field, values)` with
a documented 500-operand ceiling is precisely the primitive a following-feed
wants: the same code path that serves eight seeded personas is the one that
would serve the benchmark's 500-follow probe user, and `.take()` makes every
read bounded by construction. Declaring `reads`/`writes` per function means
live invalidation is automatic — across three milestones I never once wrote
"refetch after mutate." That is the single largest ergonomic win over a REST
backend and it matches Convex's best trick.

Where it hurt: the failure modes are correct and their remedies are
undocumented. I hit `SNAPBACK_AUTH_THROTTLED` because I opened a connection per
subscription; `SNAPBACK_CLIENT_AUTHORITY_STALE` because I subscribed while the
client was still anonymous and raced the sign-in transition;
`SNAPBACK_OUTBOX_AUTHORIZATION_SUSPENDED` because a foreground mutation fired
during an authorization barrier. Every one of those codes names the invariant
it is protecting. None of them names what an adapter author should do instead,
and the guide's provider pages do not state a connection budget or a
subscribe-after-settle rule. I derived both from failure traces. A page called
"writing a provider: lifecycle and retry" would have saved me most of the
debugging in this run.

The other friction was environmental rather than architectural: the shipped
Vite plugin's relay allowlist has no `/auth/password/*` routes, so the
password credential class — which the CLI's own React starter documents as its
sign-in journey — cannot reach the server through the paved browser path. I
wrote a five-route middleware to fill the gap. That is a packaging lag, not a
design flaw, but it is the kind of thing that makes a first day feel like
fighting the tool.

## What I would tell someone choosing this stack

Choose it when the boundary matters. If you have one client, one backend, and a
deadline, Convex plus React will get you to the same feature set faster and you
will not miss the declaration. If you have two clients, or a backend you might
swap, or a benchmark harness that must drive your app through a frozen
contract, then having the UI's data surface be a *generated artifact* rather
than a habit is worth the extra step per feature. In three milestones I changed
the backend's schema six times and the declaration five, and not once did I
wonder whether some view was still reaching around the seam. That certainty is
the product.

The honest caveat is that both halves are pre-1.0 in the ways that cost time
rather than correctness. The compilers and servers are strict and truthful; the
docs and packaging trail the features by a release or two. I hit one genuine
generator defect (a mutation parameter typed as an object emits invalid
TypeScript in the metadata sidecar) and one genuine packaging gap (the auth
relay), and I worked around both in under an hour each. Everything else that
went wrong in this run was mine — and, notably, the platform surfaced almost
all of it as a named refusal rather than as corrupted data.
