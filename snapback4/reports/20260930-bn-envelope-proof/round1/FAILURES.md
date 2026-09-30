# BN round 1 failure ledger

## Development and expected negative controls

| Invocation | Classification | Failure and disposition |
| --- | --- | --- |
| Initial evidence/install setup | Ours, shell setup | Used a repository-relative path while already in `snapback4/`; log redirection failed before install. Moved the two copied reviews to the intended round1 directory, removed the empty accidental directories, then installed successfully. |
| First final-build command | Ours, shell setup | Used a workspace-relative log path from the repository root. Redirection failed before Cargo ran. Correct workspace invocation passes. |
| First apply-audit affected command | Ours, shell setup | Same log-directory mistake; redirection failed before Node ran. Correct workspace invocation passes. |
| `guide.log` | Ours, integration/docs | Two assertions: `client::native_smoke_is_the_milestone_path_with_honest_limits` (merged witness card exceeded 399 lines) and `client::published_text_needs_no_checkout_or_lane_reports` (bounds named internal lane NA). Kept both commands, compacted prose to 399 lines, kept NA ownership in LLP/report, and removed it from published prose. `guide-final.log`: 107/107. |
| `apply-audit.log` | Ours, development | Additional proxy control showed the first round 1 implementation accepted an invalid acknowledgement map: terminal watermark equality did not prove native publication. Added native sync validation/application failure capture and required a successful terminal native apply. Added bad-ack and bad-acquisitions regressions. `affected-apply.log`: 25/25. |
| `native-binary-before.log` | Ours, post-suite compatibility audit | The stricter generic transport parsed a valid `/native.wasm` response as JSON. Positive real-module install/restart failed; digest-refusal control passed. Preserve binary download and observe native install errors; both pass afterward, with final combined affected tests 37/37. |
| Initial staged `git diff --check` | Ours, evidence formatting | Captured Node diagnostics had trailing whitespace, and the guide log had an extra EOF blank line. Normalized whitespace in retained logs; final staged diff check passes. |
| `round0-controls.log` | Expected negative controls | All 15 selected regressions fail on the exact round 0 helper/guide and recorded production binary. These are intentional controls, not current failures or baseline failures of the full suite. Four request-failure variants already exited nonzero but lost their failed-run evidence; the report distinguishes these from false successes. |
| `round0-apply-controls.log` | Expected negative controls | Both additional malformed native-payload cases fail on round 0. |

The initial affected run passed 22/22. After separating the hosting and timing
tests, the combined witness/HTTP run passed 33/33. Adding native sync-payload
checks and keeping 401 diagnostics explicit brought that to 35/35. The final
post-suite binary-native correction passes **37/37** (27 witness, ten HTTP).
No tests, workload counts, timeout guards or assertions were relaxed. No
environmental failure was observed in these development checks.

## Full suite

One client case failed: `process: pending cut preserves presentTransition before
sync publication`, at `live-propagation-fallback.test.mjs:96` through the
`turns()` assertion at line 34, `notification starts sync`. Classification:
**baseline**, with root cause unresolved. Its test, helpers and SDK source are
identical to round 0 and merged base 28014164c6; the separate witness helper is
not loaded by this case. Do not infer a specific scheduling or network cause.
The unchanged whole file rerun passes 10/10 (`live-propagation-rerun.log`);
the focused case on the preserved pre-round-1 debug binary passes 1/1
(`live-propagation-round0.log`, binary SHA-256
7f96ffed342c52322dc04226a84cab995d7234740233e94cb2d794532ecf7f90).
These passing reruns do not erase the full-suite failure. Follow-up:
[notification/sync intermittent ticket](../../../../issues/20260930-snapback4-live-propagation-notification-sync-intermittent.md).

The apply-audit correction and safe 401 diagnostic occurred while the suite was
in its build/Rust stages, before its client stage. Before/after/final source
snapshots are retained; product/test sources stayed unchanged from
`source-qualified.json` through the client stage. This is not described as
unchanged-source qualification.
After the full run, the binary-native compatibility correction changed only
the witness helper/test; `source-final.json` records it. Final affected checks
pass 37/37. The full suite was not rerun.

Exact full-suite summary: `== 1 failure(s) in 1265 s`, exit 1. Only the client
stage failed (12/13 stages pass). Rust 4,368 pass / 33 existing ignores;
clients 5,336 pass / one fail / ten existing skips; fixture wrappers 9/9;
full-count models 79/79. No cancellations. Full-suite classifications:
**ours 0, baseline 1, environmental 0**. The development failures above are
ours and are separately preserved; none is relabeled as a passing invocation.
