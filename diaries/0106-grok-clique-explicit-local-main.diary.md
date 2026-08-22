# Diary 0106: Grok Clique Explicit on unpublished local main

**Date:** 2026-08-22
**Run:** `benchmarks/runs/2026-08-22-clique-local-main-grok/`
**Lane:** `grok-clique-explicit-local-main-r01` — Grok 4.6 (grok CLI 1.0.5, xhigh)
**Backend:** unpublished local source commit `b70caf19eae1d4763224ebd182955e04430a67eb`
**Outcome:** M1–M3 green in 12,415s; 335,746 output tokens; harness cost $20.36

This is N=1 diagnostic evidence against unpublished source, not scored or
claim-eligible. The lane agent's complete diary, essay, receipts, and report
remain under `/Users/ccheever/clique-main-20260822/` on the run machine.

Harness-native grok spend (streaming-json `end` event; cap-bearing adapters
treat grok as `unavailable`):

- Output tokens: 335,746 (reasoning 311,287, counted inside output)
- Fresh input 2,746,099; cache reads 116,780,928
- 471 model turns; 972 tool calls

This diary's build narrative and essay are the lane agent's own words, written
milestone-by-milestone during the timed build per the lane prompt; the
orchestrator added only this header. One mid-run session compaction required
the agent to reconstruct `run-log.md` from in-session memory.

# Diary — grok-clique-explicit-local-main-r01

## M1

Built password sessions, durable IndexedDB custody, profile CRUD with handle uniqueness, avatar upload via `defineCommand`, and the frozen AuthForm/ProfileForm kit. Scaffolded from the local expo-chat tarball and immediately rewired onto vendor `file:` packages.

Easy: `defineLiveQuery` + `defineJsMutation` for handle uniqueness, and the sessions password mechanism once `durable-required` was set.

Fought: public npm 0.1.0 vs unpublished pin; Expo shebang needing volta `node` while Snapback needed bun 1.3.12 + `SNAPBACK_RUNTIME_BINARY`; guest reaping requiring `principalField` on every table; supervised `snapback-dev@localhost.invalid` collapsing Alice and Bob.

Explicit profile saved a readable `schema.mjs`/`functions.mjs` pair and exact generated refs. It cost `SNAPBACK_INLINE_HANDLER_FREE_IDENTIFIER` (no `const` arrow helpers) and a generation loop on `followeeId: v.principal()`.

Missing docs: that supervised Expo authority is a single minted session unless `resolveSupervisedAuthority` returns unavailable; that babel.config must be CJS for this Metro.

## M2

Additive schema successor for posts, follows, likes, and reposts (seed.json unchanged; original accounts/sessions retained). Mixed following/global feeds (20/page), implicit self-follow, thread replies excluded from feeds. Replay of starter-m2 through `writePost`/`setFollow`/`setLike`/`setRepost`.

Easy: fixtureId/mutationId unique indexes for idempotent replay; frozen FeedCard/Composer/FeedTabs once testIDs lined up.

Fought: Metro HMR storms reclaiming the lifecycle (restarted the same `snapback dev` on 48100, sqlite preserved); two Playwright pages in one context sharing IndexedDB; table `globalFeed` not delivering live new posts until JS `globalTimeline` was restored; `postById`/`repliesForPost` table live queries going empty after `writePost` (thread showed “Loading thread…”). Probe dump is the evidence.

Explicit profile made the successor hashes obvious (`startup-successor-activated` JSON). It cost converting several point/list reads to `defineJsLiveQuery` because `_id` filters and optional `parentId` indexes did not live-update.

Missing docs: live_delta behavior for `eq('_id')` + `limit: 1` after a same-table insert; that ordered JS queries replace rather than delta.

## M3

Additive conversations, memberships, messages; DM pair-key reuse; groups that coexist; `sendMessage` with quoteId; ephemeral typing registered with `defineEphemeral({ typing })` (not a schema.mjs export). Chats rail so `sm-chats-item` is visible from the feed origin. `useSnapbackActivityPresence` with `idleMs: 2500` for the 2s/5s typing window.

Easy: pairKey idempotent `ensureDm`; activity-presence idle matching the choreography ceilings once typing actually generated.

Fought: `SNAPBACK_DEFINITION_IN_SCHEMA_MODULE` vs `defineEphemeral`; `SNAPBACK_SURFACE_REFERENCE_UNKNOWN` on `defineSurface` presence bind; `SNAPBACK_REACT_ARGS_INVALID` node-limit (app.queries ~6251 nodes) which blanked the whole web boot; DM bubbles not appearing until messages became a JS live query.

Explicit profile made every successor identity printable and kept sqlite continuity. It did not save the live-query blanking bug or the 4096-node client ceiling.

Missing docs: `defineEphemeral` must live in defineSchema options; CanonicalClientValueV1 maxNodes=4096 applies to boot of a large generated `app`; table live queries on messages have the same post-insert blank as posts.

---

# Lane essay (verbatim)

# Essay — authoring Clique on unpublished Snapback (explicit profile)

I came in with Convex, Supabase, Firebase, and hand-rolled Postgres+Express as the comparison set. Snapback’s explicit profile sits closest to Convex in spirit (schema + functions, live queries, server-authoritative writes) and closest to a typed RPC layer in Express in discipline (refusals, result contracts, generated clients). It is not like Firebase’s document bags, and it is not like Supabase’s “the table is the API.”

What felt native: one `schema.mjs` and one `functions.mjs`, generated exact function references, and a running binary that served a Guide. Successor activation printed old and new schema/function hashes plus a continuity block that said accounts, sessions, and stores were preserved. That is more honest than Convex’s “just deploy” and more inspectable than Firebase’s silent rule deploys. Replay through the app write path, not a SQL dump, is the right default for a messenger.

What felt foreign: the client is not a thin wrapper around those functions. Live subscriptions have a second physics — replace versus delta, `_id` filters that can blank after a sibling insert, JS handlers that re-run versus table plans that incrementalize. I lost a thread screen to that: the mutation succeeded, the parent reply count incremented, and then `postById` returned no rows. Convex would have kept the previous document; Postgres would have returned the row on the next SELECT. Snapback’s table live query chose empty. Switching those reads to `defineJsLiveQuery` plus a local cache was the workaround, not a documented recipe.

Auth is another split. Sessions + built-in password + durable IndexedDB custody is closer to Supabase GoTrue than to Firebase anonymous-then-link. The supervised Expo mint, though, is a third user: if you adopt it, every browser tab is the same principal. Clique’s two-client proof required skipping that mint. Convex’s “identity is whatever you put in ctx.auth” is simpler; Express would have made the mistake obvious because there would be a cookie. Here the mistake was a well-typed 200.

Generation is the tax. Guest reaping wants a principal field on every table. `followeeId` as `v.principal()` failed. Inline handlers refuse `const` helpers. Ephemeral typing cannot be an export of `schema.mjs`; it has to be `defineEphemeral({ typing })` in the schema options while the collection itself lives in `surface-model.mjs`. None of that is hard once named, but each name arrived as a diagnostic after a failed generate, not as the start packet. Supabase migrations fail in SQL; this fails in a JSON diagnostic with a code you then `snapback guide`. That loop is good when the Guide page exists and bitter when the page is a capability index hit list.

The 4096-node CanonicalClientValue ceiling is the one that felt unlike every other backend I know. Adding M3 queries made the generated `app` object large enough that the Expo provider refused to boot: “Clique couldn’t start.” There is no Convex analog of “your API surface is too big to canonicalize.” The fix was deleting unused queries and folding pagination `before` into optional args. That is a real product constraint, not a lane mistake.

Realtime typing, once generated, was the nicest hour. `useSnapbackActivityPresence` with an idle deadline mapped onto the choreography’s 2s-visible / 5s-expire window without me storing a `typing_at` column. Firebase Realtime would have been similar; Postgres+Express would have been sockets plus a TTL job. Snapback’s ephemeral collection is the right primitive.

Would I ship a production messenger on this pin? For a single-team app that can live inside the generated contract and the successor lifecycle, yes — the continuity hashes and refusal codes are better than ad-hoc Express. I would not start a many-query product without a budget for live-query shape (JS vs table) and for the client node ceiling. Compared with Convex I missed “just keep the last value.” Compared with Supabase I missed SQL. Compared with Firebase I did not miss security rules. The explicit profile is a compiler in front of a live store. Treat it that way, not as a document database with types.
