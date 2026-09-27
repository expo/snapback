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
