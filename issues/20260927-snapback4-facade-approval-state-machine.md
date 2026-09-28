# Snapback 4: the app facade's shared approval as one explicit state machine

**Status:** Open
**Impact:** 3
**Urgency:** 2
**Ease:** 2
**Confidence:** 4
**Systems:** Snapback 4 — client SDK (`app-client.ts`, `read-approval.ts`), LLP 3000.023 §3.4–§3.6
**Date:** 2026-09-27
**Related:** [LLP 3000.023](../llp/3000.023-answers-stay-on-screen.rfc.md), lane KG reports in `snapback4/reports/20260927-kg-kept-through-authority/`

## Summary

Lane KG took twelve rounds of dual-family review to converge. The behavior it lands is right, and a randomized model with an independent oracle checks it. But `guardClient.observe` spreads the facade's authority state across the following:
- mutable locals (`snapshot`, `refused`, `held`, `associated`, `refreshVersion`, `closedDeadline`, `announced`);
- getters with side effects (`getSnapshot` rewrites `snapshot` and rejects the shared slot);
- listener-time normalization;
- generation and version comparisons that stand in for "already delivered".

Nearly every late-round High was one of those comparisons meaning something slightly different on one path. For example, round 11's opening refusal was taken as delivered because the generation had moved.

## Proposal

Rewrite the facade's approval as one explicit state machine per facade over the shared slot:
- **States:** `opening`, `approved(identity, deadline)`, `withdrawn(read)`, `refused(read)` and `closed(identity, deadline)`.
- **Events:** `sourceChanged`, `checkResolved(token, result)`, `sharedApproved`, `sharedRefused`, `close` and `tick`.
- **A pure transition function.** Each pending check gets a token.
- **A derived `getSnapshot`** with no side effects.

Keep the public behavior byte-for-byte. The existing approval lifecycle, model and oracle suites are the acceptance test: the rewrite is done when they pass unchanged, including every seed.

## Why not now

The landed behavior is reviewed and model-checked, and the builder-visible contract does not change. This is internal elegance and future review cost, not a user-facing defect.
