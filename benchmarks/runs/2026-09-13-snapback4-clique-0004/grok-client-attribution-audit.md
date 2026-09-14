# Grok client attribution audit

- Audit date: 2026-09-13
- Product source inspected: published `snapback4@0.2.6` at qualified commit `342c53d306d7484cd64e820ee27a151e02eb4b0b`
- Delivery working-tree HEAD at audit: `b86defee4f695640b385c4c5a651cd514e15d50d`; every product file cited below is blob-identical between that revision and the qualified product commit
- Builder snapshot: `/Users/ccheever/clique-sb4-20260913-full-3models/snapshots/grok-continuous`
- Scope: read-only attribution audit; no build, runtime reproduction, product issue, or independent assertion grade

The received claims are preserved in `final-report.md` (SHA-256 `0958642941e6aa2bc0afd450a6a435fc4b1fdb21de34de815a522462ccfaee3e`) and `essay.md` (SHA-256 `7b9af191b8444ab58cf90292019cdd608b5bcf44c5f29a1791c9b304d3f0fae9`). The report labels the missing React mutation payload `snapback4-defect (API shape)` (`final-report.md:57,62,128`) and the Hermes failure `environment / platform gap` (`final-report.md:61,78-84,131`); the essay develops those claims at lines 19 and 23. Those are builder attributions. The dispositions below are the auditor's source-backed interpretation and do not alter benchmark grading.

## Mutation result on `useMutation().run()`

**Disposition: documented Snapback 4 API limitation and real capability gap; not an implementation violation of the published 0.2.6 contract.**

The builder's factual claim is correct. The public `Write` union carries only pending identity, sent sequence, or failure (`snapback4/packages/snapback4/src/contract.ts:38-42`), and `Client.mutate<A, R>` returns `Promise<Write>` without using `R` (`contract.ts:47-57,89-94`). `useMutation().run()` simply returns that `Write` (`snapback4/packages/snapback4/src/react.tsx:158-217`). The README publishes exactly this surface (`snapback4/packages/snapback4/README.md:704-715,741-750`).

The server does produce the authoritative mutation value in its HTTP response (`snapback4/crates/snapback4/src/serve.rs:855-858`), but the JavaScript clients reduce successful responses to `{ state, id, seq }` (`snapback4/packages/snapback4/src/client.ts:288-308`; `src/local.ts:700-735`). Therefore a mutation such as `createDm` that may reuse an existing authoritative id cannot return that choice through the first-party client, despite the generated `Mutation<A, R>` knowing its result type. Querying `dmByPair` is a conforming workaround.

Grok's `API shape` qualifier is material: the behavior matches the documented contract, so it is not a 0.2.6 regression or a result-dropping implementation bug relative to that contract. It is still a Snapback client capability gap relative to the server and this application need. No new issue was opened in this audit.

## iOS Hermes export

**Disposition: observed failure is real, but the evidence points to the builder app's mismatched Expo/Babel/RN toolchain rather than Snapback; the builder's generic platform-gap label is too broad.**

The retained public CLI stream `/Users/ccheever/clique-sb4-20260913-full-3models/logs/grok-snapback4.ndjson` (SHA-256 `dcda8fba530e5b4a4d95678d3b50d0dc844fc56f2e8fa0409ecf630be2feba1a`) records two `expo export --platform ios` calls at NDJSON lines 4927 and 14635. Both reach Hermes and fail compiling the Expo Router entry bundle with `private properties are not supported` for `#x`, `#y`, `#width`, and `#height`; the M1 bundle had 991 modules and the M8 bundle 994. The fields exactly match React Native 0.81.5's `node_modules/react-native/src/private/webapis/geometry/DOMRectReadOnly.js:37-41,53-125`, rather than Snapback source. The output directories contain copied assets but no reported `.hbc` bundle or export metadata, consistent with `final-report.md:80-83`.

The app pins Expo `54.0.37` and React Native `0.81.5`, but also explicitly pins `babel-preset-expo` `^57.0.11` and selects it in `babel.config.js` (`/Users/ccheever/clique-sb4-20260913-full-3models/lanes/grok-snapback4/package.json:18-38`; `babel.config.js:1-4`). Its lockfile contains both the selected top-level preset 57.0.11 and Expo 54's compatible nested preset 54.0.12. Preset 57 defaults Hermes to the `hermes-stable`/Hermes-v1 profile and documents that profile as SDK 56+ (`node_modules/babel-preset-expo/build/index.js:54-99`; `build/configs/hermes-v1.js:9-34`); the legacy Hermes-v0 profile contains the private-field transforms (`build/configs/hermes-v0.js:5-29`). The failed generated bundle retaining those fields is consistent with that version mismatch.

The app's imports do not independently implicate Snapback: `snapback4/web` is dynamically imported only on web, while native conditionally requires `snapback4-expo` (`lanes/grok-snapback4/lib/client.tsx:21-53`). Astra produced seven valid iOS Hermes exports with the same `snapback4@0.2.6` and `snapback4-expo@0.2.1` pins, recorded in these logs:

- `evidence/m1-ios-final.log` — SHA-256 `93d5c248ecebc8c4e66d6841d8f84f51640ec7f45aaf13a4cf05081849a1f8b0`
- `evidence/m2-ios-final2.log` — SHA-256 `80d30ca5ce675ebac1d013a339a5befc18ce87e2adbd509f94e38a873e5b1a93`
- `evidence/m3-ios-final2.log` — SHA-256 `a574a15511fdbaa54e8b4baad9637a402bbaa233e196237faf89ae25ede0462b`
- `evidence/m4-ios-final.log` — SHA-256 `e2f8879ac0c70479c9aae3b2f091ab1e9e05b3bac1b3b66870c338fb3cc118ab`
- `evidence/m5-ios-export.log` — SHA-256 `ca8b07090a75ec24e011693ab1329b6b8a3dc083c49f78091cc601bf6bd8ffde`
- `evidence/m6-ios-export.log` — SHA-256 `dcd1f159fb8784f16bbe59906afffc038439d57e8d6761aa38a88a09abaafed2`
- `evidence/m8-ios-export.log` — SHA-256 `45ddd988b33b086a7a1609688b1d8b21e852c6544b7616adf94b2ec69fa9da18`

Those Astra paths are under `/Users/ccheever/clique-sb4-20260913-full-3models/lanes/astra-snapback4/`. Astra used Expo 57.0.22 and React Native 0.86.3, so it is not a like-for-like Expo environment control; it does show the Snapback package pins are not sufficient to cause the failure. Static evidence makes application/toolchain mismatch the most specific attribution. Whether changing only Grok's preset to Expo 54's version is sufficient remains unverified because this audit intentionally did not rebuild the app.
