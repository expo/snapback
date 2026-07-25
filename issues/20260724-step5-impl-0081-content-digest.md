# 0081: ContentDigestV1 — framed streaming proof digest

**Status:** Resolved (2026-07-25)
**Severity:** P2
**Systems:** Migrations, Storage, Testing
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-24
**Related:** Accepted LLP 0081 §5, LLP 0051 (JSON-transport)
**Marker:** step5-impl

Header/row/trailer frame layout with domain separation; rows as
length-prefixed RFC 8785 re-canonicalization of LLP 0051 JSON-transport
bytes, fail-closed for non-representable declared types; the second
system-field digest stream; resumable accumulator checkpoints (chaining
state + counters with the batch cursor) and resume-equality golden vectors;
full-proof-for-production with the sampled-audit class face-labeled.
M-sized.

**Resolution (2026-07-25):** `ContentDigestV1` landed in `src/rqs.rs`
exactly as §5 pins it: header frame (domain, algorithm version, plan
digest, schema hash, qualified table, generation, barrier head,
publication version, publicationTimestamp — every frame
`u64-be(length) || bytes`, numeric fields big-endian), one frame per
logical row as the length-prefixed RFC 8785 re-canonicalization of the
LLP 0051 JSON-transport value (absent distinguished from null;
out-of-domain values fail closed with the plan-invalid class, never
digested approximately), a trailer frame binding the row count, and the
system-field stream as a second digest under its own domain
(`snapback:content-digest:v1:system`). Resumability is real chaining
state: a minimal FIPS 180-4 SHA-256 core with exportable state
(`ResumableSha256`, proven byte-identical to `sha2::Sha256` over NIST
vectors and every split point ≤200 in
`resumable_sha256_matches_sha2_and_survives_checkpoints`), serialized as
`ContentDigestAccumulatorV1` with byte and row counters. Golden vectors
ship at `schemas/content-digest.v1.json`, generated through the stream
with resume-equality asserted at every row boundary during generation;
`content_digest_v1_pins_golden_vectors` additionally pins header
sensitivity and forged-row-counter rejection. The full-proof-vs
`sampled-audit` face-labeling is receipt policy and lands with the
Wave-3 verification ticket.
