# SN round 4: refresh the exact capability-free backend pin

2026-10-08. Base: `2baacccde1`. Work stayed in lane-sn on eb1000; nothing
pushed or published. The Darwin fence will be rerun by the author on the mini.

## Byte change and compatibility boundary

Read the author's [Apartment mini log](/home/ccheever/sb4-intent/sn-evidence/darwin-fence-r3.txt).
At the round-3 tip, published 0.2.33 native and WASM devices passed install,
adopt, query and reopen; published doctor and mixed-version serve refusal/store
preservation also passed. Only the subsequent exact backend pin failed. These
are supplied macOS results, not a macOS run from this lane.

Regenerated `packages/snapback4/test/fixtures/capability-free-0.4.backend.json`
from a real current `dev` server's `/schema` response for the exact control
source (`use identity guests` plus `ordinary`). Removed only the trailing random
`store_id`, using the fence's existing regex. The new pin is **3,100 bytes**,
formerly **2,950**, SHA-256
`c32d97550b9e16c302baca23a461a11411cd99d436ea8bdd2b8a4eee51748e7a`.
The 150 added bytes are exactly three program `settlement` members. Removing
only those members reproduces the prior pin byte-for-byte; every other byte is
unchanged. The strict length and buffer equality assertions remain. The comment
beside the pin records the additive summary and the supplied published-device
behavioural evidence.

A new Linux compiler regression first failed against the old pin
([red log](pin-before.log)), then compares the entire compiler-produced backend
with the regenerated fixture. It also checks the old exact schema bytes and
proves decoding the public envelope yields exactly the original typed device
backend encoding. No product implementation or compiler-summary rule changed.

## Stored schema and device persistence

The next Darwin assertion and its two allowed diagnostic-string substitutions
are byte-for-byte unchanged. Without macOS, verified its inputs as follows:

- The old and new backend pins have identical `schema` values. The existing
  `capability-free.schema.json` golden file is unchanged.
- A real Linux server's `_generations.schema` equals that golden file byte-for-byte:
  **1,359 bytes**, SHA-256
  `3332755018a4eee39994e3e431051a39dc54fcfd0d7af5e37e9c671418f19745`.
- The Linux core schema-capability regression compiles the same source and checks
  that exact schema encoding, round-trip identity and hash, plus the backend pin's
  schema. It passes without changing the old schema fixture.
- The compiler test decodes the new wire envelope into `device::Backend` and
  compares its complete serialization with a backend built directly from the
  original bound `Program` IR and schema. The summary is absent.
- Real current native and WASM devices install and adopt the new backend. The
  native SQLite `_meta['device:backend']` and WASM drained persistence have the
  same **2,389-byte** summary-free encoding, SHA-256
  `eb27bfdce483dab7266d3d91032bba98ea8023c06bd159aa8fd067f3e0267c48`.
  WASM reopening retains that backend. Runtime program enumeration uses name
  order; this is checked separately from exact persisted bytes.

These checks establish that SN did not change the stored-schema comparator's
inputs or typed IR/storage. They do not replace running the real 0.2.33 native
compiler comparison on Darwin. That full fence remains the author's rerun.

LLP 3000.023 §11 and its Revised line now explicitly record the envelope byte
change and the one-time updated backend fetch/adoption on server upgrade, with
no new capability, storage migration or IR change.

## Verification and a missed test-fixture repair

Running the entire language package, beyond the earlier targeted settlement and
guide selection, exposed four test-only `StreamReply` constructors missing
round 2's optional `changes` field ([initial compile failure](compiler-before.log)).
Added `changes: serde_json::Value::Null` in the Clique, derived-maintenance,
column-commit and timeline-delivery helpers. Null is omitted by the existing
serializer, preserving these fixtures' prior wire bytes. Their assertions and
production serialization are unchanged; the affected tests are included below.

| Check | Result | Evidence |
| --- | --- | --- |
| SDK dependency checker | `deps-ok` | [deps](deps.log) |
| Full `cargo test -p snapback4-lang`, including compiler and guide | 1,541 passed, 13 existing ignored | [compiler/guide](compiler-guide.log) |
| Core schema-capability tests | 8 passed | [schema](schema-capabilities-rust.log) |
| JS schema-capability file plus real compiler/storage witness | 4 passed, 7 Darwin-only skipped | [Linux fixture](linux-fixture.log) |
| Affected native transport fixtures | 26 passed | [column/timeline](transport-fixtures.log), [delivery](timeline-delivery.log) |
| Root `./ref-check --verbose` | 531 docs, 10,562 refs; zero errors/unchecked | [references](ref-check.log) |

The language total includes all six query-settlement tests and all 113 guide
checks. The 13 ignored tests are existing explicit measurements, calibration
fixtures and deferred controls; no ignore was introduced. The seven JS skips
are the declared darwin-arm64-only published-device cases. Compiler and native
checks used `CARGO_BUILD_JOBS=8 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0
CARGO_PROFILE_TEST_DEBUG=0`. Native commands were `cargo test -p snapback4
--test timeline --test column_commit` and `cargo test -p snapback4
--test timeline_delivery --test timeline_delivery_counterexample`; the core
command was `cargo test -p snapback4-core --test schema_capabilities`.

[Measurement](fixture.json) and [reproducible witness](fixture-witness.mjs) are
retained. From `snapback4/`, run the witness with
`node scripts/run-client-tests.mjs 1 files reports/20261007-sn-one-shot-settlement/round4/fixture-witness.mjs`.
For intentional regeneration, prefix that command with `SN_UPDATE_BACKEND_PIN=1`.
It verifies the delta against the immutable round-3 pin before writing.
The witness initially used the public client metadata namespace and then compared
runtime name order with stored source order; both harness assumptions were corrected
before the retained passing run. No intermediate harness failure is counted as a pass.

No device/wasm implementation or budget changed. This round makes no new wasm
measurement claim; round 3's byte-identical Linux measurement and 500-byte
headroom remain the last measurement.
