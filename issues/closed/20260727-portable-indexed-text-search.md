# Portable indexed full-text search v1

**Status:** Closed — reverified after exact result-contract repair
**Impact:** 5  
**Urgency:** 4  
**Ease:** 1  
**Confidence:** 5  
**Severity:** P1  
**Systems:** Search, Storage, Schema, Code generation, Auth, Live Queries, Testing  
**Author:** Codex, directed by Charlie Cheever  
**Date:** 2026-07-27  
**Related:** LLP 0004, LLP 0007, LLP 0051, LLP 0053, LLP 0063, LLP 0073, LLP 0074

Snapback has no indexed text-search authoring or runtime primitive. Signal Desk
scans incidents in a JS handler, while comparator-native implementations use a
search index. Draft LLP 0073 defines a portable term/position authority,
structured AST, ranking/cursors, authorization, rebuild, and target
capabilities; no implementation may substitute raw SQLite FTS syntax for that
contract.

## Design gate

Run `llp-super-refine` on LLP 0073 with fresh Fable 5 and Codex
gpt-5.6-sol reviewers. Resolve its scorer, synchronous-vs-bounded-async,
cursor/generation ceilings, and sensitive-field questions. Implementation
follows the converged revision and records target-specific nonclaims.

## Desired resolution

- Add a declared search index over an ordinary application table,
  with weighted text fields, exact filters, stored display fields, visibility,
  analyzer/version, size/work limits, and update mode.
- Generate the portable analyzer/parser/matcher/scorer artifacts, operation
  refs, result types, capability facts, and inspection data.
- Implement local SQLite term/position/source storage, transactional update and
  delete, structured term/phrase/prefix/exclusion/filter queries, deterministic
  ranking, bounded overfetch, authorization-safe release, highlights, and
  AEAD-protected current-keyset cursors. V1 deliberately makes no
  cross-request snapshot-stability claim.
- Implement rebuild/catch-up/activation, tombstones, corruption quarantine,
  backup/restore posture, and stable restart diagnostics.
- A native FTS accelerator may only return a proven no-false-negative candidate
  superset; disabling it must leave match truth unchanged.
- Keep PostgreSQL/hosted support as explicit GAPs until the same portable corpus
  passes there.

## Acceptance

- Unicode/analyzer, parser, query, phrase/prefix, malformed input, injection,
  ranking, cursor, pagination, update/delete, rebuild, corruption, and
  backup/restore vectors pass.
- Owner/public visibility changes leak no title, snippet, score, count, timing
  classification, or existence fact, including across cursors. Membership,
  moderation, relation-derived visibility, and generated-projection sources
  are explicit v1 rejections/nonclaims with conformance cases.
- Searchable-at-commit behavior and synchronous failure rollback are proven for
  the bounded Signal Desk fixture.
- Signal Desk uses the generated indexed search ref and deletes its scan/filter
  handler; no client casts or backend query strings remain.
- Capability/guide/admin evidence names exact analyzer, generation, limits,
  storage class, accelerator identity, and every nonclaim.
- LLP status/evidence notes, Rust-owned schemas, `@ref`s, and corpus audit land
  with implementation.

## Resolution — 2026-07-27

Implemented the exact local SQLite profile governed by LLP 0073. Schema
authoring now declares weighted, classified search indexes and generated search
operations; the client sends a closed structured AST and receives typed,
ranked, highlighted keyset pages. SQLite maintains the canonical
Unicode-17 term/position/source authority synchronously with the source
transaction, and the runtime owns visibility pushdown plus authoritative
release rechecks, bounded exact ranking, XChaCha-protected current-keyset
cursors, rebuild/activation, corruption quarantine, and backup/restore
recovery.

Signal Desk now uses `defineSearchQuery` and the generated
`api.searchIncidents` reference; its former JavaScript scan is gone. LLP 0073
is Implemented and records the admitted local profile plus the explicit
PostgreSQL, hosted-service, live/offline, sensitive-field, relation-visibility,
and accelerator nonclaims.

The retained Rust and package corpus covers analyzer/parser/query semantics,
ranking, pagination, mutation maintenance, owner isolation, rebuild,
generation switching, integrity roots, direct SQLite tampering, corruption,
and backup/restore. The final integrity hardening binds every source projection
to a canonical content digest and checks the exact derived state before
release, including mutation-triggered quarantine and deterministic
grapheme-safe highlight vectors. Focused search tests pass 23/23; the complete
repository proof owns the final integration gate.

### Exact generated result follow-up

An integration audit found that the initial search transport contract still
declared `fields` as bounded JSON and that every generated search reference
therefore collapsed to a global `Readonly<Record<string, unknown>>`. That did
not satisfy this ticket's no-cast acceptance criterion and caused codegen to
report an inapplicable degraded result for `searchIncidents`.

The repaired generator derives the runtime transport-row contract from the
named search index and source schema. Stored keys are closed and exactly typed;
optional source values use the runtime's present-null storage shape; the row id
retains its source-table brand; provider metadata and the generated
`SearchPageV1` use the same contract. A focused fixture compiles a real
`SnapbackClient.search(api.searchIncidents, ...)` consumer, rejects undeclared
keys and wrong field types, and runs the generated contract validator against
valid, extra-key, missing-key, and wrong-type rows. Signal Desk regenerates
with `degradedResults: 0` and its TypeScript project compiles without casts.
