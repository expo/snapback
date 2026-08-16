# LLP 0245 rollout 4: addition-only read/write suggestions from LLP 0146 receipts

**Opened:** 2026-08-12 (ordinary-TS authoring wave, run llp0245-0249-ordinary-ts-20260812)
**Resolved:** 2026-08-15

LLP 0245 D3/rollout 4 (dependency suggestions from static + conformance
evidence) requires the `runtime-witnessed` evidence class from LLP 0146 D1,
which is still **Draft** with its D1–D3 tranche tracked by
`issues/20260803-0146-d1-d3-tranche.md` (the `operating.declaration-conformance`
GAP row, review 2026-09-10). Rollouts 1–2 (result-only suggestions + the
stale-safe apply protocol) landed without it.

## Author ruling — 2026-08-15

Charlie Cheever ruled that R4 may proceed while LLP 0146 remains Draft by
sourcing `runtime-witnessed` evidence from `snapback.verify-receipt.v1`
conformance, provided the evidence class itself records the
registered-paths-only provenance caveat. With no registered acceptance paths,
the aggregate and suggestion evidence record `status: 'not-claimed'` and
`scope: 'explicitly-registered-paths-only'`; neither may imply broader coverage
than the registered path set.

Obligations:
- [x] consume `packages/snapback-cli/verify.mjs` coverage receipts
  (`snapback.verify-receipt.v1`) as `runtime-witnessed` evidence with
  path-specific provenance;
- [x] addition-only reads/writes proposals per LLP 0245 D3 (never removal, never a
  complete-set claim);
- [x] extend `DeclarationSuggestionV1` evidence classes and the corpus report.

## Implementation — 2026-08-15

`DeclarationSuggestionV1` analyzer v2 auto-discovers the conventional
`.snapback/verify-receipt.json`, consumes it only when its generated-artifact
identity is current, and binds the exact admitted receipt bytes into
`analysisInputId`. Every read, parse, schema, legacy-shape, envelope,
consistency, blocked-status, or identity failure for that auto-discovered
conventional file is a fail-open machine warning and supplies no runtime
evidence, so result-only suggestions still run. Explicitly passed receipt paths
and evidence reread by the apply seam remain fail-closed. Every
dependency addition retains receipt digest/path, profile id, registered path
id/kind, target profile, resolved function id, dependency class, complete
class provenance, aggregate status, the explicit registered-path scope, and
its limitation reason.

Receipt admission now runs the package-owned v1 JSON Schema through Ajv and
checks ordered-stage/profile membership, path and evidence counts, status/
completeness, and exact derivation of `underDeclarations` and
`overDeclarations` from `pathEvidence`. The producer preserves the empty
`not-claimed` aggregate at zero registered paths even when an upstream stage
blocks. A genuine `runVerify()` receipt with `functionId: null` projects an
addition only when its registered path id maps unambiguously to one generated
function identity.

The closed `dependencyChanges` shape contains only `additions`, fixes
`mode: 'addition-only'`, and fixes `completeSetClaim: false`.
`overDeclarations` are deliberately not projected. Focused tests drive the
real receipt producer into a fired null-`functionId` addition; prove witnessed-
but-undeclared reads/writes fire, already-declared dependencies stay silent,
over-declarations never produce a patch, and zero registered paths retain the
non-claim; reject planted `not-claimed` evidence and inconsistent counts/
derived arrays; preserve result-only suggestions beside stale, blocked,
schema-invalid, and byte-accurate pre-fix main-era blocked+zero-path
conventional leftovers; fail-close the same invalid receipt when explicitly
passed; stale-refuse changed admitted receipt bytes; and require the analyzer-v2
dependency/nonclaim fields while analyzer-v1 result-only records remain valid
without them.

The corpus runner now reports the evidence-class distribution beside the
existing candidate distribution. The 2026-08-15 rerun reproduced the prior
33-backend/106-candidate breakdown (20 exact, 37 schema-derived, 36 holed, 13
refused, 0 widened), with `runtime-witnessed` at zero because the source-only
corpus retains no verify receipts; `sourceBytesChanged` was false.
