# Expo 0.2.24 ordinary MP4 cache repair

Frozen 2026-09-23T01:16:52.791085+00:00. Author: Astra xhigh. Review native.patch for the
seven-file change; full-candidate.patch also includes the previously reviewed
shared SDK 0.2.33 repair. All shared runtime bytes remain exact SDK candidate 2;
its useful final candidate-4 test remains. No Rust/C ABI changes or rebuild.
Root owns the governing LLP, journal and application evidence report.

## Reproduced host issue and chosen ownership

The native lead's actual valid H.264 MP4 contains 49,779 bytes, SHA256
7e22b943746b2c858910252162f624cac396eb9e4f4100ae80e70431b7883d5f.
AVFoundation refused the extensionless original and task-owned extensionless
copy with -11828/-12847; the byte-identical .mp4 file decoded 320x240. This is
separate from the JS Blob/URL issues already fixed. The actual once image loaded
and remained outside durable storage before the video path blocked the run.

MediaFiles.swift is Foundation-only, used directly by the existing native
module under its existing serialized device lock. Existing per-store directory
and alphanumeric ID validation remain; errors retain their previous messages.
It recognizes the initial ftyp box and supported brands matching the unchanged
server parser in crates/snapback4-core/src/assets.rs:334. It does not add media
admission or trust caller-provided filename/type. Existing image bytes/names
stay unchanged.

Every payload write atomically replaces the bare-ID path first. That path is
the authoritative latest write if interruption leaves both variants. A recognized
MP4 is then moved/replaced within this same cache to <id>.mp4; legacy extensionless
MP4 entries migrate through either read or URI access. No refetch or separate
display copy is needed. Image resolution removes an obsolete .mp4 shadow. Purge
removes the potential .mp4 shadow before the authoritative bare file, so failed
shadow deletion cannot leave stale data as the sole surviving entry. The usual
module close closes/removes its helper but preserves ordinary cache bytes.
Once storage admission remains in the unchanged, tested shared SDK.

## Actual tests and limits

Standalone Mac checks compile the actual production helper with the Swift
harness OUTSIDE packaged ios/; the existing suite discovers the Node wrapper.
The harness generates a small H.264 MP4 and decodes an actual 64x48 frame via
new and migrated helper-produced file URIs, including escaped store paths. It
checks legacy read and URI migration, fresh helper reopen, both-variant
interruption/retry, image preservation, format-changing overwrite, invalid
IDs/hex, store scope, purge, and closed-helper refusal without data deletion.
Real immutable files confined to the test-owned temp directory prove failed
atomic overwrite preserves old bytes and failed shadow purge keeps authority
until retry; all flags are cleared on every exit.

The final native-mp4-host-2 run passed all seven assertion groups. Actual argv,
start/end/exit, output, source hashes, and byte-identical Rust framework before/
after manifests are LOCAL at ../host-checks/ (absolute:
/tmp/sb4-3011-20260922/native-mp4-repair/host-checks/). Their remote source is
/tmp/sb4-3011-20260922/native-mp4-host-2/. Four compiled/integration source hashes
in that receipt match the frozen manifest. The helper and harness were compiled;
full Expo module/consumer Release compilation and actual app screen/lifecycle
qualification remain with the native lead. No installed-public-package claim
is made from this standalone host test.

Expo package version becomes 0.2.24 and its Bun workspace entry matches. CLI/
shared SDK remain 0.2.33. The shared client guide carries the short migration/
rebuild note. Test harness files are outside Expo's published files list and
outside podspec's ios Swift glob.

## Unpublished native qualification tarball

M5: /tmp/sb4-3011-20260922/native-mp4-candidate-expo-1/snapback4-expo-0.2.24.tgz

SHA256: aa3a7037a65598d1c014b28136debe023d856140c6871d6fbed54607f489ccb1

Bytes: 4609484; integrity: sha512-IExI9pchHDjww3J4gCUPqDX5E2RnjIaPYVotEEM0KWFWrydsht6VBejyUOtrlcBnrhT8haHDszwaP/UAFm+LZA==

Tiny pack/source/framework receipts are local under pack-receipts/. The
archive contains 17 files, includes the production helper, excludes the test
harness, and preserves all seven framework-file digests. Actual app/native
qualification belongs to the native lead; no publication was performed.
