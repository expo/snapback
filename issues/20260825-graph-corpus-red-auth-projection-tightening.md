# graph_corpus_v1 red on main — auth projection tightening vs synthetic test principals

**Status:** Open (fix in flight) · **Opened:** 2026-08-25, session snapback-e9

Ten `graph_corpus_v1` scheduler/served tests fail on main with
`SNAPBACK_AUTH_PROJECTION_CORRUPT: projected user id is not a Snapback
identifier` at "build unit-test authority coordinator"
(`crates/snapback-engine/src/local/engine.rs:9651`). The auth landing
`35bd19287` (+ `6364729fe`/`3d765277b`/`4486f2e13`) tightened projected-user-id
validation; the graph corpus scheduler fixtures (G3-A-, G3-rung-1-, C1-,
C2-era) mint synthetic principal ids that no longer validate. The C2
two-way-windows landing (`297cfcf76..212735724`) stacked on top of the
already-red state — its own landing chain also masked the post-rebase failure
by piping cargo's exit through `tail` (session process defect, noted for the
run record).

Fix in flight (session snapback-e9): mint valid Snapback identifiers in the
corpus/test-support principal fixtures — the auth validation stays untouched;
re-freeze identity-only if partition identities embed the ids. Resolution and
exact red-introduction range will be recorded here.
