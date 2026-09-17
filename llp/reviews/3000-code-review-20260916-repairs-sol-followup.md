# Sol final repair review — 2026-09-16

Reviewer: gpt-5.6-sol, xhigh, independent read-only follow-up.
Received report below; trailing whitespace normalized.

# Independent repair follow-up review

Reviewed commit: `ebc9f14621f05584b150444241c8706a9a7ec746`
Repair base: `f6b514c35ec4cffc7fe102a51e583fcfba28f636`
Production repair commit: `7e0fc21da8d7675b4a5ec2a418604b2135c438a9`

Verdict: **NO MATERIAL FINDING REMAINS**

The two findings from the prior review are resolved. Publication now validates durable format-2 stage state before executing commands, records the successful source-suite qualification only on the fresh-stage path, refuses an existing stage without explicit resume, and makes resume repeat the installed-consumer, digest, version, and Developer ID signature checks over the exact retained tarballs without depending on the current checkout's source suite.

Custom persistence claims are now validated at every acquisition. Alternates must use the requested store's nonempty `:tab-` namespace and have `others` and `remove`; orphan claims must return the exact requested name; and a rejected claim is released when it supplies the required release operation. Orphan enumeration also filters provider output back to the validated namespace. The final fixture-only commit initializes and closes an authenticated store before exercising the malformed orphan claim, so the regression reaches that validation rather than failing earlier during backend acquisition.

The journal recovery correction is consistent with the existing device contract. Only recovered executable records receive `replay_candidate: true`; successful local prediction is retained, while a prediction or authored refusal rolls back its savepoint and produces an unpredicted durable outbox entry for server settlement. The flag remains a host-to-device admission hint rather than serialized outbox or transport state. Existing store identity, transfer-marker, FIFO, replacement, and duplicate-ID fences still surround the recovery path.

## Review scope and method

Read-only review of the complete 12-file `f6b514c35..7e0fc21da` delta, its surrounding ownership, admission, device, publication, and documentation context, plus the final test-only `7e0fc21da..ebc9f1462` delta. Per instruction, I did not run builds or tests, mutate repository source, use remote commands, or read another review artifact. `git diff --check` was clean for both reviewed deltas.
