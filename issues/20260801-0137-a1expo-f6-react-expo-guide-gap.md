# A1 Expo sweep guide-gap: clients/react-expo.md teaches a hook API that does not exist on packaged 0.1.7 and a lifecycle helper the documented path cannot reach

**Opened:** 2026-08-01
**Systems:** Documentation, React/Expo
**Related:** LLP 0137 (Track B A1 Expo iOS arm), LLP 0061, guide/clients/react-expo.md, demos/improvement-sweep/arms/a1-snapback-expo-ios/findings/0137-a1expo-f6-react-expo-guide-page-stale-api-guide-gap.json

The page's only hook snippet is the checkpoint-era object form
`useSnapbackQuery({ provider, query, userId, authority })` — not the shipped
`useSnapbackQuery(ref, args)` under `SnapbackProvider` — and its `userId`
field teaches dev-mode client-asserted identity. The page also points RN
consumers at `bindSnapbackAppLifecycle(AppState, liveHandle)` "when a
provider exposes the first-party liveQuery handle", but the React provider
path it prescribes never exposes such a handle. Missing entirely: the
WebCrypto prerequisite (f1), the in-memory store consequence (f3), the
offlineQueue nonclaim mechanics (f2).

Fix shape: rewrite against the packaged 0.1.7 surface with CI-verified
snippets (context provider + (ref,args) hook, external-bearer session boot,
crypto prerequisite, store/queue nonclaims); expose a lifecycle seam on the
React provider or drop the unreachable helper reference.

Witness: check-guide compiles the page's snippets against the packaged
closure; a fresh agent following only this page reaches a live query on an
Expo simulator.
