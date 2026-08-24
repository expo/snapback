# Shipped expo-chat done-oracle red at guest bootstrap despite declared+offered guest mechanism

**Status:** Open
**Opened:** 2026-08-24
**Systems:** Auth, Acceptance testing, Templates, Code generation
**Related:** LLP 0307 (Track Q-a probe, published-0.1.26 finding 2),
LLP 0295 (vertical paved-path coherence invariant),
`benchmarks/runs/2026-08-24-qa-ports-probe-0126/record.md`

## Problem

On published 0.1.26, the shipped `expo-chat` template's own done-oracle
(`prove` / `npm test`) fails out of the box at check 1/13:

```
SNAPBACK_AUTH_BOOTSTRAP_MECHANISM_UNAVAILABLE: The selected target does
not offer the generated guest entry mechanism.
```

while, at the same published surface, the generated
`client-lifecycle.v1.json` declares `guest-v1` and the live binding offers
`auth.guest-sessions`. Reproduced with and without `CI`, and in a fully
isolated second scaffold. This is the exact vertical paved-path failure
shape LLP 0295 names: three layers each locally defensible, the journey
broken — and it means the template's first-hour verification an agent is
told to run cannot go green.

The Q-a probe reached its live-query green via the served guide's headless
path instead (`snapback session mint` + `createExternalSessionClient`), so
the product path works; the done-oracle/bootstrap seam is what disagrees.

## Wanted

- Root-cause which layer lies: the acceptance bootstrap's mechanism
  selection, the generated lifecycle facts, or the binding's offer
  projection.
- Fix so the shipped template's `prove` passes out of the box on a packed
  scaffold, with a vertical fixture binding the three layers (declared
  lifecycle entry ∩ binding offer ∩ bootstrap admission).
- Classify whether 0.1.26's closure acceptance should have caught a
  red done-oracle (likely the same acceptance gap as
  `issues/20260824-expo-web-bundling-import-specifier-blocker.md`).

## Acceptance

- Packed scaffold of the shipped template: `prove` green 13/13 with no
  edits.
- The vertical fixture fails if any of the three layers drifts again.
