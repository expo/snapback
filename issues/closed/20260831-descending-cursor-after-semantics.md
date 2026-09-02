# Descending range cursors: `after` is exclusive greater-than in both directions

**Opened:** 2026-08-31 · **Systems:** snapback2 engine scan semantics
**Status:** resolved 2026-09-02.

On a descending scan, `after: cursor` still means exclusive greater-than,
so page 2 of a newest-first feed returns the wrong half of the index
(duplicating page 1). The lane's workaround: a client-supplied negated-time
`ord` column. Related compounding frictions from the same episode: index
changes hit `E_SUCCESSOR_DESTRUCTIVE` and `--apply-migration` needs a
running owner (chicken-and-egg on a broken dev store; the lane deleted the
store). Wanted: direction-aware cursor semantics (or a documented
`before`), and a migration path that works when the owner cannot start.

**Resolution:** Rust execution and the TypeScript evaluator now interpret
`after` and `before` relative to `order`, while explicit range bounds remain
key-order. Four frozen two-page corpus cases cover ascending/descending
`after`/`before` with equal `at` values and distinct trailing ids, assert each
tied row appears exactly once, and run through both implementations. The
migration-path observation was not part of this cursor defect and remains
outside this closure.
