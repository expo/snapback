# Probe: does the Expo presence facade work under a bare URL-first `SnapbackProvider` on web?

**Filed:** 2026-08-26 · **Resolved:** 2026-08-26 — **works**
**Systems:** Ephemeral state, React/Expo, Guide
**Owner:** LLP 0310.000 Track D / acceptance D2
**Related:** `issues/20260825-ruling-3-vs-llp-0257-background-withdrawal.md`
  (gated on this), `issues/closed/20260825-guide-gap-activity-presence-url-first.md`,
  `issues/closed/20260826-activity-presence-one-generation-per-episode.md`,
  LLP 0310 F4 / P5 / P20, LLP 0257

## Why

The 0.1.27 Clique familiar lane reported that `@expo/snapback-expo`'s
`useSnapbackActivityPresence` "requires `SnapbackExpoLifecycleContext`, which a
URL-first provider does not have." That claim is the basis for guide text that
landed 2026-08-25 and for LLP 0310.000 Ruling 3's package boundary — and it is
**unverified**:

- `packages/snapback-expo/activity-presence.mjs` resolves
  `lifecycleContext?.source ?? await resolveSnapbackExpoLifecycleSource(lifecycleContext?.environment ?? null)`.
  The context is optional.
- On web the resolver reaches `resolveDefaultAppState`
  (`packages/snapback-expo/app-state.web.mjs`), which imports
  `react-native-web`'s `AppState` — present in any Expo web app.
- LLP 0257 *requires* that bare-provider fallback, and
  `issues/20260825-ruling-3-vs-llp-0257-background-withdrawal.md` records that
  the shipped facade follows it.
- The lane never observed a refusal. Its run-log (1787660792) shows it decided
  from reading `index.d.mts`, and its own final report labels the row
  `agent-error`.

## Probe

Render the `@expo/snapback-expo` facade hook inside a bare URL-first
`SnapbackProvider` tree on Expo web (no `SnapbackExpoProvider`). Record
works / fails-with-code, and if it fails, the exact diagnostic — most plausibly
`SNAPBACK_EXPO_ACTIVITY_LIFECYCLE_UNAVAILABLE` from
`controls.failLifecycle(...)`. Also record whether the gated admission ever
opens.

## Consequences

- **Works:** LLP 0257 stands unamended, the conflict ticket closes as "no
  conflict," the 2026-08-25 guide text is corrected to describe both hooks and
  their gated/ungated difference rather than declaring one unsupported, and
  LLP 0310.000 Ruling 3 rules no package boundary.
- **Fails:** the observed failure mode — not a package taste — is what gets
  designed against, and the LLP 0257 owner decision proceeds on evidence.

## Done when

The observation is recorded and LLP 0310.000 OQ7 can be answered.

## Resolution — 2026-08-26: **works**

Probe: `tests/probes/expo-presence-bare-provider-20260826/` (`run.mjs`,
retained `observation.json`, `summary.md`, and `probe.test.mjs` as a standing
regression test).

Rendered under a bare URL-first `SnapbackProvider` — no `SnapbackExpoProvider`,
no `SnapbackExpoLifecycleContextProvider`, no injected environment:

```json
{ "outcome": "works", "diagnosticCode": null, "gatedAdmissionOpened": true,
  "touch": { "active": true, "publishAttempts": 1 } }
```

No `SNAPBACK_EXPO_ACTIVITY_LIFECYCLE_UNAVAILABLE`; the gated admission opened
and `touch()` published once. The lane's premise — that the facade *requires*
`SnapbackExpoLifecycleContext` — is refuted. Every Snapback module in the chain
was shipped source; only `react-native-web`'s `AppState` module was stubbed
(it is not a workspace dependency), and `--conditions=browser` stood in for
Metro's web condition resolution. Both limits are recorded in `summary.md`.

Consequences applied in the same landing:

- LLP 0257 stands unamended.
- `issues/20260825-ruling-3-vs-llp-0257-background-withdrawal.md` closed as
  "no conflict".
- LLP 0310.000 Ruling 3 rules **no package boundary** (its r5+ text already
  held the boundary open pending this probe).
- `guide/realtime/ephemeral-state.md`, `guide/recipes/activity-presence.md`,
  and `guide/backend/familiar-profile.md` now describe both hooks and their
  gated/ungated difference instead of declaring the facade
  `SnapbackExpoProvider`-only; retrieval case 100 updated to match.
- LLP 0310 P5/P20 closed; LLP 0310.000 OQ7 answered.
