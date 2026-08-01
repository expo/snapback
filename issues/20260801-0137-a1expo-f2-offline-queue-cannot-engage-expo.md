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
