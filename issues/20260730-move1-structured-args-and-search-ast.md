# Move 1 first slice: structured argument validators (CV-4a) proved on the typed search AST (CV-5)

**Status:** Implemented (2026-07-31, wave-1 lane C6)
**Impact:** 4
**Urgency:** 3
**Ease:** 2
**Confidence:** 4
**Severity:** P1
**Systems:** Application data API, Authoring, Code generation, Search, Developer experience
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-30
**Related:** LLP 0127, LLP 0115, LLP 0117, LLP 0004, LLP 0073, LLP 0037, LLP 0108
**Marker:** parity-moves, move-1

LLP 0127 move 1 ("Contracts reference; nothing respells") names its first
slice as "CV-4a arguments with the extended descriptor, proved end-to-end on
the search AST (CV-5) before app-authored arrays and unions arrive — 0115's
own sequencing, confirmed by 0117," and the RFC's closing enumerates this
slice as startable today with no author decision. The gap is precise (LLP
0115 CV-4a, evidence narrowed in v0.4): nested `v.object` arguments already
work end-to-end, so the input gap is specifically arrays and unions — and no
server-side per-invocation args-shape validation exists even for scalars, so
the ingress seam is an evidence *addition* (LLP 0117 option A, finding 4).
Ownership per 0115 open question 1 (answered v0.2) and 0127's "what lands
where": a **new numbered Spec** plus a dated-alignment amendment to LLP 0004
owns the merged grammar and the ingress seam; CV-5 lands in **LLP 0073's
frame** with LLP 0037 as the carrier-alignment co-owner.

Work items. (1) Widen the argument lane to the result grammar for collection
validators (`v.array`/`v.object`/unions at mutation boundaries), reusing the
result-side plumbing (vocabulary spellings, recursive Rust validation,
type/schema projection, JCS hashing, bounds). (2) Build the runtime ingress
validation seam: fail-closed server-side per-invocation validation with
precise path-carrying diagnostics. (3) CV-5 as the first conformance fixture
for the extended argument-contract descriptor: export one Rust-owned search
request schema through the existing schema-export lane; carry a schema
reference or closed descriptor through the operation contract and provider
projection (replacing the authored `v.json()`); align the hand-authored
`SearchQueryAstV1`/`SearchRequestV1` client declarations with the exported
artifact; resolve LLP 0073 open question 12 (byte-for-byte carrier vs.
Contract-owned surface). Note `argsContractHash` witnesses the extended
descriptor; it is not itself a carrier (LLP 0117 §CV-5). Exit criteria are
0115's, verbatim: CV-4a — "Split Ledger's split vector expressed as
`v.array(v.object(...))` without `v.json()`; generated client types match;
invalid nested payloads refuse server-side with a precise path-carrying
diagnostic"; CV-5 — "One exported, drift-gated search request schema;
introspection, operation contract, and generated client types all derive from
or verify against it; accepted/rejected AST fixtures agree across all
carriers; no `unknown` remains at the search argument boundary."

## Implementation record (2026-07-31, wave-1 lane C6)

Implemented against LLP 0131, tracked through its concurrent review loop
(v0.1→v0.4) and finished against the Accepted v0.4 text. What landed:

1. **One argument grammar** — `validateAuthoringValidator` gained the
   per-position grammar parameter; argument positions admit the full
   LLP 0108 recursive vocabulary (`v.null`/`v.literal`/`v.array`/`v.union`
   plus the platform-constructed `PlatformSchemaRef`); schema/ephemeral/
   legacy-result lanes keep the closed map; the dead `resultOnly` flag is
   deleted from all five builders.
2. **Descriptor v2** — `FunctionArgsContractV1` ({fields:[{name, required,
   value}]}, bounds always materialized, declaration order preserved)
   carried in every function manifest beside `resultContract`; witness
   re-keyed to `snapback:function-args:v2` over the canonical descriptor;
   Rust recomputes and exact-compares at manifest load
   (`SNAPBACK_FUNCTION_CONTRACT_HASH_INVALID`); implementationHash rotated
   once; committed demo manifests + capability manifests regenerated
   deterministically; cross-language golden pins JS/Rust JCS agreement.
3. **Ingress seam** — `src/args_contract.rs` `validate_function_args` on
   every fresh lane (query/live/search via `execute_query_invocation`,
   mutation post-replay-lookup, nested/staged mutations, actions),
   fail-closed with bounded RFC 6901 pointers, closed enums, redaction;
   `SNAPBACK_FUNCTION_ARGS_CONTRACT_VIOLATION`; PlatformSchemaRef delegates
   to the owning parser under `SNAPBACK_SEARCH_QUERY_INVALID` with the
   `/query`-prefixed pointer; `query_search_on`'s parse delegates through
   the same seam; retained-settlement replay does not revalidate.
4. **CV-5 fixture** — `search.request.schema.json` exported + drift-gated;
   `defineSearchQuery` authors the `PlatformSchemaRef` node; api.d.ts /
   provider projection / operation args schema / Contract runtime-links all
   derive from the export (fail-closed derivation); shared corpus
   `search.request.fixtures-v1.json` generated through the Rust parser and
   re-proved against every JS carrier incl. compile-time accept/reject for
   generated and published TypeScript; generation-time three-arg gate; the
   client search pin is generated (`search-contract.generated.mjs`) with
   the coded `SNAPBACK_SEARCH_REFERENCE_INVALID` skew refusal.

Exits: split-ledger fixture commits valid vectors and refuses
`/splits/2/amountCents` server-side with no partial write
(src/local.rs `split_vector_argument_contract_...`); AST fixtures agree
across all carriers (packages/snapback-codegen/search-ast-fixtures.test.mjs);
no `unknown` at the search argument boundary; goldens pinned
(args-contract-goldens.test.mjs + the Rust twin).

Decision boundary (updated 2026-07-30: all ten 0127-routed decisions were
adjudicated by the author; registry in LLP 0115 v0.6 open question 8). This
ticket does NOT include option E schema-referencing contract nodes
(`v.doc(...)`-class declaration compression) — E's placement (proposed: the
CV-4 Spec) and the one-grammar-vs-subset call (0117 OQ1/OQ2) are
adjudicated in the CV-4 Spec's own loop, not among the ten, and remain
open. It does NOT include CV-4b stored fields (a separate, larger item:
`FieldType` extension, storage representation under LLP 0004/0007,
index/live-matcher semantics, LLP 0081 migration interaction). It does NOT
include option G omission strictness: 0127 decision 5 (0115 OQ3) is now
DECIDED — the post-A+E deferral is confirmed, with a provisional lean
recorded (refusal behind a per-app toggle, default-on for new apps,
default-off for existing) explicitly subject to the rerun's
severity-causality measurement — so strictness stays sequenced after this
slice's A+E land and stays out of this ticket. Nor option F interior typing
or the rejection-union work: 0127 decision 7 CONFIRMED the absorb/delegate
split, so those are now confirmed CV items (0115 CV-17/CV-16), tracked
separately — still not this ticket's scope.
