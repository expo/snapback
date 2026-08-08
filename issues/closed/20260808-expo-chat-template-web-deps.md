# expo-chat template: web platform and deps missing

**Status:** Closed
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

## Resolution

Fixed 2026-08-08. The `expo-chat` scaffold now declares `web` alongside iOS
and Android and carries the Expo 57-compatible `@expo/metro-runtime`,
`react-dom`, and `react-native-web` dependencies. The recurring template
harness mirrors that closure and now proves a generated scaffold both
typechecks and exports an `index.html` web bundle without editing the scaffold.
It materializes the local packages like a registry consumer rather than adding
a harness-only Metro config, then starts and HTTP-probes Expo web wherever the
test environment permits loopback listeners (restricted sandboxes report that
serve probe as an explicit skip). The CLI package test also pins the dependency
and platform contract.

Verified with:

- `bun install --frozen-lockfile`
- `bun install --frozen-lockfile --cwd tests/expo-chat-template-typecheck`
- `node scripts/check-expo-chat-template-typecheck.mjs`
- `node packages/snapback-cli/package.test.mjs`
