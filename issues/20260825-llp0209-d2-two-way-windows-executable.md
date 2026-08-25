# LLP 0209 D2 — make two-way graph windows executable conformance

**Opened:** 2026-08-25 (P-C publication-readiness record)

Promote forward and backward root/child continuation scenarios into executable graph corpus rows: today `issueListV2-backward-tied-modified` is only frozen/metadata-checked; no backward evaluator resume or forward→backward traversal runs. Prove first page, resume, reverse traversal, stable ties, and no duplicate or skipped unchanged rows through both evaluator and served scheduler. Cross-link `issues/20260823-zerobugs-control-descending-tiebreak-deviation.md`; freeze no backward result until its permitted normalization is explicit.

**Claimed:** 2026-08-25, session snapback-e9 (claude.ai/code session_01VKza4iiZ918TtDxobNDvvy), sbs-orchestrate lane — in flight. Coordination: this session also holds the superseded pre-port G3-B series (branch `sbs/20260824-g3b-delta-lanes`) whose frozen cases (backward/bounded/NULL root windows, duplicate-app-id, chained delta) feed the two-way-windows lane.
