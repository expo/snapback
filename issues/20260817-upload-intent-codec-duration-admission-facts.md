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
