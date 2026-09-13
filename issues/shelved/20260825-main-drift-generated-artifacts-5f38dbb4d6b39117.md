# main drift: generated-artifacts has a stale committed record

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, Tooling, CI
**Date:** 2026-08-25
**Drift gate:** `generated-artifacts`
**Outcome:** `STALE`
**Failure signature:** `sha256:5f38dbb4d6b39117557a76a519c42cbb077a4ac5c0969ee59e9d98b324da907b`
**Causal landing:** `none — record-epoch-not-green`
**Detected at:** `057ce5898fcc7217dea8dddd7bd4b02deadb4eb7`
**Last observed:** `057ce5898fcc7217dea8dddd7bd4b02deadb4eb7`
**Attribution:** `record-epoch-not-green`
**Related:** LLP 0175 §D2.1

## Summary

The frozen-record backstop ran `generated-artifacts` independently of path selection on
`main` and found the committed record stale, but record-epoch-not-green prevents a supported causal-landing claim. This ticket is keyed by gate plus
normalized failure signature and remains idempotent while open.

## Stale record

- `committed review manifests and projections selected by scripts/generated-artifact-policy.mjs`

Checker materialization, when available:

- `demos/access-desk/snapback/generated/artifacts.json`
- `demos/access-desk/snapback/generated/authorization-review.json`
- `demos/all-aboard/tests/egress-probe/generated/artifacts.json`
- `demos/all-aboard/tests/egress-probe/generated/authorization-review.json`
- `demos/browser-local-first/snapback-sessions/generated/artifacts.json`
- `demos/browser-local-first/snapback-sessions/generated/authorization-review.json`
- `demos/browser-local-first/snapback/generated/artifacts.json`
- `demos/browser-local-first/snapback/generated/authorization-review.json`
- `demos/campfire/snapback/generated/artifacts.json`
- `demos/campfire/snapback/generated/authorization-review.json`
- `demos/card-game/snapback/generated/artifacts.json`
- `demos/card-game/snapback/generated/authorization-review.json`
- `demos/catalog-lens/snapback/generated/artifacts.json`
- `demos/catalog-lens/snapback/generated/authorization-review.json`
- `demos/chirp/snapback/generated/artifacts.json`
- `demos/chirp/snapback/generated/authorization-review.json`
- `demos/competitive-checkpoint/snapback/generated/api.d.mts`
- `demos/competitive-checkpoint/snapback/generated/api.d.ts`
- `demos/competitive-checkpoint/snapback/generated/api.mjs`
- `demos/competitive-checkpoint/snapback/generated/artifacts.json`
- `demos/competitive-checkpoint/snapback/generated/authorization-review.json`
- `demos/competitive-checkpoint/snapback/generated/functions.manifest.json`
- `demos/competitive-checkpoint/snapback/generated/schema.manifest.json`
- `demos/cursors-web/snapback/generated/artifacts.json`
- `demos/cursors-web/snapback/generated/authorization-review.json`
- `demos/dispatch-board/snapback/generated/artifacts.json`
- `demos/dispatch-board/snapback/generated/authorization-review.json`
- `demos/file-drop/snapback/generated/artifacts.json`
- `demos/file-drop/snapback/generated/authorization-review.json`
- `demos/fleet-observatory-move1/snapback/generated/artifacts.json`
- `demos/fleet-observatory-move1/snapback/generated/authorization-review.json`
- `demos/graffiti/snapback/generated/artifacts.json`
- `demos/graffiti/snapback/generated/authorization-review.json`
- `demos/knockoff/snapback/generated/artifacts.json`
- `demos/knockoff/snapback/generated/authorization-review.json`
- `demos/latency-kanban/snapback/generated/artifacts.json`
- `demos/latency-kanban/snapback/generated/authorization-review.json`
- `demos/messaging-snapback/snapback/generated/artifacts.json`
- `demos/messaging-snapback/snapback/generated/authorization-review.json`
- `demos/partiful-matrix/snapback/generated/api.mjs`
- `demos/partiful-matrix/snapback/generated/artifacts.json`
- `demos/partiful-matrix/snapback/generated/authorization-review.json`
- `demos/party-wall/snapback/generated/artifacts.json`
- `demos/party-wall/snapback/generated/authorization-review.json`
- `demos/pointing-room/snapback/generated/artifacts.json`
- `demos/pointing-room/snapback/generated/authorization-review.json`
- `demos/pointing-room/snapback/generated/functions.manifest.json`
- `demos/pointing-room/snapback/generated/schema.manifest.json`
- `demos/public-dashboard/snapback/generated/artifacts.json`
- `demos/public-dashboard/snapback/generated/authorization-review.json`
- `demos/pulse-monitor/snapback/generated/artifacts.json`
- `demos/pulse-monitor/snapback/generated/authorization-review.json`
- `demos/rbac/snapback/generated/artifacts.json`
- `demos/rbac/snapback/generated/authorization-review.json`
- `demos/shindig/snapback/generated/artifacts.json`
- `demos/shindig/snapback/generated/authorization-review.json`
- `demos/signal-desk/snapback/generated/artifacts.json`
- `demos/signal-desk/snapback/generated/authorization-review.json`
- `demos/team-chat/snapback/generated/api.d.mts`
- `demos/team-chat/snapback/generated/api.d.ts`
- `demos/team-chat/snapback/generated/artifacts.json`
- `demos/team-chat/snapback/generated/authorization-review.json`
- `demos/todo-v2/snapback/generated-remote-service/artifacts.json`
- `demos/todo-v2/snapback/generated-remote-service/authorization-review.json`
- `demos/todo-v2/snapback/generated-remote-service/functions.manifest.json`
- `demos/todo-v2/snapback/generated-remote-service/schema.manifest.json`
- `demos/todo-v2/snapback/generated/artifacts.json`
- `demos/todo-v2/snapback/generated/authorization-review.json`
- `demos/todo-v2/snapback/generated/functions.manifest.json`
- `demos/todo-v2/snapback/generated/schema.manifest.json`
- `demos/todo/snapback/generated/artifacts.json`
- `demos/todo/snapback/generated/authorization-review.json`
- `demos/todo/snapback/generated/functions.manifest.json`
- `demos/todo/snapback/generated/schema.manifest.json`
- `demos/triage-graph/snapback/generated/artifacts.json`
- `demos/triage-graph/snapback/generated/authorization-review.json`
- `demos/zero-bakeoff/apps/contention-calendar/snapback/generated/api-envelope.members.json`
- `demos/zero-bakeoff/apps/contention-calendar/snapback/generated/api.d.mts`
- `demos/zero-bakeoff/apps/contention-calendar/snapback/generated/api.d.ts`
- `demos/zero-bakeoff/apps/contention-calendar/snapback/generated/api.mjs`
- `demos/zero-bakeoff/apps/contention-calendar/snapback/generated/app.binding.1a597f6b1ee4b1a93216e0352caa5de887feee9223be586ef0ca1295b86dd5f1.mjs`
- `demos/zero-bakeoff/apps/contention-calendar/snapback/generated/app.binding.265d4437779a9e6c67696deee78aab86b99edf03904c9e6cb731dc5ff16b1d26.mjs`
- `demos/zero-bakeoff/apps/contention-calendar/snapback/generated/app.binding.mjs`
- `demos/zero-bakeoff/apps/contention-calendar/snapback/generated/app.d.mts`
- `demos/zero-bakeoff/apps/contention-calendar/snapback/generated/app.d.ts`
- `demos/zero-bakeoff/apps/contention-calendar/snapback/generated/app.descriptor.5d228242bd7070237f3597aea17754692f09deafd710d32e4e5c310db921e38d.json`
- `demos/zero-bakeoff/apps/contention-calendar/snapback/generated/app.descriptor.d7559d463ef92961b2e3fb45e15d85ea06600f18694315cafd8ec4f9f7dc9153.json`
- `demos/zero-bakeoff/apps/contention-calendar/snapback/generated/app.descriptor.json`
- `demos/zero-bakeoff/apps/contention-calendar/snapback/generated/app.mjs`
- `demos/zero-bakeoff/apps/contention-calendar/snapback/generated/artifacts.json`
- `demos/zero-bakeoff/apps/contention-calendar/snapback/generated/authorization-review.json`
- `demos/zero-bakeoff/apps/contention-calendar/snapback/generated/client-lifecycle.manifest.json`
- `demos/zero-bakeoff/apps/contention-calendar/snapback/generated/client-lifecycle.v1.json`
- `demos/zero-bakeoff/apps/contention-calendar/snapback/generated/contract-data.manifest.json`
- `demos/zero-bakeoff/apps/contention-calendar/snapback/generated/functions.manifest.json`
- `demos/zero-bakeoff/apps/contention-calendar/snapback/generated/handler-runtime-profile.v1.json`
- `demos/zero-bakeoff/apps/contention-calendar/snapback/generated/provider-bindings.json`
- `demos/zero-bakeoff/apps/contention-calendar/snapback/generated/provider-introspection.json`
- `demos/zero-bakeoff/apps/contention-calendar/snapback/generated/schema.manifest.json`
- `packages/snapback-cli/fixtures/comparator/app/snapback/generated/api-envelope.members.json`
- `packages/snapback-cli/fixtures/comparator/app/snapback/generated/api.d.mts`
- `packages/snapback-cli/fixtures/comparator/app/snapback/generated/api.d.ts`
- `packages/snapback-cli/fixtures/comparator/app/snapback/generated/api.mjs`
- `packages/snapback-cli/fixtures/comparator/app/snapback/generated/app.binding.54cf90b0ad2f035519a23d5fb82c4e443306cfe4a830fc5c986718e675c30c80.mjs`
- `packages/snapback-cli/fixtures/comparator/app/snapback/generated/app.binding.e87de2a8ce67a125de0569a4b5db0f561d471a04c8d33cffbe3ab79fa8c6d87a.mjs`
- `packages/snapback-cli/fixtures/comparator/app/snapback/generated/app.binding.mjs`
- `packages/snapback-cli/fixtures/comparator/app/snapback/generated/app.d.mts`
- `packages/snapback-cli/fixtures/comparator/app/snapback/generated/app.d.ts`
- `packages/snapback-cli/fixtures/comparator/app/snapback/generated/app.descriptor.2cbd19f3db4dfcc6339de525074ec414d7c7e95849a87a36e64b3416b9de8dbb.json`
- `packages/snapback-cli/fixtures/comparator/app/snapback/generated/app.descriptor.3d30bb6b48b5f6c8b42cc87de6a3dc227266ed62d9194107f73f3968ecc128ae.json`
- `packages/snapback-cli/fixtures/comparator/app/snapback/generated/app.descriptor.json`
- `packages/snapback-cli/fixtures/comparator/app/snapback/generated/app.mjs`
- `packages/snapback-cli/fixtures/comparator/app/snapback/generated/artifacts.json`
- `packages/snapback-cli/fixtures/comparator/app/snapback/generated/authorization-review.json`
- `packages/snapback-cli/fixtures/comparator/app/snapback/generated/client-lifecycle.manifest.json`
- `packages/snapback-cli/fixtures/comparator/app/snapback/generated/client-lifecycle.v1.json`
- `packages/snapback-cli/fixtures/comparator/app/snapback/generated/contract-data.manifest.json`
- `packages/snapback-cli/fixtures/comparator/app/snapback/generated/functions.manifest.json`
- `packages/snapback-cli/fixtures/comparator/app/snapback/generated/handler-runtime-profile.v1.json`
- `packages/snapback-cli/fixtures/comparator/app/snapback/generated/provider-bindings.json`
- `packages/snapback-cli/fixtures/comparator/app/snapback/generated/provider-introspection.json`
- `packages/snapback-cli/fixtures/comparator/app/snapback/generated/schema.manifest.json`
- `packages/snapback-cli/fixtures/push-seam/app/snapback/generated/api-envelope.members.json`
- `packages/snapback-cli/fixtures/push-seam/app/snapback/generated/api.d.mts`
- `packages/snapback-cli/fixtures/push-seam/app/snapback/generated/api.d.ts`
- `packages/snapback-cli/fixtures/push-seam/app/snapback/generated/api.mjs`
- `packages/snapback-cli/fixtures/push-seam/app/snapback/generated/app.binding.2aa937ccb6aae59a58a2efb6eb47f9425c6307b630f67ba6adb17fe224b16f2b.mjs`
- `packages/snapback-cli/fixtures/push-seam/app/snapback/generated/app.binding.e97e5ec150e1f1a03f91f4c6102cce1433a4b7eecc0f63f5c862a9923c19e1a5.mjs`
- `packages/snapback-cli/fixtures/push-seam/app/snapback/generated/app.binding.mjs`
- `packages/snapback-cli/fixtures/push-seam/app/snapback/generated/app.d.mts`
- `packages/snapback-cli/fixtures/push-seam/app/snapback/generated/app.d.ts`
- `packages/snapback-cli/fixtures/push-seam/app/snapback/generated/app.descriptor.7cf7decbbb3817c50753623ed5d105a8a90322ccfa7317bb221006d6b37c0007.json`
- `packages/snapback-cli/fixtures/push-seam/app/snapback/generated/app.descriptor.91fc401f3b998e358d50517b8667a73855695270e59f6eb460114a6bdad1bdd6.json`
- `packages/snapback-cli/fixtures/push-seam/app/snapback/generated/app.descriptor.json`
- `packages/snapback-cli/fixtures/push-seam/app/snapback/generated/app.mjs`
- `packages/snapback-cli/fixtures/push-seam/app/snapback/generated/artifacts.json`
- `packages/snapback-cli/fixtures/push-seam/app/snapback/generated/authorization-review.json`
- `packages/snapback-cli/fixtures/push-seam/app/snapback/generated/client-lifecycle.manifest.json`
- `packages/snapback-cli/fixtures/push-seam/app/snapback/generated/client-lifecycle.v1.json`
- `packages/snapback-cli/fixtures/push-seam/app/snapback/generated/contract-data.manifest.json`
- `packages/snapback-cli/fixtures/push-seam/app/snapback/generated/functions.manifest.json`
- `packages/snapback-cli/fixtures/push-seam/app/snapback/generated/handler-runtime-profile.v1.json`
- `packages/snapback-cli/fixtures/push-seam/app/snapback/generated/provider-bindings.json`
- `packages/snapback-cli/fixtures/push-seam/app/snapback/generated/provider-introspection.json`
- `packages/snapback-cli/fixtures/push-seam/app/snapback/generated/schema.manifest.json`
- `packages/snapback-react/fixtures/conversation/app/snapback/generated/api-envelope.members.json`
- `packages/snapback-react/fixtures/conversation/app/snapback/generated/api.d.mts`
- `packages/snapback-react/fixtures/conversation/app/snapback/generated/api.d.ts`
- `packages/snapback-react/fixtures/conversation/app/snapback/generated/api.mjs`
- `packages/snapback-react/fixtures/conversation/app/snapback/generated/app.binding.7e2dde14f5af3f5a48207bbc9370856d7b9e1e512bfef01d2b807e054cc0f7b1.mjs`
- `packages/snapback-react/fixtures/conversation/app/snapback/generated/app.binding.e00fcfb74973c7996e3b635d4adc5917191facd7831e9507ad0e22513a41083d.mjs`
- `packages/snapback-react/fixtures/conversation/app/snapback/generated/app.binding.mjs`
- `packages/snapback-react/fixtures/conversation/app/snapback/generated/app.d.mts`
- `packages/snapback-react/fixtures/conversation/app/snapback/generated/app.d.ts`
- `packages/snapback-react/fixtures/conversation/app/snapback/generated/app.descriptor.a5175129e2dc74ecbb21028fabb1092153e8b7f91d20277f30244d7df89aa90d.json`
- `packages/snapback-react/fixtures/conversation/app/snapback/generated/app.descriptor.f21fe23fb3a764453c8507b8731e50d24de7c4eb2e59ccb18450b2124c4aaa15.json`
- `packages/snapback-react/fixtures/conversation/app/snapback/generated/app.descriptor.json`
- `packages/snapback-react/fixtures/conversation/app/snapback/generated/app.mjs`
- `packages/snapback-react/fixtures/conversation/app/snapback/generated/artifacts.json`
- `packages/snapback-react/fixtures/conversation/app/snapback/generated/authorization-review.json`
- `packages/snapback-react/fixtures/conversation/app/snapback/generated/client-lifecycle.manifest.json`
- `packages/snapback-react/fixtures/conversation/app/snapback/generated/client-lifecycle.v1.json`
- `packages/snapback-react/fixtures/conversation/app/snapback/generated/contract-data.manifest.json`
- `packages/snapback-react/fixtures/conversation/app/snapback/generated/functions.manifest.json`
- `packages/snapback-react/fixtures/conversation/app/snapback/generated/handler-runtime-profile.v1.json`
- `packages/snapback-react/fixtures/conversation/app/snapback/generated/provider-bindings.json`
- `packages/snapback-react/fixtures/conversation/app/snapback/generated/provider-introspection.json`
- `packages/snapback-react/fixtures/conversation/app/snapback/generated/schema.manifest.json`

## Reproduce and reconcile

Check:

```sh
scripts/check-generated-artifacts
```

Regenerate/reconcile:

```sh
scripts/check-generated-artifacts
```

Commit the reconciled record with the measured change, verify the gate, record
the resolution here, and move this ticket to `issues/closed/`.
