# Align README notification claims with shipped capability facts

**Status:** Closed
**Impact:** 4
**Urgency:** 5
**Ease:** 5
**Confidence:** 5
**Systems:** README, Guide, Capabilities, Notifications
**Date:** 2026-08-19
**Governing:** LLP 0045, LLP 0143, LLP 0294 W5

## Problem

The README advertises:

> Notifications — email, SMS, and push, as a thin layer you configure with
> the providers you choose.

The capability registry reports first-class `backend.notifications` as
design-only on every target. What ships locally is the narrower Expo push seam;
it does not establish email/SMS delivery or the complete LLP 0045 durable
notification lifecycle. This wording can cause users and agents to infer a
built-in SMS workflow that does not exist.

## Required change

- Rewrite the README capability list to distinguish shipped local Expo push
  from planned first-class email/SMS/push.
- Ensure the same maturity and target language appears in README, Guide index,
  capability registry, package READMEs, and any generated public projection.
- Add a check that a design-only/GAP capability cannot be rendered as an
  unqualified shipped headline.
- Do not weaken or hide the existing Expo push seam.

## Acceptance

- A reader can tell, from the README alone, that in-app message persistence is
  ordinary application data, local Expo push is shipped, and first-class
  email/SMS/general notifications are not yet shipped.
- Generated/public documentation agrees with `guide/capabilities.md` target
  and maturity fields.
- A regression test fails on an unqualified email/SMS/push headline while the
  capability remains design-only.

## Resolution

Closed 2026-08-25. The overclaim was removed in `4e903046c` (docs(readme):
rewrite for the current state of the project) on the same day this ticket was
filed. The README now lists first-class notifications as design-only, agrees
with `guide/capabilities.md` (`backend.notifications` design-only), and
describes the shipped Expo push seam separately under Background work. A
mechanical regression test that fails on an unqualified email/SMS/push
headline was not added; the user-facing overclaim is gone.
