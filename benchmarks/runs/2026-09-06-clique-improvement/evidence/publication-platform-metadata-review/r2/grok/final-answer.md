Verdict: READY

Candidate `f681a72ef3ff495edfc354291ba232c19018259e` (parent `7884642fbddeb56bd18a03215e23c6761c76cd87`) puts one exact supported-platform predicate on both stripping old platform optionals and accepting selected artifacts. The names are `snapback2-darwin-arm64` and `snapback2-linux-x64`, matching current source `packages/snapback2/package.json`. Unrelated `snapback2-plugin` and `snapback2-plugin-tools` are no longer treated as platforms. Production and development still stage through that helper; production still verifies packed names and the dependency map, then qualifies the installed consumer before publish.

This is a source assessment of implemented behavior. Recorded passing tests are run records, not a verdict.

### Classification (source deduction)

Parent used two different rules in `baseline/snapback2/scripts/consumer-smoke.mjs`: drop anything starting with `snapback2-`, then accept `/^snapback2-[a-z0-9]+-[a-z0-9]+$/`. That deleted `snapback2-plugin` on Darwin-only staging (historical r1 Astra preserve-optional, exit 1) and would have accepted `snapback2-plugin-tools` as a platform.

Candidate `snapshot/snapback2/scripts/consumer-smoke.mjs:8-19` uses `isPlatformPackage` for both sides. Staging writes only `optionalDependencies` and only after that helper returns (`:26-30`). Ordinary `dependencies`, `peerDependencies`, and `peerDependenciesMeta` stay on the parsed manifest.

### Selections and refusals (source deduction)

Valid Darwin-only, Linux-only, and both-platform maps are representable. Version mismatch, duplicates, empty selection, `react`, both plugin names, and `snapback2-darwin-x64` throw before the shim is rewritten (`publish.test.mjs:54-64`, errors at `consumer-smoke.mjs:13` and `:19`). Linux-only in these fixtures is a name/version map, not linux runtime qualification.

Packed identity: `verifyPlatformDependencies` (`consumer-smoke.mjs:33-54`) compares tarball `package.json` name/version to artifact records and rebuilds the expected optional map with the same helper. A resumed shim that still lists a platform absent from the artifact list is refused without rewriting tarballs (`publish.test.mjs:66-73`). Extra/missing platforms fail that map check; an extra non-platform artifact fails `isPlatformPackage`.

### Call paths (unchanged files, new helper)

`publish.mjs` still builds `snapback2-${process.platform}-${process.arch}`, stages that pair (`:577-579`), qualifies media plus the dependency map (`:601-605`), then `consumerSmoke` before publish (`:881-899`). `measure.mjs` still calls `packDevelopmentConsumer`, which stages the same host identity with the same function (`consumer-smoke.mjs:157,173`). `build.mjs` still copies source `package.json` unchanged; classification happens after the copy. On this Darwin arm64 host the constructed name is a recognized platform. An undeclared host now fails staging instead of publishing a two-word-suffix name the source does not declare. Recognizing a name is not runtime qualification.

### Fixture scope

Preservation tests are synthetic JSON: they show plugin optionals survive and are refused as platforms. They do not install those plugins. Current source does not declare them.

The npm 11 consumer (`publish.test.mjs:83-133`) is host-only, offline synthetic tarballs, unchanged package/lock after `npm ci`. It does not prove plugin optionals in a lock, linux/combined-platform *install*, unresolved extra optionals, or linux runtime.

### Historical failures this correction does not erase

- Combined-platform mandatory tarball install on Darwin: verifier accepted both identities; `npm install` failed `EBADPLATFORM` for linux-x64 (r1 Astra, exit 1). Tarball operands are mandatory.
- Unresolved synthetic optional: Darwin-only staging kept `unrelated`; `npm ci` failed `Missing: unrelated@ from lock file` (r1 Grok, exit 1). Host-only without that optional then passed.
- Published `snapback2@0.0.15` still lists both platforms; linux-x64 is registry 404. Unchanged original locks fail npm 11 ci with `Missing: snapback2-linux-x64@` and succeed on npm 10.9.8. Those artifacts are historical, not this candidate’s output.

### Findings

No actionable findings.

### Optional commands actually run

None. Classification, call paths, and fixture limits were resolved from packet source and raw records. Historical counterexamples were not repeated.
