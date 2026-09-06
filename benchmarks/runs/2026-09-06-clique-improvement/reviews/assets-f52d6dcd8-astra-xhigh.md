**READY** — `f52d6dcd8` vs `f7d251394`. No material finding in the final delta.

- The [new catch](/Users/ccheever/clique-improvement/reviews/assets-r4/snapback2/packages/snapback2/src/client.ts:292) applies terminal auth evidence before propagating supersession. Replacement login waits for the tracked mutation, so old custody clears before login dispatch.
- [Serialized expiry](/Users/ccheever/clique-improvement/reviews/assets-r4/snapback2/packages/snapback2/src/client.ts:1258) checks token value and custody generation, preserving successful replacement custody.
- Current-authority results still retain their bearer through automatic discard; cleanup expiry preserves the settled rejection. [Existing tests](/Users/ccheever/clique-improvement/reviews/assets-r4/snapback2/packages/snapback2/tests/assets.test.ts:730) cover both cleanup outcomes.
- The [new regression cases](/Users/ccheever/clique-improvement/reviews/assets-r4/snapback2/packages/snapback2/tests/auth-ownership.test.ts:831) reproduce the status-listener trigger for failed and successful replacement and assert bearer, storage, and snapshot outcomes.

Static review only; no tests, edits, network, credentials, or other reviews accessed. The reported 134 JS passes are author-supplied evidence. The preceding revision’s full-script and measure passes do not establish broad execution of this final delta.