# LLP 0005: Contract/Exact and React integration

**Type:** Explainer
**Status:** Draft
**Systems:** Contract/Exact, React/Expo, Client integration, Developer experience, Sync, Realtime
**Author:** Charlie Cheever / Codex
**Date:** 2026-06-25
**Revised:** 2026-06-26
**Related:** LLP 0000, LLP 0003, LLP 0004, LLP 0012

## Summary

Snapback's primary product relationship is with the Contract/Exact app stack.
React and Expo are first-class secondary consumers. This document explains what
that means at the integration boundary: Contract/Exact should get the richest
authoring and validation loop, React/Expo should get excellent framework
bindings over the same generated Snapback contract, and Snapback core should not
fork its data, sync, auth, or runtime semantics by client framework.

The shared layer should be a headless integration contract: generated source,
manifests, runtime adapters, capability reports, and diagnostics that any client
adapter can consume without depending on a particular frontend shell.

This document does not define Contract/Exact from first principles. Snapback
cites Exact's own authority documents for that boundary: the Exact repository's
[`README.md`](../../exact/README.md), [`AGENTS.md`](../../exact/AGENTS.md),
[Exact 0216](../../exact/llp/0216-contract-explained.explainer.md) for the
Contract explainer, [Exact 0160](../../exact/llp/0160-contract-by-default.rfc.md)
for the default-authoring policy, [Exact 0158](../../exact/llp/0158-design-mode.rfc.md)
and [Exact 0200](../../exact/llp/0200-contract-design-mode-authoring-platform.rfc.md)
for Design Mode, and [Exact 0263](../../exact/llp/0263-contract-data-bindings-for-snapback-and-backends.rfc.md)
/ [Exact 0265](../../exact/llp/0265-contract-snapback-data-authoring-ergonomics.rfc.md)
for current Contract+Snapback data-binding context. This document captures
Snapback's side of the relationship, the Design Mode integration shape implied
by the root document, and the boundary that keeps React/Expo strong without
letting it steer the core architecture.

## Motivation

LLP 0000 establishes that Contract/Exact is the primary client target and that
React/Expo is a strong second. That priority affects real design choices:
Snapback is local-first, mobile-aware, realtime, and agent-first because the
primary product surface needs those properties to feel native rather than bolted
on.

The risk is ambiguity. "Contract/Exact first" could be misread as either a hard
coupling to one frontend product or a vague marketing preference with no design
force. Neither is right. Snapback should expose durable backend capabilities that
Contract/Exact can drive unusually well, while preserving the same app-facing API
for other clients.

The React/Expo note matters for the opposite reason. React is important enough
that the generated client API and local-first runtime must support it well, but
React conventions should not force the core model away from Contract/Exact,
agent validation, offline sync, or SQLite-to-Postgres portability.

## Valet diary inputs

The Valet demo diaries sharpen this document from a priority statement into an
integration contract. Across todo, kanban, Partiful-style invites, Klondike, and
Pong demos, the successful shape was consistent: source-authored Snapback schema
and handlers, generated manifests, Contract query/mutation bindings, a query
state boundary, and a thin bridge into the UI surface. The failure modes were
also consistent: every demo copied bridge code, browser packaging was fragile,
and local/server capability differences were easy to miss until a real browser
or second client exposed them.

The lessons that matter for Snapback's side of the Contract/Exact relationship:

- **The adapter is product, not sample code.** Repeated demo-local files such as
  `boot-snapback.ts`, `snapback-bridge.ts`, `wire-contract.ts`, Vite aliases, and
  wa-sqlite middleware are evidence for a first-class generated adapter package,
  not evidence that each app should own this glue.
- **Browser packaging is part of the backend integration.** A Contract or React
  browser app needs tree-shakeable backend selection, browser-pure entry points,
  one canonical wa-sqlite/Vite recipe, and no accidental imports of node-only or
  native-only modules.
- **Initial query state must be authoritative.** Several demos hand-primed a
  Contract query boundary from `getAllDocs` because subscription did not deliver
  an initial local snapshot. The shared contract should expose current value plus
  subscription as one seam rather than making adapters race a manual prime
  against later updates.
- **Capabilities must describe local/server parity.** The diaries found
  `localAuthUserId` versus server auth mismatches, local handler APIs missing
  server query helpers, async handler runtime differences, server replay seeing
  only handler source, namespace/table drift, and rate-limit behavior that left
  pending mutations stuck. Adapters need these as explicit capabilities or
  diagnostics, not tribal knowledge.
- **Verification has to be multi-surface and multi-client.** Headless host-tree
  checks caught different issues from Playwright browser tests, and two-window
  tests caught auth, presence, sync, and partial-state bugs that one-window demos
  missed.
- **React is the practical baseline, not an afterthought.** The diaries repeatedly
  found Contract more promising for agent-authored, verifiable UI, but React
  faster for time-to-first-pixel and familiar escape hatches. Snapback should use
  React/Expo support as a pressure test for whether the headless contract is
  genuinely framework-neutral.

## Relationship model

Snapback is the backend capability layer. It owns application data, backend
function execution, auth integration, asset metadata, scheduled work,
notifications, sync, realtime updates, diagnostics, and deployment targets.

Contract/Exact is the primary app-authoring and app-running context. It should
be able to express product intent in its own surfaces -- especially Exact Design
Mode -- and have that intent compile down to Snapback artifacts that are
inspectable, generated, validated, and runnable.

React/Expo is a framework adapter family over the same Snapback artifacts. It
should consume generated function references, type information, live query
subscriptions, pending mutation state, auth/session state, sync state, and
diagnostics. It should not need a Contract/Exact runtime in order to use
Snapback.

The practical rule: Contract/Exact gets the richest paved path, but not a
private backend. React/Expo gets a high-quality adapter, but not veto power over
the underlying programming model.

## Headless integration contract

The strongest way to keep Contract/Exact deep and React/Expo healthy is to put a
headless integration contract beneath both. Contract/Exact Design Mode,
Contract/Exact runtime surfaces, React, Expo, tests, and agent tools should all
consume the same underlying facts.

That contract should include at least:

- source-authored schema and handler definitions;
- generated schema and function manifests;
- generated read-set, primary-table, or dependency metadata precise enough for
  adapters to refresh the right query boundaries without guessing from filenames;
- generated function references and typed client bindings;
- target capability reports, such as whether local execution, offline replay,
  search, asset upload, auth impersonation, handler replay, browser-local query
  helpers, and live subscriptions are available;
- stable machine-readable diagnostics with source spans where possible;
- runtime state channels for connection status, pending mutations, replay
  failures, local sync state, subscription state, and authoritative initial query
  snapshots.

These artifacts are not a new set invented here. The schema/function manifests,
generated function references, and typed bindings are LLP 0004's generated
app-facing API; the capability reports, machine-readable diagnostics, and
runtime-state channels are produced by the LLP 0003 server. This document's
contribution is the requirement that *every* adapter — Contract/Exact Design
Mode, Contract/Exact runtime, React, Expo, tests, and agent tools — consume the
same generated facts, rather than each growing its own. When a reported
capability is absent, an adapter must surface that gap rather than paper over it;
the per-capability degradation policy is owned by the downstream sync, auth, and
runtime contracts.

This contract should be usable without Contract/Exact installed. A plain
React/Expo project, a local doctor command, or an agent validation tool should be
able to inspect the same generated facts and exercise the same queries and
mutations. Contract/Exact can add a richer authoring surface on top, but it
should not be the only way to understand or run the generated Snapback app.

The contract also has to preserve target separation. Browser, local-server,
native, and hosted targets may use different storage engines and runtimes, but
their entry points must make those choices explicit and tree-shakeable. An
adapter for one target must not accidentally bundle another target's native
module, filesystem dependency, or server-only helper.

## Contract/Exact integration

Contract/Exact integration should center on generated, inspectable artifacts
rather than hidden bridge code. A Design Mode action should be able to produce or
modify:

- schema definitions, field validators, indexes, and sync metadata;
- named queries, mutations, and eventually actions;
- permission and auth rules once those LLPs exist;
- generated client bindings and function references;
- local sandbox or doctor runs that prove the generated behavior works;
- diagnostics explaining schema, permission, query-plan, sync, and capability
  failures.

The generated Contract/Exact adapter should own the boring operational seams the
Valet demos had to copy by hand: browser/local-server boot, query-boundary
wiring, mutation invocation, initial local snapshots, pending-mutation state,
Vite/browser setup where relevant, and handoff from Snapback diagnostics to
Design Mode. A new Contract/Exact app should not need to re-implement the
Snapback bridge before it can show data.

The important UX contract is not that every Snapback concept must appear as a
manual control. It is that a Design Mode action -- a sentence typed into a
segment, a knob turned, or an agent-authored edit -- can map cleanly onto the
right Snapback behavior and then validate that mapping. Design Mode should act
as an authoring and inspection layer over durable Snapback source and generated
artifacts, not as a hidden side channel whose state only Contract/Exact can
interpret.

Examples of the mapping:

- "Add RSVPs to this event screen" should become data model changes, mutations,
  a live query, authorization rules when available, and a subscription whose
  realtime behavior can be checked locally.
- "Keep recent messages available offline" should become a sync policy and local
  store behavior, not a separate frontend cache invented by the app.
- "Only the current player can see this hand" should become an
  authorization-aware sync/subscription rule, not a visual hiding rule in the
  client.

Snapback should make these mappings legible to agents. Generated manifests,
source spans, capability flags, query plans, permission explanations, local
execution traces, and stable diagnostics are part of the product surface, not
debug-only leftovers.

## Boundaries

Contract/Exact-specific affordances belong in the Contract/Exact adapter,
Design Mode integration, generated bridge package, or project template. They
should not leak into the Snapback core as special cases unless the capability is
actually a general backend requirement. A Contract/Exact-motivated need
graduates into Snapback core only when at least one of these is true: the same
capability is required by React/Expo or the local doctor/agent tooling; it
protects a shared backend invariant such as auth-aware sync, portability,
deterministic replay, or honest diagnostics; or it is needed by more than one
LLP 0000 reference-app family. Otherwise it stays in the adapter/template layer.

Snapback core should define:

- schema and handler semantics;
- the generated app-facing API;
- sync, realtime, auth, storage, and runtime behavior;
- diagnostics and capability reporting;
- portability rules across local, hosted, SQLite, and Postgres targets.

The Contract/Exact adapter should define:

- how Design Mode represents Snapback concepts;
- how Contract/Exact project structure hosts generated Snapback files;
- how agent edits, codegen, local doctor runs, and previews are sequenced;
- how Snapback diagnostics are surfaced in Contract/Exact UI and agent loops;
- which Contract/Exact affordances are paved-path conveniences over core
  Snapback features.

This split keeps the primary integration deep without making Snapback unusable
outside Contract/Exact.

## React and Expo

React and Expo should use the same generated Snapback contract that
Contract/Exact uses. The React adapter can expose idiomatic hooks and helpers,
for example `useQuery`, `useMutation`, subscription state, optimistic mutation
state, connection state, and sync state. Those APIs are bindings over generated
function references; they are not the raw Snapback protocol.

React support should be good enough for serious apps:

- React Native and Expo must work with local-first partial sync, not just online
  request/response calls.
- React web should be able to subscribe to live query results without caring
  whether the server uses SQLite locally, Postgres later, or a hosted target.
- Pending mutations, optimistic results, replay failures, and connection state
  should be available to UI code in predictable framework-native forms.
- Generated types and diagnostics should work whether the app was authored in
  Contract/Exact, plain React, Expo, or another client shell.
- A React/Expo app should be able to start from the generated Snapback contract
  directly; it should not need a Contract/Exact project as an intermediate
  compiler or runtime.
- Browser and native React entry points should make storage/runtime selection
  explicit enough that web bundles do not pull node-only, native-only, or
  server-only Snapback modules by accident.

Where React conventions conflict with Snapback's core constraints, the core
constraints win. For example, Snapback should not expose direct client-side table
writes as the default just because they feel convenient in a component. The
paved path remains named queries and mutations, with live query subscription and
sync semantics owned by Snapback.

## Design implications

Several implications fall out of this relationship:

- The generated client/runtime adapter is a product artifact. It should not be
  copied by hand in demos or hidden inside one app shell.
- Capability reporting is required. Contract/Exact and React adapters both need
  to know which target features are available: local execution, offline sync,
  optimistic replay, auth impersonation, search, asset upload, and subscription
  support.
- Diagnostics must be machine-readable. Agents in Design Mode and agents editing
  React apps both need stable facts, not just human prose.
- Sync and authorization cannot be frontend-only concerns. If the client only
  hides unauthorized or unsynced data visually, the integration has failed.
- Framework adapters should stay thin over core semantics. Rich UI integration is
  welcome; private backend semantics per framework are not.
- The first-class adapter should make the common path one-command boring:
  codegen, local boot, browser/native packaging, initial query state, and
  diagnostics should be standard product behavior, not a diary-specific recipe.

## Validation path

The integration boundary is working only if it can be tested across adapters.
The first serious validation should use one small app, one generated Snapback
contract, and at least two client surfaces:

- a Contract/Exact or Design Mode surface that creates or edits the app's schema,
  queries, mutations, sync policy, and diagnostics;
- a React/Expo surface that consumes the same generated contract without private
  Contract/Exact runtime state;
- local doctor or sandbox output showing the same query, mutation, permission,
  sync, and capability facts visible to both adapters;
- a realtime check where a mutation from one surface updates a live query in the
  other surface;
- an offline or pending-mutation check once the local-first replay model exists;
- a failure check where an invalid schema, unsupported query, permission denial,
  or target capability gap is reported in a machine-readable form that both
  adapters can surface.

The Valet diaries suggest the first fixtures should not stop at todo. A todo app
is enough to prove the basic loop; a kanban or Partiful-style app is needed to
exercise multiple tables, query refresh metadata, and richer Contract binding
state; and a two-client game or presence fixture is needed to exercise
local/server auth parity, pending mutations, realtime propagation, and partial
multi-row state.

This two-adapter check validates the *integration boundary* specifically. It
comes after, and is distinct from, the first single-adapter functional validation
in LLP 0004's implementation sketch, and it does not pre-commit whether the
Contract/Exact or the React/Expo adapter ships first (see *Deferred work*). It
does not require the first implementation to have every feature. It does require
that adapters prove they are thin over the same Snapback semantics rather than
parallel client models.

## Deferred work

This explainer does not settle:

- the canonical definition of Contract/Exact or a canonical external reference;
- the exact file and package shape of the headless integration contract;
- the exact file layout for Contract/Exact projects that use Snapback;
- the Design Mode UI for Snapback concepts;
- the generated React package name, hook names, or API details;
- the package split for browser-pure, native, local-server, and hosted adapter
  entry points;
- whether React/Expo bindings ship before, with, or after the first
  Contract/Exact adapter;
- the local-first protocol, sync filters, auth model, or permission language;
- how a Contract/Exact preview process owns the local Snapback server lifecycle.

Those details should land in follow-on Specs or RFC revisions once the underlying
Snapback API, sync, auth, and runtime contracts are more concrete.

## Open questions

- What exact generated artifacts make up the headless integration contract:
  schema manifest, function manifest, capability manifest, diagnostic schema,
  client package, adapter protocol, or another split?
- Should generated function metadata include primary table, read set,
  dependency set, or another explicit refresh key so adapters never infer query
  invalidation from filenames?
- What is the shared "current value plus subscription" API that replaces
  adapter-side `getAllDocs` priming?
- Does Design Mode persist a high-level authoring intent log, or does it only
  materialize durable Snapback source files and generated manifests?
- Does Contract/Exact consume Snapback through generated TypeScript packages,
  through an internal host API, or both?
- Which Snapback diagnostics must be visible directly in Design Mode versus only
  in logs or agent tool output?
- Which local/server capability differences are allowed to degrade, and which
  should fail before preview: auth context, handler replay, query helpers,
  runtime choice, rate limits, or storage target?
- Should the first React adapter target Expo/React Native first, React web first,
  or both from the beginning?
- Which layer owns the local client store lifecycle for React Native and Expo:
  Snapback runtime, framework adapter, app code, or a target-specific package?
- How much local optimistic execution should React expose before the full
  local-first replay model is specified?
- Can Contract/Exact and React share one generated client package with thin
  framework-specific entry points, or do they need separate adapter packages?

## Status

Draft. This document should be revised once the first generated client/runtime
adapter is implemented against LLP 0004 and the v0 artifact schemas in LLP 0012.
