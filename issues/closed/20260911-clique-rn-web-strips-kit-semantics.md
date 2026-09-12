# Clique / RN Web drops frozen-kit `accessibilityValue`, selected state, and image URI

**Status:** Closed
**Priority:** P2
**Date:** 2026-09-11
**Systems:** Clique frozen UI kit, React Native Web, choreography selectors
**Related:** Clique Linux lanes on `snapback2@0.0.24` and `0.0.25` (web-only; no simulator)

## Symptom

React Native Web does not surface several kit props the frozen choreography reads:

- `accessibilityValue` (feeds, avatars, repost identity) — builders mirrored into `aria-valuetext`.
- `accessibilityState.selected` / pressed on kit button roles (chat color/background) — mirrored into `aria-selected` / `aria-pressed`.
- Image URI on nested kit nodes (background, video poster) — mirrored into an observable semantic attribute; video attachments also needed a real first-frame thumbnail on web.

Both independent Astra lanes hit this at M2 and M5. The product UI was often already correct (checkmark visible, color applied); the harness was blind. Builders patched copied kit files or added app-owned DOM bindings. That is not a Snapback engine bug, but it dominates web choreo reds on Linux Clique.

## Evidence

- 0.0.24 run-log epochs `1789163390`, `1789163629`, `1789165931`.
- 0.0.25 run-log epochs `1789164090`, `1789167392`, `1789167725`.
- Frozen kit under the instrument `ui/` (commit `f40559f37722c79178be664a11f8a6485f1508fd`).

## Requested outcome and acceptance

- Kit web mappings emit the ARIA the choreography already queries, **or** the choreography reads RN Web’s actual DOM for those states.
- Video-on-web either documents “poster required” in the kit README or generates a poster in the kit.
- Acceptance: M2 follow/feed and M5 color/background/view-once choreography pass on Chromium without an app-level `aria-*` shim and without editing harness selectors mid-run. A focused Playwright spec against the kit on RN Web is enough; a full Clique rerun is better but not required to land.

## Resolution

UI kit `0.3.3-m8` preserves the existing native accessibility props and mirrors
their public values into literal React Native Web ARIA. Contracted rendered
image nodes repeat their existing source URI as `data-source-uri`; choreography
`0.3.8-m8` includes that attribute in observable state and verifies its image
bytes when RN Web renders no `img` descendant. The kit README now requires
`FeedCard.videoPosterUri` for web video cards and a poster or thumbnail through
`MessageBubble.mediaUri` for web video messages. Composer video attachments
retain the picked asset in `uri`, require a still-image `posterUri`, and render
only that poster through the kit's `Image`.

The focused Playwright consumer bundles the public kit against
`react-native-web` and exercises live M2 feed tabs, follow state, actor/media
identity, and like/repost state plus M5 color, background, disappearing, and
view-once state in headless Chromium. It also selects the canonical committed
MP4 through the permitted app-shell file input, observes the kit's poster
preview, and publishes through `Composer`. The consumer supplies ordinary kit
props and no app-owned ARIA or DOM shim. This is focused app-UI contract
evidence, not a full Clique backend or product end-to-end rerun.

The coordinated freeze advances the instrument to
`social-messenger@0.3.8-m8`, retains the authentic `0.3.7-m8` manifest and full
setup tuple as historical fixtures, and subjects both submitted records and
hash-bound bases to the shared complete campaign-identity comparison. A
coordinated downgrade from the current physical freeze therefore cannot select
retained validation.

Verified on 2026-09-11 with UI tests and typecheck (including the RN-Web
Chromium consumer), choreography self-test and startup tests, the 143-test
metering/materialization/semantic-validation suite followed by the focused
final retained/current identity proof against the canonical `0.3.7-m8`
release, 12 lane setup/snapshot tests, three observability tests, and
`./ref-check --verbose`. Repository-wide
`check-inventories` still reports inherited script registration and generated
guide/diagnostic drift unrelated to this change.
