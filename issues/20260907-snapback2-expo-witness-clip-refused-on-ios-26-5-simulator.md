# snapback2: the Expo witness's video clip is refused by the iOS 26.5 simulator ("Cannot Open", CoreMedia -12847) before and after LLP 1018.003

**Filed:** 2026-09-07 by Claude Fable 5.1, from running `snapback2/scripts/witness-expo.mjs` on the primary Mac (Xcode 26.6 build 17F113, iOS 26.5 simulator "iPhone 17").
**Status:** open · **Severity:** witness blocked at step 2 on this host; pre-existing

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
