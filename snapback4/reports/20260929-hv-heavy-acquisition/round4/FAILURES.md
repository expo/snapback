# HV round 4 failure ledger

The required single full suite exits 0: **`== 0 failure(s) in 1634 s`**.
Full-suite failures: **ours 0, baseline 0, environmental 0**. Final affected
checks also all pass. The distinct setup/experimental failures and residual
baseline limitation below are retained so they are not concealed by that result.

- **Ours, inherited HV size debt:** merged source without Binaryen weighs
  596,818 B gzip, 3,099 B over the fixed cap. Its initial build correctly
  exits 1. The source-only range trial saves 522 B but still exits 1 at
  596,296 B. Discarded; both existing compact-index differential tests passed.
- **Ours, setup:** two editing snippets used an extra `snapback4/` prefix
  while already inside that directory and failed with FileNotFoundError.
  Neither changed files. The first left the new mixed-direction trial test
  out of the existing-test run; that test and the trial were later discarded.
  The second launched an unmodified raw rebuild (596,818 B, expected exit 1),
  now accurately named `setup-unmodified-rebuild.log`. No failed script is
  treated as evidence that the pinned optimizer ran.
- **Ours, detecting test during implementation:** after build-wasm was pinned,
  the strengthened build-script test failed with exit 91 because measure-wasm
  still called the deliberately poisoned PATH optimizer. Pinned measurement
  too, aligned its passes and dirty-input list; the complete test then passed.
- **Ours, Mac setup:** the first remote driver started before the transferred
  wasm-bindgen binary arrived and stopped at `mv` (no build or install ran).
  The driver is retried only after transfer completes. Its original log is
  retained as `mac-driver-setup.log`.

- **Environmental, Mac build setup:** the M4 mini's selected Xcode toolchain
  refused host build-script links because its Xcode license had not been
  accepted (cc exit 69, Cargo exit 101). This is not a wasm-budget failure.
  No license acceptance or machine-wide toolchain change is performed. Selecting
  the installed Command Line Tools for the process fixes the setup; both builds pass.

- **Baseline, reproducibility limitation:** complete Linux/Mac Rust builds are
  different despite the same Rust/wasm-bindgen version strings. Both fit and each
  host repeats identically. Identical input optimizes to identical output across
  hosts. A discarded path-remapping experiment still differs; one diagnostic
  comparison isolates a walrus 0.26.4/0.26.5 producer-version byte. The existing
  reproducibility ticket remains open; no cross-host full-build identity is claimed.

Expected refusal controls are successful tests, not product failures: malformed
or missing budgets, an over-budget build, missing/mismatched locked Binaryen,
an optimizer error, and a failing family census. The test PATH optimizer exits
91 if accidentally consulted. No assertion, timeout, count or ceiling is relaxed.
