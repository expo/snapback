# RN carrier bricked at origin/main: registration-ledger `toSorted` (ES2023) is not implemented by Hermes, and the react provider retries the failed subscribe with no backoff

**Opened:** 2026-08-03
**Systems:** Client integration, React/Expo, Realtime
**Related:** LLP 0155/0166 (registration ledger lineage), LLP 0137 (Track B
Expo arms), issues/20260801-0137-a1expo-f7-rn-connection-cycles.md (whose
simulator evidence rerun surfaced this)

Found during the 0137 f7 reconnect-loop evidence rerun (iOS simulator,
iPhone 17 Pro / iOS 26.3, Hermes, release build, `packages/snapback-client`
+ `packages/snapback-react` at origin/main `a4b3a3f4d` overlaid on the
installed 0.1.8 closure): **every `useSnapbackQuery` subscribe fails
instantly on the RN carrier**, so the provider never reaches `live` and no
live-stream manager survives long enough to open a socket. The on-device
stack (captured headless, same client machinery without React):

```
TypeError: undefined is not a function
    at recomputeScope (main.jsbundle:77027:60)
    at add (main.jsbundle:77136:21)
    at applyContextDemands (main.jsbundle:77230:29)
    at ?anon_2___registerActiveQueryDemand (main.jsbundle:62601:35)
```

`recomputeScope` is `packages/snapback-client/registration-ledger.mjs`, and
the undefined function is **`Array.prototype.toSorted`** (ES2023) — static
Hermes on RN 0.86 / iOS 26.3 does not implement it. Four call sites, all in
`registration-ledger.mjs` (~lines 236, 258, 315, 322). Nothing else in the
shipped client graph uses the ES2023 array methods (`structuredClone` is
used widely but exists on this carrier — execution reached `toSorted`
through two `clone()` calls).

**Secondary defect, same evidence:** on subscribe failure the react
provider retries immediately with no backoff — the connection witness
flipped `idle↔connecting` at millisecond cadence (21,828 distinct provider
state snapshots in ~3 minutes of run 1) and the retry storm starves the JS
thread (an unrelated in-app `expo-secure-store` write + director response
stalled past a 40s timeout in run 2). A subscribe that throws synchronously
should back off like a socket loss does (the stream manager's own reconnect
uses 250ms-base exponential backoff; the provider's registration-demand
path evidently does not).

Impact: the packaged React/Expo path (guide `clients/react-expo.md`, an
"Online surface, shipped" page) is entirely broken on-device at origin/main
— a regression against the 0.1.8 closure it replaces, which on the same
simulator the same day subscribed cleanly and held `live` through a 120s
idle hold (the f7 rerun's era-faithful arm). The
carrier-conformance gap is the familiar one: nothing in CI executes the
shipped client under an engine without the newest array intrinsics
(node 24 has `toSorted`, Hermes does not).

Fix shape: replace the four `toSorted` uses with a non-mutating sort over a
spread (`[...xs].sort(...)`) or a shared helper; add a provider backoff on
synchronous subscribe failure; and consider a CI lint (or an
`es2022`-targeted syntax/intrinsics check) over the shipped `.mjs` graph of
`@expo/snapback-client` + `@expo/snapback-react` so Hermes-absent
intrinsics cannot land again.

Witness: the f7 rerun app (A1 shape: provider + public `listSites` +
protected `listRecords`) reaches `live` on the iOS simulator against a
same-sha dev server, with zero `SNAPBACK_REACT_QUERY_FAILED` events.
Evidence: `demos/improvement-sweep/arms/a1-snapback-expo-ios/evidence/f7-rerun-20260803/`
(run 1 provider-thrash timeline, run 3 headless stack capture).
