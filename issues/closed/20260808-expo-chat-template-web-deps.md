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

## Addendum — 2026-08-08 (lane-0196-templates, landed separately)

A concurrent LLP 0196 lane hit one more package-level blocker the static
export surfaced: `@expo/snapback-expo`'s web AppState arm imported the
React Native package root, which Metro rejects as native-only on web.
The lane changed it to resolve React Native Web's AppState export
directly (with a DOM guard), landed with the T3 prove-command work.

Serving check completed 2026-08-08 (orchestrator, lane-0196 landing):
the full recurring harness — scaffold, codegen, static acceptance,
strict typecheck, static web export, and the live `expo start --web`
HTTP probe — passed end to end on a loopback-capable host. The probe
itself had a latent defect: `expo start --localhost` binds ::1 on
IPv6-first macOS hosts while the probe fetched 127.0.0.1, so it could
never succeed where loopback was allowed; fixed to probe `localhost`
with a configurable readiness budget.
