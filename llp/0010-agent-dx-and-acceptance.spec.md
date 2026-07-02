# LLP 0010: Agent DX and acceptance suite

**Type:** Spec
**Status:** Draft
**Systems:** Developer experience, Testing, API, Runtime, Build, Sync, Client integration
**Author:** Charlie Cheever / Codex
**Date:** 2026-06-25
**Revised:** 2026-07-01 (LLP 0032 R2: V1 implementation charter drafted, V0 marked superseded-in-practice; ratification pending)
**Related:** LLP 0000, LLP 0002, LLP 0003, LLP 0004, LLP 0005, LLP 0006, LLP 0007, LLP 0008, LLP 0009, LLP 0011, LLP 0012, LLP 0014, LLP 0024

## Summary

Snapback is agent-first. That is not a slogan about who types the code; it is a
requirement that the system expose stable, machine-readable facts an agent can
use to build, run, inspect, validate, and repair an app without hidden state or
human-only debugging rituals.

This Spec defines the first agent developer-experience contract and the initial
acceptance suite. The goal is to make the first implementation self-checking
from the beginning, not to add polish after the architecture exists.

## Scope

This Spec owns:

- the minimum local commands or command-equivalent tool surfaces agents need;
- machine-readable diagnostics;
- inspectable generated artifacts;
- deterministic reset and fixture behavior;
- the first reference-app acceptance ladder;
- required validation before broadening the subsystem surface.

It does not own the detailed semantics of storage, sync, auth, runtime security,
or client adapters. Those are covered by their subsystem LLPs. This Spec defines
how agents prove those contracts are working.

## Agent Contract

An agent working on a Snapback app must be able to answer:

- what schema is loaded;
- what functions are loaded;
- what generated artifacts changed;
- what target capabilities are available;
- whether the local server is ready;
- what database version and subscriptions exist;
- why codegen failed;
- why a query, mutation, permission check, or subscription failed;
- whether local optimistic execution and server execution disagree;
- what command or file should be changed next.

The system should prefer structured output over prose. Human-readable summaries
are useful, but every important diagnostic should have a stable code, target,
source span where possible, severity, and machine-readable details.

## Required Tool Surfaces

The exact CLI names are not fixed here, but the first implementation must expose
these operations:

- start the canonical local server;
- stop or restart it cleanly;
- reset the local app database deterministically;
- load or reload schema and functions;
- inspect loaded schema, functions, capabilities, database version, connected
  clients, active subscriptions, and recent errors;
- run a query or mutation as a chosen auth context;
- explain query plans, index usage, permission decisions, and capability gaps;
- run the acceptance suite.

The concrete v0 operation ids, CLI verbs, HTTP projection, control-plane MCP
tools, and generated app-data MCP catalog are pinned in
[LLP 0024](./0024-agent-operating-surface.spec.md). Any surface exposing these
operations should share that underlying structured result schema.

## Native Runtime Bootstrap

The canonical local target depends on Ibex, and Snapback currently links the
vendored `ibex-runtime` crate directly. That means an ordinary Rust build can
fail before any Snapback code is checked if the ignored Hermes headers,
frameworks, or compiler tools are missing under `vendor/ibex`. This is an
agent-DX failure: the agent sees a native Hermes error and starts trying to build
or repair Hermes, even though most Snapback work only needs prepared runtime
artifacts.

The Snapback bootstrap contract is:

- Normal Snapback agents run `scripts/bootstrap-ibex-runtime` before `cargo
  build`, `cargo test`, or `cargo run` on a clean checkout.
- The bootstrap first validates the vendored Ibex artifact locations expected by
  `vendor/ibex/build.rs`.
- If those are incomplete, it prefers a sibling `../ibex` checkout with prepared
  Hermes artifacts and an optional prebuilt `ibex` binary, copying/linking those
  ignored artifacts into `vendor/ibex`.
- Agents may point at a different prepared checkout with
  `SNAPBACK_IBEX_CHECKOUT=/path/to/ibex`.
- Only when no complete prepared artifact set exists should it fall back to
  Ibex's platform setup scripts, which may download or build Hermes.
- Agents should not start by building Hermes from source unless their task is
  explicitly about Ibex, Hermes, or runtime packaging.

This keeps the local target honest without making every Snapback agent rediscover
Hermes packaging details. A failed bootstrap should point at the missing artifact
class, not leave the next agent to infer it from a C++ build failure.

Valet's local-dev orchestrator (a Vite plugin) already implemented most of this and
is worth copying: spawn the server child process, codegen-on-save with debounced
coalescing, hot-push schema/functions to a running server, a health check that
reuses an already-running server, a raw TCP probe to tell "nothing listening" from
"port owned by something else," and `SIGTERM`→`SIGKILL` teardown
(`[observed - Valet LLP 0020]`). Two corrections for an agent-first product:

The no-argument local server should also be collision-tolerant for ordinary
development: try a stable Snapback local port range beginning at the canonical
port `4287`, bind the first available port in that range, and print/report the
actual bound address through the startup log and admin runtime state. Tooling
that supplies an explicit `--port` is asking for a pinned address and should keep
getting exact bind semantics, including an error if that port is owned by another
process.

Auto-selecting a port must not allow two local servers to own the same
file-backed app database. A file-backed local server should acquire an exclusive
sidecar lock for the resolved SQLite path before opening the database, keep it
held for the server lifetime, and write enough owner metadata for a second
startup attempt to report the owning PID and bound server URL. In-memory servers
do not need this lock.

- **Never silently serve stale bindings.** Valet's plugin, if codegen failed at
  startup but old generated output existed, continued with the **stale files** —
  resilient for a human, but it silently runs a wrong model. A codegen failure must
  surface as a diagnostic and the capability/state report must mark the loaded
  bundle stale.
- **Local/offline tooling must exit cleanly.** Valet's codegen generated all files
  correctly, then returned a non-zero exit code because a configured server push
  failed offline — a false failure in an agent's validation loop
  (`[confirmed - Valet diaries, 2026-06-25]`). Treat push failure as a warning;
  provide a `--no-push`/local mode.

Deterministic reset and fixtures should include a **declarative seed that writes
directly to the replica, bypassing mutation handlers**. Valet's browser seeds ran
real mutations, which made fixtures imperative and order-sensitive against codegen
(`[confirmed - Valet diaries, 2026-06-25]`); a `seed:apply <state>` that writes
fixture data straight to storage is reproducible and inspectable.

## Diagnostic Shape

A diagnostic should include:

- stable code;
- severity: info, warning, error, fatal;
- subsystem;
- target profile;
- source file and span when applicable;
- generated artifact path when applicable;
- function, table, field, index, subscription, or capability id;
- concise message;
- machine-readable details;
- suggested next checks, when safe to infer.

Diagnostics must not require scraping logs. Logs can link to diagnostics, but
the diagnostic object is the contract.

## Generated Artifacts

Agents need inspectable generated facts, including:

- schema manifest;
- function manifest;
- generated function references;
- capability manifest;
- diagnostic schema;
- client/runtime adapter metadata;
- loaded-bundle hash;
- local target state.

Generated artifacts should be deterministic enough to diff. A schema edit that
changes one field should not rewrite unrelated generated output without reason.

**No silent drops — the single most important agent-first rule.** Anything codegen
cannot parse (a field, index, validator, sync rule, return type) must emit a
structured diagnostic with a stable code and source span, and **never** be silently
omitted. This is the worst failure mode an agent can hit, because it teaches a
*false model* of the app with no error to react to. Valet is the worked example on
both sides: its schema codegen used regex + brace-matching (not an AST) and a
field written as `lane: laneStatus` (a validator *variable* reference, which the
regex did not match) was **silently stripped from the persisted schema** — inserts
succeeded, every filter on that field returned nothing, and the bug surfaced only as
wrong UI after a seven-step debugging hunt
([LLP 0006](./0006-valet-retrospective.research.md),
`[confirmed - Valet diaries, 2026-06-25]`). Two requirements follow: prefer an
**AST parser over regex** for anything load-bearing (Valet itself moved to an AST
analyzer for its security-critical surface checks, `[observed - Valet LLP 0041]`),
and validate manifest completeness against what is actually persisted, so a field
that exists in source but not in the table is an error, not a shrug. A related
silent class: a query whose declared namespace did not match the table its handler
read left data in the database that never reached the UI — the manifest must make
the read-set / primary table explicit and checked
([LLP 0012](./0012-headless-integration-contract.spec.md)).

Generated artifacts should carry a staleness marker. Valet's manifest included an
`inputsHash` over all codegen inputs, which let a `doctor` check catch a stale
build before the app ran (`[confirmed - Valet diaries, 2026-06-25]`); adopt that as
the freshness signal behind "what generated artifacts changed."

## First Slice Cutline

The first implementation should be a hard proof, not a broad demo. It should
include only:

- one trusted local app on the canonical Ibex + SQLite target;
- generated schema and function manifests loaded by the local server;
- one portable single-table indexed query shape;
- one restricted syncable-live query shape with an authoritative initial snapshot
  and online realtime deltas;
- one server-authoritative mutation path with one commit version per mutation and
  commit-time read-set conflict validation;
- deterministic reset and declarative seed;
- structured diagnostics for invalid schema, invalid function load, unsupported
  query form, stale generated artifacts, missing capability, and mutation
  conflict;
- one headless or React fixture consuming the generated contract.

The first slice should explicitly report these as capability gaps: offline
mutation replay, Postgres, Cloudflare, hosted/untrusted code, real external auth
providers, assets, cron, notifications, Contract/Exact Design Mode authoring,
rich text, high-frequency whiteboard fan-out, and finance-grade exact-money
invariants. A missing capability that is reported honestly is acceptable in the
first slice; a missing capability hidden behind fallback behavior is not.

## V0 Implementation Charter

Ratified on 2026-06-26: "first version of Snapback" means the first-slice proof
above, not a compressed v1. Implementation work should be reviewed against this
charter until it is replaced by a later accepted plan.

> **Superseded in practice (2026-07-01):** the implementation moved past this
> charter — cron, actions with outbound fetch, ephemeral realtime, and the
> admin console all shipped while it still said "must not claim" them. The V1
> charter below describes the current slice; it was drafted via
> [LLP 0032](./0032-decision-and-implementation-hardening.plan.md) R2 and its
> ratification is pending in the LLP 0000 ledger. V0 is preserved for the
> record.

V0 must include:

- the canonical local Ibex + SQLite server from LLP 0002;
- source-authored schema and handler entrypoints;
- generated schema and function manifests loaded by the local server;
- one indexed, portable, single-table query shape;
- one restricted syncable-live query shape with an authoritative initial
  snapshot and online realtime deltas;
- one server-authoritative mutation path using the accepted LLP 0003 execution
  boundary: async handler completion, buffered `ctx.db`, one commit version, and
  commit-time read-set validation;
- deterministic reset plus declarative seed that bypasses handlers;
- v0 schema/function/capability/diagnostic/runtime-state artifacts from
  LLP 0012;
- structured diagnostics for invalid schema, invalid function load, unsupported
  query form, stale generated artifacts, missing capability, and mutation
  conflict;
- one todo acceptance app, headless or React first, that proves query, mutation,
  live subscription, realtime update, conflict diagnostic, reset, and invalid
  schema/query diagnostics.

V0 must not claim:

- offline mutation replay;
- Postgres graduation;
- Cloudflare support;
- hosted or untrusted code execution;
- real external auth providers;
- assets, cron, notifications, actions, or outbound fetch;
- Contract/Exact Design Mode authoring;
- rich text or high-frequency whiteboard fan-out;
- finance-grade exact-money behavior.

## V1 Implementation Charter (proposed 2026-07-01, ratification pending)

Drafted via [LLP 0032](./0032-decision-and-implementation-hardening.plan.md)
R2 after the 2026-07-01 whole-repo review; supersedes the V0 charter above
once ratified. "Current slice" means what ships from this repository today.

V1 includes everything V0 included, plus:

- calendar-cron scheduled execution with run records and admin controls
  ([LLP 0028](./0028-cron-scheduled-execution.rfc.md));
- actions with outbound fetch behind `SNAPBACK_OUTBOUND_ACTIONS` — a coarse
  process-wide `network:fetch` grant, not a per-host allowlist
  ([LLP 0027](./0027-all-aboard-caltrain-demo.plan.md) recorded the corrected
  scope);
- ephemeral realtime state: declared collections, publish/subscribe, TTL and
  rate budgets, HTTP and WebSocket delivery
  ([LLP 0013](./0013-ephemeral-realtime-state.rfc.md));
- the admin console and `/_snapback/*` admin API with token/loopback gating,
  covering the v0 `/admin/*` aliases too (LLP 0032 S0;
  [LLP 0031](./0031-server-route-taxonomy.spec.md) owns the full route
  taxonomy);
- generated Contract bindings and the `snapback-contract` adapter consumed by
  the shipped demos ([LLP 0012](./0012-headless-integration-contract.spec.md),
  [LLP 0021](./0021-contract-exact-integration-hardening.plan.md)).

V1 must not claim (unchanged from V0 unless noted):

- offline mutation replay; Postgres graduation; Cloudflare support;
- hosted or untrusted code execution, or enforced CPU/wall-clock limits (the
  capability report self-declares them Missing);
- real external auth providers; assets; notifications;
- snapshot reads, read-your-writes `ctx.db`, or predicate-granularity
  read-set validation — ratified targets, not current behavior, until
  LLP 0032 Phase 2 lands (see LLP 0003 §Execution and Write Semantics status
  callout);
- client reconnect/resume or multiplexed live consumers (LLP 0032 P4);
- a packaged CLI or host-ops surface
  ([LLP 0024](./0024-agent-operating-surface.spec.md) is pinned, not built —
  LLP 0032 P6);
- rich text or high-frequency durable whiteboard fan-out; finance-grade
  exact-money behavior.

Those may appear as capability gaps and explicit TODOs. They should not appear
as hidden fallbacks, partial behavior under production names, or untested
optimistic claims.

## First Acceptance App

The first acceptance app is intentionally small: a todo app on the canonical
local target. It must prove:

- schema load;
- generated function references;
- one query;
- one mutation;
- `ctx.db` read/write behavior;
- system fields;
- one live subscription;
- one realtime update from another client or simulated client;
- one ordinary callable query that is correctly reported as not eligible for
  retained local-first sync;
- one concurrent mutation conflict where read-set validation prevents stale
  invariant commit;
- deterministic reset;
- machine-readable diagnostics for one invalid schema and one invalid query.

This app is the floor. If the todo path is not trivial for an agent to create,
run, and repair, Snapback's larger claims are not credible.

## First Contract/Exact Fixture

Once the headless artifacts from LLP 0012 exist, the first Contract/Exact
acceptance fixture should be the same todo app expressed through the current
Exact default path: a `.contract` surface with a `contract` block, stable
`testId` handles, and an agent/Design Mode edit that changes durable Snapback
source rather than hidden runtime state. The fixture should prove:

- Contract/Exact can inspect the generated Snapback schema, functions,
  diagnostics, capabilities, and runtime state;
- a Design Mode or agent edit can add one field or query, run codegen, and see
  honest diagnostics;
- a Contract/Exact surface and a React surface consume the same generated
  Snapback app with no private backend semantics;
- the Exact agent API or equivalent structured tree can validate the UI against
  the same backend facts the local doctor reports.

This does not require Snapback to define Contract/Exact. It uses the current
Exact facts as an external consumer: Contract is the native-first default
authoring model, React remains supported and production web stays React, and
Design Mode targets Contract first.

## Test Surfaces and Harness

Two complementary surfaces, both validated by Valet:

- A **deterministic, message-level sync harness** with explicit
  `flush`/`deliver`/`sync` controls and fault injection (`disconnect`,
  `dropNextMessage`, `reorderMessages`), asserting properties like convergence,
  causal ordering, no ghost docs, offline durability, and deterministic replay.
  Carry over two cheap disciplines: **ban `setTimeout`/sleep in tests** (if a test
  needs to sleep, the harness is missing a capability) and use **fixed id pools to
  force collisions** that random ids would miss (`[observed - Valet LLP 0007]`).
- **Multi-client browser smoke tests** — the surface that actually caught Valet's
  hardest bugs. A two-client cursor-sync test exposed a server-auth mismatch no
  single-client test could; smoke tests also caught an unsupported `withIndex` and a
  namespace mismatch (`[confirmed - Valet diaries, 2026-06-25]`). For agents, a
  structured host-ops/inspection tree is "a better test surface than a DOM." Note
  the gotcha: a UI that re-creates nodes per render fights Playwright actionability,
  needing `force`/direct dispatch.

**Make the protocol-vs-handler-replay boundary explicit.** Valet's harness applied
mutations as snapshots, **not** by re-executing handler functions — so handler-based
replay, the hardest correctness surface (the thing that makes `position = count + 1`
produce 5 not 4 on rebase), was never tested by the harness and slipped to slower
e2e suites (`[observed - Valet LLP 0007/0048]`). Snapback should make handler replay
first-class in the harness from the start, and state which suite proves which
contract so an agent is not misled about coverage.

## Acceptance Ladder

After the todo app, add reference-app slices in this order:

1. **Messaging slice:** partial local retention, reconnect, and live delivery.
2. **Kanban slice:** optimistic multi-row mutation and realtime reorder.
3. **Card-game slice:** authorization-aware sync where different clients see
   different rows from the same underlying game state.
4. **Task-tracker slice:** index-first query and cursor pagination over a larger
   local dataset.
5. **Party slice:** RSVP live update and notification stub once notifications
   exist.
6. **Asset slice:** upload metadata and processed-media state once assets exist.

The full reference-app list in LLP 0000 remains the north star. This ladder is
the build order for minimal acceptance slices, not a claim that these apps are
feature complete.

A collaborative rich-text pad should be added as a stretch acceptance slice once
the sync/realtime model is stable enough to evaluate editor-specific
collaboration. Passing that slice means Snapback supports at least one explicit
rich-text strategy with cursor/selection presence, offline replay, and convergent
multi-client edits across more than one client platform. It is not a v1 blocker
and should not be interpreted as a requirement to support every CRDT, OT, or
editor storage model.

## Reference-App Coverage

Every LLP 0000 reference app should eventually map to an acceptance profile before
Snapback uses it as evidence for product or scale claims. The first ladder above
covers todo, messaging, kanban, card game, task tracker, party, and assets. The
remaining examples need explicit profiles:

- e-commerce: inventory/order atomicity, payment-integration boundary, product
  media assets;
- collaborative whiteboard: high-frequency ephemeral presence, fan-out ceiling,
  and explicit non-goal boundary against fast-twitch games;
- collaborative rich-text pad: one chosen CRDT/OT/block strategy, not generic
  row-sync hand-waving;
- Notion-like workspace: desktop-scale local store, mixed structured/freeform
  data, large result pagination;
- team chat/community hub: channel fan-out, presence, retained history, and
  notification stubs;
- social/video app: asset processing, feed read fan-out, and the CDN-scale
  non-goal line;
- blog: read-heavy web consumption and image assets;
- finance app: exact decimals, sensitive-data auth, external market-data
  boundary, and money-grade write invariants;
- fantasy sports picker: cron-driven locks/scoring, realtime leaderboards, and
  v2 data-gateway dependency.

Each profile should state data volume, local-store size, mutation rate,
subscription count, fan-out pattern, target capabilities, and acceptable
degradation. Without those numbers, the app is a demo shape, not a scale claim.

## Capability Reports

Every target should report capabilities rather than pretending all Snapback
features are present everywhere. Capability reports should include at least:

- storage engine;
- runtime engine;
- live subscriptions;
- syncable-live query subset;
- online-only or replace-only query modes;
- offline retention;
- optimistic replay;
- mutation read-set validation and whether conflict retry is automatic;
- auth impersonation;
- permission diagnostics;
- asset upload;
- outbound fetch/actions;
- cron;
- notifications;
- local reset;
- supported query forms;
- portability opt-outs.

Adapters and tests must fail or degrade explicitly when a capability is missing.

Encode known **local-vs-server parity** divergences as capability flags or
diagnostics rather than leaving them as tribal knowledge — the agent contract above
already asks "whether local optimistic execution and server execution disagree."
Valet's recurring parity footguns make the list concrete (`[observed - Valet LLP
0024/0005]`, `[confirmed - Valet diaries, 2026-06-25]`): `Date.now()` is patched for
replay but `new Date()` is not; query builders are mutable so a reused builder /
double `.collect()` accumulates filters; a filter on a misspelled field silently
matches no rows; table-name-from-id parsing diverged between client and server on
malformed ids; an indexed `withIndex` query worked server-side but threw in the
browser-local handler. Each is a "works by accident" trap an agent should be able to
see in a capability/diagnostic report.

## Local-Server State Inspection

The local server from LLP 0003 should expose:

- schema hash and loaded time;
- function bundle hash and loaded time;
- app database path or target id;
- current database version;
- recent changeset ids;
- active subscriptions and their query references;
- connected clients;
- recent dispatch errors;
- runtime engine and isolation mode;
- resource-limit settings.

This is not a production observability replacement. It is the minimum local
feedback loop for agents.

## CI and Review Gates

Before a subsystem LLP moves beyond `Draft`, it should name the acceptance tests
that prove its contract. Before implementation PRs merge, CI should run:

- `./ref-check --verbose` for the LLP corpus;
- unit tests for generated manifests and diagnostics;
- local acceptance tests for the affected subsystem;
- the todo acceptance app once the local core exists.

When a behavior is not yet implemented, the capability report should say so and
the tests should assert the reported gap rather than silently skipping it.

The portability and cross-engine story should be backed by a **machine-readable
conformance corpus** expressed as product artifacts (`schema`, `functions`, portable
seed) rather than implementation-internal tests. Adopt the contract Valet designed
(`[observed - Valet LLP 0035]`): every case declares `required_capabilities`; a
runner reports `skipped:capability_missing` or `skipped:corpus_version_too_new`
(soft skip, not silent); a fixed placeholder table (`$NOW`, `$TOKEN`, `$ID:<name>`)
makes cases deterministic; results are a stable, diffable schema; and engine drift
is a release blocker, not a footnote. Sequence the corpus so the **replay and wire
runners come first** — Valet built four of nine case kinds and the ones it skipped
were `wire` and `mutation_replay`, exactly the runners that prove a local-first
product is not a thin online wrapper, plus the cross-engine matrix CI that would
have made "portable" more than an assertion (`[observed - Valet LLP 0035/0083/0048]`).
The hardest, most valuable acceptance pieces are the ones most likely to be deferred
under pressure; gate honestly when they are not yet built.

## Open Questions

- What package boundaries should carry the pinned CLI/MCP implementation?
- LLP 0024 answers the surface-shape question for v0: CLI, HTTP, and MCP are
  all projections of one internal host-ops core.
- Which diagnostic codes are stable enough for v1?
- How much generated output should be committed versus built on demand?
- Which pieces of the first Contract/Exact fixture depend on a stable external
  Contract/Exact definition versus the current Exact default-path facts?

## Status

Draft. The Valet DX record ([LLP 0006](./0006-valet-retrospective.research.md)) is
folded in — the no-silent-drops rule, the harness and conformance-corpus contracts,
the orchestrator surface, and the parity-divergence flags all come from what Valet
shipped or missed. This Spec should be revised alongside the first local server and
treated as a required part of implementation, not downstream polish.
