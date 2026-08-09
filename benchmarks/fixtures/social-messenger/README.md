# Social-messenger fixture pack

Version: `0.1.0-p1`

Provenance: LLP 0201 D7 P1 — the canonical `social-messenger` benchmark's
fixture-pack prerequisite.

This directory is the backend-neutral data and media pack for Clique. Replay
adapters consume action logs through an application's real authentication and
mutation paths; the logs are not database imports.

## Artifacts

- `action-schema.md` and `action-schema.json` freeze the action-line grammar,
  all 13 verbs, checkpoint markers, idempotent set-state arguments, and the
  settle-before-next rule.
- `personas.json` contains the eight starter accounts, their fixed passwords
  and complete profiles, plus the `u0001`–`u1000` scale naming and credential
  rule.
- `starter-m1.log`, `starter-m2.log`, and `starter-m3.log` are the committed
  milestone segments. M1 has only registrations and profiles; M2 adds the
  intentionally asymmetric follow graph and post corpus; M3 adds one DM, one
  group, messages, and quoted replies.
- `sample-50.log` is the committed M6 replay-adapter conformance sample. It has
  exactly 50 actions and exercises every verb at least once.
- `invariant-manifest-starter.json` describes the exact state after all three
  starter segments. `invariant-manifest-combined.json` describes the exact
  starter-plus-scale state, per-chat counts, per-user follow/conversation
  counts, named spot content, the O5 fixtures, and the 10%/50% checkpoint
  sub-manifests.
- `scale-log.sha256` pins the derived scale log. The scale log itself is not
  committed; its line and action counts are pinned in the combined manifest.
- `config/windows.production.json` carries 15-minute edit, 60-minute
  delete-for-everyone, and off/24-hour/7-day disappearance values.
  `config/windows.shortened.json` freezes grading values at 1 minute, 2
  minutes, and off/3 minutes/5 minutes respectively while retaining the
  production option identities.
- `media/` contains six labeled 640×480 PNGs, two labeled 256×256 avatars, one
  five-second 320×240 H.264/AAC MP4, the deterministic generator, and an
  adjacent content-hash manifest.

## Regeneration

Run from this directory with Node.js and `ffmpeg` available:

```sh
node generate.mjs starter
node generate.mjs sample
node media/media-gen.mjs
node generate.mjs manifests
```

Generate the intentionally uncommitted scale artifact with:

```sh
node generate.mjs scale > scale.log
shasum -a 256 -c scale-log.sha256
```

Delete the derived `scale.log` after use. It is deliberately omitted from the
repository because it is about 166,000 human-readable lines and is fully
reconstructible from the committed generator.

Validate the committed action logs with:

```sh
node validate.mjs starter-m1.log starter-m2.log starter-m3.log sample-50.log
```

The validator also accepts a derived log on standard input without writing it:

```sh
node generate.mjs scale | node validate.mjs -
```

## Determinism guarantees

`generate.mjs` uses mulberry32 with seed `20260808`. Every command begins from
that seed and from timestamp `2026-01-01T00:00:00Z`; action timestamps advance
by exactly one second. The generator has no wall-clock or ambient-randomness
input. Log timestamps are documentary: replay sequence and server arrival time
remain authoritative.

The PNG generator is a dependency-free bitmap encoder with a bundled 5×7
glyph set. The video generator gives `ffmpeg` fixed synthetic inputs, duration,
codec settings, metadata stripping, and single-threaded x264 settings. Media
contains no captured user data.

The two invariant manifests record generator version/source hash and content
hashes for their adjacent generated logs. The combined manifest pins the scale
log's SHA-256, 166,053-action count, 166,055-line count, and checkpoint prefix
hashes. Regenerating twice on the same toolchain must produce the same bytes;
the checked scale SHA-256 is the cross-run authority.

## Committed versus derived

Committed: schema and documentation, personas, configs, generator and
validator, starter logs, the 50-action sample, both manifests,
`scale-log.sha256`, all media, the media generator, and `VERSION`.

Derived and not committed: `scale.log` and any replay-adapter/backend state
created from it.
