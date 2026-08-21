# LLP 0108: Inline handlers and result contracts

**Type:** Spec
**Status:** Accepted
**Systems:** Authoring, Code generation, Runtime, Data API, Client integration, Contract, Security, Artifacts, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-27
**Revised:** 2026-08-21 (handler-visible buffered-insert versions use a
commit-time allocator fence: a moved global head rejects the invocation before
effects; admitted document results resolve `_id` against the transaction's
final row image, replace authoritative system fields, and revalidate before
settlement or publication); 2026-08-18 (LLP
0276 crate-path relocation); 2026-08-15 (single-value query egress: query/live-query
declarations admit `results.document` and `results.value`; authored handlers
return that value directly while the existing query/live transport carries it
as exactly one internal row, and typed consumers project the value back out).
**Revised:** 2026-08-08 (result-contract violations name the closed,
value-free constraint and report aggregate bound measurements only); 2026-08-03
(Accepted 2026-08-03 by the author — decision
sitting #2, "accept all that verify",
`issues/20260803-author-decision-sitting-2.md`; gate verified: the round-3
NOT-READY material findings were all absorbed by the §Final author
reconciliation narrowing, which remains normative for the v1 landing;
status Review → Accepted).
2026-08-02 (typed-interior and schema-reference implementation
clarification: result-side `v.doc(table)` is an app-authority reference that
expands through the existing frozen structural document contract before
hashing; generated handler/context types consume schema and effective-contract
artifacts, and checker diagnostics never mint a contract from behavior).
2026-08-02 (LLP 0156 D-05 refusal-tracking opt-in: additive
`trackedRefusals` private manifest authority, constrained to a unique subset
of declared `refusals`, prepared with each invocation, and omitted from the
served/public function projection).
2026-08-02 (Accepted LLP 0135 owner fold: JS-mutation sequence
declarations, versioned implementation-identity extension, and
`ctx.sequence.allocate` harness surface); 2026-08-01, later same day (declared application refusals: `ctx.refuse` plus a manifest-declared closed code set, admitted only when declared and folded to the generic failure otherwise, carried as `appCode`/`appDetails` beside the platform code on both envelope decoders); 2026-08-01 (0137 a4-f1: §Admission rules gains the dated egress
seam note — with SNAPBACK_OUTBOUND_ACTIONS set at generation, `fetch` is an
admitted global in inline handler/helper analysis, mirroring the module-form
scanner; timers stay excluded; runtime remains the security boundary.)
2026-07-31 (the recursive result vocabulary gains `AssetRef`,
the typed-reference leaf whose post-JSON representation is the non-empty
opaque asset-id string; this unblocks direct query/live-query document
contracts over asset-bearing tables while leaving attachment admission at the
storage commit boundary per LLP 0007/0044). 2026-07-31 (same-file helper sharing absorbed as normative text —
the landed move-2 mechanism (LLP 0115 CV-7; LLP 0118 option 1a; LLP 0127
decision 6; commit `4d72c407`) is specified in §Same-file helper sharing at
the end of this document: same-file lexical graph scope, lazy admission with
symbol-resolved sibling helpers, resolve-and-splice emission, the v2
named-helper-content implementation-hash format, and the four helper refusal
codes. §A's sibling-helper exclusion is narrowed exactly that far; the
superseded §Bounded static bundling and the Diary 0039 follow-on note are
marked where their group-bundle/warm-pool phrasing no longer describes the
landed design, with history retained. Benchmark receipts against LLP 0035's
fresh-invocation baseline are recorded in LLP 0118 open question 1.)
2026-07-30 (dated evidence note, Diary 0039 / LLP 0115 audit —
see §Diary 0039 field evidence at the end of this document: the info-severity
degraded-result diagnostic demonstrably failed to prevent two real apps from
shipping degraded contracts, making the strictness decision (LLP 0115 OQ3) a
real product gap rather than polish; and the superseded §Bounded static
bundling is designated the blueprint for the helper-reuse follow-on, whose
concrete costs — a v2 content-hash format carrying the dependency graph, the
group-bundle warm-pool model, and re-proving the adversarial-closure rules
across module boundaries — are recorded there. No normative v1 change.)
2026-07-28 (adversarial follow-up: dynamic computed binding and
assignment-pattern destructuring fail closed). 2026-07-28 (adversarial closure: constant-alias and destructuring
reflection refusal, default-deny dynamic computed member access, runtime
constructor-walk probes, stored optional JSON normalization, and exact record
row bounds). 2026-07-27 (final author reconciliation after the three-round
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
**Related:** LLP 0004, LLP 0009, LLP 0010, LLP 0012, LLP 0031, LLP 0035,
LLP 0037, LLP 0043, LLP 0051, LLP 0055, LLP 0064, LLP 0065, LLP 0074,
LLP 0093, LLP 0094, LLP 0095, LLP 0115, LLP 0118, LLP 0127, LLP 0131,
LLP 0156

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

> **Superseded blueprint (marked 2026-07-31).** This section was demoted to
> research by the round-3 reconciliation below and is retained as history.
> Its helper-sharing intent landed in narrowed form as the same-file slice
> (§Same-file helper sharing, at the end of this document), but its emission
> and lifecycle model did not: the group-bundle/warm-pool-key design below
> speaks in retired DK-4 terms — LLP 0009 retired DK-4 warm reuse on
> 2026-07-27 and the shipped lifecycle is fresh-per-invocation — and under
> that lifecycle resolve-and-splice dominates the group bundle on both the
> identity and runtime axes (LLP 0118 finding 7). Group-bundle emission is
> re-motivated only if pooling returns under LLP 0009's stated condition.

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

`document(table)` validates one complete stored-document shape, and
`value(validator)` validates one direct returned value. Both are valid for
mutation/action and for query/live query. They are the precise result shape
for generated CRUD, point reads, aggregates, and other operations returning
one value rather than an authored list.

### Query single-value egress — 2026-08-15

Query and live-query transport remains the closed `{version, rows}` protocol,
and the live-diff/external-store owners remain row-oriented. A query declared
with `results.document` or `results.value` therefore places the authored
handler value in **exactly one internal row**. Runtime result validation checks
that one row against the declared single-value contract; zero or multiple
internal rows are a contract violation. Typed query consumers project the row
back to the authored value, so an object handler result is an object at the
Familiar React surface rather than a one-element array. Row-shaped contracts
(`documents`, `records`, and the legacy form) retain the array-only safety
floor unchanged.

The recursive v1 value vocabulary is:

- string, boolean, JavaScript-safe integer, finite real, null, principal,
  typed asset reference (the non-empty opaque asset-id string), and table-scoped
  id;
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
  Principal | AssetRef | Id { table } | Literal { canonicalJson } |
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

When a buffered JavaScript mutation reads a document it inserted in the same
handler, the read-your-writes overlay remains structurally complete, including
`_version`. That value is handler-visible: code may return it through a value
contract, copy it into another result shape, or persist it in another row. It is
therefore the invocation's **fenced commit successor**, not a validation-only
placeholder. The completed invocation carries that successor to storage; after
the local writer acquires its `IMMEDIATE` reservation and runs the authoritative
allocator, commit proceeds only when the selected version is identical. A
disjoint intervening commit produces `SNAPBACK_MUTATION_CONFLICT` before any
buffered effect is applied. This keeps handler execution outside the write lock
and preserves complete read-your-writes documents without allowing a guessed
version to commit or escape.

For an exact `document(table)` contract, storage additionally resolves the
returned `_id` in the transaction's final row image, including an unchanged
row, and replaces `_version`, `_createdAt`, and `_updatedAt` from that
authoritative document before the result is retained, settled, or published.
A missing or deleted final row fails closed; storage revalidates the projected
result while rollback is still possible. This is defense in depth for the
exact document carrier, not the correctness mechanism for values copied
elsewhere. A mutation dry-run uses the same allocator fence and identical
final-image projection and revalidation before forming `DryRunReport.result`;
rollback still discards its would-be changes.

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
`ActionInvocation<R>` is the action envelope. Query/live `documents` and
`records` infer arrays, while query/live `document` and `value` infer their
direct payload despite the internal one-row transport carrier. Mutation/action
document/value contracts also infer their direct payload. Typed query groups
admit only the array query forms; headless one-shot queries, headless live
handles and callbacks, and React bindings project the single-value forms
before exposing them to application code.

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

Result-contract violations use the closed constraint vocabulary
`maxResultBytes`, `serialize`, `type`, `literal`, `range`, `maxBytes`,
`maxDepth`, `nodeBudget`, `maxItems`, `minItems`, `arity`, `dimensions`,
`requiredField`, `extraField`, and `union`. `limit` and `observed` appear only
for size, count, depth, and budget bounds; they are omitted for all other
constraints and never carry a rejected scalar's own value.

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

This is an Accepted specification (accepted 2026-08-03; it was a Review
proposal through the author-invoked super-refine). The implementation order
is:

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

*(Amended 2026-07-31: the sibling-helper exclusion is narrowed — same-file
top-level sibling function declarations are now admitted under §Same-file
helper sharing at the end of this document. Every other exclusion in the
paragraph above stands.)*

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
conditional only until LLP 0114 lands.

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

## Adversarial implementation closure — 2026-07-28

The inline extractor now rejects `constructor`, `prototype`, and `__proto__`
through direct access, computed constant expressions, chained `const` aliases,
computed or aliased destructuring, and the admitted `Object` reflection
methods. Element access whose property cannot be resolved statically is
outside `inline_handler_v1`; this intentionally leaves dynamic array indexing
to a future profile instead of allowing an array-built
`["con", "structor"].join("")` key to reach a constructor. The Ibex boundary
continues to deny constructor walks, destructured constructors, `eval`,
`Function`, `Reflect.apply`, and `Reflect.construct` as the runtime backstop.
Both declaration binding patterns and later destructuring assignments share
that admission rule. Static `constructor`/`prototype`/`__proto__` assignment
keys refuse, and a computed assignment key that cannot be resolved to a safe
constant refuses rather than being ignored.

Stored optional JSON fields expand to one required `json` contract because
JSON already admits null; emitting `null | json` would create an overlapping,
invalid union. Other stored optionals remain required `null | Scalar` keys.
Records may now carry an optional closed row-count bound. The LLP 0110
one-envelope profile uses exactly `{ minItems: 1, maxItems: 1 }`; both the Rust
publication boundary and shared JavaScript validator refuse zero or two rows.

## Diary 0039 field evidence — 2026-07-30

The seven-app Snapback × Convex rerun (Diary 0039) exercised this Spec's
shipped v1 across five arms and produced two findings, absorbed here as dated
evidence without changing v1 normative text. Both are tracked in LLP 0115
(CV-6, CV-7).

**The degraded-result diagnostic is correct but too quiet to do its job.**
`SNAPBACK_HANDLER_RESULT_CONTRACT_DEGRADED` ships today with a
table-interpolating remediation, at `severity: 'info'` — and two real arms
(Cursor Garden's `updateNote`, Pantry Search's `addRecipe`) shipped degraded
`unknown` contracts anyway. This Spec deliberately specifies no strictness
mechanism; the field evidence says the omission-is-admitted posture needs a
decision, not more mechanism: raise the severity, or gate refusal behind a
per-app strictness toggle (LLP 0115 open question 3, an amendment to this
Spec either way). One boundary stands regardless of that decision: a
field-level paste-ready suggested contract would require inspecting handler
behavior, which this Spec's no-inference invariants forbid — the suggestion
stays at the shipped template level.

**Self-contained v1 reproduces helper duplication by design, and the fix is
already drafted above.** Streak Lab duplicated its calendar helper between
query and mutation, and Campfire its indexed-read helpers — exactly the "no
imported or sibling helper … no transitive source graph" exclusion of the
round-3 reconciliation. The superseded §Bounded static bundling is the
designated blueprint for the follow-on (it was demoted because the review
loop reached its round limit, not because the design was refuted). The
follow-on must own three consequences that section already implies: the v1
content hash carries no dependency graph, so helper imports are a v2 hash
format, not an extractor tweak; shared helpers effectively require the
group-bundle model and therefore reopen the warm-pool-key question and the
DK-4 benchmark gate; and every 2026-07-28 adversarial-closure refusal rule
must be re-proved across module boundaries. The non-negotiables are
unchanged: closed content-addressed graph, no `Function.prototype.toString()`
authority, no runtime capture inference, no ambient checkout access.

*(Corrected by the 2026-07-31 landing: the middle consequence was wrong.
Shared helpers do not require the group-bundle model — the landed mechanism
uses resolve-and-splice emission, under which no shared bundle and no
warm-pool key exist; per-invocation evaluation stays bounded by the
operation's own closure and invalidation stays exactly per-operation under
the shipped fresh-per-invocation lifecycle (LLP 0118 finding 7). The other
two consequences held as stated: helper edges landed as the v2 hash format,
and the adversarial refusals were re-proved across the helper boundary.
§Same-file helper sharing below is the normative text.)*

## Same-file helper sharing — 2026-07-31 (normative)

The first widening of the round-3 self-containment narrowing landed on
2026-07-31 (LLP 0115 CV-7 move 2; LLP 0118 option 1a; LLP 0127 decision 6;
commit `4d72c407` — `packages/snapback-codegen/inline-handlers.mjs`, proven
in `inline-helper-sharing.test.mjs` for both motivating diary shapes). This
section is normative. It narrows §A's "no imported or sibling helper"
exclusion exactly this far and no farther.

### Graph scope: the same-file lexical slice

An inline handler may reference statically reachable top-level sibling
**function declarations** in the same authored functions file. Admission is
lazy: only helpers actually reached from an admitted handler expression are
analyzed under the handler rules, so top-level functions used purely at
definition time stay untouched. Identifier resolution is symbol-based and
runs before the globals allowlist, so a sibling declaration keeps its
authored lexical meaning even when it shadows an admitted global name. There
is still no import, no multi-file graph, no resolver, and no filesystem path
in identity: the executable graph remains closed, content-addressed, and
defined by the file's bytes alone.

Context-reader helpers are admitted (LLP 0127 decision 6): a helper may
receive and use the runtime context or values derived from it. Declared
reads/writes remain evidence (basis: `declared`), never an enforced ceiling;
a helper inherits exactly its consumer's kind- and grant-keyed runtime
boundaries. Ceiling enforcement is sequenced as its own later decision,
decoupled from this slice.

### Admission rules

Only a single-declaration, bodied, named top-level function declaration is a
spliceable helper. Helper bodies are scanned under exactly the
handler-expression rules, so the 2026-07-28 adversarial closure holds across
the helper boundary: alias, computed, and destructured reflection, assignment
destructuring, `eval`/`Function`, dynamic import, class syntax, and ambient
`this` all refuse inside a helper. Mutual helper recursion refuses;
self-recursion is admitted. A reference to a top-level
`const`/`let`/`var`/`class`/import binding refuses with the binding kind
named — under splice emission such a binding would be a temporal-dead-zone
edge or a laundering channel (e.g. `const c = obj.constructor` at top
level). The stable helper refusal codes:

- `SNAPBACK_INLINE_HELPER_SYNTAX_FORBIDDEN` — an adversarial-closure rule
  violated inside a helper body, reported at the helper's authored span;
- `SNAPBACK_INLINE_HELPER_FREE_IDENTIFIER` — a helper references
  identifiers outside the admitted helper graph, with the top-level binding
  kind named in the hint;
- `SNAPBACK_INLINE_HELPER_CYCLE` — mutual helper recursion; and
- `SNAPBACK_INLINE_HELPER_INADMISSIBLE` — a reference to a duplicate,
  bodyless, or unnamed top-level function declaration.

**Egress seam (dated note, 2026-08-01 — 0137 a4-f1).** The globals
allowlist honors the same `SNAPBACK_OUTBOUND_ACTIONS` opt-in the module-form
scanner (`scanUnsupportedHandlerSource`) applies: with the opt-in set at
generation, `fetch` is an admitted global in inline handler and helper
analysis, so an outbound action is authorable in the inline form. This is
the existing codegen DX relaxation, not a security decision — the runtime
remains the boundary that denies fetch by handler kind and by the runtime
half of the opt-in (LLP 0027 / LLP 0009). Ambient timers remain excluded
from the inline allowlist even under the opt-in (waiting inside a handler
stays out of inline v1); the final bundled-bytes rescan already admitted
both under the seam, so this aligns extraction with the rescan for `fetch`
only. Before this note the inline allowlist had no egress awareness at all,
which — combined with the undocumented closed-script registration contract
of the module form — left outbound actions unauthorable from the packaged
closure (issues/20260801-0137-a4-outbound-notification-effects-unauthorable.md).

### Emission: resolve-and-splice

Each operation's runtime module carries exactly its own reachable-helper
subset as hoisted function declarations after the v1 registration line, in
sorted-name order for deterministic regeneration. Zero-helper emission is
byte-identical to v1, so every pre-existing generated artifact regenerates
unchanged. The final capability rescan runs over the complete spliced bytes —
registration plus helpers — with refusals mapped back to the helper's
authored source span. Duplicated helper storage lands in generated
artifacts, the tier where LLP 0115 constraint 4 tolerates volume;
per-invocation evaluation stays bounded by the operation's own closure under
the shipped fresh-per-invocation lifecycle. The per-invocation cost of that
duplication was measured against LLP 0035's fresh-invocation baseline on
2026-07-31 and is noise-level; the receipts live in LLP 0118 open question 1
and the `helper_splice` section of the `snapback-bench` harness
(`crates/snapback-tools/src/bench.rs`).

### Identity: the v2 implementation-hash format

A helper-using operation moves to the v2 implementation-identity format: the
identity object's `format` is `snapback.function-implementation.v2`, its
hash-preimage domain versions with it, and its inline handler member
carries — besides the canonical handler AST — a sorted-name list of
helper-content edges `{name, contentHash}`. `contentHash` is the SHA-256 of
the helper's export-stripped canonical AST under the
`snapback:inline-helper-content:v1` domain, so toggling `export` on the
authored declaration changes neither the helper's content identity nor the
spliced bytes. No paths and no graph encoding enter identity. Helper-free
operations keep the exact v1 encoding, so every pre-existing implementation
hash regenerates byte-identically, and invalidation is exactly
per-operation: a helper edit re-hashes only the operations whose reachable
subsets contain it. The implementation-hash recompute cascade and the
generation-time registry conformance gate this identity sits under are
pinned by LLP 0131.

### What remains excluded

Multi-file bounded imports (LLP 0118 option 1 proper, gated on measured
pressure — LLP 0118 open question 6), hermetic package closures (LLP 0118
open question 8), group-bundle emission (superseded under the
fresh-per-invocation lifecycle; re-motivated only if pooling returns under
LLP 0009's stated condition), and any enforcement of declared reads/writes
as ceilings. The invariants are unchanged: closed content-addressed graph,
no `Function.prototype.toString()` authority, no runtime capture inference,
no ambient checkout access.

## Declared application refusals

*(2026-08-01, normative.)* Every handler-raised semantic refusal previously collapsed to the single
generic code `SNAPBACK_HANDLER_FAILED`: a stale-revision conflict, a consumed
invite, and a validation error were indistinguishable, and the acceptance
clients in two independent bakeoffs had to key their reconciliation branches
on message prose (LLP 0137 A3 f3; `issues/closed/20260801-0137-a3-no-structured-app-refusal-codes.md`).
Host refusals are an exemplary coded vocabulary; app semantics had none.

The channel is **declared**, because a thrown code cannot type itself. LLP
0053's pinned rule stands unchanged — a thrown object, returned envelope,
adapter string, or forged `{code: …}` is untyped — so the declaration, not
the throw, is what admits a code:

- **Authoring.** A function declares a closed set: `refusals: ['STALE_MOVE',
  'INVITE_CONSUMED']`. Codegen validates the vocabulary (1–64 characters,
  `A-Z0-9_`, no duplicates, at most 64 per function) and refuses the reserved
  `SNAPBACK_` prefix, so an app code can never be confused with a platform
  diagnostic on any surface that renders both. The manifest carries the set
  (`FunctionDefinition.refusals`) and manifest load re-validates it.
- **Raising.** `ctx.refuse(code, details?)` throws a branded error whose
  claimed app code and JSON-safe details ride the completion envelope beside
  the platform code `SNAPBACK_APP_REFUSAL`.
- **Admission.** The host admits the claim only when the invoked function
  declared that code, and folds anything else — undeclared, forged, or a
  bare `SNAPBACK_APP_REFUSAL` claim with no app code — to
  `SNAPBACK_HANDLER_FAILED`, **dropping the app payload with it**. The
  declaration set is carried host-side from the prepared invocation and is
  empty by default, so any path that does not deliberately carry it folds
  every claim: fail-closed by construction.
  As built, the local host performs this after the Ibex/workerd executor
  join, while Cloudflare admits against the exact deploy-time function
  definition selected for the invocation. The LLP 0048 conformance corpus
  pins the declared/undeclared/bare-claim triad on all three serving
  surfaces (LLP 0144 floor repair).
- **Surface.** The refusal arrives as the platform code
  `SNAPBACK_APP_REFUSAL` with `appCode` and `appDetails` in its diagnostic
  details — a namespaced field beside the platform code, never replacing it,
  and never able to mask a `SNAPBACK_*` denial. Both envelope decoders (Rust
  `handler_envelope_code`, JS `envelope.mjs`) treat it identically.

Host denials are unaffected: they stay terminal, unmaskable, and outside this
channel. A declared refusal is an ordinary handler failure for effect
purposes — a refusing mutation commits nothing, exactly as before.

**Deliberately deferred**, and not implied by this channel: retry and
quarantine dispositions for declared refusals (they participate in none
today); i18n or user-facing message contracts (`appDetails` is app-owned
JSON); a platform-wide refusal taxonomy; and refusal declarations
participating in result-contract hashes.

## LLP 0135 acceptance fold — 2026-08-02

The JS-mutation manifest gains the per-kind `sequences` member, defaulting to
the empty list. Sequence declarations participate in generation-time
admission and authorize `ctx.sequence.allocate` only through LLP 0135's
scope-visibility rule. The implementation-identity ordered field set gains
`sequences` as a versioned extension with golden vectors over the extended
preimage; an implementation must not reinterpret the frozen v1 hash. The
harness exposes `ctx.sequence.allocate` only to an invocation prepared with
that declaration. These accepted contracts do not assert the surface is
implemented; LLP 0135's acceptance corpus and artifact regeneration gate the
landing.

## Schema references and typed-interior checking — 2026-08-02

The LLP 0127 Move-1 result-side reference and LLP 0115 CV-17 pilot are
implemented as consumers of the authority this Spec already defines, not as
new inference authorities.

`v.doc(table)` is admitted only at result-contract positions. Its authored
marker carries app authority plus the table name, and codegen immediately
resolves it against the loaded schema manifest to the same closed document
object used by `results.documents(table)`. A top-level
`results.records(v.doc(table))` normalizes to the existing documents
descriptor and therefore preserves its exact `resultContractHash`; a nested
reference embeds that same structural object. No app-reference node reaches
the deployed contract grammar. Unknown tables refuse generation, using the
reference in arguments or stored schema fields is outside the admitted
grammar, and any schema-field evolution regenerates a different expanded
contract and hash rather than leaving a stale reference.

Generated handler interiors follow the same one-way flow. `GeneratedHandler`,
the read-only versus read-write `ctx.db` interfaces, helper-boundary database
types, and result types are projections of the schema manifest, function
manifest, and effective result contract. A TypeScript/checkJs diagnostic is
therefore evidence that authored handler code disagrees with an already
declared contract. It does **not** inspect handler behavior to invent, widen,
or replace that contract; omission remains the explicit degraded `unknown`
case specified above. The A2 improvement-sweep proof and
`schema-reference-type-flow.test.mjs` pin this direction, including authority
nullability and the query-write capability refusal. Implementation commit
`d9ebc2b1` carries the codegen, A2, guide, and proof corpus for this amendment.

## Tracked refusal opt-in

*(2026-08-02, normative; LLP 0156 D-05.)* Declaring an application refusal
continues to type its admission and nothing more. An author may separately opt
an admitted code into error issue tracking with
`trackedRefusals: ['STALE_MOVE']`. This opt-in has the following closed
contract:

- `trackedRefusals` is an additive per-function manifest field, omitted when
  empty. It is a unique subset of that same function's `refusals`; it cannot
  admit a code, widen the app namespace, or name a platform `SNAPBACK_*` code.
- The JavaScript builder, defensive codegen pass, and Rust manifest loader all
  enforce the subset. Codegen reports `FUNCTION_TRACKED_REFUSAL_INVALID`;
  manifest load reports `SNAPBACK_FUNCTION_TRACKED_REFUSAL_INVALID`.
- Preparation copies both the full declaration set and the tracked subset into
  the immutable invocation authority. Later emission may therefore classify an
  already admitted `appCode` without reopening mutable manifest state.
- Neither `refusals` nor `trackedRefusals` is added to
  `PublicFunctionDefinition` or provider introspection. They are authoring and
  invocation authority, not a public application API projection.

Omission means no application refusal is issue-eligible. This amendment does
not change `ctx.refuse` admission, effect semantics, result-contract or
implementation hashes, retries, quarantine, or the generic treatment of an
undeclared or forged claim.

## Dev-time declaration suggestions — 2026-08-12

<!-- @ref LLP 0245#d2-result-contracts-are-the-first-authoritative-candidate-class -->
Dev-time authoring assistance may derive candidate declarations from closed
TypeScript evidence and present them for explicit author acceptance. The
frozen committed declaration remains the sole authority: suggestion evidence,
confidence, provenance, and apply receipts gain no runtime authority. Omission
and unresolved evidence remain fail-closed exactly as this Spec requires.
