# Failure ledger

- Environmental setup: the first SDK build in the fresh worktree lacked generated wasm bindings (`web-wasm.ts`, `web-worker-runtime.ts`, `web.ts`, TS2307). Used BN's same-source generated artifact for baseline; final qualification rebuilds it locally. `install.log` and `sdk-baseline.log` preserve the attempts.
- Ours: first crash-model compile omitted the `Value` import (eight Rust errors). Added the import; the second compile passed. `crash-build.log`, `crash-build-2.log`.

The single complete-suite run finished with exit 0 and exact summary
`== 0 failure(s) in 1380 s`. Full-suite failures: ours **0**, baseline **0**,
environmental **0**. Rust: 4,367 pass / 33 existing ignores; clients: 5,317
pass / 10 existing skips; client models: 79 pass; fixture wrappers: 9 pass.
There are no cancellations or new skips. The inherited 60-second suite-time
budget remains exceeded; it is not enforced as an assertion by the suite.
Development and setup failures below were corrected, or explicitly excluded
from qualification. All original logs remain available.

- Ours, attribution harness: direct replay initially parsed the first-install envelope as a Backend (`missing field generation`); the next extraction probe selected `backend` instead of `initial_backend` and left no input file. Both attempts abort before acquisition. Corrected the replay to use the product Opening parser; the baseline executable was supplied the extracted initial backend on a fresh store. Logs `direct-before-stderr.log` and `direct-before-stderr-2.log`.
- Ours, attribution method: ordinary strace perturbs every syscall even with a narrow reporting filter. Stopped that owned replay after its staging timings showed the perturbation; attempt 3 is excluded from timing claims. Repeated with seccomp BPF filtering, recording the attempt separately.

- Ours: the first bulk-index test compile omitted the required fixture directory tag for `Sqlite::new`; supplied the tag. `native-affected-first.log`.

- Ours: bulk-index runtime control used the ordinary chat fixture, whose non-expiring caps do not create `_cap_counts`. Replaced it with an expiring capped, word-indexed fixture so the counter assertion is real. The crash model passed 48 kills in this run. `native-affected-second.log`.

- Ours: the revised bulk fixture included an unnecessary unconstrained `collect()` on Engine::seed input (E0283); removed it. `bulk-final.log`.

- Ours, diagnostic wording only: the adapted harness retained BN's fixed “three runs passed” progress string for single-run profiles/probes. The receipts correctly record one run. Corrected the future progress string; original logs are preserved.

- Ours, verification scheduling: stopped the preliminary serial `cargo test -p snapback4-device` command to avoid serially duplicating the complete suite. Its paired-world privacy model finished before the stop signal (the recorded child PID had already exited); the Cargo command exited 143. No assertion failure had appeared. This partial run is not claimed as a complete device qualification. The focused acquisition/adoption/retention/prediction/reopen targets run explicitly in `device-focused.log`; the single requested complete suite runs every original model/count through its existing parallel Rust runner. `device-suite.log` preserves the interrupted attempt.

- Ours, guide: first whole-guide run passed 103 and failed three (`definitions::heaviest_account_aliases_reach_the_executable_acquisition_recipe`, `client::published_text_needs_no_checkout_or_lane_reports`, `client::published::published_file_references_resolve_against_package_contents`). The compacted text removed a required orientation phrase and linked a repository-only report from the published guide. Restored the phrase and replaced the unshipped link with self-contained results; no tests were changed. `guide.log` preserves the red; `guide-final.log` is the corrected run.

- Ours, report aggregation: an ad-hoc receipt check first looked for `run.residency` instead of `run.coverage.residency` and stopped with KeyError before writing evidence. Corrected the field path; all 24 receipt comparisons pass in `receipt-checks.json`.

- Ours, report packaging: the first staged whitespace check flagged redundant EOF blank lines in captured logs and necessary blank-context prefixes in unified patches. Preserved raw log bytes in adjacent `.raw.log.gz` copies, trimmed only redundant EOF blank lines in display logs, and stored patches losslessly as `.patch.gz`; the repeated staged check passes. No test output or result was changed.
