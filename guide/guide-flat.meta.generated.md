<!-- Generated meta section flat projection by scripts/generate-guide-manifest.mjs. Never hand-edit. -->

---

<!-- snapback-guide-source: guide/index.md -->
---
title: The Snapback Guide
id: meta.index
order: 1
audience: agent-first
capabilities: [operating.served-guide, operating.guide-mcp]
authorities: [llp/0060-hosted-auth-security.rfc.md, llp/0061-agent-first-snapback-guide.rfc.md, llp/0000-snapback.explainer.md, llp/0042-agent-mcp-surface.rfc.md, llp/0064-native-client-surfaces.rfc.md, llp/0181-zero-configuration-expo.rfc.md, llp/0184-agent-accessible-control-plane.rfc.md, crates/snapback/src/server.rs, crates/snapback/src/schema_export.rs, schemas/http.routes.v1.json, crates/snapback/src/cli.rs, crates/snapback/src/guide_mcp.rs, packages/snapback-cli/index.mjs, packages/snapback-cli/expo-dev.mjs, packages/snapback-cli/mcp-control.mjs, llp/0193-errors-as-docs-completeness.plan.md, scripts/generate-diagnostics-registry.mjs]
examples: [demos/todo, demos/todo-v2, demos/cursors-web, demos/card-game, demos/partiful-matrix, demos/expo-golden-path-fixture]
status: current
targets: [all]
maturity: shipped
reviewed: 2026-08-17
reviewed-authorities-digest: sha256:dfe849b4ace4f244e4bbbaeab156390f714d6993d9ff092d0d0e05ad6fcd8b94
---

<img src="../brand/snapback-mark.svg" alt="Snapback" width="96" />

# The Snapback Guide

How to build an application **on** Snapback — a complete backend that
scales to zero and back up: schema and functions, server-authoritative
data, live queries, ephemeral realtime, auth, and the client arms — taught
intent-first, with code that ran in CI.

Need an exact exported signature? Start with the build-bound
[generated API reference](./reference/index.md), or run
`snapback guide <ExactSymbolName>` for a budgeted symbol lookup.
For a stable `SNAPBACK_*` failure, use the generated
[diagnostic code registry](./reference/diagnostics.md), or pass the code to
the same command for exact lookup before prose search.

**Audience:** agents (primarily) and humans (secondarily) building on
Snapback. In a checkout, read this corpus directly. Outside a checkout, a
running Snapback server exposes the same build-bound corpus at
`GET /_snapback/guide` and individual paths below that prefix. The first
read is deliberately small (LLP 0259): a template's
[start packet](./start/index.md), or
[Snapback in one screen](./start/mental-model.md) when no template is
selected — then escalate one page at a time. The
[capability index](./capabilities.md) and [surface map](./surface-map.md)
are budgeted registries for lookup, not linear first reads. Generated
`guide-flat.<section>.generated.md` files provide a per-section bulk
tier. The complete bulk projection remains at
`GET /_snapback/guide/flat.md`, but is about 2.5 MiB and growing. Those responses
carry `x-snapback-guide-content-sha256` and
`x-snapback-server-build-commit`, so a consumer can refuse to combine cached
guide bytes with a different server build. `GET /llms.txt` at the served root
provides a convention-standard index in that recommended order, with
approximate sizes, and lists the whole-corpus projection last as an explicit
bulk fallback. The same local server
serves `GET /_snapback/guide/http.routes.v1.json`, a generated build-bound
join from the installed route registry to committed input/output schema
references; a `null` schema reference means no route-specific schema is
committed, not an unconstrained body. Building Snapback
itself is a
different job — that's `AGENTS.md` and the LLP corpus, not this guide.

That served-discovery promise is for local/embedded server profiles. The
derived hosted posture deliberately disables `operatorSurface`; on that
profile `/llms.txt`, `/_snapback/guide*`,
`/_snapback/api/control-catalog`, and host-operation discovery are not
claimed. Depending on the target, those URLs may return a fixed empty 404, an
asset fallback, or a target-specific refusal; none is evidence of a hosted
discovery surface. Use the guide from the pinned checkout or published package
when working against that profile; do not infer local discovery routes from a
hosted app's root URL.

## Choose the MCP authority

Snapback ships two local stdio MCP servers. Keep their different authority
postures visible when you configure an agent:

| Server | What it exposes | Authority consequence |
| --- | --- | --- |
| `snapback mcp` | The native Rust binary's resource-only Guide server. It reads the compile-time-embedded Guide corpus and exposes the manifest, per-section flats, the roughly 2.5 MiB whole-corpus bulk flat, and manifest-named pages at stable `snapback-guide://` URIs. Context-limited readers should prefer the `start.*` packet pages or a section; capabilities is a lookup registry. It has no mutation or host-operation tools. | Least authority: safe to wire into any agent, with no additional authority grant. |
| `snapback mcp-control` | The explicit JS control-plane server shipped by `@expo/snapback-cli`: typed control tools, the generated app-data catalog, `snapback-controls://catalog` plus per-operation/instance resources, and the native Guide resources. It invokes the co-installed native runtime for both embedded Guide and build-catalog bytes; the npm package carries no second snapshot. If that binary is unavailable, resource listing reports `SNAPBACK_MCP_NATIVE_DOCUMENTATION_UNAVAILABLE` and lists no pretend Guide/catalog resources. | Standing local admin: it authenticates with the auto-minted local admin token, so the wired-in client has admin authority over the local Snapback instance. |

The split makes documentation safe by default while keeping a capable operating
surface available by explicit choice. `mcp-control` has the same local authority
the CLI already exercises, but it is still a real authority grant that a cold
agent must understand before opting in; configuring it does not grant hosted or
remote authority, and no credential is copied into MCP configuration.

Generate the project-scoped configuration instead of guessing client syntax:

```sh
snapback agent setup --print codex
snapback agent setup --print claude --server mcp
snapback agent setup --install cursor --server mcp-control
```

`--print` supports `codex`, `claude`, `cursor`, and `generic`; without
`--server` it prints both entries. Codex uses `.codex/config.toml` in a trusted
project, Claude uses `.mcp.json`, and Cursor uses `.cursor/mcp.json`. Installation
and exact uninstall require an explicit `--server mcp|mcp-control`; installation
shows the target file, requested server, and authority consequence before it
writes, then returns a receipt.

For a manual setup, the two commands are simply:

```sh
snapback mcp
snapback mcp-control
```

A project-scoped JSON client entry has this minimal shape when the installed
`@expo/snapback-cli` `snapback` bin is on `PATH` (the setup command emits the
resolved local executable paths instead):

```json fragment reason="manual MCP client configuration; generated executable paths are installation-specific"
{
  "mcpServers": {
    "snapback-guide": {
      "command": "snapback",
      "args": ["mcp"]
    },
    "snapback-control": {
      "command": "snapback",
      "args": ["mcp-control"]
    }
  }
}
```

Every Guide resource repeats the content hash and build commit in MCP metadata;
read the manifest first and refuse to combine resources whose identities differ.

**Start every task with the start packet or mental model** (LLP 0259):
[start packets](./start/index.md) for scaffolded templates,
[Snapback in one screen](./start/mental-model.md) otherwise. The
[capability index](./capabilities.md) is the completeness registry — it
lists everything Snapback has, including what this guide doesn't cover yet
(explicit GAP rows), so you never build around a feature you didn't know
existed and never assume one that is a named gap. Look terms up in it
(grep, or `snapback guide <query>`); do not linear-read it before the
first edit. When an example is the fastest route, use the checked
[demo catalog](repo:demos/README.md) to choose by client, target, maturity,
proof command, and honest nonclaims without opening every demo.

## The map

### Start here
- [Start packets](./start/index.md) — the budgeted per-template first
  reads: full packets for `react` and `expo-chat`, stubs for
  `crud-dashboard`, `media-feed`, and `todo-contract`.
- [Snapback in one screen](./start/mental-model.md) — the shared mental
  model when no template is selected (about 3 KiB).

### Getting started
- [Your first backend](./getting-started/your-first-backend.md) — schema,
  functions, inline JS handlers, seed, codegen, load, query.
- [The authoring loop](./getting-started/the-authoring-loop.md) — edit →
  regenerate → acceptance test → inspect, including the packaged
  `new`/`generate`/`dev`/`doctor` loop and the current one-command React/Vite
  starter.
- [Generated artifact custody and review](./getting-started/generated-artifacts.md)
  — the committed review manifest, policy projections, ignored input-hash
  cache, summaries, and fail-closed resolution.

### Backend
- [Handler runtime profile and generation preflight](./backend/handler-runtime.md)
  — inspect current handler module/syntax/global limits, run the full
  non-replacing `generate --check` path, and follow build-bound refusal
  remediation.
- [Queries](./backend/queries.md) — indexed snapshot reads, server scoping,
  and the ordinary-vs-live boundary.
- [Mutations](./backend/mutations.md) — buffered writes, one commit version,
  read-set conflict validation, and structured results.
- [Declarative mutation plans](./backend/declarative-plans.md) — the complete
  `defineMutation` vocabulary: plan steps, return bindings, the expression
  algebra, spec keys, and the plan-refusal channel.
- [Scoped sequences](./backend/sequences.md) — the unpublished local
  handler-tier substrate for atomic, incarnation-scoped human-facing numbers,
  its A6 evidence, and the remaining qualification GAP.
- [Trusted runtime time and identifiers](./backend/trusted-runtime-values.md) —
  server-authored timestamps and IDs in JavaScript handlers, closed operation
  arguments, diagnostics, and transition guidance.
- [Safe standard patterns](./backend/standard-patterns.md) — owner-scoped CRUD,
  unique lookup, keyset pages, and declarative trusted defaults.
- [Relational queries](./backend/relational-queries.md) — shipped
  `defineRelationalQuery` / `defineMaintainedProjection` support for bounded
  two-source joins, including conversation-membership and message-sender
  shapes; aggregation and self-joins remain explicit gaps.
- [Familiar TypeScript profile](./backend/familiar-profile.md) — the
  Experimental/non-default 0.1.23 grammar, server-side authorization,
  identity-stable React hooks, native SecureStore custody, and one Expo Router
  journey.
- [Snapshot batches](./backend/snapshot-batches.md) — 2–8 bounded child
  pages evaluated at one snapshot with one coordinated `sbsb1` cursor
  (experimental local target).
- [Portable indexed text search](./backend/text-search.md) — weighted
  term/phrase/prefix search with structured ASTs, deterministic ranking,
  authorization partitions, highlights, and current-keyset cursors
  (experimental).
- [Portable exact vector search](./backend/vector-search.md) — declared
  fixed-width embeddings, pinned `dot`/`l2sq` arithmetic, bounded exact k-NN,
  authorization partitions, and explicit ANN/live/hosted nonclaims
  (experimental).
- [Reviewed migrations](./backend/migrations.md) — the `snapback migrate`
  preview → approve → rehearse → apply → verify loop for destructive schema
  changes, its intents, and its refusal codes.
- [Sessions schema evolution](./backend/schema-evolution.md) — change schema,
  interpret the deployment pin and diagnostic hashes, let managed successor
  activation advance it, and recover partial loads without discarding data.
- [Assets](./backend/assets.md) — generated upload intents, one-call
  File/Blob/picker upload, signed-URL issuance with a shared TTL-refresh
  controller and React hook, TUS resumable transfer, typed `v.assetRef`
  attachment, private delivery, per-recipient grants and view-once guidance,
  consistent-cut logical export, and signing-key rotation (local target;
  byte-level backup remains a nonclaim).
- [Media happy paths](./backend/media-happy-paths.md) — the unreleased
  empty-safe `useSnapbackMedia` projection, plus honest GAP fences for the
  `v.media()` field, bounded collection, and atomic media command.
- [View-once media with per-recipient access](./recipes/view-once-media.md) —
  local grant-edge recipe for disappearing photos: atomic send/open/close,
  product-owned consumption, delete-for-everyone, and strict revocation.
- [Versioned seeds](./backend/versioned-seeds.md) — content-addressed fixture
  identity, non-destructive matching, explicit reset-install/clear, and
  migration boundaries (experimental).
- [Actions and outbound fetch](./backend/actions-and-fetch.md) — gated
  egress, config grants, and mutation-owned durable effects.
- [Expo push notifications](./backend/expo-push.md) — protected token
  custody, declared audiences, crash-honest Expo tickets and receipts, and
  the local/hosted boundary.
- [Streamed actions](./backend/streamed-actions.md) — bounded pull-driven
  response streaming, the attempt control plane, and durable progress.
- [Scheduled execution](./backend/cron.md) — action-backed jobs,
  demand activation, deterministic ticks, and the run ledger.
- [External API exposure](./backend/external-api.md) — the opt-in `api`
  block, the unpinned `/api/v1` family, exposed-only disclosure, and the
  OpenAPI/agent-skill projections.
- [One-off durable jobs](./backend/jobs.md) — transactional
  `ctx.jobs.enqueue`, the declared job-status live query, the
  injected-clock drain, and secret-read-leased admin inspection
  (experimental).

### Realtime
- [Live queries](./realtime/live-queries.md) — subscriptions, snapshot +
  replace/delta, durable push, the connection axis.
- [Route snapshot bundles](./realtime/snapshot-bundles.md) — one-commit page
  boot, route manifests, resume tokens, and register-mode handoff.
- [Ephemeral state](./realtime/ephemeral-state.md) — presence, typing
  indicators, cursors, typed rooms, and the scoped React
  `useSnapbackPresence` hook, plus all collection options and recovery.

### Sync and offline
- [Offline retention and mutation replay](./sync/offline-and-retention.md) —
  stale boot, durable outbox ordering, deterministic overlays, and settlement.

### Auth
- [Sessions and principals](./auth/sessions-and-principals.md) — the server
  derives who you are; scoped queries; logout barriers.
- [Email and password](./auth/passwords.md) — signup and signin end users can
  do themselves, with no mail adapter: server-side argon2id, declared lockout,
  one-time recovery codes, and the exact session shape you get back.
- [Browser sign-in and reload custody](./recipes/browser-auth.md) — local
  trusted-server identity verification, immutable app-user binding,
  IndexedDB restoration, protected rows, and logout without a hosted claim.
- [Bind a principal to your app's user identity](./auth/app-identity-binding.md)
  — the principal↔app-user table every ported app needs first: the broker
  pattern for production, the frozen-actor-map bootstrap for acceptance.
- [Authenticate a native app](./auth/native-apps.md) — local email-code or
  the supported external identity-broker seam, exact bearer carriage, and
  the production boundary.
- [Protecting live and retained data](./auth/protecting-data.md) —
  connection grants, invalidation obligations, recovery, and authorized leases.
- [Scoped roles and memberships](./auth/scoped-roles.md) — declare app-wide or
  per-resource roles; gate queries; check and change membership safely.
- [Agent principals](./auth/agent-principals.md) — register an open or
  user-invited agent, pair it, mint scoped tokens, fence custody, revoke, and
  verify the complete agent journey.
- [Move auth identities without authority](./auth/logical-transfer.md) —
  contributor-source logical export/import for stable principal, ownership,
  identity, deactivation, and scope-basis facts with no spendable authority.
- [Targets — what each one claims](./auth/targets.md) — local vs hosted
  honesty; how to check the server instead of trusting prose.

### Clients
- [The client protocol](./protocol/client-protocol.md) — route and envelope
  families, delivery lanes, version guards, auth invalidation, heartbeat,
  and the conformance corpus.
- [The headless client](./clients/headless.md) — the complete
  `SnapbackClient` surface: calls, live/ephemeral state, receipts, and auth.
- [The Swift client](./clients/swift.md) — SwiftPM for iOS/macOS,
  `poll/local` + `live/local`, session auth, invalidation, and lifecycle.
- [The app CLI](./clients/app-cli.md) — introspect and call generated/served
  operations under explicit principals, or run a local TypeScript analysis
  through the credential-owning broker parent.
- [The Contract adapter](./clients/contract-adapter.md) — generated
  bindings, one-surface boot, derived optimistic overlays, offline classes.
- [The React client](./clients/react.md) — first-class external-store hook,
  keyed sibling sharing, Strict Mode lifecycle, and settlement state.
- [Application surfaces](./clients/surfaces.md) — bind one backend resource or
  screen once, then consume its reads, mutations, assets, and presence.
- [React Expo Online clients](./clients/react-expo.md) — no-URL
  `snapback dev --expo` simulator/emulator boot through
  `SnapbackExpoProvider`, plus per-OS evidence, carrier storage, authenticated
  asset uploads, and Online/Parity honesty.
- [Framework bindings](./clients/framework-bindings.md) — build on the
  external store and own identity, reconnect, error, lifecycle, and teardown.

### Testing
- [Acceptance testing](./testing/acceptance.md) — headless-first harness,
  vacuous-pass protection, safe server lifecycle.
- [Verify the declared app contract](./testing/verify.md) — compose artifact,
  runtime, D1 coverage, capabilities, and registered acceptance into one
  identity-bound partial done-oracle receipt.
- [Loading large deterministic fixtures](./testing/large-fixtures.md) — load
  past the 1,024-effect seed ceiling with a gated batch-ingest mutation,
  loader session minting from the readiness descriptor, and digest
  verification under the null/absent canonical form.

### Operating
- [Discover agent controls](./operating/agent-controls.md) — search the
  build-bound control catalog, describe exact CLI/MCP/API projections, and
  bind advisory instance availability by digest.
- [Local instance forks](./operating/instance-forks.md) — give each worktree a
  finite-TTL, quarantined copy of realistic local state; run fork-aware
  acceptance and retain bounded app-row diff receipts (partial/unpublished).
- [Back up, copy, and move a store](./operating/backup-and-copy.md) — a store
  is not one file: the declared durable-state set, the WAL-consistent
  `snapback store export` copy verb, and how copy, restore, and fork differ.
- [Continuously replicate a local SQLite store](./operating/replication.md) —
  configure the experimental self-hosted LTX lane, read the restorable
  frontier, checkpoint, restore under quarantine, and run the G2 drill.
- [Secrets and deployment config](./operating/secrets-and-config.md) —
  declare, set, verify, grant, and consume write-only values.
- [Host operations](./operating/host-ops.md) — the complete CLI/HTTP
  operation inventory and its authority envelopes.
- [Network condition profiles](./operating/network-profiles.md) — inject
  server-side egress latency for honest optimistic-UI, settlement, and
  convergence testing, then restore `normal`.
- [Patch one existing row safely](./operating/data-patch.md) — preview a
  schema-validated, per-row-versioned correction and apply it with one
  short-lived single-use capability (local non-production only).
- [Diagnostics](./operating/diagnostics.md) — stable codes, assertion
  discipline, exact runtime link/launch doctoring, binary recovery records,
  and bootstrap failure vocabulary.
- [Admin console](./operating/admin-console.md) — the shipped browser debugger
  for seeing backend Data, Functions, Realtime, Errors, Logs, and capability
  state before reaching for `curl` or raw host operations.
- [Backend observability](./operating/observability.md) — inspect Health and
  Logs, query typed telemetry from CLI/MCP, and interpret coverage, freshness,
  retention, and shedding honestly.
- [Backend error tracking](./operating/error-tracking.md) — group eligible
  backend failures, inspect raw exemplars under scoped authority, and triage
  release-aware issue state from the console, CLI, or MCP.

### Deploying
- [Deployment posture](./deploying/index.md) — the aggregate truth: where
  local, Fly, Cloudflare, and hosted lifecycle paths stop today, with their
  tracking tickets.
- [Immutable releases and deploy plans](./deploying/releases.md) — build the
  target-neutral release, register an exact VM/container target, inspect its
  provider identity, and retain a GAP-fenced content-addressed plan.
- [Cloudflare proof](./deploying/cloudflare.md) — deploy and verify All
  Aboard on the honest partial hosted profile; explicit supported subset and gaps.
- [Hosted control](./deploying/hosted-control.md) — the package-owned read
  surface, all 17 closed lifecycle verbs, and the carrier/custody refusal.

### Recipes
- [Browser sign-in and reload custody](./recipes/browser-auth.md) — verified
  external assertion seam, principal↔app-user binding, durable IndexedDB
  custody, protected rows, and revoking logout (local product-shaped recipe).
- [Presence cursors](./recipes/presence-cursors.md) — ephemeral rooms, TTL,
  publish budgets (the cursors-web demo, distilled).
- [Membership-scoped typing indicators](./recipes/typing-indicators.md) —
  canonical conversation membership, idle withdrawal, and the Sessions
  negative-observer battery (messaging-snapback, distilled).
- [Hidden hands](./recipes/hidden-hands.md) — per-principal secrecy, logout
  blanking, lease-bounded offline retention (card-game, distilled).
- [Optimistic toggle](./recipes/optimistic-toggle.md) — like/favorite with a
  count: atomic two-field projection, replayable capture-and-set reducers,
  complete-receipt matching, and the one-canonical-store rule across query
  surfaces.
- [Paginated and load-more lists](./recipes/paged-list.md) — a unique
  immutable keyset boundary, whole-result live replacement, React archive
  assembly, and honest retained-state limits (media-feed, distilled).
- [Optimistic create with a server-minted ID](./recipes/optimistic-create.md)
  — generated mutation IR, durable intent identity, typed provisional
  presentation, logical-mint mapping, and ambiguous retry (Contention
  Calendar, distilled).
- [View-once media with per-recipient access](./recipes/view-once-media.md) —
  disappearing photos and ephemeral media with one pending grant per
  recipient, a unique consumption row, close versus delete-for-everyone, and
  next-request denial (messaging-snapback, distilled; local-only).
- [Install sessions fixtures with profiles and avatars](./recipes/sessions-fixture-install.md)
  — one restart-safe installer for password accounts, principal-owned profile
  rows, ordinary avatar uploads, typed attachment, and matched repeats that
  sign in but skip asset uploads and application-data writes.
- [Coming from Convex/Supabase?](./recipes/coming-from-convex-and-supabase.md)
  — worked-example translations of common Convex/Supabase journeys into
  Snapback, CI-verified against real demo sources (LLP 0186 W2).

### Meta
- [Capability index](./capabilities.md) — everything Snapback has, covered
  or GAP.
- [Surface map](./surface-map.md) — every declared server route and host
  operation joined to a capability or an explicit non-author-facing class.
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

---

<!-- snapback-guide-source: guide/capabilities.md -->
---
title: Capability index
id: meta.capabilities
order: 2
audience: agent-first
capabilities: []
authorities: [llp/0041-packaged-dev-loop.rfc.md, llp/0045-notifications-outbox.rfc.md, llp/0061-agent-first-snapback-guide.rfc.md, llp/0064-native-client-surfaces.rfc.md, llp/0100-membership-addressed-operations-and-pages.rfc.md, llp/0133-local-settlement.spec.md, llp/0154-minimal-observability.rfc.md, llp/0155-local-sync-product-direction.rfc.md, llp/0156-minimal-error-tracking.rfc.md, llp/0188-ltx-sqlite-replication.rfc.md, llp/0211-typed-opaque-structured-stored-values.spec.md, llp/0218-outbox-settlement-contract.rfc.md, llp/0222-connected-client-predicate.rfc.md, llp/0245-infer-show-freeze-declarations.rfc.md, llp/0248-bounded-batch-reads.rfc.md, llp/0258-first-party-application-auth-bootstrap.rfc.md, crates/snapback/src/server.rs, crates/snapback/src/admin.rs, crates/snapback/src/replication.rs, crates/snapback/src/cli.rs, crates/snapback/src/telemetry_query.rs, crates/snapback/src/errors_query.rs, packages/snapback-codegen/index.mjs, packages/snapback-cli/index.mjs, packages/snapback-client/external-store.mjs, packages/snapback-react/index.mjs, llp/0219-client-dev-diagnostics-channel.rfc.md, packages/snapback-client/client-diagnostics.mjs, packages/snapback-react/implementation.mjs]
examples: []
status: current
targets: [all]
maturity: shipped
reviewed: 2026-08-17
reviewed-authorities-digest: sha256:7f9585e2924827e7f5057f9a42dfda3b1c15cefeb0c142a6f5c2a2fcaab3db64
---

# Capability index

<!-- @ref LLP 0061#2-the-capability-index-registry-lite-with-witnesses — witnesses, GAP rows, and the joined surfaces -->

All author-facing capabilities. **GAP** rows are owned; shipped rows need a
**witness**. The [surface map](./surface-map.md) checks routes and host-ops.
Owner: `ccheever`; label gaps `guide-gap`.

## Capabilities

| id | What | Aliases | Targets | Maturity | Witness | Authorities | Page |
| --- | --- | --- | --- | --- | --- | --- | --- |
| backend.schema | Declare tables, fields, indexes, sync | schema, tables, model, field validators, v.json | local | shipped | `defineSchema` in packages/snapback-codegen/define.mjs | llp/0037, llp/0004 | getting-started/your-first-backend.md |
| backend.structured-stored-fields | Typed opaque arrays/objects, including non-authoritative principal snapshots; interior not queryable | table array, v.array field, v.object field, principal array, recipient snapshot, structured storage | local | experimental | packages/snapback-codegen/structured-stored-values.test.mjs | llp/0211, llp/0115 | GAP (interior queries; owner: LLP 0115 CV-4b, review: 2026-08-18; issue: issues/20260727-backend-bakeoff-improvement-program.md); getting-started/your-first-backend.md |
| backend.stored-enums | Closed string domains on stored fields: 2–7 literals, fail-closed at every writer, literal-union types, scanned narrowing | enum, stored enum, literal union field, closed domain, role enum, varchar enum, v.union table field | local | shipped | packages/snapback-codegen/stored-enum-authoring.test.mjs | llp/0004, llp/0007 | getting-started/your-first-backend.md |
| backend.identity-columns | Server-owned monotonic numeric/default columns (SQL IDENTITY, SERIAL) declared on a field | identity column, serial, autoincrement, sequence column, default value, GENERATED AS IDENTITY | none | design-only | llp/0191-scale-architecture-revisits.research.md (§3; no shipped witness) | llp/0191, llp/0007 | GAP (owner: LLP 0191 identity Decision, review: 2026-09-15; issue: issues/20260808-numeric-identity-default-columns.md); getting-started/your-first-backend.md |
| backend.migrations | Reviewed destructive schema evolution (LLP 0081): explicit intents including same-name JSON→structured successor-generation conversion, deterministic preview + digested observation, digest-acknowledged approval, restore-derived rehearsal, apply with consumed rehearsal receipt, receipt-vs-journal verify; `rollback` declared-but-unbuilt | migration, schema migration, alter column, rename column, drop field, backfill, v.json to v.object, ConvertJsonToStructured, snapback migrate | local | shipped | `MigrateCommand` in crates/snapback/src/cli.rs | llp/0081 | backend/migrations.md |
| backend.schema-evolution | Sessions schema evolution: complete-pair pin, managed successor, hash diagnostics, exact-carrier recovery without data loss | sessions schema change, expectedDeployment, partial load, successor activation | local | shipped | packages/snapback-cli/sessions-dev-loop.test.mjs | llp/0058, llp/0160, llp/0081 | backend/schema-evolution.md |
| backend.record-history | Bounded per-record version retention: `defineTable(...).history({ retainMs, maxVersionsPerRecord })` (≤ 30 days, 1–1,000 versions), captured at committed writes, consumed by host proof machinery; no author-facing read query | history, record history, version history, audit trail, time travel, retainMs, maxVersionsPerRecord | local | shipped | `history(` in packages/snapback-codegen/define.mjs | llp/0162 | backend/mutations.md |
| backend.functions | Queries/live queries/mutations/actions: declarative plans or colocated JS + same-file helpers; document/record/value result contracts incl. result-side `v.doc(table)` refs; manifest-derived handler/helper `ctx.db` types split read/write; exact client refs; runtime egress validation | query, mutation, endpoint, api, inline handler, result contract, results.documents, results.records, v.doc, GeneratedHandler, GeneratedQueryDatabase, ctx.refuse, refusals, application error code, domain error, app refusal, mutationPlan, letBind, insertEach, return binding, declarative mutation | local | shipped | packages/snapback-codegen/define.mjs | llp/0004, llp/0009, llp/0101, llp/0108, llp/0127 | backend/queries.md |
| backend.runtime-values | Derive deterministic per-invocation time and fresh identifiers inside JavaScript handlers | server time, server clock, timestamp, generated id, UUID, Date.now, Math.random | local | shipped | `runtime.now` in packages/snapback-harness/ctx-bootstrap.js | llp/0051, llp/0065 | backend/trusted-runtime-values.md |
| backend.mutation-settlement-identity | Mutation-only client identity and server-namespaced digest for replay-stable effects; genuine re-entry preserves it, while hosted returns null. | ctx.mutation.settlement, settlementId, replay-stable effect, provider idempotency key, effect dedupe | local | shipped | `recordEffectIntent` in crates/snapback/tests/mutation_settlement_identity_v0.rs | llp/0043 | backend/mutations.md |
| backend.standard-patterns | Generate owner CRUD, unique lookup, owner/membership keyset pages | CRUD generator, pagination, callable pagination, membership pages, trusted defaults | local | partial | `defineOwnedCrud` in packages/snapback-codegen/standard-patterns.mjs | llp/0051, llp/0065, llp/0100 | backend/standard-patterns.md |
| backend.relational-queries | Bounded two-source equi-joins with explicit visibility, closed projections, and transactionally maintained projection tables (`defineRelationalQuery`, `defineMaintainedProjection`, stable capability since 2026-07-26) | joins, relational queries, denormalized reads, materialized views, conversation membership, message sender, chat joins, defineRelationalQuery, defineMaintainedProjection, Convex joins, Supabase joins | local | partial | `defineRelationalQuery` in packages/snapback-codegen/define.mjs | llp/0080, llp/0065 | backend/relational-queries.md |
| backend.bounded-children-v1 | Experimental bounded child pages with protected relation incarnations; contributor-source local only, with public/hosted publication GAPs | one-to-many, parent children, relation incarnation, bounded child page | local | partial | crates/snapback/src/local-relation-activity-publication.v1.json | llp/0104, llp/0108, llp/0101 | GAP (public/hosted publication; owner: Charlie, review: 2026-08-20; issue: issues/20260727-backend-bakeoff-improvement-program.md) |
| backend.snapshot-batch-v1 | Experimental local 2–8-node composition: complete `bounded-children.v1` plus, in v2 (2026-08-06), `relational-query.v1` joins; one pinned authoritative snapshot/invocation; structural parent-authorization dedup; all-or-nothing tuple sealed only via bounded-child parents; one LLP 0157 `sbsb1`/`sbsb2` continuation; cursor-free-first-page `live_replace`; `retention:"none"`. Hosted/public-package publication: nonclaims. | snapshot batch, mixed snapshot batch, board view, join plus child lists, multiple child lists, one snapshot, composite query, defineSnapshotBatchQuery | local | shipped | `snapshot_batch_three_node_cursor_sealing_and_live_acceptance` in crates/snapback/src/local/tests/engine.rs + schemas/capability.manifest.local-dev-sqlite-ibex.json (`snapshot_batch_v1`, `snapshot_batch_v2`) | llp/0135, llp/0157, llp/0080, llp/0113 | backend/snapshot-batches.md |
| backend.single-table-v1 | Experimental host-derived `single_table_v1@1`: exact public authority-independent one-table live query; no app authority/retention assertion; single-node, 1,024-entry QMK refusal; whole-result/no-cursor ordered/limited `live_replace`; Arm-A retention without lease. Contributor carrier advertises it; qualified clean packages ship since 0.1.11. Remote/hosted GAPs. | single table, rqsEligible, qmk1, authority-independent retention, single node | local | shipped | crates/snapback/src/local-persistent-store-publication.v1.json + schemas/capability.manifest.local-dev-sqlite-ibex.json (`single_table_v1`) | llp/0157, llp/0166, llp/0110, llp/0113, llp/0270 | sync/offline-and-retention.md |
| backend.write-activity-v1 | Experimental atomic source write + provenance-bearing activity insert; contributor-source local only, with public/hosted publication GAPs | audit log, activity feed, transactional activity, write receipt | local | partial | tests/conformance/relation-activity-publication-v1.receipt.json | llp/0104, llp/0108, llp/0043, llp/0101 | GAP (public/hosted publication; owner: Charlie, review: 2026-08-22; issue: issues/20260727-backend-bakeoff-improvement-program.md) |
| backend.text-search | Portable term, phrase, prefix, exclusion, and equality-filter search with deterministic ranking, bounded highlights, public/owner/membership (seat-per-resource) visibility, authority-profile role-lattice lowering, and AEAD keyset cursors | full text, text index, phrase, prefix, highlights, membership search, authority profile search | local | shipped | `defineSearchQuery` in packages/snapback-codegen/define.mjs | llp/0073, llp/0065, llp/0100, llp/0240 | backend/text-search.md |
| backend.streamed-actions | Bounded pull-driven response streaming in actions: `ctx.fetchStream`, `ctx.streamAttempt` lease/settlement, durable progress via mutations | streaming, fetchStream, ReadableStream, AI tokens, SSE bytes | local | partial | `open_response_stream` in crates/snapback/src/server.rs | llp/0076, llp/0075 | backend/streamed-actions.md |
| backend.seed | Deterministic declarative seed + reset | seed, fixtures, sample data | local | shipped | route /_snapback/api/app/reset | llp/0004 | getting-started/your-first-backend.md |
| backend.versioned-seed | Experimental local seed identity: pure match, idempotent install/reset, preview/clear; hosted custody GAP. Principal/media fixtures use the linked app recipe. | seed version, seed identity, reset-install, fixture drift, sessions fixture install | local | partial | tests/conformance/versioned-seed-v1.manifest.json | llp/0103 | backend/versioned-seeds.md |
| backend.provisioning | Idempotent app provisioning (ensureApp) | ensure, deploy app, load app | local | shipped | route /app/ensure | llp/0034 | getting-started/your-first-backend.md |
| backend.codegen | Generate one digest-verified `snapback/generated/` graph for both profiles; `_generated/` refuses | codegen, artifacts, custody, _generated, contractMetadata, npm-only typecheck | all | shipped | packages/snapback-cli/familiar-dev-loop.test.mjs | llp/0010, llp/0012, llp/0253 | getting-started/generated-artifacts.md |
| backend.handler-runtime-profile | Current-rule handler admission profile + complete non-replacing generation preflight: operation selection, build-bound diagnostics, exact definition paths, separate executable/raw-evidence digests | handler runtime profile, generate --check, Can I import a helper?, Can I use Node crypto?, BUNDLE_UNSUPPORTED_IMPORT, SNAPBACK_INLINE_HELPER_INADMISSIBLE, SNAPBACK_CODEGEN_DEFINITION_NOT_EXPORTED, SNAPBACK_CODEGEN_DEFINITION_VALUE_UNSERIALIZABLE | all | shipped | packages/snapback-codegen/handler-runtime-profile.test.mjs + packages/snapback-cli/generate-check.test.mjs | llp/0237, llp/0108 | backend/handler-runtime.md |
| backend.batch-reads | Experimental local exact-id and complete-unique-key batches; unsupported targets refuse at generation | batch get, getMany, uniqueMany, N+1, dataloader, IN clause, where id in, Convex db.get loop | local | partial | crates/snapback/src/runtime/host_glue.rs batch tests + crates/snapback/tests/local_v0.rs snapshot test + packages/snapback-harness/envelope.test.mjs host-call test | llp/0248 | backend/queries.md |
| backend.handler-typescript | Single-file `.ts`/`.mts` handler modules under the pinned syntax-erasing `bounded-handler-typescript-v1` profile | typescript handler, .ts backend, ts handler, type-check handler, erasure | local | partial | `transformTypeScriptHandler` in packages/snapback-codegen/typescript-transform.mjs | llp/0246 | GAP (page pending multi-file custody; owner: LLP 0246, review: 2026-09-15; issue: issues/20260812-0246-remaining-rollouts-stacked-on-0237.md); getting-started/generated-artifacts.md |
| backend.familiar-profile-v1 | Familiar TS: generated API, scalar queries, assets, Expo Router, first-party bearer-only SecureStore custody | familiar profile, snapback-familiar-ts-v1, authoringProfile, Familiar TypeScript, api.todos.list, SecureStore custody, Expo Router familiar | local | partial | packages/snapback-codegen/familiar-phase-b.test.mjs + packages/snapback-expo/app-binding.test.mjs + packages/snapback-contract/auth-custody-secure-store.test.mjs | llp/0253, llp/0252, llp/0059 | backend/familiar-profile.md |
| authoring.declaration-suggestions | Review/apply result-only candidates; committed declaration stays authoritative | infer result, suggest contract, write my result contract, convex-style inference | local | partial | packages/snapback-codegen/declaration-suggestion.test.mjs | llp/0245, llp/0108 | getting-started/the-authoring-loop.md |
| backend.query-semantics | Read sets, snapshots, commit versions, conflict validation | consistency, transactions, conflicts | local | shipped | route /query/{name} | llp/0003, llp/0004, llp/0007 | backend/queries.md |
| backend.sequences | Experimental incarnation-scoped dense `ctx.sequence.allocate` with replay/contention/exhaustion evidence; contributor-source local only | sequence, counter, ticket number, invoice number, monotonic allocation, maxEncodedBytes | local | partial | crates/snapback/src/local-sequence-allocation-publication.v1.json | llp/0135, llp/0128, llp/0113, llp/0157 | GAP (public/hosted qualification; owner: Charlie, review: 2026-09-30; issue: issues/20260808-main-drift-sequence-allocation-publication.md); backend/sequences.md |
| backend.actions | Actions with gated outbound fetch: global `fetch` and target-portable host-mediated `ctx.fetch`, in closed-script module handlers or the inline form | action, fetch, ctx.fetch, side effects, notification, webhook | local | shipped | route /action/{name} | llp/0004, llp/0009, llp/0049 | backend/actions-and-fetch.md |
| backend.assets | Local assets: generated intents, resumable upload, trusted image/video finalization, typed attach, strict/signed/public delivery, grants, GC, cuts, key rotation. `via-references` remains; no byte backup, transcoding, or hosted claim. | files, images, video, familiar video upload, defineAssetUpload, asset grant, grants: true, ctx.assets.grant, ctx.assets.activate, ctx.assets.revoke, pending grant, view once, browser/native upload, SVG, ImagePicker, asset export, signing key rotation, Supabase Storage, Convex generateUploadUrl, sessions fixture avatar | local | partial | schemas/capability.manifest.local-dev-sqlite-ibex.json + crates/snapback/src/local/tests/engine.rs (grant lifecycle/cut) + tests/acceptance/asset-conformance-v1.mjs + tests/acceptance/familiar-video-asset-v1.mjs + demos/file-drop/tests/acceptance/browser-relay.mjs + demos/messaging-snapback/tests/acceptance/headless.mjs | llp/0044, llp/0210, llp/0220, llp/0253 | backend/assets.md |
| assets.media-field.v1 | Finalized-only top-level `v.media()` with same-snapshot `MediaRef`, exact mutation settlement, and empty-safe delivery controller; no collection, command, class-M activation, or playable-video claim. | v.media, MediaRef, useSnapbackMedia, profile image | local | shipped | packages/snapback-codegen/media-field-authoring.test.mjs + tests/acceptance/fixtures/media-profile/snapback/schema.mjs + packages/snapback-react/assets.test.mjs + crates/snapback-kernel/src/storage/tests.rs | llp/0239; llp/0244 | backend/media-happy-paths.md |
| assets.media-collection.v1 | Bounded ordered `assetCollection`: generated ops, stable item ids, finalized-only admission, sharing ceiling, GC/quota/cut custody, `useSnapbackMediaCollection` with sibling isolation. | assetCollection, media array, useSnapbackMediaCollection | local | experimental | packages/snapback-codegen/media-collection-authoring.test.mjs + crates/snapback-kernel/src/storage/tests.rs + packages/snapback-react/assets.test.mjs | llp/0239 | GAP (physical-device Expo + published-package rerun; owner: LLP 0239 R3, review: 2026-08-26; issue: issues/20260815-finish-media-happy-path.md); backend/media-happy-paths.md |
| assets.media-command.v1 | Closed `defineMediaCommand`: bounded multi-upload task, command-only mutation, atomic parent/collection/grant staging, ambiguity/retry/residue per LLP 0180, projected through `app.commands` on every client arm. | defineMediaCommand, mediaCommand | local | experimental | packages/snapback-codegen/media-command-authoring.test.mjs + packages/snapback-client/commands.test.mjs + crates/snapback-kernel/src/storage/tests.rs | llp/0239 | GAP (physical-device Expo + published-package rerun; owner: LLP 0239 R4, review: 2026-09-02; issue: issues/20260815-finish-media-happy-path.md); backend/media-happy-paths.md |
| clients.asset-signed-delivery | Signed issuance, TTL-refresh store, React hook | signed URL, assets.signedUrl, issuedUrlStore, useSnapbackAssetUrl, expiresAt | local | shipped | packages/snapback-react/assets.test.mjs | llp/0210 | backend/assets.md |
| clients.asset-upload | One-call File/Blob/picker upload; `task.done` settles on ready/rejected/cancelled/failed and only ready succeeds | assets.upload, task.done, upload terminal status, SNAPBACK_ASSET_RETRY_INELIGIBLE | local | shipped | packages/snapback-client/assets.test.mjs | llp/0210 | backend/assets.md |
| backend.expo-push-seam | Local Expo seam: session-bound token custody, host-authorized `ctx.push.send`, crash-safe handoff/receipt ledger, and advisory `ctx.realtime.hasFreshClient` input for skipping an attempt. Connectivity never proves observation or exactly-once delivery. Hosted remains a GAP. | device token, expo push token, ctx.push.send, connected client, skip push, DeviceNotRegistered | local | shipped | schemas/capability.manifest.local-dev-sqlite-ibex.outbound-actions.json (`expoPushSeam`, `connectedClientPredicate`) + packages/snapback-cli/fake-expo-push.test.mjs | llp/0143, llp/0222, llp/0045, llp/0057, llp/0059, llp/0070 | backend/expo-push.md |
| backend.notifications | First-class durable notification/effect delivery. The connected-client predicate is advisory only; exactly-once arbitration belongs to this capability's durable intent lifecycle. | notifications, push, email, delivery, effects, exactly once | none | design-only | schemas/capability.manifest.local-dev-sqlite-ibex.json (`notifications: false`; explicit `notifications` gap) | llp/0045, llp/0222 | GAP (owner: Charlie, review: 2026-08-24; issue: issues/closed/20260728-guide-gap-assets-and-notifications-capability-rows.md) |
| backend.observability-v1 | Shipped local Phase-1 backend telemetry with a generation-bound sibling store, operation-class spans, bounded retention and rollups, typed agent-facing queries, Health/Logs projections, and retained clean-release idle/benchmark evidence; hosted arms and declared product analytics remain later capabilities | telemetry, observability, health, logs, metrics, traces | local | shipped | tests/acceptance/telemetry-phase1-evidence.v1.json | llp/0154 | operating/observability.md |
| backend.error-tracking-v1 | Local Phase E0/E1 failure classification; deterministic grouping, including first-ordered authority + full raw carrier facts for multiple unhandled rejections; retained raw exemplars; release-aware issue lifecycle; typed CLI/MCP operations; Errors/Health console projections. Unbuilt: hosted grouping, E2 alerts, E3 client ingest. | error tracking, issues, fingerprints, exceptions, failures | local | partial | route /_snapback/api/errors/issues | llp/0156, llp/0154, llp/0108 | operating/error-tracking.md |
| backend.vector-search | Experimental bounded exact k-NN on declared fixed-width binary64 vector fields: pinned `dot`/`l2sq` arithmetic; public/owner visibility partitions; exact equality filters; stored fields; synchronous SQLite maintenance; digest-recheck quarantine. Nonclaims: ANN, embedding computation, live/paginated/offline search, hosted targets, PostgreSQL, sensitive fields. | vector, embeddings, similarity, semantic search, RAG, exact k-NN | local | shipped | schemas/capability.manifest.local-dev-sqlite-ibex.json (`vector_search_v1` + `vectorSearch`) + `defineVectorQuery` in packages/snapback-codegen/define.mjs | llp/0132, llp/0073 | backend/vector-search.md |
| backend.cron | Scheduled execution | schedule, cron list, cron status, cron tick, run cron now, force tick | local | shipped | route /_snapback/api/cron | llp/0028 | backend/cron.md |
| backend.jobs-one-off | Experimental LLP 0070 one-off durable work: transaction `ctx.jobs.enqueue`, default queue, delayed availability, fenced claims, append-only attempts, job rows, bounded enqueue/confirmed-mutation facts, generated status live query, injected-clock drain, and secret-read-leased admin inspect. `jobs_one_off_v1` stays experimental; no durable-background-work class while LLP 0070 is pre-Accepted. | one-off jobs, runAfter, scheduler, durable work, enqueue, background jobs, job status, retryable by design, dead-letter, DLQ, succeeded after retry, secret-read lease, job drain, drain jobs | local | partial | route /_snapback/api/jobs/drain | llp/0070, llp/0121, llp/0115 | backend/jobs.md |
| realtime.live-queries | Subscribe to a query; snapshot + replace/delta updates. Actions can query the advisory 15-second connected-client predicate. | subscription, realtime, connected client, hasFreshClient | local | shipped | route /live/{name}/subscribe + capability manifest `connectedClientPredicate` semanticsVersion 2 | llp/0008, llp/0222 | realtime/live-queries.md |
| realtime.durable-push | Durable WebSocket push lane; connection axis | websocket, stream, push, connection state, connection disconnect, disconnect client, force disconnect | local | shipped | route /live/{connection_id}/stream | llp/0008, llp/0034 | realtime/live-queries.md |
| realtime.ephemeral | Typed ephemeral rooms/React presence: typing, cursors, TTL, activity/Expo withdrawal, 1s delivery budget. Membership-backed rooms enforce current-row subscribe/publish and removal invalidation (source-current; unreleased after 0.1.23); role narrowing/downgrade kick are unshipped. | presence, cursors, ephemeral, allow.members, useSnapbackPresence, useSnapbackActivityPresence, typing indicator, Supabase Presence, Supabase Broadcast | local | shipped | route /ephemeral/publish + demos/messaging-snapback/tests/acceptance/headless.mjs | llp/0013, llp/0056, llp/0107, llp/0114, llp/0247, llp/0257 | realtime/ephemeral-state.md |
| realtime.snapshot-bundles | RQS bundles: one-commit route snapshots with resume; register mode arms live owners. Structured args admit nested `routeParam()`. Experimental local mixed routes register only live children; legacy adoption stays prove-or-fresh. `publicInline` powers Channel A. Cloudflare read ships; register/mixed are deferred. | bundle, preload, resumable snapshot, RQS, mixed route, publicInline, routeParam, query context | local, cloudflare | partial | route /app/bundle + schemas/capability.manifest.local-dev-sqlite-ibex.json (`mixed_bundle_boot_v2`) | llp/0090, llp/0092, llp/0157, llp/0166 | realtime/snapshot-bundles.md |
| sync.offline | Retained queries, outbox, replay, optimistic overlays (Contract arm: lease-bounded protected retention, derived overlays, `Parity` under LLP 0043's proof rule) | local-first, outbox | local | shipped | route /outbox/{connection_id} | llp/0043, llp/0052 | sync/offline-and-retention.md |
| sync.offline-js-arm | JS/React offline: IndexedDB/Web Locks, Node files, memory fallback; qualified durable stores retain mounted owner-admitted public-exact queries. Protected/opaque/memory behavior is unchanged; durable outbox, optimistic restart rebase, and platform drain ship. Chrome proves public retention/opaque refusal. Expo SQLite awaits device qualification; prediction is never authority. | offline browser, cold boot, IndexedDB, public retention, optimistic replay, platform drain | local | partial | packages/snapback-client/materialization-bridge.test.mjs + demos/browser-local-first/tests/acceptance/browser-public-witness.mjs | llp/0043, llp/0090, llp/0129, llp/0155, llp/0166, llp/0218, llp/0270 | sync/offline-and-retention.md |
| sync.offline-js-arm-sessions | JS browser-session/agent-custody queue: enqueue captures authority, principal scope, and custody lineage. Same-principal replacement strands rerecordable work for explicit read/discard/re-record with a new id; principal change privacy-deletes old bytes and reports a count before successor observation. Stale-auth replay strands; content refusal fails. Server-refusal-only v1: no LLP 0053 queue-obligation port (Contract asymmetry). | sessions custody, agent custody offline, strand, re-record, cross-principal delete, offline auth queue | local | shipped | demos/card-game/tests/acceptance/offline-sessions-custody.mjs + packages/snapback-client/outbox-custody.test.mjs | llp/0043, llp/0053, llp/0129 | sync/offline-and-retention.md |
| sync.local-persistent-store | LLP 0166 v3 store/hydration per `clientStoreId`: trusted activation, completeness proof, preload, checked relaunch, and durable programmatic demand. `single_table_v1@1` may retain; protected classes need leases. IndexedDB/Node-file pass; memory refuses. Expo SQLite awaits device qualification; remote/Cloudflare are nonclaims. | retained render, materialization, completeness proof, hydration, preload, relaunch, result transform | local | partial | crates/snapback/src/local-persistent-store-publication.v1.json + tests/conformance/result-transform-ship-gate-v1.receipt.json | llp/0166, llp/0157, llp/0135, llp/0110, llp/0094, llp/0270 | sync/offline-and-retention.md |
| sync.offline-js-arm-protected | Lease-bounded protected retention for generated JS/React live queries: exact namespace, atomic fresh-query/lease custody, equality expiry, and mismatch delete-before-render | offline auth browser, lease js, private chat offline | local | partial | packages/snapback-client/rqs-resume.test.mjs (custody matrix + fresh-client offline handoff) | llp/0043, llp/0053, llp/0129 | GAP (real-process restart witness; owner: orchestrator, review: 2026-08-26; issue: issues/20260801-js-arm-integrated-authenticated-restart-witness.md); sync/offline-and-retention.md |
| sync.settlement-bounded-skew | `settlement.bounded_skew`: a mutation-declared, structurally direct `runtimeNow()` field may accept a lane-L captured time only within its declared bound; mixed sinks stay server-derived and lane Q remains unbounded replay-accept. The server path and receipt fact ship, while local capture/execution remains outside this slice. | bounded skew, local settlement, runtimeNow, claim ledger | local | partial | crates/snapback/src/local.rs | llp/0133 | GAP (local capture/executor; owner: LLP 0155 Stage 2, review: 2026-08-28; issue: issues/20260802-0133-receipt-wire-coordination.md) |
| api.external-exposure | Opt-in `/api/v1` + CORS; local OAuth/PKCE and remote MCP; capability links, durable watches, and approval-gated mutation/action effects; read-only `ask` v1 with provider credentials, result schemas, durable token/result-volume budgets, and HMAC provenance receipts. Telemetry stays lossy; billing metering is a gap | external api, oauth, remote mcp, approval, effects, capability links, watches, ask, near-data ai, api budgets | local | partial | route /effects + crates/snapback-kernel/src/storage/pending_effects.rs + route /api/v1/ask + crates/snapback-kernel/src/storage/ask_spend.rs | llp/0204, llp/0031, llp/0055, llp/0150 | backend/external-api.md |
| auth.sessions | Server-minted sessions; email-code and email+password login; server-derived principals | login, signin, identity, session, principal binding, app user table, identityBinding, who am I, am I signed in, whoami, currentAuthorizationScope, settledView | local | shipped | route /auth/exchange | llp/0039, llp/0057, llp/0059 | auth/sessions-and-principals.md |
| auth.passwords | First-class session email+password: noninteractive signup/signin/change/set; server-side argon2id (19456/2/1) outside writer lock; bounded KDF concurrency; app-declared 8–128-byte password minimum (default 12, maximum 1024); declared testable lockout (10 failures→15 min); one-time self-serve recovery codes. Uniform refusal for wrong password/unknown identifier/locked; lock state never on wire. Catalog v4 required; v3 reports provider unready. Unready LLP 0045-prerequisite nonclaims: production blind-accept signup/mail reset. Local reset: capture-mailbox only. | password, email password, signup, password login, password auth, minimumLength, minimum password length, hash password, argon2, scrypt gateway, recovery codes, lockout, GoTrue, Supabase auth, password reset | local | shipped | route /auth/password/signin + `authPasswordSignIn` in packages/snapback-client/index.mjs | llp/0227, llp/0214, llp/0215, llp/0011 | auth/passwords.md |
| auth.external-identity-broker | Local bridges: adopted bearer for headless/native, or trusted-server one-use exchange into browser coordinator custody; mint/capture remain dev/test/demo only | native login, external identity, broker, adopted bearer, browser external sign-in, signed assertion, issuer subject | local | partial | `createExternalSessionClient` in packages/snapback-client/index.mjs + demos/browser-auth/tests/acceptance/browser-auth.mjs | llp/0024, llp/0057, llp/0096, llp/0151 | recipes/browser-auth.md |
| auth.browser-session-custody | First-party browser/Expo-web auth: `createSnapbackAppClient`/`client.auth`, React auth/principal hooks, durable IndexedDB/Web Locks; XSS-readable, not sender-constrained | app auth bootstrap, createSnapbackAppClient, client.auth, useSnapbackAuth, useSnapbackCurrentPrincipal, persistent login | local | shipped | packages/snapback-react/auth-bootstrap.test.mjs | llp/0258, llp/0238, llp/0059 | auth/passwords.md |
| auth.application-bootstrap-native-custody | Source-current iOS and Android admit durable-required at `single-runtime`; UNPUBLISHED behind issues/20260816-custody-first-publish-gate.md. Simulator evidence only: physical-device (D), backup/migration, and cross-process fencing remain unclaimed; a share extension was exercised, while the built/embedded NSE is not invokable via `simctl push`. | native custody, Android force-stop, iOS share extension | ios + android | shipped | demos/native-custody-probes/evidence/20260816T214639Z-0a6c91ed-phase2-android + demos/native-custody-probes/evidence/20260817T023429Z-1c2624fb-phase2-ios + packages/snapback-expo/provider-native-custody.test.mjs | llp/0258, llp/0263 | auth/passwords.md |
| auth.scoped-queries | Caller-bound filters enforce reads; `authScopeField` is invalidation/retention metadata | hidden data, per-user, row security, Supabase RLS | local | shipped | `authScopeField` in packages/snapback-codegen/define.mjs | llp/0039, llp/0053 | auth/sessions-and-principals.md |
| auth.table-visibility | Table owner/membership policy composed into all shipped read plans and ordinary `ctx.db`; `anyOf`, resource `_id`, explicit `ctx.db.elevated` | table visibility, joins, bounded children, snapshot batch, elevated read | local | shipped | `compose_declared_table_visibility` in crates/snapback-kernel/src/storage.rs | llp/0231, llp/0056 | auth/protecting-data.md |
| auth.invalidation-barrier | Authorization invalidation; logout blanking | logout, revoke, invalidation | local | shipped | route /live/authorization-invalidation/acknowledge | llp/0053 | auth/protecting-data.md |
| auth.authorized-leases | Lease-bounded offline retention of authorized reads | offline auth, lease, retained | local | shipped | route /query/{name}/authorized-lease | llp/0059 | auth/protecting-data.md |
| auth.target-honesty | Per-target auth claims and non-claims; readiness reporting | hosted auth, production auth | all | shipped | `AuthProgramReadiness` in crates/snapback-types/src/auth/mode.rs | llp/0060 | auth/targets.md |
| auth.sender-constrained-browser | Hosted-only non-extractable browser custody, HTTP/WebSocket sender proofs, nonce rotation, and replay refusal; no current adapter has positive admission | DPoP, browser key, credential theft, hosted sessions | single-instance-container-vm | partial | `HostedBrowserSnapbackClient` in packages/snapback-client/hosted-browser.mjs | llp/0077, llp/0060 | auth/targets.md |
| auth.agent-principals | Agent principals and scoped grants | agent auth, grants, pairing | local | shipped | route /auth/agents/pair | llp/0055 | auth/agent-principals.md |
| auth.agent-registration | Sessions-only open or user-invited agent registration, atomically creating the agent principal, stable identity, and initial `sbac_` credential; user invitations require operation-bound step-up and are single-use | register agent, create agent, invite agent, agent credential | local | shipped | route /auth/agents/register | llp/0055, llp/0204 | auth/agent-principals.md |
| auth.logical-transfer | Contributor-source logical export/import of principal, ownership, identity, deactivation, and scope-basis facts; empty-v2 import rotates authorization identity and mints no authority | auth export, auth import, move identities, no resurrection | local | partial | `auth_logical_import` in crates/snapback/src/cli.rs | llp/0055, llp/0057 | auth/logical-transfer.md |
| auth.scoped-roles | Scoped roles/memberships plus one-command atomic creation with a bounded transition-checked roster | roles, membership, group creation, atomic roster | local | shipped | `generated_bootstrap_atomically_creates_resource_and_protected_holder` in crates/snapback/src/runtime/host_glue.rs | llp/0056, llp/0100 | auth/scoped-roles.md |
| authority.profile.v1 | Local app-table profile (incl. dedicated React/Expo lifecycle hooks: useSnapbackAuthorityRoster/MyRole/Mutation): one finite role hierarchy drives table/handler admission, table visibility, and membership-visible search; AEAD-cursor `list`, `myRole`, transition-derived mutations, durable authority receipts, versioned dependence, and no private row ids through the generated facade. References work through ordinary clients and generic React hooks; dedicated profile hooks, assets, hosted and system profiles remain absent. | authorityProfile, role hierarchy, declarative membership, roster, profile search, myRole, invite, join, leave, change role, transfer owner, remove member, authorityTransitions, useSnapbackQuery | local | shipped | demos/team-chat/tests/acceptance/headless.mjs + demos/rbac/tests/acceptance/rbac.mjs + packages/snapback-codegen/rbac-authoring.test.mjs + crates/snapback/src/runtime/host_glue.rs | llp/0240, llp/0056, llp/0231, llp/0238 | auth/scoped-roles.md |
| authority.custom.coarse-global | Per-operation online-only `authorization.custom` evaluator with declared table inputs, source-closed elevated read sites, visible completeness warning, conservative global reauthorization, terminal declared denial, and authorization-review facts. Precise `reauthorize-on-change`, pushdown, retention, protected-local execution, and hosted targets refuse. | custom authorization, policyInput, coarse global, evaluator, completeness warning, reauthorize on change | local | shipped | packages/snapback-codegen/custom-authorization.test.mjs + crates/snapback/src/live_matcher.rs + crates/snapback/src/runtime/host_glue.rs | llp/0240, llp/0146, llp/0173 | auth/scoped-roles.md |
| authority.inspection.v1 | AdminWrite effective-authority inspection for one profile generation, principal, scope, and closed operation/view; returns policy/backing/invalidation facts without a public oracle. | inspect authority, effective role, policy branch, profile generation | local | shipped | `authority_effective_inspection` in crates/snapback-kernel/src/membership_rules.rs | llp/0240, llp/0173 | auth/scoped-roles.md |
| clients.headless | The framework-neutral client (SnapbackClient) | http client, node client, sdk, client.run, SnapbackDiagnosticError, error guard, catch refusal, optional undefined, omit field | local | shipped | `SnapbackClient` in packages/snapback-client/index.mjs | llp/0012, llp/0247 | clients/headless.md |
| clients.dev-diagnostics | Bounded per-client structured v2 channel with dev-only console projection, React churn producers, canonical queued/wedged conditions, and headless/hook/observer inspection | dev warnings, diagnostics channel, churn detector, queued mutation warning, wedge, active conditions, useSnapbackDiagnostics, observeSnapbackDiagnostics, diagnosticsChannel | local | shipped | packages/snapback-react/dev-diagnostics-acceptance.test.mjs | llp/0219 | operating/diagnostics.md |
| clients.micro | Compiled Micro profile: capability-minimal published client entrypoints (`./micro`, `./micro/core`, `./micro/live`) — core-only generated entries keep live/outbox code unreachable; `./micro/live` is the smallest grant-owned polling live composition | micro client, microclient, compiled client, minimal client, small bundle, micro live | local | shipped | `createMicroCoreRuntime` in packages/snapback-client/micro-core.mjs | llp/0147 | clients/headless.md |
| clients.protocol | Versioned route/envelope/lifecycle contract and language-neutral conformance corpus | wire protocol, native client, conformance, snapback.v1 | local | shipped | `ClientStateMachine` in clients/swift/SnapbackClient/Sources/SnapbackClient/StateMachine.swift | llp/0093, llp/0094, llp/0095, llp/0096 | protocol/client-protocol.md |
| clients.swift | In-repository SwiftPM proving client for iOS/macOS: poll/local and live/local with session auth; not published, tagged, or consumable through a dependency declaration | swift, swiftui, ios, macos, SwiftPM dependency, package URL, proving client | local | partial | `SnapbackClient` in clients/swift/SnapbackClient/Sources/SnapbackClient/SnapbackClient.swift | llp/0064, llp/0093 | clients/swift.md |
| clients.non-js | Kotlin and Dart clients do not exist yet — an aspirational gap. The current non-JS surface is the Swift client (clients.swift) plus the versioned client protocol and language-neutral conformance corpus (clients.protocol), the intended base for future Kotlin/Dart arms | kotlin, compose, dart, flutter | none | design-only | llp/0093-client-protocol-and-native-clients.rfc.md (protocol + conformance corpus; no shipped Kotlin/Dart witness) | llp/0093, llp/0064 | GAP (owner: Charlie, review: 2026-09-02; issue: issues/closed/20260808-swift-arm-not-consumable.md) |
| clients.poll-hosted | Socketless hosted demand ownership and poll delivery | hosted polling, poll hosted | cloudflare | partial | cloudflare/src/coordinator.js | llp/0093, llp/0095 | GAP (owner: Charlie, review: 2026-09-04; issue: issues/20260728-hosted-lifecycle-carrier-and-custody-gap.md) |
| clients.external-store | Shared current-value/subscription store | external store | local | shipped | `createExternalQueryStoreRegistry` in packages/snapback-client/external-store.mjs | llp/0012, llp/0064 | clients/headless.md |
| clients.framework-bindings | React/Contract bindings | bindings | local | partial | `SNAPBACK_EXTERNAL_STORE_PROTOCOL` in packages/snapback-client/external-store.mjs | llp/0012, llp/0034, llp/0064 | clients/framework-bindings.md |
| clients.app-cli | Local artifact/served-envelope app CLI, brokered code mode, stable two-section `agentDigest.v1` introspection, and an experimental app-bound Ibex one-file build qualified on macOS arm64 and Linux x86_64 GLIBC 2.35. Public inspection still lacks row-count magnitudes and D1 verdicts; hosted targets remain a GAP. | app cli, code mode, introspect, agent digest, changed since, digest cursor, one-file executable | local | partial | `buildAgentDigest` in packages/snapback-app-cli/digest.mjs + scripts/build-app-bound-executable + packages/snapback-app-cli/code-mode-ibex.test.mjs + GitHub Actions run 30999145126 | llp/0062, llp/0146 | clients/app-cli.md |
| clients.contract | Contract adapter; metadata opt-in; bindings; boot | contract, exact, ui bindings, contractMetadata exact | local | shipped | `createSnapbackContractSurface` in packages/snapback-contract/index.mjs | llp/0005, llp/0021, llp/0034 | clients/contract-adapter.md |
| clients.contract-provider-generation | Generate provider-neutral artifacts or adapt a frozen foreign declaration over Snapback | provider declaration, contract sidecar generator, convex bindings, ContractDataProvider adapter, foreign declaration digest | local | shipped | `generateFromDeclaration` in demos/partiful-matrix/scripts/generate-contract-provider.mjs + `createCoterieSnapbackProvider` in demos/coterie/src/data/snapback-provider.ts + demos/coterie/tests/snapback-provider.integration.test.ts | llp/0063, llp/0266 | clients/contract-adapter.md |
| clients.contract-keyed-scopes | Binding-time keyed Contract queries with dedup, refcounts, and authority fencing | dynamic query, query args, dedup, selection | local | shipped | `createKeyedSnapbackContractProvider` in packages/snapback-contract/keyed-provider.mjs | llp/0034, llp/0063 | clients/contract-adapter.md |
| clients.mutation-outcomes | Settlements; settled/queued union; Exact three-fact projection; non-consuming `mutationStatus`/`subscribeMutation` observation | mutation state, timeout, retry, receipt, ambiguity, queued mutation union, mutation disposition, subscribeMutation, dispatch outcome | local | shipped | packages/snapback-client/outbox-store.test.mjs | llp/0043, llp/0063, llp/0218 | clients/contract-adapter.md |
| clients.outbox-drain | Outbox drain: headless/React auto lifecycle; manual escape; barrier/custody/backoff gates; earliest-auto shared-store owner with close transfer; writer-lock serialization across handles | outbox drain, auto drain, OutboxFlusher, offline replay automatic, drainNow, outboxDrain | local | shipped | packages/snapback-client/outbox-drain.test.mjs + packages/snapback-react/offline.test.mjs + demos/browser-local-first/tests/acceptance/browser-public-witness.mjs (offline→online drain) | llp/0043, llp/0218, llp/0270 | sync/offline-and-retention.md |
| clients.optimistic-overlays | Derived optimistic mutations + reconciliation | optimistic, overlays, latency | local | shipped | `deriveOptimisticReducer` in packages/snapback-contract/index.mjs | llp/0052 | clients/contract-adapter.md |
| clients.react | React/Expo provider: real-client generated reads; ordinary generated-IR optimistic projection and restart rebase; explicit optimistic answer class and reducer precedence; settled/queued union; platform drain; presence; offline facts; Strict Mode/HMR | react, expo, hooks, useSyncExternalStore, useSnapbackQuery, Convex useQuery, generated optimistic mutation, optimistic rollback, queued mutation, useSnapbackSettledMutation, outboxDrain, drainNow, projectRecordFields, presence, query groups, hmr, offline freshness, outbox badge, app refusal | local | shipped | packages/snapback-react/generated-optimistic-default.test.mjs + packages/snapback-react/optimistic.test.mjs + packages/snapback-react/offline.test.mjs | llp/0012, llp/0043, llp/0064, llp/0107, llp/0129, llp/0133, llp/0155, llp/0218, llp/0270 | clients/react.md |
| clients.react-paged-list | React load-more: unique raw keyset, whole-result merge, volatile archive; protected cursors stay headless | paginated list, load more, infinite scroll, whole-result replacement, retained pages, pageKey | local | shipped | packages/snapback-cli/templates/media-feed/acceptance.mjs | llp/0100, llp/0114, llp/0196 | recipes/paged-list.md |
| clients.optimistic-mutation-view | Ordinary generated-IR projection for create/edit/delete/archive/reorder, inspectable server-only/filtered pending state, durable restart and automatic-drain replay, explicit prediction authority, deterministic rebase, and reflection-validated exact retirement; cross-table dependency degrades safely; explicit view remains compatible | generated optimistic mutation, createOptimisticMutationView, optimistic create, edit, delete, reorder, logical mint, idMap, restart replay | local | shipped | packages/snapback-client/generated-optimistic-default.test.mjs + packages/snapback-client/optimistic-rebase-acceptance.test.mjs | llp/0133, llp/0155, llp/0270 | clients/headless.md |
| clients.optimistic-create | Explicit typed React-provider wrapper over the ordinary generated-IR insert path, with canonical/provisional identity union, `select`, logical-mint settlement, replay recovery, and provider lifecycle ownership | React optimistic create, useSnapbackOptimisticCreate, optimistic insert hook, ProvisionalId, idMap, response loss | local | shipped | `useSnapbackOptimisticCreate` in packages/snapback-react/index.mjs + `optimistic-create.test.mjs` + demos/_kit/tests/provider-live-conformance.mjs | llp/0107, llp/0133, llp/0155, llp/0270 | recipes/optimistic-create.md |
| clients.surfaces | Generated application surfaces bind one screen/resource's reads, ordinary mutations, asset-bearing commands, raw assets, and presence around shared params; React and headless projections share canonical owners. The closed command task composes zero/one asset child with one ordinary mutation and reports truthful failure, ambiguity, and residue provenance. | defineSurface, useSurface, observeSnapbackSurface, application surface, screen surface, one hook for a screen, bind query and mutation, surface presence, conversation surface, useSnapbackSurface, defineCommand, useSnapbackCommand, image send, upload then mutate, command task | local | partial | `useSnapbackCommand` in packages/snapback-react/index.d.mts | llp/0179, llp/0180, llp/0114, llp/0176 | clients/surfaces.md |
| clients.react-expo | No-URL Expo boot and Expo web durable ship. Native durable-required ships in source at `single-runtime` on iOS and Android; UNPUBLISHED behind issues/20260816-custody-first-publish-gate.md. Android USB proven; iOS USB/LAN/release unclaimed. | Expo auth, SnapbackExpoProvider, useSnapbackAuth, auth.application-bootstrap.v1, --expo-platform web, snapback dev --expo | local | shipped | packages/snapback-expo/provider-auth-bootstrap.test.mjs + packages/snapback-expo/provider-native-custody.test.mjs + demos/native-custody-probes/evidence/20260816T214639Z-0a6c91ed-phase2-android + demos/native-custody-probes/evidence/20260817T023429Z-1c2624fb-phase2-ios | llp/0258, llp/0181, llp/0064 | clients/react-expo.md |
| clients.compose-existing-app | Backend-only initialization and dependency composition for adding Snapback to an existing React/Expo app without scaffolding a second whole project | compose into existing app, add Snapback, snapback init, backend initializer, create-expo-app | none | design-only | packages/snapback-cli/index.mjs (`snapback new` creates whole projects; no backend-only initializer) | llp/0196, llp/0181 | GAP (owner: unassigned, review: 2026-09-12; issue: issues/20260808-guide-gap-compose-snapback-into-existing-app.md); clients/react-expo.md |
| operating.server-lifecycle | Start/reuse/stop servers safely; ports; provenance; crash detection | run server, ports, bindPortExactly, lifecycle, watchdog, crash, prebuilt binary, seed reset | local | shipped | `startServer` in demos/_kit/server-process.mjs | llp/0010, llp/0030 | testing/acceptance.md |
| operating.instance-forks | Partial contributor-source finite-TTL local forks: expiry, bounded renew/inspect, resource admission, recover/diff, safe cleanup, parallel guidance, exact drop. Publishes only macOS/arm64 and Linux/x86_64; fail-closed deny-all; host-mediated isolation is non-promotable. Scoped source drift reports `requalificationDue`; bad frozen chain refuses. Unclaimed: released/npm parity, normal/public install, hosted/remote, merge-back. | fork, derived instance, fork per worktree, parallel suite, inspect, status, recover, renew, diff, automatic reap, resource limits | local | partial | crates/snapback/src/local-agent-safe-derived-deployment-fork-publication.anchor.json → tests/acceptance/receipts/agent-safe-derived-deployment-fork-publication.2026-08-04.v1.json | llp/0158, llp/0185, llp/0189 | operating/instance-forks.md |
| operating.store-durable-state | Contributor-source `snapback store describe` complete file-store durable-state registry: database; folded WAL/SHM/journal; auth/operation-detail/completeness-proof/resume keyrings; config; asset blobs; admin token; console credentials; instance-local/refuse classes. WAL-consistent atomic `snapback store export`: directly bootable directory + `store-export.json`. Push-token bytes scrubbed (LLP 0143); managed-branch/derived-fork stores refuse; not in a published closure. | backup, restore, copy database, clone database, move store, snapshot, disaster recovery, cp app.sqlite3, sqlite backup, WAL, auth-keyring.json, missing keyring, SNAPBACK_AUTH_PROVIDER_UNAVAILABLE, store describe, store export, durable state, sidecar, sibling files | local | partial | `durable_state_members` in crates/snapback/src/store_state.rs + `StoreCommand` in crates/snapback/src/cli.rs | llp/0192, llp/0057, llp/0143 | operating/backup-and-copy.md |
| operating.replication | Experimental self-hosted LTX: file/S3, encrypted keyring snapshots, frontier/status, checkpoint, restore, and MinIO G2 drill. No manifest, hosted, or G3 claim | replication, LTX, backup, RPO | local | experimental | `ReplicateCommand` in crates/snapback/src/cli.rs | llp/0188 | operating/replication.md |
| operating.agent-safe-storage | Registered Experimental `agent_safe_storage_v1` identity for the `agentSafe.v1` extension/component-fact vocabulary; it is not the `AgentSafeV1` core aggregate and no target currently supports it | operation envelope, explanation, agent-safe storage, capability facts | none | partial | `AgentSafeCapabilityExtensionV1` in crates/snapback-types/src/manifest/types.rs (Missing-only public projection) | llp/0162 | GAP (acceptance corpus, review, acceptance, and publication gates; all projections remain Missing; owner: Charlie, review: 2026-09-08; issue: issues/20260803-agent-safe-storage-acceptance-tail.md) |
| operating.packaged-dev-loop | Install native runtime; scaffold/generate/doctor/watch-load via one CLI. React/Vite starter: published and G1-qualified in the public `@expo/snapback-*` closure; guide/published-closure.json: newest published/qualified versions. Later than `newestQualified`: fast-path releases without their own qualification-arm receipt. | install, new app, create-snapback-app, react starter, vite, dev, one command, watch, sessions startup, packaged runtime | local | partial | `runDev` in packages/snapback-cli/index.mjs | llp/0041, llp/0058, llp/0114, llp/0103 | getting-started/the-authoring-loop.md |
| operating.inspect | Health/inspect projections | status, debug | local | shipped | route /inspect | llp/0017, llp/0031 | getting-started/the-authoring-loop.md |
| operating.secrets-config | App secrets/config: declare, set, verify — write-only | secrets, config, api keys, config verification, verify config, config verify | local | shipped | route /_snapback/api/config/status | llp/0036 | operating/secrets-and-config.md |
| operating.admin-console | Shipped browser debugger for Data, Functions, Realtime, Errors, Logs, capabilities, and guide docs, with master-derived fragment, device approval, and one-time operator claim-link handoffs | console, dashboard, admin link, claim link, remote browser, table inspection, browse table, table scan, inspect rows, see backend, debug backend, inspect function, inspect realtime, Expo debugging, React debugging | local | shipped | route /_snapback/admin | llp/0017 | operating/admin-console.md |
| operating.network-profiles | Named network condition profiles: server-side egress latency injection (mutation ack, live delta, query response lanes) with fail-closed local-only activation, startup-env and admin-API toggles, per-frame socket/poll markers, surface/principal activation provenance, and coalesced live deadlines | latency, slow network, network profile, delay, jitter, local-first testing | local | shipped | route /_snapback/api/debug/network-profile + host_ops.debug.networkProfileSet + demos/zero-bakeoff/protocol/environment.v2.json | llp/0167 | operating/network-profiles.md |
| operating.host-ops | Host operations over CLI/HTTP | cli, ops, host ops | local | shipped | route /_snapback/api/host-ops | llp/0024 | operating/host-ops.md |
| operating.agent-controls | Build/instance control discovery | controls list, controls describe, catalog, mcp-control, control mcp, agent setup, control tools | local | shipped | route /_snapback/api/control-catalog | llp/0184 | operating/agent-controls.md |
| operating.data-patch | Preview/apply one validated existing-row correction with per-row CAS, a single-use token, normal live notification, and explicit dev authority | data patch, direct edit, patch row, correct row, expected version, row version, apply token, devUser, devAdminBypass | local | shipped | crates/snapback/tests/data_patch_v1.rs | llp/0184, llp/0024, llp/0017 | operating/data-patch.md |
| operating.diagnostics | Stable SNAPBACK_* codes; exact current-checkout link/launch diagnosis + one binary-selection recovery record; installed disposable vertical-slice doctor; served-generation remediation sets for local/hosted operation/function/route/field refusals; shared decoder; local approval-aware stale-hash-fenced identifier repair via CLI/HTTP/MCP | diagnostics, errors, doctor, linker, stale binary, did you mean, remediation, apply repair, stale artifact, approval required, candidate fields, candidate functions | all | shipped | `apply_remediation` in crates/snapback/src/remediation.rs + host_ops.remediation.apply + `decodeRemediationSet` in packages/snapback-client/remediation.mjs | llp/0010, llp/0024, llp/0094, llp/0095, llp/0146, llp/0184 | operating/diagnostics.md |
| operating.declaration-conformance | Declared-vs-captured read/write reports, local strict opt-in, and registered-path verify aggregation; discovery, complete provenance, and Cloudflare capture remain GAPs | declaration drift, undeclared read, undeclared write, strict declarations, conformance, coverage, missingReads, read set, write set | local | partial | `aggregateConformance` in packages/snapback-cli/verify.mjs | llp/0146, llp/0127, llp/0010 | GAP (guide + remaining capture; owner: ccheever, review: 2026-09-10; issue: issues/20260803-0146-d1-d3-tranche.md) |
| operating.verify | Five-stage CLI done-oracle: source-regenerated artifact identity; digest-bound runtime readiness; local admission + registered-path D1 aggregation; generated capability resolution; registered acceptance execution; identity/test-byte-bound receipt; ordered next actions; unique mechanical recommendation. Nonclaims: live-target admission, automatic acceptance-path discovery, `acceptance.run`, product completeness, CV-14 semantic-review custody. | verify, done oracle, receipt, recommended next, test bytes, readiness | local | partial | `runVerify` in packages/snapback-cli/verify.mjs | llp/0146, llp/0010 | testing/verify.md |
| operating.served-guide | Server embeds guide pages + hash-bound flat.md and serves the root /llms.txt index | docs endpoint, llms.txt, served docs | all | shipped | route /llms.txt | llp/0061 | index.md |
| operating.guide-mcp | Read-only MCP resources for the build-bound guide corpus | mcp docs, guide resources | all | shipped | `run_stdio` in crates/snapback/src/guide_mcp.rs | llp/0061 | index.md |
| testing.acceptance | Headless-first acceptance harness and package-owned backend comparator profile | tests, acceptance, harness, comparator, backend bake-off, native push receipt | local | shipped | `runComparatorAcceptance` in packages/snapback-cli/comparator-profile.mjs | llp/0010, llp/0012, llp/0013, llp/0034 | testing/acceptance.md |
| testing.large-fixtures | Load a deterministic acceptance fixture past the 1,024-effect seed ceiling: gated ≤900-row batch-ingest mutation, loader session mint from the readiness descriptor, digest verification under the null/absent canonical form | large fixture, bulk load, bulk import, batch ingest, ingestFixtureBatch, seed ceiling, SNAPBACK_SEED_EFFECT_LIMIT_EXCEEDED, fixture loader, load test data | local | shipped | `fixtureLoadPlan` in demos/zerobugs/control/scripts/load-fixture.mts | llp/0109, llp/0183 | testing/large-fixtures.md |
| deploy.release-build | Target-neutral immutable release build, scan, content identity, and read-back verification | deploy build, release artifact, dirty preview, release digest | all | partial | `buildRelease` in packages/snapback-cli/index.mjs | llp/0072 | deploying/releases.md |
| deploy.target-control | Descriptor-first owner-only authority I/O: content-addressed preflight/deploy/backup/rollback/restore plans, pinned inspect, fenced apply, paused activation, redacted logs, verified backups, receipts, and MAC admission. Fly lease, supervisor, scoped credentials, and SQLite→Tigris recovery are proven. Public lifecycle/registration/online admission/migration/rollback remain GAPs; no hosted capability is advertised. | target add, doctor, deploy plan/apply/status/rollback, backup, restore, hosted admission, logs, audit | single-instance-container-vm | partial | `applyDeployPlan` in packages/snapback-cli/deployment-control.mjs | llp/0072, llp/0105 | deploying/releases.md |
| deploy.cloudflare | The hosted Cloudflare target, as far as it is real | deploy, hosting, production | cloudflare | partial | cloudflare/test/local-suite.mjs | llp/0014, llp/0040, llp/0049 | deploying/cloudflare.md |

Cross-repo seam: Contract/Exact *authoring* (language, components, styling,
motion, routing, Acto verification) is the **Exact guide**'s corpus —
`repo(exact):guide/index.md`. Reciprocally, Exact's `data.snapback`
external-authority row points back here (LLP 0061 §Relationship).

---

<!-- snapback-guide-source: guide/surface-map.md -->
---
title: Surface map
id: meta.surface-map
order: 3
audience: agent-first
capabilities: []
authorities: [llp/0024-agent-operating-surface.spec.md, llp/0031-server-route-taxonomy.spec.md, llp/0061-agent-first-snapback-guide.rfc.md, crates/snapback/src/server.rs, crates/snapback/src/admin.rs, crates/snapback/src/admin_link.rs]
examples: []
status: current
targets: [all]
maturity: shipped
reviewed: 2026-08-08
reviewed-authorities-digest: sha256:ecc5fe3900eaed7359f58b7e31139a32a633368e04b81e44db0110d621b48a9a
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
| /_snapback/api/auth/password/attempt | auth.passwords |
| /_snapback/api/auth/password/unlock | auth.passwords |
| /_snapback/api/auth/declared-clients | auth.agent-principals |
| /_snapback/api/auth/declared-clients/bless | auth.agent-principals |
| /_snapback/api/auth/declared-clients/delete | auth.agent-principals |
| /_snapback/api/auth/declared-clients/resume | auth.agent-principals |
| /_snapback/api/auth/declared-clients/suspend | auth.agent-principals |
| /_snapback/api/auth/integrations | auth.agent-principals |
| /_snapback/api/auth/integrations/{id}/resume | auth.agent-principals |
| /_snapback/api/auth/integrations/{id}/retire | auth.agent-principals |
| /_snapback/api/auth/integrations/{id}/suspend | auth.agent-principals |
| /_snapback/api/authority/effective | authority.inspection.v1 |
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
| /_snapback/api/cron | backend.cron |
| /_snapback/api/data/{table} | operating.admin-console |
| /_snapback/api/ephemeral/cleanup | realtime.ephemeral |
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
| /api/v1/action/{name} | backend.actions |
| /api/v1/ask | api.external-exposure |
| /api/v1/mutation/{name} | backend.functions |
| /api/v1/query/{name} | backend.functions |
| /api/v1/run | api.external-exposure |
| /.well-known/oauth-authorization-server | api.external-exposure |
| /.well-known/oauth-protected-resource | api.external-exposure |
| /app-api/agent-skill | api.external-exposure |
| /app-api/current | clients.app-cli |
| /app-api/openapi.json | api.external-exposure |
| /app-api/envelope/{sha256} | clients.app-cli |
| /app/bundle | realtime.snapshot-bundles |
| /app/ensure | backend.provisioning |
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
| /auth/agent-invitations | auth.agent-registration |
| /auth/agents/pair | auth.agent-principals |
| /auth/agents/register | auth.agent-registration |
| /auth/agents/revoke-self | auth.agent-principals |
| /auth/agents/rotate | auth.agent-principals |
| /auth/agents/token | auth.agent-principals |
| /auth/agents/token/release | auth.agent-principals |
| /auth/integrations/retire | auth.agent-principals |
| /auth/oauth/authorize | api.external-exposure |
| /auth/oauth/register | api.external-exposure |
| /auth/oauth/revoke | api.external-exposure |
| /auth/oauth/token | api.external-exposure |
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
| /auth/password/change | auth.passwords |
| /auth/password/reset | auth.passwords |
| /auth/password/signin | auth.passwords |
| /auth/password/signup | auth.passwords |
| /auth/refresh | auth.sessions |
| /auth/recovery/consume | auth.passwords |
| /auth/recovery/rotate | auth.passwords |
| /auth/request-code | auth.sessions |
| /auth/session | auth.sessions |
| /auth/step-up/request | auth.sessions |
| /capability-links | api.external-exposure |
| /capability-links/{id} | api.external-exposure |
| /capability-links/{token} | api.external-exposure |
| /capability-links/{token}/invoke | api.external-exposure |
| /effects | api.external-exposure |
| /effects/{id}/approve | api.external-exposure |
| /effects/{id}/deny | api.external-exposure |
| /watches | api.external-exposure |
| /watches/{id} | api.external-exposure |
| /watches/{id}/renew | api.external-exposure |
| /watches/{id}/resume | api.external-exposure |
| /watches/{id}/suspend | api.external-exposure |
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
| /mcp | api.external-exposure |
| /operations/explain | notAuthorFacing (unpublished LLP 0163 acceptance substrate) |
| /outbox/{connection_id} | sync.offline |
| /query/{name} | backend.functions |
| /query/{name}/authorized-lease | auth.authorized-leases |
| /push/tokens/register | backend.expo-push-seam |
| /push/tokens/unregister | backend.expo-push-seam |
| /streams/{attempt_token} | realtime.ephemeral |
| /streams/{attempt_token}/cancel | realtime.ephemeral |

## Host operations (LLP 0024 operation registry)

| Operation | Capability |
| --- | --- |
| host_ops.app.inspect | operating.host-ops |
| host_ops.app.reset | operating.host-ops |
| host_ops.cron.list | backend.cron |
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
| host_ops.auth.rehearsal.mint | notAuthorFacing (finite local auth rehearsal authority, LLP 0213) |
| host_ops.auth.rehearsal.exercise | notAuthorFacing (finite local auth rehearsal authority, LLP 0213) |
| host_ops.auth.rehearsal.revoke | notAuthorFacing (finite local auth rehearsal authority, LLP 0213) |
| host_ops.auth.rehearsal.status | notAuthorFacing (finite local auth rehearsal authority, LLP 0213) |
| host_ops.auth.rescueCollidingTable | operating.host-ops |
| host_ops.auth.integrationRetire | auth.agent-principals |
| host_ops.auth.integrationSuspend | auth.agent-principals |
| host_ops.auth.integrationResume | auth.agent-principals |
| host_ops.data.patch.preview | operating.data-patch |
| host_ops.data.patch.preview.impersonated | operating.data-patch |
| host_ops.data.patch.apply | operating.data-patch |
| host_ops.data.patch.apply.impersonated | operating.data-patch |
| host_ops.errors.issue | backend.error-tracking-v1 |
| host_ops.errors.issues | backend.error-tracking-v1 |
| host_ops.errors.transition | backend.error-tracking-v1 |
| host_ops.function.explain | operating.host-ops |
| host_ops.function.explain.impersonated | operating.host-ops |
| host_ops.remediation.apply | operating.diagnostics |
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
| host_ops.debug.live.forceResync | operating.host-ops |
| host_ops.host.start | operating.host-ops |
| host_ops.host.stop | operating.host-ops |
| host_ops.host.restart | operating.host-ops |
| host_ops.telemetry.events | backend.observability-v1 |
| host_ops.telemetry.export | backend.observability-v1 |
| host_ops.telemetry.stats | backend.observability-v1 |

---

<!-- snapback-guide-source: guide/conventions.md -->
---
title: Guide conventions
id: meta.conventions
order: 90
audience: agent-first
capabilities: []
authorities: [llp/0061-agent-first-snapback-guide.rfc.md]
examples: []
status: current
targets: [all]
maturity: shipped
reviewed: 2026-08-12
reviewed-authorities-digest: sha256:db256fee9e3faac8594cfcf8b3e51cb5206704d222c85855d0535a9842947283
---

# Guide conventions

<!-- @ref LLP 0061#design — the corpus rules this file operationalizes -->

These are the rules every page under `guide/` follows. They are adapted from
the Exact guide's conventions (Exact LLP 0365 §1) as a **compatible core plus
Snapback extensions**, so an agent that has used either guide can navigate
the other. `scripts/check-guide.mjs` enforces the mechanical parts.

## Frontmatter

Every `.md` file under `guide/` opens with YAML frontmatter using the **flat
subset only**: `key: value` scalars and inline arrays (`key: [a, b]`). No
nested maps, no block sequences — the checker parses exactly this subset.

Fields (schema: [`frontmatter.schema.json`](./frontmatter.schema.json)):

| Field | Required | Meaning |
| --- | --- | --- |
| `title` | yes | Human title. |
| `id` | yes | Stable dotted id (`clients.contract-adapter`). Used by nav, links, the capability index, and reserved as the resource id for later projections (MCP, console). Never renamed casually. |
| `order` | yes | Deterministic ordering within the section. |
| `audience` | yes | `agent-first`. |
| `capabilities` | yes | Capability-index ids this page claims coverage of (`[]` for meta pages). |
| `authorities` | yes | Repo paths (LLPs and code) this page derives from. Freshness hashes these paths and their bytes. |
| `examples` | yes | Demo directories/files that exercise what the page teaches (`[]` if none). |
| `status` | yes | `draft` \| `current` \| `deprecated` — authored lifecycle. |
| `targets` | yes | `[local]`, `[local, cloudflare]`, or `[all]` for genuinely target-independent material. Local-only pages render a banner line (see below). |
| `maturity` | yes | `shipped` \| `partial` \| `design-only`, consistent with the capability index. |
| `since` | no | Published closure version (`X.Y.Z`) in which the page's described surface first became, or is expected to become, available. |
| `unreleased` | no | The boolean `true` when the whole page deliberately describes a surface newer than the newest published closure; requires `since` and a rendered unreleased banner. |
| `reviewed` | yes | Date of the last intentional review — display metadata only. |
| `reviewed-authorities-digest` | yes | SHA-256 digest of the declared authority bytes at the last intentional review — the freshness **identity**. Refreshing it is a deliberate review act, not ordinary regeneration: `node scripts/migrate-guide-review-digests.mjs --refresh guide/path.md`. |

`targets:` and `maturity:` are the honesty boundary made mechanical
(LLP 0060's posture): a page must never generalize a local-target guarantee
into a hosted claim. A `maturity: partial` page names what works and what
doesn't. `design-only` material may appear only inside an explicitly marked
**Design reference** section, never as a technique. Auth pages teach only
behavior witnessed by an acceptance test or the server's own
capability/inspect reporting.

### Banner

Pages with `targets: [local]` start the body with:

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](./auth/targets.md).

## The published-closure fence

[`published-closure.json`](./published-closure.json) is the checked-in,
machine-readable record of the newest `@expo/snapback-*` closure available
from npm. The guide checker reads that local record; this check performs no
network access.

A page whose whole surface has one version may declare `since: X.Y.Z`. If the
whole page is deliberately ahead of the record's `newestPublished`, it also
declares `unreleased: true` and renders a blockquote whose first line starts
with `> **Unreleased.**` before the first `##` heading. The banner names the
literal newest published version so a reader knows which concrete closure is
missing the surface. Once the closure catches up, the fence is stale and must
be removed (or `since:` must be bumped to the actual future version).

Pages that mix vintages fence the affected section with an HTML comment on its
own line: `<!-- since: X.Y.Z -->` for a surface already present in that
closure, or `<!-- since: X.Y.Z unreleased -->` for a surface expected in a
future closure. An unreleased marker must be immediately followed (apart from
blank lines) by a contiguous rendered blockquote whose first line starts with
`> **Unreleased.**` and whose text names the literal newest published version.
A released marker may not name a version newer than `newestPublished`, and an
unreleased marker may not name that version or an older one.

This is an availability fence, separate from capability maturity. A
`maturity: shipped` page that claims a surface absent from the newest published
closure without an unreleased fence is a check **failure**. The npm promotion
lane updates `published-closure.json` in the same change that publishes a new
closure, regenerates the guide manifest, and sweeps all unreleased fences. The
stale-fence errors make a forgotten promotion-time sweep loud.

## Headings

Intent-first: name sections for what the reader wants to do ("Subscribe to a
query", "Scope a query to the signed-in user"), not for internal subsystem
names, so grep-by-goal works. Where a page covers an enumerable surface, it
lists **all** of it — sampling is how capabilities go undiscovered. Each
teaching page ends with an **Anti-patterns** section naming what not to
hand-roll.

## Routing: paved alternatives, grep vocabulary, vocabulary splits

Added 2026-08-06 from accepted LLP 0187 T1 (the routing-over-coverage
diagnosis; LLP 0061 owns these conventions):

- **Paved alternative at the point of choice.** Anti-pattern content and any
  "hard way" a page teaches (a JS handler where a declarative surface exists,
  a raw subscription where a hook exists) must link the paved alternative at
  the point the reader chooses, with the honest boundary of what the paved
  road cannot express. A worked hard-way example with no adjacent pointer is
  a guide defect, not a style preference.
- **The alias column is grep vocabulary.** Capability-index **Aliases** and
  page headings must include the literal strings an agent would plausibly
  search for: workload terms ("typing indicator", "dashboard") and plausible
  wrong-guess symbol names (`useSnapbackEphemeral`), whichever register they
  come from — including competitor vocabulary (Convex `useQuery`, Supabase
  RLS; LLP 0186 W2). A miss caused by a reasonable grep that returned nothing
  is a guide defect with a mechanical fix: add the string. Do not stuff —
  each alias should be a string someone would actually search.
- **Vocabulary splits are defects.** When a feature's schema side and client
  side use different names (ephemeral collections vs `useSnapbackPresence`),
  each side's page must name the other side's vocabulary. A grep from either
  register must reach the feature.
- **Every replicated miss becomes an eval seed.** When a replicated
  discoverability miss is fixed, the fix must add a seed case to
  [the retrieval eval](./retrieval-eval.md) that would have caught it
  (LLP 0187 T7's standing rule), so the fix cannot silently regress.

## Links

Two classes, checked:

- **Corpus-internal links** are relative paths within `guide/`
  (`../realtime/live-queries.md`). They must resolve.
- **Out-of-corpus references** — `authorities:`, `examples:`, and inline
  bridges into `llp/`, `demos/`, `crates/snapback/src/`, etc. — use repo-root paths in
  frontmatter and the `repo:` scheme inline
  (`[LLP 0008](repo:llp/0008-local-first-sync-and-realtime.rfc.md)`). They
  must exist in the repo.
- **Cross-repository references** use the shared
  `repo(<repository>):<repo-root-relative-path>` form, for example
  `[the Exact guide](repo(exact):guide/index.md)`. The repository token is
  lowercase ASCII (`[a-z0-9._-]+`); the path is relative, contains no `..`,
  and may carry a heading anchor. When a sibling checkout is present the
  checker verifies the path; without one it degrades honestly rather than
  claiming the remote bytes were checked. Exact uses the same convention and
  points its `data.snapback` external-authority row back to this guide.

## Code snippets

Every fenced `js` / `mjs` / `ts` / `tsx` / `json` / `contract` block carries
a declared class in its info string; the checker fails on unclassified
fences in those languages.

- **Transcluded-verified (the default):**
  <code>```js source=demos/todo/tests/acceptance/headless.mjs</code>
  The fence body must be an exact contiguous excerpt of the named file,
  copied byte-exact **including leading indentation** — the checker matches
  it as a literal substring of the source; only trailing whitespace is
  normalized. The named file must be exercised by CI — a demo acceptance
  suite, package test, or proof script. Drift in the source breaks the
  check, which is the point: the snippet's "this ran" property is inherited
  from CI, and behavioral drift becomes structural breakage. Update the page
  in the same change that changes the source.
- **Fragment:** <code>```js fragment reason="mid-file excerpt"</code>
  Not verified; the reason is mandatory so partial code is a tracked class,
  not an escape hatch.
- **Standalone-runnable:** reserved (LLP 0061 §Design 3). The scratch-app
  assembler is built only when a technique no CI-exercised file demonstrates
  needs a snippet; until then the checker rejects the class with a pointer
  to this paragraph. Prefer adding the technique to a demo or fixture and
  transcluding it.

`sh` fences are illustrative commands and exempt from mechanical
verification; keep them real and current. `text`, `yaml`, and diagram fences
are exempt.

**Exact-dependent snippets** (Contract-arm sources): the text match runs
everywhere with no Exact dependency. The *execution* guarantee is inherited
from the suite that runs the source file — Contract-arm suites are gated by
`SNAPBACK_VERIFY_EXACT`, which merge/release CI pins to `1`, so those
sources are always executed before landing even when a local core-only run
skipped them. The manifest records each snippet's source so a consumer can
see which suite carries its guarantee.

## The capability index

[`capabilities.md`](./capabilities.md) is authored, not generated. Shipped
rows carry a **witness** — a route in the declared registry, a host-op id, a
package export, a generated-manifest field, or a CLI command proving the
capability exists in code. Uncovered capabilities are explicit **GAP** rows
naming an owner and a review date. The authored
[`surface-map.md`](./surface-map.md) carries the mechanically growing route
and host-op classifications under a separate size budget. The checker joins
that map against the repo's declared enumerations — every enumerated entry
maps to a capability id or a `notAuthorFacing` classification.

## The manifest

[`guide-manifest.generated.json`](./guide-manifest.generated.json) is
generated by `scripts/generate-guide-manifest.mjs` — nav tree, per-page
frontmatter, content hashes, capability join, per-snippet status, and the
build identity the corpus was verified against. Never hand-edit it; every
later projection (MCP, admin console, CLI) consumes the manifest rather than
re-parsing the tree.

The same command emits [`guide-flat.generated.md`](./guide-flat.generated.md),
the whole-corpus bulk export (currently about 2.5 MiB), plus one
`guide-flat.<section>.generated.md` projection for every top-level manifest
navigation section. The whole export places the capability index first and
then includes every page exactly once in manifest order; each section export
contains only that section's pages in manifest order. The manifest's
`flatProjections` records their paths, served paths, MCP URIs, byte counts, and
SHA-256 digests. The guide checker rejects the manifest, whole flat, or any
section flat when stale.

For a context-limited one-request read, start with the budgeted entry tier:
[`capabilities.md`](./capabilities.md) (about 50 KiB under its current enforced
budget) plus [`surface-map.md`](./surface-map.md) (about 12 KiB under its 16 KiB
budget). Then choose a section flat or specific page. The whole export remains
available for bulk consumers, but is not the default reading recommendation.
The checked source manifest carries only its content-derived
`buildIdentity.sourceDigest`. At server compile time, `build.rs` adds
`buildIdentity.commit` to the embedded manifest for the exact binary build;
HTTP headers and MCP metadata therefore give every whole or section projection
the same guide content hash and exact carrier commit without making the source
record depend on the current checkout commit.

## Running the checks in a fresh tree

`node scripts/check-guide.mjs` is the docs-only fast path; the local proof
runs the same checks. Snippet verification reads sources on disk, and some
cited sources are gitignored codegen outputs
(`demos/*/snapback/generated/*`), so a fresh checkout or worktree fails
with "snippet source does not exist" — plus a consequent stale-manifest
error — until demo codegen has run. That failure is the checker being
honest, not the corpus being broken. In a fresh tree, run
`bun install --frozen-lockfile`, then `scripts/check-generated-artifacts`
(node-only; regenerates every committed backend and verifies the committed
review manifests), or just the per-demo codegen for the demos the failing
snippets cite, e.g.
`node packages/snapback-codegen/index.mjs demos/todo-v2/snapback`.
For demos whose snippets use streamed or outbound actions (currently
`demos/competitive-checkpoint`), prefix the codegen command with
`SNAPBACK_OUTBOUND_ACTIONS=1` — codegen selects the outbound-actions
capability manifest only when that variable is set, and otherwise fails
with `SNAPBACK_CAPABILITY_UNSUPPORTED` because the base local target does
not declare `bounded_response_stream_v1`.
Regeneration writes only gitignored paths; the tracked tree stays clean.

## Freshness

Warning-only, but sound: the checker hashes each page's current `authorities:`
bytes and reports when they differ from `reviewed-authorities-digest`. Dates
and commit locations are never identity, so an unrelated rebase cannot change
the verdict. Expired GAP review dates and check failures gate; drift warnings
don't (LLP 0061 §Design 3).

---

<!-- snapback-guide-source: guide/retrieval-eval.md -->
---
title: Retrieval eval protocol
id: meta.retrieval-eval
order: 91
audience: agent-first
capabilities: []
authorities: [llp/0061-agent-first-snapback-guide.rfc.md, llp/0245-infer-show-freeze-declarations.rfc.md]
examples: []
status: current
targets: [all]
maturity: shipped
reviewed: 2026-08-12
reviewed-authorities-digest: sha256:622ed35a0850ae6e4bec99ff59db20df0c12e2820962f76c97cfcc2d05d9a58a
---

# Retrieval eval protocol

<!-- @ref LLP 0061#5-keeping-it-current-ownership-the-diary-loop-and-a-small-eval — the pinned protocol -->

The repeatable check that the guide's discovery wiring actually works: a
cold agent with a real intent finds the paved road through the guide instead
of building around it. This is the Phase 1 exit criterion and reruns after
any discovery-wiring change (the AGENTS.md pointer, the README row, the
index page, the capability index's shape).

## Fixture

A fresh agent context — same family/tier as the repo's primary authoring
agents — cold-started in a Snapback checkout at HEAD with `AGENTS.md` as the
only steer. No prior conversation, no memory of this repo's guide.

## Seed intents

At least three, across feature areas (extend, don't replace, when new areas
land). Each case ends with two machine-parsed lines, consumed by the
[static routing check](#static-routing-check): `Expected pages:` lists
guide-relative paths in backticks (alternatives joined with "or"), and
`Route terms:` lists, in double quotes, the vocabulary an arriving agent
would plausibly grep for.

1. **Realtime:** "Add a live-updating list of items to an app built on
   Snapback." (Plus `getting-started/your-first-backend.md` when starting
   fresh.)
   Expected pages: `realtime/live-queries.md`.
   Route terms: "realtime", "subscription", "live-updating".

2. **Ephemeral:** "Let two users of my Snapback app see each other's
   cursors."
   Expected pages: `recipes/presence-cursors.md` or
   `realtime/ephemeral-state.md`.
   Route terms: "cursors", "presence".

3. **Auth:** "Scope a query so each signed-in user only sees their own
   rows."
   Expected pages: `auth/sessions-and-principals.md`,
   `recipes/hidden-hands.md`.
   Route terms: "per-user", "row security", "hidden data".

Cases 4–8 are regression seeds from the replicated 2026-08-04/05 bakeoff and
2026-08-06 G4 external-proof discoverability misses (LLP 0187 T7, landed under
LLP 0186 W2). The standing rule: every replicated discoverability miss, once
fixed in the guide, must add a seed case here that would have caught it.

4. **Relational routing:** "Show a user's conversation list (a membership
   join)." The run fails if the plan hand-writes the join in
   `defineJsLiveQuery`.
   Expected pages: `backend/relational-queries.md`.
   Route terms: "joins", "conversation membership", "relational".

5. **Ephemeral vocabulary:** "Add a typing indicator." The plan must reach
   `useSnapbackPresence` from either vocabulary entry point (schema-side
   `ephemeral`/`useSnapbackEphemeral` grep or client-side `presence` grep).
   Expected pages: `realtime/ephemeral-state.md` or `clients/react.md`.
   Route terms: "typing indicator", "ephemeral", "presence",
   "useSnapbackPresence".

6. **Operating:** "A mutation is misbehaving — inspect what it read and
   wrote." The run fails if the plan reaches for `curl`, raw host-op calls,
   or a one-off verification script without naming the console.
   Expected pages: `operating/admin-console.md`.
   Route terms: "console", "inspect function", "debug backend".

7. **Assets:** "Upload a photo from an Expo app without login." The plan
   must state the owner-authorization rule — attempt creation may be public,
   but ownership checks are never anonymous.
   Expected pages: `backend/assets.md` (the unified ImagePicker recipe).
   Route terms: "upload", "Expo ImagePicker", "images".

8. **Expo binding identity:** "My Expo app reports
   `SNAPBACK_APP_BINDING_IDENTITY_MISMATCH`." The plan must regenerate the
   descriptor, stop an older supervisor, and restart the supervised loop; it
   fails if it suggests overriding the identity or weakening binding
   admission.
   Expected pages: `clients/react-expo.md`.
   Route terms: "SNAPBACK_APP_BINDING_IDENTITY_MISMATCH", "expo".

9. **Asset rendering:** "My uploaded image renders as an empty `<Image>` on
   a sessions-mode server." (The replicated 2026-08-06 rematch-bakeoff miss:
   the working pattern — the public-immutable URL plus handling the
   rendition-publication race — was found only by reading package source.)
   The plan must hand `useSnapbackAssetImage`'s `src` to the image tag, not
   hand-build a delivery route or add an `onError` retry loop.
   Expected pages: `backend/assets.md`.
   Route terms: "empty image", "render image", "useSnapbackAssetImage",
   "strict delivery URL".

Cases 10–14 are Rosetta-tier seeds from the LLP 0186 W2 amendment's
worked-example journeys (`protected-live-crud`, `expo-media-upload`,
`relational-queries`, `ephemeral-presence`, `reactive-queries`): a
coding agent arriving with competitor vocabulary must still land on the
correct Snapback security boundary, not a plausible-sounding guess.

10. **Rosetta — protected reads:** "I'm coming from Supabase — how do I
    scope a query with row-level security so users only see their own
    rows?" The run fails if the plan claims `authScopeField` alone
    enforces the filter, or if it never states the `authUserId()`
    predicate in the query's filter as the actual boundary.
    Expected pages: `auth/sessions-and-principals.md` and
    `recipes/coming-from-convex-and-supabase.md`.
    Route terms: "Supabase RLS", "row-level security", "row security".

11. **Rosetta — asset upload:** "I'm used to Supabase Storage — how do I
    upload and attach a photo from an Expo app securely?" The run fails
    if the plan treats upload authorization as anonymous.
    Expected pages: `backend/assets.md` and
    `recipes/coming-from-convex-and-supabase.md`.
    Route terms: "Supabase Storage", "Convex generateUploadUrl",
    "object storage".

12. **Rosetta — relational reads:** "I'm used to Supabase's nested joins —
    how do I read a conversation's messages with the sender's name
    attached?" The run fails if the plan hand-writes the join in a JS
    live query instead of using the bounded relational surface.
    Expected pages: `backend/relational-queries.md` and
    `recipes/coming-from-convex-and-supabase.md`.
    Route terms: "Supabase joins", "Convex joins", "nested joins".

13. **Rosetta — presence and cursors:** "I'm coming from Supabase
    Presence/Broadcast — how do I show who's online and live cursor
    positions?" The run fails if the plan invents two different Snapback
    mechanisms for the two cases instead of one ephemeral mechanism with
    TTL.
    Expected pages: `realtime/ephemeral-state.md` and
    `recipes/coming-from-convex-and-supabase.md`.
    Route terms: "Supabase Presence", "Supabase Broadcast", "cursors".

14. **Rosetta — reactive queries:** "I'm used to Convex's useQuery — how
    do queries stay live in Snapback?" The run fails if the plan claims
    Snapback's hook is identical to Convex's auto-reactive model without
    naming the backend-declares/client-subscribes split.
    Expected pages: `clients/react.md` and
    `recipes/coming-from-convex-and-supabase.md`.
    Route terms: "Convex useQuery", "useQuery".

Cases 15–16 are absorption seeds from the 2026-08-01 optimistic-create/app-error
and 2026-08-05 large-fixture guide-gap tickets (LLP 0138 bakeoff and LLP 0183
Lane 1 misses, absorbed 2026-08-07).

15. **Large fixtures:** "Load a deterministic 5,000-row acceptance fixture —
    the seed refuses with `SNAPBACK_SEED_EFFECT_LIMIT_EXCEEDED`." The run
    fails if the plan tries to raise or dodge the seed ceiling, or reinvents
    an ungated import mutation without the sentinel-closed bootstrap gating.
    Expected pages: `testing/large-fixtures.md`.
    Route terms: "SNAPBACK_SEED_EFFECT_LIMIT_EXCEEDED", "large fixture",
    "seed ceiling".

16. **Domain errors and optimistic create:** "Show 'card is locked' copy when
    a mutation is rejected, and optimistically create a row whose ID the
    server mints." The run fails if the plan parses `SNAPBACK_HANDLER_FAILED`
    message text, forges a provisional generated row ID, or claims the
    lower-level optimistic mutation view is a first-class provider hook.
    Expected pages: `clients/react.md`, `recipes/optimistic-create.md`, and
    `backend/mutations.md` (declared refusals).
    Route terms: "optimistic create", "server-minted ID", "ctx.refuse",
    "refusals".

Case 17 is an absorption seed from the 2026-08-07 three-lane measurement
(Diary 0066 finding 6, `issues/20260807-arg-filtered-retention-none-maze.md`).

17. **Retention routing:** "My args-filtered live query classifies offline
    retention `none` — why, and what are my options?" The run fails if the
    plan blames the args (explicit `arg(...)` filters are eligible), removes
    the filter without fixing the missing declarations, or trial-and-errors
    through `composition-activation`/`registerQuery` instead of routing by
    workload shape.
    Expected pages: `sync/offline-and-retention.md` (the route-by-workload-
    shape table).
    Route terms: "retention", "args-filtered", "retainable",
    "SNAPBACK_RETENTION_NOT_RQS_ELIGIBLE".

Cases 18–20 are absorption seeds from the 2026-08-08 Zerobugs-control guide-gap
tickets (declared refusals, principal↔app-identity binding, SVG assets).

18. **Declared refusals:** "My mutation rejects a duplicate seat reservation,
    but the client only sees `SNAPBACK_HANDLER_FAILED` — how do I give the
    caller a reason it can act on?" (The replicated miss: the Zerobugs control
    shipped every application-semantic refusal as a bare `throw` through ten
    receipted gate attempts.) The run fails if the plan parses the failure
    message, invents an `{ ok: false, error }` success envelope, or reuses a
    platform `SNAPBACK_*` code as the domain code.
    Expected pages: `backend/mutations.md`.
    Route terms: "declared refusal", "ctx.refuse", "SNAPBACK_APP_REFUSAL",
    "appCode".

19. **Principal to app identity:** "My app has its own users table with OAuth
    ids — how do I connect Snapback's `ctx.auth.userId` to it?" The run fails
    if the plan writes a mutation that takes the app user id (or an email) as
    an argument and binds it to the caller's principal, or seeds binding rows
    with captured principal ids.
    Expected pages: `auth/app-identity-binding.md`.
    Route terms: "bind a principal", "identityBinding", "identity broker",
    "app user row".

20. **SVG assets:** "Uploading an `image/svg+xml` file fails even though I
    listed it in the intent's `accept.mediaTypes`." The run fails if the plan
    tries to widen the trusted image detector, treats the refusal as a bug, or
    serves SVG through an app alias without `nosniff` plus a sandbox CSP.
    Expected pages: `backend/assets.md`.
    Route terms: "SVG", "image/svg+xml",
    "SNAPBACK_ASSET_MEDIA_TYPE_UNSUPPORTED", "nosniff".

Case 21 is an absorption seed from the 2026-08-07 zerobugs `zb5-hot` `v4`
attempt (`issues/closed/20260808-sessions-store-copy-needs-auth-keyring-sibling.md`):
a full receipted gate run was burned discovering that a database copy is not a
store copy, and nothing in the guide named the sibling.

21. **Store copy and backup:** "Copy a running Snapback store somewhere else
    and boot on the copy." The run fails if the plan `cp`s the `.sqlite3`
    (with or without a `*` glob), hand-derives the sibling list, waits for a
    clean shutdown to make a `cp` safe, or reaches for `snapback auth backup`
    expecting a bootable directory.
    Expected pages: `operating/backup-and-copy.md`.
    Route terms: "backup", "copy database", "clone database",
    "auth-keyring.json", "SNAPBACK_AUTH_PROVIDER_UNAVAILABLE".

Case 22 absorbs the replicated mutation-authoring miss recorded in
`issues/closed/20260808-ctx-db-verbs-undocumented.md`.

22. **Mutation database verbs:** "Inside a JS mutation, query a declared
    index, collect at most 500 rows, and delete one matched row." The run fails
    if the plan invents raw SQL, scans without a bound, or cannot name the
    `query` → `withIndex` → `eq` → `take` → `collect` builder chain and the
    `ctx.db.delete(table, id)` write.
    Expected pages: `backend/mutations.md`.
    Route terms: "ctx.db", "withIndex", "bounded collection", "delete row".

Case 23 absorbs the repeated headless-call-shape miss recorded in
`issues/closed/20260808-headless-args-shape-guide-snippet.md`.

23. **Headless argument nesting:** "Call a generated headless query with an
    `owner` argument, then subscribe to the same query live." The run fails if
    either call places `owner` beside `args` instead of inside
    `{ args: { owner } }`, or confuses `connectionId` with a function argument.
    Expected pages: `clients/headless.md`.
    Route terms: "args nesting", "nested args",
    "SNAPBACK_ARGUMENT_VALIDATION_FAILED", "liveQuery args".

Case 24 absorbs the repeated verifier-config source-reading detour recorded in
`issues/closed/20260808-verify-config-authoring-guide-anchor.md`.

24. **Verify config authoring:** "Register my headless acceptance suite with
    `snapback verify`, including its execution identities and read/write
    conformance evidence." The run fails if it reaches into an unpublished
    source file instead of a package export, omits the profile's test bytes or
    paths, or returns no target/data/authority/seed context.
    Expected pages: `testing/verify.md`.
    Route terms: "snapback.verify.config.mjs", "defineVerifyConfig",
    "@expo/snapback-cli/verify", "acceptance profile".

Case 25 absorbs the repeated bare-Metro cold-offline source excavation
recorded in `issues/closed/20260808-offline-supervisor-origin-guide-anchor.md`.

25. **Expo supervised cold offline boot:** "After warming an Expo app through
    `snapback dev --expo`, stop the supervisor and prove a cold launch from the
    cached binding and retained receipt using bare Metro." The run fails if it
    omits the bundle-time supervisor-origin environment, invents a new dead
    URL instead of capturing the supervised exchange origin, or claims
    protected reads work offline.
    Expected pages: `clients/react-expo.md`.
    Route terms: "EXPO_PUBLIC_SNAPBACK_SUPERVISOR_ORIGIN", "bare Metro",
    "cold offline", "persisted-receipt".

Case 26 absorbs the duplicated native-lane simulator setup recorded in
`issues/closed/20260808-headless-simulator-proof-recipe.md`.

26. **Headless iOS simulator proof:** "Drive an Expo iOS proof without opening
    Simulator.app: install and launch the app, dismiss Expo Go onboarding,
    send a custom-scheme command, and capture a screenshot." The run fails if
    it uses `plutil` for the dotted scheme-approval key, expects `simctl` to
    answer the first-open confirmation, or treats URL delivery alone as the
    product witness.
    Expected pages: `clients/react-expo.md`.
    Route terms: "headless simulator", "plistlib", "Expo Go onboarding",
    "simctl openurl", "deep-link drive channel".

Cases 27–31 absorb the paged-list, server-minted optimistic-create,
structured route-argument, and mutation-settlement guide gaps closed or
narrowed on 2026-08-08.

27. **React load-more list:** "Build an infinite-scroll React feed whose
    live queries replace whole page results, survives equal timestamps at the
    boundary, and explains what is actually retained after reload." The run
    fails if the plan paginates on `createdAt`, appends every replacement,
    claims the assembled archive is durable, or feeds a raw key into a
    standard-pattern opaque cursor.
    Expected pages: `recipes/paged-list.md`.
    Route terms: "load more", "infinite scroll", "whole-result replacement",
    "retained pages", "pageKey".

28. **Server-minted optimistic ID under response loss:** "Show a provisional
    create in the same filter/order/count projection as canonical rows, then
    lose the response after commit and settle one intent to one server ID."
    The run fails if the plan forges `Id<Table>`, authors a second reducer,
    retries with a fresh intent, guesses the mapping by content/call order, or
    claims a first-class `useSnapbackMutation` insert API exists.
    Expected pages: `recipes/optimistic-create.md`.
    Route terms: "createOptimisticMutationView", "logical mint", "idMap",
    "ambiguous retry", "response loss".

29. **Structured route arguments:** "Bundle `/projects/:projectId` into a
    query taking `{ context: { projectId, cursor: null, sort: 'asc', tags:
    ['open'] } }`." The run fails if the plan flattens `context`, adds a
    server-side merge, puts `routeParam()` inside an array, or invents
    transforms or defaults.
    Expected pages: `realtime/snapshot-bundles.md`.
    Route terms: "structured route arguments", "nested routeParam",
    "query context", "route group args".

30. **Replay-stable effect intent:** "A client mutation writes a notification
    intent; retries must reuse one provider idempotency key even if the handler
    threw before commit." The run fails if the plan uses `ctx.runtime.id()`,
    parses or hashes the raw `clientMutationId`, calls the settlement surface
    from a query or action, or performs external I/O inside the mutation.
    Expected pages: `backend/mutations.md`,
    `backend/trusted-runtime-values.md`.
    Route terms: "ctx.mutation.settlement", "settlementId",
    "replay-stable effect", "provider idempotency key".

Case 31 absorbs the browser-custody and real-sign-in recipe gaps recorded in
`issues/closed/20260806-guide-gap-browser-auth-custody-indexeddb-adapter.md`
and LLP 0196 T4.

31. **Browser external sign-in and reload:** "Connect my browser app's
    existing external identity to Snapback, bind it to my users table, keep
    protected data signed in across a full reload, and log out safely." The
    run fails if it uses memory custody, gives mailbox/admin/impersonation
    material to page code, exposes a caller-selectable binding mutation,
    keys identity by email, hands a raw external bearer to page state and
    calls that coordinator custody, or claims the local fixture is hosted
    production/OIDC support.
    Expected pages: `recipes/browser-auth.md` and
    `auth/app-identity-binding.md`.
    Route terms: "browser auth reload", "IndexedDB auth custody",
    "createIndexedDbAuthCustodyStorage", "issuer subject".

Cases 32–39 absorb the diary-friction routing misses re-verified by LLP 0202:
job contention and retry observability, Expo filesystem setup, system-field
indexes, the Vite virtual module, headless transport defaults, dev-auth persona
composition, packaged codegen, and existing-app composition.

32. **Retryable durable job and DLQ inspection:** "Enqueue a notification job
    that can race foreground writes, then tell whether it succeeded only after
    a retry or exhausted into the DLQ." The run fails if it accepts the
    one-attempt default for routine contention, promises a separate dead-letter
    queue, or infers first-try success from `lastErrorCode: null`.
    Expected pages: `backend/jobs.md`.
    Route terms: "retryable by design", "SNAPBACK_AUTH_RESERVATION_STALE",
    "dead-letter", "DLQ", "succeeded after retry".

33. **Expo durable-store registration:** "Register Expo file persistence in a
    universal iOS/Android/web app without white-screening web." The run fails
    if it calls `registerExpoFileSystemRqsFiles` on web or hand-writes an
    `expo-file-system` version instead of using Expo's installer.
    Expected pages: `clients/react-expo.md`.
    Route terms: "registerExpoFileSystemRqsFiles", "Platform.OS",
    "white-screening", "npx expo install", "expo-file-system".

34. **System-field index boundary:** "Page a player's rows by `_version` and
    decide whether `.index('by_player_version', ['playerId', '_version'])` is
    legal." The run fails if it declares a system-field index or fails to name
    the authored-partition-index plus system-field range/order path.
    Expected pages: `getting-started/your-first-backend.md` or
    `backend/queries.md`.
    Route terms: "system fields", "SCHEMA_UNKNOWN_FIELD", "_version",
    "composite system-field index".

35. **Vite development virtual module:** "A hand-built Vite app cannot type
    the `virtual:snapback/dev` import used by the Snapback templates." The run
    fails if it invents a physical module or omits the ambient declaration.
    Expected pages: `getting-started/the-authoring-loop.md`.
    Route terms: "virtual:snapback/dev", "snapback-dev.d.ts",
    "snapbackBasePath", "ambient declaration".

36. **Headless live transport default:** "Subscribe with headless `liveQuery`
    and receive updates without manually polling." The run fails if it omits
    `transport: 'stream'` while claiming push updates.
    Expected pages: `clients/headless.md`.
    Route terms: "manual polling", "transport default", "transport: 'stream'",
    "poll()".

37. **Expo multi-persona auth:** "Switch between two acting users in an Expo
    demo using the packaged provider." The run fails if it passes `userId` per
    hook call or claims dev auth composes with the provider's single custody
    identity.
    Expected pages: `clients/react-expo.md`.
    Route terms: "dev-auth, multi-persona", "SnapbackExpoProvider",
    "per-call userId", "one custody identity".

38. **Packaged codegen command:** "Generate a newly scaffolded backend from an
    installed Snapback CLI rather than a Snapback source checkout." The run
    fails if it invokes `node packages/snapback-codegen/index.mjs`.
    Expected pages: `getting-started/your-first-backend.md`.
    Route terms: "snapback generate", "Generate and load", "packaged".

39. **Compose into an existing app:** "Add a Snapback backend to an existing
    `create-expo-app` project." The run fails if it invents `snapback init` or
    hides the current sibling-scaffold/copy workaround and capability GAP.
    Expected pages: `clients/react-expo.md`.
    Route terms: "existing standalone Expo", "backend-only initializer",
    "sibling directory", "compose into existing app".

Case 40 absorbs the control-MCP cold-discovery miss recorded in
`issues/closed/20260808-mcp-control-funnel-invisible.md` and LLP 0202 theme 3.

40. **Agent control MCP setup:** "Give my coding agent access to Snapback's
    local control tools over MCP, and preview the project configuration before
    installing it." The run fails if it discovers only the resource-only
    Guide server, omits the control server's local-admin authority, or edits a
    harness configuration without first using the setup preview.
    Expected pages: `operating/agent-controls.md`.
    Route terms: "mcp-control", "control mcp", "agent setup", "control tools".

Case 41 closes the retrieval regression recorded in
`benchmarks/records/2026-08-09-social-messenger-p2-pilot.md` and executed by
LLP 0223 ticket 3: the pilot's Snapback lane learned the `auth.mintSession`
HTTP request shape by observation after every documented guess refused with
`SNAPBACK_AUTH_REQUEST_INVALID`. It complements case 19 (which binds an app
identity model to principals); this case is the session-issuing broker
itself.

41. **Session-mint identity broker:** "Implement a trusted server-side
    identity broker: authenticate users at your own front door, invoke
    `auth.mintSession` over HTTP, and hand each user their Snapback session
    bearer." The run fails if the plan guesses request bodies until the
    refusal stops, shells out to `snapback session mint` for every login,
    omits an authority carrier (the AdminWrite token plus the impersonation
    capability), or places operator credentials in an app bundle.
    Expected pages: `operating/host-ops.md`, `auth/native-apps.md`.
    Route terms: "auth.mintSession", "session mint HTTP",
    "SNAPBACK_AUTH_REQUEST_INVALID", "identity broker".

Case 42 absorbs the supervised Expo-web launcher-boundary miss recorded in
`issues/closed/20260809-guide-gap-supervised-expo-web-launcher-boundary.md`.

42. **Supervised Expo web selection:** "Run an Expo web app through Snapback's
    supervised bootstrap on a dynamically selected backend port, or compose a
    custom session broker without losing that selected origin." The run fails
    if it routes `expo start --web` through `--client-command`, treats that as
    equivalent to `--expo`, or retains a fixed fallback beside a dynamic
    target.
    Expected pages: `clients/react-expo.md`.
    Route terms: "--expo-platform web", "--client-command",
    "SNAPBACK_DEV_EXPO_SUPERVISOR_BYPASSED", "custom broker origin".

Cases 43–46 absorb the Diary 0074 pointing-room guide-gap tickets, fixed
2026-08-10 — the replicated instances of the sophisticated-variant-only
anti-pattern named in LLP 0061's reachability amendment: each page taught
only the advanced variant of a capability, so the probe concluded the
ordinary variant was unsupported and built host glue around a paved path.

43. **Contract presence publishing:** "Publish ordinary `{ name, picking }`
    presence from a Contract surface and keep the entry alive with a
    heartbeat." The run fails if the plan adds a DOM-event/timer bridge in
    host code, drives the generated publish link imperatively from
    `main.ts`, or claims channel publishing is pointer-only.
    Expected pages: `recipes/presence-cursors.md`.
    Route terms: "publish ordinary presence", "pointerChannel",
    "heartbeat", "Collection publishing is not pointer-only".

44. **Contract/Vite local sign-in code:** "Boot sign-in for a non-React
    Contract/Vite surface in local development: obtain the one-time mailbox
    code without privileged material reaching the browser." The run fails
    if the admin token, impersonation capability, mailbox-reader, or
    private-origin material reaches page code, or if the dev middleware
    proxies arbitrary Snapback routes instead of relaying only the code.
    Expected pages: `recipes/browser-auth.md` and
    `auth/sessions-and-principals.md`.
    Route terms: "serve-only dev mailbox relay", "sign-in code",
    "authRequestCode", "authExchange".

45. **Disclosure-claim ceiling:** "State 'no participant sees another's
    vote until the round is revealed' as a Contract invariant." The run
    fails if it treats a count-partition invariant as proof of
    rendered-text equality, per-row provenance, or wire bytes, or if it
    does not pair the contract block with a two-principal wire-level
    acceptance test at the data boundary.
    Expected pages: `clients/contract-adapter.md`.
    Route terms: "Contract invariant", "disclosure claim",
    "wire-level acceptance test".

46. **Keyed scopes with presence:** "Re-key a Contract surface's durable
    live queries and its presence scope from one piece of component state
    (switching rooms)." The run fails if the plan merges a companion
    ephemeral-only surface into the keyed links (required before the
    2026-08-10 keyed-ephemeral fix, obsolete since), omits the generated
    publish link, or claims a keyed `forceEphemeralState` exists.
    Expected pages: `clients/contract-adapter.md`.
    Route terms: "keyedQueryScopes",
    "SNAPBACK_CONTRACT_EPHEMERAL_UNSUPPORTED", "forceEphemeralState".

Case 47 absorbs the npm-only generated-typecheck gap recorded in
`issues/closed/20260811-guide-gap-npm-generated-contract-typecheck.md`.

47. **Npm-only generated Contract imports:** "Codegen succeeds in my React or
    Expo app, but broad strict `tsc --noEmit` cannot resolve
    `@exact/contract/exports` from generated `.contract-meta.ts` files." The
    run fails if the plan installs a private/unavailable Exact package, probes
    package presence to select output, permanently excludes all generated
    Contract files on a current release, or omits the committed
    `contractMetadata: "exact"` opt-in for a real Contract project.
    Expected pages: `getting-started/generated-artifacts.md` or
    `clients/contract-adapter.md`.
    Route terms: "@exact/contract unavailable", "npm-only typecheck",
    "contractMetadata", "contract-meta".

Case 48 absorbs the replicated 2026-08-12 sweep miss
(`issues/closed/20260812-guide-gap-auth-client-surface-and-whoami.md`):
three lanes reverse-engineered `coordinator.settledView()` /
`session.authority.userId` because no page named the blessed whoami.

48. **Signed-in principal whoami:** "After boot, am I signed in, and as
    whom? Use `settledView` / `currentAuthorizationScope` / who am I."
    The run fails if it enumerates coordinator prototypes, treats
    `authSession()` as the identity read, or tells a TypeScript app to
    cast the client for these methods.
    Expected pages: `auth/sessions-and-principals.md`.
    Route terms: "who am I", "am I signed in", "settledView",
    "currentAuthorizationScope", "whoami".

Cases 49–52 exercise LLP 0237 rollout 1's cold path from familiar module and
Node vocabulary, plus both new definition-attribution codes, to the generated
restriction profile.

49. **Handler helper import:** "Can I import a helper into a Snapback handler?"
    The run fails if it claims relative imports are already admitted, adds a
    bundler alias, or misses the current same-file function-declaration path.
    Expected pages: `backend/handler-runtime.md`.
    Route terms: "Can I import a helper?", "BUNDLE_UNSUPPORTED_IMPORT",
    "same-file helper".

50. **Node crypto in handlers:** "Can I use Node crypto in a Snapback
    handler?" The run fails if it treats an engine ambient as Node
    compatibility or omits the generated profile's per-operation capability
    answer.
    Expected pages: `backend/handler-runtime.md`.
    Route terms: "Can I use Node crypto?", "node:crypto",
    "BUNDLE_UNSUPPORTED_PROCESS".

51. **Unexported definition:** "Generation reports
    `SNAPBACK_CODEGEN_DEFINITION_NOT_EXPORTED`; what exactly should I export?"
    The run must use the structured binding/span/remediation and must not edit
    a generated manifest.
    Expected pages: `backend/handler-runtime.md`.
    Route terms: "SNAPBACK_CODEGEN_DEFINITION_NOT_EXPORTED",
    "unexported top-level operation", "definition path".

52. **Unserializable definition value:** "Generation reports
    `SNAPBACK_CODEGEN_DEFINITION_VALUE_UNSERIALIZABLE`; how do I find the bad
    option?" The run must follow the exported binding and nested property path
    to the authored span rather than inspecting evaluator internals.
    Expected pages: `backend/handler-runtime.md`.
    Route terms: "SNAPBACK_CODEGEN_DEFINITION_VALUE_UNSERIALIZABLE",
    "nested property path", "definition path".

53. **Declaration suggestions:** "How do I get Snapback to write my result
    contract?" The run fails if the plan invents bounds or table identity,
    treats suggestion provenance as runtime authority, bulk-applies operations,
    or claims a manually pasted patch received the stale-safe apply check.
    Expected pages: `getting-started/the-authoring-loop.md` or
    `backend/queries.md`.
    Route terms: "infer result", "suggest contract",
    "write my result contract", "convex-style inference".

Cases 54–56 absorb the 2026-08-15 multi-profile sweep's asset-authoring,
sessions-evolution, and familiar-profile discovery misses.

54. **Store media from explicit authoring:** "Add a photo field while writing
    my Snapback schema and functions." The run fails if the plan stores a
    base64/data URL in `v.string()` or `v.json()` instead of routing through a
    generated asset intent, trusted finalization, and typed reference.
    Expected pages: `backend/assets.md` or
    `getting-started/your-first-backend.md` or `backend/handler-runtime.md`.
    Route terms: "storing media", "data URL media", "base64 image".

55. **Sessions schema evolution:** "A schema edit rotated deployment identity;
    `expectedDeployment` and `observedDeployment` differ, but I need to keep
    rows already written by a partial load." The run fails if it deletes the
    database, hand-edits hashes, or treats a field retype as additive. It must
    boot the exact predecessor carrier and use the packaged successor or
    reviewed-migration path.
    Expected pages: `backend/schema-evolution.md`.
    Route terms: "sessions schema change", "expectedDeployment",
    "partial load", "successor activation".

56. **Familiar profile end-to-end:** "Build an Expo Router app with Snapback's
    familiar TypeScript handlers, persistent native login, and a photo upload."
    The run fails if it presents familiar as the default/stable profile, keeps
    native custody in memory, omits per-handler membership checks, uses inline
    hook argument objects, or stores the photo as a data URL.
    Expected pages: `backend/familiar-profile.md`.
    Route terms: "Familiar TypeScript", "Expo Router familiar",
    "SecureStore custody".

Cases 57–58 absorb the 2026-08-16 Coterie guide gaps for sessions fixture
installation and inverse provider-neutral Contract adaptation.

57. **Sessions fixture install:** "Install deterministic password accounts,
    principal-owned profile rows, and typed avatar media in a sessions-mode
    app; rerunning must sign in and report a match without an asset upload or
    application-data write." The run
    fails if it seeds captured principal ids, treats
    `SNAPBACK_AUTH_PASSWORD_EXISTS` alone as a match, skips the fixture-source
    digest check, or uploads before the matched-repeat branch exits.
    Expected pages: `recipes/sessions-fixture-install.md`.
    Route terms: "install sessions fixtures", "fixture-source digest",
    "SNAPBACK_AUTH_PASSWORD_EXISTS", "matched repeat".

58. **Frozen provider-neutral Contract adapter:** "Implement an already-frozen
    provider-neutral `ContractDataProvider` over Snapback without changing the
    foreign declaration digest." The run fails if it generates a
    provider-specific manifest, reports an unprobed whole-manifest behavioral
    claim, polls above the seam, silently accepts future operations, or leaks
    Snapback diagnostic/app refusal codes instead of declared serialized error
    names.
    Expected pages: `clients/contract-adapter.md`.
    Route terms: "frozen provider-neutral declaration",
    "ContractDataProvider adapter", "foreign declaration digest",
    "no polling above the seam".

## Static routing check

The deterministic half of this corpus is executable:
`scripts/check-retrieval-eval.mjs` (run standalone or via
`node scripts/check-guide.mjs`) parses the numbered cases above and
verifies, on every guide check, that (1) each case's expected pages exist,
(2) each case has at least one lexical route — a route term found in the
capability index's Aliases column on a row pointing at an expected page,
or in an expected page's title, a heading, or its body — and (3) every
Rosetta record alias (`guide/rosetta/records/*.json`) is mirrored as a
seed-case route term, per the LLP 0186 W2 amendment.

What it does **not** prove: that a cold agent actually navigates to the
page within the ~15-tool-use budget, plans with the paved technique, or
avoids the anti-patterns. The checker only guarantees the lexical path
exists; whether an agent takes it remains the manual/W1-instrument
protocol below, with transcripts under `guide/eval-runs/`.

## Budget

The relevant guide page must be loaded within the first ~15 tool uses.

## Rubric

The run passes when the agent:

- (a) loads the relevant guide page(s) within budget;
- (b) plans or implements with the paved technique the page teaches; and
- (c) does **not** reach for the named anti-patterns — hand-wired HTTP glue
  for app data, polling a subscribable query, client-asserted identity.

## Evidence

The transcript of each run is retained under `guide/eval-runs/` (dated
subdirectory per run, one file per intent), referenced from the run's
summary note. A failed intent files a guide gap (see
[conventions](./conventions.md)) and blocks the change that triggered the
rerun until dispositioned.

## Owner and cadence

The guide's named owner (see `capabilities.md` header). Run at Phase 1 exit
and after any discovery-wiring change. Two consecutive runs with a failed
intent escalate to the Exact LLP 0365 retrieval-eval machinery per
LLP 0061's adoption triggers.

## Baseline

The failure exemplars this eval must not reproduce: diary 0010's
connection-state source-reading detour and ENG-22218's hand-wired HTTP glue.
