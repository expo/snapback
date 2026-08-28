# Clique PocketBase lane diary

## M1 — Accounts and profiles

Built PocketBase 0.39.9 as a lane-local binary on 127.0.0.1:48140, users auth collection with handle/displayName/bio/location/link/avatar, register/login/logout/profile custom routes, and an Expo Router shell using the frozen UI kit.

Easy: PocketBase built-in password auth and `superuser upsert` were a straight fit for M1 signup. File fields for avatars just worked.

Fought: JSVM hook callbacks do not close over file-scope helpers (they recompile as isolated `pb.js` functions). The working pattern is to `eval` `api.js` inside each `routerUse` / cron / file-download callback. Also, `created` autodate fields must be declared on every collection we sort by.

Prior PocketBase familiarity that helped: collection rules, `refreshTokenKey()` for logout revocation, autodate gotcha from the prompt.

Missing: a first-class per-session revocation table (we rotate `tokenKey` instead); JSVM docs do not shout about the isolated-handler closure trap.

## M2 — Posts and the follow graph

Feed_items denormalize originals and reposts. Custom `/api/clique/feed` does following vs global with keyset cursors. Suite 22/22 green after seeding starter-m2 through the write path.

Easy: likes/reposts as unique (user, post) rows with mutationId idempotency.

Fought: following-feed pagination needs a user who follows everyone to exceed 20 items; starter Alice following is sparse.

## M3 — Messaging

DMs keyed by pairKey, groups as distinct entities, membership leftAt for removal, recipientSet-at-send for receipts, typing rows with 5s expiry.

Easy: realtime collection subscriptions for live delivery.

Fought: typing has no primitive; durable rows plus client expiry. Receipt aggregation in JS rather than a builtin.

## M4–M5 — Media, ephemeral, search

Protected message files, view-once view table, shortened windows from fixture config, word-prefix search.

Easy: file fields and mime/size limits.

Fought: per-recipient view-once denial needs `onFileDownloadRequest`, not a rule. PB datetime strings use a space instead of `T`, which broke UTC-day insights comparisons until normalized.

## M6 — Offline, push, adapter

Headless replay adapter covers every action-schema verb. Custom-client demo authenticates, lists convos, pages history, sends, polls. Push log when the recipient has no realtime heartbeat.

Fought: PocketBase JS SDK has no offline/sync — queue is hand-rolled localStorage. sample-50 actors use handle `sama` after profile-set while verbs still name `sample-a`; findUser now also resolves `<actor>@example.com`.

## M8 — Insights, digest, multi-device

Server-side insights and trending; `cronAdd` digest every minute against the shortened 2-minute period; replay-mode flag disables both push and digest.

Easy: JSVM `cronAdd` is a real scheduler.

Fought: celebrity/fan-out not exercised until scale replay; native iOS simulator proofs are web-only-lane artifacts (Hermes export attempted separately).
