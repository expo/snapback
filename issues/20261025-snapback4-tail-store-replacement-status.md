# Snapback 4: store replacement detected at the final tail answers 200 instead of 409

**Status:** Open
**Opened:** 2026-10-25
**Area:** `engine/postgres/group_commit.rs` (~148), `engine/postgres/group_tail.rs` (~244), `crates/snapback4/src/serve.rs` (~1427, ~1445)
**Related:** write levers (`987a1f01df..24ca85a392`); LLP 3000.009.001.000.001 (cold-ingress 409 for `E_STORE_REPLACED`)

From the blind review of the levers rebase (Sol P2; Grok approved with nits).
If authority succeeds against store A and `_meta.store_id` changes before the
final-tail ticket check, the transaction rolls back with terminal
`E_STORE_REPLACED`, but the HTTP continuation keeps its earlier `boundary`
and formats the error as an evaluated intent refusal: HTTP 200 with the old
store/head/generation metadata, instead of the metadata-free 409 that cold
ingress and the warm hint path return. The write does not commit and the
body is a refusal, not a success.

Fix: distinguish a failed ticket store binding from an evaluated intent
refusal and route it through the authority-error response (409, no store
metadata). Witness: replace the store after successful authority checking
and before the tail (the existing witness replaces it before successor
staging and misses this window).
