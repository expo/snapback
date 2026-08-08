# Route-group lowering rejects nested route params and null/union literal arguments

**Opened:** 2026-08-08 · **Severity:** P2 (blocks multi-child generated groups for real list contexts)

Lane 3's rich list/detail bundle failed generation with
`ROUTES_ARGS_INVALID`: route lowering rejects a `routeParam()` nested
inside an object argument and cannot express the null/union literal
members the frozen Zerobugs list context requires. The control fell back
to primitive wrapper arguments plus a typed server-side merge — the root
of `W-QGROUP`/`W-MANUALSET`, and the reason the 22-relation graph shapes
live in hand-written handler code.

Ask: extend route-group argument lowering to structured contexts (nested
route params, null/union literals) so multi-child generated groups can
carry real query contexts. Owner seam: D2 (the LLP 0183 review round asks
D2 to own the graph/argument surface explicitly).

- **Claimed 2026-08-08:** session dc26442d (13-ticket sweep orchestrator) is executing this ticket now; sibling sessions should not duplicate.
