# Final report

Built a Quarry backend in snapback/schema.q and a headless Node seed, wire client and acceptance harness in scripts/. The sole dependency remains snapback4@0.2.9. All five application answers, ranking, UTC buckets, grouping, receipt state and digest counts are computed in Quarry.

Proofs passed:
- snapback4 check: 15 tables including maintains, 14 operations, no problems.
- npm run seed installed the exact specified dataset through application HTTP mutations in an empty persistent backend. It performs no acceptance changes or worker/server launch.
- npm run acceptance passed initial exact answers and completeness checks, alternate clocks, actual scheduled two-minute firing, claimed/observed/settled effects, duplicate digest runs across a backend restart, following periods, receipt thresholds and monotonicity, member departure, authorization refusals, live ranking and insights updates, message search/digest updates, zero unread effects and no-recipient read state.
- run-log.md records the schema shape, counter visibility and design choices.

Wall clock by milestone (seconds since start):
- Documentation and design: 0–33 (33 seconds).
- Quarry schema and first clean check: 33–166 (133 seconds).
- Headless seed/client/acceptance implementation and first execution: 166–399 (233 seconds).
- Wire proofs, real schedule wait, restart and positive probes: 399–512 (113 seconds, including final record).
- Total: 512 seconds.

Correction loops:
- loop=1, agent-error: the initial clock command wrote a timestamp to /tmp/ceremony-time-unused before run-log.md was created. Subsequent work was confined to the current directory. This was a scope violation, not a package defect; no external source or prior implementation was read. The command itself succeeded; the failed requirement was directory confinement and log-first ordering.
- No schema/compiler or acceptance correction loops occurred. The first schema check and first acceptance run passed.

Candid gaps and tradeoffs:
- The initial out-of-directory clock write remains the procedural gap noted above.
- Membership identities form an intentionally public directory; chat/message/acknowledgment contents remain membership-protected. Per-principal counters are private; only the public-post like counter is world-readable.
- This is bounded for the requested small complete dataset: 100 memberships per user/chat, 500 messages per chat, and bounded social query pages. No claim is made that unbounded datasets produce full answers.
- The worker's performed effect is an append-only delivery record plus real wire settlement; no external email/push provider was requested or integrated. It does not suppress duplicate emissions.
- Acceptance ran once end to end; repeated-run isolation is implemented with unique temporary project copies and persistent stores inside this directory, but a second full run was not performed before stopping at green.

Evidence is preserved in .acceptance/case-arBtuo/: acceptance.log, server.log, delivered-effects.jsonl and the persistent store. Both server launches retained their child handle/PID and were closed by the harness; no unowned process was discovered or killed.
