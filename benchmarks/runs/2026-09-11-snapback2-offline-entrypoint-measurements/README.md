# Snapback2 offline-entrypoint resource measurements

Date: 2026-09-11

Source commit: `117bf209d60732b449d52b8b898c709733fdfc84`

Reviewed product pin: `a52703b7c1c438656937c5a294fca0e0e79d2090`

Governing acceptance: LLP 1012 §14 and the open offline-entrypoint ticket.

## Disposition

The committed 100-lane media/max-width resource witness and the full-engine
10%/50%/100% latency curve are now recorded. Both pass their correctness and
certificate invariants. The curve is a measurement, not a newly invented
latency threshold.

The phone cold-build peak-resident/storage obligation is still externally
blocked after a fleet-wide follow-up. One iPhone is online through both the
Air and Black hosts, and Bones has two online USB Android phones. All three
physical phones require an operator unlock before an app can launch. A release
APK and the exact 10,000-message/50-conversation workload were prepared and
verified, but no process existed from which to claim resident or SQLite bytes.
Simulator or host-process RSS is not substituted for physical-phone evidence.
The canonical full-suite deadline was deliberately not rerun in this batch.

## Fleet and source custody

The control host was `Charlie’s MacBook Pro (2)` (M1 Max, 64 GiB), where a
separate Android emulator consumed about 275% CPU and the load averages were
11.07/13.42/19.03. Tailscale targets timed out before authentication. The
Black M5 Max was reachable over LAN but already owned a workspace Cargo run
and several live Clique processes, so it was not loaded further.

The run used the documented Apartment Air at
`Charlies-MacBook-Air.local` (Mac17,3, arm64, 10 logical CPUs, 32 GiB,
macOS 26.6.2). It was on AC power, reported no thermal/performance warning,
and had no competing Cargo process. An existing clean worktree at
`/Users/ccheever/lanes/llp-ship-20260829T034720Z-wave3` was switched from its
preserved old branch to `bench/offline-entrypoint-scale-20260911`; the exact
source was transferred by a 288 KiB Git bundle without pushing. The mandatory
`scripts/bootstrap-ibex-runtime` passed exact link, launch, and restricted
handler-VM qualification at `117bf209d` before Cargo ran.

Toolchain and input custody:

- Rust `1.97.0 (2d8144b78 2026-07-07)` and Cargo `1.97.0
  (c980f4866 2026-06-30)`.
- `snapback2/Cargo.lock` SHA-256:
  `5b4e0733bebf3dfa1da8ea292469c311e8aa26c0175a4750bae425fa54ab00d8`.
- Committed `search_media_tests.rs` SHA-256:
  `39c6175dfd08e3912c01e1633e925b2c5860ff7d0b3f64b545479715732f8cf9`.
- Measurement patch SHA-256:
  `d6d464532b667611f130a26b45e8fc582e791794ae317d95e0986eec47cc4c40`.
- Patched measurement source SHA-256:
  `54deef52fe4b173fa11acee01aa58ef2018fc8cd6c03fc8afbcd4728ca72fca6`.

The patch was applied only to the remote measurement worktree. After the run,
`git apply -R` restored the committed source hash and `git status` was clean.

## 100-lane media/max-width witness

The exact committed test was run without the measurement patch:

```sh
scripts/bootstrap-ibex-runtime
cd snapback2
caffeinate -s /usr/bin/time -lp cargo test --locked -p snapback2-core \
  maximum_media_shape_and_twenty_kib_stress_fit_actual_closure_and_scratch \
  -- --nocapture
```

The one selected test passed. It seeded 100 membership lanes and 200 messages;
every message carried image, once-image, and video descriptors. The stress arm
used exactly 20,480-byte message rows and 576-byte membership rows and returned
20 IDs.

| Measure | Actual / certified value | Limit evidence |
| --- | ---: | ---: |
| Receipt closure | 3,213,881 B actual | 3,938,518 B certificate; below 4 MiB |
| Derived scratch | 4,298,858 B actual | 5,840,738 B certificate |
| Derived steps | 69,027 actual | 353,091 certificate; `max_steps` 357,666, below 1M |
| Heap | certificate only | `max_heap_bytes` 5,987,138, below 8 MiB |
| Output | certificate only | `max_output_bytes` 409,632, below 1 MiB |

The outer receipt reports 41.10 s wall and 1,740,128,256 B maximum resident
set, but that includes the cold Cargo compilation and is not an engine-only or
phone RSS claim. The complete stdout/resource receipt is
[`100-lane-media-max-width.raw.txt`](./100-lane-media-max-width.raw.txt),
SHA-256 `d33665d42cafc4a528c0278d05aad9a85559e32d5d5f700f680d6ca7b551c0fe`.

## Full-engine 10%/50%/100% curve

[`scale-curve.patch`](./scale-curve.patch) parameterizes only the existing
committed test. It retains the same certified `search.global` program, actor,
in-memory engine store, 20 KiB/576-byte max-width shapes, Q2000 search term,
and three media descriptors per message. Each lane has two messages. At each
10/50/100-lane point the harness performs one correctness execution, five
unrecorded warmups, and 30 measured release-profile executions. The monotonic
timer covers `Runtime.engine.execute` only; the harness then validates 20 IDs,
the receipt pool, closure, steps, and scratch for every sample.

Exact reproducer from a clean `117bf209d` worktree:

```sh
scripts/bootstrap-ibex-runtime
git apply benchmarks/runs/2026-09-11-snapback2-offline-entrypoint-measurements/scale-curve.patch
cd snapback2
for lanes in 10 50 100; do
  SNAPBACK2_SEARCH_MEDIA_LANES="$lanes" \
  SNAPBACK2_SEARCH_MEDIA_SAMPLES=30 \
  SNAPBACK2_SEARCH_MEDIA_WARMUPS=5 \
  SNAPBACK2_SEARCH_MEDIA_STRESS_ONLY=1 \
  RUST_TEST_THREADS=1 \
  caffeinate -s /usr/bin/time -lp cargo test --release --locked \
    -p snapback2-core --lib \
    maximum_media_shape_and_twenty_kib_stress_fit_actual_closure_and_scratch \
    -- --nocapture
done
cd ..
git apply -R benchmarks/runs/2026-09-11-snapback2-offline-entrypoint-measurements/scale-curve.patch
```

The p95 is nearest-rank `sorted[ceil(0.95 * 30) - 1]`; the median averages the
two central samples. All times below are milliseconds.

| Lane ceiling | Messages | Min | Median | p95 | Max | Closure B | Scratch B | Steps |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 10% (10) | 20 | 0.622000 | 0.823854 | 1.064125 | 1.430083 | 503,707 | 788,282 | 69,027 |
| 50% (50) | 100 | 1.711042 | 1.834000 | 2.556667 | 7.821709 | 1,719,569 | 2,360,508 | 69,027 |
| 100% (100) | 200 | 2.986292 | 3.088771 | 3.298000 | 3.312667 | 3,213,881 | 4,298,858 | 69,027 |

The p95 curve is monotonic: 50/10 is 2.403×, 100/10 is 3.099×, and 100/50
is 1.290×. Every point retained plan hash
`95caf8f73648dab92a532677ffd4d95ff0f725df25bbbc5e5084590736c5e3a8`
and remained beneath the common certificate. The isolated 7.822 ms sample at
50 lanes is retained in the raw vector rather than discarded.

Machine-readable derived results are in
[`curve-summary.json`](./curve-summary.json). The complete stdout, all 90 raw
samples, test results, and `/usr/bin/time -lp` process receipts are in
[`full-engine-scale-curve.raw.txt`](./full-engine-scale-curve.raw.txt),
SHA-256 `6fa497898344004927a0637f4169066972c9fa221b1a8fc5e163b2c37942080f`.
The raw log's informational `COMMAND` line expanded `$lanes` before entering
the loop and therefore displays an empty value; the three
`SCALE_POINT_BEGIN lanes=...` records and `SEARCH_MEDIA_SCALE` payloads are
the actual invocations, and the reproducer above is the authoritative literal
command.

## Physical-phone blocker

The earlier Air-only probe below was superseded by a bounded sweep of every
suitable available-now fleet host. The durable enumerator uses `xcdevice`
rather than treating simulator or stale `xctrace` entries as attached phones:

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  xcrun xcdevice list --timeout 5
$HOME/Library/Android/sdk/platform-tools/adb devices -l
```

The sweep found one deduplicated iPhone 17 Pro Max on the Air and Black and two
Nothing A069P Android 16/API-36 phones on Bones. The current host had only
`emulator-5554`; Silver had only simulators and no ADB; Windows was reachable
but had no ADB; Office, Durand and Minisforum did not answer bounded LAN SSH.
Exact host/device dispositions are in
[`fleet-physical-device-sweep.json`](./fleet-physical-device-sweep.json).

The source-bound Android attempt kept the engine's 10,240 rule-probe ceiling:
it seeded 50 scopes, admitted 10,000 500-character source messages through the
real `messages.send` mutation, and re-counted exactly 200 messages in each of
50 conversations. A 67,950,541-byte release APK built and installed on both
phones. Both reported `deviceLocked=1`, `strongAuthRequired=0x1`, and a showing
keyguard; activity launch was refused. The paired/developer-mode iPhone also
refused an existing Snapback app launch with `CoreDeviceError 10002`, explicitly
because the device could not be unlocked. No local device credential exists.

[`physical-phone-attempt.json`](./physical-phone-attempt.json) records the
attempt without an owner secret or invented resource number.
[`measure-android-phone.mjs`](./measure-android-phone.mjs) is the exact reusable
harness: after an operator unlocks either Android phone it records sampled
`dumpsys meminfo` peak RSS, SQLite main/WAL/SHM sizes, and a process-killed
offline reopen. The older
[`physical-device-availability.raw.txt`](./physical-device-availability.raw.txt)
is retained as the initial Air-only observation, not the final fleet result.
This is an external unlock blocker, not an acceptance waiver.

SHA-256 custody: fleet sweep
`5adee33cfba9c57b5a7e8fa7e045c6888a42493c90a2ebede627b93346e051c7`;
phone attempt
`4674c0abd982fa21fd5b18712a0f28d98579d90071b761fba9d435aaa1e27232`;
measurement harness
`dac3e31276b0866dc8241a5b5cd0be681ecb6e75c7dab0ae6f86b38110f6b588`;
enumerator
`246e178e386ae117ba2bab2092621edb213603b44498a582295fba0ec20a2175`.

## Artifact verification

- `git diff --check`: pass.
- `jq -e . curve-summary.json`: pass.
- `jq -e . fleet-physical-device-sweep.json physical-phone-attempt.json`:
  pass.
- `node --check probe-physical-devices.mjs` and
  `node --check measure-android-phone.mjs`: pass.
- `git apply --check scale-curve.patch`: pass against the committed source.
- Raw/summary cross-check: pass for all three curve points, all 90 samples,
  min/median/p95/max derivation, and the committed 100-lane stress receipt.
- `./ref-check --verbose`: pass, 439 LLP documents and 8,050 references.
- `node scripts/caps.mjs`: the benchmark records are excluded as intended; the
  command reports only the existing 1,504/1,508-line source overages against
  the 204-file baseline and exits nonzero. No source file changed in this
  evidence commit.

## Remaining ticket scope

Two obligations remain: the original canonical full-suite 60-second run on
the final integrated commit, and physical-phone cold-build peak resident plus
storage evidence after an operator unlocks one of the three attached phones.
No canonical suite was run here, per orchestration request.
