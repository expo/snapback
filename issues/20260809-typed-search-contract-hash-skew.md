# typed client.search() refuses its own release's generated references (0.1.15)

Clique pilot, Snapback lane: `client.search()` with a generated
resourceArg search reference fails with
SNAPBACK_SEARCH_REFERENCE_INVALID (contract-generation hash mismatch)
INSIDE the same npm 0.1.15 closure — codegen and client disagree about
the reference hash. Workaround: plain `client.query('searchMessages',
{args:{...}})` with a hand-built term AST works, so the server path is
fine; the typed wrapper's contract check is skewed. Repro basis:
/Users/ccheever/clique-runs/p2-pilot/snapback-lane (run-log.md M5
entries). Cost the lane a loop and dinged B6; also a trust hit — a
typed API refusing its own generated artifacts within one release.
