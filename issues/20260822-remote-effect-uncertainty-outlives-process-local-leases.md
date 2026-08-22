# A remote PUT can outlive its process-local lease and recreate a deleted object

Status: Open — design item; deliberately out of scope for the asset lease work
Created: 2026-08-22
Related: issues/20260821-durable-authority-to-effect-handoff-design.md, LLP 0044

Found by review of the width publication lease. The lease closes the in-process race; this is the
part it structurally cannot close.

## The interleaving

1. B condemns shared publication P; C starts its conditional S3 PUT.
2. The request reaches a proxy or the provider, but the process dies — or the client times out —
   before receiving a result. The qualified S3 path has a 30-second client timeout and no guarantee
   that closing the client or the process cancels a request already buffered upstream
   (`crates/snapback-services/src/assets_s3.rs:125`, `:675`).
3. The lease is process-local RAII, so it disappears with the process
   (`crates/snapback-services/src/assets.rs:587`, `:741`).
4. A restarted server's first maintenance tick runs GC immediately
   (`crates/snapback-server/src/server.rs:20049`). GC deletes P's object and retires its row,
   because the new lease registry is empty
   (`crates/snapback-engine/src/local/engine.rs:14492`).
5. The delayed PUT serializes *after* the DELETE and recreates P's key.

The recreated object is undiscoverable: the publication row is gone.

## Why the lease cannot fix this

The lease is an in-memory RAII token. Its guarantee ends at process death, but an S3 request
already buffered upstream does not. Any purely process-local mechanism has the same boundary — this
needs a **durable** uncertainty fence, not a stronger token.

The `af7` bounded-expiry work narrows the in-process case (five-minute deadline, condemned row
retained as the uncertainty owner until the call returns, refusal reported as
`SNAPBACK_ASSET_STORE_UNAVAILABLE`) but explicitly does not claim to cover restart.

## Shape of a fix

A durable record of "a remote effect may be in flight for this key", written before the PUT and
cleared after a definite outcome, with condemned-object cleanup deferred while such a record is
live and younger than a bounded provider-uncertainty window. That is the same shape as the
authority-to-effect handoff design — authority and intent transfer to a durable record before the
irreversible cut — applied to cleanup rather than to authorization.

Open question worth settling first: what is the provider-uncertainty window for the qualified S3
path? Without a defensible bound, deferred cleanup becomes indefinite retention, which is the leak
the lease expiry was added to prevent.

## Severity

Requires a crash or client timeout during a specific staggered-cohort window, so it is not
routinely reachable. The consequence is a storage object that no database row references — cost and
retention rather than correctness of served bytes. It should not block the lease work, which is a
strict improvement.
