---
title: Surface map
id: meta.surface-map
order: 3
audience: agent-first
capabilities: []
authorities: [llp/0024-agent-operating-surface.spec.md, llp/0031-server-route-taxonomy.spec.md, llp/0061-agent-first-snapback-guide.rfc.md, src/server.rs, src/admin.rs, src/admin_link.rs]
examples: []
status: current
targets: [all]
maturity: shipped
reviewed: 2026-08-03
reviewed-commit: 7b467cf16
---

# Surface map

<!-- @ref LLP 0061#2-the-capability-index-registry-lite-with-witnesses — every machine-enumerable surface remains joined to one capability classification -->

Every entry of the machine-enumerable registries, classified. The checker
extracts both enumerations from the code and fails if any entry is missing
here (or listed here but gone from the code).

## Server routes (LLP 0031 declared registry)

| Route path | Capability |
| --- | --- |
| / | operating.inspect |
| /_snapback/admin | operating.admin-console |
| /_snapback/admin/ | operating.admin-console |
| /_snapback/admin/reachability/identity | operating.admin-console |
| /_snapback/admin/setup | operating.secrets-config |
| /_snapback/admin/{*path} | operating.admin-console |
| /_snapback/guide | operating.served-guide |
| /_snapback/guide/flat.md | operating.served-guide |
| /_snapback/guide/{*path} | operating.served-guide |
| /llms.txt | operating.served-guide |
| /_snapback/api/admin-secret-read/mint | notAuthorFacing (operator data-read lease, LLP 0058) |
| /_snapback/api/app/reset | backend.seed |
| /_snapback/api/app/seed/clear-v1 | backend.versioned-seed |
| /_snapback/api/app/seed/ensure-v1 | backend.versioned-seed |
| /_snapback/api/app/seed/preview-v1 | backend.versioned-seed |
| /_snapback/api/app/seed/reset-install-v1 | backend.versioned-seed |
| /_snapback/api/auth/mailbox | auth.sessions |
| /_snapback/api/client-mutations/purge | notAuthorFacing (operator settlement maintenance) |
| /_snapback/api/config/plan | operating.secrets-config |
| /_snapback/api/config/set | operating.secrets-config |
| /_snapback/api/debug/network-profile | operating.network-profiles |
| /_snapback/api/config/status | operating.secrets-config |
| /_snapback/api/config/unset | operating.secrets-config |
| /_snapback/api/config/verify | operating.secrets-config |
| /_snapback/api/connections/{connection_id}/disconnect | notAuthorFacing (admin-gated connection teardown) |
| /_snapback/api/console/credential | operating.admin-console |
| /_snapback/api/console/claim | operating.admin-console |
| /_snapback/api/console/claim/exchange | operating.admin-console |
| /_snapback/api/console/claim/status | operating.admin-console |
| /_snapback/api/console/claim/revoke | operating.admin-console |
| /_snapback/api/console/reachability/register | operating.admin-console |
| /_snapback/api/console/reachability/bind | operating.admin-console |
| /_snapback/api/console/reachability/renew | operating.admin-console |
| /_snapback/api/console/reachability/drop | operating.admin-console |
| /_snapback/api/console/approval/request | operating.admin-console |
| /_snapback/api/console/approval/poll | operating.admin-console |
| /_snapback/api/console/approval/approve | operating.admin-console |
| /_snapback/api/cron/tick | backend.cron |
| /_snapback/api/cron/{name}/run | backend.cron |
| /_snapback/api/data/{table} | operating.admin-console |
| /_snapback/api/ephemeral/cleanup | notAuthorFacing (operator maintenance) |
| /_snapback/api/ephemeral/operator/delete | notAuthorFacing (local operator repair, LLP 0184 §C) |
| /_snapback/api/errors/issue | backend.error-tracking-v1 |
| /_snapback/api/errors/issues | backend.error-tracking-v1 |
| /_snapback/api/errors/transition | backend.error-tracking-v1 |
| /_snapback/api/functions/load | backend.functions |
| /_snapback/api/functions/{name}/run | testing.acceptance |
| /_snapback/api/health | operating.inspect |
| /_snapback/api/host-ops | operating.host-ops |
| /_snapback/api/control-catalog | operating.agent-controls |
| /_snapback/api/control-catalog/instance | operating.agent-controls |
| /_snapback/api/control-catalog/operations/{operation} | operating.agent-controls |
| /_snapback/api/inspect | operating.inspect |
| /_snapback/api/jobs | backend.jobs-one-off |
| /_snapback/api/jobs/drain | backend.jobs-one-off |
| /_snapback/api/jobs/{id} | backend.jobs-one-off |
| /_snapback/api/operations/explain | notAuthorFacing (unpublished LLP 0163 acceptance substrate) |
| /_snapback/api/push/maintenance | backend.expo-push-seam |
| /_snapback/api/receipts | notAuthorFacing (operator projection) |
| /_snapback/api/schema/load | backend.schema |
| /_snapback/api/storage/operation-coverage/activate | notAuthorFacing (unpublished LLP 0163 coverage-publication substrate) |
| /_snapback/api/storage/protected-erasure | notAuthorFacing (unpublished LLP 0165 protected-erasure acceptance substrate) |
| /_snapback/api/telemetry/events | backend.observability-v1 |
| /_snapback/api/telemetry/export | backend.observability-v1 |
| /_snapback/api/telemetry/stats | backend.observability-v1 |
| /action/{name} | backend.actions |
| /app-api/current | clients.app-cli |
| /app-api/envelope/{sha256} | clients.app-cli |
| /app/bundle | realtime.snapshot-bundles |
| /app/ensure | backend.provisioning |
| /app-api/current | clients.app-cli |
| /app-api/envelope/{sha256} | clients.app-cli |
| /assets/attempts | backend.assets |
| /assets/attempts/{id} | backend.assets |
| /assets/attempts/{id}/cancel | backend.assets |
| /assets/attempts/{id}/finalize | backend.assets |
| /assets/public/{id}/{variant} | backend.assets |
| /assets/records/{id} | backend.assets |
| /assets/records/{id}/bytes/{variant} | backend.assets |
| /assets/records/{id}/signed-url | backend.assets |
| /assets/signed/{id}/{variant} | backend.assets |
| /assets/tus/{id} | backend.assets |
| /auth/agents/pair | auth.agent-principals |
| /auth/agents/revoke-self | auth.agent-principals |
| /auth/agents/rotate | auth.agent-principals |
| /auth/agents/token | auth.agent-principals |
| /auth/agents/token/release | auth.agent-principals |
| /auth/exchange | auth.sessions |
| /auth/family-alarm | auth.sessions |
| /auth/grant-requests | auth.agent-principals |
| /auth/grant-requests/{id}/approve | auth.agent-principals |
| /auth/grant-requests/{id}/deny | auth.agent-principals |
| /auth/grants | auth.agent-principals |
| /auth/grants/by-actor/{actor_id} | auth.agent-principals |
| /auth/grants/{id} | auth.agent-principals |
| /auth/logout | auth.sessions |
| /auth/pairing-codes | auth.agent-principals |
| /auth/refresh | auth.sessions |
| /auth/request-code | auth.sessions |
| /auth/session | auth.sessions |
| /auth/step-up/request | auth.sessions |
| /client-mutations/acknowledge | sync.offline |
| /client-mutations/identity-range | sync.offline |
| /connection/open | realtime.durable-push |
| /ephemeral/collections/ensure | realtime.ephemeral |
| /ephemeral/delete | realtime.ephemeral |
| /ephemeral/publish | realtime.ephemeral |
| /ephemeral/subscribe | realtime.ephemeral |
| /health | operating.inspect |
| /inspect | operating.inspect |
| /live/authorization-invalidation/acknowledge | auth.invalidation-barrier |
| /live/authorization-invalidation/manual-retry | auth.invalidation-barrier |
| /live/{connection_id}/stream | realtime.durable-push |
| /live/{name}/resume | realtime.live-queries |
| /live/{name}/subscribe | realtime.live-queries |
| /live/{name}/unsubscribe | realtime.live-queries |
| /mutation/{name} | backend.functions |
| /operations/explain | notAuthorFacing (unpublished LLP 0163 acceptance substrate) |
| /outbox/{connection_id} | sync.offline |
| /query/{name} | backend.functions |
| /query/{name}/authorized-lease | auth.authorized-leases |
| /push/tokens/register | backend.expo-push-seam |
| /push/tokens/unregister | backend.expo-push-seam |

## Host operations (LLP 0024 operation registry)

| Operation | Capability |
| --- | --- |
| host_ops.app.inspect | operating.host-ops |
| host_ops.app.reset | operating.host-ops |
| host_ops.asset.put | backend.assets |
| host_ops.asset.ensureSeedFixture | backend.assets |
| host_ops.asset.inspect | backend.assets |
| host_ops.asset.list | backend.assets |
| host_ops.asset.retry | backend.assets |
| host_ops.asset.gcSweep | notAuthorFacing (operator deterministic garbage collection) |
| host_ops.asset.delete | backend.assets |
| host_ops.asset.rotateSigningKey | notAuthorFacing (operator key rotation) |
| host_ops.asset.exportCut | notAuthorFacing (operator consistent-cut export) |
| host_ops.asset.importCut | notAuthorFacing (operator consistent-cut restore) |
| host_ops.auth.mintSession | operating.host-ops |
| host_ops.auth.rescueCollidingTable | operating.host-ops |
| host_ops.data.patch.preview | operating.data-patch |
| host_ops.data.patch.preview.impersonated | operating.data-patch |
| host_ops.data.patch.apply | operating.data-patch |
| host_ops.data.patch.apply.impersonated | operating.data-patch |
| host_ops.errors.issue | backend.error-tracking-v1 |
| host_ops.errors.issues | backend.error-tracking-v1 |
| host_ops.errors.transition | backend.error-tracking-v1 |
| host_ops.function.explain | operating.host-ops |
| host_ops.function.explain.impersonated | operating.host-ops |
| host_ops.function.run.query | operating.host-ops |
| host_ops.function.run.mutation | operating.host-ops |
| host_ops.function.run.action | operating.host-ops |
| host_ops.function.run.unknown | operating.host-ops |
| host_ops.function.run.impersonated | operating.host-ops |
| host_ops.functions.load | operating.host-ops |
| host_ops.schema.load | operating.host-ops |
| host_ops.schema.reload | operating.host-ops |
| host_ops.functions.reload | operating.host-ops |
| host_ops.acceptance.run | operating.host-ops |
| host_ops.debug.networkProfileGet | operating.network-profiles |
| host_ops.debug.networkProfileSet | operating.network-profiles |
| host_ops.host.start | operating.host-ops |
| host_ops.host.stop | operating.host-ops |
| host_ops.host.restart | operating.host-ops |
| host_ops.telemetry.events | backend.observability-v1 |
| host_ops.telemetry.export | backend.observability-v1 |
| host_ops.telemetry.stats | backend.observability-v1 |
