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
reviewed: 2026-08-02
reviewed-commit: 63d980b654664d2c990f454cbcb78958d87d27b8
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
| backend.functions | Queries, live queries, mutations, and actions; declarative plans or colocated JS handlers with same-file helpers; explicit document/record/value result contracts including result-side `v.doc(table)` schema references; manifest-derived handler/helper `ctx.db` types with a query-read/mutation-write split; generated exact client references and runtime egress validation | query, mutation, endpoint, api, inline handler, result contract, results.documents, results.records, v.doc, GeneratedHandler, GeneratedQueryDatabase | local | shipped | packages/snapback-codegen/define.mjs | llp/0004, llp/0009, llp/0101, llp/0108, llp/0127 | backend/queries.md |
| backend.runtime-values | Derive deterministic per-invocation time and fresh identifiers inside JavaScript handlers | server time, server clock, timestamp, generated id, UUID, Date.now, Math.random | local | shipped | `runtime.now` in packages/snapback-harness/ctx-bootstrap.js | llp/0051, llp/0065 | backend/trusted-runtime-values.md |
| backend.standard-patterns | Generate owner CRUD, unique lookup, owner/membership keyset pages | CRUD generator, pagination, membership pages, trusted defaults | local | partial | `defineOwnedCrud` in packages/snapback-codegen/standard-patterns.mjs | llp/0051, llp/0065, llp/0100 | backend/standard-patterns.md |
| backend.relational-queries | Bounded two-source equi-joins with explicit visibility, closed projections, and transactionally maintained projection tables (`defineRelationalQuery`, `defineMaintainedProjection`, stable capability since 2026-07-26) | joins, relational queries, denormalized reads, materialized views | local | partial | `defineRelationalQuery` in packages/snapback-codegen/define.mjs | llp/0080, llp/0065 | backend/relational-queries.md |
| backend.bounded-children-v1 | Experimental one-visible-parent/one-index-bounded-child-page profile with protected relation incarnations and `sbbc1` AEAD keysets; only contributor source builds with the exact embedded atomic carrier advertise it, while public runtime packages and hosted targets retain a structured GAP | one-to-many, parent children, relation incarnation, bounded child page | local | partial | src/local-relation-activity-publication.v1.json | llp/0104, llp/0108, llp/0101 | GAP (public-package attestation and hosted publication; owner: Charlie, review: 2026-08-31) |
| backend.write-activity-v1 | Experimental closed source-write plus one provenance-bearing activity insert with exact source-effect assertion and LLP 0043/0101 settlement; only contributor source builds with the exact embedded atomic carrier advertise it, while public runtime packages and hosted targets retain a structured GAP | audit log, activity feed, transactional activity, write receipt | local | partial | tests/conformance/relation-activity-publication-v1.receipt.json | llp/0104, llp/0108, llp/0043, llp/0101 | GAP (public-package attestation and hosted publication; owner: Charlie, review: 2026-08-31) |
| backend.text-search | Portable term, phrase, prefix, exclusion, and equality-filter search with deterministic ranking, bounded highlights, public/owner/membership (seat-per-resource) visibility, and AEAD keyset cursors | search, full text, text index, phrase, prefix, highlights | local | shipped | `defineSearchQuery` in packages/snapback-codegen/define.mjs | llp/0073, llp/0065, llp/0100 | backend/text-search.md |
| backend.streamed-actions | Bounded pull-driven response streaming in actions: `ctx.fetchStream`, `ctx.streamAttempt` lease/settlement, durable progress via mutations | streaming, fetchStream, ReadableStream, AI tokens, SSE bytes | local | partial | `open_response_stream` in src/server.rs | llp/0076, llp/0075 | backend/streamed-actions.md |
| backend.seed | Deterministic declarative seed + reset | seed, fixtures, sample data | local | shipped | route /_snapback/api/app/reset | llp/0004 | getting-started/your-first-backend.md |
| backend.versioned-seed | Experimental local stream-scoped seed identity, pure matched observation, idempotent install/reset receipts, read-only preview, and explicit clear without legacy fallback. Hosted compiled-seed custody remains a GAP. | seed version, seed identity, reset-install, fixture drift | local | partial | tests/conformance/versioned-seed-v1.manifest.json | llp/0103 | backend/versioned-seeds.md |
| backend.provisioning | Idempotent app provisioning (ensureApp) | ensure, deploy app, load app | local | shipped | route /app/ensure | llp/0034 | getting-started/your-first-backend.md |
| backend.codegen | Generate a digest-verified review manifest, input-hash cache, client API, and Contract bindings with deterministic human/JSON summaries | codegen, generate, artifacts, cache, custody, review manifest | all | shipped | `createReviewManifest` in packages/snapback-codegen/review-surface.mjs | llp/0010, llp/0012, llp/0037, llp/0041 | getting-started/generated-artifacts.md |
| backend.query-semantics | Read sets, snapshots, commit versions, conflict validation | consistency, transactions, conflicts | local | shipped | route /query/{name} | llp/0003, llp/0004, llp/0007 | backend/queries.md |
| backend.actions | Actions with gated outbound fetch: global `fetch` and target-portable host-mediated `ctx.fetch`, in closed-script module handlers or the inline form | action, fetch, ctx.fetch, side effects, notification, webhook | local | shipped | route /action/{name} | llp/0004, llp/0009, llp/0049 | backend/actions-and-fetch.md |
| backend.assets | Authenticated asset lifecycle plus the media pipeline on the local target — generated upload intents, TUS 1.0.0 resumable transfer, trusted SHA-256 finalization with GPS-strip canonicalization for images (decode/rewrite) and MP4/QuickTime video (in-place location-atom blanking, no transcoding), declared renditions with ThumbHash placeholders, typed `v.assetRef` attachment, private-strict/private-signed/public-immutable delivery with ranges and best-variant selection, opt-in reference GC, lifecycle callbacks, deletion/GC, receipts (`asset_lifecycle_v1`, `asset_image_finalization_v1`, `asset_image_pipeline_v1`, `asset_reference_gc_v1`, `asset_video_finalization_v1`); the paved browser path (stock `@expo/snapback-vite` relay over the `/assets/*` family, sessions custody, typed generated upload references) is CI-verified; transcoding and hosted targets remain design-only | files, images, video, upload, object storage, media, browser upload, vite relay | local | partial | schemas/capability.manifest.local-dev-sqlite-ibex.json (all five asset ids in supportedCapabilities; `assets` facts block with Enforced image and video ceilings) + src/assets.rs + src/assets_image.rs + src/assets_video.rs suites + demos/file-drop/tests/acceptance/browser-relay.mjs (relay + sessions + typed upload reference browser path) | llp/0044 | backend/assets.md |
| backend.push-token-registry-v1 | Session-bound Expo device-token registration, atomic rotation, explicit unregister, and lifecycle/idle retirement on the local target. A tested DeviceNotRegistered retirement primitive is reserved for the send slice, but no provider response can reach it yet. This is registry custody only: no send API, handoff ledger, delivery receipt, or first-class notification capability ships in this slice. | device token, expo push token, installation, token rotation, token retirement | local | partial | route /push/tokens/register | llp/0143, llp/0057, llp/0059 | GAP (authoring and operating guide; owner: Charlie, review: 2026-08-31; issue: issues/20260802-push-01-0143-implementation.md) |
| backend.notifications | First-class notification and effect delivery; application-authored table ledgers are not this product capability | notifications, push, email, delivery, effects | none | design-only | schemas/capability.manifest.local-dev-sqlite-ibex.json (`notifications: false`; explicit `notifications` gap) | llp/0045 | GAP (owner: Charlie, review: 2026-08-31; issue: issues/20260728-guide-gap-assets-and-notifications-capability-rows.md) |
| backend.observability-v1 | Built-in backend telemetry with a generation-bound sibling store, operation-class spans, bounded retention and rollups, typed agent-facing queries, and Health/Logs projections; LLP 0154 is Accepted but no implementation witness ships yet | telemetry, observability, health, logs, metrics, traces | none | design-only | llp/0154-minimal-observability.rfc.md | llp/0154 | GAP (implementation and guide page; owner: Charlie, review: 2026-08-31; issue: issues/20260802-obs-04-guide-gates-crossrefs.md) |
| backend.error-tracking-v1 | Minimal built-in backend error grouping and issue lifecycle layered on the observability substrate; LLP 0156 remains in its live refinement loop outside current main and no implementation witness ships yet | error tracking, issues, fingerprints, exceptions, failures | none | design-only | issues/20260802-obs-06-errors-surface-and-fixture-gates.md | llp/0156, llp/0154 | GAP (acceptance, implementation, and guide page; owner: Charlie, review: 2026-08-31; issue: issues/20260802-obs-06-errors-surface-and-fixture-gates.md) |
| backend.vector-search | Portable vector storage, ANN indexing, and semantic retrieval; no ordinary vector path ships today | vector, embeddings, similarity, semantic search, RAG, ANN | none | design-only | llp/0019-agentic-readiness.research.md (unmade product decision; no shipped witness) | llp/0019, llp/0007 | GAP (owner: Charlie, review: 2026-08-31; issue: issues/20260729-guide-gap-vector-semantic-search-capability-row.md) |
| backend.cron | Scheduled execution | cron, schedule, background jobs | local | shipped | route /_snapback/api/cron/tick | llp/0028 | backend/cron.md |
| backend.jobs-one-off | Experimental transactional one-off durable work (LLP 0070 first slice): `ctx.jobs.enqueue` inside the mutation transaction, a paved default queue, `availableAt = now + delay`, fenced claims with append-only attempt receipts, producer association on job rows plus bounded `enqueues` facts on confirmed mutation receipts, the generated declared job-status live query (codegen emits the capability requirement and acknowledgment), the injected-clock forced drain (`POST /_snapback/api/jobs/drain`), and the secret-read-leased admin inspection lane (`GET /_snapback/api/jobs`, `/jobs/{id}`). `jobs_one_off_v1` stays experimental and no durable-background-work capability class is claimed while LLP 0070 is Draft | one-off jobs, runAfter, scheduler, durable work, enqueue, background jobs, drain, job status, secret-read lease | local | partial | route /_snapback/api/jobs/drain | llp/0070, llp/0121, llp/0115 | backend/jobs.md |
| realtime.live-queries | Subscribe to a query; snapshot + replace/delta updates | live, subscription, realtime | local | shipped | route /live/{name}/subscribe | llp/0008 | realtime/live-queries.md |
| realtime.durable-push | Durable WebSocket push lane; connection axis | websocket, stream, push, connection state | local | shipped | route /live/{connection_id}/stream | llp/0008, llp/0034 | realtime/live-queries.md |
| realtime.ephemeral | Typed ephemeral rooms: presence, cursors, TTL | presence, cursors, rooms, ephemeral | local | shipped | route /ephemeral/publish | llp/0013 | realtime/ephemeral-state.md |
| realtime.snapshot-bundles | Resumable-query snapshot bundles: one request evaluates a served route-manifest entry's queries at one commit with per-query resume tokens; register mode arms the pending-registration owner; `defineRoutes` + `publicInline` feed the Channel A inlined web boot (`snapbackChannelA` in packages/snapback-vite) with anonymous reads for publicInline-class routes; on the Cloudflare arm the routes manifest compiles into the Worker, the gateway serves Channel A HTML, and the coordinator answers read-mode bundles + token resume (register mode Cloudflare: deferred) | bundle, preload, resumable snapshots, boot, RQS, inlined HTML, routes manifest | local, cloudflare | partial | route /app/bundle | llp/0090, llp/0092 | realtime/snapshot-bundles.md |
| sync.offline | Retained queries, outbox, replay, optimistic overlays (Contract arm: lease-bounded protected retention, derived overlays, `Parity` under LLP 0043's proof rule) | offline, sync, local-first, outbox | local | shipped | route /outbox/{connection_id} | llp/0043, llp/0052 | sync/offline-and-retention.md |
| sync.offline-js-arm | JS/React arm (LLP 0129 Phase 0): default persisted client cache selects IndexedDB in browsers **when both IndexedDB and Web Locks are available** and a durable file store in Node **when a usable state directory is available**, degrading to in-memory (non-durable) otherwise, with retained render for the rqsEligible subset — a per-query declaration opt-in (`auth: 'public'` + `authorityIndependent: true`; nothing retains until declared), durable LLP 0043 M2 outbox with client-minted mutation ids, ordered exactly-once replay on reconnect, and a relaunch-with-pending-intent that renders retained pre-intent rows with the token withheld (LLP 0090 D3 rendering note) plus `outboxStatus`/`useSnapbackOutbox` projection; protected/auth-scoped queries refuse retention with a named reason (`SNAPBACK_RETENTION_NOT_RETAINABLE` — implemented, asserted by no test on any carrier; the acceptance's refusal check covers the non-eligible *public* case only). **Acceptance reach:** the application acceptance proves the Node/durable-**file** carrier by a fresh client instance in the same process; the React freshness/retention surface is covered by `packages/snapback-react/offline.test.mjs` against a stub transport. LLP 0155's Stage 0 carrier harness now additionally proves that the shipped store's bytes survive an owned real-Chrome `SIGKILL`/relaunch over the same profile and that two tabs enforce Web Locks reader/writer refusal and takeover. It runs no React or server path, so end-to-end browser retained/current, full-resync/replay, settlement, observer convergence, and protected-refusal facts remain an explicit GAP. No local execution, so no `Parity` claim | offline browser, cold boot, restart-safe queue, IndexedDB, default persistence, retainability opt-in, pending intent render | local | partial | `resolveDefaultRqsStore` in packages/snapback-client/rqs-store-default.mjs + `demos/public-dashboard/tests/acceptance/offline-local-first.mjs` (Node/file, same-process) + `demos/zero-bakeoff/stage0/browser/run.mjs` (real-browser carrier substrate only) | llp/0043, llp/0090, llp/0129, llp/0155 | GAP (end-to-end browser product proof; owner: Charlie, review: 2026-08-31; issue: issues/20260801-guide-gap-js-arm-browser-indexeddb-proof.md); sync/offline-and-retention.md |
| sync.offline-js-arm-protected | Lease-bounded protected retention (LLP 0043 M1 custody) on the JS/React arm — the Contract arm ships it; this arm does not yet | offline auth browser, lease js | none | design-only | llp/0129-local-first-program.plan.md (Phase 0 status note; no shipped witness) | llp/0043, llp/0053, llp/0129 | GAP (owner: Charlie, review: 2026-08-31; issue: issues/20260731-js-arm-lease-custody-and-sessions-outbox.md) |
| sync.settlement-bounded-skew | `settlement.bounded_skew`: a mutation-declared, structurally direct `runtimeNow()` field may accept a lane-L captured time only within its declared bound; mixed sinks stay server-derived and lane Q remains unbounded replay-accept. The server path and receipt fact ship, while local capture/execution remains outside this slice. | bounded skew, local settlement, runtimeNow, claim ledger | local | partial | src/local.rs | llp/0133 | GAP (local capture/executor; owner: LLP 0155 Stage 2, review: 2026-08-31) |
| auth.sessions | Server-minted sessions; email-code login; server-derived principals | login, signin, identity, session | local | shipped | route /auth/exchange | llp/0039, llp/0057, llp/0059 | auth/sessions-and-principals.md |
| auth.external-identity-broker | Adopt a session minted by a trusted server-side identity broker; dev/test/demo host operation only | native login, external identity, broker, adopted bearer | local | partial | `createExternalSessionClient` in packages/snapback-client/index.mjs | llp/0024, llp/0057, llp/0096 | auth/native-apps.md |
| auth.scoped-queries | Per-principal query scoping via authScopeField | hidden data, per-user, row security | local | shipped | `authScopeField` in packages/snapback-codegen/define.mjs | llp/0039, llp/0053 | auth/sessions-and-principals.md |
| auth.invalidation-barrier | Authorization invalidation; logout blanking | logout, revoke, invalidation | local | shipped | route /live/authorization-invalidation/acknowledge | llp/0053 | auth/protecting-data.md |
| auth.authorized-leases | Lease-bounded offline retention of authorized reads | offline auth, lease, retained | local | shipped | route /query/{name}/authorized-lease | llp/0059 | auth/protecting-data.md |
| auth.target-honesty | Per-target auth claims and non-claims; readiness reporting | hosted auth, production auth | all | shipped | `AuthProgramReadiness` in src/auth/mode.rs | llp/0060 | auth/targets.md |
| auth.sender-constrained-browser | Hosted-only non-extractable browser custody, HTTP/WebSocket sender proofs, nonce rotation, and replay refusal; no current adapter has positive admission | DPoP, browser key, credential theft, hosted sessions | single-instance-container-vm | partial | `HostedBrowserSnapbackClient` in packages/snapback-client/hosted-browser.mjs | llp/0077, llp/0060 | auth/targets.md |
| auth.agent-principals | Agent principals and scoped grants | agent auth, grants, pairing | local | shipped | route /auth/agents/pair | llp/0055 | auth/agent-principals.md |
| auth.scoped-roles | Scoped roles and memberships | roles, membership, kick, removePrincipal | local | shipped | `membership(spec)` in packages/snapback-codegen/define.mjs | llp/0056, llp/0100 | auth/scoped-roles.md |
| clients.headless | The framework-neutral client (SnapbackClient) | http client, node client, sdk | local | shipped | `SnapbackClient` in packages/snapback-client/index.mjs | llp/0012 | clients/headless.md |
| clients.protocol | Versioned route/envelope/lifecycle contract and language-neutral conformance corpus | wire protocol, native client, conformance, snapback.v1 | local | shipped | `ClientStateMachine` in clients/swift/SnapbackClient/Sources/SnapbackClient/StateMachine.swift | llp/0093, llp/0094, llp/0095, llp/0096 | protocol/client-protocol.md |
| clients.swift | SwiftPM protocol client for iOS/macOS; poll/local and live/local with session auth | swift, swiftui, ios, macos | local | partial | `SnapbackClient` in clients/swift/SnapbackClient/Sources/SnapbackClient/SnapbackClient.swift | llp/0064, llp/0093 | clients/swift.md |
| clients.non-js | Published and maintained non-JS clients beyond Swift (Kotlin and Dart) | kotlin, compose, dart, flutter | local | partial | llp/0093-client-protocol-and-native-clients.rfc.md | llp/0093, llp/0064 | GAP (owner: Charlie, review: 2026-08-31) |
| clients.poll-hosted | Socketless hosted demand ownership and poll delivery | hosted polling, poll hosted | cloudflare | partial | cloudflare/src/coordinator.js | llp/0093, llp/0095 | GAP (owner: Charlie, review: 2026-08-31) |
| clients.external-store | Shared current-value/subscription store | external store | local | shipped | `createExternalQueryStoreRegistry` in packages/snapback-client/external-store.mjs | llp/0012, llp/0064 | clients/headless.md |
| clients.framework-bindings | React/Contract bindings | bindings | local | partial | `SNAPBACK_EXTERNAL_STORE_PROTOCOL` in packages/snapback-client/external-store.mjs | llp/0012, llp/0034, llp/0064 | clients/framework-bindings.md |
| clients.app-cli | Local app CLI and brokered code mode | app cli, code mode | local | partial | `snapback-app` in packages/snapback-app-cli/cli.mjs | llp/0062 | clients/app-cli.md |
| clients.contract | Contract/Exact adapter; generated bindings; surface boot | contract, exact, ui bindings | local | shipped | `createSnapbackContractSurface` in packages/snapback-contract/index.mjs | llp/0005, llp/0034 | clients/contract-adapter.md |
| clients.contract-provider-generation | Provider-neutral Contract manifest, bindings, metadata, types, fixtures, and docs from a provider declaration | provider declaration, contract sidecar generator, convex bindings | local | shipped | `generateFromDeclaration` in demos/partiful-matrix/scripts/generate-contract-provider.mjs | llp/0063 | clients/contract-adapter.md |
| clients.contract-keyed-scopes | Binding-time keyed Contract queries with dedup, refcounts, and authority fencing | dynamic query, query args, dedup, selection | local | shipped | `createKeyedSnapbackContractProvider` in packages/snapback-contract/keyed-provider.mjs | llp/0034, llp/0063 | clients/contract-adapter.md |
| clients.mutation-outcomes | Raw provider settlement facts plus Exact three-fact mutation projection | mutation state, timeout, retry, receipt, ambiguity | local | shipped | `partitime.step1-mutation-projection.v1` in demos/partiful-matrix/tests/acceptance/step1-mutation-projection.mjs | llp/0043, llp/0063 | clients/contract-adapter.md |
| clients.optimistic-overlays | Derived optimistic mutations + reconciliation | optimistic, overlays, latency | local | shipped | `deriveOptimisticReducer` in packages/snapback-contract/index.mjs | llp/0052 | clients/contract-adapter.md |
| clients.react | Prepared React provider over one headless store/transport seam: exact generated single/grouped live queries, capability-gated route-group references with one-commit register-mode adoption, explicit live fallback, attach-deadline recovery, sessions authorization adoption, result-validated optimistic mutation rebase/rollback, local managed connection-keyed presence, aggregate connection state, per-query `freshness`/`retention` offline facts with the `useSnapbackOutbox` queued-intent projection, Strict Mode/HMR sharing, complete cleanup, and retained Signal Desk receipts | react, hooks, useSyncExternalStore, result inference, typed mutation, optimistic rollback, presence, query groups, bundle prime, registered bundle, hmr, offline freshness, outbox badge | local | shipped | `useSnapbackOutbox` in packages/snapback-react/index.d.mts | llp/0012, llp/0064, llp/0074, llp/0090, llp/0101, llp/0114, llp/0106, llp/0107, llp/0129 | clients/react.md |
| clients.react-expo | React Expo Online surface; independent Android and iOS implementation evidence | react native, expo, android, ios, mobile | local | shipped | `profileId` in demos/partiful-matrix/tests/acceptance/native-react-expo.mjs | llp/0012, llp/0064 | clients/react-expo.md |
| operating.server-lifecycle | Start/reuse/stop servers safely; ports; provenance; crash detection | run server, ports, bindPortExactly, lifecycle, watchdog, crash, prebuilt binary, seed reset | local | shipped | `startServer` in demos/_kit/server-process.mjs | llp/0010, llp/0030 | testing/acceptance.md |
| operating.packaged-dev-loop | Install a native runtime; scaffold, generate, doctor, and watch/load through one CLI. The current packed React/Vite starter and inferred sessions startup pass locally, but the expanded React closure is not yet the byte-verified public `0.1.0` closure. | install, new app, react starter, vite, dev, one command, watch, sessions startup, packaged runtime | local | partial | `runDev` in packages/snapback-cli/index.mjs | llp/0041, llp/0058, llp/0114, llp/0103 | getting-started/the-authoring-loop.md |
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
| /_snapback/api/jobs | backend.jobs-one-off |
| /_snapback/api/jobs/drain | backend.jobs-one-off |
| /_snapback/api/jobs/{id} | backend.jobs-one-off |
| /_snapback/api/receipts | notAuthorFacing (operator projection) |
| /_snapback/api/schema/load | backend.schema |
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
| /push/tokens/register | backend.push-token-registry-v1 |
| /push/tokens/unregister | backend.push-token-registry-v1 |

### Host operations (LLP 0024 operation registry)

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
