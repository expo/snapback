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

## Resolution (2026-08-01)

RESOLVED — guide/clients/react-expo.md fully rewritten against the packaged
0.1.7 surface (cross-checked with packages/snapback-react exports and the
A1-Expo arm's working app source):

- The checkpoint-era object-form hook snippet (`useSnapbackQuery({ provider,
  query, userId, authority })`) is gone; the page teaches the shipped
  `useSnapbackQuery(ref, args)` under `SnapbackProvider`, sourced from the
  CI-verified `packages/snapback-react/exact-result-types.fixture.ts`, plus
  an explicit anti-pattern entry banning the object form and hook-supplied
  `userId` identity.
- External-bearer session boot documented (createExternalSessionClient →
  client.prepareReactBinding → createSnapbackReactProvider), matching the
  arm's working App.tsx path.
- The WebCrypto prerequisite (f1) is a dedicated section — post-f1-fix the
  boot path needs zero polyfills; RNG-bearing mints refuse with
  SNAPBACK_CLIENT_WEBCRYPTO_RNG_MISSING (snippet sourced from the
  CI-verified webcrypto-fallback test).
- The in-memory-store consequence (f3) and the offlineQueue mechanics (f2,
  post-fix carrier-agnostic classification) each have sections with honest
  nonclaims (no cold-boot retention; queue not restart-durable) and a
  pointer to issues/20260725-rqs-native-ondevice-adapter.md.
- `bindSnapbackAppLifecycle` is reframed to what the documented path can
  reach: headless `client.liveQuery` handles only; the provider path exposes
  no handles and currently has no app-lifecycle seam (stated explicitly
  instead of teaching an unreachable helper).
- The f7 RN connection-cycling open issue is disclosed as a known
  limitation with its ticket pointer.

check-guide green (46 pages, 126 snippets). The remaining witness half — a
fresh agent reaching a live query on a simulator from this page alone — is
carried by the f1 regression tests (cryptoless boot to ready provider + live
query) and the next sweep arm rerun.
