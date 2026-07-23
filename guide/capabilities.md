---
title: Capability index
id: meta.capabilities
order: 2
audience: agent-first
capabilities: []
authorities: [llp/0041-packaged-dev-loop.rfc.md, llp/0061-agent-first-snapback-guide.rfc.md, llp/0064-native-client-surfaces.rfc.md, src/server.rs, src/admin.rs, packages/snapback-cli/index.mjs, packages/snapback-client/external-store.mjs, packages/snapback-react/index.mjs]
examples: []
status: current
targets: [all]
maturity: shipped
reviewed: 2026-07-20
reviewed-commit: 7d686f7d4ce4f606e3f9a00aeb1ea50d211ac1a7
---

# Capability index

<!-- @ref LLP 0061#2-the-capability-index-registry-lite-with-witnesses — witnesses, GAP rows, and the joined surfaces -->

Every author-facing capability Snapback has, whether or not the guide
covers it yet. **GAP** rows are capabilities with no page — explicit, owned,
and dated, never silent. Shipped rows carry a code **witness** proving the
capability exists. The surface map below classifies every entry of the two
machine-enumerable registries (server routes, host-ops); `scripts/check-guide.mjs`
joins it against the code on every run, so a shipped surface cannot fall out
of this file unnoticed.

Guide owner: `ccheever`. File gaps as Linear issues in the Exact project
with the Snapback label and `guide-gap` in the title.

## Capabilities

| id | What | Aliases | Targets | Maturity | Witness | Authorities | Page |
| --- | --- | --- | --- | --- | --- | --- | --- |
| backend.schema | Declare tables, fields, indexes, sync | schema, tables, model | local | shipped | `defineSchema` in packages/snapback-codegen/define.mjs | llp/0037, llp/0004 | getting-started/your-first-backend.md |
| backend.functions | Queries, mutations; declarative plans and JS handlers | query, mutation, endpoint, api | local | shipped | `defineQuery` in packages/snapback-codegen/define.mjs | llp/0004 | getting-started/your-first-backend.md |
| backend.standard-patterns | Generate owner-scoped CRUD, unique lookup, and keyset pages with trusted defaults | CRUD generator, pagination, runtime time, runtime id | local | partial | `defineOwnedCrud` in packages/snapback-codegen/standard-patterns.mjs | llp/0051, llp/0065 | backend/standard-patterns.md |
| backend.seed | Deterministic declarative seed + reset | seed, fixtures, sample data | local | shipped | route /_snapback/api/app/reset | llp/0004 | getting-started/your-first-backend.md |
| backend.provisioning | Idempotent app provisioning (ensureApp) | ensure, deploy app, load app | local | shipped | route /app/ensure | llp/0034 | getting-started/your-first-backend.md |
| backend.codegen | Generate manifests, client api, Contract bindings | codegen, generate, artifacts | local | shipped | `runCodegenCli` in packages/snapback-codegen/index.mjs | llp/0037, llp/0021 | getting-started/your-first-backend.md |
| backend.query-semantics | Read sets, snapshots, commit versions, conflict validation | consistency, transactions, conflicts | local | shipped | route /query/{name} | llp/0003, llp/0004, llp/0007 | backend/queries.md |
| backend.actions | Actions with gated outbound fetch | action, fetch, side effects | local | shipped | route /action/{name} | llp/0004, llp/0009 | backend/actions-and-fetch.md |
| backend.cron | Scheduled execution | cron, schedule, background jobs | local | shipped | route /_snapback/api/cron/tick | llp/0028 | backend/cron.md |
| realtime.live-queries | Subscribe to a query; snapshot + replace/delta updates | live, subscription, realtime | local | shipped | route /live/{name}/subscribe | llp/0008 | realtime/live-queries.md |
| realtime.durable-push | Durable WebSocket push lane; connection axis | websocket, stream, push, connection state | local | shipped | route /live/{connection_id}/stream | llp/0008, llp/0034 | realtime/live-queries.md |
| realtime.ephemeral | Typed ephemeral rooms: presence, cursors, TTL | presence, cursors, rooms, ephemeral | local | shipped | route /ephemeral/publish | llp/0013 | realtime/ephemeral-state.md |
| sync.offline | Retained queries, outbox, replay, optimistic overlays | offline, sync, local-first, outbox | local | shipped | route /outbox/{connection_id} | llp/0043, llp/0052 | sync/offline-and-retention.md |
| auth.sessions | Server-minted sessions; email-code login; server-derived principals | login, signin, identity, session | local | shipped | route /auth/exchange | llp/0039, llp/0057, llp/0059 | auth/sessions-and-principals.md |
| auth.scoped-queries | Per-principal query scoping via authScopeField | hidden data, per-user, row security | local | shipped | `authScopeField` in packages/snapback-codegen/define.mjs | llp/0039, llp/0053 | auth/sessions-and-principals.md |
| auth.invalidation-barrier | Authorization invalidation; logout blanking | logout, revoke, invalidation | local | shipped | route /live/authorization-invalidation/acknowledge | llp/0053 | auth/protecting-data.md |
| auth.authorized-leases | Lease-bounded offline retention of authorized reads | offline auth, lease, retained | local | shipped | route /query/{name}/authorized-lease | llp/0059 | auth/protecting-data.md |
| auth.target-honesty | Per-target auth claims and non-claims; readiness reporting | hosted auth, production auth | all | shipped | `AuthProgramReadiness` in src/auth/mode.rs | llp/0060 | auth/targets.md |
| auth.agent-principals | Agent principals and scoped grants | agent auth, grants, pairing | local | shipped | route /auth/agents/pair | llp/0055 | auth/agent-principals.md |
| auth.scoped-roles | Scoped roles and memberships | roles, permissions, membership | local | shipped | `membership(spec)` in packages/snapback-codegen/define.mjs | llp/0056 | auth/scoped-roles.md |
| clients.headless | The framework-neutral client (SnapbackClient) | http client, node client, sdk | local | shipped | `SnapbackClient` in packages/snapback-client/index.mjs | llp/0012 | clients/headless.md |
| clients.external-store | Framework-neutral current-value/subscription store, keyed sibling sharing, lifecycle scope | external store, lifecycle, vanilla, strict mode | local | shipped | `createExternalQueryStoreRegistry` in packages/snapback-client/external-store.mjs | llp/0012, llp/0064 | clients/headless.md |
| clients.app-cli | Artifact-driven application CLI and packaged agent journey | app cli, agent cli, introspect | local | partial | `snapback-app` in packages/snapback-app-cli/cli.mjs | llp/0062 | clients/app-cli.md |
| clients.contract | Contract/Exact adapter; generated bindings; surface boot | contract, exact, ui bindings | local | shipped | `createSnapbackContractSurface` in packages/snapback-contract/index.mjs | llp/0005, llp/0034 | clients/contract-adapter.md |
| clients.contract-provider-generation | Provider-neutral Contract manifest, bindings, metadata, types, fixtures, and docs from a provider declaration | provider declaration, contract sidecar generator, convex bindings | local | shipped | `generateFromDeclaration` in demos/partiful-matrix/scripts/generate-contract-provider.mjs | llp/0063 | clients/contract-adapter.md |
| clients.contract-keyed-scopes | Binding-time keyed Contract queries with dedup, refcounts, and authority fencing | dynamic query, query args, dedup, selection | local | shipped | `createKeyedSnapbackContractProvider` in packages/snapback-contract/keyed-provider.mjs | llp/0034, llp/0063 | clients/contract-adapter.md |
| clients.mutation-outcomes | Raw provider settlement facts plus Exact three-fact mutation projection | mutation state, timeout, retry, receipt, ambiguity | local | shipped | `partitime.step1-mutation-projection.v1` in demos/partiful-matrix/tests/acceptance/step1-mutation-projection.mjs | llp/0043, llp/0063 | clients/contract-adapter.md |
| clients.optimistic-overlays | Derived optimistic mutations + reconciliation | optimistic, overlays, latency | local | shipped | `deriveOptimisticReducer` in packages/snapback-contract/index.mjs | llp/0052 | clients/contract-adapter.md |
| clients.react | First-class React external-store hook over generated functions | react, hooks, useSyncExternalStore | local | shipped | `useSnapbackQuery` in packages/snapback-react/index.mjs | llp/0012, llp/0063 | clients/react.md |
| clients.react-expo | React Expo Online surface; independent Android and iOS implementation evidence | react native, expo, android, ios, mobile | local | shipped | `profileId` in demos/partiful-matrix/tests/acceptance/native-react-expo.mjs | llp/0012, llp/0064 | clients/react-expo.md |
| operating.server-lifecycle | Start/reuse/stop servers safely; ports; provenance | run server, ports, lifecycle | local | shipped | `startServer` in demos/_kit/server-process.mjs | llp/0010 | testing/acceptance.md |
| operating.packaged-dev-loop | Install a native runtime; scaffold, generate, doctor, and watch/load through one CLI | install, new app, dev, watch, packaged runtime | local | partial | `runDev` in packages/snapback-cli/index.mjs | llp/0041 | getting-started/the-authoring-loop.md |
| operating.inspect | Health and inspect projections | inspect, status, debug | local | shipped | route /inspect | llp/0017, llp/0031 | getting-started/the-authoring-loop.md |
| operating.secrets-config | App secrets/config: declare, set, verify — write-only | secrets, config, api keys | local | shipped | route /_snapback/api/config/status | llp/0036 | operating/secrets-and-config.md |
| operating.admin-console | Browser inspection surface | admin, console, dashboard | local | shipped | route /_snapback/admin | llp/0017 | operating/admin-console.md |
| operating.host-ops | Host operations over CLI/HTTP | cli, ops, host operations | local | shipped | route /_snapback/api/host-ops | llp/0024 | operating/host-ops.md |
| operating.diagnostics | Stable SNAPBACK_* codes; doctor tooling | diagnostics, errors, doctor | all | shipped | scripts/ibex-doctor | llp/0010 | operating/diagnostics.md |
| operating.served-guide | Server embeds and serves this guide (pages + flat.md, hash-bound) | docs endpoint, llms.txt, served docs | all | shipped | route /_snapback/guide/flat.md | llp/0061 | index.md |
| operating.guide-mcp | Read-only MCP resources for the build-bound guide corpus | mcp docs, guide resources | all | shipped | `run_stdio` in src/guide_mcp.rs | llp/0061 | index.md |
| testing.acceptance | Headless-first acceptance harness | tests, acceptance, harness | local | shipped | `createSuite` in demos/_kit/harness.mjs | llp/0010, llp/0012 | testing/acceptance.md |
| deploy.cloudflare | The hosted Cloudflare target, as far as it is real | deploy, hosting, production | cloudflare | partial | cloudflare/test/local-suite.mjs | llp/0014, llp/0040, llp/0049 | deploying/cloudflare.md |

Cross-repo seam: Contract/Exact *authoring* (language, components, styling,
motion, routing, Acto verification) is the **Exact guide**'s corpus —
`repo(exact):guide/index.md`. The seam is reciprocal: Exact's
`data.snapback` external-authority row points back to this guide (LLP 0061
§Relationship).

## Surface map

Every entry of the machine-enumerable registries, classified. The checker
extracts both enumerations from the code and fails if any entry is missing
here (or listed here but gone from the code).

### Server routes (LLP 0031 declared registry)

| Route path | Capability |
| --- | --- |
| / | operating.inspect |
| /_snapback/admin | operating.admin-console |
| /_snapback/admin/ | operating.admin-console |
| /_snapback/admin/setup | operating.secrets-config |
| /_snapback/admin/{*path} | operating.admin-console |
| /_snapback/guide | operating.served-guide |
| /_snapback/guide/flat.md | operating.served-guide |
| /_snapback/guide/{*path} | operating.served-guide |
| /_snapback/api/admin-secret-read/mint | notAuthorFacing (operator data-read lease, LLP 0058) |
| /_snapback/api/app/reset | backend.seed |
| /_snapback/api/auth/mailbox | auth.sessions |
| /_snapback/api/client-mutations/purge | notAuthorFacing (operator settlement maintenance) |
| /_snapback/api/config/plan | operating.secrets-config |
| /_snapback/api/config/set | operating.secrets-config |
| /_snapback/api/config/status | operating.secrets-config |
| /_snapback/api/config/unset | operating.secrets-config |
| /_snapback/api/config/verify | operating.secrets-config |
| /_snapback/api/connections/{connection_id}/disconnect | notAuthorFacing (admin-gated connection teardown) |
| /_snapback/api/console/credential | operating.admin-console |
| /_snapback/api/cron/tick | backend.cron |
| /_snapback/api/cron/{name}/run | backend.cron |
| /_snapback/api/data/{table} | operating.admin-console |
| /_snapback/api/ephemeral/cleanup | notAuthorFacing (operator maintenance) |
| /_snapback/api/functions/load | backend.functions |
| /_snapback/api/functions/{name}/run | testing.acceptance |
| /_snapback/api/health | operating.inspect |
| /_snapback/api/host-ops | operating.host-ops |
| /_snapback/api/inspect | operating.inspect |
| /_snapback/api/receipts | notAuthorFacing (operator projection) |
| /_snapback/api/schema/load | backend.schema |
| /action/{name} | backend.actions |
| /app/ensure | backend.provisioning |
| /auth/agents/pair | auth.agent-principals |
| /auth/agents/revoke-self | auth.agent-principals |
| /auth/agents/rotate | auth.agent-principals |
| /auth/agents/token | auth.agent-principals |
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
| /outbox/{connection_id} | sync.offline |
| /query/{name} | backend.functions |
| /query/{name}/authorized-lease | auth.authorized-leases |

### Host operations (LLP 0024 operation registry)

| Operation | Capability |
| --- | --- |
| host_ops.app.inspect | operating.host-ops |
| host_ops.app.reset | operating.host-ops |
| host_ops.auth.mintSession | operating.host-ops |
| host_ops.auth.rescueCollidingTable | operating.host-ops |
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
| host_ops.host.start | operating.host-ops |
| host_ops.host.stop | operating.host-ops |
| host_ops.host.restart | operating.host-ops |
