# Review: LLP 0012 - Headless integration contract

**Reviewed:** `llp/0012-headless-integration-contract.spec.md` (working-tree revision)
**Family:** GPT-5 (OpenAI)
**Provider/runtime:** OpenAI API via Codex
**Date:** 2026-06-25
**Redacted:** No - reviewed local Snapback and selected local Exact repo docs.
**Method:** Single-session read-and-critique; targeted external-Exact framing
added without making Snapback the authority for Exact.

## Overall assessment

This is the keystone integration spec. The artifact list, packaging/typecheck
bar, capability manifest, runtime state, and versioning rules are exactly where
Valet showed integrations fail. The revision narrows the Contract/Exact
dependency using current Exact facts while keeping the canonical definition open.

## Strengths

- Treats packages and typecheck honesty as part of the contract.
- Online vs Parity capability class prevents fake local-first claims.
- Current-value-plus-subscription seam directly fixes the repeated Valet race.

## Concerns

- **C1 - Stable artifact schemas are needed early. [High]** If schema/function/
  capability/runtime-state formats drift, every adapter will compensate
  privately.
- **C2 - First-class bridge can slip into sample code. [High]** The bridge must
  ship as product or the Valet copy-paste pattern will repeat.
- **C3 - Contract/Exact definition remains externally gated. [Medium-High]** The
  current Exact repo gives context, not final authority.

## Suggestions

- Build one generated app consumed by Contract/Exact and React as the first
  integration proof.
- Put typecheck honesty and CI drift gates in the first adapter milestone.

## Open questions

- Which Exact authority document should Snapback cite?
- What physical package split keeps browser, native, local-server, and hosted
  entry points honest?

## Recommended next step

Keep `Draft`. Next: choose the first artifact schema set and implement the first
generated adapter over it.
