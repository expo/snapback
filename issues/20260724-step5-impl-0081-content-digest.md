# 0081: ContentDigestV1 — framed streaming proof digest

**Status:** Deferred (phase C)
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
