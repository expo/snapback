# Commission: hard query-cost guardrails before production admission

**Opened:** 2026-08-15 · **Severity:** P2 design commission ·
**Source:** author performance-direction ruling 2026-08-15 (recorded in the
lane run that also produced LLP 0265 and the G1 memoization landing)

Snapback should expose, per query: scanned rows, index ranges consulted,
result bytes, evaluation time, and estimated live fan-out cost — and act on
them **before** production: warn, require an index, require pagination, or
refuse an operation that would create a ~one-second unpreemptible live turn.
The author's framing: Convex's bounded-transaction posture is the lesson —
predictable refusal is better than correct-but-multi-second queueing. The
measured basis is the zerobugs hot inventory (LLP 0209 §1: ~0.9 s evaluation
turns on the 5.5M-row baseline) and the E-3 six-observer serialization shape.

Ask: author an RFC that decides
- which of the five signals are measured vs estimated, and where they are
  captured (evaluation turn instrumentation already exists in part — see
  turn_prof usage in `issues/closed/20260808-p1-commit-turn-overhead.md`);
- the enforcement ladder (warn → require index → paginate → refuse) and where
  each threshold lives (schema/function declaration vs instance config);
- how refusals surface (typed SNAPBACK_* diagnostics, guide page, local
  parity per LLP 0209 §8 refusal-parity requirement);
- interaction with LLP 0209 G0 bounds (declared bound values sized from
  fixtures) so the two bounding systems are one system, not two.

Related: LLP 0209 (§2 bounds, §8 refusal parity), LLP 0183 D2, LLP 0198
(strategic frame), `issues/20260808-live-query-reevaluation-cost-at-scale.md`.

---

**Resolved 2026-08-16.** Authored as `llp/0267-query-cost-guardrails.rfc.md`
(Draft, v0.4) via the 2026-08-16 orchestration session, through a
three-fix-round dual-family review loop (codex + grok; converged READY at
v0.4/v0.3 respectively; artifacts in
`llp/reviews/0267-query-cost-guardrails.*`). The RFC decides the five
signals' measured-vs-estimated split against the shipped seams, the
tighten-only enforcement ladder, offer-gated typed refusals with local/server
parity, and the single-declaration unification with LLP 0209 G0 bounds.
Acceptance is the author's call.
