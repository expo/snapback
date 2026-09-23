# Candidate 2 verification and limits

2026-09-22, Astra xhigh. Source remains frozen after the three-file delta.
Normal remote package build and full package typecheck passed. Focused tests:
22/22 passed. Two affected real-server/media tests passed against the existing
snapback4 0.2.32 executable, identified by SHA256 in remote-checks/execution.json.
The tested JS SDK is the unpublished 0.2.33 candidate. The full ten-file source
manifest and all three changed remote source hashes match. Tests include actual
temporary-file reopen, no once persistence, normal browser Blob URLs, supported
media data URI bytes/padding, malformed/error/abort/synchronous/missing reader
failures, no fallback refetch, and delayed close/sign-out/rotation results.

The earlier test wrapper did not record process start/end timestamps. Its
execution.json explicitly reconstructs the actual command list, environment,
serial-success/exit evidence from the tool transcript without inventing timing.
The later npm pack wrapper did record its actual timestamps and exit code.

Tarball: /tmp/sb4-3011-20260922/native-blob-candidate-sdk-2/snapback4-0.2.33.tgz
Bytes: 600202
SHA256: dab0e0b9830dc75a7a59ae28e5633b7af9180eb1fa1a6d3d0e03feeb26f15ddb
SRI: sha512-X2RWuyyEA9BcU5t+wANEZEA/ixeF6fV2uaAwDPo22oRSm/MK9fv2VwNIGrARHqfRCtgnZKuELhGYfHCj1g74wA==
Packed dist/assets.js exactly matches TypeScript emission of frozen assets.ts;
the packed client guide matches the source file. No native build was executed;
tracked native/Expo package sources remain unchanged, Expo version 0.2.23.
This is a workspace candidate tarball, not a published-package result. Actual
installed native rendering/lifecycle qualification is owned by astra_count.

## Copy cost and revocation limits

The normal object URL path and retained ordinary native file URI path are
unchanged. Only failed/unavailable object URL conversion uses readAsDataURL.
For N payload bytes, the base64 payload has exactly 4*ceil(N/3) characters plus
the media prefix (22 characters for image/png and video/mp4; 23 for image/jpeg).
A 2,062-byte PNG produces 2,774 data-URI characters. A 49,779-byte MP4 would
produce 66,394 characters if it took the transient fallback; the retained native
video file path does not make this data-URI copy.

These are encoded lengths, not measured RSS. The native response Blob and native
reader/bridge copies can coexist with the JS string during conversion, and a
renderer may retain decoded copies. Host string storage and bridge behavior
determine the actual peak. The Blob closes after conversion or failure; the
handle's own string reference clears on idempotent revoke. A caller's copied
immutable data string cannot be revoked and must be dropped on view close.
No file, SDK cache, second HTTP request, dependency or native ABI is added.
No instantaneous memory zeroization or decoder-copy invalidation is promised.
