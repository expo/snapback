# Building Clique on Convex — a closing essay

*Written after M8 went green and before tallying any run numbers.*

## What the work felt like

Most of this build was spent writing application logic, not plumbing. That is the headline, and
it is the thing Convex is designed to buy you. I wrote the schema, then about a dozen modules of
TypeScript functions, and the first draft of the entire client — twenty-odd files of Expo Router
screens — typechecked on the first try against generated `api.*` references. The choreography for
M1, M2, M3, M4, M6 and M8 passed on its *first* dry run in each case; the misses I did have were
almost all my own client bugs, not platform surprises. Reactive queries are the reason. Every
"without manual refresh" clause in the brief — live profile edits, like counts, reply counts,
repost attribution, typing indicators, receipt ticks walking from sent to delivered to read, the
group aggregate waiting for the slowest member, the removed member's live cut-off, cross-device
unread state — was satisfied by writing an ordinary query and subscribing to it. I never wrote a
channel, a pub/sub topic, a cache invalidation, or a "notify clients" step. Receipts became a pure
function of two watermarks per membership, and because the query reads those documents, the ticks
move by themselves.

The second big reducer of friction was that the backend is TypeScript executed transactionally.
Idempotency keys, set/clear intents, "check the edit window against server time", "delete the
media in the same transaction as the tombstone", "one digest per user per period" — each of these
is a few lines inside a mutation, with serializable isolation making the reasoning simple. When I
had a race (a scheduled backfill that didn't land under load), the fix was to move the first page
of work *into* the follow mutation, where serializability guarantees every feed item is either
visible to the follow or its fan-out sees the new edge. That kind of argument is pleasant to make.

Scheduling is first-class and it changed the shape of two milestones. Disappearing messages are
`scheduler.runAt(expiresAt, expire)` from the send mutation — genuinely server-enforced with no
client open, verified by a test that waits out the TTL. The daily digest is a cron plus batched
scheduled mutations with its state in tables, so restarts and retries can't double-emit. On
Supabase I would have reached for pg_cron plus an edge function, or an external worker; on
Firebase, a scheduled Cloud Function with weaker transactional guarantees. Here it was all in the
same codebase, deployed by the same `convex dev --once`.

The custom-client API was nearly free, which surprised me. The functions my web client calls *are*
a documented, typed, streaming API. A third party needs the `convex` npm package, a JWT from the
`auth:signIn` action, and function names; `ConvexClient.onUpdate` gives them a live message stream.
`API.md` is mostly a table of field meanings.

## Where it added friction

**Offline is entirely yours.** Convex's client queues mutations while the socket is down, but not
durably, not visibly, and there is no persisted query cache. Everything the brief asks for offline
— the durable ordered write queue with a pending state, cold-start reads, synced-message search
while offline, purging revoked content on reconnect — I built by hand: a key-value store over
localStorage/AsyncStorage, an outbox of idempotent intents, a history-sync agent, and a second
implementation of the search matcher for the local store. It is not much code, but it is exactly the
"own cache, own queue" that the offline-ergonomics rubric describes as the low end. The platform's
guarantees in this area were easy to determine only because there are essentially none to find.

**Ephemeral state is durable state.** There is no presence or broadcast primitive in the core
package, so typing indicators and "does this user have a connected client" (for the push seam) are
tables written by heartbeats. They work — the typing choreography passed all three timed attempts —
but every keystroke heartbeat is a durable write that invalidates the chat list query for everyone
in the chat. Supabase Realtime's Presence/Broadcast and Firebase's `onDisconnect` are better fits
for this narrow slice.

**Search is relevance-shaped.** Convex's full-text index prefix-matches only the final term and
ranks by relevance. The brief's pinned semantics (every term a word prefix, newest first) needed a
candidate-then-filter step, and "newest first" is only exact within the candidate window. Postgres
would have let me say what I meant in SQL.

**Aggregates are hand-maintained.** Insights and trending are counters and per-day buckets that I
update inside the write mutations. That is O(1) at the scale envelope and was quick to write, but
it is the kind of thing a `count(*) … group by day` makes unnecessary on a relational backend.

**Auth is a library, not a service.** Convex Auth fit the "built-in auth with password
credentials" requirement and composed well with the data layer — every function checks the
session row, so logout kills a token instantly — but I had to generate signing keys myself, and two
behaviours were only discoverable in the package source: `signUp` with an existing email and the
correct password silently signs the user in (the brief wants a visible rejection, so I wrapped the
provider's internal `authorize`), and the Scrypt hash runs *inside a mutation*, where on this very
loaded shared host one registration in the scale replay exceeded the one-second mutation limit.
Bounded retries were safe because every verb is idempotent, but a platform that hashes in an action
or natively wouldn't hit that ceiling.

**The dev loop has sharp edges.** Anonymous local development worked without an account, which was
great, but watch-mode `convex dev` silently starts a dashboard on a fixed port outside my allowed
range, with no flag to move it. I ended up running the `convex-local-backend` binary myself on
127.0.0.1 in my port range and deploying with `convex dev --once` against a self-hosted URL and an
admin key minted with the binary's `keygen`. That turned out to be a better workflow anyway —
fresh instances for the scale replay became a one-command affair — but I only found it by reading
the CLI bundle. Function logs don't show scheduled-function outcomes by default; I wrote a small
internal query over `_scheduled_functions` to see them. On the other hand, the errors I did hit
were precise: `InvalidCursor` told me exactly that my paginated query's index range had changed
between executions (a real bug — I had bounded the range by a value that moves with every message,
and the React hook had been silently restarting pagination to hide it).

## Compared with Snapback, Supabase, and the rest

I don't have hands-on experience with Snapback in this session and I was not permitted to look at
it, so I can only say where I would *expect* the comparison to bite, given what this brief measures.
The brief is visibly written by people who care about offline-first sync and ephemeral state as
first-class concerns — durable queues, cold-start reads, view-once never cached, multi-device
convergence. Those are precisely the places Convex leaves to the application. If Snapback provides
a local store with sync semantics, a durable write queue, and presence as platform features, it
should make M5/M6/M8 materially smaller than they were here, where that layer is a few hundred
lines of my own code with my own bugs.

Against Supabase, Convex wins on liveness and on server-side logic: no RLS policies to keep in sync
with application code, no separate edge-function runtime, no Realtime subscription filters to get
right, and transactional TypeScript for every rule. Supabase would win on search, aggregates,
ad-hoc inspection (SQL), and on auth being a hosted service with an admin UI. Offline would be
equally hand-built on both. Against Firebase/Firestore, Convex is strictly more pleasant for this
app: real transactions, typed functions, text search, and scheduled work in one place; Firebase's
remaining advantages are its offline cache and `onDisconnect`.

The shape of the work changed in one important way: on Convex, "the backend" and "the API" and
"the realtime layer" collapsed into one set of functions, so the natural unit of design was the
mutation — what must be true atomically — rather than the table or the endpoint. Fan-out on write,
receipts as watermarks, idempotent intents, digest runs as rows: each of those decisions was made
by asking "what does one transaction need to see?". That is a good question to be forced to ask,
and it is why so few of this build's defects were data-correctness defects.
