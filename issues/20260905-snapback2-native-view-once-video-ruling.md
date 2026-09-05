# Snapback 2: native view-once video needs a playback path (author ruling)

Status: Open (author ruling)
Filed: 2026-09-05 (LLP 1013 landing 9)
Related: LLP 1013 §2 decision 7 (amended), LLP 1012 §9, `rules/NOT-DOING.md`

## What the device said

Witness run 11 (Xcode 26.6, iPhone 17 simulator, expo-video 3 on SDK 54): AVPlayer refuses a
`data:video/mp4;base64,…` source outright — `Failed to load the player item: Cannot Open` — and
the attempt had consumed the viewer's one allowance for a view that showed nothing. The clip is
a valid H.264 mp4; the scheme is what the native player cannot open. In v1 native `AssetVideo`
refuses a view-once clip up front (`E_ASSET_TYPE`), consuming nothing; ordinary clips play from
their file URI; the web arm plays view-once video from an object URL of the admitted bytes.

## The paths (none free)

1. **A resource-loader native module** (`AVAssetResourceLoaderDelegate` behind a custom URL
   scheme, shipped as an Expo config plugin): bytes served from memory to AVPlayer. The only
   path that keeps "view-once never touches disk" with the native player. Native code in the
   package; Android needs its own (ExoPlayer `DataSource`). Recommended; size before
   commissioning.
2. **A WebView** (`react-native-webview`) playing the data URI in an HTML5 video element: a new
   dependency, a second renderer, and WKWebView's own cache to police with the same no-store
   discipline; playback controls diverge from `AssetVideo`.
3. **A temp file** under the app's cache, deleted when playback ends or the app backgrounds:
   breaks the spec's hard rule (the LLP 1013 design panel named it a trap); a kill mid-play
   leaves the clip on disk until the sweep.

## Also recorded here

An admission that hands bytes to a renderer which then fails to decode still counts as viewed
on the web arm (durable admission on the play request; fail-closed). Native cannot reach that
state in v1 (the refusal is before admission). Revisit with the ruling.
