# expo-chat template: missing expo-crypto and upload UI shipped in dev mode

**Status:** Open
**Impact:** 4
**Urgency:** 3
**Ease:** 4
**Confidence:** 5
**Systems:** Templates, Expo client, Offline, Assets
**Date:** 2026-08-07
**Related:** Diary 0068 (four-lane measurement, 0.1.13)

Two gaps in the flagship messaging template, both hit by measurement lanes:

1. **`expo-crypto` is not in the template's dependencies**, though the guide
   requires it for `registerExpoFileSystemRqsFiles` — so the headline
   offline-retention capability silently stays in-memory for anyone who
   doesn't read the guide page (typecheck catches it only once the
   registration is added). Add the dependency and the registration call to
   the template itself.
2. **The template ships upload UI while defaulting to dev mode**, where
   app-side uploads cannot work (sessions custody required) — embedding the
   exact contradiction the authoring skill's step 6 warns about. Either the
   template defaults to sessions mode, or its upload UI is fenced behind a
   clearly-marked mode flip with the skill's warning inline.

Acceptance: a scaffolded expo-chat app reaches offline retained render and
an in-app upload with zero dependency or mode edits, or the template
comments state the required step at the exact point of use.

- **Claimed 2026-08-08:** session 86767887 (the diary-0068 orchestrator) is executing this ticket now; sibling sessions should not duplicate.
