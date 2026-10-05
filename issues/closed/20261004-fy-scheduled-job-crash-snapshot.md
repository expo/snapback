# Snapback 4: scheduled job crash fixture observes completion after queued snapshot

Status: Closed — resolved 2026-10-04
Reported by: Lane SU, assigned to FY
Date: 2026-10-04
Baseline: `ce9bef594a`; SU full suite at `2154dc163d` plus test-only Rust changes

The real serving process can run maintenance between an unwitnessed SIGSTOP request and SIGKILL. The fixture expects a queued zero-chunk job after exit, but the stdout listener banner is not a maintenance barrier.

SU observed this failure in the full eb1000 suite; the affected fixture was
byte-identical to main and passed its isolated retry. Keep the production
semantics and descendant-death assertions; do not mask a product defect.

## Resolution

The explicit unused worker's synchronous `SNAPBACK_NODE` version probe now
stops its parent after real schedule admission and before maintenance starts.
The fixture witnesses stopped state, reads the queued zero-chunk/zero-write
job, witnesses SIGKILL exit, and compares the unchanged complete job record
before any restart. Ordinary restarts retain the same job ID, exactly one
execution, and exactly one queued effect. Only the schedule clock is edited.

Delayed-stop and synthetic post-snapshot execution controls reproduce the
baseline race mechanism; a 2.5 s delay after the new barrier passes. No product
defect was found.

Verification: each complete affected file passed 30/30 runs on eb1000 under
confined CPU load and 30/30 on the permitted Apartment mini. The complete
eb1000 suite passed with zero failures in 1,957 seconds. See the
[FY report](../../snapback4/reports/20261004-fy-fixture-races/REPORT.md)
for controls, source hashes, logs and limits. Test-only repair; nothing pushed.
