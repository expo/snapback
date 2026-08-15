# Familiar expressiveness refusals: principals in structured interiors, stored-field retype, scalar query lowering

**Filed:** 2026-08-15 · **Source:** clique-0121 exploratory sweep (LA Durand,
`~/clique-0121-20260814`), lanes `sol-snapback-familiar` and
`sol-snapback-simplified` (0.1.21) · **Systems:** Schema/validation,
Query lowering, Migration

## Problem

Three expressiveness refusals that each forced a lane onto a weaker type
than the domain wanted:

1. **Principal validators are rejected inside structured arrays.** A
   recipient snapshot naturally typed as an array of principals could not
   be generated; both lanes fell back to server-authored principal-ID
   strings / `v.json()`. Safe in these implementations only because clients
   never author the snapshot — the type system is less expressive than the
   domain exactly where authority data lives.

2. **A stored field cannot be retyped even along a widening/JSON path.**
   The simplified lane's partially loaded `recipientSet` had materialized as
   JSON; the corrected concrete-array schema was refused as a stored-field
   retype, permanently pinning the workaround from (1). There is no
   documented evolution path from `v.json()` to a structured type for
   already-stored data short of the full migration machinery (LLP 0081/0160).

3. **Scalar object query results cannot lower.** A familiar query returning
   a single object had to become a one-row array. Convex-familiar authors
   will write `get`-shaped queries constantly; this papercut hits in the
   first hour.

## Evidence

- `lanes/sol-snapback-familiar/diary.md` M3 + `final-report.md` (backend
  correction loops: "scalar object query lowering refusal; …
  nested-principal … generation refusal").
- `lanes/sol-snapback-simplified/diary.md` M3 + `final-report.md`
  ("`recipientSet` remains server-derived `v.json()` because published
  structured interiors reject principal validators and the
  already-materialized JSON field could not be retyped").

## Suggested fix

Admit principal validators in structured interiors (or document the
sanctioned snapshot pattern prominently); define a supported
JSON→structured widening story tied into the LLP 0160 migration program;
lower scalar object query results.

## Resolution

Resolved 2026-08-15 in the requested order.

1. Familiar queries now lower every exact non-row `v.*` result to the
   canonical single-value query contract. Runtime execution preserves its
   internal one-row carrier, validates exactly one row, and Familiar React
   projects the authored object or `null`. The codegen test `familiar returns
   lowering preserves row shapes and admits exact scalar values`, Rust tests
   `queries_admit_declared_single_value_result_contracts` and
   `scalar_query_validates_exactly_one_internal_row_as_the_authored_value`,
   and React test `scalar familiar query contracts project the one internal
   row as one object` prove the complete path.
2. Stored structured arrays/objects now admit `v.principal()` as a nominal
   string leaf. It is explicitly a historical snapshot only: nesting it
   confers no membership, visibility, grant, or reference authority. The
   structured-stored-values codegen suite and Rust test
   `structured_principal_arrays_round_trip_as_nominal_snapshots` prove valid
   round-trip plus fail-closed invalid-principal handling.
3. LLP 0081/0160's reviewed migration program now names
   `ConvertJsonToStructured { table, field, generation }`. It stages a
   successor generation, identity-copies every row through the destination
   structured contract, verifies row count and content digest, and publishes
   only through reviewed approval/rehearsal. Direct activation routes to that
   intent. Rust tests
   `direct_json_to_structured_activation_routes_to_the_named_reviewed_intent`
   and `json_to_structured_intent_rewrites_and_publishes_staged_generation`
   prove both the refusal route and a seeded end-to-end conversion. Existing
   LLPs 0081, 0160, and 0211 were amended; no parallel migration mechanism or
   new LLP was needed.
