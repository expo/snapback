#!/bin/sh
# Deterministic Clip Locker fixtures (gitignored outputs).
set -e
cd "$(dirname "$0")"
# ~120 MB real MP4: 8 min of testsrc2 at high bitrate, fixed seed-free
# synth (testsrc2 is deterministic), faststart for range playback.
[ -f clip-120mb.mp4 ] || ffmpeg -y -loglevel error -f lavfi -i testsrc2=size=1280x720:rate=30:duration=480 \
  -c:v libx264 -preset veryfast -b:v 2000k -pix_fmt yuv420p -movflags +faststart clip-120mb.mp4
# Small playable MP4 for range/playback legs.
[ -f clip-small.mp4 ] || ffmpeg -y -loglevel error -f lavfi -i testsrc2=size=640x360:rate=30:duration=6 \
  -c:v libx264 -preset veryfast -pix_fmt yuv420p -movflags +faststart clip-small.mp4
# Location-tagged MP4 (QuickTime ©xyz / com.apple.quicktime.location.ISO6709).
[ -f clip-geo.mp4 ] || ffmpeg -y -loglevel error -i clip-small.mp4 -c copy \
  -metadata location="+37.7749-122.4194/" -metadata location-eng="+37.7749-122.4194/" clip-geo.mp4
shasum -a 256 clip-120mb.mp4 clip-small.mp4 clip-geo.mp4 > checksums.txt
ls -l clip-120mb.mp4 clip-small.mp4 clip-geo.mp4
