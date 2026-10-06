# Native pilot Phase-2 triage: unmeasured runs fail the launch schema and request an impossible failure snapshot

**Opened:** 2026-10-06, P2A Round 5
**Severity:** Medium
**Status:** Open; instrument finding, no qualified source changed
**Area:** `benchmarks/native/0.4.0-native.1/driver/run.py`, `driver/evidence.py`, `schemas/run.schema.json`
**Related:** LLP 0201.000 §7; [pilot revision 6](../benchmarks/native/0.4.0-native.1/pilot/REVISION-6.md)

The Apartment mini packet `~/clique-native-pilot-20261005/` retains both
SB4 diagnostic segments under
`results/snapback4/diagnostic-audit-refused-never-admissible-no-pass-claimed/`.
Each correctly remains unmeasured: `fixture-compose-nonce` rejects the
builder's seed before app launch. Both run records contain `launches: []`,
`prime.complete: false`, no entered steps and null native assertions.
Independent validation nevertheless exits 2, `schema-invalid:run:launches`.

`run.schema.json` requires at least one launch unconditionally.
`verify_directory` validates this schema before its explicit non-application
failure branch can recognize an unmeasured run. JSON Schema validation over
the original M6 and M8 records reports only that `minItems` error. Phase 2
should qualify a representation for legitimate pre-launch/unavailable runs
while continuing to require actual launch evidence for measured passes.
Do not repair this by inventing a launch, changing these records or relaxing
pass prerequisites. Regression inputs should include these real records.

The driver's exception path also unconditionally requests a tree/screenshot
when a bridge exists. Here it has only attached to an installed app and has
not launched it. XCTest fails the snapshot with “Application … is not
running”, and the bridge waits 35 seconds. This obscures the primary fixture
failure and adds diagnostic operator cost. Qualify a failure-capture path
that accounts for actual app state and preserves the original failure.

Finally, xcodebuild's subsequent simulator diagnostic collection reports
missing `simctl`. The harness was sourced and its own `simctl` operations
succeeded; removing `DEVELOPER_DIR` independently reproduces exit 72.
Investigate the diagnostic subprocess environment without treating this
secondary error as evidence of an app launch crash.

Evidence: packet `preparation/round5/diagnosis/`, including original records,
XCTest/host logs, schema-error census, simulator process logs, crash census,
install/removal receipts and sourced/unsourced environment probes. The
qualified driver, validator, schema and runner remain unchanged. Both
diagnostics stay **audit-refused, never admissible, no pass claimed**.
