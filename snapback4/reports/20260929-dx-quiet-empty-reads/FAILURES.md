# Failure attribution

The single final `scripts/test.sh` run exited 0:
`== 0 failure(s) in 1520 s`. Every stage passed. No final-suite failure is
attributed to this lane, the baseline, or the environment. The earlier failed
checks and measurement/setup corrections below remain part of the record.

| Failure / correction | Attribution | Resolution and evidence |
| --- | --- | --- |
| `uninstrumented_refusals_replays_and_empty_reads_replace_older_causes` expected an unrequested empty read to replace the last refusal | **Ours**, obsolete expectation after the deliberate policy change | Its empty-read portion now runs with `--trace-empty`; the new default-mode test asserts the old refusal remains. Initial `affected-process.log`: 15 passed, 1 failed. Final `affected-process-final.log`: 16 passed, 0 failed. |
| `familiar::every_moved_fact_has_its_why_or_details_home` | **Ours**, expanded E_RULE card exceeded 4,096-byte rendered limit | Initial rendered length 4,427 B, then 4,167 B and 4,108 B during shortening. Removed the extra console-detail paragraph from this short card; the full refusal guide and operations manual retain the explanation. `guide.log`, `guide-final.log`, `guide-pass.log` retain the failures; `guide-complete.log` passes all 98. |
| `w9b_every_code_has_bounded_card_context_and_a_full_card_command` | **Ours**, same E_RULE size defect | Same three failing runs and final 98/98 pass above. No size limit raised and no facts removed from their tested homes. |
| Two affected-test shell commands used a report path relative to the repository root rather than `snapback4/` | **Ours**, command setup | Output redirection failed before Cargo ran. Corrected working directory; the affected tests then ran and passed. |
| First host-test filter selected zero tests | **Ours**, verification setup | Excluded from pass counts. Correct `refusal_tests` filter ran all three memory/reader/source-map tests in `affected-host-final.log`. |
| First two new HTTP benchmark runs used Cargo's optimized test executable against an ordinary-dev baseline | **Ours**, measurement setup | `after-1`/`after-2` are explicitly superseded. Rebuilt with `cargo build -p snapback4`; `matched-*` results use matching dev profiles. Source-module benchmark also uses the same profile on both sides. |
| Staged `git diff --cached --check` flagged five saved test logs with extra blank lines at EOF | **Ours**, artifact formatting | Normalized only terminal blank lines, retained every result, and amended the local commit after the complete diff check passed. |
| Environment inventory tried `wasm-opt --version` without checking availability | **Environmental**, optional tool absent; **ours**, inventory assumed it | Inventory now records absence. Canonical build-wasm supports this environment and passed its unchanged size cap; no optimized-build claim. |

The warnings for vendored `tiny_http::MustBeShareDummy` and unused web-build
code are inherited compiler warnings, not failed checks. The standalone
measurement host's private-interface warning is confined to its temporary
wrapper and is not a product warning.
