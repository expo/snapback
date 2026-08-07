# Supervised environment: no persisted-receipt fallback on cold boot

**Status:** Open
**Impact:** 3
**Urgency:** 3
**Ease:** 3
**Confidence:** 4
**Systems:** Expo client, Offline, Supervised dev loop
**Date:** 2026-08-07
**Related:** Diary 0066 (three-lane measurement, 0.1.12)

Cold boot with the backend stopped fails the supervised bootstrap
(`SNAPBACK_EXPO_BOOTSTRAP_UNAVAILABLE`) and the provider never falls back
to the documented `prepareReactBinding` persisted-receipt path — both
measurement lanes built app-level offline shells around the supervisor.
The receipt fallback exists and works (proven cold in both lanes); the
supervised provider just never takes it. Fix: on bootstrap-unavailable,
adopt the persisted receipt when one matches, surfacing the same honest
freshness facts.
