# Deterministic publication reds on main (red check of 1e9a50c8a7, 0.4.48)

Red check: `~/sb4-pub-0447-kit/redcheck-main.sh` (unit `sb4-pub49-redcheck-main`, Linux, load 4-20).
The script runs `publish.mjs --prepare-client` on Linux, then the complete `qualify-linux.mjs`: Rust targets, client pool,
models and consumer proofs. Evidence: `~/sb4-pub-0447-records/redcheck-main/` (`qualification/suite.log`, `qualify.log`,
`progress.log`). Each fixture fix is confirmed alone in `~/sb4-pub-0447-kit/isolated/wfix3/`.

Rust targets: all pass (cargo test 987 s), including `readauth` after `d6f0253bfa` refreshed the authoring census.
Client pool: 453 files, 7 failed (8 tests).

## Fixture / test-only: LANDED on main as `21ad8f53d9`

One commit, "test(snapback4): advance release fixtures for bounded output and the 0.4.48 bump", rebased on
1e9a50c8a7 with a normal push (no force; the pre-push hook ran). Confirmed alone at that tree, with logs in
`~/sb4-pub-0447-kit/isolated/wfix3/`:

| File | Result |
|------|--------|
| native_following | 2/2. Also re-run against a deliberately stale 0.4.45 lock: the test passed and the tracked lock bytes were restored |
| device-version | 11/11 |
| sync-generation | 51 pass, 1 skipped |
| export-failure | 2/2, run twice |
| dx12-serve | 7/7 |
| surf4 | 24/24 |
| security-packed | 3/3, run twice (101 s, 102 s) |

The first alone run of security-packed used a plain `cargo build` dev binary (opt-level 0, 200 MB) and spent more than
900 s in proveSecurity. That was an artifact of my verification build, not a red. scripts/test.sh's
`cargo test --workspace --no-run` rebuilds `target/debug/snapback4` under `[profile.test]` (opt-level 1, device crate at
opt-level 3, 90 MB). With that binary, the file passes alone in about 100 s, the same as in the suite (108 s).
The full-set confirmation is under "Full-set confirmation at 21ad8f53d9" below.

The reds and their fixes:


| # | Red | Exact failing assertion | Cause | Fix |
|---|-----|-------------------------|-------|-----|
| F1 | Source tree dirtied by `snapback4-device::native_following` (no test fails, but `cleanSource` refuses the receipt and stage) | `git status`: ` M snapback4/native-fixtures/following/Cargo.lock` after the target runs | The tracked fixture lock pins `snapback4-native` 0.4.45. The 0.4.46/0.4.47/0.4.48 bumps did not update it, so the in-place fixture build rewrites the tracked lock. | Lock to 0.4.48. Also, `native_following.rs` restores the tracked lock bytes after its build, so future bumps can no longer dirty the source. |
| F2 | `device-version.test.mjs` (file load) | `assert.equal(packageVersion, '0.4.47', 'release fixture pin follows the package bump')`: actual 0.4.48 | An explicit bump tripwire that the 0.4.48 bump did not advance. Every other assertion uses `packageVersion`. | Pin 0.4.48. **Integration 33 must advance it to 0.4.49 with its bump.** |
| F3 | `sync-generation.test.mjs` (file load) | Same pin assertion, actual 0.4.48 | Same as F2 | Pin 0.4.48. **Integration 33 must advance it to 0.4.49.** |
| F4 | `export-failure.test.mjs` tests 1-2 | `ERR_MODULE_NOT_FOUND .../node_modules/snapback4/dist/parent-lifetime.js imported from .../bin/snapback4.js` | Since `2bb0396331`, `bin/snapback4.js` imports `../dist/parent-lifetime.js`. The test's hand-built shim install copies only `dist/resolve-binary.js`. | Copy `dist/parent-lifetime.js` too. |
| F5 | `dx12-serve.test.mjs` #6 | `JSON.parse(result.stdout)`: `Unexpected token 's', "serve-chec"... is not valid JSON` | `serve-check` prints a bounded verdict by default since 0.4.46 (`printProofReport`; `--json` prints the complete report). This is the documented 0.4.46 change ("--json keeps complete evidence"). | Pass `--json` to `serve-check`. Assertions unchanged. |
| F6 | `surf4.test.mjs` #1 | `assert.ok(log.match(/active schema ([a-f0-9]+), working schema ([a-f0-9]+)/))`: undefined | Since 0.4.46, serve's bounded startup prints the full banner only with `--explain`. The kept warning reads "active schema X differs from working schema Y". | Match the kept warning. Both hashes are still extracted and still asserted to differ. |
| F7 | `security-packed.test.mjs` #2 | `assert.equal(compactText.trim().split('\n').length,2)`: 3 | Since 0.4.47, `check` adds "proof scaffold: scripts/proof-scaffold/ (7 written, ...)". The verdict and the enforcement summary are still 2 lines. | Count the non-scaffold lines (2) and allow at most one scaffold line. The test still passes if MUSE1 removes or keeps the line. |

## Product / docs / review (for Integration 33)

| # | Red | Exact failing assertion | Detail | Proposed fix |
|---|-----|-------------------------|--------|--------------|
| R1 | `delivery-fault-matrix.test.mjs` #1 "every delivery await is explicitly classified" (the other 444 fault tests pass) | `assert.deepEqual(awaitBoundary(), delivery-await-boundary.json)`: "new or changed await needs delivery reachability classification, including outside existing helper scopes" | New awaits since `93cee47c6e` (the last boundary refresh). In client delivery paths: `client.ts` +`await proofResponse(args[0], args[1], response)`, `local.ts` +`await proofResponse(args[0], args[1], response)`, `identity-request.ts` +`await proofResponse(url, init, response)` (proof-refusal observation on responses, `69b9ae720a`). In proof harness code: `proof-accounts.ts` +4, `proof.ts` +5/-1, new `proof-observation.ts` +1. | An owner reviews whether the three `proofResponse` awaits are delivery-reachable: can they reject, and do sync/mutation/identity requests absorb that? Classify or remove them, regenerate `delivery-await-boundary.json`, and keep the `delivery-fault-sites.json` assertion unchanged. The proof-* awaits are test-harness code. |

R1 analysis, to speed up the review. `proofResponse` (`proof-observation.ts:44`) returns at once unless the proof harness
called `enableProofObservation()`. When it is enabled, the whole body sits in `try { ... } catch {}`, and the wrapped
`response.json` re-raises only the original decode's own rejection. So the three new awaits in the delivery paths cannot add a
rejection, and they look like non-fault sites. That is my reading; the owner must confirm it. The boundary is regenerated
through `awaitBoundary()` (the delivery-fault-instrument helper the test imports). Because the first deepEqual threw, the
test never reached its second assertion. I evaluated it read-only against 21ad8f53d9 (census() from src, mapped exactly as the
test does; script at `~/sb4-pub-0447-records/r1/sites.mjs`, run as `node sites.mjs <snapback4>/packages/snapback4/test`; the await diff came from `r1/await-diff-list.mjs`).
It PASSES: 215 classified sites, unchanged. The new awaits sit outside the scoped fault-site functions, so the whole
mechanical fix, once the owner accepts the reachability reading, is to regenerate `delivery-await-boundary.json`.
`delivery-fault-sites.json` and the recipes need no change.

## Status of other suspects from earlier attempts, at 1e9a50c8a7

- Integration 32 fixed periphery (ready wait, data --json, parent-lifetime copy), api-index and readme-examples on main.
  All pass here.
- readauth census: passes after `d6f0253bfa`.
- store_handle_census `use<>`: passes after `87fb2ecef4`.
- retained-history: passes after `c9c3a35461`.
- security-packed test 1 duration: 108 s in the suite, so it is not near the 900 s stall bound with the suite's binary.

## Consumer proofs at 1e9a50c8a7: all passed (none red)

qualify-linux ran every consumer proof on the red suite and then threw only "Linux source suite failed" (rc 1, 5793 s in all).
Every one passed (`redcheck-main/qualification/*.json`):

- day2, dx4, dx5, dx6, dx7, dx8 and dx16
- regressions (Expo upgrades, 3/3), day4, release-transitions, dormant and day5
- production, proof-kit, client-recipes, security, migrations, staging, rule-recipes and scaf1
- frontend-proofs 24/24 and starter-proofs 48/48
- both clean-container installs (proot ubuntu:24.04 / node 24.13.1 and alpine / node 24.18.1)

The `E_FRONTEND_SCENARIO` and "proof failed: no backend refusal" lines in qualify.log are designed refusals inside passing
proofs.

## Bottom line for main

At 1e9a50c8a7 the only reds are F1-F7, now landed in 21ad8f53d9, and R1, the review item for Integration 33. Integration 33 must
also advance the two bump tripwires (device-version and sync-generation, F2/F3) to 0.4.49 with its version bump. The
native fixture lock restores itself, so it no longer needs a hand edit.

## Full-set confirmation at 21ad8f53d9: suite confirmed

Complete red check from main 21ad8f53d9, with target/debug rebuilt from scratch: unit `sb4-pub49-redcheck-main2`, records in
`~/sb4-pub-0447-records/redcheck-main2/`.

- Rust targets: cargo test ok (974 s). The source tree was clean after them, which confirms F1 in the full set.
- Client pool: 453/453 files with 1 failed; 8099 tests, 8041 passed, 1 failed, 57 skipped (1691 s). F2-F7 pass in the
  pool: device-version 2.0 s, sync-generation 21 s, export-failure 9 s, dx12-serve 38 s, surf4 47 s, security-packed
  107 s. The only red is R1: delivery-fault-matrix #1 "every delivery await is explicitly classified", 444/445.
- Models: ok (333 s). Suite verdict: "== 1 failure(s) in 3192 s", which is the client pool's R1.
- Consumer proofs: still running when this was written. The client and Expo tarballs are byte-identical to
  1e9a50c8a7's (8237b16e / 6c345458), whose consumer proofs all passed. A detached recorder
  (unit `sb4-pub49-redcheck-main2-finish`, `kit/redcheck-main2-finish.py`) appends the final outcome below and to
  STATUS.md.


### Full-set confirmation result (auto-recorded 2026-10-29T00:21:20Z)

qualify rc=1. Suite verdicts: [('ok', 'cargo test'), ('FAIL', 'client tests'), ('ok', 'client models')], ['1']. Failing client files: ['packages/snapback4/test/delivery-fault-matrix.test.mjs']. Consumer proof JSONs not passed: none (of 22). Source tree after the run: [].
