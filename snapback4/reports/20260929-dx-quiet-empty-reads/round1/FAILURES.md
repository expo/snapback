# DX round 1 failure attribution

The one requested full-suite run exited **0** with the exact summary
`== 0 failure(s) in 1332 s`. Every stage passed: **no full-suite failures are
ours, baseline or environmental**. The existing 60-second target is exceeded;
round 0 already recorded 1,520 seconds. No limit or timeout changed. The
intentional red controls and setup corrections below remain in the record.

| Failure or correction | Attribution | Evidence / resolution |
| --- | --- | --- |
| SIGTERM with a worker lost all eight refusal notices while a poll remained held | **Ours**, round 0 defect deliberately reproduced before the fix | `shutdown-before.log`: expected one counted line, got zero. Final process test passes after explicit shutdown acknowledgement. |
| SIGINT without a worker lost all eight notices | **Ours**, same round 0 defect plus direct signal exit without cleanup | `shutdown-before.log`: expected one counted line, got zero. Dev now enters managed cleanup without a worker; final test passes. |
| SIGTERM without a worker lost all eight notices | **Ours**, same direct-exit defect | `shutdown-before.log`; final test passes. |
| `every_cause_field_separates_identified_counts` with `executionSite` removed from `same_cause` | **Ours**, deliberate mutation control | `mutant-execution-site.log`: expected two lines, got one count-5 line. Exit 101; restored production code, then the full unit test selection passed. |
| Served EMPTY_READ card lacked shared-retention advice | **Ours**, Grok’s additional round 0 finding deliberately reproduced | `card-before.log`: the new served-card assertion failed before the prose change. Final process and whole-guide reruns passed. |
| Initial combined Cargo selection ran the five unit tests but selected zero process tests | **Ours**, filter setup | `affected.log` preserves the output. Zero tests are not counted as a process pass. Corrected unfiltered process/lifecycle command passed 20 + 21 tests. |
| Read-only inspection commands used a nonexistent root manual path, a nonexistent `worker_process.rs`, `.md` instead of `.rs` for the refusal card, and a file-backed signal-card path although the code description is inline | **Ours**, inspection setup | Correct paths were found with `rg`; the actual manual, worker, refusal card and inline signal-code description were read and updated. No check result was inferred from these failed reads. |
| A read-only status query prefixed `snapback4/` while already inside that workspace | **Ours**, inspection setup | Corrected the working-directory-relative paths. |
| Staged diff check flagged two original Markdown hard-break spaces in the copied Astra review | **Ours**, artifact formatting | Retained both review inputs as lossless gzip files; original bytes and source hashes are preserved. Final staged whitespace check passed. |
| Initial suite-process inventory expected one `bash scripts/test.sh` entry but also found its subshell | **Ours**, monitoring setup | Selected the root invocation, then followed its children and file descriptors to the owned parallel logs; `suite-process.json`. Only one suite was launched. |

The initial fetch/merge found one journal append conflict. Both prior entries
were retained and the merge committed before implementation; no semantic product
conflict existed. Compiler warnings for vendored `tiny_http` and unused web-only
items are inherited warnings, not failed checks.
