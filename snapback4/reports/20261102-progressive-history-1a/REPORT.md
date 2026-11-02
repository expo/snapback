# 2026-11-02 — Progressive history, chunk 1a

Implemented the server acquisition seam on `sb4/progressive-history`. Changes are uncommitted. This report ends the chunk; no device, client, contract, guide, JOURNAL, or LLP source was changed. No agents, clones, other checkouts, remote commands, commits, stashes, rebases, or pushes were used.

**Changed files and behavior**

| File:line (relative to snapback4/) | Change |
| --- | --- |
| `crates/snapback4-core/src/engine/acquisition.rs:15` | `Engine::acquisition_page_at(principal, cursor, hint, skip, from, limit, now, pending)`. Current images, head, and the existing receipt split share one read transaction. Time-audience advancement/reader time follow the stream path. |
| `crates/snapback4-core/src/engine/mod.rs:1265` | Reject a progressive cursor on the legacy snapshot entry point; register the server-only acquisition module near the existing sync evidence module. |
| `crates/snapback4-core/src/partition.rs:556` | Extend the existing cursor with the tier and a scheduling bit. Defaults omit both additions, preserving legacy cursor bytes. Progressive cursors leave the legacy watermark field zero; the request's `from` is the sole event cut. |
| `crates/snapback4-core/src/partition/snapshot.rs:16` | Extract the existing snapshot walk and allow it to stop at one horizonless table. Legacy calls retain the same selection and pagination. This split keeps partition.rs below 1,500 lines. |
| `crates/snapback4-core/src/partition/acquire.rs:79` | Tier 1 table pages, then tier 2 groups in the existing key order; foreground hint, bounded skip set, leave reporting, exhaustion, and whole-table facts. Horizoned units call the existing bounded `delivery::expand_group`, which uses `group_rows_from`. |
| `crates/snapback4-core/src/partition/acquire.rs:45` | Withhold new whole-table coverage for union, inherited, maintained, and timeline-owned shapes. Their legacy row walks still participate in exhaustion. |
| `crates/snapback4/src/serve_sync.rs:90` | Add `acquire` dispatch after existing authentication/handshake/store handling, before the legacy snapshot/stream choice. Request skip sets are capped at 32. An old-store request discards its cursor and skip set. |
| `crates/snapback4/src/serve_acquire.rs:26` | Reader and memory-owner paths use the same generation and authority checks. Reply is the ordinary stream envelope plus `acquire`, with `snapshot:false`, existing output ceiling, and generation-aware response classification. |
| `crates/snapback4-core/src/device_protocol.rs:19` | Add `device_compatibility.advertised: ["progressive-acquisition-v1"]`. The device-required capability list and device engine identity are unchanged. Both root and schema endpoints use this record. |
| `crates/snapback4-core/tests/progressive_acquisition.rs:77` | Eight core witnesses: tier order and quiescent snapshot oracle; hints/skips/fairness; leave; receipt evidence; expiry/unopened rows and empty groups; legacy cursor bytes; union row transfer without new coverage; oversized atomic-group refusal. |
| `crates/snapback4/tests/serve_sync/progressive.rs:81`, `crates/snapback4/tests/serve_sync/mod.rs:5` | Two HTTP witnesses, memory and file-reader hosts: advertised capability, compatible existing handshake, old snapshot reply bytes, old stream shape, generation/auth/store handling, pending receipts, malformed new requests and skip ceiling. |

**Wire and integration details**

Request form: `{from, pending, generation?, store_id?, limit?, acquire:{cursor:null|string, hint?:{table,group}, skip?:[{table,group}]}}`. Groups use the same plain JSON values as existing acquisition markers. An `after` cursor cannot accompany `acquire`.

Reply adds `acquire:{unit, cursor, exhausted, whole_tables, hint_ignored?, skipped?}`. A unit has `tier:1|2`, `table`, and a `group` for tier 2. A terminal request with nothing left may have `unit:null`. A missing cursor means exhaustion in replies; a null request cursor starts a walk.

The ordinary reply watermark stays at `from`; row images carry that sequence without creating any log event. `images_at` is the current head. `more` says whether that head is above `from`, independently of acquisition exhaustion. Receipts use the exact stream helper with cut `from` and upper bound `images_at`. Tests compare receipt splits at equal event cuts and compare both APIs with the same caught-up `from` and pending ids.

Tier 1 finishes before any hint is served. One out-of-order priority unit is followed by a normal walk step, even if hints keep changing. The cursor's scheduling bit enforces that fairness without a second cut. A caller may include up to 32 previously served groups to avoid their later duplicate download. Omitting them permits idempotent re-serving.

A horizoned group remains atomic even if `limit` is smaller than its horizon. Existing delivery resource ceilings may refuse it, without returning a partial floor. Tier 1 also checks the returned delivery against that budget. No horizon evictions, history versions, device facts, or legacy `ACQUIRED` writes were added.

**Orientation and code/spec observations**

Governing context: [RFC revision 1, §§6 and 9](../../../llp/3000.001.001-prioritized-progressively-usable-history.rfc.md), [parent Repairs A/B](../../../llp/3000.001-durable-replica-and-write-lifecycle.research.md), [device handshake](../../../llp/3000.001.000-device-engine-handshake.rfc.md), [Snapback 4 root](../../../llp/3000-snapback4.explainer.md), and Snapback 4's agent instructions, exclusion list and sync guide. Applied the read-only `llp-orient` workflow, scoped to this server seam. No new design document or author acceptance was created.

- The compatibility record was a device-required list, so advertisement is a separate field.
- The existing schema table walk is `Schema::synced()` order (the table map's order), not author declaration order. The fixture deliberately puts messages ahead of participants alphabetically and verifies the tier override.
- Join expansion already uses `delivery::expand_group`, including an 8,192-row ceiling and heap/output checks. An arbitrarily large declared horizon is not guaranteed to fit one unit; the retained legacy snapshot can still page it.
- The current snapshot walker already handles union arms and filtered timeline-owned tables. This implementation reuses that behavior and grants no new whole-table fact for the excluded coverage shapes.
- Actual checker anchors are `#61-the-acquisition-page` and `#62-the-walk-its-cursor-and-completion`. The dotted examples in the task failed ref-check. Only comments were corrected after the runtime checks; runtime semantics did not change.

**Verification outcome**

- Full `cargo test -p snapback4-core`: **passed**, exit 0, including the eight new tests and doctests.
- Full `cargo test -p snapback4`: **failed**, exit 101: `700 passed; 1 failed; 83 ignored`. Both new HTTP witnesses passed. The sole failed binary test was `verbs::witness::background::tests::background_policy_can_be_applied_to_an_owned_external_child`:
  `E_WITNESS_PROCESS: cannot set background policy on owned app: Operation not permitted (os error 1)`.
  Later integration targets were not run by this fail-fast invocation. This was a process-policy failure, not a loopback failure; there was no loopback failure requiring a retry.
- `cargo build`: **passed**, exit 0.
- Pinned Node: `/Users/ccheever/.volta/bin/node` reported `v24.18.0`. The initial ambient check reported `v25.9.0`; the affected run used Volta on PATH.
- Required `node scripts/affected.mjs --base origin/main --worktree --run`: **attempted, incomplete**. Its conservative classification of the HTTP test modules selected 32 commands, 7 whole Rust packages and 489 client files. The locked Bun install passed without changes. I interrupted the owned runner before its wasm/client stages because the plan includes the explicitly excluded React tests. Its CLI build subsequently printed a successful finish, but the runner receipt remains incomplete and records only the install step. No affected-suite pass is claimed.
- Final `./ref-check --verbose` from the repository root: **passed**, zero errors. The initial wrong-cwd and invalid-anchor runs are retained below.
- `git diff --check`: no diagnostics. Largest changed source file: engine/mod.rs, 1,453 lines.

The interrupted affected receipt is `target/affected/18c70392f261-1793616195227.json` at the repository root. It is the runner's generated artifact; no implementation source outside the requested directories changed.

**Not run and open integration points**

- `react.test.mjs` and `witness/idb.mjs`: **not run (sandbox)**, as instructed. Browser/native persistence, simulator/device publication, client admission and performance qualification belong to later chunks/supervisor verification.
- The remainder of the broad affected plan, including its device/client builds and checks, was not run. The supervisor should complete it in an environment that admits the excluded tests.
- Chunk 1b must durably apply the returned walk cursor, whole-table facts and group boundaries with the corresponding images, including Repair B deferral; it must preserve ordinary stream catch-up and set acquired only after exhaustion plus catch-up. In particular, cold group acquisition/whole-table facts must integrate with the existing retained-history Held/Left/Rejoined rules. This chunk makes no device-readiness claim.
- Deliverable 4(e)'s phrase “refuses ... whose handshake lacks nothing new” conflicts with the explicit advertised-only compatibility rule. The implementation follows the latter: a compatible existing handshake succeeds without this new capability; invalid/incomplete existing handshakes still fail.
- No other implementation question blocks the server seam. Documentation and JOURNAL reconciliation were deliberately left to the later commissioned chunk. LLP orientation hand-off: none.

**Verbatim command summaries**

Full logs are beside this report. All observed summary lines, including intermediate failures and nested test-process summaries, are preserved here; they are not summed into an inflated test count.


core-focused.log — 101; compile failure in initial test (private cursor decoder)

```text
error: could not compile `snapback4-core` (test "progressive_acquisition") due to 1 previous error
```

core-focused-r2.log — 101; fixture operation names were accidentally namespaced

```text
    Finished `test` profile [optimized + debuginfo] target(s) in 2m 00s
test result: FAILED. 5 passed; 2 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
error: test failed, to rerun pass `-p snapback4-core --test progressive_acquisition`
```

core-focused-r3.log — 0; all eight focused server witnesses passed

```text
    Finished `test` profile [optimized + debuginfo] target(s) in 4m 03s
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.39s
```

http-focused.log — 101; missing response classification trait on the new wrapper, subsequently repaired

```text
error: could not compile `snapback4` (bin "snapback4") due to 1 previous error; 9 warnings emitted
error: could not compile `snapback4` (bin "snapback4" test) due to 1 previous error; 9 warnings emitted
```

core-full.log — 0; full core command completed

```text
    Finished `test` profile [optimized + debuginfo] target(s) in 4m 04s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 843 filtered out; finished in 0.29s
test result: ok. 840 passed; 0 failed; 4 ignored; 0 measured; 0 filtered out; finished in 235.38s
test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.09s
test result: ok. 0 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 28 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.06s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.55s
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.06s
test result: ok. 20 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 5.22s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.24s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 32 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 146.58s
test result: ok. 14 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 19 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.11s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.23s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.59s
test result: ok. 12 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.50s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.18s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.09s
test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.36s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.07s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.13s
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.06s
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
test result: ok. 15 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.10s
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.27s
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.39s
test result: ok. 16 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.99s
test result: ok. 3 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 0.20s
test result: ok. 14 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 15.12s
test result: ok. 18 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 635.79s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 4.22s
test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.09s
test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 17 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 29 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 19.34s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.19s
test result: ok. 22 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.28s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.18s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 27 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.52s
```

http-full.log — 101; macOS sandbox refused the existing owned-child background-policy test

```text
    Finished `test` profile [optimized + debuginfo] target(s) in 3m 21s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 783 filtered out; finished in 0.52s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 783 filtered out; finished in 0.48s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 783 filtered out; finished in 0.92s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 783 filtered out; finished in 1.65s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 783 filtered out; finished in 0.69s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 783 filtered out; finished in 0.91s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 783 filtered out; finished in 0.06s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 783 filtered out; finished in 1.35s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 783 filtered out; finished in 1.31s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 783 filtered out; finished in 0.81s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 783 filtered out; finished in 1.60s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 783 filtered out; finished in 12.04s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 783 filtered out; finished in 15.12s
test result: FAILED. 700 passed; 1 failed; 83 ignored; 0 measured; 0 filtered out; finished in 38.85s
error: test failed, to rerun pass `-p snapback4 --bin snapback4`
```

build.log — 0; debug build completed

```text
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 1m 47s
```

affected.log — 1 after interrupt; broad run incomplete

```text
# 32 commands, 7 whole Rust packages, 489 client files; broad=true
Checked 649 installs across 627 packages (no changes) [272.00ms]
    Finished `dev` profile [unoptimized] target(s) in 4m 57s
```

ref-check.log — 1; first invocation used snapback4/ as the corpus root

```text
ref-check: FAIL — 0 LLP docs, 4203 refs in 25309 files, 4203 errors, 0 unchecked
```

ref-check-root.log — 1; four dotted subsection anchors did not match the actual heading slugs

```text
ref-check: FAIL — 583 LLP docs, 12957 refs in 51318 files, 4 errors, 0 unchecked
```

ref-check-final.log — 0; reference validation passed

```text
ref-check: ok — 583 LLP docs, 12957 refs in 51318 files, 0 errors, 0 unchecked
```

**Complete shell command record**

Commands ran from the repository root unless a different cwd is stated. Inspection/edit commands have no independent test verdict; their output reads previously produced evidence. Tool polls and sleeps launched no new command. Edits made through the patch tool are reflected in the changed-file table. The affected-run interruption was an owned-session Ctrl-C (observed exit 1), not a shell command.

1. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
cat llp/3000.001.001-prioritized-progressively-usable-history.rfc.md
```

2. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
sed -n '290,365p' llp/3000.001.001-prioritized-progressively-usable-history.rfc.md
```

3. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
cat snapback4/AGENTS.md snapback4/NOT-DOING.md
```

4. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
cat skills/llp-orient/SKILL.md
```

5. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
rg -n 'Repair A|Repair B|Repair C|^##' llp/3000.001-durable-replica-and-write-lifecycle.research.md
```

6. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
git status --short; git branch --show-current
```

7. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
sed -n '180,350p' snapback4/AGENTS.md
```

8. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
sed -n '1,145p' snapback4/NOT-DOING.md
```

9. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
sed -n '650,885p' llp/3000.001-durable-replica-and-write-lifecycle.research.md
```

10. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
cat llp/3000.001.000-device-engine-handshake.rfc.md
```

11. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
wc -l snapback4/crates/snapback4-core/src/partition.rs snapback4/crates/snapback4-core/src/engine/mod.rs snapback4/crates/snapback4/src/serve_sync.rs; rg --files snapback4 -g AGENTS.md
```

12. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
sed -n '650,800p' llp/3000.001-durable-replica-and-write-lifecycle.research.md
```

13. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
sed -n '801,885p' llp/3000.001-durable-replica-and-write-lifecycle.research.md
```

14. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
sed -n '1,115p' llp/3000.001.000-device-engine-handshake.rfc.md
```

15. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
sed -n '1,270p' snapback4/crates/snapback4-core/src/partition.rs
```

16. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
sed -n '1,255p' snapback4/crates/snapback4/src/serve_sync.rs
```

17. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
cat snapback4/crates/snapback4-core/src/engine/sync_evidence.rs
```

18. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
sed -n '600,1030p' snapback4/crates/snapback4-core/src/partition.rs
```

19. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
rg -n 'snapshot_acquisition|mod sync|struct StreamReply|struct SnapshotReply' snapback4/crates/snapback4-core/src/engine/mod.rs snapback4/crates/snapback4/src/*rs; cat snapback4/crates/snapback4-core/src/device_protocol.rs
```

20. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
rg -n 'snapshot|horizon|expand_joins|group_rows_from|groups_for' snapback4/crates/snapback4-core/src/partition.rs
```

21. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
sed -n '516,604p' snapback4/crates/snapback4-core/src/partition.rs; sed -n '1300,1460p' snapback4/crates/snapback4-core/src/partition.rs
```

22. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
sed -n '1200,1340p' snapback4/crates/snapback4-core/src/engine/mod.rs; cat snapback4/crates/snapback4/src/sync_wire.rs
```

23. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
cat snapback4/crates/snapback4-core/src/schema/capabilities.rs; sed -n '1,170p' snapback4/crates/snapback4/src/serve_sync_generation_tests.rs; sed -n '1,160p' snapback4/crates/snapback4/src/serve_tests.rs
```

24. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
cat snapback4/crates/snapback4/src/sync_wire.rs
```

25. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
cat snapback4/crates/snapback4-core/src/partition/delivery.rs
```

26. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
sed -n '1,190p' snapback4/crates/snapback4-core/tests/partition.rs; sed -n '1,190p' snapback4/crates/snapback4/tests/serve_sync/mod.rs
```

27. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
sed -n '1,125p' llp/3000-snapback4.explainer.md; cat llp/2000.000-keep-the-core-flip-two-substrates.rfc.md
```

28. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
tail -55 snapback4/JOURNAL.md; cat rules/RULES.md; sed -n '1,120p' snapback4/crates/snapback4-lang/src/guide/sync.rs
```

29. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
rg -n 'SnapshotCursor \{|Compatibility \{|fn synced|fn table\(' snapback4/crates/snapback4-core/src snapback4/crates/snapback4/tests | head -65; rg --files snapback4/crates/snapback4-core/tests | rg 'partition|snapshot|sync'; sed -n '1,85p' snapback4/crates/snapback4-core/tests/sync.rs
```

30. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
mkdir -p snapback4/reports/20261102-progressive-history-1a
```

31. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
python3 - <<'PY'
from pathlib import Path
root = Path('snapback4/crates/snapback4-core/src')
p = root/'partition.rs'
s = p.read_text()
start = s.index('/// Everything a principal holds right now, one page at a time:')
end = s.index('/// The whole snapshot at once,', start)
walk = s[start:end]
wrapper_end = walk.index('    let watermark =')
wrapper = walk[:wrapper_end] + '    Ok(walk(tx, schema, principal, cursor, limit, now, false)?.0)\n}\n\n'
walk = 'pub(super) fn walk(tx: &dyn PartitionRows, schema: &Schema, principal: &str, cursor: Option<SnapshotCursor>, limit: usize, now: i64, one_table: bool) -> Result<(SnapshotPage, Option<String>), RuntimeError> {\n' + walk[wrapper_end:]
walk = walk.replace('let tables: Vec<(&str, &Table, &Sync)> = schema.synced().collect();', 'let tables: Vec<(&str, &Table, &Sync)> = schema.synced().filter(|(_, _, sync)| at.tier == 0 || sync.horizon.is_none()).collect();')
walk = walk.replace('Ok(SnapshotPage { acquisitions, events, watermark, next: Some(at), held })', 'Ok((SnapshotPage { acquisitions, events, watermark, next: Some(at), held }, None))')
walk = walk.replace('        at.group = None;\n    }', '''        at.group = None;
        // @ref LLP 3000.001.001#6.1-the-acquisition-page — a tier-1 unit ends at this table, even with room left.
        if one_table && at.arm == 0 {
            let next = (at.table < tables.len()).then_some(at);
            return Ok((SnapshotPage { acquisitions, events, watermark, next, held }, Some(table_name.into())));
        }
    }''')
walk = walk.replace('Ok(SnapshotPage { acquisitions, events, watermark, next: None, held })', 'Ok((SnapshotPage { acquisitions, events, watermark, next: None, held }, None))')
(root/'partition/snapshot.rs').write_text('//! The legacy snapshot walk, also paged one horizonless table at a time.\nuse super::*;\n\n'+wrapper+walk)
s = s[:start] + s[end:]
s = s.replace('mod delivery;', 'mod delivery;\n#[cfg(feature = "sqlite")]\nmod snapshot;\n#[cfg(feature = "sqlite")]\npub use snapshot::snapshot_page;\n#[cfg(feature = "sqlite")]\nmod acquire;\n#[cfg(feature = "sqlite")]\npub use acquire::{AcquisitionGroup, AcquisitionProgress, AcquisitionUnit, AcquisitionPage};')
s = s.replace('pub struct SnapshotCursor {', '''pub struct SnapshotCursor {
    /// 0 is the legacy snapshot; progressive acquisition walks tier 1, then 2.
    #[serde(default, skip_serializing_if = "is_zero")]
    pub tier: usize,''')
p.write_text(s)
p=root/'engine/mod.rs';s=p.read_text().replace('mod sync_evidence;', 'mod sync_evidence;\nmod acquisition;\npub use acquisition::CertifiedAcquisition;');p.write_text(s)
p=root/'device_protocol.rs';s=p.read_text().replace('pub const GENERATION:', 'pub const PROGRESSIVE_ACQUISITION: &str = "progressive-acquisition-v1";\npub const GENERATION:');s=s.replace('pub struct Compatibility {', '''pub struct Compatibility {
    // @ref LLP 3000.001.001#9-scope-compatibility-and-costs — optional server protocols do not raise device admission requirements.
    pub advertised: Vec<&'static str>,''');s=s.replace('Compatibility { server_version:', 'Compatibility { advertised: vec![PROGRESSIVE_ACQUISITION], server_version:');p.write_text(s)
PY
```

32. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
rg -n 'an acquisition cursor' snapback4/crates/snapback4-core/src/engine/mod.rs; sed -n '30,60p' snapback4/crates/snapback4-core/src/partition/snapshot.rs; sed -n '1,95p' snapback4/crates/snapback4-core/tests/event_slot_snapshot.rs
```

33. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
rg -n 'Engine::|load_at|seed|Context' snapback4/crates/snapback4-core/tests/sync_count_batch.rs | head -45; cat snapback4/crates/snapback4-core/Cargo.toml; sed -n '1,70p' snapback4/crates/snapback4-core/tests/sync_count_batch.rs
```

34. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
sed -n '25,105p' llp/3000-snapback4.explainer.md; sed -n '30,160p' llp/2000.000-keep-the-core-flip-two-substrates.rfc.md
```

35. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
sed -n '1,230p' snapback4/scripts/affected.mjs
```

36. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
rg -n 'Engine::new|load_at\(' snapback4/crates/snapback4-core/tests | head -35; rg -n 'pub fn load|pub fn seed|pub fn new' snapback4/crates/snapback4-core/src/engine/mod.rs; sed -n '1,45p' snapback4/crates/snapback4-core/tests/read_through.rs; rg -n 'device_compatibility' snapback4/crates/snapback4/tests/serve* | head -20
```

37. Cwd: snapback4/. Verbatim summary: see `core-focused.log` above.

```sh
cargo test -p snapback4-core --test progressive_acquisition > reports/20261102-progressive-history-1a/core-focused.log 2>&1
```

38. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
tail -65 snapback4/reports/20261102-progressive-history-1a/core-focused.log
```

39. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
sed -n '1,130p' snapback4/crates/snapback4-core/tests/time_audiences.rs; rg -n 'schema\(|schema_mut|fn schema' snapback4/crates/snapback4-core/src/engine/mod.rs; rg -n 'fn held|joined|events.*seq|seq.*watermark' snapback4/crates/snapback4-device/src/device/validate.rs snapback4/crates/snapback4-device/src/device/deferred.rs
```

40. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
rg -n 'skip|exclude|process.env|client-files|react.test|idb.mjs|commands' snapback4/scripts/affected.mjs | tail -65; git diff --stat; git diff -- snapback4/crates/snapback4-core/src/partition.rs snapback4/crates/snapback4-core/src/engine/mod.rs
```

41. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
sed -n '300,365p' snapback4/scripts/affected.mjs; sed -n '410,555p' snapback4/scripts/affected.mjs
```

42. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
tail -30 snapback4/reports/20261102-progressive-history-1a/core-focused.log; sed -n '10,70p' snapback4/crates/snapback4-device/src/device/deferred.rs; sed -n '95,130p' snapback4/crates/snapback4-core/src/schema/timeline.rs
```

43. Cwd: snapback4/. Verbatim summary: see `core-focused-r2.log` above.

```sh
cargo test -p snapback4-core --test progressive_acquisition > reports/20261102-progressive-history-1a/core-focused-r2.log 2>&1
```

44. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
tail -60 snapback4/reports/20261102-progressive-history-1a/core-focused-r2.log
```

45. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
git status --short; wc -l snapback4/crates/snapback4-core/src/partition.rs snapback4/crates/snapback4-core/src/engine/mod.rs snapback4/crates/snapback4-core/src/partition/acquire.rs; node --version; command -v node; command -v cargo
```

46. Cwd: snapback4/. Verbatim summary: see `http-focused.log` above.

```sh
cargo test -p snapback4 progressive_acquisition -- --nocapture > reports/20261102-progressive-history-1a/http-focused.log 2>&1
```

47. Cwd: snapback4/. Inspection/edit command; no new test-summary verdict.

```sh
/Users/ccheever/.volta/bin/node --version
```

48. Cwd: snapback4/. Inspection/edit command; no new test-summary verdict.

```sh
tail -35 reports/20261102-progressive-history-1a/core-focused-r2.log
```

49. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
tail -40 snapback4/reports/20261102-progressive-history-1a/core-focused-r2.log; tail -15 snapback4/reports/20261102-progressive-history-1a/http-focused.log
```

50. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
git diff --check; rg -n 'whole_eligible|pub\(crate\) fn page|pub fn acquisition_page_at|pub\(super\) fn serve|PROGRESSIVE|mod snapshot|pub fn snapshot_page|fn walk' snapback4/crates/snapback4-core/src/partition/acquire.rs snapback4/crates/snapback4-core/src/partition/snapshot.rs snapback4/crates/snapback4-core/src/engine/acquisition.rs snapback4/crates/snapback4/src/serve_acquire.rs snapback4/crates/snapback4-core/src/device_protocol.rs
```

51. Cwd: snapback4/. Verbatim summary: see `core-focused-r3.log` above.

```sh
cargo test -p snapback4-core --test progressive_acquisition > reports/20261102-progressive-history-1a/core-focused-r3.log 2>&1
```

52. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
tail -35 snapback4/reports/20261102-progressive-history-1a/http-focused.log; tail -25 snapback4/reports/20261102-progressive-history-1a/core-focused-r3.log
```

53. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
rg -n 'fn timeline|supported_capabilities|not before|Current readable|current readable|no horizon' snapback4/crates/snapback4-core/src/partition/acquire.rs; git diff --check
```

54. Cwd: snapback4/. Verbatim summary: see `core-full.log` above.

```sh
cargo test -p snapback4-core > reports/20261102-progressive-history-1a/core-full.log 2>&1
```

55. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
tail -25 snapback4/reports/20261102-progressive-history-1a/http-focused.log; tail -20 snapback4/reports/20261102-progressive-history-1a/core-focused-r3.log
```

56. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
tail -30 snapback4/reports/20261102-progressive-history-1a/http-focused.log; tail -25 snapback4/reports/20261102-progressive-history-1a/core-focused-r3.log; tail -5 snapback4/reports/20261102-progressive-history-1a/core-full.log
```

57. Cwd: repository root. Verbatim result: `zsh:1: operation not permitted: ps`.

```sh
ps -o pid,ppid,etime,%cpu,comm -p 1
```

58. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
tail -25 snapback4/reports/20261102-progressive-history-1a/http-focused.log; tail -25 snapback4/reports/20261102-progressive-history-1a/core-focused-r3.log
```

59. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
tail -28 snapback4/reports/20261102-progressive-history-1a/http-focused.log; tail -25 snapback4/reports/20261102-progressive-history-1a/core-focused-r3.log; tail -8 snapback4/reports/20261102-progressive-history-1a/core-full.log
```

60. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
rg -n -A28 -B5 '^error' snapback4/reports/20261102-progressive-history-1a/http-focused.log
```

61. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
sed -n '280,355p' snapback4/crates/snapback4/src/latency.rs; rg -n 'Reply for .*Reply|StreamReply' snapback4/crates/snapback4/src/latency.rs snapback4/crates/snapback4/src/serve_response.rs
```

62. Cwd: snapback4/. Verbatim summary: see `http-full.log` above.

```sh
cargo test -p snapback4 > reports/20261102-progressive-history-1a/http-full.log 2>&1
```

63. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
tail -40 snapback4/reports/20261102-progressive-history-1a/core-focused-r3.log; tail -15 snapback4/reports/20261102-progressive-history-1a/core-full.log; tail -8 snapback4/reports/20261102-progressive-history-1a/http-full.log
```

64. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
tail -30 snapback4/reports/20261102-progressive-history-1a/core-full.log; tail -12 snapback4/reports/20261102-progressive-history-1a/http-full.log; git diff --check
```

65. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
python3 - <<'PY'
from pathlib import Path
for name in ['core-full.log', 'http-full.log']:
 p=Path('snapback4/reports/20261102-progressive-history-1a')/name
 lines=p.read_text().splitlines()
 print(name)
 for line in lines:
  if line.startswith('test result:') or line.startswith('error:') or ' ... FAILED' in line: print(line)
 print('\n'.join(lines[-5:]))
PY
```

66. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
python3 - <<'PY'
from pathlib import Path
for name in ['core-full.log', 'http-full.log']:
 lines=(Path('snapback4/reports/20261102-progressive-history-1a')/name).read_text().splitlines()
 print(name)
 print('\n'.join(line for line in lines if line.startswith('error:') or ' ... FAILED' in line))
 print('\n'.join(lines[-10:]))
PY
```

67. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
rg -n 'progressive_acquisition|test result:|E_WITNESS_PROCESS' snapback4/reports/20261102-progressive-history-1a/http-full.log; tail -12 snapback4/reports/20261102-progressive-history-1a/core-full.log
```

68. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
git diff --numstat; git status --short
```

69. Cwd: snapback4/. Verbatim summary: see `build.log` above.

```sh
cargo build > reports/20261102-progressive-history-1a/build.log 2>&1
```

70. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
python3 - <<'PY'
from pathlib import Path
for name in ['core-full.log', 'build.log']:
 lines=(Path('snapback4/reports/20261102-progressive-history-1a')/name).read_text().splitlines()
 print(name)
 print('\n'.join(line for line in lines if line.startswith('error:') or ' ... FAILED' in line))
 print('\n'.join(lines[-8:]))
PY
```

71. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
python3 - <<'PY'
from pathlib import Path
for name in ['core-full.log', 'build.log']:
 lines=(Path('snapback4/reports/20261102-progressive-history-1a')/name).read_text().splitlines()
 print(name)
 print('\n'.join(lines[-12:]))
PY
```

72. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
tail -7 snapback4/reports/20261102-progressive-history-1a/build.log; tail -7 snapback4/reports/20261102-progressive-history-1a/core-full.log
```

73. Cwd: snapback4/. Verbatim summary: see `affected.log` above.

```sh
PATH=/Users/ccheever/.volta/bin:$PATH node scripts/affected.mjs --base origin/main --worktree --run > reports/20261102-progressive-history-1a/affected.log 2>&1
```

74. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
tail -25 snapback4/reports/20261102-progressive-history-1a/affected.log; tail -8 snapback4/reports/20261102-progressive-history-1a/core-full.log
```

75. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
tail -25 snapback4/reports/20261102-progressive-history-1a/affected.log; tail -10 snapback4/reports/20261102-progressive-history-1a/core-full.log
```

76. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
rg '^== |^# [0-9]+ commands|^Receipt:|^BLOCKED:|error:|EACCES|EPERM' snapback4/reports/20261102-progressive-history-1a/affected.log | tail -35; rg -n 'react.test.mjs|witness/idb.mjs' snapback4/reports/20261102-progressive-history-1a/affected.log | cut -c 1-180; git status --short
```

77. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
rg '^# .*fail broad|^== |^# [0-9]+ commands' snapback4/reports/20261102-progressive-history-1a/affected.log | head -35; sed -n '930,950p' snapback4/reports/20261102-progressive-history-1a/affected.log
```

78. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
tail -8 snapback4/reports/20261102-progressive-history-1a/affected.log; tail -15 snapback4/reports/20261102-progressive-history-1a/core-full.log
```

79. Cwd: snapback4/. Verbatim summary: see `ref-check.log` above.

```sh
PATH=/Users/ccheever/.volta/bin:$PATH ../ref-check --verbose > reports/20261102-progressive-history-1a/ref-check.log 2>&1
```

80. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
git diff --check; wc -l snapback4/crates/snapback4-core/src/engine/acquisition.rs snapback4/crates/snapback4-core/src/partition/acquire.rs snapback4/crates/snapback4-core/src/partition/snapshot.rs snapback4/crates/snapback4-core/src/partition.rs snapback4/crates/snapback4-core/src/engine/mod.rs snapback4/crates/snapback4/src/serve_acquire.rs snapback4/crates/snapback4/src/serve_sync.rs snapback4/crates/snapback4-core/tests/progressive_acquisition.rs snapback4/crates/snapback4/tests/serve_sync/progressive.rs
```

81. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
tail -12 snapback4/reports/20261102-progressive-history-1a/core-full.log; tail -10 snapback4/reports/20261102-progressive-history-1a/ref-check.log
```

82. Cwd: repository root. Verbatim summary: see `ref-check-root.log` above.

```sh
PATH=/Users/ccheever/.volta/bin:$PATH ./ref-check --verbose > snapback4/reports/20261102-progressive-history-1a/ref-check-root.log 2>&1
```

83. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
tail -8 snapback4/reports/20261102-progressive-history-1a/ref-check-root.log; tail -5 snapback4/reports/20261102-progressive-history-1a/core-full.log; rg -n 'generated_populations_transitions_and_expiry' snapback4/crates/snapback4-core/tests
```

84. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
sed -n '1,115p' snapback4/crates/snapback4-core/tests/row_view_disclosure.rs; tail -8 snapback4/reports/20261102-progressive-history-1a/core-full.log; tail -8 snapback4/reports/20261102-progressive-history-1a/ref-check-root.log
```

85. Cwd: repository root. Verbatim summary: see `ref-check-final.log` above.

```sh
PATH=/Users/ccheever/.volta/bin:$PATH ./ref-check --verbose > snapback4/reports/20261102-progressive-history-1a/ref-check-final.log 2>&1
```

86. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
tail -8 snapback4/reports/20261102-progressive-history-1a/core-full.log; head -40 ref-check; rg -n 'suffix|extension|@ref|\.json|\.md' scripts/ref-check* scripts/ref_check* 2>/dev/null | head -35
```

87. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
sed -n '38,64p' ref-check; tail -6 snapback4/reports/20261102-progressive-history-1a/core-full.log; tail -6 snapback4/reports/20261102-progressive-history-1a/ref-check-final.log
```

88. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
tail -15 snapback4/reports/20261102-progressive-history-1a/core-full.log; rg -n '^error:|\.\.\. FAILED' snapback4/reports/20261102-progressive-history-1a/core-full.log
```

89. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
rg -n 'fn events|joined|set_held|held' snapback4/crates/snapback4-device/src/device/history.rs | head -45; sed -n '90,175p' snapback4/crates/snapback4-device/src/device/history.rs; tail -7 snapback4/reports/20261102-progressive-history-1a/core-full.log
```

90. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
sed -n '1,89p' snapback4/crates/snapback4-device/src/device/history.rs
```

91. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
tail -12 snapback4/reports/20261102-progressive-history-1a/core-full.log; git diff --check
```

92. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
python3 - <<'PY'
from pathlib import Path
import json
p=Path('snapback4/reports/20261102-progressive-history-1a')
for name in ['core-focused.log','core-focused-r2.log','core-focused-r3.log','http-focused.log','core-full.log','http-full.log','build.log','affected.log','ref-check.log','ref-check-root.log','ref-check-final.log']:
 lines=(p/name).read_text().splitlines()
 summaries=[line for line in lines if line.startswith(('test result:', 'error:', 'ref-check:', '# 32 commands', 'Checked ', 'Saved lockfile')) or 'Finished `' in line]
 print(name + ':')
 if name=='core-full.log': print(f'{len([s for s in summaries if s.startswith("test result:")])} test-result lines (including any nested child tests); full command exit 0 observed')
 print('\n'.join(summaries[-3:]))
for receipt in sorted(Path('target/affected').glob('*.json'), key=lambda p:p.stat().st_mtime, reverse=True):
 data=json.loads(receipt.read_text())
 if 'snapback4/crates/snapback4-core/src/partition/acquire.rs' in data.get('observedFiles',[]):
  print('affected receipt:',receipt)
  print(json.dumps({k:data.get(k) for k in ['started','complete','results']},indent=2))
  break
PY

git diff --check
git status --short
rg -n 'pub struct SnapshotCursor|pub fn acquisition_page_at|fn whole_eligible|fn resume|fn page\(|pub struct AcquisitionProgress|fn walk\(|PROGRESSIVE_ACQUISITION|advertised|acquire:|if let Some\(acquisition\)|impl.*Reply|fn serve\(|fn two_tiers|fn hints_skip|fn leave_between|fn pending_write|fn expired_and|fn legacy_cursor|fn union_rows|fn oversized|fn progressive_acquisition' snapback4/crates/snapback4-core/src/partition.rs snapback4/crates/snapback4-core/src/partition/acquire.rs snapback4/crates/snapback4-core/src/partition/snapshot.rs snapback4/crates/snapback4-core/src/engine/acquisition.rs snapback4/crates/snapback4-core/src/device_protocol.rs snapback4/crates/snapback4/src/serve_sync.rs snapback4/crates/snapback4/src/serve_acquire.rs snapback4/crates/snapback4-core/tests/progressive_acquisition.rs snapback4/crates/snapback4/tests/serve_sync/progressive.rs
```

93. Cwd: repository root. Inspection/edit command; no new test-summary verdict.

```sh
python3 - <<'PY'
from pathlib import Path
import json
p=Path('snapback4/reports/20261102-progressive-history-1a')
print(json.dumps({f.name:[line for line in f.read_text().splitlines() if line.startswith(('test result:', 'error:', 'ref-check:', '# 32 commands', 'Checked ')) or 'Finished `' in line] for f in p.glob('*.log')}))
PY
```

Chunk 1a STOP. The supervisor owns the commit and subsequent chunks.

