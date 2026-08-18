# Diary 0098: grok-coterie-explicit — 0.1.24 model×profile×app matrix lane

**Date:** 2026-08-17/18
**Run:** model×profile×app matrix on published Snapback 0.1.24
(`benchmarks/runs/2026-08-17-model-profile-app-matrix/`)
**Lane:** `grok-coterie-explicit` — Grok 4.6 (grok CLI, xhigh)
**App:** Coterie (Exact/Contract web); Snapback explicit profile, published 0.1.24 from npm
**Outcome:** M1–M3 green
**Wall:** 7,664s · **Cost (approx., public list prices):** $57.06
- Output tokens: 263,396
- Fresh input 1,902,089; cache reads 103,359,360; reasoning 226,853

This diary's build narrative and essay are the lane agent's own words, written
milestone-by-milestone during the timed build per the lane prompt; the
orchestrator added only this header. N=1 exploratory calibration evidence, not
scored or claim-eligible (LLP 0201 D5). Machine load was shared with
concurrent fleet work — per-lane loadavg samples are retained with the run
record. 

# Coterie diary

Lane `grok-coterie-explicit`. Exact/Contract client, Snapback 0.1.24 explicit.
Milestones M1–M3 only.

## M1 — accounts and profiles

### What I built
Auth screens on `/` (`sm-auth-*`), profile and edit routes, settings, durable
browser sessions, avatar delivery, and a write-path that replays
`starter-m1.log` through `createSnapbackAppClient`. Acceptance is
`npm run acceptance -- --milestone mN`.

### What felt easy
Contract layout for a sign-in form and a profile header is small. The
instrument IDs map 1:1 onto `testId`. Snapback password signup/sign-in, once
the app client exists, is a short happy path. Generated Exact bindings from
one `ProviderNativeDeclaration` compiled without drama after the first
declaration pass.

### What fought me

**Exact/Contract.** Query cells for a single session row arrive as arrays, so
`current.signedIn` was undefined and the auth form never dismissed after a
200. Hyphenated view attributes (`data-count`) failed compile. Vite under bun
crashed on WebSocket upgrade (`upgrade requires a Request object`); Node was
the workaround.

**Snapback.** The published package is `@expo/snapback-*@0.1.24`, not
`snapback@0.1.24`. Raw `SnapbackClient` fails handshake; custody
`durable-required` refuses a memory platform; `snapback load` refuses a
sessions v1 seed unless you pass startup artifacts plus
`SNAPBACK_PACKAGED_STORE_QUALIFICATION_RECEIPT`. Vite `/__snapback` 403'd
password routes until the allowlist was patched. Avatar upload is
`app.api.assets.avatarUpload`, not a top-level `api.avatarUpload`.

### Missing documentation / diagnostics
The Guide explains custody grades but not the matrix of (Node replay vs
browser) × (memory vs IndexedDB) × (volatile-explicit vs durable-required).
The Vite plugin does not say that password POST routes are omitted from the
0.1.24 allowlist. Exact does not say that a ready query of one object is
`[row]`.

## M2 — posts and the follow graph

### What I built
Global/following/user feeds, compose, follow, like, repost, threads, feed
tabs on home plus profile/thread (tabs navigate home), optimistic bag
updates, and a 400ms query refresh because live projection was not enough.

### What felt easy
Feed card structure and `sm-*` IDs. Write-path mutations for posts/follows
once unwrap-of-`{rows}` existed. Suite data assertions were straightforward
against Snapback queries.

### What fought me

**Exact/Contract.** HMR mid-choreography blanked `ExactRenderer` with
`Missing exact.dispatch`. Feed tabs authored only on home failed checks that
open a profile or thread and still expect the tab strip. Contract views
cannot reach around the provider, so a stale bag is a blank feed with no
local escape hatch.

**Snapback.** `createPost` returned 200 while the live handle did not project
the new row into the Contract bag. Stream transport through the Vite relay
was not trustworthy; poll + query refresh + optimistic writes became the
real delivery path. Refresh that skipped a smaller incoming array hid
unfollow.

### Missing documentation / diagnostics
No worked example of "live query attached through `@expo/snapback-vite` that
actually ticks a Contract `query` cell after a mutation from another client."
No warning that HMR invalidates the Exact protocol flush. No recommended
shape for composing following-feed from posts + follows + reposts on the
client — I had to own that in the provider.

## M3 — messaging

### What I built
DM reuse, groups, message list, quoted reply + jump, conversation settings
entry, typing indicator (`sm-convo-typing`), write-path replay of starter
messaging, and a capture-phase composer bridge so Playwright
`pressSequentially` publishes `setTypingMark`.

### What felt easy
Message bubbles, quote preview IDs, and DM reuse via `pairKey` were ordinary
CRUD once memberships existed. Suite assertions (reuse, two groups, quote
storage, non-admin refuse, jump) went green without a long fight. Live DM
text through the existing poll/optimistic path was already in budget.

### What fought me

**Exact/Contract.** `input change=setDraft` does not see
`pressSequentially`. The web host snaps a controlled input back to the last
rendered `value` after an `input` event. A `pure` helper with no args
(`readConvoInput`) is treated as constant, so a mount `every(200)` poll of
the DOM never observed keystrokes. `keydown=pingTyping` does not fire for
Playwright `insertText`. The working fix is a document capture listener in
the provider, not a better action.

**Snapback.** Generated `app.mjs` does not export `typing`.
`subscribeEphemeral(api.typing)` throws `collection reference ... undefined`.
The real ref is `app.api.ephemeral.typing`. Using `lastPreview === '…'` as a
typing signal never expires unless a later mutation clears it. Durable
`typingUntil` on the conversation row, refreshed on the 400ms query tick, is
what made the 2s/5s window honest.

### Missing documentation / diagnostics
Exact's input page never mentions Playwright, `pressSequentially`, or the
controlled snap-back on the direct web host. Snapback codegen does not
document that ephemeral collections are missing from the `app.mjs` barrel
that every other operation uses. There is no example of a two-client typing
indicator that satisfies a 2s appear / 5s expire ceiling through the Vite
relay.

---

# Lane essay (verbatim)

# Building Coterie on Exact/Contract and Snapback

I have spent years shipping product on React, React Native, Expo Router, and
the usual web stacks around them: Next, Vite, TanStack Query, Firebase,
Supabase, Convex, and hand-rolled Node APIs. Coterie was the first time I had
to deliver a production-shaped social messenger where the client was not
allowed to be a React tree I authored, and the backend was not allowed to be
an in-memory fake. That constraint is the whole story.

## The client is a language, not a library

Exact Contract is closer to a small UI language with a typechecker than to
React-with-rules. You declare state, derives, actions, tasks, and a view of
built-in tags. The compiler owns write discipline. You do not reach for
`useEffect`. You do not stash a feed in component state because a mutation
returned it. You do not sprinkle `data-` attributes until Playwright is happy:
the contract IDs are the product surface, and hyphenated attribute names can
fail compilation for reasons that have nothing to do with HTML.

That is genuinely nicer than React in the ways React is usually sloppy. A
React screen accumulates three sources of truth without noticing: hook state,
query cache, and whatever the last event handler closed over. Contract makes
that embarrassing. The paved path — `value=` plus `change=` on an input, a
`query` cell with loading/ready/empty, a mutation that invalidates through the
provider — is the same shape every time. When I stayed on that path, the UI
was small and the tests could see it.

The cost is that the language is thinner than the problem. A React Native
composer can listen to `onChangeText`, `onKeyPress`, and a native event in
the same afternoon. Contract's `change` lowers to `onChangeText`, and the web
host then treats the field as fully controlled: it publishes the new text and
snaps the DOM back to the last rendered `value`. Playwright `fill()` survives
that, because it writes the whole string and fires one input event. Playwright
`pressSequentially()` does not, because it is trying to be a person typing.
In React I would have patched the input, or used an uncontrolled field, or
read the DOM in a ref. In Contract there is no uncontrolled field, and a
zero-argument helper marked `pure` is a cached constant. The workaround that
finally worked was not a better action. It was a capture-phase listener in
the provider, which is an admission that the authoring model does not yet
cover the thing the frozen choreography actually does.

React-family stacks fail differently. They let you ship the workaround in the
view. Contract forces the workaround under the provider seam or into a helper
the compiler barely trusts. That is good for architecture essays and bad for
a timed two-client typing check.

The renderer still sits on React and React DOM. You feel that whenever HMR
blanks `exact.dispatch` and the screen dies in the middle of a choreography
run. You are not writing React, but you are living in its hot-reload physics
plus an extra protocol flush. Expo Router, for all its file-route magic, at
least fails in a vocabulary I already have. Exact's blank screen is a new
kind of silence.

## The backend seam is stricter than the backends I know

Snapback in the explicit profile wants to be Convex's cousin: schema in one
file, functions in another, generated clients, live queries, auth as a
principal, assets as first-class refs. The Guide served by the running binary
is the right idea. A backend that can explain itself over HTTP is better than
a README that drifts.

What I actually used was narrower. Password signup and sign-in work once you
discover that the public npm name is `@expo/snapback-*`, that a raw
`SnapbackClient` is the wrong object, that durable custody requires IndexedDB
even in a Node replay, and that `snapback load` will not ingest a sessions
table without a packaged-store qualification receipt and startup artifacts.
None of that is hard after the first time. All of it is tribal. Firebase
would have given me an error in the console and a Stack Overflow hit. Convex
would have given me a dashboard. Snapback gave me diagnostic codes with long
names and a Guide that assumes you already know which document you need.

Live delivery is the place I wanted Snapback to win. A social messenger is
exactly the product live queries are for. In practice, stream transport
through the Vite relay was not something I could bet a milestone on. The
honest path became: mutate, write an optimistic bag, poll the same queries
again on an interval, publish into Contract. That is closer to a well-behaved
TanStack Query app than to the live system on the box. Ephemeral collections
exist, and typing is the obvious use, but the generated `app.mjs` barrel does
not export the collection the way it exports mutations. `api.typing` is
undefined. `app.api.ephemeral.typing` is the real handle. The Guide talks
about ephemeral state. It does not say which symbol the Vite app is supposed
to import after codegen.

Auth custody is more serious than I expected, in a good way. Durable-required
means a relaunch still has a session, which is what the M1 choreography asks
for. It also means a Node write-path without IndexedDB is not a client. I
have implemented "remember me" on every stack I have used. I have rarely been
prevented from lying about it. Snapback prevented the lie.

## Compared to the stacks I would have reached for

If this were an Expo Router app with Convex, I would have written screens in
React Native, used the instrument UI kit or a cheap copy of it, subscribed to
queries in the view, and let Playwright talk to web through react-native-web
or a dedicated web build. The failure mode would have been styling and
navigation, not "the input event did not become state." If this were Next and
Supabase, I would have been fighting RLS and realtime slots instead of
handler admission and startup artifacts. Both of those fights are documented
in public, by people who are not me.

Exact plus Snapback is trying to make the undocumented fights compile-time
errors. Sometimes it does. Duplicate handles, missing `mutates` clauses,
hyphenated view attributes, and write-set mismatches died in the compiler
instead of in production. That is the part I would take back to a React team.
The part I would not take back is the feeling that the last mile of a
browser-driven test is always one host event away from being invisible.

I left M3 believing the architecture is real: one provider declaration, one
generated binding module, one Snapback app, no view-layer fetches. I also
left believing the authoring profile is not yet as complete as the instrument
it is being asked to satisfy. The frozen choreography types like a person.
The paved Contract input types like a controlled React field that has already
committed. Closing that gap is not a product feature. It is the difference
between a green typing indicator and a two-second timeout.
