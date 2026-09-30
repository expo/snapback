# Lane NS, round 1 — ownership and listener handoff

Round 1 addresses Astra's NOT READY and Grok's READY WITH CHANGES reviews of
round 0. Both reviews and the original lane prompt were read in full.
`origin/main` at `f1b1f0077e` was merged first, with both sides retained and no
conflicts, in `52b02b2de0`. Nothing is pushed or published.

The governing llp-orient context remains LLP 3000#4 (the Snapback 4 fence),
3000.030#3/#5/#13 (preparation, ownership and starter smoke),
3000.007#20.10 (installed-app assertions), 3000.019#3.4 (backend ownership)
and 2000.000#12 (the measured loop). The skill was read from the sibling
checkout's `vendor/llp/skills/llp-orient/SKILL.md`; this lane's skill symlink is
uninitialized. LLP 3000.030 remains in current and was updated in place.
No engine, device, client contract, timeout, assertion or size budget changed.

Changes:

- Automatic simulator reuse now requires a matching per-user creation record
  containing the UDID, name, runtime and lane prefix. Records live under
  `$XDG_STATE_HOME/snapback4/witness/simulators`, defaulting to
  `~/.local/state/snapback4/witness/simulators`, outside the project. A missing,
  malformed or stale record does not authorize any device. The live device
  must also exist, be available and booted, and match the requested prefix.
  Explicit `--udid` remains available without a tool-creation record.
- Selection sorts available runtimes numerically, newest first, for both reuse
  and creation. Creation deliberately chooses the highest numbered supported
  standard iPhone, preferring it to variants in that generation; it no longer
  takes whichever device type simctl lists last.
- Newly created identity enters the structured failed-run receipt before
  fallible ownership persistence, boot or bootstatus. The per-user creation
  file is exclusively created and synced before boot. The tool never deletes,
  erases or shuts down a simulator automatically.
- The loopback listener stays bound through preparation and is inherited by
  `dev`. The child restores close-on-exec before starting workers, validates
  the descriptor/type/address, and serves that same socket with the existing
  connection limits. Subsequent starts use the same socket handoff. The
  deliberate offline interval still closes the socket to prove TCP refusal;
  another listener appearing during that interval is refused on restart and
  never killed. There is no probe/drop/rebind gap at listener startup.
- Backend `check` runs as an owned process group inside the witness's exit-code
  wrapper, after acquiring native-project and backend-project leases (deduped
  when equal). Leases remain held through the complete run. Missing schema
  fails with exit 1, one actionable message, and a failed-run receipt. Check
  output is retained in artifact logs; it cannot exit the parent with code 2.
- Both package READMEs replace the unrelated 159.841 s / six-minute figures
  with round 0's qualified starter observations: 221.7 s cold, 83.5 s warm
  median (three runs), 186.2 s social; shared Apartment M5 Pro mini, 18 cores /
  64 GiB, Xcode/iOS 27, and all three load ranges. They say “Guidance, not a
  promise.” The witness card explains creation records and socket custody.

The public proof scope is unchanged: installed Release/Hermes application,
native local-store acquisition, offline reopen and backend restart. Empty
starter holdings establish lifecycle, not populated history. Generic smoke
does not enqueue a write; replay, application-specific assertions, M6/M8,
physical devices and publication still require their own evidence.

## Detecting regressions

`round0-built-regressions.json` records eight Rust controls plus the two
package README checks failing against a newly built, clean exact round 0
commit `3f59b23d2c` and its README bytes. `regression-provenance.json` binds the
source commit, build command, both CLI binaries and the test executable.
`round0-regressions.json` and its two logs also retain the initial repetition
against the saved pre-edit executable. Each control passes on round 1. The saved round 0 executable's
SHA-256 is `22cba48fcbc98bae38c7826c079eb9fb16da77660f5357f7da782d83519e3d70`.
Both repetitions use a test executable containing the new tests; only the CLI under test was swapped,
then restored in a `finally` block. README checks read actual files, temporarily
restored from `3f59b23d2c`, with the same restoration discipline.

| Finding | Regression |
| --- | --- |
| Prefix is not ownership | `prefix_without_creation_record_is_ignored`: a booted matching-name device without a record must be ignored; the newly created UDID is persisted. |
| Port released after preparation | `preparation_keeps_origin_port_owned_until_backend_startup`: a competing bind in fake simctl's post-preparation container lookup must fail. |
| Port released before dev | `dev_accepts_the_still_owned_listener_without_a_rebind_gap`: dev must become ready while the parent still holds its listener; competitors fail throughout. |
| Failed boot loses identity | `boot_failure_keeps_created_identity_in_receipt`: both boot and bootstatus fail, with name/UDID/runtime/selection retained and the actual boot error checked. |
| Old README measurements | One `README uses the qualified starter smoke measurements` check for each package requires the values, host, load and qualification. |
| Runtime ordering | `owned_devices_use_numeric_runtime_order`: recorded booted devices on iOS 9.3, 18.0 and 26.5 select 26.5. |
| Device type ordering | `created_device_type_is_current_not_last_listed`: supported iPhone 17 precedes iPhone 11 in the list; creation chooses 17. |
| Missing-schema exit | `missing_schema_uses_one_message_and_witness_exit_one`: missing schema must produce one message, exit 1 and a receipt. |
| Lease before generation | `project_lease_precedes_check_generation`: another lease owner prevents generated files from being written. |

The existing driver controls still cover explicit arguments, occupied ports,
concurrent artifact ownership, simulator leases, missing Xcode/runtime, app PID
replacement, malformed receipts, all smoke segments and bounded cleanup.
Fake simctl tests are process choreography, not native-execution evidence.

## Validation and development failures

Final local checks: 40 witness driver/protocol checks; 22 init checks; 10 witness
unit checks; 36 helper/preparation/native-smoke checks; 21 periphery checks; and
106 whole-guide checks pass. Client package build, `ref-check --verbose`
(525 LLP docs, 9,973 refs, zero errors/unchecked) and `git diff --check` pass.
The client card remains 114 lines / 1,198 words, witness 399 lines and package
README 300 lines. No documentation budget increase.

`development-failures.json` enumerates every failing test by invocation and
classifies each as ours (baseline 0, environmental 0). The causes were:

- The first compile placed `mod witness_socket` before main.rs's inner doc
  comments: four E0753 errors. Moved it below the comments; compile passes.
- Initial witness checks: 24 failures / 16 passes, caused by using
  `getsockopt(SO_ACCEPTCONN)` on this Darwin host, which returns ENOPROTOOPT.
  A repeated invocation before correcting the syscall retained that same
  failure. Switched to SO_TYPE/address validation plus idempotent `listen`,
  which preserves the existing binding. The logs retain every failing test.
- After that correction: two fixture failures / 38 passes. Fake `create`
  returned a UDID whose ownership record the test had preseeded, causing
  exclusive creation to refuse. Removed that future-device record in create
  fixtures and required the boot-failure control to observe an actual boot
  error. Final driver result is 40/40, without weakening product exclusivity.
- One development Python syscall probe likewise hit Darwin's ENOPROTOOPT.
  It used a private socket and no simulator.

Deliberately failing round 0 controls are expected negative evidence, separate
from the development failures above. Full-suite results follow below.

## Native qualification

All commands used `~/np-tools/node/bin:~/np-tools/bun/bin` on PATH and
`DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`. No xcode-select or
system setting changed. `SNAPBACK4_SMOKE_DEVICE_PREFIX=sb4-ns-` isolated this
lane and `SNAPBACK4_BIN` selected this unpublished branch's CLI. Fresh plain and
social starters were generated under `~/sb4-np/ns-r1-starter` and
`~/sb4-np/ns-r1-social`. Dependencies were installed normally, then the two
Snapback packages were replaced by locally packed candidates. The current
client was rebuilt; native source is unchanged from round 0 and the qualified
XCFramework was reused. Package version remains 0.4.9; the registry lock alone
does not identify these candidate bytes. `host-and-inputs.json` binds the CLI,
tarballs and toolchain.

The measured command was exactly `npm run native:smoke`, without arguments.
Cold means a new starter with no generated iOS tree or private native caches,
plus a newly created simulator. Xcode/runtime and dependency installation are
prerequisites, outside the command timing. Global host caches were not flushed.
Warm means the same starter, generated iOS/Pods/DerivedData cache and simulator;
social is a separately generated application and is excluded from the warm
median. No native run failed or was discarded in this round.

Host: shared Apartment Apple M5 Pro mini, 18 cores / 64 GiB, Xcode 27.0
(27A266a), iOS 27.0, Node 24.18.0, npm 11.16.0, CocoaPods 1.17.0.
One-minute host load was sampled every five seconds and includes other sessions
and this lane's work. Creating the exact round 0 control checkout overlapped
the first warm run; rebuilding that control waited until all native samples
finished. These are not quiet-host measurements or an isolated estimate of
this patch's overhead. Guidance, not a promise.

| Run | Wall seconds | Load min / median / max | Result |
| --- | ---: | --- | --- |
| cold | 239.025 | 18.42 / 74.75 / 183.46 | All three segments passed |
| warm-1 | 93.667 | 21.08 / 24.89 / 29.71 | All three segments passed |
| warm-2 | 82.528 | 22.10 / 31.25 / 50.72 | All three segments passed |
| warm-3 | 86.251 | 9.93 / 12.79 / 20.57 | All three segments passed |
| social | 202.091 | 5.49 / 9.45 / 28.58 | All three segments passed |

Cold is n=1; warm median is **86.251 s**, n=3, range 82.528–93.667 s.
The package READMEs retain the round 0 cohort explicitly requested in this
round's instructions; this table is the new round 1 cohort.
Cold Pods took 117.789 s and Xcode 47.668 s; warm Pods took
13.817 / 11.814 / 12.568 s and Xcode 35.153 / 31.182 / 31.664 s.
Each plain run has 82 native compile log entries. The private cache is reused,
but Xcode runs every time. All five ports and JavaScript hashes differ.

Cold created `sb4-ns-1790774558119-51432`, UDID
`3641D1D5-F689-44EF-BFD1-12C83A9AD191`, runtime
`com.apple.CoreSimulator.SimRuntime.iOS-27-0`, using the supported
`com.apple.CoreSimulator.SimDeviceType.iPhone-18-Pro-Max`.
All warms and social reused its persisted creation record. After collection,
that exact device and its ownership file were deleted; before/after inventories
and the captured record are in `simulator-cleanup.json` and the simulator lists.
It was absent before this round and is absent afterward. No other simulator was
created or used; `mini-verify-iphone` was never targeted. Only owned process PIDs
were stopped.

`receipt-index.json` preserves **320 files** across all five runs under
`receipts/`, including receipts, logs, screenshots and videos. JSON/log/helper
text is compressed losslessly (`gzip -dc`); recorded hashes describe original
bytes. The collector verifies every run artifact hash, proof/build binding,
complete app inventories (100 entries for plain, 126 for social), and every
Xcode result inventory (eight entries each), including modes, links, lengths
and hashes. Larger `.app` and `.xcresult` directories remain at the original
paths in the index. Helpers in each run match the tested source. All three
segments passed in every receipt. The plain offline screenshot also visibly
shows the native starter offline with its restored guest session.

Mac wasm: **1,977,951 B raw / 593,592 B gzip**, **127 B** below the unchanged
**593,719 B** ratchet. No budget increase.

## Complete suite

Ran `scripts/test.sh` **once**, on eb1000 in the reused isolated
`/home/ccheever/sb4-intent/lane-ns-verify` worktree. Its prior round 0 snapshot
was checkpointed locally before installing this round's source. All **2,273**
source files in `suite-source.json` were hash-verified there before and after
the suite; there was no product-source change after launch. The local main
merge is identified in that snapshot; this is source-bound evidence, not a
claim that the remote checkpoint's Git HEAD is the local merge commit.
The final report/journal/LLP result paragraphs were written afterward.

Node 24.13.1, Bun 1.3.14, Cargo 1.97.0; 96 CPUs; initial host load
1.82 / 1.72 / 1.98. The exact summary line is:

```text
== 0 failure(s) in 1357 s
```

Exit **0**. Every full-suite failure: **none — ours 0, baseline 0,
environmental 0**. Rust: **4,366 passed / 33 declared ignored**. Client
pool: **5,312 passed / 10 existing skipped**. Fixture wrapper: **9 passed**.
Serial models: **79 passed**, including both complete 5,000-sequence session
walks and the complete 3,000-sequence online-client walk. No cancelled tests,
reduced counts, changed timeouts or loosened assertions. The nominal inherited
60-second suite bar is exceeded and is not represented as met.

Linux wasm: **1,978,828 B raw / 593,225 B gzip**, **494 B** below the same
593,719 B ratchet. No cross-host byte-identity claim. `full-suite.log.gz`,
`full-suite.exit`, `full-suite-host.txt`, `suite-summary.json` and
`suite-source-verification.txt` retain the exact result. `check-logs.json`
binds the uncompressed bytes of every retained top-level command log.

The implementation, documentation, this report and one appended journal entry
are committed locally with the requested
`Co-Authored-By: GPT-6 Astra <noreply@openai.com>` trailer. Nothing was pushed
or published.
