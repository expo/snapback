# Diary 0099: grok-coterie-familiar — 0.1.24 model×profile×app matrix lane

**Date:** 2026-08-17/18
**Run:** model×profile×app matrix on published Snapback 0.1.24
(`benchmarks/runs/2026-08-17-model-profile-app-matrix/`)
**Lane:** `grok-coterie-familiar` — Grok 4.6 (grok CLI, xhigh)
**App:** Coterie (Exact/Contract web); Snapback familiar (snapback-familiar-ts-v1) profile, published 0.1.24 from npm
**Outcome:** M1–M3 green
**Wall:** 7,002s · **Cost (approx., public list prices):** $40.64
- Output tokens: 196,650
- Fresh input 1,276,340; cache reads 73,809,920; reasoning 163,422

This diary's build narrative and essay are the lane agent's own words, written
milestone-by-milestone during the timed build per the lane prompt; the
orchestrator added only this header. N=1 exploratory calibration evidence, not
scored or claim-eligible (LLP 0201 D5). Machine load was shared with
concurrent fleet work — per-lane loadavg samples are retained with the run
record. 

# Diary — grok-coterie-familiar

## M1

Built a sessions-mode Snapback familiar-TS backend (`schema.ts`, top-level `profiles.ts`/`uploads.ts`, `authoringProfile: snapback-familiar-ts-v1`) and an Exact Contract web client. Contract views import Exact-generated bindings from one `ProviderNativeDeclaration`; boot attaches a Snapback-backed `ContractDataProvider`. Starter-m1 replayed through `authPasswordSignup` + `profiles.set` + asset upload. Suite covers m1-a01–a04, a08, a10, a11. Choreography M1 green.

What felt easy: Exact route generation, Contract indent syntax, Snapback password signup once the app client had IndexedDB custody.

What fought: published codegen refuses `_generated/` (prompt said that path; 0.1.24 emits `generated/`). Raw `snapback load` refuses sessions v1 artifacts — need `--startup-artifacts`. Vite Snapback relay allowlist omits `/auth/password/*`, so the browser client talks to `:42140` directly. Live WebSocket then does not stay on the relay; first profile snapshot had to poll. Signup-then-handle-conflict left the user authenticated until we checked uniqueness first.

Exact vs Snapback: Exact's provider generate and `configureFromProvider` digest check were mechanical. Snapback sessions + familiar handlers + asset intents were the real product work.

Missing docs: familiar guide is served only after a server is up; password routes vs vite relay allowlist is not called out on the Contract adapter page.

## M2

Built posts, likes, reposts, follows, and Following/Global feeds on the familiar Snapback schema, then ported them through the same Exact provider declaration. Starter-m1+m2 replayed through the real write path. Suite covers every suite-required M2 assertion. Choreography M2 green after two correction loops.

What felt easy: feed decoration (counts, attribution, reply exclusion) once the tables existed; Exact `each` + `testId` mapping of `sm-feed-item` / like / repost / reply.

What fought: the frozen harness clicks `sm-feed-tab-*` on whatever page it is on, including `/profile/{handle}` after follow. Contract actions also captured stale `liked` / `viewerFollows` booleans, so the second click of a like toggle sent `set` again. Following remounts flashed an empty list, which the harness treated as a successful unfollow.

Exact vs Snapback: Exact’s indent views and generated bindings stayed mechanical. Snapback liveQuery calling another query inside `onUpdate` threw `SNAPBACK_CLIENT_AUTH_COMMIT_REENTRANT`; feed freshness is a 400ms poll plus cached last snapshot.

Missing docs: no Contract note that action arguments are snapshotted at render; no Snapback note that Vite’s snapback-dev relay omits password routes and that liveQuery callbacks are not a safe place to issue nested queries.

## M3

Built conversations, members, messages, typing, and receipts on the familiar Snapback schema (`chats.ts`), then bound them through the same Exact declaration. Starter-m3 replayed as real `dm-create` / `group-create` / `member-add` / `send` mutations. Suite covers a03–a05, a10, a11, a14, a15. Choreography M3 green, including live DMs, the 2s/5s typing window, and quoted-excerpt jump.

What felt easy: DM pair reuse and group-as-entity once the tables existed; putting `sm-chats-item` on the signed-in home so the frozen harness could find Alice/Bob without a new route convention.

What fought: familiar handlers reject computed indexes and `Map`, and queries may not filter on `RuntimeNow` (`SNAPBACK_AUTH_CLOCK_DEPENDENT_VISIBILITY`). Typing expiry had to live in the browser. Authenticated queries started on the signed-out home hung inside the Snapback client without issuing HTTP. Quote jump worked once `nativeID` mapped to a real `id` and `link href` stayed on-page.

Exact vs Snapback: Exact’s `link` + `nativeID` gave an honest hash jump without a scroll API. Snapback’s inline-handler and clock-visibility rules shaped the messaging model more than the Contract views did.

Missing docs: no familiar-profile note that authenticated `client.query` from a still-anonymous page can stall the coordinator; no Contract note that `each` over a pending query needs a ready-gated derive.

## Close

Essay written before the numeric tally. Final report follows.

---

# Lane essay (verbatim)

# Building Coterie: Exact/Contract and Snapback versus a React-family stack

I came into this lane with the muscle memory of a typical TypeScript product engineer: React or React Native for the client, a document or Postgres backend, TanStack Query or Relay for the cache, and Playwright glued on after the fact. Coterie asked for a different pairing — Exact Contract views talking only to generated bindings, and a published Snapback 0.1.24 familiar-TypeScript backend as the only persistence and live-delivery authority. The interesting comparison is not “does the app exist” but where the hours actually go.

## The client is a language, not a component library

A React social client is a pile of components, hooks, and route files that you can locally invent. Exact Contract is closer to a small UI language: indent syntax, `query`/`mutation`/`state`/`action`/`derive`, and `testId` as a first-class node name. That is a genuine relief when the frozen instrument already names every observable surface (`sm-auth-email`, `sm-feed-item`, `sm-convo-bubble`). You do not argue with the design system; you emit the identifiers the choreography will click.

The cost is that the language is smaller than React in the ways you notice under a two-client harness. Action arguments are snapshotted at render. There is no casual `useEffect` to mark a conversation read or to scroll a quoted message into view. Hash links and `nativeID` exist, and they were enough, but I reached for them because the obvious React move — `ref.scrollIntoView()` — is not an authoring primitive. When the harness later clicks a profile and expects feed tabs to still be present, you cannot shrug and say “that page is a different screen.” The contract IDs are global vocabulary. That is stricter than React Router plus a shared tab bar, and it is also more honest: if the choreography can see it, the user can see it.

I did not miss JSX as syntax. I missed the escape hatches. In a React app I would have patched a stale like toggle with a ref or a reducer in five minutes. Here the correct fix was to stop trusting the captured boolean and resolve the next intent from the server. That is better product engineering. It is also slower when you are still learning which expressions the compiler will accept.

## The backend is a product, not a route handler

A familiar Expo or Next backend for this app would have been a handful of REST or tRPC procedures and a few SQL tables. Snapback familiar-TS looks like that on the page — `schema.ts`, top-level `query`/`mutation` modules, password sessions — and then refuses to be casual. Handles must be unique. Asset uploads need an explicit location policy. Sessions artifacts cannot be `snapback load`ed the way a SQLite dump can. Authenticated queries started from a still-anonymous page can hang inside the client instead of failing. Queries may not hide rows based on `ctx.runtime.now()`, so a typing indicator cannot expire in the handler; the browser has to do it.

Those are not documentation nits. They are a different contract about who is allowed to lie. React Query will happily show you a cached like count while you POST the unlike. Snapback wants the mutation to settle and the next snapshot to be true. That is why the live feed, live like, and live DM checks eventually went green without a fake in-memory provider. It is also why M1 spent real time on IndexedDB custody and why the Vite snapback-dev relay’s missing password routes mattered: the browser had to talk to the backend origin directly, and then live delivery was no longer on the same origin as the page.

Compared with Convex, Firebase, or a hand-rolled websocket, Snapback’s familiar profile is stricter about syntax than it is generous with examples. Computed indexes and `Map` are rejected. The served guide is the authority, and it is only fully available once a server is up. That is the opposite of the React docs experience, where you can stay in MDN and blog posts for a long time before you hit a sealed runtime.

## Two-client truth versus storybook truth

The instrument’s choreography is the most React-unlike part of the job. A normal product team would test DMs in one Playwright context and call it done. Here Alice and Bob are isolated browsers, login is through the same `sm-auth-*` fields a human uses, and live checks run best-of-three. You cannot stub the other client. You cannot mark a missing control as a pass. That forced the UI to keep feed tabs on the profile page, to keep chat rows on the home route, and to treat like/follow as server-side toggles instead of optimistic local flips.

I would not take this pairing over React/Expo for a greenfield consumer app tomorrow. The iteration loop is longer, the error codes are dense, and the client language still needs a few more everyday primitives. I would take it for a system that already has a frozen presentation contract and a requirement that two devices agree. React makes it easy to draw the messenger. Exact plus Snapback makes it harder to draw a messenger that only works in one tab.

The feeling that stayed with me is that both sides are trying to be “the source of truth” — Contract for what the user can observe, Snapback for what the user is allowed to change — and the app in the middle is just the seam. In a React-family stack that seam is implicit and full of accidental caches. Here it is explicit, generated, and occasionally hostile. Hostile seams are tiring. They are also the reason M1 through M3 could be called green without pretending.
