# QRY wave-18 evidence

Target 0.4.35; package version deliberately remains 0.4.34. Root
[WORKSTREAM-REPORT.md](../../../WORKSTREAM-REPORT.md) is the delivery index.
The inherited Integration 18 report is preserved separately.

- CONTEXT.md: governing LLP constraints and affected-scope documentation audit.
- FROZEN-REPRO.md: original branch bodies versus completed-app workarounds;
  distinguishes the executed cask reproduction from source-level analysis.
- SURVEY.md: explanation of all 11 final new notes in five of 200 applications.
- survey-before.json.gz, survey-after-final.json.gz, survey-final-comparison.json:
  baseline/final 100 wave-15 + 50 wave-16 + 50 wave-18 schemas; 200 compile before
  and after, all source hashes unchanged. survey.py uses owned copies/cleanup.
- survey-after-initial.json.gz, survey-initial-comparison.json: preliminary
  12 notes in seven apps before helper/key precision and read-through coverage.
- difftest-run.json: 20,000 cases, 1,220,035 comparisons, zero findings.
- difftest-devices.json: seeds 0–999, 27,922 comparisons, zero findings.
- difftest-lean.json: 20,000 cases, 56,917 comparisons, same four known
  signatures / 130 findings; no new signature.
- rust-coverage.json: all 426 default unit/integration targets, 5,960 tests
  passed; six doctest targets including 17 passing cases. test-census.py maps
  bounded/resumed logs to Cargo's target inventory, excluding partial targets.
- linux-summary.json, linux-consumer.json.gz, linux-proofs/: fresh packed
  consumer qualification at 2a3876cfda, Ubuntu/Alpine and all named proof lanes
  passed. Consumer-only intentionally omits forbidden scripts/test.sh and
  cannot authorize publication. Expanded app scratch was removed.
- package-binding.json: exact qualified source and prepared client/Expo hashes.
  All three exact tarballs plus consumer.json remain in
  /home/ccheever/sb4-qry-packed for coordinator handoff.
- logs/: compressed final Rust, Mac, packed-client, root-check, wasm audit and
  Linux qualification logs. Timeouts in broad commands remain timeouts;
  complete target coverage is established by the resumed logs/census.
