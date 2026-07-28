# LLP 0105: Expo-hosted Snapback delivery

**Type:** Plan
**Status:** Draft
**Systems:** Product, Deployment, Runtime, Storage, Auth, Security, Billing, Observability, Developer experience, Operations
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-28
**Revised:** 2026-07-28 (initial cross-repository plan)
**Related:** LLP 0009, LLP 0010, LLP 0014, LLP 0018, LLP 0043, LLP 0044, LLP 0045, LLP 0047, LLP 0057, LLP 0060, LLP 0070, LLP 0071, LLP 0087, LLP 0089, LLP 0103, LLP 0104

## Summary

Deliver Expo-hosted Snapback through gated slices across Snapback,
`eas-hosting`, Universe, EAS CLI/Workflows, documentation, billing, and
operations. The first milestone is not a public free tier. It is a measured
end-to-end canary proving stable identity, isolated code, durable data,
deployment repair, hosted auth, and exact usage attribution.

The shortest credible route:

1. prove the WfP handler/host-bridge topology and costs;
2. build the control/data-plane skeleton for one internal app;
3. earn the untrusted private-beta security and lifecycle contract;
4. add billing, budgets, product UX, and free tier;
5. close or explicitly stage remaining capabilities before GA.

No phase may call the current `cloudflare-do-sqlite-v8` proof a managed
product. Its capability manifest remains the honesty boundary until the new
profile earns its own.

## Work ownership

### Snapback

- define the `eas-cloudflare-wfp-v1` capability profile;
- package content-addressed schema, permissions, query/mutation, and action
  artifacts;
- implement handler harness and invocation-bound host protocol;
- finish hosted auth and an external provider path;
- adapt coordinator/live semantics to stable environment identity;
- implement export/restore and hosted acceptance;
- close required offline, asset, notification, job, egress, and ephemeral
  gaps according to launch scope;
- maintain LLPs, guide, capability rows, and demo diaries.

### `eas-hosting`

- extend deployment manifests/tokens for stable ids and Snapback artifacts;
- provision gateway/coordinator services and a dedicated handler namespace;
- attach only generated service bindings, outbound policy, tags, and limits;
- reserve and route Snapback HTTP/WebSocket paths;
- make multi-component deploy, cleanup, rollback, and repair idempotent;
- emit stable-id usage events and provider shadow meters;
- add backup/export paths, queues, and operational alarms;
- preserve ordinary Hosting behavior for non-Snapback projects.

### Universe

- add service, environment, release, provenance, operation, entitlement,
  budget, backup, and deletion entities;
- authorize with Expo project roles and scoped service principals;
- issue signed claims and consume component-level webhooks;
- coordinate alias, transfer, disable, plan, suspension, and deletion;
- project LLP 0089 through GraphQL/HTTP/MCP;
- ingest, reconcile, price, invoice, and display usage;
- build Backend/Snapback and billing UX;
- add privacy-bounded support/audit/incident tools.

### CLI, Workflows, docs, support

Required even if housed elsewhere:

- EAS/Snapback CLI and structured noninteractive output;
- Workflows deploy/promote/rollback with protections;
- local emulator and hosted preflight;
- setup, auth, migration, pricing, limits, backup/export, incident, and
  deletion docs;
- status page, on-call runbooks, support receipts, and launch terms.

## Phase 0 — decisive spikes and contracts

Use disposable staging resources. Outputs are committed receipts.

### P0.1 WfP handler and host bridge

Build a minimal generated Worker in a dedicated dispatch namespace:

- only a `HOST` service binding;
- ambient network denied for query/mutation;
- app/object ids absent from user-controlled arguments;
- capability bound to environment, release, operation, request id, deadline;
- one query and mutation calling host operations;
- separate action role performing one allowlisted fetch;
- CPU, subrequest, response, concurrency, and queue limits;
- termination, retry, stale-capability, and cross-app attacks.

Run LLP 0009/0047 adversarial suites with two apps and two releases. Record the
exact multipart binding metadata returned after upload.

### P0.2 Ingress and WebSocket routing

Extend a staging route with stable ids and route a reserved path:

- Expo subdomain, preview URL, production alias, and custom domain;
- HTTP, WebSocket upgrade, hibernation, reconnect, and suspension;
- no collision with Expo Router/static assets;
- no user header can forge internal identity;
- no incorrect authenticated response caching.

### P0.3 Environment and release semantics

Prototype production, development, and explicit preview:

- immutable release upload and promotion without data replacement;
- named preview TTL;
- code rollback over retained data;
- incompatible schema refusal;
- transfer/domain rename without durable-id change.

Resolve whether web alias and backend activation coordinate directly or need
LLP 0103's fenced saga.

### P0.4 Meter and margin proof

Emit all LLP 0104 customer/shadow meters for the five-app corpus and
read-heavy live, write-heavy collaboration, bursty action/job, idle, and
connected-hibernating shapes.

Prove attribution through alias/domain changes and transfer. Calculate free
maximum cost and paid p50/p95 margins. Record any incomplete provider meter.

### P0.5 Hosted auth and product security

Run one external identity provider through LLP 0057/0060:

- browser/native session entry;
- effective source/TLS and auth throttling;
- session/permission invalidation;
- sender/custody posture;
- cross-app, transfer, suspension, and stale release.

Expo account auth covers only the control plane; prove the app plane separately.

### Gate 0

Proceed only if:

- LLP 0009 review accepts WfP as the untrusted boundary;
- the host bridge has a minimal receipt-checked binding envelope;
- slow actions cannot block transactional work;
- stable identity works across every EAS route shape;
- deployment/activation repair converges after injected failure;
- billable/shadow meters support the margin gate;
- paid prices are not structurally loss-making;
- free maximum cost is enforceably bounded;
- hosted auth passes its target contract;
- no Cloudflare beta primitive is a launch dependency.

Failure reshapes or kills the topology, not the public claim.

## Phase 1 — internal canary

Build for an Expo-owned application:

- Universe state machine and entities;
- signed stable-id authorization and component receipts;
- dispatcher/gateway/coordinator/handler path;
- production/development environments;
- deploy, promote, rollback, suspend, export, restore, and two-stage delete;
- end-to-end logs/crashes/requests;
- shadow usage/cost dashboard;
- external app-user auth;
- daily acceptance and fault injection.

Use real transfer and plan-change staging fixtures. Run 14 days with daily
activity and deliberate provider/API failures.

### Gate 1

- no cross-app/environment access;
- operations are idempotent and repairable;
- restore and logical export independently verify;
- transfer, suspend, spend-stop, and delete converge with receipts;
- one request correlates through every component;
- provider invoice and shadow ledger reconcile;
- ordinary EAS Hosting does not regress;
- canary SLO/cost budgets hold for 14 days.

## Phase 2 — private paid beta

Invite a small set of Starter-or-higher projects:

- expose CLI/Workflows and dashboard;
- shadow-invoice before real metering;
- acknowledge beta capability gaps;
- publish limits, export, restore, deletion, incident, and pricing docs;
- provide escalation and per-project kill/suspend;
- run at least one native and one Expo web/API app;
- diary setup, auth, deploy, rollback, debugging, billing, and recovery.

Issue credits instead of charging uncertain corrections. Enable charges only
after two complete billing periods reconcile.

Private beta requires production auth, untrusted isolation/limits, online
query/mutation/action/live, provisioning/rollback, backup/restore/export/delete,
audit, stable usage/budgets, safe config/secrets, and durable maintenance jobs.

Offline replay, retained resume, ephemeral rooms, user assets, notifications,
calendar cron, generalized egress, rich queries, and Postgres may remain
explicit beta gaps if invited apps do not require them.

### Gate 2

- two billing periods reconcile;
- ten projects deploy/promote/rollback without operator repair;
- no unresolved isolation/data-loss incident;
- restore drills succeed for three projects;
- support diagnoses every injected failure from safe receipts;
- latency/error/live/cost budgets hold;
- diaries reveal no setup blocker the guide should have prevented.

## Phase 3 — public free and paid beta

Enable self-service:

- ratified LLP 0104 free tier;
- hard free caps, warnings, budget UX, abuse admission;
- Starter usage billing;
- aggregate three-project entitlement;
- visible preview TTL/cleanup;
- one-command enable/deploy;
- onboarding template and agent/MCP provisioning;
- public status and incident communications.

### Gate 3

- free maximum-cost and abuse models hold;
- no free user can receive an invoice;
- quota stop preserves reads/export and committed data;
- median fresh-app setup is under five minutes with no Cloudflare knowledge;
- pricing, docs, CLI, dashboard, and invoice agree;
- paid economics pass the margin gate;
- public security/privacy review approves the service inventory.

## Phase 4 — complete product and GA

Close launch-app requirements:

1. offline retention and queued replay;
2. retained-version resume;
3. ephemeral realtime;
4. assets and processing;
5. notifications;
6. calendar cron and complete jobs;
7. generalized declared egress;
8. richer relational/search queries;
9. config acquisition/rotation;
10. Postgres graduation or a supported migration.

GA also requires published SLO/Enterprise posture, residency/compliance,
noisy-neighbor evidence, disaster recovery drills, provider outage and
credential rotation rehearsals, support ownership, and a large-app answer
before claiming unlimited popular-app scale.

## Cross-repository ledger

| Slice | Snapback | `eas-hosting` | Universe |
| --- | --- | --- | --- |
| Identity | Environment/release artifacts | Carry signed ids | Entities, roles, transfers |
| Deploy | Build/admission bundles | Upload components/receipts | Operation state/authorization |
| Runtime | Coordinator, harness, host ops | Gateway, namespaces/bindings | Entitlements/suspension |
| Auth | App-user sessions | Effective-source routing | Roles/service principals |
| Billing | Logical meters/limits | Provider event emission | Ledger, pricing, Stripe, UI |
| Observe | Function/job facts | Tail/request correlation | Dashboard/support queries |
| Lifecycle | Export/import contracts | Cleanup/backup/restore | Transfer/delete/retention |
| DX | CLI/MCP semantics | Deployment API | Dashboard/Workflows/docs |

## Evidence matrix

Every phase maintains local conformance, staging remote acceptance, two-app
adversarial isolation, two-release skew/rollback, transfer/plan fixtures,
state-edge fault injection, billing duplicate/late/missing/correction cases,
backup/export/restore/delete receipts, ordinary Hosting regression, five-app
cost runs, and browser/native/agent provisioning.

Receipts carry participating repo SHAs, Cloudflare runtime/compatibility date,
pricing version, commands, timestamps, safe test ids, and diagnostics. No gate
passes by prose assertion alone.

## Sequencing constraints

- No public untrusted traffic before LLP 0009/0047 review.
- No production app-user traffic before LLP 0060 acceptance on this target.
- No charges before stable-id reconciliation and two shadow periods.
- No free-tier marketing before hard-stop/data safety proof.
- No Facets launch dependency; evaluate under LLP 0087.
- No database per immutable preview deployment.
- No raw Cloudflare credential/object-id exposure.
- No capability claim merely because an EAS/Cloudflare primitive exists.

## Open decisions

1. Which CLI command owns enablement and atomic artifact coordination.
2. Preview naming, TTL, and production-data isolation.
3. Two handler/action scripts versus a proven independent kill domain.
4. First external app-user auth provider.
5. Final prices/quotas after margin proof.
6. Acceptable gaps for first invited apps.
7. On-call ownership across Expo Hosting and Snapback.

## Status

Draft. Phase 0 is proposed, not authorized here. Revise each gate with
machine-readable receipts and dated platform/pricing facts.
