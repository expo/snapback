# Failure record

All development failures below are **ours**, including test/recipe mistakes.
No existing test count, timeout, workload or wasm budget was relaxed.

| Attempt | Every failure | Resolution |
| --- | --- | --- |
| Initial SDK build, bn-sdk.log | Missing generated wasm imports (TS2307 across web modules) | I started the SDK build before the fresh-tree wasm build completed. Build wasm, then SDK. |
| development-affected-1.log: 2 pass / 4 fail | Acquisition receipt, wipe, delete-row, change-groups all timed out before acquisition | A pre-acquisition subscription could await a blocked fallback. Measure the first SDK local query immediately after the acquired barrier. |
| development-affected-2.log: 4 pass / 2 fail | Receipt expected a notes group; change-groups control did not reject | History metadata alone does not enumerate all audience shapes. Add native inspection of actual per-group rows, boundaries and history. |
| development-affected-3.log: 5 pass / 1 fail | change-groups control did not reject | The unwindowed fixture had no history metadata to mutate; give the control fixture delivered-history so the deletion really changes coverage. |
| affected.log: 2 pass / 7 fail | Acquisition receipt, serve bearer, guide snippet, wipe, delete-row, change-groups and change-boundaries all failed on incomplete local query | The extended horizon fixture's ascending query was outside known coverage. Use a descending query on the actual horizon order. These controls had not reached their corruption step. |
| development-affected-6.log: 8 pass / 1 fail | serve bearer reconnect rejected an empty snapshot at watermark zero | Retention promises no downloaded held rows; an empty snapshot transfers none. Require zero row/scope events and equal coverage; explicitly report snapshot response count. |
| guide.log: 103 pass / 2 fail | published_text_needs_no_checkout_or_lane_reports; published_file_references_resolve_against_package_contents | Keep historical HV numbers and attribution self-contained, remove inaccessible report path from published prose, and list acquire.json as generated application output. |
| ref-check.log: 2 errors | Both new @ref annotations used an HTML anchor unsupported by ref-check | Use the governing numbered section #13. |
| full-suite.log: one failed script stage; two Node test failures | The liveness-probe success-body assertion in http-bounds.test.mjs omitted the added viewer field; its enclosing HTTP admission test also counts as failed | Ours. Updated the exact expected body to include viewer: dev:alice, preserving all previous checks. The whole affected file then passes 10/10 in http-bounds-final.log. |

Staged whitespace validation also found trailing spaces on Node assertion blank
lines and an extra guide-log EOF blank line (**ours**, captured-log formatting).
Normalized log trailing whitespace; no diagnostic, count or status changed.

Final affected checks: affected-final.log (9/9) and guide-final.log (106/106).
Full suite, run exactly once: `== 1 failure(s) in 1341 s` (exit 1).
Only the probe assertion and its parent failed; both are ours. Baseline: zero.
Environmental: zero. No unresolved introduced failures remain after the affected
10/10 rerun. The inherited nominal 60-second total-suite budget remains exceeded.
REPORT.md preserves the full-run counts and the later test-only correction.
