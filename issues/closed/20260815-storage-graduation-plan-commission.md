# Commission: graduate LLP 0128's storage-scale research into a Plan

**Opened:** 2026-08-15 · **Severity:** P3 design commission (demand-gated) ·
**Source:** author performance-direction ruling 2026-08-15

Direction: SQLite plus one authority is an excellent small-cell target, but
not the universal answer. Graduate storage according to workload — Postgres
for concurrent writers and larger storage; eventually partition hot
applications by a declared locality root (workspace, room, project). Keep
transactions and version streams cell-local; make cross-cell behavior
explicit. `llp/0128-popular-app-storage-scale.research.md` already lays this
out (declared placement key at its "Divide one app by a declared placement
key" section; the open root-choice question in its closing questions).

Ask: when a workload actually demands it (a hot app outgrowing one authority,
or the LLP 0265 championship showing the ceiling), author the Plan that
sequences: (1) Postgres as an alternative authority store behind the same
commit/version-stream contract, (2) declared locality roots and cell
partitioning, (3) explicit cross-cell semantics. Until then this ticket holds
the author ruling so the direction is not re-litigated per session.

The strategic frame it serves (author, 2026-08-15): cheapest at idle,
Instant-like immediate/offline UX, Convex-like coherent reactive queries,
explicit graduation path to Postgres/cells — not winning raw-Postgres
workloads at raw Postgres.

Related: LLP 0128, LLP 0198, LLP 0265 (championship contract), LLP 0209.

---

**Resolved 2026-08-16.** The author commissioned authoring ahead of the
demand trigger in the 2026-08-16 orchestration session (this closure is the
repository record of that request). The Plan is
`llp/0269-storage-graduation.plan.md` (Draft, v0.2), authored by Codex
gpt-5.6-sol xhigh and taken through a dual-family review loop (codex + grok,
round 1 both NOT READY, delta round converged; artifacts in
`llp/reviews/0269-storage-graduation.*`). Execution remains demand-gated per
the Plan §0 — the triggers are unchanged from this ticket. Acceptance is the
author's call.
