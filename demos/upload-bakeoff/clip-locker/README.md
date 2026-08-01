# Clip Locker — LLP 0139 App C (large video)

One app, six arms: upload a large video over an unreliable connection,
resume, play with seeking, share with a bounded link, delete for real.
Arms live in `<backend>/`; each is the provider's recommended
programmatic path (official SDK/CLI), driven headless. Fixtures are
generated locally by `fixtures/make-fixtures.sh` and are gitignored;
nothing large is committed.

## Frozen acceptance checklist (before any arm; identical for all)

1. **Big upload** — upload the ~120 MB fixture (`clip-120mb.mp4`,
   deterministic ffmpeg synth). Record wall-clock and ceremony (distinct
   concepts + steps from zero to stored object).
2. **Kill at ~50 % → resume** — deterministically interrupt the transfer
   near half-way (method recorded per arm: process kill or aborted
   stream), then resume with the provider's sanctioned mechanism.
   **Measure bytes actually re-transferred** (instrumented transport or
   provider progress API). Resumability-truth = 120 MB minus resumed
   offset vs. full re-send.
3. **Integrity** — SHA-256 of the stored object (downloaded back or
   provider digest) equals the source digest.
4. **Seekable playback** — for the small real MP4 (`clip-small.mp4`),
   issue a ranged GET (`Range: bytes=N-M`) against the provider's
   delivery URL; record status (206/200), honored ranges, and headers.
5. **Share link** — mint the provider's bounded share (signed URL / TTL
   token), prove it serves signed-out, record behavior after (a) TTL
   expiry and (b) explicit revocation or deletion.
6. **Deletion truth** — delete the clip; record what stops working and
   when (metadata, canonical URL, outstanding share links, CDN cache).
7. **Video metadata privacy** — upload `clip-geo.mp4` (carries a
   QuickTime `©xyz` GPS atom); download/serve and check whether location
   metadata survives to consumers. Record the provider's default and any
   offered mitigation.
8. **Limits honesty** — the provider's documented max file size,
   chunk/part thresholds, and the first pricing cliff, from official
   docs, recorded (not tested beyond 120 MB).
9. **Ledger** — wall-clock per step, ceremony counts, verbatim
   diagnostics on any friction.

Shared-target arms follow LLP 0102's 2026-07-28 amendment: namespace
`ub-c-<backend>-<attempt>`, redacted baseline before writes, scoped
cleanup, post-cleanup absence proof — all recorded in the diary.
