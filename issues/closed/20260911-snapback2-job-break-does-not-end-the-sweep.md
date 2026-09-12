# Snapback 2 job `break` / `return` does not end the sweep

**Status:** Resolved
**Priority:** P1
**Date:** 2026-09-11
**Systems:** `snapback2/crates/snapback2-core/src/engine/jobs.rs` (`execute_job_chunk`)
**Source:** Snapback 2 codebase review 2026-09-11
**Related:** LLP 1016 D2 (a job is a sequence of sweeps)

## Symptom

`execute_job_chunk` materializes one page, then runs the chunk body with `statements_at`. `Flow::Break` and `Flow::Return` only `break` that inner loop. `exhausted` requires `page_finished` (every prefetched row processed). After a `break` on row k of a full page, `page_finished` is false, the cursor is set to k, the chunk **commits**, and the next chunk scans `after` that cursor. Remaining rows still run.

Ordinary `Stmt::For` in `runner.rs` treats `Break` as end of the loop. Jobs re-invoke the same `For` as later chunks, so `break`/`return` cannot terminate a sweep. Job inspect does not refuse `Break`/`Return` in a chunk body.

`Continue` is fine (skips one row’s body).

## Evidence

```117:145:snapback2/crates/snapback2-core/src/engine/jobs.rs
            match runner.statements_at(body, ...)? {
                Flow::Next | Flow::Continue => {}
                Flow::Break | Flow::Return(..) => break,
            }
        }
        let page_finished = processed == visited.len();
        ...
        job.cursor = visited.last().map(|(key, _)| key.clone()).or(job.cursor);
        let exhausted = page_finished
            && (visited.len() < take as usize
                || job.cursor.as_ref().zip(job.upper_key.as_ref()).is_some_and(|(a, b)| a == b));
```

## Proposed patch

Treat `Break` as end of **this sweep** (advance `job.sweep`, clear cursor/upper_key). Treat `Return` as end of **the whole job**.

```rust
        let mut processed = 0;
        let mut stop_sweep = false;
        let mut stop_job = false;
        for (_, row) in &visited {
            runner.env.insert(binding.clone(), row.clone());
            processed += 1;
            match runner.statements_at(body, &format!("{}:statement:{}", program.name, job.sweep + 1), "")? {
                Flow::Next | Flow::Continue => {}
                Flow::Break => {
                    stop_sweep = true;
                    break;
                }
                Flow::Return(..) => {
                    stop_job = true;
                    break;
                }
            }
        }
        let page_finished = processed == visited.len();
        visited.truncate(processed);
        ...
        let exhausted = stop_sweep
            || stop_job
            || (page_finished
                && (visited.len() < take as usize
                    || job
                        .cursor
                        .as_ref()
                        .zip(job.upper_key.as_ref())
                        .is_some_and(|(a, b)| a == b)));
        ...
        if exhausted {
            if stop_job {
                job.sweep = job_certificate.sweeps.len();
                job.state = "done".into();
                job.finished_at = Some(now);
                job.cursor = None;
                job.upper_key = None;
            } else {
                job.sweep += 1;
                job.cursor = None;
                job.upper_key = None;
                if job.sweep == job_certificate.sweeps.len() {
                    job.state = "done".into();
                    job.finished_at = Some(now);
                }
            }
        }
```

Alternative: refuse `break`/`return` at job inspect with `E_JOB_SHAPE` if jobs are not supposed to use them. Prefer matching ordinary `For` semantics — authors will write `break`.

## Acceptance

- A certified job whose chunk body `break`s on the first of 100 prefetched rows must not process row 2 on the next chunk. Sweep advances (or the job completes if it was the last sweep).
- `return` from a chunk body marks the job `done` without further sweeps.
- `continue` still skips one row and processes the rest of the page.
- Add a core test next to the existing job chunk tests.

## Resolution (2026-09-12)

Job chunks now preserve normal flow semantics: Break ends its sweep, Return ends the entire job, and Continue advances to the next row. The receipt records only the processed prefix of a prefetched page, and completed sweeps clear their cursor/upper key.

Validation: the integrated core jobs suite passed 26 tests (one ignored), including a 100-row, two-sweep regression covering all three forms and proving statements after them are unreachable.
