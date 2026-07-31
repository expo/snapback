# Move 1 first slice: structured argument validators (CV-4a) proved on the typed search AST (CV-5)

**Status:** Open
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
