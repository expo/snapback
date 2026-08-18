# LLP 0012: Headless integration contract

**Type:** Spec
**Status:** Draft
**Systems:** Contract/Exact, React/Expo, Client integration, Developer experience, API, Sync, Auth
**Author:** Charlie Cheever / Codex
**Date:** 2026-06-25
**Revised:** 2026-08-10, latest (LLP 0219 client dev diagnostics channel
amendment); 2026-08-03 (LLP 0109 acceptance reconciliation:
registered versioned seed installation as a separate closed family — the
`/app/ensure` intent union is unchanged — plus its status-mapper rows; see
the dated amendment). 2026-08-01 (LLP 0062-02 registration: the closed
`provision` DTO gains the optional `apiEnvelope` members carrier
(`ApiEnvelopeMembersV1`) — member material the server composes and
self-verifies at activation, never a received whole envelope; the
`AppApiDiscoveryV1` and content-addressed envelope artifacts register with
the `SNAPBACK_APP_API_*` family; engine ingestion re-verifies client-side).
Prior, same day (app-CLI registration: the
`SNAPBACK_APP_CLI_*` family joins the stable code dialect and the
Rust-owned `AppDataResultCoreV1` registers as a shared artifact shape;
forward skew per LLP 0024's frozen fallback rules). Same day, earlier: (call-time generation binding for sessions generated
references and subscriptions, with explicit unchecked legacy compatibility);
2026-07-31 (LLP 0044 companion registration: the
`SNAPBACK_ASSET_*` diagnostic family with its initial closed set; the
granular asset capability rows superseding the `assetUpload` boolean at
first implementation, with store-parameterized lifecycle claims,
delivery-profile and integrity-grade facts, and Missing-not-omitted v1
nonclaims; the asset wire DTOs versioned under the existing compatibility
rules); 2026-07-23 (LLP 0079 SC-3: dated reinforcement — the DK-3 additive-lane wire guardrail gains LLP 0078 F2a/F2e as external evidence); 2026-07-20 (Partitime Step 2 client checkpoint — the framework-neutral
`snapback.external-store.v1` implementation and `@snapback/react` adapter now
ship with package tests; React web and React Expo Android consume the same
generated function references and lifecycle store, while the Android carrier
claims Online only and the iOS and Exact Native tuples remain pending under LLP
0064); 2026-07-16 (ENG-24920 companion amendment); 2026-07-15 (registered LLP 0060 D6's future
`SNAPBACK_AUTH_HANDLER_INCOMPATIBLE` startup and per-invocation exposure while
keeping private binding markers out of public details). 2026-07-15 (registered the generated contract-data manifest as the
sole derived v1-sessions artifact exception and registered
`SNAPBACK_SCHEMA_PARSE_FAILED` in the shared diagnostic/status dialect; status
remains Draft). 2026-07-14 (ENG-24905: function ids are required and stable — a
manifest whose function omits its `id` fails load with the typed
`SNAPBACK_FUNCTION_IDENTITY_INVALID` refusal, ids are deterministic across
regeneration, and a rename retires the old id; the LLP 0055 stage
prerequisite); 2026-07-13 (ENG-24603 through ENG-24607: reconciled the item-5
through item-8 auth handshake, authority-descriptor, invalidation, authorized-
lease, client-custody, hosted-capability, and diagnostic registrations into the
shared adapter contract); 2026-07-13 (ENG-24597: registered LLP 0058's staged-mode,
invocation-gate, startup, and capability-refusal diagnostic classes); 2026-07-13 (ENG-24596: registered LLP 0057's implemented
auth-provider diagnostic family and deliberate HTTP status classes while
preserving the `hostOpsResult` transport projection); 2026-07-13 (ENG-24594: registered the adapter-visible
`SNAPBACK_AUTH_BODY_AUTH_UNSUPPORTED` refusal and the temporary pre-staged-mode
`SNAPBACK_AUTH_POLICY_UNAVAILABLE` backstop in the shared diagnostic contract);
2026-07-13 (ENG-24593 post-review bounded corrections: closed the
artifact/auth tuple to exactly v0-dev and v1-sessions, pinned the predecessor
diagnostic proof, and made privileged provisioning the sole `MODE_PENDING`
recovery branch; focused exact confirmation completed READY by both reviewer
families); 2026-07-12 (ENG-24572:
function artifacts are whole-manifest semantic units and reject atomically before
replacing a known-good generation); 2026-07-02 (LLP 0032 X1: DK-2 cursor pin —
versions are per-app-stream opaque `(stream, version)` resume tokens, no
cross-stream comparison; earlier: 2026-07-01 LLP 0032 M3: DK-3 wire guardrail
added — keep the cacheable-HTTP-read-lane option open beside WS delivery; linked
LLP 0030 for Contract/Exact preview server lifecycle)
**Related:** LLP 0000, LLP 0004, LLP 0005, LLP 0006, LLP 0007, LLP 0008, LLP 0009, LLP 0010, LLP 0011, LLP 0013, LLP 0014, LLP 0017, LLP 0024, LLP 0030, LLP 0031, LLP 0039, LLP 0044, LLP 0053, LLP 0057, LLP 0058, LLP 0059, LLP 0060, LLP 0064

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
each v0 artifact must declare `schemaVersion: "snapback.v0"` and `artifactKind`, and
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

**Must-understand auth-mode compatibility exception (ENG-24593).** The
ignore-unknown rule above is unsafe for a field that changes who supplies
invocation authority: a pre-auth binary would ignore `auth.mode: "sessions"`
and execute the deployment under legacy client-asserted dev authority. Auth
mode therefore has an exact structural compatibility rule:

The admissible artifact/auth tuple set is closed and contains **exactly** these
two pairs:

| Schema and function `schemaVersion` | Candidate auth mode | Result |
|---|---|---|
| `snapback.v0` | `dev` | accept |
| `snapback.v0` | `sessions` | reject |
| `snapback.v1` | `dev` | reject |
| `snapback.v1` | `sessions` | accept |

Every other tuple — including an unknown version or mode — is rejected before
hash comparison or any durable/runtime effect. The two capability arrays below
do not create a Cartesian product of acceptable tuples.

- a dev deployment uses the legacy pair of schema and function manifests at
  `schemaVersion: "snapback.v0"`; absent `auth.mode` means `dev`, and an
  auth-aware receiver also accepts an explicit `dev` spelling;
- every sessions deployment uses `schemaVersion: "snapback.v1"` on **both**
  the schema manifest and the function manifest. The mode is declared by the
  schema manifest, but the function artifact carries the same version so an
  executable bundle cannot cross the authority boundary as a v0 half;
- the generated `contractDataManifest` is the sole derived artifact that moves
  with that pair: it remains `snapback.v0` for v0-dev and uses
  `schemaVersion: "snapback.v1"` for v1-sessions, copying the exact accepted
  pair's `schemaHash`, `bundleHash`, and `inputsHash`. It is adapter metadata,
  not a third independently admissible deployment half, and cannot authorize
  or complete a pair. Capability, runtime-state, diagnostic, and wire artifacts
  retain their existing version spellings;
- the three v1-sessions identity strings occupy raw-value namespaces disjoint
  from v0: `snapback.v1:sessions:schema:sha256:<digest>` for `schemaHash`,
  `snapback.v1:sessions:function:sha256:<digest>` for `bundleHash`, and
  `snapback.v1:sessions:inputs:sha256:<digest>` for the shared `inputsHash`.
  The `snapback.v1:` prefix is reserved for these values; v0 emitters retain
  their existing encodings and must not emit that prefix.
  `<digest>` is the 64-character lowercase SHA-256 result of the existing
  length-framed encoding. Its domain is respectively
  `snapback-codegen/schema-content-hash/snapback.v1/sessions`,
  `snapback-codegen/bundle-content-hash/snapback.v1/sessions`, or
  `snapback-codegen/inputs-hash/snapback.v1/sessions`; the first framed items
  are the artifact kind (`schemaManifest`, `functionManifest`, or
  `schemaFunctionPair`), `snapback.v1`, `sessions`, and `appId`, followed by
  that hash's canonical content or input items. Both manifests carry the same
  pair-level `inputsHash`. The serialized namespace is part of the
  discriminator, not decoration: no v1-sessions identity may equal a v0
  identity even when the app sources and canonical content are otherwise
  identical. This forces a predecessor past its raw hash-equality shortcut and
  into its existing non-v0 rejection;
- an auth-aware receiver accepts only the closed v0-dev and v1-sessions pairs.
  It rejects v0-sessions, **v1-dev**, mixed schema/function versions, absent
  required halves on first sessions deployment, and unknown versions. Adding a
  later version requires revising this closed tuple contract; listing dimensions
  separately in target capabilities is not enough. For a later one-half update,
  the unposted half is the currently loaded, attested artifact and must satisfy
  the same pair rule;
- a pre-auth receiver's existing v0 artifact validator rejects the v1
  discriminator with `SNAPBACK_STALE_SCHEMA_ARTIFACT_VERSION`. The acceptance
  proof runs the actual unmodified predecessor in its provisioning-allowed
  `dev` profile and asserts that exact diagnostic; LLP 0039's
  relocate-and-poison rule is a separate defense against reopening or rolling
  back a database after sessions has activated;
- every artifact-ingress path constructs and preflights the complete candidate
  pair before trusting a hash match or taking an effect. It first resolves the
  explicit operation intent and that branch's authorization, then checks the
  closed `(schemaVersion, candidate auth mode)` tuple, artifact kind, and pair
  consistency (equal
  `schemaVersion`, `appId`, and `inputsHash` across the schema and function
  manifests, with non-empty `appId`, `schemaHash`, `bundleHash`, and
  `inputsHash` required for v1), and target support. Only then may it report
  `matched`, run DDL, persist a desired mode, replace functions, or seed data.
  A matching `schemaHash`, `bundleHash`, or `inputsHash` is attestation
  evidence, never permission to skip this preflight.

For v1 sessions, `/app/ensure` is a closed, explicitly discriminated request
union; missing/unknown `intent` and fields outside the selected variant are
rejected:

```json
{
  "intent": "attest",
  "requestedMode": "sessions",
  "pair": {
    "schema": {
      "artifactKind": "schemaManifest",
      "schemaVersion": "snapback.v1",
      "appId": "<non-empty>",
      "schemaHash": "<non-empty>",
      "inputsHash": "<non-empty>"
    },
    "functions": {
      "artifactKind": "functionManifest",
      "schemaVersion": "snapback.v1",
      "appId": "<same appId>",
      "bundleHash": "<non-empty>",
      "inputsHash": "<same inputsHash>"
    }
  }
}
```

The `attest` variant is the Public, non-mutating branch. Its exact DTO contains
only the pair identity above: full table/function manifests, seed data, desired
mode writes, and any other provisioning material are invalid fields. After
Public route authorization and version/mode/pair/target-support validation, it
may compare the identity to the already-loaded, previously accepted pair. It
returns only a typed `{ intent: "attest", matched: boolean, active: {
schemaVersion, appId, schemaHash, bundleHash, inputsHash } }` identity
projection and cannot stage, provision, seed, or replace runtime state.

The `provision` variant is a closed object whose required fields are
`intent: "provision"` and `requestedMode`; its only optional fields are
`schema` (a full schema manifest), `functions` (a full function manifest), and
`seed`, with at least one effect-bearing field required. A first sessions
deployment requires both manifest fields; a later one-half update may omit one
only when the loaded, attested sibling completes the pair. This branch requires
`AdminWrite` or pre-bind startup authority before any hash comparison or
effect. Any request that would provision or stage sessions, and every
provisioning request while the desired mode is sessions, uses this branch. The
server never infers intent from whether hashes match and never falls back from a
denied `provision` request to Public `attest`. Legacy untagged ensure input
remains only a v0-dev compatibility form; it cannot request, stage, attest, or
operate while desired/active mode is sessions.

During `MODE_PENDING`, ordinary app-data and the Public `{ intent: "attest" }`
branch are refused with `SNAPBACK_AUTH_MODE_PENDING`. The sole schema-apply
recovery exception is the same privileged `{ intent: "provision" }` branch,
authorized by `AdminWrite` or pre-bind startup authority, so an operator can
correct or re-stage the candidate pair. Its branch authorization and complete
tuple/pair/capability preflight still run before hashes or effects. It is not a
fallback for an ordinary request; explicit unstage remains the separate pre-bind
operator action LLP 0039 defines.

The capability manifest registers `supportedArtifactVersions` (an array of
closed artifact-version strings) and `supportedAuthModes` (an array drawn from
`dev | sessions`) as target-declared facts. The auth-aware local target reports
`["snapback.v0", "snapback.v1"]` and `["dev", "sessions"]`. On an older target,
an absent fact means unsupported; a sender never infers sessions support from
the target profile or another capability. Sender-side codegen/deploy gates and
receiver-side preflight both consume the facts; either side alone is
insufficient. The bootstrap handshake reports the app's active and desired
modes separately — target support is not evidence that a
particular app has activated sessions.
These arrays advertise supported dimensions only. They never authorize their
Cartesian product: the receiver and sender still enforce the closed pair set
`{ (snapback.v0, dev), (snapback.v1, sessions) }`.
[LLP 0039](./0039-auth-vertical-slice.rfc.md) owns the staged transition and its
predecessor fresh/provisioned-v0 acceptance matrix.

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

Function ids are **required and stable** (ENG-24905; the LLP 0055 stage
prerequisite — scoped grants and consent are keyed by function id, so a
function without a stable identity cannot be safely named by a grant):

- every function carries a non-empty `id`. A manifest whose function omits it
  (or carries an empty one) fails validation with the typed
  `SNAPBACK_FUNCTION_IDENTITY_INVALID` diagnostic before install; the
  ENG-24572 whole-manifest atomic rejection (see
  [Function Manifest](#function-manifest)) applies, so the prior known-good
  generation keeps serving. The refusal is a load-time diagnostic, not an
  opaque parse error: receivers tolerate the absent field at deserialization
  and refuse it at validation.
- ids are deterministic across regeneration: regenerating unchanged source
  produces byte-identical ids. [LLP 0004](./0004-application-data-api.rfc.md)
  pins the codegen rule and the `{appId}:{exportedName}` spelling; the
  manifest contract only requires presence, non-emptiness, and determinism,
  so hand-built or system manifests may use another deterministic scheme
  (the Rust constructor's `fn:{name}` spelling remains valid).
- **a rename is a different function.** The new name mints a new id and the
  old id is retired — never re-pointed at a different function. Deleting and
  re-adding a function with the same name deterministically reproduces the
  same id; that revival must not silently restore previously granted
  authority. The defense is the grant's durable **basis generation**
  (LLP 0055 §Grants and the scopes ticket), not id novelty — this contract
  deliberately keeps ids deterministic rather than randomized so that
  defense stays implementable.

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

Registered optional additive fields:

- `supportedArtifactVersions`;
- `supportedAuthModes`.

Historical v0 capability manifests remain valid when either field is absent.
For auth compatibility, absent or empty means unsupported; an auth-aware target
MUST emit both fields, and a sender MUST NOT infer either fact from the target
profile or another capability. This is an additive v0 registration, not a
retroactive new required field for every v0 manifest.

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
`CAPABILITY_*`, `BUNDLE_*`, `RUNTIME_*`, `HANDLER_*`, `SNAPBACK_AUTH_*`,
`MUTATION_CONFLICT`, and `STALE_*`. Exact code names can grow during
implementation, but changing an emitted code is a compatibility event.
`HANDLER_*` covers normalized JavaScript handler failures such as ambient
capability denial and arbitrary handler throws, so adapters never receive raw
runtime errors as the integration contract. LLP 0057 owns the item-3
`SNAPBACK_AUTH_*` spellings and secret-safe detail boundaries; later auth items
extend that family rather than inventing an adapter-specific dialect.

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

The server validates a function manifest as one generation before installation:
function names and the required stable ids are present, non-empty, and
globally unambiguous (a missing id is the typed
`SNAPBACK_FUNCTION_IDENTITY_INVALID` refusal registered under
[V0 Function Manifest](#v0-function-manifest)); kind and runtime
agree; host plans satisfy query/mutation bounds; action mutation references,
schema table/field/index dependencies (including the primary table), config
declarations/uses/probes/defaults, and cron targets/jitter arithmetic are valid.
Any error leaves the prior functions, config, cron state, and app generation
serving. Provisioning treats error diagnostics as failure rather than reporting
an invalid artifact as successfully installed.

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
- supported artifact versions (`supportedArtifactVersions`);
- supported auth modes (`supportedAuthModes`);
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

**Single source (LLP 0032 P2, landed 2026-07-02).** The capability manifest is
**server-declared**: the Rust core's declaration
(`CapabilityManifest::local_v0_declared`) generates the committed
`schemas/capability.manifest.local-dev-sqlite-ibex.json`, codegen embeds that
file verbatim into every generated backend (failing closed if it is missing or
for the wrong target), and drift-gate tests (`crates/snapback/tests/capability_v0.rs`) hold
the committed file equal to the declaration and the live `/inspect` report
equal to it modulo exactly two documented instance-live fields — `vmLifecycle`
(the DK-4 posture actually in force) and the `ibex_cli` gap. Codegen asserts
nothing about server capabilities on its own; the earlier hand-maintained JS
literal (which had already drifted — it never learned `vmLifecycle`) is gone.

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

**Dated amendment (2026-08-10 — LLP 0219).** The process-local, per-client
diagnostics channel is now the delivery, formatting, and coalescing surface for
client diagnostics. Its carrier is `snapback.client-diagnostic.v2`: severity is
`error | warning`, with stable code, subsystem, message/details, occurrence
metadata, and optional site. The legacy `snapback.client-diagnostic.v1` carrier
remains frozen and error-only: `onDiagnostic` and
`inspection().diagnostics` are v1 projections through
`projectDiagnosticV1`, and warning events are filtered rather than widened
under the old discriminator. Adapters expose the same v2 diagnostic objects
through `useSnapbackDiagnostics()`, `observeSnapbackDiagnostics()`, and the
headless client's `diagnosticsChannel()`.

The host-ops result envelope in
[LLP 0024](./0024-agent-operating-surface.spec.md) reuses this diagnostic schema
and its code families. CLI, HTTP, and MCP projections must not add another
diagnostic dialect for operation failures.

Auth-boundary refusals use the same adapter-visible dialect. In particular,
`SNAPBACK_AUTH_BODY_AUTH_UNSUPPORTED` is a 400 request error when any legacy
client-authority field is present under the sessions overlay, including an
explicit `null`; a valid bearer never makes that body shape acceptable.
`SNAPBACK_AUTH_POLICY_UNAVAILABLE` is a 503 implementation-order or negotiated-
capability backstop: a route or operation whose effective policy requires an
uninstalled later-item authority, coordinator, descriptor, or retained-read
contract refuses instead of falling through to a weaker credential. LLP 0031
owns the policy matrix; LLP 0058 owns item 4's exact activation and admission
fences.

ENG-24596 adds the following stable item-3 status classes from
[LLP 0057](./0057-auth-provider-protocol.spec.md). These mappings apply when a
diagnostic is the top-level served HTTP error. A core host operation that ran
still returns HTTP 200 with the ordinary `hostOpsResult` envelope and expresses
the operation failure through `ok: false` plus `diagnostics[]`.

| HTTP / locus | Item-3 auth diagnostics |
| --- | --- |
| 400 | `SNAPBACK_AUTH_REQUEST_INVALID`, `SNAPBACK_AUTH_RESCUE_INVALID`, `SNAPBACK_AUTH_RESCUE_SCHEMA_UNSUPPORTED` |
| 401 | `SNAPBACK_AUTH_REQUIRED`, `SNAPBACK_AUTH_SESSION_EXPIRED`, `SNAPBACK_AUTH_CREDENTIAL_SUPERSEDED`, `SNAPBACK_AUTH_CODE_INVALID` |
| 403 | `SNAPBACK_AUTH_CODE_LOCKED`, `SNAPBACK_AUTH_IMPERSONATION_REQUIRED` |
| 404 | `SNAPBACK_AUTH_MODE_DEV`, `SNAPBACK_AUTH_MAILBOX_ENTRY_NOT_FOUND` |
| 409 | `SNAPBACK_AUTH_REFRESH_SUPERSEDED`, `SNAPBACK_AUTH_TABLE_COLLISION`, `SNAPBACK_AUTH_CATALOG_OBJECT_COLLISION` |
| 429 | `SNAPBACK_AUTH_THROTTLED` |
| 503 | `SNAPBACK_AUTH_PROVIDER_UNAVAILABLE`, `SNAPBACK_AUTH_CATALOG_CORRUPT`, `SNAPBACK_AUTH_CATALOG_VERSION_UNSUPPORTED` |
| startup / CLI | the catalog diagnostics above plus `SNAPBACK_AUTH_BACKUP_INVALID`; no HTTP status is implied when no HTTP response exists |

The mapper allow-lists these codes; an unrecognized diagnostic remains a 500.
No status or structured detail may reveal an email address, challenge code,
session token or digest, key identifier/material, or impersonation capability.

ENG-24597 adds LLP 0058's item-4 classes. `SNAPBACK_AUTH_MODE_PENDING`,
`SNAPBACK_AUTH_POLICY_UNAVAILABLE`, `SNAPBACK_AUTH_INVALIDATION_UNAVAILABLE`,
`SNAPBACK_CAPABILITY_UNSUPPORTED`, and
`SNAPBACK_AUTH_MODE_QUIESCENCE_TIMEOUT` are HTTP 503 when they are the
top-level served refusal. `SNAPBACK_AUTH_BODY_AUTH_UNSUPPORTED` remains the 400
presence error registered above; `SNAPBACK_AUTHORITY_INDEPENDENT_INVALID` is
also 400 because the submitted function declaration does not satisfy the
closed authority-independent profile. The reserved
`SNAPBACK_AUTH_INVALIDATION_CLIENT_UNSUPPORTED` negotiation refusal is 503 when
item 6 makes it reachable: upgrading the client capability, rather than
changing request data or authority, is the recovery. The following are pre-bind startup/CLI
diagnostics and imply no HTTP response:
`SNAPBACK_AUTH_MODE_DOWNGRADE`, `SNAPBACK_AUTH_MODE_STATE_CORRUPT`,
`SNAPBACK_AUTH_STARTUP_ARTIFACT_REQUIRED`,
`SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH`, and
`SNAPBACK_AUTH_TRANSPORT_INSECURE`. Adapters may display only LLP 0058's closed
safe details: versions, modes, public identity hashes, capability ids,
transition generation, and blocker names. Artifact source/body/seed, carrier
paths, credentials, identity addresses, provider secrets, and key material are
forbidden.

`SNAPBACK_REQUEST_BODY_TIMEOUT` is the reviewed HTTP 408 class for an admitted
request whose bounded body ingest did not complete before the monotonic ingest
deadline. `SNAPBACK_AUTH_HANDSHAKE_INVALID` is produced by the kit when the
closed bootstrap response, exact offer echo, UUIDv7 identities, or descriptor
version fails validation; it is a client protocol refusal and has no server HTTP
status mapping. `SNAPBACK_AUTH_MODE_DOWNGRADE_COMMITTED` is a pre-bind
informational audit fact carrying only revocation count and transition
generation; it is not an HTTP failure response.

`SNAPBACK_SCHEMA_PARSE_FAILED` is the shared stored-schema-manifest parse
diagnostic. It maps to HTTP 400 only when it is the top-level error of an
already served API request. LLP 0058's relocate-and-poison rollback backstop
reaches it during database open before listener bind, so that use has no HTTP
response or status. Adapters may rely on the stable code and safe summary, not
on parser-library detail text.

### Auth v1 registrations after item 4

ENG-24603 through ENG-24607 register the remaining local auth-program surface
here rather than leaving each adapter to reconstruct it from implementation
details. The committed JSON Schemas are the physical authorities for these
wire artifacts:

- `auth.session.output.schema.json` for the exact bootstrap projection,
  including `authorizationStreamIncarnation`, the closed availability axes,
  and `authorityDescriptor`;
- `connection.open.input.schema.json` and `connection.grant.schema.json` for a
  delegated connection bearer bound to the resolved anonymous or session
  authority;
- `live.envelope.schema.json` and `live.socket-server.schema.json` for durable
  authorization-invalidation obligations and identifier-free terminal auth
  closure;
- `authorization-invalidation.ack.*.schema.json` and
  `authorization-invalidation.manual-retry.*.schema.json` for the two explicit
  obligation-resolution routes; and
- `authorized-lease.schema.json` plus `authorized-lease.query.*.schema.json`
  for a full-revalidation snapshot and its exact offline-retention lease.

All four auth negotiation headers use protocol value `1`:
`x-snapback-auth-client-protocol`,
`x-snapback-auth-invalidation-protocol`,
`x-snapback-authority-descriptor-protocol`, and
`x-snapback-authorized-lease-protocol`. A server advertises each accepted value
and each independently available operation class in `GET /auth/session`.
Possessing one protocol does not imply another; an adapter may not infer
retained/offline admission from finite-request admission. Successful bootstrap
and credential responses are exact closed projections: an unknown root or
nested field is a protocol error, and request or successor credentials must
not appear in the app-visible result.

The adapter/store authority is deliberately two-dimensional. `userId` is the
principal/data scope and controls retained rows; `authorityInstanceId` is the
queue scope and controls whether a queued mutation may execute. Same-user
re-login may preserve rows while suspending the predecessor queue. A valid but
different descriptor produces `SNAPBACK_AUTH_STALE_RESULT` and requires an
explicit discard-or-re-record decision; it is never an automatic retry. The
descriptor is a consistency input, not a credential, and credential validity
is resolved first.

The single client `AuthCoordinator` owns bearer custody and every authority
transition. All requests, callbacks, optimistic reconciliation, retained
writes, and live delivery compare a captured authority before publication.
Only `compareAndClear(expectedAuthority)` may clear, so a predecessor's late
success or failure cannot expose bytes under, or erase, a successor. Client-
local custody, stale-capture, fence, and store diagnostics do not acquire an
HTTP status merely because they share the `SNAPBACK_*` namespace.

The target-owned capability projection adds the exact static `hostedAuth`
support descriptor: external TLS, trustworthy effective-source derivation,
authentication throttle scope, globally fenced invalidation, and browser
credential posture. Four exact positives produce `deploymentCapable`; all five
produce `hostedAuthCapable`. Neither is deployment readiness: hosted admission
also requires LLP 0060's deployment-bound attestation, live-health snapshot,
old-receiver-safe handler protocol, and disabled operator surface. No current
target owns those authorities, so `--auth-deployment hosted` remains a
must-understand refusal even if a synthetic manifest sets all static values
positive. The local target reports its actual process-local bearer posture; a
target with no auth surface reports `unavailable` on the three applicable axes.

The remaining served HTTP mappings are deliberately allow-listed:

| HTTP / locus | Item-5-through-item-8 and hosted auth diagnostics |
| --- | --- |
| 400 | `SNAPBACK_AUTH_CLOCK_DEPENDENT_VISIBILITY`, `SNAPBACK_AUTH_MUTABLE_INPUT_DENIED`, `SNAPBACK_AUTH_INVALIDATION_ACK_BEFORE_COMMIT`, `SNAPBACK_AUTH_INVALIDATION_NAMESPACE_REQUIRED`, `SNAPBACK_AUTH_UNDECLARABLE_RETENTION`, `SNAPBACK_AUTHORIZED_LEASE_CONFIG_INVALID`, `SNAPBACK_AUTHORIZED_LEASE_INVALID`, `SNAPBACK_AUTHORIZED_LEASE_QUERY_NOT_RETAINABLE`, `SNAPBACK_AUTH_STALE_RESULT` |
| 401 | `SNAPBACK_CONNECTION_AUTHORITY_MISMATCH`, `SNAPBACK_AUTH_STREAM_RESET` (finite-route projection; the live form is a terminal frame) |
| 403 | `SNAPBACK_AUTH_PERMISSION_DENIED`, `SNAPBACK_AUTHORIZED_LEASE_AUTHORITY_INVALID` |
| 409 | `SNAPBACK_AUTH_INVALIDATION_EXPECTATION_STALE`, `SNAPBACK_AUTH_INVALIDATION_PENDING`, `SNAPBACK_AUTH_INVALIDATION_RESOLUTION_STALE`, `SNAPBACK_AUTH_RESNAPSHOT_REQUIRED`, `SNAPBACK_AUTH_RETRY_NOT_EXHAUSTED`, `SNAPBACK_AUTH_RETRY_NOT_PENDING`, `SNAPBACK_AUTHORIZED_LEASE_BOUNDARY_MISMATCH`, `SNAPBACK_AUTHORIZED_LEASE_EXPIRED`, `SNAPBACK_AUTHORIZED_LEASE_REQUEST_REUSED`, `SNAPBACK_AUTHORIZED_LEASE_STALE` |
| 429 | `SNAPBACK_CONNECTION_GRANT_LIMIT_EXCEEDED`, `SNAPBACK_AUTH_RETRY_EPISODE_CAPACITY`, `SNAPBACK_AUTH_THROTTLED` |
| 503 | `SNAPBACK_CAPABILITY_UNSUPPORTED`, `SNAPBACK_AUTH_CLOCK_ROLLBACK`, `SNAPBACK_AUTH_INVALIDATION_UNAVAILABLE`, `SNAPBACK_AUTH_INVALIDATION_CLIENT_UNSUPPORTED`, `SNAPBACK_AUTH_INVALIDATION_CAUSE_EXHAUSTED`, `SNAPBACK_AUTH_INVALIDATION_CONNECTION_GENERATION_EXHAUSTED`, `SNAPBACK_AUTH_INVALIDATION_ISSUER_EXHAUSTED`, `SNAPBACK_AUTH_INVALIDATION_ISSUER_UNAVAILABLE`, `SNAPBACK_AUTH_INVALIDATION_REVISION_EXHAUSTED`, `SNAPBACK_AUTH_INVALIDATION_SCOPE_SEQUENCE_EXHAUSTED`, `SNAPBACK_AUTHORIZATION_EPOCH_EXHAUSTED`, `SNAPBACK_AUTHORIZATION_VERSION_CORRUPT`, `SNAPBACK_AUTHORIZED_LEASE_KEY_UNAVAILABLE`, `SNAPBACK_AUTHORIZED_LEASE_STATE_CORRUPT`, `SNAPBACK_AUTHORIZED_LEASE_UNAVAILABLE`, `SNAPBACK_AUTH_PROJECTION_CORRUPT`, `SNAPBACK_AUTH_PROJECTION_UNAVAILABLE`, `SNAPBACK_AUTH_REVOCATION_UNCERTAIN`, `SNAPBACK_AUTH_RETRY_EXHAUSTED`, `SNAPBACK_AUTH_STREAM_INCARNATION_CORRUPT`, `SNAPBACK_AUTH_DEPLOYMENT_UNSUPPORTED`, `SNAPBACK_AUTH_HANDLER_INCOMPATIBLE` (reserved LLP 0060 D6 per-invocation refusal) |
| startup / no bind | `SNAPBACK_AUTH_TRANSPORT_INSECURE`, durable projection/incarnation corruption, `SNAPBACK_AUTH_HANDLER_INCOMPATIBLE` (reserved LLP 0060 D6 binding/preflight refusal), and the LLP 0098 hosted-edge adapter refusals `SNAPBACK_AUTH_HOSTED_TOPOLOGY_INVALID`, `SNAPBACK_AUTH_HOSTED_ADMISSION_UNAUTHENTICATED`, `SNAPBACK_AUTH_HOSTED_ADMISSION_FOREIGN`, `SNAPBACK_AUTH_HOSTED_ADMISSION_STALE_CONFIGURATION`, `SNAPBACK_AUTH_HOSTED_ADMISSION_STALE_SUPPORT`, `SNAPBACK_AUTH_HOSTED_ADMISSION_ROLLED_BACK`, and `SNAPBACK_AUTH_HOSTED_ADMISSION_INVALID` (control-plane/operator state raised before a listener serves); no client-authentication response exists |
| reserved hosted/v2 | `SNAPBACK_AUTH_SOURCE_UNTRUSTED` (LLP 0098 §6 derives it on the hosted path; a 503, because an untrustworthy source leaves nothing to throttle on), `SNAPBACK_AUTH_INVALIDATION_LAGGING`, `SNAPBACK_AUTH_SENDER_PROOF_REQUIRED`, `SNAPBACK_AUTH_SENDER_PROOF_INVALID`, `SNAPBACK_AUTH_SENDER_PROOF_REPLAYED`; the local bearer-v1 target must not emit these as implemented capability |

An item-6/8 corruption code not deliberately assigned a client class remains a
500 or a pre-bind refusal. Adapters must not reinterpret that conservative
default as bad request data. Public details remain identifier- and secret-free
as specified by LLP 0053, LLP 0059, and LLP 0060.

`SNAPBACK_AUTH_HANDLER_INCOMPATIBLE` is reserved for a future hosted target;
the current local target must not emit it as an implemented capability. A
per-invocation coordinator refusal uses the ordinary closed HTTP error envelope
with status 503 and executes no handler. A deployment/startup preflight refusal
is operator/control-plane state before serving and has no HTTP response. Public
details may name only the generic incompatibility class and supported protocol
version; deployment ids, admission epochs, handler and authority-stream
incarnations, invocation ids, binding credentials, and payloads remain private.

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

Client-side diagnostics follow the dated LLP 0219 amendment in
[Diagnostic Schema](#diagnostic-schema): React/Expo project the bound headless
client's channel through `useSnapbackDiagnostics()` and
`observeSnapbackDiagnostics()` rather than defining another diagnostic object
or reporter.

The React adapter may be ergonomic, but it must remain a binding over generated
Snapback function references and runtime state. It should not introduce direct
table writes or a parallel cache model as the default application API. It must also
declare its capability class honestly (Online vs. Parity, above) — a React Native
adapter that does not run handlers locally is not local-first and must not be
documented as equivalent to one — and it should inherit the reference race-handling
behaviors (pre-subscribe delta queueing, error→empty-array, full-resync-on-reconnect)
rather than re-deriving them.

### As-built external-store and React projection (2026-07-20)

The framework-neutral implementation lives at
`@snapback/client/external-store` and advertises the exact compatibility token
`snapback.external-store.v1`. It owns canonical provider/query/authority/args
identity, immutable current snapshots, same-key sibling sharing, independent
subscriber cleanup, late-handle and stale-generation fencing, connection and
error state, optimistic pending state, authoritative confirmation/rejection,
rollback, and replaceable framework-free scopes. An incompatible token refuses
with `SNAPBACK_EXTERNAL_STORE_INCOMPATIBLE` instead of publishing application
data.

`@snapback/react` is a thin `useSyncExternalStore` projection over that shared
object. The Partitime React web arm and the React Expo carrier consume the same
package and the same generated function references; neither introduces a
parallel application cache or a direct-table-write API. A pre-lock Android run
recorded release build and device launch, generated-function initial data,
optimistic pending plus confirmed settlement, authority rotation,
background/foreground events, stale-row retention and authoritative reconnect,
and server-code exclusion. That implementation is **Online** only:
`localHandlerExecutionClaimed` is false. The cumulative claim remains pending
until the final registry inputs rerun against the implementation revision.
`react-expo/ios`,
`exact-native/ios`, and `exact-native/android` remain unproved and must not be
inferred from the Android result. LLP 0064 owns the per-OS native surface and
artifact-integrity contract.

## Call-time generation binding

Generated function references for a complete sessions artifact pair carry an
`expectedGeneration` object containing exactly `schemaVersion`, `appId`,
`schemaHash`, `bundleHash`, and `inputsHash`. The packaged client repeats that
assertion on query, mutation, action, authorized-lease query, and live-subscribe
requests. References prepared from an incomplete artifact set do not invent an
identity.

On a sessions target, function selection and comparison with the active
schema/function pair are one admitted operation. Selection runs first so a
removed or unknown function keeps `SNAPBACK_UNKNOWN_FUNCTION`; otherwise an
unequal asserted pair refuses before handler, acknowledgement, receipt, or
mutation effects with `SNAPBACK_ARTIFACT_IDENTITY_MISMATCH` and the closed
detail `subcause: "generation"`. The details include both
`expectedGeneration` and server-derived `activeGeneration`. Integrity and
binding failures remain their separately registered subcauses; clients must
not infer one from the umbrella code alone.

Successful sessions calls and subscriptions echo the server-derived pair as
`facts.activeGeneration`. The server never copies this fact from the request.
Dev targets tolerate but do not enforce the additive assertion and omit the
sessions fact, preserving LLP 0062's discovery-time-only v0 rule.

A live assertion is pinned to the subscription. Activation retires the
predecessor and sends `resync_required` with reason
`SNAPBACK_ARTIFACT_IDENTITY_MISMATCH`; a fresh subscribe using predecessor
artifacts receives the same HTTP refusal, while a refetched successor reference
may establish a new subscription. Function removal still returns its own
unknown-function refusal on the fresh attempt.

The assertion is optional by design. String function names, older generated
references, browser-kit callers, Contract, and other existing clients that omit
`expectedGeneration` receive no generation comparison and retain their prior
behavior. This compatibility arm is not evidence that their discovered schema
and selected function were one generation.

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
  Realized 2026-07-02 by DK-7 ([LLP 0037](./0037-schema-source-of-truth.decision.md),
  Rust-first): the Rust serde types are the single source of truth, `schemars`-derived
  JSON Schemas for the Snapback-owned artifacts are committed under `schemas/`, and
  `crates/snapback/tests/artifact_schemas_v0.rs` is the drift gate (`dk7_committed_schemas_match_rust_types`;
  regenerate the committed schemas with `cargo run --bin snapback-schemagen`).
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

The auth-mode exception above makes that choice for schema/function deployment
artifacts: only `(snapback.v0, dev)` and `(snapback.v1, sessions)` are compatible.
V0-sessions, **v1-dev**, mixed artifacts, and unknown tuples are hard stops. The
receiver resolves the explicit ensure intent and its branch authorization, then
performs the complete closed-tuple/pair/capability preflight before any
matching-hash shortcut or durable/runtime effect. This rule applies equally to
initial provisioning, one-half updates evaluated against the loaded sibling,
startup provisioning, and attestation-only `/app/ensure`; an attestation response
must not say `matched` unless its identity-only pair is compatible and equals the
loaded pair previously accepted by provisioning preflight. During
`MODE_PENDING`, that Public attestation branch is refused; only the explicitly
privileged provisioning branch may correct or re-stage the candidate pair.

**Enforced (LLP 0032 P3, landed 2026-07-02).** The single-source +
drift-gate demand above is now CI-checked end to end: the Rust types
generate committed JSON Schemas (`schemas/*.schema.json`, per
[LLP 0037](./0037-schema-source-of-truth.decision.md)) with a snapshot
drift gate; every committed generated manifest validates against them and
parses through the runtime structs; a regen-and-diff gate holds committed
artifacts equal to what codegen emits (the `inputsHash` staleness marker is
itself exercised by it); and a strict `tsc` gate compiles every generated
`.d.ts` plus a typed consumer fixture, so invalid emitted TypeScript cannot
land.

**Database-version cursors (DK-2 pin, 2026-07-02).** The commit-version
graduation decision ([LLP 0007](./0007-storage-portability.spec.md)
§Commit-version graduation) constrains this contract's wire surface: the
"current database version" in runtime state, and any resume/reconnect cursor
built from it, is meaningful only **within one app's version stream**. Clients
and adapters treat `(stream identity, version)` as one opaque resume token —
stream identity today is the app database identity already present in runtime
state — and must not compare versions across streams, assume one global
stream across apps, or assume a stream survives intra-app sharding. Resume
below the retention floor is answered with a forced resnapshot
([LLP 0008](./0008-local-first-sync-and-realtime.rfc.md) §Retention).
Protocol extensions (including LLP 0032 P4's reconnect/resume envelopes)
must preserve this shape.

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
- an auth-aware receiver accepts exactly v0-dev and v1-sessions, while rejecting
  v0-sessions, **v1-dev**, mixed/unknown versions, unsupported auth modes, and
  insufficient privilege before hashes, schema, functions, desired mode, or seed
  can change;
- the actual unmodified pinned pre-auth predecessor runs in its
  provisioning-allowed `dev` profile and rejects a v1-sessions schema/function
  pair on both a fresh database and a database already provisioned with the
  identical app content as v0-dev. Each refusal asserts
  `SNAPBACK_STALE_SCHEMA_ARTIFACT_VERSION`, not merely an absence of mutation.
  The latter case asserts all three v1 identity strings differ from their v0
  counterparts and proves the predecessor cannot return `matched` before its
  non-v0 check; relative to each pre-request snapshot, both cases also prove no
  request-attributable byte or logical change. Together they prove the structural
  first-install discriminator independently of LLP 0039's post-activation
  relocate-and-poison defense;
- a Public v1 `attest` request can only compare the exact identity DTO and
  rejects smuggled manifests, seed, or mode-stage material, while the same
  caller cannot use `provision`; `AdminWrite` or pre-bind startup authority can
  provision, and neither branch is selected by hash equality;
- in `MODE_PENDING`, ordinary app-data and Public `attest` are refused, while
  only an explicitly privileged `provision` request may correct or re-stage the
  candidate pair; that recovery request still completes authorization and the
  closed-tuple/pair/capability preflight before hashes or effects.

This validation can use minimal UI. It is testing the contract boundary, not the
polish of either adapter.

## Open Questions

- Generated artifacts remain project-local under each app's generated output;
  the shared physical client paths are now `@snapback/client`,
  `@snapback/client/external-store`, and the separate framework package
  `@snapback/react`. Additional framework projections remain an open packaging
  question rather than reopening those shipped names.
- Which fields above need to move from v0 manifests into separately versioned
  package schemas before public release?
- How does a Contract/Exact preview process own or attach to the local Snapback
  server lifecycle? [LLP 0030](./0030-managed-snapback-vite-dev.rfc.md) now owns
  the proposed Vite-managed dev answer; revise this Spec once that API is proven.
- Does Design Mode persist a high-level intent log in addition to source edits?

## Dated registration: agent auth and roles (2026-07-16)

The shared wire registry includes the server-derived service-principal
attribution DTO `{actorUserId, effectiveUserId, grantId, dryRun}`; required
stable function ids and `authorityCreating`; unique-index and membership
declarations (`v.principal`, vocabulary, provenance, stable declaration id);
and the invariant public role-denial payload `{kind: "role"}` with richer data
confined to gated doctor output. CLI and MCP may copy the attribution block but
cannot synthesize one with authority.

Registered diagnostics include `GRANT_SCOPE_DENIED`, `GRANT_INVALID`,
`GRANT_PENDING`, `GRANT_CAP`, `AGENT_CREDENTIAL_INVALID`,
`CREDENTIAL_CLASS_MISMATCH`, `AUTHORITY_CREATING_UNCONSENTED`, and
`MEMBERSHIP_RAW_WRITE_DENIED`, plus the registration, invitation, pairing,
membership vocabulary, uniqueness, immutability, nullability, transition, and
activation refusal families. Existing status, redaction, and
diagnostic-envelope rules apply. The manifest registry also admits the
membership-required unique-index capability.

## Dated reinforcement: additive transport lanes (2026-07-23, LLP 0079 SC-3)

The DK-3 wire guardrail above — future read-path delivery options are added
*beside* the WebSocket path, never as a breaking wire change — gains external
evidence from [LLP 0078](./0078-serverpod-lessons.research.md) F2a/F2e: a
competitor's exposed-lifecycle realtime surface had to be deprecated
wholesale, and its wire/artifact breaks taxed every downstream user. The
guardrail is load-bearing and must not be relaxed under delivery pressure;
LLP 0008's 2026-07-23 dated constraints section records the companion
app-facing rule (no connection-lifecycle exposure).

## Dated registration: asset subsystem contract (2026-07-31)

Recorded as part of [LLP 0044](./0044-asset-storage-pipeline.rfc.md)'s
gating companion pass (directed by Charlie, 2026-07-31). This registers
the asset subsystem's contract surface into the registries this Spec
defines; the entries are frozen spellings that land in code with LLP
0044's first implementation slice — until then the manifest keeps
truthfully reporting the existing gap.

**Diagnostic family.** `SNAPBACK_ASSET_*` joins the stable code families
beside `SNAPBACK_AUTH_*`; LLP 0044 owns the spellings, and later asset
work extends the family rather than inventing an adapter-specific
dialect. The initial closed set distinguishes at least: stale/unsupported
upload intent; location-policy refusal; auth, read-access, or attachment
denial; unverified reference commit refusal
(`SNAPBACK_ASSET_REF_UNVERIFIED`); media-type, size, count-ceiling, and
quota refusal; offset/part conflict, cancellation, expiry, and
superseded-attempt refusal; transport-integrity and canonical-digest
failure; restricted-staging/finalization failure; processing and
resource-bound refusal; unsupported delivery profile or range behavior;
and referenced-delete/GC refusal. Changing an emitted code is a
compatibility event. HTTP classes follow the server's exhaustive
allow-list rule: a new code remains a truthful 500 until its producer
deliberately chooses a client class.

**Capability manifest.** The v0 boolean `assetUpload` and the `assets`
capability-gap entry are superseded, at first implementation, by granular
rows in the closed `TargetCapabilityId` registry:
`asset_lifecycle_v1` (the LLP 0044 target composite, claimed together
with a companion `assetLifecycleStores` fact listing each qualified byte
store — the store parameter is part of the claim),
`asset_image_pipeline_v1` and `asset_image_finalization_v1`, and the
later capabilities `asset_reference_gc_v1`, `asset_custom_processing_v1`,
and `asset_video_finalization_v1`. Delivery-profile support
(`assetDeliveryProfiles` over `public-immutable` / `private-signed` /
`private-strict`), integrity-grade reporting (end-to-end verified versus
received-bytes canonical), and the size/quota/TTL/attempt/count-ceiling
limits vector are manifest facts carrying `Enforced`/`Advisory`/`Missing`
grades. LLP 0044's v1 nonclaims — asset backup/export, video
finalization, custom read authorizers, deferred-length transfer — are
reported `Missing`, never omitted, in the manifest's
surface-missing-instead-of-fall-back idiom.

**Wire registry.** The upload-intent reference and the attempt, transfer,
lifecycle, and receipt DTOs are Rust-owned per LLP 0037's same-day
alignment and versioned like every other artifact here. Unknown protocol
versions, capabilities, intent members, state variants, and delivery
profiles fail closed under this Spec's existing compatibility rules.

## Dated registration: app-CLI result core and diagnostic family (2026-08-01)

Recorded with LLP 0024's shared app-data result core amendment (LLP 0062
§2; the recommissioned app-CLI program). `SNAPBACK_APP_CLI_*` joins the
stable code families beside `SNAPBACK_AUTH_*` and `SNAPBACK_ASSET_*`;
LLP 0062 owns the spellings and the frozen exit taxonomy those codes
classify into, and changing an emitted code is a compatibility event
here. The Rust-owned `AppDataResultCoreV1`
(`schemas/app-data.result-core.schema.json`) registers as a shared
artifact shape under the ordinary drift gates; the engine's
`appCliCallResult` wrapper is engine-owned presentation and deliberately
not a wire artifact of this contract. Diagnostic forward skew follows
LLP 0024's frozen fallback rules: unknown codes are preserved and marked
`unrecognized`, never rewritten and never a compatibility gate.

## Dated registration: provision envelope members and app-api artifacts (2026-08-01)

Recorded as the LLP 0012 half of LLP 0062 ticket 02 (the server-composed
API envelope, per the same-day author ruling in 0062 §5). The closed
`provision` variant above gains one further optional field: `apiEnvelope`
— the Rust-owned `ApiEnvelopeMembersV1` carrier
(`schemas/api.envelope-members.schema.json`) holding the codegen-owned
members (the operations map, the `appBindings` declaration, and their
member digests). It is member material, never a whole envelope: the
server composes the canonical `ApiEnvelopeV1`
(`schemas/api.envelope.schema.json`) from its own projection at
activation and self-verifies the composition before any durable effect.
Absent members activate an explicitly envelope-less generation; the
provision outcome reports `apiEnvelope: "composed" | "absent"`. The
closed-DTO rule is unchanged — every other field remains invalid.

Two served artifacts register with it: the discovery document
`AppApiDiscoveryV1` (`GET /app-api/current`, no-store, sessions targets
only) and the content-addressed envelope
(`GET /app-api/envelope/{sha256}`, immutable, identity content coding,
`Content-Digest` over the transmitted body). `SNAPBACK_APP_API_*` joins
the stable code families; LLP 0062 owns the spellings. Engine-side
ingestion re-verifies every served envelope client-side (canonicity,
member digests, content address, projection correspondence) — the
engine trusts its own verification, never the transport — and unknown
formatVersions fail closed under this Spec's compatibility rules.

## Status

Draft. Valet's integration record ([LLP 0006](./0006-valet-retrospective.research.md))
is folded in — the packaging/typecheck-honesty bar, the Online-vs-Parity capability
class, the current-value+subscription seam, the reference adapter's race handling,
and the single-source-of-truth + drift-gate versioning all come from what Valet
shipped or got wrong. The v0 artifact schema pin is accepted for the first local
implementation. The first framework-neutral store and React adapter are now
implemented and registered above; the broader Spec remains Draft while iOS,
Exact Native Parity, generated-artifact compatibility across native build
systems, and the remaining validation matrix are open. The retired Valet LLP 0088 ("Snapback Contract
Integration") holds reviewed adapter design — package API, headless boot
(`openSnapbackContractRuntime`), scoped install, generated runtime callables — to
mine into this Spec and [LLP 0021](./0021-contract-exact-integration-hardening.plan.md)
as the adapter is built; Exact 0265 still references 0088 and should repoint to the
Snapback corpus.

The ENG-24593 auth-mode compatibility exception is registered normatively even
while LLP 0039 remains Draft/FROZEN. The post-review bounded corrections above
received blind focused READY verdicts from both GPT and Claude on the exact pair
recorded in LLP 0039's Status. Implementations may not claim sessions support
without the closed-tuple paired-artifact preflight, the exact predecessor
diagnostic proof, and the `MODE_PENDING` recovery gate. This broader Spec remains
Draft; ENG-24593 authorized no status transition.

ENG-24596 likewise makes no status transition. It implements the LLP 0057
provider core and registers its adapter-visible diagnostics, but provider
activation still depends on the item-4 staged mode/shared invocation gate and
the item-5 connection/revocation coordinator.

ENG-24603 through ENG-24607 likewise make no status transition for this broad
Spec. They complete the local auth v1 registrations above, including the
independently negotiated item-6/8 surfaces and honest hosted-readiness refusal.

## Changelog

- **2026-08-01 (call-time generation binding).** Registered the complete
  generated `expectedGeneration` assertion on every packaged call family, the
  atomic sessions comparison and server-derived response fact, the typed
  generation subcause, pinned live activation refusal/resubscribe behavior,
  unknown-function precedence, v0-dev non-enforcement, and the explicit
  absent-assertion compatibility arm. Status remains Draft.

- **2026-07-31 (LLP 0044 companion registration).** Added §Dated
  registration: asset subsystem contract — the `SNAPBACK_ASSET_*` family
  with its initial closed set, the granular asset capability rows that
  supersede the `assetUpload` boolean at first implementation
  (store-parameterized lifecycle claim, image pipeline/finalization,
  later-capability ids), delivery-profile/integrity-grade/limit facts
  with Missing-not-omitted v1 nonclaims, and the Rust-owned asset wire
  DTOs under the existing compatibility rules. Frozen spellings only; no
  code claim until LLP 0044's first slice lands.
- **2026-07-14 (ENG-24905 stable function ids).** Registered the stable,
  non-optional function id requirement (the LLP 0055 stage prerequisite):
  every function carries a non-empty `id`; a manifest that omits one fails
  load with the typed `SNAPBACK_FUNCTION_IDENTITY_INVALID` refusal under the
  ENG-24572 whole-manifest atomic rejection; ids are deterministic across
  regeneration of unchanged source (codegen rule pinned in LLP 0004); and a
  rename retires the old id — it is never re-pointed at a different function.
  Same-name re-adds deterministically reproduce the same id by design; the
  ABA-revival defense is the grant-side basis generation (LLP 0055), which
  this registration keeps implementable. No status transition.

- **2026-07-13 (ENG-24603 through ENG-24607 auth-program reconciliation).**
  Registered the exact remaining auth wire artifacts, four independent
  protocol headers, two-axis client authority, single-coordinator publication
  barrier, hosted capability descriptor, and deliberate HTTP/client/startup
  diagnostic loci. This closes the shared-registry debt without changing this
  Spec's Draft status.

- **2026-07-13 (ENG-24593 post-review bounded corrections; focused exact
  confirmation complete).** Closed artifact/auth compatibility to exactly
  `(snapback.v0, dev)` and `(snapback.v1, sessions)`, added v1-dev to every
  negative and acceptance matrix, and made the separate capability arrays
  explicitly non-Cartesian. Pinned the actual unmodified predecessor to its
  provisioning-allowed `dev` profile and required the exact
  `SNAPBACK_STALE_SCHEMA_ARTIFACT_VERSION` refusal in addition to the existing
  no-mutation proof. Made privileged `{ intent: "provision" }` the sole
  schema-apply correction/re-stage branch during `MODE_PENDING`; ordinary
  attestation and app-data remain refused. The exact operative pair received
  independent READY verdicts from GPT and Claude with no blocking findings.
  Status remains Draft; the gate authorized no acceptance transition.

## Amendment (2026-08-03 — LLP 0162, effective with its acceptance)

Accepted LLP 0162 (contracts in LLP 0163) adds client-conformance
obligations for the operation-identity widening:

- A conforming client mints an `operationId` before the first attempt of
  every ordinary mutation on a covered lane and reuses it across transport
  retries; once a target advertises envelope coverage for a lane, an
  identity-less mutation on that lane refuses stably, with a versioned
  negotiation path for legacy clients until the cutover.
- Clients persist server-preallocated identity ranges atomically before
  use, refresh them at reconnect, and treat exhaustion-while-offline as the
  disclosed uncovered-queueing degradation.
- `identity-horizon-passed` is handled as outcome-unknown — never recorded
  as a terminal `failed` — and `result-expired` as outcome-known with the
  payload gone.

## Amendment (2026-08-03 — LLP 0109 acceptance reconciliation)

Accepted LLP 0109 (author acceptance 2026-08-03, decision sitting #2
extension, `issues/20260803-author-decision-sitting-2.md`) adds versioned
seed installation as a **separate closed family**, not new members of this
Spec's `/app/ensure` intent union:

- The closed `attest`/`provision`/legacy-untagged union above is
  byte-unchanged. Legacy untagged ensure and explicit `provision` retain
  their settled seed-if-empty behavior (LLP 0034) and never write versioned
  seed identity. The first landing adds no `install` intent to `/app/ensure`
  (LLP 0109 §15.3 supersedes its §3.1 sketch): the carriers are the
  Rust-owned closed `InstallSeedRequestV1` / `SeedPreviewRequestV1` /
  `ResetSeedRequestV1` bodies with closed receipt/observation results on the
  reserved
  `/_snapback/api/app/seed/{ensure-v1,preview-v1,reset-install-v1,clear-v1}`
  routes and the `app.seed.{ensure,preview,reset-install,clear}.v1` host
  operations (registered by LLP 0031's and LLP 0024's dated amendments; all
  four require `AdminWrite + NonProd`, preview included).
- Capability preflight uses the existing `supportedCapabilities` member with
  the experimental ids `versioned_seed_install_v1` and
  `versioned_seed_reset_v1`. A client holding a versioned artifact against a
  target lacking the ids fails locally with
  `SNAPBACK_CLIENT_SEED_PROTOCOL_UNSUPPORTED` (never an HTTP response) and
  never downgrades to legacy seed, untagged ensure, or the legacy reset
  carriers.
- Status-mapper registration under the existing allow-list rule, as
  implemented: the seed conflict family is HTTP 409 —
  `SNAPBACK_SEED_VERSION_REUSED`, `SNAPBACK_SEED_NONEMPTY_UNTRACKED`,
  `SNAPBACK_SEED_PARTIAL_UNTRACKED`, `SNAPBACK_SEED_MIGRATION_REQUIRED`,
  `SNAPBACK_SEED_IDENTITY_CORRUPT`, `SNAPBACK_SEED_IDENTITY_CONFLICT`,
  `SNAPBACK_SEED_CROSS_MODE_UNSUPPORTED`,
  `SNAPBACK_SEED_MEMBERSHIP_BOOTSTRAP_UNSUPPORTED` (retired from the
  sessions membership lane by LLP 0109 §18 but still allow-listed),
  `SNAPBACK_SEED_OPERATION_ID_REUSED`, `SNAPBACK_SEED_OPERATION_HISTORICAL`,
  `SNAPBACK_SEED_EFFECT_LIMIT_EXCEEDED`, and
  `SNAPBACK_SEED_REPLAY_REQUIRES_PREFLIGHT`; authored/carrier declaration
  failures are 400 (`SNAPBACK_SEED_DECLARATION_INVALID`, legacy
  `SNAPBACK_SEED_INVALID`); the pre-existing `SNAPBACK_AUTH_MODE_PENDING`
  503 wins before the seed routes; an unregistered seed code remains a
  truthful 500.
