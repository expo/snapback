# PR round 0 context

Scope: mounted local/online observations, their queue and episodes, inspection,
client guide, Chromium wasm and process-device convergence.

Governing LLPs: LLP 3000 (Snapback 4 fence and budgets), LLP 2000.000 §7–8
(partition replica and read vocabulary), LLP 3000.023 §10 (RL retention, PQ work
bounds, LL pending-cut parking), LLP 3000.019 §3.3 (answer identity/authority),
LLP 3000.031 §1.1 (existence). The client card is the current authoring surface.
3000, 3000.019, 3000.023 and 3000.031 are linked in `llp/current/` (not `foundation/`); their in-flight guidance can move. No new LLP is needed.

Constraints: LLP 3000#4 — independent workspace, 1,500-line source cap;
LLP 3000.023#10 — plain revalidation retains, hard boundaries remain exact,
change-version and pending-cut checks reject older evaluations, eight starts per
turn/eight in flight, ordinary fallback remains eligible, held watches park.
LLP 3000.023#3.6 — approved facade answers inherit the source budget and keep
independent row expiry. LLP 3000.031#1.1 — never manufacture absence.

Risk: the previous absolute deadline includes a retry's queue wait. The current
user ruling explicitly excludes queue wait from withdrawal budgets, superseding
that part of §10. Preserve consumed attempt time across retries; do not renew a
full second. Do not confuse waiting for sync/backoff with queue capacity pressure.
Inspection follows the SDK's existing auxiliary acquisition surface, avoiding a
new read-state vocabulary or reshaping contract.ts. It must not expose arguments
or answer data. Document finite sample windows and separate counts from timings.

Updates: LLP 3000.023 §10, client card within its cap, one append-only journal
entry, report and test artifacts. No publication or push. Hand-off: none.
