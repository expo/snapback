# Closing essay — Clique on Supabase (lane glm-supabase, web-only M1–M6+M8, M7 skipped)

## The run in one paragraph

This was the strangest build I have ever shipped, and the strangeness had almost
nothing to do with Supabase. The lane directory was shared by several relaunched
agent sessions of the same model; the hosted Supabase project was apparently
shared by more than one lane. Files were wiped under me twice, the frozen UI kit
was corrupted once, my database functions were overwritten mid-run by a sibling
lane's deployment of the same namespace, and foreign choreography posts flooded
my feed during my own verification runs. Against that background, the parts of
the run that belonged to the product — schema, RPCs, auth, storage, realtime,
the Expo Router client, the frozen kit, the suite, the choreography harness —
behaved exactly as a good platform should.

## What Supabase felt like

Supabase is the most "legible" backend I have used for this kind of app. Every
rule the brief demanded had an obvious, honest home:

- Server-authoritative windows, membership, view-once, and disappearing
  semantics went into SECURITY DEFINER Postgres functions callable over
  PostgREST. The database *is* the API; there is no second implementation.
- Edit/delete windows read a config table so the grading pack can shorten them;
  window checks compare against `now()` — a caller can never smuggle a
  timestamp.
- Receipt aggregation for groups and the recipient-set-at-send-time rule are
  one SQL expression each; "the aggregate shows a state only when every current
  member reached it" is literally a `count(*) = count(*) filter (where ...)`.
- View-once, tombstone, and expiry denial for media assets live in a single
  `can_access_media(path)` function that storage RLS policies consult — the
  direct object fetch is refused by the same rule the RPC uses. One predicate,
  two doors.
- The push seam is a trigger-called function consulting a presence table;
  digests are a pg_cron job over a period table whose primary key makes
  emission idempotent under retry and restart for free.
- Word-prefix search is one regex helper shared by people and message scopes.

Ergonomically, the moments that stand out: (1) applying DDL through the
Management API, I hit "any error rolls back the whole batch" — undocumented as
far as I found, but the failure message named the exact policy that already
existed, and splitting statements fixed it; (2) pg_cron accepted `30 seconds`
schedules and the digest tick's idempotency needed no extra machinery; (3) when
a sibling lane overwrote `message_send` with a variant that failed with
`invalid input syntax for type uuid: "Alice Alvarez"`, the error named the exact
value and the exact cast — I diagnosed a *foreign deployment* in one query to
`pg_get_functiondef`. Supabase's errors are documents.

The honest gaps: JWT semantics ("logout revokes the session" really means the
refresh token; access tokens live until expiry — I set `jwt_exp` low once and it
poisoned my own realtime behavior, which the docs do not warn about); storage
`?token=` is not accepted on `/object/authenticated/` (you need headers, which
`<img>` cannot send — hence blob-fetch indirection); and react-native-web 0.20
silently dropped the kit's object-form `accessibilityValue`, leaving the frozen
kit's contract semantics unrenderable without a node_modules shim. None of these
were fatal; all cost time exactly where the docs were thin.

## Compared with the alternatives I know

Against **Convex**: Convex gives you functions and a reactive client out of the
box, so "live queries" need no design, and its mutations are transactional
without thinking. Supabase makes you choose where each guarantee lives (table,
function, trigger, cron) — more decisions, but each decision is *in the
database*, inspectable with psql-grade tools. For this app, I would rather
declare the model in Postgres: the follow graph with projection-scoped unfollow,
the recipient-set receipt rule, and digest idempotency are declarative one-liners
in SQL, while in Convex they become imperative functions whose performance
characteristics at the envelope are on me. Convex would have won the offline
authoring dimension, though: its client sync story is a product, whereas my
offline layer is a hand-rolled localStorage outbox plus cache mirror — honest
B4 work.

Against **PocketBase**: PocketBase wins cold-start ("one binary, real-time
subscriptions, admin UI"), which is exactly what its high B9/B11 scores
predict. But at this app's complexity — per-recipient receipts, view-once
views, period digests, celebrity fan-out — PocketBase's Go-free extension model
(JSVM hooks) starts to feel like writing Postgres triggers without Postgres.
Supabase's SQL is the more honest home for the hard 20% of this brief, and the
scale envelope (50k posts, 10k-message chat, 900-follower celebrity) is where
Postgres stops being a luxury.

Against **the Snapback family** (experienced in other lanes of this wave):
Snapback's single-process dev loop and bundled realtime are lovely for the
first hour; the guide profile and backend-shaped scaffolding front-load
progress. But this brief's *server-authoritative* demands (refusal of expired
content, recipient sets frozen at send time, scheduled emission) are exactly
where a hosted Postgres with RLS and cron has principled answers. If Snapback
is a co-pilot, Supabase is a machine shop: more setup, more sharp edges, and no
ceiling in sight.

## The meta-experience

The defining event of this run was not technical: I shared a lane with other
instances of myself. We fought through the same files and the same database
namespace; the honest outcomes of that fight are recorded in run-log.md rather
than laundered into green receipts. What the fight *did* prove: every durable
artifact — the Postgres schema, the RPCs, the storage ACLs, the cron job —
survived everything, while every file-system artifact had to be rebuilt. In a
week where backend state lives in a hosted project and code lives in a directory
someone else can truncate, the backend is the memory. That, more than any
single feature, is my closing impression of Supabase: its state is real enough
to outlast the processes that create it.
