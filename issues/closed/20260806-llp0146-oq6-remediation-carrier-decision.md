# LLP 0146 OQ6: remediation carrier and registry decision

**Status:** Open — author ruling required
**Opened:** 2026-08-06
**Owner:** LLP 0094/0095 wire-contract family
**Related:** LLP 0146 D7/OQ6, LLP 0184 §Design/1 and §Design/4, LLP
0144 Axis C/I, LLP 0094 §0B/§0C, LLP 0095 §1.4/§2

## Decision requested

Choose the carrier for contextual typed remediations and rule whether the
remediation-kind registry is keyed by refusal code. The three carrier options
left open by LLP 0146 OQ6 are:

1. a first-class refusal-envelope member;
2. a member inside the existing diagnostic `details` object; or
3. a separate lookup.

This ticket recommends option 2 and a global kind registry whose entries are
offered contextually by each refusal. This is a recommendation for the author,
not a ruling. No runtime, HTTP, CLI, MCP, diagnostic, or ControlCatalog carrier
has been added while this question remains open.

## Substrate already landed

- `src/authoring_suggestion.rs` enriches the existing diagnostic `details`
  object for unknown operations, unknown functions/fields, and invalid
  argument shapes. Candidates come only from the caller-visible served
  host-operation/function/schema generation. The process-local repeated-miss
  summary is bounded and retains only hashes of rejected identifiers.
- `schemas/remediation-kinds.v0.schema.json` and
  `schemas/remediation-kinds.v0.registry.json` are data-only drafts marked
  `draft-pending-oq6`. Their tests enforce the independent D7 axes and require
  artifact-hash preconditions for every machine-applicable kind.
- There is no suggestion-consuming repair path today. Consequently no path can
  apply a stale suggestion; the draft schema makes the artifact-hash
  precondition mandatory so the eventual consumer cannot omit that check.
- LLP 0184's ControlCatalog `remediation` field remains `null`/absent.

## Constraints found in the real contracts and code

### Compatibility and versioning

- LLP 0094 §0C.2 classifies `ErrorResponse` as closed. The Rust type in
  `src/server.rs` uses `deny_unknown_fields` and admits only `diagnostic` plus
  its existing optional receipt/attribution fields. A first-class addition is
  therefore an envelope change and needs LLP 0094's compatibility treatment,
  generated-schema updates, and evidence that deployed clients tolerate it or
  a capability/new-version gate under §0B.
- `HostOpsResult` in `src/host_ops.rs` is another fixed envelope family, while
  query, mutation, action, socket, and hosted-kit errors do not all share one
  outer type. A first-class field would have to be defined across all of these
  families; adding it to only one would violate CLI/HTTP/MCP parity.
- `Diagnostic.details` is already a `serde_json::Value` and therefore an open,
  code-specific map. LLP 0144 Axis C already uses this sanctioned evolution
  seam for `appCode`, `appDetails`, and `appDetailsDropped` without changing
  the closed `ErrorResponse` envelope. A nested remediation carrier still
  needs its own explicit schema version; openness is not permission for an
  unversioned or unbounded contract.
- LLP 0095 makes the conformance fixture corpus, not prose, authoritative for
  client behavior: unknown fields on known server-to-client kinds are ignored,
  while new known semantics require explicit fixtures and lifecycle actions.
  Any selected carrier needs positive, unknown-kind, unknown-field, stale-hash,
  and cross-projection fixtures. If the carrier changes corpus structure, its
  fixture format version must advance rather than drift additively.

### Disclosure and authority

- LLP 0144 I7/Axis I treats diagnostic details as caller-visible disclosure.
  Authorization gates must run before candidate/remediation construction, and
  the payload may contain only facts the admitted caller may see. The landed
  suggestion substrate follows that rule: no rejected application value,
  secret, or pre-gate existence oracle is returned; candidates come from the
  served generation visible at that gate.
- Context matters. `requestGrant` needs the grantable scope for this caller;
  `useDifferentPrincipal` needs an actually available principal; identifier
  repair needs the exact served artifact hash. A refusal code alone cannot
  safely provide those preconditions.
- Principal-changing and authority-widening entries require approval. A
  projection must not infer automation safety from `requiresApproval: false`;
  only the registry's positive `machineApplicable` axis grants it.

### Projection parity

- CLI and HTTP already preserve the underlying `Diagnostic`; generated
  app-data MCP tools and `snapback_run_function` preserve the host-operation
  diagnostic inside their existing `structuredContent`. A details member
  therefore traverses all three projections without a second translation or a
  new outer MCP result member.
- A separate lookup would require a discoverable and authorization-equivalent
  route/resource/tool on every projection, including a version/caching rule and
  a way to bind the answer to the exact refused request. Code-only lookup is
  insufficient for contextual preconditions and creates an avoidable
  time-of-check/time-of-use window.

## Options

### A. First-class envelope member

**Shape:** add a remediation set beside `diagnostic`/`diagnostics` in every
refusal-bearing envelope.

**Advantages:** strongest first-class discoverability; a closed schema can
require the member uniformly; clients do not inspect code-specific details.

**Costs and risks:** largest compatibility blast radius. `ErrorResponse`,
`HostOpsResult`, mutation receipts, query/action outputs, hosted-kit failures,
socket errors, generated schemas, clients, and fixture routing all need one
coordinated versioned migration. Optional-in-v1 is not automatically safe for
closed or schema-validating consumers. Projection parity becomes a release
train rather than an inherent property.

### B. Versioned diagnostic-details member

**Shape proposed for ruling:** a namespaced object such as
`diagnostic.details.remediationSet` containing
`schemaVersion: "snapback.remediation-set.v1"`,
`registryVersion: "snapback.remediation-kinds.v1"`, the exact contextual
`artifactHash` where applicable, and bounded `items`. The final name is part of
the author's ruling; this ticket does not install it.

**Advantages:** outer wire envelopes remain unchanged; existing CLI/HTTP/MCP
wrappers already preserve the same diagnostic; LLP 0144 supplies precedent;
the nested version and bounds can evolve independently; disclosure remains at
the diagnostic construction point where authorization context exists.

**Costs and risks:** code-specific details are less statically discoverable,
and current `Diagnostic.details` has no universal per-code schema. The ruling
must therefore require the nested schema/version and fixtures rather than
relying on map openness. Consumers must use a shared decoder instead of
ad-hoc optional chaining.

### C. Separate lookup

**Shape:** a route/resource/tool that resolves remediation metadata after a
refusal, potentially keyed by refusal code plus generation and authority
context.

**Advantages:** no refusal-envelope change; registry and lookup can be cached
and versioned independently; useful for large static explanatory material.

**Costs and risks:** an extra round trip on the recovery path; no honest answer
from refusal code alone; duplication across CLI/HTTP/MCP; more authorization
and disclosure gates; offline and process-restart behavior to define; and a
TOCTOU hazard between refused generation, lookup generation, and apply. Adding
enough request identity to repair those problems largely recreates a contextual
carrier out of band.

## Recommendation

Rule **B**, the versioned diagnostic-details member. Keep the kind registry
global and versioned, **not keyed solely by refusal code**. A refusal may use a
reviewed code-to-template table as an implementation aid, but it must construct
the offered entries contextually and bind every machine-applicable item to the
exact artifact hash observed at refusal time.

This recommendation has the narrowest compatible path through LLP 0094's
closed outer envelopes, inherits projection parity from the shared diagnostic,
and is the only option that keeps artifact, scope, and principal preconditions
at the authorization-aware construction site without a second lookup race.

## Exact follow-on implementation after the ruling

1. Record the ruling in LLP 0146 OQ6 and amend LLP 0094/0095 with the exact
   carrier name, compatibility/version rule, bounds, unknown-member behavior,
   and fixture obligations.
2. Promote the draft registry/schema to the ruled v1 identity. Generate or
   share typed Rust/TypeScript decoders; do not duplicate a remediation-kind
   enum in ControlCatalog.
3. Define the bounded contextual carrier schema, including registry version,
   independent axes, precondition union, and artifact hash. Add construction
   helpers at the shared `Diagnostic` boundary.
4. Add contextual offers for the landed operation/function/field/argument
   suggestions and for each other explicitly reviewed refusal family. Preserve
   authorization-before-disclosure ordering and value/secret negatives.
5. Add a suggestion-consuming repair operation. Under the same generation
   fence used to select the replacement, compare the supplied artifact hash
   with the currently served hash; on mismatch return a named stale-artifact
   refusal and perform no write, alias, regeneration, or invocation.
6. Project the unchanged diagnostic through direct HTTP, host operations/CLI,
   generated app-data MCP tools, and the hosted arm. Add byte-for-byte parity
   tests plus positive, unknown-field, disclosure-negative, approval, and
   stale-hash fixtures required by LLP 0095.
7. Regenerate affected error/host-operation schemas and clients. If the author
   selects option A instead, perform the full LLP 0094 wire-version migration
   rather than treating the member as an additive convenience.
8. Only after the carrier and shared decoder land, populate LLP 0184's reserved
   ControlCatalog `remediation` projection and update the agent-controls Guide.
9. Update `guide/operating/diagnostics.md` from suggestion-only guidance to the
   ruled remediation/apply workflow, including approval and stale-generation
   examples.

## Author ruling — 2026-08-10

**Option B ruled.** The carrier is the versioned diagnostic-details member:
`diagnostic.details.remediationSet`, with
`schemaVersion: "snapback.remediation-set.v1"`,
`registryVersion: "snapback.remediation-kinds.v1"`, the exact contextual
`artifactHash` where applicable, and bounded `items` — the shape proposed
above is adopted, including the name. The registry is ruled **global and
versioned, not keyed solely by refusal code**: a reviewed code-to-template
table is permitted as an implementation aid, but offered entries are
constructed contextually at the authorization-aware refusal site, and every
machine-applicable item binds to the exact artifact hash observed at refusal
time. Outer wire envelopes remain unchanged; the nested schema/version and
the LLP 0095 fixture obligations are mandatory, not optional. The nine-step
follow-on above is unblocked and commissioned.

## Author ruling checklist

- [x] Carrier option **B** selected — `diagnostic.details.remediationSet`
      (ruled 2026-08-10).
- [x] Registry ownership ruled: global versioned kinds plus contextual
      offers (ruled 2026-08-10).
- [x] Compatibility and versioning ruled: outer envelopes unchanged; nested
      `schemaVersion`/`registryVersion` mandatory (ruled 2026-08-10).
- [x] Disclosure ruled: constructed at the authorization-aware diagnostic
      site; identical across CLI, HTTP, MCP, and hosted via the shared
      diagnostic (ruled 2026-08-10).
- [x] Stale-artifact refusal code/consumer ownership assigned to follow-on
      step 5's implementation, named at review (ruled 2026-08-10).
- [x] Fixture corpus and generated-client migration assigned to LLP 0095
      (ruled 2026-08-10).

## Implementation boundary note (2026-08-08)

The catalog-refusal repair intentionally reused LLP 0024's existing
`hostOpsResult.next[]` for catalog-derived Guide and CLI acquisition paths. It
did **not** introduce `details.remediations`, populate ControlCatalog's reserved
`remediation` projection, or otherwise select among this ticket's A/B/C
options. Those contextual machine-applicable remediation questions and the
author checklist above remain open.

## Ruling (2026-08-10)

Author ruled **option B with the global registry**, as recommended. Carrier:
`diagnostic.details.remediationSet` (nested `snapback.remediation-set.v1`,
registry `snapback.remediation-kinds.v1`, contextual artifactHash, bounded
items). Checklist resolution: registry is global kinds + contextual offers
(code-to-template tables are implementation aids only); compatibility rule =
closed outer envelopes unchanged, nested member independently versioned,
unknown members ignored, shared decoder required; disclosure = constructed
post-authorization at the diagnostic site, identical across CLI/HTTP/MCP/
hosted; stale-artifact refusal owned by the repair-apply consumer; fixture
corpus assigned to LLP 0095. Recorded in LLP 0146 OQ6, LLP 0094 (dated wire
amendment), and LLP 0095 (fixture obligations). Implementation follows the
ticket's nine-step list.

## Resolution — 2026-08-10 — implemented under the option-B ruling

All nine follow-on steps landed in the consolidated remediation-carrier
landing: LLP 0094/0095 amendments; the v1 registry/schema promotion
(`schemas/remediation-kinds.v1.*`); the `diagnostic.details.remediationSet`
carrier with construction helpers at the shared Diagnostic boundary
(`src/remediation.rs`); contextual offers for the suggestion families and
the scoped-token/auth refusals; the `remediation.apply` host operation with
`SNAPBACK_REMEDIATION_ARTIFACT_STALE` fencing; cross-projection parity and
the LLP 0095 fixture corpus (`schemas/remediation.wire-fixtures.v1.json`,
`tests/remediation_registry_v1.rs`, client decoder suite); regenerated
error/host-op schemas and clients; the ControlCatalog `remediation`
projection (LLP 0184 amendment); and the guide diagnostics/agent-controls
workflow update. Orchestrator hardening during landing: the requestGrant
action serializes `grantableScope` per the ruled schemas, and the carrier
module was made a true contract leaf (ServedSurfacesV1 dependency
inversion) with both new modules assigned in the ownership manifest.
