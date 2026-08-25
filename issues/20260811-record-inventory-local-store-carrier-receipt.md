# Local-store carrier gate names obsolete records while current evidence captures ambient dirty state

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 3
**Confidence:** 5
**Systems:** Local persistent store, Acceptance evidence, Metrology, Pre-push gates
**Date:** 2026-08-11
**Drift gate:** `local-store-carrier-receipt`
**Failure signature:** `sha256:81911ec32efdaf71a39ca910d73fe718ffaefa335a301eec6b7f30fffbdf2c60`
**Last observed:** `ddbd581eb77b7cb468b9b5764422b3a178438278`
**Related:** LLP 0232 D-1/D-2; `issues/20260811-record-inventory-summary.md`

## Problem

The registry says this gate owns the 2026-08-04 carrier/bundle pair, but
`node tests/acceptance/local-store-carrier-exit-v1.mjs --check` dynamically
selects the latest dated carrier receipt and paired bundle. Current main's
latest pair is 2026-08-06, so diagnostics and ticketing name records the
checker does not read.

Declared records:

- `tests/acceptance/fixtures/local-persistent-store/carrier-exit.2026-08-04.v1.json`
- `tests/acceptance/fixtures/local-persistent-store/bundle-attribution.2026-08-04.v1.json`

Actually checked records:

- `tests/acceptance/fixtures/local-persistent-store/carrier-exit.2026-08-06.v1.json`
- `tests/acceptance/fixtures/local-persistent-store/bundle-attribution.2026-08-06.v1.json`

## Offending inputs and fields

The current 2026-08-06 receipt pair serializes:

- `date`
- `startedAt` and `completedAt`
- `runtime.node`, `runtime.platform`, and `runtime.arch`
- `source.revision`
- `source.dirty`
- `source.dirtyPaths`

The retained run records Node `v25.9.0`, `source.dirty: true`, and dozens of
unrelated dirty Guide and activation/evidence paths. The source files that
matter are already individually bound by `source.files[*].sha256`; the bundle
also records its source hashes, output hash, and pinned `esbuild@0.28.1`
method. Exact HEAD and unrelated dirty paths add no semantic discrimination.

Absolute start/end timestamps are useful execution metadata but make
re-execution non-deterministic. They belong in a D-1 execution receipt or an
external evidence envelope, not in the content-compared semantic record unless
their necessity is explicitly justified. Platform/tool versions that affect
the measurement must be pinned inputs to the semantic closure, not whatever
the invoking shell supplied.

The retained run itself proves this is expensive: 2026-08-06 took 135.518
seconds (`11:21:35.351Z` to `11:23:50.869Z`); the earlier 2026-08-04 retained
run took 161.830 seconds. It requires D-1 reuse after the record is normalized.

## Proposed remedy

Per LLP 0232 D-2:

1. Replace the stale explicit 2026-08-04 registry paths and the checker's
   lexicographic latest-date selection with one content-bound, declared current
   receipt locator shared with `local-store-publication`.
2. Drop `source.revision`, `source.dirty`, and `source.dirtyPaths` from the
   semantic record; the per-file digest map is the stable source identity.
   If an exact tested revision remains required for provenance, keep it in the
   D-1 execution receipt beside the verified closure, not as freshness input.
3. Move `startedAt`/`completedAt` to execution metadata or justify and normalize
   them outside byte-equality freshness.
4. Require a clean evidence checkout and pin Node, esbuild, platform, browser,
   and binary/readiness identity in the D-1 semantic closure where they affect
   results. Refuse dirty evidence rather than retaining unrelated paths.
5. Re-mint the stable record under the pinned method and install D-1 reuse for
   the >2-minute execution.

## Acceptance

- Registry diagnostics name exactly the pair the checker reads.
- Gate-disjoint rebases and unrelated dirty paths cannot change semantic bytes.
- The same verified source/toolchain/platform closure reproduces the same
  semantic record, with run metadata carried separately.
- Toolchain or source changes that affect evidence invalidate D-1 reuse.
- The full run remains executable and honest, but a closure-identical rebase
  reuses its green receipt rather than re-running it.


## Amendment 2026-08-15 — this gate hard-blocks the publication path

Observed while assessing whether the 16 landed clique-0121 sweep fixes could be
published. `node scripts/check-agent-safe-publication.mjs` does not merely warn
on this gate — it throws and exits:

```
Error: agent-safe-publication: sibling custody gate local-store-carrier-receipt
does not retain its exact registered definition
    at assertSiblingChainCustodyTransfers (…:993)
    at validateDerivedForkCoverageTransfers (…:1037)
    at validatePublicationRecord (…:2564)
```

Confirmed inherited, not introduced: the identical failure reproduces at
`f5315002b`, the commit immediately before that fix run began, in the same
checkout with the same `node_modules`.

This raises the stakes on this ticket beyond diagnostic accuracy. As long as the
registered definition and the dynamically selected records disagree,
`validatePublicationRecord` fails closed and **no qualified npm release can be
assembled**, independent of whether the surface under release is sound. At the
time of writing, `main` carries a substantial unpublished surface delta against
the published 0.1.21 closure — the entire clique-0121 sweep fix wave, including
the canonical `generated/` directory unification, the shared operation-name
grammar, Metro-transformable generated exports, `ctx.db.elevated`, the password
`minimumLength` policy, and the familiar scalar/asset work. Every one of those
tickets was filed by an agent hitting the *published* closure, so the fixes have
no user-visible effect until a release is possible.

Suggested sequencing: resolve the registry/checker disagreement described above
first, then re-run `check-agent-safe-publication.mjs` to confirm the publication
record validates, before attempting candidate assembly under LLP 0233.
