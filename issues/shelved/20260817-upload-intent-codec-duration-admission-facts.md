# Upload intents cannot express codec or duration admission facts

**Opened:** 2026-08-17
**Source:** Coterie Snapback M2 backend lane (Diary 0086); LLP 0277 F8

## Gap

Upload intents bound media type and byte size, but the social-messenger
brief's video rules — H.264/AAC codecs and a 60-second duration ceiling —
are inexpressible, so Coterie's M2 video admission honestly enforces less
than the product rule. Any app with codec or duration policy has the same
gap: the admission boundary that already does trusted type detection is the
natural place for these facts, and client-side checks are not authority.

## Ask

Extend the trusted admission pipeline with declarable media facts for video
(container/codec identification, duration ceiling) analogous to the existing
type/byte bounds, refusing with a structured code when violated. Route the
design through the storage graduation plan (LLP 0269). Acceptance: the
Coterie M2 video intent declares the brief's actual rules and its honesty
caveat in Diary 0086 is retired by a rerun.

## Design update — 2026-08-24

The two hostile design reviews converged on the trust-boundary, duration,
fragment, brand, deterministic-bound, parser-version, and document-home
corrections. The revised design landed as dedicated **Review-status**
[LLP 0305](../../llp/0305-declared-video-admission.spec.md), under LLP 0044's
asset-pipeline authority. LLP 0269 now retains only the
SQLite → Postgres → transactional-cell portability/graduation obligations and
links to the Spec.

LLP 0305 deliberately proves declared ISO BMFF sample-entry/decoder
configuration, same-file sample extents, and bounded sample-timeline duration;
it does not decode `mdat` or claim elementary H.264/AAC bitstream identity.
Its acceptance adds the converged adversarial fixtures and requires a pinned
independent FFmpeg `ffprobe` plus decode-to-null codec/timeline oracle for the
Coterie rerun.

This ticket remains open. The design has landed at Review status; the next
lane is implementation, affected qualification, and the real-server Coterie
M2 rerun. Only that evidence may retire Diary 0086's broad caveat for the
declared facts, while retaining an explicit elementary-stream caveat, and
close this ticket.
