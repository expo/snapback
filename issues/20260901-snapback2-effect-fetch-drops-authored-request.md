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
