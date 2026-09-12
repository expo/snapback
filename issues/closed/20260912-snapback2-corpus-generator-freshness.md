# snapback2 corpus has no generator-freshness gate — twins and manifest can drift

**Status:** Closed
**Priority:** P2
**Date:** 2026-09-12
**Source:** snapback2 comprehensive review workflow (2026-09-11 sweep)
**Location:** `snapback2/crates/.../export_corpus.rs:155-178`, `:920`; `twin_cases.rs:6-18`; `scripts/test.sh`; `packages/.../types.ts:108`; `packages/compiler/src/test.ts:1-106`

## What was reported

- `export_corpus.rs:155-178` deletes/rewrites corpus JSON + manifest, and
  `:920` builds a `Program` directly; `twin_cases.rs:6-18` hand-builds IR
  that is never Quarry output — yet `test.sh` never runs `export_corpus`
  and no test asserts the checked-in files equal generator output.
- `corpusVersion` (`types.ts:108`) is never asserted anywhere.
- The evaluator package embeds the manifest in `dist/corpus-runner.js`
  while `test.ts` reads the live manifest — stale-bundle drift.
- `compiler/src/test.ts:1-106` never imports the corpus (only `--ir`
  cert asserts).

Net: checked-in corpus, twins, and bundles can silently drift from the
generators with no red gate.

## Suggested fix

- Add a generator-freshness test (regenerate to temp, diff against
  checked-in), assert `corpusVersion` in the consuming tests, build the
  bundle in `test.sh` (or test the live manifest only), and cover the
  compiler against the corpus.

## Acceptance

- A freshness gate fails when generated output differs from checked-in
  files; version asserted at consumption points.

## Resolution (2026-09-12)

The existing export_corpus binary has a read-only --check mode comparing every generated JSON case and manifest byte, including unexpected stale JSON leaves. Existing scripts/test.sh runs it and rebuilds/runs the portable embedded corpus runner; no new blocking check or registry. Evaluator, portable runner, and compiler corpus checks assert version1. Compiler checks validate canonical program/schema identity over the complete manifest. Preludes now export Rust certificates so the direct execution boundary can enforce identity.

Regeneration absorbed pre-existing cost-term explanation/allocation drift; it did not change executable corpus results. Validation: exporter --check passes293 cases; an injected unexpected JSON leaf makes it fail status1 naming the stale leaf (cleaned afterward). Full evaluator266/266, portable266/266 plus27 skipped, compiler version/skew and all293 canonical identity controls pass.
