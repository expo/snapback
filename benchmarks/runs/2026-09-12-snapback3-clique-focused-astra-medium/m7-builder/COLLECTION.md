# Focused M7 builder evidence collection

This directory preserves the M7 builder's authored source, deterministic attempts, evidence, and narratives as builder output. It does not express an independent grade. The later independent M7 grader is kept in a separate lane and collection.

- [`m7/`](m7/) preserves every M7 compiler, migration, browser, API, regression, storage, and finalization attempt with its original relative path, including failed attempts and corrected reruns.
- [`FINAL-m7.md`](FINAL-m7.md), [`m7/final-report.md`](m7/final-report.md), [`m7/diary.md`](m7/diary.md), [`m7/closing-essay.md`](m7/closing-essay.md), and [`m7/run-log.md`](m7/run-log.md) are explicitly builder-authored narratives.
- [`m7-baseline/`](m7-baseline/) and the three files under `m7/post-m7-*.json` preserve the pre/post persona snapshots used by the builder.
- [`provenance/`](provenance/) binds phase, prompt, scope, package, instrument, preparation, promotion, final freeze, model identity, token counts, and private custody.

The unchanged continuous-builder prerequisite evidence, including the earlier 24 acquisition attempts, remains in the [existing builder collection](../builder/) and is described by the [run collection record](../COLLECTION.md); it is not duplicated here.

Databases, installed dependencies, generated `dist/` runtime assets, native session contents, raw model streams, and the closed old-client profile remain private. Their hashes and custody are recorded in [`provenance/private-custody.json`](provenance/private-custody.json). Public source and build manifests retain the exact hashes for excluded runtime assets.
