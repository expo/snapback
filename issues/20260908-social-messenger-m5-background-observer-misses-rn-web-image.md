# Social-messenger M5 background observer misses stock React Native Web image changes

Status: Open
Date: 2026-09-08
Scope: frozen choreography 0.3.6-m8 / UI kit 0.3.2-m8; next instrument revision

M5 observes the `sm-chatsettings-background-preview` root before checking
loaded image bytes. `observableState` reads root text and attributes only
(`choreography.mjs:770–788,2163–2178`). The stock `ChatSettingsForm` supplies
`backgroundUri` through React Native `Image.source` without a changing root
semantic value (`ChatSettingsForm.tsx:166–175`). On React Native Web, the
changing image URL can live on a descendant `img` and background-image node;
the test-ID root snapshot stays unchanged even when the new image is loaded.

The cold019 builder retained exactly that DOM shape: descendant image
`complete=true`, `naturalWidth=640`, root `src` and inline style absent.
Mirroring the real child URL as neutral root `data-value` made its focused
probe pass with loaded bytes. These observations do not independently grade
the app or establish full M5 success.

A separate read-only `/root/invalidation_audit` source review confirms the
stock-kit/observer mismatch. `CONTRACT.md:133–135` requires a synchronized rendered
image and observable change, but does not explicitly assign descendant-to-root
mirroring to app authors. The existing source-regex observability test omits
background-change coverage. The media loader already supports descendant
images; the earlier root-only change wait is what prevents it from running.

For the next version, expose the existing `backgroundUri` through the stock
preview’s neutral root semantic value, including the empty state. Verify
actual React Native Web URI A→B changes with the observer and loaded-image
check, clarify the contract, and bump the instrument version. A narrowly
scoped M5 observer of root/descendant media URLs is another coherent option.
Do not broaden every snapshot or alter the current frozen run.

[Bounded observation custody and source hashes](../benchmarks/runs/2026-09-08-release-cold-headroom/m5-background-observer.json).
