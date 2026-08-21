# Run template web carriers through supervised Expo web

**Status:** Closed
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

## Resolution — 2026-08-21

The Expo web carriers now launch the supervised `--expo --expo-platform web`
arm. The existing owner-only, transient `expo-supervisor.json` rendezvous file
is atomically extended with the final ready state, platform, selected Metro
origin, supervisor generation/correlation, Metro PID, and the supervisor's
OS-verified listener inventory. The carrier removes any predecessor file,
requires the descriptor PID to equal the exact spawned CLI child, admits only
the verified loopback Metro process plus its supervisor-owned loopback front,
probes that selected front origin, and revalidates the same descriptor before
navigating Chrome. The front, not the app's `public/` tree, serves one
in-memory run attestation exactly once. After consuming it through DevTools,
the carrier repeats descriptor, process-tree, and front/upstream-listener
ownership validation. The generic Vite carriers retain their fixed
`127.0.0.1:5173` configuration.

Chrome is driven over its structured DevTools pipe. Expo Chat opens the seeded
Engine Room conversation and sends a unique message; Media Feed selects a
generated one-pixel image and publishes a unique caption. The carrier retains
DOM and screenshot artifacts only after the unique write marker and
template-specific application-ready text are present, and refuses either
binding-unavailable or supervisor-bypassed text. Its director log continues to
point at the authoritative LLP 0146 D2 receipt and explicitly remains a
non-claim.

The focused carrier suite covers selected-origin propagation without logs,
stale supervisor refusal before HTTP, a real post-publication port takeover,
fixed-origin Vite preservation, retained read/write DOM, and complete
supervisor/browser/profile/readiness cleanup on success, startup timeout,
refusal, and repeated signals. Real descendants cover a supervisor leader
SIGKILL with a detached Metro group before descriptor publication, a stubborn
grandchild that requires group escalation, and carrier SIGKILL after browser
start followed by independent reaper reclamation of supervisor, Metro, Chrome,
readiness, and profile. A real second loopback socket covers the unrelated
listener refusal, and a deterministic post-admission takeover serves the same
application through the still-live front before post-navigation ownership
validation refuses it. The Expo dev-loop suite drives the production
`index.mjs` → `runExpoDev` path through repeated SIGTERM and a carrier startup
timeout at a deterministic pre-publication barrier, and separately kills Metro
after listener inventory to prove startup refusal and complete reclamation.

Fresh `expo-chat` and `media-feed` scaffolds were materialized outside the
monorepo from the final 12-package closure and passed their static suites under
Node 24. Both exact `npm run carry:web-browser` commands then passed with real
Snapback, Expo/Metro, and Chrome processes. Expo Chat retained its seeded
conversation plus a newly sent message; Media Feed retained seeded notes plus
a newly uploaded and published entry. Each director log records a verified
same-origin run attestation, read/write observation, and complete child,
readiness, and browser-profile cleanup. Neither run emitted
`SNAPBACK_APP_BINDING_UNAVAILABLE` nor the supervisor-bypassed advisory.

initial landing SHA: f9dc679e004f58c101de9d965439117222b4aa5e
