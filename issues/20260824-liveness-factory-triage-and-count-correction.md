# Triage of the liveness-only factories — and a correction to my own count

Status: open
Date: 2026-08-24
Systems: snapback-auth, snapback-engine, snapback-kernel, snapback-server
Related: issues/20260824-authority-minting-factory-inventory.md,
  issues/20260824-entitlement-predicates-for-the-live-sites.md,
  issues/20260822-authorized-effect-program-status.md

## Correction first: the count I published was wrong

I reported the factory inventory as **137 LIVENESS-ONLY and 6 UNCLEAR**. The inventory actually
contains **134 LIVENESS-ONLY and 3 UNCLEAR** — and 134 + 3 = 137, which is exactly how I got there.
I derived the figures by grepping class-name occurrences rather than counting rows, so UNCLEAR rows
were double-counted into the LIVENESS-ONLY total. The inventory's own summary states the correct
figures (`issues/20260824-authority-minting-factory-inventory.md:574`).

This is the third population correction in this program and the first that is mine. It is the same
error I criticised earlier — a count not tied to enumerated rows — committed while insisting on
exactly that discipline. Counts must be taken from the row set, never from a text search.

## Triage result: 94 independent surfaces, not 134

| Bucket | Rows |
|---|---:|
| P1-SHIP (safe to patch now) | **9** |
| P2-POLICY (needs an authorization decision first) | **68** |
| P3-LOW (no durable effect or authority follows) | **17** |
| P4-DUPLICATE (forwarding layer / sibling) | **40** |
| LIVENESS-ONLY total | 134 |

The 40 duplicates collapse the population to **94 independent liveness surfaces**; counting one
already-correct push chain and one unresolved capsule question gives **96 independent surfaces
overall**.

**Real workload: 9 safe patches, 68 policy decisions, 17 no-action rows, 1 unresolved question.**

## The bottleneck is policy, not code

68 of 94 independent surfaces cannot be patched until someone decides what the authorization rule
*should* be. That matches what the five-site entitlement analysis found: the naive owner-only rule
was wrong at two of five, because those flows are cross-principal by design. Patching without the
decision would ship regressions that current tests would not catch, since the tests encode today's
permissive behaviour.

The triage marks two conditions explicitly, per instruction:
- **NF** — no legitimate cross-principal use was found, but none could be *proved* absent through an
  existing tested helper. These remain P2 rather than being promoted to P1. "Could not find" is not
  "does not exist".
- **Δ** — a restrictive fix would change intentional production behaviour, so it needs a
  compatibility decision rather than a patch.

## Next

The 9 P1-SHIP rows are the only code work that can proceed without a policy decision; each names its
predicate and an existing tested helper. The 68 P2 rows should be grouped by the *question* they
raise rather than by module, so one decision can resolve many rows at once.
