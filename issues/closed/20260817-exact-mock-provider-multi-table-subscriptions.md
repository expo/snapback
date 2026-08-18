# Exact: mock provider needs multi-table dependency-aware subscriptions

**Opened:** 2026-08-17
**Source:** Coterie M2 entries (Diary 0086); LLP 0279 item 8

## Gap

The mock boundary anchors each query's live handle to one table, so a query
that declares reads of posts and follows invalidates only on its anchor.
Coterie first shipped honest no-op `posts` writes as an invalidation bridge
(making declarations and mutation traces misleading), then replaced them
with a local memory-adapter wrapper that subscribes derived queries to each
declared table — after which `listInsights` could declare its real four-table
read set and the no-op writes disappeared.

## Ask

Upstream the wrapper's semantics: mock subscriptions should follow the
declared read set, keeping the mock deliberately coarse but truthful.
Acceptance: Coterie's wrapper is deleted and its declarations/mutation
traces stand unchanged. External (Exact repo) fix; graduate to Linear
(Exact project) when picked up.

## Resolution (2026-08-17)

Graduated to the Exact repo: `issues/20260817-exact-mock-provider-multi-table-subscriptions.md` there. Picked up by the
sbs-orchestrate Exact-side batch; further state lives in the Exact ticket.
