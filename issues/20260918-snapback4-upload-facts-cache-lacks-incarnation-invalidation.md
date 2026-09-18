# Snapback 4 upload facts cache lacks incarnation invalidation

Status: Open
Scope: Snapback 4 device prediction metadata
Reported: 2026-09-18, Repair B round 8 durable-key audit

`device:upload:[viewer,asset]` is written by `Device::upload_facts` and read by
`media::inputs` to resolve asset facts during prediction. Its key and value
carry no store identity. Incarnation replacement, backend adoption and row
reacquisition leave these records intact; there is no asset-expiry invalidation.

A native SQLite protocol probe recorded facts for `asset-from-S`, replaced S
with T, adopted the backend, acquired T and reopened. All six fact fields were
unchanged while `sync_state.store_id` was T. The reproduction and exact output
are retained at `snapback4/target/review-fix8/upload-cache-probe.py` and
`upload-cache-probe.log`. Source: `snapback4-device/src/device/media.rs`
(`upload_key`, `inputs`, `upload_facts`), and the replacement path in
`device/store_identity.rs`.

This proves a missing local cache lifetime, not unauthorized server execution:
the server resolves and validates assets independently. Qualify the prediction
behavior with an old-store upload after replacement and with an expired or
collected upload, then decide whether to scope facts by incarnation, invalidate
them on replacement, or explicitly make an unavailable asset unpredicted.
Keep legitimate same-store offline prediction and the upload-receipt tests.

This neighboring cache is outside the Repair B private-publication repair; it
is recorded because the requested invalidation-column audit found it. Do not
claim the full lifetime class closed while this boundary is unresolved.
