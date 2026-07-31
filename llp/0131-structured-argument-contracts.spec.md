# LLP 0131: Structured argument contracts

**Type:** Spec
**Status:** Draft
**Systems:** Authoring, Code generation, Runtime, Application data API, Search, Client integration, Contract, Testing
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-07-31
**Revised:** 2026-07-31 (v0.2, round-1 dual-family review fixes — identity
section rebuilt on code truth with the full consumer cascade and migration
design; Rust load-time recomputation decided; capability posture made
app-wide; RFC 6901 pointers; search diagnostic precedence decided with a
dated LLP 0073 amendment plan; `SchemaRef` renamed `PlatformSchemaRef`;
three-lane replay taxonomy; degraded-args diagnostic deferred; acceptance
completed)
**Related:** LLP 0004, LLP 0037, LLP 0051, LLP 0070, LLP 0073, LLP 0093, LLP 0108, LLP 0115, LLP 0117, LLP 0127, LLP 0130

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
positions (`packages/snapback-codegen/index.mjs:3300`, map at 3309) and a
disjoint recursive grammar for `results.*` contracts — was the bug, not a
feature (LLP 0117 finding 3; 0127 move 1). This Spec merges the lanes at
argument positions:

**Admitted at function-argument boundaries** (query, live query, mutation,
action — the one gate applied at index.mjs:1242): the full LLP 0108
recursive v1 value vocabulary, with identical spellings, bounds, and
rules — `v.null()`, `v.boolean()`, `v.string({maxBytes})`,
`v.integer({min,max})`, `v.finiteReal({min,max})`, `v.principal()`,
`v.id(table)`, `v.literal(jsonScalar)`, `v.object(fields)`,
`v.optional(validator)`, `v.array(validator,{maxItems})`,
`v.union([variants])`, and `v.json({maxDepth,maxBytes})` — plus the
existing argument-lane spellings (`v.real()`, `v.number()`, relation
incarnations), which remain valid. Bounds are LLP 0108's: depth 16, 128
object fields per contract, 8 union variants with the same syntactic
disjointness rule, 1,024 array elements, 1 MiB per string/JSON value;
omitted bounds take the profile maxima, authored bounds may only narrow.
At an ingress boundary strict JSON admits no non-finite numbers, so
`v.real()` and `v.finiteReal()` have identical runtime semantics; both
spellings stay, and codegen normalizes both to the one `finiteReal`
descriptor node (§The argument-contract descriptor, frozen form).

**Unchanged positions.** Schema fields, ephemeral scope/value shapes, and
the legacy `result` validator position keep the current closed primitive
map and their existing refusal codes — `SCHEMA_INVALID_VALIDATOR` for
schema fields, `EPHEMERAL_INVALID_VALIDATOR` for ephemeral scope/value
shapes (index.mjs:2608, 2615), `FUNCTION_INVALID_VALIDATOR` for the
legacy `result` position. Widening them is CV-4b's and later work. The
gate stays one recursive function with a per-position grammar parameter;
the builders' dead `resultOnly` metadata — carried by five builders:
`finiteReal`, `null`, `literal`, `array`, `union`
(`packages/snapback-codegen/define.mjs:228,239,249,273,282`; no readers
repo-wide, verified in LLP 0117) — is deleted from all five rather than
becoming load-bearing. That deletion would silently churn today's v1
witness for every function whose args touch those builders, which is one
of the re-key's grounds (§Identity and hashing).

**Host-plan interaction.** Host-plan value expressions already receive
structured JSON — `ValueExpr::Args` yields the whole args object and
`ValueExpr::Arg` path lookups yield whatever JSON sits at the path
(`src/value_expr.rs:121–128`) — so admission changes no reference shape.
V1 leaves operator and comparison semantics unchanged: a plan position
that compares must still resolve to a scalar leaf, and a comparison
against a non-scalar keeps its existing plan-time/runtime refusals. Any
structured-leaf operator (e.g. array membership) is future work under its
owning documents.

## The argument-contract descriptor

Today the carried descriptor and the hashed form are different objects.
The per-function argument projection is bounds-blind: the descriptor
(`packages/snapback-codegen/index.mjs:3354–3373`) records only
`shape`/`name`/`optional` and drops every authored bound. The
`argsContractHash` witness is computed over something else — the raw
authored builder objects (`def?.args`, index.mjs:1942; domain prefix
`snapback:function-args:v1`, result-contracts.mjs:38), whose validator
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

**Frozen form and normalization.** `FunctionArgsContractV1` is a
Rust-owned serde type with one frozen JSON representation, exactly as
`FunctionResultContract` is; the JS generator emits it and the committed
manifest JSON Schema gates the shape. Normalization rules, normative:
legacy spellings are aliases into the node vocabulary, never additional
descriptor node kinds — `v.real()` and `v.number()` emit the
`finiteReal` node, relation incarnations emit their underlying
`id(table)` node; optionality is a field-entry property (each
declaration-ordered entry names `name`, `optional`, and its value node),
not a wrapper node; every bound is carried explicitly, with authored
omission materialized as the profile maximum it means, mirroring the
result contract's representation (`ResultValueContract::String {
max_bytes }` et al., `src/result_contract.rs`). The descriptor format
name stays `FunctionArgsContractV1` — the first frozen carrier shape —
while the hash domain says v2 because it counts witness generations: the
v1 generation's preimage was the raw builder spelling (§Identity and
hashing).

**One new node kind: `PlatformSchemaRef`.**
`PlatformSchemaRef { authority: "platform", schema }` names an entry in
a closed, platform-owned registry of exported Rust-owned schemas. The
explicit `authority` field is a closed enum with exactly one admitted
value in v1; it exists so a future app-schema reference (option E) is a
distinct authority class with its own semantics — digest-carrying
identity whose hash churns visibly on app-schema evolution — rather
than a silent reinterpretation of this node. Hash-by-reference-id
(§Identity and hashing) is a property of the `platform` authority
class, whose ids are version-pinned by LLP 0073's version-binding rule;
it is not a property of the node kind. The registry maps each id to
both its exported artifact definition and its runtime validator; a
manifest naming an id the host does not carry, or a registry entry
whose artifact and validator disagree, refuses at manifest load
(§Identity and hashing, load-time recomputation). V1's registry has
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
`src/handler_wire.rs` as pre-serialized JSON text (`args_json`,
handler_wire.rs:93–96) and no per-invocation shape check runs in the Rust
host for declared `v.*` args — the single exception is the search plan's
special-cased serde parse (`src/search/sqlite.rs:1625`), which is
fail-closed but path-blind and covers only search. This Spec generalizes
that exception into one seam:

- **Entry.** `validate_function_args(function, args)` runs in the Rust
  host on every fresh invocation admission lane — direct function run,
  server query/mutation/action requests, live subscribe argument binding,
  search invocation, offline-outbox replay (a queued client mutation
  arrives as a fresh server mutation request and validates as one —
  replay lane 1 below), and scheduled-work admission at enqueue time
  (execution-time posture is LLP 0070's; open question 5) — before
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
  budget 65,536 (`src/result_contract.rs:15–17` constants, shared or
  mirrored), per-value byte bounds from the grammar, and a complete-args
  ceiling proposed at 1 MiB (profile maximum), admitted only through the
  preregistered hot-path benchmark gate of open question 3. Transports
  may bound lower — the 64 KiB live-socket frame cap at
  `src/server.rs:5882` already does; the per-transport divergence is
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
  3. **Durable jobs validate at enqueue.** `ctx.jobs.enqueue` validates
     the canonical argument bytes at enqueue time, inside the enclosing
     transaction (LLP 0070 already requires canonical validator-checked
     argument bytes and their digest). Retry and successor/operator
     replay posture — trusting the immutable validated bytes versus
     revalidating migrated args under a newly admitted artifact — is
     LLP 0070's call, recorded here as an interface (open question 5).
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
interfaces (index.mjs:5899–5908), the client package's independently
hand-authored typings (`packages/snapback-client/index.d.mts:145`), and
the Rust parser that owns the grammar (`src/search/types.rs:183–213`,
already deriving `JsonSchema`, with `deny_unknown_fields`). CV-5 closes
this as the first conformance fixture for the extended descriptor:

1. **Export.** `src/schema_export.rs` gains
   `search.request.schema.json`, generated from `SearchRequestV1` (whose
   definitions embed `SearchQueryAstV1` and the clause/atom types)
   through the existing single-generator lane, so the committed artifact
   is drift-gated by `tests/artifact_schemas_v0.rs` like every other
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
the raw authored builder objects (`def?.args`, index.mjs:1942, domain
`snapback:function-args:v1`) — a preimage that includes authored bounds
(`resultOptions.min`/`max`/`maxBytes`) and internal builder metadata
(`fieldType`, `resultKind`, `resultOnly`) — while the manifest carries
the bounds-blind `shape`/`name`/`optional` descriptor
(index.mjs:3354–3373). Two consequences ground the re-key:

- **The witness is unrecomputable.** Carrier and preimage are different
  objects; no consumer holding the carried descriptor can recompute or
  verify the hash. That is why the Rust host can only format-gate it.
- **The preimage is an unstable internal spelling.** This Spec's own
  mandated deletion of the dead `resultOnly` metadata (§One argument
  grammar) would silently churn v1 hashes for every function whose args
  touch the five builders carrying it — identity drift with zero
  contract change. A witness hashed over an internal spelling moves
  whenever the builders are refactored.

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
`src/manifest.rs:1546–1565`) — necessarily, since nothing carried could
reproduce the preimage. With the descriptor as preimage, the governing
precedent is the result side: the host already recomputes
`resultContractHash` from the carried contract and exact-compares,
refusing `SNAPBACK_FUNCTION_CONTRACT_HASH_INVALID` on mismatch
(`manifest.rs:1566–1594`). The v2 args witness gets the same treatment:
at manifest load the host recomputes the hash from the carried
`FunctionArgsContractV1` and exact-compares. A v2 hash without a
descriptor, an unknown node kind, an unknown `PlatformSchemaRef`
registry id, a registry entry whose exported artifact and runtime
validator disagree, or a descriptor/hash mismatch refuses before
activation under the same code. Rationale for recompute over
format-gate: format-gating alone would permit descriptor/hash
disagreement — corrupting both diagnostics (which name the hash) and
implementation identity (which incorporates it); the result-side
precedent already carries the code path and refusal code; and the
marginal cost is one canonicalization per function at manifest
admission, not per invocation.

**The re-key cascade (complete consumer inventory).** The v1 hash has
four verified consumers; each gets a normative migration rule:

1. **`implementationHash` rotates too.** `implementationIdentity`
   incorporates `argsContractHash` (index.mjs:4170) and is hashed into
   `implementationHash` (index.mjs:4187–4189). This Spec keeps the feed
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
   skew refusal.** The client hard-pins the v1 search-request digest
   and compares per call, today throwing a plain `TypeError` on
   mismatch (snapback-client/index.mjs:147, compared at 167). The pin
   is hit twice — by the re-key and by CV-5's own
   `v.json()`→`PlatformSchemaRef` descriptor change. Normative: the
   pinned constant becomes a generated artifact emitted from the same
   descriptor pipeline (regenerate, never hand-keep), with a
   conformance test asserting it equals the codegen-computed hash of
   `defineSearchQuery`'s contract; the landing ships a lockstep
   `snapback-client` release; and version skew refuses with the coded
   diagnostic `SNAPBACK_SEARCH_REFERENCE_INVALID` (§Diagnostics) whose
   message names the expected and carried contract generations — an
   old client against v2 artifacts (or the reverse) gets a legible
   "upgrade the client / regenerate references" refusal, never an
   uncoded `TypeError`.
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
| `SNAPBACK_FUNCTION_CONTRACT_HASH_INVALID` | runtime, load | existing code, extended: also fires for v2 args recomputation mismatch, missing descriptor beside a v2 hash, unknown node kind, unknown or inconsistent `PlatformSchemaRef` registry entry (§Identity and hashing) |
| `SNAPBACK_SEARCH_QUERY_INVALID` | runtime | unchanged public code for search *grammar* refusals — the `PlatformSchemaRef`-delegated `query` argument surfaces under this code, now carrying the bounded pointer; scalar-arg refusals migrate to the generic code (precedence rule below; Appendix B) |
| `SNAPBACK_SEARCH_REFERENCE_INVALID` | client | new; coded refusal replacing `client.search()`'s uncoded `TypeError` — reference-shape and contract-generation (version-skew) mismatches, naming expected vs. carried generations (§Identity and hashing, cascade item 2) |

**Seam-vs-owner precedence (decided).** The rule is node-scoped, not
function-scoped. A `PlatformSchemaRef` node's violations surface under
the owning parser's stable public code — for search,
`SNAPBACK_SEARCH_QUERY_INVALID` — now carrying the bounded pointer the
seam adds; the delegation rule and the diagnostic rule are the same
rule. Every non-reference node refuses with
`SNAPBACK_FUNCTION_ARGS_CONTRACT_VIOLATION` uniformly, search functions
included. Consequence, named and accepted: an out-of-range `limit` or
oversized `after` refuses today with `SNAPBACK_SEARCH_QUERY_INVALID`
(`src/search/sqlite.rs:1631–1636`); under the seam those scalar
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
(provider-introspection.mjs:619–627). Any args-specific authoring
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
6. **Drift gates.** `search.request.schema.json` regenerates
   byte-identically in the existing schema drift test; the args-contract
   witness has a committed fixture whose hash changes when (and only
   when) a bound or node in the canonical descriptor changes.
7. **Descriptor round trip and tampering.** A node-by-node corpus —
   every node kind, every legacy-alias normalization, every bound,
   golden canonical-form vectors including finite-real bounds and
   numeric literals — round-trips through JS generation, the committed
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
    passes end-to-end; a mixed-generation pair refuses coded —
    `SNAPBACK_SEARCH_REFERENCE_INVALID` for the search pin,
    `SNAPBACK_REACT_REFERENCE_INVALID` for react references — never an
    uncoded `TypeError`; the generated search pin equals the
    codegen-computed hash of `defineSearchQuery`'s contract.
12. **Hot-path budget.** A preregistered benchmark on the hot mutation
    path (scalar-args and structured-args profiles) with its threshold
    recorded before implementation; the 1 MiB ceiling is admitted only
    if the gate passes, else open question 3's fallback applies.
13. **Diagnostic stability rows.** Expected code per lane is pinned in
    fixtures: generic code for every non-reference node (search's
    scalar args included, post-amendment — the recorded 0073
    consequence), the owning parser's stable code for
    `PlatformSchemaRef`-delegated refusals, each carrying the bounded
    pointer.

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
> (src/value_expr.rs:121–128). What is scalar is comparison semantics
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

## Open questions

Adjudicated in this Spec's review loop (LLP 0115 v0.6 open question 8
places them here, outside the ten author-adjudicated decisions):

1. **One grammar vs. subset (0117 OQ1).** This Spec answers normatively:
   one grammar, full LLP 0108 vocabulary at argument positions. A
   reviewer arguing for a subset must name the node to exclude and the
   evidence it protects.
2. **Option E placement (0117 OQ2).** Proposed: app-visible
   schema-referencing spellings (`v.doc(...)`-class) land as a dated v2
   section of this Spec after v1 ships, reusing the `PlatformSchemaRef`
   machinery through a new authority class with digest-carrying identity
   and visible hash churn on app-schema evolution (§descriptor), with a
   dated LLP 0108 cross-amendment for result-side use. Open until this
   loop closes; nothing in v1 depends on the answer.
3. **Ingress cost budget (0117 OQ3).** The 1 MiB complete-args ceiling
   is admitted only through a preregistered hot-mutation-path benchmark
   with a fixed, pre-recorded threshold and a stated fallback ceiling if
   the gate fails (acceptance 12); the capability-id half is answered
   (`args_contract_v1`). The adjudication must also record the
   per-transport divergence: the 64 KiB live-socket frame cap
   (`src/server.rs:5882`) means a contract admitting a payload larger
   than one frame binds over HTTP but fails the live socket with a
   transport error, not the args-contract code. Proposed mitigation: a
   codegen advisory when a live-query function's maximum declared args
   payload exceeds the frame budget.
4. **Structured-leaf plan operators.** Does any host-plan operator need
   array/membership semantics over structured args in the near term, or
   does scalar-leaf comparison hold until CV-4b?
5. **Scheduled-execution revalidation.** Enqueue-time validation is
   specified here (replay lane 3); whether execution and retry trust
   the immutable enqueue-validated bytes, and whether successor or
   operator replay revalidates migrated args under the newly admitted
   artifact, is LLP 0070's call, recorded here as an interface.
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
completed. A round-2 delta review follows; the loop should adjudicate
open questions 1–3 before implementation starts; acceptance criteria
are §Acceptance verbatim.
