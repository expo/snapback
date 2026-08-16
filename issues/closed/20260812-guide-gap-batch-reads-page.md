# guide-gap: ctx.db.getMany / uniqueMany need a guide section

**Opened:** 2026-08-12 (ordinary-TS authoring wave, run llp0245-0249-ordinary-ts-20260812)

LLP 0248's bounded batch reads landed (experimental `bounded_batch_reads_v1`,
local target) with generated types, diagnostics, and reference JSDoc, but no
guide page section. `guide/backend/queries.md` should gain a batch-reads
section covering: the two forms, the 0..256 bound and byte ceilings, order/
duplicate/null semantics ("hidden and absent are indistinguishable"), the
one-host-call claim, whereApplicable complete-key refusals, and the paved
alternative link to relational projections (LLP 0187 T1 point-of-choice rule).
`guide/backend/relational-queries.md` anti-patterns should link back. Absorb
the capability-index GAP row when the section lands.

## Resolution (2026-08-15)

Absorbed into the Guide. `guide/backend/queries.md` now teaches the two typed
batch forms, exact item and byte ceilings, positional duplicate/null and
visibility semantics, one-host-call boundary, complete unique-key refusals,
and the relational-projection paved alternative. The relational-query
anti-patterns link back at the inverse point of choice, and
`backend.batch-reads` is now a real partial/local capability row backed by the
landed runtime, snapshot, and harness tests.
