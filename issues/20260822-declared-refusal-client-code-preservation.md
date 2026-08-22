# Preserve declared application refusal codes at every client boundary

**Status:** Open
**Opened:** 2026-08-22
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Declared refusals, Headless client, React client, Familiar profile,
Explicit profile, Diagnostics, Acceptance
**Governing:** LLP 0144; LLP 0295 vertical paved-path coherence invariant
**Evidence:** Clique candidate-0.1.25 Explicit Air lane at
`/Users/ccheever/clique-main-20260821/`

## Problem

The candidate-0.1.25 Explicit Clique lane declared application-semantic
refusals and the server enforced them correctly, but the generated headless
client lost the actionable code:

- Explicit `DUPLICATE_HANDLE` and `ADMIN_REQUIRED` refusals arrived at the
  headless acceptance client only as `SNAPBACK_APP_REFUSAL`.

The suites could prove that no forbidden write committed, but had to record
the authored server code separately and accept a generic client envelope.
That defeats LLP 0144's reason for declaring a refusal: the caller cannot
branch on the stable application code without transport-specific inspection
or prose parsing.

The paired Familiar lane used a bare `throw new Error(...)` for its non-admin
denial and correctly received `SNAPBACK_HANDLER_FAILED`; that is useful
fail-closed control evidence, not evidence that Familiar lost a declared code.

The Explicit result is an implementation-parity defect, not a new error-model
decision. LLP 0144 already requires admitted application refusals to preserve
`appCode` and bounded `appDetails`, while undeclared or malformed claims fail
closed.

## Required change

- Trace the declared-refusal envelope through handler settlement, runtime
  transport, generated operation clients, the headless client, Familiar
  adapters, and React hooks; retain `appCode` and bounded `appDetails` at every
  supported projection.
- Keep the platform diagnostic code namespaced as `SNAPBACK_APP_REFUSAL`; do
  not promote app-controlled strings into the platform code field.
- Keep bare exceptions, undeclared claims, malformed details, and forged
  application codes folded according to LLP 0144.
- Provide one shared typed client helper/projection so Explicit and Familiar
  do not decode different envelope shapes.
- Add the candidate failures as packed external-package regressions rather
  than source-checkout-only tests.

## Acceptance

- A packed Explicit app declaring `DUPLICATE_HANDLE` receives
  `SNAPBACK_APP_REFUSAL` plus exact `appCode: "DUPLICATE_HANDLE"` through the
  generated headless and React clients.
- A packed Familiar app declaring `ADMIN_REQUIRED` receives the same
  namespaced shape through its generated mutation hook.
- Bounded structured details survive; malformed or oversized details follow
  LLP 0144's details-dropped contract without losing the admitted app code.
- Undeclared, forged, and bare exceptions remain generic and leak no handler
  prose.
- The Clique denial assertions can branch on the client-observed app code
  while retaining the unchanged-state proof.
