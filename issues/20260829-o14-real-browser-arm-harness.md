# O14 shapes (a)–(c) need a real-browser arm before a terminal negative verdict

**Status:** Open
**Opened:** 2026-08-29
**Owner:** LLP 0317.000 lane L1 (diagnosis); implementation by whoever extends the LLP 0258 browser runner
**Systems:** Live queries, Authorization invalidation, Client SDK, Acceptance testing
**Related:** LLP 0317 O14 (shapes a–c), LLP 0317.000 P1/P6 and §Wave 1
negative-evidence standard, `demos/_kit/tests/live-query-invalidation-e2e.mjs`,
`tests/acceptance/browser-auth-bootstrap-v1.mjs` (LLP 0258 Phase 1.4
standards-real browser runner), `issues/20260827-live-query-cross-client-fanout-staleness.md`

## Why this exists

The O14 harness reproduces the reported shapes with **headless browser-shaped
clients and a React test renderer** (`fake-indexeddb`, `react-test-renderer`).
That is honest and cheap, and it is now runnable on the reported platform
(Linux x86_64, after `8b332808f` fixed the harness so shapes a–c execute at
all) against an exact-current binary. It is still not the client arm the
matrix lanes reported:

- shape (b): `sol-snapback-familiar` `1787857038` was observed by
  `manual-playwright` — a real browser context;
- shape (c): `sol-snapback-familiar` `1787857472` was two Playwright contexts
  in one browser, with the same-client projection updating while the other
  context stayed stale.

LLP 0317.000 P1 requires a `not reproducible` verdict to be earned "on the
platform **and client arm** the lane reported". A headless Linux pass therefore
upgrades the evidence but cannot close shapes (b) and (c) as terminal negatives;
the harness's own report lists the arm as a scope limitation.

## What to build

Extend, do not fork: `tests/acceptance/browser-auth-bootstrap-v1.mjs` already
drives system Chrome over raw CDP and Safari/Firefox over WebDriver, serves an
esbuild page bundle from a local origin that proxies the real server, and
asserts real IndexedDB + Web Locks custody. Add an O14 page that mounts the
same shapes (a)–(c) the headless harness defines — distinct principals and
explicit `storagePartition`s per context, the nested/list/point subscription
trio for (c) — and reuse the headless harness's witness invariants
(original subscription id unchanged, no `resubscribed`, socket attached,
polling fallback off, authoritative frame inside the deadline). Two browser
contexts in one browser is the (c) topology; the second context must be a
genuinely separate context, not a second tab sharing storage.

Run it on Linux x86_64 (Chrome is the realistic arm there) against an
exact-current, clean binary; ten consecutive passes per shape for a negative.

## Acceptance

- A browser-arm report per shape with the same verdict vocabulary the headless
  harness uses (`confirmed` / `not reproducible` / `inconclusive`), naming
  browser, platform, binary commit, and the context topology.
- LLP 0317 O14 row updated with the browser-arm verdicts; if all three shapes
  pass ×10, the row's shapes (a)–(c) close as terminal negatives and the
  provisional O2/B3/B4 score discount in the 0.1.29 matrix record is
  confirmed rather than provisional.

## Out of scope

Shape (d) — the past-1,024 quarantine mechanism is confirmed and owned by
`issues/20260828-live-query-implicit-limit-refusal-blanks-subscription.md`.
