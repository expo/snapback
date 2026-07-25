---
title: The Snapback Guide
id: meta.index
order: 1
audience: agent-first
capabilities: [operating.served-guide, operating.guide-mcp]
authorities: [llp/0061-agent-first-snapback-guide.rfc.md, llp/0000-snapback.explainer.md, llp/0064-native-client-surfaces.rfc.md]
examples: [demos/todo, demos/todo-v2, demos/cursors-web, demos/card-game, demos/partiful-matrix]
status: current
targets: [all]
maturity: shipped
reviewed: 2026-07-20
reviewed-commit: 506b622cd3
---

<img src="../brand/snapback-mark.svg" alt="Snapback" width="96" />

# The Snapback Guide

How to build an application **on** Snapback — a complete backend that
scales to zero and back up: schema and functions, server-authoritative
data, live queries, ephemeral realtime, auth, and the client arms — taught
intent-first, with code that ran in CI.

**Audience:** agents (primarily) and humans (secondarily) building on
Snapback. In a checkout, read this corpus directly. Outside a checkout, a
running Snapback server exposes the same build-bound corpus at
`GET /_snapback/guide`, individual paths below that prefix, and the complete
single-request projection at `GET /_snapback/guide/flat.md`. Those responses
carry `x-snapback-guide-content-sha256` and
`x-snapback-server-build-commit`, so a consumer can refuse to combine cached
guide bytes with a different server build. Building Snapback itself is a
different job — that's `AGENTS.md` and the LLP corpus, not this guide.

For MCP clients, run `snapback mcp`. The read-only server exposes the same
manifest, flat projection, and manifest-named pages at stable
`snapback-guide://` resource URIs. Every resource repeats the guide content
hash and build commit in MCP metadata; read the manifest first and refuse to
combine resources whose identities differ. This resource-only command exposes
no mutation or host-operation tools.

**Start every task here:** check the
[capability index](./capabilities.md) first — it lists everything Snapback
has, including what this guide doesn't cover yet (explicit GAP rows), so
you never build around a feature because you didn't know it existed.

## The map

### Getting started
- [Your first backend](./getting-started/your-first-backend.md) — schema,
  functions, handlers, seed, codegen, load, query.
- [The authoring loop](./getting-started/the-authoring-loop.md) — edit →
  regenerate → acceptance test → inspect, including the packaged
  `new`/`generate`/`dev`/`doctor` loop.

### Backend
- [Queries](./backend/queries.md) — indexed snapshot reads, server scoping,
  and the ordinary-vs-live boundary.
- [Mutations](./backend/mutations.md) — buffered writes, one commit version,
  read-set conflict validation, and structured results.
- [Safe standard patterns](./backend/standard-patterns.md) — owner-scoped CRUD,
  unique lookup, keyset pages, and server-derived time and IDs.
- [Actions and outbound fetch](./backend/actions-and-fetch.md) — gated
  egress, config grants, and mutation-owned durable effects.
- [Streamed actions](./backend/streamed-actions.md) — bounded pull-driven
  response streaming, the attempt control plane, and durable progress.
- [Scheduled execution](./backend/cron.md) — action-backed jobs,
  demand activation, deterministic ticks, and the run ledger.

### Realtime
- [Live queries](./realtime/live-queries.md) — subscriptions, snapshot +
  replace/delta, durable push, the connection axis.
- [Ephemeral state](./realtime/ephemeral-state.md) — typed rooms, all
  collection options and key modes, overlays, recovery, and Contract links.

### Sync and offline
- [Offline retention and mutation replay](./sync/offline-and-retention.md) —
  stale boot, durable outbox ordering, deterministic overlays, and settlement.

### Auth
- [Sessions and principals](./auth/sessions-and-principals.md) — the server
  derives who you are; scoped queries; logout barriers.
- [Protecting live and retained data](./auth/protecting-data.md) —
  connection grants, invalidation obligations, recovery, and authorized leases.
- [Scoped roles and memberships](./auth/scoped-roles.md) — declare app-wide or
  per-resource roles; gate queries; check and change membership safely.
- [Agent principals](./auth/agent-principals.md) — register, pair, mint scoped
  tokens, fence custody, revoke, and verify an agent journey.
- [Targets — what each one claims](./auth/targets.md) — local vs hosted
  honesty; how to check the server instead of trusting prose.

### Clients
- [The headless client](./clients/headless.md) — the complete
  `SnapbackClient` surface: calls, live/ephemeral state, receipts, and auth.
- [The app CLI](./clients/app-cli.md) — discover generated operations and run
  the packaged local agent journey without source-diving.
- [The Contract adapter](./clients/contract-adapter.md) — generated
  bindings, one-surface boot, derived optimistic overlays, offline classes.
- [The React client](./clients/react.md) — first-class external-store hook,
  keyed sibling sharing, Strict Mode lifecycle, and settlement state.
- [React Expo Online clients](./clients/react-expo.md) — the shared React
  projection on native carriers, per-OS evidence, and Online/Parity honesty.

### Testing
- [Acceptance testing](./testing/acceptance.md) — headless-first harness,
  vacuous-pass protection, safe server lifecycle.

### Operating
- [Secrets and deployment config](./operating/secrets-and-config.md) —
  declare, set, verify, grant, and consume write-only values.
- [Host operations](./operating/host-ops.md) — the complete CLI/HTTP
  operation inventory and its authority envelopes.
- [Diagnostics](./operating/diagnostics.md) — stable codes, assertion
  discipline, doctor, and bootstrap failure vocabulary.
- [Admin console](./operating/admin-console.md) — build, launch, develop, and
  debug through the privileged Contract system app.

### Deploying
- [Immutable releases and deploy plans](./deploying/releases.md) — build the
  target-neutral release, register an exact VM/container target, inspect its
  provider identity, and retain a GAP-fenced content-addressed plan.
- [Cloudflare proof](./deploying/cloudflare.md) — deploy and verify All
  Aboard on the honest partial hosted profile; explicit supported subset and gaps.

### Recipes
- [Presence cursors](./recipes/presence-cursors.md) — ephemeral rooms, TTL,
  publish budgets (the cursors-web demo, distilled).
- [Hidden hands](./recipes/hidden-hands.md) — per-principal secrecy, logout
  blanking, lease-bounded offline retention (card-game, distilled).

### Meta
- [Capability index](./capabilities.md) — everything Snapback has, covered
  or GAP.
- [Conventions](./conventions.md) — page rules, snippet classes, link
  policy, freshness.
- [Retrieval eval protocol](./retrieval-eval.md) — how we verify a cold
  agent actually finds these pages.

## How to trust the code here

Every `js`/`ts`/`contract` snippet marked `source=` is a verbatim excerpt
of a file CI executes end-to-end — `scripts/check-guide.mjs` fails the
build if a snippet drifts from its source. Prose can rot; these can't
silently. Pages carry `targets:` and `maturity:` frontmatter so a claim's
scope is always explicit ([conventions](./conventions.md)).

The deeper design rationale lives in the LLP corpus (`llp/`) — every page's
`authorities:` frontmatter names its sources. The demos (`demos/`) are the
full working applications these pages distill.
