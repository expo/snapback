Built all five shapes in snapback/schema.q using only snapback4@0.2.12: social insights with UTC day buckets, live like-ranked trending, durable scheduled digest effects, current-membership receipts, and grouped word-prefix search. Node supplies HTTP transport, seed generation, assertions, and an effect observer that claims and settles each real effect without deduplication. The application answers are computed in Quarry.

All four requested proofs passed. The schema check reports no problems. The seed installs the complete fixed dataset using application mutations only. Acceptance passed twice in independent persistent-store project copies, including restart deduplication, next-period emission, active users at zero unread, authorization refusals, monotone individual acknowledgments, membership changes, message insertion, ranking changes, and complete query/page results. Actual two-minute boundaries fired at 2026-09-14 17:14:00 UTC and 17:16:00 UTC. All owned server children were closed in finally blocks. No development server was launched separately.

| Milestone | Seconds since start |
| --- | ---: |
| Packet read and schema implementation started | 88 |
| First schema check passed | 97 |
| Headless seed and acceptance implemented | 249 |
| First full acceptance passed | 350 |
| Second full acceptance passed | 471 |
| Final record | 505 |

Correction loops:

- Loop 1, agent-error: the initial timestamp shell command wrote /tmp/ceremony-time-placeholder before creating run-log.md. This violated the current-directory constraint. It contained only a timestamp; no outside repository or prior implementation was read. Further work was confined to this directory. The outside file was not touched again.
- Loop 2, agent-error: review of the first acceptance harness found that its shutdown escalation timer could remain pending after the owned child exited. The timer now clears on exit, and the corrected harness passed the second full acceptance. This was found by code review, not a failed package command. Acceptance milestones also now append directly to run-log.md; first-run events were imported with their original timestamps from evidence.json.

No package defect or documentation gap was encountered. The schema compiled and the application assertions passed on their first runs.

Candid gaps and limits:

- The initial outside-directory timestamp write is a recorded instruction violation.
- Query scans are bounded to 200 rows per range. This covers the complete specified seed and probes; this is not an unbounded production dataset implementation. Check emits one N_NO_CURSOR note for search; all tested top-level and nested pages report complete: true. No package ceiling was increased.
- The effect worker performs observable receipt/logging and settlement; it does not integrate an external email or push provider.
- The runner's independent verifier has not been run by this agent.

Schema classification and public-counter rationale are in run-log.md. digestPeriods is conservatively counted as a work table, though it persists emission identity rather than accumulating unread totals. There are no per-principal counter tables or auxiliary operations.

Preserved proof evidence: .acceptance/run-OIP7dy/evidence.json and .acceptance/run-NyRXUf/evidence.json, with server.log and the persistent backend store in each copy. Total wall clock: 505 seconds.
