# Snapback 4: sync-generation client tests — precision follow-ups

**Status:** Open
**Date:** 2026-09-22
**Scope:** `packages/snapback4/test/sync-generation.test.mjs` only. These are test-precision items; there is no known product defect.
**Source:** Grok 4.7 xhigh round-3 delta review of `672a642495` (landed with the sync-generation series). In the same round, Astra xhigh found the fixes READY with no findings. Grok judged the product code correct, including the server's fail-closed head read and the client's finite, nonnegative head guard before `observe_store`. Its one docs finding (the card stated the order of the steps but not the adoption gate) was fixed at landing.

1. **Near-miss refusals built from the captured bytes.** Derive each negative body from `legacyBytes` with one field changed: message, an extra field, family, code. Send it with status 400 and `content-type: application/json`, and assert which edits must not retry.
2. **Non-2xx stripped retries with JSON bodies.** `Response.json({ denied: … }, { status })` for 401, 408, 429 and 503, so a parse failure cannot stand in for the latch rule.
3. **Content types on raw-byte responses.** Set `content-type: application/json` wherever `new Response(bytes)` stands in for a server reply. Keep one anchor to the published 0.2.32 capture that is not a hash of the checked-in file itself.
4. **Absolute URL without a page base.** It is origin-keyed. Only relative and protocol-relative URLs fall back to raw-string keys.
5. **Server near-miss inputs.** Change one field of a valid `/sync` request per case, replay the real status and headers with `response.clone()`, and assert pairwise which bodies are equal.
6. **Early-versus-ordinary identity test.**
   - Assert one fetch on the ordinary path and two on the early path.
   - Give the follow-up page a different sentinel head, and assert that adoption observed the early head.
   - Assert the watermark actually moved past the retained evidence in the missing-watermark recovery.
7. **Invalid-head test.**
   - Use JSON content types.
   - Assert the retryable offline denial per head.
   - Cover the staged-snapshot evidence path too.
8. **Server unreadable-head test** (`tests/serve_sync/mod.rs`).
   - Drop the assertion that the 503 `E_STORE` message contains SQLite's
     `no such table: _commits`.
   - Assert the matched-generation reply as strictly as the mismatched one:
     `retryable: true`, top-level keys exactly `["denied"]`, and no
     `watermark`.
   - Separately, consider whether store-driver text should reach a client in
     `E_STORE` messages at all. That predates this change.
9. **Receipt assertions.** Use `as_u64().unwrap()` on both sides of the
   `seq` and acknowledgement comparisons, so two missing keys (`Null ==
   Null`) cannot pass.
