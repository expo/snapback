# WK round 5 failure ledger

## Detecting controls — expected failures, ours

- `restart-before.log.gz`: both `dev immediate host restart waits for the previous worker group and excludes ownership from Node` and the equivalent `serve` case failed on the merged, pre-fix binary. Each replacement recorded the old Node and helper still alive at startup. This is our inherited round-4 supervision defect. Repaired checks pass in `restart-fixed.log.gz` and all 117 affected tests.
- `open-abort-mutant.log.gz`: deleting only the first `signal.throwIfAborted()` from a disposable compiled ledger makes `aborting initialization blocked on SQLITE_BUSY rejects after the writer lock is released` fail: it returns a ledger instead of AbortError. The source/module used by the lane was not modified. Fixed check passes; production guard was already correct.
- `node-owner-mutant.log.gz`: changing watchdog close-on-exec restoration from false to true makes both immediate-restart tests fail specifically because Node holds descriptor 3 for store ownership. Restored the exact source in a finally block, rebuilt, and ran 117 affected tests successfully. No mutation remains.

## Grok detecting controls — expected failures, ours

`grok-before.log.gz` reports **0 pass / 8 fail** for inherited round-4 defects:

- `dev workers/push.mjs snapshot does not add the temporary directory to package lookup`
- `serve workers/push.mjs snapshot does not add the temporary directory to package lookup`
- `dev worker.mjs snapshot does not add the temporary directory to package lookup`
- `named snapshot refuses a symlinked snapback package manifest`
- `named snapshot refuses a symlinked project package manifest`
- `named snapshot refuses a symlinked ancestor package manifest`
- `dev startup clears a removed worker's stale running status after host death`
- `serve startup clears a removed worker's stale running status after host death`

The first three resolve the unexpected temporary-parent package; the next three run the declaration instead of refusing its linked manifest; the final two retain a running report for a removed declaration. `grok-fixed.log.gz`: **8/8 pass** after moving snapshots into private .snapback4 directories, copying every manifest with no-follow descriptors, and clearing prior status in startup retirement's transaction.

`commit-cap-mutant.log.gz`: both two-process retained-COMMIT variants fail when a disposable compiled module stops retrying after 100 attempts. Each reports `bounded busy commit` and loses the completed receipt. The extended test holds its real reader through 110 observed busy commits; the correct implementation passes all four contention/cancellation tests in `contention-extended.log.gz`. The overall test timeout remains ten seconds; its event wait supports the intentional ~2.75-second reader hold.

## Guide checks

- `guide.log.gz` and `guide-final.log.gz`: `familiar::cards_meet_word_targets_and_preserve_every_original_compiled_block` failed with `18300 -> 12822: less than 30% reduction`; 98 passed / 1 failed each. **Baseline after merging main, relative to round 5**: the counted six cards were unchanged by the effects-card edit. A baseline control restores the only changed language-crate file to merge HEAD and reproduces the same count (`guide-budget-baseline.log.gz`, 0 pass / 1 fail). The cap is 12,810 words. Final language-card wording removes duplication while preserving all compiled blocks and recorded facts; no budget changed.
- `guide-qualified.log.gz`: **ours**, the initial wording repair moved `language-00` out of its required Details home. `familiar::every_moved_fact_has_its_why_or_details_home` failed; 98 pass / 1 fail. Restored that exact Details text.
- `guide-complete.log.gz`: **ours**, deleting the duplicate opening left the first paragraph starting with a CLI spelling. `every_card_introduces_the_feature_before_examples_and_reference_details` failed; 98 pass / 1 fail. Restored a concise prose introduction and shortened the repeated-predicate lead. Final `guide-verified.log.gz`: 99/99 pass.

## Command setup errors — ours

- The first pre-fix build invocation used an extra snapback4/ prefix while already inside that directory. Log redirection failed before cargo started. Removed only the empty directory, corrected the path, and built successfully (`build-before.log.gz`).
- An initial language-card patch named language.md instead of language.rs. apply_patch refused without modifying a file; corrected the target.
- One combined documentation patch had stale context and was rejected without changes; reapplied with current context.
- Orientation searches named a few absent guessed paths; corrected them with repository searches. They supplied no test evidence and caused no changes.

## Follow-up verification setup — ours

- `routes-server-final.log.gz`: the command supplied a nonexistent `server.test.mjs` alongside routes; Node ran only 13 route tests, so it supplies no server qualification. The correct `server-e2e.test.mjs` was subsequently run in `server-final.log.gz` and passed 9/9.
- That route run passed 12 and failed `logout while a session route waits revokes its context before any later write or response`: generated entry readiness timed out with six worker-spawn `No such file or directory` messages. Our concurrent lifecycle Cargo invocation relinked target/debug/snapback4 at 09:52:00 UTC during this run. Linux current_exe can then refer to the replaced executable, making watchdog launch fail. The exact route passed unchanged after the build (`route-logout-recheck.log.gz`). We attribute the verification setup failure to ours, not a baseline/product repair or host-load excuse.
- `affected-qualified.log.gz`: 124 pass / 1 fail, `failed revocation blocks restart until the retired bearer is refused`, timed out waiting for its replacement. It overlapped the same CLI relink; the child log was not captured, so that connection is an inference, not independently demonstrated for this case. The final affected run uses a private byte-identical copy of the CLI so its path cannot be replaced by Cargo. No assertion or deadline was relaxed. Final stable-binary run: 125/125 passed (`affected-stable.log.gz`); final quiet route file: 13/13 passed (`routes-quiet-final.log.gz`). No product change was needed for these reruns.

## Full script

Ran `scripts/test.sh` exactly once, exit **1**. Exact summary:

```text
== 1 failure(s) in 1379 s
   cargo test
```

Its Rust stage reported these three failures; all are **ours**:

| Test | Cause | Follow-up |
| --- | --- | --- |
| `familiar::every_moved_fact_has_its_why_or_details_home` (guide target) | The full inventory captured the intermediate language-card edit that moved `language-00`. | Exact Details text restored; final whole guide passes 99/99. |
| `competing_starts_preserve_the_live_replay_policy` (replay target) | Unconditional five-second ownership waiting delayed the existing prompt refusal of a live host. | Wait only when the prior announced listener is not reachable; retain immediate refusal for a reachable host. |
| `release_token_owns_the_resolved_database_before_sqlite_open` (run_admission target) | Waiting behind an active token CLI let its five-second SQLite deadline expire; serve then tried SQLite and returned E_STORE instead of immediate E_STORE_BUSY. | An unannounced CLI owner again refuses immediately. |

The first two targets reported 98/1 and 14/1 pass/fail; run_admission reported 26/1. The final replay/run-admission rerun passes 15/15 and 27/27 (`admission-fixed.log.gz`); the final five-file rerun before Grok passes 117/117 (`affected-final.log.gz`). Final Grok follow-up: 125/125 affected, 204 host-unit passes with four declared ignores, 99/99 whole guide, 13/13 routes, 9/9 server end-to-end and 1/1 lifecycle pass. Full clients passed 4,820 with ten declared skips; final models passed 79/79. No baseline or environmental full-script test failure is assigned. The 60-second script budget remains an inherited baseline process-budget miss. The full invocation is not repeated or relabeled after repair.
