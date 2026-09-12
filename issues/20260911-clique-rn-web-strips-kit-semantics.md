# Clique / RN Web drops frozen-kit `accessibilityValue`, selected state, and image URI

**Status:** Open
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
