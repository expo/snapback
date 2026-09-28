# Snapback 4: online typing retention witness fails during the full suite

- **Status:** Open
- **Date:** 2026-09-28
- **Area:** `snapback4/packages/snapback4/test/ephemeral-keep.test.mjs:91`
- **Observed during:** EX round 1, sole `scripts/test.sh` run after merging `5763da073`
- **Classification:** Baseline failure in unchanged runtime/test inputs; cause unconfirmed

`online: kept typing survives member commits and expires during a held re-read`
failed with `no publication hides typing during the burst` after 4421 ms.
The full run's wasm and process variants passed. A focused serial rerun passed
with 45 kept publications, all visible; expiry was 4433 ms after the call.

The test and all SDK, core and device runtime sources are unchanged by EX.
Its compiler edit changes prediction-note prose only. This is not evidence
that the production retention contract is broken or that host load alone
caused the failure. In particular, the wall-clock witness sets a four-second
life once, then performs a nominal two-second burst without renewal; a delayed
burst can overlap legitimate expiry. Instrument publication timestamps and
the server deadline before selecting a fix. Do not remove the withdrawal
assertion or increase a product expiry to make the test pass.

## Reproduction

From `snapback4/`, after building the package and binary:

```sh
node --test --test-concurrency=1 --test-name-pattern='^online: kept typing survives' packages/snapback4/test/ephemeral-keep.test.mjs
```

The isolated pass does not resolve the full-run red. Evidence is retained in
`snapback4/reports/20260928-ex-social-example/round1/test-sh.log.gz` and
`full-failure-controls.log.gz`. This is separate from the closed
`20260926-snapback4-ephemeral-watch-loading-flicker` ticket: this witness already
opts into retention and fails in the online arm, not the old local fallback.
