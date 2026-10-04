I'll review lane NZ rounds 0 and 1 on the named commits, using a scratch worktree on eb1000 for Linux-runnable checks only, and leave the lane branch untouched. First I'll read the review workflow and the lane report so the checks match what NZ claims.The review range is the two NZ rounds, not the whole branch against main. I'll read the lane report and the commit range, then run only the Linux checks that don't need a Mac.This host is eb1000 (`expose-builder-pixel`). The checkout is already at `1c589336fa`. Next I’ll read the lane report and the custody, deadline, and export code those two commits added.The deadline treats log growth as progress, and the guardian holds an export lease across the detached proof. I'll trace publication, cleanup, and the helper next to see whether that lease or a chatty log can stall the next export or hide a hang.The deadline treats any new log bytes as progress, and the Mac suite log is not on this machine. I’ll recompute the in-repo measurements and run the Linux-side tests in a scratch worktree.Auto-compacting conversation (80% full)...
Conversation compacted.
The code reading is already in hand. I’ll run the Linux checks in a scratch worktree, then write the verdict from those results plus the lane’s recorded evidence.This host is eb1000 and the checkout is the lane tip. I’ll add a detached scratch worktree and start the scoped Linux build there, without touching the lane tree.The offline build failed because a vendored dependency is missing in the scratch tree. I’ll see how the lane checkout supplies it and rebuild from that.The scratch binary built. Next I’ll run the deadline, cleanup, and custody checks, and recompute the measurement tables from the committed samples.**READY WITH CHANGES.** Rounds 0 and 1 do take the native proof off the critical path, and the custody design holds for a single crash. The progress deadline can still sit for 60 minutes on a log that grows without the build moving, and a failed skip marker can leave the previous proof looking current.

Reviewed `38d9bfe0de..1c589336fa` (`533721bafe`, `1c589336fa`) on this machine (`expose-builder-pixel`), not the Apartment mini, the office M1, or the M5. Checks ran in a detached scratch worktree at `1c589336fa`, which has been removed. The lane tree was not modified and nothing was pushed.

Linux checks that ran: a debug build of `snapback4`, then 10 Rust tests (deadline, WD cleanup arithmetic, sleep-clock numbers, environment-skip classification, and a live stall that drains its process group) — 10 passed, 0 failed, 3.39 s. The Node preparation fixture passed, including a foreground command timeout of at most 900 s, a background timeout above 3,500 s, and streamed `pod install` / `xcodebuild`. All 13 detached-custody tests in `export-background.test.mjs` skipped on Linux and did not fail.

## Findings

**1. Moderate. A chatty log is treated as progress, so a background preparation can occupy the only proof slot for 60 minutes without the build advancing.**

`Deadline::observe` renews the idle clock whenever any direct child `*.log` other than `background.log`, or `preparation-progress.jsonl`, gains bytes. Truncation, an unchanged size, mtime, and the custodian’s own journal do not count, and an expired budget cannot be revived. That matches the written “new bytes” rule. It does not match “no real progress.” Repeated lines, timestamps, or “Planning…” reset the 900 s idle clock until the 3,600 s hard cap.

While that runs, the project’s single `background.lock` is held, and `simulator::select` runs before `prepare_app`, so a booted private simulator is held too. The next export still returns; its proof waits.

Foreground is unchanged. `observe` returns immediately when the run is not background, both limits are 900 s, and the extension is wired only for `background::active() && label == "preparation"`. Explicit `native:smoke` and `witness ios --build` never set that flag. The Linux tests confirm the 900 s wall despite output, the hard cap, and that a stalled child is drained.

The inverse is also true. Only `pods` and `xcode-build` stream into their logs. Every other phase is buffered until exit, so a silent linker or a quiet snapshot still dies at 900 s of idle even if it is real work. The qualified social builds did not hit that: Xcode logs grew for 766–775 s, with 118–133 observations and `expired: false`.

Tighten “progress” to a phase change or non-repeated output, or say in LLP 3000.030 §15 that a chatty non-advancing log is an accepted 60-minute bound.

**2. Moderate. If the skip marker fails, the previous proof stays `latest`.**

On opt-out or a non-macOS host, `export-ios.mjs` publishes, then calls `witness export-skipped` only when `artifacts/native-smoke/latest.json` already exists, with a 5 s timeout. If that command fails, the wrapper prints `native smoke status update failed` and `native smoke skipped`, returns 0, and does not move `latest.json`. The next `doctor` and `witness status` still show the old pass. The line includes the old export hash, but it is presented as the current native-smoke status.

The success path does supersede: `skipped()` writes a new request and a `skipped` result under the publication lock. The Mac test that covers an in-flight opt-out was skipped here. After `schedule` has written `latest.json` once, a later failure writes that new run’s `result.json` and is not stale. A superseded guardian overwrites only its own directory.

**3. Low. `doctor` prints a failed proof and still exits 0.**

`doctor` pushes `doctor_summary` and never sets `ok = false` for it, so the process exit and the JSON `ok` field stay success. `witness status` exits 1 on `failed`. The recorded doctor status 0 was a passing proof; it does not show that doctor fails a bad one. The failure line itself is the same text status prints.

**4. Doc. LLP 3000.030 §15 still describes the old opt-out in the present tense.**

The new revision correctly says cache misses do not advertise an opt-out, and that only `guide witness` documents `SNAPBACK4_NATIVE_SMOKE=off`. The historical paragraph below it still says cache misses print the three-to-four-minute cost and `SNAPBACK4_NATIVE_SMOKE=off` before Xcode. The cache-miss line no longer does that. The package README, the social starter README, and the guide’s milestone paragraph no longer put the opt-out next to the cost. The guide mentions the variable once, as a disable switch.

The guide also says `status` distinguishes `superseded`. Status follows `latest.json`. A superseded older run is written into that older directory, which is no longer what status prints.

## Checks

**Custody.** For one death, the chain is sound. Publication holds `publication.lock` only through the verified publish and the spawn. The guardian is detached with `setsid` (and `taskpolicy -b` on macOS), holds the export lease on fd 3, and waits on `.snapback4-witness/background.lock`, so only one driver runs per project. A guardian that is no longer `latest` exits as `superseded` or SIGTERMs its driver, then SIGKILLs that process group after 120 s. The driver watches its parent’s pid. Preparation uses `PR_SET_PDEATHSIG` on Linux and kqueue `NOTE_EXIT` on macOS; the Linux stall test drained the group to zero members. Background selection does not reuse a booted device. Deletion requires an ownership record matching udid, name, and runtime, with a prefix, and either `ready == false` or a background run whose selection is `created`. Explicit and reused devices are not deleted. Name-only deletion is not added.

WD’s cleanup rule is intact. `cleanup.rs` is not in this diff. Idle cleanup still extends only when the process-group member count shrinks, the 60 s hard cap does not move, and the deadline is not reset on retry. The guardian uses that deadline after the driver exits. Background `simctl create` stays in the driver group on purpose, so a timeout signals only the `simctl` pid; a later group kill still reaches children that stayed in the group.

Residuals the code does not close: both guardian and driver dying together; `recovery::write` syncs the file and not the directory; a `simctl` that called `setsid` could outlive the timeout signal. The lane already documents the simultaneous-death case.

**Deadlines.** Yes. A log that grows without the build progressing can run to the 60-minute cap (finding 1). Foreground stays 900 s. The outer guardian bound is 75 minutes.

**Reporting.** On the success path, `latest.json` is updated before `export:ios` returns, and status reads that directory’s `result.json`, so an older pass is not shown as the new export’s result. The hole is finding 2. There is a narrower flap: `latest.json` is written with a null hash before the bundle is hashed, and if that gap exceeds 5 s with no live `launch.json`, status synthesizes “exited without a result.” That state is not saved, and the 3–4 s samples did not hit it. Status also ignores `driver-result.json`, so a guardian that dies after the driver wrote that file is described as having exited with no result. The state is still `failed`, not a stale pass.

**WD interplay.** Correct, as above. NZ did not weaken the membership-shrinkage rule.

**Measurements.** Recomputed from the in-repo sample JSON. They match the report. All 16 export samples exited 0, all three segments passed, and the published hash matched the loaded hash.

| Cell | Foreground return (includes proof) | Background return | Background result available |
|---|---:|---:|---:|
| Plain cold | 154.52–167.63 s | 3.07–3.90 s | 485.70–595.07 s |
| Plain warm | 42.02–44.39 s | 3.10–3.66 s | 102.05–108.12 s |
| Social cold | 219.25–219.59 s | 3.61–4.64 s | 1,135.57–1,177.32 s |
| Social warm | 51.93–53.95 s | 3.89–4.36 s | 125.60–128.24 s |

Five cold social proofs passed: the two export B samples (preparation 1,094.782 s and 1,051.017 s, 120 and 121 observations) plus three interference proofs (1,096.604 s, 1,438.464 s, 1,485.351 s; returns 3.59–3.83 s). None expired.

Interference, same formula as `round1-summary.py` (B against time-interpolated A controls; no block dropped): cached-proof median **+4.47%** (n=6, range +3.60 to +6.74); cold-compile median **+0.53%** (n=6, range −0.33 to +0.63). All 24 workload runs passed. Overlap is about 1; values slightly over 1 are timestamp noise and the summarizer clamps them.

ABBA is enough for the critical-path claim. The contrast is 3–4 s versus 42–220 s, and the within-cell ranges stay tight on a noisy host. One block per starter and cache, two samples per arm, is not a population estimate, and the report does not pretend it is. The 4.47% and 0.53% figures are a local observation: load was swinging, n=6, and the six cold windows share three builds. That caveat is in the report. “Zero critical-path cost” is the return time. Under background QoS the proof itself is much slower than the old foreground proof (social cold about 219 s versus about 1,136–1,177 s until the result); the table shows that.

Two limits. Each B sample was `--wait`ed before the next export, so the 3–4 s figures were not taken while another proof was still running. The code returns after spawn, and the publication lock is not held for the proof, but that overlap was not measured. Ambient load1 4.88–206.80 and PerfPowerServices 0–231.6% come from host samples in an archive that is not on this machine, so those were not recomputed.

**Docs.** README, starter README, Expo README, and the guide’s milestone text match the new behavior. The deadline sentence in `guide witness` matches the byte-growth rule, including the 900 s explicit-smoke wall. The two inaccuracies are finding 4.

## What only a Mac can confirm

- A real host sleep. `slept()` passed here on injected numbers. Linux `sleep_clock()` is 0. The lane also did not sleep the mini; the report says so.
- `taskpolicy -b` and the inherited-policy check (`getpriority == 1`). The code records the setter because an external pid cannot be read back.
- kqueue `NOTE_EXIT`. Linux uses `PR_SET_PDEATHSIG`; the stall test exercised that path only.
- Creating and deleting only the recorded simulator. The lane’s `device-verification.json` says 25/25 created `sb4-nz-` devices on iOS 27 were absent. That is their audit, not a live `simctl` check here. `group-verification.json` records 225 groups and 0 remaining members.
- The 13 skipped custody tests: return while the tool is blocked, serialized supersession, SIGKILL/SIGTERM/SIGHUP of driver or guardian, SIGINT of a status observer leaving the proof running, a native failure after a successful publish, retention failure not rewriting the outcome, death during create deleting only the recorded UUID, and opt-out superseding an in-flight proof.
- The full suite log `/tmp/sb4-nz-r1-full-suite-final.log`. The committed record says status 0 and 2,501.8 s. The log is not on this machine.
- Whether `simctl` children leave the driver process group.
