# guide: collect the headless-simulator proof recipe in one place

**Status:** Closed
**Impact:** 2
**Urgency:** 2
**Ease:** 3
**Confidence:** 4
**Systems:** Guide, Expo client, Testing
**Date:** 2026-08-08
**Related:** Diary 0069 (run 5, 0.1.15)

Two native-carrier lanes assembled the same tricks independently:
deep-link scheme pre-approval (the guide's plutil recipe FAILS on the
dotted key — plutil treats it as a key path; Python plistlib works —
fix the recipe), Expo Go first-run onboarding dismissal
(`simctl spawn ... defaults write host.exp.Exponent
EXDevMenuIsOnboardingFinished -bool YES`), headless simctl boot/install/
launch/screenshot, and a deep-link drive channel pattern for tap-less
interaction. One guide section (react-expo page or a testing page)
collecting these saves ~10 min per native proof run. Include the iOS
26.3 simulator emoji-tofu note (26.5 renders correctly) as environment
trivia worth one line.

## Resolution

Fixed 2026-08-08. `guide/clients/react-expo.md` now collects the complete
headless simulator proof in one section: literal dotted-key scheme approval
through an atomic `plistlib` update while shut down; `simctl` boot, install,
launch, and screenshot; Expo Go's first-run defaults key; and a closed
deep-link drive-channel pattern that must invoke ordinary app actions and pair
delivery with an independent witness. The broken `plutil` recipe is removed.
The section also records the iOS 26.3 astral-emoji/CoreText tofu defect and the
26.5-good comparison. Retrieval-eval case 26 preserves the duplicated setup
miss.

Verified with:

- isolated `plistlib` smoke test proving the full dotted approval key remains one dictionary key
- `node scripts/generate-guide-manifest.mjs`
- `node scripts/check-guide.mjs` (`64 pages`, `245 snippets`, `122 routes + 43 host-ops`; pass with 62 existing freshness warnings)
