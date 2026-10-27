# snapback4: a discarded SQLite local hit can leave its head on a later error

Opened 2026-10-27 from the SQW delta review (grok, LOW).

In `crates/snapback4/src/serve.rs` the query callback stores
`metadata = Some(Ok((store_id, head)))` whenever the authority check passes.
The SQLite local tier (`engine/revision_cache.rs`, `sqlite-local-hits`) runs that
callback, then may discard the attempt when the revision moved. If the ordinary
path then fails before invoking the callback with a non-generation error,
`serve_head::query_response_head` returns the stale `Ok` metadata, so the error
response carries the abandoned snapshot's head instead of an uncertified one.
`E_GENERATION` still retries correctly.

Impact: error responses only, after a commit race; the head is a real certified
head from slightly earlier. Fix: let the cache signal a discarded attempt so the
caller clears `metadata`, or have the ordinary path reset it before validation.
