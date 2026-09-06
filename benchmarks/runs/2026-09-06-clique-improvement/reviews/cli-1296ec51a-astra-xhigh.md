**READY**

No material findings attributable to this delta. Reviewed `change.patch`—which contains nine changed paths—the corresponding files, and relevant callers/LLP1002 sections.

Help dispatch precedes project lookup and owner actions. Guide routing preserves `{ page, content }`. Migration recovery uses canonical absolute paths with correct POSIX quoting for spaces/apostrophes, advertises commands only after successful writes, and applies the saved project/plan. The check-versus-install guidance matches the handlers.

Optional coverage, nonblocking:

- [guide.rs:7](/Users/ccheever/clique-improvement/reviews/cli/snapback2/crates/snapback2/tests/guide.rs:7): add no-argument invocation and help alongside destructive options against a running owner.
- [wire_lifecycle.rs:502](/Users/ccheever/clique-improvement/reviews/cli/snapback2/crates/snapback2/tests/owner_cases/wire_lifecycle.rs:502): cover replacement-plan selection, stale-plan refusal, failed plan writes, and relative apply paths with `--project`.

Static review only. The reported 11 guide/86 owner tests, two existing ignores, and build/caps/refs results were not independently verified; no tests, edits, network, or credential access performed.