# LLP 0209 D2 — freeze the complete list filter and selectable-order matrix

**Opened:** 2026-08-25 (P-C publication-readiness record, G3 rung-1 arc)

Add generated static-plan corpus variants for mixed-project restriction, open, creator, assignee, non-empty all-selected-label filtering, and every pinned selectable sort field/direction. Today every list oracle case runs `listContext.open/creator/assignee = null`, `selectedLabelIDs = []`, and only `modified desc` — the corpus proves fixed-plan correctness, not the LLP 0183 §D2 filter/order matrix. Each variant must exact-compare rows, order, completeness, and live replacement behavior through the evaluator and served subscription path, including combined-filter and hidden-row worlds, without introducing a client-authored AST. Treat P-B's multi-project observation and `issues/20260823-zerobugs-control-descending-tiebreak-deviation.md` as inputs, not substitutes for the semantic cases.

**Claimed:** 2026-08-25, session snapback-e9 (claude.ai/code session_01VKza4iiZ918TtDxobNDvvy), sbs-orchestrate lane — in flight. Coordination: this session also holds the superseded pre-port G3-B series (branch `sbs/20260824-g3b-delta-lanes`) whose frozen cases (backward/bounded/NULL root windows, duplicate-app-id, chained delta) feed the two-way-windows lane.
