# SEC6 qualification evidence — 2026-10-21

Product code snapshot: `4578e98bed`, package version `0.4.35`; user-visible guide
changes target `0.4.37` without a version bump. The final report is
[WORKSTREAM-REPORT.md](../../../WORKSTREAM-REPORT.md). Semantic amendment:
[LLP3000.036.004 §15](../../../llp/3000.036.004-security-invariants-and-exposure.rfc.md#15-sec6-write-boundaries-returned-privacy-and-deployment-review).
Round6 Muse and fresh Codex both READY; verbatim reviews have separate provenance
under `llp/reviews/3000.036.004-sec6-review-record.md`.

- `inputs.tar.gz` and `input-manifest.json`: frozen Quarry-only lane copies,
  original/no-invariant/single-spec-invariant forms. Generated caches, test records
  and stores are excluded from the clean measurement.
- `remeasurement.tar.gz`: final clean `check --json` and `test --all` stdout,
  stderr, exit codes and native binary SHA256 for seven reported-high lanes plus
  the separate048 roster intent. Every no-invariant input has zero declarations;
  each spec input has exactly one.
- `corpus-inputs.tar.gz`:350apps/358Quarry files, waves15,16,18–21, plus path/hash
  manifest. `census-{baseline,verified,verified-no-invariants}.json.gz` retain
  complete parsed note/verdict results. All350 pass in every final census.
  `baseline-artifact.json`/`baseline-package.json` identify the published0.4.35
  platform baseline.
- `measure.py` and `census.py`: reproducible runners. Stage each script beside its
  extracted `inputs/` or `corpus-inputs/` in ignored scratch, then pass an absolute
  built/installed CLI path and a new output name. Both isolate every app in a
  disposable directory. The census additionally accepts `--strip`.
- `difftest-{run,devices,lean}.json.gz`:20k/1000/20k reports. Run/devices have zero
  signatures; Lean has only the four known SEC5 signatures,130 observations.
- `rust-summary.json`:full seven-crate441-binary/1159-execution inventory,
  7234pass/0fail/47ignored plus successful workspace doctests. The full log is
  retained in `logs.tar.gz`.
- `prepare.json` and `linux-consumer.tar.gz`:fresh client/expo staging and installed
  Linux consumer evidence, including the security guide, SDK constructor and
  mutation-result proofs. The consumer-only route deliberately skips
  scripts/test.sh; source suites are retained separately and no publication
  qualification receipt is produced.
- `logs.tar.gz`, `earlier-measurements.tar.gz`, `first-linux-attempt/`: original
  failures, repairs and successful final runs. The first423-file client pool had
  five red files; affected repairs pass590/590, the unchanged background-retention
  timeout test passes in isolation, and seeded models pass81/81. Original failures
  are retained. The first Linux consumer attempt stopped at a shared npm-cache
  ENOENT; the retry uses an owned private cache.

Artifact hashes are in `sha256.json`. Review gzip files are verbatim; unpacking
hashes for them are in the independent review record. Compiled binaries, installed
consumer trees and test scratch are removed after receipts are saved. These are
finite, scoped results; no universal security proof is asserted.
