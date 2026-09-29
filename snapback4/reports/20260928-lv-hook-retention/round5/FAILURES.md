# Round 5 failure accounting

No failure below is claimed as an unrelated baseline or environmental exemption.

| Run | Failure | Classification and disposition |
| --- | --- | --- |
| `before.log.gz` | All 7 new HTTP cases fail: online pre-discovery withdrawal/buffered direct reply; online direct-only buffered reply; process and wasm missing-metadata withdrawal/buffered reply. | **Ours, inherited from our round 4; expected pre-fix reds.** Three mounted-owner cases remain disclosed and four old direct replies disclose the secret. The request/registration/fallback changes fix these paths. |
| `focused.log.gz` | `process missing metadata: ephemeral replacement fences withdrawal at equal durable cut`: `timed out: initial ephemeral owners`. Aggregate 20 pass / 1 fail. | **Ours, cause unconfirmed.** Timeout happened before revocation; no disclosure assertion failed. No source change followed this timeout. Isolated rerun 2/2, 12 repetitions 24/24, and `focused-second.log.gz` 23/23 pass. This original red is retained, not relabelled green. |
| `mutant-last-owner-floor.log.gz` | Buffered reply accepted after the final owner is removed. | **Ours, expected mutation red.** New zero-owner assertion kills Astra's formerly surviving mutation. |
| `mutant-request-revision.log.gz` | Three online pre-discovery/direct-only disclosure failures. | **Ours, expected mutation reds.** Removing unconditional request capture recreates the High. |
| `mutant-response-owner.log.gz` | Pre-discovery mounted owner stays disclosed. | **Ours, expected mutation red.** Removing response-based registration is detected. |
| `mutant-peer-owner.log.gz` | A peer populated solely by a matching direct read stays disclosed. | **Ours, expected mutation red.** Removing matching-peer registration is detected. |
| `mutant-missing-metadata.log.gz` | All four process/wasm missing-metadata disclosure cases fail. | **Ours, expected mutation reds.** Restoring the empty-array fallback is detected. |
| `mutant-unknown-owner.log.gz` | Known-table evidence fails to withdraw the unknown owner. | **Ours, expected mutation red.** Omitting the unknown bucket is detected. |
| `mutant-unknown-floor.log.gz` | Unknown publication accepts a reply below a known-table floor. | **Ours, expected mutation red.** Skipping known floors for the unknown footprint is detected. |
| Setup | An extra `snapback4/` prefix from the `snapback4/` cwd prevented the first before-log redirection; the same prefix mistake prevented initial mutation-runner creation (`mutations.log.gz`). | **Ours, operational.** Corrected paths; removed the empty nested directory. These attempts ran no tests. |
| Orientation/edit setup | Guessed LLP/test paths did not exist; one LLP patch context did not match. | **Ours, operational.** Located the actual files; reapplied the atomic patch with the correct context. No partial product edit or verification claim. |

No full-suite failure or success is claimed: `scripts/test.sh` was deliberately
not invoked. The whole guide, build and typecheck pass. The supervisor owns the
next landing suite. Final broad affected results are recorded in `REPORT.md`.
