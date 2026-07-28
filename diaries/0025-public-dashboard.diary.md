# 0025 — Public Dashboard snapshot-bundle workout

## 2026-07-27 — anonymous one-commit deep-link boot

Public Dashboard maps `/dashboards/:dashboardId` to one explicitly public,
authority-independent, `publicInline` live query. Acceptance provisions the
route manifest, fetches anonymous read-mode bundles for two route parameters,
checks resume tokens and commit identity, and refuses an undeclared route.

### What felt good

- `defineRoutes` made the page's data inventory explicit and prevented callers
  from choosing arbitrary functions.
- One request returned route-bound rows at one commit with a resumable-query
  token. The app authored no boot coordinator.
- Codegen made the three anonymous-disclosure facts inspectable in the function
  manifest.

### What felt bad or surprising

- The capability index advertised snapshot bundles but marked the guide as a
  GAP. Building the smallest correct app required reading LLP 0092 and existing
  rollout fixtures.
- Response details such as `commitVersion`, `entry.resume.token`, the seed
  outcome spelling, and the unknown-route diagnostic were discoverable in code
  but not in an intent-oriented page.

The new `guide/realtime/snapshot-bundles.md` teaches route declaration,
read-mode fetch, response shape, register-mode adoption, target limits, and
anti-patterns from this executable demo.
