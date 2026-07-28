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
reviewed: 2026-07-27
reviewed-commit: 8399da34f8bdebb2776395ee5751b57c2bd2e71f
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
| backend.functions | Queries, live queries, mutations, and actions; declarative plans or self-contained colocated JS handlers; explicit document/record/value result contracts with generated exact references and runtime egress validation | query, mutation, endpoint, api, inline handler, result contract, results.documents, results.records | local | shipped | `results` in packages/snapback-codegen/define.mjs | llp/0004, llp/0009, llp/0101 | backend/queries.md |
| backend.runtime-values | Derive deterministic per-invocation time and fresh identifiers inside JavaScript handlers | server time, server clock, timestamp, generated id, UUID, Date.now, Math.random | local | shipped | `runtime.now` in packages/snapback-harness/ctx-bootstrap.js | llp/0051, llp/0065 | backend/trusted-runtime-values.md |
| backend.standard-patterns | Generate owner-scoped CRUD, unique lookup, and keyset pages with trusted defaults | CRUD generator, pagination, trusted defaults | local | partial | `defineOwnedCrud` in packages/snapback-codegen/standard-patterns.mjs | llp/0051, llp/0065 | backend/standard-patterns.md |
| backend.relational-queries | Bounded two-source equi-joins with explicit visibility, closed projections, and transactionally maintained projection tables (`defineRelationalQuery`, `defineMaintainedProjection`, stable capability since 2026-07-26) | joins, relational queries, denormalized reads, materialized views | local | partial | `defineRelationalQuery` in packages/snapback-codegen/define.mjs | llp/0080, llp/0065 | backend/relational-queries.md |
| backend.bounded-children-v1 | Experimental one-visible-parent/one-index-bounded-child-page profile with protected relation incarnations and `sbbc1` AEAD keysets; the exact local source target advertises it only through the embedded atomic relation/activity carrier and requiring artifacts must acknowledge it | one-to-many, parent children, relation incarnation, bounded child page | local | partial | src/local-relation-activity-publication.v1.json | llp/0104, llp/0108, llp/0101 | GAP (signed public-package attestation and hosted publication; owner: Charlie, review: 2026-08-31) |
| backend.write-activity-v1 | Experimental closed source-write plus one provenance-bearing activity insert with exact source-effect assertion and LLP 0043/0101 settlement; the exact local source target advertises it only through the embedded atomic relation/activity carrier and requiring artifacts must acknowledge it | audit log, activity feed, transactional activity, write receipt | local | partial | tests/conformance/relation-activity-publication-v1.receipt.json | llp/0104, llp/0108, llp/0043, llp/0101 | GAP (signed public-package attestation and hosted publication; owner: Charlie, review: 2026-08-31) |
| backend.text-search | Portable indexed term, phrase, prefix, exclusion, and equality-filter search with deterministic integer ranking, bounded highlights, public/owner visibility partitions, and AEAD current-keyset cursors | search, full text, text index, phrase, prefix, highlights | local | shipped | `defineSearchQuery` in packages/snapback-codegen/define.mjs | llp/0073, llp/0065 | backend/text-search.md |
| backend.streamed-actions | Bounded pull-driven response streaming in actions: `ctx.fetchStream`, `ctx.streamAttempt` lease/settlement, durable progress via mutations | streaming, fetchStream, ReadableStream, AI tokens, SSE bytes | local | partial | `open_response_stream` in src/server.rs | llp/0076, llp/0075 | backend/streamed-actions.md |
| backend.seed | Deterministic declarative seed + reset | seed, fixtures, sample data | local | shipped | route /_snapback/api/app/reset | llp/0004 | getting-started/your-first-backend.md |
| backend.versioned-seed | Experimental local stream-scoped seed identity, pure matched observation, idempotent install/reset receipts, read-only preview, and explicit clear without legacy fallback. Hosted compiled-seed custody remains a GAP. | seed version, seed identity, reset-install, fixture drift | local | partial | tests/conformance/versioned-seed-v1.manifest.json | llp/0103 | backend/versioned-seeds.md |
| backend.provisioning | Idempotent app provisioning (ensureApp) | ensure, deploy app, load app | local | shipped | route /app/ensure | llp/0034 | getting-started/your-first-backend.md |
| backend.codegen | Generate a digest-verified review manifest, input-hash cache, client API, and Contract bindings with deterministic human/JSON summaries | codegen, generate, artifacts, cache, custody, review manifest | all | shipped | `createReviewManifest` in packages/snapback-codegen/review-surface.mjs | llp/0010, llp/0012, llp/0037, llp/0041 | getting-started/generated-artifacts.md |
| backend.query-semantics | Read sets, snapshots, commit versions, conflict validation | consistency, transactions, conflicts | local | shipped | route /query/{name} | llp/0003, llp/0004, llp/0007 | backend/queries.md |
| backend.actions | Actions with gated outbound fetch | action, fetch, side effects | local | shipped | route /action/{name} | llp/0004, llp/0009 | backend/actions-and-fetch.md |
| backend.action-streams | Pull-driven bounded response streams with durable progress and precise settlement | stream, ReadableStream, tokens, progress | local | shipped | `ctx.fetchStream` in packages/snapback-harness/ctx-bootstrap.js | llp/0076 | backend/actions-and-fetch.md |
| backend.cron | Scheduled execution | cron, schedule, background jobs | local | shipped | route /_snapback/api/cron/tick | llp/0028 | backend/cron.md |
| realtime.live-queries | Subscribe to a query; snapshot + replace/delta updates | live, subscription, realtime | local | shipped | route /live/{name}/subscribe | llp/0008 | realtime/live-queries.md |
| realtime.durable-push | Durable WebSocket push lane; connection axis | websocket, stream, push, connection state | local | shipped | route /live/{connection_id}/stream | llp/0008, llp/0034 | realtime/live-queries.md |
| realtime.ephemeral | Typed ephemeral rooms: presence, cursors, TTL | presence, cursors, rooms, ephemeral | local | shipped | route /ephemeral/publish | llp/0013 | realtime/ephemeral-state.md |
| realtime.snapshot-bundles | Resumable-query snapshot bundles: one request evaluates a served route-manifest entry's queries at one commit with per-query resume tokens; register mode arms the pending-registration owner; `defineRoutes` + `publicInline` feed the Channel A inlined web boot (`snapbackChannelA` in packages/snapback-vite) with anonymous reads for publicInline-class routes; on the Cloudflare arm the routes manifest compiles into the Worker, the gateway serves Channel A HTML, and the coordinator answers read-mode bundles + token resume (register mode Cloudflare: deferred) | bundle, preload, resumable snapshots, boot, RQS, inlined HTML, routes manifest | local, cloudflare | partial | route /app/bundle | llp/0090, llp/0092 | GAP (owner: Charlie, review: 2026-08-31) |
| sync.offline | Retained queries, outbox, replay, optimistic overlays | offline, sync, local-first, outbox | local | shipped | route /outbox/{connection_id} | llp/0043, llp/0052 | sync/offline-and-retention.md |
| auth.sessions | Server-minted sessions; email-code login; server-derived principals | login, signin, identity, session | local | shipped | route /auth/exchange | llp/0039, llp/0057, llp/0059 | auth/sessions-and-principals.md |
| auth.external-identity-broker | Adopt a session minted by a trusted server-side identity broker; dev/test/demo host operation only | native login, external identity, broker, adopted bearer | local | partial | `createExternalSessionClient` in packages/snapback-client/index.mjs | llp/0024, llp/0057, llp/0096 | auth/native-apps.md |
| auth.scoped-queries | Per-principal query scoping via authScopeField | hidden data, per-user, row security | local | shipped | `authScopeField` in packages/snapback-codegen/define.mjs | llp/0039, llp/0053 | auth/sessions-and-principals.md |
| auth.invalidation-barrier | Authorization invalidation; logout blanking | logout, revoke, invalidation | local | shipped | route /live/authorization-invalidation/acknowledge | llp/0053 | auth/protecting-data.md |
| auth.authorized-leases | Lease-bounded offline retention of authorized reads | offline auth, lease, retained | local | shipped | route /query/{name}/authorized-lease | llp/0059 | auth/protecting-data.md |
| auth.target-honesty | Per-target auth claims and non-claims; readiness reporting | hosted auth, production auth | all | shipped | `AuthProgramReadiness` in src/auth/mode.rs | llp/0060 | auth/targets.md |
| auth.sender-constrained-browser | Hosted-only non-extractable browser custody, HTTP/WebSocket sender proofs, nonce rotation, and replay refusal; no current adapter has positive admission | DPoP, browser key, credential theft, hosted sessions | single-instance-container-vm | partial | `HostedBrowserSnapbackClient` in packages/snapback-client/hosted-browser.mjs | llp/0077, llp/0060 | auth/targets.md |
| auth.agent-principals | Agent principals and scoped grants | agent auth, grants, pairing | local | shipped | route /auth/agents/pair | llp/0055 | auth/agent-principals.md |
| auth.scoped-roles | Scoped roles and memberships | roles, permissions, membership | local | shipped | `membership(spec)` in packages/snapback-codegen/define.mjs | llp/0056 | auth/scoped-roles.md |
| clients.headless | The framework-neutral client (SnapbackClient) | http client, node client, sdk | local | shipped | `SnapbackClient` in packages/snapback-client/index.mjs | llp/0012 | clients/headless.md |
| clients.protocol | Versioned route/envelope/lifecycle contract and language-neutral conformance corpus | wire protocol, native client, conformance, snapback.v1 | local | shipped | `ClientStateMachine` in clients/swift/SnapbackClient/Sources/SnapbackClient/StateMachine.swift | llp/0093, llp/0094, llp/0095, llp/0096 | protocol/client-protocol.md |
| clients.swift | SwiftPM protocol client for iOS/macOS; poll/local and live/local with session auth | swift, swiftui, ios, macos | local | partial | `SnapbackClient` in clients/swift/SnapbackClient/Sources/SnapbackClient/SnapbackClient.swift | llp/0064, llp/0093 | clients/swift.md |
| clients.non-js | Published and maintained non-JS clients beyond Swift (Kotlin and Dart) | kotlin, compose, dart, flutter | local | partial | llp/0093-client-protocol-and-native-clients.rfc.md | llp/0093, llp/0064 | GAP (owner: Charlie, review: 2026-08-31) |
| clients.poll-hosted | Socketless hosted demand ownership and poll delivery | hosted polling, poll hosted | cloudflare | partial | cloudflare/src/coordinator.js | llp/0093, llp/0095 | GAP (owner: Charlie, review: 2026-08-31) |
| clients.external-store | Framework-neutral current-value/subscription store, keyed sibling sharing, lifecycle scope | external store, lifecycle, vanilla, strict mode | local | shipped | `createExternalQueryStoreRegistry` in packages/snapback-client/external-store.mjs | llp/0012, llp/0064 | clients/headless.md |
| clients.framework-bindings | Binding contract and shipped React/Contract projections; Vue/Svelte/Solid packages remain unclaimed | vue, svelte, solid, framework adapter | local | partial | `SNAPBACK_EXTERNAL_STORE_PROTOCOL` in packages/snapback-client/external-store.mjs | llp/0012, llp/0034, llp/0064 | clients/framework-bindings.md |
| clients.app-cli | Artifact-driven application CLI and packaged agent journey | app cli, agent cli, introspect | local | partial | `snapback-app` in packages/snapback-app-cli/cli.mjs | llp/0062 | clients/app-cli.md |
| clients.contract | Contract/Exact adapter; generated bindings; surface boot | contract, exact, ui bindings | local | shipped | `createSnapbackContractSurface` in packages/snapback-contract/index.mjs | llp/0005, llp/0034 | clients/contract-adapter.md |
| clients.contract-provider-generation | Provider-neutral Contract manifest, bindings, metadata, types, fixtures, and docs from a provider declaration | provider declaration, contract sidecar generator, convex bindings | local | shipped | `generateFromDeclaration` in demos/partiful-matrix/scripts/generate-contract-provider.mjs | llp/0063 | clients/contract-adapter.md |
| clients.contract-keyed-scopes | Binding-time keyed Contract queries with dedup, refcounts, and authority fencing | dynamic query, query args, dedup, selection | local | shipped | `createKeyedSnapbackContractProvider` in packages/snapback-contract/keyed-provider.mjs | llp/0034, llp/0063 | clients/contract-adapter.md |
| clients.mutation-outcomes | Raw provider settlement facts plus Exact three-fact mutation projection | mutation state, timeout, retry, receipt, ambiguity | local | shipped | `partitime.step1-mutation-projection.v1` in demos/partiful-matrix/tests/acceptance/step1-mutation-projection.mjs | llp/0043, llp/0063 | clients/contract-adapter.md |
| clients.optimistic-overlays | Derived optimistic mutations + reconciliation | optimistic, overlays, latency | local | shipped | `deriveOptimisticReducer` in packages/snapback-contract/index.mjs | llp/0052 | clients/contract-adapter.md |
| clients.react | Prepared React provider over one headless store/transport seam: exact generated single/grouped live queries, capability-gated route-group references with one-commit register-mode adoption, explicit live fallback, attach-deadline recovery, sessions authorization adoption, result-validated optimistic mutation rebase/rollback, local managed connection-keyed presence, aggregate connection state, Strict Mode/HMR sharing, complete cleanup, and retained Signal Desk receipts | react, hooks, useSyncExternalStore, result inference, typed mutation, optimistic rollback, presence, query groups, bundle prime, registered bundle, hmr | local | shipped | `useSnapbackQueries` in packages/snapback-react/index.d.mts | llp/0012, llp/0064, llp/0074, llp/0090, llp/0101, llp/0102, llp/0106, llp/0107 | clients/react.md |
| clients.react-expo | React Expo Online surface; independent Android and iOS implementation evidence | react native, expo, android, ios, mobile | local | shipped | `profileId` in demos/partiful-matrix/tests/acceptance/native-react-expo.mjs | llp/0012, llp/0064 | clients/react-expo.md |
| operating.server-lifecycle | Start/reuse/stop servers safely; ports; provenance; crash detection | run server, ports, bindPortExactly, lifecycle, watchdog, crash, prebuilt binary, seed reset | local | shipped | `startServer` in demos/_kit/server-process.mjs | llp/0010, llp/0030 | testing/acceptance.md |
| operating.packaged-dev-loop | Install a native runtime; scaffold, generate, doctor, and watch/load through one CLI. The current packed React/Vite starter and inferred sessions startup pass locally, but the expanded React closure is not yet the byte-verified public `0.1.0` closure. | install, new app, react starter, vite, dev, one command, watch, sessions startup, packaged runtime | local | partial | `runDev` in packages/snapback-cli/index.mjs | llp/0041, llp/0058, llp/0102, llp/0103 | getting-started/the-authoring-loop.md |
| operating.inspect | Health and inspect projections | inspect, status, debug | local | shipped | route /inspect | llp/0017, llp/0031 | getting-started/the-authoring-loop.md |
| operating.secrets-config | App secrets/config: declare, set, verify — write-only | secrets, config, api keys | local | shipped | route /_snapback/api/config/status | llp/0036 | operating/secrets-and-config.md |
| operating.admin-console | Browser inspection surface | admin, console, dashboard | local | shipped | route /_snapback/admin | llp/0017 | operating/admin-console.md |
| operating.host-ops | Host operations over CLI/HTTP | cli, ops, host operations | local | shipped | route /_snapback/api/host-ops | llp/0024 | operating/host-ops.md |
| operating.diagnostics | Stable SNAPBACK_* codes; exact current-checkout link/launch diagnosis with one binary-selection recovery record; installed disposable vertical-slice doctor | diagnostics, errors, doctor, linker, missing symbols, stale binary, runtime recovery | all | shipped | `runRuntimeLinkProbe` in scripts/runtime-link-smoke.mjs | llp/0010, llp/0031, llp/0041, llp/0074 | operating/diagnostics.md |
| operating.served-guide | Server embeds and serves this guide (pages + flat.md, hash-bound) | docs endpoint, llms.txt, served docs | all | shipped | route /_snapback/guide/flat.md | llp/0061 | index.md |
| operating.guide-mcp | Read-only MCP resources for the build-bound guide corpus | mcp docs, guide resources | all | shipped | `run_stdio` in src/guide_mcp.rs | llp/0061 | index.md |
| testing.acceptance | Headless-first acceptance harness and package-owned backend comparator profile | tests, acceptance, harness, comparator, backend bake-off, native push receipt | local | shipped | `runComparatorAcceptance` in packages/snapback-cli/comparator-profile.mjs | llp/0010, llp/0012, llp/0013, llp/0034 | testing/acceptance.md |
| deploy.release-build | Target-neutral immutable release build, scan, content identity, and read-back verification | deploy build, release artifact, dirty preview, release digest | all | partial | `buildRelease` in packages/snapback-cli/index.mjs | llp/0072 | deploying/releases.md |
| deploy.target-control | Descriptor-first no-follow/single-link authority I/O; owner-only target registration; a content-addressed provider/storage/TLS/supervisor/log/credential/cost drill plan before provisioning; digest-pinned inspection; content-addressed deploy/backup/code-only-rollback/destructive-restore planning; lease/generation-fenced apply; paused restore plus explicit activation; bounded redacted logs; authenticated inspection; read-back-verified backups; receipts; fail-closed hash-chained control audit; positive hosted-auth/qualification/prepared-release artifact producers; and a MAC-authenticated hosted-startup admission consumer/sealer/producer contract. Fly observation/lease and a separately packed sentinel-owned supervisor now have real provider evidence, including scoped credential custody and SQLite → immutable Tigris mirror → conditional external-anchor restart recovery. The public lifecycle train, target registration/channel, online admissions, served inspection, migration/activation/rollback, and complete packed product receipt remain GAPs; no hosted capability is advertised | target add, target doctor, remote drill plan, deploy plan, deploy apply, deploy rollback, deploy status, backup create, backup list, backup verify, restore plan, restore apply, restore verify, restore activate, hosted admission, qualification, prepared release, logs, inspect, audit verify | single-instance-container-vm | partial | `applyDeployPlan` in packages/snapback-cli/deployment-control.mjs | llp/0072, llp/0105 | deploying/releases.md |
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
| /_snapback/api/app/seed/clear-v1 | backend.versioned-seed |
| /_snapback/api/app/seed/ensure-v1 | backend.versioned-seed |
| /_snapback/api/app/seed/preview-v1 | backend.versioned-seed |
| /_snapback/api/app/seed/reset-install-v1 | backend.versioned-seed |
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
| /app/bundle | realtime.snapshot-bundles |
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
