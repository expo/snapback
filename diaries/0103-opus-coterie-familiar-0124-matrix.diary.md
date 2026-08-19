# Diary 0103: opus-coterie-familiar — 0.1.24 model×profile×app matrix lane

**Date:** 2026-08-17/18
**Run:** model×profile×app matrix on published Snapback 0.1.24
(`benchmarks/runs/2026-08-17-model-profile-app-matrix/`)
**Lane:** `opus-coterie-familiar` — Claude Opus 5 (claude CLI headless)
**App:** Coterie (Exact/Contract web); Snapback familiar (snapback-familiar-ts-v1) profile, published 0.1.24 from npm
**Outcome:** M1–M3 green
**Wall:** 8,283s · **Cost (approx., public list prices):** $84.9
- Output tokens: 333,058
- Cache reads 138,944,629; cache writes 709,558

This diary's build narrative and essay are the lane agent's own words, written
milestone-by-milestone during the timed build per the lane prompt; the
orchestrator added only this header. N=1 exploratory calibration evidence, not
scored or claim-eligible (LLP 0201 D5). Machine load was shared with
concurrent fleet work — per-lane loadavg samples are retained with the run
record. 

# Coterie build diary — lane opus-coterie-familiar

Client: Exact/Contract (checkout `exact-pinned`, commit `4046cafc`).
Backend: Snapback 0.1.24 from the public npm registry, familiar TypeScript
authoring profile (`snapback-familiar-ts-v1`).

> Authoring note: the M1 and M2 sections below were written at the M3 boundary
> from the run log rather than at each boundary as they happened. The content is
> the log's, not reconstruction from memory, but the timestamps on the entries
> are the log's, not the diary's.

---

## M1 — Accounts and profiles

**What I built.** The whole vertical stack, because M1 is where all of it has
to exist for the first time: a Snapback familiar backend (`snapback/schema.ts`
in sessions mode with an email/password auth program, `accounts.ts`,
`social.ts`, `chats.ts`, `media.ts` asset intents), one
`ProviderNativeDeclaration` (`src/data/declaration.ts`) with nine live queries
and nineteen mutations, the generated binding surface from Exact's
`provider-generate`, a `ContractDataProvider` implemented directly over
`SnapbackClient` + `AuthCoordinator`, a Contract app shell with the frozen
`sm-*` identifiers, and a replay adapter that drives the fixture action logs
through the provider seam itself. Plus the acceptance entrypoint, its coverage
manifest validation against the instrument's `assertions.json`, and the
choreography wiring.

**What felt easy.**

*Exact/Contract.* The provider seam is genuinely well-shaped. Writing one
declaration and running one generator produced the manifest, the binding
module, the metadata sidecar, row types, conformance fixtures and reference
docs, and `configureFromProvider` fails closed on a digest mismatch — I never
once debugged "which module is stale". The indent grammar is fast to write and
the `async <query>` region with `loading`/`error`/`empty`/`ready` slots removes
the entire class of loading-boolean bugs; I never wrote a spinner flag. The
`writes`/`mutates` clauses caught two real mistakes at compile time. The
route-registry generator plus a hand-copied `exact.links.json`/postinstall
symlink pattern brought the whole framework up without an npm release.

*Snapback.* The familiar profile is exactly as advertised: `schema.ts`, one
module per namespace, `query`/`mutation` constructors with `args`/`returns`/
`auth`/`reads`/`writes`. Codegen diagnostics are the best I have seen from a
backend — every refusal named the rule, an admitted alternative, and a
build-bound guide anchor. Password signup/sign-in through `AuthCoordinator`
worked on the first try, and public-immutable asset delivery meant an uploaded
fixture avatar rendered in an `<img>` with no signing dance.

**What fought me.**

*Snapback.* Three things, in order of pain. (1) A headless client that pairs a
memory auth custody with the client's default *durable* process store fails
every signup/sign-in with `SNAPBACK_AUTH_TRANSITION_FAILED` /
`SNAPBACK_OUTBOX_AUTHORITY_TRANSITION_STALE`, because the fresh custody
restarts the authority epoch while `~/.snapback/rqs` still holds the previous
process's successor. Nothing pairs custody durability with store durability in
the Guide; I found it by reading `outbox-shared.mjs`. (2) The familiar
`generated/server` does not re-export `defineAuth`, so a sessions-mode familiar
schema cannot declare its auth program from the familiar surface alone — I had
to import it from `@expo/snapback-codegen/define`. (3) `snapback dev` has no
port flag and scans 4287-4387, which is outside this lane's pinned range; I
reproduced its managed sequence with an explicit port in
`scripts/backend.mjs`.

*Exact.* One real defect: if a declaration names a mutation's result shape
`CreatePostResult` — the obvious name — the generator emits both that interface
and its own `${Pascal}Result` alias, and the generated binding module fails to
parse. No validation issue is raised; it surfaces only as a Vite parse error.

**What documentation or diagnostic was missing.** The custody/store pairing
above. And the Snapback Guide's familiar page does not mention that the profile
cannot reach `defineAuth`, which is the first thing a sessions app needs.

---

## M2 — Posts and the follow graph

**What I built.** Two-tab feeds with the implicit self-follow rule, compose
with image/video file inputs, likes and reposts as idempotent set-state
intents, replies with an inline thread, keyset-free `limit`-growth pagination,
and profile screens with live follower/following counts. Twelve suite tests
covering all 22 suite-required M2 assertions.

**What felt easy.**

*Exact/Contract.* Composition. `FeedCard` takes an item and three curried
callbacks and is reused verbatim by the feed and the thread; adding
`onOpenThread` as an optional prop let the same component be a link on one
route and a button on another with a two-line `when/else`. Live updates
"just worked" — every cross-client check in the choreography passed the first
time the underlying wiring was right, with 100-500 ms visibility.

*Snapback.* Live queries. My feed handler is a straightforward read over
`posts`/`reposts`/`follows`, and the moment a follow edge changed, every
subscribed client's feed re-projected. I never wrote an invalidation rule; the
declared `reads` list is the whole story.

**What fought me.**

*Exact/Contract.* This is where the interaction between route navigation and
the frozen harness cost me the most time, and it was my design, not Exact's
bug. Feed tabs as route links meant the harness's "click the tab, then
immediately fill the composer" pattern raced a route remount and cleared the
draft; the per-post Reply link had the same shape and posted a top-level post
instead of a reply. Both are honest fragility in a link-navigation UI: the fix
was to keep the tab and the thread as component state on the feed route and
keep links only for cross-route jumps.

A second Exact defect: the `scroll` tag lowers with `flex: 1 1 0%`, so its
authored `height=` is ignored by flex main-sizing and the region grows with
content instead of scrolling. `flex=0` does not help (basis stays 0). A fixed
scroll region needs `column height=N overflow="scroll"`.

*Snapback.* Two lifecycle traps. Minting a fresh `connectionId` per live
subscription opens one connection per route mount and a long-lived client
eventually exhausts the server's budget (later subscribes 409 and never
deliver); the fix is one stable connection id per provider so the stream
manager multiplexes. And wiping the dev database mints a new activation, which
changes the content-hashed `app.binding.<sha>.mjs` filename that the browser
bundle pins — with the Vite root not watching the backend directory, every
query then fails `SNAPBACK_ARTIFACT_IDENTITY_MISMATCH` with no hint that the
*client* is what went stale.

**What documentation or diagnostic was missing.** A note in the Exact
built-in-tags table that `scroll`'s height cannot bound it. On the Snapback
side, the connection-budget consequence of per-subscription connection ids, and
a client-side diagnostic that says "your bundle pins activation X, the server
serves Y — rebuild the client" instead of a bare identity mismatch.

---

## M3 — Messaging core

**What I built.** DMs with one channel per pair, groups as entities with
admin/member roles and a full-history join, live messages, quoted replies with
a jump-to-original, typing indicators inside the 2 s/5 s ceilings, and
monotonic sent/delivered/read receipts aggregated over membership at send time.

**What felt easy.**

*Exact/Contract.* The conversation screen is about 150 lines and reads like the
spec. Interpolated `testId`s gave me a stable per-message anchor for the
quoted-excerpt jump without inventing a parallel id scheme.

*Snapback.* Receipt aggregation is just a query over `members` and `readState`;
because the query declares those reads, a recipient marking read pushes the
sender's tick change with no extra plumbing. Typing worked on a plain table
once I moved expiry off the server.

**What fought me.**

*Snapback.* Three real ones. (1) A query handler may not call
`ctx.runtime.now()` when its result is protected
(`SNAPBACK_AUTH_CLOCK_DEPENDENT_VISIBILITY`), so server-side typing expiry
cannot live inside the live query at all; the sender's client owns the idle
clear. That is a genuine capability gap for any time-windowed presence, and the
familiar profile has no ephemeral-state constructor to fall back on. (2) An
undeclared `ctx.refuse(code)` degrades to the opaque `SNAPBACK_HANDLER_FAILED`;
the `refusals: [...]` requirement is documented only on the mutations page and
nothing warns you that a raised code is undeclared. (3) With the durable outbox
on (the browser default), any background write in flight makes the *next*
foreground mutation fail with `SNAPBACK_OUTBOX_AUTHORIZATION_SUSPENDED` rather
than waiting — my provider's read-receipt write made every second message in a
conversation fail. I disabled the outbox (no offline claim at M1-M3) and added
a bounded retry.

*Exact/Contract.* Nothing new. A `task ... when [dep]` firing a mutation on
every delivery was my own write-loop, not a framework surprise.

**What documentation or diagnostic was missing.** The clock-dependent-visibility
rule is not on the queries page where an author looks for it. And the outbox
suspension has no author-facing guidance at all: the code is real, the
condition is transient, and nothing tells you whether to retry, acknowledge, or
turn the outbox off.

---

# Lane essay (verbatim)

# Building a social messenger on Exact/Contract and Snapback

*A qualitative comparison with React-family stacks and the backends I know,
written after M1–M3 of Coterie went green and before any numbers were tallied.*

## The shape of the day

I have built this app's shape before — auth, a feed, a follow graph, chat — on
React plus a hosted document backend, and on React Native plus a REST/GraphQL
API. The distinguishing feature of doing it on Exact and Snapback was how much
of the day went into *seams* rather than into *screens*. In a React + Firebase
or React + Supabase build, the first hour produces a rendering list and the
rest of the day is spent on the long tail of state synchronization: which
component owns the subscription, what happens on unmount, how optimistic
updates get reconciled, why a stale closure captured last render's user id.
Here almost none of that existed. The whole "how does data reach the view"
question was answered once, by one declaration file and one generator, and then
it stayed answered. What replaced it was a different tax: learning where each
framework's authority boundaries are, and paying for crossing them.

## Contract versus React

The honest headline is that Contract removed a category of bug I have stopped
noticing in React because I have internalized working around it. `async todos`
with `loading` / `error` / `empty` / `ready` slots is not sugar over
`isLoading && ...`; it is the compiler refusing to let me render a state I did
not author. I did not write a single loading boolean in this app, and I never
hit a flash-of-empty-state. Similarly, `action foo writes a, b` is a dataflow
signature that the compiler checks — twice it caught me assigning to state I
had not declared, in edits where React would have happily let me mutate a ref
and produce a silent no-render. `each ... key=` being mandatory is the same
idea applied to lists.

The indentation grammar is a smaller deal than it looks. After twenty minutes
it reads like a well-formatted JSX tree with the noise removed; the primary
argument sugar (`text "Coffee"`, `button "Post" press=submit`) is genuinely
nicer than `<Text>Coffee</Text>`. The place it costs you is refactoring: moving
a block one level in or out is a whitespace edit that no formatter I had would
do for me, and I broke my own view tree twice with a scripted reindent. In JSX
the braces make that mechanical.

What I missed from React was less than I expected, and it was not hooks. It was
*escape hatches*. Twice I wanted something the expression grammar deliberately
does not have — a computed member access, a small imperative DOM effect — and
the answer is "put it in a TS module and declare a `.contract-meta.ts`
sidecar". That is the right architecture; it is also three files and a
generator run to do what a React component does inline. For the scroll-to-quoted
-message jump I ended up with a `scrollToMessage(id)` helper marked `opaque()`,
which is exactly the honest label, but it does make you feel the wall.

The single worst hour of the build was not Contract's fault but was made worse
by it: my feed tabs and my per-post Reply were route links, and the frozen test
harness clicks a control and then immediately types into a field. A route
change remounts the route component and its state, so the draft vanished
between the click and the submit. In React with a client router I would have
hit the same race — but I would have found it faster, because the mental model
of "this component unmounted" is one I check reflexively. Here I spent a long
time suspecting the data layer, because Contract had trained me to assume state
just persists. The fix — keep the tab and the thread as component state on one
route and use links only for genuine cross-route jumps — is also the better UI.

The generated provider surface is the part I would take to any stack. One
declaration produced the manifest, the callable bindings the `.contract` files
import, the metadata sidecar, row types, conformance fixtures and reference
docs, all byte-deterministic, and `configureFromProvider` refuses to wire a
provider whose manifest digest disagrees with the generated bindings. Compare
that with the usual React reality of a hand-maintained `api.ts` drifting from
the server. Two real generator bugs bit me — a name collision between a
declared result shape and the generated `${Name}Result` alias, and a multi-line
type spelling emitted inside a single-quoted string, which silently degraded
*every* binding to an opaque import — and both surfaced as parse errors far
from their cause. But the failure mode of a generated seam is a bad generation;
the failure mode of a hand-written seam is a bad Tuesday six weeks later.

## Snapback versus the backends I know

Snapback's familiar profile is deliberately Convex-shaped, and if you have
written Convex the muscle memory transfers within minutes: `defineSchema`,
`defineTable`, `v.*`, `query`/`mutation` with `args`/`returns`/`handler`,
`ctx.db.query(...).withIndex(...)`. The additions are all in the direction of
being *more* explicit than Convex: every function declares `auth`, `reads`,
`writes`, and — the one I underrated — `refusals`. Compared with Firebase
security rules or hand-rolled Express middleware, having the read set and write
set as declared, checked facts next to the handler is a real improvement; it is
also what makes live invalidation free. I wrote zero invalidation logic in this
app. A follow edge lands and every subscribed feed re-projects.

The diagnostics are the best I have used from a backend, full stop. Codegen
refusals name the rule, an admitted alternative, and a build-bound guide anchor
you can actually open. When I put a `v.assetRef()` inside an array, the message
told me the ruling, the reason, and the bounded-children pattern to use
instead. When I imported a helper into a handler, it told me imports cannot be
spliced into the runtime module and that same-file function declarations are
admitted. That is a level of authoring support I have never gotten from a SQL
migration tool or a Firestore rules deploy.

Where it hurt was the client, not the server. Three of my four worst debugging
sessions were the client's lifecycle machinery, and all three were invisible in
the Guide. Pairing a memory auth custody with the default durable process store
makes every signup fail with an authority-transition error, because the fresh
custody restarts the epoch while the on-disk outbox holds a newer one — I found
that by reading `outbox-shared.mjs`, which is not where an app author should
be. Minting a connection id per subscription silently exhausts a connection
budget after enough route mounts, and the symptom is a subscription that
establishes and then simply never delivers. And with the durable outbox on, a
background write in flight makes the *next* foreground write fail with
`SNAPBACK_OUTBOX_AUTHORIZATION_SUSPENDED` instead of waiting for it — my
read-receipt write made every second chat message fail, and the message
("foreground mutation waits for authorization proof") tells you the mechanism
but not what to do. Compared with Firebase's client, which papers over almost
everything and occasionally lies to you, Snapback's client is honest and
strict; the cost is that its invariants are load-bearing for correctness and
mostly undocumented.

One capability gap is worth naming because it changed my design: a query
handler may not read the clock when its result is protected. That is a sound
rule — clock-dependent visibility is a real hazard — but it means server-side
expiry of anything time-windowed cannot live inside a live query, and the
familiar profile has no ephemeral-state constructor to fall back on. My typing
indicator ended up sender-cleared with a client timer, which meets the brief's
2 s/5 s ceilings but is weaker than a server-authoritative presence TTL. On
Convex I would have used a scheduled function; on Firebase, `onDisconnect`.

## What I would tell the next person

Three things. First, the two seams — the provider declaration and the backend
function surface — are worth building before any screen, and both frameworks
reward that order; my whole M1 was seam work and M3 took a quarter of the time
because of it. Second, treat live subscriptions and auth custody as *one*
lifecycle with one owner; every serious bug I hit was two owners disagreeing
about a generation, an epoch, or a connection. Third, the frozen-harness
lesson generalizes past this benchmark: a UI that changes routes in response to
a control click is racing anything that scripts it, and the fix — state on one
route, links only for real navigation — makes the app better, not just more
testable.

Would I choose this stack again for this app? For the data layer, without
hesitation: declared reads, free live invalidation, and a machine-checked
client seam removed more work than they added, and the codegen diagnostics
taught me the system as I went. For the client, yes with a caveat: Contract
made the UI smaller and safer than the React version I would have written, and
the two generator bugs I hit are the kind that get fixed once. The thing I
would want before shipping this for real is a written contract for the
Snapback client's lifecycle invariants — custody, store, connection, outbox —
because right now they are learnable only by reading the client's source or by
having your second message in a conversation fail.
