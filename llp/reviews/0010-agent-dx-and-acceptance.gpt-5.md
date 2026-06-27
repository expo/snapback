# Review: LLP 0010 - Agent DX and acceptance suite

**Reviewed:** `llp/0010-agent-dx-and-acceptance.spec.md` (working-tree revision)
**Family:** GPT-5 (OpenAI)
**Provider/runtime:** OpenAI API via Codex
**Date:** 2026-06-25
**Redacted:** No - reviewed local Snapback and selected local Exact repo docs.
**Method:** Single-session read-and-critique; targeted additions made for the
first Contract/Exact fixture and reference-app coverage.

## Overall assessment

This Spec is the mechanism that can make "agent-first" real. The additions make
two important commitments explicit: the first Contract/Exact fixture should use
the current Exact default path, and every root reference app needs an acceptance
profile before it becomes evidence for product or scale claims.

## Strengths

- Structured diagnostics, loaded-state inspection, and no silent drops are the
  right agent affordances.
- The deterministic harness plus multi-client browser smoke tests match what
  Valet proved useful.
- Capability reports prevent target gaps from becoming invisible skips.

## Concerns

- **C1 - The suite can become too large to build early. [High]** The answer is
  sequencing, not cutting scope: todo plus replay/wire plus diagnostics first.
- **C2 - Acceptance profiles need numbers. [Medium-High]** Without data volumes,
  fan-out, and mutation rates, reference apps remain demos.
- **C3 - Contract/Exact fixture still depends on stable external definition.
  [Medium]** Current Exact facts are enough for a fixture, but not the final
  canonical citation.

## Suggestions

- Make replay/wire conformance a release blocker before adding broad features.
- Use the Exact agent API/structured tree as the preferred validation surface
  where Contract is involved.

## Open questions

- Which diagnostic codes must be stable in v1?
- What is the smallest benchmark profile that makes the Partiful-scale target
  falsifiable?

## Recommended next step

Keep `Draft`. Implement the todo acceptance app, codegen no-silent-drop checks,
runtime state inspection, and the first replay/wire conformance cases as soon as
the local core exists.
