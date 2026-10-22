# Snapback 4 Darwin browser-close contention flake

Status: Open
Date: 2026-10-23
Scope: Integration 23 on shared black M5, permitted scratch clone only.

`proof-contract.test.mjs`, “KIT3 explicit form claim survives slow uploads and
never grants an unrelated callback”, reached browser cleanup and timed out
after the existing 5,000 ms close bound. The compatibility target reported
14 passes/one failure; no product assertion failure was reported.
The prior full Mac platform pool passed. Apply the flake rule: this case
must pass alone, then the complete affected Mac pool must pass again.
No bound, assertion, seed or test selection is relaxed. Final evidence and
repeat outcomes live in the Integration 23 workstream report.

The slow-upload case passed alone on the unchanged build. The next full
compatibility target passed that case but hit the identical close timeout in
“H9 renderedText opts into substring matching”. Both must pass alone, followed
by the complete 85-file affected/platform pool. The full Mac repeat uses one
file at a time to reduce contention on this shared host; coverage, seeds and
existing bounds remain unchanged.
