# snapback2: the Expo witness's video clip is refused by the iOS 26.5 simulator ("Cannot Open", CoreMedia -12847) before and after LLP 1018.003

**Filed:** 2026-09-07 by Claude Fable 5.1, from running `snapback2/scripts/witness-expo.mjs` on the primary Mac (Xcode 26.6 build 17F113, iOS 26.5 simulator "iPhone 17").
**Status:** Open — candidate repair landed; same-host device witness still required (2026-09-11) · **Severity:** witness blocked at step 2 on this host; pre-existing
**Priority:** P1

## What happens
Step 1 passes (build, owner seed, control) and step 2's two photo views load. The clip view returns `E_ASSET_TYPE` "Failed to load the player item: Cannot Open" from `AssetVideo`'s `statusChange` listener. The simulator log shows `<<< FFR_Common >>> signalled err=-12847` from CoreMedia's format reader when the player opens the `file://` URL. The container holds the clip at `Library/Caches/snapback2/dev:alice/<id>` as a valid 1,664-byte `ISO Media, MP4 Base Media v1` file, byte-identical to `scripts/witness-expo/view-once.mp4`, and the owner serves it byte-identical (`video/mp4`). Steps 3–10 never run.

## It predates the lane
The same witness at `4506a2eda` (main before LLP 1018.003 landed) fails identically on the same simulator: step 1 pass, step 2 fail on the clip with the same message. Evidence: this session's scratchpad logs `witness-expo.log` (lane, runs 3 and 4) and `witness-expo-baseline.log` (baseline).

## Candidates
- The cache file has no `.mp4` extension; AVURLAsset on iOS 26.5 may no longer sniff the container without one (`src/react-native/files.ts` keys files by asset id and width only).
- The 16×16 H.264 baseline fixture may be below what the iOS 26.5 simulator's decoder accepts.
Both are testable on this host: rename the cached file with `.mp4` in `files.ts`, or regenerate the fixture at 64×64 (no `ffmpeg` here). Earlier green runs recorded in memory were on other hosts and runtimes.

## Also seen
`expo run:ios` needs the Simulator application open before its AppleScript launch step (`open -a Simulator`), and its cold Release build exceeded the witness's 20-minute budget on a machine at load 90–250; a warm rerun fits.

## Reconciliation — 2026-09-11

Commit `dd05626495` implemented the first candidate: MIME-derived native derivatives now
map `video/mp4` to `.mp4`, with startup/replacement cleanup and unit assertions for the
suffixed player source. The 1,664-byte fixture is unchanged. No iOS 26.5 simulator was
run in this bounded triage, so CoreMedia `-12847` is not declared resolved.

Next acceptance: on the same iOS 26.5/Xcode 26.6 environment, warm-run witness step 2
against current main and record the clip's `.mp4` path plus loaded/playing events. Close
only on that pass; if `-12847` persists, qualify a larger valid fixture without weakening
MIME or custody checks.
