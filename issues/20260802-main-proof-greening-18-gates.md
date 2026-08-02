# Green main's local proof: the 18-gate worklist from the first completed verdict

**Status:** Open
**Severity:** P1 (every landing since 2026-07-28 is CI-unverified until this
closes)
**Systems:** CI, Testing
**Source:** local-proof run 30762866599 (commit a6e3ac8c, 2026-08-02
19:59Z) — the first completed verdict since 2026-07-28, produced by the
keep-going fix (issues/closed/20260802-verify-local-proof-stops-at-the-first-failure.md).

## The 18 failed gates, verbatim from the KEEP-GOING SUMMARY

1. `node scripts/check-package-test-inventory.mjs` — likely: today's landed
   package tests (settlement, metrology, registry) unregistered.
2. `node scripts/client-bundle-metrology.mjs --check` — the PKG-01 ratchet is
   brand new; today's client landings probably moved bytes past the frozen
   baseline. May be a legitimate ratchet catch, not a defect.
3. `node tests/conformance/relation-activity-publication-v1.mjs`
4. `node scripts/check-guide.mjs` — today's GAP rows / guide pages drift.
5. `scripts/ibex-doctor` — runtime state on the runner; diagnose before
   repairing (read-only codes).
6. `node cloudflare/scripts/generate-deployment-identity.mjs --check` —
   deploy inputs changed without regen (the fan-out fix?).
7. `node demos/_kit/tests/chrome-process-lifecycle.mjs`
8. `cargo clippy --all-targets -- -D warnings`
9. `cargo test -- --test-threads 4`
10. `node tests/acceptance/auth-invalidation-v1-report.mjs` — may cascade
    from 9 (reuses cargo-test artifacts).
11. versioned-seed conformance (`run-versioned-seed-v1.mjs`)
12. `node demos/_kit/tests/auth-session-schema-parity.mjs`
13. `node demos/_kit/tests/auth-invalidation-client.mjs`
14. `node demos/card-game/tests/acceptance/authority-scope.mjs`
15. `node demos/_kit/tests/live-delta-e2e.mjs`
16. `bun run --cwd packages/snapback-app-cli test`
17. `node cloudflare/test/local-suite.mjs`
18. admin-ui build + tests + browser-security + audit chain.

## Method

Work from the run's full log (`gh run view 30762866599 --log`) — each FAIL
has its inline output above the summary. Expect single-root cascades
(8/9 → 10/11; one auth regression → 12/13/14). Attribute each failure to
the landing that introduced it (today's feat commits are the prime
suspects: settlement 01–06, telemetry substrate/registry, metrology,
register-cliff isolation, device-token registry, Exact 0.1.10 pin bump)
and prefer fixing forward in the owning lane's style. Gate 2 may be a
correct ratchet refusal — if the byte growth is intended, refreeze the
baseline per PKG-01's procedure and say so.

Newer runs supersede this list's details (a run per push is now
completing); re-pull the latest completed run's summary before starting,
but the shape should be similar.

**Exit:** a completed local-proof run on main with zero failed gates; this
ticket closes citing that run id.

## Running log

- **2026-08-02 — fresh verdict and Rust cluster.** Runs `30765472576` and
  `30765119646` completed only as cancelled workflow records and emitted no
  keep-going verdict, so `30762866599` remains the newest completed run with a
  `KEEP-GOING SUMMARY`; main run `30765621395` is queued and the earlier
  queue-coalesced run `30763720394` is still in progress. Local
  `scripts/ibex-doctor` and `scripts/bootstrap-ibex-runtime` are green. Gate 9
  reproduces as exactly three live-delta fixture failures: `eda8f231` correctly
  restricted raw-row delta publication to exact schema-derived document
  contracts, while three older hand-built fixtures still carried the default
  `Unknown` result contract but expected `live_delta`. The fix-forward keeps
  the production refusal and makes those fixtures codegen-shaped. Gate 8 also
  exposes Clippy debt from settlement (`9cad757e`, `38d74e1a`), telemetry
  (`bf73583d`, `f204fecd`), and the July 31 asset train. Fixing commit
  `5a2091c5` makes the three live-delta tests pass, extends the exact target
  capability inventory for `settlement.bounded_skew`, and clears every Clippy
  finding outside the actively owned push seam.
  One additional Clippy finding is in the actively owned PUSH-01 lane
  (`src/push.rs` test helper `register`, landed by `769e7139`); it is recorded
  here as skipped-for-owner until that lane lands or confirms the seam is free.

- **2026-08-02 — generated and inventory cluster.** The newer completed full
  verdict `30763720394` still reports the original 18 failures, while later
  runs are cancelled or in progress. Gate 1 was two inventory omissions:
  settlement landing `38d74e1a` added
  `settlement-bounded-skew.test.mjs` without its package test script or the
  canonical inventory, and PUSH-01 landing `91a0a718` added
  `push-registry.test.mjs` without the canonical inventory. Fixing commit
  `44fe267e` registers both suites and advances the reviewed count to 158.
  Gate 3 was a stale publication-carrier digest after its pinned local,
  storage, and codegen sources changed; the same commit refreshes the complete
  digest chain with `scripts/refresh-publication-carrier.mjs`. Gate 6 was the
  expected all-aboard deployment-identity drift after generated manifest and
  bundle inputs changed; the same commit regenerates it with the prescribed
  generator. All three focused gates pass locally. Gate 2 now passes all 27
  profiles under the pinned Node 24.18.0 toolchain after PUSH-01's additive
  closure fix `91a0a718` and supplemental immutable ledger `745345fd`; the
  primary PKG-01 baseline was not weakened or refrozen. Gate 4's fast guide
  check also passes locally (17 freshness warnings, no errors).

- **2026-08-02 — Chrome lifecycle cluster.** Gate 7 was introduced by Stage 0
  evidence landing `f2cdfc3d`: its correct same-profile `SIGKILL`/relaunch
  witness privately duplicated Chrome's debugging-port, profile, and
  process-tree ownership, which the shared-lifecycle inventory correctly
  refused. Once that duplicate was removed, the inventory also exposed four
  older fixed-port launchers in the retained SpacetimeDB Todo bakeoff
  (`d4d8fc21`). Fixing commit `c5bb5bc3` extends the shared launcher with a
  caller-retained profile and explicit hard-stop leg while keeping port,
  signal, and whole-tree attestation centralized; Stage 0 and all four older
  smoke scripts now consume it. The focused Chrome lifecycle test, the full
  server-process lifecycle test, syntax checks, guide check, and ref-check all
  pass. The Stage 0 product harness itself could not be rerun in this checkout
  because its optional `playwright-core` install is absent, so no retained
  evidence receipt or capability claim was rewritten.

- **2026-08-02 — gate 9 follow-on and observability handoff.** After the
  live-delta fixture repair, the full four-thread Rust suite exposed two more
  independent regressions. Generation-binding commit `e2c79ba8` correctly
  bound session calls to immutable artifacts but reacquired the global writer
  after read-lane queries solely to derive invocation facts, defeating LLP
  0032's L6/L7 non-stall guarantee; the local fix derives the output and facts
  from the same immutable read snapshot, and the focused busy-mutation test now
  passes. ID-registry commit `ee707fe8` moved subscription IDs to canonical
  26-character Crockford bodies, while an older integration test still
  asserted the former UUID-shaped minimum length; the test now validates the
  canonical registry prefix, length, alphabet, and decode contract instead.
  The next full run reached only the D-01 typed-target telemetry test, which
  races a missing `telemetry_meta` row under four-thread suite execution and
  passes immediately alone. That test belongs to active observability commit
  `f204fecd`; its exact failure and reproduction are recorded in the OBS
  program running log and are skipped-for-owner here until that lane lands a
  deterministic readiness/meta-seeding repair.

- **2026-08-02 — read-lane/ID Rust follow-on landed.** Fixing commit
  `fc6dec2f` derives successful query output and invocation facts from the same
  immutable read-manifest snapshot, so the query route no longer reacquires
  the global writer after a read-lane invocation. It also updates the retained
  subscription-id integration assertion to the LLP 0148 registry grammar and
  refreshes the relation-activity publication carrier after both that local
  source change and ERG-02's `define.mjs` change. The two focused Rust tests,
  library Clippy, and gate 3 pass.

- **2026-08-02 — authorization/id cluster.** Gate 10 was an intended evidence
  ratchet from LLP 0148 commit `ee707fe8`: canonical subscription ids reduce
  three isolated retained-payload measurements by four bytes each, from 7,131
  to 7,119 total, with all behavior/counts unchanged. Gate 12's shared corpus
  still carried the pre-0148 derived service-authority UUID instead of the
  exact new `aut_` vector. Gate 14 exposed one production validator missed by
  that same landing: AuthorizedLease accepted only UUIDv7 authority instances
  even though current servers issue `aut_` identifiers; the fix preserves
  permanent legacy-read compatibility and adds prefixed coverage. Gate 13 was
  older fixture drift after `5c417d1d`: production correctly avoids a duplicate
  T-UNSUB once terminal deletion has already retired the exact query, while the
  test still demanded the redundant request. Fixing commit `a0456ce2` updates
  the strict evidence, corpus, validator, and lifecycle assertion. Gates 10,
  12, 13, and 14 now pass locally.

- **2026-08-02 — live-delta cluster.** Gate 15 was the end-to-end instance of
  `eda8f231`'s correct refusal already seen in Rust: its hand-built live-query
  manifest had no schema-derived `Documents` result contract and production
  therefore used conservative replacement. Fixing commit `754ced31` derives
  and hashes the exact contract from the fixture's table schema; the suite is
  3/3 green without weakening the delta admission policy. The governing live
  guide did not explain this prerequisite despite using the fixture as its
  executable example, so the required follow-up is filed as
  `issues/20260802-guide-gap-live-delta-result-contract.md`. Gate 16's full
  `snapback-app-cli` package suite passes without changes.

- **2026-08-02 — Cloudflare cluster.** Shared wire change `c4c575e9` made
  `authorityDescriptor` a required MutationResponse settlement fact, but the
  narrow Cloudflare arm still emitted the earlier four-member envelope. Fixing
  commit `469c9532` gives the dev/anonymous DO a persisted `aut_` authority
  cohort, stable across eviction and rotated by destructive reset, and emits
  its honest generation-zero descriptor before a mutation can commit. The
  wire-shape suite is 32/32 and the full pinned-Node Cloudflare local suite is
  26/26. Both deployment identities were regenerated because the hosted bundle
  closure intentionally gained the shared ID registry; gates 6 and 17 pass.
