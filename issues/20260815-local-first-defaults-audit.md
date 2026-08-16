# Audit: make local perceived performance the default client posture

**Opened:** 2026-08-15 · **Severity:** P3 program audit ·
**Source:** author performance-direction ruling 2026-08-15

Direction: persisted query facts, automatic optimistic reducers, offline
outbox settlement, and local query evaluation should be the DEFAULT across
React, Expo, and native clients — not opt-in capabilities. InstantDB is the
benchmark: if the UI paints correctly in under a frame, a 70 ms vs 120 ms
server settlement difference matters much less.

Snapback already ships pieces of this (optimistic rebase, outbox settlement,
materialization store, external store, local read admission — see
`guide/reference/expo-snapback-client--*.md`). The gap is *defaultness* and
coverage, not existence.

Ask: audit each client arm (React, Expo, Swift, headless) against the four
capabilities; produce a matrix of exists/default/opt-in/missing; file one
follow-up per gap where making it the default is safe, and an RFC where the
default change has semantic consequences (e.g. local evaluation divergence
vs LLP 0209 §8 server/local agreement). Cross-reference LLP 0190 (D3 seams)
— retained facts and local replicas are D3's rungs and this audit should not
fork that ownership.

Related: LLP 0190, LLP 0209 §8, guide client reference pages, LLP 0198
(strategic frame: Instant-like immediate/offline UX as a headline property).
