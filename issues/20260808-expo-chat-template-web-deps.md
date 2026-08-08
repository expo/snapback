# expo-chat template: web platform and deps missing

**Status:** Open
**Impact:** 3
**Urgency:** 3
**Ease:** 5
**Confidence:** 5
**Systems:** Templates, Expo client
**Date:** 2026-08-08
**Related:** Diary 0069 (run 5, 0.1.15)

Both web lanes in two consecutive measurement runs paid their longest
single loop to the same gap: the expo-chat template ships
`platforms: ["ios","android"]` and omits `react-dom`, `react-native-web`,
and `@expo/metro-runtime`, so `expo start --web` fails until the author
adds all four. The guide advertises the web carrier as paved. Add the
platform and deps to the template (the react template presumably has
them — copy its shape). Acceptance: a scaffolded expo-chat app serves
Expo web with zero edits.
