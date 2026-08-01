# Policy-gate inspection limit (2 MiB) breaks default-config TUS uploads

**Status:** OPEN — found by the LLP 0139 Clip Locker bakeoff arm
(2026-08-01), first minutes of real large-file use

On the sessions lane, every asset TUS `PATCH` passes the policy gate's
body inspection, which rejects bodies over `limitBytes: 2097152` with
`SNAPBACK_VALUE_TOO_LARGE` ("request body exceeded the policy-gate
inspection limit") → HTTP 413. Consequences:

1. The JS client's `DEFAULT_CHUNK_BYTES` (4 MiB) can never complete an
   upload against the shipped server — default config fails on chunk 1.
2. The declared `ASSET_MAX_CHUNK_BYTES` capability fact (8 MiB) and the
   TUS route's own `DefaultBodyLimit` (8 MiB + 16 KiB) are unreachable:
   the gate caps first, so the manifest overstates the real chunk bound.
3. The conformance suite masked it by using 64-byte chunks; the first
   real 120 MB upload found it immediately.
4. Diagnostic quality note: when the failure races the stream, the
   client surfaces bare `fetch failed` (connection cut mid-body) instead
   of the clean 413 diagnostic — intermittently misleading.

Fix directions (pick one, keep facts honest): exempt the opaque
`application/offset+octet-stream` TUS body from policy-gate inspection
(it is never policy-inspectable JSON; the route's own limit + the
handler's chunk fact govern), or raise the gate limit for the
`AssetTransfer` invocation source to `ASSET_MAX_CHUNK_BYTES` + headroom.
Either way, add a real-chunk-size conformance vector (≥ the client
default) so defaults-vs-limits drift can't recur, and align
`DEFAULT_CHUNK_BYTES`, the gate, the route limit, and the manifest fact.

Bakeoff arm workaround: `chunkBytes` lowered to fit under the gate;
recorded as ceremony friction in the diary.

---

**RESOLVED 2026-08-01.** Root cause: every body-bearing app route carries
`LegacyBodyPolicy::Rejected`, so the policy middleware buffered the whole
body through `peek_policy_json_body` under the generic 2 MiB
`POLICY_BODY_PEEK_LIMIT` — TUS `PATCH` chunks included, though an opaque
`application/offset+octet-stream` body can never carry the JSON
transport-auth fields the peek exists to reject (its JSON parse of chunk
bytes always yielded `None`; the size cap was inspection's only effect).

Fix: (1) `InvocationSource::AssetTransfer` bodies are exempt from policy
inspection; ingest is bounded in the handler by the declared
`ASSET_MAX_CHUNK_BYTES` fact + headroom, refusing over-bound chunks with
the classified `SNAPBACK_ASSET_MEDIA_BOUNDS_EXCEEDED` 413 (an extractor
layer's plain 413 would truthfully surface as an unclassified 500).
(2) The host-ops lane — whose `asset.put`/`asset.ensureSeedFixture`
inputs legitimately carry chunk-sized base64 — peeks and bounds under a
widened envelope (chunk fact × 4/3 + 64 KiB), reachable only after the
route's coarse admin authorization. (3) The masking gap is closed twice:
`route_policy_v1::tus_patch_streams_declared_chunks_past_the_policy_gate`
+ `host_ops_peek_admits_declared_byte_envelopes`, and the conformance
suite's Vector 1c (`defaultChunkUpload`) uploading ~10 MB over three
4 MiB default chunks against the real server.
