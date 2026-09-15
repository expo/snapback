# Clique on Snapback 4 — builder diary

## M1 — Accounts and profiles

Built password signup/login via `use identity`, profiles with unique handles, avatar uploads, and an Expo Router shell wired to the frozen UI kit. The backend is one Quarry file: tables, rules, `sync`, and mutations. Acceptance is a Node script against `createClient`; choreography is the copied Playwright harness.

What felt easy: identity, unique handles, and `client.upload` + `image` columns matched the brief without a custom media service. `snapback4 check` diagnostics with rewrites were specific enough to compile a large schema in a handful of passes.

What fought: the published darwin-arm64 binary stalled at `_dyld_start` under this host's inherited stdio (environment). Metro hid `snapback/generated/` because it is gitignored. `webDevice()`'s default wasm URL resolved to HTML until the `.wasm` was copied into `public/`. Logout left a bearer in `localStorage` until `forgetSession` plus an auth gate in the root layout.

Prior familiarity that helped: Expo Router file routes, Playwright test IDs, and the idea of a sync audience matching the read rule (from the published guide, not from earlier Snapback source).

Missing docs: none fatal for M1; wasm-plus-bundler was implied by `webDevice({ wasm })` in the README. The host Gatekeeper stall is not in the package README.

Compared with Convex/Supabase at this step: Quarry's `use identity` plus handle uniqueness in the same file is less plumbing than rolling Supabase Auth + a profiles table and RLS. Convex would have been similar in "one functions file" feel, with a looser schema language.

## M2 — Posts and the follow graph

Built posts (text/images/video), likes/reposts/replies as set-state intents, global timeline, and a following feed as a merge of `timeline` lanes (self + follows). Suite green. Choreography **green** on a later pass (`receipts/m2.jsonl`, 9/9): video compose needed a still poster (`/poster.png`), likes needed `sync public` on the likes table plus `dailyActivity` readable so Bob could increment Alice’s tally, unrepost needed a timeline delete.

Easy: `createPost` + public posts + unique like/repost pairs. `check` named `N_WIDE_MERGE` on the 501-lane following query and left it legal.

Fought: fan-out-on-write missed older posts after a later follow — switched to merge-on-read. Metro FlatList-on-web infinite `onEndReached`. Hidden file inputs. `intents` with `read <- deny` made idempotent replay `E_RULE`. Generated `api.ts` showed `likesOf` as `runs: server, horizon: none` until likes were synced.

## M3 — Messaging core

DMs (`dmPairs` with a client `pairKey`), groups, quoted replies, typing (`expire at .until` plus a 3s client hide), receipts, retain `delivered-history`. Suite green. Choreography: DM live, 1:1 receipts, group aggregate read, typing, quoted reply each passed on at least one run; a single JSONL never held every required check at once. Latest `receipts/m3.jsonl` is not green.

Easy: `created conversations[.conversationId]` for the first memberships; cap 50.

Fought: RN Web composer `fill` vs disabled send (native `<textarea>`); `View` testID vs `<article data-testid>`; 29 bubbles polling `receiptsOf` starved `mutate`; after remove, `groupsNamed` unmounted Dave’s thread and dropped retained history. Pairwise `dailyActivity`-style visibility bugs did not show up here; poll storms did.

## M4 — Media messages, reactions, edit/delete

Photo/video messages, reactions one per user, server edit/delete windows from shortened config. Suite green. Choreography: photo live-render passed; video viewer, reaction chips, edit, delete tombstone failed in `receipts/m4.jsonl`. Edit was rewired from `prompt()` to the composer so a later run could fill `sm-convo-input`.

## M5 — Ephemeral, chat config, search

Disappearing via `expiresAt: now + ttl`; view-once column; accent enum; people/in-chat/global `matching`; job digest every 2m. Suite green. Choreography: chat color+background sync passed; view-once viewer, warm-offline search, disappearing control failed (`receipts/m5.jsonl`). Offline search cannot work on `createClient`.

## M6 — Offline, push, API, replay

Push `emit notify` + `pushEvents` + worker JSONL. `API.md` + `custom-client-demo.mjs`. Sample-50 replay in the suite. Scale replay on port 49342 `--fresh`: 167,157 actions in 453s; named O5 fixtures matched. Native iOS simulator offline proofs not run (native-artifact, not web-green). Web used the online client, so durable offline queue is a gap on web.

## M8 — Insights, digest, multi-device

Insights query (six totals + 7 UTC days). Trending top-10 by likes in 24h. Digest schedule every 2m, skipped when `replayMode`. Multi-device unread on memberships. Suite green. Choreography: same-account live message passed; insights like refresh, cross-device read, dual-offline failed (`receipts/m8.jsonl`).

Scale clock: start=1789397301 end=1789397754 wall=453s, verification pass against named O5 (u0500 500/100, u0005 5, u0900 900/200, u0901 5).

