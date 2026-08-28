# graph_corpus_v1 red on main — auth projection tightening vs synthetic test principals

**Status:** Resolved · **Opened:** 2026-08-25, session snapback-e9 · **Resolved:** 2026-08-25

Ten `graph_corpus_v1` scheduler/served tests failed on main with
`SNAPBACK_AUTH_PROJECTION_CORRUPT: projected user id is not a Snapback
identifier` while building the unit-test authority coordinator. The auth
validation remains fail closed; the graph corpus fixtures now use canonical
Snapback catalog identifiers.

## Cause and attribution

The first-bad range is exactly `8d796b798^..8d796b798`:

- `2d75ff7206` (`feat(auth): add durable session projection foundation`,
  2026-07-13) had already made projected user identifiers validate as
  Snapback identifiers.
- `8d796b798` (`fix(graph): G2-C fix round 1 ...`, 2026-08-24) then added the
  scheduler fixtures with synthetic `principal_ordinary` identities. That
  composition was invalid from its first landing.
- `35bd19287` did not introduce this red: its parent `625f3bb98` already
  reproduces the same projection panic. The later database-derived authority
  coordinator changed the surrounding composition, not the first-bad range.
- The C2 two-way-windows series stacked on the existing red. At `db1fb7048`,
  the full corpus ran 49 tests (32 passed, 17 failed); all nine of the ten
  named tests then present failed at the same projected-identifier panic. At
  `212735724`, it ran 53 tests (34 passed, 19 failed), including all ten named
  tests with the same panic.

These reproductions were run in detached worktrees with no stash or source
overlay.

## Resolution

- The Rust graph corpus support mints deterministic `usr_`, `idn_`, `ses_`,
  and `aut_` fixtures through the production `format_id` encoder.
- The session catalog, prepared authority, and connection effect fence now
  use the same canonical session/authority tuple.
- Dev-mode served mutations carry canonical projected auth inputs, while the
  scheduler fixture drains its protected sessions-mode stream through the
  retained effect fence.
- The canonical JavaScript freezer uses the same valid corpus principals and
  authority instances. The G2-B, G2-C, G3-A, and two-way observations were
  re-frozen through their owning freeze paths.

The six changed graph artifacts contain 201 `resultBytes` fields. A recursive
path-and-value comparison against the pre-fix artifacts found **zero changed
result fields**. The remaining artifact changes are principal/authority
identifiers and their identity-, proof-, partition-, or fixture-derived
digests.

## Verification

- `cargo test -p snapback --test graph_corpus_v1` — PASS: 53 passed, 0 failed
  (1,371.56s).
- `cargo test -p snapback-kernel live_matcher` — PASS: 28 passed, 0 failed,
  825 filtered out.
- `./ref-check --verbose` — PASS: 315 LLP docs, 6,919 refs in 13,219 files,
  0 errors, 0 unchecked.
- `volta run --node 24.18.0 node scripts/check-inventories.mjs` — PASS: 358
  package tests, 31 script tests, 31 demos/catalog entries, 487 publication
  leaves, 157 guide pages, and 1,872 snippets. Existing gap-review expiry
  warnings remain.
- `cargo test -p snapback-engine` — BLOCKED before test execution by six
  unrelated compile errors already present at the unmodified branch tip
  `ac40ff4d1`: two private kernel methods, missing
  `OAuthConsentBeginCase::AbsentUser`, missing
  `LiveInvalidationIssuer::with_authenticator`, and two authority-coordinator
  borrow conflicts. A detached clean worktree reproduced the exact same six
  errors. See `issues/closed/20260825-engine-unit-tests-do-not-compile-on-main.md`.
