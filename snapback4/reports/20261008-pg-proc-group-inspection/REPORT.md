# PG — native Linux process-group inspection

2026-10-08 · eb1000 (`expose-builder-pixel`, Linux 6.8.0-142-generic) ·
branch `sb4-intent/pg-proc-group-inspection` · base `1dd87edd57`.
Work and all process load stayed in this worktree on eb1000. No push.

## Finding

The instrumented, otherwise unchanged native witness reproduced the refusal
on loaded witness-module run **9**. It failed
`preparation::cleanup_tests::direct_enumeration_resizes_and_keeps_births_in_the_selected_group`.
[Raw run output](instrumented/009.log.gz), [exact stat bytes](first-refusal.stat),
and [decoded refusal detail](first-refusal.json) preserve the observation.
The first eight runs are retained too; run 8 has a separate assertion failure
described below.

The rejected PID was **4095072**, with comm `pg plain`, matching this
campaign's short-lived churn children. The selected witness group was **4092886**.
The 139-byte stat has a final newline and all 52 fields. It reports state
**X**, PPID **0**, PGID **-1**, session **-1**, and birth tick **17057038**.
The native parser rejects the negative PGID. Immediately afterwards,
`getpgid(4095072)` returned **ESRCH (3)**; rereading its stat returned
**ENOENT (2)**. There was no surviving PID to classify as a zombie or compare
births with. The observed snapshot says X, not Z; no matching current birth
is inferred from the vanished process.

This is an exit/reaping race, not a split comm, truncated read or permission
error in the captured incident. The parser already found the last `)` and
worked on bytes before this change. Existing tests exercise non-UTF-8 comm
with spaces and parentheses both inside and outside the selected group.
Historical LU/FH/RO/EM/FL/FS failures lack snapshots; their identical diagnostic
does not establish that every historical incident had this exact row shape.

Linux 6.8's [`do_task_stat`](https://github.com/torvalds/linux/blob/v6.8/fs/proc/array.c#L442-L628)
initializes PPID to zero and PGID/session to -1, fills them only when it can
lock the task's sighand, and emits signed decimals. The state table defines X
as dead. That source path explains the captured complete row during reaping;
the contemporaneous ESRCH/ENOENT establishes disappearance for this observation.

## Change and safety boundary

The instrumentation was installed **before** reproduction. Its exact delta
is [instrumentation.patch](instrumentation.patch.gz), with executable hashes in
[instrumented-binaries.sha256](instrumented-binaries.sha256). No parser acceptance
changed in that campaign.

The final parser keeps the last-`)` byte split and all PGID/state/birth checks.
A rejected readable row now triggers one fresh `getpgid` on the PID obtained
from its `/proc` directory. **Only ESRCH turns that candidate into gone.**
A live PID, another current group, PGID zero, or an inaccessible/failed probe
still refuses. X/Z or the sentinel alone never authorizes dropping a row.
Unlike an untrusted PID printed in a ps table, the lookup PID comes from the
enumerated proc directory; malformed row contents cannot choose the recheck.

Refusals include the parser reason, PID, selected group, original raw stat
as hex, and immediate PGID/error and stat state/birth observations. Each of
the two byte snapshots is limited to 4096 bytes with length and truncation
explicit. The captured real row is complete, not truncated. No environment
or cmdline is read. Diagnostic rereads do not confer ownership or turn a live
unknown process into success. Successful ordinary rows need no extra syscall.

The retained leader birth, reaping lock, guardian checks, checks before group
signals, whole-group STOP/KILL, cleanup deadlines and two empty inspections
remain intact. Neither inspection nor this new ESRCH check grants signaling
authority. A changed birth remains a refusal for a live group.

## Reproduction and verification

Commands run from `snapback4/`. `bun install --frozen-lockfile` succeeded and
`bash ~/sb4-intent/check-sdk-deps.sh` printed **deps-ok**. An initial invocation
from the repository root failed the checker's relative package lookup; the
Snapback 4 install/check ran successfully before implementation.
Native builds used six jobs and
`LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT`.

[repeat.py](repeat.py) pins tests and owned load to CPUs **88–91** with taskset.
Each campaign starts six Python busy loops and two [C churners](churn.c).
Each churner forks up to 32 children per batch, gives alternating children
`pg plain` / `pg (odd) name` comms, exits them after 1 ms and reaps every one.
The parent handles are recorded, terminated and waited at campaign completion;
no name-based or host-wide process signaling occurs. Other worktrees/processes
are untouched. The instrumented nine-run campaign created/reaped **933,920**
churn children. Per-run output is gzip-compressed; each campaign's summary
records commands, elapsed times, exit statuses, load PIDs and reaping.

Reproduce the campaign (after compiling `churn.c` to the sibling `churn`):

```sh
python3 reports/20261008-pg-proc-group-inspection/repeat.py \
  --label fresh-witness --rounds 30 -- \
  target/debug/deps/snapback4-19b4b0de3b5a3951 verbs::witness:: --test-threads=4
python3 reports/20261008-pg-proc-group-inspection/repeat.py \
  --label fresh-handoff --rounds 30 -- \
  node reports/20261008-pg-proc-group-inspection/export-handoff.mjs
```

The binary filename is from this build's Cargo inventory; obtain the current
path with `cargo test -p snapback4 --bin snapback4 --no-run`. Rebuild the sibling
CLI too: native test helpers re-execute it. No native executable was replaced
while a campaign was running.

- [Loaded witness module](fixed-witness/summary.json): **30/30 complete runs,
  84/84 tests per run; 2,520 passed, zero failed and zero inspection refusals**.
  Four libtest threads per run; all five new controls run each time. This
  includes all the preparation/recovery recurrence cases available on Linux.
- [Witness integration](witness-integration.log.gz): **32 passed**.
- [Loaded export handoff](fixed-export-handoff/summary.json): **30/30 passed**,
  zero inspection refusals. Each invocation runs the exact
  `maintenance crash matrix: publication-handoff (off, next Expo fails)`
  case through the canonical file runner, including acknowledged keeper cleanup.
- [Complete export-background suite](export-background.log): **70 passed,
  zero failed, 34 Darwin skips**, 104 declared cases, 434.279 seconds.
  The canonical file runner confirmed keeper cleanup; no inspection error.
- [Reference check](ref-check.log): **531 LLPs, 10,588 references, zero errors
  and zero unchecked**.

[Final native source and executable hashes](fixed-binaries.sha256) bind the
binaries used throughout these checks. The generated wasm build passed its
existing budget: **645,605 B gzip / 646,180 B**; the SDK build passed.
[SHA256SUMS](SHA256SUMS) binds the retained raw logs, snapshots and reproduction
sources. Load workers were all reaped before this manifest was written.

## Negative controls

The nine Linux inspection tests include five new controls:

- The exact captured X/-1 row passes only after ESRCH. Successful probes for
  the selected, outside or zero group, and EPERM/EACCES/EIO probes still refuse.
- A real live child receives a corrupted PGID row and genuinely malformed
  bytes through the reader seam. Both refuse; evidence preserves the bytes,
  live/non-zombie status and matching birth where available. The child survives.
  Killing/reaping that same child between the rejected read and fresh probe
  then produces the required gone result.
- A real foreign group with a second living member refuses recovery when its
  leader birth record belongs to another process. Both processes survive the
  attempted recovery and are cleaned up through their owned child handles.
- Malformed state/birth, including a purported zombie with invalid birth,
  refuses while present and passes only after ESRCH. A normal valid row does
  not require another probe.
- Oversized malformed bytes retain an explicitly truncated 4096-byte hex
  snapshot and bounded refusal detail.

Existing outside-group, arbitrary-comm and read-permission controls remain.
[Focused controls](parser-controls.log.gz): **9 passed**.

## Other observations and limits

Instrumented run 8 fails the existing
`witness_passed_outcome_survives_post_driver_compression_failure` assertion
that stderr contains `receipt compression failed`; the fixture itself exits
successfully. The assertion does not print its captured stderr, so the log
does not identify the alternate diagnostic. This failure is retained and is
not relabelled as a process-inspection failure or a passing run.
[Separate follow-up](../../../issues/20261008-snapback4-witness-post-driver-compression-diagnostic-flake.md)
retains this unknown diagnostic.

The first export-handoff campaign lacked the generated SDK `dist/resolve-binary.js`
in this fresh tree. All 30 setup failures are retained under
[export-missing-dist](export-missing-dist/summary.json) and excluded from proof.
The ordinary wasm and SDK builds supply these generated artifacts before the
real export campaign. This setup-only campaign overlapped part of witness
verification on the same CPUs, temporarily adding another six busy loops and
two churners. The real handoff campaign also overlaps the witness campaign near its end.
The final evidence does not claim an exclusive or quiet host.

Linux only: Darwin cases skip in the export suite. No M5, simulator,
publication or universal flake-free claim follows from these checks.
No cause is assigned retroactively to unretained historical snapshots.

## Governing context and documentation

The scoped `llp-orient` context is [LLP 3000 §publication suite under contention](../../../llp/3000-snapback4.explainer.md#publication-suite-under-contention)
and accepted [LLP 3000.030 §15](../../../llp/3000.030-native-proof-in-minutes.rfc.md#15),
both in `llp/current/`, plus the Snapback 4 fence and append-only JOURNAL.
The former requires completed process evidence and preserves first failures;
the latter binds native group cleanup to birth/lease custody. The witness
guide's owned-process and refusal guidance remains applicable. The LLP's
Linux inspection paragraph is reconciled with the change; no new LLP or gate.
Hand-off: none. No independent review or cross-host qualification is claimed.

The [native inspection ticket](../../../issues/closed/20261004-snapback4-native-witness-proc-group-inspection.md)
is closed with this retained reproduction and proof. Its historical recurrences
remain intact; links inside the moved ticket and from four open related tickets
are adjusted for its closed location. The separate compression-diagnostic
assertion follow-up remains open. All final source/binary digests still match,
all campaign load children are reaped, and `git diff --check` passes.
