# LLP 0209 D2 — freeze the complete list filter and selectable-order matrix

**Opened:** 2026-08-25 (P-C publication-readiness record, G3 rung-1 arc)

Add generated static-plan corpus variants for mixed-project restriction, open, creator, assignee, non-empty all-selected-label filtering, and every pinned selectable sort field/direction. Today every list oracle case runs `listContext.open/creator/assignee = null`, `selectedLabelIDs = []`, and only `modified desc` — the corpus proves fixed-plan correctness, not the LLP 0183 §D2 filter/order matrix. Each variant must exact-compare rows, order, completeness, and live replacement behavior through the evaluator and served subscription path, including combined-filter and hidden-row worlds, without introducing a client-authored AST. Treat P-B's multi-project observation and `issues/20260823-zerobugs-control-descending-tiebreak-deviation.md` as inputs, not substitutes for the semantic cases.

**Claimed:** 2026-08-25, session snapback-e9 (claude.ai/code session_01VKza4iiZ918TtDxobNDvvy), sbs-orchestrate lane — in flight. Coordination: this session also holds the superseded pre-port G3-B series (branch `sbs/20260824-g3b-delta-lanes`) whose frozen cases (backward/bounded/NULL root windows, duplicate-app-id, chained delta) feed the two-way-windows lane.

## Implementation update — 2026-08-25

This lane now freezes nine generated static-plan variants through the canonical Zerobugs freezer: mixed-project `modified asc/desc` and `created asc/desc`; `open`; `creator`; `assignee`; non-empty all-selected-label membership; and the combined open+creator+assignee+all-label case. The additive Matrix fixture supplies five visible rows, a matching cross-project decoy, one matching hidden row, two selected labels, non-null creator/assignee/open values, and ties for every selectable order. Every variant has hidden-present/hidden-absent oracle worlds, exact initial and title-replacement expectations, and runner coverage through both direct evaluation/attested matching and the served scheduler path. All matcher results are `match`, all served updates are `live_replace`, and G3 rung-1 eligibility/memo artifacts remain unchanged.

The matrix exposed and this lane fixed the served dependency attester's stale parent-population invariant after a non-empty semi-join: subsequent sibling facts are now checked against only retained parents. Descending oracle rows remain normalized by the pinned physical `_id ASC` tie rule and retain the raw control-oracle digest/order plus the existing deviation-ticket pointer; the D1 oracle itself is unchanged.

No requested axis was inexpressible and no admission refusal remains. The six P-C rows named in this ticket now have executable evaluator+served evidence. Remaining work is review/orchestrator closure and post-landing reconciliation of LLP 0209's explicitly dated v0.11 publication-readiness table; search, two-way windows, overlays, full relation shapes, and production class-2 publication readiness remain owned by their separate P-C tickets and are not broadened by this lane.

## Resolution (2026-08-25)

Closed by the C1 lane (series ending `bfb45a821`): nine generated static-plan matrix variants (project/open/creator/assignee/all-label/combined/created+modified orders), paired hidden-row worlds and live replacement per axis, four both-label decoys making each conjunct independently load-bearing, tie fixtures with physical/logical id order inverted, direction-independent normalization dispositions, and the predicate-only-scoped semi-join attestation fix. Dual-family READY (grok r1, codex r3); records `llp/reviews/0209-c1-filter-order-matrix.*`.
