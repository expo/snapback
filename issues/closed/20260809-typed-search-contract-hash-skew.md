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

## Resolution — 2026-08-10

Duplicate of `issues/closed/20260809-typed-search-reference-hash-skew.md`
(same 0.1.15 defect, filed the same day from the pilot side). That ticket
resolved the root cause: generated search references now carry a dedicated
`searchRequestContractHash` plus `searchResourceArg`; the client
exact-compares the dedicated witness; a real-codegen regression composes
plain and membership references through `client.search()`; the canonical
proof runs the same composition. Closing as duplicate — no residue.
