# Snapback 4: four Linux publication guarantees are only partly pinned by tests

- **Opened:** 2026-09-27, from the round-2 reviews of lane LX
  (`~/sb4-intent/reviews/lx-r2.{astra,grok}.md`: READY WITH CHANGES and READY).
- **Severity:** Low. Test strength only. Each guarantee holds in the code and
  in the real proot qualification; a regression could slip past the unit tests.

1. **The round-trip proof script.** Replacing every copied
   `publication-roundtrip.mjs` with an immediate exception still passes all
   95 tests. Execute the unchanged script under mocked subprocess and client
   boundaries, asserting its operations and failure propagation (Astra).
2. **The proot environment allowlist.** The integration mock ignores
   `opts.env`, so `env: { ...process.env, ...prootEnvironment(temporary) }`
   passes all 18 qualifier tests. Seed host sentinels and assert that only the
   allowlist reaches proot (Astra).
3. **The fake install.** `linux-proof-harness.mjs:24` records the tarballs'
   digests without reading `process.argv`, so an install line replaced with
   `npm --version` passes. Record the arguments and assert both tarball paths
   (Grok).
4. **The SQLite flags Cargo sees.** `linux-package.test.mjs:13` pins the
   `export` text; `-u LIBSQLITE3_FLAGS` on the `cargo` line alone still passes.
   Require the fake Cargo's `process.env.LIBSQLITE3_FLAGS` to equal
   `sqliteBuildFlags` (Grok).

## Resolution — 2026-09-27, lane LX round 3

**Status: Closed.** Production behavior is unchanged. Resolved all four:

1. `publication-roundtrip.test.mjs` executes an unchanged copy of the real
   proof with mocked subprocess/client boundaries. Fourteen cases pin the
   complete CLI/client call sequence, returned-result assertions, error
   propagation and cleanup. Replacing the proof with an immediate exception
   makes the success test fail (exit 1); a no-op also fails.
2. `qualify-linux.test.mjs` seeds synthetic host Node/loader/binary/token/
   cloud/extra-variable sentinels and compares every actual proot `opts.env`
   against the exact allowlist, including Alpine setup. Spreading
   `process.env` into that invocation fails with `actual proot subprocess
   environment must equal the allowlist` (exit 1).
3. `helpers/linux-proof-harness.mjs` records fake npm's real arguments and
   requires the install verb/flags and both `/proof/client.tgz` and
   `/proof/platform.tgz`. Replacing install with `npm --version` fails on
   both routes; removing either tarball path fails too (each exit 1).
4. The redirected-target fake Cargo in `qualify-linux.test.mjs` asserts its
   actual `process.env.LIBSQLITE3_FLAGS === sqliteBuildFlags`. Unsetting
   that variable immediately before Cargo, while retaining the export,
   fails with `Cargo must receive the publication SQLite flags` (exit 1).

All eight independent mutation controls failed exactly one selected test.
Unmutated checks: **109 affected tests passed; whole guide 86 passed**.
No full suite was run, per the round-3 instruction. File-by-file changes,
exact mutation replacements, commands and failure evidence are recorded in
[the round-3 report](../../snapback4/reports/20260927-lx-linux-package/REPORT.md#round-3--close-the-four-publication-test-gaps-2026-09-27).
