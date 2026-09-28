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
3. `VERSION=… PUBDATE=… ATTEMPT=1 bash dryrun-when-quiet.sh` (or
   `run-dryrun.sh` directly when the M1 is quiet), then `run-finish.sh`, which
   publishes and verifies the registry.
4. Land the publication record as before. The M5 kit remains as the fallback
   host; nothing there was changed.

Close this ticket when the 0.4.8 record on main names the M1 as its host.
