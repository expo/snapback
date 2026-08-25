# Shipped expo-chat done-oracle red at guest bootstrap despite declared+offered guest mechanism

**Status:** Closed
**Opened:** 2026-08-24
**Resolved:** 2026-08-25
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

## Resolution

The acceptance-owned synthetic supervised binding was the lying layer. The
generated `client-lifecycle.v1.json` correctly declared `guest-v1`, and the
real supervisor correctly projected that declaration to
`auth.guest-sessions`. The public acceptance runner's `bindingFor(...)`
instead copied the generated required capabilities plus a template-authored
extras list; `expo-chat/acceptance.mjs` manually supplied only
`auth.passwords`. After the zero-config preflight passed, the second synthetic
bootstrap therefore refused the declared guest mechanism before check 2.

`@expo/snapback-acceptance` now derives the `auth.passwords` and
`auth.guest-sessions` offers from the generated
`authBootstrap.entryMechanisms`, matching the real supervisor. The Expo chat
acceptance no longer transcribes either mechanism capability. The existing
packed guest-session proof now includes `@expo/snapback-acceptance` and binds
the shipped template's generated guest lifecycle row to the acceptance
binding offer and the real packed client bootstrap admission in one 1/1
vertical fixture.

Published 0.1.27 was verified to retain the defect: a fresh registry scaffold
declared `guest-v1`, its real supervisor source projected
`auth.guest-sessions`, its acceptance source supplied only `auth.passwords`,
and the packed client dynamically emitted
`SNAPBACK_AUTH_BOOTSTRAP_MECHANISM_UNAVAILABLE` for the missing guest offer.

The 0.1.27 closure should have caught the red done-oracle under LLP 0275 D6
and LLP 0196 T5. Its implemented template qualification stopped at scaffold,
install, generate, and `test:static` (plus the Expo web-export repair); LLP
0041's 0.1.27 record likewise reports static acceptance, even though LLP
0041's template contract says static acceptance cannot satisfy the acceptance
claim. No new release gate was added in this repair: the packed vertical
fixture covers the three-layer drift class requested by this ticket.

Final evidence used candidate-packed CLI and acceptance bytes over the
published 0.1.27 dependency/runtime closure on a clean remote scaffold with no
application edits. `bun run prove` exited 0 with verify status `passed`, all
five stages passed, the acceptance profile passed with zero diagnostics, and
conformance reported `expectedPaths: 13`, `observedPaths: 13`.
