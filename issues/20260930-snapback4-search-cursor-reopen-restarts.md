# Snapback 4: search continuation restarts after reconnect and device reopen

Status: Open — reproduced product defect; oracle assertions unchanged.
Date: 2026-09-30.
Systems: `packages/snapback4/src/local-search.ts`, `src/local.ts`;
ordinary-search generated oracle, LLP 3000.028 §3.3/§7.2.

A cursor minted **after a completed reconnect** repeats its first page when
passed to a newly opened client on the same device. No reset, membership,
generation, store or argument change occurs between those two pages. This
violates the oracle's stable-row continuation check and the documented absence
of an in-memory cursor dependency. A longer test timeout cannot repair it.

## Cause and evidence

`ordinarySearch` serializes `env.linkRevision` into the cursor binding
(`local-search.ts`, currently line 167). `createLocalClient` initializes that
counter to zero (`local.ts`, currently line 116). A prior offline/online cycle
increments it to two. The next client again starts at zero, so the old-binding
comparison discards both source positions even when their coverage is unchanged.

Lane SL's third whole heavy attempt failed unchanged process oracle seed 130:
descending, limit five, immutable scope, no cut. Action eight with
`shouldSync:false` closes/reopens without clearing rows. The next page repeats
`m00025`, `m00024`, `𐀀00022`, `m00023`, `00021`; the independent model expects
`m00020`, `m00019`, `m00018`, `m00017`, `m00016`.

A focused trace reproduced this at normal-schedule repetition 154 after 153
passes. It shows the earlier offline/online transition, cursor link revision
**2 → 0**, and identical other binding fields, device epoch, delivery fence,
store/generation identity and audience. The cause of that earlier unsolicited
link transition is not established by this trace; it is unnecessary to the
cursor defect below, which reproduces with an explicit legal reconnect.

The deterministic control forces an offline sync and successful online sync
**before** minting page zero's cursor, then runs the unchanged normal seed-130
assertions. All **five process and five wasm repetitions fail** at the same
page-one equality assertion. No timeout, assertion, seed or case in the whole
suite was changed to accommodate the defect.

## Reproducer and records

The [SL report](../snapback4/reports/20260929-sl-suite-under-load/REPORT.md)
contains the whole run (`qualified-heavy-3`, `== 1 failure(s) in 3757 s`), all
passing/failed diagnostic attempts, source hashes, raw logs and
[`search-failure-traces.json`](../snapback4/reports/20260929-sl-suite-under-load/search-failure-traces.json).
[`search-failure-analysis.json`](../snapback4/reports/20260929-sl-suite-under-load/search-failure-analysis.json)
compares the cursor fields. From `snapback4/`, after the ordinary builds and the
report's containment-helper setup:

```sh
python3 reports/20260929-sl-suite-under-load/prepare-search-control.py
python3 reports/20260929-sl-suite-under-load/prepare-search-reconnect-control.py
python3 reports/20260929-sl-suite-under-load/run.py search-reconnect-reproduction 48 -- node --test --test-reporter=spec target/sl-load/controls/ordinary-search-reconnect.test.mjs
```

The control's ten failures are expected on this source. A passing ordinary
whole-suite repetition does not close this ticket.

Next: define a reopen-compatible link/coverage binding while preserving actual
offline/online plan invalidation and all store, generation, membership, viewer,
argument and reset fences. Add a named regression covering both device hosts;
do not teach the oracle to accept a repeated first page.
