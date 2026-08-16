# Video strip walker refuses a real iPhone MOV at a box boundary

**Filed:** 2026-08-16 · **Status:** Open · **Systems:** Assets, Video

**Related:** issues/20260815-finish-media-happy-path.md (device pass),
src/assets_video.rs, demos/media-happy-post

## Signal

Physical-device acceptance (iPhone, Expo Go, expo-image-picker in
`compatible` representation mode): a photo-library video uploads to 100%,
then finalization refuses with

```text
SNAPBACK_ASSET_VIDEO_PARSE_FAILED: box \0\0\0\0 declares a size beyond its container
```

The per-item residue contract worked exactly as designed: items #1–#3
(images) finalized and stayed ready; #4 failed alone with the typed
diagnostic; nothing was silently deleted.

## Analysis

The bounded strip walker (`src/assets_video.rs`) supports the `qt` brand and
the standard size forms (size-0 to-end at top level, size-1 largesize). A
box whose reported kind is four NUL bytes with a size beyond its container
suggests the walker is reading trailing padding or an Apple-muxer atom
layout (`wide`, zero-fill after `mdat`, or similar) as a box header. The
exact reproducing bytes were reclaimed with the failed attempt (bounded
cleanup); a fixture file from the same device is being captured.

## Wanted

1. Extend the walker to handle whatever real Apple exports produce here
   (likely: tolerate zero padding at top level after the last box, and/or
   `wide`+co64 conventions) WITHOUT weakening the bounded fail-closed
   posture for genuinely malformed sizes.
2. A fixture built from the real device file's box structure (metadata
   layout only; strip the media payload down) in the video finalizer tests.
3. While refusing, the diagnostic should render the kind bytes safely
   (`\0\0\0\0` printed raw today) and name the offset.

## Progress (2026-08-16, Phase H landed)

Root cause identified from the failure bytes and corroborated against
Apple's QuickTime metadata layout and FFmpeg's parser: QuickTime `meta`
atoms are NOT ISO fullboxes; parsing the 4-byte version/flags that are not
there shifts the walker into garbage (`\0\0\0\0` kind, size beyond
container). Fixed: `meta` children are distinguished by direct `hdlr`
detection; narrow top-level zero-padding admission added without relaxing
malformed-size fail-closed handling; refusal diagnostics now escape
non-printable kinds and carry byte offsets. Synthetic Apple-layout tests
cover the shapes. REMAINING before close: verify against the author's
real device MOV (AirDrop pending) and upgrade/supplement the fixture from
its box structure.

## Closed (2026-08-16): real-device verification complete

The author's actual iPhone MOV (13.6MB QuickTime: ftyp(qt) + wide + mdat +
trailing moov with nine trak atoms and two QuickTime meta atoms whose first
child is a direct hdlr at +8 — no fullbox version/flags) uploaded through
the full generated media command against a live server, finalized through
the fixed strip walker, committed atomically, and read back as an ordered
collection item with server-admitted kind "video"
(demos/media-happy-post/tests/probe-real-video.mjs). The committed
regression coverage stays synthetic by design: real iPhone meta/ilst atoms
can carry location and device metadata, so the personal file's bytes are
deliberately not embedded in the repository; its box layout is recorded
above and mirrored by the synthesized tests.
