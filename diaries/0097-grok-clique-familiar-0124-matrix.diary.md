# Diary 0097: grok-clique-familiar — 0.1.24 model×profile×app matrix lane

**Date:** 2026-08-17/18
**Run:** model×profile×app matrix on published Snapback 0.1.24
(`benchmarks/runs/2026-08-17-model-profile-app-matrix/`)
**Lane:** `grok-clique-familiar` — Grok 4.6 (grok CLI, xhigh)
**App:** Clique (Expo Router web); Snapback familiar (snapback-familiar-ts-v1) profile, published 0.1.24 from npm
**Outcome:** M1–M3 green
**Wall:** 19,346s · **Cost (approx., public list prices):** $35.49
- Output tokens: 188,471
- Fresh input 1,309,601; cache reads 63,472,896; reasoning 157,095

This diary's build narrative and essay are the lane agent's own words, written
milestone-by-milestone during the timed build per the lane prompt; the
orchestrator added only this header. N=1 exploratory calibration evidence, not
scored or claim-eligible (LLP 0201 D5). Machine load was shared with
concurrent fleet work — per-lane loadavg samples are retained with the run
record. Overlapped the heaviest concurrent machine load of the run (see loadavg samples); one mid-run session compaction.

# Clique familiar-profile diary

## M1 — accounts and profiles

**Built.** Sessions-mode Snapback 0.1.24 familiar TypeScript (`schema.ts`,
`profiles.ts`, `media.ts`, `snapback/generated/`, React familiar hooks).
Email/password auth, unique handles, profile edit, avatar upload via
`ctx.assets.attach`, Expo Router web UI on the frozen kit, starter-m1 replay
through the app write path, and `npm run acceptance -- --milestone m1`.

**Easy.** Familiar `query`/`mutation`/`useQuery`/`useMutation` felt like
Convex. The kit already carried every M1 test ID. Once the client actually
booted, live profile text crossed two browsers in a few hundred milliseconds.

**Fought.** Almost everything before the first AuthForm paint.

- Published 0.1.24 retired `_generated/` for `snapback/generated/`.
- Familiar scanners rejected module-level regex helpers, `identities[i]`,
  and live queries that returned a scalar doc; they want arrays.
- `defineAuth` is not on `generated/server`; it lives on
  `@expo/snapback-codegen/define`.
- `snapback load` cannot install sessions. `snapback dev` wants 4287–4387,
  outside the lane pin, so the backend is raw `snapback start` plus a
  handmade `{formatVersion:1, schema, functions}` carrier.
- Default `v.assetRef()` authorizers failed to compile; avatar needed an
  explicit `defineAssetUpload`. Writes then failed with
  `SNAPBACK_ASSET_REF_UNVERIFIED` until `ctx.assets.attach`.
- Expo `--localhost` binds `[::1]` only. Choreography must use
  `http://localhost:42102`, not `127.0.0.1`.
- `SnapbackExpoProvider`'s `binding=` prop is not a delivery seam. The
  default environment only fetches a `snapback dev --expo` exchange and
  boots with `SNAPBACK_APP_BINDING_UNAVAILABLE`. A custom
  `SnapbackExpoEnvironmentV1` that resolves a loopback supervised-dev
  binding with `delivery.channel = local-supervised-ipc` and
  `resolveSupervisedAuthority → unavailable` is what actually starts
  first-party web bootstrap.
- First choreography miss: the edit form saved before `profiles.me`
  hydrated, so handle was empty. Second: after logout the harness signs
  back in on `/settings`, which has no feed tabs.

**Familiar saved.** Constructor shape, hooks, and generated `api.mjs`
references. Headless `createSnapbackAppClient` plus the same binding
worked for replay and the suite without the Expo supervisor.

**Still Snapback-specific.** Sessions startup carrier, asset attach,
binding admission, live-array result rule, and the Expo environment
facade. Convex would have been `npx convex dev` and a URL.

**Missing docs/diagnostics.** No start-packet path for “port-pinned
`snapback start` + Expo web, no supervisor.” The provider error tells
you to run `snapback dev --expo` even when `binding=` was passed. The
served guide describes first-party bootstrap but not how to admit a
handmade loopback binding.

M1 suite + required choreography are green (`receipts/m1-suite.json`,
`receipts/m1-choreography.jsonl`, `green: true`).

## M2 — posts and the follow graph

**Built.** `posts`, `follows`, `likes`, `reposts`; text/image/video posts;
Following vs Global projection with implicit self-follow; like/repost
set-state; replies only on thread screens; 20-item pagination; feed UI
with live cards.

**Easy.** Familiar live queries recomputed the feed from ordinary tables
and the kit already had compose/card/tab IDs. The suite went green on
the first full run after replay could sign back in.

**Fought.** M2 replay after M1 disposed clients and tried to mutate
unsigned-in. Choreography wanted feed tabs on profile (`router.replace`
not `push`, or it stacked extra composers). Wrapping `Stack` in chrome
zero-heighted the list (items existed but Playwright called them
hidden). Thread + feed both mounting `sm-compose-input` failed strict
mode until unfocused composers unmounted.

**Familiar saved.** Same `useQuery`/`useMutation` as M1; no extra
sync protocol.

**Still Snapback-specific.** Asset attach for image/video posts; live
queries must return arrays so pagination is cursor+limit rather than
`{page, next}`.

**Missing.** No note that Expo Router stack keeps previous screens
mounted, so contract IDs must be unique in the visible tree.

M2 suite + required choreography are green
(`receipts/m2-suite.json`, `receipts/m2-choreography.jsonl`,
`green: true`; image/video compose live checks skipped by the frozen
harness).

## M3 — DMs, groups, typing, quotes

**Built.** `chats.ts` on the same familiar constructors: idempotent DM
ensure, distinct group create, send with optional `quoteId`,
`setTyping` using `ctx.runtime.now()`, membership admin gates, and
array-shaped `mine` / `messages` / `typingIn` live queries. Starter-m3
replayed through the app write path. Conversation UI uses the frozen
composer, bubble, quote preview, and typing indicator. Acceptance
covers the required suite IDs; the two-client harness covers live DM
text, typing appear/expire, and (optionally) quoted-excerpt jump.

**Easy.** Once M1/M2 binding and chrome were honest, adding another
table module felt like adding another Convex file. DM identity by
sorted pair key, group identity by client id, and quote as a nullable
message id all fell out of ordinary indexed reads. Live message
delivery in the harness was well under the two-second ceiling without
any extra channel.

**Fought.** Expo Router's stack, not Snapback's live layer.

- `Date.now()` in a mutation handler is refused; typing timestamps
  have to come from `ctx.runtime.now()`.
- The stack keeps previous `/chat/[id]` screens mounted. Playwright's
  `getByTestId('sm-convo-typing')` is document-global, so leftover
  indicators from unfocused chats made expiry structurally fail (many
  visible nodes that never hid).
- Per-keystroke `setTyping(true)` without a queue can land after an
  idle `setTyping(false)` and pin the indicator on.
- The kit's `MessageBubble` already owns `sm-convo-bubble`. A sibling
  Reply button is invisible to
  `bubble.getByTestId('sm-convo-quote')`. The lane has to wrap the
  bubble *and* the Reply action in the contract id, and give the kit
  bubble a non-contract testID.

**Familiar saved.** Same `query`/`mutation`/`useQuery`/`useMutation`
loop as M1/M2. Typing is just another table plus a live array; no
presence protocol to invent. Headless suite clients reused the
generated `api.chats.*` refs.

**Still Snapback-specific.** Handler clocks, the array-return rule
(so "is anyone typing?" is a list, not a boolean query), and
sessions-mode refusing `snapback load`. The Expo environment
workaround from M1 was reused unchanged.

**Missing.** Nothing in the served guide says that contract IDs must
be unique in the *visible* tree, or that unfocused stack screens still
answer Playwright locators. A one-line note on typing expiry —
publish a row, delete it on idle, expire the leftover on the client
with margin under five seconds — would have saved the correction
loop.

M3 suite + required choreography are green
(`receipts/m3-suite.json`, `receipts/m3-choreography.jsonl`,
`green: true`). Optional quoted-reply also passed after the wrap
fix. M4–M8 were not built.

---

# Lane essay (verbatim)

# Familiar Snapback versus Convex (and the backends behind them)

I came into this lane treating Snapback's familiar TypeScript profile as
"Convex with a different binary." That was half right, and the wrong half
cost most of the calendar time.

The half that is right is the daily authoring loop. A `schema.ts`, a
folder of modules that export `query` / `mutation` / `action`, generated
`api` refs, and React hooks named the way a Convex app is named — that
is a real, usable product surface. Once a table existed, the next
feature was ordinary: index, write, return an array, subscribe in the
screen. DMs, groups, likes, and typing did not require a second mental
model. I never reached for sockets, Redis, or a hand-rolled
invalidation map. Live updates just happened, the same way they happen
on Convex when you keep the query pure and let the runtime rerun it.

That is the comparison that matters against the rest of the field.
Firebase Realtime / Firestore would have given me the live layer and
then made me fight security rules, implicit denormalization, and
"is this a document or a query?" for every feed projection. Supabase
would have given me Postgres and then made me wire Realtime, RLS, and
storage as three products. A boring Express-plus-Postgres stack would
have been honest about the seams and then eaten the milestone on
pagination, auth sessions, and "please push this row to the other
browser." Familiar Snapback, like Convex, collapses those seams for the
social-messenger shape: one schema, one function module, one hook, two
clients see the same write.

The half that is not Convex is everything around the function body.

Convex's golden path is one command and a URL. Familiar Snapback's
golden path, as published, is `snapback dev --expo` on a port band this
lane is not allowed to use, plus a supervisor exchange that mints an
app binding. Sessions mode cannot be `snapback load`-ed. The startup
artifact is a carrier you assemble yourself. The Expo provider's
`binding=` prop looks like the escape hatch and is not one: the default
environment still goes looking for the supervisor. I had to author a
`SnapbackExpoEnvironmentV1` that pretends to be supervised-dev IPC,
declares authority unavailable, and points at a loopback origin. That
is not a Convex concept. It is not even a "read the start packet"
concept. It is a product that has a first-party bootstrap story in the
guide and a default client that will not take you there unless you
already know the admission struct.

Auth is closer to Clerk-shaped Snapback than to Convex's
`auth.config.ts` + provider. Passwords have a documented minimum
length, durable web restore lives in IndexedDB with Web Locks, and
`defineAuth` does not come from the generated server module. Assets are
stricter than Convex file storage: an upload authorizer is not enough;
a later write that stores the ref has to `ctx.assets.attach` or the
runtime refuses it as unverified. Handlers may not call `Date.now()`.
Live queries may not return a single document. Module-level helpers
that look like "too much programming" get refused by the familiar
scanner. None of that is hard once you have been bitten. All of it is
invisible if you treat the profile as a Convex skin.

The served Guide is the right idea — I could ask it one page at a time,
and the Familiar TypeScript profile page plus the Expo start packet
were the two documents that actually moved the work. What they do not
say is how to run the published binary under a port pin, how to admit
a handmade binding, or that Expo Router will keep the previous screen
mounted so a contract test id is a *document* id, not a *route* id.
Those gaps are not "the docs are incomplete" in the usual open-source
sense. They are gaps between the profile the bench asked me to use and
the product the binary still wants to be: a supervised, `snapback dev`
world.

Would I pick this over Convex for a greenfield social app tomorrow?
For the function bodies, yes, interchangeably. For the first hour of
bringing a web client up, no. Convex has already spent that hour for
you. Familiar Snapback still spends it as a negotiation with
codegen policy, custody, and the Expo environment facade. Once that
negotiation is over — and in this lane it is now a hundred-line
`binding.ts` plus a carrier writer — the rest of Clique was the app I
expected to write.

I did not inspect Snapback's implementation repository. Everything I
believe about the runtime comes from the served guide, the published
package types, the shipped provider files, and the refusals the binary
printed. That is enough to ship M1–M3. It is not enough to confuse
this with Convex. The familiar profile saved the *shape* of the
backend. It did not save the *ceremony* of starting it.
