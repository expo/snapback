# Social-messenger fixture pack

Version: `0.2.1-m8`

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
- `scale.log` is the committed full replay fixture and `scale-log.sha256` pins
  its bytes. Its line and action counts are also pinned in the combined
  manifest. A frozen read-only instrument therefore delivers the workload it
  asks a lane to replay; a lane does not need to discover a generator command
  or write back into the instrument tree.
- `config/digest.production.json` schedules one digest period per day, anchored
  at 08:00 UTC. `config/digest.shortened.json` schedules one period every 2
  minutes for grading. Both configs require at most one digest per user per
  period and server-authoritative schedule evaluation.
- `config/windows.production.json` carries 15-minute edit, 60-minute
  delete-for-everyone, and off/24-hour/7-day disappearance values.
  `config/windows.shortened.json` freezes grading values at 1 minute, 2
  minutes, and off/3 minutes/5 minutes respectively while retaining the
  production option identities.
- `media/` contains six labeled 640×480 PNGs, two labeled 256×256 avatars, one
  five-second 320×240 H.264/AAC MP4, the deterministic generator, and an
  adjacent content-hash manifest.

## Named scale fixtures

- `u0500` follows exactly 500 accounts and belongs to exactly 100
  conversations; `u0005` is the existing 5-follow comparison account.
- `u0900` is the celebrity: exactly 900 scale users follow it, and it authors
  exactly 200 top-level posts spread evenly through the scale log.
- `u0901` is the celebrity-follower read-path probe. It follows exactly
  `u0001`, `u0002`, `u0003`, `u0004`, and celebrity `u0900`.
- `g0001` remains the 50-member busy group with exactly 10,000 messages.

The combined manifest records these fixtures at the 10%, 50%, and final
states; celebrity post counts at those states are 20, 100, and 200.

## Regeneration

Run from this directory with Node.js and `ffmpeg` available:

```sh
node generate.mjs starter
node generate.mjs sample
node media/media-gen.mjs
node generate.mjs manifests
```

The manifest command recomputes the starter state and refuses any drift from
the committed starter manifest before writing the combined manifest. Additive
fixture milestones therefore retain the starter manifest's original bytes and
provenance.

Regenerate the committed scale artifact with:

```sh
node generate.mjs scale > scale.log
shasum -a 256 -c scale-log.sha256
```

Commit `scale.log` with the adjacent digest and manifest updates. The file is
large but intentional: LLP 0317 Wave 5 treats delivery of the exact replay
workload as a hard instrument gate after the 0.1.29 matrix lost cells when the
read-only snapshot carried only its digest.

Changing the starter fixture is rarer and guarded. After deliberately editing
the generator and regenerating `starter-m*.log`, run
`node generate.mjs manifests --update-starter`; ordinary `manifests` continues
to refuse accidental starter drift.

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
log's SHA-256, 167,157-action count, 167,159-line count, and checkpoint prefix
hashes. Regenerating twice on the same toolchain must produce the same bytes;
the checked scale SHA-256 is the cross-run authority.

## Committed versus derived

Committed: schema and documentation, personas, configs, generator and
validator, starter logs, the 50-action sample, both manifests,
`scale-log.sha256`, all media, the media generator, and `VERSION`.

Derived and not committed: replay-adapter/backend state created from the
committed action logs.
