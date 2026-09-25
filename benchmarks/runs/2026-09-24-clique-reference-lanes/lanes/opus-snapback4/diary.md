# Clique on Snapback 4 — run diary (opus-clique-snapback4-ref-20260924)

## M1 — Accounts and profiles (green 2026-09-25T00:28:46Z, epoch 1790296126)

**Built.** Expo Router app (web export + iOS Hermes export) over `createApp` with
`webDevice()` on web, `snapback4-expo`'s `nativeDevice` on native, SecureStore /
explicit `localStorageSessionStore()` for session persistence. Backend is one
Quarry file: `use identity password`, a public `sync public` `profiles` table
with `unique handle else HANDLE_TAKEN`, `search displayName, handle`, an
`image` avatar column, and a handful of queries/mutations. A shared replay
library (`scripts/lib/replay.mjs`) drives the real `/auth` + `/m/<op>` wire and
powers `npm run seed`; the acceptance runner validates a coverage manifest
against the instrument's assertion list.

**Easy.** Password auth was a single `use identity password` line — Argon2,
seven-day sessions, logout revocation and duplicate-email refusal all built in.
Avatar upload was `client.upload(blob)` then a mutation taking `{ id }`; the
asset inherits the public profile's read rule, so there was no storage policy
to write. Live profile edits on the other client needed zero code: the profile
table is synced and `useQuery` re-rendered when the stream arrived. `check`
compiled on the first try and generated precise types (including docs on
`runs: device` / `predicts: eligible`).

**Fought.** Nothing in the backend. One self-inflicted loop: Metro resolved
`pick.ts` before `pick.web.tsx`, so the web file input never mounted (agent
error; renamed to `pick.web.ts`). The Expo starter is not Expo Router, so I
added the router, Slot-based shell and SPA static server myself.

**Familiarity.** Knowing Expo Router / RN-web conventions and Playwright's
file-chooser semantics saved time. Nothing Snapback-4-specific was known
beforehand; the README + guide cards were sufficient.

**Missing.** `createApp` has no `assets` option, so the documented
`keep: "viewed"` media retention (only on `createLocalClient`) is not
reachable from the ordinary app entry point — recorded as a gap for M6
offline media. Handle availability before signup needs guests (`use identity`),
so a password-only product creates the account first and then refuses the
handle on the profile write (the README says exactly this).

**Compared.** Versus Convex (auth via a separate library, hand-wired storage
URLs) and Supabase (GoTrue + RLS policies + storage bucket policies), this was
the least ceremony I have seen for auth + profile + avatar: one schema file,
no policies duplicated between database and storage.

## M2 — Posts and the follow graph (green 2026-09-25T00:36:11Z, epoch 1790296571)

**Built.** `posts` (originals and replies in one table, `parentId` optional),
`reposts`, `follows`, `likes`, all `public` + `sync public`; the paved
`view activity` union and `view following: activity where .actor = viewer or
exists follows[viewer, .actor]`, which the engine materializes per reader.
Like/repost counts are maintained columns on `posts`; follower/following and
reply counts are maintained views. Feed UI = FlatList over `usePage`, kit
`FeedCard`, a thread route and a persistent header carrying the feed tabs
(the harness clicks feed tabs while on a profile page, so tabs live in the
shell). Seed verbs follow/post/like/repost/reply use deterministic fixture ids
and write ids so re-runs replay instead of duplicating.

**Easy.** The Following feed was a two-line declaration: the engine owns
fan-out, backfill on follow, and purge on unfollow; self-inclusion came from
`.actor = viewer`. `check --cost` showed Global as constant work and Following
reading a materialized per-reader inbox. All nine M2 choreography checks
passed on the first run — live likes, reposts, follow projection and reply
counts needed no client-side subscription code at all.

**Fought.** Only my own UI: the composer cleared its text after an async
submit, wiping text typed for the next reply (agent error), and FlatList
virtualization hid page-2 items from the pagination test (agent error).

**Familiarity.** Standard Twitter-clone modelling; nothing platform-specific
was assumed. The feeds card literally names Clique's fixture sizes, which
made trusting the declared shape easy.

**Missing / notes.** Everything public is `sync public`, so every device
acquires every post, like, repost and follow; the card is explicit that page
size does not bound acquisition. That is the platform's chosen trade for
offline feeds; it is a scale risk I will measure at M6.

**Compared.** Convex would need a hand-written fan-out (or a read-time
`in` over followees with pagination pain) and Supabase an RLS'd view or RPC;
here the timeline is a declared read-model with correct unfollow semantics.

## M3 — Messaging core (green 2026-09-25T00:44:17Z, epoch 1790297057)

**Built.** `conversations` / `members` / `messages` synced `to members[...]`,
`dmIndex` (one row per owner with `unique owner, other`) for DM dedupe,
`typing` with `expire at`, per-membership `deliveredOrdinal`/`readOrdinal`
watermarks, and a per-conversation `lastOrdinal` counter so messages carry a
server-arrival ordinal. Receipts are derived client-side from the synced
roster (recipient set = members who joined before the message). An app-wide
background hook acknowledges delivery when the device receives a newer
ordinal; opening a conversation marks it read. `retain delivered-history` gives
removed members their pre-removal history; route resolution is sticky so the
open screen keeps rendering after removal.

**Easy.** Every M3 choreography check passed on the first run: live DMs,
typing within 2 s / gone within 5 s, sent→delivered→read, the group aggregate,
add/promote/remove/leave with live cutoff, quoted jump. Typing needed only a
table with `expire at` plus the documented client-side deadline filter. The
removed-member semantics were a single `retain` line. `why send` explained
exactly which reads were held vs. horizon and that presence decides only
effects.

**Fought.** Nothing platform-side. Kit shape: the per-message actions must be
descendants of `sm-convo-bubble`, so I wrap the kit bubble in my own
`sm-convo-bubble` view that also carries the action row.

**Familiarity.** WhatsApp-style receipt watermarks and the "membership at send
time" recipient set are design knowledge, not platform knowledge.

**Missing.** No first-class receipt primitive; watermarks were the obvious
model and the rules/sync made them cheap. Group title routes need client-side
resolution (no server-side "find my group by title" without a non-uniform scan).

**Compared.** In Convex this is similar code but typing would be a table plus
a cron to clean it; here expiry is declarative. In Supabase, Realtime presence
would be the typing channel and receipts an RLS'd table — more moving parts.

## M4 — Media messages, reactions, edit/delete (green 2026-09-25T00:48:21Z, epoch 1790297301)

**Built.** `image`, `video` and `image … once` columns on `messages`; `send`
checks kind/media consistency and the server-sniffed video duration (≤60 s);
`reactions` keyed `(conversationId, messageId, principal)` with a
per-message cap so first reactions predict offline; `reactionCounts` view for
chips; `editMessage`/`deleteMessage` check `now - msg.at` against
`editWindowMs()`/`deleteWindowMs()`, generated from the windows config file.
Delete clears the asset columns, so `/assets/<id>` stops serving immediately.

**Easy.** Asset revocation needed no storage code: clearing the column is the
revocation, and non-members get 404 because assets follow the home row's read
rule. Window enforcement uses the server's `now`; `POST /dev/clock/advance`
made the "edit after the window is refused" test take one second instead of
a minute.

**Fought.** Two UI races of my own (web video attach awaited poster
generation; viewer testID on a late-mounting `<video>`). No platform issues.

**Compared.** Supabase/Convex would each need signed URLs or a storage policy
mirroring message membership plus explicit object deletion; here the asset is
a typed column and the row's rule is the storage policy.

## M5 — Ephemeral, chat config, search (green 2026-09-25T01:02:03Z, epoch 1790298123)

**Built.** Disappearing messages are one computed field on insert
(`expiresAt: now + ttl`, ttl from the chat's setting via a generated
`disappearTtlMs()` helper) plus `expire at .expiresAt` on the table. View-once
is an `image … once` column (the server serves one view per principal and
answers 410 after) plus a `viewOnceOpens` table for the UI's opened state.
Chat color/background are conversation columns guarded by an admin check in
groups. Search is `search body` / `search displayName, handle` with the
card's `matching` queries: people, in-chat, and all-chats grouped by chat.

**Easy.** Expiry is genuinely server-enforced with no client or job: the
disappearing choreography closed both browsers, waited five real minutes, and
the rows were gone from the server, the devices and search. View-once refusal
was a column modifier. Warm-offline search needed no second implementation:
the same `matching` queries run on the device over held rows when the link
drops — the offline indicator was the only UI work. The dev clock endpoint let
my suite cover the 3-minute expiry in a second.

**Fought.** Nothing in the platform. One test-side loop (CSS uppercase).

**Missing.** Search is word-prefix only (documented), which the brief pins
anyway. Non-uniform "search every chat" server scans are metered and report
`complete: false` beyond limits — the grouped form handles it.

**Compared.** Every alternative I know needs a second offline search index
(SQLite FTS on device, Postgres FTS on server) and a purge job for expiry;
here one declaration covered both sides and expiry is part of the table.

## M6 — Offline writes, push seam, custom-client API (web green 2026-09-25T01:02:30Z, epoch 1790298150)

**Built.** Offline writes are the local-first client's durable outbox: the
`send` mutation predicts (its reads are all held), so a message composed
offline renders immediately with `pending: true` (the bubble shows the
`pending` receipt) and flushes in order on reconnect, then walks
sent→delivered→read through the same watermarks. The push seam is
`if not exists connected[m.principal]: emit push {...}` inside `send`, with a
generated `server()` effect handler (`snapback/server.ts`) that appends each
payload to `logs/push.jsonl`. The custom-client API is the native wire:
`/auth/*`, `POST /q/apiConversations|apiHistory|apiMessagesAfter`,
`POST /m/send`, and a documented `/changes` long-poll (API.md,
`scripts/custom-client-demo.mjs`, Node built-ins only). The replay adapter
(`scripts/lib/replay.mjs`) implements all 13 verbs with deterministic
fixture ids/write ids and passes the sample-50 conformance check with a
state-vs-intent verifier.

**Easy.** Offline queue + ordered flush + pending state were free: the M6
choreography passed on the first run with zero offline-specific code beyond
rendering `row.pending`. Presence-gated push was one `if` in the mutation —
the engine defers absence decisions through the connection grace window.
`--replay` is a first-class dev flag that suppresses effects and holds
schedules for the scale replay.

**Fought.** The generated server entry refused to typecheck until I marked
`snapback/` as ESM and referenced Node types explicitly (the diagnostic was
accurate; the docs say to install `@types/node` but not that the Expo
tsconfig hides it) — recorded as ambiguous.

**Missing.** `createApp` exposes no media-retention option, so previously
viewed media is not retained offline through the ordinary app entry point
(the lower-level `createLocalClient({ assets: { keep: "viewed" } })` has it).
No simulator artifact was produced (not required this run).

**Compared.** This is the milestone where Snapback 4 is furthest ahead:
Convex and Supabase need a hand-built outbox (or a third-party sync engine)
for queued writes, and push-on-absence needs connection tracking; here both
are properties of the platform.

## M8 — Insights, digest, multi-device offline (web green 2026-09-25T01:08:26Z, epoch 1790298506)

**Built.** Insights are six maintained aggregate views (`count posts where
.parentId = null by .authorId`, `count likes by .postId.authorId` — the
engine records the one-hop attribution — reposts/replies received, and
follower/following counts) plus two calendar views bucketed by `day(.at)`;
the `insights` query assembles the trailing seven UTC days with a `range`
loop, so empty days are zeros. Trending is a predicate read over the
maintained `likeCount` column: originals with `.at > now - 1d and .at <= now`,
`last 10 by .likeCount, .at`. The daily digest is a `job` swept per profile,
counting new followers, new originals by followed accounts, and unread
messages through the user's *own* memberships, emitting through the same
`push` seam with `once [user, periodEnd]`; its `schedule` line is generated
from the digest config (every 2 m under the shortened profile). Multi-device
convergence and dual-offline ordering needed no new code: the watermark and
ordinal design from M3 plus the outbox already did it.

**Easy.** All five M8 choreography checks passed on their first execution
(the one later failure was my own dev-instance pollution — suite posts pushed
Alice's posts off Bob's first Global page). The digest is authorization-safe
by construction (it only walks the recipient's memberships), idempotent across
retries/restarts via `once`, and testable with `clock advance 2m`. Backdating a
post for the ">24 h is absent" check was `snapback4 run createPost … --now`.
`doctor` showed schedule boundaries, job chunks and effect counts directly.

**Fought.** Nothing platform-side. Dev-clock advances (used by my suites for
windows) skew server time versus browser time until a dev restart; I
restarted dev before the M8 choreography.

**Missing.** No simulator artifact for the durable-queue restart proof (not
required this run); the web outbox is durable in IndexedDB by the SDK's
contract but I did not separately prove kill/relaunch on web.

**Compared.** Aggregates-as-declarations beat both Convex (hand-maintained
counters or paginated counting) and Supabase (materialized views + refresh or
triggers). Scheduled work being a `job` + `schedule` in the same schema file,
with `--replay` holding schedules, is simpler than cron + edge functions.

## Scale replay (own clock) and final regression

**Scale replay.** A fresh `dev --replay` instance, seeded with the starter log
through the same adapter, took all 167,157 scale actions in 932 s of replay
wall (~180 settled actions/s, one at a time) and conformed to the invariant
manifest exactly at 10%, 50% and the end — counts, per-user and per-chat
tallies, the named O5 fixtures (including paging all 10,000 g0001 messages
through the API) and the spot entities. Read probes stayed flat at 1–3 ms p95
across the three sizes (Following for the 500-follow user, deep history,
global search, Insights, Trending). The one failed degradation rule — the
celebrity post-create p95 — was measured while the shared host's load average
sat between 79 and 188 on 18 cores; follow-up measurements showed the same
latency for a zero-follower author and identical metered engine work for the
celebrity, so I believe it is contention, but it is recorded as failed.

**Regression.** Re-running every suite after M8 caught two real bugs of mine
that only appear under client/server clock skew: Trending ran on the device
(its `api.ts` entry said `runs: device`), so its 24-hour window used the
browser clock instead of server time; I made it read an online-only aggregate
so it runs on the server. And a pending (predicted) reply sorted by device
time. The skew itself was self-inflicted — my suites advance the dev clock to
test edit/delete/expiry windows — and it also produced future-dated posts that
hid fresh posts from Global's first page until real time caught up.

**Lesson.** The dev clock endpoint is excellent for testing windows, but it is
process-global; a lane that shares one dev instance between suites and
choreography should either restart dev after clock tests or run them on a
separate instance.

**Correction (after a lower-load re-measure).** The celebrity write-path tail is
not just contention: `why createPost` shows the insert is constant (4 writes),
but the declared Following timeline then delivers ~900 inbox copies per
celebrity post in background chunks on the same single-writer engine, so a
burst of celebrity posts queues behind the previous post's delivery. The
per-write acknowledgement does not scale with followers; a back-to-back burst
does. That is the declared timeline's fan-out-on-write trade, visible exactly
where the brief said it would be.
