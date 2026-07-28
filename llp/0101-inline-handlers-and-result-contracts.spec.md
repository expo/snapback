# LLP 0101: Inline handlers and result contracts

**Type:** Spec
**Status:** Review
**Systems:** Authoring, Code generation, Runtime, Data API, Client integration, Contract, Security, Artifacts, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-27
**Revised:** 2026-07-27 (final author reconciliation after the three-round
super-refine limit: narrows inline v1 to statically self-contained expressions,
removes the proposed per-request compatibility protocol from this landing,
retains existing replay and 64 KiB settlement limits, and closes effective
schema/result hashing and consumer custody). 2026-07-27 (super-refine round-1 Codex reconciliation: closes
the handler-only transform graph, warm-VM and source custody, expected-operation
wire identity, row-only query compatibility, structural document contracts,
post-JSON validation, legacy rows/actions, retained-contract replay, Contract
GAP witness, action diagnostics, and redacted path rules). 2026-07-27 (entered
the author-invoked super-refine loop; initial focused specification for the
backend-bakeoff authoring and result-contract program)
**Related:** LLP 0004, LLP 0009, LLP 0010, LLP 0012, LLP 0031, LLP 0037, LLP 0043, LLP 0051, LLP 0055, LLP 0064, LLP 0065, LLP 0074, LLP 0093, LLP 0094, LLP 0095

## Summary

Snapback's JavaScript operation declaration and executable handler should be
colocated in one exported builder call. The build still produces a closed,
content-addressed module graph; it never obtains executable authority from
`Function.prototype.toString()`, runtime capture inference, or a public
manifest. The existing `source`/`exportName` form remains a compatibility lane.

Every operation may also declare one closed result contract. That contract
flows through the Rust-owned function manifest, validates handler egress before
publication or commit, binds retained mutation output identity, and generates
the same precise client reference type for query, live query, mutation, and
action. Omission remains an explicit degraded `unknown` contract rather than an
inference from opaque JavaScript.

This Spec controls two coupled seams because they share one build-time function
authority: the handler graph supplies the bytes that execute, and the result
contract supplies the values those bytes may release.

## Goals and non-goals

V1 must:

- remove the duplicate declaration/registry/source navigation of ordinary JS
  operations;
- keep static dependency bundling, capability ceilings, replay identity, and
  warm-VM isolation explicit;
- distinguish stored documents, computed record arrays, and direct values;
- validate fresh and replayed egress before any invalid value becomes live,
  retained, settled, or client-visible; and
- infer arguments and results from generated references without caller casts.

V1 does not:

- serialize a closure with `handler.toString()`;
- infer reads, writes, auth, effects, args, or results from handler behavior;
- admit dynamic import, target ambient modules, arbitrary Node built-ins, or
  runtime dependency installation;
- make browser or public inspection artifacts executable;
- promise client-side execution of JS handlers; or
- silently widen Exact/Contract value vocabularies that their owning schemas
  cannot represent.

## Source authoring

The inline form is available for JS query, live query, mutation, and action:

```ts
export const listTodos = defineJsLiveQuery({
  args: {},
  result: results.documents("todos"),
  reads: ["todos"],
  handler: async (ctx) => {
    return ctx.db.query("todos").collect()
  },
})

export const createTodo = defineJsMutation({
  args: { title: v.string() },
  result: results.value(v.id("todos")),
  reads: [],
  writes: ["todos"],
  handler: async (ctx, args) => {
    return ctx.db.insert("todos", {
      title: args.title,
      completed: false,
    })
  },
})
```

The exported binding name remains the stable operation name and therefore the
LLP 0004 function id input. An inline declaration contains `handler` and
contains neither `source` nor `exportName`. The legacy form contains both
`source` and `exportName` and no `handler`. Missing or mixed discriminants fail
at the authored source span with
`SNAPBACK_FUNCTION_HANDLER_FORM_INVALID`.

The handler value must be a direct function or async-arrow expression in the
exported builder object's `handler` property. A variable containing a function,
an accessor, spread property, computed property, conditional expression, or
post-construction mutation is rejected. This syntactic constraint gives
codegen one unambiguous source slice and prevents isolated evaluation from
becoming an authority-discovery mechanism.

## Bounded static bundling

Inline handlers use a bounded, handler-only module transform, not a
closure-free literal model and not a runtime import of the definition module.
They may reference lexical constants, local helper functions, and admitted
static ECMAScript imports. This is a reviewed extension of LLP 0010's shipped
single-file handler profile; the legacy profile does not silently gain imports.

Codegen parses the original module before isolated definition evaluation:

1. locate each directly exported Snapback builder and its direct handler
   expression;
2. retain the exact source span and exported binding;
3. replace only that handler expression in the definition-evaluation graph
   with an unforgeable internal marker that is strict JSON;
4. build a synthetic runtime entry from the parsed source graph that replaces
   the exported builder call with `export default <handler-expression>` and
   retains only statically reachable lexical declarations/imports;
5. reject the graph unless a deterministic side-effect analysis proves every
   retained top-level construct is an import, function/class declaration, or
   `const` initialized by the closed pure-expression grammar below, then bundle
   that transformed handler-only graph; and
6. cross-check marker, export, span, graph identity, and bundle output before
   emitting the function manifest.

The marker is build-internal data keyed by the extractor's own table. An
author-authored lookalike has no matching table entry and fails. Executable
source never crosses the isolated definition evaluator's JSON result boundary.

The three graphs are separate artifacts:

- the original source graph is author input and source custody;
- the transformed definition graph contains markers and executes only in the
  existing isolated strict-JSON evaluator; and
- the transformed runtime graph contains no Snapback builder call/import and
  exports one closed registration map for every admitted inline handler in the
  same original static module graph.

The runtime resolver starts at the canonical app source root, follows only
literal relative ESM imports ending in `.js` or `.mjs`, refuses CommonJS,
package/bare imports, re-export stars, import attributes, URL imports, dynamic
import, and paths/symlinks whose fully resolved target escapes the root. It
admits at most 64 files, depth 16, 512 KiB source bytes, and a 256 KiB final
bundle. Every edge records importer span, normalized relative path, resolved
file identity, bytes digest, and module format. Case-fold collisions and a file
changing between parse and attested reread refuse.

The pure top-level initializer grammar is literals, arrays/objects without
spread/accessors, references to earlier admitted pure constants, and calls to a
closed Snapback-owned pure-helper allowlist whose source and version are pinned
in the extractor artifact; application code cannot assert purity. Arbitrary
calls, `new`, mutation,
await/yield, getters, computed property execution, environment/global reads,
and expression statements refuse even if a bundler believes they are
tree-shakeable. Function/class bodies remain inert until invoked and undergo
the final capability scan. The runtime entry registers a build-owned closed
operation-id-to-handler map. It is not mutable application global state, and
selection occurs only after the host has resolved and authorized the exact
manifest operation.

Final bundled bytes are rescanned under the existing handler capability
allowlist. Eval-like construction, unresolved modules, forbidden built-ins,
ambient file/network access, or a retained builder symbol fails before
artifact replacement. The transform does not execute application top-level
side effects in either codegen or the server runtime.

Warm execution retains LLP 0009's target-specific posture. On trusted-local
warm VMs, module lexical values—including values application code deliberately
stores in helper modules—may persist between invocations. Snapback resets and
generation-fences its host-owned context, capability, registry, active promise/
continuation, authority, argument, and result slots; stale continuations cannot
exercise a successor context. It does not claim to erase arbitrary application
closure state. Hosted/fresh-action profiles that require reset-equivalent
module evaluation retain that stronger existing posture. Imported modules do
not silently strengthen any target's isolation claim.

Inline operations from one original static graph intentionally share one
runtime bundle and therefore one warm-pool key. This preserves LLP 0009's
four-VM bound for the common many-operation application instead of producing
one key per operation and thrashing the pool. Every operation manifest binds
the complete group-bundle digest plus its exact registration id; changing one
co-resident handler invalidates the group's implementation identities. A
same-landing LLP 0009 amendment and DK-4 benchmark must prove 1, 4, 16, and 64
inline-operation graphs remain within the existing warm-reuse and memory
budgets before `inline_handler_v1` is advertised.

## Identity, artifacts, and public custody

The stable operation id remains `{appId}:{exportedName}`. It is authorization
identity, not implementation identity.

One separate `implementationHash` binds, using this Spec's frozen v1
length-framed encoding and domain `snapback:function-implementation:v1\n`, the
following fields in this exact order:

- operation id and kind;
- `handlerForm`, extractor/transform/bundler/evaluator/admission profile
  versions, canonical app source-root identity, and runtime registration
  profile;
- canonical args/result contracts;
- declared reads, writes, auth, effects, `uses`, and `outgrewIr`;
- the normalized graph edge/file records, complete bundled handler bytes, and
  dependency/source-map digests;
- runtime/data-tier profile versions; and
- every generated plan or standard-pattern identity consumed by the operation.

Each field is encoded as `u32be(tagBytes.length) || tagBytes ||
u64be(valueBytes.length) || valueBytes`; lists include their count and preserve
their declared canonical order. Canonical result contracts use the JCS bytes
defined below. Golden vectors freeze the preimage and digest. A handler byte,
dependency byte, form, toolchain, or admission change therefore changes
`implementationHash`, the complete artifact graph input hash, and bundle
admission identity. Unchanged source regenerates byte-identically.

Generated refs carry a closed `ExpectedOperationV1`:
`{protocol, appId, operationId, kind, implementationHash,
resultContractHash}`. The negotiated client protocol carries it through
ordinary query invocation, live subscribe/resume, mutation/action invocation,
query groups, and offline/ambiguous replay. The server validates request shape
and credential/authority envelope first, resolves the stable operation under
that authority, then compares every expected member before arguments, storage
work, settlement lookup, or handler execution. A mismatch returns
`SNAPBACK_OPERATION_IMPLEMENTATION_STALE` with only safe expected/actual
digests and upgrade/reload remediation. Consent and grants remain bound to the
stable operation id; implementation equality is compatibility, not authority.

The capability id `expected_operation_v1` gates this carrier and is advertised
in the capability manifest, connection grant, and authenticated `/inspect`
projection. It reports one admission policy:

- `exact.v1` compares every tuple member. It is the local/dev and build-pinned
  hosted policy. A rolling deployment admits explicitly listed predecessor and
  successor tuples only while both complete artifacts are installed.
- `contract-compatible.v1` is the long-lived native-client policy. It requires
  exact protocol, app, operation, kind, and `resultContractHash`, but treats an
  implementation-hash mismatch as a safe structured compatibility notice
  rather than a refusal. Hosted operation behavior may evolve while the
  generated input/result contract remains identical.

The policy is target-advertised and included in every connection/session
identity; a client never guesses or silently downgrades it. Live resume and
queued/ambiguous mutation replay remain `exact.v1` even under a
contract-compatible session because their prior execution/settlement identity
must not retarget. New generated-ref clients refuse a target that lacks the
capability rather than discard identity. Legacy string calls remain the
deprecated v1 compatibility lane and send no expected tuple; they cannot claim
stale-ref protection or precise result typing.

Private runtime artifacts contain the executable bundle. Browser/client
references and public inspection contain operation id, implementation hash,
contract hashes, and capability facts but never handler source, source-map
content, source path/span, or dependency paths. Canonical local source links
and spans may appear only in local build output, the committed review manifest,
and LLP 0031's authenticated/gated developer-admin twin; their public sentinel
is absent, not a redacted filesystem basename. Public/private trimming is
schema-driven under LLP 0037 and tested at every route/artifact.

Failed extraction, analysis, bundling, or result-contract validation leaves the
previous complete artifact graph untouched.

## Result contract vocabulary

The source vocabulary is:

```ts
results.documents(tableName)
results.records(recordValidator)
results.document(tableName)
results.value(valueValidator)
```

The validator spellings introduced or made normative by this profile are
`v.null()`, `v.boolean()`, `v.string({maxBytes})`,
`v.integer({min,max})`, `v.finiteReal({min,max})`, `v.principal()`,
`v.id(table)`, `v.literal(jsonScalar)`, `v.object(fields)`,
`v.optional(validator)`, `v.array(validator,{maxItems})`,
`v.union([variants])`, and `v.json({maxDepth,maxBytes})`. Omitted bounds use the
profile maxima below; authored bounds may only narrow them. All other spellings
refuse under `SNAPBACK_HANDLER_RESULT_CONTRACT_INVALID`.

`documents(table)` is valid only for query/live query. Its handler returns an
array of complete stored documents from that table, including the table's
Snapback system fields. Generated types use the installed table schema.
Optional stored fields follow storage reality: the complete document shape
contains the property with `T | null` when storage materializes absence as
null.

`records(v.object(...))` is valid only for query/live query. Its handler returns
an array of computed closed records. Those records contain exactly the declared
properties. Codegen never invents `_id`, `_version`, `_createdAt`, or
`_updatedAt`.

`document(table)` is valid for mutation/action and validates one complete
stored-document shape. It is the precise migration path for generated CRUD and
other operations returning one row. `value(validator)` is valid for
mutation/action and validates the direct returned value. Scalar queries are
outside v1: the existing query/live wire remains the closed
`{version, rows}` array protocol and `snapback.external-store.v1` does not
change.

The recursive v1 value vocabulary is:

- string, boolean, JavaScript-safe integer, finite real, null, principal, and
  table-scoped id;
- closed object with required and optional fields;
- homogeneous bounded array;
- closed union of 2–8 distinguishable variants, whose alternatives have
  different primitive kinds or closed objects sharing one required literal
  discriminator with pairwise-distinct values; and
- bounded JSON using LLP 0051's canonical JSON boundary.

Unknown object fields fail. Contracts govern the strict JSON image after the
existing evaluator serializer, not the pre-serialization JavaScript object
graph. Consequently an object property whose value serializes as `undefined`
is absent, an array element/root `undefined` follows the existing JSON boundary
(`null`), and getters/proxy traps/`toJSON` may run as application code during
serialization before contract validation. The validator itself invokes no
application code. Cycles and root-level function/symbol values that cannot
cross that boundary fail serialization before validation. Non-finite numbers
arrive as JSON `null` and therefore fail an integer/finite-real contract as
actual kind `null` while remaining valid under `unknown` or an admitted null
contract. Values with non-plain prototypes arrive as their ordinary JSON image
(for example, enumerable own properties, or `{}` for an uncustomized `Map`) and
are then checked structurally; prototype identity is never part of the result.
This post-image rule is identical across Hermes, V8, IR, and hosted evaluators
and is covered by one adversarial corpus.

`v.optional` inside a stored document follows table/storage semantics, while
inside a computed contract it means an absent-or-present JSON property. Unions
are evaluated in declaration order for diagnostics and must satisfy the
syntactic disjointness rule above; overlapping variants fail generation.

The Rust-owned manifest enum is:

```text
FunctionResultContractV1 =
  Unknown
  | Documents { table }
  | Records { object }
  | Document { table }
  | Value { value }

ResultValueV1 =
  Null | Boolean | String { maxBytes } |
  Integer { min, max } | FiniteReal { min, max } |
  Principal | Id { table } | Literal { canonicalJson } |
  Object { declarationOrderedFields[] } |
  Array { element, maxItems } |
  Union { discriminator?, variants[] } |
  Json { maxDepth, maxBytes }
```

Bounds are depth 16, 128 object fields across one contract, 8 union variants,
1,024 array elements, 1 MiB per string/JSON value, and a newly enforced 4 MiB
complete post-serialization result ceiling on query, live, mutation, action,
retention, and replay lanes. The capability report changes
`maximum_result_size` from advisory to enforced for targets advertising
`result_contract_v1`; validation refuses before publication or commit when the
complete encoded result would exceed it. Integer bounds are JavaScript-safe; finite-real
canonicalization follows LLP 0007. Field names are unique UTF-8 strings and
objects retain declaration order for projections while hashes use RFC 8785
JCS. `resultContractHash` is
`sha256(UTF8("snapback:function-result:v1\n") || JCS(contract))`.

`Documents` and `Document` are structural installed-schema contracts, not
nominal provenance claims: a JSON object passes when it exactly satisfies the
named table's current application fields plus host system-field shape,
including present-null stored optionals. A computed clone with that exact
shape is indistinguishable and valid; table origin is not inferred from JSON.
`Records` contains exactly the declared properties and never gains system
fields.

The manifest is projected to JSON Schema, TypeScript, provider introspection,
operation schemas, Contract bindings, capability inspection, and summaries.
Consumers do not re-infer it from a TypeScript declaration.

An omitted result becomes `{kind: "unknown"}`. The runtime still enforces JSON
transport bounds, generated references expose `unknown`, and codegen emits one
degraded-authoring diagnostic with exact source link and remediation. It never
samples a result or examines opaque source to invent a type.

## Runtime validation and atomicity

All validation errors use
`SNAPBACK_HANDLER_RESULT_CONTRACT_VIOLATION` and include operation id/kind,
contract hash, JSON path, expected contract kind, and actual JSON kind. They
never include the rejected value.

Query and live-query output is validated before snapshot/live publication,
cache insertion, or transport serialization. The outer array and every
document/record are checked. A document contract also checks application and
system-field shape structurally against the installed named table schema; it
does not attempt provenance recovery from JSON.

A fresh mutation result is validated before its storage transaction commits.
Validation failure rolls back the writes, creates no successful retained
output, advances no durable version, and publishes no optimistic settlement.
This requires the commit seam, not a post-commit transport check.

Retained mutation output stores the complete original
`ExpectedOperationV1`, `resultContractHash`, and a reference to the
content-addressed normalized validator. Validator artifacts are durably
deduplicated by hash and retained at least as long as any unacknowledged LLP
0043 settlement that cites them. Exact replay under the original expected tuple
validates and releases the original bytes without rerunning, even after a
new deployment installs another current contract. Reuse of the same
`clientMutationId` under a different expected tuple refuses
`SNAPBACK_MUTATION_RESULT_CONTRACT_STALE`; it never reinterprets or reruns.

Legacy retained rows lacking a contract hash are migrated as `Unknown` and
remain reclaimable through the legacy string/tuple lane. Auth/credential
preparation and authority-descriptor checks still precede settlement lookup.
Authenticated acknowledgement permits the existing bounded retention eviction
of result and now-unreferenced validator artifact, so a contract rollout cannot
strand an immortal unacknowledged settlement. Acknowledgement is tuple-
independent after authority checks: even a client whose expected tuple is stale
may acknowledge and reclaim the already-delivered settlement.

An action result is validated before Snapback publishes it. Effects that the
action already performed cannot be rolled back; the result is still refused
through the ordinary structured invocation diagnostic. Cron actions also write
the existing gated cron-run record; direct actions have only their response
envelope and gated recent diagnostics, not a fictional persisted run log.
V1 does not invent a new public effect-receipt schema. Direct and cron actions
validate their final JSON result; streaming chunk contracts require a separate
stream protocol revision. Action authoring and guides must not describe result
validation as external-effect atomicity.

Buffered, native, IR, and hosted evaluators apply the same contract and corpus.
Validation is deterministic and does not call application code.

## Generated references and consumers

Every generated operation reference carries compile-time `Args` and
handler-payload `Result` phantoms plus runtime
operation/app/schema/implementation identity. Shared helpers
`FunctionArgs<R>` and `FunctionResult<R>` extract those payloads.
`QueryInvocation<R>` is the existing `{version, rows:
FunctionResult<R>}` envelope; `MutationInvocation<R>` is the existing mutation
receipt/envelope whose logical `result` is `FunctionResult<R>`; and
`ActionInvocation<R>` is the action envelope. Query/live documents and records
infer arrays; mutation/action document/value contracts infer their direct
payload. React/query groups admit only the array query forms.

Headless invocation, the first-party React binding, typed query groups,
provider introspection, mutation settlement, and operation schemas consume
that same reference. User-selected generics cannot override a generated
result. An untyped third-party provider may expose `unknown`, but a first-party
generated reference remains the compile-time source of truth and runtime
egress remains validated.

Each operation emits deterministic args and result JSON Schemas. Omitted
contracts emit an explicitly unconstrained/degraded result schema, not a
fabricated document row. All projections carry the source contract hash and
are drift-checked against the Rust manifest.

The Rust-owned `ContractProjectionWitnessV1` artifact is:
`{operationId, resultContractHash, status}` where status is
`{kind:"supported", descriptorHash}` or
`{kind:"missing", reason}`. The closed missing reasons are
`optional-field`, `union`, `mutation-result`, `action-result`,
`principal`, `bounded-json`, and `exact-vocabulary-version`. Unsupported
operations remain present in provider inspection and generated refs but have no
Contract binding; a Contract consumer refuses that operation with the witness
and direct remediation. Where the Exact-owned descriptor vocabulary cannot
represent the shape, Snapback refuses to emit a lossy binding. Adding that
vocabulary requires a coordinated Exact schema/version change; Snapback does
not silently fork the descriptor schema.

## Compatibility and migration

The operation-kind/form matrix is closed:

- query/live/mutation: `{handler}` inline or
  `{source, exportName}` legacy module, never both;
- action: `{handler}` inline, `{js:{source, exportName}}` legacy JS, or the
  existing closed plan arm, exactly one; and
- every mixed, missing, indirect, or nested variation refuses before
  definition evaluation.

The legacy forms remain supported through v1 and receive the same explicit new
result-contract path. Existing JS query `result: v.object(...)` retains a
versioned `LegacyQueryRowsV0` compatibility contract: it validates the declared
application fields while permitting the shipped document system fields and
preserves current generated typing. It is not reinterpreted as exact
`results.records`. At runtime it requires every declared required field and
validates every declared present field, permits the four shipped document
system fields, and also permits undeclared non-system fields. That deliberate
open-extra behavior preserves existing over-returning handlers while making
the generated declared subset sound. Validation activates whenever the target
advertises `result_contract_v1`; a previously missing or invalid declared field
then refuses at egress, while an extra field continues to pass. Codegen emits a
source-linked local/gated migration warning;
authors choose `results.documents(table)` for stored rows or
`results.records(...)` for exact closed computed rows. New mutation/action
result contracts use `results.document` or
`results.value`.

Artifact manifests record `handlerForm: inline | module | action-plan` and
`resultContractVersion`. Form changes with byte-equivalent bundled output still
change the implementation hash because source custody and admission evidence
changed; operation id remains stable.

## Diagnostics

Stable generation diagnostics include:

- `SNAPBACK_FUNCTION_HANDLER_FORM_INVALID`;
- `SNAPBACK_INLINE_HANDLER_DIRECT_LITERAL_REQUIRED`;
- `SNAPBACK_INLINE_HANDLER_EXPORT_REQUIRED`;
- `SNAPBACK_INLINE_HANDLER_MARKER_INVALID`;
- `SNAPBACK_HANDLER_BUNDLE_IMPORT_FORBIDDEN`;
- `SNAPBACK_HANDLER_BUNDLE_DYNAMIC_IMPORT`;
- `SNAPBACK_HANDLER_RESULT_CONTRACT_INVALID`;
- `SNAPBACK_HANDLER_RESULT_CONTRACT_KIND`;
- `SNAPBACK_HANDLER_RESULT_CONTRACT_DEGRADED`; and
- `SNAPBACK_HANDLER_RESULT_CONTRACT_VIOLATION`.

Runtime compatibility adds:

- `SNAPBACK_OPERATION_IMPLEMENTATION_STALE`; and
- `SNAPBACK_MUTATION_RESULT_CONTRACT_STALE`.

Contract violations traverse object fields in declaration order and arrays by
ascending index; the first deterministic failure wins. Paths use bounded RFC
6901 JSON Pointer, maximum 17 segments and 256 UTF-8 bytes, including an outer
query-row index plus the contract's maximum depth. A pointer exactly at either
bound is emitted; a deeper or longer path emits the bounded ancestor followed
by one literal `/<truncated>` segment after reserving space for that suffix.
Declared field names
use normal pointer escaping. An unknown application-controlled key appears
publicly only as `/<unknown>#<first-12-hex-sha256>`; its original bounded name
may appear in the gated developer twin. Union failure reports the discriminator
path when available, otherwise the first variant's first failure plus the
bounded count of failed variants. Expected/actual kinds use closed enums, never
the rejected value. Public detail fields are capped independently and have
schema-owned gated/public projections.

Generation diagnostics use original authored paths/spans only in local and
gated custody. Internal transformed or synthetic module text is never presented
as the remediation source; public clients receive operation/digest facts
without source paths.

## Acceptance

Semantic acceptance requires this Spec and the governing LLP 0004/0009/0010/
0012/0031/0037/0043/0093/0094/0095 contracts to agree on bundling, identity,
public custody, replay, wire closure, refusal registration, client conformance,
and runtime validation. The same landing updates LLP 0094's §0C closure matrix
and §0E refusal registry and adds LLP 0095 query/live/mutation/action/resume/
replay conformance fixtures for both admission policies.

Implementation evidence must prove:

- inline query, live query, mutation, and action execute natively and through
  every claimed evaluator; legacy module form remains compatible;
- static local helpers/imports bundle, while mixed form, indirect handler,
  dynamic import, forbidden ambient dependency, forged marker, and unsupported
  syntax fail at precise source spans before artifact replacement;
- handler/dependency byte changes alter implementation and artifact identities;
  unchanged regeneration is byte-identical, stale loads/refs refuse, and public
  artifacts contain no executable source;
- warm-VM reuse resets and fences every host-owned slot/continuation while
  preserving LLP 0009's explicit trusted-local application lexical-residue
  nonclaim and stronger hosted/fresh target postures;
- document arrays, singular documents, computed records, direct values,
  optional fields, unions, ids,
  arrays, JSON, scalar bounds, extra fields, and nested error paths pass one
  cross-evaluator corpus;
- computed records receive no invented system fields and stored documents
  exactly match storage optional/system-field behavior;
- invalid query/live/action output is never published; invalid mutation output
  rolls back every write and retained settlement; replay validates without
  rerunning and a contract-hash change refuses stale output;
- generated query/mutation/action calls infer exact args/results without casts
  or explicit generics; React hooks and grouped queries prove the same when the
  sibling first-class-React and typed-group surface lands;
- expected-operation identity is carried and checked across query/live and
  mutation/action lanes, and across group/resume/replay whenever those sibling
  lanes exist; stale refs refuse before
  work while legacy strings retain their documented weaker compatibility;
- provider, operation-schema, client-reference, capability, and supported
  Contract projections agree on one contract hash; an unrepresentable Contract
  shape is an explicit GAP rather than lossy output;
- codegen summaries count and link every degraded unknown result;
- adversarial post-JSON boundary, legacy-row, nested-action-form,
  source-custody, original-contract replay, validator-retention, redacted-path,
  and Contract-witness matrices pass; and
- a maintained demo deletes separate handler registry/source wiring while
  preserving its live, atomicity, rejection, and package-closure evidence.

## Status and implementation sequence

This is a Review proposal. After author-invoked super-refine and acceptance, the
implementation order is:

1. Rust result-contract manifest/schema and semantic validation;
2. pre-commit/runtime/replay egress validation and contract hashing;
3. generated args/result schemas and reference inference;
4. inline source extraction, transformed definition evaluation, and static
   handler bundling;
5. React/query-group consumers and supported Contract projection;
6. demo migration, guide/capability updates, and full conformance review.

## Final author reconciliation after round 3

The three-round super-refine loop ended with both reviewer families at
`NOT READY`. Their material findings are accepted. To avoid implementing
reviewed-but-unclosed replay, rolling-deployment, and graph-synthesis
mechanisms, this section narrows the first implementation slice. It is
normative and supersedes contrary language above for the v1 landing. The
broader mechanisms remain research, not advertised capability.

### A. Inline v1 is a self-contained expression, not a module bundler

An inline handler is one authored function or arrow-function expression whose
complete AST is present in the declaration's `handler` member. The admitted
free identifiers are only the function's parameters, locals declared inside
the expression, ECMAScript syntax explicitly allowed by LLP 0009, and the
existing runtime globals already supplied by the isolated evaluator. Inline v1
admits no imported or sibling helper, class declaration or expression,
computed/static class element, dynamic import, `eval`, `Function`, top-level
definition initializer, or transitive source graph.

Codegen parses the authored module and extracts the handler member's exact AST
node and source span. It does not reconstruct executable source with
`Function.prototype.toString()`. The definitions module continues to run in
the existing isolated generation worker because that is already required by
the legacy authoring surface; inline v1 makes no stronger no-top-level-effects
claim. The extracted expression is emitted into one deterministic runtime
module per operation. Registration identity is the exported operation name;
duplicate names refuse. Operations are sorted by UTF-8 name in aggregate
manifests, and each complete generated operation retains the existing
per-artifact size/count limits.

The implementation hash is SHA-256 over a JCS object containing
`formatVersion`, `appId`, operation name/kind, canonical extracted AST bytes,
the exact args contract hash, effective result-contract hash, declared
reads/writes/auth/uses, and the operation's own standard-pattern or plan
identity when present. Author declaration order is diagnostic metadata only.
Golden vectors and byte-identical regeneration are the authority for the
encoding. Executable source, paths, spans, and source maps remain private
artifacts and never enter public inspect/provider payloads.

### B. No new expected-operation or compatibility protocol in v1

`ExpectedOperationV1`, `exact.v1`, `contract-compatible.v1`, compatibility
notices, predecessor execution windows, and tuple carriage through RQS,
groups, resume, or replay are removed from this implementation slice. Clients
and loads retain the shipped whole-artifact/function-reference compatibility
behavior governed by LLP 0064 and LLPs 0090–0095. This landing must not
advertise `expected_operation_v1`, add wire members for it, or relax any
existing exact identity check.

Existing mutation settlement identity, lookup order, acknowledgement,
retention, replay, and garbage collection remain exactly as governed by LLP
0043. A frozen effective validator is stored with an unacknowledged settlement
so replay never resolves a table name against a later schema. The general
finite egress ceiling is 4 MiB, but a retained mutation result remains subject
to the existing 65,536-byte serialized `MutationOutput` ceiling and existing
global/per-authority caps. No executable predecessor is retained for replay.

### C. Effective result contracts are closed and schema-bound

The Rust-owned result-contract enum includes every variant named in this Spec,
including `LegacyQueryRowsV0`. `Document` and `Documents` are expanded at
generation/load time into a frozen, name-keyed structural schema including the
four required host fields and exact optional-storage semantics. The effective
result-contract hash is SHA-256 over the expanded JCS contract, never merely a
table name or declaration-ordered field array.

Legacy query validators map all shipped spellings without changing existing
authoring: nullary `string`, `boolean`, `integer`, `real`, `number`, `id`, and
`json`, plus their shipped option-bearing forms, map to their current bounded
runtime meanings. `real` and `number` mean a finite JSON number at the active
profile bounds; nullary `json` uses the active profile's recursive JSON
limits. The closed new `results.*` grammar may reject an unknown new spelling,
but activation must not reject a previously valid legacy declaration.
`LegacyQueryRowsV0` requires `_id`, `_version`, `_createdAt`, and `_updatedAt`
with their exact generated types while retaining the legacy rule for
undeclared non-system fields.

Every existing JS and HostPlan query, live-query, mutation, action,
relational-query, action-plan, and standard-pattern return arm maps
deterministically to a concrete effective contract or to the explicit
`Unknown` contract. No operation disappears. Unknown is honest loss of
precision, not permission to skip runtime JSON-image and size validation.

Validation is against the existing post-`JSON.stringify`/parse image,
including its root-`undefined` settlement behavior. Query/live/action results
validate before publication. Mutation results validate before commit and
settlement retention. Contract-wide depth, node, array, string, and byte
limits apply through nested `json` nodes as well. Diagnostic pointer sentinels
are encoded outside the user-field namespace; user-authored names cannot
collide with truncation or unknown-key markers.

### D. Consumer and capability closure

Provider introspection receives an explicit revision that carries every
operation kind, its args hash, effective result hash, and either a total
recursive witness or a closed path-specific missing reason. Contract consumes
that revision fail-closed. Generated headless, React, and React Expo
references carry the complete runtime reference; hook APIs infer `Args` and
`Result` and do not expose a result-generic override. React evidence is
mandatory because that package already ships; typed query-group evidence is
conditional only until LLP 0102 lands.

Only `inline_handler_v1` and `result_contract_v1` may be added by this slice.
They begin at experimental maturity under LLP 0058 and require its normal
acknowledgement until their positive conformance predicates pass. The same
landing amends LLP 0004's authoring surface, LLP 0009's evaluator and benchmark
inventory, LLP 0010's single-file-runtime restriction, LLP 0037's effective
schema custody, LLP 0058's capability registry, LLP 0064's compatibility
statement, and the applicable LLP 0094/0095 generation/runtime diagnostic and
fixture registries.

The inline advertisement gate is a named count-parametrized benchmark over
1, 16, 64, and 256 self-contained operations. Warm invocation must retain LLP
0035's `warm_invoke_us < 0.75 × vm_cost_us` criterion at every count, the
existing four-VM per-instance LRU cap must hold under churn, and the landing
records median/p95 generation latency plus peak RSS as evidence rather than
claiming a nonexistent historical memory budget.

The landing's conformance matrix must exercise every legacy validator
spelling, every result node, schema-only hash changes, all existing operation
forms, post-JSON adversarial values, 64 KiB settlement versus 4 MiB egress
boundaries, exact system-field behavior, React inference, total Contract
projection, public-source custody, and byte-identical regeneration.
