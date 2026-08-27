# Clique / grok-supabase diary

Lane: grok-clique-supabase. Backend: hosted Supabase (`@supabase/supabase-js` 2.112.4). Scope: WEB-ONLY M1–M6+M8, skip M7.

## M1 — accounts and profiles

Built email/password signup on Supabase Auth, profiles with server-side handle uniqueness, avatar upload, and session restore. The suite went green on the first honest pass: duplicate email/handle, avatar upload, and profile edit all mapped cleanly onto Auth + a unique constraint.

What felt easy: password hashing and sessions are the product, not a side quest. `signUp` / `signInWithPassword` / `signOut({ scope: "global" })` plus a small session table covered the checklist.

What fought: hosted Storage RLS refused authenticated uploads even with a `WITH CHECK (true)` policy to `public` (same JWT that succeeded at RPCs). Docker was absent, so there was no local stack to compare. The workaround is a lane-local media proxy on port 48301 using the service role after verifying the user JWT, and service-role uploads in the Node replay adapter.

Prior familiarity: Postgres unique indexes, JWT session mental model.

Missing: a Storage policy debugger that shows *which* role actually ran the INSERT. The error string is just "new row violates row-level security policy."

## M2 — posts and follow graph

Posts, likes, reposts, replies, Following vs Global, 20-item pages. SQL constraints and RPCs were straightforward. The follow graph as a real table with `(follower, followee)` primary key is exactly the model.

What fought: Expo Router web + the frozen kit's `accessibilityValue` does not become `aria-valuetext` under React Native Web, so the choreography harness could not see identities, media kinds, or repost attribution until we added visible web semantic bridges. Nested PostgREST embeds needed explicit FK hints (`PGRST201`). Feed N+1 queries made live updates miss 20s ceilings until we collapsed selects.

## M3 — messaging

DMs with a sorted-pair unique key, groups as entities, quoted replies, membership RPCs. Server-side admin checks were one `SECURITY DEFINER` function. Seed idempotency (replay starter twice, same post count) passed.

Realtime typing used broadcast channels named `clq29_grok_typing:*`. Receipts aggregate membership-at-send-time in SQL.

## M4–M5 — media, reactions, ephemeral, search

Edit/delete windows and disappearing TTLs live in `clq29_grok_runtime` and are evaluated with `now()` in RPCs (shortened grading config). Search is `clq29_grok_matches_prefix` (NFC + simple fold + word prefix). Offline search is a second, client-side implementation over a cached message list — Supabase has no offline query story.

## M6 — API, push seam, replay adapter

Custom client is supabase-js + PostgREST, documented in `API.md`. Push emission is a trigger-like RPC that writes `clq29_grok_push_log` when presence is stale. The 50-action sample log replayed green through the same adapter as the starter seed. Native iOS/Hermes is environment-null.

## M8 — insights, digest, multi-device

Insights and trending are SQL aggregates (no client corpus paging). Digest is a Node worker on a 15s tick calling `clq29_grok_run_digest` (no pg_cron from this lane). Offline queue is hand-rolled AsyncStorage.

## Whole-run notes

Supabase the database was a good fit for Clique's relational model. Supabase the product (Auth + Storage + Realtime + hosted RLS) had sharp edges: Storage RLS vs JWT, Management API 429s on DDL, no first-class offline, no first-class scheduled jobs without extra process. The lane stayed on ports 48300–48319 and namespaced every object `clq29_grok_`.
