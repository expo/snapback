# Round 3 failures and controls

No red result below is erased by a later successful run.

| Invocation | Failure | Attribution and disposition |
| --- | --- | --- |
| Pre-fix `red-controls.log` | `supervised workers/push.mjs refuses refresh without logging a bearer across split writes` | **Ours, expected control against round 2:** successor bearer found in logs. Fixed; same control passes. |
| Same | `supervised worker.mjs refuses refresh without logging a bearer across split writes` | **Ours, expected control against round 2:** conventional worker has the same leak. Fixed; same control passes. |
| Same | `private worker snapshot resolves schema-local packages` | **Ours, expected control against round 2:** `ERR_MODULE_NOT_FOUND`. Fixed; same control passes. |
| Same | `private worker snapshot resolves schema-local packages before project packages` | **Ours, expected control against round 2:** actual entry/helper values `project`, expected `schema`. Fixed; same control passes. |
| `build.log` | Rust E0603: `identity::digest` is private | **Ours, implementation error:** used the existing host SHA-256 pattern instead. `build-fixed.log` and full-suite build pass. |
| `guide.log` | `definitions::w11_every_registered_code_quotes_its_definition` | **Ours:** new public code needed entries in the existing definition and recovery inventories. Repaired; whole-guide rerun passes 98/98. |
| Same | `w11_every_registered_code_has_a_dedicated_section` | **Ours:** new public code needed default routing to its effects-card paragraph. Repaired; whole-guide rerun passes 98/98. |
| `mutant-standalone-redaction.log` | `standalone worker reports errors containing its bearer with automatic redaction` | **Ours, intentional mutation control:** deleting automatic bearer replacement from a disposable compiled worker exposes the fake bearer and fails. Original compiled module untouched; new test passes on it. |
| `affected.log` | `two standalone processes sharing a ledger perform one action, then replay after both exit` | **Baseline relative to round 3 (inherited lane code), unresolved intermittent failure:** two `performed` lines instead of one. The standalone test and worker/ledger implementations are unchanged from 13a00b80b; this fixture does not use either changed Rust path. Isolated rerun and all 20 repeats pass without a repair. No environmental cause is established. The failure is retained and is not claimed fixed. |

The initial affected command named a nonexistent `effect-context.test.mjs`;
Node selected the three existing files (78 tests). The final affected command
uses the actual `generated-effect-context.test.mjs` and all four files.

The full-suite result and any failures from that single invocation are recorded
in REPORT.md with its exact summary line. The inherited 60-second suite budget
miss is a baseline process-budget issue; no ceiling or timeout was raised.

## Completed Grok review follow-up

| Invocation | Failure | Attribution and disposition |
| --- | --- | --- |
| `grok-red-controls.log` | `automatic worker.mjs refuses a symlink before issuing a service token` | **Ours, expected pre-fix control:** linked entry executes and records a start. Private automatic-entry snapshot fixes it. |
| Same | `automatic worker restart rejects an entry replaced with a symlink` | **Ours, expected pre-fix control:** two starts instead of one. Per-restart snapshot refuses the linked entry. |
| Same | `automatic worker executes validated entry and relative helper after source replacement` | **Ours, expected pre-fix control:** `escaped` instead of `validated`. Private schema-tree snapshot retains both entry and helper bytes. |
| `grok-red-controls.log` and `grok-fixed-controls.log` | `automatic server.mjs refuses a symlink before issuing a service token` | **Ours, invalid fixture, not a detecting control:** arbitrary idle code is not a valid generated-server declaration, so server setup never reaches the listening URL. Removed that invalid variant; retained the three real detecting process tests and the existing generated-server/context compatibility suite. |
| `grok-affected-final.log` | `watchdog SIGTERM completes group cleanup without a live supervisor` | **Baseline test synchronization race, repaired:** the test checked the helper immediately after observing the watchdog's exit. The watchdog reaps Node, but cannot waitpid Node's child; SIGKILL delivery to that descendant can complete after the watchdog exit event. The test now waits for descendant death under its unchanged overall timeout and still asserts it. No watchdog/product behavior changed. |
| Same | `watchdog SIGINT completes group cleanup without a live supervisor` | **Baseline test synchronization race, repaired**, same cause and change. Both tests bypass the changed source-snapshot path entirely. |

The first post-Grok affected run was **100 pass / 2 fail**. Final post-repair
results are retained in `affected-qualified.log.gz`; host units and the whole
guide were also requalified after the automatic-entry snapshot change. The
required full script was not repeated. It started before Grok's completed
review, so its green Rust/client stages are not a claim about one atomic snapshot
of the final follow-up changes.

## Required full suite

One invocation, exit **0**, exact summary `== 0 failure(s) in 1336 s`.
Every stage passes; no full-suite failures are ours, baseline or environmental.
Final post-Grok affected **102/102**, host units **203 passed / 4 ignored**,
whole guide **98/98**. The inherited 60-second suite target remains exceeded.
