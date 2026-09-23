# Clique cal16 — final candidate native evidence

Review scope: assess whether these frozen application assertions and their
actual installed Release receipts support the stated candidate results.
No other review family's conclusions are included. The original cal16 result
remains 104 pass / 0 fail / 15 not run, score 88; this extension is separate.

All three scenarios passed on SDK **candidate 0.2.33** plus native Expo
**candidate 0.2.24**, using the original published **CLI 0.2.32** read-only.
These are not registry-integrity or final public-pin results. Publication and
an installed public-pin rerun remain pending. No app media shim was added.

## Read first

1. `report.md` records scope, exact measurements, failures and limits;
   `diary.md` records the actual application experience.
2. `extension-from-frozen.diff` compares the preserved graded application
   with the exact executed witness revision 4. `extension-app/src/NativeWitness.tsx`,
   `native-assertions.ts`, `native-observe.ts`, `Chat.tsx`, `Video.native.tsx`
   and `ui/src/MessageBubble.tsx` hold the app-specific assertions/observers.
3. `checks/packet-verification.json` is a fresh read-only check of all 71
   original files, all 75 built extension source files, all nine driver artifact
   digests, exact pending/settled/delivered/read IDs, native frame receipts,
   explicit revocation reconnect, and the complete offline ID set.
4. Each `results/*-expo024-candidate-1/` contains the unchanged published
   driver's receipts, run manifest, video, logs and task wrapper observations.
   `media-files.json` is the stopped-host oracle; `memory.json` and `disk.json`
   distinguish sampled RSS, logical file size and allocated file size.

## Exact inputs and ownership

`custody/candidate-tarballs.json` identifies the two unpublished tarballs;
package integrity is also in `custody/release-expo024-candidate-1.json` and
`extension-app/package-lock.json`. SDK tarball SHA-256 is
`dab0e0b9830dc75a7a59ae28e5633b7af9180eb1fa1a6d3d0e03feeb26f15ddb`;
Expo tarball SHA-256 is
`aa3a7037a65598d1c014b28136debe023d856140c6871d6fbed54607f489ccb1`.
All 73 non-package source files match frozen witness revision 4. The new
native package required prebuild and CocoaPods regeneration; the preserved
Pod lock binds 0.2.24 and the Release identity binds both Swift inputs.
`build/` contains successful installation, prebuild, pods, full TypeScript
and normal simulator-signing Release logs. Rust framework bytes were unchanged.

Immutable Release app on M5:
`/Users/ccheever/clique-sb4-20260922-astra-cal16/attempts/native-extension/artifacts/release-expo024-candidate-1.app`.
Hermes SHA-256 is `826a28901be24753972f6f1ee24c105938caae2b302b609d54c427a47a7ec0d1`;
executable SHA-256 is `2693e01a948c80cbf40784de03d333326f591a8dcc13cce8147fed7c74363e82`.
The exact source manifest was captured before dependent fixtures/install.

The only simulator was iPhone 17 Pro / iOS 26.5,
`3ADCE896-A566-44FF-838E-95C20022B386`; the only backend port was 49380.
Every scenario's stopped Documents snapshot remains under its M5 artifact
folder, including SQLite sidecars. Full stores, dependencies, Release binary,
credentials and private session plans are deliberately outside this packet.
The owned app/backend are stopped, port 49380 is free, simulator shut down;
root owns the heavy-work slot. No command here authorizes another run.

## What passed

| Scenario | Driver / wrapper seconds | Principal evidence |
| --- | ---: | --- |
| Restart | 54.498 / 56.266780 | Real history/search, offline ordinary Image onLoad, fresh native first frame in both offline processes, live once file/manifest exclusion, same two pending IDs after death, exactly two ordered sent writes, exact delivered/read pair |
| Revocation | 31.053 / 32.341310 | Learned leave, retained text/empty roster, media purge, cold restart, explicitly online reconnect, later message absent |
| Acquisition | 42.742 / 44.440960 | Full M8 fixture, first real render, acquired opener upper bound, cold offline reopen, all 10,000 exact IDs through 299 local pages in 100 scopes before reconnect |

`diagnosticOnly` was absent/false. Media fixtures were uploaded by Bob and
consumed by Alice; the once recipient never picked/uploaded the source file.
The wrapper's host oracle requires exactly the bare ordinary image and
`.mp4` ordinary video, correct sizes/digests, and neither variant for once or
revoked assets. Duplicate variants, missing controls and wrong digests fail.
The live once assertion occurs after the actual Image onLoad and before close.
It uses the same opened native core and manifest, not a second store.

The acquisition expectation is `custody/retained-fixture.json`; every actual
offline ID is retained in the receipt. Its independently recalculated LF-joined
sorted SHA-256 is `c18d2f7afba531ca5a0ee2feb32459153f07086ad2f986023cfce94bc87ddf50`.
The app audit happened while the backend refused connections and before the
driver's reconnect signal. The separate 248-membership stopped-SQLite check
was after reconnect and is not attributed to the offline enumeration.

First useful real row layout: **20,416.582 ms**. Acquired on original opener
return: **20,212.121 ms upper bound** (the original opener awaits sync).
Cold opener: **115.107 ms**; complete offline ID audit: **7,615.971 ms**.
Observed 46 response bodies total **59,280,798 UTF-8 bytes**, with **161,275
response events including repeats**. Copying/parsing adds observer overhead;
these are not wire bytes or unique rows. Sampled own-app RSS maximum is
**421,003,264 bytes** in 143 samples, not an exact peak footprint. DB/WAL/SHM
logical bytes are 264,450,048 / 157,730,112 / 32,768; allocated bytes are
268,906,496 / 168,513,536 / 32,768. These individual runs are not controlled
comparative benchmarks; earlier faster measurements are not substituted.

## Actual screen frames and source-video appearance

`frames/restart-offline-video-1.png` was extracted at actual video time
**3.991667 s** (requested 4 s); `restart-offline-video-2.png` at **13.990 s**
(requested 14 s). Matching offline native first-frame receipts are **3.567 s**
and **13.634 s** after the driver's `recording-started` timestamp. Driver
chronology establishes that the backend was stopped. The static witness header
still says “Opening native witness…” and is not a timing assertion.

The actual player is the blue-gray rectangle below the separate red IMG01
poster. The first screenshot partly clips that player; the second shows it
fully. `frames/source-video-frame-{0,2}.png` decode the preserved exact
49,779-byte MP4 at 0.000 and 2.000 seconds: both are solid blue-gray. The MP4
SHA-256 `7e22b943746b2c858910252162f624cac396eb9e4f4100ae80e70431b7883d5f`
matches both fixture and native cache controls. Native first-frame callbacks,
with a fresh mount/epoch and actual cached URI, are the primary rendering
witness. The red poster is not playback evidence; no motion or audio claim is
made. Initial prime/once rendering and initial acquisition occur before the
existing driver starts recording; their application receipts remain primary.

## Preserved failure history and limits

`failure-history/` includes selected original receipts and identities; omitted
large failure videos/logs remain in the prior immutable packets listed and
hashed by `custody/prior-packets.json`. Final successful driver artifacts are
all present and independently hash checked.

- Original unsigned/ad-hoc setup attempts failed SecureStore/launch; normal
  simulator signing was used for actual results. No published framework was
  patched or re-signed.
- Original SDK 0.2.32 / Expo 0.2.23 ordinary media failed because RN Blob lacked
  arrayBuffer; `restart-3` is preserved.
- SDK candidate 1 repaired byte retention but actual once failed. The separate
  ordinary-only probe reproduced Expo URL.createObjectURL's TypeError while
  online, closed its own Blob, and consumed no once grant.
- SDK candidate 2 repaired the transient path: actual once onLoad and live
  exclusion passed. Setup-only `restart-candidate-2` remains distinct from
  actual `restart-candidate-2b`, where the video failed “Cannot Open”.
- The exact MP4 decoded when suffixed `.mp4`, but its native bare filename
  failed AVFoundation -11828 / underlying OSStatus -12847. Byte-identical
  diagnostic controls and probe source are retained; none entered app playback.
- Native Expo candidate 0.2.24 repaired canonical cache naming; the three
  successful scenarios above used the real app playback path without a shim.

Delivered-history text can remain after learned leave while media is purged
and new delivery excluded. Blob handle cleanup does not erase arbitrary copied
data-URI strings or native decoder copies. Android, physical power loss,
exact peak memory, wire bytes and physical-floor comparisons remain unmeasured.
Real-provider delivery is pending a selected account/recipient; workers stayed
disconnected. Original acquisition runs audited exact IDs only after reconnect;
that limitation is not retroactively removed by the later candidate result.

## Repeatable read-only packet checks

From this directory (no simulator/backend/build):

```sh
python3 tools/verify-packet.py
python3 tools/test_clique_media_oracle.py
TYPESCRIPT_PATH=/path/to/typescript/lib/typescript.js node tools/check-native-assertions.cjs extension-app
```

The task checks passed: 12 host-file cases, 24 pair/receipt assertions and six
source transpiles. Full native application typecheck/build also passed as
recorded in `build/`. `tools/run-clique-native.py` is the exact executed wrapper,
not a new global harness. `PACKET.json` hashes every included file except itself.
