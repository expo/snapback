# Commission the D2 and D4 owner-Specs with the five-rung ladder (LLP 0191 OQ1, ruled)

**Opened:** 2026-08-08 · **Ruling:** LLP 0191 "Author rulings" #1, Charlie Cheever 2026-08-08 · **Gate:** drafting starts after the OQ4 spike reports (`20260808-oq4-coalescing-measurement-spike.md`)

**Gate cleared (2026-08-08):** the OQ4 spike ran and reported; results and
Spec-facing disposition are in
`issues/closed/20260808-oq4-coalescing-measurement-spike.md` (headline:
hypothesis not confirmed; rank settlement isolation first in the D4 rung-1
remainder, and scope coalescing's authorization-lane exclusion explicitly;
rung 2 is not the binding constraint; rung 3 has ~6× measured headroom).
Drafting is unblocked.

**D4-side drafted (2026-08-08):** LLP 0200
(`llp/0200-live-evaluation-scheduling-and-settlement.spec.md`, Draft) — it
extends the D4 charter to server-side evaluation scheduling (§0), decouples
settlement from subscriber work, splits the authorization lane
(data-driven resolution refresh vs authority transitions), and phases
implementation with the spike harness as the A/B instrument. Informed by
the post-spike diagnostic in the parent evidence ticket (write-turn
coupling; auth-lane routing; quarantine churn).

**D2-side drafted (2026-08-09):** LLP 0209
(`llp/0209-live-graph-profile.spec.md`, Draft) — the graph-profile
owner-Spec with rungs 2–4 as required content: the finite graph IR with
per-node authority classification and content-addressed plan identity,
the completeness vocabulary, and server/local evaluator agreement (§5
scope); rung 2 scoped as extend-and-measure and explicitly *not* the
near-term bottleneck (the spike's 0-conservative-fallback result), with
per-node dependency capture required at graph introduction and further
widening demand-gated on ledger evidence; rung 3 sequenced first among
the evaluation-cost rungs (same-authority-partition memoization against
the measured ~6× headroom), with cross-principal sharing gated on a
declared authority-independent base sharing LLP 0190 §4's answer; rung 4
as per-node-kind delta rules extending LLP 0008 DK-3's `live_delta`
guards; rung 5 referenced as D3 scope via the §8 interface. Sequenced
G0–G3 with the preserved spike harness as the A/B instrument. Both
commissioned Specs are now drafted; this ticket stays open until their
review/acceptance disposition is recorded.

Two separable owner-Specs, per LLP 0191 §1's revised ladder:

**D4-side (scheduling/lifecycle Spec):** rung 1 — coalescing,
cancellation, fair scheduling, with the latest-value delivery contract
named as a semantic change; settlement isolation (commit-ack vs
settlement vs convergence as separately measured contracts; bounded
write-path cost of a slow/disconnected subscriber); quarantine-recovery
lifecycle (what re-establishes liveness after a quarantine).
**Commissioning must resolve:** LLP 0183 charters D4 as the headless
*windowed-query controller* — either extend that charter to server-side
evaluation scheduling explicitly or name the runtime owner.

**D2-side (graph-profile Spec):** rung 2 — affected-read precision as
*extend-and-measure* of `crates/snapback/src/live_matcher.rs`'s captured-dependency
matching (widen to joins/ranges/windows/authority partitions; record
match/skip/fallback decisions); rung 3 — same-authority-partition
memoization first, cross-principal sharing only after an
authority-independent base is declared (shared answer with LLP 0190 §4);
rung 4 — IVM scoped to admitted shapes (extending the existing DK-3
`live_delta` precedent, LLP 0008). Also required scope per §5: the finite
graph IR, authorization at every node, completeness vocabulary,
server/local evaluator agreement. Rung 5 is referenced D3 scope via the
shared D2–D3 interface.

Independent early landings (not gated on the Specs, per §5 ruling):
stored literal-union enums + identity/default columns through the schema
owner (`20260808-stored-literal-union-enums.md`,
`20260808-numeric-identity-default-columns.md` — owner named at
commissioning, W-ENUM's D2-vs-D5 dual routing resolved there); structured
route-argument lowering as compiler prerequisite
(`20260808-route-group-argument-lowering.md`).

**D2-side G0 commissioned (2026-08-23):** LLP 0209 stayed Draft with G1
landed and G0 blocked on two author inputs (bound values, OQ-1). Author
ruling 2026-08-23 commissions G0 and converts both inputs into lane
deliverables ratified at exit — packet and lane plan in
`issues/20260823-llp0209-g0-commission.md`, ruling recorded in LLP 0209
v0.4. LLP 0200 (D4-side) completed its four-phase program 2026-08-09
(§6d) and sits at Review. This ticket still waits on the Specs'
review/acceptance disposition.


**D2-side G0 exited (2026-08-23):** LLP 0209 v0.6 records the G0 exit
(Status Draft → Review); Stages A/B1/B2/B3 landed (`77ed8394d`,
`73232029d`, `4627f9d95`, `40e76924c`). The D4-side (LLP 0200) sits at
Review since 2026-08-09. Both commissioned Specs are now at Review; this
ticket waits only on the author's acceptance disposition of the two Specs.

## Triage (2026-08-26 leftover sweep)

Still open for **author acceptance**. LLP 0200 and LLP 0209 are **Review** (not Draft). Implementation has continued (0209 G0 exit 2026-08-23; later G2/G3 landings). Measurement tail remains `issues/shelved/20260808-live-query-reevaluation-cost-at-scale.md`.

