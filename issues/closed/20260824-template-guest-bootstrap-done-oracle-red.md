# Shipped expo-chat done-oracle red at guest bootstrap despite declared+offered guest mechanism

**Status:** Resolved
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

## Resolution (2026-08-25)

The acceptance runner's synthetic supervised binding was the lying layer.
`bindSupervisedApp` copied the generated application's required capabilities
and caller-supplied extras, but unlike the real supervisor binding it did not
project admitted auth entry mechanisms into target offers. Expo-chat supplied
`auth.passwords` explicitly, so its generated `guest-v1` declaration met a
binding that omitted `auth.guest-sessions`; the ordinary app-client bootstrap
correctly refused the false binding. Codegen's lifecycle fact and the runtime
supervisor offer projection were both correct.

`@expo/snapback-acceptance` now projects `auth.passwords` and
`auth.guest-sessions` from the generated bootstrap policy when it constructs
the supervised binding. Its packed-package test loads Expo-chat's generated
lifecycle table and descriptor, intersects each shipped mechanism with the
acceptance binding, and lets the real app-client bootstrap admit the result.
Before the projection fix that fixture exited 1 at the missing target
capability assertion; after the fix it passes.

The 0.1.26 closure should have caught the red done-oracle. Like
`20260824-expo-web-bundling-import-specifier-blocker`, its template
qualification stopped at static acceptance, so a broken first-hour journey
shipped. The current cold-install harness had grown a raw `npm test` step, but
that still tested a debugging implementation instead of the template's sole
done-oracle. Packed Expo-chat qualification now runs `npm run prove`, and a
source guard prevents regression to raw-only acceptance.

Verification:

- Fresh scaffold, installed with the packed fixed acceptance package and this
  checkout's qualified runtime, after the scaffold's declared `generate`
  stage: `fresh scaffold prove: 13/13 paths observed; status=passed;
  profile=passed`. A bare `prove` on a cache-less tree still fail-closes with
  `SNAPBACK_CODEGEN_CACHE_INVALID`; that pre-existing property was not the
  guest-bootstrap red. The README's documented first-hour order and the packed
  cold-install qualification both run `generate` before `prove`; this fix does
  not fold generation into the done-oracle.
- `node --test --test-concurrency=1 packages/snapback-acceptance/package.test.mjs`:
  29 tests passed, 0 failed.
- `node --test scripts/snapback-package-cold-install.test.mjs`: 46 tests
  passed, 0 failed.
- `./ref-check --verbose`: 311 LLP docs, 6565 refs in 12168 files, 0 errors,
  0 unchecked.
