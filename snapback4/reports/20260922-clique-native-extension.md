# Clique cal16: post-grade native extension

This is an extension of the frozen cal16 application, not a new score or a
replacement for its independent grade. The original result remains **104 pass,
0 fail, 15 not run; score 88**. All three installed Release scenarios now pass on
the published SDK/CLI 0.2.33 and native Expo 0.2.24 packages: restart/offline media and
settlement/read progression, learned revocation, and full retained-fixture
acquisition with all 10,000 required message IDs checked before reconnect.
The earlier published-pin failures and candidate results remain recorded below.
The [corrective release](./20260922-native-media-repair.md#corrective-release-qualification)
and the final separate public-package rerun both match the qualified package
hashes. See [the final result](#final-public-package-result) for exact scope.

## Custody and scope

On the owned M5 host, the source lane is
`/Users/ccheever/clique-sb4-20260922-astra-cal16/lanes/astra-snapback4`.
The extension is its separate sibling packet
`attempts/native-extension`, containing:

- `frozen-app/`: 71 copied source/configuration files, hashed in
  `custody/frozen-source.json` before adaptation;
- `custody/`: copied grade artifacts, their hashes, fixture manifests and
  nonsecret semantic fixture descriptions;
- `fixture-baseline/`: a complete stopped APFS copy of the final-schema M8
  instance, including database sidecars and assets, totaling 1,021,276,583 bytes;
- `app/` and `backend/`: the independently mutable extension copies;
- `artifacts/`: installation, typecheck, build and witness attempts, including
  unsuccessful attempts;
- `private/`: host-only session injection files, excluded from the bundle and
  report artifacts. Fixture passwords remain in the original external fixture
  files and are never placed in application source.

The original lane, instrument, grade and pre-grade snapshot are untouched.
The original `npm ci` installed the exact published `snapback4@0.2.32` and
`snapback4-expo@0.2.23` from the frozen lock. The extension uses the existing
published witness helper and CLI, not another global harness. Its only backend
origin is `http://127.0.0.1:49380`; it does not touch port 4400. External provider
workers are disconnected.

The owned simulator is `3ADCE896-A566-44FF-838E-95C20022B386`, iPhone 17 Pro,
iOS 26.5. Direct Release builds use `xcodebuild -jobs 4`, followed by `simctl
install`. No Metro server supplies the installed JavaScript. Published native
frameworks are consumed unchanged.

## Required retained content

The baseline contains 100,015 messages. Target fixture principal `u0500` is a
member of 100 conversations and is authorized for 10,000 nonexpired messages
and 248 membership rows. `custody/retained-fixture.json` records every required
message ID, conversation ID, per-table counts and the observation clock.
Acquisition must preserve these requirements; a 100-row inbox alone is not
proof of all retained message content.

The actual schema declares no message acquisition horizon. A query's `last 50`
is pagination, not a residency horizon; the witness records actual
`complete`/`cut` facts rather than claiming an artificial horizon boundary.
Two small auxiliary conversations are created through the real app mutations
and uploads for restart/revocation semantics. They are inaccessible to u0500
and are identified separately from the full acquisition fixture.

## Application adaptation and measurement

The extension's app-owned runner renders the real `Chats`, `Conversation` and
`Search` components with the actual client. Witness-only controls invoke the
existing chat send and Bubble media functions. A delegated native opener
retains the same core for read-only cache observation; it returns that core
unchanged. The app's original ordinary-media retention policy remains
`keep: "viewed", maxBytes: 134217728`.

The original client opener awaits sync before returning. Durable acquisition
observed on return is therefore an upper bound, separately labeled from the
first useful real row's layout. Actual `/sync` and `/changes` response copies
record JSON body UTF-8 bytes and event counts, including repeats. They are not
network wire bytes; copying/parsing adds measurement overhead. File metadata
after the driver stops the app distinguishes logical and allocated database,
WAL/SHM and media bytes. A task-only wrapper samples RSS only for app PIDs
reported by this driver's launch log at 250 ms intervals; a sampled maximum
is not an exact peak footprint.

## Original-pin results, 2026-09-22

Exact npm installation, native dependency installation and the adapted app's
TypeScript checks passed. Two Release builds succeeded. Build 2 uses normal
simulator signing and the unchanged published native framework. Its Hermes
bundle SHA-256 is
`257967ce35a067b844f79a257c728954358205bc968c8d1585daa07dc7f85be3`;
the executable is
`62cc3af9b0d1a231e2448635d60f728d12137af95a6da191e7ed37a5dca33c3e`.
`custody/release-build-2.json` binds the remaining identities and npm integrities.

The unsigned first build could not use SecureStore, so `restart-1` failed
before client work. An explicitly re-signed copy was refused at launch in
`restart-2`. Normal simulator signing, as used by the existing reference
witness, resolved both setup problems. These attempts remain preserved;
`CODE_SIGNING_ALLOWED=NO` is not the working recipe.

`restart-3` reproduced the SDK media failure in the actual installed app.
The native client acquired successfully in 6,350.785 ms. The actual Bubble
image/video hooks then reported `denied`, and native ordinary cache bytes
were absent. A separate authenticated ordinary-image response was HTTP 200
with a 2,062-byte React Native Blob whose `arrayBuffer` property was undefined.
The app's unchanged cache path calls that method. The compact nonsecret
reproduction is in `artifacts/restart-3/restart-ios-receipts.jsonl`:

```json
{"event":"blob-compatibility","responseStatus":200,"blobSize":2062,"arrayBuffer":"undefined","blobConstructor":"Blob"}
{"error":"Ordinary image durable bytes absent: 01M35G740AMT5XEGMDXCP7CQM1","witness":{"step":"primed:failed"}}
```

The excerpt omits timestamps; the original complete driver receipt is retained.
No app Blob shim or changed SDK pin was used. The app does have its own native
`expo-video` component, so its neighboring web `<video>` file is not a defect.

The independent acquisition scenarios passed their implemented checks:

| Observation | Acquisition 1 | Acquisition 2 |
|---|---:|---:|
| Outer wrapper elapsed, reported stdout rounded | 24.406 s | 22.104 s |
| Published driver elapsed, manifest timestamps | 23.065 s | 21.029 s |
| Original opener return / acquired upper bound | 10,970.041 ms | 11,018.320 ms |
| First useful real chat-row layout | 11,109.019 ms | 11,159.628 ms |
| Cold offline opener | 73.174 ms | 68.269 ms |
| Actual offline inbox rows | 100 | 100 |
| Observed response bodies | 59,280,702 bytes | 59,280,702 bytes |
| Response events, including repeats | 161,275 | 161,275 |
| Sampled own-app RSS maximum | Unmeasured | 416,333,824 bytes |

The earlier report mislabeled the outer wrapper timings as driver elapsed.
Both values are retained above with distinct labels. The original wrapper
stdout was not saved as a standalone artifact; the driver values are directly
recomputable from each immutable run manifest.

Both runs transferred 161,274 snapshot events in the observed response set.
The real chat list's delivery acknowledgments remain enabled. Bytes cover the
45 copied `/sync` and `/changes` response bodies collected at the acquisition
receipt, not every possible later response, asset transfer or network header.
The first sampler matched the wrong installed directory name and recorded no
samples; run 2 corrected that guard to the exact installed executable and
recorded 69 samples at nominal 250 ms intervals. It used a fresh native store
and a fresh full final-schema M8 baseline copy without auxiliary additions.

After the driver reconnected and terminated the app, each native SQLite store
contained exactly the 10,000 required message IDs and 248 membership rows.
The SHA-256 of sorted message IDs joined by LF is
`c18d2f7afba531ca5a0ee2feb32459153f07086ad2f986023cfce94bc87ddf50`.
This exact-ID comparison was **after reconnect**. The offline phase itself
asserted acquired=true and the real 100-row inbox. It did not enumerate the
entire required message set before reconnect. Later candidate runs add
that stronger assertion through actual `chat.thread` cursor pages before
`offline-done`; it is not attributed to these original-pin runs.

Run 2's stopped logical file sizes were database 264,450,048 bytes, WAL
157,730,112 bytes and SHM 32,768 bytes. Allocated sizes were respectively
268,951,552, 168,026,112 and 32,768 bytes. This acquisition scenario retained
no ordinary media files and does not qualify media acquisition. The preserved
`stopped-documents/` copy supports a repeatable read-only inspection.

The driver manifests' recorded artifact byte counts and SHA-256 values were
verified. An actual video frame at 1.922 seconds shows Clique's Busy Group
0001 and probe conversations before reconnect. Its witness status still
reads “Opening native witness…”; the driver chronology establishes the
offline phase. Initial acquisition timing is recorded by the app; the existing
driver starts video after prime and does not film initial acquisition.

## Candidate SDK results and witness revisions

The extension alone installed the unpublished SDK 0.2.33 tarball with SHA-256
`b89d1cd7676b1aa76885bd146a00b3ec6fdd916a80110f2097c6b0ed33307754`,
using `--omit=optional`. Native Expo remains published 0.2.23. The optional
`CLIQUE_CLI` wrapper path invokes the original frozen lane's published CLI
0.2.32 read-only. Candidate package/lock copies, exact source manifests and
normally signed Release copies are retained independently from build 2.
Two candidate Release builds and their full TypeScript checks passed.

The first candidate restart reached real ordinary-image `onLoad`; its image
and video files matched the fixture sizes (2,062 and 49,779 bytes) and both
SHA-256 digests. Once bytes were absent from disk. The actual once open then
returned the client's offline-cache refusal and timed out before rendering.
These are partial observations: this attempt did not reach offline media,
pending intent, read progression or revocation assertions. Its pre-call link
state was not recorded and is not inferred from the refusal.

A separate diagnostic build fetched only an ordinary image and stopped
before any once request. It recorded an online client, HTTP 200, a native
Blob with `data.blobId`, missing `arrayBuffer`, and public `close`. Both URL
methods were functions, but `URL.createObjectURL(blob)` threw `TypeError:
undefined is not a function`. `RN$Bridgeless` was true while
`__turboModuleProxy` was undefined. The installed Expo 57 URL implementation
calls that missing proxy in this branch. Blob close succeeded. This is a
host URL compatibility failure, separate from the repaired byte-reading
path. There is no app shim, alternate once fetch or durable temporary file.
The diagnostic deliberately records a failed prime, not a scenario pass.

Candidate acquisition used a fresh native store and a fresh full M8 baseline
copy. It passed the stronger assertion: before the driver allowed reconnect,
actual `chat.thread` pages enumerated all 10,000 required message IDs across
100 scopes, in 299 pages and 4,439.369 ms. The recorded actual IDs independently
hash to `c18d2f7afba531ca5a0ee2feb32459153f07086ad2f986023cfce94bc87ddf50`.
The stopped-backend condition, acquired flag and complete offline inbox also
passed. This resolves the earlier acquisition timing limitation for this
candidate; it does not alter the earlier runs or qualify a future SDK build.

| Candidate acquisition observation | Value |
| --- | ---: |
| Acquired on original opener return, upper bound | 12,034.578 ms |
| First useful real chat-row layout | 12,169.536 ms |
| Cold offline opener | 72.897 ms |
| Observed response bodies / UTF-8 bytes | 46 / 59,280,798 |
| Response events, including repeats | 161,275 |
| Own-app RSS samples / sampled maximum | 96 / 405,225,472 bytes |
| DB / WAL / SHM logical bytes | 264,450,048 / 157,730,112 / 32,768 |
| DB / WAL / SHM allocated bytes | 268,906,496 / 168,513,536 / 32,768 |
| Incidental ordinary media logical / allocated bytes | 729 / 4,096 |

The same response-copying and sampled-memory limits apply. The incidental
media file is not a complete media-fixture claim. A real video frame at
2.422 seconds shows the offline inbox; status text still says “Opening native
witness…”. Driver chronology and the app's local query assertions establish
timing. No physical-floor ratio is claimed.

Witness review also tightened the completion conditions. Delivered/read waits
require both exact IDs and receipt states. Offline ordinary image evidence
requires the actual Image's load event; video requires a fresh native player
mount and first frame for that request. The host checks ordinary file sizes
and digests alongside once absence. The later revision additionally
checks once file/manifest absence while its loaded handle remains open, with
ordinary positive controls; requires online after revocation reconnect; and
rechecks both original settlement IDs, order, count and absence of failures
immediately before completion. Retained conversation/text and purged media
remain separate obligations. Source inspection supports an exact retained
conversation with an empty roster after leave, not a null conversation.

## Earlier review-packet checkpoint

The original packet `/tmp/sb4-3011-20260922/clique-native-review` and revision 2
`clique-native-review-r2` remain immutable. The new bounded packet is
`/tmp/sb4-3011-20260922/clique-native-candidate-review`. It separates exact
candidate builds 1 and 2 from the proposed witness revision 3, preserves the
original sources/results, and includes task scripts, fixture expectations,
full diffs/manifests, nonsecret receipts and actual frames. Full databases,
dependencies, credentials and private session plans remain outside it.

At that checkpoint, semantic restart, offline media, once rendering/exclusion,
pending-intent survival, final delivery/read progression and learned revocation
were pending the transient URL repair. Later candidate results below advance
those cells; they do not change the earlier attempts.

## Second SDK candidate: once rendering passed; video naming blocked playback

The second unpublished SDK tarball is still version 0.2.33, with distinct
SHA-256 `dab0e0b9830dc75a7a59ae28e5633b7af9180eb1fa1a6d3d0e03feeb26f15ddb`.
The native package and CLI stayed at published 0.2.23 and 0.2.32. Frozen witness
revision 3 passed full app TypeScript and a normally signed Release build.
Its exact 73 non-package source files match the reviewed revision; package and
lock changes are separately retained. The immutable Release copy is named
`release-candidate-3.app` because the earlier diagnostic also had its own build.
Its Hermes bundle SHA-256 is
`ec4ee8713ea25b34fbc1f10bd1f931529d2f018e996f47170272d4698a77fc05`.

A setup-only attempt used an incorrect readiness route and stopped before
fixture preparation or native execution. It is preserved as
`restart-candidate-2/setup-failure.json`; it consumed no once grant. The next
attempt, `restart-candidate-2b`, used fresh auxiliary fixtures in a separate
backend copy. `diagnosticOnly` was absent. It reached actual once Image
`onLoad`, then proved no once file or manifest entry while the loaded handle
remained open, with positive ordinary-image/video cache controls. This
confirms the transient Blob repair on the actual host. It does not claim
immediate erasure of copied data-URI strings or native decoder memory.

The next actual native VideoView failed during prime with “Cannot Open”. The
run stopped there: no offline media, pending-survival, settlement/read or
revocation pass is claimed. The stopped file hashes matched the original
fixture: video 49,779 bytes, SHA-256
`7e22b943746b2c858910252162f624cac396eb9e4f4100ae80e70431b7883d5f`.
Image size/hash and once file absence also passed. Wrapper elapsed was
19.290335 seconds; the preserved driver manifest is a separate timing source.

A task-only AVFoundation probe classified the failure without changing the
SDK, app, fixture or cache. The original `.mp4` is playable/readable H.264
`avc1`, 320×240 at 30 fps, duration 5 seconds, and decoded frame zero. Both the
exact native cache path and its escaped file URI exist but fail with
`AVFoundationErrorDomain -11828`, underlying `NSOSStatusErrorDomain -12847`.
Byte-identical diagnostic copies isolate the name: `same-bytes` fails;
`same-bytes.mp4` plays and decodes. These comparisons run through macOS
AVFoundation; the actual iOS simulator failure is independently retained.
They identify the extensionless cache name as the playback problem, not an
invalid fixture. The app never receives the suffixed diagnostic copy.
At this checkpoint, a native cache remedy and actual offline video rerun
were still pending.

Further review hardens the witness only: count terminal `sent` events
explicitly and require the exact distinct ID pair at pending-survival and
server-presence gates. This revision 4 has 24 passing predicate assertions
and six successful source transpiles. Full application typecheck and native
execution were pending at this checkpoint; both passed in the later run below. The SDK's existing terminal-only callback
contract is not labeled a product bug. Prior packets and runtime results
remain unchanged. The new bounded packet is
`/tmp/sb4-3011-20260922/clique-native-candidate2-review`.


## SDK 0.2.33 / Expo 0.2.24 candidate: all three scenarios passed

The final candidate run retained SDK tarball SHA-256
`dab0e0b9830dc75a7a59ae28e5633b7af9180eb1fa1a6d3d0e03feeb26f15ddb`
and installed native Expo 0.2.24 tarball SHA-256
`aa3a7037a65598d1c014b28136debe023d856140c6871d6fbed54607f489ccb1`.
The frozen original CLI remains published 0.2.32. The native change gives
recognized MP4 cache files a `.mp4` name, including legacy-cache migration,
and removes both owned variants on purge. The Rust frameworks are unchanged.
There is no application media shim or alternate playback path.

Expo prebuild and CocoaPods installation regenerated the project with
`MediaFiles.swift`; full app TypeScript and a normally signed Release build
passed. The immutable `artifacts/release-expo024-candidate-1.app` has Hermes
bundle SHA-256
`826a28901be24753972f6f1ee24c105938caae2b302b609d54c427a47a7ec0d1`
and executable SHA-256
`2693e01a948c80cbf40784de03d333326f591a8dcc13cce8147fed7c74363e82`.
`custody/release-expo024-candidate-1.json` binds package integrities, native
inputs and the Pod lock. All 73 non-package app source files match frozen
witness revision 4; the two package files are separately captured. Normal
execution used `diagnosticOnly=false` (the optional field was absent).

| Actual installed Release scenario | Result | Driver elapsed | Outer wrapper elapsed |
| --- | --- | ---: | ---: |
| `restart-expo024-candidate-1` | Pass | 54.498 s | 56.266780 s |
| `revocation-expo024-candidate-1` | Pass | 31.053 s | 32.341310 s |
| `acquisition-expo024-candidate-1` | Pass | 42.742 s | 44.440960 s |

The restart run rendered the actual once image, then checked file and manifest
absence while its loaded handle remained live, alongside ordinary positive
controls. The actual ordinary image loaded online and in both offline app
processes. The actual native video produced a first frame online and from a
fresh player mount in each offline process. Its cache URI now ends in `.mp4`.
The host oracle independently checked ordinary size/digest and canonical
names, rejected duplicate owned variants, and found neither once variant.
It has 12 task-helper checks for expected, extra, missing and corrupt files.

The two original pending message/write IDs survived process death unchanged.
Only terminal `sent` events count: exactly two distinct expected writes settled
in order at sequences 177417 and 177418, with no failures. The exact two
message IDs subsequently reached delivered and read through the other
participant's real operations. Final completion rechecked IDs, count, order,
terminal state and absence of failure. History and search assertions also
passed while the backend refused connections.

Revocation used a fresh native store. After learning leave, the retained
conversation/text remained while its roster became empty and ordinary media
was purged. Cold offline restart preserved that boundary. After an explicitly
confirmed online reconnect, retained history remained and the later message
was still absent. The raw host oracle found neither bare nor `.mp4` variants
for revoked ordinary assets or once content. This is learned authorization
revocation with retained delivered history; it does not promise erasure of
copied data-URI strings or native decoder memory.

The full acquisition used a fresh native store and a fresh APFS copy of the
final M8 baseline. Before allowing reconnect, actual local `chat.thread`
queries enumerated all required IDs:

| Final candidate acquisition observation | Value |
| --- | ---: |
| Acquired on original opener return, upper bound | 20,212.121 ms |
| First useful real chat-row layout | 20,416.582 ms |
| Cold offline opener | 115.107 ms |
| Offline message IDs / scopes / actual query pages | 10,000 / 100 / 299 |
| Offline full-ID audit elapsed | 7,615.971 ms |
| Observed response bodies / UTF-8 bytes | 46 / 59,280,798 |
| Response events, including repeats | 161,275 |
| Own-app RSS samples / sampled maximum | 143 / 421,003,264 bytes |
| DB / WAL / SHM logical bytes | 264,450,048 / 157,730,112 / 32,768 |
| DB / WAL / SHM allocated bytes | 268,906,496 / 168,513,536 / 32,768 |
| Incidental ordinary media logical / allocated bytes | 729 / 4,096 |

The actual offline ID list independently matches the required fixture and
hashes to `c18d2f7afba531ca5a0ee2feb32459153f07086ad2f986023cfce94bc87ddf50`
(sorted IDs joined by LF). A separate stopped-database check **after reconnect**
again found these 10,000 IDs and 248 membership rows. The membership count is
not attributed to the offline enumeration. These are individual measured
attempts with observer overhead, not a controlled performance comparison;
the slower final timing is retained rather than replaced with an earlier run.

The three complete driver receipts/manifests, host oracle results, wrapper
outputs, disk/memory observations and custody copies are retained locally at
`/tmp/sb4-3011-20260922/clique-native-expo024-evidence`. The compact independent
review packet is
`/tmp/sb4-3011-20260922/clique-native-final-candidate-review`; it includes exact
source, task scripts, original-versus-extension diff, fixture expectations,
all three receipts and preserved failure evidence, without private plans or
other reviewers' conclusions. Each attempt's stopped Documents copy and the
immutable Release app remain on M5 in the extension's `artifacts/` tree.

At this candidate checkpoint, the owned app/backend were stopped, port 49380
was free, and the owned simulator was shut down. Final package publication and
the installed-pin rerun followed below. Real-provider delivery remains **pending account and
recipient**. Android, physical-device power loss, exact peak memory and wire
bytes are unmeasured. The original cal16 grade and score remain unchanged.


### Independent evidence audit and portable receipts

Astra max independently verified the frozen 275-file candidate packet and
marked all three stated candidate passes READY, with no material evidence
contradictions. The [actual review](../../llp/reviews/3000.011-recent-builder-friction.gpt.md#actual-clique-native-candidate-evidence-review--2026-09-23)
records its scope and limits. [Selected verbatim receipts and custody](./20260922-clique-native-extension/candidate-expo024/SELECTED.json)
are retained here; the complete packet, including videos and full logs, stays
at its recorded local path. The packet manifest still describes that complete
packet, not just this portable subset.

The separate [post-reconnect checker supplement](./20260922-clique-native-extension/post-reconnect-check/README.md)
records a fresh read-only inspection of an APFS clone of the preserved stopped
Documents snapshot. Its actual output confirms 10,000 messages and 248
memberships; before/after hashes show the original snapshot was unchanged.
It adds portable evidence for the ancillary membership count and does not
replace or relabel the original offline message-query proof.

## Final public-package result

All three actual scenarios passed after a fresh registry installation of
`snapback4@0.2.33`, `snapback4-darwin-arm64@0.2.33` and
`snapback4-expo@0.2.24`. The new sibling packet is
`attempts/native-extension-public`; the earlier candidate app, Release build,
backend snapshots and results are preserved. The [installed-package receipt](./20260922-clique-native-extension/public-033-024/custody/installed-public-packages.json)
binds all three registry URLs and integrities to the qualified release. The
actual CLI reports 0.2.33. All 73 non-package application source files match
the reviewed candidate; only `package.json` and its lock changed. Published
CLI generation introduced no API source change in this application.

CLI check, Pod generation and full application typecheck passed. The first
build failed before app execution because copied Xcode caches contained an
absolute Swift module-cache path to the candidate directory. That setup failure
is preserved. A fresh owned DerivedData directory with identical source and
normal signing passed in 404.393 seconds. The [immutable Release custody](./20260922-clique-native-extension/public-033-024/custody/release-public-033-024-1.json)
records Hermes bundle SHA-256
`11dc8975a0776c3e2c3e6931de88645c67e95c582756274df92e8badf0338901`
and executable SHA-256
`5367499af0dbd6a32bc890c85be52cd855820524c741d3c9d7b5ca19d75c03db`.

| Public installed Release scenario | Result | Driver elapsed | Outer wrapper elapsed |
| --- | --- | ---: | ---: |
| `restart-public-033-024-1` | Pass | 50.979 s | 52.521659 s |
| `revocation-public-033-024-1` | Pass | 32.466 s | 33.822223 s |
| `acquisition-public-033-024-1` | Pass | 30.048 s | 31.433715 s |

The unchanged revision-4 assertions completed against the public CLI. The
actual once image loaded with no durable once bytes or manifest entry while
its handle remained live. Ordinary images and native video rendered in both
offline processes; the stopped host oracle verified exact ordinary bytes and
canonical filenames, excluding both possible once variants. The same two
pending message/write pairs survived death, settled exactly once in order at
sequences 167308 and 167309, and reached delivered/read through the other
participant. Learned revocation retained delivered text, purged ordinary
media and excluded the later message offline and after an explicitly confirmed
online reconnect.

Root inspected the [two offline screen frames](./20260922-clique-native-extension/public-033-024/frames/frames.json).
They show the blue-gray native player below the separate red IMG01 poster,
matching the exact fixture's sampled source frames. Native first-frame receipts
occur at 02:33:40.395 and 02:33:50.211 UTC, 3.209 and 13.025 seconds after
recording began. The extracted frames are at 3.608333 and 13.411667 seconds;
the first player is partly clipped and the second fully visible. Neither
motion nor audio is claimed, and the unchanged status heading is not a timing
measurement. The existing driver does not film priming or initial acquisition.

| Public acquisition observation | Value |
| --- | ---: |
| Acquired on original opener return, upper bound | 13,061.567 ms |
| First useful real chat-row layout | 13,197.117 ms |
| Cold offline opener | 79.280 ms |
| Offline message IDs / scopes / actual query pages | 10,000 / 100 / 299 |
| Offline full-ID audit elapsed | 5,304.011 ms |
| Observed response bodies / UTF-8 bytes | 46 / 59,280,798 |
| Response events, including repeats | 161,275 |
| Own-app RSS samples / sampled maximum | 102 / 424,673,280 bytes |
| DB / WAL / SHM logical bytes | 264,450,048 / 157,730,112 / 32,768 |
| DB / WAL / SHM allocated bytes | 268,906,496 / 168,513,536 / 32,768 |
| Incidental ordinary media logical / allocated bytes | 729 / 4,096 |

The complete offline query enumeration matches the required message-ID hash
`c18d2f7afba531ca5a0ee2feb32459153f07086ad2f986023cfce94bc87ddf50`
before reconnect. The separate [post-reconnect inspection](./20260922-clique-native-extension/public-033-024/custody/post-reconnect-public-check.json)
of an APFS clone found 10,000 messages and 248 memberships; it did not open
the preserved snapshot with SQLite. These are single observed runs with
instrumentation overhead, not evidence of a causal performance improvement
over the slower candidate. Response-body copies are not wire bytes, and
sampled RSS is not an exact peak.

[Selected verbatim receipts, custody and frames](./20260922-clique-native-extension/public-033-024/SELECTED.json)
are retained in the repository. The complete packet is
`/tmp/sb4-3011-20260922/clique-native-public-evidence`; full stopped Documents
snapshots and the immutable Release remain on M5. Owned app/backend processes
were stopped, the simulator shut down, and port 49380 confirmed refusing
connections at 02:35:19.692 UTC. The final cold corrective-package benchmark
started separately afterward. Native and operational qualification do not
supply real-provider, Android, physical-device or power-loss evidence, and
do not revise cal16's original grade.

Astra max independently audited the final public packet and this report at
`64e1a3ddd`, reproducing all 267 packet hashes, all 37 selected receipt hashes,
the nine driver artifact bindings, exact IDs and measurements. The [actual
review](../../llp/reviews/3000.011-recent-builder-friction.gpt.md) is READY with
no material findings. It reviewed the retained custody chain for host-only
Release binaries rather than independently hashing omitted binaries, and
does not qualify the separate cold benchmark or real-provider cell.
