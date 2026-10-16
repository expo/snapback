# EXPOPIN — completed

Worktree `/home/ccheever/projects/sb4-w13-expopin`, branch `sb4-w13-expopin`.
Base `6faa0fb9cd`; initial status clean, no pre-existing workstream commits.
Version stays 0.4.29; Integration 14 cuts 0.4.30. Nothing pushed or published.

## Changes and commits

- `507edf88ce`: research recorded; Expo 57.0.30/core 57.0.23, matching Babel 57.0.16/fingerprint 0.20.14, supported Expo peer range, independent Bun lock. Reference app supplies plain/chat/social manifests. Current docs and prospective 0.4.30 guide changes updated; bounded adapter accepts matching Xcode/SDK 27.0 or 27.1.
- `db99df07e8`: one shared scene/config plugin repairs upstream JSI SDK-switch cache identity using the selected Xcode build. Idempotent, exact-anchor refusal; no Swift API or interop-mode change.
- `d21839d9d7`: admit the exact upgraded Constants manifest phase in bounded preparation, retain custom-script rejection; Bash 3 portable real-hash regression.
- `2cd9965ef6`: atomic script replacement preserves Bun's hardlinked cache inode and executable mode. Real prebuild/hardlink/idempotence/hash regressions on Linux and Mac; emitted shell bytes unchanged.
- `526e4042ce`: update the old scene-only VM fixture to register the cache mod and retain real Node builtins. Tests/docs only; no published artifact bytes change.
- The commit containing this report retains final evidence/reviews, resolves and archives the ticket, and links the LLP amendment to the report.

## Verification

- M5 only in scratch `~/projects/snapback-ws-expopin` and `~/projects/snapback-ws-expopin-tools`; no publication worktree used or modified. Older Xcode selected read-only. Owned simulator deleted.
- Default Xcode 27.1/27A9275: reference Release with default precompiled Expo modules, installed publication offline/restart witness, native link/install digest verification all pass. Final witness 32.254 s; installed receipts record 27A9275 / iOS SDK 27.1.
- SDK-switch control: updated unpatched dependencies reproduce the JSI failure under 27.0. Shared patch makes 27.0 Release/witness pass (28.442 s, 27A266a / SDK 27.0), then return to 27.1 builds and runs successfully.
- Fresh plain `init --expo` and `new social --template social`: install/check/typecheck/web export and bounded own-Release three-segment smoke pass on 27.1 (128.084 / 223.792 s total). Native source d21839d9d7; subsequent writer-only change emits identical compiler-input shell bytes and is separately tested on both OSes.
- Final Mac native package/preparation/witness tests: 30/30 pass. Linux affected tests: 24 pass/1 macOS-only skip; focused final scene/preparation tests: 16/16 pass.
- Full canonical client pool completed 398/398 files: 7,511 pass, one obsolete scene VM mock failure, 56 skips. Corrected full-file rerun passes 8/8; no additional failure. The original pool exit remains failed and is retained. Earlier recursive 403-file attempt/setup failures and their passing trace/route reruns are also retained, never relabeled.
- Full seeded models: 81/81 pass. Guide: 125/125 pass. Initial init 49/50 due obsolete Babel assertion; corrected affected rerun passes. Docs budget 320/320 plus self-containment passes. ref-check passes with zero errors/unchecked.
- Fresh `publish.mjs --prepare-client` pack at 2cd9965ef6: full `qualify-linux --consumer-only` passes 12 host frontend proofs, 6 starter proofs, clean Ubuntu 24.04 and Alpine (284.167 / 395.601 s). Final artifact integrities retained. Private fresh npm cache resolves the initial stale-metadata ETARGET; no shared cache deleted. No full scripts/test.sh run. Consumer evidence explicitly says publicationQualified=false.
- Root Bun install/hoist setup passes. Root caps reports 13 inherited corpus/oversize violations; inventories reports absent generated Snapback 1/Contract artifacts. Unrelated source/fences unchanged; those checks are not claimed green.

## Reviews and ticket

Fresh read-only reviews, verbatim plus provenance under `llp/reviews/`:

- Codex gpt-6.1-sol, high: round 2 **READY**.
- Muse muse-spark-1.3-contributor, high: round 3 **READY** after terminal pool evidence. A transient stream retry is retained; no key file read or printed.

The sole diff-check diagnostic is an extra EOF blank line in the verbatim Muse response; it is intentionally preserved. Earlier NOT READY replies remain verbatim; they requested missing validation, then fulfilled. Reviews are not author acceptance or publication qualification.

Resolved ticket: `issues/closed/20261016-snapback4-expo-sdk-57-does-not-build-on-xcode-27.1.md`.
Detailed commands, upstream research/issue text, every attempt, digests and bounded claims: `snapback4/reports/20261016-expopin/REPORT.md` (with evidence index).

## Decisions and deferrals

Retain SDK 57 maintenance patches instead of an SDK 58/RN 0.88 migration. No native module API change needed. Root Snapback 1 corpus/generated-artifact repair, SDK 58, physical-device proof, new timing qualification and publication are outside this workstream. Exact export-cache audit policy remains conservative on changed unaudited dependency closures; no new warm-time claim. No upstream message sent; issue text is filed in the report. Integration 14 owns versioning and integrated publication qualification on current Xcode.
