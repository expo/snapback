# Commission the D2 and D4 owner-Specs with the five-rung ladder (LLP 0191 OQ1, ruled)

**Opened:** 2026-08-08 · **Ruling:** LLP 0191 "Author rulings" #1, Charlie Cheever 2026-08-08 · **Gate:** drafting starts after the OQ4 spike reports (`20260808-oq4-coalescing-measurement-spike.md`)

**Gate cleared (2026-08-08):** the OQ4 spike ran and reported; results and
Spec-facing disposition are in
`issues/closed/20260808-oq4-coalescing-measurement-spike.md` (headline:
hypothesis not confirmed; rank settlement isolation first in the D4 rung-1
remainder, and scope coalescing's authorization-lane exclusion explicitly;
rung 2 is not the binding constraint; rung 3 has ~6× measured headroom).
Drafting is unblocked.

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
*extend-and-measure* of `src/live_matcher.rs`'s captured-dependency
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
