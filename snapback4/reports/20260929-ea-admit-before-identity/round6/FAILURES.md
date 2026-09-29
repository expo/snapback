# EA round 6 failure ledger

The unsuccessful checks below are deliberate negative controls of this lane's
bugs or coverage, classified **ours**. They are not baseline or environmental
failures. No product assertion, deadline, model count or budget was relaxed.

| Evidence | Failures | Attribution and disposition |
| --- | --- | --- |
| `negative-baseline.log` | 1: offline cached backend to real /schema refresh preserves waiting admission | Ours, round-5 comparator reproduced before the repair. Real module installation and /schema refresh succeed, then the write falsely returns E_ADMISSION_STORE instead of pending. The two new suspended-runtime tests pass existing production. |
| `mutant-raw-backend.log` | 1: same real cached-backend refresh regression | Ours, deliberate restoration of raw JSON.stringify after the repair. The same false refusal is detected. |
| `mutant-deadline-both.log` | 2: late initial and late final identity before timer delivery | Ours, deliberate removal of both post-I/O wall-clock checks. Both incorrectly admit and fail the E_ADMISSION_TIMEOUT assertion. |
| `mutant-deadline-initial.log` | 1: late initial identity before timer delivery | Ours, deliberate removal of only the initial check. Final check still refuses, but the test detects the extra final read after the already-expired initial read. |
| `mutant-deadline-final.log` | 1: late final identity before timer delivery | Ours, deliberate removal of only the final check. The call incorrectly admits. |

All mutants touched only the generated identity-admission.js, with exact bytes
restored in a finally block before positive checks. `mutation-exits.json` records
exit 1 for each mutated run. The new real regression is adapted from Astra's
retained temporary review probe, with original-ID, single admission/POST and
terminal-outcome assertions added. Its fresh response is received from the
server, never manufactured from the cached representation.

The completed Rust and client stages of the single full run have zero failures:
Rust 4,331 passed / 33 declared ignores; clients 5,166 passed / 10 existing skips,
zero cancellations. All full-run source inputs remain frozen. The final full-run
summary and complete attribution are recorded in REPORT.md after completion.

Final full-run result, exit 0: `== 0 failure(s) in 1253 s`.
Models passed 79/79 with all 10,000 session and 3,000 online-client sequences.
Full-run attribution: **ours 0, baseline 0, environmental 0**. No unexpected
failure occurred in any round-6 positive verification run. The six failing
assertions across the five deliberate negative runs above are preserved.
