# A1 Expo sweep: offline queue can never engage on the Expo carrier — connectivity classification requires `instanceof TypeError`, Expo fetch rejects plain Error

**Opened:** 2026-08-01
**Systems:** Client integration, Offline sync, React/Expo
**Related:** LLP 0137 (Track B A1 Expo iOS arm), LLP 0043 (M2 queue), demos/improvement-sweep/arms/a1-snapback-expo-ios/findings/0137-a1expo-f2-offline-queue-cannot-engage-on-expo-fetch-error-class.json

With `offlineQueue: true`, an offline mutate on the Expo simulator surfaces
the raw transport error (`fetch failed: UnexpectedException: Could not
connect to the server. (at ExpoModulesCore/Promise.swift:56)`, name `Error`)
instead of queueing. `isConnectivityFailureError` (index.mjs) requires
`error instanceof TypeError`; Expo's fetch rejects connection failures with a
plain `Error`, so the M2 queue path never engages on this carrier. Node
control with identical options and an explicit memory store against the same
stopped server queues `{queued:true, sequence:1}` — the error-class check is
the whole story.

Fix shape: classify connectivity by transport provenance (no HTTP status, no
diagnostic, no receipt) independent of the error constructor, or normalize
carrier fetch rejections in the shared transport; keep the fail-closed rule
that server-answered refusals never queue. Conformance test with an
Expo-fetch-shaped Error.

Witness: offline mutate on an Expo simulator returns
`{queued:true, clientMutationId, sequence}` and replays exactly once.

## Resolution (2026-08-01)

RESOLVED — `packages/snapback-client/index.mjs`. Root cause exactly as filed:
`isConnectivityFailureError` required `error instanceof TypeError`, but only
WHATWG-conformant runtimes (undici/browsers) reject the fetch dispatch with a
TypeError; Expo/RN fetch rejects with a plain `Error`, so the M2 queue could
never engage on that carrier.

Fix — classify by transport provenance, not constructor identity:

- `sanitizeTransportError` now stamps `fetchDispatchFailed: true` exactly at
  the one boundary where the fetch dispatch itself rejected (no Response was
  produced, so no HTTP status / server diagnostic / receipt can exist). The
  body-read failure path after an answered response is deliberately NOT
  stamped.
- `isConnectivityFailureError` accepts the provenance stamp OR the legacy
  TypeError shape, still requires status/diagnostic/receipt to be absent
  (fail-closed: server-answered refusals never queue), and now explicitly
  excludes caller-owned `AbortError`/`TimeoutError` rejections so the wider
  provenance arm cannot queue an intentional abort.

Genuine programming errors are NOT swallowed: only rejections of the actual
dispatch get the stamp, so a plain-Error/TypeError thrown by response
handling or app code keeps failing loud.

Regression tests (Expo-shaped plain-Error rejection proven-to-fail pre-fix)
in `packages/snapback-client/outbox-store.test.mjs`: queue engagement +
exactly-once replay under the witnessed Expo rejection string, and the
guards (AbortError never queues; server-answered refusal never queues).
Docs: guide/sync/offline-and-retention.md prose; LLP 0043 dated Revised note.

Witness satisfied (node projection of the carrier shape): offline mutate
under an Expo-shaped rejection returns `{queued:true, clientMutationId,
sequence}` and replays exactly once.
