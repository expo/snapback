# Snapback 4: the calibration's native proof needs a cross-lane app protocol before it can be run by an operator

**Opened:** 2026-09-30, after calibration #27 on 0.4.9 again scored native as unverified
**Severity:** Medium: 16 of the grader's 101 assertions (M6 and M7 simulator) have never been run in nine calibrations, and every scorer note repeats "native runtime remains unverified"
**Area:** `benchmarks/tools/social-messenger/choreography/simulator.md` (the frozen M6/M8 iOS-simulator artifact spec), `choreography.mjs --simulator-status`, `snapback4 witness ios --build` (lane NP, 0.4.9)
**Status:** Open; a design question for the instrument's owner, not a lane

## What is true today

- `snapback4 witness ios --build` (0.4.9) builds a Release app and runs the
  SDK's installed-app smoke on a simulator in minutes. It proves the SDK's
  native runtime against the chat app's witness protocol.
- The calibration's native evidence is a different thing. `simulator.md`
  freezes eight exact cold-offline steps against the **lane's own app**:
  cold launch with the backend stopped, previously viewed ordinary media
  rendering from durable state, a view-once asset refusing, offline search
  for a synced token, two queued sends in compose order, a backend restart
  with exactly-once ordered flush, and receipts advancing to `read`, with
  structured receipts and a run manifest. It is recorded through
  `--simulator-status` as `supplementalExternal` with `requiredForGreen:
  false`, and it says plainly that "a future generic driver must first add
  that cross-lane app protocol; until then each lane's native acceptance
  harness may produce the artifacts".
- No calibration builder has written that harness. Nine runs in, the M6 and
  M7 simulator assertions are `not-run` (or, in #25, `fail` under a grader
  that read the same absence differently), and the O4 native dimension is
  scored from a Hermes bundle export.

So the cheap fix, an operator running `witness ios --build` on the builder's
app after the build, is not honest evidence: the witness does not execute
the frozen steps and the builder's app does not speak the witness protocol.
The prompt template is frozen for series comparability, so telling the
builder to write the harness is not available either.

## What would make native measurable

1. Specify the cross-lane app protocol the frozen spec asks for: a small set
   of stable accessibility identifiers and a receipt hook that any lane's
   Expo app exposes (conversation list, message composer, send, media open,
   search box, queued-state marker), plus how the driver learns the fixture
   conversation and bodies. Put it in the instrument as a versioned
   addition, not a change to the eight steps.
2. Build the generic driver on top of `witness ios --build`'s simulator
   lifecycle (boot, install, launch, screen recording, backend stop/restart)
   so it executes the eight steps against any app that speaks the protocol
   and emits the artifacts `simulator.md` names.
3. Version the instrument (`INSTRUMENT_COMMIT`, `INSTRUMENT.sha256`) and
   the prompt template together so the series records which calibrations
   carried the protocol requirement; scores before and after are not
   comparable on O4 and should not be fitted as one line.

Until then, treat native as unmeasured in the series rather than as a
persistent deficit, and read the offline_sync note's "native runtime remains
unverified" as a statement about the instrument.
