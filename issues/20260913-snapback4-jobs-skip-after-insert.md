# Snapback 4: job chunks never run `after insert` / `check_final_exists`

Status: Open
Priority: P2
Date: 2026-09-13
Systems: jobs
Author: Grok 4.6 (comprehensive review of origin/main `f9bf18f0e`)

## Problem and reproduction

Mutations run `check_final_exists` after the program body; local predictions do too. `run_job_chunk` runs the chunk, appends the log, and commits without that check.

A job body may `insert`. Probe: `after insert <- exists targets[.name]` on `sources`, job `insert sources { name: 'ghost' }` with no matching `targets` row. The run finished `Done` with `error: None` and one `sources` row stored. The same insert in a mutation would refuse `E_CONSTRAINT`.

## Implementation locations

- [snapback4/crates/snapback4-core/src/engine/job.rs](../snapback4/crates/snapback4-core/src/engine/job.rs) (`run_job_chunk`)
- [snapback4/crates/snapback4-core/src/engine/mod.rs](../snapback4/crates/snapback4-core/src/engine/mod.rs) (mutation path that does call it)
- [snapback4/crates/snapback4-core/src/engine/local.rs](../snapback4/crates/snapback4-core/src/engine/local.rs)

## Suggestion

After a successful chunk body, call `runner.check_final_exists()?` before `record_commit` / `append`, and park on that refusal like any other chunk refusal.
