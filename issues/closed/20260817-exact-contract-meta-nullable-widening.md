# Exact: contract-meta regeneration widens `string | null` sidecar fields

**Opened:** 2026-08-17
**Source:** Coterie M3 review corrections (Diary 0086); LLP 0279 item 7

## Symptom

The contract-meta command completed successfully but widened five
`string | null` state fields to `string` in the generated helper sidecar,
so the checked-in sidecar needed hand correction after regeneration. The
provider generator itself handled the same round's refusal/token/write-set
changes cleanly; only the meta sidecar lost nullability.

## Ask

Preserve declared nullability through contract-meta regeneration, and add a
round-trip test that a nullable state field survives regeneration
byte-identically. Acceptance: regenerating Coterie's sidecar produces no
nullability diff. External (Exact repo) fix; graduate to Linear (Exact
project) when picked up.

## Resolution (2026-08-17)

Graduated to the Exact repo: `issues/20260817-exact-contract-meta-nullable-widening.md` there. Picked up by the
sbs-orchestrate Exact-side batch; further state lives in the Exact ticket.
