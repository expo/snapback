# LLP 0245 rollout 4: addition-only read/write suggestions blocked on LLP 0146 tranche

**Opened:** 2026-08-12 (ordinary-TS authoring wave, run llp0245-0249-ordinary-ts-20260812)

LLP 0245 D3/rollout 4 (dependency suggestions from static + conformance
evidence) requires the `runtime-witnessed` evidence class from LLP 0146 D1,
which is still **Draft** with its D1–D3 tranche tracked by
`issues/20260803-0146-d1-d3-tranche.md` (the `operating.declaration-conformance`
GAP row, review 2026-09-10). Rollouts 1–2 (result-only suggestions + the
stale-safe apply protocol) landed without it.

Do when unblocked:
- consume `packages/snapback-cli/verify.mjs` coverage receipts
  (`snapback.verify-receipt.v1`) as `runtime-witnessed` evidence with
  path-specific provenance;
- addition-only reads/writes proposals per LLP 0245 D3 (never removal, never a
  complete-set claim);
- extend `DeclarationSuggestionV1` evidence classes and the corpus report.
