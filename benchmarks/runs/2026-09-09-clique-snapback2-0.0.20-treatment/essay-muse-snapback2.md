# Building Clique on Snapback 2: a backend comparison from inside the run

This essay was written after M8, before tallying numbers, by the continuation
session that closed the lane (the original builder was stopped at the M5 wall;
see the disclosure in `run-log.md`, `diary.md`, and `final-report.md`). It
compares one full build on Snapback 2 (`snapback2@0.0.20`) against Convex,
Supabase, and the Firebase-style backends I know from model knowledge and
prior work. Every claim below is anchored to something that happened in this
lane; the diary entries are the receipts.

## Where Snapback 2 reduced friction

**The owner model made the backend feel like a local process, and that
changed everything about iteration.** `snapback2 dev` on port 50700 held the
database, the Quarry backend (72 ops at first cert, gen `46086a4d` after a
factory reset), and the effect runner in one long-lived process that survived
the entire lane — it answered HTTP 200 in 113ms seven hours after boot, across
a session boundary. Compare Convex, where the backend is a cloud deployment
(or a local simulated peer that still pretends to be remote): every iteration
round-trips through deploy tokens, deployment selection, and dashboard state.
Here there was no deploy step at all. `snapback2 check` compiled, certified,
and refreshed types in seconds, and the generated `api.d.ts` meant the client
never hand-wrote an endpoint name. Supabase gives you a real Postgres and a
generated API too, but you still think in terms of migrations, RLS policies,
and a hosted project; Snapback's loop was tighter than either: edit `.q`,
check, reload the page.

**Quarry's viewer-gated rows dissolved the auth layer I would have built by
hand elsewhere.** Conversations, messages, reads, and profiles all resolve
against the token's principal, so cross-user DM access is refused by
construction rather than by policies I had to remember to write. The diary's
proudest one-liner — "a logged-out client gets `E_AUTH_REQUIRED`, reusing the
old token gets `E_AUTH_SUPERSEDED`" — fell out of the session model, not out
of code I wrote. On Supabase this would have been a page of RLS policies with
exactly the kind of permissive-default bug the holdout probes are designed to
catch; on Convex it would have been `ctx.auth` checks in every function, each
one a chance to forget. The token story the brief demanded for the
custom-client API (scoped, expiring, revoked on logout) was three paragraphs
of `API.md` describing behavior the platform already had. That is the shape
difference: Snapback moved a whole category of security work from code I write
to structure I inherit.

**The replay adapter turned idempotency from a virtue into a habit.**
Because seeds replay through the app's own write path with fixture IDs as
mutation clientKeys, reinstalling a segment converges instead of duplicating —
M1/M2/M3 seeds are idempotent, and the scale adapter (`scripts/replay.mjs`)
rides the same mechanism. I have never gotten that property this cheaply on
any other backend. On Convex or Supabase, seed idempotency is a script I write
and maintain, with upsert keys I choose and dedupe bugs I own. Here the
dedupe key is part of the mutation contract, so every write path — seed,
replay, retry, offline flush — is idempotent by default. The offline queue the
brief requires is philosophically the same object as the seed script, and once
I saw that, both got simpler.

## Where Snapback 2 added friction

**The offline-first drain is a distributed system wearing a function-call
costume, and the costume fools you for weeks.** The single hardest stretch of
the lane — the M4 latency saga and all thirteen M5 attempts — had one root
theme: a client-local "commit" is not an owner-side application, and the drain
that bridges them is serial, contended, and invisible. Symptoms I chased for
days (30–60s mutation settlement while node settled in 16ms; markRead
murdered by a concurrent markFetched with `E_OFFLINE_CONFLICT`; per-message
subscriptions melting 40-message threads; observer media fetches losing to a
saturated commit queue on a loaded box) all reduced to queueing dynamics that
no guide page names. Convex's reactivity is server-driven and total-ordered —
when a mutation commits, every subscriber converges promptly and there is no
local shadow state to reason about. Supabase Realtime is cruder but equally
honest: you know exactly what you subscribed to and what you didn't. Snapback
sits in between — local optimistic state, background sync, live invalidation
that arrives in ~15s heartbeat clusters — and that middle is where all the
bodies are buried. I fixed each instance (chained marks, conversation-wide
queries, a 10s WarmSyncBeat that cut observer latency from 60s to 618ms), but
each fix was bespoke queue management, the kind of work server-driven backends
simply never ask of you. The M5 capability-failure is, at bottom, a
throughput story: the product was correct, the sync was too slow under
contention, and four hours was not enough to make a shared box fast.

**Effects are declared authority with an undisclosed execution context.**
The `delivery.ts` notify effect that fetched `https://api.example.com` —
black-holing every outbox drain for 30s per mutation — was my bug, and the
fix (a no-I/O stub retaining the declared grants, with the `pushLog` insert
as seam evidence) took minutes once diagnosed. But the diagnosis took far
longer than it should have because nothing in the programming model tells you
that emitted effects gate drain settlement. On Convex, actions and mutations
have crisp boundaries: mutations commit fast and cannot do I/O, actions can do
I/O and cannot commit. The constraint is the documentation. Snapback's model
is arguably more expressive (offline-tolerant effects with grants as future
authority), but the failure mode — one chatty effect silently serializing
behind every user intent — is the worst kind: everything works, just slowly,
and slowness reads as "the platform is slow" rather than "my effect is in the
drain path." A single sentence in the guide ("emitted effects settle before
the outbox drains") would have saved a day.

**Assets are auth-shaped in a way the client framework cannot see.**
Quarry's owning-row read rule is principled — a tokenless `/api/asset/<id>`
URL 404s, an authed fetch 200s — but a plain `<img>` tag cannot send headers,
so every image and video surface needed a blob-URL choke point
(`useWebBlobUrl`: mint URL, re-fetch with session headers, expose `blob:`),
plus bounded retry once observer fetches started losing. On Supabase, signed
URLs solve exactly this: time-boxed bearer URLs the dumbest `<img>` tag can
render. On Convex, `getUrl` returns an authorized URL with the same property.
Snapback has the validator (`height/id/width` exactly — I found that by
reading minified code, a low point) and the bytes endpoint, but no
pass-around grant, so I built a per-surface fetch-and-revoke machine instead.
It works and it is arguably more secure, but it is undeniably more code, and
the residual risk the diary flags (old Bearer URLs resolving after delete) is
the kind of thing signed-URL expiry answers structurally.

**The small-paper-cut ledger is real.** No `substr` primitive (worked around
for push preview truncation). `accessibilityValue` silently unmapped by the
pinned react-native-web while the vendor kit itself used it — the M2 frozen
rerun died on a prop the kit blessed. `accessibilityState.selected` dropped
the same way, turning a palette click into a no-op for a full attempt.
Signup returns no replay grant while login does (auto-login after signup is
now load-bearing app logic compensating for a platform asymmetry). Reaction
`at` is immutable where the update path assumed mutable. None of these is
fatal; together they cost something like two days, and every one of them was
discovered empirically rather than documented.

## How the shape of the work differed

On Supabase, the shape of a messaging build is: schema → RLS → storage
policies → realtime subscriptions → edge function for the digest → client
caching you own entirely. The database is superb and everything else is
assembly. On Convex, the shape is: schema → functions with auth checks →
reactive queries that just work → actions/scheduler for the digest → client
that is mostly presentational. The backend does more; you write less; you
trust the cloud.

On Snapback 2, the shape was: schema+rules as one Quarry unit → generated
client → then the great inversion — most of my engineering went into the
client's relationship with sync (outbox discipline, paging budgets,
stash persistence across reloads, heartbeat warmth, blob-URL plumbing). The
backend proper (conversations, messages, reactions, push seam, expiring
messages with a purge chain) came up fast and stayed up; the diary's backend
bugs fit in one hand. The client/sync layer took the other four hands. That
is the honest summary of the tradeoff: Snapback gives you a secure,
offline-capable, replay-friendly data core with less code than either
alternative, and charges you in sync dynamics at the edge — latency
forensics, drain hygiene, and warm-client choreography that server-driven
backends absorb invisibly.

Would I choose it again for this brief? For M1–M4 — yes without hesitation:
accounts, DMs, groups, media, reactions, search, all offline-tolerant, went
green on a stable core with genuinely little code (~1,000 lines of Quarry and
seed for the whole backend). For M5's realtime-choreography tail and M6/M8's
offline depth — only with eyes open about what the edge costs, a quieter box,
and a guide that documents the drain. The platform's best ideas (viewer-gated
rows, clientKey idempotency everywhere, cert-time schema checks) are the ones
that remove categories of work; its weakest spots are the ones where the
abstraction leaks timing. Leaks can be learned — the diary proves that — but
they have to be written down, which is what the gap list in the final report
is for.
