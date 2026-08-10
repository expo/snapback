# DX: scaffold env auto-write + document session-mint HTTP shape and persisted-receipt branch

Two small B9 losses from the Clique pilot's Snapback lane vs Convex's
82-scoring zero-to-backend flow:
1. Convex's CLI writes the client env (EXPO_PUBLIC_CONVEX_URL) into
   .env.local unprompted at dev start; Snapback's scaffold should
   auto-write the equivalent client wiring so a fresh app connects
   with zero manual config.
2. Two knowledge gaps were learned by observation rather than docs,
   each costing a loop: the `snapback session mint` HTTP request shape
   (defeated every documented guess; SNAPBACK_AUTH_REQUEST_INVALID),
   and the offline cold-start persisted-receipt binding branch
   (binding.source:'persisted-receipt' — undocumented). Both belong in
   the guide per LLP 0193's errors-as-docs bar (the error/behavior is
   the retrieval key). Evidence: p2-pilot snapback-lane run-log.md.

## Dated note — 2026-08-10 (mint-docs half landed)

`guide/auth/sessions-and-principals.md` now documents `snapback session mint`
and the exact `POST /_snapback/api/host-ops` `auth.mintSession` request
(authority headers, body, envelope, settled-sessions boundary, custody);
the offline page documents the `binding.source === 'persisted-receipt'`
cold-boot branch and tells apps to render offline presentation rather than
reject it. The scaffold/dev-start env auto-write half remains open (in
flight on a parallel lane).

## Resolution — 2026-08-10 (second half)

Env auto-write landed: `runExpoDev` writes the credential-free
`EXPO_PUBLIC_SNAPBACK_SUPERVISOR_ORIGIN` to `.env.local` before Metro starts
(new `packages/snapback-cli/expo-client-environment.mjs`) — preserves
unrelated entries, replaces stale owned assignments, supports loopback and
the Android emulator alias, emits `client-environment-written`; templates
ignore `.env*.local`; session material stays in the transient no-store
exchange. Full supervised `expo-dev-loop.test.mjs` (real runtime binary)
passes with the new assertions. The mint-docs half landed earlier today
(see the 2026-08-10 dated note above). Both halves done — closing.

## Dated note — 2026-08-10 (env auto-write superseded by LLP 0223)

The `.env.local` auto-write above landed hours before LLP 0223 (this
ticket's execution Plan) was accepted, and the accepted Decision explicitly
rejects it: "Auto-inject, do not auto-write" — a durable copy of the
rendezvous origin held as ambient configuration is a stale-lifecycle bug
across supervisor generations, and the fallback constraint is a
generation/expiry-bound file under `.snapback/`, "never an ambient
`.env.local`". The LLP 0223 implementation reverted the auto-write and
replaced it with the acceptance-level proof of the supervisor-native
contract this ticket's Convex comparison actually needed: process-env
injection into Metro, provider `ready` plus a live app-level round trip
with zero manual config, an asserted no-`.env*` invariant, and descriptor
transience (0o600, removed on close). The ticket stays closed; its env
half is answered by the injected contract and its proof rather than a
persisted file.
