# snapback2: run exits zero for a rejected mutation

**Status:** Open
**Systems:** snapback2, CLI, mutation wire
**Severity:** P2
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/crates/snapback2/src/verbs.rs:274-287

Failure scenario: snapback2 run invokes a mutation whose db.require is false or whose write violates a constraint. The CLI prints {"state":"rejected",...} but exits 0, so a shell, CI job, or agent records the failed write as successful.

Why it happens: print_response decides success only from HTTP status. The mutation endpoint intentionally returns typed committed/rejected states with HTTP 200, and no run caller inspects body.state before returning the exit code.

Suggested fix: have the run verb recognize a mutation rejected state and exit 1 while preserving the JSON body; keep query typed states successful. Add process-level exit-code cases for committed, rejected, transport refusal, and denied query.
