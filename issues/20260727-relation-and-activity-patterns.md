# Bounded parent/child reads and transactional activity patterns

**Status:** Open  
**Impact:** 4  
**Urgency:** 3  
**Ease:** 1  
**Confidence:** 4  
**Severity:** P2  
**Systems:** Data API, Relational queries, Mutations, Code generation, Auth, Testing  
**Author:** Codex, directed by Charlie Cheever  
**Date:** 2026-07-27  
**Related:** LLP 0004, LLP 0051, LLP 0065, LLP 0080

Snapback ships bounded two-source joins, maintained projections, owner CRUD,
unique lookup, and keyset pages. It does not ship the common one-to-many
parent/child read or an auditable write-plus-activity helper, so Signal Desk
manually repeats child collection, parent touch, activity insert, and result
assembly.

## Design gate

Amend LLP 0080 for bounded one-to-many semantics and LLP 0065 for the
transactional activity pattern, then run `llp-super-refine` with Fable 5 and
Codex gpt-5.6-sol input. The design must keep visibility explicit and every
generated transaction step inspectable.

## Desired resolution

- Add a bounded parent/child query profile with explicit parent visibility,
  child foreign-key/index, per-parent bound, stable order/keyset cursor,
  projection, and live/fallback classification.
- Apply authorization before limit and cursor construction. Missing and
  invisible parents must not form an existence oracle.
- Add a closed write-plus-activity standard pattern with explicit source and
  activity tables, field mappings, visibility, provenance, returned shape,
  idempotency, and generated read/write/effect ceilings.
- Do not infer authority, visibility, activity meaning, or transaction scope
  from names. Generated code exposes rather than hides the atomic steps.

## Acceptance

- Parent/child tests cover cross-owner noninterference, missing/invisible
  parity, exact index requirements, order/pagination, concurrent insert,
  parent deletion policy, live replacement/delta honesty, and bounds.
- Activity tests prove source and activity share one commit version, injected
  failure rolls both back, durable replay is idempotent, and generated
  ceilings/results/types are exact.
- Signal Desk uses the helpers for incident/task/comment reads and at least one
  mutation-plus-activity flow without losing its atomicity/live evidence.
- Codegen, provider/Contract bindings, guide pages, capability facts, and
  target GAPs reflect the reviewed profiles.
