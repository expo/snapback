# LLP 0131: Structured argument contracts

**Type:** Spec
**Status:** Draft
**Systems:** Authoring, Code generation, Runtime, Application data API, Search, Client integration, Contract, Testing
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-07-31
**Revised:**
**Related:** LLP 0004, LLP 0037, LLP 0051, LLP 0070, LLP 0073, LLP 0093, LLP 0108, LLP 0115, LLP 0117, LLP 0127, LLP 0130

## Summary

Function arguments get the same contract treatment results already have.
One declared-contract grammar spans argument and result positions;
`v.array`, `v.union`, and the other result-only spellings become valid at
function-argument boundaries; every fresh invocation is validated
server-side against its function's argument contract before any handler
code or plan step runs, refusing with a path-carrying diagnostic; and the
platform's own worst offender — the search query authored as `v.json()` —
becomes the first conformance fixture: a reference to one exported,
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
  12 on projection-carrier scope is resolved there), schema-export custody
  (LLP 0037), result contracts (LLP 0108), scheduled-execution semantics
  (LLP 0070), the client wire protocol (LLP 0093).
- **Analysis layer:** LLP 0117 §Option A, §CV-5, findings 3–4, and open
  questions 1–3 are this Spec's reviewed evidence base; nothing below
  re-derives what that document verified on current main.

## Goals and non-goals

V1 must:

- express Split Ledger's split vector as `v.array(v.object(...))` at a
  mutation boundary with no `v.json()` and no hand-written shape checks;
- validate every declared argument object server-side, per invocation,
  fail-closed, before handler dispatch — scalars included;
- refuse invalid nested payloads with a precise JSON-path diagnostic that
  never echoes the rejected value;
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
spellings stay, and codegen may normalize them to one descriptor node.

**Unchanged positions.** Schema fields, ephemeral scope/value shapes, and
the legacy `result` validator position keep the current closed primitive
map and their existing refusal codes (`SCHEMA_INVALID_VALIDATOR`,
`FUNCTION_INVALID_VALIDATOR`). Widening them is CV-4b's and later work.
The gate stays one recursive function with a per-position grammar
parameter; the builders' dead `resultOnly` metadata
(`packages/snapback-codegen/define.mjs:263,276`; no readers repo-wide,
verified in LLP 0117) is deleted rather than becoming load-bearing.

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

Today's per-function argument projection is bounds-blind: the descriptor
(`packages/snapback-codegen/index.mjs:3354–3373`) records only
`shape`/`name`/`optional` and drops every authored bound, and the
`argsContractHash` witness is computed over that lossy form
(result-contracts.mjs:38, domain prefix `snapback:function-args:v1`;
computed at index.mjs:1942). The extension replaces it:

**`FunctionArgsContractV1`** is one closed object contract over the
function's declared arguments: declaration-ordered fields, each carrying a
value node from the same node vocabulary the result manifest uses
(LLP 0108's `ResultValueV1` set — null, boolean, string, integer,
finiteReal, principal, id, literal, object, array, union, json — reused
kind-for-kind, bounds included). One node vocabulary, two contract roots
(args, result). The Rust manifest carries the args contract beside the
existing `resultContract`.

**One new node kind: `SchemaRef`.** `SchemaRef { schema }` names an entry
in a closed, platform-owned registry of exported Rust-owned schemas. V1's
registry has exactly one entry, `snapback:search-query-ast:v1`, resolving
to the `SearchQueryAstV1` definition inside the exported search request
schema (§The search fixture). `SchemaRef` is deliberately not an
app-authorable spelling in v1: `defineSearchQuery` constructs it
internally, and no `v.*` builder emits it. This keeps the
reference-not-respell mechanism (LLP 0117 §CV-5) in scope while leaving
app-schema references — option E, with its own hash-churn and grammar
questions — to this Spec's review loop (open question 2).

**Witness, not carrier.** `argsContractHash` remains an identity witness
computed over the descriptor's canonical form; the descriptor (including
any `SchemaRef` node) is the carrier. The hash never resolves a reference
and no consumer may treat it as one (LLP 0115 CV-5 v0.5; 0117 §CV-5).

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
  search invocation, and scheduled-work admission at enqueue time
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
  do. `SchemaRef` nodes delegate to the owning Rust parser's
  deserialization — the parser stays the single authority for its
  grammar — upgraded to carry the failing JSON path instead of discarding
  the serde error.
- **Budget.** The result validator's discipline applies: depth 16, node
  budget 65,536 (`src/result_contract.rs:15–17` constants, shared or
  mirrored), per-value byte bounds from the grammar, and a complete-args
  ceiling proposed at 1 MiB (profile maximum; transports may bound lower
  — the 64 KiB live-socket frame cap at `src/server.rs:5882` already
  does; ceiling number adjudicated in this loop, open question 3).
- **Failure.** `SNAPBACK_FUNCTION_ARGS_CONTRACT_VIOLATION`, carrying
  operation id and kind, `argsContractHash`, the JSON path (e.g.
  `$.splits[2].amountCents`), the expected node kind, and the actual JSON
  kind — never the rejected value (LLP 0108's redaction rule). Refusal
  precedes every effect: no handler bytes execute, no plan step runs, no
  write is buffered, no settlement is created.
- **Replay.** Fresh-invocation admission is the seam. Exact replay of a
  retained mutation result under its original expected tuple releases the
  original bytes without re-running ingress validation, mirroring
  LLP 0108's replay identity posture; re-validating history against a
  newer contract would be a different (and wrong) claim.
- **Capability.** Targets advertise `args_contract_v1`. An app whose
  functions declare structured or `SchemaRef` arguments refuses
  deployment to a target without it, the same fail-closed pattern
  `result_contract_v1` and `full_text_search_v1` use. On targets that do
  advertise it, the seam validates *all* declared args, scalars included
  — that is the evidence addition — and acceptance evidence is keyed on
  the capability id (answering LLP 0117 open question 3's second half).

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
   `SchemaRef { schema: "snapback:search-query-ast:v1" }` node; `limit`
   and `after` keep their scalar validators. A generation-time check
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
   against all carriers: Rust deserialization accepts/refuses, the
   exported JSON Schema validates/rejects, and the generated plus
   hand-published TypeScript types accept/reject at compile time. A
   fixture disagreeing anywhere fails CI.
5. **Sequencing.** This fixture exercises the reference lane end-to-end
   on a closed host-owned grammar before app-authored arrays and unions
   arrive in anger — 0115's sequencing, confirmed by 0117. Whether the
   provider projection is a byte-for-byte carrier or a Contract-owned
   surface is LLP 0073 open question 12, resolved there; this Spec's
   carrier design (reference + drift-gated witness artifact) supplies the
   mechanism either answer needs.

## Identity and hashing

- **Re-keyed witness.** The extended descriptor's canonical form is
  hashed under a new domain prefix, `snapback:function-args:v2`,
  replacing v1. Rationale: the v1 descriptor drops all bounds, so a
  hash-stable extension would leave the witness blind to exactly the
  facts this Spec makes contractual; and the hash currently has no
  semantic consumer — the Rust host format-gates it
  (`src/manifest.rs:1546–1565`) and the provider binding carries it
  (`binding.argsHash = fn.argsContractHash`, index.mjs:2072), but nothing
  recomputes or compares it. Every function's `argsContractHash` therefore
  changes once, visibly, at adoption — a diff, not a behavior change.
- **Canonicalization.** Hashing follows LLP 0108's rule: descriptors
  retain declaration order for projections while hashes use the canonical
  JSON form (RFC 8785-compatible on this value domain — sorted keys over
  strings, booleans, and safe integers; LLP 0051's boundary).
- **References hash by id, not by artifact bytes.** A `SchemaRef` node
  contributes its reference id to the canonical form — not the referenced
  schema's digest. The referenced grammar is version-pinned by LLP 0073's
  version-binding rule (a new operator vocabulary is a new parser profile
  and a new id), and artifact-byte drift is already gated by the
  schema-export drift test; embedding generated bytes in the witness
  would add hash churn on formatting-only schemars changes while
  witnessing nothing the drift gate does not.
- **Untouched identities.** `resultContractHash` and `implementationHash`
  are unaffected. Retained-settlement identity does not incorporate the
  args witness in v1 (replay posture above).

## Diagnostics

| Code | Phase | Meaning |
| --- | --- | --- |
| `FUNCTION_INVALID_VALIDATOR` | authoring | still the refusal for genuinely invalid argument validators; no longer fires for `v.array`/`v.union` at argument positions |
| `SCHEMA_INVALID_VALIDATOR` | authoring | unchanged; stored fields stay closed (CV-4b) |
| `SNAPBACK_FUNCTION_ARGS_CONTRACT_VIOLATION` | runtime, ingress | new; fail-closed per-invocation refusal with operation id/kind, args hash, JSON path, expected/actual kinds; never the value |
| `SNAPBACK_FUNCTION_ARGS_CONTRACT_DEGRADED` | authoring, info | new; a declared `v.json()` argument on a non-search function; the args-side analogue of the degraded-result diagnostic. Severity policy is deliberately not decided here (CV-6 / SD-1's frame) |
| `SNAPBACK_SEARCH_QUERY_INVALID` | runtime | unchanged public code for search grammar refusals; gains the path detail via the shared seam |

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
   `SNAPBACK_FUNCTION_ARGS_CONTRACT_VIOLATION` naming the exact path
   (e.g. `$.splits[2].amountCents`), with no handler execution and no
   partial write observable afterward.
3. **Scalar evidence addition.** A pre-existing scalar-args function
   invoked with a wrong-kind scalar refuses at ingress on an
   `args_contract_v1` target — a refusal that demonstrably does not
   occur on current main.
4. **Closed root.** An invocation carrying an undeclared argument
   property refuses with the root-level path.
5. **Search corpus.** The shared accepted/rejected AST fixtures agree
   across Rust deserialization, the exported schema, codegen-emitted
   types, and the client package's typings; no `unknown` remains at the
   search argument boundary in generated `api.d.ts` or the provider
   projection.
6. **Drift gates.** `search.request.schema.json` regenerates
   byte-identically in the existing schema drift test; the args-contract
   witness has a committed fixture whose hash changes when (and only
   when) a bound or node in the canonical descriptor changes.

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
> results. A closed platform-owned `SchemaRef` node lets the operation
> contract reference exported Rust-owned schemas instead of respelling
> them; the search query AST is its first and only v1 instance. Stored
> fields remain scalar-only under this RFC's first-slice rules; CV-4b
> owns that extension. App-visible schema references and omission
> strictness remain undecided and are tracked in LLP 0131's open
> questions.

## Open questions

Adjudicated in this Spec's review loop (LLP 0115 v0.6 open question 8
places them here, outside the ten author-adjudicated decisions):

1. **One grammar vs. subset (0117 OQ1).** This Spec answers normatively:
   one grammar, full LLP 0108 vocabulary at argument positions. A
   reviewer arguing for a subset must name the node to exclude and the
   evidence it protects.
2. **Option E placement (0117 OQ2).** Proposed: app-visible
   schema-referencing spellings (`v.doc(...)`-class) land as a dated v2
   section of this Spec after v1 ships, reusing the `SchemaRef`
   machinery, with a dated LLP 0108 cross-amendment for result-side use.
   Open until this loop closes; nothing in v1 depends on the answer.
3. **Ingress cost budget (0117 OQ3).** The 1 MiB complete-args ceiling
   and the per-invocation parse/validate overhead need a measured budget
   on the hot mutation path; the capability-id half is answered
   (`args_contract_v1`).
4. **Structured-leaf plan operators.** Does any host-plan operator need
   array/membership semantics over structured args in the near term, or
   does scalar-leaf comparison hold until CV-4b?
5. **Scheduled-execution revalidation.** Enqueue-time validation is
   specified here; whether execution time re-validates against the
   then-current contract (or trusts the enqueue-time witness) is
   LLP 0070's call, recorded here as an interface.
6. **Unchanged-lane debt.** Ephemeral scope/value and legacy `result`
   positions keep the scalar map in v1; decide whether they widen with
   CV-4b or die as lanes first.

## Status

Draft. Authored 2026-07-31 as wave-1 lane D1 of the author-approved
parity program (LLP 0130 governs; SD-4 applies to this document's
acceptance). The review loop should adjudicate open questions 1–3 before
implementation starts; acceptance criteria are §Acceptance verbatim.
