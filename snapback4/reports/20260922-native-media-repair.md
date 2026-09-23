# Native media compatibility repair, 2026-09-22

The actual post-grade Clique Release app reproduced a defect in published
`snapback4@0.2.32` with `snapback4-expo@0.2.23`, Expo 57 and React Native 0.86.3:
ordinary media could not enter its native cache. The [original receipts](./20260922-native-media-repair/original-native-failure.jsonl)
show successful native acquisition, a successful HTTP 200 response containing
a 2,062-byte Blob with no `arrayBuffer` method, refused image/video hooks,
and absent ordinary image bytes. This is a runtime failure, separate from the
earlier simulator-signing setup failures.

The corrective 0.2.33 SDK candidate uses the host's public FileReader only
when the direct Blob method is absent. It owns each fetched response Blob
until copying finishes or the transient handle is revoked, and closes the
native Blob when supported. Browser URL cleanup remains. Once responses
never enter ordinary byte extraction or retention, retained file lifetime is
unchanged, and caller-supplied upload Blobs remain caller-owned. The repair
changes neither the native ABI nor Expo package contents. Native release is
not a guarantee of immediate memory zeroization or decoder-copy removal.

The [ten-file candidate manifest](./20260922-native-media-repair/candidate-manifest.json)
and [patch](./20260922-native-media-repair/candidate.patch) bind the Astra xhigh
implementation to base `272deaea60a4496cc80ae232da310e452ea6929b` and patch
SHA-256 `eb7a8ef75c53eaf6e87351299c8a2e8a8b744d5099bfa12767267c8281bf181f`.
CLI/client/platform/Cargo versions and lock records select 0.2.33; Expo stays
0.2.23. This candidate is not yet a qualified or published version.

## Affected verification

On the isolated M5 checkout with Node 24.18.0, the exact ten source hashes
matched before and after these checks:

| Check | Result |
| --- | --- |
| Normal SDK package build | Pass, 0.809 s |
| Complete SDK package typecheck | Pass, 0.636 s |
| Blob/cache and online-session tests | 18 passed, zero failed/skipped, 0.156 s process time |
| Existing real-server ordinary-media and video cases | Two passed, zero failed/skipped, 4.360 s process time |

The [execution record](./20260922-native-media-repair/affected-result.json),
[focused log](./20260922-native-media-repair/affected-focused.log) and
[real-media log](./20260922-native-media-repair/affected-real-media.log) retain
commands and counts. The real-server cases use the existing 0.2.32 backend
and process-device executable, whose runtime source is unchanged by this
JavaScript repair. The complete publication suite must still rebuild and
qualify the 0.2.33 pair. The small video fixture establishes metadata and byte
retention, not native decoding; that belongs to the actual-app witness.

Astra max independently marked this exact patch READY with no material
findings; its actual response is retained in the [family review](../../llp/reviews/3000.011-recent-builder-friction.gpt.md#native-blob-compatibility-repair-review--2026-09-22).
Grok 4.7 xhigh also marked this exact patch READY with no material findings;
its [verbatim review](../../llp/reviews/3000.011-recent-builder-friction.grok.md#native-blob-compatibility-repair-review--2026-09-22) is retained. Both verdicts apply to the first patch.
The actual candidate native app then passed ordinary image rendering and
ordinary image/video file-byte controls, but failed its first once-image open.
Final package qualification, registry publication and a corrected-pin native
rerun remain pending. The original cal16 grade and score remain unchanged.


## Second native failure: transient Blob URL creation

An ordinary-Blob diagnostic isolated the failure without requesting or
consuming another once grant. HTTP 200 returned a 2,062-byte native Blob;
`close`, `URL.createObjectURL` and `URL.revokeObjectURL` were functions, the
Blob had its native ID, and the client link was online. URL creation threw
`TypeError: undefined is not a function`. The installed Expo 57 URL polyfill
calls the absent `__turboModuleProxy` directly when `RN$Bridgeless` is true;
React Native's public FileReader path resolves the native module through its
registry fallback and had already copied the ordinary bytes successfully.
The probe closed its own Blob and stopped before any once request. The native
extension report will retain the exact candidate/build/attempt identities.

The selected next remedy uses public `FileReader.readAsDataURL` only when
transient object-URL creation is unavailable or throws. It adds no file,
cache entry, second fetch, app polyfill, private native import, dependency or
ABI. This is a response-sized base64 copy in JavaScript memory; a copied data
string cannot be invalidated like a browser object URL. The screen must drop
its URI when closed. Handle cleanup releases SDK-owned references and native
Blob resources; it does not promise memory zeroization or decoder-copy
removal. That limitation is explicitly accepted for this bounded repair,
consistent with once being a server view grant and exclusion from SDK durable
storage. Ordinary retained-file behavior and normal browser object URLs stay
as they are. Astra xhigh implemented the second candidate below. Independent review and
the actual native once-image proof remain prerequisites to creating its
publication stage.


## Second candidate, frozen for review and native execution

The [second candidate manifest](./20260922-native-media-repair/candidate-2/candidate-manifest.json)
binds full patch SHA-256
`59408cfb668697adf7c145ddd933ec861d3c5dd0055b60a38d6ff8b0823bc75c`
and [delta](./20260922-native-media-repair/candidate-2/delta.patch)
`640910fc6f8cf7a88e84739202eda8f223b3fdd17bf8c49d3bc996e91d68cd82`
to the same base. Only the shared asset implementation, its focused lifecycle
test and the client guide change from candidate 1. The [ordinary-Blob probe](./20260922-native-media-repair/candidate-2/ordinary-url-probe.jsonl)
records the actual host failure without a once request.

The fallback validates supported media type, data-URI structure, base64 length
and padding against Blob size. Its existing readonly URL property reads the
handle's held string, which idempotent revoke clears; copied strings have the
documented lifetime limitation. Conversion closes the owned native Blob in
the existing cleanup path, including reader failures. Browser object URLs and
ordinary retained files keep their existing behavior.

Normal SDK build and typecheck passed on M5, as did [22 focused cases](./20260922-native-media-repair/candidate-2/affected/focused.log)
and [two existing real-server media cases](./20260922-native-media-repair/candidate-2/affected/media-server.log).
The new cases cover real SDK/cache paths, one fetch, no durable once bytes,
supported media byte round trips, missing/throwing APIs, malformed results,
reader failures and stale-session completion. FileReader is mocked in these
unit cases; they do not establish native image rendering. Both independent
review families are reviewing this frozen delta, and the revised actual-app
witness is preparing its native run. No second-candidate native or publication
pass is claimed yet.


The [candidate pack receipt](./20260922-native-media-repair/candidate-2/pack-receipts/candidate.json)
identifies the unpublished 600,202-byte tarball:
`dab0e0b9830dc75a7a59ae28e5633b7af9180eb1fa1a6d3d0e03feeb26f15ddb`.
The [execution record](./20260922-native-media-repair/candidate-2/affected/execution.json)
explicitly reconstructs the earlier command/exit evidence from the tool
transcript; individual start/end times were not recorded and are not invented.
The later pack wrapper did record timestamps. This pack is for candidate
native testing and does not replace the publisher's qualified stage.

For a payload of N bytes, the fallback holds 4 × ceil(N / 3) base64 characters
plus its MIME prefix: the 2,062-byte PNG yields 2,774 characters. These are
encoded lengths, not measured process memory. Native reader/bridge and decoder
copies may coexist; ordinary retained file URIs and working object URLs avoid
this new copy. [Verification and limits](./20260922-native-media-repair/candidate-2/verification.md)
retain that distinction.


## Final shared SDK runtime and test review

Both Grok 4.7 xhigh and Astra max marked the transient repair READY. Their
actual responses are retained in the [Grok](../../llp/reviews/3000.011-recent-builder-friction.grok.md#native-transient-media-repair-review--2026-09-22)
and [Astra](../../llp/reviews/3000.011-recent-builder-friction.gpt.md#native-transient-media-repair-review--2026-09-22)
records. Astra's nonblocking regex concern did not reproduce: the original
unflagged JavaScript expression rejected all five line terminators when
executed. The reviewer withdrew that finding in an [addendum](../../llp/reviews/3000.011-recent-builder-friction.gpt.md#native-transient-review-factual-correction--2026-09-23).
The proposed regex replacement was discarded and preserved as candidate 3;
no failed reproduction is described as a product fix.

[Final candidate 4](./20260922-native-media-repair/candidate-4/candidate-manifest.json),
full patch `fd540b33587d95d811a06e624f4d786a0cc885c5317b1b05dbbbcc02dd8ab60b`,
keeps every runtime/configuration/version/document byte of candidate 2 and adds
only the useful five-terminator regression test. All 23 focused cases and the
strict affected typecheck passed. Astra max approved that final test-only
delta. Grok raised the same unflagged-regex concern; a direct independent
Node24 execution again rejected every proposed terminator. Grok then withdrew
the finding and returned READY in its [factual correction](../../llp/reviews/3000.011-recent-builder-friction.grok.md#final-native-media-test-review-factual-correction--2026-09-23).
Both original responses and corrections remain intact. Native candidate 2 therefore
exercises the same shared SDK runtime as this final candidate.

## Third native defect: cached video filename

The actual installed candidate rendered the once image and passed file/manifest
absence checks while its handle was live, with ordinary cached media as positive
controls. The following actual VideoView failed during prime with `Cannot Open`.
That failed attempt does not qualify offline video, queued-write survival,
receipt progression or revocation.

The exact original and cached video have the same 49,779 bytes and SHA-256
`7e22b943746b2c858910252162f624cac396eb9e4f4100ae80e70431b7883d5f`.
The [AVFoundation probe](./20260922-native-media-repair/native-video/probe.swift)
confirmed a valid H.264/avc1, 320×240, 30 fps, five-second source and decoded
frame zero. The extensionless cached URI failed with AVFoundation error
-11828 and underlying OSStatus -12847. [Byte-identical filename controls](./20260922-native-media-repair/native-video/same-byte-filename-controls.jsonl)
reproduced failure without a suffix and successful decoding with `.mp4`.
These probes ran on macOS; the actual simulator VideoView failure is separately
preserved in the [native application report](./20260922-clique-native-extension.md).
No app read the diagnostic copies, and the fixture was not replaced.

The selected native repair stays in the first-party Swift private-media store:
write recognized ordinary MP4 to an actual `.mp4` path; resolve/migrate already
retained extensionless MP4; keep reads, atomic writes and removal consistent
across both owned names. Images retain their current names and bytes. Once
still never enters this store. The existing per-device lock and ID/path
validation remain; no app workaround, second fetch, extra display copy or
Rust/C ABI change is needed. The native package now requires **0.2.24**, with
unchanged Rust framework bytes and newly compiled Swift in the consumer app.
The following checkpoint records its source review and actual-helper regressions;
final package publication and public-pin execution remain separate.


## Frozen native cache candidate

The [native manifest](./20260922-native-media-repair/native-mp4-candidate-1/source-manifest.json)
binds seven changed paths to native delta
`a87144c533bed75ea4fbeeaa7c5415e66350c6d30151da5a3685b31062333cc9`
and the combined 15-file candidate
`82ef57eca122df982ed82c34785d7bac38fce494a205da372addda134899d6e7`.
The helper and module preserve the existing lock and alphanumeric IDs. Each
write commits atomically to the bare ID, then resolves recognized MP4 into
`.mp4`; a bare file wins if interruption leaves both names. Purge removes the
possible shadow first, preserving retry behavior without stale resurrection.
Recognition matches the server's supported initial `ftyp` brands; it is a
filename hint for admitted bytes, not a second media-admission policy.

The [actual host execution](./20260922-native-media-repair/native-mp4-candidate-1/host-checks/execution.json)
passed all seven scenario groups in 1.32 seconds overall. Tests compile the
production helper and decode a generated H.264 64×48 frame through both new
and migrated cache URIs. They also cover legacy reopen, exact bytes, both-name
interruption states, format changes, real immutable-file overwrite and purge
failures followed by retry, invalid IDs/hex, scoped escaped paths, and closed
helper behavior. The Swift executable harness is outside packaged `ios/`;
the suite discovers its Node wrapper, with an explicit non-macOS skip.

The [unpublished Expo candidate](./20260922-native-media-repair/native-mp4-candidate-1/pack-receipts/candidate.json)
is 4,609,484 bytes, SHA-256
`aa3a7037a65598d1c014b28136debe023d856140c6871d6fbed54607f489ccb1`.
Its 17-file package contains the frozen Swift source and unchanged Rust
framework content; the test harness is excluded. This is a candidate pack,
not a registry publication or complete release qualification. Both requested
families independently marked the frozen native repair READY with no material
findings, and approved the updated host file oracle. The rebuilt actual Clique app passed
complete restart (56.267 s) and revocation (32.341 s) scenarios on the candidate
packages, including fresh native offline video frames on both process launches.
Full acquisition also passed: the actual offline query walk matched all
10,000 IDs across 100 scopes and 299 pages before reconnect. Final public-pin
execution and publication are
still pending; the [native report](./20260922-clique-native-extension.md) retains
the exact app, package, scenario and evidence identities.
