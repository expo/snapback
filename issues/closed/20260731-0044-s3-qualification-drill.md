# 0044 S3 lane: live-endpoint qualification drill

**Status:** OPEN — created by W2g (2026-07-31)

The S3-compatible store landed behind the `AssetStore` seam with its
protocol logic validated against an in-process S3-semantics fake that
independently re-derives SigV4 and enforces bucket/multipart/range/wipe
semantics (`src/assets_s3.rs` tests, 6/6). **No live endpoint has been
qualified** — neither MinIO nor docker exists on the build machine — so
per LLP 0044's store-parameter honesty, no target claims the S3 store:
`assetLifecycleStores` stays `["local-fs"]`, and
`SNAPBACK_ASSET_STORE=s3` refuses (`SNAPBACK_ASSET_STORE_UNQUALIFIED`)
without the `SNAPBACK_ASSET_S3_EXPERIMENTAL=1` acknowledgment.

## Runnable qualification recipe

Local MinIO (any machine with docker or a minio binary):

    docker run -d -p 9000:9000 -e MINIO_ROOT_USER=quser \
      -e MINIO_ROOT_PASSWORD=qsecret123 minio/minio server /data
    mc alias set qual http://127.0.0.1:9000 quser qsecret123
    mc mb qual/snapback-qual

    SNAPBACK_S3_TEST_ENDPOINT=http://127.0.0.1:9000 \
    SNAPBACK_S3_TEST_BUCKET=snapback-qual \
    SNAPBACK_S3_TEST_ACCESS_KEY_ID=quser \
    SNAPBACK_S3_TEST_SECRET_ACCESS_KEY=qsecret123 \
    cargo test --lib s3_store_live_endpoint_qualification -- --nocapture

The same env shape points at R2 (account endpoint + API token S3
credentials) or Tigris; each provider earns its own qualification fact —
R2 evidence does not qualify Tigris (LLP 0044 §Capability facts). The R2
drill needs shared-deployment coordination per the fleet convention
(check other sessions before touching the shared Cloudflare account).

## What qualification unlocks (in order)

1. A passing live run against MinIO → the local target may declare the
   dev-lane S3 store as an additional qualified store
   (`assetLifecycleStores` gains an `s3-*` parameter) and the
   `SNAPBACK_ASSET_STORE=s3` refusal lifts for that posture.
2. The S3 attempt routes: multipart instructions
   (`AssetS3TransferInstructionV1`, schema committed) minted at attempt
   create, presigned part PUTs client-direct, completion through
   Snapback admission, TUS lane untouched.
3. Provider drills (R2 first per LLP 0014, Tigris beside the Fly lane)
   with per-provider checksum/conditional-write/range variance recorded
   as facts.

## Resolution (2026-08-03)

**Status: CLOSED — dev-lane qualification ran green; the local target now
declares the `s3-compatible` store parameter.**

Docker was unavailable on the build machine, so the drill used the
ticket's other allowed path: the standalone MinIO darwin-arm64 server
binary (RELEASE.2025-09-07T16-13-09Z, `minio server` on
`http://127.0.0.1:9000`, ephemeral scratch data dir, `mc mb
qual/snapback-qual`), torn down after the run. Credentials were the
recipe's throwaway `quser`/`qsecret123` pair, never anything real.

Evidence:

- `SNAPBACK_S3_TEST_*` per the recipe →
  `cargo test --lib s3_store_live_endpoint_qualification -- --nocapture`:
  `test assets_s3::tests::s3_store_live_endpoint_qualification ... ok`
  (1 passed; 1909 filtered out) — idempotent publication, digest
  read-back, ranged read, multipart create/abort, prefix wipe, clean
  `exists` probe, all against the live endpoint.
- Negative control: the same run with a wrong
  `SNAPBACK_S3_TEST_SECRET_ACCESS_KEY` FAILED — the passing run was a
  live-endpoint exchange, not an env-gated skip.

Flip (unlock 1 of the ticket's activation order):

- `AssetTargetFactsV1::local_v1().lifecycle_stores` gains
  `ASSET_STORE_S3_COMPATIBLE` (`"s3-compatible"`) — `src/assets.rs`.
- The `SNAPBACK_ASSET_STORE=s3` unqualified refusal now consults that
  same declared-facts source (`src/local.rs asset_store_obj`): declared ⇒
  admitted; fact withdrawn ⇒ refusal returns, experimental override
  unchanged.
- LLP 0044 dated status note + the W2g evidence row in
  `tests/acceptance/asset-lifecycle-v1-evidence.md` updated to match.

Not claimed (unlocks 2–3 stay open): the S3 attempt routes (multipart
instructions still held inherent) and every hosted provider — R2 and
Tigris each still earn their own qualification fact per this recipe.
