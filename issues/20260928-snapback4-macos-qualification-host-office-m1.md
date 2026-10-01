# Snapback 4: macOS publication qualification runs on the office M1

**Opened:** 2026-09-28, on Charlie's ruling "Move macOS qualification to the M1"
**Severity:** Medium: publication cadence; 0.4.7's dry run needed three attempts over more than nine hours on the black M5
**Area:** the snapback4 publication kit (outside the repository), `snapback4/scripts/publish.mjs`, `snapback4/scripts/qualify-linux.mjs`
**Status:** Open until the first publication cut from the M1 lands its record on main; owner is whoever publishes next (the office session through 0.4.7)

## Why

The black M5 (`100.88.75.121`) hosted every publication through 0.4.7. It now
carries about 45 logged-in sessions, XProtect at half a core, and other
sessions' Rust and Node builds. The 0.4.7 dry run was stopped twice and passed
on its third attempt, more than nine hours after the cut, against a publish
rhythm of about twelve hours before that. The office M1 (`100.82.202.35`,
10 cores, 64 GB) idles at load 4 to 5 between calibration runs.

## What is in place on the M1

- `~/sb4-pub-template/`: the M5's 0.4.7 kit (pubstep, native, publish,
  finish, bump, run-* wrappers, helpers) rendered with `{{VERSION}}`,
  `{{PREV}}`, `{{PUBDATE}}` and `{{TAG}}`. `cut.sh VERSION PREV PUBDATE`
  renders `~/sb4-pub-<TAG>/` (TAG is the version without dots). `start.sh`
  reuses a warm worktree at `~/projects/snapback-pub-<TAG>` when one exists,
  bumps, pushes `pub/publish-<TAG>`, and starts the native half.
- `~/sb4-03-lanes/codesign-relay/codesign`, the same shim as on the M5,
  tested: an ad-hoc sign through the GUI session's launchd completes in 0.6 s.
- `~/sb4-03-lanes/published-0.2.33/`, the fence the dry run compares against.
- `~/projects/snapback-pub-048`, a warm detached worktree at `80036b4664`.

Differences from the M5 that the kit absorbs:

- `xcode-select` on the M1 points at the command-line tools and there is no
  passwordless sudo, so `pubstep.sh` exports
  `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer` (Xcode 26.6,
  iOS 26.5 runtime).
- The simulator is the M1's iPhone 17 Pro, `CD019FCB-AF6D-4A41-8FE6-75B5380ACD95`.
- `dryrun-when-quiet.sh` waits for a 15-minute load under 10 (10 cores), not
  under 30, and refuses to start while a calibration builder is loading the
  machine.

## Validation on 2026-09-28

Warm-up (`~/sb4-pub-048-warm.log`), all exit 0: root and package installs,
xcframework build 9 min 19 s, server build 1 min 57 s, wasm build 2 min 58 s,
client package build, `npm whoami`, `xcodebuild -version`.

Simulator rehearsal (`~/sb4-pub-048-rehearse.log`), the native half's
simulator steps run raw without publication records: simulator boot 4 s, but the
first boot of the iOS 26.5 runtime took 33 min to become ready (the M5 warm:
6 s); the chat backend check 5 s; the cold Expo release build 39 min 28 s
(the M5: 29 s from cache, 161 s for 0.4.6); simulator install 41 s. The
witness's first run passed every functional step of both segments and then
failed at teardown with `E_WITNESS_PROCESS: owned process did not stop within
10 seconds`, the hardcoded SIGTERM grace in `crates/snapback4/src/verbs/witness.rs`,
while the machine was under the boot's load storm. A rerun of the witness alone
passed: offline segment 62 s, restart segment 134 s, `ok: true`. Expect one slow
native half per fresh runtime and DerivedData, and rerun the witness step if it
fails only at teardown.

## Co-tenancy on the M1

The M1 is not idle. It hosts the Clique calibration builder (calibration #25
on 0.4.7 started there at 09:11 UTC and overlapped this rehearsal from 09:22
to 10:37 UTC, so its early milestone timings ran beside a 40-minute Xcode
build and a simulator boot: treat them as contaminated), the six-hourly
`com.snapback.local-proof-backstop` and two-hourly `com.snapback.drift-backstop`
launchd jobs, and long-running snapback2 compiler processes under
`~/projects/snapback-worktrees/clique-client-sessions`. Load reached 550
during calibration #25 with the backstop running.

Rule: the native half and the dry run never run while a calibration builder
is running. `start.sh` refuses when a `clique-sb4-*` lane process exists
(`FORCE=1` overrides) and `dryrun-when-quiet.sh` waits it out. This is
sufficient while trains are longer than a calibration (about 5.5 hours). If
the train gets shorter than that, one of the two must move: candidates from
the fleet are the Apartment M5 Pro mini (`100.64.36.16`) and the Apartment
M1 Max; probe load before assigning either.

## Procedure for the next publication

1. On the M1: `bash ~/sb4-pub-template/cut.sh 0.4.8 0.4.7 <PUBDATE>`, then
   `VERSION=0.4.8 PREV=0.4.7 PUBDATE=<PUBDATE> bash ~/sb4-pub-048/start.sh`
   (native half), then `run-prepare.sh`. Cut only once the publication date is
   known: the helpers hardcode `reports/<PUBDATE>-publication-<VERSION>`.
2. Copy the prepared client to EPYC and run
   `node snapback4/scripts/qualify-linux.mjs` there; `publish.mjs` refuses to
   run on Linux and imports the result. Copy `receipt.json` and
   `snapback4-linux-x64-0.4.8.tgz` back into the M1 worktree's
   `snapback4/target/incoming/linux-0.4.8/`.
3. Once calibration is idle, prewarm tests **inside the bumped publication
   worktree's `snapback4/` directory** with
   `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT cargo test --workspace --no-run`.
   Use the dry run's Rust toolchain, target directory, default test profile,
   features, `RUSTFLAGS` and Cargo profile environment. Do not add `--release`
   or `--profile production`; those do not warm the suite's test artifacts.
   This executes no tests and produces no qualification receipt. Then run
   `VERSION=… PUBDATE=… ATTEMPT=1 bash dryrun-when-quiet.sh` (or
   `run-dryrun.sh` directly when the M1 is quiet), then `run-finish.sh`, which
   publishes and verifies the registry.
4. Land the publication record as before. The M5 kit remains as the fallback
   host; nothing there was changed.

Close this ticket when the first subsequent publication record on main names
the M1 as its host.

## 2026-09-28 — 0.4.8 on the M1: the suite does not pass here yet; published from the M5 fallback

The 0.4.8 native half, client preparation and Linux qualification ran as planned (release commit 7a056f2fee; Linux `== 0 failure(s) in 1807 s`). Both Darwin dry runs on the M1 failed on host speed, not product defects:

- **Attempt 1** (19:07Z) overlapped the six-hourly local-proof backstop; the Rust stage took 9,660 s and `snapback4::replay::replay_delivers_900_followers_promptly_after_commit_without_schedules` missed its 5 s wall deadline. Stopped after that failure.
- **Attempt 2** (22:26Z, no co-tenant): `== 3 failure(s) in 5269 s`. Rust: the same replay deadline, and `serve::tests::ephemeral_tests::rate_and_input_refusals_are_http_200_failed_under_dev_and_serve` (its token bucket refills between requests on a slow host). Client tests: file-level timeouts under the suite's default parallelism on 10 cores, e.g. "web admission review: recovery and transport respect the session boundary" hit 180 s and cancelled every subtest, and "a peer logout commits before the next lock holder…" took 45 s. Client models failed as well.

The same commit's dry run then ran on the black M5 (18 cores), the kit's documented fallback, reusing the Linux receipt; the 0.4.8 publication record names that host.

Before the next M1 cut:
1. The two Rust tests are made host-tolerant on main (the replay property is "wakes without a schedule tick", now bounded at 60 s with jobs asserted empty; the rate test re-drains its bucket before each request).
2. The client test files that time out at 10 cores need their own fixes or a documented per-host concurrency for the publication run (the dry run unsets `SNAPBACK4_TEST_SERIAL_CLIENT_FILES`; decide whether publication may set a lower concurrency on smaller hosts without weakening the suite).
3. Warm `cargo test --workspace --no-run` in the publication worktree before the dry run; compiling tests took most of an hour on the M1.


## 2026-09-29 — Lane MT: ten-CPU suite qualification and test warm-up

The full source suite passed twice on Linux restricted to CPUs 0–9, then once
unpinned, with a 64 GiB memory cap and swap disabled: **2,064 s, 2,080 s and
1,254 s**, respectively. The publication concurrency overrides were unset.
Each run passed 4,305 Rust tests, 4,858 client tests, 79 model tests and nine
fixture-wrapper tests; the same 33 Rust ignores and ten conditional client
skips remain. No failures or cancellations in final qualification.

`scripts/test.sh` now gives all ordinary client files one CPU-derived pool:
`max(1, min(24, floor(os.availableParallelism() / 3)))`, or three slots on ten
CPUs and 24 on 96. Acquisition/server-e2e no longer add seven shard processes
outside that pool. Rust and full-count serial models retain their stages.
Three existing retention/reset fixture races were reproduced and corrected
without changing product code, assertions or timeouts: valid isolation reads,
event capture for transient replacement notifications, and complete synthetic
query evidence. The original Linux baseline was green; the historical M1
file-level timeouts did not reproduce here. All diagnostic failures and their
classifications are in the [Lane MT report](../snapback4/reports/20260929-mt-ten-core-suite/REPORT.md).

The warm-up command in step 3 is compatible with the suite's authoritative
Cargo inventory. On this host the cold inventory took 423 s; a subsequent
`cargo test --workspace --no-run` reused all 273 test binaries in 0.25 s wall
time. It must use the bumped publication worktree and matching build inputs;
it supplies no test result or publication receipt. Wasm was byte-identical to
the rebuilt baseline: 2,042,203 B raw / 593,573 B gzip-9, under the unchanged
593,719 B cap.

The M1 was neither contacted nor loaded; no artificial ambient memory pressure
was introduced on Linux. This result does not qualify Darwin or those skipped
conditional lanes. The ticket remains **Open** for the actual M1 publication
record after calibration is idle. This lane committed locally only; no push
or publication.

## 2026-09-29 — 0.4.9 on the M1: the dry run failed again under load; published from the M5 fallback

0.4.9 was first cut on the M1 at `7fd2795935` (from main `6d8e530674`, after lane MT's ten-CPU pool). The native half, client preparation and a Linux qualification against the M1's client passed.

- **Attempt 1** stopped at once: `publication source is dirty`. The native witness step appends a line to `snapback4/metrics/witness.jsonl`. Before a dry run, save that line and restore the file: `cp snapback4/metrics/witness.jsonl ~/sb4-pub-<TAG>/witness.jsonl.native-<TAG> && git checkout snapback4/metrics/witness.jsonl`. The records commit restores it. The M5 kit now does this; `~/sb4-pub-template` on the M1 does not yet.
- **Attempt 2**: `== 3 failure(s) in 11298 s`, with the M1's load near 80 while no calibration was running.
  - `cargo test` alone took 8,276 s.
  - The failures were timing assertions: the clique_03 replay's "celebrity write ratio 23.1 exceeds 3", the typing-expiry test's 30 s timeout, and a web admission review file whose failure cascaded.

0.4.9 then moved to the black M5, where it took four more cuts. When the M5 was briefly offline, the fourth cut (a7caaa9234) also ran here: its native half and a Linux qualification against the M1's client passed, but dry-run attempt 3 failed 12 client tests and attempt 4, with client files serial, failed 27. They cluster in Chromium-driven browser tests: web admission review (180 s timeouts, and a hang on an idle dev server), web startup, and the IndexedDB journal and orphan tests. The same files pass on the M5. One suspect is `witness/lib.mjs` `chromiumExecutable()`, which picks the highest-sorted Playwright chromium build in the cache (1193, 1234 and 1243 here) rather than the revision `playwright-core` expects; lane SL has the evidence. The M5's dry runs exposed defects unrelated to host speed: the first macOS run of lanes PQ and WK, and publication-only checks that lane suites never run (the published-0.2.33 byte pin). Each was fixed on main (`a5e690077a`, `77bbb5c4ff`). The 0.4.9 publication records state every attempt.

**Assessment.** Lane MT removed the file-level timeouts on an idle ten-CPU host. The M1's ambient load is the remaining obstacle; it is not from calibrations, which are already excluded. The ruling to move macOS qualification to the M1 stands. This ticket stays open with two paths:
- make the remaining wall-clock assertions load-tolerant, for example by measuring the celebrity write ratio against a control taken in the same run;
- or reserve the M1 for publication windows.

Separately, run a lane's new client test files on a Mac before a release cut. PQ and WK passed every Linux suite and failed only on macOS. The Apartment mini ran such a canary for the final cut's new lanes (`~/sb4-canary.sh`): all green.

## 2026-10-01 — the M1 qualified 0.4.10; signing is the remaining blocker

After 0.4.10's first dry run on the M5 failed on host sleep (the M5 is an
in-use laptop), the office M1 qualified the release: native half, a Linux
qualification against the M1's client, and a dry run whose full suite
passed (`== 0 failure(s) in 9455 s`). Two causes explain the earlier M1
failures, and both are now handled:

1. **This repository's drift backstop loads the host.** The launchd job
   (`com.snapback.drift-backstop`, 2 h interval) runs 2.5–4.5 h, so it runs
   almost back to back. On 2026-09-30 one run held 278 runnable processes
   (load 283), and a native witness failed at teardown when its video
   recorder did not stop within 10 s. Publication now holds both launchd
   backstops off the host (`launchctl bootout`, only when no run is in
   progress) and restores them afterward; a safety watchdog restores them
   after 14 h at most.
2. **The "Chromium failures" were a cascade.** In 0.4.9's M1 attempt 4, one
   web-admission-review test timed out under load, then closed the shared
   browser, so every later test failed with "Target page, context or
   browser has been closed". Lane SL made that test hold up under load.

**Remaining blocker:** the M1 has no code-signing identity at all
(`security find-identity -v -p codesigning` finds 0). The dry run signs the
darwin binary with a Developer ID Application identity right after the
suite, so the M1's dry run stopped there. Only the black M5 holds that
identity. 0.4.10 was therefore signed and published from the M5 (dry run
attempt 2, run under `caffeinate` so the laptop could not idle-sleep). For
the M1 to publish, the owner must install the Developer ID Application
identity in the M1's login keychain, or set `SNAPBACK4_SIGN_IDENTITY` to an
identity that exists there. This ticket stays open until then.
