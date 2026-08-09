# guide-gap: supervised Expo web launcher and generic client-arm boundary are not discoverable

**Status:** Open
**Opened:** 2026-08-09 · **Severity:** P2 · **Area:** CLI / Expo / Guide / diagnostics
**Related:** LLP 0181, `guide/clients/react-expo.md`,
`issues/closed/20260807-supervised-expo-web-carrier-unpaved.md`

## Incident

An agent was asked to run an external Expo/Snapback application on web. The
application's normal script was `snapback dev snapback --expo`, but that path
selected an iOS simulator and `snapback dev --help` exposed
`--expo-platform ios|android`, with no web value. The agent therefore switched
to the apparently plausible generic arm:

```sh
snapback dev snapback --client . --client-command "expo start --web"
```

That command started a healthy backend and Expo web server, but it did not
establish the supervised Expo environment. The distinction is real in the CLI:
the generic `startClientArm` passes the caller environment through unchanged,
while `startMetro` in the Expo supervisor installs
`EXPO_PUBLIC_SNAPBACK_SUPERVISOR_ORIGIN`.

The consumer used the supported external-session client with an explicit
backend URL and had a benchmark-era fallback of `http://127.0.0.1:4291`.
Snapback dynamically selected `http://127.0.0.1:4287`. Password authentication
through the application's gateway succeeded, then `prepareReactBinding`
attempted the stale fallback origin and the UI reported only `Failed to fetch`.
The failure looked like bad credentials even though it was a post-auth backend
connection failure.

## Why the current Guide did not prevent it

`guide/clients/react-expo.md#run-the-supervised-loop-on-expo-web` correctly
states that the supervised carrier works with Expo web and mentions pressing
`w` or using `--web`, but it gives no complete copy-paste Snapback command. It
also does not state that launching `expo start --web` through
`--client-command` is **not** equivalent to `--expo`: the generic arm does not
create or publish the supervised bootstrap exchange.

The CLI compounds the ambiguity: its help says the command can supervise "a
web or Expo client surface", while the only platform selector shown for the
Expo arm is `--expo-platform ios|android`. Nothing at parse time or startup
warns when an Expo command is routed through the generic client arm.

This is not a duplicate of the closed web-carrier ticket. The package-level
web carrier is paved; this ticket is about selecting it, understanding its
boundary, and diagnosing an accidental bypass.

## Desired resolution

1. **Make Expo web a first-class, discoverable supervisor selection.** Prefer
   `--expo-platform web` or an equivalently obvious supported command. It must
   run through the Expo supervisor and install the credential-free bootstrap
   origin; it must not silently degrade to the generic client arm.
2. **Document exact commands.** The Expo Guide and CLI help should show one
   complete command for iOS, Android, and web, and explicitly distinguish
   `--expo`/the Expo supervisor from `--client-command`.
3. **Diagnose the high-confidence mistake.** When a generic client command is
   recognizably `expo start`, emit a coded advisory naming that no supervised
   Expo bootstrap was installed and pointing to the first-class Expo-web
   command. Do not guess for arbitrary client commands.
4. **Cover explicit-origin external-session consumers.** The Guide should say
   that an app bypassing `SnapbackExpoProvider` and constructing
   `createExternalSessionClient(origin, ...)` owns origin propagation. Dynamic
   dev ports must come from the selected target/ready descriptor or a
   stack-owned configuration carrier, never an incidental fixed fallback.
5. **Improve unreachable-target diagnostics.** Where the client can retain
   causal context, wrap a browser transport failure with a stable diagnostic
   that includes the attempted origin and phase (for example, application
   binding preparation), rather than surfacing bare `Failed to fetch`.

## Acceptance

- `snapback dev --help` exposes an unambiguous supervised Expo-web path.
- A clean published Expo fixture reaches the supervised bootstrap and backend
  when the backend does not receive its usual first-choice port.
- An Expo-looking command passed through the generic arm produces a coded,
  actionable advisory or refusal with the exact supported alternative.
- The Guide contains copy-paste supervised commands and a tested
  external-session/custom-broker origin-propagation pattern.
- A deliberately unreachable external-session origin reports the attempted
  origin and connection phase; a UI can distinguish it from credential
  rejection without parsing prose.

