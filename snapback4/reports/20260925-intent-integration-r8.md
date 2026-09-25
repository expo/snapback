# Integration round 8 — combined main qualification for 0.4.2

Date: 2026-09-25 UTC. Worktree: `~/sb4-intent/lane-i`.
Branch: `sb4-intent/integration-042`. Qualified runtime/test code: `5ca77f244`.

Ran `git fetch origin`, detached at `origin/main`, and created the requested
branch from **`83719d7acae8f18bef61392d3116093ee082dffd`**. There were no local
changes to carry or conflicts to resolve. This qualification covers the fetched
main snapshot, including these already-landed merges:

| Change | Main merge | Lane head |
| --- | --- | --- |
| S round 1, total text in effect-payload reads | `2d9a50b2b` | `fecca564f` |
| M5 session-model scheduling and clock isolation | `7811b01e4` | `abe99021f` |
| R, `min`/`max` over reads, through review round 2 | `60f4e6c62` | `c5eb2c2a2` |
| Q, expiring aggregate counts, through review round 3 | `83719d7ac` | `a71116723` |

## Changes and measurement

- `metrics/wasm-budget.json`: replace the status of the summed estimate with a
  measured combined-artifact record in `why`. Preserve the historical lane
  measurements and their attribution caveats. The measured artifact is
  **1,775,799 B raw / 495,276 B gzip**. The required calculation is
  `ceil(495276 / 1000) * 1000 = 496000`: **496,000 B remains the smallest
  permitted rounded ratchet**, with **724 B headroom**. Reducing to 495,000
  would put the measured artifact over budget. The authorized 496,000 ceiling
  was never exceeded or raised.
- `packages/snapback4/tsconfig.json`: resolve the private `#fetch` specifier to
  source during TypeScript checks, independently of generated `dist` files.
  The runtime package-import conditions and transport selection are unchanged.
- `packages/snapback4/test/package-typecheck.test.mjs`: compile the package with
  a compiler host that hides its generated declarations, reproducing a clean
  checkout without deleting files used by concurrent tests.
- `crates/snapback4-core/src/engine/mod.rs`: compare the stored schema before
  and after index preparation, independently of cap-counter readiness. Both hashes
  describe the same loaded generation, avoiding a later metadata observation.
  A changed contribution index therefore activates through the existing metered,
  atomic path even when the source has no caps.
- `crates/snapback4-core/tests/expiring_adoption.rs`: make the rollback/stability
  digest handle an optional cap-count table, hashing its presence and, when
  present, its contents. Keep every existing adoption and heap assertion.
- `crates/snapback4-device/tests/expiring_counts.rs`: strengthen the legacy-open
  regression to require the upgraded schema hash/index, one generation advance,
  stable reopen, and no unnecessary cap-count table or marker.
- `packages/snapback4/test/worker.test.mjs`: hold the deferred effect's
  settlement response, then wait for the worker's following claim before
  stopping. This distinguishes the server commit from response consumption;
  preserve all worker, dependency, doctor and error assertions.
- `packages/snapback4/test/app-global.test.mjs`: route read-only auth probes
  through the existing bounded retry for `UND_ERR_SOCKET`; return every
  successful response immediately to the unchanged refusal assertions.
- `packages/snapback4/test/client-lifecycle.test.mjs`: hold `begin_send` until
  the replay fixture has inspected its rebased prediction, preserving the
  production generation guard and all prediction, original-ID and final-row
  assertions. Fixture cleanup releases every held operation.
- `JOURNAL.md`: append one dated round-8 entry with qualification and limits.
- `reports/20260925-intent-integration-r8.md`: this report.

Measurement uses the repository's `scripts/build-wasm.sh`: Rust **1.97.0**,
wasm-bindgen **0.2.127**, no wasm-opt, `gzip -9` over the generated web artifact.
The initial suite and the explicit rebuild after the integration fixes reproduce
the same sizes. Against the preceding recorded
0.4.1 integration artifact (1,765,796 raw / 491,640 gzip), the combined difference
is **+10,003 raw / +3,636 gzip bytes**. This is a whole-artifact comparison, not
independent per-lane attribution. No generated wasm is committed.

## Integration defects and regressions

The first complete suite ended **`== 2 failure(s) in 705 s`**. Its two failing
stages were `package typecheck` and `cargo test`; all ordinary client tests and
all three full-count models passed. Every failure is accounted for here:

| Failure | Classification and resolution |
| --- | --- |
| Four TS2307 errors for `#fetch` in `app.ts`, `auth.ts`, `client.ts`, `local.ts` | Integration regression: the new package-import `types` target points at `dist/default-fetch.d.ts`, but a clean suite typechecks before building it. The source-only mapping fixes that dependency. The new regression fails with all four errors without the fix. |
| `expiring_adoption::fitting_large_rows_adopt_without_retrying_the_same_oversized_page` | Stale test fixture assumption after lazy cap storage: uncapped stores correctly lack `_cap_counts`. Update the digest, preserving table-presence and row-content checks. |
| `expiring_adoption::a_row_that_cannot_fit_refuses_after_prior_pages_without_publishing` | Same stale fixture assumption; the heap refusal and complete rollback assertions remain. |
| `expiring_adoption::sixty_three_views_adopt_within_the_examination_and_step_page_budgets` | Same stale fixture assumption; bounded adoption and stable reinstallation remain asserted. |
| `expiring_counts::sqlite_041_store_rebuilds_expiry_index_at_open` | Real integration regression: Q normalizes the old contribution index, but lazy cap readiness let an uncapped store attach without activating it. Generation stayed 1 instead of advancing to 2. The independent schema-hash check repairs the upgrade. |

Focused qualification:

- Package typecheck passes. The new clean-package test plus `node-transport`
  and `transport-outcomes`: **26 passed, zero failures**.
- Core `expiring_adoption`: **5 passed**; fitting pages, bounded 63-view
  adoption, plain cap indexes and refusal rollback are preserved.
- Device `expiring_counts`: **9 passed, 1 existing ignored sweep-lag witness**;
  legacy adoption, server backlog cost, both device adapters and disclosure
  coverage pass.
- CLI `expiry_writes`: **32 passed**, including the M5 refused-upgrade
  byte-preservation test, one-time occupancy initialization and born-expired
  rows releasing their caps.

The legacy-open failure reproduces on the original combined tree;
its expected generation advance was not relaxed. Both fixes are committed
separately: `09bf21ae6` (clean typecheck) and `0ed6aebf3` (expiry adoption).
No authorization, disclosure, meter or durability assertion was weakened.
No intermittent failure occurred in the first run.

The second complete run ended **`== 1 failure(s) in 641 s`**, with only
`client tests` failing. `W7r1 runWorker and doctor observe deferred presence
effects` at `worker.test.mjs` observed one `AbortError` instead of an empty
error list. The unchanged test passed alone (**1 passed**).

Classification: an intermittent fixture race, confirmed by a controlled
reproduction, not an environmental waiver. It aborted the worker after reading
SQLite's `sent` state but before the worker consumed its settlement response.
The repaired fixture holds that response until the committed state is observed,
then waits for the next worker claim before stopping. Removing only that wait
reproduces the same `AbortError` deterministically. With it restored, the whole
worker file passes **34/34**. No timeout, outcome assertion or worker runtime
behavior changed. This correction is commit `d5862019f`.

The third complete run ended **`== 1 failure(s) in 663 s`**, again only
`client tests`. The worker correction passed. Two other cases failed:

- `a completed global fence survives replacement before a late rotation
  returns` (`app-global.test.mjs`): its final direct `/probe` failed with
  `UND_ERR_SOCKET: other side closed`. **Passed alone unchanged.** Classified
  as an intermittent fixture transport failure. The existing `until` helper
  already retries this exact aborted-pool socket error; the direct probe had
  bypassed it. Use that bounded helper for every read-only probe, wrapping a
  successful response so a live token's absent refusal ends the retry just as
  a refusal does. Assertions and all other thrown errors keep their meaning.
  The helper documents the aborted pooled-socket cause; that precise socket's
  lifecycle was not independently instrumented.
- `wasm: population growth cannot mint new IDs during prediction replay`
  (`client-lifecycle.test.mjs`): its blanket no-device-refusal assertion saw
  `observe_store` return `E_GENERATION: a mutation send overlapped the sync
  response; retry sync`. **Passed alone unchanged.** Classified as an
  intermittent fixture-ordering failure. The independent head probe can
  capture an older send revision, so the production guard correctly refuses
  it. Hold `begin_send` while inspecting the rebased prediction, then release
  the original-ID request and verify the two final authoritative rows. No
  production guard or assertion is removed.

Commit `919b36bc5` contains these fixture corrections. **All 7 global-session
cases and both wasm/native replay cases pass** afterward. All three models
passed at their full counts in all three nonzero suite attempts. For the final
run, use the script's existing `SNAPBACK4_TEST_SERIAL_CLIENT_FILES=1` mode:
all files and tests still run, with independent client files serialized;
intentional within-test interleavings and model counts are unchanged.

The first serial attempt was deliberately stopped before completion (exit 143,
no summary line), with no reported test failures, when final code review
narrowed the adoption condition to compare the stored schema before and after
index preparation. This uses the same loaded snapshot instead of comparing
against a later `schema_hash` metadata read that could belong to another
generation. The legacy-open regression still requires exactly one upgrade and
stable subsequent reopen and passes again after refinement (`5ca77f244`). The
final complete run below supersedes that attempt.

## Qualification

Build: `cargo build --workspace` passes. Ran `bun install --frozen-lockfile`
before JavaScript tests. The existing main suite runs Rust before ordinary
client tests, then the three models serially. Their sequence counts, model
oracles, timeouts and skip rules are unchanged.

Command from `snapback4/`:

```sh
PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH" \
TMPDIR=/dev/shm/sb4-intent-i-r8-tests \
CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 CARGO_INCREMENTAL=0 \
CARGO_BUILD_JOBS=12 RUST_TEST_THREADS=4 SNAPBACK4_RUST_TEST_PROCESSES=8 \
SNAPBACK4_SESSION_SEQUENCES=5000 SNAPBACK4_ONLINE_SEQUENCES=3000 \
SNAPBACK4_TEST_SERIAL_CLIENT_FILES=1 \
bash scripts/test.sh
```

Final complete suite, exit **0**: **`== 0 failure(s) in 1529 s`**.

- Rust matrix: **891 target executions, including workspace doctests**,
  with zero failed targets; the complete guide target passes.
- Ordinary client stage: **1,506 passed, 10 existing skips, zero failures**
  (1,516 total; all client files run serially).
- E online: **5,000 sequences**.
- E real-wasm local: **5,000 sequences**.
- J online: **3,000 sequences**.
- Explicit guide run: `cargo test -p snapback4-lang --test guide`, **80 passed**,
  zero failures; all published Quarry guide blocks compile without diagnostics
  or notes.
- `./ref-check`: **508 LLP documents, 9,282 references in 25,903 files; zero
  errors, zero unchecked references**.
- README docs budget: **300/300 physical lines**.
- Wasm budget: **495,276 / 496,000 B gzip**.

The final run has **zero failures**. All earlier failures are classified and
resolved above; none was waived as baseline or environmental. Existing explicit
skips and ignored witnesses retain their original rules.

Evidence under `~/sb4-intent/`: `integration-r8-build.log`,
`integration-r8-install.log`, `integration-r8-wasm.log`,
`integration-r8-guide.log`, `integration-r8-ref-check.log`,
`integration-r8-ref-check-final.log`,
`integration-r8-suite.log`, `integration-r8-suite-retry.log`,
`integration-r8-suite-retry2.log`, `integration-r8-suite-superseded.log`,
`integration-r8-suite-final.log`,
`integration-r8-wasm-final.log`, `integration-r8-typecheck-before.log`,
`integration-r8-typecheck.log`, `integration-r8-fetch-regressions.log`,
`integration-r8-adoption.log`, `integration-r8-snapshot-adoption.log`,
`integration-r8-expiring-counts.log`,
`integration-r8-expiry-writes.log`, `integration-r8-worker-alone.log`,
`integration-r8-worker-cut-before.log`, `integration-r8-worker-fixed.log`,
`integration-r8-global-alone.log`, `integration-r8-replay-alone.log`,
`integration-r8-global-fixed.log`, and `integration-r8-replay-fixed.log`.

## Scope and existing limits

This is integration qualification, with no new authoring form. The suite covers
S's total `sha256` and `join` effect payloads, R's `min(read, .column)` and
`max(read, .column)` folds, and Q's maintained count/sum views over expiring
rows together with the client changes. Example existing forms include
`min(receipts where .message = m.id, .state) ?? 2` and
`view unreadCounts: count receipts where .state < 2 and .visible by .chat, .principal`.

The lanes' documented conservative boundaries remain. S retains ordinary
prediction requirements for fallible/shared work. R retains winner heap charges
and ordinary authorization/expiry filtering. Q's accepted device stop remains:
a 10,000-source local aggregate may exceed its 8,192 examinations, return
unavailable and use the existing server fallback; physical totals and private
next-expiry values are not delivered. Q's documented conservative PostgreSQL
query reservation for a declared 2 MiB payload remains unchanged. See
`20260925-intent-lane-s.md`, `20260925-intent-lane-r-round2.md` and
`20260925-lane-q-round3.md` for reproductions and their qualification evidence.

No runtime ceiling, authorization, disclosure or durability policy changes.
No package version bump, push, publication or simulator qualification.
