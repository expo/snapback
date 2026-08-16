# expo-chat template live acceptance broken at origin/main (supervised-connect)

**Status:** Closed
**Impact:** 2
**Urgency:** 3
**Ease:** 2
**Confidence:** 5
**Systems:** CLI templates, Expo, Dev supervisor, Auth, LLP 0262
**Date:** 2026-08-16
**Related:** LLP 0258 Phase 3 templates; LLP 0262 (dev-identity capability,
landed 055fe1784/fa53a5772/866a075ef); the react template live acceptance
is GREEN (9/9), so this is expo-supervised-path-specific

## Problem

`packages/snapback-cli/templates/expo-chat/acceptance.mjs` fails at its
first live check `zero-config-supervised-connect` — the round-trip
`roundTripClient.mutate(api.sendMessage, ...)` returns
`SNAPBACK_OUTBOX_NOT_WRITER` ("this context does not hold single-writer
ownership of the client store"), executing 0 checks.

**This reproduces at PRISTINE origin/main**, not only on Phase-3 branches:
a clean `origin/main` checkout of the template (the older 13-check
acceptance) fails the same live run at 0/13 with a query-readiness
`'error' !== 'ready'` against a current-tree debug binary. The check is
byte-identical across the Phase-3 hardening branch and origin/main (that
branch's diff makes zero changes to `runZeroConfigSupervisedConnect`), and
the expo package suite, both static acceptances, and the **react** template
LIVE acceptance (9/9, including live query+mutation) are all green — so this
is specific to the expo supervised-connect / dev-identity path, not the
ordinary auth journey or the client mutation path in general.

## Likely cause

The LLP 0262 dev-identity capability landings (055fe1784 mint/witness,
fa53a5772 one-shot dev-identity checkout over native launch channels,
866a075ef review fixes) changed the supervised dev-identity path that
`createSupervisedExpoEnvironment` + `createSnapbackExpoBoot` drive in
`zero-config-supervised-connect`. The boot's app client and the test's
`roundTripClient` appear to contend for single-writer ownership of the
same generation `clientStoreId` after that change. Needs the LLP 0262 /
expo-supervisor owner to confirm whether the boot should relinquish the
writer before the round-trip client opens it, or whether the acceptance
must reuse the boot's client rather than constructing a second one.

## Evidence
- Phase-3 hardening branch (main + hardening), fresh current-tree binary:
  `zero-config-supervised-connect` → SNAPBACK_OUTBOX_NOT_WRITER, 0/15.
- Pristine origin/main, same binary: 0/13, query-readiness 'error'.
- react template live acceptance, same binary: 9/9 PASS.
- expo package `npm test`: PASS. Both static acceptances: PASS.

## Exit
The expo-chat template live acceptance completes its journey (the 15-check
Phase-3 version, or origin/main's, whichever is current) against a
current-tree runtime.

## Resolution (2026-08-16)

The apparent boot-versus-round-trip contention was an unintentional third
client: `validateReadyDescriptorHealth` constructed a default durable
`SnapbackClient` before the Expo application bootstrap. Its health-only probe
could win the process store's writer lease, leaving the LLP 0258 bootstrap
owner as a reader and making queued mutations refuse with
`SNAPBACK_OUTBOX_NOT_WRITER`. The readiness probe now opts out of RQS and the
offline queue and closes its client after inspection. The acceptance continues
to reuse `roundTripBoot.appClient().client`; single-writer enforcement remains
unchanged.

Completing the newly expanded 15-check journey exposed two unrelated harness
contradictions from the Phase-3 hardening: the synthetic binding omitted the
target's `auth.passwords` offer, and the reload check expected durable recovery
from the template's explicit `volatile-explicit` custody. The binding now names
the password offer and the reload check proves the volatile owner returns to
anonymous before signing in again, matching LLP 0258 D3.

The live Expo acceptance passes 15/15 against the digest-qualified runtime at
commit `799855de720d4288edcbc197745f5df1ae2ff574`; the React acceptance remains
9/9, the Expo package suite passes, and both static template acceptances pass.
