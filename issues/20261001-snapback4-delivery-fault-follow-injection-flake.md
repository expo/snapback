# Snapback 4: transient follow fault can finish without injecting its fault

Status: Open
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

- [Original failure](../snapback4/reports/20261001-nx-export-proves-native/round1/full-suite-failure-extract.log)
- [Complete suite](../snapback4/reports/20261001-nx-export-proves-native/round1/full-suite.log)
- [Isolated case](../snapback4/reports/20261001-nx-export-proves-native/round1/delivery-fault-47-isolated.log)
- [Baseline/current input hashes](../snapback4/reports/20261001-nx-export-proves-native/round1/delivery-fault-baseline-inputs.json)
