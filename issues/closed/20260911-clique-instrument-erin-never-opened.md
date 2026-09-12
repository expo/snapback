# Clique instrument: Weekend Plans includes Erin; choreography never opens her

**Status:** Resolved
**Priority:** P2
**Date:** 2026-09-11
**Systems:** Clique frozen instrument (social-messenger M3), choreography `group-receipt-waits-for-slowest-member`
**Related:** `benchmarks/briefs/social-messenger.md`; frozen instrument commit `f40559f37722c79178be664a11f8a6485f1508fd`

## Symptom

The M3 starter group “Weekend Plans” includes Erin. The required choreography assertion `group-receipt-waits-for-slowest-member` opens only Alice, Bob, and Carol, then expects aggregate `read`. Under send-time recipient-set semantics, Erin never reading makes that default fixture impossible.

Both 0.0.24 and 0.0.25 Astra builders independently recorded an instrument skip and used the documented `fixtures.groupTitle` adapter against a suite-created three-person “Proof Trio.” That is the correct local workaround. It still costs a documented skip on every Clique run until the starter and the assertion agree.

## Evidence

- 0.0.24 `lanes/astra-snapback2/evidence/instrument-gaps.md` (full write-up).
- 0.0.24 run-log epoch `1789164097`; 0.0.25 epoch `1789164612` and `evidence/instrument-skip-m3.json`.
- Assertion name: `group-receipt-waits-for-slowest-member` in `choreography/choreography.mjs`.

Do not “fix” this by fabricating an Erin receipt.

## Requested outcome and acceptance

Either:

1. Remove Erin from the Weekend Plans starter membership used by that assertion, **or**
2. Launch Erin’s client in the choreography, **or**
3. Make the default fixture the three-person group the assertion already drives, and keep Weekend Plans as a separate four-person seed that the assertion does not use.

Acceptance: a cold Clique M3 run on the frozen instrument gets `group-receipt-waits-for-slowest-member` green on the **default** starter without an adapter skip. Update the instrument in the next Clique freeze; do not silently edit a run in flight.

## Resolution (2026-09-11)

The next frozen instrument is `social-messenger@0.3.7-m8`. Its default
`Weekend Plans` group contains Alice, Bob, and Carol, matching the three
clients that `group-receipt-waits-for-slowest-member` opens. The two starter
messages previously authored by Erin are now authored by Carol, and the dinner
reply says “for three.” Erin remains a starter persona. Dave remains absent
from the starter group so the separate M3 membership assertion can add him.

The committed generator, M3 log, starter invariant, and combined invariant all
carry the new three-member state under fixture version `0.2.2-m8`. The
choreography self-test now refuses before a lane starts unless the default
group's exact membership is Alice/Bob/Carol, every starter group-message author
is a member, and Dave remains addable. The manifest and current emitters,
schemas, meter, validator, setup identity, and lane setup moved together to
`0.3.7-m8`; schema compatibility retains `0.3.6-m8`. No file under
`benchmarks/runs/` changed.

Evidence:

- Fixture regeneration and validation: `generate.mjs starter`,
  `generate.mjs manifests --update-starter`, then `validate.mjs` over all three
  starter logs plus `sample-50.log`: 136 actions valid; M3 has 18 actions.
- Headless Chromium choreography self-test: PASS, 10 assertions, with M1, M7,
  and M8 green plus startup-refusal and retained-version schema coverage. This
  focused harness test also executes the new cold-starter membership/sender
  preflight; it does not claim a product-backend M3 rerun.
- Lane setup and snapshot validation: 12/12 pass; the resolved immutable
  snapshot reports pin `social-messenger@0.3.7-m8`, manifest SHA-256
  `565273b97d8acfe8a657b3655a20d4295ba59b1e7221cad28e2715cf43740923`,
  and rejects digest drift.
- Choreography startup tests: 8/8 pass. Observability tests: 3/3 pass.
- Metering, retained-record compatibility, materialization, and record
  validation tests: 119/119 pass with loader-injection variables scrubbed as
  required by the harness. This includes a physical-root regression proving
  retained `0.3.6-m8` stays historical while mixed-current, downgraded, and
  unknown pins remain fail-closed.
