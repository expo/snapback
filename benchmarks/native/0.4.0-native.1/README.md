# Clique native instrument 0.4.0-native.1

**Unscored qualification candidate; new series.** LLP 0201.000 was accepted on
2026-10-05. Phase 1 implements and qualifies the driver. The two independent
Snapback 4/Convex app builds in Phase 2 are required before scored use. Do not
run a calibration from this directory or attach its results to an old packet.

The existing `benchmarks/instrument.manifest.json` and its artifact roots remain
unchanged. This directory is an independently hashed native component plus a
versioned copy of the UI kit. The manifest embeds the exact inherited web
manifest. Materialization emits two component roots; existing web receipts keep
0.3.8-m8 and native receipts use 0.4.0-native.1. They must never be relabeled.

```sh
node benchmarks/native/0.4.0-native.1/freeze.mjs --check
node benchmarks/native/0.4.0-native.1/freeze.mjs --check --materialize /tmp/new-native-packet
```

The packet carries INSTRUMENT_COMMIT, INSTRUMENT.sha256, prompt, contract,
kit/helper, driver, schemas and grader instructions. The source manifest records
the series break and disabled scoring. Only run `freeze.mjs` without `--check`
when deliberately cutting new candidate bytes, before qualification; it never
writes the old manifest.

Install Python dependencies `pillow==11.3.0 jsonschema==4.25.1 opencv-python-headless==4.12.0.88` in a task-local
venv. Export validation also needs AVFoundation/Xcode on macOS or FFmpeg
(`imageio-ffmpeg==0.6.0` supplies a portable binary) on other hosts. Node 24.18.0, Playwright 1.62.1 with Chromium, Xcode 27.0 (27A266a), iOS 27
and Release Expo 57.0.22 / RN 0.86.3 are the initial qualification toolchain.
`driver/add-driver.rb` creates an independent XCTest target in a disposable
native project; its runner can target any installed bundle ID. Build it once
with `build-for-testing`, then supply its explicit `test-without-building` argv.
The runner/control bridge reserves localhost port 49492; occupied ports refuse.
It uses no coordinates, Simulator.app activation, label translations or app
success callbacks. Native UI actions use only CONTRACT.md IDs and scoped values.

`driver/run.py --config operator.json --segment m6 --out <new-directory>` runs
online prime and the eight steps; `--segment m8` runs the separate queue-restart
sequence. Supply config fields illustrated in `reference/qualify.py`: recorded
Release `.app`, bundle ID, explicit dedicated UDID, runner argv, backend argv/cwd,
exact origin/data directory, seed/oracle argv, web Bob origin, ordinary fixture
image, view-once review fixture and the compiled `video-check` argv. The reference
uses synthetic images with visible color patterns; generic image fixtures are
compared after aspect-fit crop, at a frozen mean absolute channel error <20/255.
Stale view-once detection searches the full screenshot across 0.25–1.25 times
the opened image size, using channel-centered correlation >=0.90. It excludes
prime letterboxing and refines the best size for rounding and modest aspect
changes, preserving detection through margins and brightness/contrast shifts.
An observed stale image is a terminal failure; only missing refusal evidence
can be polled again, and the first stale capture and pixel record are retained.
Capture a full-run video and inspect it in grading as well as the automated scan.

Credentials are separate environment input: CLIQUE_ALICE_EMAIL/PASSWORD and
CLIQUE_BOB_EMAIL/PASSWORD. CLIQUE_PLAYWRIGHT_PACKAGE is the absolute path of a
package.json whose installation contains pinned Playwright. The helper is inert without a protocol launch (and on web without its native
module). Application message/operation IDs must be minted independently of the
observer nonce. The helper stores only allowlisted observations. Retained XCTest logs redact fixture passwords.
No auth session is injected. No client offline toggle replaces stopping the
backend. Install once before prime; no reinstall/reset occurs in the measurement.
The driver stops only its launched processes, holds a per-UDID flock lease, checks
the exact origin repeatedly offline and verifies unchanged native/Hermes hashes.

Artifacts: `m6-ios-screen.mp4`, `m6-ios-receipts.jsonl`, `m6-ios-run.json` (or m8),
fixture, timestamped app event stream, host lifecycle, native trees, screenshots,
pixel comparisons and complete raw server/Bob observations. A report's JSON
`pass` is tri-state; unavailable setup and invalid evidence are unmeasured.
Executed application failures are false; downstream assertions stay null.
Run `driver/validate.py <directory> --segment m6` before grading, using the
trusted instrument distribution with its post-build `QUALIFIED.json`. Validation
compares commit, inventory, Python source and qualified XCTest binary hashes; an
evidence packet cannot supply its own trust anchor. Candidate receipts remain
in memory until validation succeeds; failures rewrite all verdicts consistently. Qualification
reports include every attempt and its actual wall/action cost. Grader policy is
in `grader.md`; no O4 or overall score is computed by these tools.

`reference/` is a deliberately small diagnostic Expo app and Node backend,
not a new backend benchmark. It reuses the revised presentational components,
normal sign-in, a SQLite-backed cache/outbox, real HTTP/server persistence,
virtualized history and browser Bob. Its fault switches are confined to the
reference; helper and generic driver do not grant outcomes for them. The build
script uses a scratch APFS clone of installed dependencies and retains all build
attempt logs. Qualification uses only the Apartment mini's dedicated simulator.

Run the instrument tests with `python -m unittest discover -s tests -v` and the
copied kit's tests/typecheck, plus `node --test tests/bob.test.mjs` with
`CLIQUE_PLAYWRIGHT_PACKAGE` pointing at the Playwright installation's package.json. The Phase-2 plan and retained matrix live in
`snapback4/reports/20261005-ni-native-protocol/` at repository root.
