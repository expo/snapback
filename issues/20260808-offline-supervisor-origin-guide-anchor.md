# guide-gap: the offline cold-boot env coupling needs a guide anchor

**Status:** Open
**Impact:** 3
**Urgency:** 2
**Ease:** 4
**Confidence:** 4
**Systems:** Guide, Offline, Expo client
**Date:** 2026-08-08
**Related:** Diary 0069 (run 5, 0.1.15)

The bare lane (no skill) excavated EXPO_PUBLIC_SNAPBACK_SUPERVISOR_ORIGIN
from supervised-environment.mjs source to activate the cached-binding
cold-boot lane on bare Metro — third run where package source was the
only path to this recipe (skill trap 12 covers skill users). Put the
complete operational recipe (bundle must carry the env; bare-Metro
restart pattern; what the supervisor reclaims) on the react-expo page's
offline section with a snippet.
