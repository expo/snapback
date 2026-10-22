# 0.4.35 attempt 2 at 2e10681b32 — Linux red: wasm codec census (deterministic); plus an npm-cache environment fault

Commit: 2e10681b327f1c473428c103483b3d42ec38434f (coordinator ruling after attempt 1; contains 078b33ec45 + hot-release race fix).

## Passed
- Mac native-2 (Xcode 27.1 27A9275), prepare-2 (client sha512-BazFeTCT..., expo sha512-JGAqB1/d...; Expo == native-qualified 24/24), lean-2, warm-2.
- Linux suite: cargo build ok (75 s); cargo test ok (1,022 s) — guide-code red from attempt 1 is gone.

## Red 1 (product test, deterministic) — client tests (1,570 s): 423/423 files, 1 failed; tests 7,811 / pass 7,753 / fail 2 / skip 56
packages/snapback4/test/wasm-codec-census.test.mjs, 2 of 27:
- "web-reachable typed JSON calls all use the codec funnel": direct serde family outside json_codec.rs:
  crates/snapback4-core/src/assets/test_cases.rs:539: let mut json = serde_json::to_value(&a).unwrap();
- "census kills parse, encoded, MQ components and container regressions": 2 !== 1 (same line).
Isolated (node --test): FAILED 3/3, 25 pass / 2 fail (isolated-a2/).
Cause: assets.rs:854 declares `#[cfg(all(test, feature = "sqlite"))] pub(crate) mod test_cases;` (test-only); the census's
testOnly() exempted only an exact `#[cfg(test)]`. Fixed by the coordinator in f0eed70bb3 (census only; parent 2e10681b32).

## Red 2 (environment) — qualify-linux consumer proofs stopped in proveExpoUpgrades (publication-regressions.mjs:60)
`npm install` failed: ENOENT stat ~/.npm/_cacache/content-v2/sha512/77/53/d99eff2a... ("Invalid response body while trying to fetch
https://registry.npmjs.org/typescript"). The shared npm cache's content had been pruned externally while its index remained
(cache dir sha512/77 recreated 05:59Z, the window in which host free space jumped 47 -> 90 GB from other activity); the entry was
rewritten 4 s after the failure. Not a product defect. Mitigation for the next Linux attempt: private fresh NPM_CONFIG_CACHE.
linux-2 exit 1 after 3,777.5 s. No receipt.
