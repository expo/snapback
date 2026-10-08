# Snapback 4: transient follow fault can finish without injecting its fault

Status: Closed
Date: 2026-10-01
Scope: `snapback4/packages/snapback4/test/delivery-fault-matrix.test.mjs`, site 47, transient mode

Lane NX round 1's one complete suite on the Apartment Mac mini failed
`47 transient: local.ts:850 follow` at line 264:
`the classified await must actually experience an injected fault`.
The case completed in 85.902375 ms with `injected === 0`. The client pool had
six file slots; native-control builds were also running on this host.

This is an inherited fixture/input scope: `local.ts`, the delivery-fault
fixture, instrumenter, recipes, site manifest and await-boundary record are
byte-identical to NX's base `bfe1d7d722`. The isolated command below passes
2/2 (classification plus this case). That retry does not erase the original
failure or establish that the fixture is reliable.

```sh
RG_MATRIX_SITE=47 RG_MATRIX_MODE=transient node --test packages/snapback4/test/delivery-fault-matrix.test.mjs
```

Run from `snapback4/` with the built client/wasm and Node 24.18.0. Capture the
follow/sync and fault-arm ordering, then make the injection deterministic
while preserving the reachability, actual-injection, recovery and custody
assertions. Do not remove the final injection assertion to make this pass.

Evidence:

- [Original failure](../../snapback4/reports/20261001-nx-export-proves-native/round1/full-suite-failure-extract.log)
- [Complete suite](../../snapback4/reports/20261001-nx-export-proves-native/round1/full-suite.log)
- [Isolated case](../../snapback4/reports/20261001-nx-export-proves-native/round1/delivery-fault-47-isolated.log)
- [Baseline/current input hashes](../../snapback4/reports/20261001-nx-export-proves-native/round1/delivery-fault-baseline-inputs.json)


## Resolution — 2026-10-08, lane FT

Closed after repairing drift in the already-landed fix `69140d7ca7`. That
repair drains competing sync/install work before the classified await owns its
faulting I/O and explicitly reaches follow before advancing retry epochs.
Lane SN subsequently moved sync coordination into `LocalNetwork`; the test's
private hooks still named removed `syncOnce`/`syncing` locals. FT updates those
hooks, the two semantic follow/flush selectors, and the complete await seal.
All 162 classified I/O sites retain their recipes and assertions. The old
numeric site 47 is now site 48; the follow retry is site 49.
The complete matrix passes 339/339; both modes, competing ownership and joined
follow controls pass 30 loaded repetitions (11 cases per run). Removing the
shared-work drain remains a detecting negative control. Final evidence and
boundary audit are in the [FT report](../../snapback4/reports/20261008-ft-client-flakes/REPORT.md).
