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
**Related:** LLP 0004, LLP 0051, LLP 0065, LLP 0080, LLP 0104, LLP 0108

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

## Resolution — 2026-07-27

LLP 0104 completed three super-refine rounds with Fable 5 and Codex input. The
local landing now contains:

- protected relation-incarnation schema type, registry lifecycle, automatic
  central-writer stamping, inactive-parent/direct-write refusals, and
  activation validation;
- the exact indexed bounded-children plan, absent/visible discriminator,
  first-page live classification, lexicographic `take + 1` executor, and
  purpose-derived 1,024-byte `sbbc1` XChaCha cursor;
- the closed existing-owner write/activity plan, exact source-effect
  assertion, server-derived session/delegated provenance, canonical
  client-mutation-identity digest, result contract, and quantitative ceiling;
- Signal Desk proving declarations/schema, generated artifacts, package/Rust
  focused tests, Guide design references, capability GAPs, and Diary 0022
  observations.

The repository-scoped implementation is complete. Local evidence is recorded
in LLP 0104 under “Implemented landing evidence” and includes the exact
codegen/provider types, protected storage lifecycle, bounded persisted
executor and cursor, atomic source/activity/replay behavior, exhaustive public
diagnostic classification, Signal Desk declarations, guide/diary updates,
TypeScript, and production build.

The Signal Desk product path intentionally retains its explicit JavaScript
activity mutation because the shared three-backend UI contract uses a
development persona rather than backend-specific session custody. A direct
session-authenticated Signal Desk acceptance path exercises the closed helper,
including atomic source/activity versions, exact replay, storage-equal no-op
rollback, and an attempted development-impersonation refusal. The distinction
is now executable rather than declaration-only.

LLP 0104 remains Review because its first-publication lifecycle requires
author acceptance after the non-dual-READY review. Positive capability facts
therefore remain false. The additional paired-store/restore vectors,
cross-language cursor goldens, hosted corpus, and full retained-settlement
publication matrix are capability-publication evidence tracked by the LLP,
not open work in this repository ticket.

## Reopened — 2026-07-27

An independent completed-lane audit found that the resolution above was
narrower than this ticket's own acceptance criteria. The local executor and
Signal Desk declaration/acceptance path are real, but a false capability fact
means the helper is not yet an ordinary supported authoring choice. This ticket
therefore remains open until the LLP 0104 publication evidence is complete:
paired-store noninterference, restore/backfill vectors, cross-language cursor
goldens, retained-settlement boundaries and queue-owner coverage, the hosted
target corpus, full Signal Desk product adoption, and author acceptance or an
equally explicit decision to narrow the public profile.

## Repository-local publication evidence — 2026-07-27

The paired-store, restore/backfill, cross-language cursor/order, cursor
concurrency/deletion/live, activity fault-cut, exact 65,536/65,537 retained
result, ACK/purge/replay-loss, and web/React Native/Expo queue-owner rows are
now executable and mapped by
`tests/conformance/relation-activity-publication-v1.receipt.json`. The work
also fixed two evidence-discovered defects: relation activation now validates
parent-to-registry and registry-to-parent integrity, and cross-parent cursors
return the uniform invalid-cursor outcome before lineage restart comparison.

## Local source publication checkpoint — 2026-07-28

LLP 0104 and LLP 0108 now explicitly narrow the first positive publication to
the exact `local-dev-sqlite-ibex` source target. The tracked
`LocalCapabilityPublicationV1` carrier binds the atomic capability pair to the
qualification receipt and exact executor/schema bytes; Rust compiles and
validates it through private target facts that application artifacts cannot
set. Both capabilities are statically experimental, appear only on the exact
local auth-aware profile, and require artifact acknowledgment. Remote-service,
workerd-conformance, Cloudflare, and hosted profiles keep structured GAPs.

The conformance runner verifies carrier/receipt/source byte equality and the
guide names the acknowledgment and target boundary. Public-package attestation
and hosted claim-family publication remain distinct deployment work under LLP
0108. Final ticket disposition waits for the complete program-level
publication review.
