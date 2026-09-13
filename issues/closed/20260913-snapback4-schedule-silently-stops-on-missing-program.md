# Snapback 4: A schedule whose program is gone silently stops firing

Status: Closed
Severity: major
Priority: P1
Area: correctness
Observed: 2026-09-13
Evidence: Code-traced
Baseline: `6918cccbc264cf000982b03a5a11a2cf5563f885` / Snapback 4 0.1.15
Review provenance: Snapback4 comprehensive-review synthesis (2026-09-13 child review)

## Problem and reproduction

In [job.rs](../../snapback4/crates/snapback4-core/src/engine/job.rs):288-293,
`fire_schedules` looks up `self.programs.get(&schedule.target)` and, when
the program is missing (renamed or deleted target), writes the boundary
into `_meta`, commits, and `continue`s — no job, no error, no log row:

```rust
let (Some(program), Some(_)) = (program, last) else {
    tx.set_meta(&key, &boundary.to_string())?;
    tx.commit()?;
    continue;
};
```

Renaming a job target therefore silently kills the schedule: every future
boundary is recorded as done while nothing ever runs. This is distinct
from `20260913-snapback4-jobs-skip-after-insert` (missing
`check_final_exists`) and `20260913-snapback4-schedule-rewinds-double-fire`
(rewind semantics).

## Implementation locations

- [crates/snapback4-core/src/engine/job.rs](../../snapback4/crates/snapback4-core/src/engine/job.rs) (`fire_schedules`)

## Suggestion

Refuse loudly: when the target program is missing, record a failed job run
(or a schedule error row) naming the schedule and the missing target
instead of committing the boundary as satisfied. Alternatively refuse the
schema adoption that drops a targeted program while a schedule names it.
Add a test: schedule names deleted target -> visible error, boundary not
marked satisfied.

## Resolution — 2026-09-13

Engine activation refuses a schedule whose target is missing or is not a job, and validates period/offset. The test drops the targeted program and observes refusal without changing the active generation or scheduled jobs.

Integrated implementation: `4b70bdb6f` and `3d2007794`, plus the HTTP/device follow-ups where applicable. Focused core, simulator and host regressions passed. Full integrated suite and scoped blind review are recorded in the append-only Snapback4 journal before publication.
