# Snapback 2 asset GET shares the JSON worker pool with helper waits

**Status:** Resolved
**Priority:** P2
**Date:** 2026-09-11
**Systems:** `snapback2/crates/snapback2/src/serve.rs` (`WorkerClass::for_url`), `asset_http.rs` (`MediaJobs::helper`)
**Source:** Snapback 2 codebase review 2026-09-11
**Related:** LLP 1006 §5 / §14 (upload class, two helpers)

## Symptom

Uploads correctly use the dedicated upload class (`MAX_UPLOAD_WORKERS = 4`). `GET/HEAD /api/asset/...` does not: `WorkerClass::for_url` only special-cases `/api/upload`, so delivery, lazy rung renders, and `MediaJobs::helper()` waits (cap 2, up to 30s) occupy the general JSON HTTP pool (up to 60 workers when SSE is idle).

A public image is an unauthenticated compute endpoint. Snapping bounds *decode* work per asset, but each waiter still holds a JSON worker on the condvar. That can 503 `E_OWNER_BUSY` for queries. This is pool-sharing, not unbounded decode — helper RSS/time/pixel ceilings are real.

## Evidence

```166:180:snapback2/crates/snapback2/src/serve.rs
    fn for_url(url: &str) -> Self {
        ...
        } else if path == "/api/upload" {
            Self::Upload
        } else if path == "/api/live" || path == "/api/subscribe" || ...
        {
            Self::Sse
        } else {
            Self::Json
        }
    }
```

## Proposed patch

Classify `/api/asset/` with uploads (or a third bounded class). Keep the two-helper CPU cap.

```rust
        } else if path == "/api/upload" || path.starts_with("/api/asset/") {
            Self::Upload
        }
```

`MAX_UPLOAD_WORKERS = 4` plus 2 helpers is a coherent bound: at most four asset/upload HTTP workers, two of which can be in the helper condvar.

Better, if upload POSTs must not starve under image-rung storms: a dedicated `Asset` class of 4, leave upload at 4. That needs a new counter in `WorkerPools`. The one-line `/api/asset/` → `Upload` change is the floor.

## Acceptance

- 8 concurrent public-image rung renders cannot occupy every JSON worker. `POST /api/query` still gets a JSON slot (or a reserved JSON slot, already 8).
- Upload POST still has a dedicated bound; a slow helper wait is not a fifth concurrent upload body.
- Existing upload-worker tests still pass.

## Resolution (2026-09-12)

Asset GET routes, including percent-decoded route classification, now share the bounded upload/asset worker class rather than JSON workers. The reservation regression exhausts asset capacity while proving JSON/control capacity remains usable. Native worker-budget tests and the integrated asset round trip pass.
