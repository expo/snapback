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
