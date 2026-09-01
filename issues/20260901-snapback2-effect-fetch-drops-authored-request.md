# snapback2: effect fetch drops authored request headers

**Status:** Open
**Systems:** snapback2, effects, fetch
**Severity:** P1
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/crates/snapback2-effects/src/prelude/fetch.js:103-107

Failure scenario: an effect calls fetch(url, {method:"POST", headers:{"content-type":"application/json","idempotency-key":meta.id,"authorization":"Bearer token"}, body}). The provider receives the method/body but none of those headers, so authentication fails and retries lack the idempotency key that prevents duplicate provider actions.

Why it happens: invokeRaw extracts only method and body and calls the raw binding with url, method, body, and redirectMode. The outer prelude wrapper cannot restore discarded headers, and the integration provider tests do not record/assert request headers.

Suggested fix: extend the raw binding ABI to accept a normalized header list, implement Fetch-compatible header handling including credential stripping across cross-origin redirects, and assert content-type, authorization, and idempotency-key delivery in an engine test.

## Upstream handoff for expo/ibex

Snapback 2 is pinned to expo/ibex revision `174c94fb7eb06785d3b48ce9f92527b6f9636bd3`. At that revision, `crates/ibex2/src/boundary_abi.rs` function `run_async`, in its `AsyncOp::Fetch` arm, reads only arguments 0 through 3 (URL, method, body, redirect mode), builds `Request::get(&url)`, and never populates `request.headers`. The raw Hermes binding is variadic, but the Rust boundary silently ignores any fifth argument. The shipped `crates/ibex2/src/bindings/fetch.js` factory `makeFetch` also forwards `RequestInit` directly and has no complete request-header normalization contract.

The upstream change should extend the raw fetch ABI with request headers. One small fit with the existing implementation is a fifth numeric handle for the already engine-owned `Headers`: `run_async` should validate that handle through `RuntimeState::with_headers`, clone the value into `request.headers`, and reject an unknown handle. `bindings/fetch.js` should normalize every supported `HeadersInit` form into the engine's `Headers` object and pass its private handle. Ibex's Hermes engine tests should prove that ordinary authored headers reach the loopback transport and that invalid header handles are rejected rather than ignored.

After that upstream seam exists, Snapback's adapted `crates/snapback2-effects/src/prelude/fetch.js` can pass the header handle and enforce Fetch redirect rules while it follows redirects one hop at a time: remove body headers on a POST-to-GET rewrite and remove `authorization`, `proxy-authorization`, and `cookie` on a cross-origin hop. Those Snapback changes alone cannot deliver headers against the pinned ABI because argument 5 is currently discarded.

Snapback can defend the present boundary only by failing closed whenever an authored request contains headers, preventing an unauthenticated or non-idempotent wire request. That is a useful possible mitigation, but it does not implement the documented effect API (whose canonical example requires content type and idempotency headers), so it is not the fix and was not substituted for one here. This ticket remains open for an upstream Ibex change followed by the Snapback prelude and engine regression.
