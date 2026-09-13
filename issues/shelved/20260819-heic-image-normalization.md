# Design and implement HEIC normalization for Expo uploads

**Status:** Open
**Impact:** 5
**Urgency:** 4
**Ease:** 2
**Confidence:** 5
**Systems:** Assets, Expo, Media processing, Capability facts, Security
**Date:** 2026-08-19
**Governing:** LLP 0044, LLP 0176 G3, LLP 0181 E2, LLP 0294 W3

## Problem

The Expo source adapter can read a picker-owned HEIC URI, but the trusted local
image pipeline admits and rewrites JPEG/PNG rather than decoding HEIC. On iOS,
compatible-mode picker conversion can also return a non-cancel empty-assets
outcome; a prior demo fix made that failure visible but did not add HEIC
support. Apps that need consistent iOS/Android image storage still have to
invent conversion behavior.

HEIC is not a mechanical MIME-list addition. Decoder availability, hostile-
input isolation, metadata and orientation, color profiles, Live Photos,
canonical bytes, output quality, and target portability all affect the trusted
asset contract.

## Required work

1. Amend LLP 0044 with a bounded HEIC design deciding:
   - trusted server decode versus first-party Expo normalization versus a
     staged combination;
   - canonical JPEG primary versus retained original plus JPEG rendition;
   - location/metadata, orientation, color, animation/Live Photo, quality, and
     export behavior;
   - byte, pixel, frame, memory, CPU, time, and output ceilings;
   - decoder containment and target capability/refusal facts.
2. Implement only the accepted slice and preserve content detection from
   bytes rather than trusting file extension or picker MIME.
3. Make every conversion/decode failure visible through the command task; only
   an explicit picker cancellation may be a silent no-op.

## Acceptance

- Retained real-device fixtures include an iOS-picked HEIC plus Android JPEG
  and PNG controls through the ordinary generated Expo command.
- The result is server-detected, renderable on both platforms, correctly
  oriented, and compliant with the declared location/metadata policy.
- Corrupt HEIC, decompression/resource bombs, unsupported Live Photo forms,
  timeout, and output-ceiling cases refuse with stable bounded diagnostics.
- Capability facts distinguish targets with and without the accepted decoder.
- No Expo-only conversion is advertised as general backend transcoding, and no
  hosted target inherits the local claim without its own evidence.
