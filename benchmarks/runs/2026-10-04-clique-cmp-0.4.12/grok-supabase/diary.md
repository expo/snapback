# Clique / Supabase lane diary

Lane: grok-clique-supabase-20260916  
Backend: hosted Supabase + `@supabase/supabase-js@2.112.4`  
Host: Linux x86_64, ports 55600–55619

## M1 — Accounts and profiles

Built: Expo Router shell, vendored UI kit, Postgres schema under `clq916g_`, Supabase Auth email/password (admin `createUser` + `signInWithPassword`), profiles with unique handles, avatar upload to a private `clq916g_media` bucket served through the API, seed of `starter-m1.log`.

Easy: hosted Auth is a real password credential path; unique handles are ordinary unique indexes; the frozen AuthForm/ProfileForm meant pixels were not the work.

Fought: signup vs handle uniqueness (must check handle before `createUser` or the Auth API swallows the failure as “Database error creating new user”); Expo web needed `babel-preset-expo` declared at the app root; session persistence on web is just supabase-js `persistSession` + localStorage.

Prior familiarity: Postgres constraints and a thin HTTP BFF. Saved time vs inventing a KDF.

Missing: no local Supabase stack, no CLI. DDL goes through the pooled Postgres URL. Email confirmation had to be forced via `email_confirm: true` on admin create because this brief forbids outbound email.

Compared to Snapback/Convex at this step: Auth is a separate product from the data plane. Wiring JWT → profile row is ceremony Convex folds into the function context and Snapback folds into the runtime. Once the profile row exists, the rest is SQL.

Status: suite + choreography green.

## M2 — Posts and the follow graph

Built: posts (text/images/video), likes/reposts as set-state, Following vs Global vs Trending tabs, 20-per-page feeds, replies excluded from feeds, seed `starter-m2.log`.

Easy: the data model is tables. Follow edges and feed unions are the kind of query Postgres wants.

Fought: unused `$1` in the Global feed query (`could not determine data type of parameter $1`); Following pagination needed extra filler posts after unfollow tests; RN-web `accessibilityValue` often does not become `aria-valuetext`, so choreography semantic values required `data-value` patches on the vendored kit; a poll-merge that kept stale feed rows made unreposts look sticky; FeedTabs had to live in the chrome so profile → follow → Following still had `sm-feed-tab-*`.

Prior familiarity: SQL unions for feed fan-in. The celebrity/read-path worry is real even at starter size if you merge client caches badly.

Missing: no live query primitive. 1s poll plus postgres_changes (unused for feeds in the end) is the substitute.

Status: suite + choreography green.

## M3 — Messaging core

Built: unique DMs, groups with admin membership, quoted replies, typing table with 3s TTL, receipts over membership-at-send, seed `starter-m3.log`.

Easy: DM pair uniqueness (`dm_pair`), quoted reply as `quote_id`, member add/remove as rows.

Fought: this milestone ate the session. Dual React (vendored kit `node_modules` vs app React) crashed `TypingIndicator` with invalid hook call — conversation routes rendered nothing. Nested Expo Router `settings` segments did not mount; query `?settings=1` did. RN-web `TextInput`/`Pressable` did not reliably take Playwright `fill`/`click`; a native `<input>`/`<button>` pair did in a debug script and then failed strict-mode because two `sm-convo-input` nodes existed. After deleting the kit composer, live bubbles still did not appear under the harness even though a manual Playwright script could send. Typing within 2s needed sub-second polling and still missed when Auth/token races skipped the first load. Group aggregate read waited on leftover Dave membership from earlier retries.

Prior familiarity: WhatsApp-style receipts are a join, not a CRDT. That part was clear.

Missing: no presence/typing primitive. A `typing` table plus poll is a durable workaround. Realtime broadcast would have been the Supabase-shaped answer; I under-used it.

Status: suite green; choreography not green after many correction loops. Stopped before the 4h wall to keep M4–M8 suites and the scale adapter on the clock. Recorded as `aborted` (not cap-exhausted).

## M4 — Media, reactions, edit/delete

Built: image/video messages, one reaction per user, edit/delete windows from `config/windows.json` (shortened grading profile), tombstones, asset denial via the media gate.

Easy: window checks against `now()` in the store. Set-state reactions.

Fought: M3 choreography surface (composer/bubbles) blocked M4 two-client proofs. Suite covered the mutation path.

Status: suite green; choreography attempted, failed on the same bubble wait. Official status `blocked-by-M3`.

## M5 — Ephemeral, chat config, search

Built: disappearing options `off|24h|7d` with shortened TTLs, view-once opens table, accent/background, word-prefix people/message search, warm-offline cache + `sm-search-offline`.

Easy: prefix search over NFC/lowercase is a few lines. View-once is a unique `(message, user)` insert.

Fought: same conversation chrome. Suite green.

Status: suite green; choreography not separately greened. `blocked-by-M3`.

## M6 — Offline writes, push seam, custom-client API, replay adapter

Built: client queue in localStorage, presence heartbeats, `clq916g_push_log` when the recipient has no fresh device, `API.md` + `scripts/custom-client-demo.mjs`, replay adapter over every action-schema verb, `sample-50.log` conformance on the dev instance.

Easy: “same function surface as the app” is natural when mutations live in one `store.mjs`. The demo is supabase-js Auth plus fetch.

Fought: hosted connection pooler `EMAXCONNSESSION` when acceptance and the API each opened `pg.Pool({ max: 12 })`. Cut to `max: 4`. Native iOS simulator proofs unavailable on Linux. Hermes bytecode export failed on private fields in the RN bundle.

Status: suite green (including sample-50). Web choreography (offline queue) not greened. Native simulator recorded unavailable. `blocked-by-M3`. Scale replay started on `clq916g_s_` against a fresh schema seeded with starter logs.

## M8 — Insights, digest, multi-device

Built: six lifetime totals, 7 UTC day buckets (zeros included), trending top-10/24h, digest worker on the shortened 120s period, push-log payloads, multi-device read via receipts.

Easy: the aggregates are SQL. Digest idempotency is a primary key on `(user_id, period_start)`.

Fought: trending tie-break tests lost to a feed full of already-liked posts; had to lift the tied pair above the noise with equal likes.

Status: suite green. Choreography not greened. `blocked-by-M3`. Native durable-queue restart not-run (no simulator).

## M7

Not run (separate fresh session, per ENVIRONMENT.md).
