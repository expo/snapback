# LLP 0310 P20 / LLP 0310.000 D2 — bare-provider Expo presence facade: result

**Run:** 2026-08-26 · `node --conditions=browser --import ./register.mjs ./run.mjs`
**Ticket:** `issues/20260826-probe-expo-presence-facade-bare-provider.md`
**Retained observation:** `observation.json`
**Regression test:** `probe.test.mjs`

## Question

The 0.1.27 Clique familiar lane reported that `@expo/snapback-expo`'s
`useSnapbackActivityPresence` "requires `SnapbackExpoLifecycleContext`, which a
URL-first provider does not have", and switched packages on that basis. Its
run-log (1787660792) shows it decided from reading `index.d.mts`; it never
observed a refusal, and its own final report labels the row `agent-error`.

## Result: **works**

Rendered under a bare URL-first `SnapbackProvider` — no `SnapbackExpoProvider`,
no `SnapbackExpoLifecycleContextProvider`, no injected environment:

```json
{ "outcome": "works", "diagnosticCode": null, "gatedAdmissionOpened": true,
  "touch": { "active": true, "publishAttempts": 1 } }
```

No `SNAPBACK_EXPO_ACTIVITY_LIFECYCLE_UNAVAILABLE`. The gated admission opened
and `touch()` published once. The lane's premise is refuted.

## What ran, exactly

Every Snapback module in the chain is shipped source:

    useSnapbackActivityPresence (packages/snapback-expo/activity-presence.mjs)
      -> useSnapbackExpoLifecycleContext() === null      (the context IS optional)
      -> resolveSnapbackExpoLifecycleSource(null)        (lifecycle-source.mjs)
      -> import('#app-state') under the `browser` condition
      -> resolveDefaultAppState()                        (app-state.web.mjs)
      -> react-native-web AppState

## Limits (stated, not waved)

1. `react-native-web/dist/exports/AppState/index.js` is **stubbed**
   (`rnw-appstate-stub.mjs`); it is not a workspace dependency. `admitSource`
   accepts any object exposing `addEventListener`, which is the predicate under
   test, so the stub is faithful to it — but this run does not prove that the
   real react-native-web module resolves under Metro's web bundling.
2. Node with `--conditions=browser` stands in for Metro's web condition
   resolution of the package `imports` map.

Neither limit touches the claim the lane made. The lane's claim was that the
facade *requires* a context a URL-first provider cannot supply; the context is
optional in source and the fallback path admits.

## Consequences (per the ticket)

- LLP 0257 stands unamended; its bare-provider fallback is what shipped.
- `issues/20260825-ruling-3-vs-llp-0257-background-withdrawal.md` closes as
  "no conflict".
- LLP 0310.000 Ruling 3 rules **no package boundary**.
- The 2026-08-25 guide text must describe both hooks and their gated/ungated
  difference rather than declaring one unsupported.
