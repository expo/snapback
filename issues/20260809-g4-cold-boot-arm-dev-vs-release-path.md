# Design question: is G4's retained-cold-boot arm a dev-path or a release-path obligation?

**Status:** Open — routed to LLP 0181's owner; raised by the LLP 0176 G4
external rerun against live 0.1.16
**Impact:** 3
**Urgency:** 3
**Ease:** 3
**Confidence:** 4
**Systems:** Expo, Client store, Retention, Release exports
**Date:** 2026-08-09
**Related:** [LLP 0181](../llp/0181-zero-configuration-expo.rfc.md),
[LLP 0176 §G4](../llp/0176-expo-messaging-golden-path.plan.md),
[`20260806-expo-file-carrier-process-kill-witness.md`](./20260806-expo-file-carrier-process-kill-witness.md),
[G4 0.1.16 receipts](../demos/expo-golden-path-fixture/receipts/20260809-g4-external-0116-summary.md)

## The question

LLP 0176 §G4's guarantees ledger requires: "After one current query, a cold app
relaunch can render the retained snapshot with truthful retained/connection
facts." The ceremony does not say which carrier must satisfy it, and the two
candidates now behave differently:

- **Supervised development path.** The 0.1.13 supervised-binding-cache repair
  makes a cold relaunch resolvable without the supervisor — but only for one
  hour, and only in a development bundle.
- **Release path.** LLP 0181's package contract makes the supervised
  environment inert under the production condition: `resolveBinding` fails with
  `SNAPBACK_APP_BINDING_UNAVAILABLE`, and the whole supervised vocabulary is
  pruned by Metro's production transform. The 0.1.16 G4 receipts confirm that
  prune against real Hermes bytes. Retained state on a release app must
  therefore arrive through `prepareReactBinding`'s persisted receipt, not the
  supervised cache.

So a dev-path pass is not a release-path claim, and the two are not
substitutable. G4's arm currently does not say which one it is asking for.

## Why it is being raised now rather than answered

The 0.1.16 rerun could not measure either path — the published runtime cannot
start a generated backend
([blocking ticket](./20260809-runtime-package-missing-store-qualification-receipt.md)),
so there was never a current query to retain. The last real measurement remains
the 0.1.11 iOS attempt, which stayed at boot `starting` while the backend was
paused and rendered only after connectivity returned: **not proved**.

Answering this by measurement would have meant choosing which path to measure,
and that choice is a specification decision, not a supervisor's call. Deciding
it before the next rerun avoids producing evidence for the wrong arm.

## What a ruling needs to settle

1. Which carrier G4's retained-cold-boot arm binds: supervised dev, release
   `prepareReactBinding`, or both as separate rows.
2. Whether the supervised cache's 1-hour TTL is inside or outside the arm's
   claim.
3. Whether a release-path retained render is in scope for G4 at all, given that
   G4's own device-evidence boundary already defers the LLP 0064 `Online` claim
   to G5.

## Acceptance

- LLP 0181's owner rules the above, and LLP 0176 §G4's guarantees ledger is
  amended to name the carrier explicitly.
- The next G4 rerun measures the named path and records the other one as
  out of scope by rule rather than by omission.
