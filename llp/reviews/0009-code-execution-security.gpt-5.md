# Review: LLP 0009 - Code execution security and tenant isolation

**Reviewed:** `llp/0009-code-execution-security.rfc.md` (working-tree revision)
**Family:** GPT-5 (OpenAI)
**Provider/runtime:** OpenAI API via Codex
**Date:** 2026-06-25
**Redacted:** No - reviewed local repo artifacts only.
**Method:** Single-session read-and-critique against LLP 0003, 0006, 0007, and
0010.

## Overall assessment

This RFC is appropriately blunt: engine choice is a security boundary, Ibex is
not automatically hosted-safe, and a no-op watchdog is worse than no claim. That
honesty is essential for Snapback to become a real platform rather than a local
demo engine.

## Strengths

- Clear local/self-hosted/hosted threat-model split.
- Runtime conformance is required before "one programming model" is true.
- Static analysis is correctly treated as defense-in-depth, not the sandbox.

## Concerns

- **C1 - Hosted multi-tenant code is gated on a real kill boundary. [High]**
  Without V8, an engine watchdog, or process/isolate termination, hosted claims
  should not ship.
- **C2 - Fresh-per-invocation may be durable but needs cost data. [Medium]**
  Pooling is research, but startup/host-call overhead still needs measurement.
- **C3 - Read-only query enforcement must be real. [Medium]** Storage alone will
  not prevent writes on a query path.

## Suggestions

- Make capability reports distinguish `enforced` vs `advisory` for every limit.
- Put runtime conformance and runaway-handler tests in the first acceptance
  suite, not after hosted work begins.

## Open questions

- What is the first hosted-safe engine path?
- Can Ibex gain a real watchdog, or is it local/trusted only for v1?

## Recommended next step

Keep `Draft`. Do not run untrusted app code until the engine/resource-limit story
is enforceable and tested.
