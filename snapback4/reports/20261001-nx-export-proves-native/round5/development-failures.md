# Round 5 development failures

- `js-failure-development.log`: 5 passed, 1 failed. Test fixture error: the
  interposer selected `/var/.../dist`, while the wrapper used the canonical
  `/private/var/.../dist`; no fault was injected. Canonicalized the fixture root.
  `js-failure-recheck.log` then passes both new tests; the full 19-test affected
  run in `js-export.log` passes.
- `js-export-final.log`: 18 passed, 1 failed. Effective Expo config evaluation
  timed out in an existing plugin-resolution control. Shared mini load observed
  during this period: 190.13 / 212.63 / 199.55; many other Rust/Xcode processes
  were active. The config tests pass 3/3 in `js-config-recheck.log` without a code
  or timeout change. Classified as an intermittent evaluation timeout under
  contention; exact causation is not established. Every log is retained.
- `linux-missing-compiler.log`: initial GMKtec Linux host lacked `cc`; no test
  executed. Moved verification to expo-build-450a with a C compiler.
- `linux-missing-fixtures.log`: copied Snapback 4 source lacked two top-level
  benchmark files needed by an unrelated compile-time include. Copied the exact
  schema/window fixtures; the Linux units, integration and JS tests then pass.
  A connection probe to Minisforum timed out; no work ran there.
- Two audit helper edit commands used a path relative to the repository while
  their cwd was already `snapback4/`; edits failed before mutation. One subsequent
  helper run overwrote its own delta summary with an empty current-to-current
  comparison. Restored the comparison from round 4's recorded installed file
  identities and the current files, then verified only the two intended files
  differ. No product file was affected by the failed edit commands.
- Initial dependency audit omitted the changed `snapback4-expo` package-tree
  digest while adding its complete dependency snapshots. Existing conservative
  behavior therefore retained app JS in the key, and the first two nominal
  `warm` attempts rebuilt. These successful cache misses are retained and are
  not warm samples. Added the audited package digest, rebuilt the CLI, and used
  separately named `*-final` priming and warm runs. No key coverage was relaxed.
- Wasm's first local summary used Python gzip, whose header omitted the wasm
  filename (604,641 B). Corrected the summary to the canonical build command,
  `gzip -9 -c <wasm path>`: 604,666 B; raw bytes/hash were identical throughout.
- `rust-witness-final.log`: default-parallel witness units were 24/25. The
  unchanged `lease_preserves_an_existing_owner_and_releases_on_drop` test failed
  its immediate reacquisition after dropping the owner. All new controls passed.
  The canonical runner uses one thread for this binary; the serialized rerun is
  retained separately. A concurrent fork briefly inheriting the open-file lock
  before exec is a possible explanation, not an established root cause. No lock
  implementation, timeout or assertion was weakened to make it pass.
  Serialized affected rerun: 25/25 passed in 8.03 s; the earlier parallel red is
  not relabeled. `issues/20261002-snapback4-witness-parallel-lease-test.md` retains
  the unresolved observation and proposed isolated reproduction.
- The focused delivery-fault rerun is 7/8, exit 1: case 47 transient fails because
  no fault was injected at its classified await. Case 47 persistent and 48's
  transient/persistent variants pass. The unanchored selection additionally runs
  cases 147/148 in both modes; those four pass. This is retained as an unresolved
  fixture coverage failure in unchanged code, not a passing product check.
