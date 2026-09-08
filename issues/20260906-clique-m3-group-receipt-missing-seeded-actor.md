# Clique M3 group receipt scenario omits a seeded recipient

Status: Open
Date: 2026-09-06
Scope: frozen Clique instrument f40559f37722c79178be664a11f8a6485f1508fd

The exact starter-m3 fixture creates the Alice/Bob group and adds Carol and Erin. The brief requires aggregate delivered/read state from all retained send-time recipients. The frozen group receipt scenario opens Alice/Bob and Carol but never Erin. Its expected aggregate transition therefore omits a recipient required by the fixture and brief.

The cold published Snapback2 0.0.13 run emitted application/choreography-failed, including both group receipts and an independent DM transition failure. The missing actor is a concrete setup concern, not a built-in skip and not an explanation of the DM failure. The builder later opened an actual Erin client and got a supplemental pass; that result remains separate from the standalone frozen failure. Fixture and harness bytes match the original pin. Current idempotency replay receipts are not claimed to be the original first seed or a full database census.

Resolve the fixture/scenario contract explicitly and validate the required actor choreography without changing the app's all-recipient rule, removing seeded members or weakening assertions. Preserve original failures, deadlines and source pins. Any future instrument correction must have an explicit comparison-validity decision; do not silently replace existing Convex/Supabase scores, relabel the supplemental pass or rerun the safety-blocked builder request.

[Source binding and retained outcome](../benchmarks/runs/2026-09-06-clique-improvement/evidence/astra-013-terminal/m3-first-outcome/report.md). This ticket records the defect; no harness mutation or new benchmark execution is performed.

## Reproduced on published 0.0.19 — 2026-09-08

The frozen `social-messenger@0.3.6-m8` starter again includes Erin, while the
receipt choreography drives Bob and Carol only. The control lane uses a
three-person group and masks the discrepancy. The retained M3 receipt remains
6/7; no application pass or prerequisite waiver is inferred.

The fresh Grok assessment retained that failure but called it an application
defect. A separate source/evidence audit confirms that attribution is not
established: its supplemental observer also omits Erin and mishandles a null
receipt attribute. Preserve the original report and its separate root
adjudication in
[the diagnostic run](../benchmarks/runs/2026-09-08-release-cold-headroom/README.md).
The duplicate September 8 ticket is archived under `issues/closed/`; this
September 6 ticket owns the unresolved fixture/calibration correction.
