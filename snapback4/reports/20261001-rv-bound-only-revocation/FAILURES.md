# Failure accounting

The first `scripts/test.sh` invocation was interrupted during `client models` by the model-capacity restart. Its log is `test-sh-interrupted.log`; it has **no final summary line**. No summary is inferred for that interrupted run. Its client phase reported 5,722 tests: 5,669 passed, 43 failed, 10 skipped. The corrected complete invocation is `test-sh.log`.

## Every failure in the interrupted canonical run

| Test/file | Count | Attribution and resolution |
| --- | ---: | --- |
| Rust artifact build: `column_commit`, `timeline_delivery` | 2 compile errors; one failed phase | **Ours.** StreamReply fixture initializers lacked the additive field. Fixed. The artifact-build follow-ups exposed the same omission in `clique_03/transport.rs` and `derived_maintains/disclosure.rs`; fixed too. |
| `answers-stay-review`: apply/admit/settle × held/throw × omitted/true keep | 12 | **Ours.** Lightweight watch stubs had no dependency table set. Missing metadata now classifies unknown instead of throwing. Bound/failure follow-up passes. |
| `codec`: shipped page codec extensions | 1 | **Ours.** Frozen apply reply expectation omitted the additive outer certificate. Exact expectation updated; payload unchanged. |
| `delivery-fault-matrix`: every delivery await explicitly classified | 1 | **Ours.** New `change-evidence.ts` missing from the file census. Added its zero-await hash; existing await hashes and all fault recipes unchanged. |
| `ephemeral-adoption`: durable-only wire shape, online/wasm | 2 | **Ours.** Exact wire checks now include only the additive preservation field. Request bytes and absence of ephemeral negotiation remain checked. |
| `event-slot-capability.test.mjs`, `event-slots.test.mjs` | 2 file failures | **Ours, cascading.** The failed Rust artifact build prevented `target/event-slots-traces.json` generation. The completed Rust target regenerated it; both files pass, 48 tests. |
| `keep-expiry`: failure re-read, wasm/process/online | 3 | **Ours.** A non-policy body update now deliberately retains through failure. Tests now assert that retention and withdrawal at the original expiry; all 28 expiry tests pass. Explicit replacement loading still withdraws. |
| `keep-observation`: local apply/admit/settle | 3 | **Ours.** Same absent-metadata stub issue; fixed without changing the assertions. |
| `per-row-inflight`: queue-bound controls, wasm/process × omitted/true keep | 4 | **Ours.** Insert-only evidence is now unbounded. The fixture batch also changes a read-rule owner column, retaining every original queue/episode assertion for revoking evidence. |
| `per-row-retention`: local active attempt, wasm/process | 2 | **Ours.** Non-policy label edit no longer starts a bound. Control now transfers ownership; it still checks the exact bound and late accepted replacement. |
| `raw-read-deadlines`: rearm existing episode, wasm/process | 2 | **Ours.** A harmless value edit no longer establishes the original episode. The control also changes an expiry input; all resubscription/episode assertions remain. |
| `read-existence-integration`: process same-key row arrival/delete | 1 | **Environmental/transient, unreproduced.** Hit the 122-second hang guard amid the broad run. Passed unchanged in the isolated 88-test deadline/existence follow-up. No causal diagnosis or baseline attribution is claimed. |
| `retention-episode`: grouped-commit deadline plus apply/admit/settle × omitted/true keep | 7 | **Ours.** Same missing dependency metadata on stubs; fixed conservatively. All assertions pass unchanged. |
| `wasm-codec-census`: typed JSON funnel and mutation control | 2 | **Ours.** Persistent summary decoder directly used serde. It now uses the existing JSON codec funnel; no census exception added. |
| `write-authority`: mutation replay identity | 1 | **Ours.** Initial acknowledgement key expectation now names `generation` and `preserved`, validates their types, and still checks the exact legacy replay response and absence of historical row data. |

Total client failures: **43** (42 lane-owned, one unreproduced environmental/transient timeout). No failure is claimed baseline without evidence. Full failing test names, variants and stacks are in `test-sh-interrupted.log`.

## Complete invocation after recovery

The complete run's broad client phase reports **5,769 tests: 5,758 passed, one failed, ten skipped**. Its single failure is **ours**: `a failed safe reread preserves the displayed answer dependency plan for the next safe event`. The worker loaded the build from before the two-event regression's fix. Both clients now preserve the displayed plan on a failed evaluation. The rebuilt package passes all 16 RV regressions and the 95-test affected sweep. No tests or seeds were disabled. The exact summary is `== 1 failure(s) in 1459 s` (`client tests`). All 79 client-model tests pass. See REPORT.md and `test-sh.log`.

The previously timed-out process row-existence test passes unchanged in this broad run too. The complete Rust inventory is green: 282 test binaries, 995 executions, plus doctests.

## Other unsuccessful development checks

- Initial whole-guide checks: stale retention fact inventory plus word budgets (three failures, then two, then one while shortening). **Ours.** Updated the exact moved fact and shortened prose without relaxing checks; 110/110 pass.
- Initial device codec comparison: additive outer apply certificate missing from the frozen baseline adapter. **Ours.** Narrow snapshot certificate assertion and unchanged payload comparison; both dispatch routes agree.
- Initial core directed test setup used a duplicate crate type and then an unconstrained indexed text column. **Ours, test setup.** Serde round-trip for the test schema and bounded text fixed setup; three classifier tests pass.
- Soundness model found missing derived row-key authorization input. **Ours, product.** Added aggregate source/row-key/parent and inherited authority dependencies; final 11,392-commit model passes. Other initial model failures were setup of original expiry/job programs, fixed before the reported run.
- Initial wasm build exceeded the old cap by 4,821 bytes. **Ours, required size increase.** Authorized ratchet increased to measured 610,046 + 500 bytes; final build passes.
- Rust follow-up had one exact legacy `/changes` wire failure: `serve::tests::ephemeral_tests::legacy_poll_reply_has_exact_base_shape`. **Ours.** Expected the additive field explicitly; corrected single test passes. The follow-up was itself interrupted before the remaining targets completed; it is not claimed a complete green run.
- Browser reruns hit a withdrawal-control wait. **Ours, harness.** Previous-phase competitors could occupy every local slot indefinitely; capacity wait remains excluded by the existing policy. Controls now drain prior work before holding the next phase, and evidence capture does not block the `/changes` response. No scheduler or deadline guarantee was weakened. Final qualification passes with eight held reads and 24 competitors.
- One intermediate follow-up still used the old mutation key expectation because the edit matched the wrong quote style. **Ours, test edit.** Corrected and passed in `replay-followup.log`.
- One attempted rule-sensitive label fixture violated the compiled sync/read policy. **Ours, test setup.** Replaced with an ownership transfer, preserving the original deadline assertions; `bound-followup.log` passes.

- The new two-event failure regression exposed dependency metadata being replaced by a failed online read's empty plan. **Ours, product.** Failed evaluations now preserve the displayed plan; the local publication path follows the same rule. The focused regression passes after the fix.
- A ref-check invocation from `snapback4/` incorrectly selected an empty LLP root and reported 1,354 missing references. **Ours, invocation.** The required root-level invocation passes; no reference rules were loosened.

The publication comparison's four Linux skips are a platform limitation, not passing macOS evidence. The darwin-arm64 run remains the operator's pre-landing check.
