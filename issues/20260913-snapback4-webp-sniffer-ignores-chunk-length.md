# Snapback 4: the WebP sniffer ignores chunk length and invents dimensions

Status: Open
Priority: P2
Date: 2026-09-13
Systems: asset sniff
Author: Grok 4.6 (comprehensive review of origin/main `f9bf18f0e`)

## Problem and reproduction

`webp_dimensions` sets `payload = &bytes[i + 8..]` (the rest of the file), not the declared chunk length. A `VP8X` chunk with `length=1` plus following bytes is sniffed as a canvas.

Probe: `WEBP_SHORT_CHUNK` sniffed `204545×122625`. Those facts ride on the row (`width`/`height`); `require photo.width <= N` then judges garbage. JPEG/PNG paths honor declared lengths; VP8/VP8L have the same unbounded `payload`.

MP4 still never reads width/height from the header (NOT-DOING says “dimensions and duration read from the header”; only `mvhd` duration is parsed). That is a smaller claim mismatch.

## Implementation locations

- [snapback4/crates/snapback4-core/src/assets.rs](../snapback4/crates/snapback4-core/src/assets.rs) (`webp_dimensions`, MP4 branch of `sniff`)

## Suggestion

Slice `payload` to `i+8..i+8+length` and refuse a truncated chunk. Add the length-1 VP8X case next to `webp_vp8x_dimensions`. Parse `tkhd`/`stsd` for video dimensions, or narrow the NOT-DOING line.
