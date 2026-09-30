# Failure ledger

The final qualification is reported separately in REPORT.md. These are all failed development checks and detecting controls, preserved rather than relabelled. No test failure was attributed to environment.

Build/setup failures:

- **Ours:** the first Rust build returned E0271: the new iterator supplied `&String` where `&str` was required. Corrected before device tests.
- **Ours:** the first wasm build exceeded 593,719 B by 1,721 B. The required audience dependency metadata measured 595,440 B; the cap and rationale are updated in this commit.
- **Environmental setup:** `python` was absent; the installed `python3` ran the edit script. No test was skipped.
- **Ours, setup:** a line-compaction edit script could loop after exhausting blank lines. It was stopped before writing local.ts; the edit was applied correctly with python3. No test ran on partial local.ts bytes.

Development test corrections: invalid `select` syntax in the new fixture (six cases); a mistaken `connection()` spelling (two cases); opt-in inspection needed to seed queue timing at opt-in (one case); two existing online expectations needed the requested queue-inclusive bound; and the new offline-before-commit test initially sampled before its injected asynchronous commit and included legal pre-removal offline publications (two cases). Each was corrected with the withdrawal requirement intact.

## affected.log — ours

- online keep=undefined: invalidating an acquisition leaves replacement queue wait outside the episode
- online keep=true: invalidating an acquisition leaves replacement queue wait outside the episode

## assertion-round1.log — ours — expected rejection of deliberate stale-reply mutation

- wasm: apply revocation, keep=undefined, throw
- wasm: apply revocation, keep=undefined, unavailable
- process: apply revocation, keep=undefined, throw
- process: apply revocation, keep=undefined, unavailable

## offline-order.log — ours

- wasm: offline-before removal only withdraws its room and resumes
- process: offline-before removal only withdraws its room and resumes

## regressions-first.log — ours

- wasm: published removal only withdraws its room and resumes
- wasm: staged removal only withdraws its room and resumes
- wasm: offline removal only withdraws its room and resumes
- process: published removal only withdraws its room and resumes
- process: staged removal only withdraws its room and resumes
- process: offline removal only withdraws its room and resumes

## regressions-second.log — ours

- wasm: offline removal only withdraws its room and resumes
- process: offline removal only withdraws its room and resumes

## round0-controls-complete.log — baseline — deliberate round 0 negative control

- unused inspection records no timings and allocates no withdrawal callbacks
- compound scope matching skips disjoint groups and watches with no tables
- wasm: published removal only withdraws its room and resumes
- wasm: staged removal only withdraws its room and resumes
- wasm: offline removal only withdraws its room and resumes
- wasm: offline-before removal only withdraws its room and resumes
- process: published removal only withdraws its room and resumes
- process: staged removal only withdraws its room and resumes
- process: offline removal only withdraws its room and resumes
- process: offline-before removal only withdraws its room and resumes
- wasm: terminal change-feed refusal bypasses eight occupied slots
- process: terminal change-feed refusal bypasses eight occupied slots
- online scope-ambiguous change evidence expires while waiting for capacity
- online viewer replacement is inspected as viewer, not schema reset

## round0-controls-final.log — baseline — deliberate round 0 negative control

- unused inspection records no timings and allocates no withdrawal callbacks
- compound scope matching skips disjoint groups and watches with no tables
- wasm: published removal only withdraws its room and resumes
- wasm: staged removal only withdraws its room and resumes
- wasm: offline removal only withdraws its room and resumes
- process: published removal only withdraws its room and resumes
- process: staged removal only withdraws its room and resumes
- process: offline removal only withdraws its room and resumes
- wasm: terminal change-feed refusal bypasses eight occupied slots
- process: terminal change-feed refusal bypasses eight occupied slots
- online scope-ambiguous change evidence expires while waiting for capacity
- online viewer replacement is inspected as viewer, not schema reset

## round0-controls-new-mount-final.log — baseline — deliberate round 0 negative control

- a pending group removal fences an initial observation until actual publication

## round0-controls-new-mount.log — ours — negative-control compatibility error, corrected in final control

- a pending group removal fences an initial observation until actual publication

## round0-controls.log — baseline — deliberate round 0 negative control

- unused inspection records no timings and allocates no withdrawal callbacks
- compound scope matching skips disjoint groups and watches with no tables
- wasm: published removal only withdraws its room and resumes
- wasm: staged removal only withdraws its room and resumes
- wasm: offline removal only withdraws its room and resumes
- process: published removal only withdraws its room and resumes
- process: staged removal only withdraws its room and resumes
- process: offline removal only withdraws its room and resumes
- wasm: terminal change-feed refusal bypasses eight occupied slots
- process: terminal change-feed refusal bypasses eight occupied slots
- online scope-ambiguous change evidence expires while waiting for capacity
- online viewer replacement is inspected as viewer, not schema reset

## withdrawal-first.log — ours

- inspection groups shared observations, measures queue/attempt time, and records bounded withdrawal causes
