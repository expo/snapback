**CHANGES_REQUIRED — `9b0c74269a34dc2b9ea2023d77fe748486869c1e`**

**P2 — Uncached `assetBlob()` still has an unfenced asynchronous byte read.** The new check at [client-upload.ts:215](/Users/ccheever/clique-improvement/reviews/integration-r3/snapback2/packages/snapback2/src/client-upload.ts:215) validates authority after `response.blob()`. But its actual caller then awaits `blob.arrayBuffer()` at [client-assets.ts:71](/Users/ccheever/clique-improvement/reviews/integration-r3/snapback2/packages/snapback2/src/client-assets.ts:71). Without a cache, `cachedAssetBytes()` returns that network callback directly, bypassing its subsequent `current()` checks.

Concrete static counterexample, not executed:

1. Start authenticated A’s `assetBlob()` without an offline cache.
2. Let `response.blob()` finish; withhold the returned Blob’s `arrayBuffer()` conversion.
3. Complete login as B.
4. Release the conversion.

The old request returns A’s private bytes after B’s custody is installed. Aborting during that conversion likewise escapes the new signal check. The added test withholds `response.blob()`, so it misses this second read. Check authority and cancellation after the complete conversion, before public delivery.

The other claimed repairs hold up in the inspected source: fetch/native-fetch/XHR upload refusals retain captured terminal evidence; malformed upload bodies check authority; named JSON options preserve `onSend` immediately before dispatch; expiry cancels sibling drains while excluding the originating HTTP-401 signal; and terminal propagation bypasses the sealed outbox read. Bounded cleanup ordering remains intact. I found no additional material deadlock, successor-custody clearing, or durable-intent loss in those cancellation paths.

Read only the scoped snapshot, relevant contracts/callers/tests, and `prior-astra.md`. No edits, tests, network, credentials, benchmark app, or other review reports accessed. Reported validation was not independently executed.