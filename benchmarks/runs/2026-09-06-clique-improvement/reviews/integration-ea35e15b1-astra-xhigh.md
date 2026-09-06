CHANGES_REQUIRED — `ea35e15b1d37cd546a05ad13f687a41431559d6d`

The prior Astra cleanup hang is resolved in source: [client-upload.ts:96](/Users/ccheever/clique-improvement/reviews/integration-r2/snapback2/packages/snapback2/src/client-upload.ts:96) races the complete discard operation against abort, independently of fetch/body cooperation.

Two material gaps remain. Both reproductions below are static, not executed.

1. **P2 — Upload supersession still discards terminal bearer evidence.** The new expiry handler at [client.ts:326](/Users/ccheever/clique-improvement/reviews/integration-r2/snapback2/packages/snapback2/src/client.ts:326) cannot receive the terminal refusal when [fetchResponse:364](/Users/ccheever/clique-improvement/reviews/integration-r2/snapback2/packages/snapback2/src/client-upload.ts:364) rejects authority before parsing it.

   Repro: confirm bearer A; start `client.upload(file)` and withhold its response; begin a login that will fail; release an owner-shaped HTTP 401 `E_AUTH_SESSION`. The upload throws `E_AUTH_SUPERSEDED` before parsing the refusal. Login then fails and restores A’s authenticated snapshot; persisted A remains, and its offline partition is not sealed. The first automatic upload has the same path. Preserve captured-bearer terminal evidence before suppressing delivery, as the JSON mutation path does.

2. **P2 — The new upload expiry path leaves sibling drains blocked.** [drainNow:1212](/Users/ccheever/clique-improvement/reviews/integration-r2/snapback2/packages/snapback2/src/client.ts:1212) registers cancellation controllers, but [expireSession:1316](/Users/ccheever/clique-improvement/reviews/integration-r2/snapback2/packages/snapback2/src/client.ts:1316) never cancels them.

   Repro: after startup completes, start an online mutation and withhold its replay response or log-tail fetch. Concurrently let a direct upload receive HTTP 401 `E_AUTH_SESSION`. The new handler clears custody and seals the partition, but the mutation’s signal remains un-aborted. Its promise and `outbox.settled()` remain blocked on the obsolete transport. Terminal expiry must release sibling drains while preserving durable intents and the originating terminal evidence.

The added tests check meaningful invariants: completion while transport remains withheld, identical replay envelopes, one owner execution, and unchanged state after late responses. However, upload-401 cases omit supersession, and drain interruptions omit terminal expiry.

No additional material cursor/certificate interaction found in the inspected paths. No edits, tests, network, credentials, or other review reports accessed. This is source review; no final package, measure, or full-script green claimed.