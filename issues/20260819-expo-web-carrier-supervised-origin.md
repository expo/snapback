# Run template web carriers through supervised Expo web

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 3
**Confidence:** 5
**Systems:** Expo, CLI, Templates, Carrier kit, Verification
**Date:** 2026-08-19
**Governing:** LLP 0181 web browser, LLP 0196 T4, LLP 0294 W2

## Problem

The `expo-chat` and `media-feed` `web-browser` carrier configs run:

```sh
snapback dev snapback --client . --client-command "expo start --web --port 5173"
```

That is the generic client arm. It intentionally does not install
`EXPO_PUBLIC_SNAPBACK_SUPERVISOR_ORIGIN` or publish the supervised bootstrap
exchange. The CLI even emits `SNAPBACK_DEV_EXPO_SUPERVISOR_BYPASSED`, yet the
carrier proceeds and captures the app's
`SNAPBACK_APP_BINDING_UNAVAILABLE` boot-error screen.

The carrier kit currently requires a static absolute `origin`, while
supervised Expo web selects a free Metro port and reports it through structured
readiness. The first-party template command and first-party binding contract
therefore cannot compose.

## Required change

- Launch Expo templates through `snapback dev snapback --expo
  --expo-platform web`.
- Let the carrier consume the selected browser origin from a structured
  readiness event/file instead of requiring a static port.
- Bind HTTP readiness and browser navigation to the exact supervised child,
  not merely any listener occupying the port.
- Keep Vite/non-Expo web templates on their existing fixed-origin arm where
  appropriate.
- Preserve complete child/browser cleanup and the distinction between the D2
  verify receipt and non-authoritative carrier artifacts.

## Acceptance

- Fresh packed `expo-chat` and `media-feed` scaffolds pass
  `npm run carry:web-browser` outside the monorepo.
- The retained DOM contains application-ready UI and a real read/write journey;
  it contains neither `SNAPBACK_APP_BINDING_UNAVAILABLE` nor the supervisor-
  bypassed advisory.
- The selected origin may vary across runs and is obtained without log parsing.
- A stale/unrelated listener cannot satisfy readiness.
- Browser profile, Expo/Metro, backend, bootstrap exchange, and temporary
  artifacts follow their declared cleanup policy on success, refusal, timeout,
  and signal.
