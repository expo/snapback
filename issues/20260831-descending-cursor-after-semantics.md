# Descending range cursors: `after` is exclusive greater-than in both directions

**Opened:** 2026-08-31 · **Systems:** snapback2 engine scan semantics
**Status:** reported by the Quarry benchmark lane with mechanism + workaround; not independently re-verified.

On a descending scan, `after: cursor` still means exclusive greater-than,
so page 2 of a newest-first feed returns the wrong half of the index
(duplicating page 1). The lane's workaround: a client-supplied negated-time
`ord` column. Related compounding frictions from the same episode: index
changes hit `E_SUCCESSOR_DESTRUCTIVE` and `--apply-migration` needs a
running owner (chicken-and-egg on a broken dev store; the lane deleted the
store). Wanted: direction-aware cursor semantics (or a documented
`before`), and a migration path that works when the owner cannot start.
