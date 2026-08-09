# `packages/snapback-codegen/index.d.mts` is digest-covered but has no drift gate

**Status:** Resolved (2026-08-07)
**Opened:** 2026-08-07
**Systems:** Codegen, Publication, Testing
**Related:** LLP 0162; `issues/20260807-review-prose-history-not-frozen.md`

Found as R12-1 by the Fable round-12 review of the derived-fork publication
chain, which also bounded it.

## The asymmetry

`packages/snapback-codegen/index.d.mts` hand-declares TypeScript types
against Rust types it cannot see. It is inside `IMPLEMENTATION_ROOTS`, so it
is covered by the qualification digest — but **nothing gates it**. Meanwhile
`schemas/`, which sits *outside* the roots, has a byte-exact drift gate
(`dk7_committed_schemas_match_rust_types`).

The protection is on the wrong file. That asymmetry produced two separate
findings in two consecutive rounds from two different reviewer families:

- **R11-1** (both families, independently): a serde rename to
  `denyAll`/`captureOnly`/`notPromotable`/`promotable` updated neither the
  schemas nor this declaration. The schema half was caught by its gate; the
  declaration half was caught only because a reviewer went looking.
- **R12-1** (this ticket): `AgentSafeCapabilityFactsV1.envelope` and
  `.explanation` have been declared in a shape the Rust abandoned at
  `b6a668a74` (2026-08-04). That commit reshaped both members and
  regenerated all four schemas without touching the declaration. `envelope`
  should be `{ordinaryMutation, hostChildMutation, …}` with the first two as
  `{hostPlan, ibexBuffered}` objects, not scalars named
  `ordinaryIbexMutation`/`hostPlanSettlement`; `explanation` should be
  `{scopedFacts: […]}`, not a six-key per-lane map. The dead key names
  appear nowhere else in the repo.

## Bound

The reviewer bounded the damage rather than leaving it open: **exactly these
two members, no third.** It compared all 198 enum definitions across all 242
committed schemas against every `JsonSchema` Rust enum (194 compared, 0
mismatches), all 11 union aliases in the declaration against the schemas (0
mismatches), and every `AgentSafe*` interface key set nested and top-level.

The fork tuple itself is correct, which is why this did not block the
derived-fork publication: the drift is three days old, lives in the LLP 0162
storage vocabulary, is outside the fork surface, and breaks no gate.

## Fix

Two parts, and the second matters more than the first:

1. Correct the two drifted members.
2. **Add a drift gate for this file** so it cannot silently disagree with the
   Rust again. The reviewer notes the check is roughly 20 lines of Node,
   needs no Rust toolchain, and would have caught both R11-1 and R12-1.

Deferred because the fix rotates the qualification digest — land it with the
next cycle that needs a new C anyway rather than spending one on it alone.

Minor, same area: the `{"DenyAll": true, "CaptureOnly": true}` tampering
probes now name spellings that no longer exist (still non-vacuous, but the
comment misdescribes them), and `EffectSettlementCapabilityV1` names two
different Rust types across the schema namespace.

## Implementation note — 2026-08-07

Implemented on branch `codex/pub-chain-hardening-20260807`; lands with the
fresh derived-fork requalification cycle. The declaration now projects the
Rust/schema `ordinaryMutation` and `hostChildMutation` adapter maps and the
sparse `scopedFacts` explanation list. A Node-only structural gate compares all
33 `AgentSafe*` enum/object definitions against all four committed schemas and
runs both from the publication oracle and the DK-7 Rust drift test. Its
negative fixtures temporarily reintroduce the R11-1 enum casing drift and both
R12-1 nested-shape drifts and prove each is rejected. The tampering probes now
use current lower-camel spellings, and the artifact-local
`EffectSettlementCapabilityV1` name collision is documented at the DK-7
comparison boundary and in LLP 0037 rather than renamed invasively.

## Resolution (2026-08-07)

Implemented and landed on main in `ff015ee6d` ("fix(codegen): gate AgentSafe
declarations against schemas"): both drifted members corrected to the Rust
shapes, and a Node-only drift gate now compares all 33 `AgentSafe*`
declarations against all four committed schema projections, wired into the
live publication oracle and `dk7_committed_schemas_match_rust_types`.
Negative fixtures prove it catches R11-1 and both R12-1 drifts. Tampering
probes use current spellings; the `EffectSettlementCapabilityV1` double-naming
is documented as artifact-local at the comparison site. Landed ahead of the
requalification cycle per LLP 0189 (the withdrawal already requires a fresh
qualification C).
