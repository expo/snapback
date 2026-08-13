# Guide frozen records embed rebase-unstable commit identity and exceed their declared inventory

**Status:** Closed
**Impact:** 5
**Urgency:** 5
**Ease:** 3
**Confidence:** 5
**Systems:** Guide, Diagnostics, Generated records, Pre-push gates
**Date:** 2026-08-11
**Drift gate:** `guide`
**Related:** LLP 0232 D-2; `issues/20260811-record-inventory-summary.md`

## Problem

The Guide generator is fast enough (3.61 seconds in the Lane 2 isolated
Node 24.18.0 run), but its bytes are not invariant under a gate-disjoint
rebase. `node scripts/generate-guide-manifest.mjs` reads `git rev-parse HEAD`
and projects that identity through a large generated closure.

The registered records are:

- `guide/guide-manifest.generated.json`
- `guide/guide-flat.generated.md`
- `guide/reference/diagnostics-registry.json`
- `guide/reference/diagnostics.md`
- `packages/snapback-client/diagnostic-codes.d.mts`

The generator actually writes a larger frozen surface than the registry
declares: `guide/reference/registry.json`, 46 generated symbol-reference
Markdown pages, `guide/reference/index.md`, and the per-section
`guide/guide-flat.*.generated.md` projections.

## Offending inputs and fields

- `guide/guide-manifest.generated.json`:
  `buildIdentity.commit` is the generator's current HEAD.
- `guide/reference/diagnostics-registry.json`:
  `buildIdentity.commit` is current HEAD even though
  `buildIdentity.sourceDigest` already identifies the semantic inputs.
- `guide/reference/diagnostics.md`: generated `reviewed-commit` repeats the
  same HEAD.
- `guide/reference/registry.json`: `buildIdentity.commit` is current HEAD;
  `buildIdentity.sourceDigest` already supplies content identity.
- Generated API-reference Markdown pages: `reviewed-commit` is current HEAD.
- `guide/guide-manifest.generated.json` then absorbs those bytes through
  `pages[*].reviewedCommit`, `pages[*].sha256`, resource hashes,
  `flatProjections[*].sha256`, and `contentHash`, turning one commit stamp into
  a multi-megabyte projection rewrite.

The generators' `--check` paths preserve or strip the committed build identity
when comparing semantic content. That is direct evidence that these commit
fields are not required for frozen-record freshness. Runtime binary/build
identity remains a separate serving concern and should not be baked into the
source projection.

## Proposed remedy

Per LLP 0232 D-2:

1. Drop current-HEAD fields from the source-generated Guide, diagnostics, and
   symbol records, or replace them with the existing semantic source digests.
2. Keep exact binary build commit injection at the runtime/serving boundary if
   the served-resource protocol requires it; do not make committed source
   projections predict their carrier commit.
3. Stop generated reference pages from using HEAD as `reviewed-commit`; bind
   generated pages to their source digest or use a generated-source identity
   distinct from authored review freshness.
4. Make the `guide` registry enumerate every generated record the command
   writes, including the symbol registry, generated API-reference pages, and
   section-flat projections.
5. Add a fixture that regenerates after a gate-disjoint commit and requires
   byte-identical output.

## Acceptance

- A Guide-relevant source change regenerates the complete declared record set.
- Repeating regeneration after an unrelated commit produces no byte changes.
- Content-affecting Guide, diagnostics, or symbol changes still fail the gate.
- Runtime responses may still expose exact binary identity without embedding
  that identity in committed Guide-source records.

## Resolution

Resolved 2026-08-12 under LLP 0232 D-2. Authored page review anchors were
migrated at their historical commits to `reviewed-authorities-digest`; the
checker now compares those anchors with current authority bytes. Source Guide,
symbol, and diagnostics records retain content digests but no commit identity,
while `build.rs` injects the carrier commit only into the embedded runtime
manifest. The guide drift gate now declares all 65 records written by its
regeneration command, and the regression proof covers both genuine authority
changes and gate-disjoint commits.
