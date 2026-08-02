# G-04: The register cliff — one ordinary query must not degrade a whole register group

**Status:** Amendment proposed — implementation gated on mixed-route v2 design
**Program:** 20260802-convex-erg-00-program.md
**Systems:** Live queries, Client integration, Codegen
**Related:** LLP 0127 (reactivity-fee finding), LLP 0090 (resumable query
snapshots — register/rung-2 tails recorded open at its execution close),
LLP 0114 (client seam), LLP 0155 Move 1/2 (the strategic successor surface)

## Task

The parity research records a reactivity cliff: mixing one ordinary
(non-analyzable / opaque) query into a register group degrades the whole
group's delivery class, so authors pay a classification fee Convex never
charges. The 2026-08-02 synthesis lists it as an un-programmed gap.

**Verify first:** reproduce the cliff on current main (the delta-lane
conservatism just changed in eda8f231 — behavior may have moved). Record: what
exactly degrades (delivery lane? retainability? the whole group vs the one
query?), which doc owns the current behavior, and whether LLP 0090's open
register/rung-2 tail tickets cover it.

**Then either:** (a) implement per-query classification so an opaque query
degrades only itself, under the existing capability-classification vocabulary
— if the fix is within decided design; or (b) if it needs new design, write
the finding into the owning LLP (0090 or the 0155 Move-1 Spec) as a dated
amendment proposal and re-scope this ticket to that path. Do not silently
widen delivery guarantees for opaque queries; the fix is isolation of the
degradation, never upgrade of the unanalyzable.

## Exit

- The dated reproduction/ownership note.
- Path (a): a test proving one opaque query in a group leaves sibling
  analyzable queries' delivery class untouched, plus the inspector/diagnostic
  naming the per-query class. Path (b): the amendment proposal landed and
  this ticket re-scoped or closed onto the successor.

## Running log

- **2026-08-02 — current-main reproduction and ownership delta.** Reproduced
  against `1a056305a63fc49755e2cf845c58fdbce7ae81b2`. Codegen admits
  `[LiveQuery, LiveQuery]` as one generated query group, keeps
  `[LiveQuery, Query]` as a valid read-bundle route but emits neither
  `registerGroupEligible:true` nor a generated group, and admits
  `[LiveQuery, defineJsLiveQuery]` as a generated group. Therefore the cliff
  is not opaque-plan analysis, per-query `live_delta`, or the live matcher:
  it is the route-level all-`LiveQuery` gate in
  `generatedQueryGroupRoutes` and the generated format-1 projection. LLP
  0112 owns that current behavior; LLP 0090 D1.2 owns the whole-request
  read/register protocol that makes a codegen-only relaxation dishonest.
  The existing `authoring-validation.test.mjs` mixed-route fixture passed and
  pins the current outcome; the nine-test `live_delta_v0` suite remains green,
  so no global delta degradation was found.
- **2026-08-02 — path (b), amendment proposal.** A dated, explicitly
  non-normative proposal now sits in LLP 0090's revision history. It asks a
  successor version to preserve one pinned snapshot while classifying each
  child as registered-live or read-only, project per-child provenance and a
  weakest group state, and close failure/authority/idempotency/cleanup/bounds
  before implementation. LLP 0112 format 1 remains unchanged. LLP 0157 is a
  live, separately owned authoring lane; this ticket neither edits it nor
  treats composition-plan identity as a liveness decision. The implementation
  half is re-scoped to the accepted successor profile and is blocked until
  that author-level contract exists.
