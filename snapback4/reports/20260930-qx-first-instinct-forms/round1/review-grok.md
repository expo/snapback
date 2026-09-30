I'll review lane QX round 0 against the report and the branch diff, checking each claim with a concrete test or a reproduction. No files will be changed and nothing will be pushed.The report is a four-claim lane review, not a generic diff pass. I'll confirm the branch and evidence first, then check each claim against the compiler and the prediction tests.The product change is about 620 lines across 22 files. I'll read the sugar lowering and the prediction change next, then check them against the explicit read-through path.Auto-compacting conversation (80% full)...
Conversation compacted.
The review is still open: I will check each claim against the code and the recorded measurements, then run only the targeted checks that can confirm or refute them. No repo files will be changed.The tree is the claimed commit and is clean. Next I will read the sugar lowering and the upsert proof, then check the recorded numbers against the raw measurements.A scratch run already flagged a cap-group prediction. I am reading that test and reproducing it, rather than treating the earlier log as the verdict.Sugar and the explicit form match on schema, residency text, and the membership schedule. Next I will take the new absence proof out of a scratch copy and confirm the prediction test fails.Auto-compacting conversation (80% full)...
Conversation compacted.
The audit is ready to write. I’ll confirm the high-severity reproduction and the report numbers against the files, then give the verdict.**NOT READY.** The membership-path sugar and the parent-pinned insert proof match the explicit read-through form, and the reported timings and suite arithmetic match the logs. Removing the device blanket that queued every read-through upsert also lets a held update predict a row the server refuses when that update moves an uncovered secondary unique key or cap.

## Findings

**High. A held upsert predicts a row the server refuses when a mutable field enters an uncovered unique key or cap.**

On main, `reserve_target_resolution` returned `Prediction("upsert on a read-through child queues without a row")` for every device upsert on a read-through child. This commit deletes that line and adds a parent-pinned branch only inside `upsert_absence_proven`. That function is used for an absent key (`write_target.rs` around the new `parent_verdict` return, and `prove_upsert_insert`). A held row takes `replace` → `check_constraints`. There, a unique collision is a local lookup, and a cap is recounted only when its group moves, from local rows (`write.rs`). Rows in another audience are not on the device.

Reproduced outside the repo, memory and SQLite, and again on the wasm and process devices. Schema: read-through `reactions` with the ordinary `unique parent, principal`, plus either `unique byEmoji: emoji` or `cap 1 by emoji`. Alice holds her reaction `r0` (`emoji: "old"`) on message `m0`. A hidden reaction in another conversation already has `emoji: "taken"`. Alice upserts her own row to `"taken"`.

- Device: `predictable: true`, `predicted: ["reactions/r0"]`, and the page shows pending `"taken"`.
- Server, unique case: `Failed`, `E_RULE` (a unique key or cap group contains a row you cannot read).
- Server, cap case: `Failed`, `E_CONSTRAINT` (`reactions holds at most 1 rows per group by emoji`).
- `settle` puts the confirmed emoji back to `"old"`. Settlement is still authoritative. The device still showed a row the server will not keep.

The same insert, with no local row yet, queues with `predicted: []`. Residency already knows the insert is uncovered: the site is `upsert insert blocked` / `Held`, reason `reactions unique key byEmoji (emoji) is not covered … unpinned: $parent.group` (or the cap equivalent). `predicts` stays `eligible`. `check` prints `predicts: updates only — inserts into reactions queue without a row` (`residency.rs`, and the prediction guide says a held-row update remains eligible). That label is wrong for this patch: the update is the unsound arm.

The natural reaction key does not hit this. `unique parent, principal` and `cap 50 by parent` pin the parent; `parent` and `principal` are immutable, so an emoji patch does not move those groups. The social-starter measurement is in that shape. A plausible extra constraint does hit it: `unique principal, emoji`, or any cap whose columns omit the parent, on a field the upsert writes.

Deleting only the new parent-pinned branch in a scratch copy makes the good insert queue again: `predictions_memory` and `predictions_sqlite` fail with `predictable: false` and `predicted: []` for the acquired insert into `m00`. That branch is what the first-write prediction depends on. The scratch sources were copied back; they match the repo. The repo tree was not modified (`975361c1025f`, clean).

**Low. One audience mismatch is `E_SYNC`, not `E_READ_THROUGH`.**

`sync public` or `sync to groups[.parent.group]` on an otherwise valid read-through child is refused as `E_SYNC`. A sugar read that drops part of the parent rule, including a service disjunct, is `E_READ_THROUGH`. Both refuse. Neither accepts a wider audience. The claim’s code name is too narrow for the explicit-sync case.

## Claim 1 — confirmed

`read <- exists members[.message.conversation, viewer]` and `sync to members[.message.conversation]` lower to the same program as `read through .message` plus inferred `sync`.

Checked on a scratch copy of this commit:

- `membership_paths`: `generated_paths_have_identical_schema_programs_and_residency` (depths 2 and 3, both retention policies, whole and horizon sync, audience columns `group`, `conversation`, and `room`), `path_refusals_are_targeted_and_repairs_compile`, and `explicit_through_can_name_its_authored_sync_path`.
- `snapback4 --test check`: `membership_paths_keep_check_residency_output` — `check --residency` text matches for the eight sugar/explicit pairs.
- `first_instinct`: `schedules_memory` and `schedules_sqlite`. Same snapshot pages, sync bytes, held groups, server and device query answers, and meter fields across the membership schedule. A captured ancestor move is `Failed` in both spellings.

The child reference must be required, immutable, without a default, and point at an ordinary table. The authored read must print the whole inherited rule. A third hop is accepted when the intermediate table already inherits. Nullable links, mutable links, defaults, cycles, and a narrower rule (including dropping `or viewer = 'service:search'`) are `E_READ_THROUGH`. Parent deletion with a stored child is `E_PARENT_HAS_CHILDREN` for both spellings. Expiry at the parent deadline empties the page and a late react is `NOT_FOUND`, with the same schema and outcomes either way. No accepted sugar path differed from explicit read-through on those checks.

## Claim 2 — refuted for updates that change an uncovered unique or cap

The insert arm holds. An acquired upsert into an absent `(parent, viewer)` predicts one row. It queues with no row when the device has not acquired, the parent is missing, the viewer has left, or the child sync is a horizon (`predictions_memory` / `predictions_sqlite` on the committed proof). An uncovered secondary unique or cap also queues the insert. `insert if absent` on a read-through child is still a hard queue: `write.rs` returns `Prediction("insert if absent on a read-through child queues without a row")` on the device, and residency still records a `Server` site for that kind only.

The claim that every secondary unique key and cap group has its own proof does not hold for a held update that changes that key or group. That is the High finding. Refusal does restore the confirmed row. I did not find a prediction that hides a row the server would accept.

## Claim 3 — confirmed from the measurement log

`latency-summary.log` matches the report. Final samples, n=20, no exclusions:

| Arm | Baseline p50 | Final p50 | Pending at first render |
|---|---:|---:|---|
| Web insert | 29.65 ms | 3.60 ms | 0/20 → 20/20 |
| Web update | 28.80 ms | 3.40 ms | 0/20 → 20/20 |
| Process insert | 35.55 ms | 8.95 ms | 0/20 → 20/20 |
| Process update | 35.90 ms | 7.30 ms | 0/20 → 20/20 |

This is the writer’s optimistic render on localhost, not remote-reader latency. The earlier `fixed-*` process medians (insert 5.10, update 4.20) are lower and are not the numbers in the claim.

## Claim 4 — confirmed from the suite log

`full-suite.log` ends with `== 1 failure(s) in 1369 s`. The only `test result: FAILED` blocks are `census::authoring_census` (80 passed, 1 failed) and `inherited_expiry_replay_memory` plus `inherited_expiry_replay_sqlite` (8 passed, 2 failed). The report’s 4,368 passed, 3 failed, 33 ignored matches a count of that log’s cargo results. The original run is still red. Wasm gzip in the build logs is 593,225 original and 593,524 final (+299), under the 593,719 cap.

The blanket that was removed was device-only (`self.device && table.through`). The server still runs the constraints: the reproductions above fail on the server with `E_RULE` and `E_CONSTRAINT`. Nothing was committed, edited in the repo, or pushed.
