# Snapback 4 authentic predecessor fixture rejects execution-facts admission

Status: Open
Owner: baseline maintenance, outside wave-24 DX7
Discovered: 2026-10-23

The full five-crate test run fails
`allocation::dependencies::derived_prediction::round1::authentic_predecessor_stores_open_install_and_converge`
in `snapback4-lang --test declarative_receipts` while opening the preserved
`rp-predecessor/server.sqlite` fixture, before adoption:
`Schema("add: execution facts changed without a program change")`.

The identical failure reproduces on unmodified origin/main `cadb7c55be`.
The comparison used a disposable git-archive snapshot with the original
`starter-before.q` report input copied verbatim from git. No fixture or assertion
was changed. Provenance: `~/sb4-loop/dx7-baseline-lang-results.json`; full log:
`~/sb4-loop/dx7-baseline-declarative_receipts.log`. The disposable source and
target were removed after the comparison.

Reproduce with `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0
CARGO_PROFILE_TEST_DEBUG=0 cargo test -p snapback4-lang --test declarative_receipts
allocation::dependencies::derived_prediction::round1::authentic_predecessor_stores_open_install_and_converge
-- --exact` from `snapback4/`.

Investigate execution-facts derivation and predecessor admission together under
LLP 3000.022 §14 and its declarative-receipt refinements. Preserve the historical
fixture's authenticity; do not regenerate it or weaken admission just to clear
the test. The independent source-reservation failures are tracked separately in
`issues/20261022-snapback4-residency-source-reservations-baseline.md`.
