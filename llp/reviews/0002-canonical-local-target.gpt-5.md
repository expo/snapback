# Review: LLP 0002 - Canonical local dev/test target

**Reviewed:** `llp/0002-canonical-local-target.decision.md` (working-tree revision)
**Family:** GPT-5 (OpenAI)
**Provider/runtime:** OpenAI API via Codex
**Date:** 2026-06-25
**Redacted:** No - reviewed local repo artifacts only.
**Method:** Single-session read-and-critique against LLP 0000, 0003, 0010, and
the Valet retrospective.

## Overall assessment

The decision is right: a full local Ibex + SQLite server is the only credible
default target for agent validation. It exercises the real runtime/store/server
boundary and avoids cloud flakiness in the first feedback loop.

## Strengths

- "First standard target" avoids pretending local success proves every target.
- The consequences call out parity, seeding/reset, realtime tests, and CI.
- It aligns with Valet's useful architecture while leaving room for later
  Cloudflare/Postgres targets.

## Concerns

- **C1 - Local can become false confidence. [Medium-High]** The doc says local
  is necessary but insufficient; implementation must make capability gaps visible
  or agents will over-generalize local results.
- **C2 - Bootstrap details are still open. [Medium]** The one-command path,
  fixtures, reset, and CI surrogate are the actual agent-DX contract.

## Suggestions

- Tie the first implementation directly to LLP 0010's required tool surfaces.
- Promote the next standard target decision early enough that Cloudflare does
  not become a late port.

## Open questions

- What exact command starts, resets, seeds, and inspects the canonical target?
- What local behavior is explicitly not evidence for hosted/Postgres/Cloudflare?

## Recommended next step

Propose marking this `Accepted` only after the ratifying source confirms the
decision and the first bootstrap/CI shape is named. Until then, `Draft` is fine.
