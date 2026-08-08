# S3 asset store: harden transport + range handling + XML before the experimental fence is lifted

**Opened:** 2026-08-08 · **Severity:** P2 (correctness/robustness; currently fenced behind `SNAPBACK_ASSET_S3_EXPERIMENTAL=1`) · **Area:** assets / S3

The S3 store is the least mature component in the asset layer (hand-rolled
SigV4, naive XML extraction). It is correctly gated behind
`SNAPBACK_ASSET_S3_EXPERIMENTAL=1` and was qualified only against MinIO (which
honors ranges). These must land before the fence moves.

## A) HTTP 200 (range ignored) treated as a valid chunk → u64 wrap / runaway stream / infinite hash loop

`src/assets_s3.rs:658-659` (`200 | 206 => Ok(response.body)`), consumed at
`src/server.rs:21195-21198` and `assets_s3.rs:678-692`. An S3-compatible
provider that ignores `Range` returns 200 + full body. In
`stream_asset_delivery`, `remaining - read` underflows — release profile has no
overflow checks — so `remaining` wraps to ~2^64 and the stream serves past the
window against a wrong `Content-Length`. In `AssetS3Store::hash`, a full-body
200 ≥ `CHUNK_READ_LIMIT` never breaks the loop → infinite re-GET/hash.
*Fix:* for status 200, slice `body` to `[offset..offset+max_len]` (or refuse as
a store contract violation); treat `read > remaining` in the stream as an error.

## B) No read/overall timeout, unbounded response buffering → hung endpoint wedges the instance

`src/assets_s3.rs:114-163`. `ureq::request` with no agent sets no read/write/
overall timeout, and `read_to_end` has no size cap. Every `AssetStore` call runs
inside the global `LocalSnapback` mutex, so a stalled S3 endpoint holds the
global lock forever → the entire instance stops serving. Contrast push
(`src/push.rs:176-211`), which sets connect/read/write timeouts and caps the
response at 1 MiB.
*Fix:* build a `ureq::Agent` with timeouts (mirror `post_expo_json`) and cap
`read_to_end` with `.take(limit)`.

## C) `multipart_complete` interpolates ETags into XML without escaping

`src/assets_s3.rs:490-495`:
`format!("<Part><PartNumber>{number}</PartNumber><ETag>{etag}</ETag></Part>")`.
Client-controlled ETags (via presigned part PUTs) containing
`</ETag><Part>…` inject structure into `CompleteMultipartUpload`. Impact is
malformed-request weirdness (the client already controls its own part list), but
it's a landmine for when the native-multipart lane activates.
*Fix:* XML-escape or validate ETag shape (`"[0-9a-f-]+"`) before interpolation.

## Confidence

High on all three mechanisms; medium on impact given the experimental fence.
Land as a set before ungating S3.

## Resolution (2026-08-08)
Fixed on main (Lane B). Verified: cargo build; cargo test --lib asset 135 pass (single-threaded); ref-check clean.
