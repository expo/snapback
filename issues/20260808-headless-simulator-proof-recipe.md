# guide: collect the headless-simulator proof recipe in one place

**Status:** Open
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
