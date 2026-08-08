# guide-gap: the offline cold-boot env coupling needs a guide anchor

**Status:** Closed
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

## Resolution

Fixed 2026-08-08. The React/Expo guide's existing supervised-offline section
now includes the literal supervisor-to-Metro environment injection and a full
warm/capture/stop/restart/cold-launch recipe. It explains that the origin must
be captured before shutdown, must be present when bare Metro builds the
bundle, and is public loopback routing rather than authority. It also names
the resources supervisor shutdown reclaims and the strict empty-cache,
expired-binding, and protected-read outcomes. Retrieval-eval case 25 preserves
the repeated bare-lane source excavation.

Verified with:

- `node packages/snapback-expo/supervised-offline-fallback.test.mjs`
- `node scripts/generate-guide-manifest.mjs`
- `node scripts/check-guide.mjs` (`64 pages`, `245 snippets`, `122 routes + 43 host-ops`; pass with 62 existing freshness warnings)
