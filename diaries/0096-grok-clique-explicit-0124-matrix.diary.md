# Diary 0096: grok-clique-explicit — 0.1.24 model×profile×app matrix lane

**Date:** 2026-08-17/18
**Run:** model×profile×app matrix on published Snapback 0.1.24
(`benchmarks/runs/2026-08-17-model-profile-app-matrix/`)
**Lane:** `grok-clique-explicit` — Grok 4.6 (grok CLI, xhigh)
**App:** Clique (Expo Router web); Snapback explicit profile, published 0.1.24 from npm
**Outcome:** M1–M3 green
**Wall:** 4,336s · **Cost (approx., public list prices):** $28.51
- Output tokens: 141,020
- Fresh input 1,091,051; cache reads 50,955,520; reasoning 124,426

This diary's build narrative and essay are the lane agent's own words, written
milestone-by-milestone during the timed build per the lane prompt; the
orchestrator added only this header. N=1 exploratory calibration evidence, not
scored or claim-eligible (LLP 0201 D5). Machine load was shared with
concurrent fleet work — per-lane loadavg samples are retained with the run
record. 

# Diary — grok-clique-explicit

## M1

Built Snapback explicit-profile accounts and profiles on the expo-chat scaffold: password sessions (`durable-required` so web reload keeps the session), `users` rows keyed by handle/principal/fixture, `ensureProfile`/`updateProfile`, avatar upload, Expo Router screens, and a headless replay of `starter-m1.log`.

Easy: built-in password signup, unique handle indexes, live profile queries. The start packet plus `define.d.ts` were enough to author the first schema.

Fought: `snapback dev` will not pin 42080, so the backend had to be started with `--startup-artifacts` and a hand-built Expo environment because `SnapbackExpoProvider` ignores a raw `binding` override (`SNAPBACK_APP_BINDING_UNAVAILABLE` / `OVERRIDE_UNCONFIRMED`). Expo `--localhost` bound IPv6 only. Auth-gate + Stack crashed after login until replaced with `Slot`. Inline handler helpers cannot close over module consts.

Explicit profile cost: refusal codes, `discloseUniqueConflicts`, and helper splicing rules are ceremony Convex does not charge. It saved a fight with implicit auth widening.

Missing: a documented “attach Expo web to an already-running `--port` server” path; the Guide search is fuzzy and does not return the named page unless you already know the URL.

## M2

Built follows, posts (text/images/video), likes, reposts, replies, Following/Global live feeds, and thread screens. Replay of `starter-m2.log` goes through the same mutations as the app.

Easy: JS live queries plus unique follow/like/repost mutation IDs. Once authorship was isolated, the suite was mostly a read of the seed.

Fought: durable custody is process-global in Node unless `storagePartition` is set — every persona wrote as Henry. Result contracts refuse `null` for optional fields. Choreography requires feed tabs on every route after a profile visit, and `sm-profile`’s first text line cannot be the kit’s Edit button or avatar initials.

Explicit profile saved unique indexes for follow/like/repost idempotency. It cost optional-null result-contract failures and an extra generate/reload.

Missing: a warning that multiple `createSnapbackAppClient` instances share durable auth without `storagePartition`.

## M3

Built DMs and groups, live message lists, receipts (sent/delivered/read on the write path), quoted replies, and ephemeral typing. Replay of `starter-m3.log` uses the same mutations as the conversation screen. Typing is a connection-keyed ephemeral collection: the surface observes, and the composer publishes a short lease then deletes after idle.

Easy: once membership and `sendChatMessage` existed, the live DM check landed on the first try. `useSurface` for conversation meta + messages is the right grain. Quoted-reply excerpt rendering was already in the kit; the jump is just `scrollToIndex`.

Fought: publishing typing through the surface `presence` value kept the lease alive for the whole non-empty draft, so Alice still saw “Bob is typing” at the five-second ceiling. The served guide is clear once you find it — `touch`/`delete` (or `useSnapbackActivityPresence`) — but `useSurface({ typing: value })` reads like a bound state, not a heartbeat. The harness also treats an optional implemented check as a segment failure, so `sm-convo-quote` had to live *inside* the `sm-convo-bubble` wrapper even though the kit puts the Reply action outside the bubble contract.

Explicit profile saved a typed ephemeral collection with an enforceable TTL instead of a homemade presence table. It cost another generate/reload cycle whenever the collection or result contract moved, and it refused `null` on optional quote fields.

Missing: a one-pager that says “surface presence value is a continuous publish; idle expiry needs `publish` + `delete`.” Also missing: the harness green rule (any implemented fail, including `required: false`) written next to the assertion list.

---

# Lane essay (verbatim)

# Essay — building Clique on Snapback explicit 0.1.24

I came into this lane with Convex, Supabase, Firebase, and a few generations of
hand-rolled Postgres + Express in my head. Clique is a small social app — accounts,
follows, feeds, DMs — the kind of thing those four stacks all claim as a weekend
project. Snapback’s explicit profile is not a weekend-shaped experience. It is
closer to writing a contract and then being allowed to write the product.

Convex is the nearest cousin. You declare tables, you write mutations and
queries, the client subscribes, and the room stays live. Snapback’s live queries
and session-scoped auth feel like that family. The difference is tone. Convex
lets you close over whatever you want and sort it out at runtime. The explicit
profile stops you at generate: refusal codes must look a certain way, optional
result fields must be omitted rather than nulled, inline handlers cannot close
over module constants, a seed helper cannot return a lone value when the
contract asked for records. Those refusals are annoying in the moment and
valuable later. They are also a different job than “ship the feed.” I spent
attention on the shape of the artifact that I would have spent, on Convex, on
the product.

Supabase is the opposite trade. You get a real database, RLS, storage buckets,
and a presence channel that is allowed to be a bit sloppy. You can put a typing
flag on a row, or track presence, or broadcast and not care. Snapback’s
ephemeral collections are stricter and, once you understand them, cleaner: a
connection-keyed map with a declared TTL, a publish budget, and no path into
durable history. That is better than the Firebase Realtime Database habit of
leaving `/typing/{uid}` around until someone remembers to delete it. It is also
easier to misuse from React. Binding a surface presence value to “draft is
non-empty” looks like the Supabase `track({ typing: true })` pattern and does
the wrong thing — it renews the lease forever. The Guide eventually says the
right thing (`touch` on keystroke, `delete` on idle). Finding that page from
the CLI search is guesswork. Convex’s docs and Supabase’s presence page would
have put the idle-withdraw example on the first hit.

Firebase still wins at “the client is the app.” Auth persistence, local cache,
and a security-rules file you can half-understand get a prototype on screen
fast. Snapback’s sessions auth with `durable-required` custody is the grown-up
version of that for web reload, and it worked. The Node headless client did
not: every `createSnapbackAppClient` in one process shared the same durable
session until `storagePartition` appeared. Firebase would have given each
Admin/client instance its own app name and made that obvious. Snapback buried
it. That single fact cost more product time than any schema decision.

Hand-rolled Postgres + Express would have been slower to first live query and
faster to debug afterward. I would have known why two users collided (one
cookie jar). I would have written a `typing` row with `expires_at` and a
cron, or a Redis key with TTL, and the choreography ceiling would have been
an SQL question, not a “does `skip` retract or only stop heartbeats” question.
I would also have invented an inconsistent auth story, an upload pipeline with
a hole in it, and a feed that is wrong under concurrent likes. Snapback’s
asset uploads, unique indexes on follow/like/repost, and generated function
references are the reason I did not invent those holes. The explicit profile
is a very good compiler for a backend. It is a mediocre teacher of the
compiler.

What I wanted from documentation, and did not get in one place: how to attach
an Expo web app to a Snapback process that is already bound to a chosen port;
that `SnapbackExpoProvider` will not take a raw binding override; that Guide
search is fuzzy and the real pages live under `/_snapback/guide/...`; that
surface presence is a publisher, not a React state mirror; that optional
result-contract fields are absent-or-value, never null. The start packet and
`define.d.ts` were enough to author the first schema. Everything after that
was a conversation with generate errors and a search box that does not believe
in titles.

Would I use this again for a real Clique? Yes for the durable half — schema,
auth, live feeds, uploads — if the team already wanted Snapback. I would not
choose it over Convex just to get a social MVP out. I would not choose it over
Supabase if the product needed ad-hoc SQL and a dashboard more than it needed
generated references. I would choose it over a blank Express repo if I cared
about the live query and asset story and I had already paid the generate-loop
tax once. The explicit profile saved me from a few silent inconsistencies. It
charged me in ceremony, in binding folklore, and in a typing indicator that
looked implemented until a second browser proved the lease was immortal.

The honest comparison is not “Snapback versus Firebase on features.” It is
“which stack lets a single engineer keep the model of the system in their
head while the tests get meaner.” Convex keeps the model small. Supabase keeps
the model familiar. Firebase keeps the model on the client. Postgres keeps the
model visible. Snapback explicit keeps the model in the artifact. That is a
real advantage, and it is also why the lane felt like talking to a typechecker
that had opinions about product.
