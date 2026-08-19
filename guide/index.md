---
title: The Snapback Guide
id: meta.index
order: 1
audience: agent-first
capabilities: [operating.served-guide, operating.guide-mcp]
authorities: [llp/0060-hosted-auth-security.rfc.md, llp/0061-agent-first-snapback-guide.rfc.md, llp/0000-snapback.explainer.md, llp/0042-agent-mcp-surface.rfc.md, llp/0064-native-client-surfaces.rfc.md, llp/0181-zero-configuration-expo.rfc.md, llp/0184-agent-accessible-control-plane.rfc.md, crates/snapback-server/src/server.rs, crates/snapback/src/schema_export.rs, schemas/http.routes.v1.json, crates/snapback-cli/src/cli.rs, crates/snapback-cli/src/guide_mcp.rs, packages/snapback-cli/index.mjs, packages/snapback-cli/expo-dev.mjs, packages/snapback-cli/mcp-control.mjs, llp/0193-errors-as-docs-completeness.plan.md, scripts/generate-diagnostics-registry.mjs]
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
