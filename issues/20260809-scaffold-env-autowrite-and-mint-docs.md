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
