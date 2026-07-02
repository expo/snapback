# LLP 0012: Headless integration contract

**Type:** Spec
**Status:** Draft
**Systems:** Contract/Exact, React/Expo, Client integration, Developer experience, API, Sync
**Author:** Charlie Cheever / Codex
**Date:** 2026-06-25
**Revised:** 2026-07-01 (LLP 0032 M3: DK-3 wire guardrail added — keep the cacheable-HTTP-read-lane option open beside WS delivery; earlier: linked LLP 0030 for Contract/Exact preview server lifecycle)
**Related:** LLP 0000, LLP 0004, LLP 0005, LLP 0006, LLP 0007, LLP 0008, LLP 0009, LLP 0010, LLP 0011, LLP 0013, LLP 0014, LLP 0017, LLP 0024, LLP 0030

## Summary

LLP 0005 explains the relationship between Snapback, Contract/Exact, and
React/Expo. This Spec turns that relationship into a headless integration
contract: the generated artifacts, manifests, capability reports, diagnostics,
and runtime state that every adapter consumes.

Contract/Exact gets the richest paved path, especially through Design Mode.
React/Expo remains a serious secondary target. Both must sit on the same
Snapback facts instead of growing private backend semantics.

## Scope

This Spec owns the adapter-facing contract beneath:

- Contract/Exact Design Mode;
- Contract/Exact runtime surfaces;
- React and Expo bindings;
- local doctor and sandbox tools;
- reference-app acceptance fixtures;
- agent tooling.

It does not define Contract/Exact from first principles. Snapback cites Exact's
own authority documents for that: the Exact repository's
[`README.md`](../../exact/README.md), [`AGENTS.md`](../../exact/AGENTS.md),
[Exact 0216](../../exact/llp/0216-contract-explained.explainer.md) for the
Contract explainer, [Exact 0160](../../exact/llp/0160-contract-by-default.rfc.md)
for the default-authoring policy, [Exact 0158](../../exact/llp/0158-design-mode.rfc.md)
and [Exact 0200](../../exact/llp/0200-contract-design-mode-authoring-platform.rfc.md)
for Design Mode, and [Exact 0263](../../exact/llp/0263-contract-data-bindings-for-snapback-and-backends.rfc.md)
/ [Exact 0265](../../exact/llp/0265-contract-snapback-data-authoring-ergonomics.rfc.md)
for current Contract+Snapback data-binding context. This Spec defines
Snapback's side of the boundary and should not copy Exact's own authority map.

## Contract Artifacts

The headless contract consists of logical artifacts. Their physical filenames can
change while the implementation is young, but generated output must identify
which logical artifact it is.

Required artifacts:

- source-authored schema and handler entrypoints;
- schema manifest;
- function manifest;
- generated function references;
- generated client package or package metadata;
- capability manifest;
- diagnostic schema;
- runtime state schema;
- target profile description.

Adapters consume these artifacts. They do not infer backend semantics from
private code paths.

**Packaging is part of the contract, and Valet's was artisanal — fix it here.**
Across every Contract+Snapback demo, the integration cost was almost entirely
packaging, not semantics (`[confirmed - Valet diaries, 2026-06-25]`):

- there was no published, typed package, so each consumer hand-maintained a fragile
  alias map to the runtime's source — and `tsc` passed while reporting real
  unresolved-module errors, so **typecheck was "lying about being green,"** defeating
  the agent's primary self-validation signal;
- a peer checkout silently diverged from a vendored one ("newer commit ≠ has the
  feature"), arguing for **capability-based resolution** (probe for the feature, not
  the directory) — which the Versioning section makes a manifest concern;
- a "framework-agnostic" client was React-coupled by packaging, and isomorphic
  clients dragged native modules into browser bundles, arguing for a **truly
  framework-agnostic core with tree-shakeable backend selection**;
- every demo re-copied ~200 lines of bridge glue (manifest projection +
  query-state-sum adaptation + cold-start prime) and a ~10-entry build-alias block.

So this contract must ship **real, typed, versioned packages** (not source aliases),
a build preset that owns the wiring, and the **bridge as a first-class adapter**
(`@expo/snapback/contract`-style) rather than something each consumer re-derives. If
the published artifacts are not trustworthy enough that `tsc`/typecheck is honest,
the headless contract has not actually shipped.

## V0 Artifact Schema Pin

Ratified on 2026-06-26: v0 pins the logical artifact schemas below for the
first local implementation. The filenames may move while packages settle, but
each artifact must declare `schemaVersion: "snapback.v0"` and `artifactKind`, and
diagnostics must report version mismatches rather than letting adapters infer.

**Evolution policy — the pin is a floor, not a ceiling.** During v0, *adding* a
field to a pinned artifact is non-breaking: adapters must ignore fields they do
not recognize, and a subsystem that needs a new fact extends the relevant shared
artifact here rather than forking a parallel schema. *Renaming* or *removing* a
pinned field, or changing an emitted diagnostic code, is a compatibility event
that requires a `schemaVersion` past `snapback.v0` (see [Versioning](#versioning)
for how a mismatch is then surfaced). This makes this Spec the registry for the
shared artifact shapes: other LLPs register their additions into the
`runtimeState`, `capabilityManifest`, and diagnostic-code families defined here —
for example [LLP 0013](./0013-ephemeral-realtime-state.rfc.md)'s ephemeral room
counters and [LLP 0017](./0017-admin-console-inspection-surface.rfc.md)'s admin
facts (host, port, uptime, admin-write capability) — so `artifactKind` and
`schemaVersion` let a doctor or adapter detect a field set it does not yet
understand instead of guessing.

### V0 Schema Manifest

Required fields:

- `artifactKind: "schemaManifest"`;
- `schemaVersion`;
- `appId`;
- `schemaHash`;
- `tables`, each with name, source span when available, fields, system fields,
  indexes, sync metadata, and portability flags;
- validator descriptors using the first portable validator vocabulary;
- generated-at timestamp and codegen input hash.

### V0 Function Manifest

Required fields:

- `artifactKind: "functionManifest"`;
- `schemaVersion`;
- `bundleHash`;
- `functions`, each with id, exported name, source span when available, kind,
  args validator, required capabilities, auth requirement, syncability class,
  primary table/read-set summary, write-set summary for mutations when known,
  and handler bundle entrypoint;
- unsupported dependency diagnostics emitted during bundling.

V0 function ids are generated references, not route strings. Adapters call
through generated references and must not infer a table from the filename or
namespace.

### V0 Capability Manifest

Required fields:

- `artifactKind: "capabilityManifest"`;
- `schemaVersion`;
- target profile id;
- storage engine;
- runtime engine;
- local server lifecycle support;
- live subscriptions;
- syncable-live query support;
- online-only and replace-only query modes;
- offline retention;
- optimistic replay;
- mutation isolation mode;
- auth impersonation support;
- permission diagnostics;
- asset upload;
- outbound actions;
- cron;
- notifications;
- supported query forms;
- portability opt-outs;
- resource limits, each marked `enforced`, `advisory`, or `missing`.

Missing features are data, not prose. Adapters and acceptance tests assert the
reported gap.

### V0 Diagnostic Schema

Required fields:

- stable `code`;
- `severity`;
- `subsystem`;
- `targetProfile`;
- source span when available;
- generated artifact reference when applicable;
- function/table/field/index/subscription/capability id when applicable;
- concise message;
- structured details;
- suggested next checks when safe to infer.

The first stable code families are `SCHEMA_*`, `FUNCTION_*`, `QUERY_*`,
`CAPABILITY_*`, `BUNDLE_*`, `RUNTIME_*`, `HANDLER_*`, `MUTATION_CONFLICT`, and
`STALE_*`. Exact code names can grow during implementation, but changing an
emitted code is a compatibility event. `HANDLER_*` covers normalized JavaScript
handler failures such as ambient capability denial and arbitrary handler throws,
so adapters never receive raw runtime errors as the integration contract.

### V0 Runtime State

Required fields:

- `artifactKind: "runtimeState"`;
- `schemaVersion`;
- target profile id;
- local server readiness;
- loaded schema hash and loaded time;
- loaded function bundle hash and loaded time;
- app database path or target id;
- current database version;
- active subscriptions;
- connected clients;
- pending mutations;
- recent changeset ids;
- recent dispatch/runtime errors;
- runtime engine and isolation mode;
- resource-limit settings and enforcement status.

Framework adapters may expose these facts idiomatically, but the underlying
state shape is shared.

## Schema Manifest

The manifest and state sections that follow — schema, function, capability,
diagnostic, and runtime state — give the rationale and intent behind these
artifacts. Where one lists fields, the pinned set under
[V0 Artifact Schema Pin](#v0-artifact-schema-pin) is the normative v0 schema; a
field that appears only in the prose below is a candidate for the next pin
revision, not part of v0 until it is reconciled into the pin.

The schema manifest should include:

- app id or local project id;
- schema hash;
- tables;
- fields and validators;
- system fields;
- indexes;
- sync metadata;
- permission metadata when available;
- portability flags;
- source spans where available.

The manifest is the adapter's source of truth for what data exists and what can
be edited or inspected.

## Function Manifest

The function manifest should include:

- generated function id;
- exported name and source span;
- kind: query, mutation, and later action;
- args validator;
- return type or generated type reference when available;
- required capabilities;
- auth requirements;
- syncability and subscription support;
- the tables a function reads/writes (its read-set / primary table), explicit and
  validated against the handler body — not inferred from the file or a hand-set
  namespace;
- bundle or module hash.

Adapters should call functions through generated references, not handwritten
endpoint strings. The read-set/primary-table field is load-bearing: in Valet a
query whose declared namespace did not match the table its handler actually read
left rows in the database that **never reached the UI** — counts stuck at zero, no
error — until the file was moved to fix the namespace
([LLP 0006](./0006-valet-retrospective.research.md),
`[confirmed - Valet diaries, 2026-06-25]`). Make the table binding an explicit,
checked manifest fact so this silent class of failure cannot recur, and so the sync
matcher ([LLP 0008](./0008-local-first-sync-and-realtime.rfc.md)) has the read-set
it needs.

## Capability Manifest

The capability manifest reports what the current target can do. It should cover:

- storage engine;
- runtime engine;
- local server lifecycle ownership;
- live subscriptions;
- syncable-live query subset;
- online-only and replace-only query modes;
- offline retention;
- optimistic replay;
- mutation isolation mode: read-set validation, retry, reject-only, or another
  named strategy;
- auth provider and impersonation support;
- permission diagnostics;
- asset upload;
- outbound actions;
- cron;
- notifications;
- supported query forms;
- portability opt-outs.

An adapter must surface missing required capabilities instead of silently
falling back to a different model.

Query capability must be fine-grained. A generated function being callable does
not imply it can be retained locally, incrementally updated, or safely resynced
after permission changes. The manifest should distinguish at least:

- callable online query;
- live replace/resnapshot query;
- syncable-live query with retained local results and incremental deltas;
- offline-retained query;
- auth-resyncable query.

Adapters must use those classes in their public runtime state. A React hook or
Contract/Exact binding should not label a result "local-first" unless the
underlying function has the syncable-live/offline-retained capabilities the target
requires.

> **DK-3 wire guardrail (2026-07-01).** The read-path classes above describe
> *what a query is*, not *which transport delivers it*. v1 delivers over the
> stateful WebSocket only ([LLP 0008](./0008-local-first-sync-and-realtime.rfc.md)
> DK-3, on the M1 fan-out evidence in
> [LLP 0035](./0035-local-target-benchmarks.research.md)), but that pin must not
> harden into an assumption. A future **cacheable HTTP read lane** (LLP 0022's
> "most actionable single idea") has to be addable as a *new read-path delivery
> option beside* the WS path — not a breaking wire change. Keep the delivery
> transport out of the query capability class, and do not pin further read-path
> wire surface that presumes WS-only, until DK-3's revisit trigger fires.

The manifest must encode the **Online vs. Parity** distinction Valet drew for
adapters (`[observed - Valet LLP 0037]`): an *Online* client speaks the wire
protocol and runs mutations on the server (it may offer optimistic UI from mutation
args), while a *Parity* client adds local handler execution, deterministic replay
with the captured environment, offline queueing, and rebase-on-reconnect. The rule:
**no local handler execution means no local-first/parity claim**, and an Online-only
adapter must not be documented or reported as equivalent to a parity SDK. This makes
"surface missing capabilities instead of silently falling back" concrete — an
adapter cannot quietly present itself as local-first while being online-only.

## Diagnostic Schema

Diagnostics are part of the integration contract. Each adapter should be able to
display, log, or act on the same diagnostic object.

Diagnostics should include stable codes, severity, subsystem, source spans,
generated artifact references, target profile, and structured details. Design
Mode may present them richly; React may show them through dev tooling; agents may
consume them directly.

The host-ops result envelope in
[LLP 0024](./0024-agent-operating-surface.spec.md) reuses this diagnostic schema
and its code families. CLI, HTTP, and MCP projections must not add another
diagnostic dialect for operation failures.

## Runtime State

Runtime state channels should include:

- connection state;
- local server readiness;
- loaded schema and function hashes;
- subscription state;
- pending mutations;
- replay failures;
- permission denials;
- local sync cursor;
- target capability changes;
- recent runtime errors.

Framework adapters can expose this state in idiomatic forms such as React hooks,
but the underlying facts should be shared.

Subscription state must be exposed as **one "current value plus subscription"
seam**, so no adapter has to race a manual prime against later updates. Every
Valet/Contract demo hand-primed a query boundary from `getAllDocs` because the
subscription delivered no authoritative initial snapshot
(`[confirmed - Valet diaries, 2026-06-25]`); the contract is that subscribing
returns the current authorized result *and* the live stream as a single seam (the
server's `subscribe_response` returns all matching documents before any deltas — see
[LLP 0008](./0008-local-first-sync-and-realtime.rfc.md)).

Valet's React adapter solved the races this contract will hit, and the reference
adapter should carry the same behaviors (`[observed - Valet LLP 0008]`): queue
deltas that arrive before the subscribe response and apply only those with
`version > subscribeResponse.version`; buffer messages received before `auth_ok`;
force a full resync on reconnect (incremental resume risks missing changes and
corrupting rebase); return an **empty array, not `undefined`,** on subscription
error so `data.map(...)` cannot crash; treat `skip` as a full unsubscribe, not a
pause; and expose a single combined pending-mutation count.

## Contract/Exact Requirements

Contract/Exact integration must treat durable Snapback source and generated
artifacts as the source of truth. Design Mode may offer higher-level authoring
controls, but those controls should materialize inspectable Snapback changes:

- schema edits;
- query and mutation edits;
- sync and permission edits once those contracts exist;
- generated manifests;
- local doctor or sandbox runs;
- diagnostics.

Design Mode should not keep hidden backend state that a plain agent, local
doctor command, or React adapter cannot inspect.

Snapback's Contract/Exact vocabulary should stay aligned with the Exact
authority documents linked in [Scope](#scope). If those documents change the
names, lifecycle, or Design Mode model, revise this Spec rather than letting
Snapback define a parallel interpretation.

## React and Expo Requirements

React and Expo adapters must work from the same generated contract without a
Contract/Exact runtime. They should expose idiomatic APIs for:

- live query subscription;
- mutation invocation;
- pending mutation state;
- connection state;
- local sync state;
- auth/session state;
- diagnostics and capability gaps.

The React adapter may be ergonomic, but it must remain a binding over generated
Snapback function references and runtime state. It should not introduce direct
table writes or a parallel cache model as the default application API. It must also
declare its capability class honestly (Online vs. Parity, above) — a React Native
adapter that does not run handlers locally is not local-first and must not be
documented as equivalent to one — and it should inherit the reference race-handling
behaviors (pre-subscribe delta queueing, error→empty-array, full-resync-on-reconnect)
rather than re-deriving them.

## Versioning

Each artifact should carry a version or schema hash. Adapters must declare which
artifact versions they support. If the local server, generated client package,
and adapter disagree about versions, the system should produce a diagnostic
rather than failing later at runtime.

Valet's experience hardens this section (`[observed - Valet LLP 0004/0012/0048]`):

- **Single source of truth + CI drift gate.** Valet kept its wire protocol in two
  hand-synced files (`protocol.ts` and `protocol.rs`) that "must be kept in sync" —
  exactly the drift this section guards against. Define each shared manifest/protocol
  in **one** source-of-truth schema that both codegen and runtime consume, and add a
  CI test that fails on drift (Valet later added codegen↔runtime enum drift tests).
- **Beware two hashes for one artifact.** Valet computed *two* schema hashes — the
  client hash excluded indexes the client never creates, the server hash included
  them — so "schema unchanged" meant different things on each side. Choose one
  canonical hash, or make each hash's scope explicit in the manifest so adapters
  compare like for like.
- **Staleness marker.** An `inputsHash` over all codegen inputs lets a doctor/adapter
  detect a stale build before runtime (`[confirmed - Valet diaries, 2026-06-25]`).
- **Capability- not directory-based resolution.** Because a peer checkout silently
  lagged a vendored one on a feature, the version handshake should let an adapter
  probe for a *capability/version*, not assume a location has it.

A version mismatch can be a *warning* that allows the connection to continue, or a
hard stop — Valet chose "continue with a warning"; pick deliberately and report it
either way rather than failing opaquely at runtime.

## Validation Requirements

The contract is valid only if one generated Snapback app can be consumed by at
least two surfaces. The first validation should prove:

- one schema and function set generates the shared artifacts;
- a Contract/Exact or Design Mode surface can inspect or edit those artifacts;
- a React/Expo surface can consume the same artifacts without Contract/Exact;
- both surfaces see the same diagnostics and capability gaps;
- a mutation from one surface updates a live query in the other;
- an ordinary callable query and a syncable-live query surface different
  capabilities to both adapters;
- mutation conflict diagnostics surface through the shared runtime state when
  read-set validation rejects stale work;
- no adapter depends on hidden backend semantics unavailable to the other;
- `tsc`/typecheck on a consuming app is honest — green means resolvable, typed
  artifacts, not source-alias theater;
- each adapter reports its capability class (Online vs. Parity), and an online-only
  adapter is not presented as local-first;
- a CI drift check fails when the shared manifest/protocol schema diverges between
  codegen and runtime.

This validation can use minimal UI. It is testing the contract boundary, not the
polish of either adapter.

## Open Questions

- What are the first physical file paths and package names for generated
  artifacts?
- Are generated client bindings one package with adapter entrypoints or separate
  packages per framework?
- Which fields above need to move from v0 manifests into separately versioned
  package schemas before public release?
- How does a Contract/Exact preview process own or attach to the local Snapback
  server lifecycle? [LLP 0030](./0030-managed-snapback-vite-dev.rfc.md) now owns
  the proposed Vite-managed dev answer; revise this Spec once that API is proven.
- Does Design Mode persist a high-level intent log in addition to source edits?

## Status

Draft. Valet's integration record ([LLP 0006](./0006-valet-retrospective.research.md))
is folded in — the packaging/typecheck-honesty bar, the Online-vs-Parity capability
class, the current-value+subscription seam, the reference adapter's race handling,
and the single-source-of-truth + drift-gate versioning all come from what Valet
shipped or got wrong. The v0 artifact schema pin is accepted for the first local
implementation; the broader Spec should still be revised when the first generated
client adapter is implemented. The retired Valet LLP 0088 ("Snapback Contract
Integration") holds reviewed adapter design — package API, headless boot
(`openSnapbackContractRuntime`), scoped install, generated runtime callables — to
mine into this Spec and [LLP 0021](./0021-contract-exact-integration-hardening.plan.md)
as the adapter is built; Exact 0265 still references 0088 and should repoint to the
Snapback corpus.
