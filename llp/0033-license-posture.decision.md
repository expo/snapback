# LLP 0033: License posture — MIT and the free-riding trade

**Type:** Decision
**Status:** Active
**Systems:** Project, Packaging, Deployment
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-07-01
**Revised:** 2026-08-25 (Active: linked into `llp/foundation/` as part of the
LLP v2 larger kernel)
**Revised:** 2026-07-01 (ratified same day: MIT eyes-open; DK-8 decided)
**Related:** LLP 0000, LLP 0022, LLP 0032

## Summary

Snapback is pure MIT. The closest commercial peer, PowerSync, deliberately
chose the Functional Source License to block AWS-style resale of its service —
exactly the free-riding a permissive license invites for a "host it for other
people" backend. Until now Snapback's exposure to that trade was a blind spot,
not a decision. This document makes it a named, ratified decision.

Drafted via [LLP 0032](./0032-decision-and-implementation-hardening.plan.md)
R5 (docket row DK-8), from the finding in
[LLP 0022](./0022-electric-powersync-turso.research.md).

## Context

- [LLP 0000](./0000-snapback.explainer.md) ratifies "truly open" as a core
  product value: Snapback's openness is a differentiator against
  source-available peers, not an accident of default.
- [LLP 0022](./0022-electric-powersync-turso.research.md) records that
  PowerSync's service is FSL 1.1 (converts to Apache-2.0 after two years;
  restricts "Competing Use") while its SDKs stay Apache-2.0 — a priced-in
  defense against hyperscaler resale. ElectricSQL, by contrast, is
  Apache-2.0 end to end and treats openness as adoption fuel.
- Snapback today has no hosted service, no revenue model pinned, and no
  trademark policy. The exposure is prospective: if a hosted Snapback becomes
  a business, a hyperscaler could offer "managed Snapback" on the MIT core
  without contributing back.

## Options

1. **MIT eyes-open (recommended).** Keep everything MIT. Accept the resale
   exposure explicitly, on the grounds that (a) "truly open" is a ratified
   core value and a real differentiator against FSL peers, (b) Snapback's
   moat is intended to be agent-first DX velocity and integration quality,
   not license restriction, and (c) relicensing later — while painful — is
   possible for future versions if the calculus changes, whereas launching
   restrictive and opening later burns trust in the other direction.
2. **MIT + trademark policy.** Keep the code MIT but register and police the
   Snapback name, so a free-rider can sell the software but not call it
   "Snapback". Low cost, meaningful friction for resellers; can be adopted
   later without relicensing.
3. **FSL/BUSL-style source-available.** Price in the PowerSync trade now.
   Directly conflicts with LLP 0000's ratified "truly open" value and forfeits
   the differentiation LLP 0022 identifies; would need that value re-ratified
   first.

## Decision (ratified 2026-07-01)

**Option 1 — MIT eyes-open — with option 2 (trademark policy) noted as a
compatible, deferrable follow-up.** The free-riding exposure is accepted as a
conscious trade for the ratified openness value. Revisit triggers, either of:

- a hosted Snapback service becomes a funded product line, or
- a third party ships a managed Snapback offering at meaningful scale.

On either trigger, the cheap first response is the trademark policy, not a
license change.

## Consequences

- LLP 0000's "truly open" claim now links to a recorded trade, not an
  unexamined default.
- No packaging or code change; P6 packaging work (LLP 0032) proceeds under
  MIT.
- LLP 0022's open flag on this topic is closed by cross-reference.

## Status

Accepted — ratified by Charlie 2026-07-01 in the LLP 0032 Phase 0 batch.
Ledgered in LLP 0000; docket row DK-8 is decided.
