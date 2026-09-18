# Repair B integration, round 2

The integration starts at main parent `04def4945175f0623f8073e180aca1135c646960`
and lane parent `456782dbb785af9b6c66fa5a35e74546396bb20a`. No push, rebase,
or change to either merge parent. The 411,000 B budget is unchanged.

## Disposal and the two client faults

[LLP 3000.001](../../llp/3000.001-durable-replica-and-write-lifecycle.research.md#repair-b-replacement-disposal)
records the rule: accepting a valid first replacement page **discards the ordinary
slot's effects and accumulated acknowledgements together**. It does not install
them first. The transaction rolls back disposal if the page is rejected.
Incarnation binding and maximum validated head evidence survive in snapshot
staging, including restart after reopen. The published base, watermark and live
predictions remain unchanged until terminal snapshot catch-up publishes. Only
the replacement acquisition's receipts can then suppress predictions. In
particular, an ACK absent from the replacement cannot retire a prediction merely
because it was present in the discarded slot. Previously published delivered
history follows the existing retention policy; private ordinary effects never
become delivered history by disposal.

The device now validates snapshot continuation requests against zero and their
opaque `after` token, and catch-up requests against the staged cut. The client
keeps server-instructed restarts and all snapshot continuation requests at
`from: 0, stream: false`, even when native `sync_state` reports an older published
or deferred cursor. This fixes both the overwritten restart cursor and the
second page's `obsolete deferred transfer page` refusal.

Overflow observation uses an empty **nonterminal** envelope (`more: true`). It
preserves explicit `images_at` when supplied, but never substitutes an event cut
for a server head. Identity observation, real rewind detection, page validation,
ordinary deferral and the server's indivisible-commit overflow behaviour remain
in force. No HTTP ceiling or wasm budget changed.

## Attribution of the incoming 26,135 B

The main parent measures 410,459 B gzip; the incoming integration is 436,594 B.
The following are **ordered source-ablation measurements**, not independent
removable costs or proposed implementations. Starting with an isolated copy of
the incoming sources, remove opening, then restore observation, then capture,
then deferred storage. Each build uses the production build script, bindgen,
`wasm-opt -Os` when smaller, and `gzip -9`. Shared optimization and compression
are charged to the step that removes them. The remaining delta is explicitly
reported rather than assigned arbitrarily to a feature.

| Area removed | Artifact after removal, gzip B | Marginal gzip B |
| --- | ---: | ---: |
| Incoming integration | 436,594 | — |
| Wasm opening: initial-backend envelope/dispatch and checked kept-backend installation | 435,376 | 1,218 |
| Private restore observation/evidence and adoption capture | 433,722 | 1,654 |
| Request capture, declaration validation/recovery and replay exclusion | 426,833 | 6,889 |
| Deferred slot, fold/record/install, deferral decision and bound validation | 416,009 | 10,824 |
| Remaining shared publication/lifecycle, additive wire/outbox and integration changes vs main | 410,459 | 5,550 |
| **Total growth** | | **26,135** |

The TypeScript client's opening changes contribute **0 B to wasm**; only the
Rust opening entry point and store installation above live in this artifact.
The residual includes cross-cutting publication/snapshot state, receipt
ownership and lifecycle integration still reachable after the four probes.
The final residual row is a subtraction against the measured main control,
not a fifth source-ablation build.

Probe details: opening restores main's `web.rs` and ordinary opening install;
restore restores main's observation body and removes private evidence/capture
helpers; capture bypasses the immutable declaration subsystem while preserving
ordinary pending-ID enumeration; slot bypasses fold/record/install and the new
bounds check while retaining the ordinary applicator. These probes intentionally
do not implement the invariant and are confined to ignored `target/` sources.
They are never linked into the tested production artifact.

Local evidence is under `target/repair-b-integration-r2/`: the executable
`attribute-probes.py`, `probe-sizes.jsonl`, five `probe-*.log` build transcripts
and their wasm artifacts. Source restoration explicitly refreshes mtimes so
Cargo cannot reuse an ablated artifact for the baseline. That baseline was
reproduced at exactly 436,594 B after the probes. The original main control is
`target/repair-b-integration/origin-main-forced-wasm-build.log` (410,459 B).

Toolchain: rustc 1.97.0 (`2d8144b78`), cargo 1.97.0, wasm-bindgen 0.2.127,
wasm-opt 132, Node 24.18.0. No optimizer or compiler configuration changed.

## Cheap reductions

The serde family/absence census passes. The lane introduces no unexpected
second typed JSON reader or writer family; the existing permitted counting
writer is unchanged. The initial symbol census shows 50,324 raw shallow B
in symbols naming `deferred`, including 22,711 B naming `Recording`; these are
inclusive, overlapping symbol groups, not gzip costs. Recording instantiates
the ordinary applicator and some helpers a second time.

Measured candidates, in order:

| Change | Gzip B | Delta B |
| --- | ---: | ---: |
| Incoming integration | 436,594 | — |
| Initial correctness fixes | 436,562 | −32 |
| Unstable sort of unique submission IDs; direct insertion of adoption capture keys | 436,150 | −412 |
| Trial shared applicator via trait object | 438,790 | +2,640; **reverted** |
| One recording map containing presence, changed flag and admission provenance | 433,908 | −2,242 |
| Preserve disposed image-head evidence across snapshot restart/reopen | 433,908 | 0 |

Submission ties remain errors, so stable tie ordering carried no meaning. Direct
capture insertion avoids building/sorting an intermediate collection. Combining
the two row-keyed recording maps removes duplicate collection machinery and
keeps presence and provenance in one entry; the durable `RowEffect` format is
unchanged. Existing marker-only admission upgrades, delete/recreate, fold order,
metadata failure and both-store regression coverage exercise these semantics.
The trait-object experiment reduced raw bytes but compressed worse, so none of
its signature changes remain.

The final artifact is **1,576,856 B raw / 433,908 B gzip**. The retained cheap
reductions save **2,654 B** against the corrected implementation; including the
32 B change from the correctness fixes, the incoming artifact shrinks by
**2,686 B**. The remaining delta over the main parent is **23,449 B (5.71%)**.

A budget set to the exact measured size would rise **22,908 B (5.57%)**, from
411,000 to 433,908, with no headroom. No budget change is made here. Relative to
the diet's 520,557 B starting point and this main parent's 410,459 B, accepting
the final lane spends **21.3% of the 110,098 B recovered**. The retained overall
saving would be 86,649 B. The 23,449 B lane delta is larger than S2's shelved
19,897 B saving and consumes 67.4% of S4a's measured 34,781 B saving; those
branches are comparisons, not promised stackable reductions on this tree.
The discarded trial demonstrates why raw code savings alone cannot justify a
ratchet change.

## Verification

Full command output is retained verbatim under
`target/repair-b-integration-r2/`, including warnings, individual tests,
skipped counts and failure summaries. The combined
[verbatim transcript](../target/repair-b-integration-r2/verification-verbatim.txt)
contains all four commands, with each exit code and working directory.

| Requested command | Exit | Result | Verbatim stdout/stderr |
| --- | ---: | --- | --- |
| `cargo test -p snapback4-device` | 0 | 872 passed, 0 failed, 3 ignored | [device](../target/repair-b-integration-r2/cargo-test-device.log) |
| `cargo test -p snapback4-core` | 0 | 163 passed, 0 failed | [core](../target/repair-b-integration-r2/cargo-test-core.log) |
| `cargo test -p snapback4` | 0 | 265 passed, 0 failed | [CLI](../target/repair-b-integration-r2/cargo-test-snapback4.log) |
| `bash snapback4/scripts/test.sh` | 1 | Every test/typecheck/build step passes except the wasm byte gate | [full suite](../target/repair-b-integration-r2/full-suite.log) |

The final suite's byte line and terminal result, verbatim:

```text
wasm 1576856 B raw, 433908 B gzip (budget 411000: OVER by 22908 B — issues/20260913-snapback4-wasm-device-diet.md)
== 1 failure(s) in 235 s
   wasm build
```

README member coverage and TypeScript example coverage pass. The 104-case
Repair B target, the six boundary tests, ordinary device/core/CLI suites and
client/server overflow regressions all pass. Both the serde-family check and
server-only/Unicode-table absence check pass on the final sources.

Intermediate transcripts are also retained. Early direct runs exposed the
superseded refusal assertion and synthetic fixture cursor reuse; the fixtures
now require authoritative disposal and retained unacknowledged predictions.
`full-suite-initial.log` captured the old boundary assertion before that test
was updated (and the same byte overrun); every client test passed in that run.
The final suite above reruns the corrected source and has no test failure.
