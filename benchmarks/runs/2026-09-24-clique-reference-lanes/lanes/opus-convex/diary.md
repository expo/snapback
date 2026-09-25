# Clique on Convex — build diary (opus-clique-convex-ref-20260924)

## M1 — Accounts and profiles (green at 1790297156, 37 min after lane start)

**Built.** Expo Router (SDK 57) web+iOS client over a Convex 1.46.0 local backend. Auth is Convex Auth's
Password provider (Scrypt, JWT access tokens + refresh tokens, server-side session rows). A profile row
(handle/displayName/bio/location/link/avatar) is created atomically inside the signup mutation via
`afterUserCreatedOrUpdated`, so a duplicate handle rolls back the whole account creation. Every
function resolves the caller through a helper that also requires the Convex Auth session document
to still exist, so logout kills an outstanding access token immediately instead of at JWT expiry.
Avatars upload straight to Convex file storage via a mutation-minted upload URL. I also wrote the
whole backend schema and most client screens up front (feeds, chats, receipts, search, digest), so
later milestones are mostly verification and fixes.

**Easy.** Reactivity is free: `useQuery(api.users.profile)` on Bob's page updates the instant Alice
saves; the M1 live-profile choreography passed on its first run. Codegen + end-to-end types through
`api.*` meant the entire first draft of ~20 client files typechecked with zero errors. File
storage upload is three lines.

**Fought me.** (1) Anonymous `convex dev` watch mode silently starts a local dashboard on
127.0.0.1:6790 — outside my port range — with no flag to move or disable it. I killed it within a
minute and switched to running the `convex-local-backend` binary myself (`--interface 127.0.0.1`,
my ports) and pushing code with `convex dev --once` against a self-hosted URL/admin key; that also
gives me clean fresh instances for the scale replay. (2) Convex Auth's Password `signUp` with an
existing email *and the right password* silently signs in instead of failing, so "duplicate email is
rejected" needed a wrapper around the provider's internal `authorize` (found by reading the package
source; the `profile()` callback is typed sync, so an async check there was impossible). (3) The
TypeScript 6 default of `types: []` meant `process.env` failed to typecheck in convex/ until I added
`types: ["node"]`.

**Prior familiarity.** Knowing Convex Auth's key setup (JWT_PRIVATE_KEY/JWKS) and the auth.config
shape saved the interactive `npx @convex-dev/auth` flow; I generated keys with `jose` directly.

**Missing capability/docs.** No documented way to pin the anonymous-mode dashboard port; the Password
provider's duplicate-email semantics aren't documented where you'd look for them.

**Compared to alternatives.** Versus Supabase, auth is less turnkey (no hosted GoTrue; you wire
keys and HTTP routes yourself) but the session/data composition is tighter: the same function that
reads data checks the session row transactionally. Versus a hand-rolled Postgres+Express stack,
M1 was a fraction of the code.

## M2 — Posts and the follow graph (green at 1790297559, 6 min after M2 start)

**Built.** Posts (text / 1–4 images / one video with a client-extracted poster frame), likes and
reposts as idempotent set/clear intents carrying mutation IDs, replies as posts with a parent,
Global feed = a `feedItems` table (one row per post or repost), Following = a fan-out-on-write
`timeline` table materialised by batched scheduled mutations, with a read-time follow-edge guard so
an unfollow is immediate even before the async prune runs. The first backfill page on follow runs
inside the follow mutation itself. Both feed subscriptions live above the router so tab switches and
back-navigation render already-synced data instantly (the choreography samples "before" state the
moment a tab is clicked).

**Easy.** `usePaginatedQuery` gave reactive, gap-free cursor pagination for free — new posts appear
at the top of page one live, and the suite's no-duplicates/no-gaps check passed first time.
`ctx.scheduler.runAfter(0, …)` made fan-out a few lines. All nine M2 choreography checks passed on
the first dry run, including video (Playwright's Chromium decoded the fixture MP4 fine).

**Fought me.** One flaky miss: a follow's scheduled backfill didn't land during a full suite run,
while the backend logged an OCC conflict on `follows` at the same millisecond (a concurrent fan-out
job reading the followee's follower range). Not reproducible in isolation and no failed scheduled
job recorded; I stopped depending on scheduler timing for the first page. I could not attribute it
cleanly (logged as ambiguous). Convex's function logs didn't show scheduled-function outcomes, so I
wrote an internal query over `_scheduled_functions` to inspect them.

**Prior familiarity.** Knowing that Convex paginated queries stay reactive and that a query's cache
key includes its args (so time-dependent queries need a nonce) shaped the Trending/Insights design.

**Compared to alternatives.** In Postgres I'd express Following as one indexed join and worry
about the celebrity; here the "join" is hand-built fan-out, but it's small, transactional, and the
reactivity is the platform's. Firebase would have needed the same fan-out with weaker transactions.

## M3 — Messaging core (green at 1790297846, ~5 min after M3 start)

**Built.** DMs deduped by a sorted-pair key; groups as entities with admin/member roles and
active/removed/left membership rows. Each chat has a monotonically increasing `seq`; receipts are
per-member watermarks (`deliveredSeq`, `readSeq`) and a message's recipient set is "active members
who joined before its seq", so the group aggregate drops members who leave and ignores late joiners.
Delivery is acknowledged by a global client agent subscribed to "chats whose lastSeq exceeds my
deliveredSeq" (gated on the browser's online state); read is marked when a conversation is on
screen. Removed members read history only up to their `endedSeq`. Typing is a small table of
`expiresAt` rows written by a throttled heartbeat, rendered with a client-side clock. Quoted replies
store a pointer and render an excerpt; tapping scrolls to the measured bubble offset.

**Easy.** All seven M3 choreography checks passed on the first dry run — reactive queries made
receipts (sent → delivered → read), typing, and removal cutoff behave live without any channel code.
The watermark model made receipts a pure function of documents the query already reads.

**Fought me.** My own bug: the harness reloads the page immediately after clicking "Remove", which
aborted the fire-and-forget mutation; the removal then landed after Alice's next message. Fixed by
sending chat-admin and settings writes through the same durable, ordered outbox as messages (so a
reload replays them in order). The failed run also left Dave as an admin of the starter group, so I
wrote a small restore script — the choreography isn't self-healing after an aborted run.

**Missing capability.** Convex has no ephemeral/presence primitive in the core package; typing and
"is anyone connected" (for push) are ordinary tables plus heartbeats. It works, but every keystroke
heartbeat is a durable write and invalidates the chat-list query.

**Compared to alternatives.** Supabase Realtime has Presence/Broadcast channels for typing that
avoid durable writes; Firebase RTDB has onDisconnect. Convex's advantage is that everything else
(receipts, membership cutoffs) is transactional and reactive with no channel plumbing at all.

## M4 — Media messages, reactions, edit/delete (green at 1790298066, 3 min after M4 start)

**Built.** Photo and video messages upload to Convex storage (video gets a client-extracted poster
frame uploaded alongside), render inline from the reactive message query, and play in a viewer
(`<video>` on web, expo-video natively). Reactions are one row per (message, user) with set/replace/
clear intents. Edit and delete-for-everyone enforce the config-file windows against server time
inside the mutation; delete tombstones the row, clears text/search text, deletes the storage
objects (so the old URL stops serving), and drops reactions.

**Easy.** Everything. All five M4 choreography checks passed on the first dry run. Storage deletion
revoking the URL is exactly the semantic the brief wants for delete-for-everyone. Server-time window
checks are just `Date.now()` inside a mutation (mutations can't be given a caller clock).

**Fought me.** Only my own test helper (key-order-sensitive equality).

**Compared to alternatives.** Supabase Storage would need RLS policies on a bucket plus signed URLs
to get equivalent revocation; here "the asset is gone" is one `ctx.storage.delete` in the same
transaction as the tombstone. The price is that storage URLs are capability URLs (anyone holding
one can fetch until deletion), which is why view-once needs a separate path.

## M5 — Ephemeral, chat config, search (green at 1790299405, 22 min after M5 start)

**Built.** Disappearing messages: the chat setting stamps `expiresAt` on messages sent after the
change and the send mutation schedules `internal.messages.expire` with `ctx.scheduler.runAt`, which
tombstones the row, clears search text and deletes storage objects — no client needs to be open
(verified by a suite test that waits out the shortened 3-minute TTL). Reads additionally filter by
`expiresAt`. View-once: recipients never receive a storage URL; opening mints a per-recipient,
short-lived ticket served by an HTTP action with `Cache-Control: no-store`; closing (or expiry)
revokes it and a second open is refused. Chat colour/background/name/description/disappearing are
chat-row fields with admin gating. Search: a Convex full-text search index per message (filtered by
chat) provides candidates, then the exact pinned rule (case-insensitive word-prefix over NFC text,
every term) is applied and results are ordered newest-first; people search is a search index over
display name + handle. Offline: a HistorySync agent pulls up to 1000 recent messages per chat into
the durable local store and the search screen falls back to the same word-prefix matcher over it.

**Easy.** `scheduler.runAt` for exact-time expiry is the cleanest server-side expiry I've written
on any backend. HTTP actions made the view-once ticket endpoint ~20 lines.

**Fought me.** Convex's full-text search is relevance-ranked and prefix-matches only the last term,
so exact "every term is a word prefix, newest first" semantics needed a candidate-then-filter step
(and results are bounded by the candidate set, not truly newest-first across unlimited matches).
Offline search is necessarily a second implementation over my own cache. Two choreography misses
were my own client bugs (viewer node rendered too late; cache window too small).

**Missing capability.** No offline persistence in the Convex client at all — the local store,
history sync, and offline search are hand-built.

**Compared to alternatives.** Postgres full-text (Supabase) would give ordering control via SQL but
the same need for a separate offline index; Firestore has no text search at all. Convex's scheduled
functions beat pg_cron/edge-function combos for per-message expiry.

## M6 — Offline writes, push seam, custom-client API (green at 1790299740, 5 min after M6 start)

**Built.** A durable, ordered outbox (localStorage on web, AsyncStorage natively) for message
sends, likes, reposts, reactions, follows, and chat-admin calls; every item is an idempotent intent
(client message ID or set/clear + mutation ID) so replays can't duplicate or invert. Pending bubbles
render from the outbox and are replaced by the server row with the same client ID. The push seam:
send checks each recipient's device heartbeats; users with no live client get a
`{targetUserId, chatId, senderDisplayName, preview}` row in `pushLog` plus a provider action that
logs it (replay mode disables it). The custom-client API is Convex's native protocol documented in
API.md, exercised by a headless demo that signs in, lists conversations, pages history, streams a
live message via `ConvexClient.onUpdate`, sends idempotently, and proves sign-out kills the token.
The replay adapter maps every action-log verb to the app's own mutations and passed the 50-action
conformance log with full state verification.

**Easy.** The custom-client API was nearly free: the web app's own function surface *is* a
documented, typed, streaming API; a third party only needs `convex` and function names.

**Fought me.** The demo's subscription threw `InvalidCursor`: my history query's index range
included `lte(seq, chat.lastSeq)`, which moves with every message and breaks reactive pagination.
The React hook silently restarts pagination so the web app never showed it; the plain client
surfaced it with a precise error. On the scale replay, Convex Auth's sign-up hashes the password with
pure-JS Scrypt *inside a mutation*, and under this host's load (load average ~160 on 18 cores) one
exceeded the 1-second mutation limit; bounded retries (safe because every verb is idempotent) fixed
it.

**Missing capability.** No offline write queue, no persistence, no presence/"is connected" signal,
no push integration — all hand-built. Convex's reactive client does queue mutations while the socket
is down, but not durably and not visibly.

## M8 — Insights, digest, multi-device (green at 1790300256, 5 min after M8 start)

**Built.** Insights from server-maintained counters (`userStats`) and per-UTC-day buckets
(`dailyStats`) updated transactionally in the post/like/repost/reply/follow mutations; the screen
reads 1 + 7 small documents regardless of corpus size. Trending walks a `(parentId, likeCount,
_creationTime)` index from the top and keeps the first ten top-level posts inside the trailing 24 h.
Both use a nonce argument so each load re-evaluates against server time instead of hitting the
query cache. The daily digest is a Convex cron that polls for newly elapsed periods of the configured
schedule, records a `digestRuns` row, and processes users in scheduled batches; one-per-user-per-
period is enforced by an index lookup in the same transaction as the insert, so retries and
restarts can't double-emit. Multi-device read state falls out of the watermark model.

**Easy.** Cron + scheduler made the digest genuinely server-scheduled with no external
infrastructure, and the suite verified exact counts (including an unauthorised chat that must not
count) on the first run. All five M8 web choreography checks passed on the first dry run.

**Fought me.** My own suite's posts pushed Alice's posts off Bob's first Global page, which the
harness's insights check needs; I refreshed that precondition with one Alice post (logged).

**Compared to alternatives.** Aggregates are where a SQL backend shines (`count(*) … group by
day`); on Convex I maintained counters by hand, which is more code but O(1) at the envelope.

## Scale replay (own clock) and post-M8 hardening

**What happened.** The adapter replayed all 167,157 scale actions through the app's own auth and
mutation path against a fresh, starter-seeded instance in replay mode (push + digests off). The first
attempt died at action 67: Convex Auth hashes passwords inside a mutation and, on this heavily loaded
host, one registration exceeded the 1 s mutation limit; with bounded retries the second attempt
settled every action. The 10 %, 50 % and final invariant checks (per-entity counts, per-user
following/conversation counts, per-chat message counts, per-group rosters, and the named O5
fixtures including paging all 10,000 messages of the busy group) matched the manifest exactly, and a
seeded API-level sample (two seeds) verified profiles, follow edges, posts with like/repost/reply
counts and liker state, memberships, full message histories, quotes and reactions.

**What the envelope taught me.** The local backend's per-function limit of 4,096 document reads
caught three unbounded patterns my small dev data never exercised: a 500-message history page, the
chat list for a 1,000-conversation hub account, and global search across 1,000 chats. The probes
also showed that on this backend an index-range read's cost grows with the size of the range (even
`take(1)` on a 50k-row table), so anything comparing a heavy user to a light one needs bounded
ranges: I capped each user's materialised Following timeline at 400 items, moved Trending onto a
small 24 h candidate table, and deferred fan-out for large audiences so it never queues ahead of the
author's own writes. After a one-time migration all four ratio rules sat well inside 3×.
