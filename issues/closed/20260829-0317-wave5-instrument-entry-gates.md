# LLP 0317 Wave 5 instrument entry gates

**Status:** Closed (0.3.6 entry gates satisfied for the scoped rerun)
**Opened:** 2026-08-29
**Reopened:** 2026-08-29
**Closed:** 2026-08-29
**Owner:** LLP 0317.000 lanes L17/L18
**Systems:** Benchmarks, Instrument, Fixtures, Choreography, Snapshot identity
**Related:** LLP 0317 N7/N20, LLP 0317.000 Wave 5,
`benchmarks/instrument.manifest.json`

## Disposition

Wave 5 uses instrument `social-messenger@0.3.6-m8`. Its fresh materialized
snapshot passes the registered verifier, and its manifest, emitter, setup
identity, receipt schemas, meter, record validator, and production driver all
declare that same current pin. The first `0.3.5-m8` launch was interrupted and
is inadmissible: its manifest's choreography-root digest omitted concurrently
integrated W9 files, so the immutable snapshot refused verification on both
hosts. The first attempted 0.3.6 replacement was likewise interrupted before
admission when rebasing changed the source revision its prompts named. All four
partial lanes remain retained as entry-gate evidence and contribute no result.

- **N7 / Dave contradiction — repaired.** Starter M3 now contains Erin rather
  than Dave. Dave is therefore absent and addable when the M3 membership
  choreography begins. The choreography self-test reads the frozen starter
  segment and refuses if its declared add-member target is already present.
- **Scale fixture — repaired.** The 167,157-action `scale.log` is committed,
  covered by the fixture-root digest, delivered by the read-only instrument
  materializer, checked against `scale-log.sha256`, and accepted by the action
  validator. Lanes no longer need to infer a generator command or write into a
  read-only snapshot.
- **N20 / OpenCode hangs — excluded, not repaired.** GLM cells are not part of
  this rerun. The 0.1.29 GLM Snapback cells did not produce a matched usable
  baseline, and no repository-owned OpenCode runner repair has landed. No GLM
  absence or result may be read as product evidence. This satisfies the
  conditional L17 gate only because the scoped matrix excludes GLM.
- **Terra — excluded as registered non-signal.** The retained 0.1.29 Terra
  cells self-aborted at M1. Per LLP 0317.000 they are not re-run at a changed
  effort and are excluded from comparison.
- **Scale tail — gate satisfied.** The `sol-snapback-explicit` lane sealed on
  2026-08-28 and its visible tail is classified in LLP 0317 r2.7. Wave 5 does
  not claim that every tail item belongs to this correction program.

The matched rerun is therefore scoped to Sol and Grok, Explicit and Familiar,
with the same repaired instrument against both published 0.1.29 and the new
published pin. N=1 per cell supports existence statements only. No ordering or
loop-count magnitude claim is authorized without LLP 0317.000's N≥8 bar.

## Verification

- `node generate.mjs manifests` refuses unintended starter drift.
- `shasum -a 256 -c scale-log.sha256` passes.
- `node validate.mjs starter-m1.log starter-m2.log starter-m3.log
  sample-50.log scale.log` validates 167,294 actions.
- The choreography 0.3.6 self-test passes from both the source tree and the
  exact read-only materialization, including the N7 preflight. The materialized
  run repeated the known M7 calibration failure and an immediate identical
  rerun passed; the
  pre-existing nondeterminism is retained separately in
  `issues/20260829-social-messenger-m7-calibration-nondeterminism.md`. M7 is
  environment-null in this scoped rerun.
- `materialize-instrument.mjs` produced a read-only 0.3.6 snapshot containing
  the full 13,014,016-byte scale log. The registered verifier accepted
  manifest SHA-256
  `ee75020c41bb09186dc003e1f2cdf0dedebbb3adc21abfbfeb83addba2e64623`;
  `scale-log.sha256` and all 167,294 starter/sample/scale actions validated
  from that snapshot before any replacement cell started.

## Residual

N20 remains open for any future matrix that includes GLM/OpenCode. This record
does not classify or fix the external runner hang.
