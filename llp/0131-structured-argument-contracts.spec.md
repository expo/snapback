# LLP 0131: Structured argument contracts

**Type:** Spec
**Status:** Accepted
**Systems:** Authoring, Code generation, Runtime, Application data API, Search, Client integration, Contract, Testing
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-07-31
**Revised:** 2026-08-10 (recorded the fail-closed option-collision boundary:
a search `resourceArg` owns its namesake client option, so `userId` cannot also
carry dev-mode per-call authority; use session custody or rename and regenerate).
2026-08-09 (typed-search selector correction: generated search
references now carry the unchanged SearchRequestV1 witness separately from
the complete operation args witness, so membership `resourceArg` additions do
not look like client/codegen generation skew; the qualified publication gate
composes both variants through the shipped wrapper). 2026-08-02 (Option-E placement executed without reopening the
argument grammar: the distinct app-authority `v.doc(table)` marker is admitted
only in result contracts, expands before hashing to LLP 0108's existing
structural document contract, and refuses at argument/stored-field positions).
2026-07-31 (implementation record and rulings — the wave-1
lane C6/C2 landing recorded as this document's closing dated amendment:
the Rust search-grammar narrowing blessed, explicit-null optionals ruled
to the canonical-form projection, the `allowExtra` load-gate mechanism
and the minted `SNAPBACK_FUNCTION_ARGS_CONTRACT_INVALID` code recorded,
the reverse-pairing claim narrowed to descriptor-present enforcement,
acceptance rows 8/9/12/13/14 evidence recorded, and drifted code cites
refreshed; Status stays Accepted)
2026-07-31 (ACCEPTED under LLP 0130 SD-4's standing
authorization: dual-family READY — Fable round 3 fix-verification,
Codex round 4, the round-3 literal(null) claim retracted by its own
family after empirical refutation — with the three conditions checked
and satisfied: (1) zero unresolved MATERIAL concerns in either
family's final round (the round-4 MINOR wording item on acceptance 14
is folded into this same landing: a conforming migrated-args
successor enqueues as its own fresh admission); (2) within the decided
scope of its commission (0115 CV-4a+CV-5; OQ1-OQ3 adjudicated in-loop,
OQ5 closed v0.4); (3) no evidence boundary weakened — the ingress seam
is strictly additive and the identity re-key is visible-once with its
consumer cascade specified. Recorded per SD-4's honesty rule: the
author's standing acceptance made in advance. Review artifacts:
reviews/0131-structured-argument-contracts.{fable,codex}.md.) 2026-07-31 (v0.4, round-3 fixes — successor-admission rule
corrected against LLP 0070: every new successor job, verbatim-copy or
migrated-args, operator-initiated or automatic, validates at its own
enqueue against the then-current admitted artifact's contract, and only
execution/retry attempts of the original immutable job inherit its
enqueue-time validation (replay lane 3, Appendix C, acceptance 14, open
question 5); the round-3 `v.literal(null)` reachability claim
re-verified empirically and narrowed — it clears the argument gate's
primitive map but refuses on the object-fields requirement, so
`resultOnly` churn stays scoped to `v.finiteReal`; two cites the v0.3
sweep missed refreshed: client search pin, 0108 formula)
**Related:** LLP 0004, LLP 0037, LLP 0051, LLP 0070, LLP 0073, LLP 0093, LLP 0108, LLP 0110, LLP 0115, LLP 0117, LLP 0127, LLP 0130

## Summary

Function arguments get the same contract treatment results already have.
One declared-contract grammar spans argument and result positions;
`v.array`, `v.union`, and the other result-only spellings become valid at
function-argument boundaries; every fresh invocation of a v2-generated
app is validated server-side against its function's argument contract
before any handler code or plan step runs, refusing with a
pointer-carrying diagnostic (v2-generated apps require `args_contract_v1`
app-wide, so incapable targets refuse deployment rather than skipping the
seam); and the platform's own worst offender — the search query authored
as `v.json()` — becomes the first conformance fixture: a reference to one
exported,
drift-gated, Rust-owned search request schema carried through the
argument-contract descriptor, the provider projection, and the generated
client types.

This is LLP 0115's CV-4a plus CV-5 first slice (0127 move 1, "contracts
reference; nothing respells"), commissioned as a new owned Spec with a
dated LLP 0004 alignment per 0115 open question 1. The ingress seam is an
evidence *addition*: today no server-side per-invocation argument-shape
validation exists even for scalars (LLP 0117 finding 4, code-verified).

## Commission, ownership, and scope

- **Commissioned by:** LLP 0115 CV-4a ("new Spec + 0004 alignment") and
  CV-5 (re-scoped v0.3), sequenced by LLP 0127 move 1's first slice, under
  the author-approved wave-1 program. LLP 0130 SD-4's standing acceptance
  rule applies to this document's review loop.
- **Owns:** the merged validator grammar at argument positions, the
  argument-contract descriptor and its identity witness, the runtime
  ingress-validation seam, and the platform schema-reference node the
  search fixture rides.
- **Does not own:** search grammar semantics (LLP 0073; its open question
  12 on projection-carrier scope is still Open there — this Spec proposes
  the resolution and Appendix B carries the dated amendment that records
  it at acceptance), schema-export custody (LLP 0037), result contracts
  (LLP 0108), scheduled-execution semantics (LLP 0070), the client wire
  protocol (LLP 0093).
- **Analysis layer:** LLP 0117 §Option A, §CV-5, findings 3–4, and open
  questions 1–3 are this Spec's reviewed evidence base; nothing below
  re-derives what that document verified on current main.

## Goals and non-goals

V1 must:

- express Split Ledger's split vector as `v.array(v.object(...))` at a
  mutation boundary with no `v.json()` and no hand-written shape checks;
- validate every declared argument object server-side, per invocation,
  fail-closed, before handler dispatch — scalars included — on every
  target a v2-generated app can deploy to (the claim is capability-scoped
  honestly: codegen requires `args_contract_v1` app-wide, so an incapable
  target refuses deployment rather than silently skipping the seam —
  §Runtime ingress validation, capability posture);
- refuse invalid nested payloads with a precise bounded RFC 6901
  JSON-Pointer diagnostic that never echoes the rejected value;
- replace `defineSearchQuery`'s authored `query: v.json()` with a
  reference to one exported Rust-owned schema, and gate every carrier of
  the search AST shape against that artifact; and
- keep every projection (generated TypeScript, args JSON Schema, provider
  introspection, Contract bindings) derived from the same descriptor.

V1 does not:

- extend stored-field (schema) validators — CV-4b is a separate, larger
  design (FieldType, storage representation under LLP 0004 §Portability
  Rules and LLP 0007, index/live-matcher semantics, LLP 0081 migrations)
  and is explicitly out of scope here;
- add omission strictness for results (0115 OQ3 / LLP 0130 SD-1's frame)
  or arguments;
- add interior handler typing (0115 CV-17) or rejection unions (CV-16);
- ship an app-visible schema-referencing spelling (`v.doc(...)`-class,
  0117 option E) — see open question 2;
- infer any contract from handler source (LLP 0108's invariants hold); or
- treat client-side pre-validation as an evidence boundary — clients may
  pre-check against the args JSON Schema, but the seam that counts is the
  server's.

## One argument grammar

The two-lane structure — a closed scalar primitive map for authoring
positions (`packages/snapback-codegen/index.mjs:3314`, map at 3323) and a
disjoint recursive grammar for `results.*` contracts — was the bug, not a
feature (LLP 0117 finding 3; 0127 move 1). This Spec merges the lanes at
argument positions:

**Admitted at function-argument boundaries** (query, live query, mutation,
action — the one gate applied at index.mjs:1271–1273): the full LLP 0108
recursive v1 value vocabulary, with identical spellings, bounds, and
rules — `v.null()`, `v.boolean()`, `v.string({maxBytes})`,
`v.integer({min,max})`, `v.finiteReal({min,max})`, `v.principal()`,
`v.id(table)`, `v.literal(jsonScalar)`, `v.object(fields)`,
`v.optional(validator)`, `v.array(validator,{maxItems})`,
`v.union([variants])`, and `v.json({maxDepth,maxBytes})` — plus the
existing argument-lane spellings (`v.real()`, `v.number()`, relation
incarnations), which stay valid. Bounds are LLP 0108's: depth 16, 128
object fields per contract, 8 union variants with the same syntactic
disjointness rule, 1,024 array elements, 1 MiB per string/JSON value;
omitted bounds take the profile maxima, authored bounds may only narrow.
At an ingress boundary strict JSON admits no non-finite numbers, so
`v.real()` and `v.finiteReal()` have identical runtime semantics; both
spellings stay, and codegen normalizes both to the one `finiteReal`
descriptor node (§The argument-contract descriptor, frozen wire form).

**Unchanged positions.** Schema fields, ephemeral scope/value shapes, and
the legacy `result` validator position keep the current closed primitive
map and their existing refusal codes — `SCHEMA_INVALID_VALIDATOR` for
schema fields, `EPHEMERAL_INVALID_VALIDATOR` for ephemeral scope/value
shapes (index.mjs:2683, 2690), `FUNCTION_INVALID_VALIDATOR` for the
legacy `result` position. Widening them is CV-4b's and later work. The
gate stays one recursive function with a per-position grammar parameter;
the builders' dead `resultOnly` metadata — carried by five builders:
`finiteReal`, `null`, `literal`, `array`, `union`
(`packages/snapback-codegen/define.mjs:228,239,249,273,282`; no readers
repo-wide, verified in LLP 0117) — is deleted from all five rather than
becoming load-bearing. Reachability, re-verified empirically in round
3: of the five, only `v.finiteReal` passes today's argument gate,
through its `number`/`Real` classification (index.mjs:3326). The
round-3 review flagged `v.literal(null)` as a second admitted builder —
its `object`/`Json` classification does clear the gate's primitive map
(index.mjs:3323) — but the gate's next check requires every
`primitive: 'object'` validator to carry a `fields` object
(index.mjs:3342), which literal builders never construct, so
`v.literal(null)` refuses `FUNCTION_INVALID_VALIDATOR` ("object
validator must have a fields object"; confirmed by running `generate`
against current main). `v.null`, every other `v.literal`, `v.array`,
and `v.union` refuse at the primitive map itself, so the deletion's
immediate silent churn stays scoped to functions declaring
`v.finiteReal` args. The deeper ground is general: a witness whose
preimage is the internal builder spelling moves whenever any builder
metadata (`fieldType`, `resultKind`, `resultOnly`) is refactored
(§Identity and hashing).

**Host-plan interaction.** Host-plan value expressions already receive
structured JSON — `ValueExpr::Args` yields the whole args object and
`ValueExpr::Arg` path lookups yield whatever JSON sits at the path
(`crates/snapback/src/value_expr.rs:121–128`) — so admission changes no reference shape.
V1 leaves operator and comparison semantics unchanged: a plan position
that compares must still resolve to a scalar leaf, and a comparison
against a non-scalar keeps its existing plan-time/runtime refusals. Any
structured-leaf operator (e.g. array membership) is future work under its
owning documents.

## The argument-contract descriptor

Today the carried descriptor and the hashed form are different objects.
The per-function argument projection is bounds-blind: the descriptor
(`packages/snapback-codegen/index.mjs:3368–3387`) records only
`shape`/`name`/`optional` and drops every authored bound. The
`argsContractHash` witness is computed over something else — the raw
authored builder objects (`def?.args`, index.mjs:1956; domain prefix
`snapback:function-args:v1`, result-contracts.mjs:40), whose validator
objects do carry authored bounds (`resultOptions.min`/`max`/`maxBytes`)
plus internal builder metadata (`fieldType`, `resultKind`, `resultOnly`).
No consumer holding the carried descriptor can recompute the witness.
The extension replaces both halves:

**`FunctionArgsContractV1`** is one closed object contract over the
function's declared arguments: declaration-ordered fields, each carrying a
value node from the same node vocabulary the result manifest uses
(LLP 0108's `ResultValueV1` set — null, boolean, string, integer,
finiteReal, principal, id, literal, object, array, union, json — reused
kind-for-kind, bounds included). One node vocabulary, two contract roots
(args, result). The Rust manifest carries the args contract beside the
existing `resultContract`.

**Frozen wire form (normative, closed).** `FunctionArgsContractV1` is a
Rust-owned serde type with one frozen JSON representation, exactly as
`FunctionResultContract` is; the JS generator emits it and the committed
manifest JSON Schema gates the shape. The representation is frozen here,
not deferred to the implementation:

- **Manifest member.** `FunctionDefinition` gains `argsContract`
  (snake alias `args_contract`), carried beside the existing
  `resultContract`. Pairing mirrors the result side
  (manifest.rs:1753–1767): a v2 `argsContractHash` without
  `argsContract`, or the reverse, refuses at load under
  `SNAPBACK_FUNCTION_CONTRACT_HASH_INVALID`.
- **Root.** One JSON object with exactly one member, `fields`: the
  declaration-ordered array of argument entries. Unknown root members
  refuse (serde `deny_unknown_fields`). An empty declared root is
  `{"fields": []}` — still a closed object at ingress.
- **Entry.** Each entry is `{"name", "required", "value"}`,
  member-for-member the existing `ResultObjectFieldContract`
  (manifest.rs:3249–3253) — one entry shape for argument roots and
  `object` nodes alike. `v.optional(inner)` normalizes to
  `required: false`. This corrects v0.2's `optional` entry member: the
  frozen form mirrors the result side exactly rather than inventing a
  second entry dialect.
- **Node encoding.** Every value node is internally tagged with
  `kind`, camelCase variant names, unknown members and unknown kinds
  refused — verbatim the serde form `ResultValueContract` already has
  (`#[serde(tag = "kind", rename_all = "camelCase",
  deny_unknown_fields)]`, manifest.rs:3150–3210, code-verified).
- **Closed node table.** Members beside `kind`, exhaustive:

  | `kind` | members |
  | --- | --- |
  | `null`, `boolean`, `principal` | — |
  | `string` | `maxBytes` |
  | `integer` | `min`, `max` |
  | `finiteReal` | `min`, `max` |
  | `id` | `table` |
  | `literal` | `value` (finite JSON scalar) |
  | `json` | `maxDepth`, `maxBytes` |
  | `array` | `element` (node), `maxItems` |
  | `union` | `variants` (array of nodes) |
  | `object` | `fields` (array of entries), `allowExtra` |
  | `platformSchemaRef` | `authority`, `schema` |

  The first twelve kinds serialize byte-compatibly with
  `ResultValueContract`; `platformSchemaRef` is the one argument-lane
  addition. `allowExtra` is carried for node-type reuse and must be
  `false` at every argument position; the manifest schema gate refuses
  `true`. Every bound member is always present: authored omission
  materializes as the profile maximum it means, mirroring
  `ResultValueContract::String { max_bytes }` et al.
- **Ordering and canonicalization.** The carried JSON preserves
  declaration order in every `fields` array, and projections read it
  in that order. The witness preimage is the canonical form under LLP
  0108's rule (0108:380–381 is the result-side formula):
  `argsContractHash = "sha256:" +
  hex(sha256(UTF8("snapback:function-args:v2\n") ||
  JCS(FunctionArgsContractV1)))` — RFC 8785 JCS, lowercase hex.

**Normalization (normative).** Legacy spellings are aliases into the
node vocabulary, never additional descriptor node kinds:

- `v.real()` and `v.number()` emit the `finiteReal` node;
- `v.relationIncarnationOf(...)` emits the `string` node with the
  profile-maximum byte bound — **not** `id(parentTable)`, which v0.2
  wrongly implied. Incarnation values on the wire are host-minted
  UUIDv7 tokens (`Uuid::now_v7()`, crates/snapback/src/storage.rs:14188), not parent
  row ids, and generated TypeScript brands id nodes (`Id<Table>`,
  index.mjs:6104): an `id(parentTable)` projection would type-admit a
  genuine parent row id — semantically wrong — while rejecting a held
  incarnation token. The `string` normalization matches both today's
  projection (`{shape: 'primitive', name: 'string'}`) and today's
  runtime reality; whether a token names the active incarnation stays
  the relation machinery's runtime check (LLP 0110), exactly as
  search's semantic constraints stay with their owner. Accepted
  consequence, stated: `v.string()` and an incarnation argument are
  witness-identical — incarnation-ness lives in the schema and
  relation machinery, not the args contract. A dedicated node kind
  would be new vocabulary with its own hash churn: a v2 question, not
  v1. Acceptance 7 freezes this alias's golden;
- `v.optional(validator)` sets its entry's `required: false` — never a
  wrapper node;
- omitted authored bounds materialize as profile maxima.

The descriptor format name stays `FunctionArgsContractV1` — the first
frozen carrier shape — while the hash domain says v2 because it counts
witness generations: the v1 generation's preimage was the raw builder
spelling (§Identity and hashing).

**One new node kind: `PlatformSchemaRef`.**
`PlatformSchemaRef { authority: "platform", schema }` names an entry in
a closed, platform-owned registry of exported Rust-owned schemas. The
explicit `authority` field is a closed enum with exactly one admitted
value, permanently for this node kind: it makes the platform scope
legible on the wire and in the witness. A future app-schema reference
(option E) is a distinct node design — its own node kind carrying its
own authority value and digest-carrying identity whose hash churns
visibly on app-schema evolution (open question 2) — never a widened
enum on this node. Hash-by-reference-id (§Identity and hashing) is a
property of the `platform` authority class, whose ids are
version-pinned by LLP 0073's version-binding rule; it is not a property
of reference nodes generally. The registry is one generated Rust source
mapping each id to its exported artifact definition and its runtime
validator. Both halves derive from the same Rust type, so "the registry
pair disagrees" is not a load-time-observable fact — v0.2's load-time
refusal for it is withdrawn as unexecutable. The executable definition
of agreement is the generation-time conformance gate: (a) the committed
artifact regenerates byte-identically from the owning Rust type (the
existing schema drift lane, crates/snapback/tests/artifact_schemas_v0.rs), and (b) the
shared golden accept/reject vector corpus (§The search fixture, point
4) runs against both halves — a vector the serde parser accepts but the
exported schema rejects, or the reverse, fails CI before any manifest
carrying the reference exists. Load time refuses exactly what load can
observe: a manifest naming an id the host does not carry (§Identity and
hashing, load-time recomputation). V1's registry has
exactly one entry, `snapback:search-query-ast:v1`, resolving to the
`SearchQueryAstV1` definition inside the exported search request schema
(§The search fixture). `PlatformSchemaRef` is deliberately not an
app-authorable spelling in v1: `defineSearchQuery` constructs it
internally, and no `v.*` builder emits it. This keeps the
reference-not-respell mechanism (LLP 0117 §CV-5) in scope while leaving
app-schema references — option E, with its own hash-churn and grammar
questions — to this Spec's review loop (open question 2).

**Witness, not carrier.** `argsContractHash` becomes an identity witness
computed over the descriptor's canonical form — for the first time, since
today's witness preimage is not the carried descriptor; the descriptor
(including any `PlatformSchemaRef` node) is the carrier. The hash never
resolves a reference and no consumer may treat it as one (LLP 0115 CV-5
v0.5; 0117 §CV-5).

## Runtime ingress validation

The genuinely new evidence boundary. Today arguments cross
`crates/snapback/src/handler_wire.rs` as pre-serialized JSON text (`args_json`,
handler_wire.rs:93–96) and no per-invocation shape check runs in the Rust
host for declared `v.*` args — the single exception is the search plan's
special-cased serde parse (`crates/snapback/src/search/sqlite.rs:1625`), which is
fail-closed but path-blind and covers only search. This Spec generalizes
that exception into one seam:

- **Entry.** `validate_function_args(function, args)` runs in the Rust
  host on every fresh invocation admission lane — direct function run,
  server query/mutation/action requests, live subscribe argument binding,
  search invocation, offline-outbox replay (a queued client mutation
  arrives as a fresh server mutation request and validates as one —
  replay lane 1 below), and scheduled-work admission at enqueue time
  (execution-time posture: enqueue-validated bytes are authoritative
  for that job's own attempts; every successor job validates at its
  own enqueue — replay lane 3, decided) — before
  handler dispatch, plan execution, or any buffered write. All evaluator
  lanes (native, IR, buffered, hosted) see the same seam and the same
  corpus, mirroring LLP 0108's runtime-validation posture.
- **Semantics.** The args value is one closed JSON object: undeclared
  properties refuse, missing required (non-optional) declared properties
  refuse, and each present property validates against its node with the
  same post-JSON-image rules as result validation (structural checks
  only; no application code; deterministic across evaluators). `v.json()`
  arguments validate only the JSON budget, exactly as `Unknown` results
  do. `PlatformSchemaRef` nodes delegate to the owning Rust parser's
  deserialization — the parser stays the single authority for its
  grammar — upgraded to carry the failing JSON path instead of discarding
  the serde error, and its refusals surface under the owning parser's
  stable public code (§Diagnostics, precedence rule). The corpus is
  structural: a delegated grammar's index-specific semantic constraints
  (for search: declared fields, analyzer results, prefix limits) remain
  the owner's runtime validation, not this seam's.
- **Budget.** The result validator's discipline applies: depth 16, node
  budget 65,536 (`crates/snapback/src/result_contract.rs:15–17` constants, shared or
  mirrored), per-value byte bounds from the grammar, and a complete-args
  ceiling proposed at 1 MiB (profile maximum), admitted only through the
  preregistered numeric gate of acceptance 12 (open question 3,
  decided). Transports
  may bound lower — the 64 KiB live-socket frame cap at
  `crates/snapback/src/server.rs:6007` already does; the per-transport divergence is
  recorded under open question 3.
- **Failure.** `SNAPBACK_FUNCTION_ARGS_CONTRACT_VIOLATION`, carrying
  operation id and kind, `argsContractHash`, the failing path as a
  bounded RFC 6901 JSON Pointer under LLP 0108's diagnostic rules —
  segment/byte maxima with the `/<truncated>` suffix, unknown-key
  hashing, union first-deterministic-failure reporting — plus the
  expected node kind and the actual JSON kind as closed enums, never the
  rejected value (LLP 0108's redaction rule). Example pointer:
  `/splits/2/amountCents`. Refusal precedes every effect on the
  invocation lanes: no handler bytes execute, no plan step runs, no
  write is buffered, no settlement is created. The enqueue lane is
  narrower by construction: the *enclosing* mutation's handler has
  already run; refusal there means the enqueue call fails and no job
  exists (LLP 0070's transactional enqueue), and the enclosing
  transaction's fate is the mutation's own.
- **Replay.** Three lanes, normatively distinct:
  1. **Offline-outbox replay validates as a fresh invocation.** A
     mutation queued offline arrives at the server as a fresh mutation
     request — `function + args + environment` against fresh server
     state (LLP 0008 §Mutation Replay) — and passes ingress validation
     before handler execution, with 0008's drop-on-refusal semantics
     unchanged.
  2. **Retained-settlement release does not revalidate.** Exact replay
     of a retained mutation result under its original expected tuple
     releases the original bytes without re-running ingress validation
     and without running the handler, mirroring LLP 0108's replay
     identity posture; re-validating history against a newer contract
     would be a different (and wrong) claim.
  3. **Durable jobs validate at enqueue; enqueue-time validation is
     authoritative for that job's own attempts (decided; open
     question 5 closed, corrected in v0.4).** `ctx.jobs.enqueue`
     validates the canonical argument bytes at enqueue time, inside
     the enclosing transaction (LLP 0070 already requires canonical
     validator-checked argument bytes and their digest). Execution and
     retry attempts of that same immutable job never re-validate args
     shape: they re-execute against the retained validated bytes under
     LLP 0070's immutable-job model, even when the app's contract
     narrows between enqueue and execution — the same history posture
     as lane 2. The inheritance boundary is the job id. Every
     successor job is a new job with its own enqueue — LLP 0070's
     replay transactionally creates a fresh job id and rechecks
     current artifact admission (0070:124–131), and operator replay is
     itself successor creation that may copy canonical bytes verbatim
     — so every successor, verbatim-copy or migrated-args,
     operator-initiated or automatic, validates its argument bytes at
     its own enqueue against the then-current admitted artifact's
     contract. Identical bytes a narrowed contract no longer admits
     refuse there; a predecessor's validation authorizes nothing
     beyond that predecessor's own execution and retry attempts.
     (v0.3's verbatim-copy inheritance is withdrawn: operator replay
     can itself be a verbatim copy, and inheriting would let a
     predecessor's validation admit a new job under a possibly-
     narrowed current artifact, contradicting 0070's successor
     admission.) The rule lands in LLP 0070 as Appendix C's dated
     amendment at this Spec's acceptance; acceptance 14 pins the
     matrix.
- **Capability posture.** Targets advertise `args_contract_v1`. Every
  v2-generated app requires it app-wide: every function manifest carries
  the v2 descriptor — scalar-only functions and empty argument roots
  included (an empty root is still a closed object; undeclared
  properties refuse) — so deployment to a target without the capability
  refuses outright, the same fail-closed pattern `result_contract_v1`
  and `full_text_search_v1` use. The universal claim is scoped exactly
  there: on every target a v2-generated app can deploy to, the seam
  validates *all* declared args, scalars included — that is the
  evidence addition — and acceptance evidence is keyed on the
  capability id (answering LLP 0117 open question 3's second half).
  Default-target posture: the first-party local and hosted targets ship
  `args_contract_v1` in the same landing, so the default deployment
  path is capable from day one; for older or third-party targets the
  posture is refusal, never silent scalar-only validation. Apps
  generated before v2 keep current behavior (no seam) until
  regenerated.

## The search fixture (CV-5)

The platform's own structured input ships the degradation it diagnoses
elsewhere: `defineSearchQuery` authors `query: v.json()`
(`packages/snapback-codegen/define.mjs:778`), and four carriers describe
one host-owned grammar with nothing gating agreement — the authored
validator, the codegen-emitted `SearchQueryAstV1`/`SearchRequestV1`
interfaces (index.mjs:5942–5943), the client package's independently
hand-authored typings (`packages/snapback-client/index.d.mts:145`), and
the Rust parser that owns the grammar (`crates/snapback/src/search/types.rs:183–213`,
already deriving `JsonSchema`, with `deny_unknown_fields`). CV-5 closes
this as the first conformance fixture for the extended descriptor:

1. **Export.** `crates/snapback/src/schema_export.rs` gains
   `search.request.schema.json`, generated from `SearchRequestV1` (whose
   definitions embed `SearchQueryAstV1` and the clause/atom types)
   through the existing single-generator lane, so the committed artifact
   is drift-gated by `crates/snapback/tests/artifact_schemas_v0.rs` like every other
   Snapback-owned schema (LLP 0037's Rust-first rule; no hand-authoring).
2. **Reference.** `defineSearchQuery`'s `query` argument becomes the
   `PlatformSchemaRef { authority: "platform", schema:
   "snapback:search-query-ast:v1" }` node; `limit` and `after` keep
   their scalar validators. A generation-time check
   verifies the function's complete argument contract (query + limit +
   after) agrees with the exported request schema's top level, so "one
   exported search request schema" stays literally true.
3. **Carriers.** The provider projection and operation args JSON Schema
   carry the reference with its expansion embedded by value (operation
   schemas stay self-contained); the search argument stops projecting as
   `unknown`, and the degraded-search-argument path of
   `PROVIDER_INTROSPECTION_RESULT_TYPE_DEGRADED` no longer fires for it.
   The codegen-emitted client interfaces and the client package's public
   typings verify against the exported artifact (derivation may follow;
   0115's exit accepts either).
4. **Corpus.** One shared accepted/rejected AST fixture corpus runs
   against **all** carriers: Rust deserialization accepts/refuses; the
   exported JSON Schema validates/rejects; the expansions embedded by
   value in the provider projection and in the per-operation args JSON
   Schema validate/reject the same fixtures — an embedded copy that
   drifts is a corpus failure, not merely a no-`unknown` finding; and
   the generated plus hand-published TypeScript types accept/reject at
   compile time. A fixture disagreeing anywhere fails CI. The corpus is
   structural where it exercises serde/JSON Schema/TypeScript; search's
   index-specific semantic constraints (declared fields, analyzer
   results, prefix limits) are not representable in the generic exported
   request schema and remain LLP 0073's runtime validation.
5. **Sequencing and the 0073 recording.** This fixture exercises the
   reference lane end-to-end on a closed host-owned grammar before
   app-authored arrays and unions arrive in anger — 0115's sequencing,
   confirmed by 0117. Whether the provider projection is a byte-for-byte
   carrier or a Contract-owned surface is LLP 0073 open question 12,
   still **Open** in 0073's registry. This Spec *proposes* the
   resolution — the provider projection is a corpus-gated carrier;
   Contract bindings remain a downstream surface with explicit GAP
   behavior — and the resolution lands as a dated LLP 0073 amendment at
   this Spec's acceptance (Appendix B), with LLP 0037 the
   carrier-alignment co-owner for the exported artifact. Nothing here
   edits 0073 before then; this Spec's carrier design (reference +
   drift-gated witness artifact) supplies the mechanism either answer
   needs.

## Identity and hashing

**Code baseline (corrected in round-1 review).** Today's witness does
not hash the carried descriptor. `fn.argsContractHash` is computed over
the raw authored builder objects (`def?.args`, index.mjs:1956, domain
`snapback:function-args:v1`) — a preimage that includes authored bounds
(`resultOptions.min`/`max`/`maxBytes`) and internal builder metadata
(`fieldType`, `resultKind`, `resultOnly`) — while the carried
projection is the bounds-blind `shape`/`name`/`optional` descriptor
(index.mjs:3368–3387). Two consequences ground the re-key:

- **The witness is unrecomputable.** Carrier and preimage are different
  objects; no consumer holding the carried descriptor can recompute or
  verify the hash. That is why the Rust host can only format-gate it.
- **The preimage is an unstable internal spelling.** This Spec's own
  mandated deletion of the dead `resultOnly` metadata (§One argument
  grammar) would silently churn v1 hashes for every function declaring
  `v.finiteReal` args — the one flagged builder today's argument gate
  admits end-to-end (round-3-verified: `v.literal(null)` clears the
  primitive map but refuses on the object-fields requirement, §One
  argument grammar) — identity drift with zero contract change; and
  the same exposure holds for any refactor of the
  `fieldType`/`resultKind` metadata the preimage also carries. A
  witness hashed over an internal spelling moves whenever the builders
  are refactored.

**Re-keyed witness.** The v2 witness is computed over the canonical form
of `FunctionArgsContractV1` itself — the carried descriptor becomes the
preimage — under the new domain prefix `snapback:function-args:v2`,
replacing v1. Recomputability becomes a property: any holder of the
descriptor can verify the witness. Every function's `argsContractHash`
changes once, visibly, at adoption; the re-key turns what would
otherwise be silent churn on the first builder refactor into a single
reviewed migration event. It is a deliberate whole-function identity
migration, not "a diff" — the consumer cascade below is normative.

**Rust load-time recomputation (decided: recompute).** Today the host
only format-gates the args hash (sha256 shape check,
`crates/snapback/src/manifest.rs:1546–1565`) — necessarily, since nothing carried could
reproduce the preimage. With the descriptor as preimage, the governing
precedent is the result side: the host already recomputes
`resultContractHash` from the carried contract and exact-compares,
refusing `SNAPBACK_FUNCTION_CONTRACT_HASH_INVALID` on mismatch
(`manifest.rs:1753–1781`). The v2 args witness gets the same treatment:
at manifest load the host recomputes the hash from the carried
`FunctionArgsContractV1` and exact-compares. A v2 hash without a
descriptor, an unknown node kind, an unknown `PlatformSchemaRef`
registry id, or a descriptor/hash mismatch refuses before activation
under the same code; registry-pair agreement is the generation-time
conformance gate's property (§The argument-contract descriptor), not a
load-time claim. Rationale for recompute over
format-gate: format-gating alone would permit descriptor/hash
disagreement — corrupting both diagnostics (which name the hash) and
implementation identity (which incorporates it); the result-side
precedent already carries the code path and refusal code; and the
marginal cost is one canonicalization per function at manifest
admission, not per invocation.

**The re-key cascade (complete consumer inventory).** The v1 hash has
four verified consumers; each gets a normative migration rule:

1. **`implementationHash` rotates too.** `implementationIdentity`
   incorporates `argsContractHash` (index.mjs:4361) and is hashed into
   `implementationHash` (index.mjs:4378–4380). This Spec keeps the feed
   — the args contract is part of what an implementation *is*, and
   dropping the feed to dodge churn would blind implementation identity
   to contract changes — so every function's `implementationHash` also
   changes once at adoption. Consequences owned normatively: committed
   generated manifests and fixtures regenerate (the comparator
   fixture's pinned v1 hashes among them; acceptance 11);
   deployment-equality custody treats the re-key as a new
   implementation generation, exactly as any implementation change is
   treated; receipts and retained settlements keyed under old hashes
   remain valid history under their original identities (replay lane 2)
   and are never migrated or re-keyed.
2. **`client.search()`'s pinned digest becomes generated, with a coded
   skew refusal in the one direction new code can promise.** The
   client hard-pins the v1 search-request digest and compares per
   call, today throwing a plain `TypeError` on mismatch
   (snapback-client/index.mjs:167, compared at 187). The pin is hit
   twice — by the re-key and by CV-5's own
   `v.json()`→`PlatformSchemaRef` descriptor change. Normative: the
   pinned constant becomes a generated artifact emitted from the same
   descriptor pipeline (regenerate, never hand-keep), with a
   conformance test asserting it equals the codegen-computed hash of
   `defineSearchQuery`'s contract, and the landing ships a lockstep
   `snapback-client` release. The skew guarantee, stated per
   direction: the **v2 client** refuses any reference generation it
   does not expect — v1 references included — with the coded
   diagnostic `SNAPBACK_SEARCH_REFERENCE_INVALID` (§Diagnostics),
   naming expected and carried generations in a legible "regenerate
   references / upgrade" message. An **already-installed pre-v2
   client** is immutable code: handed v2 references, it keeps throwing
   its uncoded `TypeError`, and no new release can recode it. That
   legacy direction is a documented failure mode, and the
   lockstep-release rule carries its mitigation burden: references and
   the client move together (cascade item 3's migration rule), so the
   uncoded path exists only in an unsupported partial-upgrade state —
   fail-closed, but uncoded. v0.2's claim that both directions refuse
   coded was impossible as written and is withdrawn.
3. **React deployment identity refuses mixed generations.**
   `exactDeploymentFunction` joins implementation/args/result hashes
   (react-binding.mjs:125–133) and is equality-compared at admission
   (react-binding.mjs:248, 1095). Across the v1→v2 boundary a stale
   reference against a fresh manifest (or the reverse) refuses with
   `SNAPBACK_REACT_REFERENCE_INVALID` — fail-closed and desirable, but
   a behavior, not a diff, and it is stated as such. Migration rule:
   references and manifests move together — the codegen run that
   produces the v2 manifest produces the v2 references; partial
   adoption inside one app is not a supported state.
4. **Client store keys rotate.** `canonicalReactStoreKeyV1` embeds
   `argsContractHash` and `implementationHash` in every keyed client
   entry (canonical-client-value.mjs:225–235). At adoption every key
   rotates. Migration rule: store keys are cache identities, not
   durable data — the stated posture is cold-start; v1-keyed entries
   become unreachable and are evicted by the store's ordinary
   lifecycle, and no reader ever observes a v1-keyed entry as current.

**Canonicalization.** Hashing follows LLP 0108's rule: descriptors
retain declaration order for projections while hashes use the canonical
JSON form. The descriptor value domain includes finite reals —
`v.finiteReal({min,max})` bounds and real-valued `v.literal` — so
canonical number formatting follows LLP 0007 via LLP 0108's routing
(0108:377–380), with LLP 0051's boundary covering the
string/boolean/safe-integer remainder. The acceptance corpus freezes
golden canonical-form vectors that include finite-real bounds and
numeric literals precisely because those are the
canonicalization-sensitive cases (acceptance 7).

**References hash by id, not by artifact bytes.** A `PlatformSchemaRef`
node contributes its authority class and reference id to the canonical
form — not the referenced schema's digest. The referenced grammar is
version-pinned by LLP 0073's version-binding rule (a new operator
vocabulary is a new parser profile and a new id), and artifact-byte
drift is already gated by the schema-export drift test; embedding
generated bytes in the witness would add hash churn on formatting-only
schemars changes while witnessing nothing the drift gate does not. This
rule is scoped to the `platform` authority class; an app-schema
authority class (option E) needs digest-carrying identity with visible
churn on schema evolution and is a distinct node design (§The
argument-contract descriptor).

**Untouched and touched identities.** `resultContractHash` is
unaffected. `implementationHash` is affected — cascade item 1; v0.1's
contrary claim was false. Retained-settlement identity does not
incorporate the args witness in v1 (replay lane 2).

## Diagnostics

| Code | Phase | Meaning |
| --- | --- | --- |
| `FUNCTION_INVALID_VALIDATOR` | authoring | still the refusal for genuinely invalid argument validators; no longer fires for `v.array`/`v.union` at argument positions |
| `SCHEMA_INVALID_VALIDATOR` | authoring | unchanged; stored fields stay closed (CV-4b) |
| `EPHEMERAL_INVALID_VALIDATOR` | authoring | unchanged; ephemeral scope/value shapes stay closed (CV-4b / open question 6) |
| `SNAPBACK_FUNCTION_ARGS_CONTRACT_VIOLATION` | runtime, ingress | new; fail-closed per-invocation refusal with operation id/kind, args hash, bounded RFC 6901 pointer, expected/actual kind enums; never the value |
| `SNAPBACK_FUNCTION_CONTRACT_HASH_INVALID` | runtime, load | existing code, extended: also fires for v2 args recomputation mismatch, missing descriptor beside a v2 hash (or the reverse), unknown node kind, unknown `PlatformSchemaRef` registry id (§Identity and hashing) |
| `SNAPBACK_SEARCH_QUERY_INVALID` | runtime | unchanged public code for search *grammar* refusals — the `PlatformSchemaRef`-delegated `query` argument surfaces under this code, now carrying the bounded pointer; scalar-arg refusals migrate to the generic code (precedence rule below; Appendix B) |
| `SNAPBACK_SEARCH_REFERENCE_INVALID` | client | new; emitted by the lockstep v2 client for reference-shape and contract-generation (version-skew) mismatches, naming expected vs. carried generations; a pre-v2 installed client keeps its uncoded `TypeError` — the documented legacy mode (§Identity and hashing, cascade item 2) |
| `SNAPBACK_REACT_REFERENCE_INVALID` | client | existing code, unchanged: mixed-generation react references already refuse coded (react-binding.mjs:1090–1098); listed because acceptance 11 pins it |

**Seam-vs-owner precedence (decided).** The rule is node-scoped, not
function-scoped. A `PlatformSchemaRef` node's violations surface under
the owning parser's stable public code — for search,
`SNAPBACK_SEARCH_QUERY_INVALID` — now carrying the bounded pointer the
seam adds; the delegation rule and the diagnostic rule are the same
rule. Every non-reference node refuses with
`SNAPBACK_FUNCTION_ARGS_CONTRACT_VIOLATION` uniformly, search functions
included. Consequence, named and accepted: an out-of-range `limit` or
oversized `after` refuses today with `SNAPBACK_SEARCH_QUERY_INVALID`
(`crates/snapback/src/search/sqlite.rs:1631–1636`); under the seam those scalar
refusals move to the generic code — a change to a diagnostic LLP 0073
lists as stable, so it lands only through the dated LLP 0073 amendment
at acceptance (Appendix B). A function-classed special case keeping the
legacy code for search scalars would reintroduce exactly the
special-casing this Spec exists to remove. Path preservation through
wrapping: a delegated refusal carries the argument-position pointer
prefix (`/query`) joined with the parser-reported inner path when
available; the owner's message is wrapped, never rewritten.

**Degraded-args authoring diagnostic (deferred).** V0.1 proposed a new
`SNAPBACK_FUNCTION_ARGS_CONTRACT_DEGRADED` authoring diagnostic; the
commissioning ticket does not commission one, and its severity policy
belongs to CV-6 / LLP 0130 SD-1's frame. It is removed from this Spec's
normative scope. The `v.json()` escape is already loud today: any
`unknown`-shaped projection — a declared `v.json()` argument included —
emits the warning-severity `PROVIDER_INTROSPECTION_RESULT_TYPE_DEGRADED`
(provider-introspection.mjs:628–648). Any args-specific authoring
diagnostic, and its severity, routes to CV-6/SD-1.

## Acceptance

Falsifiable, in the LLP 0115 exit-criteria sense; each bullet is a test
that can fail:

1. **Split vector.** Split Ledger's split vector authored as
   `v.array(v.object({...}), {maxItems})` with integer bounds, no
   `v.json()`, no hand-written shape validation; generated client arg
   types match the authored shape exactly; the valid-vector invocation
   commits.
2. **Path-carrying refusal.** The same mutation invoked with a
   wrong-kind nested element refuses server-side with
   `SNAPBACK_FUNCTION_ARGS_CONTRACT_VIOLATION` naming the exact bounded
   pointer (e.g. `/splits/2/amountCents`), with no handler execution
   and no partial write observable afterward.
3. **Scalar evidence addition.** A pre-existing scalar-args function
   invoked with a wrong-kind scalar refuses at ingress on an
   `args_contract_v1` target — a refusal that demonstrably does not
   occur on current main.
4. **Closed root.** An invocation carrying an undeclared argument
   property refuses with the root-level pointer, including against an
   empty declared argument root.
5. **Search corpus.** The shared accepted/rejected AST fixtures agree
   across Rust deserialization, the exported schema, the expansions
   embedded in the provider projection and the per-operation args JSON
   Schema, codegen-emitted types, and the client package's typings; no
   `unknown` remains at the search argument boundary in generated
   `api.d.ts` or the provider projection.
6. **Drift gates and registry conformance.** `search.request.schema.json`
   regenerates byte-identically in the existing schema drift test; the
   args-contract witness has a committed fixture whose hash changes when
   (and only when) a bound or node in the canonical descriptor changes;
   and the registry conformance gate fails when the pair is made to
   disagree — a committed artifact tampered away from its Rust source,
   or a golden vector flipped on one half only, is caught at generation
   time (the executable meaning of registry-pair disagreement).
7. **Descriptor round trip and tampering.** A node-by-node corpus —
   every node kind, every legacy-alias normalization
   (`v.real()`/`v.number()`→`finiteReal`,
   `v.relationIncarnationOf`→`string` with the materialized bound, and
   the `v.string()`/incarnation witness collision asserted as
   identical), every bound, golden canonical-form vectors including
   finite-real bounds and numeric literals — round-trips through JS
   generation, the committed
   manifest JSON (schema-gated), Rust serde load, and the
   inspect/provider/Contract projections and generated references.
   Tampered-manifest negatives refuse at load with
   `SNAPBACK_FUNCTION_CONTRACT_HASH_INVALID`: descriptor edited without
   the hash, hash edited without the descriptor, v2 hash with a missing
   descriptor, unknown node kind, unknown `PlatformSchemaRef` registry
   id.
8. **Bound edges.** For each bound type — depth, node budget, array
   `maxItems`, object fields, union variants, string/JSON `maxBytes`,
   and the complete-args ceiling — an exactly-at-bound value validates
   and a one-over value refuses; union failures report deterministically
   with the bounded, redacted pointer rules of LLP 0108.
9. **Lane matrix.** The same invalid payload refuses identically, with
   the same code and pointer, across direct call, server request, live
   subscribe binding, offline-outbox replay, and durable-job enqueue,
   on every evaluator lane (native, IR, buffered, hosted); a settlement
   retained under a prior contract still releases without revalidation
   (replay lane 2).
10. **Capability refusal.** A v2-generated app containing only
    scalar-args (and empty-args) functions refuses deployment to a
    target not advertising `args_contract_v1`.
11. **Blast-radius migration.** Regenerating the committed fixtures
    (the comparator fixture included) rotates every `argsContractHash`
    and `implementationHash` exactly once, and everything compiles and
    passes end-to-end. Mixed-generation refusals are pinned per
    direction: the v2 client handed a v1 (or malformed) reference
    refuses `SNAPBACK_SEARCH_REFERENCE_INVALID`; react references
    refuse `SNAPBACK_REACT_REFERENCE_INVALID` in both directions
    (existing code, react-binding.mjs:1090–1098); the pre-v2 client's
    uncoded `TypeError` against v2 references is recorded as the
    documented legacy mode — documentation, not a gate, since shipped
    clients cannot be re-coded. The generated search pin equals the
    codegen-computed hash of `defineSearchQuery`'s contract.
12. **Hot-path budget (preregistered here, before implementation).**
    On the reference profile — release-build `snapback` host, native
    evaluator, Apple M-series-class development hardware, the host
    class LLP 0108's benchmark evidence uses — added per-invocation
    ingress-validation latency must hold: p95 ≤ 100 µs for the scalar
    profile (five scalar args) and p95 ≤ 1 ms for the structured
    profile (a 64 KiB nested object/array payload, depth ≥ 8). The
    1 MiB complete-args ceiling is admitted only if a 1 MiB payload
    additionally validates at p95 ≤ 16 ms (the same 1 ms-per-64-KiB
    budget). Fallback if a gate fails, decided now: ceiling reduction
    — the complete-args ceiling drops to the largest of
    512/256/128/64 KiB whose measured p95 meets the 1 ms-per-64-KiB
    budget, floored at 64 KiB (the live-frame cap, making transports
    uniform). A bounded-depth short-circuit is rejected outright:
    skipping validation below a depth reopens the unvalidated hole
    this Spec exists to close.
13. **Diagnostic stability rows.** Expected code per lane is pinned in
    fixtures: generic code for every non-reference node (search's
    scalar args included, post-amendment — the recorded 0073
    consequence), the owning parser's stable code for
    `PlatformSchemaRef`-delegated refusals, each carrying the bounded
    pointer.
14. **Durable-job attempt authority.** With a job enqueued under
    contract generation G and the contract narrowed before execution:
    the job executes and retries against its retained validated bytes
    with no shape revalidation; every successor creation validates at
    its own enqueue — a successor copying those bytes verbatim, a
    migrated-args successor whose payload the narrowed contract still
    rejects, and operator resubmission of the identical bytes alike
    refuse under the narrowed contract, with no successor job row
    created and the predecessor left immutable; a migrated-args
    successor whose payload conforms to the narrowed contract enqueues
    successfully as its own fresh admission; and
    an invalid payload refuses at the original enqueue with no job row
    created (replay lane 3; Appendix C).

## Appendix A — proposed LLP 0004 dated alignment

Proposed text, recorded here per the commissioning pattern; to be
appended to LLP 0004 (which already carries the 2026-07-30 pointer
section commissioning this Spec) only when this Spec is Accepted, with
the actual landing date. LLP 0004 is not edited by this document.

> ## Dated alignment: structured argument contracts (date of acceptance)
>
> LLP 0131 now owns the design the 2026-07-30 alignment deliberately
> deferred. Argument positions admit the full LLP 0108 value vocabulary
> — one grammar for arguments and results; the two-lane split is
> retired at argument boundaries. A new Rust-side ingress seam validates
> every fresh invocation's arguments against the function's declared
> contract, fail-closed with path-carrying diagnostics, before any
> handler or plan effect; this is an evidence addition, not a
> convenience. Argument contracts project through the same descriptor,
> hash witness (`snapback:function-args:v2`), and generated artifacts as
> results. A closed platform-owned `PlatformSchemaRef` node lets the
> operation contract reference exported Rust-owned schemas instead of
> respelling them; the search query AST is its first and only v1
> instance. Stored fields remain scalar-only under this RFC's
> first-slice rules; CV-4b owns that extension. App-visible schema
> references and omission strictness remain undecided and are tracked
> in LLP 0131's open questions.
>
> This alignment supersedes the 2026-07-30 pointer's deferral and
> corrects one statement in it: the value-expression IR does not
> operate over scalar argument references only — `ValueExpr::Args` and
> `ValueExpr::Arg` path lookups already carry structured JSON
> (crates/snapback/src/value_expr.rs:121–128). What is scalar is comparison semantics
> at plan positions (LLP 0131 §Host-plan interaction), so only one
> dated parent statement remains normative.

## Appendix B — proposed LLP 0073 dated amendment

Proposed text, recorded here per the same commissioning pattern as
Appendix A; to be appended to LLP 0073 (with LLP 0037 as
carrier-alignment co-owner for the exported artifact) only when this
Spec is Accepted, with the actual landing date. LLP 0073 is not edited
by this document; its open question 12 stays Open until then.

> ## Dated amendment: request-contract carriers and argument
> diagnostics (date of acceptance)
>
> LLP 0131 resolves open question 12: the provider/operation projection
> is a corpus-gated byte-for-byte carrier of the exported search
> request schema — the shared accepted/rejected fixture corpus
> validates its embedded expansion, making the Diary 0039 `unknown` a
> violated acceptance bullet, repaired by propagating the LLP
> 0037-owned exported artifact rather than by new type design. Contract
> bindings remain a downstream surface with explicit GAP behavior.
> Diagnostics: `SNAPBACK_SEARCH_QUERY_INVALID` remains the stable
> public code for query-grammar refusals and now carries the bounded
> RFC 6901 pointer; scalar request-argument refusals (`limit`, `after`)
> migrate to `SNAPBACK_FUNCTION_ARGS_CONTRACT_VIOLATION` under LLP
> 0131's node-scoped precedence rule.

## Appendix C — proposed LLP 0070 dated amendment

Proposed text, recorded per the same commissioning pattern as
Appendices A and B; to be appended to LLP 0070 only when this Spec is
Accepted, with the actual landing date. LLP 0070 is not edited by this
document.

> ## Dated amendment: argument-shape validation authority (date of
> acceptance)
>
> LLP 0131 supplies the ingress seam for `ctx.jobs.enqueue`: canonical
> argument bytes validate against the function's declared argument
> contract at enqueue time, inside the enclosing transaction, refusing
> `SNAPBACK_FUNCTION_ARGS_CONTRACT_VIOLATION` before any job row
> exists. Enqueue-time validation is authoritative for that job's own
> execution and retry attempts: they re-execute the retained validated
> bytes and never re-derive args shape. Every successor job is a fresh
> admission: replay already creates a fresh job id and rechecks
> current artifact and authorization admission under this RFC, and the
> successor's argument bytes — copied verbatim or explicitly migrated,
> operator-initiated or domain reconciliation — validate at the
> successor's own enqueue against the then-current admitted artifact's
> contract. A predecessor's enqueue-time validation authorizes only
> that predecessor's attempts, never a new job. History is never
> revalidated against a newer contract: attempts of an existing job
> are history; a successor job is not.

## Open questions

Adjudicated in this Spec's review loop (LLP 0115 v0.6 open question 8
places them here, outside the ten author-adjudicated decisions):

1. **One grammar vs. subset (0117 OQ1).** This Spec answers normatively:
   one grammar, full LLP 0108 vocabulary at argument positions. A
   reviewer arguing for a subset must name the node to exclude and the
   evidence it protects.
2. **Option E placement (0117 OQ2).** Proposed: app-visible
   schema-referencing spellings (`v.doc(...)`-class) land as a dated v2
   section of this Spec after v1 ships, as a distinct node design — an
   `AppSchemaRef`-class node kind carrying its own authority value and
   digest-carrying identity with visible hash churn on app-schema
   evolution (§descriptor). The registry-and-delegation pattern recurs;
   the `PlatformSchemaRef` node kind is not reused. A dated LLP 0108
   cross-amendment covers result-side use. Open until this loop closes;
   nothing in v1 depends on the answer.
3. **Ingress cost budget (0117 OQ3) — decided in v0.3.** The numeric
   gate and its fallback are preregistered in acceptance 12: p95 ≤
   100 µs scalar and ≤ 1 ms per 64 KiB structured on the reference
   profile, 1 MiB ceiling admitted only under the same pro-rata budget,
   ceiling reduction (never a validation short-circuit) on failure; the
   capability-id half was already answered (`args_contract_v1`). The
   recorded per-transport divergence stands: the 64 KiB live-socket
   frame cap (`crates/snapback/src/server.rs:6007`) means a contract admitting a
   payload larger than one frame binds over HTTP but fails the live
   socket with a transport error, not the args-contract code;
   mitigation stays the proposed codegen advisory when a live-query
   function's maximum declared args payload exceeds the frame budget.
   Remaining for the loop: ratifying the preregistered numbers, not
   choosing them.
4. **Structured-leaf plan operators.** Does any host-plan operator need
   array/membership semantics over structured args in the near term, or
   does scalar-leaf comparison hold until CV-4b?
5. **Scheduled-execution revalidation — closed in v0.3, corrected in
   v0.4.** Decided: enqueue-time validation is authoritative for the
   enqueued job's own execution and retry attempts, which never
   re-derive args shape. Every new successor job — verbatim-copy or
   migrated-args, operator-initiated or automatic — validates at its
   own enqueue against the then-current admitted artifact's contract
   (replay lane 3; acceptance 14). v0.3's verbatim-copy inheritance
   contradicted LLP 0070's successor admission (0070:124–131 —
   operator replay is itself successor creation that may copy bytes
   verbatim) and would have let a predecessor's validation admit a
   new job under a possibly-narrowed contract; round 3 caught it and
   it is withdrawn. The rule lands in LLP 0070 through Appendix C's
   dated amendment at acceptance.
6. **Unchanged-lane debt.** Ephemeral scope/value and legacy `result`
   positions keep the scalar map in v1; decide whether they widen with
   CV-4b or die as lanes first.

## Status

Draft. Authored 2026-07-31 as wave-1 lane D1 of the author-approved
parity program (LLP 0130 governs; SD-4 applies to this document's
acceptance). Revised to v0.2 the same day after round-1 dual-family
review (Fable NOT READY: C1–C4 material; Codex NOT READY: 8 material,
1 minor — heavy overlap): the identity section was rebuilt on code
truth with the full consumer cascade, Rust load-time recomputation and
the search diagnostic precedence were decided, `SchemaRef` became
`PlatformSchemaRef`, the replay taxonomy went normative, the
degraded-args diagnostic was deferred to CV-6/SD-1, and acceptance was
completed.

Revised to v0.3 the same day after round-2 delta review (Fable READY —
three minors, one semantically load-bearing; Codex NOT READY — round-1
items 2/6/8 unresolved plus two new MATERIALs): the descriptor wire
form is frozen as a closed schema table, with the registry's
unexecutable load-time pair comparison withdrawn in favor of the
generation-time conformance gate; open question 5 closed with the
durable-job lifetime-authority rule, Appendix C's proposed LLP 0070
amendment, and acceptance 14; the hot-path budget is preregistered
numerically with a ceiling-reduction fallback (open question 3
decided); the search version-skew guarantee is restated per direction,
documenting the pre-v2 client's uncoded `TypeError` as the legacy mode;
relation-incarnation normalization is corrected to the string node with
the witness collision accepted; option E is reconciled to a distinct
node kind; the `resultOnly` churn claim is narrowed to `v.finiteReal`
reachability; and stale code cites are refreshed against current main
(two survived that sweep and are corrected in v0.4).

Revised to v0.4 the same day after the round-3 reviews — the Codex
round-3 delta review, Round 3 of
llp/reviews/0131-structured-argument-contracts.codex.md (NOT READY,
one MATERIAL, one MINOR), and the Fable round-3 fix-verification in
llp/reviews/0131-structured-argument-contracts.fable.md (READY with
one hygiene residual). The successor rule is
corrected against LLP 0070: every new successor job — verbatim-copy or
migrated-args, operator-initiated or automatic — validates at its own
enqueue against the then-current admitted artifact's contract, and only
execution/retry attempts of the original immutable job inherit its
enqueue-time validation (replay lane 3, Appendix C, acceptance 14, open
question 5). The round-3 `v.literal(null)` reachability claim was
re-verified empirically and narrowed rather than adopted: it clears the
argument gate's primitive map (index.mjs:3323) but refuses on the
object-fields requirement (index.mjs:3342), so `resultOnly` churn
stays scoped to `v.finiteReal` (§One argument grammar). The two cites
the v0.3 sweep missed are refreshed: the client search pin moved to
snapback-client/index.mjs:167 (compared at 187) under the LLP 0129
client commits, and the 0108 result-formula cite is corrected to
0108:380–381. A focused Codex round-4 delta review follows; the loop
should adjudicate open questions 1–2 before implementation starts;
acceptance criteria are §Acceptance verbatim.

## Amendment (2026-07-31): implementation record and rulings

Wave-1 lane C6 landed this Spec's implementation on main
(`4ca67710`..`2bd3c4f9`, 2026-07-31); lane C2's enqueue seam completed
acceptance 14 the same day (`804782a1`). The implementer recorded nine
divergences and observations in
issues/20260731-0131-implementation-divergences.md. Because this document
is Accepted, they land here as one dated delta pass — recording what the
shipped code actually does where it departs from the v0.4 text, making
the two rulings the ticket requested, and refreshing drifted cites —
rather than as silent drift. Paragraphs above that say "today" describe
the pre-implementation baseline this Spec was accepted against; this
section records the landed state. All cites below are verified against
main at this amendment's date.

### Ruling 1 (item 1) — the Rust search-grammar narrowing is blessed

The implementation narrowed the search filter grammar beyond the v0.4
text: `SearchFilterOpV1` is a closed eq-only enum
(crates/snapback/src/search/types.rs:181–186) and `SearchFilterValueV1` is a closed
scalar union of string, number, and boolean (types.rs:193–199), carried
by `SearchFilterV1` (types.rs:235–241). The narrowing was not
Spec-mandated, but the fixture's carrier agreement (§The search fixture,
point 4) was impossible without it: the published typings
(packages/snapback-client/index.d.mts:145–167 — `op: 'eq'`,
`value: string | number | boolean`) were narrower than the
deserialization grammar, whose `op` was effectively open and whose
`value` was an open `serde_json::Value` refused later by semantic
validation. The accepted-query set is unchanged — non-eq operators and
non-scalar values were already refused semantically — and the refusal
moved to parse time under the same stable public code
(`SNAPBACK_SEARCH_QUERY_INVALID`, now path-carrying through
crates/snapback/src/args_contract.rs:380–425). **Ruling: blessed.** The closed enum is
the carrier-agreement mechanism this Spec's fixture exists to prove;
widening the published typings instead would have advertised a query set
the owning parser refuses. A new operator is a new parser profile and a
new reference id under LLP 0073's version-binding rule, exactly as
§Identity and hashing already requires.

### Ruling 2 (item 2) — explicit-null optionals: canonical-form projection

schemars encodes `Option<T>` as `type: ["T","null"]` not-required, so
serde and the exported search.request.schema.json admit `"limit": null`,
while derived TypeScript and the published typings spell
`limit?: number`, rejecting explicit null. The implementation codified a
canonical-form projection — an optional property whose schema is
nullable derives as an optional non-null member — in
packages/snapback-codegen/search-request-schema.mjs:22–26 (the stated
rule), 73–84 (`nullablePairType`), 115–121 (TypeScript derivation; a
required nullable property refuses derivation outright), and 153–168
(descriptor derivation). **Ruling: the canonical-form projection is the
Spec's.** The wire admits absent; the typed carriers spell `field?: T`;
explicit null is outside the cross-carrier agreed set, and the corpus
deliberately carries no explicit-null fixture because the carriers
genuinely disagree there — such a fixture would force one carrier to
lie. A future widening that admits explicit null must land as its own
dated amendment with accept fixtures on every carrier (serde parse,
exported schema, embedded expansions, generated and published
TypeScript) before any carrier advertises it.

### Item 3 — `allowExtra` refusal is enforced at manifest load, args lane

The v0.4 node table says "the manifest schema gate refuses `true`". The
generated manifest JSON Schema shares `ResultValueContract` nodes
between the args and result lanes
(schemas/functions.manifest.schema.json carries `allowExtra` as an
ordinary boolean member) and cannot express a lane-conditional
constraint. The refusal is enforced at manifest load instead: the shared
node validator runs with a lane parameter, and `ContractLane::Args`
refuses `allowExtra: true` at any argument position
(crates/snapback/src/manifest.rs:1490–1498) under
`SNAPBACK_FUNCTION_ARGS_CONTRACT_INVALID`, reached from
`validate_args_contract_definition` (manifest.rs:1558–1625) before
activation. The JS generator never emits `true` (`effectiveArgsContract`,
packages/snapback-codegen/result-contracts.mjs:57–68). Same fail-closed
effect, different mechanism; the committed schema remains the shape gate
for everything lane-unconditional.

### Item 4 — code table addendum: `SNAPBACK_FUNCTION_ARGS_CONTRACT_INVALID`

The implementation minted one code the §Diagnostics table does not
carry. Folded in as the Spec's:

| Code | Phase | Meaning |
| --- | --- | --- |
| `SNAPBACK_FUNCTION_ARGS_CONTRACT_INVALID` | runtime, load | args-lane structural defects of the carried descriptor: empty or duplicate argument entry names (crates/snapback/src/manifest.rs:1566–1572) and `allowExtra: true` at any argument position (manifest.rs:1493–1498); minted at manifest.rs:1196–1205, classified 4xx author-input (crates/snapback/src/server.rs:21866), registered in the served diagnostics inventory (server.rs:34975) |

One correction against the commissioning ticket's own record: the ticket
lists "missing-hash-beside-descriptor pairing" under this code, but the
shipped code refuses that pairing defect under the existing
`SNAPBACK_FUNCTION_CONTRACT_HASH_INVALID` row (manifest.rs:1581–1591),
exactly as the v0.4 table already records. The new code covers
descriptor structure, not identity pairing.

### Item 5 — reverse pairing narrowed to what the wire can distinguish

§The argument-contract descriptor claims "a v2 `argsContractHash`
without `argsContract`, or the reverse, refuses at load". As shipped,
the descriptor-present half is fully enforced: a descriptor without a
hash refuses (crates/snapback/src/manifest.rs:1581–1591), a descriptor/hash
recomputation mismatch refuses (manifest.rs:1592–1604), and every
carried hash is format-gated (manifest.rs:1733–1752). The reverse — a
v2 hash with no descriptor — is not enforceable: v1 and v2 hashes are
both bare `sha256:hex` on the wire, and a legacy manifest (v1 hash, no
descriptor) must keep loading (manifest.rs:1559–1563), so the reverse
refusal is indistinguishable from legacy without a generation marker in
the hash format or the manifest. The claim is narrowed accordingly:
descriptor-present pairing refuses at load; hash-without-descriptor
loads as legacy and its functions get no ingress seam — exactly the
pre-v2 behavior every legacy app already has. Introducing a generation
marker to close the residue would be its own dated change.

### Item 7 and acceptance 14 — the acceptance rows' evidence, honestly

Recorded beside §Acceptance. No row's claim is weakened, but three rows'
evidence shapes are weaker than a literal reading implies, and two rows
gained their evidence at the landing:

- **Row 8 (bound edges):** covered ad hoc, not exhaustively. Unit tests
  exercise selected bounds and refusal paths (wrong-kind nested
  elements, closed roots, missing required, integer range via search
  `limit`, union failure counts, bounded-pointer truncation —
  crates/snapback/src/args_contract.rs:543–813); an exhaustive at-bound/one-over pair
  per bound type (depth, node budget, `maxItems`, object fields, union
  variants, `maxBytes`, the complete-args ceiling) remains unwritten.
- **Row 9 (lane matrix):** the hosted-evaluator leg is
  inherited-by-construction rather than fixture-proven per lane: every
  seam call site runs host-side before any evaluator dispatch
  (crates/snapback/src/local.rs:1756, 6213, 6345, 10041, 12484, 16573), and the
  capability fact is per-target-instance (crates/snapback/src/manifest.rs:5741–5744).
- **Row 12 (hot-path budget):** the preregistered gate ran at the
  landing and admitted the 1 MiB ceiling — p95 scalar 541 ns, 64 KiB
  depth-8 structured 571 µs, ~1 MiB 703 µs (the commissioning ticket's
  record); the benchmark is pinned as the release-gated test
  `args_contract_hot_path_budget` (crates/snapback/src/args_contract.rs:823–926).
- **Row 13 (diagnostic stability rows):** exists as unit tests, not a
  per-lane pinned fixture table: the generic code for search's scalar
  args (crates/snapback/src/args_contract.rs:700–735) and the owning parser's code with
  the argument-position pointer prefix for the delegated node
  (args_contract.rs:666–698).
- **Row 14 (durable-job attempt authority):** evidenced at lane C2's
  landing (`804782a1`): `admit_job_enqueues` (crates/snapback/src/local.rs:1712) calls
  `validate_function_args` per enqueue (local.rs:1756), pre-commit,
  inside the producing mutation's transaction; violations refuse with
  the per-lane code and no job row or partial write; contract-less
  callees keep legacy behavior. Pinned by
  `enqueue_validates_callee_args_contract_transactionally`
  (crates/snapback/src/server.rs:36546) across violating, conforming, and legacy-callee
  legs.

### Item 9 — cite refresh

Line-number refreshes applied in place above where a present-tense
claim's code moved under the C6/C2/SD-6 landings: the argument gate
application (index.mjs:1253 → 1271–1273), the ephemeral refusal sites
(index.mjs:2622, 2629 → 2683, 2690), the result-side pairing precedent
(manifest.rs:1566–1580 → 1753–1767), the entry shape
(manifest.rs:3004–3008 → 3249–3253), the node serde form
(manifest.rs:2957–3000 → 3150–3210), the result recompute precedent
(manifest.rs:1566–1594 → 1753–1781), the incarnation mint
(crates/snapback/src/storage.rs:13972 → 14188), the `Id<Table>` brand
(index.mjs:5932 → 6104), the identity feed (index.mjs:4205 → 4361;
4222–4224 → 4378–4380), the live-socket frame cap
(crates/snapback/src/server.rs:5882 → 6007, both occurrences), and the
degraded-projection warning (provider-introspection.mjs:619–627 →
628–648). Re-verified unchanged: crates/snapback/src/value_expr.rs:121–128,
crates/snapback/src/handler_wire.rs:93–96, crates/snapback/src/result_contract.rs:15–17 (mirrored at
crates/snapback/src/args_contract.rs:45–47),
react-binding.mjs:125–133/248/1090–1098, canonical-client-value.mjs:
225–235, LLP 0108:377–380 and 380–381, LLP 0070:124–131.

Baseline cites are deliberately left as written — they are the recorded
pre-implementation ground this Spec was reviewed against — with their
landed replacements recorded here:

- **Two-lane gate** (index.mjs:3314, map at 3323; classification 3326;
  object-fields check 3342): the merged gate is
  `validateAuthoringValidator`
  (packages/snapback-codegen/index.mjs:3393) with a per-position grammar
  parameter — argument-lane branches at 3402–3436, the closed primitive
  map at 3437–3443, the object-fields requirement at 3456–3458. The
  round-3 reachability narrative describes the pre-merge gate: the
  merged gate admits `v.null`/`v.literal`/`v.array`/`v.union` at
  argument positions by design, and the `resultOnly` deletion landed
  with the one-time v2 re-key (zero matches remain in
  packages/snapback-codegen/define.mjs), so the churn analysis that
  metadata supported is now history.
- **Bounds-blind descriptor and raw-builder v1 witness**
  (index.mjs:3368–3387; `def?.args` at index.mjs:1956; v1 domain at
  result-contracts.mjs:40): executed as specified —
  `effectiveArgsContract` builds the carried descriptor
  (packages/snapback-codegen/result-contracts.mjs:57–68), the v2
  witness hashes its canonical form (result-contracts.mjs:43–48, domain
  at 45), both applied at index.mjs:2016–2017; the string
  `snapback:function-args:v1` no longer appears in the tree.
- **Search fixture baseline** (authored `v.json()` at define.mjs:778;
  hand-authored codegen interfaces at index.mjs:5942–5943; independent
  client typings at index.d.mts:145; parser at
  crates/snapback/src/search/types.rs:183–213): executed — `defineSearchQuery`
  (define.mjs:774) constructs the `PlatformSchemaRef` internally
  (define.mjs:759–766); every JS carrier derives from the committed
  exported schema through
  packages/snapback-codegen/search-request-schema.mjs (TypeScript lines
  spliced at index.mjs:6109, provider descriptor expansion at 3503,
  embedded operation JSON Schema at 3558); the generation-time
  top-level gate is `searchArgsSchemaProblems`
  (search-request-schema.mjs:245–280, applied at index.mjs:1348); the
  client typings (index.d.mts:145–167) carry the narrowed closed
  grammar and are corpus-verified; the grammar types span
  crates/snapback/src/search/types.rs:158–274.
- **Format-gate baseline** (manifest.rs:1546–1565): superseded — load
  recomputes the v2 witness from the carried descriptor and
  exact-compares (crates/snapback/src/manifest.rs:1592–1604); the sha256 shape gate now
  covers all three carried hashes (manifest.rs:1733–1752).
- **Search parse baseline** (path-blind parse at sqlite.rs:1625; scalar
  refusals at sqlite.rs:1631–1636): the request parse delegates through
  the shared path-carrying seam (crates/snapback/src/search/sqlite.rs:1628 →
  crates/snapback/src/args_contract.rs:389–393). The surviving legacy in-plan check is
  the `limit` range refusal (sqlite.rs:1630–1635), which pre-v2 apps
  (no descriptor) still hit under `SNAPBACK_SEARCH_QUERY_INVALID`;
  v2-descriptor apps refuse `limit`/`after` at the seam first with the
  generic code — the recorded LLP 0073 consequence, pinned at
  crates/snapback/src/args_contract.rs:700–735.
- **Client pin baseline** (hard-pinned digest at
  snapback-client/index.mjs:167, compared at 187): executed as cascade
  item 2 requires — the pin is the generated
  search-contract.generated.mjs artifact (imported at
  packages/snapback-client/index.mjs:33–35), and skew refuses the coded
  `SNAPBACK_SEARCH_REFERENCE_INVALID` (minted at index.mjs:168–180,
  compared at 211).
- **The seam itself:** crates/snapback/src/args_contract.rs — `validate_function_args`
  at 140, the mirrored budget constants at 45–47, the node-scoped
  `PlatformSchemaRef` delegation at 331–341.

This amendment closes issues/20260731-0131-implementation-divergences.md
items 1–5, 7, and 9; item 6 was closed at lane C2's landing; item 8 is
tracked residue owed elsewhere.

## Amendment (2026-08-02): Option-E app schema reference placement

Open question 2's dated-v2 placement is now executed for the result side only.
`v.doc(table)` constructs a distinct `AppSchemaRef`-class authoring marker with
`authority: 'app'`; it does not reuse the platform-owned search reference and
it is not admitted by this Spec's argument grammar. LLP 0108 remains the
result-contract owner: codegen resolves the marker against the app schema to
the existing closed structural document contract before validation, emission,
or hashing. Top-level use preserves the exact `results.documents(table)`
witness; nested use embeds the same expanded object. The app reference itself
never enters the deployed node grammar.

The evolution consequence is therefore visible and fail-closed: changing the
referenced table changes its expanded result contract and hash, while an
unknown table refuses generation. A focused fixture also pins that arguments
and stored schema fields reject `v.doc`, so this amendment neither widens the
landed CV-4a grammar nor claims CV-4b. Generated interior types consume the
expanded result/schema artifacts under LLP 0108's dated clarification; they
do not infer a contract from handler behavior. Implementation commit
`d9ebc2b1` executes this placement without changing the argument grammar.

## Amendment (2026-08-09): typed-search selector witness for resource-scoped references

The §Identity and hashing cascade item 2 assumed that a search operation's
complete `argsContractHash` was also the identity of the shared
`SearchRequestV1` grammar. LLP 0073's later membership-visibility amendment
correctly added one generated required `resourceArg` sibling beside
`{query, limit?, after?}`. That changes the complete operation contract and
therefore must change `argsContractHash`; comparing it with the plain request
pin made same-generation resource-scoped references look stale.

Generated non-live search references now carry two witnesses with distinct
roles. `argsContractHash` remains the server-validated identity of the complete
operation arguments, including `resourceArg`. `searchRequestContractHash` is
derived by the same v2 descriptor/hash pipeline over the unchanged
SearchRequestV1 fields after removing that generated sibling. Codegen also
carries `searchResourceArg` (`null` for a plain search, its declared name for a
resource-scoped search), so the flat typed wrapper forwards that required
argument without guessing from the hash. An ordinary query reference carries
neither search marker.

`client.search()` still fails closed: it requires a generated Query reference,
requires the dedicated search marker, and exact-compares that marker with its
generated same-release pin before network I/O. It does not accept a mismatched
marker and does not weaken complete-argument validation; the subsequent
ordinary `query()` path validates the full generated `argumentSchema` and
sends the full `argsContractHash`/generation as before. The lockstep-release
rule from cascade item 2 remains unchanged.

The flat options object has one fail-closed collision boundary. A generated
`searchResourceArg` owns the option with that name. When that name is `userId`,
the value is application resource data and `client.search()` must not also
interpret it as dev-mode per-call authority; the ordinary query receives no
caller `userId`. Applications needing both use session/coordinator-owned
authority, or rename the resource argument and regenerate. One scalar must
never be ambiguously treated as both resource identity and invocation
authority. The same reserved-slot rule applies to `readSet` and
`authorityCapture`.

Acceptance is one real-codegen composition test that generates both a plain
and membership `resourceArg` search reference, runs each through the shipped
typed wrapper, checks the exact transmitted arguments and the skew refusal,
and strict-typechecks required/forbidden resource options. The canonical
local proof exposes that same test as the named
`typed-search-wrapper-qualification` gate in the publication, packaging,
client, and codegen selections, satisfying LLP 0189 D-2/D-4/D-6 without a
complete-proof-at-HEAD precondition.
