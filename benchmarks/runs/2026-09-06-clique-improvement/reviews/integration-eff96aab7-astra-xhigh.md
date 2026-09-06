CHANGES_REQUIRED

**Automatic upload cleanup can indefinitely block auth replacement and terminal expiry.** At [client-upload.ts:96](/Users/ccheever/clique-improvement/reviews/integration/snapback2/packages/snapback2/src/client-upload.ts:96), the two-second timer aborts a signal, but the cleanup promise is awaited directly.

Static repro, not executed: an automatic upload succeeds; mutation returns a valid `E_AUTH_SESSION` rejection; `/api/uploads/discard` fetch or body parsing remains pending and ignores abort; then login/logout begins. After two seconds, cleanup still blocks the tracked mutation. The auth transition waits in [client.ts:1273](/Users/ccheever/clique-improvement/reviews/integration/snapback2/packages/snapback2/src/client.ts:1273), and captured-token expiry at [client.ts:307](/Users/ccheever/clique-improvement/reviews/integration/snapback2/packages/snapback2/src/client.ts:307) is never reached. Known-invalid custody persists.

Fix direction: wrap the entire discard operation with the existing `withAbort` helper so timeout releases cleanup independently of transport cooperation. Preserve the original mutation outcome and the checks that suppress late cleanup responses.

Within the supplied comparisons, no dropped edits found: combining auth and assets changes reproduces integrated `client.ts` exactly; all 147 final blobs in `change.patch` match their recorded hashes. No additional material interaction found in positional JSON/custody callbacks, recovery-drain cancellation, or certificate/page/cursor handling.

Optional coverage: persist a conditional-page certificate, cold-reopen, interrupt auth recovery, then verify twin continuation and the resumed tail.

No tests run, edits made, network/credentials accessed, or other reviews read. No integrated-suite pass claimed.