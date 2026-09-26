# Snapback 4: an already stored manufactured `sent` receipt stays trusted after upgrade

- **Opened:** 2026-09-26, from the lane V round-13 reviews (Grok Low; Astra Low
  "previously manufactured success remains trusted"). Carried out of
  `issues/closed/20260925-snapback4-legacy-acknowledgement-outcome.md`, which
  lane V rounds 12–15 resolved.
- **Area:** `packages/snapback4/src/writes.ts` (`acknowledged`, the unqualified branch).
- **Severity:** Low. It is reachable only on a device that ran a pre-0.4.2 build
  which stored a `sent` for a refused operation.

## What happens

Before outcome-qualified acknowledgements, a legacy acknowledgement of a
refused `_ops` row could be stored as `sent`. The upgraded client trusts a
stored receipt, so that `sent` survives. A genuine success whose receipt
committed before an aborted outbox settlement has the same unqualified shape.
Discarding every such receipt, and requiring replay, would weaken round 9's
known-terminal durability rule. Round 13 recorded a two-real-server
counterexample: audit 0 for the old bug, audit 1 for a genuine saved success.

## Decision needed

Either accept the Low as an upgrade-only limitation and document it, or
distinguish the two shapes. For example, the device could mark receipts it
wrote from a qualified outcome, and replay only unmarked ones that still hold a
retained binding.
