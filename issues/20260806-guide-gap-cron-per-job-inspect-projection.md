# guide-gap: the cron page teaches per-job facts from /inspect, which no longer carries them

**Status:** Open
**Impact:** 3
**Urgency:** 3
**Ease:** 3
**Confidence:** 5
**Progress:** Not started
**Severity:** P2
**Systems:** Scheduled execution, Developer experience, Testing
**Author:** Claude (Opus 5), building demos/eas-payments
**Date:** 2026-08-06
**Related:** guide/backend/cron.md, demos/all-aboard/tests/acceptance/cron.mjs, scripts/verify-local-proof, diaries/0066-eas-payments-engine-slice.diary.md

## The gap

[cron](../guide/backend/cron.md) does say the per-job view is
`snapback cron list` / `GET /_snapback/api/cron`, and that "the public
`GET /inspect` projection exposes aggregate cron posture only". But the page's
own worked example — the "Gate polling on real demand" and "Test
deterministically" snippets — is transcluded from
`demos/all-aboard/tests/acceptance/cron.mjs`, whose helper reads:

```js
const inspectJob = async () => {
  const state = await (await fetch(`${server.baseUrl}/inspect`)).json();
  return (state.cron?.jobs ?? []).find((j) => j.name === 'warmPoll') ?? null;
};
```

`state.cron` has no `jobs` array. Observed on this checkout for
`demos/eas-payments`, both projections:

```json
{ "artifactKind": "cronRuntimeState", "schemaVersion": "snapback.v0",
  "jobCount": 1, "failedJobCount": 0, "inFlightJobCount": 0 }
```

The `?? []` swallows it, so `inspectJob()` silently returns `null` and every
per-job assertion fails on a nonexistent job rather than on a real fact.

Building `demos/eas-payments` I copied that helper and lost a check to it. The
fix was `GET /_snapback/api/cron`, which returns exactly what is needed:

```json
{ "artifactKind": "snapback.cron-list/v1", "jobs": [
  { "name": "expireGrants", "action": "expireGrantsSweep", "enabled": true,
    "schedule": { "everyMs": 60000, "cron": null },
    "activationPolicy": "always", "activationState": "Armed",
    "lastRunAtMs": 1786053123804, "lastOutcome": "Succeeded",
    "consecutiveFailures": 0 } ] }
```

## The all-aboard suite is currently red

```
$ SNAPBACK_OUTBOUND_ACTIONS=1 node packages/snapback-codegen/index.mjs demos/all-aboard/snapback
$ node demos/all-aboard/tests/acceptance/cron.mjs
  ✗ warm-poll job is registered from the manifest
  ✗ demand activation: inactive with no subscribers
  ✗ demand activation: armed while a rider is subscribed
  ✓ scheduler run: action -> mutation -> live delta
  ✓ refresh committed through the mutation (feed marker + trigger)
  ✗ run is recorded in the cron ledger
  ✗ demand activation: inactive again after the rider disconnects
FAIL all-aboard cron (Phase 2) — 2/7
```

Exactly the five checks that read per-job facts. The two that assert product
behavior through the live query still pass, so the scheduler itself is fine —
only the observation path is wrong.

`demos/all-aboard/tests/acceptance/cron.mjs` is **not** registered in
`scripts/verify-local-proof` (`all-aboard-egress` and
`all-aboard-startup-timing` are), so nothing caught the drift. The guide's
`source=` snippet check verifies the excerpt still matches the file's text; it
cannot notice that the file no longer passes.

## What would close this

1. Repair `demos/all-aboard/tests/acceptance/cron.mjs` to read
   `GET /_snapback/api/cron`, so the guide's transcluded snippets teach the
   working call.
2. Register that suite in `scripts/verify-local-proof` so demand activation and
   the run ledger stay covered.
3. On [cron](../guide/backend/cron.md), show the AdminRead JSON shape next to
   the `snapback cron list` command — an author writing a headless assertion
   needs the field names (`activationState`, `lastOutcome`, `lastRunAtMs`), not
   just the CLI.
4. Consider making the aggregate projection's absence explicit: a caller
   reaching for `state.cron.jobs` gets `undefined` and, with the common `?? []`
   idiom, a silent empty list. Naming the per-job route in the aggregate
   payload would turn a silent wrong answer into a pointer.

`demos/eas-payments/tests/acceptance/headless.mjs` has a working version of the
helper.
