**CHANGES_REQUIRED** — `2e671c5c6` against `a897055f8`.

The three prior reproductions are addressed. Outbox admission/prediction failures now clean up before persistence; ambiguous commits retain media; cleanup expiry preserves the settled rejection; receiving cancellation fences late writes. Two gaps remain:

1. **[P2] Wire custody starts before local serialization succeeds.**  
   [client-outbox.ts:84](/Users/ccheever/clique-improvement/reviews/assets-r2/snapback2/packages/snapback2/src/client-outbox.ts:84) marks custody before `JSON.stringify()`. With no outbox, submit a valid photo File alongside a non-serializable argument, such as a cyclic JSON object. Upload succeeds, serialization throws before any mutation request, and [client-upload.ts:134](/Users/ccheever/clique-improvement/reviews/assets-r2/snapback2/packages/snapback2/src/client-upload.ts:134) skips cleanup because custody is already `"wire"` and the error is a `TypeError`. Repeating this exhausts staging despite having no mutation or intent.

   Serialize before marking custody, and place the transport notification immediately before fetch, after local checks. Add coverage asserting no mutation request and zero residual staging usage.

2. **[P2] Failed finalizer cleanup leaves permanently active custody after the worker exits.**  
   [asset_http.rs:139](/Users/ccheever/clique-improvement/reviews/assets-r2/snapback2/crates/snapback2/src/asset_http.rs:139) skips `AssetUploadFailed` when staging deletion fails. After `finalize()` has transferred the file to the worker, reproduce by denying staging-directory deletion through worker teardown, then restoring permissions. The worker drops its file, but the registered custody retains `receiving: None, finished: false`.

   Subsequent disposal cannot retry deletion: [blob_store.rs:492](/Users/ccheever/clique-improvement/reviews/assets-r2/snapback2/crates/snapback2/src/blob_store.rs:492) has no file to clean and continues reporting unfinished custody. The [sweep filter:95](/Users/ccheever/clique-improvement/reviews/assets-r2/snapback2/crates/snapback2/src/writer_assets.rs:95) consequently excludes it forever. The charge remains until restart, even after permissions are repaired.

   Preserve failed cleanup ownership/path in a retryable state, distinguish it from a running finalizer, and release quota only after deletion succeeds. Cover worker exit followed by repaired permissions, disposal, and sweep.

**Optional observation:** The [finalizer regression:691](/Users/ccheever/clique-improvement/reviews/assets-r2/snapback2/crates/snapback2/src/writer_assets.rs:691) holds a staging file and manually completes custody. An additional interleaving after reservation and during blob publication would strengthen late-publication coverage.

Static review only: I executed no code or tests and accessed no network or credentials. The reported **66 JS / 53 Rust passes** remain supplied evidence. Only `prior-astra.md` was opened among prior reviews.